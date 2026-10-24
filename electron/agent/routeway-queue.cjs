const { abortableDelay } = require('./model-failure-policy.cjs');

// One app-wide inference at a time, shared by tasks, reviewers and API keys.
// Free-account limits are not multiplied by the number of stored keys.
let tail = Promise.resolve();
let nextStartAt = 0;

function waitForTurn(previous, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Task cancelled.'));
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal?.removeEventListener('abort', cancelled); reject(new Error('Task cancelled.')); };
    signal?.addEventListener('abort', cancelled, { once: true });
    previous.then(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, error => { signal?.removeEventListener('abort', cancelled); reject(error); });
    if (signal?.aborted) cancelled();
  });
}

async function withRoutewayRequest(options, request) {
  const previous = tail;
  let release;
  const completed = new Promise(resolve => { release = resolve; });
  tail = previous.then(() => completed);
  try {
    await waitForTurn(previous, options.signal);
    await abortableDelay(Math.max(0, nextStartAt - Date.now()), options.signal);
    if (options.signal?.aborted) throw new Error('Task cancelled.');
    if (options.isCredentialReady && !options.isCredentialReady()) throw new Error('The queued Routeway key is no longer ready. Check paused, removed or limited keys before retrying.');
    nextStartAt = Date.now() + 12100;
    return await request(options);
  } catch (error) {
    if (error.status === 429) nextStartAt = Math.max(nextStartAt, Date.now() + (error.retryAfterMs ?? 60000));
    // A failed or partly streamed free request must not consume quota in an
    // unlimited automatic retry loop. An explicit retry remains available.
    error.noRetry = true;
    throw error;
  } finally { release(); }
}

module.exports = { withRoutewayRequest };
