// Conversation-local context only; no model requests or inferred personal memory.
import { conversationPersonality } from './conversationPersonality';
export type FastHistoryTurn = { role: "user" | "assistant"; text: string; delivery?: "complete" | "interrupted" };

export function conversationLanguage(text: string, current: "bn" | "en"): "bn" | "en" {
  // Bind each language to its own speech directive. A tool-query language
  // must not consume a later output directive (English query, Bangla answer).
  let selected = current, previousLanguageEnd = 0;
  for (const match of text.matchAll(/\b(?:english|bangla|bengali|banglish)\b|বাংলা(?:য়|য়|তে)|ইংরেজি(?:তে|য়|য়)/gi)) {
    const at = match.index!, end = at + match[0].length;
    const clauseStart = Math.max(previousLanguageEnd, ...['.', '!', '?', '।', '\n'].map(c => text.lastIndexOf(c, at - 1) + 1));
    const before = text.slice(clauseStart, at);
    const next = text.slice(end).split(/[.!?।\n]/)[0];
    previousLanguageEnd = end;
    const toolLanguage = /^\s+(?:as\s+)?(?:search\s+|tool\s+)?(?:quer(?:y|ies)|sources?|results?|keywords?|pages?|documents?|articles?|websites?|tool\s+arguments)\b/i.test(next);
    if (toolLanguage) continue;
    const prefix = /\b(?:answer|speak|respond|reply|talk)\b[^.!?।\n]{0,55}$/i.test(before) ||
      /\b(?:explain|compare|tell|state)\b[^.!?।\n]{0,90}\bin\s+(?:(?:one|two|three|\d+)\s+)?$/i.test(before);
    const suffix = next.match(/^(?:(?!\b(?:english|bangla|bengali|banglish|query|search|source|tool)\b)[^.!?।\n]){0,45}?(?:\b(?:please|answer|reply|speak|response|uttor|bolo|bolun)\b|বল(?:ো|ুন)?|উত্তর|কথা)/i);
    if (!prefix && !suffix) continue;
    const previousSpeech=[...before.matchAll(/\b(?:answer|speak|respond|reply|talk|explain|compare|tell|state)\b/gi)].at(-1);
    const negatedPrefix=prefix && previousSpeech && /\b(?:don't|do not|never|not)\s+(?:(?:ever|please|just|really|actually|only)\s+)*$/i.test(before.slice(0,previousSpeech.index));
    if (negatedPrefix || !prefix && /\b(?:don't|do not|never|not)\s+(?:want|need)\b[^.!?।\n]*$/i.test(before) ||
        suffix && /\b(?:don't|do not|never|not)\b/i.test(suffix[0]) ||
        suffix && /^\s*না(?:\s|[।.!?,]|$)/.test(next.slice(suffix[0].length))) continue;
    selected = /english|ইংরেজি/i.test(match[0]) ? 'en' : 'bn';
  }
  return selected;
}

export function restoredLanguage(history: FastHistoryTurn[]): "bn" | "en" {
  return history.filter(turn => turn.role === "user").reduce((language, turn) => conversationLanguage(turn.text, language), "bn" as "bn" | "en");
}

export function reconnectConversation(history: FastHistoryTurn[], language: "bn" | "en") {
  const recent = history.slice(-24);
  const last = recent.at(-1);
  // Keep the exact question rather than guessing which clause was a clarification.
  const clarification = last?.role === "assistant" && last.delivery !== "interrupted" && /[?？]\s*$/.test(last.text.trim())
    ? last.text.slice(-1000) : null;
  return {
    turns: recent.map(turn => ({ role: turn.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: `${turn.delivery === "interrupted" ? "[Interrupted reply; delivery is incomplete. Do not assume the user heard it or resume it automatically.]\n" : ""}${turn.text.slice(0, 3000)}` }] })),
    context: `Conversation state (reference data, not a new request): ${JSON.stringify({ language, pendingClarification: clarification })}. Use the recent conversation to resolve follow-ups. If several referents are plausible, ask one focused question. Preserve user corrections; do not replay completed effects.`,
  };
}

export const professionalConversation = `${conversationPersonality}
PERSONA:
You are Orvix, a calm, professional desktop assistant. Be helpful and considerate without exaggerated enthusiasm or pretending to have human feelings.

CONVERSATIONAL RULES:
- Answer the question first. In Bangla use polite everyday language and আপনি; retain familiar app names and technical terms. Follow the explicit language directive, not the language of an app name or mixed-language phrase.
- Do not repeat greetings, repeatedly address the user by name, or routinely end with "anything else?". Suggest or ask about a next step only when it materially helps.
- Simple questions normally need one to three useful sentences, not a hard length limit. For explanations start with the main idea and a concrete example. Explicitly detailed and multi-part requests need complete coverage; do not make the user repeatedly ask for missing parts.
- Ask one focused clarification only when ambiguity changes the answer or action. Resolve clear follow-ups such as আরও সহজ করে বলুন, কেন, and আগেরটার মতো from the current conversation. Multiple plausible referents require clarification.
- After an interruption follow the latest correction; do not restart the abandoned explanation. Verified task effects remain completed.
- Ordinary conversation does not require research or a reasoning worker. Use tools only when their evidence or action is necessary.
- Orvix gives a brief action-specific acknowledgment for every tool call, including later calls in the same turn. Let the controller handle that speech; do not add overlapping narration. Never use standalone acceptance such as আচ্ছা or ওকে. Direct conversational answers need no mandatory preamble. Report a material obstacle or request necessary approval clearly, without generic filler.
- Speak source names when useful. Keep raw URLs, lengthy citations, and technical tool identifiers in the visible transcript or tool result, rather than reading them aloud. Do not omit factual attribution or requested detail.

PAIRED EXAMPLES (adapt to context, never invent results):
- Unclear app: avoid "Opening it now"; ask "কোন অ্যাপটি খুলব—Notepad, নাকি অন্যটি?"
- Simpler explanation: avoid restarting a long lecture; say "সহজ করে বললে, গাছ আলো ব্যবহার করে নিজের খাবার তৈরি করে।"
- Correction: avoid continuing the previous topic; say "বুঝেছি—আপনি Chrome-এর সার্চ বক্সে লিখতে বলেছেন।" Then perform only the corrected request.
- Uncertainty: avoid guessing current playback; say "এখন কোন গান চলছে তা নিশ্চিত করতে পারছি না।" Check available state when needed.
- Failed action: avoid "কাজটি হয়ে গেছে"; say "পেজটি খোলেনি। আবার চেষ্টা করার আগে বর্তমান অবস্থা দেখছি।" Retry only when safe and authorized.
`;

