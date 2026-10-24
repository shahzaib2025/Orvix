// Audit preserved diagnostic records; no provider calls or application effects.
const fs=require('node:fs'),path=require('node:path');
const {reviewOutcomeIssues}=require('../electron/fast-outcomes.cjs');
const tags=['fixes20-v2-20261004','fixes-focused-v3-20261004','fixes-native-final-20261004','fixes-reread-final-20261004'];
const audits=[];
for(const tag of tags) {
 const filename=path.join(__dirname,`check_fast_long_conversation.${tag}.report.json`);
 if(!fs.existsSync(filename))continue;
 const report=JSON.parse(fs.readFileSync(filename,'utf8'));
 const turns=report.turns.map(t=>{
  const context=t.taskContext,review=t.completionReviews?.at(-1);
  const verified=context?.evidence?.filter(e=>e.verified)||[];
  const domainIssues=context&&review?.answer?reviewOutcomeIssues(context,review.answer,verified):[];
  const completed=t.executionStatus==='completed';
  return {number:t.number,request:t.prompt,elapsedMs:t.elapsedMs,status:t.status,executionStatus:t.executionStatus,
   taskId:context?.id,revision:context?.revision,modelToolCalls:t.toolCalls?.length||0,
   tools:t.toolCalls?.map(c=>c.name)||[],reviews:t.completionReviews?.length||0,
   delivered:t.segments?.some(s=>s.delivery==='complete')||false,
   receivedPcmChunks:t.receivedAudioChunks,admittedPcmChunks:t.playedAudioChunks,
   fetchedUrls:t.pages?.map(p=>({url:p.url,status:p.status}))||[],
   verificationIssues:review?.review?.issues||[],domainIssues,
   falseCompletionCandidate:completed&&(domainIssues.length>0||review?.completed!==true),
   remaining:context?.requirements?.filter(r=>r.id!=='request'&&r.status!=='verified').map(r=>({id:r.id,text:r.text}))||[],error:t.error};
 });
 audits.push({tag,finishedAt:report.finishedAt,scope:report.scope,mutationPolicy:report.mutationPolicy,
  codeHashes:report.codeHashes,requested:report.requestedTurns,observed:turns.length,
  modelCalls:turns.reduce((n,t)=>n+t.modelToolCalls,0),delivered:turns.filter(t=>t.delivered).length,
  controllerCompleted:turns.filter(t=>t.executionStatus==='completed').length,
  falseCompletionCandidates:turns.filter(t=>t.falseCompletionCandidate).map(t=>t.number),
  turns});
}
const output=path.join(__dirname,'fast-fixes-20261004.audit.json');
fs.writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),limitations:'Text input and counted PCM only. No physical microphone, audible speakers or packaged app acceptance. Domain audit catches observed mismatches; it does not independently establish every semantic claim or a zero-bug guarantee. Mutations were blocked by the diagnostic adapters.',runs:audits},null,2));
for(const audit of audits)console.log(JSON.stringify({tag:audit.tag,observed:audit.observed,modelCalls:audit.modelCalls,delivered:audit.delivered,controllerCompleted:audit.controllerCompleted,falseCompletionCandidates:audit.falseCompletionCandidates}));
