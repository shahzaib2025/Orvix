const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { createPreviewServer } = require('../electron/agent/preview-server.cjs');
const { createVisualMcp } = require('../electron/agent/visual-mcp.cjs');
const { visualToolDefinitions } = require('../electron/agent/tools.cjs');
const root = path.resolve(__dirname, '..', 'scratch', 'parallel-preview-live-' + Date.now());
fs.mkdirSync(root, { recursive: true });
const pool = createOpenCodeWorkers(root), controllers = [new AbortController(), new AbortController()], servers = [], bridges = [];
const report = { scope: 'Two actual OpenCode worker MCP connections and two owned local preview processes.', root };
const command = process.platform === 'win32' ? `& '${process.execPath.replace(/'/g, "''")}' server.cjs` : `'${process.execPath.replace(/'/g, "'\\''")}' server.cjs`;
async function disconnected(url) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await fetch(url, { signal: AbortSignal.timeout(500) }); await new Promise(resolve => setTimeout(resolve, 100)); } catch { return true; }
  }
  return false;
}
(async () => {
  const previews = await Promise.all(controllers.map(async (controller, index) => {
    const directory = path.join(root, 'project-' + index); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'server.cjs'), `const s=require('http').createServer((q,r)=>r.end('PREVIEW_${index}'));s.listen(0,'127.0.0.1',()=>console.log('PREVIEW_URL=http://127.0.0.1:'+s.address().port));`);
    const server = createPreviewServer(controller.signal); servers[index] = server;
    const bridge = await createVisualMcp({ definitions: visualToolDefinitions, acceptsImages: false, imageStore: {}, signal: controller.signal,
      call: (_, args, signal) => server.start(args.command, args.directory, signal) }); bridges[index] = bridge;
    await pool.forTask('preview-' + index).exclusive(controller.signal, async ({ api }) => {
      assert.equal((await api('/mcp', { method: 'POST', body: { name: 'orvix_visual', config: bridge.config }, signal: controller.signal })).orvix_visual.status, 'connected');
    });
    const value = (await (await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'start_preview_server', arguments: { directory, command } } }) })).json()).result;
    assert.equal(value.isError, undefined); const preview = JSON.parse(value.content[0].text);
    assert.equal(await (await fetch(preview.url)).text(), 'PREVIEW_' + index); return preview;
  }));
  report.previews = previews.map(({ pid, url }) => ({ pid, url }));
  report.workers = pool.status().workers; assert.notEqual(report.workers['preview-0'].pid, report.workers['preview-1'].pid);
  await pool.forTask('preview-0').exclusive(controllers[0].signal, async ({ api }) => { await api('/mcp/orvix_visual/disconnect', { method: 'POST', signal: controllers[0].signal }); });
  controllers[0].abort(); await bridges[0].close();
  assert.equal(await disconnected(previews[0].url), true);
  assert.equal(await (await fetch(previews[1].url)).text(), 'PREVIEW_1');
  await pool.forTask('preview-1').exclusive(controllers[1].signal, async ({ api }) => { assert.equal((await api('/mcp', { signal: controllers[1].signal })).orvix_visual.status, 'connected'); });
  report.secondPreviewSurvived = true; report.secondMcpSurvived = true;
  controllers[1].abort(); await bridges[1].close(); assert.equal(await disconnected(previews[1].url), true);
  report.cleanup = 'passed'; report.passed = true;
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
  for (const controller of controllers) controller.abort(); for (const server of servers) server?.stopAll();
  await Promise.allSettled(bridges.map(bridge => bridge?.close())); pool.shutdown();
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
});
