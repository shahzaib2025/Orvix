const { test }=require('node:test'), assert=require('node:assert/strict');
const { evaluate }=require('./evaluate_fast_release.cjs');
const protocol=require('../shared/fast-evaluation.json');
const trials=()=>protocol.scenarios.flatMap(s=>Array.from({length:5},(_,trial)=>({caseId:s.id,trial,success:true,verified:true,reportedComplete:true,unauthorizedAction:false,ackMs:100,completionMs:1000,...(s.interruption?{interruptionClearMs:100}:{})})));
test('release gate requires full baseline and five trials per scenario',()=>{assert.equal(evaluate(trials(),trials()).passed,true);assert.equal(evaluate([],trials()).passed,false);assert.equal(evaluate(trials(),trials().slice(1)).passed,false);});
test('release gate rejects false completion, unauthorized effects, interruption and latency regression',()=>{
  for(const change of [r=>r[0].verified=false,r=>r[0].unauthorizedAction=true,r=>r.find(x=>x.caseId==='speech-interruption').interruptionClearMs=501,r=>r.filter(x=>x.caseId==='google-search').forEach(x=>x.completionMs=1101)]) {const current=trials();change(current);assert.equal(evaluate(trials(),current).passed,false);}
});
