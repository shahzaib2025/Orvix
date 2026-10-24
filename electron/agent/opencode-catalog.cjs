const fs = require('node:fs');
const path = require('node:path');
const { isModelNotFound } = require('./opencode-model-readiness.cjs');
const fallback = require('../opencode-models.json').filter(model => model.id.startsWith('opencode/'));
const disabledModels = [
  { id: 'opencode/space-bunny-free', name: 'Space Bunny Free', reason: 'Removed from Orvix at user request.' },
  { id: 'opencode/minimax-m3.1-flash-free', name: 'MiniMax M3.1 Flash Free', reason: 'The task worker could not resolve this model in the pinned OpenCode runtime.' },
  { id: 'opencode/ling-3.0-flash-fin-free', name: 'Ling 3.0 Flash Fin Free', reason: 'Removed from Orvix at user request after repeated provider model-unavailable errors.' },
  { id: 'opencode/exo-free', name: 'Exo Free', reason: 'The provider confirmed this model is deprecated (HTTP 410).' },
];
const disabledIDs = new Set(disabledModels.map(model => model.id));
const ttl = 6 * 60 * 60 * 1000;
const catalogSource = 'configured-providers-v1';
let runtime, target, pending, onChange = () => {}, retryAt = 0;
let retiredModels = new Map();
let state = { models: fallback.map(model => ({ ...model, variants: [] })), excluded: [], updatedAt: 0, stale: true, error: '' };
function normalizeFreeModels(providers, live) {
  const provider = (providers?.providers ?? providers?.all ?? []).find(item => item.id === 'opencode');
  if (!provider?.models || !Array.isArray(live?.data)) throw new Error('OpenCode returned an invalid free-model catalog.');
  const ids = new Set(live.data.map(item => item?.id).filter(id => typeof id === 'string'));
  const models = [], excluded = disabledModels.filter(model => ids.has(model.id.slice('opencode/'.length))).map(model => ({ ...model }));
  for (const item of Object.values(provider.models)) {
    if (!item || !/^[\w.-]{1,150}$/.test(item.id) || !ids.has(item.id) || disabledIDs.has(`opencode/${item.id}`)) continue;
    if (item.cost?.input !== 0 || item.cost?.output !== 0 || Object.values(item.cost?.cache ?? {}).some(value => value !== 0)) continue;
    if (item.cost?.tiers?.some(tier => tier.input !== 0 || tier.output !== 0)) continue;
    const caps = item.capabilities;
    if (!caps?.input?.text || !caps?.output?.text || !caps.toolcall) {
      excluded.push({ id: `opencode/${item.id}`, name: item.name || item.id, reason: 'This model does not advertise text responses and tool calling for the Orvix agent.' }); continue;
    }
    const npm = String(item.api?.npm ?? '');
    const route = /anthropic/.test(npm) ? 'messages' : /openai$/.test(npm) ? 'responses' : 'chat';
    models.push({ id: `opencode/${item.id}`, name: String(item.name || item.id).slice(0, 150), route,
      input: caps.input.image ? ['text', 'image'] : ['text'], supportsTemperature: caps.temperature === true,
      variants: Object.keys(item.variants ?? {}).filter(value => /^[\w-]{1,30}$/.test(value)),
      contextLength: Number(item.limit?.context) || null, outputLimit: Number(item.limit?.output) || null });
  }
  if (!models.length) throw new Error('OpenCode advertised no compatible free models. The previous catalog has been retained.');
  for (const id of ids) if ((id.endsWith('-free') || id === 'big-pickle') && !models.some(model => model.id === `opencode/${id}`) && !excluded.some(model => model.id === `opencode/${id}`)) excluded.push({ id: `opencode/${id}`, name: id, reason: 'No compatible free-agent metadata is advertised by this OpenCode runtime.' });
  return { models, excluded };
}
function configureOpenCodeCatalog(directory, service, notify = () => {}) {
  runtime = service; target = path.join(directory, 'opencode-free-catalog.json'); pending = null; retryAt = 0;
  retiredModels = new Map();
  onChange = notify;
  state = { models: fallback.map(model => ({ ...model, variants: [] })), excluded: [], updatedAt: 0, stale: true, error: '' };
  try {
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    for (const item of saved.retiredModels ?? []) if (/^opencode\/[\w.-]+$/.test(item?.id) && typeof item.reason === 'string') retiredModels.set(item.id, item);
    if (Number.isFinite(saved.updatedAt) && saved.updatedAt > 0 && saved.updatedAt <= Date.now() + 60000
      && Array.isArray(saved.models) && saved.models.every(model => /^opencode\/[\w.-]+$/.test(model.id)
        && typeof model.name === 'string' && ['chat', 'messages', 'responses'].includes(model.route)
        && Array.isArray(model.input) && model.input.includes('text') && model.input.every(value => ['text', 'image'].includes(value))
        && Array.isArray(model.variants) && model.variants.every(value => typeof value === 'string' && /^[\w-]{1,30}$/.test(value)))) {
      state = { ...state, models: saved.models, updatedAt: saved.updatedAt,
        excluded: Array.isArray(saved.excluded) ? saved.excluded.filter(item => typeof item?.id === 'string' && typeof item.name === 'string' && typeof item.reason === 'string') : [] };
    }
  } catch { /* The bundled list is an unverified offline fallback. */ }
  state.models = state.models.filter(model => !retiredModels.has(model.id) && !disabledIDs.has(model.id));
  state.excluded = [...state.excluded.filter(model => !disabledIDs.has(model.id)), ...disabledModels];
  const runtimeVersion = runtime?.status()?.runtimeVersion;
  if (runtimeVersion) {
    try { const saved = JSON.parse(fs.readFileSync(target, 'utf8')); if (saved.runtimeVersion !== runtimeVersion || saved.source !== catalogSource) state.updatedAt = 0; }
    catch { state.updatedAt = 0; }
  }
}
function saveCatalog() {
  try { fs.writeFileSync(`${target}.tmp`, JSON.stringify({ ...state, source: catalogSource, runtimeVersion: runtime?.status()?.runtimeVersion ?? null, retiredModels: [...retiredModels.values()] }), { mode: 0o600 }); fs.renameSync(`${target}.tmp`, target); } catch { /* A working in-memory catalog is still usable. */ }
}
function markOpenCodeModelUnavailable(id, error) {
  const message = String(error?.message ?? error);
  if (/^opencode\/[\w.-]+$/.test(id) && isModelNotFound(id, error)) {
    // Unlike confirmed retirement, resolver mismatches can recover on an
    // explicit catalog refresh. Hide the broken choice now and across restart.
    const model = state.models.find(model => model.id === id);
    if (!model) return false;
    const item = { id, name: model.name, reason: 'The task worker could not resolve this model. Refresh the model list to check its availability again.' };
    state = { ...state, models: state.models.filter(model => model.id !== id), excluded: [...state.excluded.filter(model => model.id !== id), item] };
    saveCatalog(); onChange(getOpenCodeCatalog()); return true;
  }
  if (!/^opencode\/[\w.-]+$/.test(id) || !/\b(?:deprecated|decommissioned|retired)\b/i.test(message)
    || !/HTTP 410\b|\bmodel\b/i.test(message)) return false;
  const model = state.models.find(model => model.id === id);
  const item = { id, name: model?.name || id, reason: 'The provider confirmed this model is retired.', recordedAt: Date.now() };
  retiredModels.set(id, item);
  state = { ...state, models: state.models.filter(model => model.id !== id), excluded: [...state.excluded.filter(model => model.id !== id), item] };
  saveCatalog(); onChange(getOpenCodeCatalog()); return true;
}
function getOpenCodeCatalog() { return { ...state, stale: !state.updatedAt || Date.now() - state.updatedAt >= ttl, runtime: runtime?.status() ?? null }; }
async function fetchLiveCatalog(signal) {
  // GET-only retry: never replay an agent prompt or already completed tool actions.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch('https://opencode.ai/zen/v1/models', { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15000)]), redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if (attempt === 0 && response.status >= 500) continue;
        throw new Error('Zen catalog request failed (HTTP ' + response.status + ').');
      }
      return await response.json();
    } catch (error) {
      signal?.throwIfAborted();
      const transient = /fetch failed|socket|network|connection|timed out|timeout/i.test(String(error.message)) || ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error.cause?.code);
      if (attempt === 0 && transient) continue;
      const code = /^[A-Z_0-9]{1,50}$/.test(error.cause?.code ?? '') ? ' (' + error.cause.code + ')' : '';
      throw new Error(String(error.message) + code, { cause: error });
    }
  }
}
async function refreshOpenCodeCatalog(force = false, signal) {
  if (!runtime) throw new Error('OpenCode headless service is not initialized.');
  if (pending) return pending;
  if ((!force && !state.error && !getOpenCodeCatalog().stale) || (!force && Date.now() < retryAt)) return getOpenCodeCatalog();
  pending = runtime.exclusive(signal, async ({ api,prepareLocation,workdir }) => {
    await prepareLocation?.(workdir,signal);
    const [providers, live] = await Promise.all([api('/config/providers', { signal }), fetchLiveCatalog(signal)]);
    const next = normalizeFreeModels(providers, live);
    state = { ...next, models: next.models.filter(model => !retiredModels.has(model.id)), excluded: [...next.excluded.filter(model => !retiredModels.has(model.id)), ...retiredModels.values()], updatedAt: Date.now(), stale: false, error: '' }; retryAt = 0;
    saveCatalog();
    const snapshot = getOpenCodeCatalog(); onChange(snapshot); return snapshot;
  }).catch(error => {
    if (signal?.aborted) throw error;
    state = { ...state, error: String(error.message || error).slice(0, 500) }; retryAt = Date.now() + 30000;
    return getOpenCodeCatalog();
  }).finally(() => { pending = null; });
  return pending;
}
function openCodeModel(id) { return disabledIDs.has(id) ? undefined : state.models.find(model => model.id === id); }
module.exports = { configureOpenCodeCatalog, getOpenCodeCatalog, refreshOpenCodeCatalog, openCodeModel, normalizeFreeModels, markOpenCodeModelUnavailable, fetchLiveCatalog };
