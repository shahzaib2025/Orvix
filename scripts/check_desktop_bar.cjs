const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createDesktopBar } = require('../electron/desktop-bar.cjs');
const { createOwnedHelpers } = require('../electron/desktop-bar/helpers.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const empty = { windows: 0, timers: 0, handlers: 0, helpers: 0, pending: 0, helperTimers: 0 };

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-bar-'));
  const file = path.join(directory, 'desktop-bar-settings.json');
  if (options.saved) fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: true }));
  const views = [], changes = [];
  const createView = callbacks => {
    const item = { active: true, stopped: false, callbacks, deactivations: 0,
      start: options.start || (() => Promise.resolve()),
      deactivate() { this.active = false; this.deactivations++; this.cancelStart?.(); },
      async dispose() { this.deactivate(); if (options.dispose) await options.dispose(item); this.stopped = true; },
      diagnostics: () => item.stopped ? empty : { ...empty, windows: item.active ? 2 : 0, helpers: item.stopped ? 0 : 1 },
    };
    if (options.deferred) item.start = () => new Promise((resolve, reject) => { item.finishStart = resolve; item.cancelStart = () => reject(new Error('cancelled')); });
    views.push(item); return item;
  };
  const controller = createDesktopBar({ app: { getPath: () => directory }, file, platform: options.platform || 'win32', createView, onChange: state => changes.push(state) });
  t.after(async () => { await controller.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { controller, views, changes, file, directory };
}

test('fresh and unsupported installs allocate no feature resources', async t => {
  const a = fixture(t);
  assert.deepEqual(await a.controller.initialize(), { supported: true, enabled: false, status: 'off', error: '' });
  assert.equal(a.views.length, 0); assert.deepEqual(a.controller.diagnostics(), empty);
  const b = fixture(t, { platform: 'linux', saved: true });
  assert.equal((await b.controller.initialize()).supported, false);
  await assert.rejects(b.controller.setEnabled(true), /Windows/);
  assert.equal(b.views.length, 0);
});

test('remembered On starts once; shutdown preserves the preference', async t => {
  const a = fixture(t, { saved: true });
  assert.equal((await a.controller.initialize()).status, 'on');
  await a.controller.setEnabled(true); await a.controller.setEnabled(true);
  assert.equal(a.views.length, 1);
  await a.controller.shutdown();
  assert.equal(JSON.parse(fs.readFileSync(a.file)).enabled, true);
  assert.deepEqual(a.controller.diagnostics(), empty);
  await assert.rejects(a.controller.setEnabled(true), /closing/);
});

test('twenty on/off cycles leave no resources or enabled preference', async t => {
  const a = fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await a.controller.setEnabled(true)).status, 'on');
    assert.equal((await a.controller.setEnabled(false)).status, 'off');
    assert.deepEqual(a.controller.diagnostics(), empty);
  }
  assert.equal(a.views.length, 20); assert.ok(a.views.every(view => view.stopped));
  assert.equal(JSON.parse(fs.readFileSync(a.file)).enabled, false);
});

test('Off cancels a pending entrance and late completion cannot resurrect it', async t => {
  const a = fixture(t, { deferred: true });
  const on = a.controller.setEnabled(true); await tick();
  const off = a.controller.setEnabled(false);
  assert.equal(a.views[0].active, false);
  a.views[0].finishStart();
  await Promise.all([on, off]);
  assert.equal(a.controller.getState().status, 'off'); assert.deepEqual(a.controller.diagnostics(), empty);
});

test('rapid requests settle to the last choice without duplicate views', async t => {
  const a = fixture(t);
  await Promise.all([a.controller.setEnabled(true), a.controller.setEnabled(false), a.controller.setEnabled(true)]);
  assert.equal(a.views.length, 1); assert.equal(a.controller.getState().status, 'on');
});

test('startup failures clean resources and revert the saved switch', async t => {
  const a = fixture(t, { start: async () => { throw new Error('load failed'); } });
  const result = await a.controller.setEnabled(true);
  assert.equal(result.status, 'error'); assert.match(result.error, /load failed/);
  assert.equal(result.enabled, false); assert.deepEqual(a.controller.diagnostics(), empty);
  assert.equal(JSON.parse(fs.readFileSync(a.file)).enabled, false);
});

test('Off is not reported until helper cleanup finishes; failure is visible and retryable', async t => {
  let fail = true;
  const a = fixture(t, { dispose: async () => { if (fail) throw new Error('helper still alive'); } });
  await a.controller.setEnabled(true);
  const result = await a.controller.setEnabled(false);
  assert.equal(result.status, 'error'); assert.match(result.error, /helper still alive/);
  assert.equal(a.controller.diagnostics().helpers, 1);
  fail = false;
  assert.equal((await a.controller.setEnabled(false)).status, 'off');
  assert.deepEqual(a.controller.diagnostics(), empty);
});

test('a renderer crash cleans up and does not restart automatically', async t => {
  const a = fixture(t);
  await a.controller.setEnabled(true);
  a.views[0].callbacks.onFailure(new Error('renderer crashed'));
  await tick(); await tick();
  assert.equal(a.controller.getState().status, 'error');
  assert.equal(a.controller.getState().enabled, false); assert.deepEqual(a.controller.diagnostics(), empty);
});

function fakeProcesses({ responds = true, graceful = true } = {}) {
  const children = [], kills = [];
  const spawn = (executable, args) => {
    const child = new EventEmitter();
    child.pid = 80000 + children.length;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stop = () => { if (!child.closed) { child.closed = true; child.emit('close', 0); } };
    child.kill = child.stop;
    child.stdin.on('finish', () => { if (graceful) setImmediate(child.stop); });
    child.stdin.on('data', data => { if (responds) { const input = JSON.parse(data); setImmediate(() => child.stdout.write(JSON.stringify({ id: input.id, volume: 42, brightness: 70 }) + '\n')); } });
    children.push(child); return child;
  };
  const execFile = (file, args, _options, done) => { kills.push({ file, args }); children.find(child => String(child.pid) === args[1])?.stop(); done(null); };
  return { spawn, execFile, children, kills };
}

test('read controls helper is owned and completely disposed', async () => {
  const fake = fakeProcesses(); const helpers = createOwnedHelpers(fake);
  assert.equal((await helpers.runControls('Read')).volume, 42);
  assert.equal(helpers.diagnostics().helpers, 1);
  await helpers.dispose();
  assert.deepEqual(helpers.diagnostics(), { helpers: 0, pending: 0, helperTimers: 0 });
  await assert.rejects(helpers.runControls('Read'), /off/);
  assert.equal(fake.children.length, 1);
});

test('pending control cancellation rejects requests and stops the helper', async () => {
  const fake = fakeProcesses({ responds: false }); const helpers = createOwnedHelpers(fake);
  const request = helpers.runControls('Read'); const rejection = assert.rejects(request, /off/);
  helpers.deactivate(); await helpers.dispose(); await rejection;
  assert.deepEqual(helpers.diagnostics(), { helpers: 0, pending: 0, helperTimers: 0 });
});

test('an unresponsive helper is killed by its owned PID tree, never by process name', async () => {
  const fake = fakeProcesses({ graceful: false }); const helpers = createOwnedHelpers({ ...fake, platform: 'win32' });
  await helpers.runControls('Read'); await helpers.dispose();
  assert.deepEqual(fake.kills, [{ file: 'taskkill.exe', args: ['/PID', '80000', '/T', '/F'] }]);
  assert.equal(helpers.diagnostics().helpers, 0);
});

test('an exited helper is never targeted by a possibly reused PID', async () => {
  const fake = fakeProcesses({ graceful: false }); const helpers = createOwnedHelpers({ ...fake, platform: 'win32' });
  await helpers.runControls('Read'); fake.children[0].emit('exit', 0);
  const cleanup = helpers.dispose(); setTimeout(fake.children[0].stop, 600);
  await cleanup;
  assert.deepEqual(fake.kills, []); assert.equal(helpers.diagnostics().helpers, 0);
});

test('invalid preference inputs cannot start resources or overwrite settings', async t => {
  const a = fixture(t);
  await assert.rejects(a.controller.setEnabled('true'), /Choose/);
  assert.equal(a.views.length, 0); assert.equal(fs.existsSync(a.file), false);
});

test('a failed preference write cannot prevent complete runtime shutdown', async t => {
  const a = fixture(t);
  await a.controller.setEnabled(true);
  fs.unlinkSync(a.file); fs.mkdirSync(a.file);
  const result = await a.controller.setEnabled(false);
  assert.equal(result.enabled, false); assert.equal(result.status, 'error');
  assert.match(result.error, /stopped.*could not be saved/);
  assert.deepEqual(a.controller.diagnostics(), empty);
});

test('both installer configurations include local assets and unpack native scripts', () => {
  const root = path.join(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  assert.match(config, /electron\/\*\*\/\*/);
  for (const file of ['controls.ps1', 'shortcuts.ps1']) assert.ok(config.includes(`electron/desktop-bar/${file}`));
  for (const file of ['index.html', 'styles.css', 'renderer.js', 'clock.html', 'clock-renderer.js', 'preload.cjs', 'orvix-logo.png']) assert.ok(fs.existsSync(path.join(root, 'electron', 'desktop-bar', file)));
  const source = fs.readFileSync(path.join(root, 'electron', 'desktop-bar', 'window.cjs'), 'utf8');
  assert.doesNotMatch(source, /app\.quit|requestSingleInstanceLock|appendSwitch|setInterval|QuickDeck-Prototype/);
});
