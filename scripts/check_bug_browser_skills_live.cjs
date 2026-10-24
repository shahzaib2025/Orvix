// One live production-agent trial. Independent browser grading is not supplied to the model.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { app } = require('electron');
const { chromium } = require('playwright-core');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { installFileConsole } = require('./file-console.cjs');
app.setPath('userData', path.join(process.env.APPDATA, 'Orvix'));
const visualTrial = process.argv.includes('--visual');
const root = path.resolve(__dirname, '../scratch/' + (visualTrial ? 'visual-composition-live-' : 'bug-browser-live-') + Date.now());
const project = path.join(root, 'project');
fs.mkdirSync(project, { recursive: true });
installFileConsole(path.join(root, 'runner.log'));
const report = { root, project, visualTrial, visualAssessment:visualTrial?'pending independent screenshot review':undefined, startedAt: new Date().toISOString(), events: [] };
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Field Notes — Local Preview</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Field Notes</h1><p id="preserve">A small reading list for quiet evenings.</p><section class="viewer"><div id="fallback" hidden>Preview unavailable</div><form id="request-form"><label for="email">Email</label><input id="email" type="email" required><button type="submit">Request preview</button><button id="reset" type="button">Reset</button><output id="result" role="status" aria-live="polite"></output></form></section><p id="notice">Local demo only. No message is sent.</p><p id="status" role="status">Loading preview…</p></main><script src="app.js"></script></body></html>`;
const css = `*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#202b24;font:16px/1.5 system-ui}main{max-width:900px;margin:auto;padding:24px}.viewer{position:relative;min-width:620px;min-height:200px;padding:24px;background:white;border:1px solid #ccc;border-radius:12px}#fallback{position:absolute;inset:0;display:grid;place-content:center;background:#eceae4;z-index:2}form{display:grid;gap:12px}input,button{font:inherit;padding:12px}output{min-height:24px}@media(max-width:600px){main{padding:16px}}`;
const js = `const form=document.getElementById('request-form');const email=document.getElementById('email');const result=document.getElementById('result');document.getElementById('status').textContent='Preview ready';form.addEventListener('submit',event=>{event.preventDefault();const value=email.textContent.trim();result.textContent=value?'Demo request noted for '+value+'. Nothing was sent.':'Please enter your email.';});document.getElementById('reset').addEventListener('click',()=>{form.reset();result.textContent='';});`;
// The visual trial starts with functional behavior; its intentionally weak composition is assessed from captures.
const visualCss = `*{box-sizing:border-box}body{margin:0;background:#f6f6f6;color:#737373;font:16px/1.5 Arial,sans-serif}main{max-width:900px;margin:auto;padding:24px}h1{font-size:16px;font-weight:400;margin:20px 0}.viewer{position:relative;min-width:0;min-height:200px;padding:24px;background:white;border:1px solid #ccc;border-radius:12px}#fallback{position:absolute;inset:0;display:grid;place-content:center;background:#eceae4;z-index:2}#fallback[hidden]{display:none}form{display:grid;gap:12px}label{font-size:24px}input,button{font:inherit;padding:12px}output{min-height:24px}#notice,#status{font-size:16px}@media(max-width:600px){main{padding:16px}}`;
const visualJs = js.replace('email.textContent.trim()', 'email.value.trim()').replace('form.reset()', "email.value=''");
// Mark this as its own project so workspace discovery cannot expand to the parent checkout.
const manifest = JSON.stringify({ name:'orvix-bug-browser-fixture', private:true, version:'1.0.0' }, null, 2) + '\n';
for (const [name, content] of Object.entries({ 'index.html': html, 'styles.css': visualTrial?visualCss:css, 'app.js': visualTrial?visualJs:js, 'package.json': manifest })) {
  fs.writeFileSync(path.join(project, name), content);
  fs.mkdirSync(path.join(root, 'original'), { recursive: true });
  fs.writeFileSync(path.join(root, 'original', name), content);
}
let server, browser, runtime, engine, deadline, pulse;
const taskId = 'bug-browser-' + crypto.randomUUID();
async function grade(label) {
  const checks = [];
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(report.gradeUrl, { waitUntil:'networkidle' });
    const initial = await page.evaluate(() => {
      const overlay = document.querySelector('#fallback');
      return { overlayVisible: !!overlay && getComputedStyle(overlay).display !== 'none' && overlay.getBoundingClientRect().width > 0,
        viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
        ready: document.querySelector('#status')?.textContent,
        preserve: document.querySelector('#preserve')?.textContent,
        notice: document.querySelector('#notice')?.textContent };
    });
    let confirmation = '', resetWorks = false, flowError = null;
    try {
      await page.locator('#email').fill('reader@example.com');
      await page.locator('#email').press('Enter');
      confirmation = await page.locator('#result').innerText();
      await page.locator('#reset').click({ timeout: 1500 });
      resetWorks = (await page.locator('#email').inputValue()) === '' && (await page.locator('#result').innerText()) === '';
    } catch (e) { flowError = e.message.slice(0, 400); }
    await page.screenshot({ path: path.join(root, `${label}-${viewport.width}.png`), fullPage:true });
    checks.push({ viewport, ...initial, errors, confirmation, resetWorks, flowError,
      passed: !initial.overlayVisible && initial.documentWidth <= viewport.width &&
        confirmation === 'Demo request noted for reader@example.com. Nothing was sent.' && resetWorks && !errors.length &&
        initial.preserve === 'A small reading list for quiet evenings.' && initial.notice === 'Local demo only. No message is sent.' });
    await page.close();
  }
  return { passed:checks.every(check=>check.passed), checks };
}
app.whenReady().then(async () => {
  const records = path.join(app.getPath('userData'), 'agent-task-records');
  const manifest = JSON.parse(fs.readFileSync(path.join(records, 'index.json'), 'utf8'));
  const selected = manifest.files.filter(file=>/^[a-f0-9]{64}\.json$/.test(file)).map(file=>{
    try { const r=JSON.parse(fs.readFileSync(path.join(records,file),'utf8'));return {modelId:r.modelId,variant:r.thinkingVariant??null,updatedAt:r.updatedAt??0}; } catch{return null;}
  }).filter(r=>r?.modelId).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  if (!selected?.modelId.startsWith('opencode/')) throw Error('Selected model is not native OpenCode; no substitution.');
  report.modelId=selected.modelId;report.variant=selected.variant;save();
  server=http.createServer((req,res)=>{
    const name=req.url?.split('?')[0]==='/'?'index.html':req.url?.split('?')[0].slice(1);
    if(!['index.html','styles.css','app.js'].includes(name)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(path.join(project,name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  report.gradeUrl='http://127.0.0.1:'+server.address().port+'/';
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  report.baseline=await grade('before');save();
  if(!visualTrial&&report.baseline.passed)throw Error('Broken fixture unexpectedly passed.');
  if(visualTrial&&!report.baseline.passed)throw Error('Visual fixture must start with working behavior.');
  runtime=createOpenCodeWorkers(path.join(root,'runtime'));
  configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
  const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));
  const model=catalog.models.find(item=>item.id===selected.modelId);
  if(catalog.error||catalog.stale||!model||selected.variant&&!model.variants.includes(selected.variant))throw Error(catalog.error||'Selected model/reasoning unavailable; no fallback.');
  const started=Date.now();
  engine=createAgentEngine({getPath:()=>path.join(root,'engine'),getVersion:()=> 'bug-browser-live'}, {getKey:()=>''}, event=>{
    if(['tool','activity','approval','question'].includes(event.type)) {
      report.events.push({atMs:Date.now()-started,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message,evidenceId:event.evidenceId,input:event.type==='tool'&&event.phase==='completed'?event.input:undefined});save();
      if(event.type==='tool'&&event.phase==='completed')console.log('Tool:',event.name,event.failed?'failed':'completed');
    }
    if(event.type==='approval')engine.decide(event.approvalId,false);
    if(event.type==='question'){report.question=event.question;engine.cancel(taskId);}
  });
  await engine.workspaces.open(taskId,project,async()=>true);
  deadline=setTimeout(()=>{report.deadlineReached=true;engine.cancel(taskId);},360000);
  pulse=setInterval(()=>{report.elapsedMs=Date.now()-started;save();console.log('Still active',report.elapsedMs);},30000);
  try {
    const repairRequest=`Repair the existing local webpage in ${project}. It says Preview ready but the unavailable panel covers the form; the page also scrolls horizontally on a narrow phone. Submitting a valid email does not produce the promised confirmation. Investigate the actual causes, fix these defects, and verify desktop and mobile behavior and the primary interaction. A valid request should show exactly: Demo request noted for reader@example.com. Nothing was sent. Reset must clear the input and confirmation. Preserve the existing heading, introductory text, local-only notice, IDs, and established appearance; do not redesign the page or install dependencies. Work only inside this isolated project. Report the causes, actual checks, and any limits accurately.`;
    const visualRequest=`Refine the existing webpage in ${project} into a premium, attractive single-section presentation for Field Notes, a fictional reading-list preview for quiet evenings. Inspect its current rendered composition, identify the important visual weaknesses, and choose your own coherent direction for the subject. Improve hierarchy, typography, spacing, contrast, primary-action prominence, and desktop/mobile composition. You own the visual decisions; no layout, palette, font pair, illustration, or animation is prescribed. Original CSS/SVG artwork is allowed if useful, but do not download assets, use remote resources, install dependencies, add extra sections, or invent business facts, reviews, prices, or delivery claims. Keep the existing heading, introductory sentence and local-only notice verbatim, preserve all existing IDs and form behavior, and leave app.js and package.json unchanged. A valid email must show exactly Demo request noted for reader@example.com. Nothing was sent. Reset must clear the input and confirmation. Inspect the delivered desktop and mobile views and verify the primary flow within the existing preview allowance. Report the observed visual improvements and any remaining limits accurately. Work only in this isolated project.`;
    const result=await engine.run({taskId,requestId:crypto.randomUUID(),modelId:selected.modelId,thinkingVariant:selected.variant,designProfile:'none',accessMode:'Full access',accessModeVersion:2,
      messages:[{role:'user',content:visualTrial?visualRequest:repairRequest}]});
    report.reply=result.text;report.agentVerification=result.verification;report.usage=result.usage;
  }catch(e){report.agentError=e.message;}
  finally{clearTimeout(deadline);clearInterval(pulse);report.durationMs=Date.now()-started;}
  report.loadedSkills=engine.taskMemory.read(taskId)?.loadedSkills??[];
  report.final=await grade('after');
  report.requiredSkillsRead=[visualTrial?'visual_composition':'bug_repair','browser_verification'].every(id=>report.loadedSkills.some(skill=>skill.id===id&&skill.evidenceId&&skill.contentHash));
  report.browserToolObserved=report.events.some(event=>event.phase==='completed'&&!event.failed&&/preview_website$/.test(event.name??''));
  report.preservation=Object.fromEntries((visualTrial?['app.js','package.json']:['index.html','package.json']).map(name=>[name,fs.readFileSync(path.join(root,'original',name),'utf8')===fs.readFileSync(path.join(project,name),'utf8')]));
  report.passed=report.final.passed&&report.requiredSkillsRead&&report.browserToolObserved&&!report.agentError&&Object.values(report.preservation).every(Boolean);
}).catch(e=>{report.error=e.message;console.error(e.message);}).finally(async()=>{
  clearTimeout(deadline);clearInterval(pulse);engine?.shutdown();runtime?.shutdown();await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:report.passed??false,error:report.error??report.agentError??null,report:path.join(root,'report.json')}));app.exit(report.passed?0:1);
});
