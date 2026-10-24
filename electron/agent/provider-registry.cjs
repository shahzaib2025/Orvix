const NARA_BASE_URL = 'https://router.bynara.id/v1';
const { baseUrl: ROUTEWAY_BASE_URL } = require('../../shared/routeway-models.json');
const { baseUrl: REQUESTY_BASE_URL } = require('../../shared/requesty-models.json');
const { baseUrl: INCEPTION_BASE_URL } = require('../../shared/inception-models.json');
function openCodeHeaders(route, key, sessionId) {
  const headers = {
    'Content-Type': 'application/json', Accept: 'text/event-stream',
    'x-opencode-session': sessionId, 'User-Agent': 'orvix-desktop/0.1.0',
  };
  if (route === 'messages') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.Authorization = `Bearer ${key}`;
  return headers;
}

const adapters = {
  kilo: { id: 'kilo', label: 'Kilo', credentialTier: 'kilo', baseUrl: 'https://api.kilo.ai/api/gateway',
    headers: (_route, key, sessionId) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream',
      Authorization: `Bearer ${key}`, 'X-KiloCode-TaskId': sessionId, 'X-KiloCode-Version': 'orvix-desktop/0.1.0' }), reasoningSummary: model => model.route === 'responses' },
  opencode: { id: 'opencode-zen', label: 'OpenCode Zen', credentialTier: 'zen', baseUrl: 'https://opencode.ai/zen/v1', headers: openCodeHeaders,
    reasoningSummary: model => model.route === 'responses' && /^gpt-/i.test(String(model.id).split('/')[1] ?? '') },
  'opencode-go': { id: 'opencode-go', label: 'OpenCode Go', credentialTier: 'go', baseUrl: 'https://opencode.ai/zen/go/v1', headers: openCodeHeaders,
    reasoningSummary: model => model.route === 'responses' && /^gpt-/i.test(String(model.id).split('/')[1] ?? '') },
  antigravity: { id: 'antigravity', label: 'Google Antigravity (I/O)', credentialTier: 'antigravity', baseUrl: 'http://127.0.0.1', headers: () => ({ 'Content-Type': 'application/json' }) },
  google: { id: 'google', label: 'Google Gemini', credentialTier: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
  groq: { id: 'groq', label: 'Groq', credentialTier: 'groq', baseUrl: 'https://api.groq.com/openai/v1', headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
  cerebras: { id: 'cerebras', label: 'Cerebras', credentialTier: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
  nara: { id: 'nara', label: 'Nara Router', credentialTier: 'nara', baseUrl: NARA_BASE_URL, headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
  routeway: { id: 'routeway', label: 'Routeway', credentialTier: 'routeway', baseUrl: ROUTEWAY_BASE_URL, headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
  requesty: { id: 'requesty', label: 'Requesty', credentialTier: 'requesty', baseUrl: REQUESTY_BASE_URL, headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
  inception: { id: 'inception', label: 'Inception AI', credentialTier: 'inception', baseUrl: INCEPTION_BASE_URL, headers: (_route, key) => ({ 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }) },
};

function providerFor(model) {
  const prefix = String(model.id).split('/')[0];
  const adapter = adapters[prefix];
  if (!adapter) throw new Error(`No provider adapter is registered for ${prefix}.`);
  const baseUrl = adapter.baseUrl;
  if (!baseUrl) throw new Error(`${adapter.label} endpoint is unavailable.`);
  return { ...adapter, baseUrl, acceptsImages: Array.isArray(model.input) && model.input.includes('image') };
}

module.exports = { providerFor, NARA_BASE_URL, ROUTEWAY_BASE_URL, REQUESTY_BASE_URL };
