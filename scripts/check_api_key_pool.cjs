const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiKeyStore, requestWithKeyPool } = require('../electron/agent/api-key-store.cjs');
const { createCredentials } = require('../electron/agent/credentials.cjs');
const { request } = require('../electron/agent/model-client.cjs');
const { requestWithRetry } = require('../electron/agent/model-retry.cjs');

function fixture() {
  const values = new Map(); let time = 10000;
  const store = createApiKeyStore({ readFile: () => '', readValue: (_, name) => values.get(name) ?? '', writeValue: (name, value) => values.set(name, value), legacyKey: () => '', removeLegacy: () => {}, now: () => time, environment: {} });
  const add = (tier, key) => store.change(tier, { operation: 'add', key });
  return { store, values, add, advance: ms => { time += ms; } };
}
const options = () => ({ modelId: 'groq/openai/gpt-oss-120b', signal: new AbortController().signal });
const rejected = status => Object.assign(new Error(`Rejected (HTTP ${status}).`), { status, keyRotationEligible: true });

test('key lists have no small fixed cap, reject duplicates, and keep masks secret', () => {
  const { store, add } = fixture();
  for (let i = 0; i < 70; i++) add('groq', `test-key-secret-${i}`);
  assert.equal(store.snapshot('groq').length, 70);
  assert.throws(() => add('groq', 'test-key-secret-1'), /already added/);
  assert.throws(() => add('groq', 'bad\nkey'), /one line/);
  assert.throws(() => add('toString', 'unknown-provider-key'), /Unknown API provider/);
  assert.ok(!JSON.stringify(store.snapshot('groq')).includes('test-key-secret'));
  const entry = store.snapshot('groq')[0];
  store.change('groq', { operation: 'toggle', id: entry.id });
  assert.equal(store.snapshot('groq')[0].status, 'paused');
  store.change('groq', { operation: 'update', id: entry.id, key: 'replacement-secret-value', label: 'Replacement' });
  assert.equal(store.snapshot('groq')[0].label, 'Replacement');
  assert.equal(store.snapshot('groq')[0].enabled, false);
});

test('round-robin wraps and concurrent requests remain in their selected provider', async () => {
  const { store, add } = fixture(); add('groq', 'key-a'); add('groq', 'key-b'); add('cerebras', 'key-c');
  const received = [];
  const run = input => { received.push(input.key); return Promise.resolve(input.key); };
  assert.deepEqual(await Promise.all([requestWithKeyPool(options(), 'groq', store, run), requestWithKeyPool(options(), 'groq', store, run)]), ['key-a', 'key-b']);
  await requestWithKeyPool(options(), 'groq', store, run);
  await requestWithKeyPool(options(), 'cerebras', store, run);
  assert.deepEqual(received, ['key-a', 'key-b', 'key-a', 'key-c']);
});

test('429 moves to the next key, respects Retry-After, and reuses recovered keys', async () => {
  const { store, add, advance } = fixture(); add('groq', 'key-a'); add('groq', 'key-b');
  const calls = [];
  await requestWithKeyPool(options(), 'groq', store, async input => { calls.push(input.key); if (input.key === 'key-a') throw Object.assign(rejected(429), { retryAfterMs: 120000 }); return 'ok'; });
  assert.deepEqual(calls, ['key-a', 'key-b']);
  assert.equal(store.snapshot('groq')[0].cooldownUntil, 130000);
  assert.equal(store.acquire('groq').key, 'key-b');
  advance(120001);
  assert.equal(store.acquire('groq').key, 'key-a');
});

test('invalid keys are skipped, while forbidden requests do not switch credentials', async () => {
  const { store, add } = fixture(); add('groq', 'key-a'); add('groq', 'key-b');
  const calls = [];
  await requestWithKeyPool(options(), 'groq', store, async input => { calls.push(input.key); if (input.key === 'key-a') throw rejected(401); return 'ok'; });
  assert.equal(store.snapshot('groq')[0].status, 'invalid');
  assert.deepEqual(calls, ['key-a', 'key-b']);
  let attempts = 0;
  await assert.rejects(requestWithKeyPool(options(), 'groq', store, async () => { attempts++; throw rejected(403); }), /403/);
  assert.equal(attempts, 1);
});

test('exhausted pools stop after one attempt per key and cancellation stops failover', async () => {
  const { store, add } = fixture(); add('groq', 'key-a'); add('groq', 'key-b');
  let calls = 0;
  await assert.rejects(requestWithKeyPool(options(), 'groq', store, async () => { calls++; throw rejected(429); }), error => error.noRetry && /No more eligible/.test(error.message));
  assert.equal(calls, 2);
  await assert.rejects(requestWithKeyPool(options(), 'groq', store, async () => { calls++; }), /No groq key is ready/);
  assert.equal(calls, 2);
  const second = fixture(); second.add('groq', 'key-a'); second.add('groq', 'key-b');
  const controller = new AbortController();
  await assert.rejects(requestWithKeyPool({ ...options(), signal: controller.signal }, 'groq', second.store, async () => { controller.abort(); throw rejected(429); }), /429/);
  assert.equal(second.store.snapshot('groq')[1].attempts, 0);
});

test('key metadata survives restart, singular-key migration and edits preserve other settings', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-key-pool-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFilePath = path.join(dir, '.env');
  fs.writeFileSync(envFilePath, '# untouched\nANOTHER_SETTING=yes\nORVIX_GROQ_API_KEY="legacy-test-secret"\n');
  const make = () => createCredentials({ getPath: () => dir }, { isEncryptionAvailable: () => false }, { envFilePath, environment: {} });
  let credentials = make();
  credentials.changeApiKey('groq', { operation: 'add', key: 'second-test-secret', label: 'Second project' });
  credentials.changeApiKey('groq', { operation: 'toggle', id: credentials.status().groq.keys[0].id });
  credentials = make();
  assert.equal(credentials.status().groq.keys.length, 2);
  assert.equal(credentials.status().groq.keys[0].status, 'paused');
  assert.equal(credentials.apiKeys.acquire('groq').key, 'second-test-secret');
  credentials.changeApiKey('groq', { operation: 'remove', id: credentials.status().groq.keys[1].id });
  assert.equal(make().status().groq.keys.length, 1);
  const content = fs.readFileSync(envFilePath, 'utf8');
  assert.match(content, /# untouched\nANOTHER_SETTING=yes/);
  assert.doesNotMatch(content, /ORVIX_GROQ_API_KEY=/);
  assert.ok(!JSON.stringify(credentials.status()).includes('legacy-test-secret'));
});

test('malformed stored key lists are not silently overwritten', () => {
  const { store, values, add } = fixture(); values.set('ORVIX_GROQ_API_KEYS', '{broken');
  assert.throws(() => add('groq', 'new-key'), /invalid JSON/);
  assert.equal(values.get('ORVIX_GROQ_API_KEYS'), '{broken');
});

test('real transport rotates before ordinary retries and never replays a partial stream', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const { store, add } = fixture(); add('groq', 'key-a'); add('groq', 'key-b');
  const auth = [];
  global.fetch = async (_, input) => {
    auth.push(input.headers.Authorization);
    if (auth.length === 1) return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429, headers: { 'retry-after': '180' } });
    return new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const input = { ...options(), history: [{ role: 'user', content: 'hello' }], tools: [] };
  const result = await requestWithKeyPool(input, 'groq', store, requestWithRetry);
  assert.equal(result.text, 'done'); assert.deepEqual(auth, ['Bearer key-a', 'Bearer key-b']);
  assert.equal(store.snapshot('groq')[0].cooldownUntil, 190000);
  let calls = 0;
  global.fetch = async () => { calls++; return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"connection closed HTTP 429"}}\n\n', { headers: { 'content-type': 'text/event-stream' } }); };
  await assert.rejects(requestWithKeyPool(input, 'groq', store, requestWithRetry), error => error.responseStarted && error.noRetry);
  assert.equal(calls, 1);
});

test('Nara always uses its official endpoint and only its selected pool key', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const { store, add } = fixture(); add('nara', 'nara-secret'); add('google', 'google-secret');
  global.fetch = async (url, input) => {
    assert.equal(url, 'https://router.bynara.id/v1/chat/completions');
    assert.equal(input.headers.Authorization, 'Bearer nara-secret');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  assert.equal((await requestWithKeyPool({ ...options(), modelId: 'nara/jev', providerBaseUrl: 'https://wrong.example/v1', history: [], tools: [] }, 'nara', store, request)).text, 'ok');
});

test('Agent conversation runs use the pool, including automatic Nara routing', async t => {
  const original = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-agent-key-pool-'));
  const app = { getPath: () => dir };
  const credentials = createCredentials(app, { isEncryptionAvailable: () => false }, { envFilePath: path.join(dir, '.env'), environment: {} });
  credentials.changeApiKey('groq', { operation: 'add', key: 'limited-groq-key' });
  credentials.changeApiKey('groq', { operation: 'add', key: 'ready-groq-key' });
  credentials.changeApiKey('nara', { operation: 'add', key: 'ready-nara-key' });
  const engine = require('../electron/agent/engine.cjs').createAgentEngine(app, credentials, () => {}, null);
  t.after(() => { engine.shutdown(); global.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); });
  const observed = [];
  global.fetch = async (url, input) => {
    observed.push([url, input.headers.Authorization]);
    if (input.headers.Authorization === 'Bearer limited-groq-key') return new Response('{"error":{"message":"Rate limited"}}', { status: 429 });
    return new Response('{"choices":[{"message":{"content":"Hello from the selected model."}}]}', { headers: { 'content-type': 'application/json' } });
  };
  for (const [taskId, modelId] of [['groq-task', 'groq/openai/gpt-oss-120b'], ['nara-task', 'nara/jev']]) {
    const result = await engine.run({ taskId, requestId: `${taskId}-turn`, modelId, accessMode: 'Controlled', accessModeVersion: 2, messages: [{ role: 'user', content: 'yo' }] });
    assert.equal(result.text, 'Hello from the selected model.');
  }
  assert.deepEqual(observed, [
    ['https://api.groq.com/openai/v1/chat/completions', 'Bearer limited-groq-key'],
    ['https://api.groq.com/openai/v1/chat/completions', 'Bearer ready-groq-key'],
    ['https://router.bynara.id/v1/chat/completions', 'Bearer ready-nara-key'],
  ]);
});
