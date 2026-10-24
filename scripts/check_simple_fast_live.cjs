// Real Live API and public research services, typed prompts and counted PCM.
// This does not test physical microphone capture, speakers, or the packaged app.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
const {searchWeb,readSearchResultPage}=require('../electron/search.cjs');
const report={scope:'SimpleFastVoiceSession; real Live provider and public page retrieval; typed input, counted PCM only.',turns:[]};
const incident=process.argv.includes('--incident');
const latency=process.argv.includes('--latency');
const workLoop=process.argv.includes('--work-loop');
const regression20=process.argv.includes('--streaming-regression');
const modelClaimsRetest=process.argv.includes('--claims-model-retest');
const claimsRetest=process.argv.includes('--claims-retest');
const focusedRetest=process.argv.includes('--streaming-retest');
const tag=process.argv.find(arg=>arg.startsWith('--tag='))?.slice(6)||'';
const pcStatusDiagnostic=process.argv.includes('--pc-status-diagnostic');
if(tag&&!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid report tag');
const file=path.join(project,(workLoop?'scratch/simple-fast-work-loop-live.report.json':latency?'scratch/simple-fast-generated-ack-live.report.json':incident?'scratch/simple-fast-incident-live.report.json':'scratch/simple-fast-live.report.json').replace('.report.json',`${tag?'.'+tag:''}.report.json`));fs.mkdirSync(path.dirname(file),{recursive:true});
if(regression20&&process.argv.includes('--resume')&&fs.existsSync(file))Object.assign(report,JSON.parse(fs.readFileSync(file,'utf8')));
let turn,finish,voice,active=0,maxActive=0;
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
function diagnosticSnapshot(){
  const stateFile=path.join(process.env.LOCALAPPDATA||'', 'PCMonitorTest/current-state.json');
  try {
    const ageMs=Date.now()-fs.statSync(stateFile).mtimeMs;
    if(ageMs>10000)return {snapshot:null,ageMs};
    const raw=JSON.parse(fs.readFileSync(stateFile,'utf8').replace(/^\uFEFF/,''));
    return {ageMs,snapshot:{Windows:(raw.Windows||[]).map(w=>({...w,Title:w.App+' window',Document:''})),Media:raw.Media||[],Browsers:(raw.Browsers||[]).map(b=>({...b,Tabs:[],Videos:(b.Videos||[]).map(v=>({...v,title:'Reported media'}))})),Activity:raw.Activity,Volume:raw.Volume,Muted:raw.Muted}};
  }catch{return {snapshot:null,ageMs:null};}
}
if(pcStatusDiagnostic){report.scope='Real Live typed conversation, real PC monitor file captured at connection startup; window titles and tab details omitted. Simulated PCM playback, no physical microphone/speakers or computer control.';report.pcSnapshotReads=[];}
async function operation(name,input,execute){
  const item={name,input,startedAt:Date.now()};turn.operations.push(item);active++;maxActive=Math.max(maxActive,active);save();
  try{const result=await execute(input);item.result=result;return result;}finally{active--;item.endedAt=Date.now();save();}
}
global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{
  createLiveToken:require('../electron/live-auth.cjs').createLiveToken,getPcSnapshot:async()=>{if(!pcStatusDiagnostic)return null;const observed=diagnosticSnapshot();report.pcSnapshotReads.push({at:Date.now(),ageMs:observed.ageMs,activeApp:observed.snapshot?.Windows.find(w=>w.Active)?.App,currentDwell:observed.snapshot?.Activity?.DwellTimes?.find(d=>d.IsCurrent),media:observed.snapshot?.Media,playingVideos:observed.snapshot?.Browsers?.flatMap(b=>b.Videos.filter(v=>v.playing)),duringTurn:turn?.prompt||null});save();return observed.snapshot;},
  getFastSettings:async()=>({desktopEnabled:pcStatusDiagnostic,transcriptionHints:false}),onFastWorkEvent:()=>()=>{},
  updateFastTask:async()=>({id:'diagnostic-read-only',windowTargets:[]}),cancelFastTask(){},
  executeFast:async(_id,name,args)=>operation(name,args,async()=>{
    if(!pcStatusDiagnostic||!['desktop_observe','browser_observe'].includes(name))return {status:'unavailable',dispatched:false,message:'Diagnostic allows observations only; no computer actions.'};
    const observed=diagnosticSnapshot();return observed.snapshot?{status:'ok',observation:observed.snapshot,snapshotAgeMs:observed.ageMs}:{status:'unavailable',message:'Fresh PC monitor state unavailable.'};
  }),
  searchWeb:input=>operation('web_search',input,searchWeb),readSearchPage:input=>operation('read_web_page',input,readSearchResultPage),
  reviewFastCompletion:()=>{throw Error('Simple Fast must not use legacy completion review');},
  logLive:(kind,message,details)=>{
    if(!turn)return;turn.events.push({kind,message,details,at:Date.now()});save();
    if(kind==='tool'||kind==='warn'||kind==='error'||message.endsWith('Acknowledgment finished'))console.log(message,JSON.stringify(details));
    if(message.endsWith('Report delivered'))finish?.({delivery:details.delivery,renderer:details.renderer});
  },
}};
const code=require('esbuild').buildSync({entryPoints:[path.join(project,'src/simpleFastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;
const loaded=new Module(__filename,module);loaded.paths=module.paths;loaded._compile(code,__filename);
const prompts=process.argv.includes('--research-context-retest')?[
 'Research upcoming GPT model leaks using current public reports and the official OpenAI catalog. Distinguish old rumors from confirmed releases. Reply briefly in English with dated sources.',
 'terra er kono update?',
 'terra model er',
 'gpt er',
 'Use only the previously retrieved information. What remains uncertain? No new search or actions; reply in two English sentences.',
]:process.argv.includes('--ack-conversation')?[
 'hi',
 'valo asi tmi kmn aso? Bangla script-e choto uttor dao.',
 'https://example.com/ page ta pore bolo eta ki. Banglay ek bakye bolo.',
 'Search online for solar panel basics from official sources. Use an English search query and give a short Bangla answer; say if search is unavailable.',
 'প্রথমে https://example.com/ পড়ো, তারপর https://ai.google.dev/gemini-api/docs/function-calling পড়ো। প্রতিটি টুলের ফলের পর পরের কাজ করো। দুই পৃষ্ঠার উদ্দেশ্য বাংলায় দুই বাক্যে বলো।',
 'আগের পড়া তথ্য থেকে function calling কী বাংলায় এক বাক্যে বলো। নতুন সার্চ বা টুল লাগবে না।',
]:process.argv.includes('--prepared-ack-multistep')?[
 'বাংলায় সংক্ষেপে বলো: প্রথমে https://example.com/ পড়ো, তারপর https://ai.google.dev/gemini-api/docs/function-calling পড়ো। দুই পৃষ্ঠার উদ্দেশ্য আলাদা করে বলো।',
]:pcStatusDiagnostic?[
 'hi',
 'accha koyta jbe?',
 'accha pc status dekho to',
 'Ekhon fresh kore pc status check koro. Kon app active ar media ekhon cholche kina dekho. Bangla script-e uttor dao.',
]:process.argv.includes('--banglish-retest')?[
 'florian bd er protiddhondi khujo to. Reply briefly in English; label candidates and missing evidence.',
 'na nao bolo oder khoj niye. Reply briefly in English with documented facts and source URLs.',
 'tahole data niye amk janao. Gather new documented data before answering; do not infer that missing data proves no competitors exist. Reply in two English sentences.',
]:modelClaimsRetest?[
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one supported model selection consideration in two English sentences.',
 'আগের তুলনার ভিত্তিতে একটি ব্যবহারিক বিবেচনা বাংলায় বলো। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. State one model from each and explain that these pages do not establish which is best. Reply in two English sentences.',
]:claimsRetest?[
 'Search for Florian BD competitors and compare one documented aspect. Do not invent competitors or facts; label missing evidence. Reply briefly in English.',
 'আগের প্রতিযোগী তুলনার সীমাবদ্ধতা বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one supported model selection consideration in two English sentences.',
 'আগের তুলনার ভিত্তিতে একটি ব্যবহারিক বিবেচনা বাংলায় বলো। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. State one model from each and explain that these pages do not establish which is best. Reply in two English sentences.',
]:focusedRetest?[
 'Search online about Florian BD and report one sourced fact briefly. If evidence is missing, say so. Reply in English.',
 'Search for Florian BD competitors and compare one documented aspect. Do not invent competitors or facts; label missing evidence. Reply briefly in English.',
 'Read https://ai.google.dev/gemini-api/docs/function-calling and determine who executes custom function code: the model or the application? Find the relevant section before answering; do not infer this from a function declaration example. Reply in English.',
 'আগের সূত্র অনুযায়ী function code কে চালায় বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।',
]:regression20?[
 'Read https://ai.google.dev/gemini-api/docs/models and tell me one listed model and its intended use. Reply in English in one sentence.',
 'আগের পড়া তথ্য থেকে সেই মডেলের ব্যবহার বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।',
 'Read https://developers.openai.com/api/docs/models and tell me one listed model and its intended use. Reply in English in one sentence.',
 'আগের পড়া OpenAI তথ্য বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one documented intended use from each in two English sentences.',
 'আগের দুই সূত্র থেকে তুলনাটি বাংলায় দুই বাক্যে বলো। নতুন খোঁজ নয়।',
 'Read https://ai.google.dev/gemini-api/docs/function-calling and explain function calling in one English sentence.',
 'আগের function calling ব্যাখ্যাটি বাংলায় এক বাক্যে বলো। নতুন তথ্য দরকার নেই।',
 'Read https://ai.google.dev/gemini-api/docs/live-api/capabilities and tell me one documented Live capability in one English sentence.',
 'আগের Live capability বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।',
 'Search online about Florian BD and report one sourced fact briefly. If evidence is missing, say so. Reply in English.',
 'আগের Florian BD অনুসন্ধানে কী জানা গেছে বাংলায় বলো। নতুন খোঁজ লাগবে না।',
 'Search for Florian BD competitors and compare one documented aspect. Do not invent competitors or facts; label missing evidence. Reply briefly in English.',
 'আগের প্রতিযোগী তুলনার সীমাবদ্ধতা বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one supported model selection consideration in two English sentences.',
 'আগের তুলনার ভিত্তিতে একটি ব্যবহারিক বিবেচনা বাংলায় বলো। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/function-calling and tell me whether tools require application execution. Reply briefly in English.',
 'আগের উত্তরের ভিত্তিতে tool execution বাংলায় এক বাক্যে বোঝাও। নতুন খোঁজ লাগবে না।',
 'Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. State one model from each and explain that these pages do not establish which is best. Reply in two English sentences.',
 'আগের দুই পৃষ্ঠার তুলনা বাংলায় দুই বাক্যে দাও। নতুন খোঁজ লাগবে না।',
]:workLoop?[
  'Hello. Reply in English in one short sentence.',
  'গুগল আর ওপেনএআই-এর বর্তমান API মডেলের তথ্য এক এক করে পড়ে তুলনা করো। বাংলায় সর্বোচ্চ তিনটি বাক্যে প্রত্যেকটির একটি ব্যবহার বলো এবং তথ্যের সীমাবদ্ধতা বোঝাও।',
  'Reply in English. Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time, using each result before choosing the next call. Compare one documented intended use from each in two sentences. Cite both pages.',
  'আগের পড়া একই তথ্য থেকে বাংলায় দুই বাক্যে তুলনাটি বলো। নতুন তথ্য বা নতুন খোঁজ লাগবে না।',
]:latency?[
  'Achha GPT latest model aur Gemini latest model compare karo to.',
  'আগের দুটির তথ্য থেকে বাংলায় সংক্ষিপ্ত তুলনা বলো, শুধু পড়া সূত্রের তথ্য ব্যবহার করো।',
  'OpenAI-er latest model gular API তথ্য দাও, সংক্ষেপে বাংলায় বলো।',
]:incident?[
  'Hello.',
  'क्या करूं?',
  'Achha, ChatGPT latest model gula and Google latest model gula compare koro to.',
  'bailar',
  'Pahle apne tattu bula, pehle.',
  'বাংলায় উত্তর দাও। আগের গুগল ও ওপেনএআই তুলনার তথ্য থেকে দুটির ব্যবহারিক পার্থক্য বোঝাও। কেবল পড়া সূত্রে সমর্থিত তথ্য বলো।',
]:[
  'google er letest model gular tottho deo to',
  'Reply in English. Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one documented capability or intended use from each publisher and explain what this evidence cannot establish about which is best. Cite the read URLs. Do not search other pages.',
  'বাংলায় উত্তর দাও। আগের একই দুটি পৃষ্ঠা আবার একবার করে পড়ে দেখো। গুগল ও ওপেনএআই-এর মডেল বেছে নেওয়ার জন্য দুটি বাস্তব বিবেচনা বলো। শুধু পৃষ্ঠায় পাওয়া তথ্য ব্যবহার করো এবং অনুপস্থিত তথ্য অজানা বলো।',
];
(async()=>{
  voice=new loaded.exports.SimpleFastVoiceSession(report.turns.flatMap(t=>[{role:'user',text:t.prompt},...(t.answer?[{role:'assistant',text:t.answer,delivery:t.delivery==='complete'?'complete':'interrupted'}]:[])]),{onStatus:(status,detail)=>{if(status==='error'&&turn)finish?.({error:detail});},onProgress(){},onTranscript:e=>{if(turn){turn.transcripts.push({...e,at:Date.now()});if(e.phase==='final')turn.answer=e.text;}}});
  voice.audioEngine.ensureContext=async()=>{};voice.audioEngine.playAudio=(_pcm,onStart)=>{if(turn)turn.audioChunks++;onStart?.();return Date.now();};
  try{
    const originalReport=voice.report.bind(voice);
    voice.report=async(...args)=>{if(turn)turn.generatedAnswer=voice.turnText;return originalReport(...args);};
    await voice.start(false);
    for(const prompt of prompts.slice(report.turns.length,process.argv.includes('--single')?1:prompts.length)){
      turn={prompt,transcripts:[],events:[],operations:[],audioChunks:0,startedAt:Date.now()};report.turns.push(turn);let timer;
      const done=new Promise(resolve=>{finish=resolve;timer=setTimeout(()=>resolve({error:'150-second live deadline reached'}),150_000);});
      voice.sendText(prompt);Object.assign(turn,await done);clearTimeout(timer);finish=undefined;
      if(pcStatusDiagnostic){turn.pcAtEnd=diagnosticSnapshot();turn.pcAtEnd={ageMs:turn.pcAtEnd.ageMs,activeApp:turn.pcAtEnd.snapshot?.Windows.find(w=>w.Active)?.App,media:turn.pcAtEnd.snapshot?.Media,playingVideos:turn.pcAtEnd.snapshot?.Browsers?.flatMap(b=>b.Videos.filter(v=>v.playing))};}
      // A delivery callback precedes pump cleanup and a stalled-session stop.
      // Do not accidentally interrupt that cleanup with the next test request.
      await new Promise(resolve=>setTimeout(resolve,100));
      for(let i=0;i<100&&!voice.stopped&&(voice.pumping||voice.speaking);i++)await new Promise(resolve=>setTimeout(resolve,10));
      turn.elapsedMs=Date.now()-turn.startedAt;turn.maxConcurrentOperations=maxActive;
      turn.acknowledgments=turn.events.filter(e=>e.message.endsWith('Acknowledgment audio onset'));
      turn.acknowledgmentPlayback=turn.events.filter(e=>e.message.endsWith('Acknowledgment audio onset')).map(e=>({tool:e.details.tool,elapsedSinceRequestMs:e.at-turn.startedAt,...e.details}));
      const ordered=turn.operations.every((op,index)=>turn.acknowledgments.some(e=>e.details.tool===op.name&&e.at<=op.startedAt&&(!index||e.at>=turn.operations[index-1].endedAt)));
      turn.orderingPassed=ordered&&maxActive<=1;save();
      console.log('TURN',JSON.stringify({operations:turn.operations.length,orderingPassed:turn.orderingPassed,delivery:turn.delivery,error:turn.error,answer:turn.answer}));
      if(turn.error||voice.stopped){if(!regression20&&!process.argv.includes('--banglish-retest'))break;voice.stop();await voice.start(false);}
    }
    if(process.argv.includes('--ack-conversation')){
      report.audit={requestedTurns:prompts.length,completedTurns:report.turns.filter(t=>t.delivery==='complete'&&!t.error).length,
        everyToolAcknowledgedBeforeDispatch:report.turns.every(t=>t.orderingPassed),
        multistepToolCalls:report.turns[4]?.operations.length||0,
        turns:report.turns.map(t=>({prompt:t.prompt,tools:t.operations.length,acknowledgments:t.transcripts.filter(e=>e.phase==='progress'&&e.delivery==='complete').map(e=>e.text),onsetMs:t.acknowledgmentPlayback.map(e=>e.elapsedMs),delivery:t.delivery,error:t.error}))};save();
      console.log('ACK CONVERSATION AUDIT',JSON.stringify(report.audit));
    }
    if(regression20){report.audit={requests:report.turns.length,delivered:report.turns.filter(t=>t.delivery==='complete'&&!t.error).length,sequentialExplainedOperations:report.turns.every(t=>t.orderingPassed),failures:report.turns.filter(t=>t.error||t.delivery!=='complete').map(t=>({prompt:t.prompt,error:t.error,answer:t.answer}))};save();console.log('REGRESSION AUDIT',JSON.stringify(report.audit));}
    if(incident){
      const comparison=report.turns[2],ambiguous=report.turns[4];
      report.audit={
        allSixReportsFinished:report.turns.length===6&&report.turns.every(t=>t.answer&&!t.error),
        sequentialExplainedOperations:report.turns.every(t=>t.orderingPassed),
        naturalComparisonReadBothCatalogs:comparison?.operations.length===2&&comparison.operations.every(op=>op.name==='read_web_page')&&comparison.operations.some(op=>op.input.url.includes('ai.google.dev'))&&comparison.operations.some(op=>op.input.url.includes('openai.com')),
        unclearFollowupClarified:!!ambiguous?.answer&&/নাকি|or something else/.test(ambiguous.answer)&&ambiguous.operations.length===0,
        conversationalHindiHadNoWorkPromise:!!report.turns[1]?.answer&&!report.turns[1].transcripts.some(e=>e.phase==='progress'),
        finalAudioDelivered:report.turns.every(t=>t.delivery==='complete'),
        writtenOnlyExplanations:report.turns.flatMap(t=>t.acknowledgments||[]).filter(e=>e.details.delivery==='visible_only').length,
      };save();
      if(Object.entries(report.audit).some(([key,value])=>key!=='writtenOnlyExplanations'&&value===false))process.exitCode=1;
      console.log('AUDIT',JSON.stringify(report.audit));
    }
    if(workLoop){
      report.audit={
        allReportsFinished:report.turns.length===4&&report.turns.every(t=>t.answer&&!t.error),
        sequentialExplainedOperations:report.turns.every(t=>t.orderingPassed),
        oneResultCheckPerExecutedTool:report.turns.every(t=>t.events.filter(e=>e.message.endsWith('Tool completed')).length===t.operations.length),
        chatSkippedWorkLoop:report.turns[0]?.operations.length===0&&report.turns[0]?.acknowledgments.length===0,
        bothComparisonSourcesRead:report.turns.slice(1,3).length===2&&report.turns.slice(1,3).every(t=>t.operations.filter(op=>op.name==='read_web_page').some(op=>op.input.url.includes('ai.google.dev'))&&t.operations.filter(op=>op.name==='read_web_page').some(op=>op.input.url.includes('openai.com'))),
        followupUsedRetainedInformation:report.turns[3]?.operations.length===0,
        finalAudioReturned:report.turns.every(t=>t.delivery==='complete'),
      };save();console.log('WORK LOOP AUDIT',JSON.stringify(report.audit));
      if(Object.values(report.audit).some(value=>value===false))process.exitCode=1;
    }
  }finally{voice.stop();save();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
