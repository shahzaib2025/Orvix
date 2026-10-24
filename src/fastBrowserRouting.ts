export function explicitNewBrowserTab(text:string):boolean {
  const request=text.replace(/https?:\/\/\S+|"[^"]*"|“[^”]*”/g,'');
  if(/\b(?:don['’]?t|do not|never|no)\b.{0,40}\b(?:new|another|separate)\s+tab\b|নতুন.{0,20}ট্যাব.{0,20}(?:না|নয়|নয়)|notun.{0,15}tab.{0,20}(?:na|noy)/i.test(request))return false;
  return /\b(?:new|another|separate)\s+(?:browser\s+)?tab\b|নতুন\s*ট্যাব|আলাদা\s*ট্যাব|\b(?:notun|natun|alada)\s+tab\b/i.test(request);
}
export function browserSite(input:Record<string,unknown>):string {
  const args=(input.args||{}) as Record<string,unknown>,action=String(input.action||'');
  if(action.startsWith('youtube_'))return 'youtube.com';
  if(action==='search')return 'www.google.com';
  try{const host=new URL(String(args.url)).hostname;return host==='www.youtube.com'?'youtube.com':host;}catch{return '';}
}

// Resolve only affirmative navigation requests against sources actually shown
// to the user, in their displayed order. Background reading is a different task.
export function requestedSourceNavigation(text:string, presented:string[], selected?:string):{requested:boolean;url?:string} {
  if (!/\b(?:open|khulo|khule dao|niye jao|take me|go to)\b|খুলে দাও|খোলো|খুলুন|নিয়ে যাও|নিয়ে যাও/i.test(text) ||
      /\b(?:don['’]?t|do not|never|maybe|if|should I)\b|\b(?:khulo|khule dao)\s+na\b|খুল.{0,12}না|^\s*(?:how|why|did|what happens|can I|could I)\b/i.test(text)) return {requested:false};
  const supplied=text.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[.,;!?]+$/, '');
  if (supplied) return {requested:true,url:supplied};
  const ordinal=text.match(/\b([1-9]\d*)(?:st|nd|rd|th)?\s*(?:one|link|source|result|ta|ট|টি)?\b/i)?.[1];
  const named=/\bfirst\b|প্রথম/i.test(text)?1:/\bsecond\b|দ্বিতীয়|দ্বিতীয়/i.test(text)?2:/\bthird\b|তৃতীয়|তৃতীয়/i.test(text)?3:undefined;
  if (ordinal || named) return {requested:true,url:presented[Number(ordinal || named)-1]};
  if (/\b(?:it|that|this|its|website|page|link|tar|ota|oita)\b|ওটা|ওই|ওয়েবসাইট|ওয়েবসাইট|পেজ|লিংক/i.test(text))
    return {requested:true,url:selected || (presented.length===1?presented[0]:undefined)};
  return {requested:false};
}

export function navigationResultMatches(url:string,result:Record<string,unknown>):boolean {
  if(result.status!=='ok'||result.completionUnknown===true)return false;
  const observation=(result.observation||{}) as Record<string,unknown>,page=(observation.page||{}) as Record<string,unknown>;
  const urls=[observation.url,page.url,...(Array.isArray(observation.tabs)?observation.tabs.filter(tab=>tab.active===true).map(tab=>tab.url):[])];
  const canonical=(value:unknown)=>{try {const u=new URL(String(value));u.hash='';return u.href.replace(/\/$/,'');}catch{return '';}};
  return urls.some(value=>canonical(value)===canonical(url));
}
function newTabForSite(text:string,site:string):boolean {
  const parts=text.split(/\bthen\b|;|\n|তারপর|এরপর|\band\s+(?=(?:open|go|use|search|play)\b)/i);
  if(parts.length===1)return explicitNewBrowserTab(text);
  const name=site.replace(/^www\./,'').split('.')[0];
  return parts.some(part=>{
    const related=site==='youtube.com'?/youtube|ইউটিউব|\byt\b/i.test(part):site.includes('google.')?/google|গুগল/i.test(part):name&&part.toLowerCase().includes(name);
    return related&&explicitNewBrowserTab(part);
  });
}
export function routeBrowserAction(input:Record<string,unknown>,text:string,tabs:Map<string,string>):Record<string,unknown> {
  const action=String(input.action||''),args={...((input.args||{}) as Record<string,unknown>)};
  const opening=['tab_open','navigate','search','youtube_search'].includes(action),site=browserSite(input);
  if(action==='window_create'&&!/\b(?:new|another|separate)\s+(?:browser\s+|chrome\s+)?window\b|নতুন\s*উইন্ডো|আলাদা\s*উইন্ডো|\bnotun window\b/i.test(text))throw new Error('No new browser window was requested; reuse a matching tab.');
  if(action==='tab_duplicate'&&!/\b(?:duplicate|copy|clone)\b.{0,25}\btab\b|\btab\b.{0,25}\b(?:duplicate|copy|clone)\b|ট্যাব.{0,20}(?:কপি|ডুপ্লিকেট)/i.test(text))throw new Error('No tab duplication was requested.');
  const explicitTarget=/\b(?:this|current|that|named|titled)\s+tab\b|\btab\s+(?:named|titled)\b|\b(?:here|in (?:the )?tab)\b|এই\s*ট্যাব|ওই\s*ট্যাব|সেই\s*ট্যাব|ট্যাবে|এখানে|\b(?:ei tab|oi tab|ekhane)\b/i.test(text);
  if(!opening&&!action.startsWith('youtube_'))return input;
  const target=site&&tabs.get(site)|| (explicitTarget?input.target:undefined);
  if(opening){
    args.tabPolicy=newTabForSite(text,site)&&!tabs.has(site)?'new':'reuse';
    if(action==='tab_open'&&!args.url&&!explicitNewBrowserTab(text))throw new Error('A destination URL is required; no new tab was requested.');
    // Empty explicitly requested tabs retain the legacy creation path.
    if(action==='tab_open'&&!args.url)delete args.tabPolicy;
  }
  const routed:Record<string,unknown>={...input,args};delete routed.target;
  if(target&&args.tabPolicy!=='new')routed.target=target;
  return routed;
}
