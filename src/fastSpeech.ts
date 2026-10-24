// Formatting is often omitted by speech transcription. Preserve every word
// and numeric value while allowing parentheses, underscores and punctuation.
export function spokenReviewedReport(reviewed: string): string {
  // Full links stay in the written report. Long paths and tracking parameters
  // are citation presentation, not factual wording the voice must recite.
  return reviewed.split("\n")
    .map(line=>line.replace(/https?:\/\/[^\s<>]+/gi,"").replace(/[ \t]+/g," ").trim())
    .filter(line=>!/^\s*(?:sources?|retrieved sources|সূত্র|পড়া সূত্র)\s*:\s*[|,;]*$/i.test(line))
    .join("\n").replace(/\n{3,}/g,"\n\n").trim();
}
export function matchesReviewedSpeech(spoken: string, reviewed: string): boolean {
  const digits = (value: string) => value.normalize("NFKC").replace(/[০-৯]/g, c => String("০১২৩৪৫৬৭৮৯".indexOf(c))).replace(/(?<=\d),(?=\d{3}\b)/g, "");
  const small=["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens=["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  const sep="[\\s-]+", and="(?:[\\s-]+and)?[\\s-]+";
  const words=(n:number):string=>n<20 ? small[n] : n<100 ? tens[Math.floor(n/10)]+(n%10?sep+small[n%10]:"")
    : n<1000 ? small[Math.floor(n/100)]+sep+"hundred"+(n%100?and+words(n%100):"")
    : n<1_000_000 ? words(Math.floor(n/1000))+sep+"thousand"+(n%1000?and+words(n%1000):"")
    : words(Math.floor(n/1_000_000))+sep+"million"+(n%1_000_000?and+words(n%1_000_000):"");
  const bangla=["শূন্য","এক","দুই","তিন","চার","পাঁচ","ছয়","সাত","আট","নয়","দশ"];
  // Transcription may write a spoken numeral as words. Only rewrite exact
  // equivalents of numbers in the reviewed report, preserving their value.
  for(const numeral of [...new Set(digits(reviewed).match(/-?\d+(?:\.\d+)?/g) || [])].sort((a,b)=>b.length-a.length)) {
    const value=Number(numeral), integer=Math.floor(Math.abs(value));
    if(!Number.isFinite(value) || integer>=1_000_000_000)continue;
    const fraction=numeral.split(".")[1];
    const cardinal=(value<0?`(?:minus|negative)${sep}`:"")+words(integer)+(fraction?sep+"point"+sep+[...fraction].map(d=>small[Number(d)]).join(sep):"");
    const replaceOutsideUrls=(text:string,expression:RegExp,replacement:string)=>text.split(/(https?:\/\/[^\s<>]+)/gi)
      .map(part=>/^https?:\/\//i.test(part)?part:part.replace(expression,replacement)).join("");
    const equivalent=new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${cardinal}(?![\\p{L}\\p{M}\\p{N}])`,"giu");
    spoken=replaceOutsideUrls(spoken,equivalent,numeral);
    reviewed=replaceOutsideUrls(reviewed,equivalent,numeral);
    if(value>=0 && value<=10 && !fraction) {
      const bn=bangla[value];
      const counted=new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${bn}টি|${value===1?"একটি":value===2?"দুটি":bn+"টি"})(?![\\p{L}\\p{M}\\p{N}])`,"gu");
      const bare=new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${bn}(?![\\p{L}\\p{M}\\p{N}])`,"gu");
      spoken=replaceOutsideUrls(spoken,counted,`${numeral}টি`);
      reviewed=replaceOutsideUrls(reviewed,counted,`${numeral}টি`);
      // Bare "নয়" is also negation. Never normalize it away as nine.
      if(value!==9) {spoken=replaceOutsideUrls(spoken,bare,numeral);reviewed=replaceOutsideUrls(reviewed,bare,numeral);}
    }
  }
  const normalize = (value: string) => digits(value).toLowerCase().replace(/&/g," and ").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
  const numbers = (value: string) => JSON.stringify((digits(value).match(/-?\d+(?:\.\d+)?/g) || []).map(Number));
  let speech = normalize(spoken);
  // Match punctuation spoken inside an exact reviewed URL. Never remove
  // these words elsewhere or accept a different host, path or query value.
  const punctuation: Record<string,string> = {":":"colon","/":"slash",".":"dot","-":"(?:dash|hyphen)","_":"underscore","?":"questionmark","=":"(?:equals|equal)","&":"(?:and|ampersand)","#":"(?:hash|hashtag)","%":"percent"};
  for (const url of reviewed.match(/https?:\/\/[^\s<>);]+/gi) || []) {
    const clean = url.replace(/[.,!?]+$/, "");
    const pattern = [...digits(clean).toLowerCase()].map(character => punctuation[character] ? `(?:${punctuation[character]})?` : normalize(character).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("");
    speech = speech.replace(new RegExp(pattern,"g"),normalize(clean));
  }
  return speech === normalize(reviewed) && numbers(spoken) === numbers(reviewed);
}
