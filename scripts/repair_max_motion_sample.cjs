// One production-agent repair pass for the incomplete first acceptance sample.
const fs = require('node:fs'), path = require('node:path');
const { app, safeStorage } = require('electron');
app.setPath('userData', path.join(process.env.APPDATA, 'Orvix'));
const { createSearchKeyStore } = require('../electron/search-key-store.cjs');
const { configureSearchKeys } = require('../electron/serper-search.cjs');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { installFileConsole } = require('./file-console.cjs');
const original = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const run = original.runs[0];
const output = path.join(run.root, 'repair.json');
const report = { model:run.model, variant:run.variant, project:run.project, taskId:run.taskId, startedAt:new Date().toISOString(), status:'building', events:[] };
const save = () => fs.writeFileSync(output, JSON.stringify(report,null,2));
installFileConsole(path.join(run.root, 'repair.log')); save();
let runtime, engine, timer;
const begun=Date.now();
app.whenReady().then(async()=>{
  configureSearchKeys(createSearchKeyStore(app,safeStorage));
  runtime=createOpenCodeHeadless(path.join(run.root,'runtime'));
  configureOpenCodeCatalog(run.root,runtime); configureOpenCodeModel(runtime);
  const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(90000));
  const model=catalog.models.find(m=>m.id===run.model);
  if(catalog.error||catalog.stale||!model||run.variant&&!model.variants.includes(run.variant))throw Error('Original model/reasoning unavailable; no substitute.');
  engine=createAgentEngine({getPath:()=>path.join(run.root,'engine'),getVersion:()=> 'max-motion-repair'}, {getKey:()=>''}, event=>{
    if(['tool','activity'].includes(event.type)){report.events.push({atMs:Date.now()-begun,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message});save();}
    if(event.type==='approval')engine.decide(event.approvalId,false);
    if(event.type==='question'){report.question=event.question;engine.cancel(run.taskId);}
  });
  await engine.workspaces.open(run.taskId,run.project,async()=>true);
  timer=setTimeout(()=>engine.cancel(run.taskId),1200000);
  const request='Finish this existing FIELDWORK website in one targeted repair batch, preserving its chosen design, useful content and required MAX motion stack. Do not rebuild, fetch more assets or inspect other websites. Verify the saved reveal fix in #water, #planting, #details, #notes, #engage and #practice; each section must show its content during normal scrolling. Resolve the remaining dark-surface contrast problems without globally changing colors used on light backgrounds. Assert the valid inquiry submission and its honest local-only confirmation. Within the existing bounded preview workflow, inspect current desktop/mobile composition, navigation, primary action, representative boundaries, hero and pin entry/progression/release/reverse. Inspect reduced-motion content including every process stage. Capture individual sections when the long page exceeds full-page capture limits. Report unresolved shortcomings honestly. This is the one targeted repair allowance for the incomplete sample, not an invitation for repeated polishing.\nOriginal brief: '+run.brief+'\nExisting project: '+run.project;
  const result=await engine.run({taskId:run.taskId,requestId:'targeted-repair',modelId:run.model,thinkingVariant:run.variant,designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:run.brief+'\nProject: '+run.project},{role:'assistant',content:run.result},{role:'user',content:request}]});
  report.status='returned';report.result=result.text;report.verification=result.verification;report.usage=result.usage;
}).catch(error=>{report.status='failed';report.error=error.message;}).finally(async()=>{
  clearTimeout(timer);engine?.shutdown();await runtime?.shutdown();report.durationMs=Date.now()-begun;report.finishedAt=new Date().toISOString();save();
  fs.copyFileSync(output,path.join(run.project,'targeted-repair-report.json'));app.exit(report.error?1:0);
});
