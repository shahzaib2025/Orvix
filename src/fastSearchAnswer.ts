// A successful search is evidence retrieval, not the answer to a topic question.
// Keep this local and narrow: normal answers incur no extra model request.
export function searchStatusQuestion(goal: string): boolean {
  return /^(?:is|does|can|check|test)\s+(?:the\s+)?(?:web\s+)?search\b.{0,35}(?:work|available|enabled|configured)|^(?:সার্চ|অনুসন্ধান).{0,25}(?:কাজ করছে কি|চালু আছে কি)/i.test(goal.trim());
}

export function searchStatusOnly(text: string): boolean {
  const clean = text.replace(/https?:\/\/\S+/g, '')
    .replace(/This is a preliminary description from search results; I have not read the original page\.?/gi, '')
    .replace(/এটি সার্চের ফল থেকে পাওয়া প্রাথমিক বিবরণ; মূল পৃষ্ঠা এখনো পড়িনি[।.]?/g, '').trim();
  const sentences = clean.split(/[.!?।\n]+/).map(s=>s.trim()).filter(Boolean);
  return sentences.length > 0 && sentences.every(sentence =>
    /^(?:the\s+)?(?:web\s+|online\s+)?(?:search|lookup|tool|provider|connection|serper|duckduckgo)(?:\s+(?:is|was|has|have|are|been|now|currently|available|unavailable|and|working|functioning|normally|successfully|successful|succeeded|completed|worked|returned|found|results?|retrieved|enabled|disabled|failed|not|no|new|relevant|\d+))*$/i.test(sentence) ||
    /^(?:যেহেতু\s*)?(?:সার্চ|অনুসন্ধান|টুল)\s*(?:(?:সুবিধা|সুবিধাটি|পরিষেবা|পরিষেবাটি|সেবা|সেবাটি|ব্যবস্থা|ব্যবস্থাটি|ইঞ্জিন|ইঞ্জিনটি|এখন|বর্তমানে|সফলভাবে|স্বাভাবিকভাবে|ঠিকভাবে|ভালোভাবে|সফল|চালু|সচল|উপলব্ধ|কাজ|করছে|চলছে|হয়েছে|হয়েছে|এবং|আছে|করা|যাচ্ছে|ও|নেই|ঠিকঠাক|সম্পন্ন|তাই|এটি|বলেই|বলে|ধরা|যায়|যায়|হচ্ছে)[, ]*)*$/.test(sentence));
}

export function searchTopicGoal(goal: string): string {
  // This aside specifies failure handling, not the substance to research.
  // Preserve the original text in history; remove only this conditional search
  // status aside from the answer instruction. Failed receipts still report it.
  return goal.replace(/\b(?:say|tell me|report|mention|let me know)\s+if\s+(?:the\s+)?(?:web\s+)?search\s+(?:is\s+)?(?:unavailable|fails?|failed)[^.!?।\n]*/gi,'').replace(/;\s*([.!?।]|$)/g,'$1').trim();
}

export function requestsOfficialSources(goal:string):boolean {
  return /\b(?:from|using|only|use|with)\s+(?:the\s+)?official\s+sources?\b|অফিশিয়াল সূত্র|অফিসিয়াল সূত্র/i.test(goal);
}
export function preserveSearchSourceConstraint(query:string,goal:string):string {
  const official=requestsOfficialSources(goal);
  return official && !/\bofficial\b|\bsite:/i.test(query) ? query.trim()+' official sources' : query;
}

export function explicitReplyLanguageMismatch(text: string, goal: string, language: 'bn' | 'en'): boolean {
  if(language !== 'bn' || /\bbanglish\b/i.test(goal) ||
    !/\bbangla\b.{0,45}\b(?:answer|reply|script)|\b(?:answer|reply)\b.{0,45}\bbangla\b|বাংলা(?:য়|য়|তে)/i.test(goal))return false;
  const body=text.replace(/https?:\/\/\S+/g,'');
  return /[A-Za-z]{3}/.test(body) && !/[\u0980-\u09ff]/.test(body);
}

export const searchContentInstruction = 'Explain the subject in workProgress.goal using the retrieved evidence, in the requested spoken language. Search availability, success, result counts and provider names do not answer a subject question. Preserve requested source restrictions. If excerpts lack the requested facts, read one relevant returned source or state exactly which information is missing. Never invent facts.';
