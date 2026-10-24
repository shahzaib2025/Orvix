const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { cleanComposition } = require('../electron/agent/design-composition.cjs');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { parseBenchmarkOptions, runId, benchmarkPrompt, sourceEvidence, profileChecks, reviewOutcomeAccepted, compositionSignature } = require('./website_design_benchmark_helpers.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const options = parseBenchmarkOptions(process.argv.slice(2));
const { model: requestedModel, variant: requestedVariant, caseId: requestedCase, mode: requestedMode, profiles: requestedProfiles, repeats } = options;
const cases = [
  { id: 'luxury', brief: 'Build a premium, original website for AUREL, a fictional independent fragrance atelier. Audience: design-conscious fragrance collectors. Direction: tactile luxury, considered editorial typography, warm ivory and dark ink, meaningful product imagery or an original crafted product illustration, restrained depth and layering. Present a signature scent, a small collection, the materials story and a clear discovery action. Avoid fabricated reviews, awards or sales statistics. The brand must feel different from a SaaS page or an artist portfolio.', workflow: [
    { action: 'click', selector: '[data-action="discover"]' },
    { action: 'assert', assertion: { kind: 'text', selector: '[data-testid="collection-state"]', expected: 'Collection opened' } },
    { action: 'assert', assertion: { kind: 'visible', selector: '#collection' } }
  ], contract: 'A discover button with data-action="discover" must open/reveal or navigate to a visible #collection section and update a live status element data-testid="collection-state" to exactly "Collection opened".' },
  { id: 'saas', brief: 'Build a premium, original website for Signaldesk, a fictional developer incident-diagnosis product. Audience: engineering teams. Direction: precise technical confidence, strong hierarchy, an informative original product/interface visual and purposeful layering. Include a clear product explanation, workflow, pricing and a demo request form. Avoid generic lavender gradients and fabricated customer logos, endorsements or performance claims. Visually distinguish this brand from a luxury fragrance site and an artist portfolio.', workflow: [
    { action: 'click', selector: '[data-action="annual"]' },
    { action: 'assert', assertion: { kind: 'text', selector: '[data-testid="billing"]', expected: 'Annual billing' } },
    { action: 'fill', selector: '#demo-email', value: 'designer@example.com' },
    { action: 'click', selector: '[data-action="submit-demo"]' },
    { action: 'assert', assertion: { kind: 'text', selector: '[data-testid="demo-state"]', expected: 'Demo request received' } }
  ], contract: 'An annual-pricing control data-action="annual" must change the actual pricing presentation and status data-testid="billing" to exactly "Annual billing". An accessible email field #demo-email and submit button data-action="submit-demo" must validate a local demo form and show data-testid="demo-state" with exactly "Demo request received" after a valid submission. Clearly identify this as a local demo; no external submission.' },
  { id: 'portfolio', brief: 'Build a premium, original portfolio for Mira Sen, a fictional independent art director. Audience: creative studios and commissioning clients. Direction: bold editorial composition, expressive typography, art-led project imagery or original graphic artwork, intentional asymmetry and excellent mobile craft. Include identity and editorial projects, a short about section and a contact action. Avoid fabricated client claims. Visually distinguish this portfolio from a luxury product page and a SaaS page.', workflow: [
    { action: 'click', selector: '[data-filter="identity"]' },
    { action: 'assert', assertion: { kind: 'text', selector: '[data-testid="filter-state"]', expected: 'Identity projects' } },
    { action: 'assert', assertion: { kind: 'hidden', selector: '[data-testid="editorial-project"]' } },
    { action: 'assert', assertion: { kind: 'visible', selector: '[data-testid="identity-project"]' } }
  ], contract: 'Include at least one identity project data-testid="identity-project" and one editorial project data-testid="editorial-project", both initially visible. A filter button data-filter="identity" must actually hide the editorial project, retain the identity project and update a live status data-testid="filter-state" to exactly "Identity projects". Provide an All filter that restores both categories.' }
];
const starter = {
  'package.json': JSON.stringify({ name: 'orvix-design-benchmark', private: true, scripts: { dev: 'node server.cjs' } }),
  'index.html': '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empty benchmark project</title></head><body><main></main></body></html>',
  'server.cjs': `const http=require('node:http'),fs=require('node:fs'),path=require('node:path'); const root=__dirname;const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};const s=http.createServer((q,r)=>{try{const url=new URL(q.url,'http://localhost');const f=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(f!==root&&!f.startsWith(root+path.sep))throw Error('outside');const content=fs.readFileSync(f);r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(content);}catch{r.writeHead(404);r.end('Not found');}});s.listen(0,'127.0.0.1',()=>console.log('PREVIEW_URL=http://127.0.0.1:'+s.address().port));`
};
const base = path.resolve(__dirname, '..', 'scratch', 'website-design-benchmark');
const root = path.join(base, new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(root, { recursive: true });
const runtime = createOpenCodeWorkers(path.join(root, 'runtime'));
let stopRequested = false, activeEngine, activeId;
const requestStop = () => { stopRequested = true; activeEngine?.cancel(activeId); };
process.on('SIGINT', requestStop); process.on('SIGTERM', requestStop);
process.stdin.on('data', chunk => { if (chunk.includes(3)) requestStop(); });
const report = { version: 3, startedAt: new Date().toISOString(), root, history:options.history, starterHash: hash(JSON.stringify(starter)), runs: [], designProfiles: requestedProfiles, repeats, limitations: ['A repeated composition signature is a review cue, not proof of copying or lack of originality.', 'Static source checks establish declared section/library indicators only; they do not prove meaningful sections or visible animation.', 'Visual judgment is performed by the supervising assistant, not a blinded human panel.', 'Plain HTML/CSS/JavaScript projects with no supplied reference assets.'] };
const save = () => fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(report, null, 2));
save(); fs.writeFileSync(path.join(base, 'latest.txt'), root);
if(options.priorRoot){
  const audit=JSON.parse(fs.readFileSync(path.resolve(options.priorRoot,'structure-audit.json'),'utf8'));
  const store=createTaskMemoryStore({getPath:()=>path.join(root,'engine')});
  for(const row of (audit.runs??[]).slice(0,6)){
    const observation=row.observedComposition;
    if(!row.brief?.direction||observation?.version!==1||!Array.isArray(observation.views))continue;
    const views=observation.views.slice(0,2).map(view=>({width:Math.max(240,Math.min(2560,Number(view.width)||1440)),composition:cleanComposition(view.composition)})).filter(view=>view.composition);
    if(!views.length)continue;
    const taskId='baseline_'+hash(String(row.id)).slice(0,24);
    store.write(taskId,{status:'completed',changedFiles:['index.html'],designReview:{brief:row.brief,sourceFingerprint:'baseline',observedComposition:{version:1,fingerprint:'baseline',views}}});
  }
  report.priorObservations=store.recentDesigns('new').length;save();
}
function serveProject(project) {
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  return http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(project, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(project + path.sep)) throw new Error('Outside project');
      const content = fs.readFileSync(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' }); response.end(content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
async function runCase(item, profile, mode, repeat) {
  const id = runId(item.id, profile, mode, repeat, options), runRoot = path.join(root, id), project = path.join(runRoot, 'project'); fs.mkdirSync(project, { recursive: true });
  const engineRoot = options.history === 'shared' ? path.join(root,'engine') : path.join(runRoot,'engine');
  for (const [name, content] of Object.entries(starter)) fs.writeFileSync(path.join(project, name), content);
  const prompt = benchmarkPrompt(item);
  const entry = { id, case: item.id, profile, repeat, mode, project, brief: item.brief, prompt, promptHash: hash(prompt), model: report.model, startedAt: new Date().toISOString(), status: 'running', events: [] };
  report.runs.push(entry); save(); console.log(`START ${id} ${entry.startedAt}`);
  fs.writeFileSync(path.join(runRoot, 'prompt.txt'), prompt);
  let engine, timer, server, timedOut=false;
  const started = Date.now();
  try {
    engine = createAgentEngine({ getPath: () => engineRoot, getVersion: () => 'benchmark' }, { getKey: () => '' }, event => {
      if (event.type === 'tool' || event.type === 'activity') {
        entry.events.push({ atMs: Date.now() - started, type: event.type, name: event.name, phase: event.phase, callId: event.callId, failed: event.failed, message: event.message, detail: event.detail, durationMs: event.durationMs, evidenceId: event.evidenceId });
        if (event.type === 'activity' || event.phase === 'completed') console.log(`${id} ${Math.round((Date.now() - started) / 1000)}s ${event.message ?? event.name}${event.failed ? ' FAILED' : ''}`);
        if (event.phase === 'completed' && !event.failed && event.name?.includes('preview_website') && !entry.firstObservedPreviewMs) entry.firstObservedPreviewMs = Date.now() - started;
        save();
      }
      if (event.type === 'approval') engine.decide(event.approvalId, false);
      if (event.type === 'question') engine.cancel(id);
    });
    activeEngine = engine; activeId = id;
    await engine.workspaces.open(id, project, async () => true);
    timer = setTimeout(() => {timedOut=true;engine.cancel(id);}, 900000);
    const response = await engine.run({ taskId: id, requestId: 'build', modelId: report.model, thinkingVariant: report.variant, accessMode: 'Full access', accessModeVersion: 2, designProfile: profile, designReviewMode: mode, messages: [{ role: 'user', content: prompt }] });
    clearTimeout(timer); entry.agentDurationMs = Date.now() - started;
    entry.text = response.text; entry.usage = response.usage; entry.verification = response.verification; entry.changedFiles = response.changes.map(change => change.path);
    entry.sourceEvidence = sourceEvidence(project);
    entry.profileChecks = profileChecks(profile, entry.sourceEvidence);
    entry.compositionSignatures = {};
    entry.firstPreviewMs = entry.firstObservedPreviewMs ?? (response.verification?.designReview?.snapshots?.[0]?.recordedAt ? response.verification.designReview.snapshots[0].recordedAt - started : null);
    save();
    server = serveProject(project); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const imageStore = createImageStore({ getPath: () => engineRoot });
    const url = `http://127.0.0.1:${server.address().port}`, signal = AbortSignal.timeout(90000);
    entry.finalHero = await previewWebsite({ url, taskId: id, requestId: 'independent-hero', signal, imageStore });
    entry.finalFullPage = await previewWebsite({ url, taskId: id, requestId: 'independent-flow', signal, imageStore, full_page: true, workflow: item.workflow });
    for (const view of entry.finalFullPage.views) {
      const signature = compositionSignature(view);
      if (signature) entry.compositionSignatures[view.label] = signature;
    }
    entry.hostValidation = entry.finalFullPage.views.map(view => ({ label: view.label, width: view.width, overflow: view.metrics.horizontalOverflow, brokenImages: view.metrics.brokenImages, errors: view.errors, flow: view.workflow.status, accessibilityViolations: view.accessibility?.violations ?? null }));
    const functional = entry.hostValidation.every(view => view.flow === 'passed' && !view.overflow && !view.brokenImages && !view.errors.length);
    const designStatus = response.verification?.designReview?.status;
    const profileAccepted = entry.profileChecks.every(check => check.passed);
    entry.status = functional && profileAccepted && reviewOutcomeAccepted(profile, designStatus) ? 'completed' : 'issues_found';
  } catch (error) { entry.status = timedOut ? 'timed_out' : stopRequested ? 'stopped' : 'failed'; entry.agentDurationMs ??= Date.now() - started; entry.error = timedOut ? 'Agent exceeded the 15-minute generation/review budget; final acceptance is incomplete.' : String(error.message ?? error); entry.errorCause = error.cause?.code ?? error.cause?.message; console.log(`FAIL ${id}: ${entry.error}`); }
  finally {
    clearTimeout(timer); engine?.shutdown(); if (server) await new Promise(resolve => server.close(resolve));
    activeEngine = null; activeId = null;
    entry.totalDurationMs = Date.now() - started; entry.finishedAt = new Date().toISOString();
    entry.sourceHashes = entry.sourceEvidence?.sourceHashes ?? Object.fromEntries(fs.readdirSync(project).filter(name => fs.statSync(path.join(project, name)).isFile()).map(name => [name, hash(fs.readFileSync(path.join(project, name)))]));
    save(); console.log(`END ${id} ${entry.status} ${Math.round(entry.agentDurationMs / 1000)}s`);
  }
}
(async () => {
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(30000));
  if (catalog.error || catalog.stale) throw new Error(catalog.error || 'Unverified catalog');
  const model = requestedModel ? catalog.models.find(model => model.id === requestedModel) : catalog.models.find(model => model.id === 'opencode/longcat-2.5-preview-free');
  if (!model?.input.includes('image')) throw new Error('Selected benchmark model is not in the verified image-capable free catalog. Choose --model explicitly; there is no automatic fallback.');
  if (requestedVariant && !model.variants.includes(requestedVariant)) throw new Error('Thinking variant is not advertised by this model.');
  report.model = model.id; report.catalogAt = catalog.updatedAt;
  report.variant = requestedVariant ?? null; report.designProfile = requestedProfiles.length === 1 ? requestedProfiles[0] : null;
  report.implementationHashes = Object.fromEntries(['design-composition.cjs', 'design-diversity.cjs', 'task-memory-store.cjs', 'preview-website.cjs', 'opencode-workers.cjs', 'design-review.cjs', 'design-profile.cjs', 'opencode-agent.cjs', 'website-design-guidance.cjs', 'opencode-model.cjs', 'opencode-headless.cjs', 'preview-server.cjs', 'skill-library.cjs', 'task-skill-router.cjs', 'tools.cjs', 'skills/visual_composition/SKILL.md', 'skills/website_design/SKILL.md', 'skills/website_design_medium/SKILL.md', 'skills/website_design_max/SKILL.md', 'skills/website_motion_max/SKILL.md', 'skills/gsap/SKILL.md', 'skills/scrolltrigger/SKILL.md', 'skills/lenis/SKILL.md'].map(name => [name, hash(fs.readFileSync(path.resolve(__dirname, '..', 'electron', 'agent', name)))]));
  save();
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index]; if (requestedCase && requestedCase !== item.id) continue;
    for (const profile of requestedProfiles) for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const mode of index % 2 ? ['balanced', 'fast'] : ['fast', 'balanced']) {
        if (!stopRequested && (!requestedMode || requestedMode === mode)) await runCase(item, profile, mode, repeat);
      }
    }
  }
  report.finishedAt = new Date().toISOString(); save(); console.log(`REPORT ${path.join(root, 'results.json')}`);
})().catch(error => { report.error = String(error.message ?? error); save(); console.error(error); process.exitCode = 1; }).finally(async () => { await runtime.shutdown(); process.stdin.pause(); });
