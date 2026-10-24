const crypto = require('node:crypto');

const providerEnvKeys = { google: 'ORVIX_GOOGLE_API_KEY', groq: 'ORVIX_GROQ_API_KEY', cerebras: 'ORVIX_CEREBRAS_API_KEY', nara: 'ORVIX_NARA_API_KEY', routeway: 'ORVIX_ROUTEWAY_API_KEY', requesty: 'ORVIX_REQUESTY_API_KEY', inception: 'ORVIX_INCEPTION_API_KEY' };
const providerMultiEnvKeys = Object.fromEntries(Object.entries(providerEnvKeys).map(([tier, name]) => [tier, `${name}S`]));
const idFor = (tier, key) => crypto.createHash('sha256').update(`${tier}:${key}`).digest('hex').slice(0, 24);

function createApiKeyStore({ readFile, readValue, writeValue, legacyKey, removeLegacy, now = Date.now, environment = process.env }) {
  const states = new Map();
  const cursors = new Map();
  function state(id) {
    if (!states.has(id)) states.set(id, { attempts: 0, successes: 0, failures: 0, cooldownUntil: 0, invalid: false });
    return states.get(id);
  }
  function entries(tier) {
    if (typeof tier !== 'string' || !Object.hasOwn(providerEnvKeys, tier)) throw new Error('Unknown API provider.');
    const contents = readFile();
    let saved = [];
    const raw = readValue(contents, providerMultiEnvKeys[tier]);
    if (raw) {
      try { saved = JSON.parse(raw); } catch { throw new Error(`The ${tier} key list in .env is invalid JSON. Repair that setting before changing keys.`); }
      if (!Array.isArray(saved) || saved.some(item => !item || typeof item.key !== 'string' || !item.key.trim() || item.key.length > 1024 || /[\r\n\0]/.test(item.key) || (item.enabled !== undefined && typeof item.enabled !== 'boolean') || (item.label !== undefined && typeof item.label !== 'string'))) throw new Error(`The ${tier} key list in .env is invalid.`);
    }
    const fileKey = readValue(contents, providerEnvKeys[tier]);
    const external = environment[providerEnvKeys[tier]]?.trim();
    const legacy = legacyKey(tier);
    const all = [
      ...(external ? [{ key: external, label: 'Environment key', source: 'environment' }] : []),
      ...saved.map(item => ({ ...item, source: 'file' })),
      ...(fileKey ? [{ key: fileKey, label: 'Original key', source: 'file' }] : []),
      ...(legacy ? [{ key: legacy, label: 'Previously saved key', source: 'secure-store' }] : []),
    ];
    const seen = new Set();
    return all.filter(item => { if (seen.has(item.key)) return false; seen.add(item.key); return true; }).map(item => ({
      id: idFor(tier, item.key), key: item.key, label: String(item.label || 'API key').slice(0, 80), enabled: item.enabled !== false, source: item.source,
    }));
  }
  function snapshot(tier) {
    return entries(tier).map(({ key, ...item }) => {
      const current = state(item.id);
      return { ...item, maskedKey: key.length > 8 ? `•••• ${key.slice(-4)}` : '••••••••', ...current,
        status: !item.enabled ? 'paused' : current.invalid ? 'invalid' : current.cooldownUntil > now() ? 'cooldown' : 'ready' };
    });
  }
  function change(tier, input) {
    if (!input || !['add', 'update', 'remove', 'toggle'].includes(input.operation)) throw new Error('Invalid key action.');
    const all = entries(tier);
    let item = all.find(entry => entry.id === input.id);
    if (input.operation !== 'add' && (!item || item.source === 'environment')) throw new Error('This key is missing or managed by an environment variable.');
    if (['add', 'update'].includes(input.operation)) {
      if (typeof input.key !== 'string' || !input.key.trim() || input.key.length > 1024 || /[\r\n\0]/.test(input.key)) throw new Error('Enter a valid API key on one line.');
      const key = input.key.trim();
      if (all.some(entry => entry.key === key && entry.id !== item?.id)) throw new Error('This key is already added to this provider.');
      const replacement = { id: idFor(tier, key), key, label: String(input.label || item?.label || `Key ${all.length + 1}`).trim().slice(0, 80), enabled: item?.enabled ?? true, source: 'file' };
      if (item) { all.splice(all.indexOf(item), 1, replacement); states.delete(item.id); }
      else all.push(replacement);
    } else if (input.operation === 'remove') { all.splice(all.indexOf(item), 1); states.delete(item.id); }
    else item.enabled = !item.enabled;
    writeValue(providerMultiEnvKeys[tier], JSON.stringify(all.filter(entry => entry.source !== 'environment').map(({ key, label, enabled }) => ({ key, label, enabled }))));
    writeValue(providerEnvKeys[tier], '');
    removeLegacy(tier);
  }
  function acquire(tier, excluded = new Set()) {
    const all = entries(tier);
    const start = cursors.get(tier) ?? 0;
    for (let offset = 0; offset < all.length; offset++) {
      const index = (start + offset) % all.length;
      const entry = all[index];
      const current = state(entry.id);
      if (!entry.enabled || excluded.has(entry.id) || current.invalid || current.cooldownUntil > now()) continue;
      cursors.set(tier, (index + 1) % all.length);
      current.attempts++;
      return entry;
    }
    return null;
  }
  function settle(entry, error) {
    const current = state(entry.id);
    if (!error) { current.successes++; return; }
    current.failures++;
    if (error.status === 401) current.invalid = true;
    if ([402, 429].includes(error.status)) current.cooldownUntil = now() + Math.max(1000, error.retryAfterMs ?? (error.terminalQuota ? 86400000 : 60000));
  }
  return { entries, snapshot, change, acquire, settle };
}

async function requestWithKeyPool(options, tier, store, requestModel) {
  const tried = new Set();
  let lastError;
  while (true) {
    if (options.signal?.aborted) throw new Error('Task cancelled.');
    const entry = store.acquire(tier, tried);
    if (!entry) {
      const error = new Error(lastError ? `No more eligible ${tier} keys for this request. ${lastError.message}` : `No ${tier} key is ready. Check paused or invalid keys and wait for rate-limit cooldowns to expire.`);
      error.noRetry = true;
      throw error;
    }
    tried.add(entry.id);
    try {
      const answer = await requestModel({ ...options, key: entry.key,
        isCredentialReady: () => store.snapshot(tier).some(item => item.id === entry.id && item.status === 'ready'),
      });
      store.settle(entry); return answer;
    }
    catch (error) {
      store.settle(entry, error);
      if (options.signal?.aborted || error.responseStarted || error.stopKeyRotation || ![401, 402, 429].includes(error.status)) throw error;
      lastError = error;
    }
  }
}

module.exports = { createApiKeyStore, requestWithKeyPool, providerEnvKeys, providerMultiEnvKeys };
