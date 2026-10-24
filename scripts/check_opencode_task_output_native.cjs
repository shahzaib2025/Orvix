// Real bundled OpenCode tools, with a scripted loopback model and HTML source.
// No provider account or paid model request is used by this fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-native-output-'));
  const taskId = 'native-output', modelId = 'opencode/fixture-free';
  const workerRoot = path.join(root, 'opencode-workers', crypto.createHash('sha256').update(taskId).digest('hex'), 'opencode-headless');
  const workdir = path.join(workerRoot, 'workspace'), outputRoot = path.join(workerRoot, 'data', 'opencode', 'tool-output');
  const events = [], diagnostics = []; let step = 0, savedOutput, sourceFetches = 0, runtime, engine, timeout;
  let fixtureFailure;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/page') {
        sourceFetches++;
        response.writeHead(200, { 'content-type': 'text/html' });
        return response.end('<!doctype html><main>' + 'x'.repeat(120000) + '<h1>Native output recovery heading</h1><section>Details</section></main>');
      }
      assert.match(request.url, /\/chat\/completions$/);
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const names = (body.tools ?? []).map(tool => tool.function?.name);
      const current = step++;
      let tool, args, text;
      if (current === 0) { tool = 'read'; args = { filePath: workdir }; }
      else if (current === 1) { tool = 'webfetch'; args = { url: `http://127.0.0.1:${server.address().port}/page`, format: 'html' }; }
      else if (current === 2) {
        savedOutput = path.join(outputRoot, fs.readdirSync(outputRoot).find(file => file.startsWith('tool_')));
        tool = 'bash'; args = { command: `(Get-Item '${savedOutput}').Length`, description: 'Check the saved HTML output size' };
      } else if (current === 3) { tool = 'grep'; args = { path: outputRoot, pattern: '<h1>' }; }
      else if (current === 4) { tool = 'read'; args = { filePath: savedOutput, limit: 1 }; }
      else if (current === 5) { tool = 'orvix_visual_read_tool_output'; args = { filePath: savedOutput, search: '<h1>', limit: 500 }; }
      else if (current === 6) text = 'The captured homepage heading is Native output recovery heading.';
      else throw new Error('Unexpected extra model generation: ' + current);
      if (tool) assert.ok(names.includes(tool), 'Bundled runtime must advertise ' + tool);
      const id = 'chatcmpl-fixture-' + current;
      const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + current, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: text };
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fixture-free', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
      response.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fixture-free', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) + '\n\n');
      response.end('data: [DONE]\n\n');
    } catch (error) {
      fixtureFailure = error; response.writeHead(500); response.end('Fixture failed');
      engine?.cancel(taskId);
    }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
    runtime = createOpenCodeWorkers(root, { create: directory => createOpenCodeHeadless(directory, { idleMs: 3000,
      spawn(binary, args, options) {
        const config = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
        config.provider = { opencode: { npm: '@ai-sdk/openai-compatible', options: { baseURL, apiKey: 'local-fixture' }, models: {
          'fixture-free': { name: 'Local fixture', toolcall: true, limit: { context: 128000, output: 8000 }, modalities: { input: ['text'], output: ['text'] } },
        } } };
        options.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
        options.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
        return spawn(binary, args, options);
      },
    }) });
    fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ source: 'configured-providers-v1', updatedAt: Date.now(), runtimeVersion: require('opencode-ai/package.json').version,
      models: [{ id: modelId, name: 'Local fixture', route: 'chat', variants: [], input: ['text'] }] }));
    configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
    engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => events.push(event), null, {
      runNativeSession: options => runOpenCodeSession({ ...options,
        permissionRecovery: () => { const recovery = options.permissionRecovery(); diagnostics.push({ recovery }); return recovery; },
        onEvent: event => {
          if (event.type.startsWith('permission.')) diagnostics.push({ permission: event.properties });
          if (event.properties?.part?.state?.metadata?.outputPath) diagnostics.push({ outputPath: event.properties.part.state.metadata.outputPath, sessionID: event.properties.part.sessionID });
          return options.onEvent(event);
        },
      }),
    });
    timeout = setTimeout(() => engine.cancel(taskId), 90000);
    const result = await engine.run({ taskId, requestId: 'native-turn', modelId, accessMode: 'Full access', accessModeVersion: 2, designProfile: 'none',
      messages: [{ role: 'user', content: 'Inspect the homepage HTML and report its heading. Use the captured result; do not edit local files.' }] });
    if (fixtureFailure) throw fixtureFailure;
    assert.equal(step, 7, JSON.stringify({ reply: result.text, diagnostics, tools: events.filter(event => event.type === 'tool' && event.phase === 'completed').map(event => ({ name: event.name, failed: event.failed, output: event.output?.slice(0, 300) })) })); assert.equal(sourceFetches, 1);
    const done = events.filter(event => event.type === 'tool' && event.phase === 'completed');
    assert.deepEqual(done.filter(event => event.name === 'read').map(event => event.failed), [false, false], 'neutral directory listing and exact saved-output read succeed without opening a workspace');
    assert.equal(done.find(event => event.name === 'webfetch').failed, false);
    assert.equal(done.find(event => event.name === 'bash').failed, true);
    assert.ok(done.some(event => event.failed && /grep|external_directory/.test(event.name)));
    const read = done.find(event => event.name === 'orvix_visual_read_tool_output');
    assert.ok(read && !read.failed); assert.match(read.output, /Native output recovery heading/);
    assert.match(result.text, /Native output recovery heading/);
    assert.deepEqual(engine.workspaces.list(taskId), []);
    console.log('PASS: bundled OpenCode listed its neutral workspace, fetched long HTML once, retained blocked shell/directory-search decisions, and recovered through the session output reader. No private folder became a project.');
  } finally {
    clearTimeout(timeout); engine?.shutdown(); runtime?.shutdown();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
