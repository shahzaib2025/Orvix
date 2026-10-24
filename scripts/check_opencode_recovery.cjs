const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fetchLiveCatalog, configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');

test('catalog transient GET failure recovers once without weakening verification', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; }); let calls = 0;
  global.fetch = async () => { if (++calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); return Response.json({ data: [{ id: 'fixture-free' }] }); };
  assert.deepEqual(await fetchLiveCatalog(), { data: [{ id: 'fixture-free' }] }); assert.equal(calls, 2);
});
test('catalog retry stops after two network failures and preserves the cause code', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; }); let calls = 0;
  global.fetch = async () => { calls++; throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }); };
  await assert.rejects(fetchLiveCatalog(), /UND_ERR_SOCKET/); assert.equal(calls, 2);
});
test('catalog cancellation and authentication failures are never retried', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; }); let calls = 0;
  global.fetch = async () => { calls++; return new Response('', { status: 401 }); };
  await assert.rejects(fetchLiveCatalog(), /HTTP 401/); assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort(); await assert.rejects(fetchLiveCatalog(controller.signal)); assert.equal(calls, 1);
});
test('catalog server error retries its GET once', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; }); let calls = 0;
  global.fetch = async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ data: [] });
  assert.deepEqual(await fetchLiveCatalog(), { data: [] }); assert.equal(calls, 2);
});
test('recoverable design-gate denial actively resumes even when the model returned text', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-brief-recovery-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/fixture-free', name: 'Fixture', route: 'chat', variants: [], input: ['text'] }] }));
  let eventStream, prompts = 0, recoveries = 0, recoveryEvents = 0, permissionCalls = 0;
  const messages = new Map();
  const frame = event => 'data: ' + JSON.stringify(event) + '\n\n';
  const runtime = { status: () => ({}), async exclusive(signal, callback) { return callback({ workdir: root, supportsAsyncPrompts: true,
    async api(endpoint, options = {}) {
      if (endpoint === '/session') return { id: 'brief-recovery-session' };
      if (endpoint.endsWith('/prompt_async')) {
        prompts++;
        const id = prompts === 1 ? 'assistant-blocked' : 'assistant-resumed';
        messages.set(id, { info: { id, role: 'assistant', finish: prompts === 1 ? 'tool-calls' : 'stop' },
          parts: [{ type: 'text', text: prompts === 1 ? 'I will continue after defining the layout.' : 'The design brief is now recorded.' }] });
        queueMicrotask(() => {
          const events = [{ type: 'message.updated', properties: { info: { id, role: 'assistant', sessionID: 'brief-recovery-session', time: { created: prompts } } } }];
          if (prompts === 1) events.push({ type: 'permission.asked', properties: { id: 'brief-gate-permission', sessionID: 'brief-recovery-session', permission: 'write', tool: { callID: 'blocked-write' } } });
          events.push({ type: 'session.idle', properties: { sessionID: 'brief-recovery-session' } });
          eventStream.enqueue(Buffer.from(events.map(frame).join('')));
        });
        return true;
      }
      if (endpoint.startsWith('/permission/')) return true;
      const messageId = endpoint.split('/').at(-1);
      if (messages.has(messageId)) return messages.get(messageId);
      return true;
    },
    async events() { return { body: new ReadableStream({ start(controller) { eventStream = controller; } }) }; }
  }); } };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const result = await runOpenCodeSession({ taskId: 'brief-recovery', modelId: 'opencode/fixture-free', parts: [{ type: 'text', text: 'Build a website' }],
    onPermission: async () => { permissionCalls++; return false; },
    permissionRecovery: () => { recoveries++; return { reason: 'The design brief is required.', recoverable: true, continue: true, guidance: 'Call set_design_brief now.' }; },
    onRecovery: message => { recoveryEvents++; assert.match(message, /continuing with the permitted scoped tools/i); }, timeoutMs: 3000 });
  assert.equal(result.text, 'The design brief is now recorded.');
  assert.equal(permissionCalls, 1);
  assert.ok(recoveries >= 1);
  assert.equal(recoveryEvents, 1, 'the same denied tool should trigger only one continuation');
  assert.equal(prompts, 2, 'the native session should resume once without waiting for a blank model reply');
});
test('terminal authentication error without idle fails promptly and retains the task session', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-native-error-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/fixture-free', name: 'Fixture', route: 'responses', variants: [], input: ['text'] }] }));
  const calls = []; let stream;
  const runtime = { status: () => ({}), exclusive: async (_, callback) => callback({ workdir: root, supportsAsyncPrompts: true,
    api: async (endpoint, options = {}) => { calls.push([endpoint, options.method]); if (endpoint === '/session') return { id: 'error-fixture' }; if (endpoint.endsWith('/prompt_async')) queueMicrotask(() => {
      stream.enqueue(Buffer.from('data: ' + JSON.stringify({ type: 'session.error', properties: { sessionID: 'unrelated', error: { data: { message: 'Ignore other tasks' } } } }) + '\n\n'));
      stream.enqueue(Buffer.from('data: ' + JSON.stringify({ type: 'session.error', properties: { sessionID: 'error-fixture', error: { name: 'APIError', data: { message: 'Authentication required', statusCode: 401 } } } }) + '\n\n'));
    }); return true; },
    events: async () => ({ body: new ReadableStream({ start(controller) { stream = controller; } }) })
  }) };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  await assert.rejects(runOpenCodeSession({ modelId: 'opencode/fixture-free', parts: [], timeoutMs: 1000 }), /Authentication required/);
  assert.equal(calls.filter(([endpoint]) => endpoint.endsWith('/prompt_async')).length, 1);
  assert.ok(calls.some(([endpoint]) => endpoint.endsWith('/abort'))); assert.equal(calls.some(([,method]) => method === 'DELETE'), false);
});

test('full-page capture naturally activates off-screen reveals and restores the original position', async t => {
  const http = require('node:http');
  const {previewWebsite}=require('../electron/agent/preview-website.cjs');
  const {createImageStore}=require('../electron/agent/image-store.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-reveal-'));
  const server=http.createServer((_,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="en"><head><title>UNSEEN</title><style>body{margin:0}.spacer{height:1400px}.reveal{height:500px;background:#123;color:white;opacity:0}.in{opacity:1}</style></head><body><main><h1>Fixture</h1><div class="spacer"></div><section class="reveal"><h2>Content below the fold</h2></section></main><script>new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");document.title="REVEAL_READY"}})).observe(document.querySelector(".reveal"));</script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
  const r=await previewWebsite({url:'http://127.0.0.1:'+server.address().port,taskId:'fixture',requestId:'reveal',signal:new AbortController().signal,imageStore:createImageStore({getPath:()=>root}),full_page:true,viewports:[{width:800,height:600}]});
  assert.equal(r.views[0].metrics.title,'REVEAL_READY');
  assert.equal(r.views[0].capture.preparation.bottomReached,true);
  assert.equal(r.views[0].capture.preparation.restoredY,0);
  assert.ok(fs.existsSync(r.views[0].image.file));
});
