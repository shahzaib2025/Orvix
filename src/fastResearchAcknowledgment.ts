import type { ProgressContext } from './fastProgressVoice';

export type ResearchNotice = { subject: string; previousText: string };
const normalized = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/জিপিটি|জিপিটিই|চ্যাটজিপিটি|chatgpt/g, 'gpt').replace(/ওপেন\s*এ\s*আই/g, 'openai')
  .replace(/জেমিনি|জেমিনাই/g, 'gemini').replace(/গুগল/g, 'google').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The executor already sanitized operation.subject. Never derive speech from
// fetched page content, URL queries, entered values, or raw tool arguments.
export function researchNotice(context: ProgressContext, previousText: string, hasPrevious: boolean): ResearchNotice | undefined {
  if (!hasPrevious || !['web_search', 'read_web_page'].includes(context.operation?.name || '')) return;
  const subject = (context.operation?.subject || 'the requested topic')
    .replace(/https?:\/\/\S+|site:\S+/gi, ' ').replace(/[\r\n<>`{}]/g, ' ')
    .replace(/\b(?:latest|current|official|search|find|information|about)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ').slice(0, 80).trim();
  return { subject: subject || 'the requested topic', previousText };
}

export function matchesResearchNotice(text: string, notice?: ResearchNotice): boolean {
  if (!notice) return true;
  const spoken = normalized(text), previous = normalized(notice.previousText);
  if (!spoken || spoken === previous) return false;
  // Brand/topic anchors must survive paraphrasing; instruction asks the model
  // to retain this supplied label so a translated generic "page" cannot pass.
  const subject = normalized(notice.subject);
  const brand = subject.match(/\b(gpt|openai|gemini|google)\b/);
  if (brand) return new RegExp(`\\b${brand[1]}\\b`).test(spoken);
  const terms = subject.split(' ').filter(word => word.length > 2 && !['the', 'requested', 'topic', 'models', 'model', 'page', 'docs'].includes(word));
  return terms.length ? terms.some(term => spoken.includes(term)) : spoken.includes(subject);
}

// Failure-only installed-voice wording keeps the same subject guarantee.
export function researchNoticeFallback(context: ProgressContext, language: 'bn' | 'en'): string | undefined {
  const notice = context.researchNotice;
  if (!notice) return;
  const read = context.operation?.name === 'read_web_page', subject = notice.subject;
  const first = language === 'bn' ? read ? `আচ্ছা, ${subject}-এর পেজটা পড়ে দেখি।` : `${subject} সম্পর্কে তথ্য খুঁজছি।`
    : read ? `Reading the ${subject} page.` : `Searching for ${subject}.`;
  if (normalized(first) !== normalized(notice.previousText)) return first;
  return language === 'bn' ? read ? `${subject}-এর পাতাটি এবার পড়ছি।` : `এবার ${subject} নিয়ে খোঁজ করি।`
    : read ? `Let me read ${subject}'s page next.` : `Looking up more about ${subject}.`;
}
