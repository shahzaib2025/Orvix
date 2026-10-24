const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createEvidenceStore } = require('../electron/agent/evidence-store.cjs');
const { createExecutionMapStore } = require('../electron/agent/execution-map.cjs');
const { createDecisionPlanner } = require('../electron/agent/decision-planning.cjs');
const { createProjectMap } = require('../electron/agent/project-map.cjs');
const { createSemanticService } = require('../electron/agent/semantic-service.cjs');
const { selectContext } = require('../electron/agent/context-selection.cjs');
const { createRuntimeInspector, attachOwnership } = require('../electron/agent/runtime-inspector.cjs');
const { verifyNativeWorkflow } = require('../electron/agent/native-workflow.cjs');
const { validateWorkflow } = require('../electron/agent/browser-workflow.cjs');
const signal = () => new AbortController().signal;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-understanding-'));
  const app = { getPath: () => root }, evidence = createEvidenceStore(app), execution = createExecutionMapStore(app, evidence);
  execution.ensure('task', 'turn', 'Notify once when brightness changes, never merely because it is below 50%.', 'Full access');
  execution.update('task', 'turn', { replace_initial_goal: true, requirements: [{ id: 'changes', text: 'Notify once for a settled brightness change', verification_types: ['user_flow'] }] });
  const workspaces = { list: () => [root], assert: (_task, file) => { const resolved = path.resolve(file); const rel = path.relative(root, resolved); if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Outside workspace'); return resolved; } };
  return { root, app, evidence, execution, workspaces, cleanup: () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-understanding-')); fs.rmSync(root, { recursive: true, force: true }); } };
}
const intent = { goal: 'Notify once after a brightness change', feature: 'Brightness monitor', trigger: 'Settled change', expectedBehavior: 'One notification with old and final values', exclusions: ['Threshold notifications'], assumptions: [{ text: 'Do not notify at initial baseline', basis: 'Only changes were requested' }], examples: [{ input: '50% stays at 50%', expected: 'No notification' }, { input: '50% becomes 51%', expected: 'One notification' }], questions: [] };
const criterion = (id = 'settled') => ({ id, requirementId: 'changes', description: 'One settled change notice', observable: 'Notification renderer acknowledges display with old and new values', negativeCase: 'Initial baseline and unchanged samples produce no notification', method: 'sensor' });
function plannerFor(f, review) { return createDecisionPlanner({ ...f, taskId: 'task', requestId: 'turn', signal: signal(), publish: () => {}, review }); }

test('independent plans preserve concrete examples and require coverage of every acceptance case', async () => {
  const f = fixture();
  try {
    const seen = [];
    const planner = plannerFor(f, async (purpose, prompt) => { seen.push([purpose, prompt]); return JSON.stringify(purpose === 'request_understanding' ? intent : purpose === 'acceptance_planning' ? { status: 'approved', criteria: [criterion(), { ...criterion('no-baseline'), description: 'Initial baseline never notifies' }], missingRequirements: [] } : { status: 'approved', reason: 'Check observes the actual notification display' }); });
    const understood = await planner.interpret(f.execution.read('task', 'turn').objective);
    assert.equal(understood.trigger, 'Settled change'); assert.equal(understood.examples[0].expected, 'No notification');
    const plan = await planner.acceptance({ files: [] });
    const review = await planner.check({ requirement_ids: ['changes'], acceptance_ids: ['settled'], steps: [{ action: 'assert_notification' }] }, {}, 'sensor');
    assert.equal(review.acceptanceStamp, plan.stamp);
    function proof(id) { const saved = f.evidence.record('task', 'turn', { kind: 'verification', name: 'native', status: 'passed', phase: 'user_flow', requirementIds: ['changes'], stateFingerprint: 'fresh', reviewStatus: 'approved', acceptanceStamp: plan.stamp, acceptanceIds: [id], command: id }, 'Observed notification'); f.execution.observe('task', 'turn', saved); }
    proof('settled'); assert.equal(f.execution.view('task', 'turn', 'fresh').complete, false);
    proof('no-baseline'); assert.equal(f.execution.view('task', 'turn', 'fresh').complete, true);
    assert.equal(f.execution.view('task', 'turn', 'changed').requirements[0].status, 'stale');
    assert.ok(seen.find(([purpose, prompt]) => purpose === 'acceptance_planning' && prompt.includes('50% stays at 50%')));
  } finally { f.cleanup(); }
});

test('changed acceptance criteria invalidate old proofs even when IDs are reused', async () => {
  const f = fixture(); let revision = 0;
  try {
    const planner = plannerFor(f, async purpose => JSON.stringify(purpose === 'request_understanding' ? intent : { status: 'approved', criteria: [{ ...criterion(), observable: revision ? 'Display acknowledgement plus saved inbox record' : criterion().observable }], missingRequirements: [] }));
    await planner.interpret('Monitor changes'); const old = await planner.acceptance({});
    const proof = f.evidence.record('task', 'turn', { kind: 'verification', name: 'check', command: 'check', phase: 'user_flow', status: 'passed', reviewStatus: 'approved', acceptanceStamp: old.stamp, acceptanceIds: ['settled'], requirementIds: ['changes'], stateFingerprint: 'same' }, 'Observed'); f.execution.observe('task', 'turn', proof);
    assert.equal(f.execution.view('task', 'turn', 'same').complete, true);
    revision++; const next = await planner.acceptance({}, true); assert.notEqual(next.stamp, old.stamp); assert.equal(f.execution.view('task', 'turn', 'same').complete, false);
  } finally { f.cleanup(); }
});

test('coverage gaps, malformed reviews and unavailable reviewers cannot become approved evidence', async () => {
  const f = fixture();
  try {
    const missing = plannerFor(f, async () => JSON.stringify({ status: 'approved', criteria: [], missingRequirements: [] }));
    assert.equal((await missing.acceptance({})).status, 'needs_revision');
    assert.equal((await missing.check({ requirement_ids: ['changes'] }, {}, 'sensor')).status, 'rejected');
    const malformed = plannerFor(f, async () => JSON.stringify({ ...intent, assumptions: 'guessed' }));
    assert.equal((await malformed.interpret('Change brightness', true)).status, 'unavailable');
    const offline = plannerFor(f, async () => { throw new Error('Review model unavailable'); });
    assert.equal((await offline.acceptance({}, true)).status, 'unavailable');
    assert.equal((await offline.check({ requirement_ids: ['changes'] }, {}, 'sensor')).status, 'unavailable');
    assert.equal(f.execution.view('task', 'turn', 'same').complete, false);
  } finally { f.cleanup(); }
});

test('unverified work does not invalidate complete acceptance criteria or trap a resumed run', async () => {
  const f = fixture(); let reviews = 0;
  try {
    const planner = plannerFor(f, async () => {
      reviews++;
      return JSON.stringify({ status: 'needs_revision', criteria: [criterion()], missingRequirements: ['changes'],
        reason: 'No successful file creation or content verification is present. The requirement remains unsatisfied.' });
    });
    const plan = await planner.acceptance({ files: [] });
    assert.equal(plan.status, 'approved');
    assert.deepEqual(plan.missingRequirements, []);
    assert.equal(f.execution.view('task', 'turn', 'unchanged').requirements[0].status, 'pending');
    const revision = f.execution.read('task', 'turn').revision;
    f.execution.update('task', 'turn', {});
    assert.equal(f.execution.read('task', 'turn').revision, revision);
    f.execution.annotate('task', 'turn', { acceptance: { ...plan, status: 'needs_revision', missingRequirements: ['changes'], reason: 'No successful file creation or content verification is present.' } });
    const refreshed = await planner.acceptance({ files: [] });
    assert.equal(refreshed.status, 'approved');
    assert.equal(reviews, 2);
  } finally { f.cleanup(); }
});

test('a genuine acceptance coverage gap remains blocked', async () => {
  const f = fixture();
  try {
    const planner = plannerFor(f, async () => JSON.stringify({ status: 'needs_revision', criteria: [criterion()], missingRequirements: ['changes'],
      reason: 'The criterion does not cover the required unchanged-brightness case.' }));
    const plan = await planner.acceptance({ files: [] });
    assert.equal(plan.status, 'needs_revision');
    assert.deepEqual(plan.missingRequirements, ['changes']);
  } finally { f.cleanup(); }
});

test('success printing is rejected without calling a reviewer', async () => {
  const f = fixture(); let called = false;
  try {
    const planner = plannerFor(f, async () => { called = true; return '{}'; });
    for (const command of ['Write-Host "Passed"', 'echo brightness changed', 'node -e "console.log(\'passed\')"']) assert.equal((await planner.check({ command, requirement_ids: ['changes'] }, {})).status, 'rejected');
    assert.equal(called, false);
  } finally { f.cleanup(); }
});

test('follow-up interpretation receives the earlier human task instead of asking to repeat it', async () => {
  const f = fixture();
  try {
    const planner = plannerFor(f, async (purpose, prompt) => {
      assert.equal(purpose, 'request_understanding');
      assert.match(prompt, /Earlier task context/); assert.match(prompt, /Finish the white Three\.js website/);
      assert.match(prompt, /Do not ask the user to repeat a task/);
      return JSON.stringify({ ...intent, goal: 'Finish the white Three.js website', feature: 'Website', questions: [{question:'Preferred accent color?',impact:'optional'}] });
    });
    const value = await planner.interpret('You are stuck, complete the task', false, { originalTaskGoal: 'Finish the white Three.js website', earlierHumanRequests: ['Use separate HTML, CSS and JS files'] });
    assert.equal(value.questions.filter(item => item.impact === 'material').length, 0); assert.equal(value.understandingVersion, 2);
    assert.equal((await planner.interpret('same')).goal, value.goal);
  } finally { f.cleanup(); }
});

test('native snapshots reject stale files and never combine a reading with a newer timestamp', () => {
  const f = fixture(), { readNativeSnapshot } = require('../electron/agent/native-snapshot.cjs');
  try {
    const file = path.join(f.root, 'sensor.json'); fs.writeFileSync(file, JSON.stringify({ Brightness: 51, Volume: 30, BatteryPercent: 80 }));
    assert.equal(readNativeSnapshot(file).sensors.brightness.value, 51);
    const at = fs.statSync(file).mtimeMs;
    assert.equal(readNativeSnapshot(file, { now: () => at + 11000 }).status, 'unavailable');
    const raced = readNativeSnapshot(file, { readState: () => { fs.utimesSync(file, new Date(), new Date(at + 1000)); return {Brightness:52}; } });
    assert.equal(raced.status, 'unavailable');
  } finally { f.cleanup(); }
});

test('context retrieval resolves callers and tests, refreshes changed sources, and excludes credentials', async () => {
  const f = fixture(), semantic = createSemanticService();
  try {
    const file = path.join(f.root, 'brightness.ts');
    fs.writeFileSync(file, 'export function settledBrightness(value: number) { return value + 1; }');
    fs.writeFileSync(path.join(f.root, 'brightness.test.ts'), 'import { settledBrightness } from "./brightness";\nexport function testChange() { return settledBrightness(50) === 51; }');
    fs.writeFileSync(path.join(f.root, 'tsconfig.json'), '{"compilerOptions":{"strict":true},"include":["*.ts"]}');
    fs.writeFileSync(path.join(f.root, 'AGENTS.md'), 'Verify changes without baseline notifications.');
    fs.writeFileSync(path.join(f.root, '.env'), 'PASSWORD=must-not-be-retrieved');
    const maps = createProjectMap(f.app); await maps.refresh(f.root, 'task', f.workspaces, signal());
    const options = { maps, roots: [f.root], workspaces: f.workspaces, taskId: 'task', query: 'settledBrightness', focusFiles: [file], semantic, signal: signal(), semanticCache: new Map() };
    const first = await selectContext(options);
    assert.ok(first.files.some(item => item.file.endsWith('brightness.test.ts'))); assert.ok(first.files.some(item => item.file.endsWith('AGENTS.md')));
    assert.ok(first.semanticImpact.some(item => item.callers?.some(caller => caller.enclosingSymbol === 'testChange')));
    assert.ok(!JSON.stringify(first).includes('must-not-be-retrieved'));
    fs.writeFileSync(file, 'export function settledBrightness(value: number) { return value + 2; }');
    assert.ok(!(await selectContext({ ...options, semantic: null })).files.some(item => item.file === file));
    await maps.refresh(f.root, 'task', f.workspaces, signal());
    const next = await selectContext(options);
    assert.match(next.files.find(item => item.file === file).excerpt, /value \+ 2/);
    assert.notEqual(next.files.find(item => item.file === file).hash, first.files.find(item => item.file === file).hash);
  } finally { semantic.shutdown(); f.cleanup(); }
});

test('runtime ownership distinguishes managed descendants, stale PID reuse and unknown working directories', async () => {
  const root = path.resolve('project-fixture'), other = path.resolve('old-project');
  const start = Date.now();
  const processes = [{ pid: 10, parentPid: 1, startedAt: start, commandLine: 'node server.js' }, { pid: 11, parentPid: 10, commandLine: 'node worker.js' }, { pid: 12, parentPid: 1, startedAt: start - 60000, cwd: other, commandLine: 'node server.js' }, { pid: 13, commandLine: `node "${path.join(root, 'server.js')}"` }];
  const managed = [{ pid: 10, startedAt: start, directory: root }, { pid: 12, startedAt: start, directory: root }];
  const observed = attachOwnership(processes, [root], managed);
  assert.equal(observed[1].cwd, root); assert.equal(observed[1].ownership, 'managed_preview');
  assert.equal(observed[2].ownership, 'unrelated_or_unknown'); assert.equal(observed[2].cwd, other);
  assert.equal(observed[3].cwd, null); assert.equal(observed[3].ownership, 'project_reference_candidate');
  const runtime = createRuntimeInspector({ managed: () => managed, collectProcesses: async () => ({ processes, listeners: [{ port: 8790, pid: 12 }, { port: 8791, pid: 11 }] }) });
  const result = await runtime.inspect({ scope: 'ports', ports: [8790] }, [root], signal());
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].owner.cwd, other);
  await assert.rejects(runtime.inspect({ scope: 'ports', ports: [70000] }, [root], signal()), /Invalid runtime selector/);
});

test('live Windows port inspection observes the real fixture listener and executable versions', { skip: process.platform !== 'win32' }, async () => {
  const server = http.createServer((_request, response) => response.end('fixture'));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const runtime = createRuntimeInspector(); const result = await runtime.inspect({ scope: 'ports', ports: [server.address().port] }, [], signal());
    assert.equal(result.status, 'ok', result.reason); assert.ok(result.rows.some(item => item.pid === process.pid));
    const environment = await runtime.inspect({ scope: 'environment' }, [], signal()); assert.ok(environment.executables.some(item => item.name === 'node' && item.status === 'available'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('native verification distinguishes a fresh settled change from stale or missing sensor readings', async () => {
  const start = Date.now(); let sample = 0;
  const steps = [{ action: 'observe_sensor', sensor: 'brightness' }, { action: 'assert_sensor', sensor: 'brightness', operator: 'changed' }];
  const options = { steps, signal: signal(), snapshot: async () => ({ status: 'ok', observedAt: start + sample, sensors: { brightness: { value: sample++ ? 51 : 50, source: 'fixture' } } }) };
  assert.equal((await verifyNativeWorkflow(options)).status, 'passed');
  const stale = await verifyNativeWorkflow({ ...options, snapshot: async () => ({ status: 'ok', observedAt: start - 20000, sensors: { brightness: { value: 50 } } }) }); assert.equal(stale.status, 'skipped');
  const missing = await verifyNativeWorkflow({ ...options, snapshot: async () => ({ status: 'ok', observedAt: start, sensors: { brightness: { value: null } } }) }); assert.equal(missing.status, 'skipped');
  const unchanged = await verifyNativeWorkflow({ ...options, snapshot: async () => ({ status: 'ok', observedAt: Date.now(), sensors: { brightness: { value: 50 } } }) }); assert.equal(unchanged.status, 'failed');
});

test('queued notices cannot verify delivery; only the exact renderer acknowledgement can', async () => {
  const options = { steps: [{ action: 'notification_test' }, { action: 'assert_notification' }], signal: signal(), snapshot: async () => ({}), notifyTest: async () => ({ status: 'queued', id: 'notice-1' }) };
  const queued = await verifyNativeWorkflow({ ...options, notificationStatus: async id => ({ id, status: 'queued' }) }); assert.equal(queued.status, 'skipped');
  const wrong = await verifyNativeWorkflow({ ...options, notificationStatus: async () => ({ id: 'another-notice', status: 'shown', shownAt: Date.now() }) }); assert.equal(wrong.status, 'skipped');
  const old = await verifyNativeWorkflow({ ...options, notificationStatus: async id => ({ id, status: 'shown', shownAt: Date.now() - 60000 }) }); assert.equal(old.status, 'skipped');
  const shown = await verifyNativeWorkflow({ ...options, notificationStatus: async id => ({ id, status: 'shown', shownAt: Date.now() }) }); assert.equal(shown.status, 'passed');
  const controller = new AbortController(); const pending = verifyNativeWorkflow({ ...options, signal: controller.signal, steps: [{ action: 'notification_test' }, { action: 'assert_notification', timeout_ms: 10000 }], notificationStatus: async () => { controller.abort(); return null; } }); await assert.rejects(pending, /cancelled/);
});

test('browser assertions require explicit state and block credential retrieval', () => {
  for (const assertion of [{ kind: 'text', selector: '#result', expected: '' }, { kind: 'checked', selector: '#setting', expected: 'true' }, { kind: 'storage', key: 'authToken', expected: 'key' }]) assert.throws(() => validateWorkflow([{ action: 'assert', assertion }]));
  assert.throws(() => validateWorkflow([{ action: 'evaluate', code: 'anything' }]));
  assert.doesNotThrow(() => validateWorkflow([{ action: 'assert', assertion: { kind: 'storage', key: 'brightnessSetting', expected: 'true' } }]));
});

test('a later turn retrieves relevant saved evidence from the same task without rerunning its source', async () => {
  const f = fixture(), { createAgentEngine } = require('../electron/agent/engine.cjs'), { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs'); let engine, step = 0;
  try {
    const source = f.evidence.record('task', 'earlier', { kind: 'tool', name: 'read_file' }, 'Earlier observed brightness configuration: notifications follow settled changes.');
    createTaskMemoryStore(f.app).write('task', { goal: 'Understand brightness notifications', latestRequest: 'Read brightness configuration', status: 'completed', savedEvidence: [{ id: source.id, requestId: 'earlier', name: 'read_file', file: 'brightness.ts', recordedAt: source.recordedAt, requirementIds: [] }] });
    engine = createAgentEngine(f.app, {getKey: () => 'fixture-key'}, () => {}, () => {}, {nativeSnapshot: async () => ({status:'unavailable'}), reviewModel: async ({purpose,history}) => {
      let value;
      if (purpose === 'request_understanding') value = intent;
      else if (purpose === 'execution_requirements') value = { requirements: [{ text: 'Use the earlier brightness observation to explain the requested behavior.', verification_types: ['research'] }] };
      else { const requirements = JSON.parse(/Requirements:\n([^\n]+)\nObserved project sources/.exec(history[0].content)[1]); value = {status:'approved',criteria:requirements.map(req => ({...criterion('criterion-' + req.id),requirementId:req.id})),missingRequirements:[]}; }
      return {text:JSON.stringify(value),calls:[]};
    }, requestModel: async ({history}) => {
      if (step++ === 0) {
        assert.match(history.at(-1).content, /Earlier observed brightness configuration/); assert.match(history.at(-1).content, /"requestId":"earlier"/);
        const call = {id:'saved',name:'read_evidence',args:{evidence_id:source.id,source_request_id:'earlier'}};
        return {text:'',calls:[call],route:'chat',raw:{content:null,tool_calls:[{id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}};
      }
      assert.match(history.findLast(item => item.role === 'tool').content, /notifications follow settled changes/);
      return {text:'Retrieved the earlier observation. Current runtime behavior remains unverified.',calls:[],route:'chat',raw:{content:'Retrieved the earlier observation. Current runtime behavior remains unverified.'}};
    } });
    await engine.run({taskId:'task',requestId:'later',modelId:'opencode/big-pickle',accessMode:'Plan',accessModeVersion:2,messages:[{role:'user',content:'Use the earlier brightness observation'}]});
    assert.ok(engine.taskMemory.read('task').savedEvidence.some(item => item.id === source.id && item.requestId === 'earlier'));
    const saved = (await engine.evidence.list('task','later')).records;
    assert.ok(!saved.some(item => item.name === 'read_file'), 'source must not be rerun just to recover archived evidence');
  } finally {engine?.shutdown();f.cleanup();}
});

test('material clarification pauses edits and invalidates the rest of an already proposed batch', async () => {
  const f = fixture(); const { createAgentEngine } = require('../electron/agent/engine.cjs'); let engine, step = 0, asked = 0; const events = []; const project = fs.mkdtempSync(path.join(__dirname, 'agent-understanding-fixture-')); const file = path.join(project, 'choice.txt');
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"understanding-fixture"}');
  const call = (name, args, id) => ({ id, name, args });
  const answer = calls => ({ text: '', calls, route: 'chat', raw: { content: null, tool_calls: calls.map(item => ({ id: item.id, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.args) } })) } });
  try {
    engine = createAgentEngine(f.app, { getKey: () => 'fixture-key' }, event => {
      events.push(event);
      if (event.type === 'clarification' && event.phase !== 'remove') {
        asked++; assert.equal(fs.existsSync(file), false); assert.equal(engine.journal.metadata('task').safe, true);
        assert.equal(events.filter(item => item.type === 'tool' && item.name === 'write_file' && item.phase === 'started').length, 0, 'clarification wait cannot appear as a running edit');
        engine.answerQuestion(event.questionId, 'Changes only');
      }
    }, () => {}, { nativeSnapshot: async () => ({ status: 'unavailable', reason: 'Fixture has no hardware' }), reviewModel: async ({ purpose, history }) => {
      assert.equal(history.length, 1, 'review must not inherit the executor conversation');
      let value;
      if (purpose === 'request_understanding') value = { ...intent, questions: [{ question: 'Change notifications or threshold notifications?', impact: 'material', options: ['Changes only', 'Threshold'] }] };
      else if (purpose === 'execution_requirements') value = { requirements: [{ text: 'Implement the clarified brightness notification behavior.', verification_types: ['focused', 'user_flow'] }] };
      else if (purpose === 'acceptance_planning') { const requirements = JSON.parse(/Requirements:\n([^\n]+)\nObserved project sources/.exec(history[0].content)[1]); value = { status: 'approved', criteria: requirements.map(req => ({ ...criterion('criterion-' + req.id), requirementId: req.id })), missingRequirements: [] }; }
      else value = { status: 'approved', reason: 'Actual state check' };
      return { text: JSON.stringify(value), calls: [] };
    }, requestModel: async ({ history }) => {
      if (step++ === 0) return answer([call('open_workspace', { directory: project }, 'open')]);
      if (step === 2) return answer([call('write_file', { file, content: 'Wrong assumption' }, 'wrong'), call('write_file', { file, content: 'Also wrong' }, 'wrong-batch')]);
      if (step === 3) { assert.equal(fs.existsSync(file), false); assert.ok(JSON.stringify(history).includes('Changes only')); return answer([call('write_file', { file, content: 'Changes only' }, 'correct')]); }
      return { text: 'Implemented the clarified behavior; verification remains pending.', calls: [], route: 'chat', raw: { content: 'Implemented the clarified behavior; verification remains pending.' } };
    } });
    await engine.run({ taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Monitor brightness' }] });
    assert.equal(asked, 1); assert.equal(fs.readFileSync(file, 'utf8'), 'Changes only'); assert.equal(engine.pendingQuestion('task', 'turn'), null);
    assert.ok(events.some(item => item.type === 'activity' && item.message.startsWith('Waiting for your answer')));
    const successfulWrite = events.find(item => item.type === 'tool' && item.callId === 'correct' && item.phase === 'completed' && !item.failed);
    assert.ok(successfulWrite && successfulWrite.durationMs >= 0);
  } finally { engine?.shutdown(); assert.equal(path.dirname(project), __dirname); assert.ok(path.basename(project).startsWith('agent-understanding-fixture-')); fs.rmSync(project, { recursive: true, force: true }); f.cleanup(); }
});
