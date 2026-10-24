import type { ProgressContext } from './fastProgressVoice';

// Generic, reviewed speech only: no user data is retained in the shared cache.
const clips=new Map<'bn'|'en',string[]>();
export const readAcknowledgmentText=(language:'bn'|'en')=>language==='en'
  ? 'Okay, I am looking up the information.' : 'আচ্ছা, তথ্যটা খুঁজে যাচাই করে দেখছি।';
export const cachedReadAcknowledgment=(language:'bn'|'en')=>clips.get(language);
export function cacheReadAcknowledgment(language:'bn'|'en',audio:string[]) {
  if(audio.length&&audio.reduce((sum,chunk)=>sum+chunk.length,0)<=640_000)clips.set(language,audio);
}
export function contextualReadAcknowledgment(context:ProgressContext,language:'bn'|'en') {
  const subject=(context.operation?.subject||'').normalize('NFKC').replace(/[\r\n<>`"“”]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
  if(!subject)return readAcknowledgmentText(language);
  const reading=context.operation?.name==='read_web_page';
  return language==='en'?`Okay, I am ${reading?'reading':'looking up'} ${subject}.`
    : `আচ্ছা, ${subject} ${reading?'পড়ে যাচাই করছি':'সম্পর্কে খুঁজে দেখছি'}।`;
}
