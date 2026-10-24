const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createProjectMap } = require('../electron/agent/project-map.cjs');
const { createWorkspaceManager } = require('../electron/agent/workspace-manager.cjs');
const { createChangeStore } = require('../electron/agent/change-store.cjs');
const { fingerprint } = require('../electron/agent/verification.cjs');
const { createRunState } = require('../electron/agent/run-state.cjs');
function fixture() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-responsive-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'agent-responsive-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"responsive-fixture"}');
  return { state, project, app: { getPath: () => state }, cleanup() {
    assert.equal(path.dirname(state), path.resolve(os.tmpdir())); assert.ok(path.basename(state).startsWith('orvix-responsive-'));
    assert.equal(path.dirname(project), __dirname); assert.ok(path.basename(project).startsWith('agent-responsive-fixture-'));
    fs.rmSync(state, { recursive: true, force: true }); fs.rmSync(project, { recursive: true, force: true });
  } };
}
test('concurrent project scans coalesce while the main event loop remains responsive', async () => {
  const f = fixture(), maps = createProjectMap(f.app, { background: true }), workspaces = createWorkspaceManager(f.app);
  let timer;
  try {
    const file = path.join(f.project, 'heavy.ts');
    fs.writeFileSync(file, Array.from({length:25000}, (_,index) => `export function example${index}(value: number) { return value + ${index}; }`).join('\n'));
    await workspaces.open('task', f.project, async () => true);
    let ticks = 0, longestGap = 0, previous = performance.now();
    timer = setInterval(() => { const now = performance.now(); ticks++; longestGap = Math.max(longestGap, now - previous); previous = now; }, 10);
    const results = await Promise.all(Array.from({length:12}, () => maps.refresh(f.project, 'task', workspaces, new AbortController().signal)));
    assert.ok(results.every(result => result === results[0]), 'one shared scan must serve all overlapping requests');
    assert.equal(results[0].files.find(item => item.file === file).symbols.length, 25000);
    assert.ok(ticks > 5, 'main-thread timers must run during indexing');
    assert.ok(longestGap < 500, `main event loop stalled for ${longestGap.toFixed(1)}ms`);
    console.log(`Index responsiveness: ${ticks} main-thread timer ticks, longest gap ${longestGap.toFixed(1)}ms; 12 requests shared one scan.`);
  } finally { clearInterval(timer); maps.shutdown(); f.cleanup(); }
});
test('loading saved turn metadata does not start project indexing or inspect tracked file bodies', async () => {
  const f = fixture(), { createAgentEngine } = require('../electron/agent/engine.cjs'); let engine;
  try {
    engine = createAgentEngine(f.app, {getKey: () => null}, () => {}, () => {});
    await engine.workspaces.open('task', f.project, async () => true);
    for (let index = 0; index < 80; index++) engine.execution.ensure('task', 'turn-' + index, 'Historic turn', 'Full access');
    engine.projectMaps.refresh = () => { throw new Error('A history lookup triggered indexing'); };
    engine.changes.diff = () => { throw new Error('A history lookup read a tracked file body'); };
    engine.changes.capture = () => { throw new Error('A history lookup loaded the full changes manifest'); };
    const results = await Promise.all(Array.from({length:80}, (_,index) => engine.getExecution('task', 'turn-' + index, {refresh:false})));
    assert.ok(results.every(result => result.execution && result.freshness === 'saved'));
  } finally { engine?.shutdown(); f.cleanup(); }
});
test('change fingerprint reads the manifest once and invalidates its cache after edits or restore', () => {
  const f = fixture(), store = createChangeStore(f.app);
  try {
    for (let index = 0; index < 16; index++) { const file = path.join(f.project, index + '.txt'); fs.writeFileSync(file, 'after-' + index); store.markFile('task', file, Buffer.from('before'), Buffer.from('after-' + index)); }
    let reads = 0; const capture = store.capture; store.capture = task => { reads++; return capture(task); };
    store.diff = () => { throw new Error('Fingerprint repeatedly reopened the changes manifest'); };
    const first = fingerprint(store.list('task'), store, 'task'); assert.equal(reads, 1);
    assert.equal(fingerprint(store.list('task'), store, 'task'), first); assert.equal(reads, 1);
    fs.writeFileSync(path.join(f.project, '0.txt'), 'different'); store.markFile('task', path.join(f.project, '0.txt'), Buffer.from('before'), Buffer.from('different'));
    assert.notEqual(fingerprint(store.list('task'), store, 'task'), first); assert.equal(reads, 2);
    store.restoreAll('task'); assert.notEqual(fingerprint(store.list('task'), store, 'task'), first); assert.equal(reads, 3);
  } finally { f.cleanup(); }
});
test('a cancelled background scan does not stop other queued projects', async () => {
  const f = fixture(), maps = createProjectMap(f.app, {background:true}), workspaces = createWorkspaceManager(f.app);
  try {
    const second = path.join(f.project, 'second'); fs.mkdirSync(second); fs.writeFileSync(path.join(second, 'package.json'), '{"name":"second"}'); fs.writeFileSync(path.join(second, 'index.ts'), 'export const ready = true;');
    await workspaces.open('task', f.project, async () => true); await workspaces.open('other', second, async () => true);
    const controller = new AbortController();
    const cancelled = maps.refresh(f.project, 'task', workspaces, controller.signal);
    const other = maps.refresh(second, 'other', workspaces, new AbortController().signal);
    controller.abort(); await assert.rejects(cancelled, /cancelled/);
    assert.ok((await other).files.some(file => file.symbols.some(symbol => symbol.name === 'ready')));
  } finally { maps.shutdown(); f.cleanup(); }
});

test('tool output heartbeats update live run state without synchronously rewriting its journal', async () => {
  const f = fixture(), state = createRunState(f.app);
  try {
    const id = state.begin({ taskId: 'task', requestId: 'request', messages: [], modelId: 'fixture', accessMode: 'Controlled' });
    const file = path.join(f.state, 'agent-attempts', `${id}.json`);
    const before = JSON.parse(fs.readFileSync(file, 'utf8')).lastProgressAt;
    await new Promise(resolve => setTimeout(resolve, 2));
    const live = state.progress(id);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8')).lastProgressAt;
    assert.ok(live.lastProgressAt > before, 'live state should reflect new output');
    assert.equal(persisted, before, 'partial output must not synchronously rewrite the attempt journal');
  } finally { f.cleanup(); }
});
