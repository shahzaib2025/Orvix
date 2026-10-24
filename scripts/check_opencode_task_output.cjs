const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createTaskOutputAccess } = require('../electron/agent/opencode-task-output.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-task-output-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  function worker(name) {
    const base = path.join(root, 'opencode-workers', name, 'opencode-headless');
    const workdir = path.join(base, 'workspace'), outputRoot = path.join(base, 'data', 'opencode', 'tool-output');
    fs.mkdirSync(workdir, { recursive: true }); fs.mkdirSync(outputRoot, { recursive: true });
    return { workdir, outputRoot, file: path.join(outputRoot, 'tool_saved_html') };
  }
  return { root, worker };
}
const outputEvent = (file, sessionID = 'session-a', status = 'completed') => ({ type: 'message.part.updated', properties: {
  part: { type: 'tool', tool: 'webfetch', callID: 'fetch', messageID: 'assistant', sessionID,
    state: { status, input: { url: 'https://example.invalid' }, output: 'Saved full output.', metadata: { truncated: true, outputPath: file } } },
} });

test('saved minified HTML can be searched and paged without a shell or project workspace', t => {
  const { worker } = fixture(t), own = worker('a');
  const html = '<!doctype html><main>' + 'x'.repeat(22000) + '<h1>Recovered heading</h1><section>Details</section></main>';
  fs.writeFileSync(own.file, html);
  const access = createTaskOutputAccess(); access.begin('session-a', own.workdir);
  assert.equal(access.canListRuntime(own.workdir), true);
  assert.equal(access.canListRuntime(path.dirname(own.workdir)), false);
  assert.equal(access.canTraverse(own.outputRoot), false);
  assert.throws(() => access.read({ filePath: own.file }), /registered/);
  access.observe(outputEvent(own.file));
  assert.equal(access.read().outputs.length, 1);
  assert.equal(access.canTraverse(own.outputRoot), true);
  const found = access.read({ filePath: own.file, search: '<H1>', limit: 500 });
  assert.equal(found.searchFound, true); assert.match(found.text, /Recovered heading/);
  let text = '', offset = 0;
  do { const chunk = access.read({ filePath: own.file, offset, limit: 7999 }); text += chunk.text; offset = chunk.nextOffset; } while (offset !== null);
  assert.equal(text, html, 'character chunks retain the entire single-line document');
  access.observe({ type: 'message.part.updated', properties: { part: { type: 'tool', tool: 'grep', callID: 'search', sessionID: 'session-a', state: { status: 'running', input: { path: own.outputRoot, pattern: '<h1>' } } } } });
  assert.equal(access.recovery({ permission: 'grep', patterns: ['<h1>'], tool: { callID: 'search' } }, own.workdir).recoverable, true);
  assert.throws(() => access.read({ filePath: own.file, limit: 999999 }), /8000/);
  assert.deepEqual(access.read({ filePath: own.file, search: 'absent' }).searchFound, false);
  fs.appendFileSync(own.file, 'changed');
  access.observe(outputEvent(own.file));
  assert.equal(access.registered(own.file), null); assert.throws(() => access.read({ filePath: own.file }), /unchanged/);
});

test('unregistered records, another worker/session, failed tools and linked files remain private', t => {
  const { worker } = fixture(t), own = worker('a'), other = worker('b');
  fs.writeFileSync(own.file, 'own output'); fs.writeFileSync(other.file, 'other private output');
  const access = createTaskOutputAccess(); access.begin('session-a', own.workdir);
  access.observe(outputEvent(other.file)); access.observe(outputEvent(own.file, 'session-b'));
  access.observe(outputEvent(own.file, 'session-a', 'error'));
  assert.deepEqual(access.read().outputs, []);
  const linked = path.join(own.outputRoot, 'tool_link'); fs.linkSync(other.file, linked);
  access.observe(outputEvent(linked)); assert.equal(access.registered(linked), null);
  const record = path.join(own.outputRoot, 'opencode.db'); fs.writeFileSync(record, 'private database');
  access.observe(outputEvent(record)); assert.throws(() => access.read({ filePath: record }), /registered/);
  access.observe(outputEvent(own.file)); assert.ok(access.registered(own.file));
  access.begin('session-new', own.workdir); assert.deepEqual(access.read().outputs, []);
  access.observe(outputEvent(own.file, 'session-new'));
  const moved = own.outputRoot + '-retained'; fs.renameSync(own.outputRoot, moved);
  fs.symlinkSync(other.outputRoot, own.outputRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(access.canTraverse(own.outputRoot), false); assert.throws(() => access.read({ filePath: own.file }), /registered/);
});

for (const mode of ['Full access', 'Controlled', 'Plan']) test(`native ${mode} can inspect a large saved result without opening private workspaces`, async t => {
  const { root, worker } = fixture(t), own = worker('a');
  fs.writeFileSync(own.file, '<main>' + 'x'.repeat(23000) + '<h1>Output recovery heading</h1></main>');
  let engine, bridge, reads = 0;
  engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, () => {}, null, { runNativeSession: async options => {
    assert.equal(options.directory, null);
    assert.match(options.parts[0].text, /ask one focused question for the real project folder/);
    bridge = await options.visualTools({ acceptsImages: false, signal: options.signal, workdir: own.workdir });
    options.onSession({ sessionID: 'session-a', directory: own.workdir, workdir: own.workdir });
    assert.equal(await options.onPermission({ permission: 'read', patterns: [own.workdir] }, own.workdir), true);
    await options.onEvent({ type: 'message.updated', properties: { info: { id: 'assistant', role: 'assistant' } } });
    await options.onEvent(outputEvent(own.file));
    assert.equal(await options.onPermission({ permission: 'external_directory', patterns: [own.outputRoot + '/*'] }, own.workdir), true);
    assert.equal(await options.onPermission({ permission: 'read', patterns: [own.file] }, own.workdir), true);
    assert.deepEqual(engine.workspaces.list('task-output'), [], 'neither runtime directory is registered as a project');
    if (mode !== 'Plan') {
      assert.equal(await options.onPermission({ permission: 'bash', metadata: { command: `(Get-Item '${own.file}').Length` } }, own.workdir), false);
      const recovery = options.permissionRecovery();
      assert.equal(recovery.recoverable, true); assert.match(recovery.guidance, /read_tool_output/);
    }
    assert.equal(await options.onPermission({ permission: 'orvix_visual_read_tool_output' }, own.workdir), true);
    const invoke = async (method, params = {}) => {
      const response = await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++reads, method, params }) });
      return (await response.json()).result;
    };
    const listed = await invoke('tools/list'); assert.ok(listed.tools.some(tool => tool.name === 'read_tool_output'));
    if (mode === 'Plan') assert.deepEqual(listed.tools.map(tool => tool.name), ['read_tool_output']);
    const result = await invoke('tools/call', { name: 'read_tool_output', arguments: { filePath: own.file, search: '<h1>', limit: 500 } });
    assert.ok(!result.isError); assert.match(JSON.parse(result.content[0].text).text, /Output recovery heading/);
    const privateRead = await invoke('tools/call', { name: 'read_tool_output', arguments: { filePath: path.join(root, 'agent-memory', 'other.json') } });
    assert.equal(privateRead.isError, true);
    return { text: 'The captured homepage heading is Output recovery heading.', usage: null };
  } });
  t.after(async () => { await bridge?.close(); engine.shutdown(); });
  const result = await engine.run({ taskId: 'task-output', requestId: 'turn-output', modelId: 'opencode/mimo-v2.6-flash-free', accessMode: mode, accessModeVersion: 2,
    designProfile: 'none', messages: [{ role: 'user', content: 'Inspect the homepage structure from this website URL using its captured HTML.' }] });
  assert.match(result.text, /Output recovery heading/);
});

test('the real transport recovers a blocked output command through the reader without replaying the fetch', { timeout: 10000 }, async t => {
  const { root, worker } = fixture(t), own = worker('a');
  fs.writeFileSync(own.file, '<main>' + 'x'.repeat(24000) + '<h1>Transport recovery heading</h1></main>');
  const modelId = 'opencode/fixture-free';
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: modelId, name: 'Fixture', route: 'chat', variants: [], input: ['text'] }] }));
  let stream, bridgeConfig, prompts = 0, fetches = 0, readResult;
  const sentPrompts = [];
  const send = event => stream.enqueue(Buffer.from('data: ' + JSON.stringify(event) + '\n\n'));
  const message = (id, completed = false) => send({ type: 'message.updated', properties: { info: { id, role: 'assistant', sessionID: 'session-a', time: { created: id === 'first' ? 1 : 2, ...(completed ? { completed: 3 } : {}) } } } });
  const idle = () => send({ type: 'session.idle', properties: { sessionID: 'session-a' } });
  const runtime = { status: () => ({}), async exclusive(_, callback) {
    return callback({ workdir: own.workdir, supportsAsyncPrompts: true,
      async events() { return { body: new ReadableStream({ start(controller) { stream = controller; } }) }; },
      async api(endpoint, options = {}) {
        if (endpoint === '/mcp') { bridgeConfig = options.body.config; return { orvix_visual: { status: 'connected' } }; }
        if (endpoint === '/session') return { id: 'session-a' };
        if (endpoint.endsWith('/prompt_async')) {
          sentPrompts.push(structuredClone(options.body)); prompts++;
          if (prompts === 1) {
            fetches++; message('first'); send({ ...outputEvent(own.file), properties: { part: { ...outputEvent(own.file).properties.part, messageID: 'first' } } });
            send({ type: 'permission.asked', properties: { id: 'blocked', sessionID: 'session-a', permission: 'bash', tool: { callID: 'blocked-shell' }, metadata: { command: `(Get-Item '${own.file}').Length` } } });
          } else {
            assert.equal(prompts, 2, 'only one scoped recovery is needed');
            assert.match(options.body.parts[0].text, /orvix_visual_read_tool_output/);
            message('second');
            send({ type: 'permission.asked', properties: { id: 'output-read', sessionID: 'session-a', permission: 'orvix_visual_read_tool_output', tool: { callID: 'output-read' } } });
          }
          return null;
        }
        if (endpoint === '/permission/blocked/reply') {
          assert.equal(options.body.reply, 'reject');
          send({ type: 'message.part.updated', properties: { part: { type: 'tool', tool: 'bash', callID: 'blocked-shell', messageID: 'first', sessionID: 'session-a',
            state: { status: 'error', input: { command: `(Get-Item '${own.file}').Length` }, error: 'User rejected permission' } } } });
          message('first', true); idle(); return null;
        }
        if (endpoint === '/permission/output-read/reply') {
          assert.equal(options.body.reply, 'once');
          const response = await fetch(bridgeConfig.url, { method: 'POST', headers: { ...bridgeConfig.headers, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_tool_output', arguments: { filePath: own.file, search: '<h1>', limit: 400 } } }) });
          const rpc = await response.json(); assert.ok(!rpc.result.isError); readResult = JSON.parse(rpc.result.content[0].text);
          send({ type: 'message.part.updated', properties: { part: { type: 'tool', tool: 'orvix_visual_read_tool_output', callID: 'output-read', messageID: 'second', sessionID: 'session-a', state: { status: 'completed', input: { filePath: own.file }, output: readResult.text } } } });
          message('second', true); idle(); return null;
        }
        if (endpoint.endsWith('/message/first')) return { info: { id: 'first', role: 'assistant' }, parts: [{ type: 'text', text: 'Unable to inspect the saved output with the rejected command.' }] };
        if (endpoint.endsWith('/message/second')) return { info: { id: 'second', role: 'assistant' }, parts: [{ type: 'text', text: 'The captured heading is Transport recovery heading.' }] };
        return true;
      },
    });
  } };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, () => {});
  t.after(() => engine.shutdown());
  const result = await engine.run({ taskId: 'transport-output', requestId: 'turn-output', modelId, accessMode: 'Full access', accessModeVersion: 2,
    designProfile: 'none', messages: [{ role: 'user', content: 'Inspect the website homepage structure from the captured HTML.' }] });
  assert.equal(fetches, 1); assert.equal(prompts, 2);
  assert.notEqual(sentPrompts[0].messageID, sentPrompts[1].messageID);
  assert.match(readResult.text, /Transport recovery heading/); assert.match(result.text, /Transport recovery heading/);
  assert.deepEqual(engine.workspaces.list('transport-output'), []);
});
