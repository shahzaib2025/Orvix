// Read-only app audit; writes benchmark artifacts only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'check_fast_long_conversation.diagnostic20-original-stall-20261004.report.json'), 'utf8'));
const resumed = JSON.parse(fs.readFileSync(path.join(__dirname, 'check_fast_long_conversation.diagnostic20-restarted-20261004.report.json'), 'utf8'));
const turns = [original.turns[0], ...resumed.turns].sort((a,b) => a.number-b.number);
const sourceHashChanges = Object.entries(original.codeHashes).filter(([file,hash]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex') !== hash).map(([file]) => file);
const sum = name => turns.reduce((total,turn) => total+(turn[name]?.length || 0),0);
const counts = {};
for (const turn of turns) for (const call of turn.toolCalls || []) counts[call.name] = (counts[call.name] || 0)+1;
const rows = turns.map(turn => {
  const completions=turn.toolCompletions || [];
  const failedCalls=completions.filter(c=>!['ok','completed'].includes(c.status));
  return {number:turn.number,status:turn.status || 'running',executionStatus:turn.executionStatus || 'unrecorded',
    durationSeconds:turn.elapsedMs === undefined ? null : Math.round(turn.elapsedMs/100)/10,
    modelToolCalls:turn.toolCalls?.length || 0,backendSearches:turn.searches?.length || 0,backendPageReads:turn.pages?.length || 0,backendWeatherReads:turn.weather?.length || 0,
    reviews:turn.completionReviews?.length || 0,rejectedCalls:failedCalls.map(c=>({name:c.name,status:c.status})),
    receivedPcm:turn.receivedAudioChunks || 0,admittedPcm:turn.playedAudioChunks || 0,
    lastVisibleReport:turn.answer || turn.segments?.at(-1)?.text || '',error:turn.error,
    diagnostics:turn.diagnostics || [],explicitSessionRestart:turn.number === 2 || turn.connectionRecovery?.explicitStopStart || false,
    finalReview:turn.completionReviews?.at(-1)?.review,
  };
});
const report={requestedTurns:20,finishedTurns:turns.filter(t=>['completed','failed','not_run_provider_blocked'].includes(t.status)).length,
  scope:original.scope,sessionCaveat:'The initial turn stalled. The original harness then could not dispatch later requests because start() was a no-op. Prompts 2-20 ran after an explicit diagnostic restart. This does not prove an uninterrupted 20-turn session or automatic recovery.',
  appSourceHashChanges:sourceHashChanges,toolCallCounts:counts,totalToolCalls:sum('toolCalls'),totalBackendSearches:sum('searches'),totalBackendPageReads:sum('pages'),totalBackendWeatherReads:sum('weather'),
  deliveredFinalReports:turns.filter(t=>t.status==='completed').length,controllerCompleted:turns.filter(t=>t.status==='completed'&&t.executionStatus==='completed').length,
  failedDeliveryOrConnection:turns.filter(t=>t.status==='failed').length,providerBlocked:resumed.providerBlocked || false,
  sessionInterventions:[{beforeTurn:2,kind:'explicit fresh diagnostic process',reason:'Initial reply stall left start() unable to reconnect. Earlier controller/provider state is not restored in the new process.'}],
  rows,turns};
const durations=rows.map(row=>row.durationSeconds).filter(Number.isFinite).sort((a,b)=>a-b);
report.latency={scope:'Mixed-task end-to-end durations including failures; not a simple-task baseline comparison',medianSeconds:durations.length%2?durations[Math.floor(durations.length/2)]:(durations[durations.length/2-1]+durations[durations.length/2])/2,p95Seconds:durations[Math.ceil(durations.length*0.95)-1],sumSeconds:durations.reduce((a,b)=>a+b,0)};
const compare=turns.find(turn=>turn.number===2);
if(compare?.taskContext && compare.completionReviews?.length) {
  const verify=require('../electron/fast-outcomes.cjs').reviewOutcomeIssues;
  const originalAnswer=compare.completionReviews.at(-1).answer;
  const reorderedSameFacts='Dhaka is at 31.5 degrees C. Sylhet is at 27.1 degrees C. Dhaka is warmer by 4.4 degrees.';
  report.weatherOrderReproduction={originalAnswer,originalIssues:verify(compare.taskContext,originalAnswer,compare.taskContext.evidence),reorderedSameFacts,reorderedIssues:verify(compare.taskContext,reorderedSameFacts,compare.taskContext.evidence)};
}
report.continuityChecks=[{before:11,after:12},{before:12,after:13},{before:19,after:20}].map(pair=>{
  const before=turns.find(turn=>turn.number===pair.before)?.taskContext,after=turns.find(turn=>turn.number===pair.after)?.taskContext;
  return {...pair,sameTask:before?.id === after?.id,beforeEvidenceCount:before?.evidence?.length || 0,afterEvidenceCount:after?.evidence?.length || 0,beforeVerifiedEvidence:before?.evidence?.filter(e=>e.verified).length || 0,afterVerifiedEvidence:after?.evidence?.filter(e=>e.verified).length || 0};
});
fs.writeFileSync(path.join(__dirname,'fast20-diagnostic-20261004.audit.json'),JSON.stringify(report,null,2));
const table=['| Turn | Final delivery | Controller | Seconds | Model calls | Web searches / pages | Weather reads | Admitted PCM |','|---|---|---|---:|---:|---:|---:|---:|',...rows.map(t=>`| ${t.number} | ${t.status} | ${t.executionStatus} | ${t.durationSeconds ?? '-'} | ${t.modelToolCalls} | ${t.backendSearches} / ${t.backendPageReads} | ${t.backendWeatherReads} | ${t.admittedPcm} |`)];
fs.writeFileSync(path.join(__dirname,'fast20-diagnostic-20261004.transcript.md'),[
  '# Fast 20-request diagnostic conversation','',report.scope,'',report.sessionCaveat,'',...table,'',
  ...turns.flatMap(turn=>[`## Turn ${turn.number}`,'',turn.prompt,'',rows.find(t=>t.number===turn.number).lastVisibleReport || turn.error || 'Request still running.','']),
].join('\n'));
console.log(JSON.stringify({...report,rows:undefined,turns:undefined},null,2));
