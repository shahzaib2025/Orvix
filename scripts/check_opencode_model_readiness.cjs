const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { resolveOpenCodeModel, isModelNotFound } = require('../electron/agent/opencode-model-readiness.cjs');
const { configureOpenCodeCatalog, getOpenCodeCatalog, refreshOpenCodeCatalog, markOpenCodeModelUnavailable } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const id = 'opencode/fixture-free';
const missing = () => new Error('Model not found: ' + id + '. Did you mean: paid-fixture?');
const nativeModel = { id: 'fixture-free', cost: { input: 0, output: 0 }, capabilities: { input: { text: true }, output: { text: true }, toolcall: true } };

test('readiness reloads a stale directory instance once and preserves the exact selected model', async () => {
  const calls = []; let fresh = false;
  const model = await resolveOpenCodeModel(async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (endpoint === '/session/status') return {};
    if (endpoint === '/instance/dispose') { fresh = true; return true; }
    return { providers: [{ id: 'opencode', models: fresh ? { 'fixture-free': nativeModel } : {} }] };
  }, 'C:\\Work', id);
  assert.equal(model.id, 'fixture-free');
  assert.equal(calls.length, 4);
  assert.equal(calls[0].endpoint, '/config/providers');
  assert.equal(calls[0].endpoint, calls[3].endpoint);
  assert.ok(calls.every(item => item.options.directory === 'C:\\Work'));
  assert.equal(calls[2].options.method, 'POST');
});
test('readiness does not reload a resumed session or retry authentication, rate-limit or transport failures', async () => {
  let calls = 0;
  await assert.rejects(resolveOpenCodeModel(async () => { calls++; throw missing(); }, 'C:\\Work', id, undefined, { refresh: false }), error => error.modelUnavailable === true);
  assert.equal(calls, 1);
  for (const message of ['HTTP 403', 'HTTP 429', 'fetch failed', 'Model not found: opencode/other-free', 'Model not found: opencode/fixture-free.v2']) {
    calls = 0;
    await assert.rejects(resolveOpenCodeModel(async () => { calls++; throw Error(message); }, 'C:\\Work', id), error => error.message === message);
    assert.equal(calls, 1);
  }
  assert.equal(isModelNotFound(id, missing()), true);
  assert.equal(isModelNotFound(id, Error('Model not found: opencode/fixture-free.v2')), false);
});
test('cancelling readiness prevents instance refresh and malformed provider metadata is not model retirement', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(resolveOpenCodeModel(async () => { calls++; return []; }, 'C:\\Work', id, controller.signal));
  assert.equal(calls, 0);
  await assert.rejects(resolveOpenCodeModel(async () => ({}), 'C:\\Work', id), /invalid configured-provider metadata/);
});
test('readiness never disposes an instance with active sessions and never uses a now-paid or tool-incapable model', async () => {
  const calls = [];
  await assert.rejects(resolveOpenCodeModel(async endpoint => {
    calls.push(endpoint);
    return endpoint === '/session/status' ? { running: { type: 'busy' } } : { providers: [] };
  }, 'C:\\Work', id), error => error.modelUnavailable === true);
  assert.deepEqual(calls, ['/config/providers', '/session/status']);
  for (const model of [{ ...nativeModel, cost: { input: 1, output: 0 } }, { ...nativeModel, capabilities: { ...nativeModel.capabilities, toolcall: false } }]) {
    let count = 0;
    await assert.rejects(resolveOpenCodeModel(async endpoint => { count++; assert.equal(endpoint, '/config/providers'); return { providers: [{ id: 'opencode', models: { 'fixture-free': model } }] }; }, 'C:\\Work', id), /not a verified free/);
    assert.equal(count, 1);
  }
});
test('unresolvable selection is blocked before sessions or execution tools and the catalog updates without permanently retiring it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-model-readiness-'));
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; fs.rmSync(root, { recursive: true, force: true }); });
  const model = { id, name: 'Fixture', route: 'chat', input: ['text'], variants: [] };
  const available = { ...model, id: 'opencode/available-free' };
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [model, available] }));
  const calls = []; let notifications = 0;
  const api = async (endpoint) => { calls.push(endpoint); if (endpoint === '/instance/dispose') return true; if (endpoint === '/session/status') return {}; return { providers: [] }; };
  const runtime = { status: () => ({}), exclusive: async (_signal, callback) => callback({ workdir: root, api,
    verifyModel: (directory, selected, signal, options) => resolveOpenCodeModel(api, directory, selected, signal, options) }) };
  configureOpenCodeCatalog(root, runtime, () => notifications++); configureOpenCodeModel(runtime);
  await assert.rejects(runOpenCodeSession({ taskId: 'task', modelId: id, parts: [], timeoutMs: 1000 }), /unavailable in this OpenCode worker/);
  assert.equal(calls.some(endpoint => endpoint === '/session' || /prompt|message/.test(endpoint)), false);
  assert.deepEqual(getOpenCodeCatalog().models.map(item => item.id), [available.id]);
  assert.equal(notifications, 1);
  assert.equal(markOpenCodeModelUnavailable(available.id, new Error('HTTP 403')), false);
  configureOpenCodeCatalog(root, runtime);
  assert.deepEqual(getOpenCodeCatalog().models.map(item => item.id), [available.id]);
  // A later verified explicit refresh can restore the same exact model.
  const ids = ['fixture-free', 'available-free'];
  const providers = { all: [{ id: 'opencode', models: Object.fromEntries(ids.map(id => [id, { id, name: id, cost: { input: 0, output: 0 }, capabilities: { input: { text: true }, output: { text: true }, toolcall: true } }])) }] };
  runtime.exclusive = async (_signal, callback) => callback({ api: async endpoint => { assert.equal(endpoint, '/config/providers'); return providers; } });
  global.fetch = async () => new Response(JSON.stringify({ data: ids.map(id => ({ id })) }));
  await refreshOpenCodeCatalog(true);
  assert.equal(getOpenCodeCatalog().models.length, 2);
  for (const model of getOpenCodeCatalog().models) markOpenCodeModelUnavailable(model.id, { modelUnavailable: true, modelId: model.id });
  configureOpenCodeCatalog(root, runtime);
  assert.equal(getOpenCodeCatalog().models.length, 0, 'an empty verified catalog must not restore unverified fallback models after restart');
});

test('discovery uses configured generation providers rather than catalog-only model metadata', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-configured-catalog-')), previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; fs.rmSync(root, { recursive: true, force: true }); });
  const configured = { providers: [{ id: 'opencode', models: { 'fixture-free': nativeModel } }] };
  const endpoints = [];
  configureOpenCodeCatalog(root, { status: () => ({}), exclusive: async (_signal, callback) => callback({ api: async endpoint => {
    endpoints.push(endpoint);
    if (endpoint !== '/config/providers') throw new Error('Unfiltered catalog endpoint must not be used');
    return configured;
  } }) });
  global.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'fixture-free' }, { id: 'catalog-only-free' }] }));
  const result = await refreshOpenCodeCatalog(true);
  assert.equal(result.error, '');
  assert.deepEqual(result.models.map(model => model.id), [id]);
  assert.deepEqual(endpoints, ['/config/providers']);
  assert.ok(result.excluded.some(model => model.id === 'opencode/catalog-only-free'));
});
