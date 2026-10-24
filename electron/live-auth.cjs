const MODELS = Object.freeze({
  Fast: process.env.GEMINI_FAST_MODEL || 'gemini-3.8-live',
  Thinking: 'gemini-3.8-live-extended-thinking',
});
const { GoogleGenAI } = require('@google/genai');
const { createHash } = require('node:crypto');
const keyIdentifier = key => createHash('sha256').update(key).digest('hex').slice(0,16);


function getCandidateApiKeys() {
  const priority = (process.env.GEMINI_API_KEY_PRIORITY || '159,97,jdhru,fbd')
    .split(',')
    .map(p => p.trim().toUpperCase())
    .filter(Boolean);
  const keys = [];
  for (const p of priority) {
    const key = process.env[`GEMINI_API_KEY_${p}`]?.trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  for (const [name, val] of Object.entries(process.env)) {
    if (name.startsWith('GEMINI_API_KEY_') && name !== 'GEMINI_API_KEY_PRIORITY') {
      const trimmed = val?.trim();
      if (trimmed && !keys.includes(trimmed)) keys.push(trimmed);
    }
  }
  return keys;
}

const pendingTokens = new Map();
function errorDetails(error, keys) {
  const statusValue = error?.status ?? error?.code;
  const status = /^\d{3}$/.test(String(statusValue)) ? Number(statusValue) : undefined;
  const code = error?.cause?.code ?? error?.cause?.cause?.code ?? (status ? undefined : error?.code);
  const redact = value => {
    let text = String(value ?? '');
    for (const key of keys) text = text.split(key).join('[REDACTED]');
    return text.replace(/AIza[\w-]+/g, '[REDACTED]').replace(/auth_tokens\/[^\s"']+/g, 'auth_tokens/[REDACTED]').replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]').slice(0, 1200);
  };
  const message = redact(error?.message);
  const cause = redact(error?.cause?.message);
  const timeout = /timeout|timed out|deadline/i.test(`${error?.name} ${code} ${message} ${cause}`);
  const network = /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|EHOST|ENET|UND_ERR_SOCKET/i.test(`${code} ${message} ${cause}`);
  const category = timeout ? 'timeout' : status >= 500 ? 'provider' : network ? 'network' : status === 429 ? 'quota' : [400, 401, 403].includes(status) ? 'credentials' : 'unknown';
  return {category, status, code: redact(code), name: redact(error?.name), message, cause};
}
function tokenFailure(details) {
  const suffix = details.status ? ` (HTTP ${details.status})` : details.code ? ` (${details.code})` : '';
  const messages = {
    timeout: 'Gemini session-token request timed out after a retry. Try again shortly.',
    network: 'Gemini session-token request failed at the network connection. Check DNS, proxy, firewall, and connectivity.',
    provider: 'Gemini returned a temporary server error after a retry. Try again shortly.',
    quota: 'Gemini rate limit reached across all keys. Try again shortly.',
    credentials: 'Gemini rejected all available API keys. Check their validity and API permissions.',
    unknown: 'Gemini session-token request failed. See the [LiveAuth] terminal diagnostic for the original error.',
  };
  return new Error(messages[details.category] + suffix);
}
async function issueLiveToken(apiKeys) {
  let lastDetails;
  for (let i = 0; i < apiKeys.length; i++) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      try {
        const ai = new GoogleGenAI({ apiKey: apiKeys[i], httpOptions: { apiVersion: 'v1beta', timeout: 15_000 } });
        const issued = await ai.authTokens.create({config: {
          uses: 16,
          expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 5 * 60_000).toISOString(),
        }});
        if (typeof issued.name !== 'string' || !issued.name) throw new Error('Gemini returned no session token.');
        console.info('[LiveAuth]', JSON.stringify({event:'token_issued', keyIndex:i, attempt, durationMs:Date.now()-started}));
        return {token:issued.name, keyId:keyIdentifier(apiKeys[i]), remainingKeys:apiKeys.length-i-1};
      } catch (error) {
        lastDetails = errorDetails(error, getCandidateApiKeys());
        const retry = ['timeout', 'network', 'provider'].includes(lastDetails.category) && attempt < 2;
        console.warn('[LiveAuth]', JSON.stringify({event:'token_request_failed', keyIndex:i, attempt, durationMs:Date.now()-started, ...lastDetails, retry}));
        if (retry) { await new Promise(resolve => setTimeout(resolve, 500)); continue; }
        if (['quota', 'credentials'].includes(lastDetails.category)) break;
        throw tokenFailure(lastDetails);
      }
    }
  }
  throw tokenFailure(lastDetails || {category:'unknown'});
}

async function createLiveToken(profile, depth = 'MEDIUM', recovery = {}) {
  const model = MODELS[profile];
  if (!model) throw new Error('Unknown voice profile.');
  if (profile === 'Thinking' && !['LOW', 'MEDIUM', 'HIGH'].includes(depth)) throw new Error('Unknown thinking depth.');
  
  if(!recovery || typeof recovery!=='object' || recovery.excludedKeyIds!==undefined && (!Array.isArray(recovery.excludedKeyIds) || recovery.excludedKeyIds.length>32 || recovery.excludedKeyIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{16}$/.test(id))))throw new Error('Invalid Live recovery options.');
  const excluded = new Set(recovery.excludedKeyIds || []);
  const apiKeys = getCandidateApiKeys().filter(key=>!excluded.has(keyIdentifier(key)));
  if(!apiKeys.length && excluded.size)throw new Error('Gemini Live quota is unavailable across the configured keys. Retry after the provider limit resets.');
  if (!apiKeys.length) throw new Error('Add GEMINI_API_KEY_159 to the app .env and restart Orvix.');

  const poolId = apiKeys.map(keyIdentifier).join(',');
  let pending = pendingTokens.get(poolId);
  if (!pending) {
    pending = issueLiveToken(apiKeys).finally(() => { if (pendingTokens.get(poolId) === pending) pendingTokens.delete(poolId); });
    pendingTokens.set(poolId, pending);
  } else console.info('[LiveAuth]', JSON.stringify({event:'token_request_shared', profile}));
  return {...await pending, model};
}

module.exports = { createLiveToken, getCandidateApiKeys };
