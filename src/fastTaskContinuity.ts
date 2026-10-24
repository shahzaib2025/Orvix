// Explicit Banglish work requests; keep casual uses and negated instructions out.
export function banglishResearch(text:string):boolean {
  return !/\b(?:khujo|khojo|search)\s+na\b/i.test(text) && /\b(?:khujo|khojo|khunjo|khoj\s+niye|data\s+niye)\b/i.test(text);
}
export function windowCorrection(text:string):boolean {
  return /^(?:hoy\s+nai|hoye\s+ni|kaj\s+hoy\s+nai|didn['’]?t work|not done|হয় নাই|হয় নাই|হয়নি|হয়নি)[.!?। ]*$/i.test(text.trim());
}
export function workspaceCorrection(text:string):boolean {
  return /^(?:tmr|tomar|your|তোমার)\s+(?:workspace|ওয়ার্কস্পেস|ওয়ার্কস্পেস)[.!?। ]*$/i.test(text.trim());
}
export function allWindowRequest(text:string):boolean {
  return /(?:\ball\b|\bevery\b|\bs[ho]*ob\b|সব(?:গুলো|গুলা)?|সকল).{0,45}(?:windows?|apps?|applications?|উইন্ডো|অ্যাপ|এপ)/i.test(text) && /minimi[sz]e|maximi[sz]e|restore|মিনিমাইজ|ম্যাক্সিমাইজ/i.test(text);
}
export function substantiveReply(text:string):boolean { return /[\p{L}\p{N}]/u.test(text); }
export function verifyWindowSet(targets:{handle:number;action:string}[], result:Record<string,unknown>) {
  const observation=(result.observation || {}) as Record<string,unknown>;
  const windows=observation.windows;
  if(result.status!=='ok'||!Array.isArray(windows))return {verified:false,remaining:targets.map(t=>t.handle),unavailable:true};
  const remaining=targets.filter(t=>!windows.some(w=>Number(w.handle)===t.handle && (t.action==='focus'?w.foreground===true:w.state===(t.action==='minimize'?'minimized':t.action==='maximize'?'maximized':'normal')))).map(t=>t.handle);
  return {verified:targets.length>0&&!remaining.length,remaining,unavailable:false};
}
