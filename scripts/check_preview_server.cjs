const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPreviewServer } = require('../electron/agent/preview-server.cjs');
function fixture(startupMs = 500) {
  const controller = new AbortController(); let launches = 0, stops = 0, child;
  const server = createPreviewServer(controller.signal, { startupMs, spawn() { launches++; child = new EventEmitter(); Object.assign(child, { pid: 1234, exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() }); return child; },
    stop(owned) { stops++; owned.exitCode = 0; owned.emit('close'); } });
  return { controller, server, child: () => child, launches: () => launches, stops: () => stops };
}
test('managed preview waits for an observed local URL and returns immediately when ready', async () => {
  const f = fixture(), started = Date.now(), pending = f.server.start('node server.cjs', 'project');
  setTimeout(() => f.child().stdout.emit('data', '\x1b[36mLocal: http://127.0.0.1:34567/\x1b[0m\n'), 10);
  const result = await pending; assert.equal(result.url, 'http://127.0.0.1:34567/'); assert.equal(result.status, 'ready'); assert.ok(Date.now() - started < 400);
  f.server.stopAll(); assert.equal(f.stops(), 1);
});
test('startup without a URL is explicit and repeating the same command reuses its process', async () => {
  const f = fixture(20), first = await f.server.start('node server.cjs', 'project');
  assert.equal(first.url, null); assert.equal(first.status, 'starting'); assert.match(first.note, /do not guess/);
  f.child().stdout.emit('data', 'PREVIEW_URL=http://localhost:12345');
  const second = await f.server.start('node server.cjs', 'project'); assert.equal(second.reused, true); assert.equal(second.pid, first.pid); assert.equal(second.url, 'http://localhost:12345/'); assert.equal(f.launches(), 1);
  f.server.stopAll();
});
test('remote, lookalike and credential URLs do not become local preview targets', async () => {
  const f = fixture(20), pending = f.server.start('node server.cjs', 'project');
  f.child().stdout.emit('data', 'https://example.com http://localhost.evil.com:3000 http://user:secret@localhost:12345 http://localhost:invalid');
  assert.equal((await pending).url, null); f.server.stopAll();
});
test('cancelled startup stops only its owned process and cannot return ready', async () => {
  const f = fixture(), pending = f.server.start('node server.cjs', 'project'); setTimeout(() => f.controller.abort(), 10);
  await assert.rejects(pending, /cancelled/); assert.equal(f.stops(), 1); assert.deepEqual(f.server.inspect(), []);
  await assert.rejects(f.server.start('node server.cjs', 'project'), /cancelled/); assert.equal(f.launches(), 1);
});
test('individual operation cancellation stops its server without cancelling the task', async () => {
  const f = fixture(), operation = new AbortController();
  const pending = f.server.start('node server.cjs', 'project', operation.signal);
  operation.abort(); await assert.rejects(pending, /cancelled/);
  assert.equal(f.controller.signal.aborted, false); assert.equal(f.stops(), 1);
  const retry = f.server.start('node server.cjs', 'project');
  f.child().stdout.emit('data', 'http://127.0.0.1:34567/');
  assert.equal((await retry).status, 'ready'); assert.equal(f.launches(), 2);
  f.server.stopAll();
});

test('startup errors surface rather than pretending the server is running', async () => {
  const f = fixture(), pending = f.server.start('node server.cjs', 'project'); setTimeout(() => f.child().emit('error', new Error('Fixture launch failed')), 10);
  await assert.rejects(pending, /launch failed/); assert.deepEqual(f.server.inspect(), []);
});
