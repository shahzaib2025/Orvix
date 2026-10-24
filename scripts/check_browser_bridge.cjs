const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { WebSocket } = require('ws');
const { createYoutubeControl } = require('../electron/youtube-control.cjs');
const protocol = require('../electron/browser-protocol.cjs');
const { findPairedProfile } = require('../electron/chrome-launch.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-browser-bridge-'));
fs.mkdirSync(path.join(root, 'PCMonitorTest'));
const token = randomBytes(32).toString('hex');
fs.writeFileSync(path.join(root, 'PCMonitorTest', 'pairing-token.txt'), token);
process.env.LOCALAPPDATA = root;
let launches = 0, commands = 0;
const control = createYoutubeControl({ port: 0, startChrome: async () => { launches++; }, connectionTimeoutMs: 20 });
let client;
(async () => {
  assert.equal((await control.browserRequest('observe', { scope: 'browser' })).status, 'unavailable');
  assert.equal(launches, 0);
  assert.match(fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8'), /shared\/(?:browser-tools\.json|\*\.json)/, 'Packaged desktop must include the structured browser schema (explicitly or via the shared JSON glob)');
  const extensionId = 'a'.repeat(32), userData = path.join(root, 'test-chrome'), ownStorage = path.join(userData, 'Profile 2', 'Local Extension Settings', extensionId);
  fs.mkdirSync(ownStorage, { recursive: true }); fs.writeFileSync(path.join(ownStorage, '000001.log'), `fixture token ${token}`);
  assert.equal(findPairedProfile(extensionId, token, userData).profile, 'Profile 2');
  assert.equal(findPairedProfile(extensionId, '0'.repeat(64), userData), null);
  const second = path.join(userData, 'Default', 'Local Extension Settings', extensionId); fs.mkdirSync(second, { recursive: true }); fs.writeFileSync(path.join(second, '000001.log'), token);
  assert.equal(findPairedProfile(extensionId, token, userData), null, 'Never guess between paired profiles');
  assert.throws(() => protocol.validate('act', { action: 'evaluate', args: { code: 'alert(1)' } }));
  assert.throws(() => protocol.validate('act', { action: 'click', args: { script: 'do it' } }));
  for (const action of ['type', 'key']) {
    const args = action === 'type' ? { text: 'open code' } : { key: 'Enter' };
    assert.throws(() => protocol.validate('act', { action, target: 'session:tab:1', args }), error => error.code === 'invalid_target_type');
    assert.equal(protocol.validate('act', { action, target: 'session:element:1:0:document.1', args }).action, action);
  }
  assert.equal(protocol.validate('act', { action: 'scroll', target: 'session:tab:1', args: { y: 400 } }).action, 'scroll');
  assert.throws(() => protocol.validate('observe', { scope: 'page', screenshot: 'yes' }));
  assert.throws(() => protocol.validate('act', { action: 'click', expect: { kind: 'text', value: '' } }));
  assert.throws(() => protocol.validate('act', { action: 'key', target: 'session:element:1:0:document.1', args: { key: 'Enter' }, expect: { kind: 'search_query', value: '' } }));
  assert.throws(() => protocol.validate('act', { action: 'upload', args: { files: [root] } }));
  assert.equal(JSON.stringify(protocol.summary({ action: 'type', args: { text: 'SECRET' }, observation: { screenshot: { data: 'IMAGE' }, text: 'SECRET' } })).includes('SECRET'), false);
  client = new WebSocket(`ws://127.0.0.1:${control.port}`, { origin: `chrome-extension://${'a'.repeat(32)}` });
  await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  let ready;
  const readyPromise = new Promise(resolve => { ready = resolve; });
  client.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'ready') ready();
    if (m.type === 'command') client.send(JSON.stringify({ type: 'result', id: m.id, result: { status: 'ok', playbackState: 'playing' } }));
    if (m.type === 'browser-command') {
      commands++;
      if (m.id === 'cancel-me') return;
      client.send(JSON.stringify({ type: 'result', id: m.id, result: { requestId: m.id, status: 'ok', verification: { verified: true } } }));
    }
    if (m.type === 'browser-cancel') client.send(JSON.stringify({ type: 'result', id: m.id, result: { requestId: m.id, status: 'cancelled' } }));
  });
  client.send(JSON.stringify({ type: 'hello', browser: 'Chrome', token }));
  await readyPromise;
  assert.equal((await control.browserRequest('act', { action: 'tab_open' })).status, 'update_required');
  const oldYoutube = await control.browserRequest('act', { action: 'youtube_search', args: { query: 'Fixture song' } });
  assert.equal(oldYoutube.status, 'ok'); assert.equal(oldYoutube.legacyCompatibility, true); assert.equal(oldYoutube.verification.verified, true);
  client.close(); await new Promise(resolve => client.once('close', resolve));
  client = new WebSocket(`ws://127.0.0.1:${control.port}`, { origin: `chrome-extension://${'a'.repeat(32)}` });
  await new Promise(resolve => client.once('open', resolve));
  const ready2 = new Promise(resolve => client.once('message', resolve));
  client.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'browser-command') {
      commands++;
      if (m.id !== 'cancel-me') client.send(JSON.stringify({ type: 'result', id: m.id, result: { requestId: m.id, status: 'ok' } }));
    }
    if (m.type === 'browser-cancel') client.send(JSON.stringify({ type: 'result', id: m.id, result: { requestId: m.id, status: 'cancelled' } }));
  });
  client.send(JSON.stringify({ type: 'hello', browser: 'Chrome', token, protocolVersion: 2, sessionId: 'test-session', extensionVersion: '0.3.0', capabilities: { missingPermissions: [] } }));
  await ready2;
  client.send(JSON.stringify({ type: 'inventory', sessionId: 'test-session', observation: { sessionId: 'test-session', timestamp: Date.now(), tabs: [{ ref: 'test-session:tab:1' }], windows: [] } }));
  await new Promise(resolve => setTimeout(resolve, 30));
  const cached = await control.browserRequest('observe', { scope: 'browser' });
  assert.equal(cached.observation.tabs.length, 1); assert.equal(commands, 0);
  assert.equal((await control.browserRequest('act', { action: 'tab_open' })).status, 'ok');
  const pending = control.browserRequest('act', { action: 'tab_activate', target: 'current', requestId: 'cancel-me' });
  await new Promise(resolve => setTimeout(resolve, 20)); control.cancelBrowser(['cancel-me']);
  assert.equal((await pending).status, 'cancelled');
  assert.equal(launches, 0);
  console.log('Browser bridge checks passed: no launch on observation, legacy compatibility, fresh inventory, validated requests, cancellation and redacted logs.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  client?.close(); control.close();
  if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
});
