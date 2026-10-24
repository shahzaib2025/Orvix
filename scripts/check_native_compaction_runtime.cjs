// Actual bundled OpenCode; loopback inference only. No provider quota or user project.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const root = path.resolve(__dirname, '..', 'scratch', 'native-compaction-runtime-' + Date.now());
fs.mkdirSync(root, { recursive: true });
const file = path.join(root, 'probe.txt'); fs.writeFileSync(file, 'COMPACTION_READ_ONCE\n');
const runtime = createOpenCodeHeadless(root, { contextLimitTokens: 32000 }), captured = [], sessions = [], notices = [], checkpoints = [];
let readPermissions = 0;
const server = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); captured.push({ toolCount: body.tools?.length ?? 0, promptCharacters: JSON.stringify(body.messages).length });
  if (captured.length === 2) {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { type: 'FreeTierError', message: "OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building." } })); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = { id: 'fixture-' + captured.length, object: 'chat.completion.chunk', created: 1, model: body.model };
  const first = captured.length === 1;
  const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read-once', type: 'function', function: { name: 'read', arguments: JSON.stringify({ filePath: file }) } }] }
    : { role: 'assistant', content: 'COMPACTION_RECOVERY_VERIFIED' };
  response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
  response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: first ? 40000 : 10, completion_tokens: 5, total_tokens: first ? 40005 : 15 } }) + '\n\n');
  response.end('data: [DONE]\n\n');
});
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await runtime.exclusive(AbortSignal.timeout(90000), async ({ api }) => {
      await api('/global/config', { method: 'PATCH', body: { provider: { opencode: { options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'loopback-only' }, models: {
        'compaction-fixture-free': { name: 'Compaction fixture', tool_call: true, reasoning: false, cost: { input: 0, output: 0 }, limit: { context: 32000, output: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } }
      } } } } });
    });
    fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/compaction-fixture-free', name: 'Compaction fixture', route: 'chat', variants: [], input: ['text'] }] }));
    const lane = { status: () => ({}), exclusive: runtime.exclusive };
    configureOpenCodeCatalog(root, lane); configureOpenCodeModel(lane);
    const reply = await runOpenCodeSession({ taskId: 'compaction-runtime', modelId: 'opencode/compaction-fixture-free', directory: root,
      signal: AbortSignal.timeout(90000), timeoutMs: 80000, parts: [{ type: 'text', text: 'Read probe.txt once and report the marker. Do not edit anything.' }],
      onPermission: request => { assert.equal(request.permission, 'read'); readPermissions++; return true; },
      onSession: value => sessions.push(value.sessionID), onRecovery: value => notices.push(value), onCheckpoint: value => checkpoints.push(value),
      onCompactionContext: () => 'Current user request: report the observed probe marker. Read only. Do not repeat the completed read.' });
    assert.equal(reply.text, 'COMPACTION_RECOVERY_VERIFIED');
    assert.equal(sessions.length, 2); assert.equal(new Set(sessions).size, 2);
    assert.equal(captured.length, 3); assert.equal(captured[1].toolCount, 0);
    assert.equal(readPermissions, 1); assert.equal(notices.length, 1);
    assert.ok(checkpoints.some(value => value.continuity?.sourceSessionID === sessions[0]));
    assert.equal(fs.readFileSync(file, 'utf8'), 'COMPACTION_READ_ONCE\n');
    const result = { passed: true, scope: 'Bundled native runtime plus loopback inference, not real provider validation', inferenceRequests: captured, nativeSessions: sessions, readPermissions, notices, usage: reply.usage };
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { runtime.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
