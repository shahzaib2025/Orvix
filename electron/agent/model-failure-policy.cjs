const { details } = require('./provider-failure.cjs');
function terminalQuota(error) { return details(error).kind === 'quota'; }
function transientFailure(error) {
  if (error?.noRetry || error?.keyRotationEligible) return false;
  return ['transient','rate_limit'].includes(details(error).kind);
}
function retryDelay(attempt, base = 2000, maximum = 60000) {
  return Math.min(maximum, base * 2 ** Math.min(20, Math.max(0, attempt - 1)));
}
function providerRetryDelay(error, attempt, base = 2000, maximum = 60000) {
  return Math.max(retryDelay(attempt,base,maximum),details(error).retryAfterMs ?? 0);
}
function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Task cancelled.'));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Task cancelled.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
module.exports = { terminalQuota, transientFailure, retryDelay, providerRetryDelay, abortableDelay };
