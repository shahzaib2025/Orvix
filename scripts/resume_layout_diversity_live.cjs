// Finish a retained experiment without replaying its build request.
const fs=require('node:fs'),path=require('node:path');
const reportFile=process.argv[2];if(!reportFile||!path.isAbsolute(reportFile))throw Error('Supply an absolute experiment report.');
const report=JSON.parse(fs.readFileSync(reportFile,'utf8')),run=report.runs.at(-1);
if(!['failed','building'].includes(run?.status))throw Error('Expected an interrupted experiment.');
const limitMinutes=Number(process.argv[3]??5);
if(!Number.isFinite(limitMinutes)||limitMinutes<1||limitMinutes>20)throw Error('Use a bounded 1–20 minute continuation.');
const source=path.join(report.stateRoot,'snapshot/electron');
const {createOpenCodeWorkers}=require(path.join(source,'agent/opencode-workers.cjs'));
const catalog=require(path.join(source,'agent/opencode-catalog.cjs'));
const model=require(path.join(source,'agent/opencode-model.cjs'));
const {createAgentEngine}=require(path.join(source,'agent/engine.cjs'));
const {readEnvValue}=require(path.join(source,'agent/credentials.cjs'));
const providerKey=process.env.ORVIX_OPENCODE_ZEN_KEY?.trim()||readEnvValue(fs.existsSync('.env')?fs.readFileSync('.env','utf8'):'','ORVIX_OPENCODE_ZEN_KEY');
const runtime=createOpenCodeWorkers(path.join(report.stateRoot,'runtime'),{getProviderKey:()=>providerKey});
catalog.configureOpenCodeCatalog(report.stateRoot,runtime);model.configureOpenCodeModel(runtime);
const save=()=>{for(const p of [reportFile,path.join(report.stateRoot,'report.json')])fs.writeFileSync(p,JSON.stringify(report,null,2));};
const continuation={startedAt:new Date().toISOString(),status:'resuming',previousError:run.error};(run.continuations??=[]).push(continuation);
let engine,timer;const start=Date.now();
run.durationMs??=Math.max(0,...(run.events??[]).map(event=>event.atMs??0));
save();
engine=createAgentEngine({getPath:()=>path.join(report.stateRoot,'engines',report.historyMode==='shared'?'shared':run.label),getVersion:()=> 'layout-diversity-control'},{getKey:()=>''},event=>{
 if(['tool','activity'].includes(event.type)){run.events.push({atMs:(run.durationMs??0)+Date.now()-start,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message,detail:event.detail,input:event.input,output:event.output?.slice(0,1600)});save();if(event.phase==='completed'||event.type==='activity')console.log(run.label+' resume '+Math.round((Date.now()-start)/1000)+'s '+(event.name??event.message));}
 if(event.type==='approval')engine.decide(event.approvalId,false);
 if(event.type==='question'){run.question=event.question;engine.cancel(run.taskId);}
},null,{runNativeSession:options=>model.runOpenCodeSession({...options,onRequest:async trace=>{run.traces.push(trace);save();await options.onRequest?.(trace);}})});
process.on('SIGINT',()=>engine.cancel(run.taskId));
(async()=>{
 const ready=await catalog.refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));
 if(ready.error||ready.stale||!ready.models.some(m=>m.id===report.modelId&&m.variants.includes(report.variant)))throw Error('Exact model/reasoning unavailable.');
 await engine.workspaces.open(run.taskId,run.project,async()=>true);
 const journal=engine.journal.recover(run.taskId);if(!journal.safe)throw Error('Retained session is unsafe: '+journal.reason);
 timer=setTimeout(()=>{continuation.diagnosticTimedOut=true;save();engine.cancel(run.taskId);},limitMinutes*60000);
 const result=await engine.run({taskId:run.taskId,requestId:'build',modelId:report.modelId,thinkingVariant:report.variant,designProfile:run.lane==='raw'?'none':run.lane,designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,resume:true,messages:[{role:'user',content:report.brief+'\nBuild in this new approved folder: '+run.project+'. Do not read unrelated projects.'}]});
 run.status='returned';delete run.error;run.reply=result.text;run.verification=result.verification;run.usage=result.usage;run.changedFiles=result.changes.map(c=>c.path);run.hasEntrypoint=fs.existsSync(path.join(run.project,'index.html'));run.observedComposition=engine.taskMemory.read(run.taskId)?.designReview?.observedComposition;continuation.status='returned';delete report.stopReason;
})().catch(e=>{continuation.status='failed';continuation.error=e.message;run.error=e.message;process.exitCode=1;}).finally(()=>{clearTimeout(timer);continuation.durationMs=Date.now()-start;run.durationMs=(run.durationMs??0)+continuation.durationMs;run.finishedAt=new Date().toISOString();report.finishedAt=run.finishedAt;save();engine.shutdown();runtime.shutdown();console.log('RESULT '+continuation.status+' '+reportFile);});
