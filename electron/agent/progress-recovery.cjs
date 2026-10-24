const crypto = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function createProgressRecovery(previous) {
  const state = { observations: [], sinceProgress: 0, recoveries: 0, cooldown: 0, fingerprint: '', ...previous };
  function observe(name, args, output, evidenceId, fingerprint, meaningful = false, failure = false) {
    const signature = digest(JSON.stringify([name, canonical(args)]));
    const result = digest(String(output));
    const repeats = state.observations.filter(item => item.signature === signature && item.result === result).length;
    const failed = failure || /^Error:|^Exit [1-9]/.test(String(output));
    const planFailure = failed && /Acceptance coverage needs revision:/.test(String(output));
    const repeatedPlanFailure = planFailure && state.observations.slice(-3).some(item => item.planFailure);
    const reviewFailure = failed && /Independent check review:|Incompatible verification phase|is required\.|Reproduction requires/.test(String(output));
    const repeatedReviewFailure = reviewFailure && state.observations.slice(-3).some(item => item.reviewFailure);
    if (meaningful || state.fingerprint && state.fingerprint !== fingerprint) state.sinceProgress = 0;
    else state.sinceProgress++;
    state.fingerprint = fingerprint;
    state.observations.push({ name, signature, result, evidenceId, failed, planFailure, reviewFailure });
    state.observations = state.observations.slice(-48);
    if (state.cooldown > 0) { state.cooldown--; return null; }
    const cycle = state.sinceProgress >= 12 && state.observations.slice(-6).every(item =>
      state.observations.filter(other => other.signature === item.signature && other.result === item.result).length > 1);
    if (!(repeats >= 2 || failed && repeats >= 1 || cycle || repeatedReviewFailure || repeatedPlanFailure)) return null;
    state.recoveries++; state.cooldown = 5;
    const reason = failed ? 'The same failing action returned unchanged evidence.' : 'Repeated exploration returned unchanged evidence without advancing the task.';
    return { reason, recovery: state.recoveries, evidenceIds: state.observations.slice(-6).map(item => item.evidenceId),
      instruction: `Progress recovery ${state.recoveries}: ${reason} Reconsider the current hypothesis. Choose the smallest unverified requirement using the supplied task map. ${planFailure ? 'The acceptance plan blocked this action before it ran. Do not retry the same edit or submit an empty execution-map update. Inspect the actual uncovered criteria and revise the relevant requirement or report the concrete blocker. ' : ''}${reviewFailure ? 'Do not revise the same compound command again. Link only compatible phases and select acceptance_ids for code behavior actually asserted. Final reply and preservation/scope are observed separately at finalization. Rejected proposals did not run. ' : ''}Reuse saved evidence with read_evidence instead of repeating broad reads. Narrow the next check, change the hypothesis, or explain a concrete blocker. Continue working; there is no step, tool-call, or time budget. Recent evidence IDs: ${state.observations.slice(-6).map(item => item.evidenceId).join(', ')}.` };
  }
  return { observe, snapshot: () => structuredClone(state) };
}
module.exports = { createProgressRecovery };
