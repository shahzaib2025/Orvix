// Production FastVoiceSession, real Live and public pages. Audio is inspected
// and counted in Node; physical microphone and audible playback are not tested.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
const {createFastWork}=require('../electron/fast-work.cjs'),{searchWeb,readSearchResultPage}=require('../electron/search.cjs');
const listeners=new Set();const work=createFastWork({browser:{cancel(){}},desktop:{cancel(){}},groundingReviewer:require('../electron/fast-grounding.cjs').createGroundingReviewer(),emit:event=>listeners.forEach(fn=>fn(event))});
const report={scope:'Real Fast profile and public research services; text input, PCM counted. No physical microphone or audible speaker validation.',turns:[]};
const incident=process.argv.includes('--incident');
const file=path.join(__dirname,incident?'fast-research-incident-fix-live.report.json':'fast-acknowledgments-research-live.report.json');let turn,voice,finish;
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
global.window={setTimeout,clearTimeout,orvixDesktop:{
  createLiveToken:require('../electron/live-auth.cjs').createLiveToken,getPcSnapshot:async()=>null,getFastSettings:async()=>work.settings(),
  updateFastTask:async input=>work.update(input),getFastContext:async id=>structuredClone(work.taskContext(id)),getFastTask:async id=>work.task(id),
  registerFastPlan:async(id,input)=>work.registerPlan(id,input),reviewFastCompletion:async(id,input)=>{turn.reviews.push(structuredClone(input));save();return work.reviewCompletionGrounded(id,input);},
  beginFastEvidence:async(id,tool,input)=>work.beginEvidence(id,tool,input),recordFastEvidence:async(id,token,tool,input,result)=>work.recordEvidence(id,token,tool,input,result),
  setFastDelivery:async(id,state)=>work.delivery(id,state),cancelFastTask:id=>work.cancel(id),onFastWorkEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  searchWeb:async input=>{turn.operations.push({name:'web_search',...input,at:Date.now()});save();return searchWeb(input);},
  readSearchPage:async input=>{const entry={name:'read_web_page',...input,at:Date.now()};turn.operations.push(entry);save();const result=await readSearchResultPage(input);entry.status=result.status;entry.content=result.content;save();return result;},
  logLive:(kind,message,details)=>{if(!turn)return;turn.events.push({kind,message,details,at:Date.now()});if(message==='[FastVoice] Tool acknowledgment delivered'||kind==='warn'||kind==='error')console.log(message,JSON.stringify(details));save();},
}};
const built=require('esbuild').buildSync({entryPoints:[path.join(project,'src/fastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;
const loaded=new Module(__filename,module);loaded.paths=module.paths;loaded._compile(built,__filename);const {FastVoiceSession}=loaded.exports;
(async()=>{
  voice=new FastVoiceSession([],{onStatus:(status,detail)=>{if(turn&&status==='error')finish?.({error:detail});},onProgress(){},onTranscript:value=>{if(turn&&value.phase==='final'){turn.segments.push(value);if(value.delivery==='complete')finish?.({answer:value.text});}}});
  voice.audioEngine.ensureContext=async()=>{};voice.audioEngine.playAudio=()=>{if(turn)turn.audioChunks++;};voice.audioEngine.clearPlayback=()=>{};
  try{
    await voice.start(false);const connected=Date.now()+30_000;while(!voice.session&&Date.now()<connected)await new Promise(resolve=>setTimeout(resolve,100));if(!voice.session)throw new Error('Fast did not connect');
    for(const prompt of (incident ? [
      'google er letest model gular tottho deo to',
      'বাংলায় বলো, এই পড়া তথ্য অনুযায়ী মডেল বেছে নেওয়ার সময় কী যাচাই করা দরকার? কেবল আগের গুগলের সূত্র ব্যবহার করো। নতুন তথ্য দরকার হলে একই সূত্র পড়ো।',
    ] : [
      'Reply in English. Compare the current Google Gemini and OpenAI model catalogs using only these two original pages: https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models . Do not search or read other pages. First plan separate Google research, OpenAI research, and comparison/report steps. Read both pages, compare one supported capability or intended use from each, identify any unknown latest-model ranking, cite the two URLs, and review_task before the final answer. Do not repeat failed reads or reviews without new evidence.',
      'বাংলায় উত্তর দাও। শুধু https://ai.google.dev/gemini-api/docs/models পৃষ্ঠাটি read_web_page দিয়ে পড়ো। অনলাইনে সার্চ করবে না। এই পৃষ্ঠার একটি যাচাই করা তথ্য বলো, সূত্র দাও এবং review_task দিয়ে উত্তর যাচাই করো। না পড়তে পারলে সঠিক বাধা বলো।',
    ]).filter((_,index)=>(!process.argv.includes('--bangla')||index===1)&&(!process.argv.includes('--single')||index===0))){
      turn={prompt,events:[],operations:[],reviews:[],segments:[],audioChunks:0,startedAt:Date.now()};report.turns.push(turn);let timer;
      const completed=new Promise(resolve=>{finish=resolve;timer=setTimeout(()=>resolve({error:'Live task deadline reached'}),210_000);});
      voice.sendText(prompt);Object.assign(turn,await completed);clearTimeout(timer);finish=undefined;
      turn.taskContext=structuredClone(voice.taskContext||{});turn.acknowledgments=turn.events.filter(e=>e.message==='[FastVoice] Tool acknowledgment delivered').length;
      turn.elapsedMs=Date.now()-turn.startedAt;
      turn.visibleAcknowledgments=turn.events.filter(e=>e.message==='[FastVoice] Tool acknowledgment audio unavailable; continuing with visible acknowledgment').length;
      turn.operationsWithoutPriorAcknowledgment=turn.operations.filter(op=>!turn.events.some(e=>['[FastVoice] Tool acknowledgment delivered','[FastVoice] Tool acknowledgment audio unavailable; continuing with visible acknowledgment'].includes(e.message)&&e.details.name===op.name&&e.at<=op.at)).length;
      turn.status=turn.error?'failed':turn.taskContext.status;save();console.log('TASK',JSON.stringify({status:turn.status,acknowledgments:turn.acknowledgments,operations:turn.operations.length,error:turn.error}));
      if(turn.error)break;
    }
  }finally{voice.stop(true);save();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
