// Exercise the bundled runtime against a loopback fixture; no provider account,
// private application state, or real model inference is used by this check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-temperature-native-'));
const captured = [], checks = [];
const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  let payload;
  try { payload = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
  captured.push({ model: payload.model, temperature: payload.temperature, path: request.url });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = { id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: payload.model };
  response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'TEMPERATURE_FIXTURE_OK' }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}\n\n`);
  response.end('data: [DONE]\n\n');
});
const runtime = createOpenCodeHeadless(root);
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  await runtime.exclusive(AbortSignal.timeout(90000), async ({ api }) => {
    // Project config is deliberately disabled by Orvix; use this fixture's
    // isolated global config, never the user's OpenCode installation.
    await api('/global/config', { method: 'PATCH', body: {
      provider: { opencode: { options: { baseURL, apiKey: 'local-fixture-only' }, models: {
        'temperature-supported-fixture': { name: 'Temperature supported fixture', temperature: true, tool_call: true, reasoning: false,
          cost: { input: 0, output: 0 }, limit: { context: 32000, output: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } },
        'temperature-unsupported-fixture': { name: 'Temperature unsupported fixture', temperature: false, tool_call: true, reasoning: false,
          cost: { input: 0, output: 0 }, limit: { context: 32000, output: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } },
      } } },
    } });
    const agents = await api('/agent');
    assert.equal(agents.find(agent => agent.name === 'build').temperature, 0.7);
    checks.push('Bundled runtime resolves build temperature to 0.7');
    for (const supported of [true, false]) {
      const modelID = `temperature-${supported ? 'supported' : 'unsupported'}-fixture`;
      const session = await api('/session', { method: 'POST', body: {} });
      try {
        await api(`/session/${session.id}/prompt_async`, { method: 'POST', timeoutMs: 15000, body: {
          model: { providerID: 'opencode', modelID }, agent: 'build', parts: [{ type: 'text', text: 'Reply with the fixture marker. Do not use tools.' }],
        } });
        let reply;
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const messages = await api(`/session/${session.id}/message`);
          reply = messages.findLast(message => message.info?.role === 'assistant');
          if (reply?.info?.time?.completed || reply?.info?.error) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(reply, 'Expected an assistant fixture response');
        assert.equal(reply.info?.error, undefined, JSON.stringify(reply.info?.error));
        assert.ok(reply.parts.some(part => part.type === 'text' && part.text.includes('TEMPERATURE_FIXTURE_OK')));
        const sent = captured.find(item => item.model === modelID);
        assert.ok(sent, 'Expected request to loopback provider');
        assert.equal(sent.temperature, supported ? 0.7 : undefined);
        checks.push(supported ? 'Supported model sends temperature 0.7 in actual provider JSON' : 'Unsupported model omits temperature from actual provider JSON');
      } finally { await api(`/session/${session.id}`, { method: 'DELETE' }); }
    }
  });
  console.log(JSON.stringify({ passed: true, checks, captured }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; })
  .finally(() => { runtime.shutdown(); server.closeAllConnections(); server.close(); });
