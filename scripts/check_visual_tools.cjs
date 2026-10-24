const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { previewWebsite, captureOptions } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { readVisualAsset } = require('../electron/agent/visual-asset.cjs');
const { createVisualMcp } = require('../electron/agent/visual-mcp.cjs');
const { visualToolDefinitions } = require('../electron/agent/tools.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

test('capture bounds reject invalid sizes, conflicting sections and unbounded counts', () => {
  assert.throws(() => captureOptions({ viewports: [{ width: 100, height: 900 }] }));
  assert.throws(() => captureOptions({ viewports: Array(5).fill({ width: 400, height: 800 }) }));
  assert.throws(() => captureOptions({ selector: '#hero', full_page: true }));
  assert.equal(captureOptions()[1].label, 'mobile');
});

test('real preview detects CSS overriding closed navigation but accepts visible open menus and corrected hidden states', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-hidden-navigation-'));
  const server = http.createServer((request, response) => response.end(`<!doctype html><html lang="en"><head><title>Navigation visibility</title><style>
    body{margin:0;background:white;color:black}#toggle{position:fixed;top:8px;right:8px;z-index:2}.menu{display:flex;position:fixed;inset:60px 0 auto;background:white;padding:20px}
    ${request.url === '/fixed' ? '.menu[hidden]{display:none}' : ''}
    </style></head><body><main><h1>Navigation fixture</h1><button id="toggle" aria-controls="menu" aria-expanded="false" onclick="const m=document.getElementById('menu');m.hidden=!m.hidden;this.setAttribute('aria-expanded',String(!m.hidden))">Menu</button>
    <nav class="menu" id="menu" aria-label="Mobile" hidden><a href="#content">Content</a></nav><p id="content">The page remains usable.</p>
    <div hidden><div hidden style="display:flex">Still hidden by its parent</div></div><div hidden="until-found">Searchable content</div></main></body></html>`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive:true,force:true}); });
  const options = {url:`http://127.0.0.1:${server.address().port}/broken`,taskId:'hidden',requestId:'capture',signal:AbortSignal.timeout(45000),imageStore:createImageStore({getPath:()=>root}),viewports:[{width:390,height:844}]};
  const broken = await previewWebsite(options);
  assert.deepEqual(broken.views[0].metrics.hiddenAttributeOverrides.map(item => item.id), ['menu']);
  const fixed = await previewWebsite({...options,url:options.url.replace('/broken','/fixed'),workflow:[
    {action:'assert',assertion:{kind:'hidden',selector:'#menu'}},
    {action:'click',selector:'#toggle'},
    {action:'assert',assertion:{kind:'visible',selector:'#menu'}},
    {action:'click',selector:'#toggle'},
    {action:'assert',assertion:{kind:'hidden',selector:'#menu'}},
  ]});
  assert.equal(fixed.views[0].workflow.status,'passed',JSON.stringify(fixed.views[0].workflow));
  assert.deepEqual(fixed.views[0].metrics.hiddenAttributeOverrides,[]);
});

test('skip links to content sections are not clipping failures only when focus makes them usable', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-skip-section-'));
  const server = http.createServer((_, response) => response.end('<!doctype html><html lang="en"><head><title>Skip fixture</title><style>.skip,.broken{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:white;color:black}</style></head><body><a class="skip" href="#composer">Skip to card composer</a><a class="broken" href="#composer">Unusable offscreen link</a><main><h1>Cards</h1><section id="composer"><h2>Composer</h2><label>Name <input></label></section></main></body></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive:true,force:true}); });
  const result = await previewWebsite({url:`http://127.0.0.1:${server.address().port}`,taskId:'skip',requestId:'r',signal:new AbortController().signal,imageStore:createImageStore({getPath:()=>root}),viewports:[{width:390,height:844}]});
  assert.equal(result.views[0].metrics.viewportClippedContent.some(item => item.text === 'Skip to card composer'),false);
  assert.equal(result.views[0].metrics.viewportClippedContent.some(item => item.text === 'Unusable offscreen link'),true);
});
test('off-screen lazy images stay pending while actual failed images count as broken', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-lazy-image-'));
  const canvas = createCanvas(2, 2), bitmap = canvas.toBuffer('image/png');
  const server = http.createServer((request, response) => {
    if (request.url === '/missing.png') { response.writeHead(404); return response.end(); }
    if (request.url === '/lazy.png') { response.writeHead(200, { 'content-type': 'image/png' }); return response.end(bitmap); }
    response.end('<!doctype html><html lang="en"><title>Image status fixture</title><main><h1>Images</h1><img src="/missing.png" alt="Failed fixture" width="20" height="20"><div style="height:12000px"></div><img loading="lazy" src="/lazy.png" alt="Lazy fixture" width="20" height="20"></main></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}`, taskId: 'images', requestId: 'capture', signal: AbortSignal.timeout(30000), imageStore: createImageStore({ getPath: () => root }), viewports: [{ width: 768, height: 600 }] });
  assert.equal(result.views[0].metrics.brokenImages, 1);
  assert.equal(result.views[0].metrics.pendingImages, 1);
});

test('full-page capture keeps fixed navigation at the top after a deep workflow action', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-fullpage-nav-'));
  const server = http.createServer((_, response) => response.end('<!doctype html><html lang="en"><title>Fixed navigation fixture</title><style>body{margin:0;background:white}header{position:fixed;top:0;left:0;width:100%;height:40px;background:#0000ff;z-index:10}main{height:2000px;padding-top:60px}#after{margin-top:1700px}</style><header>Navigation</header><main><h1>Start</h1><button id="after" onclick="this.textContent=\'Selected\'">Choose</button></main></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}`, taskId: 'nav', requestId: 'capture', signal: AbortSignal.timeout(30000), imageStore: createImageStore({ getPath: () => root }), full_page: true, viewports: [{ width: 768, height: 600 }], workflow: [{ action: 'click', selector: '#after' }, { action: 'assert', assertion: { kind: 'text', selector: '#after', expected: 'Selected' } }] });
  assert.equal(result.views[0].workflow.status, 'passed');
  const bitmap = await loadImage(fs.readFileSync(result.views[0].image.file));
  const canvas = createCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
  const pixel = context.getImageData(bitmap.width - 10, 10, 1, 1).data;
  assert.ok(pixel[2] > 200 && pixel[0] < 30 && pixel[1] < 30, 'Fixed blue navigation must appear at the top of the full-page image.');
});

test('real browser captures full pages, sections, motion preferences and hover state; ambiguous actions stop', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-visual-tools-'));
  const server = http.createServer((_, response) => response.end('<!doctype html><html lang="en"><head><title>Visual fixture</title><style>#hero{height:1600px;background:#b52344}.tip{display:none}button:hover+.tip{display:block}</style></head><body><main><h1>Fixture</h1><button id="hover">Hover</button><span class="tip">Visible on hover</span><section id="hero"><h2>Long section</h2></section><button>Duplicate</button><button>Duplicate</button></main></body></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const imageStore = createImageStore({ getPath: () => root });
  const options = { url: `http://127.0.0.1:${server.address().port}`, taskId: 'visual', requestId: 'capture', signal: new AbortController().signal, imageStore, viewports: [{ width: 768, height: 600 }] };
  const full = await previewWebsite({ ...options, full_page: true, reduced_motion: true, workflow: [{ action: 'hover', selector: '#hover' }, { action: 'assert', assertion: { kind: 'visible', selector: '.tip' } }] });
  assert.equal(full.views[0].workflow.status, 'passed');
  assert.equal(full.views[0].capture.reducedMotion, true);
  assert.equal(full.views[0].metrics.prefersReducedMotion, true);
  assert.ok(full.views[0].metrics.designSignals.some(item => item.id === 'hero' && item.height === 1600));
  assert.equal(full.views[0].metrics.viewportWidth, 768);
  assert.ok((await loadImage(full.views[0].image.file)).height > 1600);
  const section = await previewWebsite({ ...options, selector: '#hero', workflow: [{ action: 'scroll', selector: '#hero' }, { action: 'assert', assertion: { kind: 'visible', selector: '#hero' } }] });
  assert.ok(Math.abs((await loadImage(section.views[0].image.file)).height - 1600) <= 1);
  assert.equal(section.views[0].workflow.status, 'passed');
  const ambiguous = await previewWebsite({ ...options, workflow: [{ action: 'click', selector: 'button' }] });
  assert.equal(ambiguous.views[0].workflow.status, 'failed');
  assert.match(ambiguous.views[0].workflow.steps[0].reason, /exactly one/);
  await assert.rejects(previewWebsite({ ...options, selector: 'button' }), /exactly one/);
  await assert.rejects(previewWebsite({ ...options, url: 'https://example.com' }), /local HTTP/);
});

test('local asset inspection preserves source and denies outside/sensitive files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-visual-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'photo.png'); fs.writeFileSync(file, createCanvas(2000, 1000).toBuffer('image/png'));
  const original = fs.readFileSync(file);
  const options = { file, taskId: 'asset', requestId: 'read', signal: new AbortController().signal, imageStore: createImageStore({ getPath: () => root }), workspaces: { assert(_, value) { if (path.dirname(value) !== root) throw new Error('outside workspace'); return value; } } };
  const result = await readVisualAsset(options);
  assert.equal(result.width, 1600); assert.equal(result.height, 800);
  assert.equal(result.images[0].mime, 'image/jpeg'); assert.deepEqual(fs.readFileSync(file), original);
  await assert.rejects(readVisualAsset({ ...options, file: path.join(os.tmpdir(), 'outside.png') }), /outside/);
  fs.writeFileSync(path.join(root, '.env.png'), original);
  await assert.rejects(readVisualAsset({ ...options, file: path.join(root, '.env.png') }), /non-sensitive/);
});

test('MCP authenticates, validates arguments and delivers images only to image-capable models', async () => {
  for (const acceptsImages of [true, false]) {
    let called = 0;
    const bridge = await createVisualMcp({ definitions: visualToolDefinitions, acceptsImages, signal: new AbortController().signal, imageStore: { read: () => 'aW1hZ2U=' },
      call: async () => { called++; return { images: [{ file: 'fixture.jpg', mime: 'image/jpeg' }] }; } });
    const rpc = async (method, params = {}) => (await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
    try {
      assert.equal((await fetch(bridge.config.url, { method: 'POST' })).status, 401);
      assert.equal((await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, Origin: 'https://evil.example' } })).status, 403);
      assert.equal((await rpc('initialize')).result.serverInfo.name, 'orvix-visual');
      assert.equal((await rpc('tools/list')).result.tools.length, 5);
      assert.equal((await rpc('tools/call', { name: 'read_visual_asset', arguments: {} })).result.isError, true);
      assert.equal(called, 0);
      const result = (await rpc('tools/call', { name: 'read_visual_asset', arguments: { file: 'fixture.png' } })).result;
      assert.equal(result.content.filter(item => item.type === 'image').length, acceptsImages ? 1 : 0);
      if (!acceptsImages) assert.match(result.content[0].text, /cannot see images/);
    } finally { await bridge.close(); }
    await assert.rejects(fetch(bridge.config.url));
  }
});

test('MCP cancellation aborts a running operation and releases the operation slot', async () => {
  let started; const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const bridge = await createVisualMcp({ definitions: visualToolDefinitions, acceptsImages: false, signal: new AbortController().signal, imageStore: {}, call: async (_, __, callSignal) => {
    calls++; if (calls > 1) return { ok: true };
    started(); await new Promise((resolve, reject) => callSignal.addEventListener('abort', () => reject(new Error('Task cancelled.')), { once: true }));
  } });
  const send = async body => fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', ...body }) });
  try {
    const pending = send({ id: 7, method: 'tools/call', params: { name: 'read_visual_asset', arguments: { file: 'fixture.png' } } });
    await ready;
    assert.equal((await send({ method: 'notifications/cancelled', params: { requestId: 7 } })).status, 202);
    const result = await (await pending).json(); assert.equal(result.result.isError, true); assert.match(result.result.content[0].text, /cancelled/);
    assert.equal((await (await send({ id: 8, method: 'tools/call', params: { name: 'read_visual_asset', arguments: { file: 'fixture.png' } } })).json()).result.isError, undefined);
  } finally { await bridge.close(); }
});

test('MCP deadline releases an abandoned operation even when it ignores cancellation', async () => {
  const task = new AbortController(); let calls = 0, abandonedSignal;
  const bridge = await createVisualMcp({ definitions: visualToolDefinitions, acceptsImages: false, signal: task.signal, imageStore: {}, operationTimeoutMs: 50,
    call: async (_, __, signal) => { if (++calls === 1) { abandonedSignal = signal; return new Promise(() => {}); } return { ok: true }; } });
  const rpc = async id => (await (await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_visual_asset', arguments: { file: 'fixture.png' } } }) })).json()).result;
  try {
    assert.match((await rpc(1)).content[0].text, /timed out/);
    assert.equal(abandonedSignal.aborted, true); assert.equal(task.signal.aborted, false);
    assert.equal((await rpc(2)).isError, undefined);
  } finally { await bridge.close(); }
});

test('MCP client disconnect cancels its operation and allows another request', async () => {
  let started, cancelled; const ready = new Promise(resolve => { started = resolve; });
  const aborted = new Promise(resolve => { cancelled = resolve; }); let calls = 0;
  const bridge = await createVisualMcp({ definitions: visualToolDefinitions, acceptsImages: false, signal: new AbortController().signal, imageStore: {},
    call: async (_, __, signal) => { if (++calls > 1) return { ok: true }; signal.addEventListener('abort', cancelled, { once: true }); started(); return new Promise(() => {}); } });
  const client = new AbortController();
  const send = signal => fetch(bridge.config.url, { method: 'POST', signal, headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: calls + 1, method: 'tools/call', params: { name: 'read_visual_asset', arguments: { file: 'fixture.png' } } }) });
  try {
    const pending = send(client.signal); const rejected = assert.rejects(pending, /abort/i);
    await ready; client.abort(); await rejected;
    await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Disconnect did not cancel operation')), 2000); timer.unref(); })]);
    assert.equal((await (await send()).json()).result.isError, undefined);
  } finally { await bridge.close(); }
});

test('native agent captures actual browser images, records flow evidence and invalidates it after edits', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-native-visual-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'native-visual-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"visual-fixture"}');
  const server = http.createServer((_, response) => response.end('<!doctype html><html lang="en"><head><title>Native visual fixture</title></head><body><main><h1>Fixture</h1><button id="go">Go</button><p id="state">Ready</p></main><script>document.querySelector("#go").onclick=()=>document.querySelector("#state").textContent="Done"</script></body></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let observedImage = false;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, () => {}, null, { runNativeSession: async options => {
    const bridge = await options.visualTools({ acceptsImages: true, signal: options.signal });
    try {
      const response = await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'preview_website', arguments: {
        directory: project, url: `http://127.0.0.1:${server.address().port}`, viewports: [{ width: 390, height: 844 }], workflow: [{ action: 'click', selector: '#go' }, { action: 'assert', assertion: { kind: 'text', selector: '#state', expected: 'Done' } }],
        motion: {section:'main',checkpoints:[{progress:0,label:'entry'},{progress:1.1,label:'release'}]},
      } } }) });
      const value = (await response.json()).result; assert.equal(value.isError, undefined);
      const image = value.content.find(item => item.type === 'image'); assert.ok(image.data.length > 100); observedImage = true;
      assert.equal(value.content.filter(item=>item.type==='image').length,3);
      assert.deepEqual(JSON.parse(value.content[0].text).imageOrder,['viewport-1 page','viewport-1 motion: entry','viewport-1 motion: release']);
      assert.equal(JSON.parse(value.content[0].text).views[0].workflow.status, 'passed');
      // A later native edit makes previous browser observations stale, even without an API-suite check.
      await options.onEvent({ type: 'message.updated', properties: { info: { id: 'assistant', role: 'assistant' } } });
      await options.onEvent({ type: 'message.part.updated', properties: { part: { id: 'edit-1', messageID: 'assistant', type: 'tool', tool: 'edit', state: { status: 'completed', input: {}, output: 'source changed' } } } });
      return { text: 'Browser observations are recorded; a later edit needs another capture.', usage: null };
    } finally { await bridge.close(); }
  } });
  t.after(async () => { engine.shutdown(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(project), __dirname); fs.rmSync(project, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  await engine.workspaces.open('native-visual', project, async () => true);
  const result = await engine.run({ taskId: 'native-visual', requestId: 'turn-1', modelId: 'opencode/mimo-v2.6-flash-free', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Inspect the local website' }] });
  assert.equal(observedImage, true); assert.equal(result.verification.status, 'not_run');
  const flow = result.verification.checks.find(check => check.phase === 'user_flow');
  assert.equal(flow.status, 'passed'); assert.equal(flow.stale, true); assert.ok(flow.evidenceId);
});
