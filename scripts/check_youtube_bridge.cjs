const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { WebSocket } = require('ws');
const { createYoutubeControl } = require('../electron/youtube-control.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-youtube-'));
const token = randomBytes(32).toString('hex');
fs.mkdirSync(path.join(root, 'PCMonitorTest'));
fs.writeFileSync(path.join(root, 'PCMonitorTest', 'pairing-token.txt'), token);
process.env.LOCALAPPDATA = root;
const control = createYoutubeControl({ port: 0 });

(async () => {
  assert.equal((await control.execute({ action: 'pause' })).status, 'unavailable');
  const client = new WebSocket(`ws://127.0.0.1:${control.port}`, { origin: `chrome-extension://${'a'.repeat(32)}` });
  await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  const ready = new Promise((resolve, reject) => {
    client.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ready') { resolve(); return; }
      if (message.type === 'command') {
        assert.equal(message.action, 'search_and_play');
        assert.equal(message.query, 'Target video');
        client.send(JSON.stringify({ type: 'result', id: message.id, result: { status: 'ok', title: 'Target video', playbackState: 'playing' } }));
      }
    });
    client.once('error', reject);
  });
  client.send(JSON.stringify({ type: 'hello', browser: 'Chrome', token }));
  await ready;
  // Extension diagnostics must not disrupt command/result routing.
  client.send(JSON.stringify({ type: 'trace', stage: 'tab changed', tabId: 12, url: 'https://www.youtube.com/results?search_query=Target', token: 'never-log-this' }));
  const result = await control.execute({ action: 'search_and_play', query: 'Target video' });
  assert.equal(result.status, 'ok');
  assert.equal(result.playbackState, 'playing');
  client.close();
  console.log('YouTube bridge checks passed: unpaired failure and authenticated command/response.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  control.close();
  if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
});
