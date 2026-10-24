const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOpenCodePreferences } = require('../electron/agent/opencode-preferences.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');

test('OpenCode keep-alive preference defaults off and survives reloads atomically', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-opencode-preference-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let preferences = createOpenCodePreferences(root);
  assert.equal(preferences.getKeepAlive(), false);
  assert.deepEqual(preferences.setKeepAlive(true), { keepAlive: true });
  preferences = createOpenCodePreferences(root);
  assert.equal(preferences.getKeepAlive(), true);
  assert.deepEqual(preferences.setKeepAlive(false), { keepAlive: false });
  assert.equal(createOpenCodePreferences(root).getKeepAlive(), false);
  assert.throws(() => preferences.setKeepAlive('on'), /must be a boolean/);
});

test('keep-alive pins the focused task and keeps only the previous task warm', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-opencode-worker-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created = [];
  const create = (directory, options) => {
    const worker = { directory, options, keepAlive: options.keepAlive, shutdownCalled: false, connectCalls: 0, retireCalls: 0,
      setKeepAlive(value) { this.keepAlive = value; },
      retireIdle() { this.keepAlive = false; this.retireCalls++; },
      async connect() { this.connectCalls++; },
      status() { return { running: false, starting: false, queued: 0, keepAlive: this.keepAlive }; },
      shutdown() { this.shutdownCalled = true; } };
    created.push(worker);
    return worker;
  };
  const manager = createOpenCodeWorkers(root, { create });
  t.after(() => manager.shutdown());
  const catalog = created[0];
  assert.equal(catalog.options.buildTemperature, null);
  assert.equal(catalog.keepAlive, false);
  const first = manager.forTask('task-a');
  assert.equal(first.keepAlive, false);
  assert.equal(await manager.setKeepAlive(true, 'task-a'), true);
  assert.equal(catalog.connectCalls, 1, 'the catalog worker starts when keep-alive is enabled');
  assert.equal(catalog.keepAlive, false, 'catalog and reviews retain their idle timeout instead of pinning a second server');
  assert.equal(first.keepAlive, true);
  assert.equal(await manager.setKeepAlive(false), false);
  assert.equal(catalog.keepAlive, false);
  assert.equal(first.keepAlive, false);
  const second = manager.forTask('task-b');
  assert.equal(second.keepAlive, false);
  await manager.setKeepAlive(true, 'task-a');
  assert.equal(manager.status().keepAlive, true);
  assert.equal(first.keepAlive, true);
  assert.equal(second.keepAlive, false);
  await manager.connectTask('task-b');
  assert.equal(second.keepAlive, true);
  assert.equal(first.keepAlive, false);
  assert.equal(first.retireCalls, 0, 'the previous task gets its ordinary idle grace period');
  const third = manager.forTask('task-c');
  await manager.connectTask('task-c');
  assert.equal(third.keepAlive, true);
  assert.equal(second.keepAlive, false);
  assert.equal(second.retireCalls, 0, 'only the most recently left task stays warm');
  assert.ok(first.retireCalls > 0, 'older idle tasks retire to bound resident workers');
  assert.equal(catalog.connectCalls, 2, 're-enabling keep-alive ensures the catalog server is connected');
});

test('failed keep-alive startup rolls back the requested policy', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-opencode-worker-start-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createOpenCodeWorkers(root, { create: () => ({
    setKeepAlive() {}, async connect() { throw new Error('fixture server startup failed'); },
    status() { return { running: false, starting: false, queued: 0, keepAlive: false }; }, shutdown() {},
  }) });
  t.after(() => manager.shutdown());
  await assert.rejects(manager.setKeepAlive(true), /fixture server startup failed/);
  assert.equal(manager.status().keepAlive, false);
});
