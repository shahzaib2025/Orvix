// Isolated composition experiment. Production files/settings are never swapped.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,safeStorage}=require('electron');
app.setPath('userData',path.join(process.env.APPDATA,'Orvix'));
const {installFileConsole}=require('./file-console.cjs');
const stamp=Date.now(),stateRoot=path.resolve('scratch/design-composition-ab-'+stamp);
const output=path.join(process.env.USERPROFILE,'Desktop','Orvix-Design-Composition-AB-'+stamp);
fs.mkdirSync(stateRoot,{recursive:true});fs.mkdirSync(output);
installFileConsole(path.join(stateRoot,'runner.log'));
const records=path.join(app.getPath('userData'),'agent-task-records');
const manifest=JSON.parse(fs.readFileSync(path.join(records,'index.json')));
const selected=manifest.files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(records,f)))).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).find(t=>t.modelId);
if(!selected?.modelId.startsWith('opencode/'))throw Error('No native selected model; no substitution.');
const images=[
 'https://images.pexels.com/photos/35696867/pexels-photo-35696867.jpeg',
 'https://images.pexels.com/photos/7452869/pexels-photo-7452869.jpeg',
 'https://images.pexels.com/photos/33980199/pexels-photo-33980199.jpeg'
];
const brief='Create a professional white-theme three-section website composition study for MERIDIAN, a fictional architecture and materials studio. Develop an opening, a presentation of the practice, and one illustrative project. Invent the visual presentation. Include working navigation between these sections and deliberate text motion. This is a bounded three-section study, not a full website: no inquiry form or additional sections are needed. Label fictional project material and stock photography honestly; do not invent real clients, awards, prices or contact details. Use relevant direct image URLs from this shared asset bank without downloads or further image searches: '+images.join(' ');
const minimal='# Website design — MAX\n\nDESIGN MAX\nApply only to the selected frontend task. Honor the human scope and factual constraints. Invent a coherent professional visual identity and composition appropriate to the content. Build working responsive code, readable motion and accessible navigation. Record your chosen direction briefly in the existing design brief. Inspect desktop/mobile with the existing bounded preview. No layout, font, palette, component recipe or section order is prescribed beyond the human brief. Preserve content with reduced motion.\n';
const variants=['A-Minimal','B-Current-MAX'].map(label=>{
 const root=path.join(stateRoot,label),electron=path.join(root,'snapshot','electron'),project=path.join(output,label);
 fs.mkdirSync(root,{recursive:true});fs.mkdirSync(project);
 fs.cpSync(path.resolve('electron'),electron,{recursive:true});
 const skill=path.join(electron,'agent','skills','website_design_max','SKILL.md');
 if(label==='A-Minimal')fs.writeFileSync(skill,minimal);
 return {label,root,electron,project,skillHash:crypto.createHash('sha256').update(fs.readFileSync(skill)).digest('hex')};
});
const report={output,stateRoot,brief,model:selected.modelId,variant:selected.thinkingVariant??null,startedAt:new Date().toISOString(),scope:'three-section composition only',controls:'Same brief, assets, model, reasoning, runtime settings, compact reminder, tools and budgets; only MAX entrypoint content differs. Technical/visual randomness remains uncontrolled.',runs:[]};
const save=()=>fs.writeFileSync(path.join(stateRoot,'report.json'),JSON.stringify(report,null,2));save();
let engine,runtime,timer;
app.whenReady().then(async()=>{
 for(const item of variants){
  const base=item.electron;
  const keyStore=require(path.join(base,'search-key-store.cjs')).createSearchKeyStore(app,safeStorage);
  require(path.join(base,'serper-search.cjs')).configureSearchKeys(keyStore);
  runtime=require(path.join(base,'agent','opencode-headless.cjs')).createOpenCodeHeadless(path.join(item.root,'runtime'));
  const catalogModule=require(path.join(base,'agent','opencode-catalog.cjs'));
  catalogModule.configureOpenCodeCatalog(item.root,runtime);
  require(path.join(base,'agent','opencode-model.cjs')).configureOpenCodeModel(runtime);
  const catalog=await catalogModule.refreshOpenCodeCatalog(true,AbortSignal.timeout(90000));
  const model=catalog.models.find(m=>m.id===report.model);
  if(catalog.error||catalog.stale||!model||report.variant&&!model.variants.includes(report.variant))throw Error('Selected model/reasoning unavailable; no fallback.');
  const run={...item,taskId:'composition-'+crypto.randomUUID(),model:report.model,variant:report.variant,status:'building',startedAt:new Date().toISOString(),events:[]};report.runs.push(run);save();
  const begun=Date.now();
  engine=require(path.join(base,'agent','engine.cjs')).createAgentEngine({getPath:()=>path.join(item.root,'engine'),getVersion:()=> 'composition-ab'}, {getKey:()=>''},event=>{
   if(['tool','activity'].includes(event.type)){run.events.push({atMs:Date.now()-begun,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message});save();}
   if(event.type==='approval')engine.decide(event.approvalId,false);
   if(event.type==='question'){run.question=event.question;engine.cancel(run.taskId);}
  });
  try{
   await engine.workspaces.open(run.taskId,item.project,async()=>true);
   timer=setTimeout(()=>engine.cancel(run.taskId),600000);
   const result=await engine.run({taskId:run.taskId,requestId:'build',modelId:report.model,thinkingVariant:report.variant,designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:brief+'\nBuild in this new folder: '+item.project+'. Do not inspect other generated sites.'}]});
   run.status='returned';run.result=result.text;run.verification=result.verification;run.usage=result.usage;
  }catch(e){run.status='failed';run.error=e.message;}
  finally{clearTimeout(timer);run.durationMs=Date.now()-begun;run.finishedAt=new Date().toISOString();save();engine.shutdown();engine=null;await runtime.shutdown();runtime=null;}
 }
}).catch(e=>{report.error=e.message;}).finally(async()=>{
 clearTimeout(timer);engine?.shutdown();await runtime?.shutdown();report.finishedAt=new Date().toISOString();save();fs.copyFileSync(path.join(stateRoot,'report.json'),path.join(output,'generation-report.json'));app.exit(report.error?1:0);
});
