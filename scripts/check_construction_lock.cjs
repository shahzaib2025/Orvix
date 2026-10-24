const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateInput, contains, createAttemptNotifier, createConstructionLocks, elevationError } = require('../electron/construction-lock.cjs');
const input = { targets: ['C:\\Work\\draft'], mode: 'read_write', durationMinutes: 60 };
test('cancelled Windows approval explains the failure without exposing encoded commands', () => {
  const cause = { message: 'Command failed: powershell.exe -EncodedCommand encoded-internals', stderr: '<S S="Error">Start-Process : The operation was canceled by the user._x000D__x000A_</S>' };
  assert.match(elevationError(cause, 'Work').message, /approval was cancelled.*protection was not started/);
  assert.match(elevationError(cause, 'Recover').message, /recovery was not started/);
  assert.equal(elevationError(cause, 'Work').message.includes('EncodedCommand'), false);
});
test('Construction Lock validates selected paths, duration and mode', () => {
  assert.deepEqual(validateInput(input), input);
  for (const target of ['C:\\', '\\\\server\\share', 'C:\\Work\\draft:secret', 'relative', 'C:\\Work\\a\nfile', 'C:\\Work\\*.txt']) assert.throws(() => validateInput({ ...input, targets: [target] }));
  for (const durationMinutes of [0, 481, NaN, 2.5, '60']) assert.throws(() => validateInput({ ...input, durationMinutes }));
  assert.throws(() => validateInput({ ...input, mode: 'unknown' }));
  assert.throws(() => validateInput({ ...input, targets: [] }));
  assert.throws(() => validateInput({ ...input, targets: Array(13).fill('C:\\Work\\file') }));
});
test('critical locations, aliases and overlapping trees cannot be selected', () => {
  const forbidden = ['C:\\Windows', 'C:\\Users\\Test\\AppData', 'C:\\Orvix'];
  for (const target of ['C:\\Windows\\System32', 'C:\\Users\\Test', 'c:\\orvix\\electron', 'C:\\Work\\..\\Windows']) assert.throws(() => validateInput({ ...input, targets: [target] }, forbidden));
  assert.throws(() => validateInput({ ...input, targets: ['C:\\Work', 'c:\\work\\draft'] }));
  assert.throws(() => validateInput({ ...input, targets: ['C:\\Work\\draft', 'c:\\work\\draft'] }));
  assert.equal(contains('C:\\WorkElsewhere', 'C:\\Work'), false);
  assert.equal(contains('c:\\work\\nested', 'C:\\Work'), true);
});
test('denied attempt dialogs are deduplicated and do not stack', async () => {
  let at = 0, resolve, calls = [];
  const notice = createAttemptNotifier(attempt => { calls.push(attempt); return new Promise(done => { resolve = done; }); }, () => at);
  notice({ id: '1', path: 'C:\\Work\\a' }); await Promise.resolve();
  notice({ id: '1', path: 'C:\\Work\\a' });
  at = 20000; notice({ id: '2', path: 'C:\\Work\\b' }); assert.equal(calls.length, 1);
  resolve(); await new Promise(done => setImmediate(done));
  notice({ id: '3', path: 'C:\\Work\\a' }); assert.equal(calls.length, 1);
  at = 31000; notice({ id: '4', path: 'C:\\Work\\a' }); await Promise.resolve(); assert.equal(calls.length, 2);
  resolve(); await new Promise(done => setImmediate(done));
  at = 32000; notice({ id: '5', path: 'C:\\Work\\b' }); assert.equal(calls.length, 2);
});
test('stale permission journals remain recoverable across restart without exposing descriptors to UI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-lock-unit-'));
  const root = path.join(dir, 'construction-locks'), id = '00000000-0000-0000-0000-000000000001', session = path.join(root, id);
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ id, ...input }));
  fs.writeFileSync(path.join(session, 'manifest.json'), JSON.stringify({ status: 'active', updatedAt: 1, targets: input.targets, entries: [{ path: input.targets[0], sddl: 'private-descriptor' }], attempts: [] }));
  const engine = createConstructionLocks({ getPath: () => dir, getAppPath: () => 'C:\\Orvix' });
  try {
    const state = engine.list(); assert.equal(state.lock.status, 'recovery_required'); assert.equal(state.lock.id, id);
    assert.equal(JSON.stringify(state).includes('private-descriptor'), false);
    engine.stop(); assert.equal(fs.readFileSync(path.join(session, 'unlock'), 'utf8'), 'Orvix exited');
  } finally { engine.stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { force: true, recursive: true }); }
});
test('corrupt pointer and live journal fall back to the original permission checkpoint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-lock-backup-'));
  const root = path.join(dir, 'construction-locks'), id = '00000000-0000-0000-0000-000000000002', session = path.join(root, id);
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(root, 'current.json'), '{broken');
  fs.writeFileSync(path.join(session, 'manifest.json'), '{broken');
  fs.writeFileSync(path.join(session, 'original.json'), JSON.stringify({ version: 1, id, targets: input.targets, mode: input.mode, status: 'preparing', updatedAt: 1, entries: [{ sddl: 'private' }], attempts: [] }));
  const engine = createConstructionLocks({ getPath: () => dir, getAppPath: () => 'C:\\Orvix' });
  try {
    assert.equal(engine.list().lock.status, 'recovery_required');
    assert.equal(engine.list().lock.id, id);
    assert.deepEqual(engine.list().lock.targets, input.targets);
  } finally { engine.stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { force: true, recursive: true }); }
});
test('recovery waits for a newly launched helper instead of rejecting the old stale checkpoint', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-lock-recovery-'));
  const root = path.join(dir, 'construction-locks'), id = '00000000-0000-0000-0000-000000000003', session = path.join(root, id);
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ id, ...input }));
  const manifest = path.join(session, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ status: 'preparing', updatedAt: 1, targets: input.targets, attempts: [] }));
  let completion;
  const engine = createConstructionLocks({ getPath: () => dir, getAppPath: () => 'C:\\Orvix' }, {
    workerAlive: () => true,
    accessProbe: async (_mode, current) => ({ id: current.id, status: 'verified', checked: 1, issues: [] }),
    runPowerShell: async () => {
      completion = setTimeout(() => fs.writeFileSync(manifest, JSON.stringify({ status: 'unlocked', updatedAt: Date.now(), targets: input.targets, attempts: [] })), 100);
      return { stdout: '12345' };
    },
  });
  try { assert.equal((await engine.unlock()).lock.status, 'unlocked'); }
  finally { clearTimeout(completion); engine.stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { force: true, recursive: true }); }
});
test('a helper that exits during startup reports its captured diagnostic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-lock-exit-'));
  const root = path.join(dir, 'construction-locks'), id = '00000000-0000-0000-0000-000000000004', session = path.join(root, id);
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ id, ...input }));
  fs.writeFileSync(path.join(session, 'manifest.json'), JSON.stringify({ status: 'preparing', updatedAt: 1, targets: input.targets, attempts: [] }));
  const engine = createConstructionLocks({ getPath: () => dir, getAppPath: () => 'C:\\Orvix' }, {
    workerAlive: () => false,
    runPowerShell: async () => { fs.writeFileSync(path.join(session, 'helper.log'), Buffer.from('\uFEFFCheckpoint could not be replaced: fixture diagnostic', 'utf16le')); return { stdout: '12345' }; },
  });
  try { await assert.rejects(engine.unlock(), /Checkpoint could not be replaced: fixture diagnostic/); }
  finally { engine.stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { force: true, recursive: true }); }
});

test('permission restoration is not labelled access restored until the normal-user check succeeds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-access-check-'));
  const id = '00000000-0000-0000-0000-000000000009', session = path.join(dir, 'construction-locks', id);
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(dir, 'construction-locks', 'current.json'), JSON.stringify({ id, ...input }));
  fs.writeFileSync(path.join(session, 'manifest.json'), JSON.stringify({ status: 'unlocked', updatedAt: Date.now(), targets: input.targets, attempts: [] }));
  fs.writeFileSync(path.join(session, 'access-before.json'), '{}');
  let release;
  const engine = createConstructionLocks({ getPath: () => dir, getAppPath: () => 'C:\\Orvix' }, { accessProbe: () => new Promise(resolve => { release = resolve; }) });
  try {
    assert.equal(engine.list().lock.status, 'checking_access');
    release({ id, status: 'attention', issues: [{ path: input.targets[0], reason: 'file_busy' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(engine.list().lock.status, 'access_attention');
    assert.equal(engine.list().lock.verification.issues[0].reason, 'file_busy');
    const check = engine.unlock(); release({ id, status: 'verified', checked: 1, issues: [] });
    assert.equal((await check).lock.status, 'unlocked');
  } finally { engine.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unlocked legacy journal with no access baseline does not trap Stop all, while actual access failures still block', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-legacy-access-'));
  const id = '00000000-0000-0000-0000-000000000010', session = path.join(dir, 'construction-locks', id);
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(dir, 'construction-locks', 'current.json'), JSON.stringify({ id, ...input }));
  fs.writeFileSync(path.join(session, 'manifest.json'), JSON.stringify({ status: 'unlocked', updatedAt: Date.now(), targets: input.targets }));
  const receipt = { id, status: 'attention', checked: 0, issues: [{ reason: 'baseline_missing', message: 'Original access record is missing.' }] };
  const engine = createConstructionLocks({ getPath: () => dir, getAppPath: () => 'C:\\Orvix' }, { accessProbe: async () => receipt });
  const { stopTinyRuntimeAndUnlock } = require('../electron/tiny-window-lifecycle.cjs');
  try {
    const control = await stopTinyRuntimeAndUnlock({ control: async () => ({ status: 'stopped' }) }, engine);
    assert.equal(control.status, 'stopped');
    assert.equal(engine.list().lock.status, 'access_unverified');
    assert.deepEqual(engine.list().lock.verification.issues, receipt.issues);
    receipt.issues.push({ reason: 'access_denied', path: input.targets[0] });
    await assert.rejects(stopTinyRuntimeAndUnlock({ control: async () => ({ status: 'stopped' }) }, engine), /file access needs attention/);
    assert.equal(engine.list().lock.status, 'access_attention');
    receipt.issues = [{ reason: 'check_unavailable' }];
    await assert.rejects(stopTinyRuntimeAndUnlock({ control: async () => ({ status: 'stopped' }) }, engine), /file access needs attention/);
  } finally { engine.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
