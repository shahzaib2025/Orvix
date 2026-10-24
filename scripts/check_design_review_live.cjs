const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const root = path.resolve(__dirname, '..', 'scratch', 'design-review-live'); fs.mkdirSync(root, { recursive: true });
const project = fs.mkdtempSync(path.join(root, 'fixture-'));
const runtime = createOpenCodeHeadless(path.join(root, 'runtime'));
let engine, timer;
const result = { at: new Date().toISOString(), project };
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
(async () => {
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"design-live-fixture","private":true,"scripts":{"dev":"node server.cjs"}}');
  fs.writeFileSync(path.join(project, 'server.cjs'), 'const http=require("node:http"),fs=require("node:fs");const s=http.createServer((q,r)=>{r.writeHead(200,{"content-type":"text/html"});r.end(fs.readFileSync(__dirname+"/index.html"))});s.listen(0,"127.0.0.1",()=>console.log("PREVIEW_URL=http://127.0.0.1:"+s.address().port));');
  fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atelier furniture</title><style>body{margin:0;background:#f4efe5;color:#39352c;font-family:Georgia,serif}main{padding:32px}h1{font-size:130px;line-height:1.1;white-space:nowrap}.tiles{display:flex;gap:32px}.tile{min-width:400px;padding:36px;background:#fff}button{background:#39352c;color:white;padding:18px;border:0}footer{padding:40px}</style></head><body><main><p>ATELIER</p><h1>Furniture with a story</h1><p>Hand-finished wood furniture made for everyday living.</p><button id="explore">Explore collection</button><p id="status" role="status">Ready</p><section class="tiles"><article class="tile"><h2>Oak seating</h2><p>Honest materials. Thoughtful proportions.</p></article><article class="tile"><h2>Walnut tables</h2><p>A centrepiece for conversation.</p></article></section><footer>Made with care.</footer></main><script>document.querySelector("#explore").onclick=()=>document.querySelector("#status").textContent="Collection selected"</script></body></html>');
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(30000)); assert.ok(!catalog.error && !catalog.stale, catalog.error);
  const model = catalog.models.find(item => item.input.includes('image')); assert.ok(model); result.model = model.id;
  const events = [];
  engine = createAgentEngine({ getPath: () => path.join(root, 'engine'), getVersion: () => 'test' }, { getKey: () => '' }, event => { events.push(event); if (event.type === 'activity') console.log(event.message); });
  const taskId = `design-live-${Date.now()}`; await engine.workspaces.open(taskId, project, async () => true);
  timer = setTimeout(() => engine.cancel(taskId), 300000);
  const started = Date.now();
  const response = await engine.run({ taskId, requestId: 'design-review', modelId: model.id, accessMode: 'Full access', accessModeVersion: 2, designReviewMode: 'balanced', messages: [{ role: 'user', content:
    `Redesign this existing furniture website in ${project} into a restrained editorial site with warm materials, clear typography and a usable mobile composition. Preserve the Explore collection button and its "Collection selected" status behavior. This is a staged review test: in your INITIAL builder stage, leave the seeded source unchanged, start the preview using orvix_visual_start_preview_server with command "node server.cjs", then inspect desktop/mobile using orvix_visual_preview_website with the returned PREVIEW_URL and workflow [{"action":"click","selector":"#explore"},{"action":"assert","assertion":{"kind":"text","selector":"#status","expected":"Collection selected"}}]. Report this initial candidate and let Orvix's independent reviewer inspect it. When Orvix returns design feedback in the NEXT stage, edit index.html to address the observed issues, use the existing running server URL from task evidence or inspect server output, and capture fresh desktop/mobile screenshots with the same workflow. Avoid installing packages or running unrelated commands.` }] });
  result.durationMs = Date.now() - started; result.text = response.text; result.usage = response.usage; result.verification = response.verification;
  result.tools = events.filter(event => event.type === 'tool' && event.phase === 'completed').map(event => ({ name: event.name, failed: event.failed, evidenceId: event.evidenceId })); save();
  const design = response.verification.designReview;
  assert.equal(design.reviews.length, 1, 'Expected one independent critic');
  assert.equal(design.reviews[0].result.status, 'needs_revision', 'Seeded overflowing mobile design must need revision');
  assert.equal(design.status, 'reinspected', 'No fresh post-revision inspection');
  assert.equal(design.revisions, 1);
  assert.ok(response.changes.some(change => change.path === path.join(project, 'index.html')));
  const fresh = design.snapshots.at(-1); assert.ok(fresh.views.every(view => !view.metrics.horizontalOverflow && view.workflow.status === 'passed'), 'Final mobile overflow or flow failure');
  assert.ok(response.verification.usageStages.some(stage => stage.stage === 'design_review' && stage.usage));
  const previewUrls = [...new Set(design.snapshots.map(snapshot => snapshot.url))];
  for (const url of previewUrls) {
    let running = true;
    for (let attempt = 0; attempt < 10 && running; attempt++) {
      try { await fetch(url, { signal: AbortSignal.timeout(1000) }); await new Promise(resolve => setTimeout(resolve, 250)); }
      catch { running = false; }
    }
    assert.equal(running, false, 'Managed preview remained reachable after the task finished');
  }
  result.previewCleanup = 'passed';
  result.status = 'passed'; save(); console.log(JSON.stringify({ status: result.status, model: result.model, durationMs: result.durationMs, review: design.reviews[0].result, text: result.text }, null, 2));
})().catch(error => { result.status = 'failed'; result.error = String(error.message ?? error); save(); console.error(error); process.exitCode = 1; }).finally(async () => { clearTimeout(timer); engine?.shutdown(); await runtime.shutdown(); });
