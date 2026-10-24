import { mentionedModelPublishers, type ModelPublisher } from './simpleFastResearch';

export function volatileResearch(text: string): boolean {
  return /\b(?:latest|letest|newest|current|recent|today|now|news|updates?|upcoming|rumou?rs?|leaks?|ashtese|ashche)\b|সর্বশেষ|সাম্প্রতিক|লেটেস্ট|বর্তমান|আপডেট|আসছে|ফাঁস|গুজব/i.test(text);
}

export function rumorResearch(text: string): boolean {
  return /\b(?:rumou?rs?|leaks?|unconfirmed|speculation)\b|গুজব|ফাঁস|লিক/i.test(text);
}

export function researchSearchPolicy(text: string): { refresh?: true; freshness?: 'oneWeek' | 'oneMonth' } {
  if (!volatileResearch(text)) return {};
  // Explicit historical questions must retain their requested date range.
  if (/\b(?:in|during|from|before|history|historical|back in)\s+(?:the\s+)?(?:19|20)\d{2}\b|\b(?:last year|years ago|history of)\b/i.test(text)) return { refresh: true };
  return { refresh: true, freshness: rumorResearch(text) || /\b(?:news|today)\b/i.test(text) ? 'oneWeek' : 'oneMonth' };
}

export type ResearchContinuation = { goal: string; publishers: ModelPublisher[]; continued: boolean; reference?: string };

// A short correction narrows the active topic. This is a search scope, never
// evidence that the referenced product actually belongs to that publisher.
export function resolveResearchContinuation(text: string, previous: string): ResearchContinuation {
  const explicit = mentionedModelPublishers(text), prior = mentionedModelPublishers(previous);
  const base = { goal: text, publishers: explicit, continued: false };
  if (/\b(?:don['’]?t|do not|never|stop|cancel|maybe|if)\b|\b(?:koro|khujo|search|check)\s+na\b|(?:করো|খুঁজো|সার্চ).{0,8}না|(?:\band|\bor|আর|এবং|নাকি|…|\.\.\.)\s*$/i.test(text)) return base;
  if (!prior.length || !/\b(?:gpt|gemini|models?|modelgula|konmodel)\b|মডেল|জেমিনি|জিপিটি/i.test(previous)) return base;
  if (text.trim().split(/\s+/).length > 12 || /https?:\/\/|\b(?:crypto|blockchain|chain|coin|token|weather|phone|speaker|new topic|instead|forget|search again for)\b|নতুন বিষয়|বাদ দাও/i.test(text)) return base;
  // Explicitly named new subjects such as "JBL latest model" start fresh.
  if (!explicit.length && /\b(?:latest|letest|newest)\b|লেটেস্ট|সর্বশেষ/i.test(text)) return base;
  const fragment = /\b(?:updates?|models?|er|about (?:it|that)|what about|gpt er|gemini er)\b|এর|মডেল|আপডেট/i.test(text);
  if (!fragment) return base;
  const publisherCorrection = explicit.length > 0 && /^(?:gpt|openai|chatgpt|gemini|google|জিপিটি|জেমিনি|গুগল)(?:\s+er|\s*এর)?[.!?। ]*$/i.test(text.trim());
  if (explicit.length && !publisherCorrection) return base;
  const previousReference = /Subject reference: ([^\n]+)/.exec(previous)?.[1];
  const reference = publisherCorrection ? previousReference :
    /^\s*([\p{L}\p{N}._-]+)(?:\s+er\b|\s+models?\b|\s+updates?\b|\s*মডেল|\s*এর)/iu.exec(text)?.[1] || previousReference;
  const publishers = explicit.length ? explicit : prior;
  const scope = publishers.map(p => p === 'OpenAI' ? 'OpenAI GPT' : 'Google Gemini').join(' and ');
  return { goal: `${scope} model updates\n${reference ? `Subject reference: ${reference}\n` : ''}User follow-up: ${text}`, publishers, continued: true, reference };
}

export function scopeContinuationQuery(query: string, context: ResearchContinuation): string {
  if (!context.continued) return query;
  const scope = context.publishers.map(p => p === 'OpenAI' ? 'OpenAI GPT' : 'Google Gemini').join(' ');
  if (/\b(?:crypto|blockchain|coin|chain|terra_money|terrabyte)\b/i.test(query) || mentionedModelPublishers(query).some(p=>!context.publishers.includes(p)))
    return `${scope} ${context.reference || ''} AI model updates announcements`.trim();
  const scoped=context.publishers.every(p=>mentionedModelPublishers(query).includes(p));
  const terms = [scoped?'':scope, context.reference&&!query.toLowerCase().includes(context.reference.toLowerCase())?context.reference:'', 'AI model', query];
  return terms.join(' ').replace(/\s+/g, ' ').trim();
}

export const temporalResearchInstruction = 'For time-sensitive research, report the lookup date and preserve each source URL, publication date when supplied, and retrieval time. Retrieval time is not publication time. Unknown dates remain unknown; a date filter does not prove freshness. Treat old articles as historical context, not current release status. For model rumors, read a relevant original report and the current official catalog before describing a release as upcoming or unannounced. Separate confirmed releases, attributed rumors, and unknown facts. A Reddit post or video title is a lead, not official confirmation. Never say a publisher has made no announcement merely because this search did not find one. Carry terse follow-ups and corrections within the active subject; verify the entity/publisher relationship, and ask one focused question if it remains ambiguous.';
