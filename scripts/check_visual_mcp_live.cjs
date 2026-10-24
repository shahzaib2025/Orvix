// Uses the installed OpenCode binary for discovery. --model additionally uses a verified free vision model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { createVisualMcp } = require('../electron/agent/visual-mcp.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { visualToolDefinitions } = require('../electron/agent/tools.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const root = path.resolve(__dirname, '..', 'scratch', 'visual-mcp-live');
fs.mkdirSync(root, { recursive: true });
const runtime = createOpenCodeHeadless(root);
const imageStore = createImageStore({ getPath: () => root });
const results = { at: new Date().toISOString() };
const signal = AbortSignal.timeout(180000);
let bridge;
(async () => {
  const canvas = createCanvas(320, 240); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e3ab8'; ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = '#f4be22'; ctx.beginPath(); ctx.arc(160, 120, 70, 0, Math.PI * 2); ctx.fill();
  const ref = imageStore.savePreview('live', 'visual', 'asset', canvas.toBuffer('image/jpeg', 80));
  let calls = 0;
  const factory = args => createVisualMcp({ definitions: visualToolDefinitions, imageStore, signal, acceptsImages: args.acceptsImages,
    call: async name => { assert.equal(name, 'read_visual_asset'); calls++; return { images: [ref], note: 'Describe the visible shapes and colours. No textual answer is supplied.' }; } });
  bridge = await factory({ acceptsImages: true });
  await runtime.exclusive(signal, async ({ api }) => {
    const connected = await api('/mcp', { method: 'POST', body: { name: 'orvix_visual', config: bridge.config }, signal });
    assert.equal(connected.orvix_visual.status, 'connected'); results.connected = true;
    const ids = await api('/experimental/tool/ids', { signal });
    results.toolIds = ids.filter(name => name.startsWith('orvix_visual_'));
    // MCP tools are separate from native tool IDs in some OpenCode releases.
    const status = await api('/mcp', { signal }); assert.equal(status.orvix_visual.status, 'connected');
    await api('/mcp/orvix_visual/disconnect', { method: 'POST', signal });
    results.disconnected = (await api('/mcp', { signal })).orvix_visual.status !== 'connected';
  });
  await bridge.close(); bridge = null;
  if (process.argv.includes('--model')) {
    configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
    const catalog = await refreshOpenCodeCatalog(true, signal);
    assert.ok(!catalog.error && !catalog.stale, catalog.error);
    const model = catalog.models.find(item => item.input.includes('image'));
    results.visionModels = catalog.models.filter(item => item.input.includes('image')).map(item => item.id);
    if (!model) results.modelCheck = 'unavailable: current free catalog advertises no vision models';
    else {
      const reply = await runOpenCodeSession({ modelId: model.id, directory: root, signal, timeoutMs: 120000,
        parts: [{ type: 'text', text: 'Call orvix_visual_read_visual_asset with file "fixture.png" exactly once. Then describe the colours and shape visible in the image returned by that tool in one short sentence. Do not use shell or other tools.' }],
        visualTools: factory, onPermission: async request => String(request.permission).startsWith('orvix_visual_') });
      assert.ok(calls > 0, 'Model did not call the visual tool');
      assert.match(reply.text, /blue/i); assert.match(reply.text, /yellow|gold/i); assert.match(reply.text, /circle|circular|round/i);
      results.model = model.id; results.modelReply = reply.text; results.usage = reply.usage; results.modelCheck = 'passed';
    }
  }
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (bridge) await bridge.close(); await runtime.shutdown(); });
