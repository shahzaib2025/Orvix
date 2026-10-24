// Progress may renew an inactivity deadline, never the total request limit.
function createRequestDeadline({ timeoutMs, idleTimeoutMs, deferred = false } = {}) {
  const controller = new AbortController();
  let totalTimer, idleTimer, reason, started = false;
  const abort = value => { if (!controller.signal.aborted) { reason = value; controller.abort(); } };
  const positive = value => Number.isFinite(value) && value > 0;
  const progress = () => {
    if (!started || !positive(idleTimeoutMs) || controller.signal.aborted) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort('inactive'), idleTimeoutMs);
    idleTimer.unref?.();
  };
  const start = () => {
    if (started || controller.signal.aborted) return;
    started = true;
    if (positive(timeoutMs)) { totalTimer = setTimeout(() => abort('total'), timeoutMs); totalTimer.unref?.(); }
    progress();
  };
  if (!deferred) start();
  return { signal: controller.signal, start, progress, reason: () => reason,
    dispose() { clearTimeout(totalTimer); clearTimeout(idleTimer); } };
}
module.exports = { createRequestDeadline };
