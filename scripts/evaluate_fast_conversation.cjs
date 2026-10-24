const fs = require('node:fs');
const protocol = require('../shared/fast-conversation-evaluation.json');
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
const measured = value => Number.isFinite(value) && value >= 0;
function evaluate(baseline, current) {
  const errors = [], ids = new Set(protocol.scenarios.map(s=>s.id));
  for (const [label, rows] of [['baseline',baseline],['current',current]]) {
    if (!Array.isArray(rows)) { errors.push(`${label}: expected trial rows`); continue; }
    if (rows.length !== protocol.scenarios.length * protocol.repetitions || rows.some(row=>!ids.has(row.caseId))) errors.push(`${label}: requires exactly 150 known scenario trials`);
    for (const scenario of protocol.scenarios) {
      const trials = rows.filter(row=>row.caseId===scenario.id);
      if (trials.length!==5 || new Set(trials.map(row=>row.trial)).size!==5 || trials.some(row=>!Number.isInteger(row.trial) || row.trial<1 || row.trial>5)) errors.push(`${label}: ${scenario.id} needs trials 1–5`);
      for (const row of trials) {
        if (row.evidenceKind !== 'real_microphone' || typeof row.reviewer !== 'string' || !row.reviewer.trim()) errors.push(`${label}: ${scenario.id}/${row.trial} needs real microphone evidence and human review`);
        if (!measured(row.firstAudibleMs) || scenario.action && !scenario.unresolved && !measured(row.verifiedCompletionMs)) errors.push(`${label}: ${scenario.id}/${row.trial} missing measured timings`);
        for (const field of ['success','questionsCovered','languageCorrect','reportedComplete','verified','unauthorizedAction','staleAudioResumed']) if (typeof row[field] !== 'boolean') errors.push(`${label}: ${scenario.id}/${row.trial} missing ${field}`);
        if (label==='current') {
          if (scenario.unresolved && row.reportedComplete) errors.push(`Unresolved scenario reported complete: ${scenario.id}/${row.trial}`);
          if (row.reportedComplete && !row.verified) errors.push(`False completion: ${scenario.id}/${row.trial}`);
          if (row.unauthorizedAction || row.staleAudioResumed) errors.push(`Unauthorized action or stale speech: ${scenario.id}/${row.trial}`);
          if (!row.questionsCovered || !row.languageCorrect) errors.push(`Coverage or language failure: ${scenario.id}/${row.trial}`);
          if (scenario.interruption && (!measured(row.interruptionClearMs) || row.interruptionClearMs>500)) errors.push(`Interruption limit: ${scenario.id}/${row.trial}`);
          if (!scenario.action && row.additionalModelRequests!==0) errors.push(`Extra conversational model request: ${scenario.id}/${row.trial}`);
          for (const field of ['professionalTone','clarity','coherence']) if (!Number.isFinite(row[field]) || row[field]<1 || row[field]>5) errors.push(`Missing human rating ${field}: ${scenario.id}/${row.trial}`);
        }
      }
    }
  }
  if (!Array.isArray(baseline) || !Array.isArray(current)) return {passed:false,errors};
  const rate = current.length ? current.filter(row=>row.success).length/current.length : 0;
  if (rate<0.95) errors.push('Supported scenario success is below 95%');
  const ratings = {};
  for (const field of ['professionalTone','clarity','coherence']) {
    ratings[field] = current.reduce((sum,row)=>sum+(Number.isFinite(row[field]) ? row[field] : 0),0)/Math.max(1,current.length);
    if (ratings[field]<4) errors.push(`${field} average is below 4/5`);
  }
  const latency = [];
  for (const scenario of protocol.scenarios) for (const field of ['firstAudibleMs', ...(scenario.action && !scenario.unresolved ? ['verifiedCompletionMs'] : [])]) {
    const before=baseline.filter(row=>row.caseId===scenario.id && row.success && measured(row[field]));
    const after=current.filter(row=>row.caseId===scenario.id && row.success && measured(row[field]));
    if (!before.length || !after.length) { errors.push(`Missing timing comparison: ${scenario.id}/${field}`); continue; }
    const comparison={caseId:scenario.id,metric:field,baselineMedian:percentile(before.map(row=>row[field]),0.5),currentMedian:percentile(after.map(row=>row[field]),0.5),baselineP95:percentile(before.map(row=>row[field]),0.95),currentP95:percentile(after.map(row=>row[field]),0.95)};
    if (comparison.currentMedian>comparison.baselineMedian*1.1 || comparison.currentP95>comparison.baselineP95*1.1) errors.push(`Latency regression: ${scenario.id}/${field}`);
    latency.push(comparison);
  }
  return {passed:errors.length===0,errors,successRate:rate,ratings,trials:current.length,latency};
}
if (require.main===module) {
  if (process.argv.length!==4) { console.error('Usage: npm run evaluate:fast-conversation -- baseline.jsonl current.jsonl'); process.exitCode=2; }
  else {
    try {
      const read=file=>fs.readFileSync(file,'utf8').split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
      const report=evaluate(read(process.argv[2]),read(process.argv[3]));console.log(JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
    } catch (error) {console.error(error.message);process.exitCode=2;}
  }
}
module.exports={evaluate};
