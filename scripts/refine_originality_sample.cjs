// One explicit user-requested SVG enrichment and correction pass through Orvix.
const fs=require('node:fs'),path=require('node:path');
const {app,safeStorage}=require('electron');
app.setPath('userData',path.join(process.env.APPDATA,'Orvix'));
const {installFileConsole}=require('./file-console.cjs');
const {createOpenCodeWorkers}=require('../electron/agent/opencode-workers.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const {createSearchKeyStore}=require('../electron/search-key-store.cjs');
const {configureSearchKeys}=require('../electron/serper-search.cjs');
const {selectedSkill}=require('../electron/agent/skill-library.cjs');
const baseline=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const run=baseline.runs.find(x=>x.label===process.argv[3]);
if(!run||baseline.runs.some(x=>x.status==='building'))throw Error('Complete both fresh samples before refinement.');
const requestId='svg-enrichment',file=path.join(run.root,requestId+'-report.json');
if(fs.existsSync(file))throw Error('The requested bounded pass was already attempted.');
const freeze=path.join(run.project,'generation-baseline');fs.mkdirSync(freeze);
for(const name of fs.readdirSync(run.project))if(/\.(?:html|css|js|mjs|json)$/.test(name))fs.copyFileSync(path.join(run.project,name),path.join(freeze,name));
const report={...run,events:[],requestId,skillHash:selectedSkill('website_design','max').contentHash,motionSkillHash:selectedSkill('website_motion_max','max').contentHash,status:'starting',startedAt:new Date().toISOString()};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
installFileConsole(path.join(run.root,requestId+'.log'));save();
let engine,runtime,timer;const begun=Date.now();
app.whenReady().then(async()=>{
 configureSearchKeys(createSearchKeyStore(app,safeStorage));
 runtime=createOpenCodeWorkers(path.join(run.root,requestId+'-runtime'));
 configureOpenCodeCatalog(run.root,runtime);configureOpenCodeModel(runtime);
 const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(90000));
 const model=catalog.models.find(x=>x.id===run.model);
 if(catalog.error||catalog.stale||!model||run.variant&&!model.variants.includes(run.variant))throw Error('Original model/reasoning unavailable; no substitution.');
 engine=createAgentEngine({getPath:()=>run.engineRoot,getVersion:()=>requestId},{getKey:()=>''},event=>{
   if(['tool','activity'].includes(event.type)){report.events.push({atMs:Date.now()-begun,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message});save();}
   if(event.type==='approval')engine.decide(event.approvalId,false);
   if(event.type==='question'){report.question=event.question;engine.cancel(run.taskId);}
 });
 await engine.workspaces.open(run.taskId,run.project,async()=>true);
 timer=setTimeout(()=>engine.cancel(run.taskId),600000);
 const prompt='Improve this existing MAX website in its current folder in one bounded batch, preserving its independently chosen composition and working content. The human requests substantially more SVG artwork and SVG animation distributed across the page so the sections feel engaging and outstanding, rather than isolated SVGs only inside pins. Read the updated selected website_design_max and website_motion_max skills completely using the registered native read tool. Invent subject-specific artwork and choreography: at least four distinct developed vector story treatments across hero, early, middle and late regions, including a shape/structure change. Major story sections should contribute a state or develop a connected vector story; keep body reading and controls calm. Do not use a repeated vector decoration or copy a preset layout. No image downloads. Correct material issues from the recorded preview: blocked or broken external image URLs (retain useful photographic imagery and accurate alt descriptions), low-contrast labels/text during actual animated states, prohibited ARIA attributes on SplitText targets and inaccessible scrollable inquiry summary. Ensure navigation and hero text do not overlap at the top or on reverse scroll. Preserve all content and useful diagrams under mobile/reduced motion and verify the primary local-only inquiry with an actual action and changed-state assertion after final edits. Use the existing bounded preview allowance for representative SVG intermediate/reverse states and desktop/mobile, with valid documented selectors and workflow arguments. Do not claim acceptance from importing plugins or passing syntax checks. Report any unresolved weakness honestly. Do not touch generation-baseline: it records the untouched generated sample. Folder: '+run.project;
 report.status='building';save();
 const result=await engine.run({taskId:run.taskId,requestId,modelId:run.model,thinkingVariant:run.variant,designProfile:'max',designReviewMode:'fast',specialty:null,accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
 report.status='returned';report.result=result.text;report.verification=result.verification;report.usage=result.usage;
}).catch(error=>{report.status='failed';report.error=error.message;}).finally(async()=>{
 clearTimeout(timer);engine?.shutdown();await runtime?.shutdown();report.durationMs=Date.now()-begun;report.finishedAt=new Date().toISOString();save();
 fs.copyFileSync(file,path.join(baseline.output,run.label+'-svg-enrichment-report.json'));app.exit(report.status==='returned'?0:1);
});
