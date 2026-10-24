const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'check_fast_multistep_live.report.json');
const suite=JSON.parse(fs.readFileSync(file,'utf8'));
const reviews=[];
for(const trial of suite.trials||[]){
 const raw=JSON.parse(fs.readFileSync(trial.report,'utf8'));
 for(const turn of raw.turns){
  const context=turn.taskContext||turn.completionReviews?.at(-1)?.context||{};
  const last=turn.completionReviews?.at(-1)?.review||{};
  const unsuccessful=turn.status!=='completed'||turn.executionStatus!=='completed'||turn.findings?.length;
  const obstacles=[turn.error,context.pauseReason,...(last.issues||[]),...(context.steps||[]).filter(s=>s.obstacle&&s.state!=='verified').map(s=>s.id+': '+s.obstacle),...(last.missingRequirements||[]).map(id=>'Missing: '+((context.requirements||[]).find(r=>r.id===id)?.text||id))].filter(Boolean);
  const claims=turn.toolCalls.filter(c=>c.name==='review_task').flatMap(c=>c.args?.claims||[]);
  const provenance=claims.map(c=>{
   const evidence=(context.evidence||[]).find(e=>e.id===c.evidenceId);
   const fullEvidence=turn.completionReviews?.flatMap(r=>r.context?.evidence||[]).find(e=>e.id===c.evidenceId);
   const source=evidence||fullEvidence;
   return {requirementId:c.requirementId,sourceUrl:source?.sourceUrl,answerQuote:c.answerQuote,sourceQuote:c.sourceQuote,quotationPresent:!!source?.excerpt?.normalize('NFC').replace(/\s+/g,' ').toLowerCase().includes(String(c.sourceQuote||'').normalize('NFC').replace(/\s+/g,' ').toLowerCase()),semanticEntailment:'independent_review_required'};
  });
  reviews.push({session:trial.number,request:turn.number,unsuccessful,obstacles:obstacles.length?obstacles:unsuccessful?(turn.findings||['Final completion not established']):[],answer:turn.answer,claimMappings:provenance,independentDesktopObservation:turn.independentDesktopAudit?.status||'not_applicable_or_unavailable',liveMutations:turn.toolCalls.filter(c=>['browser_act','desktop_act','work_browser','manage_window'].includes(c.name)).length});
 }
}
const audit={scope:'Every request reviewed for controller failures, source/answer mappings and independent desktop observation availability. This is a structural audit, not a semantic correctness certification.',requestsReviewed:reviews.length,unsuccessfulReviewed:reviews.filter(r=>r.unsuccessful).length,reviewedAt:new Date().toISOString(),zeroFalseCompletionClaims:'not_certified',zeroDuplicatedLiveMutations:'not_certified_read_only_suite',reviews};
fs.writeFileSync(path.join(__dirname,'check_fast_multistep_audit.report.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({requestsReviewed:audit.requestsReviewed,unsuccessfulReviewed:audit.unsuccessfulReviewed}));
