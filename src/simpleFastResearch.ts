import { banglishResearch } from "./fastTaskContinuity";
export type ModelPublisher = "Google" | "OpenAI";

export const modelCatalogs: Record<ModelPublisher,string> = {
  Google:"https://ai.google.dev/gemini-api/docs/models",
  OpenAI:"https://developers.openai.com/api/docs/models",
};
// The landing page can render "all models" as a JavaScript-only button.
// This verified documentation index contains older named variants too.
export const modelCatalogIndexes: Partial<Record<ModelPublisher,string>> = {
  OpenAI:'https://developers.openai.com/api/docs/models/all',
};
export function isModelPublisherSource(url:string,publishers:ModelPublisher[]):boolean {
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)return false;
    const hosts:Record<ModelPublisher,string[]>={
      OpenAI:['openai.com','www.openai.com','developers.openai.com','platform.openai.com','help.openai.com','deploymentsafety.openai.com'],
      Google:['google.com','www.google.com','ai.google.dev','developers.google.com','blog.google','deepmind.google','deepmind.google.com','gemini.google','gemini.google.com','cloud.google.com','research.google'],
    };
    return publishers.some(p=>hosts[p].includes(parsed.hostname));
  } catch { return false; }
}

// Conservative fast path: a finished, affirmative read instruction. Ambiguous
// or corrected input stays with the main model; this never selects a mutation.
export function knownFirstRead(text:string, publishers:ModelPublisher[]):{name:string;args:Record<string,unknown>}|undefined {
  const request=text.replace(/https?:\/\/[^\s<>]+/gi,"[page]");
  const explicitUrls=(text.match(/https?:\/\/[^\s<>]+/gi)||[]).map(url=>url.replace(/[.,;!?]+$/, ""));
  if(explicitUrls.length){
    const readIntent=/\b(?:read|reread|re-read|poro|porun)\b|\bpore\s+(?:bolo|bolun|dekho|dekhun|dao)\b|পড়|পড়/i;
    // Scope negation to reading itself. "Do not search other pages" limits
    // discovery; it does not cancel reading URLs the user supplied.
    const negatedRead=/\b(?:not|never|don['’]?t|do not|shouldn['’]?t|should not|cancel|stop)\s+(?:to\s+)?(?:re-?read|read|open)\b|(?:পড়|পড়|খুল).{0,20}(?:না|নয়|নয়)|(?:না|নয়|নয়).{0,20}(?:পড়|পড়|খুল)/i;
    const uncertainRead=/^\s*(?:maybe|if|whether|should\s+(?:i|we)|(?:can|could|would)\s+i)\b|\b(?:maybe|if|whether)\b.{0,45}\b(?:read|reread|re-read)\b/i;
    if(!readIntent.test(text)||negatedRead.test(request)||uncertainRead.test(request))return;
    try{new URL(explicitUrls[0]);return {name:"read_web_page",args:{url:explicitUrls[0]}};}catch{return;}
  }
  if(/\b(?:not|never|don['’]?t|shouldn['’]?t|cancel|stop|instead|actually|maybe|if|whether|or)\b|\b(?:should (?:I|we)|(?:can|could) I|what (?:does|is)|did you)\b|(?:\band|আর|এবং|…|\.\.\.)\s*$|(?:^|\s)না(?:\s|[।.!?,]|$)|নয়|নয়|বাতিল|থাম|বরং|বদল|নাকি|নাহি|नहीं|मत/i.test(request))return;
  if(publishers.length)return {name:"web_search",args:{query:`latest ${publishers.join(' and ')} AI models official documentation`}};
}

export function retainedInformationFollowup(text:string):boolean {
  const retained=/\b(?:previous|earlier|already (?:read|retrieved)|retained|same information|gathered information)\b|আগের|পূর্বের|পড়া একই|পড়া একই/i.test(text);
  const noRetrieval=/\b(?:no (?:new|more) (?:search|research|retrieval)|without (?:new |any )?(?:search|research|retrieval)|do not (?:search|retrieve|browse)|only (?:use|using) (?:the )?(?:previous|retained))\b|নতুন.{0,24}(?:খোঁজ|তথ্য|সার্চ).{0,20}(?:না|লাগবে না)|শুধু.{0,20}(?:পড়া|পড়া|আগের).{0,20}(?:তথ্য|সূত্র)/i.test(text);
  return retained&&noRetrieval&&!/\b(?:write|save|delete|click|press|open|reread|refresh|send)\b|আবার.{0,15}(?:পড়|পড়)|লিখ|পাঠা|মুছ/i.test(text);
}

export function mentionedModelPublishers(text:string): ModelPublisher[] {
  const publishers:ModelPublisher[]=[];
  if(/\b(?:google|gemini)\b|গুগল|জেমিনি/i.test(text))publishers.push("Google");
  if(/\b(?:openai|chatgpt|gpt)\b|ওপেনএআই|চ্যাটজিপিটি|জিপিটি/i.test(text))publishers.push("OpenAI");
  return publishers;
}

export function researchFollowup(text:string): boolean {
  return /\b(?:previous|earlier|before|continue|resume|comparison|compare|these|those|their|pehle|pahle|phele|tattu|tottho|again|re-search|refresh)\b|\b(?:abar|abr)\b|আগের|পূর্বের|তুলনা|এদের|ওদের|এগুলোর|মডেলগুলোর|আবার|आगे|पहले/i.test(text);
}

// A repeated lookup is an explicit request for a fresh observation. Keep the
// detector narrow so ordinary "tell me again" follow-ups do not spend a search.
export function explicitSearchRefreshRequest(text:string): boolean {
  return /\b(?:search|look(?:\s+it)?\s+up|check|find|khujo|khojo|khunjo|khoj)\b.{0,35}\b(?:again|anew|fresh|refresh|retry)\b|\b(?:again|anew|fresh|refresh|retry)\b.{0,35}\b(?:search|look(?:\s+it)?\s+up|check|find|khujo|khojo|khunjo|khoj)\b|\b(?:abar|abr)\b.{0,24}\b(?:khujo|khojo|khunjo|khoj|search|check|find)\b|(?:আবার|পুনরায়|পুনরায়).{0,28}(?:খুঁজ|সার্চ|দেখে নাও|খোঁজ)/i.test(text);
}

export function searchRefreshUsesRetainedTopic(text:string): boolean {
  if (!explicitSearchRefreshRequest(text)) return false;
  const remainder=text.toLowerCase()
    .replace(/\b(?:search|look(?:\s+it)?\s+up|check|find|khujo|khojo|khunjo|khoj|try|please)\b/g," ")
    .replace(/\b(?:again|anew|fresh|refresh|retry|abr|abar|for|about|the|it|that|this|same|query|topic|thing|information|info|results|once|more)\b/g," ")
    .replace(/(?:আবার|পুনরায়|পুনরায়|খুঁজে দেখো|খুঁজে দেখ|খুঁজ|সার্চ করো|সার্চ|দেখে নাও|খোঁজ|করো)/g," ")
    .replace(/[\s.,!?।…]+/g,"").trim();
  return remainder.length===0;
}

export function ambiguousResearchFollowup(text:string): boolean {
  // Do not guess a topic from an unclear ASR fragment or a bare reference to
  // earlier information. Specific source, subject, and comparison requests proceed.
  if (explicitSearchRefreshRequest(text) && !searchRefreshUsesRetainedTopic(text)) return false;
  if(/\b(?:google|gemini|openai|chatgpt|gpt|compare|comparison|pricing|cost|capability|continue|resume)\b|তুলনা|গুগল|ওপেনএআই|চ্যাটজিপিটি|জেমিনি|সূত্র|পৃষ্ঠা|খরচ|দাম|চালিয়ে|চালিয়ে/i.test(text))return false;
  return researchFollowup(text)&&text.trim().split(/\s+/).length<=12;
}

export function needsWorkAcknowledgment(text:string): boolean {
  return banglishResearch(text) || /\b(?:search|research|read|reread|re-read|write|save|copy|list|find|open|close|launch|focus|minimize|maximize|compare|comparison|check|verify|weather|forecast|continue|resume|models?|modelgula|modelgular)\b|খুঁজ|খোঁজ|পড়|পড়ে|পড়ো|লিখ|তৈরি|তুলনা|কম্পেয়ার|কম্পেয়ার|যাচাই|ফাইল|আবহাওয়া|আবহাওয়া|মডেল/i.test(text);
}

// A finished research request can be acknowledged before its exact tool is
// selected. Negated research commands and incomplete utterances still wait.
export function earlyResearchAcknowledgment(text: string): boolean {
  if (/^(?:please\s+)?(?:don['’]?t|do not|never|stop|cancel)\s+(?:search|research|read|compare|check|find)\b|^(?:খুঁজো না|খুঁজবেন না|সার্চ করো না|গবেষণা করো না|তুলনা করো না)/i.test(text.trim())) return false;
  if (/^(?:maybe|if|whether|should (?:I|we)|(?:can|could) I)\b|^(?:হয়তো|হয়তো|যদি)/i.test(text.trim())) return false;
  if (/(?:\band|\bor|আর|এবং|নাকি|…|\.\.\.)\s*$/i.test(text.trim())) return false;
  return banglishResearch(text) || /\b(?:search|research|read|reread|re-read|find|compare|comparison|check|weather|forecast|models?)\b|খুঁজ|খোঁজ|পড়|পড়|তুলনা|কম্পেয়ার|কম্পেয়ার|আবহাওয়া|আবহাওয়া|মডেল/i.test(text);
}

export function searchSubjectKey(query:string): string {
  const publisher=mentionedModelPublishers(query);
  // Query paraphrases for one publisher share a budget. General searches have
  // a small turn-wide budget; independent page reads are never blocked by it.
  return publisher.length===1?`search:${publisher[0]}`:"search:general";
}

export function catalogAnswer(text:string): boolean {
  return /(?:\b(?:gpt|gemini)|জিপিটি|জেমিনি)[\s-]*[0-9০-৯]|(?:latest|newest|লেটেস্ট|সর্বশেষ).{0,40}(?:model|মডেল)/i.test(text);
}

export function unsupportedModelNames(answer:string,excerpts:string[]): boolean {
  const normalize=(text:string)=>text.replace(/[০-৯]/g,c=>String("০১২৩৪৫৬৭৮৯".indexOf(c)))
    .replace(/জিপিটি/gi,"GPT").replace(/জেমিনি/gi,"Gemini").toLowerCase();
  const source=normalize(excerpts.join("\n"));
  for(const match of normalize(answer).matchAll(/\b(gpt|gemini)[\s-]*(\d+(?:\.\d+)?)(?![\d.])(?:[\s-]+(astra|sol|luna|terra|pro|flash(?:[\s-]+lite)?|live))?/g)){
    const number=match[2].replace(/\./g,"\\.");
    const variant=match[3] ? `[\\s-]+${match[3].replace(/[\s-]+/g,'[\\s-]+')}\\b` : '';
    if(!new RegExp(`\\b${match[1]}[\\s-]*${number}(?![\\d.])${variant}`,"i").test(source))return true;
  }
  return false;
}
