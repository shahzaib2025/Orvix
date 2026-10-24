const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { createWorkspaceReservations } = require('../electron/agent/workspace-reservations.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('task workers are separate, lazy, unlimited and catalog operations have their own worker', async () => {
  const created = [], gates = new Map();
  const pool = createOpenCodeWorkers('fixture', { create(directory, options) {
    const state = { directory, options, calls: 0, closed: false }; created.push(state);
    return { exclusive: async (_, callback) => { state.calls++; return callback(state); }, status: () => ({ running: state.calls > 0 }), shutdown: () => { state.closed = true; } };
  } });
  assert.equal(created.length, 1);
  const jobs = Array.from({ length: 6 }, (_, index) => { const id = `task-${index}`, gate = deferred(); gates.set(id, gate); return pool.forTask(id).exclusive(null, async () => gate.promise); });
  assert.equal(created.length, 7); assert.equal(new Set(created.map(item => item.directory)).size, 7);
  assert.deepEqual(created[0].options, { buildTemperature: null });
  assert.ok(created.slice(1).every(item => item.options === undefined));
  assert.equal(pool.forTask('task-0'), pool.forTask('task-0'));
  await pool.exclusive(null, async state => assert.equal(state.directory, 'fixture'));
  assert.equal(Object.keys(pool.status().workers).length, 6);
  for (const gate of gates.values()) gate.resolve(); await Promise.all(jobs);
  pool.shutdown(); assert.ok(created.every(item => item.closed)); assert.throws(() => pool.forTask('next'), /shutting down/);
});

test('project writers wait across parent/child paths; unrelated projects continue; cancellation never grants ownership', async () => {
  const locks = createWorkspaceReservations(), a = new AbortController(), b = new AbortController();
  const root = path.join(os.tmpdir(), 'orvix-reservation-fixture');
  await locks.reserve('a', [root], a.signal);
  let entered = false, waited = false; const blocked = deferred();
  const pending = locks.reserve('b', [path.join(root, 'child')], b.signal, () => { waited = true; blocked.resolve(); }).then(() => { entered = true; });
  const cancelled = assert.rejects(pending, /cancelled/);
  await blocked.promise;
  assert.equal(waited, true); assert.equal(entered, false);
  await locks.reserve('c', [root + '-different'], a.signal);
  b.abort(); await cancelled; locks.release('a');
  assert.equal(entered, false); assert.equal(locks.inspect().held.b, undefined);
  const waiting = locks.reserve('d', [root + '-different'], a.signal); locks.release('c'); await waiting;
  assert.ok(locks.inspect().held.d); locks.release('d');
});

test('worker crash, restart and idle cleanup do not stop another active worker or reuse its credentials', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-worker-pool-')), children = [], envs = [];
  const pool = createOpenCodeWorkers(root, { create: directory => createOpenCodeHeadless(directory, {
    binary: 'fixture.exe', port: async () => 50000 + children.length, idleMs: 30,
    spawn(_, __, options) {
      const child = new EventEmitter(); Object.assign(child, { pid: children.length + 300, exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0); }; children.push(child); envs.push(options.env); return child;
    }, fetch: async () => new Response(JSON.stringify({ healthy: true })),
  }) });
  t.after(() => { pool.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const a = pool.forTask('a'), b = pool.forTask('b'), gate = deferred(), started = deferred();
  const live = b.exclusive(null, async () => { started.resolve(); await gate.promise; }); await started.promise;
  await a.exclusive(null, async () => {});
  assert.notEqual(envs[0].XDG_DATA_HOME, envs[1].XDG_DATA_HOME);
  assert.notEqual(envs[0].OPENCODE_SERVER_PASSWORD, envs[1].OPENCODE_SERVER_PASSWORD);
  children[1].kill(); assert.equal(b.status().pid, children[0].pid);
  await a.exclusive(null, async () => {}); assert.equal(children.length, 3);
  await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(a.status().running, false); assert.equal(b.status().running, true);
  gate.resolve(); await live; pool.shutdown(); assert.ok(children.every(child => child.exitCode !== null));
});

test('two project reservations cannot deadlock each other', async () => {
  const locks = createWorkspaceReservations(), signal = new AbortController().signal;
  const roots = ['one', 'two'].map(value => path.join(os.tmpdir(), 'orvix-lock-' + value));
  await locks.reserve('a', [roots[0]], signal); await locks.reserve('b', [roots[1]], signal);
  const waiting = locks.reserve('a', [roots[1]], signal);
  await assert.rejects(locks.reserve('b', [roots[0]], signal), /conflict/);
  locks.release('b'); await waiting; locks.release('a');
});

test('concurrent operations in one session retain the union of their project reservations', async () => {
  const locks = createWorkspaceReservations(), signal = new AbortController().signal;
  const roots = ['one', 'two', 'three'].map(value => path.join(os.tmpdir(), 'orvix-union-' + value));
  await locks.reserve('a', [roots[0]], signal); await locks.reserve('b', [roots[1]], signal);
  const waiting = deferred();
  const second = locks.reserve('a', [roots[1]], signal, () => waiting.resolve());
  await waiting.promise; const third = locks.reserve('a', [roots[2]], signal);
  locks.release('b'); await Promise.all([second, third]);
  assert.equal(locks.inspect().held.a.length, 3); locks.release('a');
});

test('engine sessions overlap and cancelling one pending approval leaves the other session active', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-parallel-engine-'));
  const starts = new Map(['a', 'b'].map(id => [id, deferred()]));
  const events = []; let engine;
  engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => events.push(event), null, { runNativeSession: async options => {
    assert.ok(options.taskId); starts.get(options.taskId).resolve();
    await options.onPermission({ permission: 'bash', patterns: ['Write-Output fixture'], metadata: { command: 'Write-Output fixture' } }, root);
    return { text: 'Permission reviewed; no shell command executed.', usage: null };
  } });
  t.after(() => { engine.shutdown(); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const run = id => engine.run({ taskId: id, requestId: `request-${id}`, modelId: 'opencode/mimo-v2.6-flash-free', accessMode: 'Controlled', accessModeVersion: 2, messages: [{ role: 'user', content: 'Inspect status' }] });
  const a = run('a'), rejected = assert.rejects(a, /cancelled/), b = run('b');
  await Promise.all([...starts.values()].map(item => item.promise));
  for (let i = 0; i < 100 && (!engine.pendingApproval('a') || !engine.pendingApproval('b')); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(engine.pendingApproval('a')); assert.ok(engine.pendingApproval('b'));
  engine.cancel('a'); await rejected; assert.equal(engine.isRunning('b'), true); assert.ok(engine.pendingApproval('b'));
  engine.decide(engine.pendingApproval('b').approvalId, false); await b;
  assert.equal(engine.pendingApproval('a'), null); assert.ok(events.some(item => item.taskId === 'a' && item.type === 'approval' && item.phase === 'remove'));
});

test('native OpenCode clarification batches preserve question details and return one answer per question', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-question-batch-'));
  const events = [];
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => events.push(event), null, {
    runNativeSession: async options => {
      const answers = await options.onQuestion({ questions: [
        { question: 'Which opening should lead?', options: [{ label: 'Gallery', description: 'Start with a curated visual wall.', recommended: true }] },
        { question: 'Which palette should guide it?', options: ['Warm neutrals', 'Cool contrast'] },
      ] });
      assert.deepEqual(answers, [['Gallery'], ['Cool contrast']]);
      return { text: 'The selected direction is ready.', usage: null };
    },
  });
  t.after(() => { engine.shutdown(); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });

  const run = engine.run({ taskId: 'question-task', requestId: 'question-turn', modelId: 'opencode/mimo-v2.6-flash-free',
    accessMode: 'Controlled', accessModeVersion: 2, messages: [{ role: 'user', content: 'Inspect the project and explain its entry point.' }] });
  let pending;
  for (let attempt = 0; attempt < 100 && !pending; attempt++) {
    pending = engine.pendingQuestion('question-task', 'question-turn');
    if (!pending) await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(pending, 'the batched clarification should be available to the matching task');
  assert.equal(pending.questions.length, 2);
  assert.equal(pending.questions[0].options[0].description, 'Start with a curated visual wall.');
  assert.equal(pending.questions[0].options[0].recommended, true);
  assert.ok(events.some(event => event.taskId === 'question-task' && event.requestId === 'question-turn'
    && event.type === 'clarification' && event.questionCount === 2));
  engine.answerQuestion(pending.questionId, JSON.stringify(['Gallery', 'Cool contrast']));
  const result = await run;
  assert.equal(result.text, 'The selected direction is ready.');
  assert.equal(engine.pendingQuestion('question-task', 'question-turn'), null);
});

test('real engine project reservations hold a second writer while read-only research runs, then release on completion', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-project-writers-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'parallel-project-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"parallel-writers-fixture"}');
  fs.writeFileSync(path.join(project, 'probe.txt'), 'before');
  const started = deferred(), release = deferred(), blocked = deferred(), calls = [], events = [], pending = [];
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => {
    events.push(event);
    if (event.taskId === 'writer-b' && /Waiting for another session/.test(event.message ?? '')) blocked.resolve();
  }, null, { runNativeSession: async options => {
    if (options.taskId.startsWith('writer')) {
      assert.equal(await options.onPermission({ permission: 'edit', patterns: ['probe.txt'], metadata: {} }, project), true);
      // Models may reason/read concurrently; the reservation starts at the
      // actual mutation permission, not when the model session is created.
      calls.push(options.taskId);
      if (options.taskId === 'writer-a') { started.resolve(); await release.promise; }
      fs.writeFileSync(path.join(project, 'probe.txt'), options.taskId);
    } else {
      assert.equal(await options.onPermission({ permission: 'read', patterns: ['probe.txt'], metadata: {} }, project), true);
      calls.push(options.taskId);
    }
    return { text: 'Fixture operation completed.', usage: null };
  } });
  t.after(async () => { release.resolve(); engine.shutdown(); await Promise.allSettled(pending); assert.equal(path.dirname(project), __dirname); fs.rmSync(project, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  for (const id of ['writer-a', 'writer-b', 'research']) await engine.workspaces.open(id, project, async () => true);
  const run = (id, mode = 'Full access') => engine.run({ taskId: id, requestId: id + '-turn', modelId: 'opencode/mimo-v2.6-flash-free', accessMode: mode, accessModeVersion: 2, messages: [{ role: 'user', content: mode === 'Plan' ? 'Read probe.txt' : 'Edit probe.txt file' }] });
  const a = run('writer-a'); pending.push(a); await started.promise;
  const b = run('writer-b'); pending.push(b); await blocked.promise;
  const research = await run('research', 'Plan'); assert.deepEqual(research.changes, []);
  assert.deepEqual(calls, ['writer-a', 'research']); assert.equal(fs.readFileSync(path.join(project, 'probe.txt'), 'utf8'), 'before');
  assert.ok(events.some(item => item.taskId === 'writer-b' && /Waiting for another session/.test(item.message)));
  release.resolve(); await Promise.all([a, b]);
  assert.deepEqual(calls, ['writer-a', 'research', 'writer-b']);
  assert.equal(fs.readFileSync(path.join(project, 'probe.txt'), 'utf8'), 'writer-b');
  assert.equal(engine.changes.diff('writer-b', path.join(project, 'probe.txt')).before, 'writer-a');
});
