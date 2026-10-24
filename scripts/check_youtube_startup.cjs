const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { WebSocket } = require('ws');
const { createYoutubeControl } = require('../electron/youtube-control.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-youtube-startup-'));
const token = randomBytes(32).toString('hex');
fs.mkdirSync(path.join(root, 'PCMonitorTest'));
fs.writeFileSync(path.join(root, 'PCMonitorTest', 'pairing-token.txt'), token);
process.env.LOCALAPPDATA = root;
let control, client;
async function shutdown() {
  if (client && client.readyState !== WebSocket.CLOSED) {
    const done = new Promise(resolve => client.once('close', resolve));
    client.close();
    await done;
  }
  client = null;
  control?.close();
  control = null;
  await new Promise(resolve => setTimeout(resolve, 50));
}
(async () => {
  let launches = 0, commands = 0;
  control = createYoutubeControl({ port: 0, reconnectGraceMs: 10, connectionTimeoutMs: 1000, startChrome: async () => {
    launches++;
    client = new WebSocket(`ws://127.0.0.1:${control.port}`, { origin: `chrome-extension://${'a'.repeat(32)}` });
    client.on('open', () => client.send(JSON.stringify({ type: 'hello', browser: 'Chrome', token })));
    client.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'command') {
        commands++;
        client.send(JSON.stringify({ type: 'result', id: message.id, result: { status: 'ok', playbackState: 'playing' } }));
      }
    });
  } });
  const results = await Promise.all([1, 2].map(() => control.execute({ action: 'search_and_play', query: 'Shape of You' })));
  assert.ok(results.every(result => result.status === 'ok'));
  assert.equal(launches, 1, 'Concurrent requests must share startup');
  assert.equal(commands, 2, 'Send each command once after authentication');
  await control.execute({ action: 'search_and_play', query: 'Shape of You' });
  assert.equal(launches, 1, 'Connected Chrome must not launch again');
  await shutdown();
  control = createYoutubeControl({ port: 0, reconnectGraceMs: 10, connectionTimeoutMs: 20, startChrome: async () => {} });
  const absent = await control.execute({ action: 'search_and_play', query: 'Shape of You' });
  assert.match(absent.message, /extension is enabled.*Chrome profile/);
  await shutdown();
  control = createYoutubeControl({ port: 0, reconnectGraceMs: 10, startChrome: async () => { throw new Error('Chrome not installed'); } });
  assert.match((await control.execute({ action: 'search_and_play', query: 'Shape of You' })).message, /Chrome not installed/);
  await shutdown();
  console.log('YouTube startup checks passed: launch, authenticated wait, shared recovery, existing connection, missing extension and launch failure.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await shutdown();
  if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
});
