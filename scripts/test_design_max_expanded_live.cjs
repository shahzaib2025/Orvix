const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

const root = fs.mkdtempSync(path.resolve(__dirname, '..', 'scratch', 'design-max-expanded-'));
const project = path.join(root, 'project'); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'aster-observatory-demo', private: true, scripts: { dev: 'node server.cjs' } }));
fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empty project</title></head><body><main></main></body></html>');
fs.writeFileSync(path.join(project, 'server.cjs'), `const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=__dirname;const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};http.createServer((q,r)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(q.url,'http://localhost').pathname==='/'?'/index.html':new URL(q.url,'http://localhost').pathname));if(!f.startsWith(root+path.sep))throw Error('outside');r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));}catch{r.writeHead(404);r.end('Not found')}}).listen(0,'127.0.0.1',function(){console.log('PREVIEW_URL=http://127.0.0.1:'+this.address().port)});`);
const prompt = `Build a substantial premium showcase for FIELDWORK, a fictional studio creating tactile acoustic objects for calm interiors. Use the actual Design MAX profile and choose your own art direction, page narrative, typography, palette, imagery, section designs and motion. The brief is visually open: do not copy ASTER, astronomy imagery, its centered hero or its scene compositions. Make a compelling subject-specific page with useful depth beyond its signature scene; no invented testimonials, affiliations or performance claims. Use a local demo inquiry action.
Use plain HTML/CSS/JavaScript and preserve the supplied package/server. The approved project is ${project}. Use node server.cjs through the managed preview. No package installation or external research is necessary. Generate your own suitable visuals in code if useful. Use existing set_design_brief including a compact storyboard. Implement the coherent candidate and inspect desktop/mobile, the primary action and representative motion states with existing tools. Do not spend extra passes on optional cosmetic preferences; fix concrete failures in a batch. Provide a concise final response. The website itself and its section compositions must be your work, not an acknowledgment or plan.`;
const result = { root, project, prompt, requestedCreativeLevel: 'Design MAX', actualDesignProfile: 'max', actualReviewMode: 'fast', implementedMaxProfile: true, startedAt: new Date().toISOString(), status: 'starting', events: [] };
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
save(); console.log('OUTPUT ' + root);
const runtime = createOpenCodeHeadless(path.join(root, 'runtime'));
let engine, timer, stopping = false;
const stop = () => { stopping = true; engine?.cancel('fieldwork-test'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
(async () => {
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(30000));
  if (catalog.error || catalog.stale) throw Error(catalog.error || 'Unverified catalog');
  const model = catalog.models.find(item => item.id === 'opencode/longcat-2.5-preview-free');
  if (!model?.input.includes('image') || !model.variants.includes('low')) throw Error('The selected image-capable model/variant is unavailable; no fallback was chosen.');
  result.model = model.id; result.variant = 'low'; result.status = 'building';
  result.sourceHashes = Object.fromEntries(['design-profile.cjs', 'website-design-guidance.cjs', 'opencode-agent.cjs', 'preview-website.cjs', 'preview-browser.cjs'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', 'electron', 'agent', name))).digest('hex')]));
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
  await engine.workspaces.open('fieldwork-test', project, async () => true);
  timer = setTimeout(stop, 900000);
  const reply = await engine.run({ taskId: 'fieldwork-test', requestId: 'build', modelId: model.id, thinkingVariant: 'low', designProfile: 'max', designReviewMode: 'fast', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: prompt }] });
  result.agentDurationMs = Date.now() - started; result.text = reply.text; result.usage = reply.usage; result.verification = reply.verification; result.changedFiles = reply.changes.map(item => item.path); result.status = 'agent_completed'; save();
  console.log('COMPLETE ' + Math.round(result.agentDurationMs / 1000) + 's');
})().catch(error => { result.status = stopping ? 'stopped' : 'failed'; result.error = String(error.message ?? error); result.agentDurationMs = result.agentStartedAt ? Date.now() - result.agentStartedAt : null; save(); console.error(result.error); process.exitCode = 1; }).finally(async () => { clearTimeout(timer); engine?.shutdown(); await runtime.shutdown(); result.finishedAt = new Date().toISOString(); save(); console.log('RESULT ' + path.join(root, 'result.json')); });
