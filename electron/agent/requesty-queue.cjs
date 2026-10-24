const { abortableDelay } = require('./model-failure-policy.cjs');

// Keep Agent requests to the same Requesty account from colliding at its
// organization concurrency limit. The cooldown applies across stored keys.
let tail = Promise.resolve();
let blockedUntil = 0;

function waitForTurn(previous, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Task cancelled.'));
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal?.removeEventListener('abort', cancelled); reject(new Error('Task cancelled.')); };
    signal?.addEventListener('abort', cancelled, { once: true });
    previous.then(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, () => { signal?.removeEventListener('abort', cancelled); resolve(); });
    if (signal?.aborted) cancelled();
  });
}

async function withRequestyRequest(options, request, now = Date.now) {
  const previous = tail;
  let release;
  const completed = new Promise(resolve => { release = resolve; });
  tail = previous.then(() => completed);
  try {
    await waitForTurn(previous, options.signal);
    await abortableDelay(Math.max(0, blockedUntil - now()), options.signal);
    if (options.signal?.aborted) throw new Error('Task cancelled.');
    if (options.isCredentialReady && !options.isCredentialReady()) throw new Error('The queued Requesty key is no longer ready. Check paused, removed or limited keys before retrying.');
    return await request(options);
  } catch (error) {
    if (error.status === 429) {
      blockedUntil = Math.max(blockedUntil, now() + Math.max(1000, error.retryAfterMs ?? 60000));
      error.stopKeyRotation = true;
      error.noRetry = true;
    }
    throw error;
  } finally { release(); }
}

module.exports = { withRequestyRequest };
