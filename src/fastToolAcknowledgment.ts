import type { ProgressContext } from './fastProgressVoice';
import { weatherLocation } from './fastWeather';

// Reviewed fallback wording describes only the pending operation. It never
// includes user secrets, entered values, or a claim that work has succeeded.
export function toolAcknowledgment(context: ProgressContext, language: 'bn' | 'en'): string {
  const name = context.operation?.name || '', action = context.operation?.action || '';
  if (name === 'get_weather' && !context.recovery) {
    const place = weatherLocation(context.operation?.subject || '');
    if (place) return place.acknowledgment[language === 'bn' ? 0 : 1];
  }
  let words: [string, string];
  if (context.recovery) words = ['আচ্ছা, আবার চেষ্টা করি।', 'Okay, trying that action again.'];
  else if (name === 'open_local_file') words = ['আচ্ছা, ফাইলটা খুলছি।', 'Opening the file in its app.'];
  else if (name === 'position_window') words = ['আচ্ছা, উইন্ডোটা সাজাই।', 'Positioning the selected window.'];
  else if (name === 'web_search') words = ['আচ্ছা, তথ্যটা খুঁজে দেখি।', 'Okay, searching for the information.'];
  else if (name === 'read_web_page') words = ['হুম, পেজটা পড়ে দেখি।', 'Okay, reading the page.'];
  else if (/observe|snapshot|screen|capture|pc_status/.test(name)) words = ['আচ্ছা, বর্তমান অবস্থাটা দেখি।', 'Okay, checking the current state.'];
  else if (/search/.test(action)) words = ['আচ্ছা, খুঁজে দেখি।', 'Okay, searching for it.'];
  else if (/pause|stop/.test(action)) words = ['আচ্ছা, মিডিয়া থামাই।', 'Okay, pausing the media.'];
  else if (/play|resume/.test(action)) words = ['আচ্ছা, চালু করি।', 'Okay, starting the media.'];
  else if (/select/.test(action)) words = ['হুম, পছন্দটা বেছে নিই।', 'Okay, selecting the requested option.'];
  else if (/open|navigate|launch/.test(action) || /open|launch/.test(name)) words = ['আচ্ছা, খুলে দেখি।', 'Okay, opening it.'];
  else if (/minimize/.test(action)) words = ['আচ্ছা, উইন্ডোটা ছোট করি।', 'Okay, minimizing the window.'];
  else if (/maximize/.test(action)) words = ['আচ্ছা, উইন্ডোটা বড় করি।', 'Let me maximize that.'];
  else if (/restore/.test(action)) words = ['আচ্ছা, উইন্ডোটা ফিরিয়ে আনি।', 'Let me restore that.'];
  else if (/focus/.test(action)) words = ['আচ্ছা, উইন্ডোটা সামনে আনি।', 'Okay, bringing the window forward.'];
  else if (/close/.test(action)) words = ['আচ্ছা, বন্ধ করি।', 'Okay, closing it.'];
  else if (/list|directory/.test(name)) words = ['আচ্ছা, ফাইলের তালিকাটা দেখি।', 'Okay, checking the file list.'];
  else if (/read/.test(name)) words = ['হুম, ফাইলটা পড়ে দেখি।', 'Okay, reading the file.'];
  else if (/write|type|draft/.test(name + ' ' + action)) words = ['আচ্ছা, লিখে দিই।', 'Okay, preparing the text.'];
  else if (/click/.test(action)) words = ['আচ্ছা, বেছে নেওয়া জায়গায় চাপি।', 'Let me click that.'];
  else if (/scroll/.test(action)) words = ['আচ্ছা, পেজটা সরিয়ে দেখি।', 'Okay, scrolling the page.'];
  else if (name === 'get_weather') words = ['আচ্ছা, আবহাওয়াটা দেখে নিই।', 'Okay, checking the weather.'];
  else words = ['আচ্ছা, পরের কাজটা করি।', 'Okay, starting the next operation.'];
  return words[language === 'bn' ? 0 : 1];
}
