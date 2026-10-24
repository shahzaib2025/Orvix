const models = require('../opencode-models.json');

async function checkOne(model, key, signal) {
  const endpoint = model.route === 'responses' ? 'responses' : 'chat/completions';
  const body = model.route === 'responses'
    ? { model: model.id.split('/')[1], input: [{ role: 'user', content: 'Reply OK' }], max_output_tokens: 16, store: false }
    : { model: model.id.split('/')[1], messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 16 };
  const timeout = AbortSignal.timeout(25000);
  try {
    const response = await fetch(`https://opencode.ai/zen/v1/${endpoint}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([signal, timeout]),
    });
    const data = await response.json().catch(() => null);
    const message = String(data?.error?.message ?? data?.message ?? '');
    const status = response.ok ? 'available'
      : response.status === 401 ? 'key_rejected'
      : response.status === 403 && /free tier can only be used from within OpenCode/i.test(message) ? 'client_restricted'
      : response.status === 403 ? 'access_denied'
      : response.status === 429 ? 'rate_limited' : 'provider_error';
    return { name: model.name, http: response.status, status };
  } catch {
    if (signal.aborted) throw new Error('Task cancelled.');
    return { name: model.name, http: null, status: timeout.aborted ? 'timeout' : 'network_error' };
  }
}

function formatResult(results) {
  const labels = {
    available: 'available', key_rejected: 'key rejected', client_restricted: 'blocked for independent clients',
    access_denied: 'access denied', rate_limited: 'rate limited', provider_error: 'provider error',
    timeout: 'timed out', network_error: 'network error',
  };
  const valid = results.some(item => item.status === 'available');
  const lines = results.map(item => `- ${item.name}: ${labels[item.status]}${item.http ? ` (HTTP ${item.http})` : ''}`);
  return `Zen free-model access through Orvix's direct API:\n${lines.join('\n')}\n\n${valid
    ? 'At least one model accepted the key. A blocked model can still work inside the official OpenCode client; this check does not test that client.'
    : 'No model accepted the key in this check. A 401 suggests the key was rejected; a client restriction or timeout does not prove the key is invalid.'}`;
}

async function checkZenFreeAccess(key, signal, onProgress) {
  if (typeof key !== 'string' || !/^oc_sk_[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error('Provide a valid OpenCode API key to check.');
  const results = [];
  for (const model of models.filter(item => item.id.startsWith('opencode/'))) {
    if (signal.aborted) throw new Error('Task cancelled.');
    onProgress?.(`Checking ${model.name}`);
    const result = await checkOne(model, key, signal);
    results.push(result);
    onProgress?.(`${model.name}: ${result.http ? `HTTP ${result.http}` : result.status}`);
  }
  return { results, text: formatResult(results) };
}

module.exports = { checkZenFreeAccess };
