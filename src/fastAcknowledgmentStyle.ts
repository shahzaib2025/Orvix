import type {ProgressContext} from './fastProgressVoice';

export type AcknowledgmentStyle = {length:'short'|'long'; targetWords:string; similarity:number; reason:string};
const normalize = (value:string) => value.normalize('NFKC').toLowerCase()
  .replace(/জিপিটি|চ্যাটজিপিটি|chatgpt/g,' gpt ').replace(/জেমিনি|জেমিনাই/g,' gemini ')
  .replace(/গুগল/g,' google ').replace(/ওপেনএআই/g,' openai ')
  .replace(/https?:\/\/[^\s]+|site:[^\s]+/g,' ')
  .replace(/\b(?:please|the|a|an|for|of|to|and|in|my|me|search|research|read|check|find|official|documentation|latest|current|letest|deo|dao|dekho|gula|gular|er)\b|খুঁজে|খুঁজছি|সার্চ|গবেষণা|দেখো|দেখুন|পড়ছি|পড়ছি|করো|করুন|সম্পর্কে|তথ্য|সর্বশেষ/g,' ');
const words = (value:string) => new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) || []);
function similarity(a:string,b:string) {
  const left=words(a),right=words(b);
  if(!left.size||!right.size)return 0;
  const common=[...left].filter(word=>right.has(word)).length;
  return 2*common/(left.size+right.size);
}
function isResearch(context:ProgressContext) {
  const name=context.operation?.name || '';
  if (['web_search','read_web_page','search_class10_textbook','read_class10_textbook_pages'].includes(name)) return true;
  if (['browser_act','desktop_act','manage_window','write_file','read_file','list_directory','search_files','search_content','manage_clipboard'].includes(name)) return false;
  return /\b(?:research|search|compare|comparison|models?|letest|latest)\b|গবেষণা|সার্চ|তুলনা|মডেল/i.test(context.goal);
}
export function acknowledgmentStyle(context:ProgressContext, recent:ProgressContext[]):AcknowledgmentStyle {
  const research = isResearch(context);
  const recentResearch = recent.slice(-6).filter(isResearch);
  const score = Math.max(0,...recentResearch.map(previous=> {
    const subject=context.operation?.subject || '', prior=previous.operation?.subject || '';
    const left=words(subject),right=words(prior);
    if(!left.size||!right.size)return similarity(context.goal,previous.goal);
    // A publisher page after a search on that publisher is a continuation.
    const page = context.operation?.name==='read_web_page' || previous.operation?.name==='read_web_page';
    const smaller=left.size<right.size?left:right,larger=left.size<right.size?right:left;
    const topic=page&&[...smaller].every(word=>larger.has(word))?1:similarity(subject,prior);
    return .35*similarity(context.goal,previous.goal)+.65*topic;
  }));
  const length = context.recovery || research && (!recentResearch.length || score<.7) ? 'long' : 'short';
  return {length,targetWords:context.recovery?'brief explanation':'2-6 with an action',similarity:Math.round(score*100),
    reason:context.recovery?'recovery_requires_explanation':!research?'ordinary_task':!recentResearch.length?'first_research_step':score>=.7?'related_followup':'new_research_topic'};
}
