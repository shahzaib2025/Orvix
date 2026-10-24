const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { info, requestBody, request, appendResult } = require('../electron/agent/model-client.cjs');
const { providerFor } = require('../electron/agent/provider-registry.cjs');
const { createCredentials, readEnvValue } = require('../electron/agent/credentials.cjs');
const { requestedKeyCheck, redactApiKeys } = require('../electron/agent/api-key-check.cjs');

const signal = () => new AbortController().signal;
const tool = { name: 'inspect', description: 'Inspect a value', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };

test('all configured provider model IDs resolve to distinct routes and API IDs', () => {
  const pairs = [
    ['requesty/google/gemma-4-31b-it', 'requesty', 'google/gemma-4-31b-it'],
    ['requesty/nvidia/nemotron-3-ultra-550b-a55b', 'requesty', 'nvidia/nemotron-3-ultra-550b-a55b'],
    ['requesty/mistral/leanstral-1-5', 'requesty', 'mistral/leanstral-1-5'],
    ['google/gemini-3.8-flash', 'google', 'gemini-3.8-flash'],
    ['groq/openai/gpt-oss-120b', 'groq', 'openai/gpt-oss-120b'],
    ['cerebras/gpt-oss-120b', 'cerebras', 'gpt-oss-120b'],
    ['nara/agnes-2.5-flash', 'nara', 'agnes-2.5-flash'],
  ];
  for (const [id, tier, apiModelId] of pairs) {
    const model = info(id);
    assert.equal(model.credentialTier, tier);
    assert.equal(model.apiModelId, apiModelId);
    assert.equal(model.route, 'chat');
  }
  assert.notEqual(info('groq/openai/gpt-oss-120b').id, info('cerebras/gpt-oss-120b').id);
  assert.equal(providerFor(info('google/gemini-3.8-flash')).baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(providerFor(info('groq/openai/gpt-oss-120b')).baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(providerFor(info('cerebras/gpt-oss-120b')).baseUrl, 'https://api.cerebras.ai/v1');
  assert.equal(providerFor(info('nara/agnes-2.5-flash')).baseUrl, 'https://router.bynara.id/v1');
  assert.equal(providerFor(info('requesty/google/gemma-4-31b-it')).baseUrl, 'https://router.requesty.ai/v1');
  assert.equal(providerFor(info('requesty/google/gemma-4-31b-it')).headers('chat', 'requesty-fixture').Authorization, 'Bearer requesty-fixture');
  assert.equal(providerFor(info('nara/agnes-2.5-flash'), 'https://router.example/v1').baseUrl, 'https://router.bynara.id/v1');
  assert.throws(() => info('groq/not-a-listed-model'), /available model/);
});

test('request formatting uses namespaced provider identity and only supported reasoning values', () => {
  const body = requestBody(info('groq/openai/gpt-oss-120b'), [{ role: 'user', content: 'Hello' }], [tool], 'high', () => '');
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.tools[0].function.name, 'inspect');
  assert.throws(() => requestBody(info('nara/jev'), [], [], 'high', () => ''), /does not advertise/);
  assert.equal(requestBody(info('google/gemini-2.5-pro'), [], [], null, () => '').model, 'gemini-2.5-pro');
  assert.throws(() => requestBody(info('google/gemini-3.8-flash'), [], [], 'minimal', () => ''), /does not advertise/);
  assert.equal(requestBody(info('google/gemini-3.8-flash'), [], [], 'low', () => '').reasoning_effort, 'low');
  assert.throws(() => info('nara/nemotron-3-ultra-free'), /available model/);
});

test('multiple API keys round-trip through .env and hosted routers use built-in URLs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-api-provider-keys-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, '# keep unrelated settings\nOTHER_SETTING=preserved\nORVIX_GOOGLE_API_KEY="old-value"\nORVIX_GOOGLE_API_KEY="older-duplicate"\n');
  const app = { getPath: () => dir };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`cipher:${value}`), decryptString: value => value.toString().slice(7) };
  try {
    const credentials = createCredentials(app, safeStorage, { envFilePath: envFile });
    credentials.setKey('google', 'sample-google-secret');
    credentials.setKey('groq', 'sample-groq-secret');
    credentials.setKey('cerebras', 'sample-cerebras-secret');
    credentials.setKey('nara', 'sample-nara-secret');
    credentials.setKey('requesty', 'sample-requesty-secret');
    const status = credentials.status();
    assert.equal(status.nara.configured, true);
    assert.equal(status.google.fromFile, true);
    assert.equal(status.naraBaseUrl, 'https://router.bynara.id/v1');
    const restored = createCredentials(app, safeStorage, { envFilePath: envFile });
    assert.equal(restored.status().google.keys.length, 2);
    assert.equal(restored.getKey('groq'), 'sample-groq-secret');
    assert.equal(restored.getKey('cerebras'), 'sample-cerebras-secret');
    assert.equal(restored.getKey('nara'), 'sample-nara-secret');
    assert.equal(restored.getKey('requesty'), 'sample-requesty-secret');
    assert.equal(restored.getBaseUrl('nara'), 'https://router.bynara.id/v1');
    const env = fs.readFileSync(envFile, 'utf8');
    assert.match(env, /# keep unrelated settings/);
    assert.match(env, /OTHER_SETTING=preserved/);
    assert.ok(JSON.parse(readEnvValue(env, 'ORVIX_GOOGLE_API_KEYS')).some(item => item.key === 'sample-google-secret'));
    assert.doesNotMatch(env, /ORVIX_GOOGLE_API_KEY=/);
    assert.doesNotMatch(env, /ORVIX_NARA_BASE_URL=/);
    assert.ok(JSON.parse(readEnvValue(env, 'ORVIX_REQUESTY_API_KEYS')).some(item => item.key === 'sample-requesty-secret'));
    assert.doesNotMatch(env, /ORVIX_REQUESTY_API_KEY=/);
    const credentialFile = path.join(dir, 'opencode-credentials.json');
    assert.equal(fs.existsSync(credentialFile), false);
    for (const key of credentials.status().google.keys) credentials.changeApiKey('google', { operation: 'remove', id: key.id });
    assert.equal(createCredentials(app, safeStorage, { envFilePath: envFile }).getKey('google'), '');
    assert.doesNotMatch(fs.readFileSync(envFile, 'utf8'), /ORVIX_GOOGLE_API_KEY=/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Requesty sends selected model IDs through its OpenAI-compatible endpoint', async () => {
  const original = global.fetch;
  let sent;
  try {
    global.fetch = async (url, options) => {
      sent = { url, headers: options.headers, body: JSON.parse(options.body) };
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'Requesty is connected.' } }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
    };
    const result = await request({ modelId: 'requesty/google/gemma-4-31b-it', history: [{ role: 'user', content: 'Say hello' }], tools: [tool], key: 'requesty-live-fixture', signal: signal() });
    assert.equal(result.text, 'Requesty is connected.');
    assert.equal(sent.url, 'https://router.requesty.ai/v1/chat/completions');
    assert.equal(sent.headers.Authorization, 'Bearer requesty-live-fixture');
    assert.equal(sent.body.model, 'google/gemma-4-31b-it');
    assert.equal(sent.body.tools[0].function.name, 'inspect');
  } finally { global.fetch = original; }
});

test('Requesty serializes concurrent Agent requests', async () => {
  const { withRequestyRequest } = require('../electron/agent/requesty-queue.cjs');
  let active = 0;
  let maximum = 0;
  const call = () => withRequestyRequest({ signal: signal() }, async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return 'ok';
  });
  assert.deepEqual(await Promise.all([call(), call(), call()]), ['ok', 'ok', 'ok']);
  assert.equal(maximum, 1);
});

test('Requesty keys are recognized and fully redacted', () => {
  const fixture = 'rqsty-sk-Abcdefghijklmnop+xyz/==123';
  const parsed = requestedKeyCheck(`Check this Requesty API key ${fixture}`);
  assert.equal(parsed.provider.id, 'requesty');
  assert.equal(parsed.supplied, fixture);
  assert.equal(redactApiKeys(`Requesty key: ${fixture}`), 'Requesty key: [API key redacted]');
});

test('streamed tool calls round-trip through provider chat history with the selected key', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      const event = calls.length === 1
        ? 'data: {"choices":[{"delta":{"reasoning_content":"Inspect the source.","reasoning_details":[{"type":"reasoning.text","text":"Inspect"}],"tool_calls":[{"index":0,"id":"call-a","type":"function","function":{"name":"inspect","arguments":"{\\"path\\":\\"src\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        : 'data: {"choices":[{"delta":{"content":"Found it."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(event, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const history = [{ role: 'user', content: 'Inspect src' }];
    const options = { modelId: 'groq/openai/gpt-oss-120b', history, tools: [tool], key: 'groq-secret', sessionId: 'task-g', signal: signal() };
    const first = await request(options);
    assert.equal(first.calls[0].name, 'inspect');
    assert.deepEqual(JSON.parse(first.calls[0].args), { path: 'src' });
    appendResult(first.route, history, first, [{ id: first.calls[0].id, text: 'Inspection complete.' }]);
    const second = await request(options);
    assert.equal(second.text, 'Found it.');
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer groq-secret');
    assert.equal(calls[0].body.model, 'openai/gpt-oss-120b');
    assert.equal(calls[1].body.messages.at(-1).role, 'tool');
    const sentAssistant = calls[1].body.messages.find(message => message.role === 'assistant');
    assert.equal(Object.hasOwn(sentAssistant, 'reasoning_content'), false);
    assert.equal(Object.hasOwn(sentAssistant, 'reasoning_details'), false);
    assert.equal(history.find(message => message.role === 'assistant').reasoning_content, 'Inspect the source.', 'provider formatting must not erase recorded reasoning');
  } finally { global.fetch = originalFetch; }
});

test('array-shaped Google errors retain provider diagnostics without leaking keys', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json([{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unsupported thinking level; key google-fixture-secret' } }], { status: 400 });
    await assert.rejects(request({ modelId: 'google/gemini-3.8-flash', history: [], tools: [], key: 'google-fixture-secret', signal: signal() }), error => {
      assert.equal(error.status, 400); assert.match(error.message, /Unsupported thinking level/); assert.doesNotMatch(error.message, /google-fixture-secret/); return true;
    });
  } finally { global.fetch = original; }
});

test('Routeway streamed errors retain safe diagnostics and apply quota cooldown metadata', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response(
      `data: ${JSON.stringify({ error: { message: 'Unable to process your request right now.', status_code: 429, code: 'rate_limit_exceeded', id: 'rw-fixture-123' } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream', 'retry-after': '75' } },
    );
    await assert.rejects(request({
      modelId: 'routeway/gemma-4-26b-a4b-it-luminous:free', history: [{ role: 'user', content: 'Say OK' }],
      tools: [], key: 'routeway-fixture-secret', signal: signal(),
    }), error => {
      assert.match(error.message, /Routeway stream error \(HTTP 429\) \[rate_limit_exceeded\]/);
      assert.match(error.message, /Unable to process your request right now/);
      assert.match(error.message, /request ID: rw-fixture-123/);
      assert.equal(error.status, 429);
      assert.equal(error.statusCode, 429);
      assert.equal(error.providerCode, 'rate_limit_exceeded');
      assert.equal(error.requestId, 'rw-fixture-123');
      assert.equal(error.retryAfterMs, 75000);
      assert.equal(error.stopKeyRotation, true);
      assert.equal(error.responseStarted, true);
      assert.equal(error.noRetry, true);
      assert.doesNotMatch(error.message, /routeway-fixture-secret/);
      return true;
    });
  } finally { global.fetch = original; }
});

test('Gemini streamed tool signatures survive argument chunks and the tool-result request', async () => {
  const original = global.fetch;
  let count = 0;
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (++count === 1) {
        const packets = [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'sig-call', function: { name: 'inspect', arguments: '{"path":' }, extra_content: { google: { thought_signature: 'opaque-fixture-signature' } } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"src"}' } }] }, finish_reason: 'tool_calls' }] },
        ];
        return new Response(packets.map(packet => `data: ${JSON.stringify(packet)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
      }
      const assistant = body.messages.find(message => message.role === 'assistant');
      assert.equal(assistant.tool_calls[0].extra_content.google.thought_signature, 'opaque-fixture-signature');
      assert.equal(assistant.tool_calls[0].function.arguments, '{"path":"src"}');
      return Response.json({ choices: [{ message: { content: 'Checked.' } }] });
    };
    const history = [{ role: 'user', content: 'Inspect src' }];
    const options = { modelId: 'google/gemini-3.8-flash', key: 'google-fixture', tools: [tool], variant: 'low', history, signal: signal() };
    const answer = await request(options);
    appendResult(answer.route, history, answer, [{ id: 'sig-call', text: 'Observed source.' }]);
    assert.equal((await request(options)).text, 'Checked.');
  } finally { global.fetch = original; }
});

test('provider timeouts stay distinct from user cancellation before and during streams', async () => {
  const original = global.fetch;
  try {
    const options = controller => ({ modelId: 'google/gemini-3.8-flash', history: [], tools: [], key: 'fixture', signal: controller.signal });
    const before = new AbortController();
    global.fetch = async () => { before.abort(new DOMException('Deadline expired', 'TimeoutError')); throw before.signal.reason; };
    await assert.rejects(request(options(before)), /Model request timed out/);
    const during = new AbortController();
    global.fetch = async () => new Response(new ReadableStream({ start(controller) { during.abort(new DOMException('Deadline expired', 'TimeoutError')); controller.error(during.signal.reason); } }), { headers: { 'content-type': 'text/event-stream' } });
    await assert.rejects(request(options(during)), error => { assert.match(error.message, /Model request timed out/); assert.equal(error.responseStarted, true); return true; });
  } finally { global.fetch = original; }
});

test('saved provider credentials reach direct key checks through the actual engine', async () => {
  const { createAgentEngine } = require('../electron/agent/engine.cjs');
  const original = global.fetch;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-saved-api-check-'));
  const keys = { google: 'google-saved-fixture', groq: 'groq-saved-fixture', cerebras: 'cerebras-saved-fixture', nara: 'nara-saved-fixture', routeway: 'routeway-saved-fixture', requesty: 'requesty-saved-fixture' };
  let engine;
  try {
    const sent = [];
    global.fetch = async (url, options) => { sent.push({url,headers:options.headers}); return Response.json({ data: [] }); };
    engine = createAgentEngine({ getPath: () => root }, { getKey: tier => keys[tier] ?? '' }, () => {}, null);
    for (const [name, tier] of [['Google Gemini','google'],['Groq','groq'],['Cerebras','cerebras'],['Nara Router','nara']]) {
      const result = await engine.run({ taskId: 'saved-'+tier, requestId: 'check-'+tier, modelId: 'groq/openai/gpt-oss-120b', accessMode: 'Controlled', messages: [{ role: 'user', content: `Check my ${name} API key` }] });
      assert.match(result.text, /key accepted/);
      assert.equal(sent.at(-1).headers[tier === 'google' ? 'x-goog-api-key' : 'Authorization'], tier === 'google' ? keys[tier] : `Bearer ${keys[tier]}`);
      assert.ok(!result.text.includes(keys[tier]));
    }
    const requesty = await engine.run({ taskId: 'saved-requesty', requestId: 'check-requesty', modelId: 'groq/openai/gpt-oss-120b', accessMode: 'Controlled', messages: [{ role: 'user', content: 'Check my Requesty API key' }] });
    assert.match(requesty.text, /key accepted/);
    assert.equal(sent.at(-1).url, 'https://router.requesty.ai/v1/models');
    assert.equal(sent.at(-1).headers.Authorization, `Bearer ${keys.requesty}`);
    const count = sent.length;
    const routeway = await engine.run({ taskId: 'saved-routeway', requestId: 'check-routeway', modelId: 'groq/openai/gpt-oss-120b', accessMode: 'Controlled', messages: [{ role: 'user', content: 'Check my Routeway API key' }] });
    assert.match(routeway.text, /listings are public/); assert.equal(sent.length, count, 'a public catalog must not be used as an authentication proof');
  } finally { engine?.shutdown(); global.fetch = original; fs.rmSync(root, {recursive:true,force:true}); }
});

test('provider errors and cancellation surface without switching models or leaking keys', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer secret-for-error');
      return Response.json({ error: { message: 'rate limit reached: secret-for-error' } }, { status: 429 });
    };
    await assert.rejects(request({ modelId: 'cerebras/gpt-oss-120b', history: [{ role: 'user', content: 'hi' }], tools: [], key: 'secret-for-error', signal: signal() }), error => {
      assert.match(error.message, /HTTP 429/); assert.ok(!error.message.includes('secret-for-error')); return true;
    });
    const controller = new AbortController();
    global.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    const run = request({ modelId: 'google/gemini-3.8-flash', history: [{ role: 'user', content: 'hi' }], tools: [], key: 'google-key', signal: controller.signal });
    controller.abort();
    await assert.rejects(run, /Task cancelled/);
  } finally { global.fetch = originalFetch; }
});
