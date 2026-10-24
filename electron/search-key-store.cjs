const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const counters = () => ({ queries: 0, attempts: 0, successes: 0, credits: 0, cacheHits: 0, failures: 0, unknown: 0, fallbackCalls: 0, fallbackSuccesses: 0 });
function createSearchKeyStore(app, safeStorage, onChange = () => {}) {
  const target = path.join(app.getPath('userData'), 'search-keys.json');
  const canPersist = safeStorage.isEncryptionAvailable();
  const secrets = new Map();
  let storageError = '';
  let state = { revision: 0, keys: [], pools: [], pending: [], totals: counters(), providerCooldownUntil: 0, lastProvider: '', lastSearchAt: null };
  if (canPersist) {
    try {
      const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.keys) || !Array.isArray(saved.pools) || !Array.isArray(saved.pending)) throw new Error('Invalid storage');
      if (saved.pools.some(p => !p || typeof p.id !== 'string' || !Number.isSafeInteger(p.remaining) || p.remaining < 0)
        || saved.keys.some(k => !k || typeof k.id !== 'string' || typeof k.encrypted !== 'string' || typeof k.fingerprint !== 'string' || !saved.pools.some(p => p.id === k.poolId))
        || saved.pending.some(r => !r || typeof r.id !== 'string' || !['pending', 'unknown'].includes(r.status))) throw new Error('Invalid storage');
      state = { ...state, ...saved, totals: { ...counters(), ...saved.totals } };
      for (const key of state.keys) {
        try {
          secrets.set(key.id, safeStorage.decryptString(Buffer.from(key.encrypted, 'base64')));
          // A previous local encryption failure is recoverable; a provider rejection is not.
          if (key.status === 'invalid' && key.lastError === 'Saved key could not be decrypted. Delete and add it again.') {
            key.status = 'ready'; key.lastError = ''; state.revision++;
          }
        }
        catch { key.status = 'invalid'; key.lastError = 'Saved key could not be decrypted. Delete and add it again.'; }
      }
      // A process exit cannot prove whether a pending request was billed.
      for (const request of state.pending) if (request.status === 'pending') {
        request.status = 'unknown'; state.totals.unknown++;
        const key = state.keys.find(k => k.id === request.keyId); if (key) key.unknown++;
      }
    } catch (error) { if (error.code !== 'ENOENT') storageError = 'Search key storage could not be read. No stored data was overwritten.'; }
  }
  function snapshot() {
    const pools = state.pools.filter(pool => state.keys.some(key => key.poolId === pool.id));
    return { revision: state.revision, canPersist, storageError, lastProvider: state.lastProvider, lastSearchAt: state.lastSearchAt, providerCooldownUntil: state.providerCooldownUntil, unresolvedUnknown: state.pending.filter(r => r.status === 'unknown').length, totals: { ...state.totals },
      pools: pools.map(pool => ({ ...pool })),
      keys: state.keys.map(({ encrypted, fingerprint, ...key }) => {
        const pool = state.pools.find(p => p.id === key.poolId);
        return { ...key, remaining: pool?.remaining ?? 0, poolLabel: pool?.label ?? '',
          status: key.status === 'invalid' ? 'invalid' : !key.enabled ? 'paused' : !pool?.remaining ? 'exhausted' : state.providerCooldownUntil > Date.now() ? 'cooldown' : key.status === 'error' ? 'error' : 'ready' };
      }) };
  }
  function save() {
    if (storageError) throw new Error(storageError);
    if (canPersist) {
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target + '.tmp', JSON.stringify({ version: 1, ...state }), { mode: 0o600 });
        fs.renameSync(target + '.tmp', target);
      } catch { storageError = 'Search key usage could not be saved. Searches are paused to protect quota accounting.'; throw new Error(storageError); }
    }
    onChange(snapshot());
  }
  function requireHealthy() { if (storageError) throw new Error(storageError); }
  function amount(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Balance must be a non-negative whole number.'); return value; }
  function label(value) { const text = String(value || '').trim(); if (!text || text.length > 100) throw new Error('Enter a label of up to 100 characters.'); return text; }
  function add(input) {
    requireHealthy();
    const raw = typeof input?.key === 'string' ? input.key.trim() : '';
    if (!/^[a-zA-Z0-9_-]{20,256}$/.test(raw)) throw new Error('Enter a valid Serper API key.');
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    if (state.keys.some(key => key.fingerprint === fingerprint)) throw new Error('This key is already saved.');
    const name = label(input.label);
    let pool = input.poolId ? state.pools.find(p => p.id === input.poolId && state.keys.some(k => k.poolId === p.id)) : null;
    if (input.poolId && !pool) throw new Error('Select an existing account pool.');
    if (!pool) { pool = { id: randomUUID(), label: name, remaining: amount(input.remaining ?? 2500) }; state.pools.push(pool); }
    const id = randomUUID();
    const key = { id, label: name, poolId: pool.id, masked: '••••' + raw.slice(-4), fingerprint, enabled: true, status: 'ready', addedAt: Date.now(), lastUsedAt: null, lastError: '', attempts: 0, successes: 0, failures: 0, credits: 0, unknown: 0 };
    if (canPersist) key.encrypted = safeStorage.encryptString(raw).toString('base64');
    secrets.set(id, raw); state.keys.push(key); state.revision++; save(); return snapshot();
  }
  function update(id, input) {
    requireHealthy(); const key = state.keys.find(k => k.id === id); if (!key) throw new Error('Key no longer exists.');
    const nextLabel = input.label === undefined ? key.label : label(input.label);
    const nextBalance = input.remaining === undefined ? null : amount(input.remaining);
    if (nextBalance !== null && state.pending.some(r => r.poolId === key.poolId && r.status === 'pending')) throw new Error('Wait for active searches before reconciling this account balance.');
    key.label = nextLabel;
    if (typeof input.enabled === 'boolean') key.enabled = input.enabled;
    if (nextBalance !== null) {
      const pool = state.pools.find(p => p.id === key.poolId); pool.remaining = nextBalance; pool.exhausted = false;
      state.pending = state.pending.filter(r => r.poolId !== key.poolId);
      for (const member of state.keys.filter(k => k.poolId === key.poolId)) if (member.status !== 'invalid') { member.status = 'ready'; member.lastError = ''; }
    }
    state.revision++; save(); return snapshot();
  }
  function remove(id) {
    requireHealthy(); state.keys = state.keys.filter(k => k.id !== id); secrets.delete(id);
    state.pending = state.pending.filter(r => r.status === 'pending' || state.keys.some(k => k.poolId === r.poolId));
    state.pools = state.pools.filter(p => state.keys.some(k => k.poolId === p.id) || state.pending.some(r => r.poolId === p.id));
    state.revision++; save(); return snapshot();
  }
  function count(name) { requireHealthy(); if (!(name in state.totals)) throw new Error('Invalid counter.'); state.totals[name]++; save(); }
  function recordProvider(provider) { requireHealthy(); state.lastProvider = provider; state.lastSearchAt = Date.now(); save(); }
  function reserve(excluded = new Set()) {
    requireHealthy(); if (Date.now() < state.providerCooldownUntil) return null;
    const key = state.keys.find(k => k.enabled && k.status !== 'invalid' && !excluded.has(k.id) && secrets.has(k.id) && state.pools.find(p => p.id === k.poolId)?.remaining > 0);
    if (!key) return null;
    const pool = state.pools.find(p => p.id === key.poolId); pool.remaining--;
    const request = { id: randomUUID(), keyId: key.id, poolId: pool.id, status: 'pending', at: Date.now() };
    state.pending.push(request); key.attempts++; key.lastUsedAt = request.at; state.totals.attempts++; save();
    return { ...request, key: secrets.get(key.id) };
  }
  function settle(id, outcome, options = {}) {
    requireHealthy(); const request = state.pending.find(r => r.id === id && r.status === 'pending'); if (!request) return;
    const key = state.keys.find(k => k.id === request.keyId), pool = state.pools.find(p => p.id === request.poolId);
    if (outcome === 'success') {
      const credits = Number.isSafeInteger(options.credits) && options.credits >= 0 ? options.credits : 1;
      if (pool) pool.remaining = Math.max(0, pool.remaining + 1 - credits);
      state.totals.successes++; state.totals.credits += credits;
      if (key) { key.successes++; key.credits += credits; key.status = 'ready'; key.lastError = ''; }
    } else if (outcome === 'unknown') {
      request.status = 'unknown'; state.totals.unknown++;
      if (key) { key.unknown++; key.status = 'error'; key.lastError = 'Request outcome unknown; reserved credit retained. Reconcile with Serper dashboard.'; }
    } else {
      if (pool) pool.remaining++;
      state.totals.failures++; if (key) { key.failures++; key.lastError = options.message || 'Search request failed.'; key.status = outcome === 'invalid' ? 'invalid' : 'error'; }
      if (outcome === 'exhausted' && pool) pool.remaining = 0;
    }
    if (outcome !== 'unknown' || !state.keys.some(k => k.poolId === request.poolId)) state.pending = state.pending.filter(r => r.id !== id);
    state.pools = state.pools.filter(p => state.keys.some(k => k.poolId === p.id) || state.pending.some(r => r.poolId === p.id));
    if (options.cooldownMs) state.providerCooldownUntil = Date.now() + options.cooldownMs;
    if (outcome === 'exhausted' && pool) pool.exhausted = true;
    if (pool?.exhausted) pool.remaining = 0;
    save();
  }
  if (canPersist && !storageError) save();
  return { snapshot, add, update, remove, count, recordProvider, reserve, settle, revision: () => state.revision };
}
module.exports = { createSearchKeyStore };
