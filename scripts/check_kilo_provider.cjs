const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeCatalog, configureKiloCatalog, refreshKiloCatalog } = require('../electron/agent/kilo-catalog.cjs');
const { info, requestBody, request, appendResult } = require('../electron/agent/model-client.cjs');
const { providerFor } = require('../electron/agent/provider-registry.cjs');
const { createCredentials } = require('../electron/agent/credentials.cjs');
const { redactApiKeys, requestedKeyCheck, checkApiKey } = require('../electron/agent/api-key-check.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { collectStream } = require('../electron/agent/model-stream.cjs');
const free = (id, extra = {}) => ({ id, name: id, isFree: true, pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'] }, supported_parameters: ['tools', 'reasoning'], ...extra });
const connected = () => free('openai/gpt-6-luna', { isFree: false, pricing: { prompt: '0.01', completion: '0.02' }, hasUserByokAvailable: true,
  opencode: { ai_sdk_provider: 'openai', variants: { none: { reasoning: { enabled: false, effort: 'none' } }, high: { reasoning: { enabled: true, effort: 'high' } }, thinking: { reasoning: { enabled: true } } } } });

test('connected OpenAI models use Responses with only advertised effort values', () => {
  const model = normalizeCatalog({ data: [connected(), { ...connected(), id: 'openai/unconnected', hasUserByokAvailable: false }, { ...connected(), id: 'openai/oss', opencode: {} }] })[0];
  assert.equal(model.route, 'responses'); assert.equal(model.access, 'byok');
  assert.deepEqual(Object.keys(model.variants), ['none', 'high']);
  const body = requestBody(model, [{ role: 'user', content: 'hello' }], [{ name: 'inspect_storage', parameters: { type: 'object', properties: { directory: { type: 'string' }, action_id: { type: 'string' } }, required: ['directory'] } }], 'none', () => '');
  assert.equal(body.model, 'openai/gpt-6-luna');
  assert.deepEqual(body.reasoning, { effort: 'none' });
  assert.equal(body.store, false); assert.equal(body.messages, undefined);
  assert.equal(body.tools[0].strict, false); assert.deepEqual(body.tools[0].parameters.required, ['directory']);
  assert.throws(() => requestBody(model, [], [], 'max', () => ''), /does not advertise/);
  assert.equal(normalizeCatalog({ data: [{ ...connected(), hasUserByokAvailable: false }] }).length, 0);
});

test('authenticated Kilo catalog and Responses tool history retain account scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-kilo-byok-'));
  const original = global.fetch;
  let key = 'account-a';
  try {
    configureKiloCatalog(dir, () => key);
    global.fetch = async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer account-a'); return Response.json({ data: [connected()] }); };
    await refreshKiloCatalog(true);
    fs.writeFileSync(path.join(dir, 'kilo-model-checks.json'), JSON.stringify({ account: createHash('sha256').update(key).digest('hex'), testedAt: '2026-10-09T09:00:00Z', models: { 'sample/code:free': { status: 'passed', note: 'Observed tool check' } } }));
    assert.equal((await refreshKiloCatalog()).checks.models['sample/code:free'].status, 'passed');
    const requests = [];
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://api.kilo.ai/api/gateway/responses'); requests.push(JSON.parse(options.body));
      return Response.json({ output: requests.length === 1 ? [{ type: 'function_call', call_id: 'sum-1', name: 'sum', arguments: '{"a":2,"b":3}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '5' }] }] });
    };
    const history = [{ role: 'user', content: 'Sum 2 and 3' }];
    const input = { modelId: 'kilo/openai/gpt-6-luna', history, tools: [{ name: 'sum', parameters: { type: 'object' } }], variant: 'high', key, sessionId: 'task', signal: new AbortController().signal };
    const first = await request(input);
    appendResult(first.route, history, first, [{ id: first.calls[0].id, text: '5' }]);
    assert.equal((await request(input)).text, '5');
    assert.equal(requests[1].input.at(-1).call_id, 'sum-1');
    assert.equal(requests[0].reasoning.effort, 'high');
    key = 'account-b';
    global.fetch = async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer account-b'); return Response.json({ data: [free('other/free')] }); };
    assert.equal((await refreshKiloCatalog()).models[0].access, 'free');
    assert.equal((await refreshKiloCatalog()).checks, undefined, 'checks from a different saved key must not be shown');
    assert.throws(() => info('kilo/openai/gpt-6-luna'), /available/);
    configureKiloCatalog(dir, () => 'account-a');
    assert.throws(() => info('kilo/other/free'), /available/);
    assert.ok(!fs.readFileSync(path.join(dir, 'kilo-model-catalog.json'), 'utf8').includes('account-b'));
  } finally { global.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); configureKiloCatalog(dir); }
});

test('Kilo catalog excludes paid, expired and non-tool models and retains only advertised thinking options', () => {
  const models = normalizeCatalog({ data: [
    free('sample/code:free', { opencode: { variants: { instant: { reasoning: { enabled: false, effort: 'none' } }, high: { reasoning: { enabled: true, effort: 'high' } }, bad: { reasoning: { enabled: true, effort: 'invented' } } } } }),
    free('paid:free', { isFree: false }), free('priced', { pricing: { prompt: '1', completion: '0' } }),
    free('no-tools', { supported_parameters: [] }), free('expired', { expiration_date: '2020-01-01' }),
    free('audio', { pricing: { prompt: '0', completion: '0', request: '0.1' } }), free('sample/code:free'),
  ] });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'kilo/sample/code:free');
  assert.deepEqual(Object.keys(models[0].variants), ['instant', 'high']);
  const body = requestBody(models[0], [{ role: 'user', content: 'hello' }], [], 'instant', () => '');
  assert.equal(body.model, 'sample/code:free');
  assert.deepEqual(body.reasoning, { enabled: false, effort: 'none' });
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.tools, undefined);
  assert.throws(() => requestBody(models[0], [], [], 'xhigh', () => ''), /does not advertise/);
  assert.deepEqual(providerFor(models[0]).headers('chat', 'test-token', 'task').Authorization, 'Bearer test-token');
});

test('Kilo refresh replaces removed models, preserves cached evidence on errors and round-trips tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-kilo-'));
  const original = global.fetch;
  try {
    configureKiloCatalog(dir);
    let calls = 0;
    global.fetch = async () => { calls++; return Response.json({ data: [free('sample/code:free')] }); };
    const [one, two] = await Promise.all([refreshKiloCatalog(true), refreshKiloCatalog(true)]);
    assert.equal(calls, 1); assert.equal(one.updatedAt, two.updatedAt);
    assert.equal(info('kilo/sample/code:free').apiModelId, 'sample/code:free');
    const requests = [];
    global.fetch = async (url, input) => {
      assert.equal(url, 'https://api.kilo.ai/api/gateway/chat/completions');
      requests.push(JSON.parse(input.body));
      return Response.json({ choices: [{ message: requests.length === 1
        ? { content: null, tool_calls: [{ id: 'call-1', function: { name: 'sum', arguments: '{"a":2,"b":3}' } }] }
        : { content: '5' } }], usage: { prompt_tokens: 20, completion_tokens: 2 } });
    };
    const history = [{ role: 'user', content: 'Sum 2 and 3' }];
    const input = { modelId: 'kilo/sample/code:free', history, tools: [{ name: 'sum', description: 'Sum', parameters: { type: 'object' } }], key: 'test-key', sessionId: 'task', signal: new AbortController().signal };
    const first = await request(input);
    assert.equal(first.calls[0].name, 'sum');
    appendResult('chat', history, first, [{ id: 'call-1', text: '5' }]);
    assert.equal((await request(input)).text, '5');
    assert.equal(requests[1].messages.at(-1).tool_call_id, 'call-1');
    global.fetch = async () => Response.json({ data: [free('sample/new:free')] });
    await refreshKiloCatalog(true);
    assert.throws(() => info('kilo/sample/code:free'), /available/);
    global.fetch = async () => { throw new Error('offline'); };
    const cached = await refreshKiloCatalog(true);
    assert.equal(cached.models[0].apiModelId, 'sample/new:free'); assert.equal(cached.error, 'offline');
  } finally { global.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Kilo credentials persist through the existing encrypted store and JWTs are redacted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-kilo-key-'));
  const app = { getPath: () => dir };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().slice(10) };
  try {
    const credentials = createCredentials(app, safeStorage);
    assert.equal(credentials.setKey('kilo', 'test-kilo-key').kilo.configured, true);
    assert.equal(createCredentials(app, safeStorage).getKey('kilo'), 'test-kilo-key');
    assert.ok(!fs.readFileSync(path.join(dir, 'opencode-credentials.json'), 'utf8').includes('test-kilo-key'));
    assert.equal(redactApiKeys('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureTest12345'), '[API key redacted]');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Kilo catalog loading can be cancelled before any model or tool runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-kilo-cancel-'));
  const original = global.fetch;
  let finish;
  try {
    configureKiloCatalog(dir);
    global.fetch = () => new Promise(resolve => { finish = resolve; });
    const engine = createAgentEngine({ getPath: () => dir }, { getKey: () => 'test-key' }, () => {}, null,
      { requestModel: async () => { throw new Error('Model must not run after cancellation'); } });
    const run = engine.run({ taskId: 'cancel-test', requestId: 'cancel-turn', modelId: 'kilo/sample/code:free', accessMode: 'Plan', accessModeVersion: 2, messages: [{ role: 'user', content: 'yo' }] });
    assert.equal(engine.isRunning('cancel-test'), true);
    engine.cancel('cancel-test');
    await assert.rejects(run, /Task cancelled/);
    assert.equal(engine.isRunning('cancel-test'), false);
    finish(Response.json({ data: [free('sample/code:free')] }));
    await refreshKiloCatalog();
  } finally { global.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a fresh Kilo catalog starts a model without another catalog request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-kilo-cached-start-'));
  const original = global.fetch;
  let engine, catalogRequests = 0;
  try {
    configureKiloCatalog(dir, () => 'test-key');
    global.fetch = async () => { catalogRequests++; return Response.json({ data: [free('sample/code:free')] }); };
    assert.equal((await refreshKiloCatalog(true)).stale, false);
    global.fetch = () => { throw new Error('A fresh catalog must not be fetched again when starting the model.'); };
    engine = createAgentEngine({ getPath: () => dir }, { getKey: () => 'test-key' }, () => {}, null, {
      requestModel: async () => ({ text: 'Model reply.', calls: [], usage: null }),
    });
    const result = await engine.run({ taskId: 'cached-task', requestId: 'cached-turn', modelId: 'kilo/sample/code:free', accessMode: 'Controlled', messages: [{ role: 'user', content: 'yo' }] });
    assert.equal(result.text, 'Model reply.');
    assert.equal(catalogRequests, 1);
  } finally { engine?.shutdown(); global.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Kilo streamed reasoning metadata survives the tool-result round trip', async () => {
  const packets = [
    { choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.encrypted', data: 'part-' }] }, finish_reason: null }] },
    { choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.encrypted', data: 'two' }], content: 'Done' }, finish_reason: 'stop' }] },
  ];
  const response = new Response(packets.map(packet => `data: ${JSON.stringify(packet)}\n\n`).join('') + 'data: [DONE]\n\n');
  const collected = await collectStream('chat', response, () => {}, () => {});
  const history = [];
  appendResult('chat', history, { raw: collected.raw }, []);
  assert.equal(history[0].reasoning_details[0].data, 'part-two');
});

test('a public Kilo catalog is never reported as authenticated key verification', async () => {
  const check = requestedKeyCheck('check my saved Kilo API key');
  assert.equal(check.provider.id, 'kilo');
  const result = await checkApiKey(check, { kilo: 'test-key' }, new AbortController().signal);
  assert.match(result, /listings are public and cannot verify a key/);
  assert.doesNotMatch(result, /key accepted/);
});
