const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

const root = fs.mkdtempSync(path.resolve(__dirname, '..', 'scratch', 'design-max-live-'));
const project = path.join(root, 'project'); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'aster-observatory-demo', private: true, scripts: { dev: 'node server.cjs' } }));
fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empty project</title></head><body><main></main></body></html>');
fs.writeFileSync(path.join(project, 'server.cjs'), `const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=__dirname;const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};http.createServer((q,r)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(q.url,'http://localhost').pathname==='/'?'/index.html':new URL(q.url,'http://localhost').pathname));if(!f.startsWith(root+path.sep))throw Error('outside');r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));}catch{r.writeHead(404);r.end('Not found')}}).listen(0,'127.0.0.1',function(){console.log('PREVIEW_URL=http://127.0.0.1:'+this.address().port)});`);
const prompt = `Build a complete, distinctive premium website for ASTER Observatory, a fictional contemporary observatory offering twilight visits and guided night-sky experiences. This tests the implemented Design MAX profile of Orvix. Choose your own subject-specific art direction, typography, palette, first viewport, section compositions and supporting interactions. Do not use a generic hero/cards/testimonials/pricing template, or repeat a beige editorial portfolio with an orange italic headline. Make it feel memorable, immersive and professionally composed, with meaningful original sky/optical visuals created in code if useful. No fabricated testimonials, real affiliations or numerical success claims. No external submission.

The main signature experience MUST work: on desktop a viewport-sized stage stays in view inside #journey while natural page scrolling progresses through three clearly different chapters, changing real central text and corresponding sky/optical imagery, then releases into subsequent content. Put the sticky stage in #journey-stage. Chapters must have data-story-chapter="1", "2", "3" and meaningful visible copy; mark the changing copy with data-story-copy and the corresponding media with data-story-media. These hooks are for observation, not a visual recipe. Content, scene composition and transition technique are your decisions. Make forward/reverse scrolling coherent, add supporting motion with purpose, and avoid scroll trapping. Recompose the story for mobile; reduced motion must keep all chapter content and actions accessible.

Provide a clear visit action data-action="book" leading to #visit, an accessible local-demo email field #visit-email and submit control data-action="submit-visit". Valid submission must visibly set data-testid="visit-state" to exactly "Visit request received". State that it is a local demonstration. Build relevant, attractive supporting sections, navigation and footer without a fixed section count. All navigation/controls must work; desktop and mobile must be usable without horizontal overflow. Preserve the supplied package/server files and use node server.cjs for the managed preview. Use plain HTML/CSS/JavaScript in this small standalone project; separate CSS/JS/assets are fine. Avoid package installation or external research unless essential. You may use CSS sticky, native animation or an appropriate available technique; no prescribed animation library.

Implement one coherent candidate using the supplied shared design principles. Use the real managed preview and inspect actual desktop/mobile pages and the primary action once. Include one motion checkpoint capture of #journey using observe_selectors ["#journey-stage","[data-story-copy]","[data-story-media]"] at progress 0, 0.45, 0.9, 1.1, 0, with animations enabled; fix concrete problems. Keep reports concise. Do not settle for acknowledging the task or describing a plan: deliver the working site. Do not claim motion is tested from static screenshots. Your approved project is ${project}.`;
const result = { root, project, prompt, requestedCreativeLevel: 'Design MAX', actualDesignProfile: 'max', actualReviewMode: 'fast', implementedMaxProfile: true, startedAt: new Date().toISOString(), status: 'starting', events: [] };
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
save(); console.log('OUTPUT ' + root);
const runtime = createOpenCodeHeadless(path.join(root, 'runtime'));
let engine, timer, stopping = false;
const stop = () => { stopping = true; engine?.cancel('aster-test'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
(async () => {
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(30000));
  if (catalog.error || catalog.stale) throw Error(catalog.error || 'Unverified catalog');
  const model = catalog.models.find(item => item.id === 'opencode/longcat-2.5-preview-free');
  if (!model?.input.includes('image') || !model.variants.includes('low')) throw Error('The selected image-capable model/variant is unavailable; no fallback was chosen.');
  result.model = model.id; result.variant = 'low'; result.status = 'building';
  result.sourceHashes = Object.fromEntries(['website-design-guidance.cjs', 'opencode-agent.cjs', 'preview-website.cjs', 'preview-browser.cjs'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', 'electron', 'agent', name))).digest('hex')]));
  const started = Date.now(); result.agentStartedAt = started;
  engine = createAgentEngine({ getPath: () => path.join(root, 'engine'), getVersion: () => 'max-design-test' }, { getKey: () => '' }, event => {
    if (event.type === 'tool' || event.type === 'activity') {
      const item = { atMs: Date.now() - started, type: event.type, name: event.name, phase: event.phase, failed: event.failed, message: event.message, output: event.output?.slice(0, 1600) };
      result.events.push(item);
      if (event.type === 'tool' && event.phase === 'completed' && !event.failed && event.name?.includes('preview_website')) result.firstPreviewMs ??= item.atMs;
      save();
      if (event.phase === 'completed' || event.type === 'activity') console.log(Math.round(item.atMs / 1000) + 's ' + (event.name ?? event.message) + (event.failed ? ' FAILED' : ''));
    }
    if (event.type === 'approval') engine.decide(event.approvalId, false);
    if (event.type === 'question') { result.question = event.question; stop(); }
  });
  await engine.workspaces.open('aster-test', project, async () => true);
  timer = setTimeout(stop, 900000);
  const reply = await engine.run({ taskId: 'aster-test', requestId: 'build', modelId: model.id, thinkingVariant: 'low', designProfile: 'max', designReviewMode: 'fast', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: prompt }] });
  result.agentDurationMs = Date.now() - started; result.text = reply.text; result.usage = reply.usage; result.verification = reply.verification; result.changedFiles = reply.changes.map(item => item.path); result.status = 'agent_completed'; save();
  console.log('COMPLETE ' + Math.round(result.agentDurationMs / 1000) + 's');
})().catch(error => { result.status = stopping ? 'stopped' : 'failed'; result.error = String(error.message ?? error); result.agentDurationMs = result.agentStartedAt ? Date.now() - result.agentStartedAt : null; save(); console.error(result.error); process.exitCode = 1; }).finally(async () => { clearTimeout(timer); engine?.shutdown(); await runtime.shutdown(); result.finishedAt = new Date().toISOString(); save(); console.log('RESULT ' + path.join(root, 'result.json')); });
