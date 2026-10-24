// Safe provider metadata for recovery. Never persist response bodies or headers.
function safeMessage(value) {
  return String(value ?? '').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:oc_sk_|sk-)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[redacted]').slice(0, 1800);
}
function retryAfterMs(headers, now = Date.now()) {
  const get = name => typeof headers?.get === 'function' ? headers.get(name)
    : Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const value = get('retry-after');
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) - now;
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 2147483647) : null;
}
function details(error) {
  const message = String(error?.message ?? error ?? '');
  const statusCode = Number(error?.statusCode ?? error?.status ?? message.match(/\bHTTP\s+(\d{3})\b/i)?.[1]) || null;
  const code = String(error?.providerCode ?? error?.code ?? error?.type ?? error?.cause?.code ?? '').slice(0, 100);
  const text = code + ' ' + message;
  let kind = 'fatal';
  if (error?.name === 'AbortError' || /\b(?:cancelled|canceled)\b/i.test(message)) kind = 'cancelled';
  else if (error?.terminalQuota === true || statusCode === 402 || /insufficient_quota|(?:insufficient|exhausted|exceeded|out of|no remaining|not enough).{0,40}(?:quota|credit|balance|budget)|(?:quota|credit|balance|billing|usage limit|daily limit).{0,50}(?:exhaust|exceed|insufficient|reached|empty|required)|payment required/i.test(text)) kind = 'quota';
  else if (statusCode === 401 || /invalid_api_key|authentication_error|unauthenticated/i.test(code)) kind = 'authentication';
  else if (statusCode === 403 || /FreeTierError|client_restricted/i.test(text)) kind = 'access';
  else if (statusCode === 429 || /rate[- ]?limit|too many requests/i.test(text)) kind = 'rate_limit';
  else if ([408,409,425,500,502,503,504].includes(statusCode) || /overloaded|temporarily unavailable|server is busy|capacity/i.test(text)) kind = 'transient';
  else if (![400,404,422].includes(statusCode) && !/authentication|invalid (?:model|session|request)|missing.{0,20}runtime|bounded system instruction|independent reviewer|permission/i.test(message)
    && /Model request timed out|Model stream ended before|fetch failed|cannot connect|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket|connection (?:closed|reset)|event connection|OpenCode is not running|OpenCode stopped|OpenCode startup timed out|forcibly closed|wsasend|EOF|closed network connection|socket hang up|returned neither text nor tool calls|raw was empty/i.test(text)) kind = 'transient';
  return { kind, statusCode, ...(code ? {code:safeMessage(code)} : {}),
    retryAfterMs:Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0 ? Math.min(error.retryAfterMs,2147483647) : null };
}
function providerError(message, {statusCode, code, headers, responseBody} = {}) {
  let body;
  if (typeof responseBody === 'string' && responseBody.length <= 100000) try { body=JSON.parse(responseBody); } catch {}
  const error = new Error(safeMessage(message));
  error.statusCode = Number(statusCode) || null;
  error.providerCode = safeMessage(body?.error?.code ?? body?.error?.type ?? body?.code ?? code ?? '').slice(0,100);
  error.retryAfterMs = retryAfterMs(headers);
  return error;
}
function recoveryMetadata(error) {
  const value = details(error);
  return {...value,message:safeMessage(error?.message ?? error)};
}
module.exports = { details, providerError, recoveryMetadata, retryAfterMs, safeMessage };
