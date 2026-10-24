// A read-only live report using the user's saved native model; no fabricated business data or model substitution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{app}=require('electron');
const {createOpenCodeWorkers}=require('../electron/agent/opencode-workers.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const {installFileConsole}=require('./file-console.cjs');
app.setPath('userData',path.join(process.env.APPDATA,'Orvix'));
const root=path.resolve('scratch/report-live-'+Date.now());fs.mkdirSync(root,{recursive:true});installFileConsole(path.join(root,'runner.log'));
const report={root,startedAt:new Date().toISOString(),events:[]};const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
let runtime,engine,timer,pulse;
app.whenReady().then(async()=>{
 const records=path.join(app.getPath('userData'),'agent-task-records');const manifest=JSON.parse(fs.readFileSync(path.join(records,'index.json'),'utf8'));
 const selection=manifest.files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>{try{const r=JSON.parse(fs.readFileSync(path.join(records,f),'utf8'));return{modelId:r.modelId,variant:r.thinkingVariant??null,updatedAt:r.updatedAt??0};}catch{return null;}}).filter(r=>r?.modelId).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 if(!selection?.modelId.startsWith('opencode/'))throw Error('Saved model is not native OpenCode; no substitution.');
 report.modelId=selection.modelId;report.variant=selection.variant;save();
 runtime=createOpenCodeWorkers(path.join(root,'runtime'));configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));const model=catalog.models.find(m=>m.id===selection.modelId);
 if(catalog.error||catalog.stale||!model||selection.variant&&!model.variants.includes(selection.variant))throw Error(catalog.error||'Saved model/reasoning is unavailable.');
 const taskId='report-'+crypto.randomUUID();
 engine=createAgentEngine({getPath:()=>path.join(root,'engine'),getVersion:()=> 'report-live'},{getKey:()=>''},event=>{
  if(['tool','activity','approval','clarification'].includes(event.type)){report.events.push({type:event.type,phase:event.phase,name:event.name,message:event.message});save();}
  if(event.type==='approval')engine.decide(event.approvalId,false);
  if(event.type==='clarification'&&event.phase!=='remove')engine.cancel(taskId);
 });
 timer=setTimeout(()=>{report.deadlineReached=true;engine.cancel(taskId);},180000);
 pulse=setInterval(()=>{save();console.log('Live report in progress');},30000);
 const prompt='Give a report only, using these supplied facts. Do not run tools, commands, browse, inspect files, or change anything. Compare the three clipboard routes for Orvix in one useful Markdown table and recommend their order. Organize the report with meaningful Markdown headings and a concise evidence section. Do not invent tests, latency measurements or numeric scores. Facts: Desktop bridge uses existing clipboard IPC and confirms status ok; it may be unavailable outside the desktop app. Browser clipboard confirms a resolved writeText promise, but may fail because of permissions. Text-selection fallback uses execCommand copy where supported, returns success/failure, and must restore focus and selection. Proposed order is desktop, browser, selection fallback. These facts describe the implementation contract; this task has no live clipboard or device test evidence. State that limitation accurately. Keep the reply under 300 words.';
 const result=await engine.run({taskId,requestId:'live-'+crypto.randomUUID(),modelId:selection.modelId,thinkingVariant:selection.variant,designProfile:'none',accessMode:'Plan',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
 report.text=result.text;report.responsePath=path.join(root,'response.md');fs.writeFileSync(report.responsePath,result.text);
 report.toolStarts=report.events.filter(e=>e.type==='tool'&&e.phase==='started').length;
 report.passed=report.toolStarts===0&&/^#{1,6} /m.test(result.text)&&/\|[^\n]+\|/.test(result.text)&&/\|\s*:?-{3,}/.test(result.text)&&/desktop/i.test(result.text)&&/browser/i.test(result.text)&&/selection/i.test(result.text)&&/unverified|no (?:live|actual)|not (?:run|tested)|has not|haven.t|not.{0,20}verified/i.test(result.text);
}).catch(e=>{report.error=e.stack;console.error(e.message);}).finally(()=>{clearTimeout(timer);clearInterval(pulse);engine?.shutdown();runtime?.shutdown();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:!!report.passed,report:path.join(root,'report.json')}));app.exit(report.passed?0:1);});
