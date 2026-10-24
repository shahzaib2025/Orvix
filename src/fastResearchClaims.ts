// Local guards for known misleading research formulations; no provider review.
export const researchClaimInstruction = "A failed page read cannot strengthen an earlier candidate into a recognized, principal, or confirmed competitor. Attribute promotional comparisons to their publisher and retain candidate status unless retrieved evidence establishes the stronger claim. A failed or irrelevant lookup establishes only a limitation of this retrieval, never that no public evidence or competitors exist. Say: I could not identify documented competitors from the retrieved sources; the comparison remains unknown. For comparisons, attach each capability to the exact named model and source. Compare the same documented dimension for both subjects. A capability mentioned on one page does not establish exclusivity, superiority, or its absence from the other. If one side is undocumented, mark that dimension unknown. Do not infer publisher-wide priorities (for example Google focuses on voice while OpenAI focuses on cost) from selected catalog descriptions. Attribute claims and distinguish statements in a source from independent conclusions.";

export function needsScopedResearchReply(goal: string): boolean {
  return /protiddhondi|protidwondi|compare|comparison|competitors?|versus|\bvs\b|\bbest\b|\bbetter\b|সেরা|তুলনা|প্রতিযোগী|কম্পেয়ার|কম্পেয়ার|পার্থক্য/i.test(goal);
}
export function globalAbsenceClaim(text: string): boolean {
  return (/\b(?:no|not any|never any)\s+(?:public\s+|available\s+|documented\s+|reliable\s+)*(?:evidence|information|sources?|competitors?)\b|\b(?:evidence|competitors?)\s+(?:does not|do not|doesn't|don't)\s+exist\b|কোনো\s+(?:প্রকাশ্য\s+)?(?:প্রমাণ|প্রতিযোগী|তথ্য).{0,35}(?:নেই|অস্তিত্ব নেই)/i.test(text) ||
    /\b(?:OpenAI|Google)\b.{0,90}\b(?:has not|hasn't|have not|haven't|never)\b.{0,45}\b(?:announced|confirmed|said|released)\b|\b(?:no|nothing)\s+(?:recent\s+|new\s+|official\s+)*(?:announcements?|confirmation|word|updates?|references?|news)\b|\b(?:OpenAI|Google)\b.{0,100}\b(?:kichu boleni|announce koreni|confirm koreni)\b|(?:ওপেনএআই|গুগল).{0,100}(?:ঘোষণা করেনি|কিছু বলেনি|জানায়নি|জানায়নি)|(?:কোনো|কোনও).{0,20}(?:আপডেট|ঘোষণা|খবর).{0,15}(?:নেই|হয়নি|হয়নি)|\b(?:kono|kono new|recent)\s+update\s+(?:nai|nei)\b/i.test(text)) &&
    !/\b(?:retrieved|returned|these sources|this search|my search)\b|পাওয়া সূত্র|পাওয়া সূত্র|এই অনুসন্ধান|আমি.{0,20}(?:পাইনি|পারিনি)/i.test(text);
}
function broadComparisonClaim(text: string): boolean {
  if (/do not (?:establish|provide|show)|does not (?:establish|provide|show)|neither|cannot (?:confirm|determine)|remains unknown|নিশ্চিত করা যায় না|প্রতিষ্ঠিত হয় না/i.test(text)) return false;
  const publisher = /\b(?:Google|OpenAI|Gemini|GPT)\b|গুগল|ওপেনএআই|জেমিনি|জিপিটি/i.test(text);
  // A connective between two supported summaries does not itself claim a
  // provider-wide priority, superiority or exclusivity.
  return publisher && /\b(?:focus(?:es|ed)? (?:on|more)|primarily|mainly|exclusively|specializ\w*|only|better|best|faster|fastest|cheaper|cheapest|superior)\b|মূলত|প্রধানত|শুধুমাত্র|সবচেয়ে|সবচেয়ে|বেশি ভালো|বেশি উপযোগী|বেশি কার্যকর|দ্রুততম/i.test(text);
}
function modelCapabilityMismatch(sentence:string, evidence:string[]) {
  const modelPattern=()=>/\b(?:Gemini|GPT)[-\s]+[0-9]+(?:\.[0-9]+)?(?:[-\s]+(?:Flash(?:-Lite)?|Live|Extended Thinking|Pro|Sol|Astra|Luna|TTS)\b)*/gi;
  const normalize=(s:string)=>s.toLowerCase().replace(/[-\s]+/g,' ').trim();
  const dimensions=[/\breasoning\b|রিজনিং|যুক্তি/i,/\bcoding\b|কোডিং/i,/software engineering|সফটওয়্যার ইঞ্জিনিয়ারিং|সফটওয়্যার ইঞ্জিনিয়ারিং/i,/\bvoice\b|ভয়েস|ভয়েস/i,/\bcost\b|খরচ/i,/\benterprise\b|এন্টারপ্রাইজ/i];
  for(const clause of sentence.split(/\b(?:while|whereas|meanwhile)\b|অন্যদিকে/gi)) {
    const models=[...clause.matchAll(modelPattern())];if(models.length!==1)continue;
    const claimed=dimensions.filter(d=>d.test(clause));if(!claimed.length)continue;
    const passages:string[]=[];
    for(const excerpt of evidence){const mentions=[...excerpt.matchAll(modelPattern())];for(let i=0;i<mentions.length;i++)if(normalize(mentions[i][0])===normalize(models[0][0]))passages.push(excerpt.slice(mentions[i].index!+mentions[i][0].length,mentions[i+1]?.index ?? mentions[i].index!+700));}
    if(claimed.some(d=>!passages.some(p=>d.test(p))))return true;
  }
  return false;
}

export function scopeResearchAnswer(text: string, evidence: string[], language: 'bn'|'en', options:{modelComparison?:boolean}={}) {
  const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  const passages=evidence.map(normalize);
  let absence=false,comparison=false;
  const sentences=text.split(/(?<=[.!?।])\s+(?!\d)/);
  const kept=sentences.filter(sentence=>{
    const quote=sentence.match(/^(?:The page says:|Search results say:|পৃষ্ঠায় লেখা আছে:|পৃষ্ঠায় লেখা আছে:)\s*["“]([^"”]+)["”]/i);
    if (quote && passages.some(p=>p.includes(normalize(quote[1])))) return true;
    if(globalAbsenceClaim(sentence)){absence=true;return false;}
    const claim=normalize(sentence.replace(/[.!?।]+$/,''));
    const unscopedModel=options.modelComparison && /google|openai|gemini|gpt|গুগল|ওপেনএআই|জেমিনি|জেমিনাই|জিপিটি/i.test(sentence) &&
      !/(?:GPT|Gemini|জিপিটি|জেমিনি|জেমিনাই)[-\s]*[0-9০-৯]/i.test(sentence) &&
      /model|capabilit|voice|reasoning|coding|cost|মডেল|ক্ষমতা|ভয়েস|ভয়েস|খরচ|কোডিং/i.test(sentence) &&
      !/do not (?:establish|provide|show)|does not (?:establish|provide|show)|neither|unknown|cannot|অজানা|নিশ্চিত.*না/i.test(sentence) && !/^https?:\/\//.test(sentence.trim());
    const competitorRank = /(?:recognized|confirmed|principal|main|leading|major).{0,35}competitor|(?:প্রধান|স্বীকৃত|নিশ্চিত|শীর্ষ).{0,35}প্রতিযোগী/i.test(sentence) && !/cannot|unknown|not confirmed|নিশ্চিত.*না/i.test(sentence) && !passages.some(p=>p.includes(claim));
    if(competitorRank || unscopedModel || options.modelComparison && modelCapabilityMismatch(sentence,evidence) || broadComparisonClaim(sentence)&&!passages.some(p=>p.includes(claim))){comparison=true;return false;}
    return true;
  });
  if(absence)kept.push(language==='en'?'I could not establish the requested information from the retrieved sources. This does not prove that public evidence or competitors do not exist.':'পাওয়া সূত্র থেকে চাওয়া তথ্য নিশ্চিত করতে পারিনি। এর অর্থ প্রকাশ্য প্রমাণ বা প্রতিযোগী নেই, এমন নয়।');
  if(comparison)kept.push(language==='en'?'The retrieved passages do not establish that broader difference; that comparison remains unknown.':'পাওয়া অংশগুলো থেকে ওই বিস্তৃত পার্থক্য প্রতিষ্ঠিত হয় না; তুলনার ওই অংশ এখনো অজানা।');
  return {text:kept.join(' '),changed:absence||comparison,absence,comparison};
}
