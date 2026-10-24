const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const endpoint = 'https://api.kilo.ai/api/gateway/models';
const ttl = 5 * 60 * 1000;
let models = [];
let updatedAt = 0;
let target;
let pending;
let error = '';
let retryAt = 0;
let getKey = () => '';
let account = '';
const fingerprint = key => key ? createHash('sha256').update(key).digest('hex') : '';

function normalizeCatalog(data) {
  if (!Array.isArray(data?.data)) throw new Error('Kilo returned an invalid model catalog.');
  const seen = new Set();
  return data.data.flatMap(item => {
    if (typeof item?.id !== 'string' || !/^[a-zA-Z0-9_.:/-]{1,200}$/.test(item.id) || seen.has(item.id)) return [];
    const free = item.isFree === true || (item.isFree === undefined && item.id.endsWith(':free'));
    const zeroPrice = item.pricing && ['prompt', 'completion'].every(key => item.pricing[key] !== undefined && Number(item.pricing[key]) === 0);
    const parameters = Array.isArray(item.supported_parameters) ? item.supported_parameters : [];
    const byok = item.id.startsWith('openai/') && item.opencode?.ai_sdk_provider === 'openai' && item.hasUserByokAvailable === true;
    if ((!byok && (!free || !zeroPrice)) || !parameters.includes('tools') || !item.architecture?.input_modalities?.includes('text')) return [];
    if (!byok && Object.entries(item.pricing).some(([key, value]) => key !== 'discount' && Number(value) > 0)) return [];
    if (item.expiration_date && Number.isFinite(Date.parse(item.expiration_date)) && Date.parse(item.expiration_date) + 86400000 <= Date.now()) return [];
    seen.add(item.id);
    const variants = {};
    if (parameters.includes('reasoning')) for (const [name, body] of Object.entries(item.opencode?.variants ?? {})) {
      const reasoning = body?.reasoning;
      if (!/^[a-z]{1,20}$/.test(name) || !reasoning || typeof reasoning.enabled !== 'boolean') continue;
      if (reasoning.effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoning.effort)) continue;
      if (byok && !reasoning.effort) continue;
      variants[name] = { enabled: reasoning.enabled, ...(reasoning.effort ? { effort: reasoning.effort } : {}) };
    }
    return [{ id: `kilo/${item.id}`, apiModelId: item.id, name: String(item.name || item.id).slice(0, 150), route: byok ? 'responses' : 'chat', access: byok ? 'byok' : 'free',
      input: item.architecture.input_modalities.filter(value => value === 'text' || value === 'image'),
      contextLength: Number(item.context_length) || null, variants, mayTrainOnPrompts: item.mayTrainOnYourPrompts === true,
      order: Number.isFinite(item.preferredIndex) ? item.preferredIndex : 999 }];
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function configureKiloCatalog(directory, keyReader = () => '') {
  models = []; updatedAt = 0; error = ''; retryAt = 0;
  getKey = keyReader;
  account = fingerprint(getKey());
  target = path.join(directory, 'kilo-model-catalog.json');
  try {
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    if ((saved.account || '') !== account) return;
    models = normalizeCatalog(saved.catalog);
    updatedAt = Number(saved.updatedAt) || 0;
  } catch { /* Fetch a fresh catalog if no valid cache exists. */ }
}
function snapshot() {
  let checks;
  if (target && account) try {
    const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(target), 'kilo-model-checks.json'), 'utf8'));
    if (saved.account === account && saved.testedAt && saved.models && typeof saved.models === 'object') checks = { testedAt: saved.testedAt, models: saved.models };
  } catch { /* No observed checks for this account yet. */ }
  return { models, updatedAt, stale: Date.now() - updatedAt >= ttl, error, ...(checks ? { checks } : {}) };
}
async function refreshKiloCatalog(force = false) {
  const key = getKey();
  const scope = fingerprint(key);
  if (scope !== account) { models = []; updatedAt = 0; error = ''; retryAt = 0; account = scope; }
  if (pending) return pending;
  if ((!force && Date.now() - updatedAt < ttl) || Date.now() < retryAt) return snapshot();
  pending = (async () => {
    try {
      const response = await fetch(endpoint, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error(`Kilo catalog request failed (${response.status}).`);
      const catalog = await response.json();
      const next = normalizeCatalog(catalog);
      if (fingerprint(getKey()) !== scope) throw new Error('Kilo account changed. Refresh the model list.');
      models = next; updatedAt = Date.now(); error = ''; retryAt = 0;
      if (target) {
        try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify({ updatedAt, account: scope, catalog })); }
        catch { /* A working catalog remains usable when its cache cannot be saved. */ }
      }
    } catch (failure) {
      error = failure.name === 'TimeoutError' ? 'Kilo catalog refresh timed out.' : String(failure.message || 'Kilo catalog refresh failed.').replaceAll(key || 'NO_KEY', '[redacted]');
      retryAt = Date.now() + 30000;
    }
    return snapshot();
  })().finally(() => { pending = null; });
  return pending;
}
function kiloModel(modelId) { return models.find(model => model.id === modelId); }
module.exports = { normalizeCatalog, configureKiloCatalog, refreshKiloCatalog, kiloModel };
