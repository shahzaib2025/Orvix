const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const desktop = process.argv[2];
if (!desktop || !path.isAbsolute(desktop)) throw Error('Supply an absolute Desktop comparison folder.');
fs.mkdirSync(desktop, { recursive: true });
const root = fs.mkdtempSync(path.resolve(__dirname, '..', 'scratch', 'design-comparison-'));
const runtime = createOpenCodeHeadless(path.join(root, 'runtime'));
const report = { root, desktop, model: 'opencode/muse-spark-1.3-contributor-free', variant: 'xhigh', runs: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(desktop, 'comparison.json'), JSON.stringify(report, null, 2));
let engine, activeTask;
const stop = () => engine?.cancel(activeTask);
process.on('SIGINT', stop); process.on('SIGTERM', stop);
const serverSource = `const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=__dirname;const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};http.createServer((q,r)=>{try{const u=new URL(q.url,'http://localhost'),f=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(root+path.sep))throw Error('outside');r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));}catch{r.writeHead(404);r.end('Not found')}}).listen(Number(process.env.PORT)||0,'127.0.0.1',function(){console.log('PREVIEW_URL=http://127.0.0.1:'+this.address().port)});`;
(async () => {
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(30000));
  if (catalog.error || catalog.stale) throw Error(catalog.error || 'Unverified catalog');
  const model = catalog.models.find(m => m.id === report.model);
  if (!model?.variants.includes('xhigh') || !model.input.includes('image')) throw Error('Muse Spark 1.3 xhigh with image input is unavailable; no fallback selected.');
  report.catalogModel = model;
  report.skillHash = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../electron/agent/skills/website_design/SKILL.md'))).digest('hex');
  console.log('COMPARISON ' + desktop); save();
  for (const [label, profile] of [['Default', 'normal'], ['Medium', 'medium'], ['MAX', 'max']]) {
    const project = path.join(desktop, label); fs.mkdirSync(project, { recursive: true });
    if (fs.existsSync(path.join(project, 'index.html'))) throw Error('Refusing to overwrite an existing comparison: ' + project);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'orvix-design-comparison', private: true, scripts: { dev: 'node server.cjs' } }));
    fs.writeFileSync(path.join(project, 'server.cjs'), serverSource);
    fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>New website</title></head><body><main></main></body></html>');
    const prompt = `Build a complete, premium showcase website for EMBERLINE, a fictional studio creating sculptural lighting for living spaces. The audience is people choosing expressive lighting for their homes. Include useful information about the objects, their materials and the studio's approach, with a functioning local demo inquiry action. Invent the art direction, visual representations, content narrative, section composition, typography, palette and appropriate interactions yourself. No supplied visual reference or prescribed layout. Do not invent endorsements, business statistics or technical performance claims; identify demo content honestly.\nUse the selected design profile from Orvix task settings and read the relevant website-design skill. Use plain HTML/CSS/JavaScript, preserve the supplied package/server and make index.html the entry. The approved project is ${project}. Use node server.cjs through the managed preview tool. No package installation is necessary. Use available tools for the existing bounded desktop/mobile inspection and primary interaction. Implement the website, not a proposal. Keep the final response concise.`;
    const run = { label, profile, project, prompt, startedAt: new Date().toISOString(), status: 'building', events: [] };
    report.runs.push(run); save(); activeTask = 'compare-' + profile;
    const started = Date.now();
    engine = createAgentEngine({ getPath: () => path.join(root, label), getVersion: () => 'design-comparison' }, { getKey: () => '' }, event => {
      if (event.type === 'tool' || event.type === 'activity') {
        const item = { atMs: Date.now() - started, type: event.type, name: event.name, phase: event.phase, failed: event.failed, message: event.message, output: event.output?.slice(0, 1800) };
        run.events.push(item); save();
        if (event.phase === 'completed' || event.type === 'activity') console.log(label + ' ' + Math.round(item.atMs / 1000) + 's ' + (event.name ?? event.message) + (event.failed ? ' FAILED' : ''));
      }
      if (event.type === 'approval') engine.decide(event.approvalId, false);
      if (event.type === 'question') { run.question = event.question; stop(); }
    });
    let timer;
    try {
      await engine.workspaces.open(activeTask, project, async () => true);
      timer = setTimeout(stop, 900000);
      const reply = await engine.run({ taskId: activeTask, requestId: 'build', modelId: model.id, thinkingVariant: 'xhigh', designProfile: profile, designReviewMode: 'fast', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: prompt }] });
      run.status = 'agent_completed'; run.text = reply.text; run.usage = reply.usage; run.verification = reply.verification; run.changedFiles = reply.changes.map(c => c.path);
    } catch (error) { run.status = 'failed'; run.error = String(error.message ?? error); }
    finally { clearTimeout(timer); engine.shutdown(); engine = null; run.durationMs = Date.now() - started; run.finishedAt = new Date().toISOString(); save(); fs.writeFileSync(path.join(project, 'generation.json'), JSON.stringify(run, null, 2)); }
    console.log(label + ' ' + run.status + ' ' + Math.round(run.durationMs / 1000) + 's');
  }
})().catch(error => { report.error = String(error.message ?? error); console.error(report.error); process.exitCode = 1; }).finally(async () => { engine?.shutdown(); await runtime.shutdown(); report.finishedAt = new Date().toISOString(); save(); });
