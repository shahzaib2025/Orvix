const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSearchKeyStore } = require('../electron/search-key-store.cjs');
const { searchSerper, configureSearchKeys } = require('../electron/serper-search.cjs');
const secret = 'test-serper-key-0000000000001';
const encryptionKey = crypto.randomBytes(32);
const safeStorage = { isEncryptionAvailable: () => true,
  encryptString: text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv); const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
  decryptString: data => { const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(); } };
function fixture(t, persistent = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-search-test-'));
  t.after(() => { configureSearchKeys(null); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  const app = { getPath: () => directory };
  const secure = persistent ? safeStorage : { isEncryptionAvailable: () => false };
  const store = createSearchKeyStore(app, secure); configureSearchKeys(store);
  return { store, app, secure, directory };
}
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
test('reload recovers only stale local decryption failures without changing balance or pause', t => {
  const { store, app, secure, directory } = fixture(t);
  store.add({ label: 'Recoverable', key: secret, remaining: 9 });
  store.add({ label: 'Rejected', key: secret + '2', remaining: 7 });
  store.add({ label: 'Paused', key: secret + '3', remaining: 5 });
  const target = path.join(directory, 'search-keys.json');
  const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
  for (const key of saved.keys) key.status = 'invalid';
  saved.keys[0].lastError = saved.keys[2].lastError = 'Saved key could not be decrypted. Delete and add it again.';
  saved.keys[1].lastError = 'Invalid API key'; saved.keys[2].enabled = false;
  fs.writeFileSync(target, JSON.stringify(saved));
  const restored = createSearchKeyStore(app, secure);
  assert.deepEqual(restored.snapshot().keys.map(k => k.status), ['ready', 'invalid', 'paused']);
  assert.deepEqual(restored.snapshot().pools, saved.pools);
  assert.deepEqual(restored.snapshot().totals, saved.totals);
  assert.equal(restored.snapshot().keys[1].lastError, 'Invalid API key');
  assert.equal(restored.reserve().keyId, saved.keys[0].id);
  const failed = createSearchKeyStore(app, { ...secure, decryptString: () => { throw new Error('unavailable'); } });
  assert(failed.snapshot().keys.every(k => k.status === 'invalid'));
  assert.equal(failed.reserve(), null);
});
test('encrypted persistence, masked listing, duplicate keys, pause and deletion', t => {
  const { store, app, secure, directory } = fixture(t);
  const added = store.add({ label: 'First', key: secret, remaining: 10 });
  assert(!JSON.stringify(added).includes(secret));
  assert(!fs.readFileSync(path.join(directory, 'search-keys.json'), 'utf8').includes(secret));
  assert.throws(() => store.add({ label: 'Duplicate', key: secret }), /already saved/);
  store.update(added.keys[0].id, { enabled: false }); assert.equal(store.reserve(), null);
  const reloaded = createSearchKeyStore(app, secure); assert.equal(reloaded.snapshot().keys[0].status, 'paused');
  reloaded.remove(added.keys[0].id); assert.equal(reloaded.snapshot().keys.length, 0);
});
test('account pool is shared; concurrent reservations cannot overspend; settlement is idempotent', t => {
  const { store } = fixture(t);
  const added = store.add({ label: 'First', key: secret, remaining: 1 });
  store.add({ label: 'Second', key: secret + '2', poolId: added.keys[0].poolId });
  assert.equal(store.snapshot().pools.length, 1);
  const request = store.reserve(); assert.equal(request.keyId, added.keys[0].id); assert.equal(store.reserve(), null);
  assert.throws(() => store.update(request.keyId, { remaining: 20 }), /active searches/);
  store.settle(request.id, 'success'); store.settle(request.id, 'success');
  assert.equal(store.snapshot().totals.credits, 1); assert.equal(store.snapshot().keys[1].remaining, 0);
});
test('process restart retains unknown reservation; balance reconciliation resolves it', t => {
  const { store, app, secure } = fixture(t);
  const added = store.add({ label: 'First', key: secret, remaining: 2 }); store.reserve();
  const reloaded = createSearchKeyStore(app, secure);
  assert.equal(reloaded.snapshot().keys[0].remaining, 1); assert.equal(reloaded.snapshot().unresolvedUnknown, 1);
  reloaded.update(added.keys[0].id, { remaining: 2 }); assert.equal(reloaded.snapshot().unresolvedUnknown, 0);
});
test('deleted in-flight key never returns; provider credit consumption is honored', t => {
  const { store } = fixture(t); const added = store.add({ label: 'First', key: secret, remaining: 10 });
  const request = store.reserve(); store.remove(added.keys[0].id); store.settle(request.id, 'success', { credits: 2 });
  assert.equal(store.snapshot().keys.length, 0); assert.equal(store.snapshot().totals.credits, 2);
});
test('confirmed exhaustion rotates oldest first and normalizes Google ranking without secrets', async t => {
  const { store } = fixture(t);
  store.add({ label: 'First', key: secret, remaining: 3 }); store.add({ label: 'Second', key: secret + '2', remaining: 3 });
  let calls = 0;
  const results = await searchSerper('Gemini official models', undefined, async () => ++calls === 1 ? response(400, { message: 'Not enough credits' }) : response(200, { credits: 1, organic: [{ title: 'Official Gemini', link: 'https://ai.google.dev/gemini-api/docs/models?utm_source=test', snippet: 'Current models' }] }));
  assert.equal(calls, 2); assert.equal(results[0].url, 'https://ai.google.dev/gemini-api/docs/models');
  assert.equal(store.snapshot().keys[0].status, 'exhausted'); assert.equal(store.snapshot().totals.successes, 1);
  assert(!JSON.stringify(results).includes(secret));
});
test('rate limits and ambiguous network failures do not rotate through the key pool', async t => {
  const { store } = fixture(t);
  store.add({ label: 'First', key: secret, remaining: 5 }); store.add({ label: 'Second', key: secret + '2', remaining: 5 });
  let calls = 0;
  await assert.rejects(searchSerper('test', undefined, async () => { calls++; return response(429, {}); }), /rate limit/);
  assert.equal(calls, 1); assert.equal(store.reserve(), null);
  const other = fixture(t).store; other.add({ label: 'Other', key: secret, remaining: 5 }); other.add({ label: 'Next', key: secret + '2', remaining: 5 });
  await assert.rejects(searchSerper('test', undefined, async () => { throw new Error('network'); }), /unknown/);
  assert.equal(other.snapshot().unresolvedUnknown, 1); assert.equal(other.snapshot().totals.attempts, 1);
});
test('session-only storage writes no plaintext file', t => {
  const { store, directory } = fixture(t, false); store.add({ label: 'Session', key: secret });
  assert.equal(store.snapshot().canPersist, false); assert.deepEqual(fs.readdirSync(directory), []);
});
test('a failed concurrent request cannot revive a confirmed exhausted account', t => {
  const { store } = fixture(t); store.add({ label: 'Account', key: secret, remaining: 3 });
  const first = store.reserve(), second = store.reserve();
  store.settle(first.id, 'exhausted'); store.settle(second.id, 'failure');
  assert.equal(store.snapshot().pools[0].remaining, 0); assert.equal(store.reserve(), null);
});
test('invalid credential rotates once and corrupt storage is never overwritten', async t => {
  const { store, directory, app, secure } = fixture(t);
  store.add({ label: 'Invalid', key: secret, remaining: 3 }); store.add({ label: 'Valid', key: secret + '2', remaining: 3 });
  let calls = 0;
  await searchSerper('models', undefined, async () => ++calls === 1 ? response(403, { message: 'Invalid API key' }) : response(200, { organic: [] }));
  assert.equal(calls, 2); assert.equal(store.snapshot().keys[0].status, 'invalid');
  fs.writeFileSync(path.join(directory, 'search-keys.json'), '{broken');
  const broken = createSearchKeyStore(app, secure); assert(broken.snapshot().storageError);
  assert.throws(() => broken.add({ label: 'Account', key: secret }), /could not be read/);
  assert.equal(fs.readFileSync(path.join(directory, 'search-keys.json'), 'utf8'), '{broken');
});
test('shared search counts queries and cache hits, then falls back once without LangSearch', async t => {
  const { store } = fixture(t); store.add({ label: 'First', key: secret, remaining: 5 });
  const original = global.fetch; t.after(() => { global.fetch = original; }); let calls = 0;
  global.fetch = async url => { calls++; assert(!String(url).includes('langsearch')); return response(200, { credits: 1, organic: [{ title: 'Orvix fixture models', link: 'https://example.com/models', snippet: 'Orvix fixture results' }] }); };
  const { searchWeb } = require('../electron/search.cjs');
  assert.equal((await searchWeb({ query: 'Orvix fixture models' })).provider, 'Serper');
  assert.equal((await searchWeb({ query: 'Orvix fixture models' })).cached, true);
  const refreshed = await searchWeb({ query: 'Orvix fixture models', refresh: true });
  assert.equal(refreshed.provider, 'Serper'); assert.equal(refreshed.cacheBypassed, true); assert.equal(refreshed.cached, undefined);
  assert.equal((await searchWeb({ query: 'Orvix fixture models' })).cached, true);
  assert.equal(calls, 2); assert.equal(store.snapshot().totals.queries, 4); assert.equal(store.snapshot().totals.cacheHits, 2);
  store.update(store.snapshot().keys[0].id, { enabled: false });
  global.fetch = async () => { calls++; return { status: 200, text: async () => '<div class="result results_links results_links_deep web-result"><a class="result__a" href="https://example.com/models">Orvix fixture models</a><a class="result__snippet">Orvix fixture results</a>' }; };
  assert.equal((await searchWeb({ query: 'Orvix fixture models' })).provider, 'DuckDuckGo');
  assert.equal(store.snapshot().totals.fallbackCalls, 1);
  global.fetch = async () => ({ status: 200, text: async () => 'captcha bot challenge' });
  assert.equal((await searchWeb({ query: 'Orvix fixture blocked' })).status, 'unavailable');
  assert.equal((await searchWeb({ query: 'Orvix fixture blocked' })).status, 'unavailable');
  assert.equal(store.snapshot().totals.fallbackCalls, 2);
});
