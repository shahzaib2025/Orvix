// Diagnostic-only runner: app sources and installed settings are not modified.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const prompts = [
  'Reply in English. Call get_weather for Dhaka, Bangladesh. Tell me the observed temperature, feels-like temperature and conditions. Finish the report rather than only acknowledging.',
  'Also check Sylhet using get_weather and compare it with the Dhaka result. Preserve the previous evidence, tell me which is warmer and by how many degrees, and call review_task before finishing.',
  'বাংলায় উত্তর দাও। get_weather দিয়ে রংপুর এবং রাজশাহীর আবহাওয়া দেখো। দুই শহরের তাপমাত্রা, অনুভূত তাপমাত্রা এবং অবস্থার তুলনা করো। যাচাই করে উত্তর শেষ করো।',
  'Reply in English. Use desktop_observe scope windows to list up to three actual visible application window titles. Do not launch, focus, close or type into anything. Register the requested outcome and call review_task.',
  'Continue the PC check. Use desktop_observe scope apps to discover Notepad, then scope windows to check whether Notepad is running. Separate an installed app from an open window. Do not launch or change anything. Use plan_task and review_task.',
  'Reply in English. Read https://florianbd.com/ with read_web_page. Establish what Florian BD sells from direct evidence and give two published product categories if available. Cite the exact source. Register outcomes with plan_task and use review_task. Unreadable evidence means unknown, not nonexistent.',
  'Also add Florian BD customer contact channels to the same task. Read its official site with read_web_page, retain verified earlier findings and report only explicitly published contact information with exact source URLs. Call review_task.',
  'Reply in English. Search about Florian BD and compare it with one relevant Bangladesh competitor. Use web_search and read_web_page. First establish both identities, then compare product categories and customer segment. Register each required outcome with plan_task, cite supporting source URLs, call review_task, and mark missing evidence unknown.',
  'বাংলায় উত্তর দাও। আগের ফ্লোরিয়ান বিডি ও প্রতিযোগীর তুলনায় প্রকাশিত ডেলিভারি তথ্য, রিটার্ন নীতি এবং দামের প্রমাণ যোগ করো। web_search এবং read_web_page ব্যবহার করো। আগের যাচাই করা তথ্য রাখো, অজানা তথ্য বানাবে না, plan_task এবং review_task দিয়ে প্রতিটি বিষয়ে কী যাচাই হয়েছে স্পষ্ট করে শেষ করো।',
  'Reply in English. Read Florian BD product listings and product pages using read_web_page. Report details and published prices for at most three actual products. Follow a listing link if the homepage does not show them. Clearly state which pages you read and whether the sample is complete. Use plan_task and review_task; do not describe three examples as the whole catalog.',
  'Reply in English. Read https://ai.google.dev/gemini-api/docs/function-calling with read_web_page. Explain who actually executes a tool call and how the tool result returns to the model. Plan these two outcomes, cite exact evidence and call review_task. Keep the answer concise.',
  'Continue that function-calling task. Read the same official page again using read_web_page with a focused query about multiple function calls. Explain parallel independent calls versus dependent calls if documented; label anything unsupported unknown. Preserve prior outcomes and call review_task.',
  'বাংলায় উত্তর দাও। আগের function-calling ব্যাখ্যা শেষ করো। review_task দিয়ে আগের প্রমাণ যাচাই করে টুল চালানো এবং ফল ফেরত দেওয়ার বিষয় দুইটি বাংলায় বলো। নতুন গবেষণা শুরু করবে না।',
  'Reply in English. Check whether https://www.uber.com/gh/en/ride/safety/audio-recording/ proves a Bangladesh policy. Call read_web_page only; do not search. Report the actual country-scope result and missing Bangladesh evidence. Call review_task and do not claim a Bangladesh policy was verified from a Ghana page.',
  'Reply in English. Use read_web_page only to inspect https://orvix-benchmark-does-not-exist.invalid/. Do not search or substitute a website. Report the actual failure and any remaining obstacle; never claim the page was read successfully. Call review_task if a task exists.',
  'বাংলায় উত্তর দাও। এখন get_weather দিয়ে খুলনার বর্তমান তাপমাত্রা এবং আবহাওয়া বলো। আগের ব্যর্থ পাতার কাজের সঙ্গে এটিকে মিশাবে না। যাচাই করে পূর্ণ উত্তর দাও।',
  'Reply in English. Use desktop_observe scope windows again and report up to three current window titles. Compare with earlier observations only where the actual evidence supports it. Do not interact with any window. Use plan_task and review_task.',
  'Reply in English. Read https://ai.google.dev/gemini-api/docs/live-api/capabilities with read_web_page. Explain generation completion versus turn completion and one documented interruption behavior. Register all requested outcomes, cite official source URLs, call review_task, and make no claims about physical microphone testing.',
  'Reply in English. Audit our earlier Florian BD comparison using read_web_page on its official site and the competitor source you identified earlier. Check two concrete claims, identify any unsupported delivery, return or price claim, and correct or qualify it. Preserve uncertainty. Use plan_task and review_task and distinguish direct page evidence from search excerpts.',
  'বাংলায় উত্তর দাও। আগের ফ্লোরিয়ান বিডি অডিটের বাকি উত্তর শেষ করো। review_task দিয়ে সংরক্ষিত প্রমাণ যাচাই করো, নতুন টুল দিয়ে গবেষণা আবার শুরু করবে না। কোন দাবি যাচাই হয়েছে এবং কোন তথ্য এখনো অজানা তা স্পষ্ট করো।',
];
const filename = path.join(__dirname, 'check_fast_long_conversation.cjs');
let source = fs.readFileSync(filename, 'utf8');
const start = source.indexOf('const prompts = ');
const end = source.indexOf('async function run(prompt, number)', start);
if (start < 0 || end < 0) throw new Error('Diagnostic harness markers changed');
source = source.slice(0, start) + 'const prompts = ' + JSON.stringify(prompts) + ';\n' + source.slice(end);
source = source.replace("const desktop=require('../electron/desktop-control.cjs').createDesktopControl();", "const nativeDesktop=require('../electron/desktop-control.cjs').createDesktopControl(); const desktop={observe:(...args)=>nativeDesktop.observe(...args),act:async()=>({status:'blocked',message:'This diagnostic permits observations only.'}),cancel:(...args)=>nativeDesktop.cancel(...args)};");
source = source.replace("['src/fastVoice.ts',", "['src/fastVoice.ts','src/fastTask.ts','src/fastSpeech.ts','electron/fast-outcomes.cjs','electron/fast-windows.cjs',");
source = source.replace("const report = { startedAt:", "const report = { diagnosticOnly: true, requestedTurns: 4, mutationPolicy: 'read-only', startedAt:");
source = source.replace("report.status = report.turns.every", "report.status = report.turns.length === 4 && report.turns.every");
// Exercise production restart recovery without a manual stop/start workaround.

process.argv.push('--multistep', '--limit=20', '--turns=4,5,14,15', '--tag=fixes-native-final-20261004');
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);


