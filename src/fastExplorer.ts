export type ExplorerTarget={path:string;type:'folder'|'file'};
export function explorerOnlyRequest(text:string):boolean {
  return explorerRequest(text)&&!/\b(?:then|and|also|read|list|summari[sz]e|contents|inside|ki ki ache)\b|তারপর|এরপর|পড়|পড়|তালিকা|কি কি আছে|কী কী আছে|फिर|पढ़/i.test(text.replace(/["'][^"']*["']/g,''));
}
export function explorerRequest(text:string):boolean {
  if(/https?:\/\/|\b(?:browser|website|youtube|tab)\b|ব্রাউজার|ওয়েবসাইট/i.test(text))return false;
  if(/\b(?:don['’]?t|do not|never|maybe|if)\b|\b(?:open|khulo|khule)\s+na\b|খুল.{0,12}না|খোলো না|मत खोल|नहीं खोल|^\s*(?:how|why|can I|could I|what happens)\b/i.test(text))return false;
  const local=/\b(?:files?|folders?|directory|explorer|desktop|documents|downloads)\b|ফাইল|ফোল্ডার|এক্সপ্লোরার|ডেস্কটপ|फोल्डर|फ़ोल्डर|फाइल|फ़ाइल|एक्सप्लोरर|[a-z]:[\\/]/i.test(text);
  const open=/\b(?:open|reveal|show|khulo|khule|dekhao|dekhao to)\b|খুল|খোলো|দেখাও|ওপেন|ওপেন|খুলুন|ओपन|खोल|दिखा/i.test(text);
  const listing=/\b(?:list|contents|what.*inside|ki ki ache|ki ache)\b|কি কি আছে|কী কী আছে|কী আছে|কি আছে|ভেতরে কি|ভিতরে কি/i.test(text);
  return local&&open&&(!listing||/\b(?:open|reveal)\b|ওপেন|খুল|ओपन|खोल/i.test(text));
}
export function knownExplorerOperation(text:string,previous?:ExplorerTarget):{name:string;args:Record<string,unknown>}|undefined {
  if(!explorerRequest(text))return;
  const mode=/\breveal\b|\bselect(?:ed)?\b|নির্বাচন|সিলেক্ট/i.test(text)?'reveal':'open';
  const absolute=text.match(/["']([a-z]:[\\/][^"'\r\n]+)["']/i)?.[1]||text.match(/[a-z]:[\\/][^\r\n]+/i)?.[0]?.replace(/\s+(?:in (?:file )?explorer|please|open koro|খুলে দাও).*$/i,'').trim().replace(/[.!?।]+$/,'');
  if(absolute)return {name:'open_in_explorer',args:{path:absolute,mode}};
  const standard=text.match(/\b(Desktop|Documents|Downloads)(?:[\\/][^\s"']+)?/i)?.[0];
  if(standard)return {name:'open_in_explorer',args:{path:standard,mode}};
  const named=/^\s*(?:please\s+)?(?:(?:open|show|reveal)\s+)?(?:the\s+)?([a-z0-9][a-z0-9 _-]{0,60}?)\s+folder\b/i.exec(text)?.[1];
  if(named&&!/^(?:the|that|this|same|current|previous|your|my|file explorer)$/i.test(named))return {name:'open_in_explorer',args:{path:named.trim(),mode}};
  if(previous&&/^(?:(?:please|okay|ok|achha|accha|আচ্ছা|अच्छा|তো|তাহলে|now|again|abar|আবার|open|show|reveal|khulo)[,\s]+)*(?:(?:the|that|this|same|previous|current|oi|ei)\s+)?(?:folder\b|file\b|it\b|ফোল্ডারটা|ফোল্ডারটি|ফাইলটা|ফাইলটি|এটা|ওটা|फोल्डर|फ़ोल्डर|फाइल)/i.test(text.trim()))return {name:'open_in_explorer',args:{path:previous.path,mode}};
}
export function explorerTargetFromResult(name:string,result:Record<string,unknown>):ExplorerTarget|undefined {
  if(result.status!=='ok')return;
  if(name==='list_directory'&&typeof result.directory==='string')return {path:result.directory,type:'folder'};
  if(name==='read_file'&&typeof result.path==='string')return {path:result.path,type:'file'};
  if(name==='open_in_explorer'&&typeof result.path==='string')return {path:result.path,type:result.type==='folder'?'folder':'file'};
  if(name==='search_files'&&typeof result.directory==='string'&&Array.isArray(result.results)&&result.results.length===1&&typeof result.results[0]==='string')return {path:result.directory.replace(/[\\/]$/,'')+'/'+result.results[0],type:'file'};
}
export function explorerResultText(result:Record<string,unknown>,language:'bn'|'en') {
  const verified=result.status==='ok'&&(result.verification as {verified?:boolean}|undefined)?.verified===true;
  if(verified)return language==='en'?(result.mode==='reveal'?'The item is selected in File Explorer.':'The folder is open in File Explorer.'):(result.mode==='reveal'?'ফাইল এক্সপ্লোরারে চাওয়া আইটেমটি নির্বাচন করা আছে।':'ফাইল এক্সপ্লোরারে ফোল্ডারটি খোলা আছে।');
  if(result.status==='disabled')return language==='en'?'Fast desktop control is disabled. Enable it in Fast settings to open File Explorer.':'Fast সেটিংসে ডেস্কটপ কন্ট্রোল বন্ধ আছে। ফাইল এক্সপ্লোরার খুলতে সেটি চালু করুন।';
  if(result.status==='not_found')return language==='en'?'That file or folder path was not found. Please provide its exact location.':'ফাইল বা ফোল্ডারটি ওই ঠিকানায় পাওয়া যায়নি। সঠিক ঠিকানাটি দিন।';
  if(result.status==='needs_selection')return language==='en'?'More than one local path matches. Which exact path should I open?':'একাধিক ঠিকানা মিলে গেছে। কোন ঠিকানাটি খুলব?';
  return language==='en'?'The requested item is not confirmed open in File Explorer.':'চাওয়া আইটেমটি ফাইল এক্সপ্লোরারে খোলা নিশ্চিত হয়নি।';
}
export const fastExplorerInstruction='You can visibly open local folders and select local files with open_in_explorer when Fast desktop control is enabled. list_directory/read_file inspect data; they do not open a visible window. For follow-ups reuse the exact previously observed directory/file path. Discover unknown paths, clarify ambiguous matches, then call open_in_explorer; do not substitute a listing for opening. A file target is selected in Explorer, not executed or played. Say a setting is disabled or permission was denied only when the actual setting/tool result establishes it. Never invent an inability to open Explorer. Report success only from verification.verified=true; an uncertain effect must not be automatically repeated.';
