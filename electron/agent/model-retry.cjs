const { request } = require('./model-client.cjs');
const { transientFailure, providerRetryDelay, abortableDelay } = require('./model-failure-policy.cjs');

// Executor requests wait through temporary outages without restarting tools.
// Independent reviews and explicit bounded policies retain their own limits.
const maxRetries = 2;

function retryable(error) {
  return transientFailure(error);
}

async function requestWithRetry(options, onRetry, requestModel = request) {
  const { retryPolicy, ...requestOptions } = options;
  const retryLimit = Number.isInteger(retryPolicy?.maxRetries)
    ? Math.max(0, retryPolicy.maxRetries)
    : options.purpose ? maxRetries : Infinity;
  const baseDelayMs = Number.isFinite(retryPolicy?.baseDelayMs) ? Math.max(0, retryPolicy.baseDelayMs) : 2000;
  const maxDelayMs = Number.isFinite(retryPolicy?.maxDelayMs) ? Math.max(0, retryPolicy.maxDelayMs) : 120000;
  for (let retry = 0; ; retry++) {
    const progressIds = new Set();
    try {
      return await requestModel({ ...requestOptions, onProgress: progress => {
        progressIds.add(progress.id);
        options.onProgress?.(progress);
      } });
    } catch (error) {
      if (options.signal?.aborted || !retryable(error) || retry >= retryLimit) throw error;
      const delayMs = providerRetryDelay(error, retry + 1, baseDelayMs, Math.min(60000, maxDelayMs));
      onRetry?.({ attempt: retry + 1, retryLimit, delayMs, progressIds: [...progressIds], error });
      await abortableDelay(delayMs, options.signal);
    }
  }
}

module.exports = { requestWithRetry };
