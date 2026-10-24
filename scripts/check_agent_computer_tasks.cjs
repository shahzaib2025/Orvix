const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTools } = require('../electron/agent/tools.cjs');
const { createWorkspaceManager } = require('../electron/agent/workspace-manager.cjs');
const { inspectStorage } = require('../electron/agent/computer-files.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

function fixture() {
  const base = fs.mkdtempSync(path.join(__dirname, 'computer-task-fixture-'));
  const project = path.join(base, 'important-project'); const target = path.join(base, 'users'); const data = path.join(base, 'data');
  fs.mkdirSync(project); fs.mkdirSync(target); fs.mkdirSync(data);
  fs.writeFileSync(path.join(project, 'keep.txt'), 'Important project stays intact');
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"important-project"}');
  const app = { getPath: () => data };
  const workspaces = createWorkspaceManager(app);
  return { base, project, target, app, workspaces, cleanup() { assert.equal(path.dirname(base), __dirname); fs.rmSync(base, { recursive: true, force: true }); } };
}
function toolsFor(f, { mode = 'Controlled', approve = async () => 'host', signal = new AbortController().signal } = {}) {
  const unrelatedProjectGuard = new Proxy({}, { get() { throw new Error('Computer task touched project change tracking'); } });
  return createTools(unrelatedProjectGuard, f.workspaces, {}, 'computer-' + crypto.randomUUID(), signal, approve, async () => true, () => {}, null, null, null, null, null, mode,
    { prepareCommand() { throw new Error('Computer task inspected project setup'); }, commandObserved() { throw new Error('Computer task recorded project test'); } });
}

test('folder measurement ranks explicit targets, reports exclusions, and never opens the saved project', async () => {
  const f = fixture();
  try {
    await f.workspaces.open('task', f.project, async () => true);
    fs.mkdirSync(path.join(f.target, 'small')); fs.mkdirSync(path.join(f.target, 'large'));
    fs.writeFileSync(path.join(f.target, 'small', 'one.bin'), Buffer.alloc(10));
    fs.writeFileSync(path.join(f.target, 'large', 'two.bin'), Buffer.alloc(100));
    fs.writeFileSync(path.join(f.target, 'large', '.env'), 'hidden');
    fs.mkdirSync(path.join(f.target, 'AppData')); fs.writeFileSync(path.join(f.target, 'AppData', 'cache.bin'), Buffer.alloc(50));
    const result = JSON.parse(await toolsFor(f, { mode: 'Plan' }).call('inspect_storage', { directory: f.target }));
    assert.equal(result.folders[0].directory, path.join(f.target, 'large'));
    assert.equal(result.folders[0].bytes, 100); assert.equal(result.folders[1].bytes, 50); assert.equal(result.folders[2].bytes, 10);
    assert.equal(result.complete, false); assert.equal(result.folders[0].excluded, 1);
    assert.deepEqual(f.workspaces.list('task'), [f.project]);
    assert.equal(fs.readFileSync(path.join(f.project, 'keep.txt'), 'utf8'), 'Important project stays intact');
  } finally { f.cleanup(); }
});

test('folder creation uses the reviewed absolute path outside projects and Plan blocks mutations', async () => {
  const f = fixture();
  try {
    const target = path.join(f.target, 'new-folder'); const decisions = [];
    const tools = toolsFor(f, { approve: async (...args) => { decisions.push(args); return 'host'; } });
    assert.equal(JSON.parse(await tools.call('create_folder', { directory: target })).created, true);
    assert.equal(decisions[0][1], target); assert.equal(decisions[0][2], 'host_command');
    assert.equal(JSON.parse(await tools.call('create_folder', { directory: target })).alreadyExists, true);
    assert.equal(decisions.length, 1); assert.deepEqual(f.workspaces.list('task'), []);
    const denied = path.join(f.target, 'denied');
    assert.match(await toolsFor(f, { approve: async () => false }).call('create_folder', { directory: denied }), /declined/);
    assert.equal(fs.existsSync(denied), false);
    await assert.rejects(toolsFor(f, { mode: 'Plan' }).call('create_folder', { directory: denied }), /Plan mode/);
    await assert.rejects(toolsFor(f).call('create_folder', { directory: 'relative' }), /absolute/);
    await assert.rejects(toolsFor(f).call('create_folder', { directory: path.join(f.target, '.ssh', 'private') }), /credential/);
  } finally { f.cleanup(); }
});

test('standalone tests use generated scratch, computer commands require a target, and denial prevents effects', async () => {
  const f = fixture(); let scratch;
  try {
    const decisions = []; const tools = toolsFor(f, { approve: async (...args) => { decisions.push(args); return 'host'; } });
    const output = await tools.call('run_computer_command', { purpose: 'standalone_test', command: 'node -e "console.log(process.cwd())"' });
    scratch = decisions[0][1];
    assert.match(scratch, /orvix-agent-tests/); assert.equal(output.includes(scratch), true);
    assert.match(output, /Exit 0/); assert.notEqual(scratch, f.project);
    assert.equal(decisions[0][2], 'host_command');
    const computer = await tools.call('run_computer_command', { purpose: 'computer', directory: f.target, command: 'node -e "console.log(process.cwd())"' });
    assert.equal(computer.includes(f.target), true);
    await assert.rejects(tools.call('run_computer_command', { purpose: 'computer', command: 'echo x' }), /require.*absolute directory/);
    await assert.rejects(tools.call('run_computer_command', { purpose: 'standalone_test', directory: f.project, command: 'echo x' }), /Omit directory/);
    await assert.rejects(tools.call('run_command', { directory: f.target, command: 'echo x' }), /outside.*workspaces/);
    const sentinel = path.join(f.target, 'should-not-exist');
    const denied = await toolsFor(f, { approve: async () => false }).call('run_computer_command', { purpose: 'computer', directory: f.target, command: "node -e \"require('fs').writeFileSync('should-not-exist','bad')\"" });
    assert.match(denied, /declined/); assert.equal(fs.existsSync(sentinel), false);
    const deletionReviews = [];
    await toolsFor(f, { approve: async (...args) => { deletionReviews.push(args); return false; } }).call('run_computer_command', { purpose: 'computer', directory: f.target, command: 'Remove-Item should-not-exist' });
    assert.equal(deletionReviews[0][2], 'delete');
  } finally {
    if (scratch) { assert.equal(path.basename(path.dirname(scratch)), 'orvix-agent-tests'); fs.rmSync(scratch, { recursive: true, force: true }); }
    f.cleanup();
  }
});

test('background storage scan cancels without affecting the open project', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const scan = inspectStorage(f.target, controller.signal);
    controller.abort();
    await assert.rejects(scan, /cancelled/);
    assert.equal(fs.existsSync(path.join(f.project, 'keep.txt')), true);
  } finally { f.cleanup(); }
});

test('real executor and evidence view do not index an unrelated saved workspace for a computer request', async () => {
  const f = fixture(); let engine;
  try {
    const events = []; let step = 0;
    engine = createAgentEngine(f.app, { getKey: () => 'fixture-key' }, event => events.push(event), null, {
      reviewModel: async ({ purpose, history }) => ({ text: JSON.stringify(purpose === 'request_understanding'
        ? { taskKind: 'computer', goal: 'Measure user folders', acknowledgement: 'I’ll measure the requested user folders.', expectedBehavior: 'Folder sizes from the requested path', questions: [] }
        : purpose === 'execution_requirements' ? { requirements: [{ text: 'Measure folders in the exact requested target and report their observed sizes.', verification_types: ['focused'] }] }
          : purpose === 'acceptance_planning' ? { status: 'approved', criteria: JSON.parse(/Requirements:\n([\s\S]*?)\nObserved project sources/.exec(history.at(-1).content)[1]).map(item => ({ id: 'folders', requirementId: item.id, method: 'observation', description: 'Measure the requested folder', observable: 'Actual measured folders and byte sizes from the target', negativeCase: 'Measurement uses a different target or has unresolved exclusions' })), missingRequirements: [] }
          : purpose === 'completion_review' ? (assert.match(history[0].content, /"effect":"read_only"/), { status: 'reviewed', coveredIds: ['folders'], reason: 'Recorded read-only measurement matches the requested path', unsupportedClaims: [] })
            : { status: 'approved', reason: 'Fixture read-only observation' }), calls: [] }),
      requestModel: async ({ history }) => {
        assert.equal(JSON.stringify(history).includes('"file":"' + path.join(f.project, 'keep.txt').replaceAll('\\', '\\\\') + '"'), false);
        if (step++ === 0) {
          const calls = [{ id: 'scan', name: 'inspect_storage', args: JSON.stringify({ directory: f.target }) }];
          return { text: '', calls, route: 'chat', raw: { content: null, tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) } };
        }
        return { text: 'The requested folder measurement is available.', calls: [], route: 'chat', raw: { content: 'The requested folder measurement is available.' } };
      },
    });
    await engine.workspaces.open('task', f.project, async () => true);
    const refresh = engine.projectMaps.refresh;
    engine.projectMaps.refresh = async (...args) => { if (args[0] === f.project) throw new Error('Unrelated project must not be indexed'); return refresh(...args); };
    await engine.run({ taskId: 'task', requestId: 'computer-turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Measure the largest folders in ' + f.target }] });
    const view = await engine.getExecution('task', 'computer-turn');
    assert.deepEqual(view.projects, []);
    assert.equal(view.execution.intent.taskKind, 'computer');
    assert.equal(view.execution.complete, true); assert.equal(view.execution.requirements[0].status, 'verified');
    assert.ok(events.some(e => e.name === 'inspect_storage' && e.phase === 'completed' && !e.failed));
    const measured = engine.runState.result('task', 'computer-turn').verification.toolOutcomes.find(item => item.name === 'inspect_storage');
    assert.equal(measured.directory, f.target); assert.match(measured.observedOutput, /"measurement"/);
    assert.equal(events.some(e => e.name === 'open_workspace'), false);
    assert.deepEqual(engine.workspaces.list('task'), [f.project]);
    assert.equal(fs.readFileSync(path.join(f.project, 'keep.txt'), 'utf8'), 'Important project stays intact');
  } finally { engine?.shutdown(); f.cleanup(); }
});
