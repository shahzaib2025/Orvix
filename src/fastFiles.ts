import type { ExplorerTarget } from './fastExplorer';
export type FileWindow={path?:string;handle:number;identity:string;app:string;title:string;state:string};
export type FileWindowChoice={path:string;windowState:string;windows:FileWindow[]};
export function selectedFileWindowOperation(text:string,choices?:FileWindowChoice):{name:string;args:Record<string,unknown>}|undefined {
  if(!choices)return;
  const index=/^(?:the\s+)?(?:first|1|প্রথম|এক)(?:\s|$)/i.test(text)?0:/^(?:the\s+)?(?:second|2|দ্বিতীয়|দ্বিতীয়|দুই)(?:\s|$)/i.test(text)?1:/^(?:the\s+)?(?:third|3|তৃতীয়|তিন)(?:\s|$)/i.test(text)?2:-1;
  if(index>=0&&choices.windows[index])return {name:'open_local_file',args:{path:choices.path,handle:choices.windows[index].handle,windowState:choices.windowState}};
}
const openWords=/\b(?:open|launch|khulo|khule|khol|kholo)\b|ওপেন|খুল|খোলো|खोल|ओपन/i;
const notAction=/\b(?:don't|do not|never|maybe|if)\b|\b(?:open|khulo)\s+na\b|খুলো না|খোলো না|খুলবে না|खोलो मत|मत खोल|^\s*(?:how|why|can I|could I)\b/i;
const commandText=(text:string)=>text.replace(/["'][^"'\r\n]*[\\/.][^"'\r\n]*["']/g,' file ')
  .replace(/[a-z]:[\\/][^\r\n]*?\.[a-z0-9]{2,5}(?=\s|[.!?।"']|$)/gi,' file ')
  .replace(/\S+\.[a-z0-9]{2,5}\b/gi,' file ');
export function fileOpenRequest(text:string,previous?:ExplorerTarget){
  const command=commandText(text);
  if(notAction.test(command)||/https?:\/\//i.test(text)||/\b(?:website|browser|youtube|tab)\b|ওয়েবসাইট/i.test(command))return false;
  if(/\b(?:explorer|reveal|select(?:ed)?|folder|directory)\b|এক্সপ্লোরার|ফোল্ডার|फोल्डर/i.test(command))return false;
  return openWords.test(command)&&(/\bfile\b|ফাইল|फ़ाइल|फाइल/i.test(command)||previous?.type==='file'&&/\bit\b|এটা|ওটা|এটি|ওটি|इसे/i.test(command));
}
export function requestedFileState(text:string):string|undefined {
  text=commandText(text);
  const left=/\bleft\b|বাম|বাঁ|bam|baam/i.test(text),right=/\bright\b|ডান|daan/i.test(text),top=/\btop\b|উপর|opore|upore/i.test(text),bottom=/\bbottom\b|নিচ|niche/i.test(text);
  if(left!==right)return (top!==bottom?(top?'top_':'bottom_'):'')+(left?'left':'right');
  if(/\bminimi[sz](?:e|ed|ing)\b|মিনিমাইজ|मिनिमाइज/i.test(text))return 'minimized';
  if(/\b(?:maximi[sz](?:e|ed|ing)|full\s*screen)\b|ম্যাক্সিমাইজ|পুরো স্ক্রিন|ফুল স্ক্রিন|मैक्सिमाइज/i.test(text))return 'maximized';
  if(/\b(?:restore|normal)\b|রিস্টোর|আগের আকার/i.test(text))return 'normal';
  if(/\bfocus\b|সামনে আন|samne ano|फोकस/i.test(text))return 'focus';
}
export function ambiguousFileLayout(text:string){return /\b(?:small portion|small window|half(?: the)? screen|quarter(?: of)?(?: the)? screen|corner)\b|ছোট অংশ|অর্ধেক|কোণায়|কোণায়/i.test(text)&&!requestedFileState(text);}
export function knownFileOperation(text:string,previous?:ExplorerTarget,window?:FileWindow):{name:string;args:Record<string,unknown>}|undefined {
  if(notAction.test(commandText(text))||ambiguousFileLayout(text))return;
  if(fileOpenRequest(text,previous)){
    const quoted=text.match(/["']([a-z]:[\\/][^"'\r\n]+)["']/i)?.[1];
    const absolute=text.match(/[a-z]:[\\/][^\r\n]+/i)?.[0]?.replace(/\s+(?:maximized|minimized|full screen|in (?:a |the )?(?:left|right|top|bottom)|please|reply|open koro|খুলে দাও).*$/i,'').replace(/[.!?।]+$/,'').trim();
    const named=text.match(/(?:^|[\s"'])([^\\/\s"']+\.[a-z0-9]{2,5})(?=$|[\s"'!?।])/i)?.[1];
    const file=quoted||absolute||(named&&previous?.type==='file'&&previous.path.replace(/\\/g,'/').split('/').at(-1)?.toLowerCase()===named.toLowerCase()?previous.path:named)|| (previous?.type==='file'?previous.path:undefined);
    if(file)return {name:'open_local_file',args:{path:file,windowState:requestedFileState(text)||'maximized'}};
  }
  if(!window)return;
  const followup=/\b(?:it|that|this|again|abar)\b|এটা|ওটা|এটাকে|ওটাকে|ফাইলটা|আবার|इसे|इसको/i.test(text);
  const app=window.app&&text.toLowerCase().includes(window.app.toLowerCase());
  if(!followup&&!app)return;
  // An explicit different app must not inherit the document's window.
  if(/\b(?:chrome|edge|notepad|word|excel|powerpoint|explorer|orvix|code)\b/i.test(text)&&!app)return;
  const state=requestedFileState(text),close=/\b(?:close|quit|get rid of it|bondho)\b|বন্ধ কর|बंद कर/i.test(text);
  if(close)return {name:'manage_window',args:{action:'close',handle:window.handle,appName:window.app}};
  if(state&&['left','right','top_left','top_right','bottom_left','bottom_right'].includes(state))return {name:'position_window',args:{handle:window.handle,layout:state}};
  if(state)return {name:'manage_window',args:{action:({minimized:'minimize',maximized:'maximize',normal:'restore',focus:'focus'} as Record<string,string>)[state],handle:window.handle,appName:window.app}};
}
export function fileWindowFromResult(name:string,result:Record<string,unknown>,previous?:FileWindow):FileWindow|undefined {
  if(name==='open_local_file'||name==='position_window'){
    const w=result.window as FileWindow|undefined;
    if(w&&Number.isSafeInteger(w.handle)&&typeof w.identity==='string')return {...w,path:typeof result.path==='string'?result.path:previous?.path};
  }
  if(name==='manage_window'&&result.handle===previous?.handle&&result.verification&&(result.verification as {verified?:boolean}).verified===true){
    if(result.action==='close')return;
    return {...previous!,state:({maximize:'maximized',minimize:'minimized',restore:'normal'} as Record<string,string>)[String(result.action)]||previous!.state};
  }
}
export function fileResultText(result:Record<string,unknown>,language:'en'|'bn'){
  if(result.status==='ok'&&(result.verification as {verified?:boolean}|undefined)?.verified){
    const state=String(result.requestedState||result.action||'focus');
    const en:Record<string,string>={maximized:'The file is open in its app, maximized.',minimized:'The file window is minimized.',normal:'The file window is restored.',focus:'The file window is in front.',maximize:'The file window is maximized.',minimize:'The file window is minimized.',restore:'The file window is restored.',close:'The file window is closed.',left:'The window fills the left half.',right:'The window fills the right half.',top_left:'The window fills the top-left quarter.',top_right:'The window fills the top-right quarter.',bottom_left:'The window fills the bottom-left quarter.',bottom_right:'The window fills the bottom-right quarter.'};
    const bn:Record<string,string>={maximized:'ফাইলটি তার অ্যাপে ম্যাক্সিমাইজ অবস্থায় খোলা আছে।',minimized:'ফাইলের উইন্ডোটি মিনিমাইজ করা আছে।',normal:'ফাইলের উইন্ডোটি আগের আকারে আছে।',focus:'ফাইলের উইন্ডোটি সামনে আছে।',maximize:'ফাইলের উইন্ডোটি ম্যাক্সিমাইজ করা আছে।',minimize:'ফাইলের উইন্ডোটি মিনিমাইজ করা আছে।',restore:'ফাইলের উইন্ডোটি আগের আকারে আছে।',close:'ফাইলের উইন্ডোটি বন্ধ হয়েছে।',left:'উইন্ডোটি স্ক্রিনের বাম অর্ধেকে আছে।',right:'উইন্ডোটি স্ক্রিনের ডান অর্ধেকে আছে।',top_left:'উইন্ডোটি উপরের বাম কোণায় আছে।',top_right:'উইন্ডোটি উপরের ডান কোণায় আছে।',bottom_left:'উইন্ডোটি নিচের বাম কোণায় আছে।',bottom_right:'উইন্ডোটি নিচের ডান কোণায় আছে।'};
    return (language==='en'?en:bn)[state]||(language==='en'?'The requested window state is verified.':'চাওয়া উইন্ডোর অবস্থা যাচাই হয়েছে।');
  }
  if(result.status==='confirmation_required')return language==='en'?'Please approve closing this window in Orvix.':'এই উইন্ডোটি বন্ধ করতে Orvix-এ অনুমোদন দিন।';
  if(result.status==='needs_selection')return language==='en'?'More than one matching file or window was found. Which one should I use?':'একাধিক ফাইল বা উইন্ডো মিলে গেছে। কোনটি ব্যবহার করব?';
  if(result.status==='unsupported_file')return language==='en'?'This file type cannot be opened automatically. I can show it in Explorer.':'এই ধরনের ফাইল স্বয়ংক্রিয়ভাবে খোলা যাবে না। এক্সপ্লোরারে দেখাতে পারি।';
  if(result.status==='not_found')return language==='en'?'That file was not found. Please give its exact location.':'ফাইলটি পাওয়া যায়নি। সঠিক ঠিকানাটি দিন।';
  if(result.status==='disabled')return language==='en'?'Fast desktop control is disabled. Enable it in Fast settings.':'Fast সেটিংসে ডেস্কটপ কন্ট্রোল বন্ধ আছে। সেটি চালু করুন।';
  if(result.status==='stale_target')return language==='en'?'The remembered file window changed or closed. Please select the current window.':'মনে রাখা ফাইলের উইন্ডোটি বদলে গেছে বা বন্ধ হয়েছে। বর্তমান উইন্ডোটি বেছে দিন।';
  if(result.status==='unavailable')return language==='en'?'Windows window observation is unavailable; I could not confirm this file action.':'উইন্ডোর অবস্থা দেখা যাচ্ছে না; ফাইলের এই কাজটি নিশ্চিত করা যায়নি।';
  if(result.status==='failed')return language==='en'?'Windows could not open this file in its default app.':'Windows ফাইলটি তার ডিফল্ট অ্যাপে খুলতে পারেনি।';
  if(result.action==='close')return language==='en'?'The window is not confirmed closed; check for an unsaved-changes prompt.':'উইন্ডোটি বন্ধ হওয়া নিশ্চিত হয়নি; অসম্পূর্ণ পরিবর্তন সেভ করার বার্তা আছে কি না দেখুন।';
  return language==='en'?'The requested file window or its state could not be verified.':'চাওয়া ফাইলের উইন্ডো বা তার অবস্থা নিশ্চিত করা যায়নি।';
}
export const fastFilesInstruction='Fast can open documents and media in their default Windows apps with open_local_file. Plain open means maximized with taskbar visible; explicit minimize/normal/focus/snap position overrides this. Never substitute read_file or Explorer selection for opening the associated app. Use previously observed exact paths; discover unknown paths and clarify ambiguity. Scripts/installers/programs are not automatically launched. Track the returned window handle/identity. For minimize/maximize/restore/focus/close follow-ups use manage_window on the same handle; position_window handles left/right halves and top/bottom corners. Ask which side/corner for unspecified small portions. Close means close the window, never delete its file. Do not close other app windows or dismiss unsaved-change prompts. Only verification.verified=true proves the requested state; uncertain opening must not be repeated.';
