const candidate = /(?<![A-Za-z0-9._-])[A-Za-z0-9][A-Za-z0-9._-]{23,}(?![A-Za-z0-9._-])/g;
const knownPrefix = /^(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$|oc_sk_|sk-[A-Za-z0-9_-]{40,}|sk-ant-|sk-or-v1-|sk-proj-|gsk_|csk-|AIza|ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|glpat-|hf_|xoxb-|xoxp-)/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hexHash = /^[0-9a-f]{40,}$/i;

function nearKeyLabel(text: string, index: number): boolean {
  return /\b(?:api\s*)?(?:key|token|credential)\s*(?:(?:is|=|:)\s*)?["'`(]?\s*$/i
    .test(text.slice(Math.max(0, index - 40), index));
}

export function redactApiKeys(value: string): string {
  const clean = value.includes("oc\\_sk\\_") ? value.replace(/\\_/g, "_") : value;
  const context = /\b(?:api\s*key|key|token|credential|secret)\b/i.test(clean);
  return clean.replace(candidate, (match, index: number) =>
    knownPrefix.test(match) || (context && !uuid.test(match) && !hexHash.test(match)
      && (nearKeyLabel(clean, index) || (match.length >= 32 && /[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match))))
      ? "[API key redacted]" : match);
}

export function isApiKeyCheck(value: string): boolean {
  const clean = value.replace(/\\_/g, "_").replace(/\s+/g, " ").trim();
  if (clean.length > 600) return false;
  if (/\b(?:make|build|create|implement|add|write|fix|research|develop|set\s*up|configure)\b/i.test(clean)) return false;
  if (/\b(?:do\s*not|don't|dont|not\s+for|without)\b.{0,35}\b(?:check|chk|test|verify|validate)\b/i.test(clean)) return false;
  const directCommand = /^\s*(?:(?:please|can\s+you)\s+)?(?:check|chk|test|verify|validate)\b/i.test(clean);
  const directQuestion = /^\s*(?:can|does|do|is|will)\b.{0,100}\b(?:api\s*key|key|token|credential)\b.{0,100}\b(?:work|access|valid|usable|supported?|use)\b/i.test(clean);
  const topic = /\b(?:api\s*key|key|token|credential|free\s+models?|routeway)\b|\b(?:oc_sk_|sk-ant-|sk-or-v1-|sk-proj-|gsk_|csk-|AIza|ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|glpat-|hf_|xoxb-|xoxp-)/i.test(clean);
  const supplied = [...clean.matchAll(candidate)].some(match =>
    !uuid.test(match[0]) && !hexHash.test(match[0]) && (knownPrefix.test(match[0])
      || nearKeyLabel(clean, match.index) || (match[0].length >= 32 && /[A-Z]/.test(match[0]) && /[a-z]/.test(match[0]) && /[0-9]/.test(match[0]))));
  const configured = /\b(?:my|configured|saved|current)\b.{0,50}\b(?:api\s*key|key|token)\b/i.test(clean);
  return (directCommand || directQuestion) && topic && (supplied || configured || directCommand);
}
