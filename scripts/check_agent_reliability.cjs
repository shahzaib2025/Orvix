const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEvidenceStore } = require('../electron/agent/evidence-store.cjs');
const { createExecutionMapStore } = require('../electron/agent/execution-map.cjs');
const { createProgressRecovery } = require('../electron/agent/progress-recovery.cjs');
const { createProjectMap } = require('../electron/agent/project-map.cjs');
const { createTaskStore } = require('../electron/agent/task-store.cjs');
const { createTools } = require('../electron/agent/tools.cjs');
const { auditReply } = require('../electron/agent/claim-audit.cjs');

async function fixtureReview({ purpose, history }) {
  const prompt = history.at(-1).content;
  let value;
  if (purpose === 'request_understanding') value = { goal: 'Fixture task', expectedBehavior: 'Preserve the requested behavior', feature: 'fixture', trigger: '', assumptions: [], examples: [], questions: [], exclusions: [] };
  else if (purpose === 'execution_requirements') {
    const request = /Original request:\n([\s\S]*?)\nIntent:/.exec(prompt)?.[1] ?? 'Complete the requested task';
    const placeholder = JSON.parse(/Current placeholder requirement:\n([^\n]+)/.exec(prompt)[1]);
    value = { requirements: [{ text: request, verification_types: placeholder[0].verificationTypes }] };
  }
  else if (purpose === 'acceptance_planning') {
    const requirements = JSON.parse(/Requirements:\n([^\n]+)\nObserved project sources/.exec(prompt)[1]);
    value = { status: 'approved', criteria: requirements.map(item => ({ id: 'accept-' + item.id, requirementId: item.id, description: item.text, observable: 'Actual requested state observed', negativeCase: 'Invalid state remains rejected', method: item.verificationTypes.includes('research') ? 'observation' : 'command' })), missingRequirements: [], reason: 'Fixture criteria cover the request.' };
  } else value = { status: 'approved', reason: 'Fixture review observes an actual assertion against the application.' };
  return { text: JSON.stringify(value), calls: [] };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-evidence-'));
  const app = { getPath: () => root };
  const evidence = createEvidenceStore(app);
  return { root, app, evidence, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('full evidence survives restart, pagination and checksum validation', async () => {
  const f = fixture();
  try {
    const text = 'first\n' + 'x'.repeat(90000) + '\nlast';
    const item = f.evidence.record('task', 'turn', { kind: 'tool', name: 'read_file' }, text);
    const restored = createEvidenceStore(f.app);
    let actual = '', offset = 0;
    do { const page = restored.read('task', 'turn', item.id, offset); actual += page.output; offset = page.nextOffset; } while (offset !== null);
    assert.equal(actual, text);
    assert.throws(() => restored.read('other', 'turn', item.id), /unavailable/);
    assert.throws(() => restored.read('task', '../turn', item.id), /Invalid/);
    for (let i = 0; i < 42; i++) restored.record('task', 'turn', { kind: 'tool', name: 'read_file' }, String(i));
    const first = await restored.list('task', 'turn');
    const second = await restored.list('task', 'turn', first.nextOffset);
    assert.equal(first.records.length, 40); assert.equal(second.records.length, 3); assert.equal(second.nextOffset, null);
    fs.appendFileSync(path.join(f.root, 'agent-evidence', 'task', 'blobs', item.outputHash + '.txt'), 'tampered');
    assert.throws(() => restored.read('task', 'turn', item.id), /checksum/);
  } finally { f.cleanup(); }
});

test('streamed command output retains early output beyond the model tail', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const tools = createTools({ register: async () => ({}), list: () => [], scan: async () => ({}) }, { assert: (_, value) => value, list: () => [f.root] }, {}, 'task', controller.signal,
      async () => 'host', null, () => {}, null, null, null, null, null, 'Full access', {
        commandCapture: args => f.evidence.commandCapture('task', 'turn', args),
        evidenceMatches: (id, text) => f.evidence.matches('task', 'turn', id, text),
      });
    const command = 'node -e "console.log(\'EARLY_ASSERTION\');console.log(\'x\'.repeat(50000));console.log(\'END\')"';
    const result = JSON.parse(await tools.call('verify_work', { directory: f.root, command, label: 'Full output assertion', phase: 'focused', expected_exit: 'zero', expected_output: 'EARLY_ASSERTION' }));
    assert.equal(result.status, 'passed');
    assert.ok(result.commandEvidenceId);
    assert.equal(f.evidence.matches('task', 'turn', result.commandEvidenceId, 'EARLY_ASSERTION'), true);
    assert.equal(f.evidence.matches('task', 'turn', result.commandEvidenceId, 'END'), true);
    assert.ok(f.evidence.metadata('task', 'turn', result.commandEvidenceId).outputBytes > 50000);
  } finally { f.cleanup(); }
});

test('execution dependencies reject cycles and unsupported completion atomically', () => {
  const f = fixture();
  try {
    const map = createExecutionMapStore(f.app, f.evidence);
    map.ensure('task', 'turn', 'Fix behavior', 'Full access');
    const requirement = { id: 'r1', text: 'Reject invalid input', verification_types: ['user_flow'] };
    map.update('task', 'turn', { replace_initial_goal: true, requirements: [requirement], actions: [
      { id: 'inspect', title: 'Inspect handler', kind: 'inspect', requirement_ids: ['r1'] },
      { id: 'edit', title: 'Repair handler', kind: 'edit', requirement_ids: ['r1'], depends_on: ['inspect'] },
    ] });
    const revision = map.read('task', 'turn').revision;
    assert.throws(() => map.update('task', 'turn', { actions: [{ id: 'inspect', title: 'Inspect handler', kind: 'inspect', requirement_ids: ['r1'], depends_on: ['edit'] }] }), /cycle/);
    assert.equal(map.read('task', 'turn').revision, revision);
    assert.throws(() => map.update('task', 'turn', { actions: [{ id: 'inspect', title: 'Inspect handler', kind: 'inspect', requirement_ids: ['r1'], state: 'done' }] }), /evidence/);
    const planned = f.evidence.record('task', 'turn', { kind: 'model', name: 'assistant_output' }, 'I did it');
    assert.throws(() => map.update('task', 'turn', { actions: [{ id: 'inspect', title: 'Inspect handler', kind: 'inspect', requirement_ids: ['r1'], state: 'done', evidence_ids: [planned.id] }] }), /Planning/);
    assert.throws(() => map.validateLinks(map.read('task', 'turn'), ['missing']), /Unknown/);
  } finally { f.cleanup(); }
});

test('verification is requirement-specific, fresh, and superseded by a failed rerun', () => {
  const f = fixture();
  try {
    const map = createExecutionMapStore(f.app, f.evidence);
    map.ensure('task', 'turn', 'Fix behavior', 'Full access');
    map.update('task', 'turn', { replace_initial_goal: true, requirements: [{ id: 'r1', text: 'Invalid input rejected', verification_types: ['user_flow'] }] });
    const observe = (phase, status, fingerprint = 'current') => { const proof = f.evidence.record('task', 'turn', { kind: 'verification', name: 'verify_work', requirementIds: ['r1'], phase, status, stateFingerprint: fingerprint, command: 'same', directory: 'root' }, status); map.observe('task', 'turn', proof); };
    observe('build', 'passed'); observe('reproduce', 'passed');
    assert.equal(map.view('task', 'turn', 'current').complete, false);
    observe('user_flow', 'passed'); assert.equal(map.view('task', 'turn', 'current').complete, true);
    assert.equal(map.view('task', 'turn', 'changed').requirements[0].status, 'stale');
    observe('user_flow', 'failed'); assert.equal(map.view('task', 'turn', 'current').requirements[0].status, 'failed');
    assert.equal(map.read('task', 'turn').proofs.filter(item => item.phase === 'user_flow').length, 1);
    assert.ok(auditReply('All requirements are complete.', { checks: [], requirements: map.view('task', 'turn', 'current').requirements }, false).length);
  } finally { f.cleanup(); }
});

test('research support requires source text, remains scoped, and invalidates after changes', () => {
  const f = fixture();
  try {
    const map = createExecutionMapStore(f.app, f.evidence);
    map.ensure('task', 'turn', 'Explain handler', 'Plan');
    const source = f.evidence.record('task', 'turn', { kind: 'tool', name: 'read_file', stateFingerprint: 'current' }, 'function validateInput() {}');
    assert.throws(() => map.support('task', 'turn', { evidence_id: source.id, requirement_ids: ['r-goal'], expected_text: 'made up' }), /not found/);
    map.support('task', 'turn', { evidence_id: source.id, requirement_ids: ['r-goal'], expected_text: 'function validateInput' });
    assert.equal(map.view('task', 'turn', 'current').requirements[0].status, 'supported');
    assert.equal(map.view('task', 'turn', 'changed').complete, false);
  } finally { f.cleanup(); }
});

test('progress recovery survives checkpoints, detects repeated failures, and never ends a run', () => {
  let recovery = createProgressRecovery();
  assert.equal(recovery.observe('read_file', { b: 2, a: 1 }, 'same', 'e1', 'current'), null);
  assert.equal(recovery.observe('read_file', { a: 1, b: 2 }, 'same', 'e2', 'current'), null);
  recovery = createProgressRecovery(recovery.snapshot());
  const note = recovery.observe('read_file', { a: 1, b: 2 }, 'same', 'e3', 'current');
  assert.match(note.instruction, /Continue working/); assert.match(note.instruction, /read_evidence/); assert.equal(note.recovery, 1);
  recovery = createProgressRecovery();
  recovery.observe('verify_work', {}, '{"status":"failed"}', 'e1', 'current', false, true);
  assert.match(recovery.observe('verify_work', {}, '{"status":"failed"}', 'e2', 'current', false, true).reason, /failing/);
  const diverse = createProgressRecovery();
  for (let i = 0; i < 100; i++) assert.equal(diverse.observe('read_file', { file: i }, String(i), 'e' + i, 'current'), null);
});

test('project map refreshes symbols and import edges when dependencies appear or disappear', async () => {
  const f = fixture();
  try {
    const root = path.join(f.root, 'project'); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"node test.js"}}');
    fs.writeFileSync(path.join(root, 'main.ts'), "import { handler } from './handler'; export const run = handler;");
    fs.writeFileSync(path.join(root, '.env'), 'ignored fixture');
    fs.mkdirSync(path.join(root, 'node_modules')); fs.writeFileSync(path.join(root, 'node_modules', 'hidden.ts'), 'export const hidden = 1;');
    const workspaces = { assert: (_, file) => { assert.ok(file === root || file.startsWith(root + path.sep)); return file; } };
    const map = createProjectMap(f.app); const signal = new AbortController().signal;
    await map.refresh(root, 'task', workspaces, signal);
    const before = map.fingerprint([root]);
    assert.equal(map.query(root, { action: 'files' }).results.length, 2);
    fs.writeFileSync(path.join(root, 'handler.ts'), 'export function handler() { return true; }');
    await map.refresh(root, 'task', workspaces, signal);
    assert.notEqual(map.fingerprint([root]), before);
    assert.equal(map.query(root, { action: 'symbol', query: 'handler' }).total, 1);
    assert.equal(map.query(root, { action: 'dependents', query: 'handler.ts' }).total, 1);
    fs.unlinkSync(path.join(root, 'handler.ts')); await map.refresh(root, 'task', workspaces, signal);
    assert.equal(map.query(root, { action: 'dependents', query: 'handler.ts' }).total, 0);
    assert.equal(map.fingerprint([root]), before);
  } finally { f.cleanup(); }
});

test('per-task history migrates legacy storage and saves beyond the old aggregate limit', () => {
  const f = fixture();
  try {
    const old = [{ id: 'task', turns: [{ id: 'turn', prompt: 'Keep prompt', reply: 'Keep reply', activity: [] }] }];
    fs.writeFileSync(path.join(f.root, 'agent-tasks.json'), JSON.stringify(old));
    const store = createTaskStore(f.app); assert.deepEqual(store.read(), old);
    const tasks = Array.from({ length: 4 }, (_, i) => ({ id: 'task-' + i, turns: [{ id: 'turn', prompt: 'p'.repeat(8_000_000), reply: 'Exact reply ' + i, activity: [] }] }));
    store.write(tasks); const restored = createTaskStore(f.app).read();
    assert.equal(restored.length, 4); assert.equal(restored[3].turns[0].prompt.length, 8_000_000); assert.equal(restored[3].turns[0].reply, 'Exact reply 3');
    assert.throws(() => store.write([{ id: '../bad', turns: [] }]), /Invalid/);
    assert.equal(store.read().length, 4);
  } finally { f.cleanup(); }
});

test('project map uses configured TypeScript aliases and reports Python structure honestly', async () => {
  const f = fixture();
  try {
    const root = path.join(f.root, 'project'); fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
    fs.writeFileSync(path.join(root, 'main.ts'), "import { handle } from '@/handler'; export const run = handle;");
    fs.writeFileSync(path.join(root, 'src', 'handler.ts'), 'export function handle() { return true; }');
    fs.writeFileSync(path.join(root, 'worker.py'), 'from helper import process\nclass Worker:\n    def perform(self):\n        return process()\n');
    fs.writeFileSync(path.join(root, 'helper.py'), 'def process():\n    return True\n');
    const map = createProjectMap(f.app); const workspaces = { assert: (_, file) => file };
    await map.refresh(root, 'task', workspaces, new AbortController().signal);
    assert.equal(map.query(root, { action: 'dependents', query: 'src/handler.ts' }).total, 1);
    const worker = map.query(root, { action: 'files', query: 'worker.py' }).results[0];
    if (worker.resolution === 'unavailable') assert.ok(worker.diagnostics.length);
    else {
      assert.equal(worker.resolution, 'python-ast');
      assert.ok(worker.symbols.some(item => item.name === 'Worker'));
      assert.ok(worker.symbols.some(item => item.name === 'perform'));
      assert.equal(worker.imports[0].resolution, 'python-static-candidate');
      assert.equal(map.query(root, { action: 'dependents', query: 'helper.py' }).total, 1);
    }
  } finally { f.cleanup(); }
});

test('engine links a real edited behavior to passing evidence and preserves it after restart', async () => {
  const f = fixture();
  const root = fs.mkdtempSync(path.join(__dirname, 'agent-fixture-'));
  const { createAgentEngine } = require('../electron/agent/engine.cjs');
  let engine;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"agent-fixture"}');
    const file = path.join(root, 'handler.cjs');
    fs.writeFileSync(file, 'module.exports = n => false;');
    let step = 0;
    const events = [];
    const sequence = [
      ['open_workspace', { directory: root }],
      ['update_execution_map', { replace_initial_goal: true, requirements: [{ id: 'positive', text: 'Positive input accepted', verification_types: ['focused'] }], actions: [{ id: 'check', title: 'Verify positive input', kind: 'check', requirement_ids: ['positive'] }] }],
      ['read_file', { file }],
      ['write_file', { file, content: 'module.exports = n => n > 0;', expected_original: 'module.exports = n => false;', requirement_ids: ['positive'] }],
      ['verify_work', { directory: root, command: 'node -e "const f=require(\'./handler.cjs\');if(!f(1)||f(0))process.exit(1);console.log(\'Positive input accepted\')"', label: 'Positive input', phase: 'focused', expected_exit: 'zero', expected_output: 'Positive input accepted', requirement_ids: ['positive'], action_id: 'check' }],
    ];
    engine = createAgentEngine(f.app, { getKey: () => 'fixture-key' }, event => events.push(event), () => {}, { reviewModel: fixtureReview, requestModel: async ({ history }) => {
      let item = sequence[step];
      if (step === 5) {
        const last = history.filter(item => item.role === 'tool').at(-1).content;
        const id = /Saved evidence: ([\w-]+)/.exec(last)[1];
        item = ['update_execution_map', { actions: [{ id: 'check', title: 'Verify positive input', kind: 'check', state: 'done', requirement_ids: ['positive'], evidence_ids: [id] }] }];
      }
      step++;
      if (!item) return { text: 'Positive input is accepted; zero is rejected.', calls: [], route: 'chat', raw: { content: 'Positive input is accepted; zero is rejected.' }, usage: null };
      const [name, args] = item;
      const call = { id: 'call-' + step, name, args };
      return { text: '', calls: [call], route: 'chat', raw: { content: null, tool_calls: [{ id: call.id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, usage: null };
    } });
    const result = await engine.run({ taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Accept positive input and reject zero.' }] });
    assert.equal(result.verification.requirements[0].status, 'verified');
    assert.equal(engine.taskMemory.read('task').status, 'completed');
    assert.equal(engine.runState.scorecard().verified, 1, 'only current verified requirements count as a successful coding attempt');
    assert.equal(engine.execution.read('task', 'turn').projectSetup.profiles[0].projects[0].runtime.status, 'available', 'opening the workspace refreshes the initially empty runtime probe');
    assert.equal((await engine.getExecution('task', 'turn')).execution.complete, true);
    assert.ok(events.some(event => event.type === 'execution'));
    assert.ok(events.filter(event => event.type === 'tool' && event.phase === 'completed').every(event => event.evidenceId));
    assert.equal(engine.journal.read('task'), null);
    engine.shutdown();
    engine = createAgentEngine(f.app, { getKey: () => 'fixture-key' }, () => {}, () => {});
    assert.equal((await engine.getExecution('task', 'turn')).execution.complete, true);
    fs.writeFileSync(file, 'module.exports = n => false;');
    assert.equal((await engine.getExecution('task', 'turn')).execution.requirements[0].status, 'stale');
  } finally { engine?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); f.cleanup(); }
});

test('stream capture redacts credentials split across chunks', () => {
  const f = fixture();
  try {
    const capture = f.evidence.commandCapture('task', 'turn', { command: 'fixture' });
    capture.append('API key: oc_sk_AbCd'); capture.append('Ef12345678901234567890\nDone');
    const saved = capture.finish({ status: 'passed' });
    const text = f.evidence.read('task', 'turn', saved.id).output;
    assert.match(text, /API key redacted/); assert.equal(text.includes('AbCd'), false); assert.match(text, /Done/);
  } finally { f.cleanup(); }
});

test('engine recovery and evidence survive compaction and a safe interrupted resume', async () => {
  const f = fixture();
  const root = fs.mkdtempSync(path.join(__dirname, 'agent-fixture-'));
  const { createAgentEngine } = require('../electron/agent/engine.cjs');
  let engine;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"agent-fixture"}');
    const file = path.join(root, 'notes.txt');
    const full = 'Observed source\n' + 'x'.repeat(170000) + '\nFinal source line'; fs.writeFileSync(file, full);
    let step = 0; const events = [];
    engine = createAgentEngine(f.app, { getKey: () => 'fixture-key' }, event => events.push(event), () => {}, { reviewModel: fixtureReview, requestModel: async () => {
      if (step > 6) throw new Error('Fixture interruption');
      const name = step === 0 ? 'open_workspace' : 'read_file';
      const args = step === 0 ? { directory: root } : { file }; step++;
      const call = { id: 'call-' + step, name, args };
      const usage = step === 4 ? { input_tokens: 200000 } : null;
      return { text: '', calls: [call], route: 'chat', raw: { content: null, tool_calls: [{ id: call.id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, usage };
    } });
    const input = { taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Inspect notes.' }] };
    await assert.rejects(engine.run(input), /Fixture interruption/);
    const checkpoint = engine.journal.read('task');
    assert.equal(checkpoint.safe, true); assert.ok(checkpoint.recovery.recoveries >= 1);
    assert.ok(events.some(event => event.type === 'context' && event.compactions > 0));
    assert.ok(events.some(event => event.type === 'activity' && /Reconsidering/.test(event.message)));
    const records = (await engine.evidence.list('task', 'turn', 0, 100)).records;
    const source = records.find(item => item.kind === 'tool' && item.name === 'read_file');
    assert.equal(engine.evidence.metadata('task', 'turn', source.id).outputChars, full.length);
    assert.equal(engine.evidence.matches('task', 'turn', source.id, 'Final source line'), true);
    assert.ok(records.some(item => item.kind === 'checkpoint'));
    engine.shutdown();
    engine = createAgentEngine(f.app, { getKey: () => 'fixture-key' }, () => {}, () => {}, { reviewModel: fixtureReview, requestModel: async ({ history }) => {
      assert.ok(history.some(item => String(item.content).includes('Progress recovery')));
      return { text: 'Inspected notes; verification remains pending.', calls: [], route: 'chat', raw: { content: 'Inspected notes; verification remains pending.' }, usage: null };
    } });
    const result = await engine.run({ ...input, resume: true });
    assert.match(result.text, /Requirements awaiting current verification/);
    assert.equal(engine.taskMemory.read('task').status, 'partial');
    assert.equal(engine.evidence.matches('task', 'turn', source.id, 'Final source line'), true);
  } finally { engine?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); f.cleanup(); }
});
