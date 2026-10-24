// Real bundled runtime + local inference fixture: no remote model quota.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { createOpenCodeHeadless, unusedPort } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, getOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-readiness-native-'));
const runtime = createOpenCodeHeadless(root);
let prompts = 0;
const server = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); prompts++;
  assert.equal(body.model, 'readiness-fixture');
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const base = { id: 'readiness-response', object: 'chat.completion.chunk', created: 1, model: body.model };
  for (const choice of [{ index: 0, delta: { role: 'assistant', content: 'READY' }, finish_reason: null }, { index: 0, delta: {}, finish_reason: 'stop' }]) {
    response.write('data: ' + JSON.stringify({ ...base, choices: [choice] }) + '\n\n');
  }
  response.end('data: [DONE]\n\n');
});
(async () => {
  const port = await unusedPort(); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  await runtime.exclusive(AbortSignal.timeout(90000), async ({ api }) => {
    await api('/global/config', { method: 'PATCH', body: { provider: { opencode: {
      options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'local-fixture-only' },
      models: { 'readiness-fixture': { name: 'Readiness fixture', tool_call: true, reasoning: false, cost: { input: 0, output: 0 }, limit: { context: 32000, output: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } } },
    } } } });
  });
  const models = ['missing-readiness-fixture', 'readiness-fixture'].map(id => ({ id: 'opencode/' + id, name: id, route: 'chat', input: ['text'], variants: [] }));
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ source: 'configured-providers-v1', runtimeVersion: runtime.status().runtimeVersion, updatedAt: Date.now(), models }));
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  await assert.rejects(runOpenCodeSession({ taskId: 'native-readiness', modelId: models[0].id, parts: [{ type: 'text', text: 'Do not run this.' }], timeoutMs: 30000 }), /unavailable in this OpenCode worker/);
  assert.equal(prompts, 0, 'missing model must fail before inference');
  assert.deepEqual(getOpenCodeCatalog().models.map(m => m.id), [models[1].id]);
  // Restart our fixture worker to exercise real cold process initialization.
  const retiredPid = runtime.status().pid;
  runtime.retireIdle(); assert.equal(runtime.status().running, false);
  // Windows taskkill is asynchronous; wait for our fixture's process to exit
  // before testing a genuinely cold start against its retained database.
  const stoppedBy = Date.now() + 10000;
  for (;;) {
    try { process.kill(retiredPid, 0); }
    catch (error) { if (error.code === 'ESRCH') break; throw error; }
    if (Date.now() >= stoppedBy) throw new Error('Fixture worker did not finish its requested shutdown.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const began = performance.now(), responseBudgetMs = 30000;
  const result = await runOpenCodeSession({ taskId: 'native-readiness', modelId: models[1].id,
    readOnly: true, conversation: true, timeoutMs: responseBudgetMs, preparationTimeoutMs: 90000,
    parts: [{ type: 'text', text: 'Reply READY. Do not use tools.' }], onPermission: async () => false });
  assert.equal(result.text.trim(), 'READY'); assert.equal(prompts, 1);
  console.log(JSON.stringify({ passed: true, missingModelBlockedBeforeInference: true, pickerInvalidated: true,
    coldConversationMs: Math.round(performance.now() - began), responseBudgetMs, prompts }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  runtime.shutdown(); server.closeAllConnections(); server.close();
  if (path.dirname(root) !== os.tmpdir()) throw new Error('Invalid native fixture cleanup path.');
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
});
