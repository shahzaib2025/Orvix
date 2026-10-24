// Summarize recorded production decisions and preserve their order, without model calls.
const fs=require('node:fs'),path=require('node:path');
const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const results=report.runs.map(run=>{
 const base=path.join(run.engineRoot,'agent-evidence',run.taskId);
 const dir=path.join(base,'build');
 const records=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f)))).sort((a,b)=>a.recordedAt-b.recordedAt);
 const comparisons=records.filter(r=>r.name==='design_originality_comparison').map(r=>({at:r.recordedAt,evidenceId:r.id,...JSON.parse(fs.readFileSync(path.join(base,'blobs',r.outputHash+'.txt'),'utf8'))}));
 const writes=records.filter(r=>r.kind==='tool'&&['write','edit','apply_patch'].includes(r.name)&&!r.failed);
 const accepted=comparisons.find(r=>r.status==='distinct');
 const final=path.join(run.project,'final-inspection');
 return {label:run.label,model:run.model,variant:run.variant,skillHash:run.skillHash,briefHash:run.briefHash,durationMs:run.durationMs,status:run.status,error:run.error,priorDesignCount:run.priorDesignCount,
   comparisons,firstSourceWriteAt:writes[0]?.recordedAt,sourceAfterAcceptedProposal:!!accepted&&writes.length>0&&writes.every(r=>r.recordedAt>=accepted.at),
   observedChecks:['normal','reduced'].flatMap(key=>{
     const file=path.join(final,key+'-result.json');if(!fs.existsSync(file))return [];
     return JSON.parse(fs.readFileSync(file)).views.map(view=>({mode:key,viewport:[view.width,view.height],overflow:view.metrics.horizontalOverflow,brokenImages:view.metrics.brokenImages,errors:view.errors,
       accessibility:view.accessibility.violations.map(issue=>({id:issue.id,targets:issue.targets})),workflow:view.workflow.status,motionFrames:view.motion?.frames?.length}));
   })};
});
fs.writeFileSync(path.join(report.output,'originality-results.json'),JSON.stringify(results,null,2));
for(const run of results)console.log(JSON.stringify({label:run.label,status:run.status,durationMs:run.durationMs,decisions:run.comparisons.map(x=>x.status),sourceAfterAcceptedProposal:run.sourceAfterAcceptedProposal,workflows:run.observedChecks.map(x=>x.workflow)}));
