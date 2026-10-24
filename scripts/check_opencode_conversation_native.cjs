// Real bundled OpenCode with a loopback inference fixture. No provider quota.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createOpenCodeHeadless, unusedPort } = require('../electron/agent/opencode-headless.cjs');
const { instructionsFor } = require('../electron/agent/model-client.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-conversation-native-'));
let debugTrace = '';
const trace = process.argv.includes('--trace');
const runtime = createOpenCodeHeadless(root, trace ? { spawn(file, args, options) {
  const child = require('node:child_process').spawn(file, ['--print-logs', '--log-level', 'DEBUG', ...args], options);
  const retain = chunk => { debugTrace += String(chunk).replaceAll(options.env.OPENCODE_SERVER_PASSWORD, '[redacted]'); };
  child.stdout?.on('data', retain); child.stderr?.on('data', retain);
  return child;
} } : {});
const captured = [];
let submittedAt = 0;
let toolsPreparationMs = null;
let taskPreparationMs = null;
const server = http.createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  captured.push({ systemCharacters: JSON.stringify(body.messages.filter(message => message.role === 'system')).length,
    dispatchMs: Math.round(performance.now() - submittedAt),
    promptCharacters: JSON.stringify(body.messages).length, tools: body.tools?.map(tool => tool.function?.name) ?? [] });
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const base = { id: 'conversation-fixture', object: 'chat.completion.chunk', created: 1, model: body.model };
  response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi there.' }, finish_reason: null }] }) + '\n\n');
  response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
  response.end('data: [DONE]\n\n');
});
(async () => {
  const port = await unusedPort();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  await runtime.exclusive(AbortSignal.timeout(90000), async ({ api }) => {
    await api('/global/config', { method: 'PATCH', body: { provider: { opencode: {
      options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'loopback-fixture-only' },
      models: { 'conversation-fixture': { name: 'Conversation fixture', tool_call: true, reasoning: false,
        cost: { input: 0, output: 0 }, limit: { context: 32000, output: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } } },
    } } } });
  });
  if (process.argv.includes('--prepare-task')) {
    const began = performance.now();
    await runtime.prepare(undefined, AbortSignal.timeout(60000), 'opencode/conversation-fixture');
    taskPreparationMs = Math.round(performance.now() - began);
    assert.equal(runtime.status().prepared, true);
    assert.equal(runtime.status().preparedModelId, 'opencode/conversation-fixture');
    assert.equal(captured.length, 0, 'task preparation must not send any model requests');
    await runtime.prepare(undefined, AbortSignal.timeout(60000), 'opencode/conversation-fixture');
    assert.equal(captured.length, 0, 'cached preparation must not consume model quota');
  }
  await runtime.exclusive(AbortSignal.timeout(90000), async ({ api }) => {
    const agents = await api('/agent');
    const conversation = agents.find(agent => agent.name === 'orvix_conversation');
    assert.ok(conversation);
    assert.ok(conversation.permission.some(rule => rule.permission === '*' && rule.action === 'ask'));
    if (process.argv.includes('--prepare-location')) {
      const started = performance.now();
      const references = await api('/api/reference');
      assert.ok(Array.isArray(references.data));
      assert.equal(captured.length, 0, 'location preparation must not submit a model request');
      toolsPreparationMs = Math.round(performance.now() - started);
    }
    if (process.argv.includes('--prepare-tools')) {
      const started = performance.now();
      const tools = await api('/experimental/tool?provider=opencode&model=conversation-fixture');
      assert.ok(Array.isArray(tools));
      assert.equal(captured.length, 0, 'tool preparation must not submit a model request');
      toolsPreparationMs = Math.round(performance.now() - started);
    }
    for (const agent of ['build', 'orvix_conversation']) {
      const session = await api('/session', { method: 'POST', body: { permission: [{ permission: '*', pattern: '*', action: 'ask' }] } });
      try {
        submittedAt = performance.now();
        await api(`/session/${session.id}/prompt_async`, { method: 'POST', body: { agent, model: { providerID: 'opencode', modelID: 'conversation-fixture' },
          parts: [{ type: 'text', text: instructionsFor(null, 'Plan', 'conversation') + '\nConversation:\n' + JSON.stringify([{ role: 'user', content: 'Hi' }]) }] } });
        let reply;
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          reply = (await api(`/session/${session.id}/message`)).findLast(message => message.info?.role === 'assistant');
          if (reply?.info?.time?.completed || reply?.info?.error) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(reply?.info?.error, undefined, JSON.stringify(reply?.info?.error));
        assert.ok(reply?.parts?.some(part => part.type === 'text' && part.text === 'Hi there.'));
      } finally { await api(`/session/${session.id}`, { method: 'DELETE' }); }
    }
  });
  assert.equal(captured.length, 2);
  assert.ok(captured[1].systemCharacters < captured[0].systemCharacters / 2, 'conversation must avoid the large default coding instructions');
  assert.deepEqual(captured[1].tools, captured[0].tools, 'retain the real native tool definitions and permission gates');
  console.log(JSON.stringify({ passed: true, buildSystemCharacters: captured[0].systemCharacters, conversationSystemCharacters: captured[1].systemCharacters,
    buildPromptCharacters: captured[0].promptCharacters, conversationPromptCharacters: captured[1].promptCharacters, toolCount: captured[1].tools.length,
    buildDispatchMs: captured[0].dispatchMs, conversationDispatchMs: captured[1].dispatchMs, toolsPreparationMs, taskPreparationMs }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; })
  .finally(async () => {
    if (trace) {
      const output = path.resolve(__dirname, '../scratch/opencode-validation/native-initialization-trace.log');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, debugTrace);
    }
    runtime.shutdown(); server.closeAllConnections(); server.close();
    if (path.dirname(root) !== os.tmpdir()) throw new Error('Invalid native-fixture cleanup path.');
    try { await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  });
