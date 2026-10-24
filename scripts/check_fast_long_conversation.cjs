// Real Fast Live conversation with production public search/page retrieval.
// Text input; PCM chunks counted, no microphone or audible speaker playback.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const project = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(project);
const { searchWeb, readSearchResultPage } = require('../electron/search.cjs');
const tag = process.argv.find(arg => arg.startsWith('--tag='))?.split('=')[1] || '';
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid report tag');
const suffix = tag ? `.${tag}` : '';
const reportFile = path.join(__dirname, `check_fast_long_conversation${suffix}.report.json`);
const report = { startedAt: new Date().toISOString(), scope: 'Real Gemini Live, production FastVoiceSession, real public web search and page retrieval; text input, audio chunks counted. No microphone, audible speaker playback, or browser fixtures.', turns: [] };
report.codeHashes=Object.fromEntries(['src/fastVoice.ts','electron/fast-work.cjs','electron/fast-ledger.cjs','electron/search.cjs','shared/work-tools.json','src/fastResearch.ts','src/fastRequest.ts','electron/fast-worker.cjs','shared/page-tool.json','electron/main.cjs','electron/preload.cjs','src/desktop.d.ts'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(project,file))).digest('hex')]));
let current, voice;
let validationMonitor, validationMonitorRoot;
const {createFastWork}=require('../electron/fast-work.cjs');
const desktop=require('../electron/desktop-control.cjs').createDesktopControl();
const listeners=new Set();
const work=createFastWork({groundingReviewer:require('../electron/fast-grounding.cjs').createGroundingReviewer(),browser:{observe:async()=>({status:'unavailable',message:'Browser bridge is not connected in this public-services test.'}),act:async()=>({status:'unavailable',message:'Browser bridge is not connected in this public-services test.'})},desktop,emit:event=>{for(const listener of listeners)listener(event);}});
const multistep=process.argv.includes('--multistep');
work.configure({desktopEnabled:multistep});
function save() { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); }
function elapsed() { return Date.now() - current.startedMs; }
global.window = { setTimeout, clearTimeout, orvixDesktop: {
  getFastSettings:async()=>work.settings(),
  updateFastTask:async input=>work.update(input),getFastTask:async id=>work.task(id),getFastContext:async id=>structuredClone(work.taskContext(id)),
  registerFastPlan:async(id,input)=>work.registerPlan(id,input),reviewFastCompletion:async(id,input)=>{const result=await work.reviewCompletionGrounded(id,input);current?.completionReviews?.push(JSON.parse(JSON.stringify(result)));return result;},
  beginFastEvidence:async(id,tool,input)=>work.beginEvidence(id,tool,input),recordFastEvidence:async(id,token,tool,input,result)=>work.recordEvidence(id,token,tool,input,result),
  setFastDelivery:async(id,state)=>work.delivery(id,state),cancelFastTask:id=>work.cancel(id),executeFast:async(id,tool,input)=>work.execute(id,tool,input),
  onFastWorkEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
  getPcSnapshot: async () => null,
  createLiveToken: require('../electron/live-auth.cjs').createLiveToken,
  getWeather: async input => {
    const entry = {location:input.location, startedMs:elapsed()}; current?.weather.push(entry);
    const result = await require('../electron/weather.cjs').getWeather(input);
    Object.assign(entry,{...result,elapsedMs:elapsed()-entry.startedMs});
    console.log(`WEATHER ${result.status}: ${input.location}`);save();return result;
  },
  searchWeb: async input => {
    const entry = { query: input.query, startedMs: elapsed() };
    current?.searches.push(entry);
    const result = await searchWeb(input);
    Object.assign(entry, { status: result.status, results: result.results, elapsedMs: elapsed() - entry.startedMs });
    console.log(`SEARCH ${result.status}: ${input.query}`); save(); return result;
  },
  readSearchPage: async input => {
    const entry = { url: input.url, query:input.query, offset:input.offset, startedMs: elapsed() };
    current?.pages.push(entry);
    const result = await readSearchResultPage(input);
    Object.assign(entry, { status: result.status, source: result.source, title: result.title, message: result.message, content: result.content, elapsedMs: elapsed() - entry.startedMs });
    console.log(`PAGE ${result.status}: ${input.url}`); save(); return result;
  },
  logLive: (kind, message, details) => {
    if (!current) return;
    if (kind === 'warn' || kind === 'error') current.diagnostics.push({ kind, message, details, atMs: elapsed() });
    if (message === '[FastVoice] Tool call completed') current.toolCompletions.push({ ...details, atMs: elapsed() });
  },
} };
const built = esbuild.buildSync({ entryPoints: [path.join(project, 'src/fastVoice.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.fast-long-conversation.cjs'), module);
loaded.filename = path.join(__dirname, '.fast-long-conversation.cjs'); loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { FastVoiceSession } = loaded.exports;
const scopeProbe = process.argv.includes('--scope-probe');
const productionSmoke = process.argv.includes('--production-smoke');
const continuityProbe = process.argv.includes('--continuity-probe');
const prompts = continuityProbe ? [
  'Reply in English. Call get_weather for Dhaka, Bangladesh. Give the observed temperature and conditions, then finish the answer.',
  'বাংলায় উত্তর দাও। get_weather দিয়ে সিলেটের বর্তমান তাপমাত্রা আর আবহাওয়া বলো। শুরু করছি বলে থেমে যাবে না।',
  'বলো শেষ করো। আগের সিলেটের ফলাফল দিয়ে উত্তর শেষ করো, review_task দিয়ে যাচাই করো; একই আবহাওয়ার কাজ আবার চালাবে না।',
  'Reply in English. Read https://florianbd.com/ using read_web_page. Establish what this business sells from the page, cite the source, and use review_task before narrating your findings. A failed read cannot prove nonexistence.',
  'Achha details do. Continue the same Florian BD task. Read the site again if needed and explain its products using retrieved evidence and review_task. Mark anything unsupported as unknown.',
  'বাংলায় উত্তর দাও। ফ্লোরিয়ান বিডির সবগুলা প্রোডাক্টের ডিটেইলস আর দাম দাও। আগে plan_task দিয়ে ক্যাটালগের ধাপ নিবন্ধন করো। প্রকাশিত ক্যাটালগ লিংক, পরবর্তী পৃষ্ঠা এবং বাকি লেখা দেখো। পুরোটা যাচাই সম্ভব না হলে কোন অংশ পড়েছ আর কোনটা বাকি আছে তা review_task দিয়ে স্পষ্ট করে বলো; নমুনাকে সব পণ্য বলবে না।',
  'Reply in English. Read https://ai.google.dev/api/live with read_web_page. Use query to locate BidiGenerateContentClientContent. Explain whether client content can interrupt current model generation, quote only supported evidence and call review_task.',
  'তারপর। আগের API ব্যাখ্যার বাকি উত্তর শেষ করো, review_task দিয়ে পুরোনো প্রমাণ যাচাই করো; নতুন কাজ শুরু করবে না।',
  'Reply in English. Call get_weather for Rajshahi, Bangladesh. Give the actual current temperature and conditions, with no unsupported nationwide conclusion.',
  'বাংলায় উত্তর দাও। এই নির্দিষ্ট পাতাটি বাংলাদেশের নীতি যাচাই করতে পারে কি না দেখো: https://www.uber.com/gh/en/ride/safety/audio-recording/. read_web_page কল করো, অন্য কোথাও সার্চ করবে না। দেশের সীমা, প্রকৃত ফলাফল এবং বাকি তথ্য স্পষ্ট করে শেষ করো।',
] : multistep ? [
  'Reply in English. Research https://florianbd.com using read_web_page. Establish its business identity, identify a relevant competitor using web_search, and compare their product categories and published delivery information. Cite exact source URLs. Mark missing delivery information unknown. First register all outcomes with plan_task and finish with review_task.',
  'Also include the published contact channels for Florian BD. Keep earlier verified work, add this outcome to the same plan, read its official page and cite the contact evidence. Explain any remaining unknowns and call review_task.',
  'Reply in English. Read https://ai.google.dev/gemini-api/docs/function-calling with read_web_page. Explain who executes a function call and what the application sends back. Register these two outcomes and source mappings; call review_task before your final answer.',
  'বাংলায় উত্তর দাও। read_web_page দিয়ে https://ai.google.dev/gemini-api/docs/function-calling পড়ো। টুল কে চালায় এবং ফলাফল কীভাবে মডেলকে ফেরত দেয় তা ব্যাখ্যা করো। plan_task এবং review_task ব্যবহার করো, সূত্রের URL দাও।',
  'Reply in English. Use desktop_observe scope windows to inspect the actual Windows PC. Report two observed application/window titles, or accurately explain if fewer are available. Do not focus, close, or type into anything. Use plan_task for each outcome, observed evidence IDs and review_task.',
  'Reply in English. Use desktop_observe scope apps to discover Notepad and then use desktop_observe scope windows to check whether it is open. Report discovery separately from running status. No launch, typing or closing. Plan the two dependent observations and call review_task.',
  'Reply in English. Read https://florianbd.com with read_web_page again. State its identity and one explicitly published product category. Cite the source, preserve uncertainty about unpublished prices, and call plan_task and review_task.',
  'Reply in English. Research https://www.uber.com/gh/en/ride/safety/audio-recording/ using read_web_page only. Do not search. Determine whether this page can verify a Bangladesh policy, explain the actual country-scope result and state the missing Bangladesh evidence. Use plan_task and review_task; do not claim that the policy is verified.',
  'Reply in English. Read https://ai.google.dev/gemini-api/docs/live-api/capabilities. Explain generation completion versus turn completion and one documented interruption behavior. Cite exact source text, call plan_task and review_task, and do not make claims about microphone tests.',
  'বাংলায় উত্তর দাও। desktop_observe দিয়ে Windows-এর খোলা উইন্ডো দেখো, তারপর apps দিয়ে Notepad খুঁজে দেখো। দেখা উইন্ডো এবং অ্যাপ খুঁজে পাওয়া আলাদা করে ব্যাখ্যা করো। কিছু খুলবে না, বন্ধ করবে না, লিখবে না। plan_task আর review_task ব্যবহার করো।',
] : productionSmoke ? [
  'Reply in English. Search about Florian BD in Bangladesh and compare it with competitors. Use web_search. First establish its identity from relevant evidence; explain products, customers, competitors and what remains unknown. A GitHub username or similarly named overseas business is not proof of a Bangladesh business. A failed search does not prove nonexistence. Finish with a clear conclusion and ask for the exact business website if identity is unresolved.',
  'Reply in English. Now search for florianbd com using web_search. Treat this as the exact domain florianbd.com. Do not substitute Floridian, Florida, Hurricane Ian, NASA, or similarly spelled domains. Explain which source actually matched and whether identity and competitor comparison were verified. Finish with a factual conclusion and blocker instead of promising later work.',
  'Reply in English. Search Daraz Bangladesh versus Pickaboo using web_search and read_web_page. Compare buying a phone in Dhaka, authenticity checks, delivery, returns, warranty and customer support using original official sources. Separate verified policies from unreadable or unverified details. Explain the practical buyer checklist and complete the comparison with source URLs.',
  'Reply in English. Give current weather for all eight divisions of Bangladesh. Call get_weather for Dhaka, Chattogram, Rajshahi, Khulna, Barishal, Sylhet, Rangpur and Mymensingh. Give each city temperature, conditions and observation time when available. Explain these are representative city readings, mark unavailable readings, and finish all eight without ending at the first city.',
  'Reply in English. Compare OpenAI GPT and Google Gemini for live voice and function calling. Research current official documentation using web_search and read_web_page. Explain generation versus turn completion, tool result handling, interruption and reconnect, and which model or API limitations you could verify. Provide an implementation checklist and clear conclusion with direct source URLs; do not claim universal model superiority.',
  'বাংলায় উত্তর দাও। Research whether https://www.uber.com/gh/en/ride/safety/audio-recording/ verifies the current ride safety policy for Bangladesh. Call read_web_page on this exact URL. Do not search for other pages. Explain the actual tool status, the country scope, what was verified and what is unknown. Finish clearly and do not claim a global feature rollout.',
] : scopeProbe ? [
  'Reply in English. Research whether https://www.uber.com/gh/en/ride/safety/audio-recording/ can verify the current ride safety policy for Bangladesh. Call read_web_page on this exact URL. Do not search for other pages. Explain the actual tool status, why the page can or cannot support a Bangladesh claim, what was verified, and which evidence remains missing. Do not say the feature is globally available unless the tool result establishes that. Finish this check with a clear conclusion.',
] : [
  'Reply in English. Search about Florian BD and compare it with its competitors in Bangladesh. First verify which company this name refers to; do not silently substitute another brand. Use web_search and read_web_page. Identify its products or services, customer segment, official website, two relevant competitors, pricing evidence, delivery or service coverage, strengths and weaknesses. Cite the source beside each current claim. If the identity is ambiguous, explain what you actually found and what clarification you need instead of inventing a comparison. Finish with a clear conclusion, not just a promise to research.',
  'Reply in English. Continue our Bangladesh business research: investigate the exact names "Florian BD", "Florian Bangladesh", and "Florianbd" with fresh web_search calls. Read a relevant page with read_web_page if there is a plausible match. Separate verified identity from similarly named businesses and explain whether the competitor comparison requested earlier can responsibly be completed. List the searches that worked, any unavailable sources, and the precise missing detail needed. Do not assert that a company does not exist merely because a search failed.',
  'Reply in English. Now research Daraz Bangladesh versus Pickaboo as options for buying electronics. Use web_search and read_web_page on current official sources. Compare their business model, product range, seller or authenticity risks, delivery coverage, warranty handling, return or refund requirements, and customer support. Explain which claims you verified and which policies you could not read. Give a practical recommendation for a Dhaka buyer buying a phone, with source URLs and limitations; do not make up live prices.',
  'Reply in English. Deepen the previous Daraz versus Pickaboo comparison with new web_search and read_web_page calls focused on return and warranty policies. Imagine a phone arriving damaged, a change-of-mind return, and a manufacturer defect after several weeks. Explain the steps a buyer should take in each case, what evidence must be saved, where policies differ, and which exact deadlines or exclusions you can verify. Distinguish seller promises from platform policy. Finish all three scenarios and cite the original policy pages.',
  'Reply in English. Research Chaldal versus Shwapno online grocery services for a family in Dhaka. Use web_search and read_web_page to compare verified delivery areas, delivery fees or minimum order evidence, payment choices, fresh food quality or substitution policies, returns, support, and convenience. Do not infer present coverage from an old article. Give a comparison and a practical shopping plan, with current source links and explicit unknowns rather than invented numbers.',
  'বাংলায় উত্তর দাও। বাংলাদেশে Pathao আর Uber নিয়ে বিস্তারিত গবেষণা করো। web_search এবং read_web_page ব্যবহার করে অফিসিয়াল সূত্রে রাইডের ধরন, শহর বা এলাকার কভারেজ, ভাড়ার পরিবর্তন, পেমেন্ট, নিরাপত্তার সুবিধা, বাতিলের নিয়ম ও অভিযোগ করার পদ্ধতি তুলনা করো। নির্দিষ্ট লাইভ ভাড়া অনুমান করবে না। ঢাকার একজন যাত্রীর তিনটি পরিস্থিতি—দৈনন্দিন অফিস, রাতের যাত্রা, বিমানবন্দর—নিয়ে ব্যবহারিক সিদ্ধান্ত দাও, প্রতিটি যাচাই করা দাবির পাশে সূত্রের URL দাও এবং অজানা বিষয় স্পষ্ট করো। শুধু কাজ করার প্রতিশ্রুতি দিয়ে থেমো না।',
  'Reply in English. Research Walton versus Singer Bangladesh for a household considering a refrigerator. Use web_search and read_web_page to compare official product specifications, stated warranty scope, service network evidence, delivery and installation terms, and published prices only where a specific current model page supports them. Avoid comparing different capacities as if identical. Explain how a buyer can choose comparable models, list unanswered questions, and provide a reasoned purchase checklist with sources.',
  'Reply in English. Research how Daraz, Pickaboo, Chaldal, Shwapno, Walton, and Singer publish customer support and after-sales information. Use new web_search calls and read_web_page to verify at least two official support or policy pages. Based on our earlier discussion, compare the transparency of their published contact channels, complaint escalation, return instructions, and warranty evidence. Separate a lack of readable evidence from a lack of service. End with a table-like comparison and the three most important questions a customer should ask.',
  'Reply in English. Audit our earlier competitor research using web_search and read_web_page again: verify two concrete policy claims from the Daraz/Pickaboo or Chaldal/Shwapno answers against original sources. Quote only brief policy wording if available. Say which claim survives verification, which must be corrected or qualified, and which pages failed to load. Include exact source URLs and explain whether you read direct page content or only a search excerpt. Do not simply repeat the earlier answer.',
  'Reply in English. Finish this business research conversation with a complete evidence-backed plan for evaluating Florian BD once its exact website is supplied. Use web_search and read_web_page to verify an official Bangladesh e-commerce or consumer guidance source relevant to the evaluation. Give a reusable competitor comparison framework covering identity, product match, prices, delivery, returns, warranty, customer support, trust signals, and unanswered questions. Connect it to the companies we discussed, clearly label any inference, list the remaining blockers, and give a final completion summary with sources.',
];
async function run(prompt, number) {
  current = { number, prompt, startedAt: new Date().toISOString(), startedMs: Date.now(), searches: [], pages: [], weather: [], toolCalls: [], toolCompletions: [], completionReviews:[], progress: [], statuses: [], segments: [], rawTranscription: [], diagnostics: [], receivedAudioChunks: 0, playedAudioChunks: 0 };
  report.turns.push(current); const turn = current;
  console.log(`TURN ${number} START`); save();
  let timer;
  const checkpoint = setInterval(() => {
    if (current === turn) {
      turn.sessionState = { connected: !!voice.session, serverResponseActive: voice.serverResponseActive, awaitingAnswer: voice.awaitingAnswer, activeTools: voice.activeToolCalls.size, retainedResults: voice.retainedResults.length, recoveryPending: voice.interruptedReplyPending };
      save();
    }
  }, 10000);
  const completed = new Promise((resolve, reject) => {
    turn.finish = resolve; turn.fail = reject;
    timer = setTimeout(() => reject(new Error('No completed answer within the bounded live test deadline')), continuityProbe ? 180000 : 240000);
  });
  // Connection errors can reject before start() returns. Keep that rejection
  // observed until the awaited turn result records it in the benchmark.
  void completed.catch(()=>{});
  try {
    if(!voice.session) {
      turn.connectionRecovery={attempted:true,priorRequestPreserved:false};
      // Keep the failed turn's result. Re-establish transport for the next
      // distinct request rather than producing seven artificial cascaded fails.
      await voice.start(false);
      const deadline=Date.now()+30000;
      while(!voice.session && !voice.stopped && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
      if(!voice.session)throw new Error('Live connection unavailable before this request.');
    }
    voice.sendText(prompt); await completed;
    turn.status = 'completed';
    turn.findings = [];
    if (!turn.toolCalls.length) turn.findings.push('No model function call; frontend research may have bypassed tool delegation');
    if (!continuityProbe && !multistep && !scopeProbe && !(productionSmoke && [4,6].includes(number)) && !turn.searches.length) turn.findings.push('No public search executed');
    if(multistep){turn.taskContext=JSON.parse(JSON.stringify(voice.taskContext || {}));turn.executionStatus=voice.taskContext?.status;if(!turn.completionReviews.length)turn.findings.push('No authoritative completion audit');if(turn.executionStatus!=='completed')turn.findings.push('Required outcomes remain unverified');}
    if(continuityProbe) {
      turn.taskContext=JSON.parse(JSON.stringify(voice.taskContext || {}));turn.executionStatus=voice.taskContext?.status;
      if([3,5,8].includes(number)) {const previous=report.turns.at(-2);if(previous?.taskContext?.id!==turn.taskContext.id)turn.findings.push('Follow-up replaced the preceding task.');}
      if([1,2,9].includes(number) && !/[\d০-৯].*(?:°|degrees|ডিগ্রি|সেলসিয়াস)/i.test(turn.answer || ''))turn.findings.push('Weather answer omitted the observed temperature.');
      if(number===6 && turn.executionStatus==='completed' && turn.pages.length<=1)turn.findings.push('A homepage sample was falsely accepted as the complete catalog.');
      if(/does not exist|no public footprint|অস্তিত্ব নেই/i.test(turn.answer || '') && !turn.pages.some(page=>page.status==='ok'))turn.findings.push('Unsupported business absence claim.');
    }
    if (productionSmoke && number === 2 && turn.pages.some(page => !new URL(page.url).hostname.endsWith('florianbd.com'))) turn.findings.push('Domain lookup read an unrelated host');
    if (productionSmoke && number === 2 && !turn.pages.some(page=>page.status==='ok' && new URL(page.url).hostname==='florianbd.com')) turn.findings.push('Supplied domain was not successfully read directly');
    if (productionSmoke && number === 2 && !/plant|nursery|নার্সারি|গাছ/i.test(turn.answer||'')) turn.findings.push('Domain identity was not established from the readable page');
    if (productionSmoke && number === 4 && turn.weather.length !== 8) turn.findings.push('Weather checklist did not execute all eight city lookups');
    if (productionSmoke && number === 4 && !turn.progress.some(item=>/missing audio|অনুপস্থিত অডিও/.test(item.text||'')) && turn.progress.some(item=>['Dhaka','Chattogram','Rajshahi','Khulna','Barishal','Sylhet','Rangpur','Mymensingh'].every(city=>item.text?.includes(city)) && /degrees|celsius|temperature/i.test(item.text))) turn.findings.push('Complete weather answer was unnecessarily regenerated');
    if (productionSmoke && number === 6 && (turn.searches.length || !turn.toolCompletions.some(call=>call.name==='read_web_page' && call.status==='out_of_scope'))) turn.findings.push('Country scope or search prohibition failed');
    if (scopeProbe && turn.searches.length) turn.findings.push('Executed searches despite the page-only restriction');
    if(multistep && turn.toolCalls.some(call=>call.name==='desktop_observe')) {
      const independent=await desktop.observe({scope:'windows',requestId:require('node:crypto').randomUUID()});
      turn.independentDesktopAudit={status:independent.status,observation:independent.observation};
      if(independent.status!=='ok')turn.findings.push('Independent native outcome observation unavailable');
    }
    if (!turn.playedAudioChunks) turn.findings.push('No response PCM admitted');
    if (!turn.answer?.trim()) turn.findings.push('Final answer is empty');
    if (/\bS\d+\b/.test(turn.answer || '')) turn.findings.push('Answer contains numeric source aliases rather than stable source URLs');
    if (/বাংলায় উত্তর/.test(prompt) && !/[\u0980-\u09ff]/.test(turn.answer || '')) turn.findings.push('Requested Bangla answer was not delivered');
    if (scopeProbe && !turn.toolCompletions.some(call => call.name === 'read_web_page' && call.status === 'out_of_scope')) turn.findings.push('Expected regional page rejection did not occur');
    console.log(`TURN ${number} COMPLETE ${elapsed()}ms tools=${turn.toolCalls.length} searches=${turn.searches.length} pages=${turn.pages.length} chars=${turn.answer?.length} findings=${turn.findings.join('; ')}`);
  } catch (error) {
    turn.status = 'failed'; turn.error = error.message;
    console.log(`TURN ${number} FAILED: ${error.message}`);
  } finally {
    if(multistep){turn.taskContext=JSON.parse(JSON.stringify(voice.taskContext || {}));turn.executionStatus=voice.taskContext?.status;}
    clearTimeout(timer); clearInterval(checkpoint); turn.elapsedMs = elapsed(); delete turn.finish; delete turn.fail; delete turn.startedMs;
    save(); current = null;
  }
}
(async () => {
  if(multistep) {
    const check=await desktop.observe({scope:'windows',requestId:require('node:crypto').randomUUID()});
    if(check.status!=='ok') {
      validationMonitor=require('node:child_process').spawn(path.join(project,'PC-Monitor-Test/bin/PCMonitor.Fast.exe'),['--quiet'],{windowsHide:true,stdio:'ignore',env:{...process.env}});
      validationMonitor.on('error',error=>{report.desktopSetupError=error.message;});
      const deadline=Date.now()+15000;
      while(Date.now()<deadline) {const observed=await desktop.observe({scope:'windows',requestId:require('node:crypto').randomUUID()});if(observed.status==='ok'){report.desktopSetup='production monitor launched for validation';break;}await new Promise(resolve=>setTimeout(resolve,300));}
      if(!report.desktopSetup)throw new Error('Native desktop observations unavailable during test setup.');
    } else report.desktopSetup='existing production monitor';
  }
  const historyFile = process.argv.find(arg => arg.startsWith('--history='))?.slice('--history='.length);
  const restored = historyFile ? JSON.parse(fs.readFileSync(historyFile, 'utf8')).turns.filter(turn => turn.status === 'completed').flatMap(turn => [{ role: 'user', text: turn.prompt, delivery: 'complete' }, { role: 'assistant', text: turn.answer, delivery: 'complete' }]) : [];
  if (historyFile) report.restoredFrom = historyFile;
  voice = new FastVoiceSession(restored, {
    onProgress: value => { if (current) current.progress.push({ text: value.text, phase: value.phase, atMs: elapsed() }); },
    onStatus: (status, detail) => { if (current) { current.statuses.push({ status, detail, atMs: elapsed() }); if (status === 'error') current.fail?.(new Error(detail)); } else { (report.startupStatuses ||= []).push({status,detail});console.log(`SESSION ${status}: ${detail || ''}`); } },
    onTranscript: value => {
      if (!current || value.role !== 'assistant') return;
      if (value.phase === 'progress') current.progress.push({ text: value.text, atMs: elapsed() });
      if (value.phase === 'final') {
        current.segments.push({ text: value.text, delivery: value.delivery, atMs: elapsed() });
        if (value.delivery === 'complete') { current.answer = value.text; current.finish?.(); }
      }
    },
  });
  voice.audioEngine.ensureContext = async () => {};
  voice.audioEngine.playAudio = () => { if (current) { current.playedAudioChunks++; current.firstAudioMs ??= elapsed(); } };
  voice.audioEngine.clearPlayback = () => {};
  voice.sessionLanguage = 'en';
  const handle = voice.handleMessage.bind(voice);
  voice.handleMessage = message => {
    if (current) {
      for (const call of message.toolCall?.functionCalls || []) current.toolCalls.push({ name: call.name, args: call.args, atMs: elapsed() });
      const content = message.serverContent;
      if (content?.outputTranscription?.text) { current.firstTranscriptMs ??= elapsed(); current.rawTranscription.push(content.outputTranscription.text); }
      current.receivedAudioChunks += (content?.modelTurn?.parts || []).filter(part => part.inlineData?.mimeType?.startsWith('audio/pcm')).length;
    }
    handle(message);
    const disconnectTurn = Number(process.argv.find(arg => arg.startsWith('--disconnect-turn='))?.split('=')[1]);
    if (current?.number === disconnectTurn && !current.injectedDisconnect && current.toolCompletions.length && current.receivedAudioChunks > 5 && voice.serverResponseActive) {
      current.injectedDisconnect = { atMs: elapsed(), reason: 'Controlled live-session close while task response is unfinished' };
      console.log(`TURN ${current.number} CONTROLLED DISCONNECT`);
      voice.session?.close();
    }
  };
  await voice.start(false);
  const connectionDeadline = Date.now() + 30000;
  while (!voice.session && !voice.stopped && Date.now() < connectionDeadline) await new Promise(resolve => setTimeout(resolve, 500));
  if (!voice.session) throw new Error(report.startupStatuses?.findLast(item=>item.status==='error')?.detail || 'Fast Live did not establish a session; see startup status in the run log');
  const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || 10);
  const selection = process.argv.find(arg => arg.startsWith('--turns='))?.split('=')[1].split(',').map(Number);
  for (let index = 0; index < Math.min(limit, prompts.length); index++) if (!selection || selection.includes(index + 1)) {
    await run(prompts[index], index + 1);
    if (/quota|billing|resource.exhausted|rate.limit|denied access|request was rejected/i.test(report.turns.at(-1)?.error || '')) {
      report.providerBlocked = true;
      const blocker=report.turns.at(-1)?.error || 'Provider unavailable';
      for (let next=index+1;next<Math.min(limit,prompts.length);next++) if(!selection || selection.includes(next+1)) report.turns.push({number:next+1,prompt:prompts[next],status:'not_run_provider_blocked',error:blocker+' No further requests were dispatched.',toolCalls:[],searches:[],pages:[],weather:[],findings:['Not tested because provider quota or project access was unavailable.']});
      break;
    }
  }
  report.status = report.turns.every(turn => turn.status === 'completed' && !turn.findings.length) ? 'passed' : 'issues_found';
  if (report.status !== 'passed') process.exitCode = 1;
})().catch(error => {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1; console.error(error);
  const limit=Number(process.argv.find(arg=>arg.startsWith('--limit='))?.split('=')[1] || 10);
  const selection=process.argv.find(arg=>arg.startsWith('--turns='))?.split('=')[1].split(',').map(Number);
  for(let index=0;index<Math.min(limit,prompts.length);index++)if((!selection || selection.includes(index+1)) && !report.turns.some(t=>t.number===index+1))report.turns.push({number:index+1,prompt:prompts[index],status:'not_run_provider_blocked',error:'Connection unavailable before this request: '+error.message,toolCalls:[],searches:[],pages:[],weather:[],findings:['Not dispatched; startup connection failed.']});
}).finally(() => {
  voice?.stop(); validationMonitor?.kill(); report.finishedAt = new Date().toISOString(); save();
  const transcript = [productionSmoke ? '# Fast: production six-turn conversation' : '# Fast: research conversation', '', report.scope, '', `Overall status: ${report.status}${report.error ? `; ${report.error}` : ''}`, '', ...report.turns.flatMap(turn => [`## Turn ${turn.number}`, '', turn.prompt, '', `Status: ${turn.status}; model tool calls: ${turn.toolCalls.length}; public searches: ${turn.searches.length}; page reads: ${turn.pages.length}; duration: ${turn.elapsedMs} ms.`, '', ...(turn.findings || []).map(item => `- ${item}`), '', turn.answer || turn.error || 'No final answer', ''])].join('\n');
  fs.writeFileSync(path.join(__dirname, `fast-long-conversation${suffix}.md`), transcript);
});
