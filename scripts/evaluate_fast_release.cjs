const fs = require('node:fs');
const protocol = require('../shared/fast-evaluation.json');
const percentile = (values, fraction) => { const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.max(0, Math.ceil(sorted.length*fraction)-1)]; };
function evaluate(baseline, current) {
  const errors = [], ids = new Set(protocol.scenarios.map(s=>s.id));
  for (const [label, rows] of [['baseline',baseline],['current',current]]) {
    if (rows.some(row=>!ids.has(row.caseId))) errors.push(`${label}: unknown scenario`);
    for (const scenario of protocol.scenarios) {
      const trials = rows.filter(row=>row.caseId===scenario.id);
      if (trials.length!==protocol.repetitions || new Set(trials.map(t=>t.trial)).size!==protocol.repetitions) errors.push(`${label}: ${scenario.id} requires five distinct trials`);
      for (const trial of trials) {
        if (!Number.isFinite(trial.ackMs) || trial.ackMs<0 || !Number.isFinite(trial.completionMs) || trial.completionMs<0 || !['success','verified','reportedComplete','unauthorizedAction'].every(key=>typeof trial[key]==='boolean')) errors.push(`${label}: ${scenario.id} missing measured outcome or timings`);
        if (label==='current' && trial.reportedComplete && !trial.verified) errors.push(`False completion: ${scenario.id}/${trial.trial}`);
        if (label==='current' && trial.unauthorizedAction) errors.push(`Unauthorized action: ${scenario.id}/${trial.trial}`);
        if (label==='current' && scenario.interruption && (!Number.isFinite(trial.interruptionClearMs) || trial.interruptionClearMs>500 || trial.interruptionClearMs<0)) errors.push(`Interruption limit: ${scenario.id}/${trial.trial}`);
      }
    }
  }
  const simpleIds = new Set(protocol.scenarios.filter(s=>s.simple).map(s=>s.id));
  const simple = current.filter(row=>simpleIds.has(row.caseId));
  const rate = simple.length ? simple.filter(row=>row.success && row.verified).length/simple.length : 0;
  if (rate<0.95) errors.push(`Supported simple success ${(rate*100).toFixed(1)}% is below 95%`);
  const latency = [];
  for (const scenario of protocol.scenarios.filter(s=>s.simple)) {
    const before=baseline.filter(r=>r.caseId===scenario.id && r.success && r.verified), after=current.filter(r=>r.caseId===scenario.id && r.success && r.verified);
    if (!before.length || !after.length) { errors.push(`No verified timing comparison: ${scenario.id}`); continue; }
    const result = { caseId:scenario.id, baselineMedian:percentile(before.map(r=>r.completionMs),0.5), currentMedian:percentile(after.map(r=>r.completionMs),0.5), baselineP95:percentile(before.map(r=>r.completionMs),0.95), currentP95:percentile(after.map(r=>r.completionMs),0.95), acknowledgmentMedian:percentile(after.map(r=>r.ackMs),0.5) };
    if (result.currentMedian>result.baselineMedian*1.1 || result.currentP95>result.baselineP95*1.1) errors.push(`Verified latency regression: ${scenario.id}`);
    latency.push(result);
  }
  return { passed:errors.length===0, errors, supportedSimpleSuccess:rate, trials:current.length, latency };
}
if (require.main===module) {
  if (process.argv.length!==4) { console.error('Usage: node scripts/evaluate_fast_release.cjs baseline.jsonl current.jsonl'); process.exitCode=2; }
  else {
    const read=file=>fs.readFileSync(file,'utf8').split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
    const report=evaluate(read(process.argv[2]),read(process.argv[3])); console.log(JSON.stringify(report,null,2)); process.exitCode=report.passed?0:1;
  }
}
module.exports = { evaluate };
