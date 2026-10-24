import { banglishResearch, windowCorrection } from "./fastTaskContinuity";
import { isWeatherRequest } from './fastWeather';
export type FastRoute = "conversation" | "local_fact" | "lookup" | "planning" | "action" | "clarification";
export function routeFastRequest(text:string, pendingWork=false):FastRoute {
  const value=text.trim();
  if (isWeatherRequest(value)) return 'lookup';
  if (banglishResearch(value)) return "lookup";
  if (/\b(?:gpt|openai|gemini|google)\b/i.test(value) && /\b(?:leaks?|rumou?rs?|updates?|ashtese|ashche|upcoming)\b|ফাঁস|আপডেট|আসছে|গুজব/i.test(value)) return 'lookup';
  if (pendingWork && windowCorrection(value)) return "lookup";
  if (/\b(?:minimize|maximize|restore|resize)\b|মিনিমাইজ|ম্যাক্সিমাইজ/i.test(value)) return "action";
  if (/^(?:please\s+)?compare\b|তুলনা\s*(?:কর|করে)/i.test(value)) return "lookup";
  // Capability explanations do not need a browser/PC lookup just because they name a tool.
  if (/^(?:what can you do|how can you help|(?:explain|tell me) (?:your|the) (?:capabilities|limitations)|can you (?:use|control|access) (?:a |the |my )?(?:browser|computer|desktop|screen))[?.! ]*$/i.test(value)) return "conversation";
  if(/(?:\b(?:what(?:'s| is)? (?:the )?time|current time|time now|time\s+(?:koto|kota|in|at)|k[oou]?[tth]+a?\s*b[aou]?[jz][aeo]?|kota bje)\b|(?<![\p{L}\p{N}])(?:ক(?:য়|য়)টা|কটা|কতটা)\s*(?:বাজে|সম[য়য়])|কত বাজে|এখন.*সম[য়য়]|कितना बजे|कितने बजे)/iu.test(value))return "local_fact";
  // Fast path: creative writing and plain concept questions need no tools, so they must not hit the work path.
  if(/^(?:please\s+)?(?:write|create|make|compose|tell)\s+(?:me\s+)?(?:a|an|some)\s+(?:short\s+)?(?:poem|story|joke|essay|song|haiku|riddle|paragraph|caption)\b/i.test(value))return "conversation";
  if(/^(?:what(?:'s| is| are| was)|who (?:is|was)|why|how (?:does|do|is)|explain|define|meaning of)\b/i.test(value)&&!/\b(?:latest|letest|current|recent|news|weather|forecast|price|pricing|today|now|my|desktop|screen|computer|laptop|battery|clipboard|tabs?|browser|folder|search|research)\b|আবহাও|দাম|সার্চ/i.test(value))return "conversation";
  const requestedPlan=/\b(?:plan|planning|schedule|timetable|step[- ]by[- ]step|minute[- ]by[- ]minute|routine|itinerary|recipe|checklist)\b|ধাপে ধাপে|পরিকল্পনা|সময়সূচি|সময়সূচি|রুটিন/i.test(value);
  if (/গান.{0,35}(?:ছাড়ো|ছাড়ো|চালাও|বাজাও|চালিয়ে দাও|চালিয়ে দাও)|\b(?:gaan|gan)\b.{0,35}\b(?:chalao|bajao|charo|chharo|play)\b/i.test(value)) return "action";
  const explicitSideEffect=/\b(?:remind me|set (?:a )?reminder|add (?:it )?to (?:my )?calendar|schedule (?:a |the )?(?:meeting|appointment|event|reminder)|(?:meeting|appointment|event|reminder) (?:on|in) (?:my )?calendar|open|close|play|pause|resume|stop|click|type|save|delete|send|upload|download|install|run|launch|focus|monitor|copy)\b|খুলে দাও|বন্ধ করে|চালু কর|পজ কর|থামাও|মুছে দাও|পাঠিয়ে দাও|পাঠিয়ে দাও|গানটা চালাও|\b(?:yt|youtube)\b/i.test(value);
  if(requestedPlan&&!explicitSideEffect)return "planning";
  if(explicitSideEffect||/\b(?:write|create)\s+(?:a |the )?(?:file|folder|document|reminder|calendar event)\b|খুল|বন্ধ কর|লিখে (?:ফাইল|দাও)|মুছ|তৈরি কর/i.test(value))return "action";
  if(/(?:^|\s)(?:dekho|dekhen|dekhe dekho|khuje|khunje)(?:\s|[।.!?,]|$)|দেখো|দেখুন|খোঁজ|खोज|देखो|देखिए|सर्च|रिसर्च/i.test(value))return "lookup";
  if(/\b(?:search|research|latest|letest|current|recent|news|weather|forecast|desktop|files?|folder|browser|tabs?|screen|computer|laptop|battery|clipboard|books?|models?|price|pricing|prayer)\b|আবহাও|সময়সূচ|সময়সূচ|নামাজ|ডেস্কটপ|ফাইল|ব্রাউজার|ট্যাব|স্ক্রিন|বই|মডেল|সার্চ|খুঁজ|গবেষণা|দাম/i.test(value))return "lookup";
  if(pendingWork&&/previous|earlier|these|those|same|আগের|এগুলোর|শেষ|আরও|তারপর/i.test(value))return "lookup";
  if(pendingWork&&/^(?:yes|ok|okay|continue|again|then|do it|\?|হ্যাঁ|আচ্ছা|আবার|তারপর|কি হলো)[.!?। ]*$/i.test(value))return "action";
  if(/^(?:\?|what do you mean|মানে|কি বললে)[?। ]*$/i.test(value))return "clarification";
  return "conversation";
}
export function fastClockContext(text:string, now=new Date()):{zone:string;text:string} {
  const explicit=text.match(/\b(?:[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/)?.[0];
  const places:[RegExp,string][]=[[/bangladesh|dhaka|বাংলাদেশ|ঢাকা/i,"Asia/Dhaka"],[/india|kolkata|delhi|ভারত/i,"Asia/Kolkata"],[/london|uk|লন্ডন/i,"Europe/London"],[/new york|নিউ ইয়র্ক/i,"America/New_York"],[/tokyo|japan/i,"Asia/Tokyo"],[/dubai/i,"Asia/Dubai"],[/paris|france/i,"Europe/Paris"],[/sydney/i,"Australia/Sydney"],[/los angeles/i,"America/Los_Angeles"],[/singapore/i,"Asia/Singapore"],[/utc|gmt/i,"UTC"]];
  const cityZones=(Intl as unknown as {supportedValuesOf?:(kind:string)=>string[]}).supportedValuesOf?.("timeZone")||[];
  const city=cityZones.find(zone=>{const name=zone.split('/').at(-1)!.replace(/_/g,' ');return name.length>=4&&new RegExp('\\b'+name+'\\b','i').test(text);});
  const known=explicit||places.find(([pattern])=>pattern.test(text))?.[1]||city;
  const requestedPlace=/\b(?:time\s+(?:in|at)|(?:in|at)\s+)([a-z][a-z ]+)/i.exec(text)?.[1]||/([a-z][a-z ]+)\s+er\s+(?:kota|koyta|time)/i.exec(text)?.[1];
  if(requestedPlace&&!known)return {zone:"unknown",text:"The requested place's timezone is unresolved. Ask which city or IANA timezone the user means; do not substitute Bangladesh time."};
  const zone=known||"Asia/Dhaka";
  try{new Intl.DateTimeFormat("en",{timeZone:zone}).format(now);}catch{return {zone:"unknown",text:"The requested IANA timezone is invalid. Ask the user for the correct city or timezone; do not substitute Bangladesh time."};}
  return {zone,text:"Fresh clock observation: "+new Intl.DateTimeFormat("en-GB",{timeZone:zone,dateStyle:"full",timeStyle:"long"}).format(now)+"; IANA timezone: "+zone+". Use this time and timezone, never infer local time from UTC."};
}
