const { checkZenFreeAccess } = require('./zen-key-check.cjs');

const providers = [
  { id: 'routeway', name: 'Routeway', names: /\brouteway\b/i },
  { id: 'requesty', name: 'Requesty', names: /\brequesty\b/i, url: 'https://router.requesty.ai/v1/models' },
  { id: 'inception', name: 'Inception AI', names: /\binception(?:\s+ai|\s+labs)?\b/i, url: 'https://api.inceptionlabs.ai/v1/chat/completions/models' },
  { id: 'kilo', name: 'Kilo', names: /\bkilo(?:\s*code)?\b/i },
  { id: 'openai', name: 'OpenAI', names: /\bopenai\b/i, url: 'https://api.openai.com/v1/models' },
  { id: 'anthropic', name: 'Anthropic', names: /\b(?:anthropic|claude)\b/i, url: 'https://api.anthropic.com/v1/models', headers: { 'anthropic-version': '2023-06-01' } },
  { id: 'gemini', name: 'Google Gemini', names: /\b(?:gemini|google\s+ai(?:\s+studio)?)\b/i, url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', keyHeader: 'x-goog-api-key' },
  { id: 'openrouter', name: 'OpenRouter', names: /\bopenrouter\b/i, url: 'https://openrouter.ai/api/v1/key' },
  { id: 'groq', name: 'Groq', names: /\bgroq\b/i, url: 'https://api.groq.com/openai/v1/models' },
  { id: 'mistral', name: 'Mistral', names: /\bmistral\b/i, url: 'https://api.mistral.ai/v1/models' },
  { id: 'xai', name: 'xAI', names: /\b(?:xai|x\.ai)\b/i, url: 'https://api.x.ai/v1/models' },
  { id: 'deepseek', name: 'DeepSeek', names: /\bdeepseek\b/i, url: 'https://api.deepseek.com/models' },
  { id: 'cerebras', name: 'Cerebras', names: /\bcerebras\b/i, url: 'https://api.cerebras.ai/v1/models' },
  { id: 'nara', name: 'Nara Router', names: /\b(?:nara(?:\s*router)?|nararouter)\b/i, url: 'https://router.bynara.id/v1/models' },
  { id: 'github', name: 'GitHub', names: /\bgithub\b/i, url: 'https://api.github.com/user', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } },
  { id: 'gitlab', name: 'GitLab.com', names: /\bgitlab\b/i, url: 'https://gitlab.com/api/v4/user' },
  { id: 'huggingface', name: 'Hugging Face', names: /\b(?:hugging\s*face|huggingface)\b/i, url: 'https://huggingface.co/api/whoami-v2' },
  { id: 'slack', name: 'Slack', names: /\bslack\b/i, url: 'https://slack.com/api/auth.test', method: 'POST', jsonOk: true },
  { id: 'opencode', name: 'OpenCode Zen', names: /\b(?:opencode|zen)\b/i },
];
const keyWords = /\b(?:api\s*key|key|token|credential|free\s+models?)\b/i;
const recognizable = /\b(?:oc_sk_|rqsty-sk-|sk-[A-Za-z0-9_-]{40,}|sk-ant-|sk-or-v1-|sk-proj-|gsk_|csk-|AIza|ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|glpat-|hf_|xoxb-|xoxp-)[A-Za-z0-9._-]{16,}\b/i;
const candidate = /(?<![A-Za-z0-9._-])[A-Za-z0-9][A-Za-z0-9._-]{23,}(?![A-Za-z0-9._-])/g;
const requestyKey = /\brqsty-sk-[A-Za-z0-9+/=_-]{16,}/i;
const knownPrefix = /^(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$|oc_sk_|rqsty-sk-|sk-[A-Za-z0-9_-]{40,}|sk-ant-|sk-or-v1-|sk-proj-|gsk_|csk-|AIza|ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|glpat-|hf_|xoxb-|xoxp-)/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hexHash = /^[0-9a-f]{40,}$/i;

function nearKeyLabel(text, index) {
  return /\b(?:api\s*)?(?:key|token|credential)\s*(?:(?:is|=|:)\s*)?["'`(]?\s*$/i
    .test(text.slice(Math.max(0, index - 40), index));
}

function redactApiKeys(value) {
  if (typeof value !== 'string') return value;
  const normalized = value.includes('oc\\_sk\\_') ? value.replace(/\\_/g, '_') : value;
  const clean = normalized.replace(/\brqsty-sk-[A-Za-z0-9+/=_-]{16,}/gi, '[API key redacted]');
  const context = /\b(?:api\s*key|key|token|credential|secret)\b/i.test(clean);
  // Linear token scan also handles large unbroken source/log lines without RegExp stack overflow.
  return clean.replace(/[A-Za-z0-9._-]+/g, (match, index) =>
    match.length >= 24 && /^[A-Za-z0-9]/.test(match) && (knownPrefix.test(match) || (context && !uuid.test(match) && !hexHash.test(match)
      && (nearKeyLabel(clean, index) || (match.length >= 32 && /[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match))))) ? '[API key redacted]' : match);
}

// The access report is only for a direct credential-check request. A task that
// mentions a key while asking the agent to build something must reach the agent.
function directKeyCheckIntent(message) {
  const clean = message.replace(/\\_/g, '_').replace(/\s+/g, ' ').trim();
  if (clean.length > 600) return false;
  if (/\b(?:make|build|create|implement|add|write|fix|research|develop|set\s*up|configure)\b/i.test(clean)) return false;
  if (/\b(?:do\s*not|don't|dont|not\s+for|without)\b.{0,35}\b(?:check|chk|test|verify|validate)\b/i.test(clean)) return false;
  const directCommand = /^\s*(?:(?:please|can\s+you)\s+)?(?:check|chk|test|verify|validate)\b/i.test(clean);
  const directQuestion = /^\s*(?:can|does|do|is|will)\b.{0,100}\b(?:api\s*key|key|token|credential)\b.{0,100}\b(?:work|access|valid|usable|supported?|use)\b/i.test(clean);
  return (directCommand || directQuestion) && (keyWords.test(clean) || recognizable.test(clean));
}

function requestedKeyCheck(message) {
  if (typeof message !== 'string') return null;
  const clean = message.replace(/\\_/g, '_');
  if (!directKeyCheckIntent(clean)) return null;
  const named = providers.filter(provider => provider.names.test(clean));
  const candidates = [...clean.matchAll(candidate)];
  const supplied = requestyKey.exec(clean)?.[0] ?? candidates.find(match => knownPrefix.test(match[0]))?.[0]
    ?? candidates.find(match => !uuid.test(match[0]) && !hexHash.test(match[0])
      && nearKeyLabel(clean, match.index))?.[0]
    ?? candidates.find(match => !uuid.test(match[0]) && !hexHash.test(match[0])
      && match[0].length >= 32 && /[A-Z]/.test(match[0]) && /[a-z]/.test(match[0]) && /[0-9]/.test(match[0]))?.[0]
    ?? null;
  if (!supplied && !/\b(?:my|configured|saved|current)\b.{0,50}\b(?:api\s*key|key|token)\b/i.test(clean)
    && !/^\s*(?:check|chk|test|verify|validate)\b/i.test(clean)) return null;
  let provider = named.length === 1 ? named[0] : null;
  if (!provider && named.length === 0 && supplied) {
    if (supplied.startsWith('rqsty-sk-')) provider = providers.find(item => item.id === 'requesty');
    else if (supplied.startsWith('oc_sk_')) provider = providers.find(item => item.id === 'opencode');
    else if (supplied.startsWith('sk-ant-')) provider = providers.find(item => item.id === 'anthropic');
    else if (supplied.startsWith('sk-or-v1-')) provider = providers.find(item => item.id === 'openrouter');
    else if (supplied.startsWith('sk-proj-')) provider = providers.find(item => item.id === 'openai');
    else if (supplied.startsWith('gsk_')) provider = providers.find(item => item.id === 'groq');
    else if (supplied.startsWith('csk-')) provider = providers.find(item => item.id === 'cerebras');
    else if (supplied.startsWith('AIza')) provider = providers.find(item => item.id === 'gemini');
    else if (/^(?:ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(supplied)) provider = providers.find(item => item.id === 'github');
    else if (supplied.startsWith('glpat-')) provider = providers.find(item => item.id === 'gitlab');
    else if (supplied.startsWith('hf_')) provider = providers.find(item => item.id === 'huggingface');
    else if (/^xox[bp]-/.test(supplied)) provider = providers.find(item => item.id === 'slack');
  }
  return { supplied, provider: provider ?? null, ambiguous: named.length > 1,
    opencodeTier: /\b(?:opencode\s+go|go\s+plan|go\s+key)\b/i.test(clean) ? 'go' : 'zen' };
}

async function checkApiKey(request, configuredKeys, signal, onProgress) {
  if (!request.provider) return request.ambiguous
    ? 'Several providers were named. Say which provider issued the API key, then ask me to check it.'
    : 'I could not identify a supported provider for this key. Name its issuer. I can check OpenCode, Kilo, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, xAI, DeepSeek, Cerebras, Nara Router, Requesty, Inception AI, GitHub, GitLab.com, Hugging Face, Slack, and Routeway. No key was sent.';
  const { provider } = request;
  const key = request.supplied ?? configuredKeys?.[provider.id === 'opencode' ? request.opencodeTier : provider.id === 'gemini' ? 'google' : provider.id];
  if (!key) return `Provide the ${provider.name} API key to check. I will not save it in task history.`;
  if (key.length > 512 || /[^\x21-\x7e]/.test(key)) return 'The key format is invalid.';
  const prefixOwner = key.startsWith('oc_sk_') ? 'opencode' : key.startsWith('sk-ant-') ? 'anthropic'
    : key.startsWith('sk-or-v1-') ? 'openrouter' : key.startsWith('sk-proj-') ? 'openai'
    : key.startsWith('gsk_') ? 'groq' : key.startsWith('csk-') ? 'cerebras'
    : key.startsWith('AIza') ? 'gemini'
    : /^(?:ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(key) ? 'github'
    : key.startsWith('glpat-') ? 'gitlab' : key.startsWith('hf_') ? 'huggingface'
    : /^xox[bp]-/.test(key) ? 'slack' : key.startsWith('rqsty-sk-') ? 'requesty' : null;
  if (prefixOwner && prefixOwner !== provider.id) return 'The key prefix and named provider do not match. Name the provider that issued this key.';
  if (provider.id === 'opencode') {
    if (request.opencodeTier === 'go') return 'OpenCode Go access is model-specific. A key-only check cannot confirm your Go plan. Send a small request using a Go model in Agent to verify it; that request may use provider credits. No request was sent for this check.';
    const result = await checkZenFreeAccess(key, signal, onProgress);
    return result.text;
  }
  if (provider.id === 'kilo') return 'Kilo model listings are public and cannot verify a key. Select a free Kilo model in Agent and send a small request to test authenticated generation. No inference request was sent for this key-only check.';
  if (provider.id === 'routeway') return 'Routeway model listings are public and cannot verify a key. Select Routeway and a free model in Agent, then send a small request to verify authenticated generation. That request uses the shared free daily quota. No inference request was sent for this key-only check.';
  onProgress?.(`Checking ${provider.name} API access`);
  const timeout = AbortSignal.timeout(20000);
  try {
    const headers = { ...(provider.headers ?? {}), [provider.keyHeader ?? 'Authorization']: provider.keyHeader ? key : `Bearer ${key}` };
    const response = await fetch(provider.url, { method: provider.method ?? 'GET', headers, redirect: 'error', signal: AbortSignal.any([signal, timeout]) });
    if (response.ok && provider.jsonOk) {
      const body = await response.json().catch(() => null);
      if (body?.ok !== true) return `${provider.name}: authentication not accepted (${String(body?.error ?? 'unknown error').replace(/[^a-z0-9_-]/gi, '').slice(0, 80)}).`;
    }
    if (response.ok && provider.id === 'inception') {
      const body = await response.json().catch(() => null);
      const models = Array.isArray(body?.data) ? body.data.map(item => item?.id).filter(id => typeof id === 'string' && /^mercury-[\w.-]{1,64}$/.test(id)) : [];
      return models.length
        ? `Inception AI: key accepted (HTTP ${response.status}). The account's chat model list includes ${models.join(', ')}. Orvix's selector contains the documented Mercury 3, 2.5, and 2 models; account access can differ.`
        : `Inception AI: key accepted (HTTP ${response.status}), but its chat model list did not contain a recognized Mercury model ID. Check your Inception account's model access.`;
    }
    if (response.ok) return `${provider.name}: key accepted (HTTP ${response.status}). This access check confirms authentication, but does not prove that every model or resource is enabled or that quota remains.`;
    if (response.status === 401) return `${provider.name}: key rejected (HTTP 401).`;
    if (response.status === 403) return `${provider.name}: access denied (HTTP 403). The key may be valid but lack permission for this endpoint.`;
    if (response.status === 429) return `${provider.name}: rate limited (HTTP 429). This does not prove the key is invalid.`;
    return `${provider.name}: provider returned HTTP ${response.status}. Authentication is unconfirmed.`;
  } catch {
    if (signal.aborted) throw new Error('Task cancelled.');
    return `${provider.name}: ${timeout.aborted ? 'request timed out' : 'network request failed'}. Authentication is unconfirmed.`;
  }
}

module.exports = { requestedKeyCheck, checkApiKey, redactApiKeys };
