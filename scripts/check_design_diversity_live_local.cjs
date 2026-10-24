const fs=require('node:fs'),path=require('node:path');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {createDesignDiversity,comparisonInstructions}=require('../electron/agent/design-diversity.cjs');
const root=path.resolve('scratch/design-diversity-live-'+Date.now());fs.mkdirSync(root,{recursive:true});
const base=path.join(process.env.APPDATA,'Orvix','agent-memory');
const read=id=>JSON.parse(fs.readFileSync(path.join(base,id+'.json'),'utf8')).designReview.brief;
const earlier=read('344cdb95-77c6-44a7-8a93-9fb88a0e7330'), current=read('bc7c5e07-5d60-40c6-a71a-480411a3205b');
const runtime=createOpenCodeHeadless(path.join(root,'runtime'));configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
const report={model:'opencode/muse-spark-1.3-contributor-free',variant:'medium',root,tests:[],kind:'live composition comparisons only; no website generation'};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
(async()=>{const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(45000));if(catalog.error||catalog.stale)throw Error(catalog.error||'Catalog stale');
 const model=catalog.models.find(x=>x.id===report.model);if(!model?.variants.includes(report.variant))throw Error('Exact Muse configuration unavailable');
 const guard=createDesignDiversity({prior:[{taskId:'shop2',brief:earlier}],signal:AbortSignal.timeout(180000),record:r=>{report.lastComparison=r;save();},compare:async prompt=>{
  const start=Date.now();const result=await runOpenCodeSession({taskId:'diversity-probe',modelId:report.model,variant:report.variant,readOnly:true,onPermission:async()=>false,systemPrompt:comparisonInstructions,parts:[{type:'text',text:prompt}],timeoutMs:60000});
  report.lastDurationMs=Date.now()-start;report.lastUsage=result.usage;save();return result;}});
 for(const item of [{name:'actual repeated user sites',brief:current,expectBlocked:true},{name:'different composition control',brief:{...current,direction:'A full-screen documentary photographic opening with small overlaid navigation and a compact title at the bottom. The page develops as continuous edge-to-edge image sequences with inset captions and a broad typographic letter interlude; no side-by-side text/media hero or tilted card collage.',storyboard:'Documentary opening -> full-width photographic sequence -> typographic letter interlude -> compact message action'},expectBlocked:false}]){
  const started=Date.now();let blocked=false,reason;try{await guard.check(item.brief);}catch(e){blocked=true;reason=e.message;}report.tests.push({name:item.name,expectedBlocked:item.expectBlocked,blocked,passed:blocked===item.expectBlocked,reason,durationMs:Date.now()-started,comparison:report.lastComparison,usage:report.lastUsage});save();}
})().catch(e=>{report.error=e.message;save();process.exitCode=1;}).finally(()=>{runtime.shutdown();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({root,tests:report.tests.map(x=>({name:x.name,passed:x.passed,blocked:x.blocked,durationMs:x.durationMs})),error:report.error}));});
