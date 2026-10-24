const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

// Separate provider smoke test, never counted as a new-site benchmark sample.
const root = fs.mkdtempSync(path.resolve(__dirname, '..', 'scratch', 'website-native-smoke-'));
const project = path.join(root, 'project'); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'native-smoke', private: true, scripts: { dev: 'node server.cjs' } }));
fs.writeFileSync(path.join(project, 'server.cjs'), 'const http=require("node:http"),fs=require("node:fs");const s=http.createServer((q,r)=>{r.writeHead(200,{"content-type":"text/html"});r.end(fs.readFileSync(__dirname+"/index.html"))});s.listen(0,"127.0.0.1",()=>console.log("PREVIEW_URL=http://127.0.0.1:"+s.address().port));');
fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview smoke test</title><style>body{margin:0;font:18px system-ui;color:#162029;background:#f5f1e8}main{max-width:900px;margin:auto;padding:32px}button{padding:16px;color:white;background:#162029;border:0}</style></head><body><main><h1>Local preview</h1><button id="check">Check interaction</button><p id="status" role="status">Ready</p></main><script>document.querySelector("#check").onclick=()=>document.querySelector("#status").textContent="Checked"</script></body></html>');
const runtime = createOpenCodeHeadless(path.join(root, 'runtime'));
const result = { at: new Date().toISOString(), root, project, events: [] };
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
let engine, timer;
(async () => {
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(30000));
  assert.ok(!catalog.error && !catalog.stale, catalog.error);
  const model = catalog.models.find(item => item.id === 'opencode/longcat-2.5-preview-free');
  assert.ok(model?.input.includes('image') && model.variants.includes('low'));
  result.model = model.id;
  engine = createAgentEngine({ getPath: () => path.join(root, 'engine'), getVersion: () => 'live-smoke' }, { getKey: () => '' }, event => {
    if (event.type === 'tool' || event.type === 'activity') {
      result.events.push({ type: event.type, name: event.name, phase: event.phase, failed: event.failed, message: event.message }); save();
      if (event.phase === 'completed' || event.type === 'activity') console.log(event.name ?? event.message);
    }
    if (event.type === 'approval') engine.decide(event.approvalId, false);
    if (event.type === 'question') engine.cancel('native-smoke');
  });
  await engine.workspaces.open('native-smoke', project, async () => true);
  timer = setTimeout(() => engine.cancel('native-smoke'), 300000);
  const started = Date.now();
  const response = await engine.run({ taskId: 'native-smoke', requestId: 'inspect', modelId: model.id, thinkingVariant: 'low', accessMode: 'Full access', accessModeVersion: 2, designReviewMode: 'fast', messages: [{ role: 'user', content: 'Inspect the existing local website without editing it. Start the managed preview using orvix_visual_start_preview_server with command "node server.cjs" in the approved project. Use its returned url when ready; if starting, repeat the same tool, never guess a port. Capture desktop and mobile using orvix_visual_preview_website with workflow [{"action":"click","selector":"#check"},{"action":"assert","assertion":{"kind":"text","selector":"#status","expected":"Checked"}}]. Report the observed result briefly. Do not use bash, install packages or change files.' }] });
  result.durationMs = Date.now() - started; result.text = response.text; result.usage = response.usage; result.verification = response.verification;
  const completed = result.events.filter(event => event.type === 'tool' && event.phase === 'completed' && !event.failed);
  assert.ok(completed.some(event => event.name.includes('start_preview_server')));
  assert.ok(completed.some(event => event.name.includes('preview_website')));
  assert.ok(response.text.trim());
  const checks = response.verification.checks.filter(check => !check.stale);
  const flows = checks.filter(check => check.phase === 'user_flow');
  assert.ok(flows.length && flows.every(check => check.status === 'passed'), 'Browser evidence must survive the final reply retrieval');
  const views = flows.flatMap(check => JSON.parse(check.output));
  assert.ok(views.some(view => view.metrics.viewportWidth >= 900) && views.some(view => view.metrics.viewportWidth <= 500), 'Require both desktop and mobile observations, whether captured together or separately');
  assert.ok(views.every(view => view.workflow?.status === 'passed' && !view.metrics.horizontalOverflow
    && view.workflow.steps.some(step => step.action === 'click' && step.selector === '#check' && step.status === 'performed')
    && view.workflow.steps.some(step => step.action === 'assert' && step.selector === '#status' && step.actual === 'Checked' && step.status === 'passed')));
  for (const url of new Set(checks.map(check => check.command.replace(/^preview_website /, '')))) {
    let reachable = true;
    for (let attempt = 0; attempt < 10 && reachable; attempt++) {
      try { await fetch(url, { signal: AbortSignal.timeout(1000) }); await new Promise(resolve => setTimeout(resolve, 250)); }
      catch { reachable = false; }
    }
    assert.equal(reachable, false, 'Managed preview did not stop after the task');
  }
  result.status = 'passed'; result.previewCleanup = 'passed'; save();
  console.log(JSON.stringify({ status: result.status, root, durationMs: result.durationMs, text: result.text }));
})().catch(error => { result.status = 'failed'; result.error = String(error.message ?? error); save(); console.error(result.error); process.exitCode = 1; }).finally(async () => { clearTimeout(timer); engine?.shutdown(); await runtime.shutdown(); });
