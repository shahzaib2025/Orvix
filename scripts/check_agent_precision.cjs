const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunState, score, regressionObservations } = require('../electron/agent/run-state.cjs');
const { recover } = require('../electron/agent/run-journal.cjs');
const { createProjectProfiles } = require('../electron/agent/project-profile.cjs');
const { parseCandidates } = require('../electron/agent/candidate-structure.cjs');
const { createProjectMap } = require('../electron/agent/project-map.cjs');
const { selectContext, evaluateRetrieval } = require('../electron/agent/context-selection.cjs');
const { createWorkspaceManager } = require('../electron/agent/workspace-manager.cjs');
const { createChangeStore } = require('../electron/agent/change-store.cjs');
const { createTools } = require('../electron/agent/tools.cjs');
const { auditReply } = require('../electron/agent/claim-audit.cjs');

async function fixture() {
  const root = fs.mkdtempSync(path.join(__dirname, 'agent-precision-fixture-'));
  const app = { getPath: () => path.join(root, 'data') };
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  const workspaces = createWorkspaceManager(app); await workspaces.open('task', project, async () => true);
  return { root, app, project, workspaces, signal: new AbortController().signal, cleanup: () => { assert.equal(path.dirname(root), __dirname); assert.ok(path.basename(root).startsWith('agent-precision-fixture-')); fs.rmSync(root, { recursive: true, force: true }); } };
}
const call = (id, name, args) => ({ id, name, args });
function answer(calls) { return { text: '', calls, route: 'chat', raw: { content: null, tool_calls: calls.map(item => ({ id: item.id, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.args) } })) } }; }

test('project commands require recorded success and expire on source, manifest or runtime changes', async () => {
  const f = await fixture(), maps = createProjectMap(f.app), profiles = createProjectProfiles(f.app);
  const manifest = path.join(f.project, 'package.json'), file = path.join(f.project, 'main.js');
  fs.writeFileSync(manifest, JSON.stringify({ scripts: { test: 'node --test', build: 'vite build' }, packageManager: 'pnpm@9' })); fs.writeFileSync(file, 'module.exports = 1;');
  let environment = { embeddedNode: 'fixture', executables: [{ name: 'node', status: 'available', version: 'v22' }] };
  const inspect = async () => { await maps.refresh(f.project, 'task', f.workspaces, f.signal); return profiles.inspect({ taskId: 'task', root: f.project, maps, workspaces: f.workspaces, environment }); };
  try {
    let value = await inspect(); assert.equal(value.projects[0].commands[0].command, 'pnpm run test'); assert.equal(value.projects[0].commands[0].status, 'declared');
    profiles.observe([f.project], { directory: f.project, command: 'echo test', status: 'passed' }); assert.equal((await inspect()).projects[0].commands[0].status, 'declared');
    profiles.observe([f.project], { directory: f.project, command: 'pnpm run test', status: 'passed', evidenceId: 'real-log', recordedAt: Date.now() });
    assert.equal((await inspect()).projects[0].commands[0].status, 'verified');
    fs.writeFileSync(file, 'module.exports = 2;'); assert.equal((await inspect()).projects[0].commands[0].status, 'stale');
    environment.executables[0].version = 'v24'; assert.equal((await inspect()).projects[0].commands[0].status, 'declared');
    profiles.observe([f.project], { directory: f.project, command: 'pnpm run test', status: 'failed' }); assert.equal((await inspect()).projects[0].commands[0].status, 'failed');
    fs.writeFileSync(manifest, JSON.stringify({ scripts: { test: 'other test' } })); assert.equal((await inspect()).projects[0].commands[0].status, 'declared');
  } finally { maps.shutdown(); f.cleanup(); }
});

test('lexical navigation omits comments and literal calls and labels language limitations', () => {
  const result = parseCandidates('main.go', 'package main\nimport (\n "local/lib"\n)\n/* func Fake() { Bad(); } */\nfunc Run() { Handle(); fmt.Println("Bogus()"); }\nvar note = `Ghost()`');
  assert.deepEqual(result.symbols.map(item => item.name), ['Run']); assert.equal(result.resolution, 'lexical-candidates');
  assert.ok(result.calls.some(item => item.name === 'Handle')); assert.ok(!result.calls.some(item => ['Bad', 'Bogus', 'Ghost'].includes(item.name))); assert.equal(result.imports[0].specifier, 'local/lib');
  assert.equal(parseCandidates('widget.rs', 'pub fn parse() { consume(); }').symbols[0].name, 'parse');
  assert.equal(parseCandidates('Widget.java', 'public class Widget {\n public void run() { consume(); }\n}').symbols.length, 2);
});

test('Go retrieval finds a known caller and test rather than equating a larger history with coverage', async () => {
  const f = await fixture(), maps = createProjectMap(f.app);
  const files = ['handler.go', 'main.go', 'handler_test.go'].map(name => path.join(f.project, name));
  fs.writeFileSync(path.join(f.project, 'go.mod'), 'module fixture\ngo 1.22'); fs.writeFileSync(files[0], 'package main\nfunc Handle() {}'); fs.writeFileSync(files[1], 'package main\nfunc main() { Handle() }'); fs.writeFileSync(files[2], 'package main\nfunc TestHandle() { Handle() }');
  try {
    await maps.refresh(f.project, 'task', f.workspaces, f.signal);
    const pack = await selectContext({ maps, roots: [f.project], workspaces: f.workspaces, taskId: 'task', query: 'Handle behavior', focusFiles: [files[0]] });
    assert.equal(evaluateRetrieval(pack, files).recall, 1); assert.equal(pack.coverage.testsIncluded, 1);
    assert.ok(pack.files.find(item => item.file === files[1]).reasons.some(reason => /candidate/.test(reason)));
    assert.equal(evaluateRetrieval({ files: [] }, files).recall, 0);
  } finally { maps.shutdown(); f.cleanup(); }
});

test('batch recovery retains completed operations and discards remaining actions without replay', () => {
  const state = { taskId: 'task', requestId: 'turn', safe: false, history: [], step: 3, pendingBatch: { answer: answer([call('done', 'write_file', { file: 'one' }), call('next', 'write_file', { file: 'two' })]), results: [{ id: 'done', text: 'Created one; saved evidence proof', images: [] }], active: null } };
  const result = recover(state); assert.equal(result.safe, true); assert.equal(result.state.step, 4); assert.equal(result.state.pendingBatch, null);
  assert.match(JSON.stringify(result.state.history), /Created one; saved evidence proof/); assert.match(JSON.stringify(result.state.history), /not started/); assert.equal(state.history.length, 0);
  state.pendingBatch.active = { name: 'write_file', mutates: true }; assert.equal(recover(state).safe, false); assert.match(recover(state).reason, /unknown/);
  state.pendingBatch.active = { name: 'read_file', mutates: false }; assert.equal(recover(state).safe, true);
});

test('terminal results survive restart and are recovered even before completion metadata commits', async () => {
  const f = await fixture();
  try {
    const store = createRunState(f.app); const id = store.begin({ taskId: 'task', requestId: 'turn', modelId: 'fixture', accessMode: 'Full access', messages: [] });
    store.tool(id, { callId: 'edit', name: 'write_file', phase: 'started' }); store.tool(id, { callId: 'edit', name: 'write_file', phase: 'completed', durationMs: 25 });
    store.finish(id, { result: { text: 'Saved reply', verification: { checks: [] } }, verified: true });
    assert.equal(createRunState(f.app).result('task', 'turn').text, 'Saved reply');
    const metadataFile = path.join(f.app.getPath(), 'agent-attempts', id + '.json'); const metadata = JSON.parse(fs.readFileSync(metadataFile)); metadata.status = 'running'; fs.writeFileSync(metadataFile, JSON.stringify(metadata));
    const restored = createRunState(f.app); assert.equal(restored.latest('task', 'turn').status, 'completed'); assert.equal(restored.scorecard().verified, 1);
    const second = restored.begin({ taskId: 'task', requestId: 'turn2', accessMode: 'Full access', messages: [] }); restored.tool(second, { name: 'write_file', callId: 'unknown', phase: 'started' });
    assert.equal(createRunState(f.app).latest('task', 'turn2').status, 'interrupted');
  } finally { f.cleanup(); }
});

test('scorecard measures comparable observed runs and excludes cancelled, partial and unknown timing from success', () => {
  const base = { taskId: 'task', requestId: 'one', requestSignature: 'same', initialFingerprint: 'same', modelId: 'fixture', accessMode: 'Full access', startedAt: 1, coding: true, tools: [], status: 'completed', verified: false };
  const records = [{ ...base, status: 'failed' }, { ...base, startedAt: 2, resumed: true, verified: true }, { ...base, requestId: 'two', requestSignature: 'other', initialFingerprint: 'different', status: 'cancelled' }, { ...base, requestId: 'three', requestSignature: 'third', tools: [{ name: 'write_file', status: 'completed', durationMs: 100 }, { name: 'write_file', status: 'interrupted', durationMs: null }] }];
  const value = score(records); assert.equal(value.firstAttempt.passed, 0); assert.equal(value.firstAttempt.total, 2); assert.equal(value.recovery.rate, 1); assert.equal(value.repeatConsistency.rate, 0); assert.equal(value.partial, 1); assert.equal(value.tools[0].averageMs, 100); assert.equal(value.falseCompletionRate, null);
  assert.equal(score([]).firstAttempt.rate, null);
  assert.deepEqual(regressionObservations([{ phase: 'reproduce', status: 'passed', exitCode: 0, command: 'test', directory: 'root' }, { phase: 'regression', status: 'failed', command: 'test', directory: 'root' }]), { compared: 1, failed: 1 });
});

test('grouped reads enforce scope and sensitive-file policy and retain per-file hashes and errors', async () => {
  const f = await fixture(), changes = createChangeStore(f.app);
  try {
    const file = path.join(f.project, 'main.js'); fs.writeFileSync(file, 'first\nsecond\nthird'); fs.writeFileSync(path.join(f.project, '.env'), 'SECRET=hidden');
    const tools = createTools(changes, f.workspaces, {}, 'task', f.signal, async () => true, async () => true, () => {}, {}, async () => true, () => {});
    const result = JSON.parse(await tools.call('read_file_ranges', { ranges: [{ file, start_line: 2, max_lines: 1 }, { file: path.join(f.project, '.env') }, { file: path.join(f.root, 'outside.js') }] }));
    assert.equal(result.results[0].lines[0].text, 'second'); assert.match(result.results[0].sha256, /^[a-f0-9]{64}$/); assert.ok(result.results[1].error); assert.ok(result.results[2].error); assert.ok(!JSON.stringify(result).includes('SECRET=hidden'));
  } finally { changes.stop('task'); f.cleanup(); }
});

test('progress claims need recorded counts and cannot turn a single passing check into a fabricated suite', () => {
  assert.ok(auditReply('All 109 regression checks now pass.', { checks: [{ phase: 'regression', status: 'passed', output: 'tests 42\npass 42' }] }, false).length);
  assert.equal(auditReply('All 42 regression checks now pass.', { checks: [{ phase: 'regression', status: 'passed', output: 'tests 42\npass 42' }] }, false).length, 0);
  assert.equal(auditReply('I’ll inspect the relevant callers, then check the behavior.', { checks: [] }, false).length, 0);
  assert.ok(auditReply('42 tests passed.', { checks: [{ phase: 'regression', status: 'passed', output: 'tests 42\npass 40' }] }, false).length);
});

async function review({ purpose, history }) {
  const prompt = history.at(-1).content;
  const value = purpose === 'request_understanding' ? { goal: 'Create the requested files', acknowledgement: 'I’ll create the requested files and check their saved contents.', feature: 'Fixture files', expectedBehavior: 'Requested contents are saved', questions: [], assumptions: [], examples: [] }
    : purpose === 'execution_requirements' ? { requirements: [{ text: 'The requested project outcome is present in the target files.', verification_types: ['focused'] }] }
    : purpose === 'acceptance_planning' ? { status: 'approved', criteria: JSON.parse(/Requirements:\n([^\n]+)\nObserved project sources/.exec(prompt)[1]).map(item => ({ id: 'accept-' + item.id, requirementId: item.id, description: item.text, observable: 'File state matches request', negativeCase: 'Wrong content rejected', method: 'command' })), missingRequirements: [] }
      : { status: 'approved', reason: 'Actual requested state is asserted.' };
  return { text: JSON.stringify(value), calls: [] };
}
const environment = async () => ({ status: 'ok', observedAt: Date.now(), embeddedNode: process.version, executables: [{ name: 'node', status: 'available', version: process.version }, { name: 'npm', status: 'available', version: 'fixture' }] });

test('actual executor resumes completed edits after batch cancellation and restores a lost renderer reply', async () => {
  const f = await fixture(), { createAgentEngine } = require('../electron/agent/engine.cjs');
  const first = path.join(f.project, 'one.txt'), second = path.join(f.project, 'two.txt'); let engine, step = 0, cancelled = false; const events = [];
  const input = { taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, designProfile: 'max', messages: [{ role: 'user', content: 'Create the requested files' }] };
  try {
    engine = createAgentEngine(f.app, { getKey: () => 'fixture' }, event => {
      events.push(event);
      if (!cancelled && event.type === 'tool' && event.phase === 'completed' && event.callId === 'one') { cancelled = true; engine.cancel('task'); }
    }, () => {}, { collectEnvironment: environment, reviewModel: review, requestModel: async () => {
      if (step++ === 0) return answer([call('one', 'write_file', { file: first, content: 'Saved once' }), call('two', 'write_file', { file: second, content: 'Must not run yet' })]);
      throw Error('Cancelled batch must not reach another model request');
    } });
    await assert.rejects(engine.run(input), /cancelled/i);
    assert.equal(fs.readFileSync(first, 'utf8'), 'Saved once'); assert.equal(fs.existsSync(second), false);
    assert.equal(engine.journal.metadata('task').designProfile, 'max'); assert.equal(engine.journal.metadata('task').safe, true); assert.equal(engine.journal.metadata('task').completedTools, 1);
    assert.equal(events.find(event => event.type === 'model_progress' && event.progressId === 'request-acknowledgement')?.text, 'I’ll create the requested files and check their saved contents.');
    engine.shutdown();
    engine = createAgentEngine(f.app, { getKey: () => 'fixture' }, () => {}, () => {}, { collectEnvironment: environment, reviewModel: review, requestModel: async ({ history, designProfile }) => {
      assert.equal(designProfile, "max"); assert.match(JSON.stringify(history), /Saved evidence/); assert.match(JSON.stringify(history), /remaining proposed actions were discarded/);
      return { text: 'One edit is saved; the second file still needs work.', calls: [], route: 'chat', raw: { content: 'One edit is saved; the second file still needs work.' } };
    } });
    const result = await engine.run({ ...input, resume: true }); assert.match(result.text, /second file/); assert.equal(engine.runState.scorecard().verified, 0);
    const disk = await engine.reconcileTasks([{ id: 'task', turns: [{ id: 'turn', status: 'pending', runStartedAt: 0 }] }]);
    assert.equal(disk[0].turns[0].status, 'done'); assert.equal(disk[0].turns[0].reply, result.text);
    assert.equal(fs.existsSync(second), false); assert.equal(engine.journal.read('task'), null);
  } finally { engine?.shutdown(); f.cleanup(); }
});

test('interrupted task reconciliation restores its saved partial file report', async () => {
  const f = await fixture(), { createAgentEngine } = require('../electron/agent/engine.cjs'); let engine;
  try {
    engine = createAgentEngine(f.app, { getKey: () => null }, () => {}, () => {}, {});
    const file = path.join(f.project, 'index.html');
    await engine.turnReports.write('task', 'turn', [{ path: file, folder: f.project, kind: 'modified', binary: false, diffAvailable: true,
      added: 4, deleted: 1, before: Buffer.from('before').toString('base64'), after: Buffer.from('after').toString('base64') }]);
    const attempt = engine.runState.begin({ taskId: 'task', requestId: 'turn', modelId: 'fixture', accessMode: 'Full access', messages: [] });
    engine.runState.finish(attempt, { interrupted: true });
    const disk = await engine.reconcileTasks([{ id: 'task', turns: [{ id: 'turn', status: 'pending', runStartedAt: 0 }] }]);
    assert.equal(disk[0].turns[0].status, 'error');
    assert.equal(disk[0].turns[0].turnReport.changes[0].path, file);
    assert.match(disk[0].turns[0].error, /application stopped/i);
  } finally { engine?.shutdown(); f.cleanup(); }
});

test('executor records a project test command only after a real successful host execution', async () => {
  const f = await fixture(), { createAgentEngine } = require('../electron/agent/engine.cjs'); let engine, step = 0;
  fs.writeFileSync(path.join(f.project, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "require(\'node:assert\').equal(require(\'node:fs\').readFileSync(\'state.txt\',\'utf8\'),\'actual\')"' } }));
  fs.writeFileSync(path.join(f.project, 'state.txt'), 'actual');
  try {
    engine = createAgentEngine(f.app, { getKey: () => 'fixture' }, () => {}, () => {}, { collectEnvironment: environment, reviewModel: review, requestModel: async () => step++ === 0 ? answer([call('check', 'verify_work', { directory: f.project, command: 'npm run test', label: 'Assert persisted state', phase: 'focused', expected_exit: 'zero' })]) : { text: 'The persisted fixture state matched.', calls: [], route: 'chat', raw: { content: 'The persisted fixture state matched.' } } });
    const result = await engine.run({ taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Check the persisted state' }] });
    assert.equal(result.verification.checks.find(check => check.command === 'npm run test').status, 'passed');
    const value = await engine.getExecution('task', 'turn', { refresh: false });
    assert.equal(value.execution.projectSetup.profiles[0].projects[0].commands[0].status, 'verified');
    assert.ok(value.execution.projectSetup.profiles[0].projects[0].commands[0].verification.evidenceId);
  } finally { engine?.shutdown(); f.cleanup(); }
});

test('completed streamed updates are audited and pending approvals remain recoverable by a reloaded window', async () => {
  const f = await fixture(), { createAgentEngine } = require('../electron/agent/engine.cjs'); let engine, step = 0; const events = [];
  try {
    let releaseApproval; const approvalReady = new Promise(resolve => { releaseApproval = resolve; });
    engine = createAgentEngine(f.app, { getKey: () => 'fixture' }, event => { events.push(event); if (event.type === 'approval') releaseApproval(event); }, () => {}, { collectEnvironment: environment, reviewModel: review, requestModel: async ({ onProgress }) => {
      onProgress?.({ kind: 'agent_update', id: 'bad', phase: 'delta', text: 'All 109 checks passed.' });
      onProgress?.({ kind: 'agent_update', id: 'bad', phase: 'complete', text: 'All 109 checks passed.' });
      return step++ === 0 ? answer([call('cmd', 'run_command', { directory: f.project, command: 'node --version' })]) : { text: 'Command approval was declined; no checks ran.', calls: [], route: 'chat', raw: { content: 'Command approval was declined; no checks ran.' } };
    } });
    const pending = engine.run({ taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Controlled', accessModeVersion: 2, messages: [{ role: 'user', content: 'Inspect the project runtime' }] });
    const event = await approvalReady; assert.equal(engine.pendingApproval('task').approvalId, event.approvalId); assert.equal(engine.runState.latest('task', 'turn').phase, 'waiting for approval');
    const disk = await engine.reconcileTasks([{ id: 'task', turns: [{ id: 'turn', status: 'pending', runStartedAt: 0 }] }]); assert.equal(disk[0].turns[0].runState.status, 'running');
    engine.decide(event.approvalId, false); await pending;
    assert.equal(engine.pendingApproval('task'), null); assert.ok(!events.some(event => event.type === 'model_progress' && event.progressId.endsWith('-bad') && /109/.test(event.text ?? '')));
  } finally { engine?.shutdown(); f.cleanup(); }
});
