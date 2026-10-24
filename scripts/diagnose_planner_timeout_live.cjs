const fs=require('node:fs'),path=require('node:path');
const {createOpenCodeWorkers}=require('../electron/agent/opencode-workers.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const root=path.resolve('scratch/planner-diagnostic-'+Date.now());fs.mkdirSync(root,{recursive:true});
const source=JSON.parse(fs.readFileSync('scratch/two-brief-skill-1792355669496/01-Default-retry-delivered-prompt-2.json'));
const pool=createOpenCodeWorkers(root);configureOpenCodeCatalog(root,pool);configureOpenCodeModel(pool);
const report={root,startedAt:new Date().toISOString(),modelId:source.modelId,events:{},updates:[],textCharacters:0,reasoningCharacters:0};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));save();
(async()=>{
 await refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));
 const start=Date.now();
 try{
  const result=await runOpenCodeSession({...source,taskId:'planner-diagnostic',analysis:true,timeoutMs:300000,
   onPermission:async()=>false,onEvent:ev=>{
    const ms=Date.now()-start;report.events[ev.type]=(report.events[ev.type]??0)+1;
    const part=ev.properties?.part;
    if(ev.type==='message.part.delta'){
     const n=String(ev.properties?.delta??'').length;
     report.deltaCharacters=(report.deltaCharacters??0)+n;
    }
    if(part?.type==='text')report.textCharacters=Math.max(report.textCharacters,String(part.text??'').length);
    if(part?.type==='reasoning')report.reasoningCharacters=Math.max(report.reasoningCharacters,String(part.text??'').length);
    if(!report.updates.length||ms-report.updates.at(-1).atMs>=10000){report.updates.push({atMs:ms,event:ev.type,textCharacters:report.textCharacters,reasoningCharacters:report.reasoningCharacters,deltaCharacters:report.deltaCharacters??0});save();}
   }});
  report.durationMs=Date.now()-start;report.status='returned';report.usage=result.usage;
  try{const parsed=JSON.parse(result.text);report.result={status:parsed.status,criteriaCount:parsed.criteria?.length,missingRequirements:parsed.missingRequirements};}catch{report.result={validJSON:false,length:result.text.length};}
 }catch(e){report.status='failed';report.error=e.message;report.durationMs=Date.now()-start;}
})().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>{pool.shutdown();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report));});
