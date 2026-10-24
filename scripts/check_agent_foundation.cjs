const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTaskContract, updateTaskContract } = require('../electron/agent/task-contract.cjs');
const { isContinuationRequest } = require('../electron/agent/task-continuation.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { messagesFor, instructionsFor, requestBody } = require('../electron/agent/model-client.cjs');
const { createRunJournal } = require('../electron/agent/run-journal.cjs');
const { automaticChoice, normalizeAccessMode } = require('../electron/agent/access-mode.cjs');
const { createTools } = require('../electron/agent/tools.cjs');
const { summarizeVerification } = require('../electron/agent/verification.cjs');
const { auditReply, removeUnsupportedClaims } = require('../electron/agent/claim-audit.cjs');
const { localUrl } = require('../electron/agent/preview-website.cjs');

test('task criteria survive a memory write and resume', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-contract-'));
  try {
    const app = { getPath: () => root };
    const store = createTaskMemoryStore(app);
    const initial = createTaskContract('Fix login');
    const contract = updateTaskContract(initial, { constraints: ['Keep public API'], acceptance: ['Empty password rejected'], workspaces: ['C:\\work'] }, ['C:\\work']);
    const stateFingerprint = 'a'.repeat(64);
    store.write('task-1', { goal: 'Fix login', latestRequest: 'Fix login', contract, status: 'running',
      evidence: [{ label: 'Login check', phase: 'focused', status: 'passed', stateFingerprint }] });
    const saved = store.read('task-1');
    assert.deepEqual(saved.contract.acceptance, ['Empty password rejected']);
    assert.deepEqual(saved.contract.workspaces, ['C:\\work']);
    assert.equal(saved.evidence[0].stateFingerprint, stateFingerprint);
    assert.match(store.context(saved), /Empty password rejected/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('short continuation messages preserve the existing task objective', () => {
  const contract = createTaskContract('Build a premium Toyota C-HR Three.js site');
  assert.equal(isContinuationRequest('continue'), true);
  assert.equal(isContinuationRequest('Please finish the task.'), true);
  assert.equal(isContinuationRequest('Continue by adding mobile controls'), false);
  assert.equal(createTaskContract('continue', contract).objective, 'Build a premium Toyota C-HR Three.js site');
  assert.equal(createTaskContract('Add mobile controls', contract).objective, 'Build a premium Toyota C-HR Three.js site');
  assert.equal(createTaskContract('Add mobile controls').objective, 'Add mobile controls');
});

test('stale checks and skipped checks never become passed', () => {
  const base = { label: 'Focused', command: 'npm test', directory: 'C:\\work', phase: 'focused', status: 'passed', stateFingerprint: 'old' };
  assert.equal(summarizeVerification([base], '', 1, 'new').status, 'not_run');
  assert.equal(summarizeVerification([{ ...base, status: 'skipped', stateFingerprint: 'new' }], '', 1, 'new').status, 'not_run');
  assert.equal(summarizeVerification([{ ...base, status: 'failed', stateFingerprint: 'new' }], '', 1, 'new').status, 'failed');
  assert.equal(summarizeVerification([{ ...base, status: 'failed', stateFingerprint: 'old' }, { ...base, stateFingerprint: 'new' }], '', 1, 'new').status, 'passed');
  assert.equal(summarizeVerification([{ ...base, stateFingerprint: 'new' }], '', 1, 'new').status, 'passed');
});

test('unsupported final claims are detected and removed', () => {
  const verification = { status: 'not_run', checks: [] };
  assert.equal(auditReply('Tests passed.', verification, false).length, 1);
  assert.equal(auditReply('No tests passed.', verification, false).length, 0);
  assert.equal(auditReply('I inspected the screenshot.', verification, false).length, 1);
  assert.equal(auditReply('Tests passed.', { status: 'passed', checks: [{ phase: 'layout', status: 'passed' }] }, false).length, 1);
  assert.equal(removeUnsupportedClaims('Changed the file.\nTests passed.', verification, false), 'Changed the file.');
});

test('saved image references use provider-specific request shapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-image-'));
  try {
    const store = createImageStore({ getPath: () => root });
    const ref = store.save('task-1', 'request-1', [{ name: 'reference.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR+QAAAAASUVORK5CYII=' }])[0];
    const history = [{ role: 'user', content: [{ type: 'text', text: 'Match this' }, ref] }];
    assert.equal(messagesFor('chat', history, store.read)[1].content[1].type, 'image_url');
    assert.equal(messagesFor('responses', history, store.read)[0].content[1].type, 'input_image');
    assert.equal(messagesFor('messages', history, store.read)[0].content[1].type, 'image');
    assert.throws(() => store.read({ ...ref, file: path.join(root, '..', 'other.png') }), /Invalid image reference/);
    store.forget('task-1');
    assert.equal(fs.existsSync(ref.file), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('3D website guidance stays in the invoked model request only', () => {
  const history = [{ role: 'user', content: 'Build a portfolio' }];
  const ordinary = instructionsFor(null);
  const specialty = instructionsFor('3d-website');
  assert.doesNotMatch(ordinary, /scroll.*scene/i);
  assert.match(specialty, /"specialty":"3d-website"/);
  assert.doesNotMatch(specialty, /WebGL is unavailable/);
  // Profile skill contents have their own tests; this checks request-level specialty isolation.
  for (const route of ['chat', 'messages', 'responses']) {
    const model = { id: 'opencode/example', name: 'Example', route };
    const normalBody = requestBody(model, history, [], null, () => '', false, false, null);
    const specialBody = requestBody(model, history, [], null, () => '', false, false, '3d-website');
    const getInstructions = body => route === 'chat' ? body.messages[0].content : route === 'messages' ? body.system : body.instructions;
    assert.equal(getInstructions(normalBody), ordinary);
    assert.equal(getInstructions(specialBody), specialty);
    assert.deepEqual(history, [{ role: 'user', content: 'Build a portfolio' }]);
  }
  assert.equal(instructionsFor(null), ordinary);
});

test('agent responses present sizes in readable units by default', () => {
  const instructions = instructionsFor(null);
  assert.match(instructions, /report human-readable MB or GB first/);
  assert.match(instructions, /Omit raw byte counts by default/);
  assert.match(instructions, /Label decimal MB\/GB and binary MiB\/GiB accurately/);
});

test('safe resume metadata retains the original specialty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-run-'));
  try {
    const journal = createRunJournal({ getPath: () => root });
    journal.write({ taskId: 'task-1', requestId: 'request-1', modelId: 'opencode-go/kimi-k3', accessMode: 'Full access', thinkingVariant: null,
      specialty: '3d-website', history: [{ role: 'user', content: 'Build a site' }], safe: true });
    assert.equal(journal.metadata('task-1').specialty, '3d-website');
    assert.equal(journal.metadata('task-1').context.budgetTokens, 200000);
    assert.equal(journal.read('task-1').specialty, '3d-website');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('access modes select the intended approval behavior', () => {
  assert.equal(normalizeAccessMode('Full access'), 'Controlled');
  assert.equal(normalizeAccessMode('Full access', 2), 'Full access');
  assert.equal(automaticChoice('Controlled', 'workspace'), null);
  assert.equal(automaticChoice('Controlled', 'command'), null);
  assert.equal(automaticChoice('Plan', 'workspace'), true);
  assert.equal(automaticChoice('Plan', 'command'), false);
  assert.equal(automaticChoice('Full access', 'workspace'), true);
  assert.equal(automaticChoice('Full access', 'command'), 'host');
  assert.equal(automaticChoice('Full access', 'host_command'), 'host');
  assert.equal(automaticChoice('Full access', 'delete'), 'host');
  assert.equal(automaticChoice('Controlled', 'delete'), null);
  assert.equal(automaticChoice('Plan', 'delete'), false);
  assert.equal(automaticChoice('Full access', 'command', true), false);
  assert.match(instructionsFor(null, 'Plan'), /Research with the available read and search tools/);
  assert.match(instructionsFor(null, 'Full access'), /without asking for workspace/);
  assert.match(instructionsFor(null, 'Controlled'), /user approves new workspaces/);
  for (const route of ['chat', 'messages', 'responses']) {
    const model = { id: 'opencode/example', name: 'Example', route };
    const readInstructions = body => route === 'chat' ? body.messages[0].content : route === 'messages' ? body.system : body.instructions;
    for (const mode of ['Plan', 'Full access', 'Controlled']) {
      const body = requestBody(model, [{ role: 'user', content: 'Help with a site' }], [], null, () => '', false, false, null, mode);
      assert.equal(readInstructions(body), instructionsFor(null, mode));
    }
  }
});

test('Controlled file deletions and explicit shell delete commands wait for approval', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-delete-approval-'));
  try {
    const first = path.join(directory, 'first.txt');
    const second = path.join(directory, 'second.txt');
    fs.writeFileSync(first, 'keep this file');
    fs.writeFileSync(second, 'keep this one too');
    const prompts = [];
    const changes = { register: async () => ({}), scan: async () => ({}), list: () => [], markFile() {}, markBatch() {} };
    const workspaces = { assert: (_taskId, file) => path.resolve(file), list: () => [directory] };
    const makeTools = (approve, mode = 'Controlled') => createTools(changes, workspaces, null, 'task-delete', new AbortController().signal,
      approve, null, () => {}, null, null, null, null, null, mode);
    const declined = makeTools(async (command, folder, kind, review) => { prompts.push({ command, folder, kind, review }); return false; });

    const directResult = await declined.call('delete_file', { file: first, expected_original: 'keep this file' });
    assert.match(directResult, /Deletion declined/);
    assert.equal(fs.readFileSync(first, 'utf8'), 'keep this file');
    assert.equal(prompts.at(-1).kind, 'delete');
    assert.deepEqual(prompts.at(-1).review.deletions, [{ file: first, bytes: Buffer.byteLength('keep this file') }]);

    const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const batchResult = await declined.call('apply_patch_batch', { operations: [
      { type: 'delete', file: first, expected_sha256: sha256(first) },
      { type: 'delete', file: second, expected_sha256: sha256(second) },
    ] });
    assert.equal(JSON.parse(batchResult).status, 'declined');
    assert.equal(prompts.at(-1).review.deletions.length, 2);
    assert.equal(fs.existsSync(first), true);
    assert.equal(fs.existsSync(second), true);

    const command = await declined.call('run_command', { directory, command: `Remove-Item -LiteralPath '${first}'` });
    assert.match(command, /Deletion command declined/);
    assert.equal(prompts.at(-1).kind, 'delete');
    assert.equal(prompts.at(-1).review.destructiveCommand, true);
    assert.equal(fs.existsSync(first), true);

    const approved = makeTools(async (_command, _folder, kind) => kind === 'delete');
    assert.match(await approved.call('delete_file', { file: first, expected_original: 'keep this file' }), /^Deleted /);
    assert.equal(fs.existsSync(first), false);
    fs.writeFileSync(first, 'full access file');
    const full = makeTools(async (_command, _folder, kind) => automaticChoice('Full access', kind), 'Full access');
    assert.match(await full.call('delete_file', { file: first, expected_original: 'full access file' }), /^Deleted /);
    assert.equal(fs.existsSync(first), false);
    assert.equal(JSON.parse(await full.call('apply_patch_batch', { operations: [
      { type: 'delete', file: second, expected_sha256: sha256(second) },
    ] })).files, 1);
    assert.equal(fs.existsSync(second), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Plan exposes only read tools and rejects a direct command call', async () => {
  const tools = createTools(null, null, null, 'task-1', new AbortController().signal,
    null, null, null, null, null, null, null, null, 'Plan');
  const names = tools.definitions('Plan').map(tool => tool.name);
  assert.ok(names.includes('search_content'));
  assert.ok(names.includes('open_workspace'));
  for (const forbidden of ['git_status', 'run_command', 'verify_work', 'apply_edit', 'delete_file', 'apply_patch_batch', 'preview_website', 'start_preview_server']) {
    assert.ok(!names.includes(forbidden), `${forbidden} must be unavailable in Plan mode`);
    await assert.rejects(tools.call(forbidden, {}), /Plan mode allows research and reading only/);
  }
});

test('Full access runs a host command while Controlled can decline it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-mode-command-'));
  try {
    const changes = { register: async () => ({}), scan: async () => ({}), list: () => [] };
    const workspaces = { assert: () => directory, list: () => [directory] };
    const commandEvents = [];
    const makeTools = (mode, approve) => createTools(changes, workspaces, null, 'task-1', new AbortController().signal,
      approve, null, event => commandEvents.push({ ...event, at: Date.now() }), null, null, null, null, null, mode);
    let fullApprovals = 0;
    const full = makeTools('Full access', (_command, _directory, kind) => {
      fullApprovals++;
      return automaticChoice('Full access', kind);
    });
    const command = `Write-Output 'started'; Start-Sleep -Milliseconds 400; Write-Output 'mode-ok'`;
    const commandStart = Date.now();
    let returned = false;
    const resultPromise = full.call('run_command', { directory, command }, undefined, { callId: 'stream-test', name: 'run_command', startedAt: commandStart })
      .then(result => { returned = true; return result; });
    const deadline = Date.now() + 5000;
    while (!commandEvents.some(event => event.type === 'tool' && event.phase === 'update' && event.callId === 'stream-test')) {
      if (Date.now() > deadline) throw new Error('The command emitted no streaming output.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const progress = commandEvents.find(event => event.type === 'tool' && event.phase === 'update' && event.callId === 'stream-test');
    assert.equal(returned, false, 'the first output update must arrive before command completion');
    assert.match(progress.output, /started/);
    assert.match(await resultPromise, /Exit 0\s+started[\s\S]*mode-ok/);
    assert.equal(fullApprovals, 1);
    let controlledApprovals = 0;
    const controlled = makeTools('Controlled', () => { controlledApprovals++; return false; });
    assert.equal(await controlled.call('run_command', { directory, command }), 'Command declined by user.');
    assert.equal(controlledApprovals, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('old Full access checkpoints resume as Controlled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-access-mode-'));
  try {
    const journal = createRunJournal({ getPath: () => root });
    journal.write({ taskId: 'task-1', requestId: 'request-1', modelId: 'example', accessMode: 'Full access',
      history: [{ role: 'user', content: 'Fix site' }], safe: true });
    assert.equal(journal.metadata('task-1').accessMode, 'Full access');
    const file = path.join(root, 'agent-runs', 'task-1.json');
    const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete legacy.accessModeVersion;
    fs.writeFileSync(file, JSON.stringify(legacy));
    assert.equal(journal.metadata('task-1').accessMode, 'Controlled');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preview URL remains local', () => {
  assert.equal(localUrl('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173/');
  assert.throws(() => localUrl('https://example.com/'), /local HTTP URL/);
});
