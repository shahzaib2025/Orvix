// Isolated acknowledgment latency probe: real progress provider and timed PCM
// playback, fixture main proposals/transcription, safe local/public read tools.
// It is NOT the physical microphone or packaged-app release benchmark.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
const label=process.argv[2]||'candidate',bundle=path.join(project,`scratch/fast-ack-${label}.cjs`);
fs.mkdirSync(path.dirname(bundle),{recursive:true});
if(!process.argv.includes('--reuse-bundle'))fs.writeFileSync(bundle,require('esbuild').buildSync({entryPoints:[path.join(project,'src/simpleFastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text);
const loaded=new Module(__filename,module);loaded.paths=module.paths;loaded._compile(fs.readFileSync(bundle,'utf8'),__filename);
const scriptedOnly=process.argv.includes('--scripted-only');
const output=path.join(project,`scratch/fast-ack-${label}${scriptedOnly?'-voice-delta':''}.report.json`);
const report={label,scope:'Real warm acknowledgment provider; simulated main proposals and transcript endpoints; timed PCM playback; real safe local observations. No physical microphone, speakers or packaged Windows app.',requests:[]};
let voice,current,playing=0,drainAt=0;
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{
 createLiveToken:require('../electron/live-auth.cjs').createLiveToken,
 logLive:(kind,message,details)=>{current?.events.push({kind,message,details,at:Date.now()});},
 listDirectory:async()=>{current.toolStart=Date.now();return {status:'ok',entries:fs.readdirSync(project).map(name=>({name}))};},
 readSearchPage:async args=>{current.toolStart=Date.now();return {status:'ok',source:'direct_page',url:args.url,content:'Fixture source contents. This probe measures acknowledgment timing, not research accuracy.'};},
}};
const prompts=[
 'Reply in English. Read https://ai.google.dev/gemini-api/docs/models.',
 'বাংলায় এক বাক্যে বলো। গুগলের বর্তমান মডেলের তথ্য দেখো।',
 'Reply in English. List the workspace files.',
 'বাংলায় দুই বাক্যে বলো। কর্মক্ষেত্রের ফাইলগুলোর তালিকা দেখো।',
 'Reply in English. Read https://developers.openai.com/api/docs/models.',
 'ওপেনএআই-এর বর্তমান মডেলের তথ্য বাংলায় সংক্ষেপে বলো।',
];
function reply(){queueMicrotask(()=>voice.receive({serverContent:{outputTranscription:{text:'Observation returned.'},turnComplete:true}}));}
function proposal(){setTimeout(()=>voice.receive({toolCall:{functionCalls:[{id:crypto.randomUUID(),name:current.operation.name,args:current.operation.args}]}}),200);}
function session(){return {sendClientContent:data=>{const text=data.turns?.[0]?.parts?.[0]?.text||'';if(text.includes('Actual results:'))reply();else proposal();},sendToolResponse:reply,close(){}};}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values,p)=>values.length?values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
async function warm(){
 let timer;const started=Date.now();
 try{await Promise.race([voice.progressVoice.prepare(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Warm connection unavailable within six seconds')),6000);})]);
  if(!voice.progressVoice.session)throw Error('Warm connection closed before the request');
  return Date.now()-started;
 }finally{clearTimeout(timer);}
}
(async()=>{
 voice=new loaded.exports.SimpleFastVoiceSession([],{onStatus(){},onProgress:event=>{if(current)current.visibleAt??=Date.now();},onTranscript:event=>{if(current&&event.phase==='progress'){current.progressText=event.text;if(event.delivery==='complete')current.ack=event.text;}}});
 voice.stopped=false;voice.session=session();
 voice.narrator={render:async()=>[],close(){}}; // Final answers are outside this latency probe.
 voice.audioEngine={get hasPlayback(){return playing>0;},playAudio:chunk=>{const duration=Buffer.from(chunk,'base64').length/48;current.firstAudio??=Date.now();playing++;drainAt=Math.max(drainAt,Date.now())+duration;setTimeout(()=>{if(!--playing){current.drainAt=Date.now();for(const resolve of voice.playbackWaiters)resolve();voice.playbackWaiters.clear();}},Math.max(0,drainAt-Date.now()));},close(){},hasMicrophone:false};
 // First token/connect is deliberately excluded from warm samples.
 await warm();
 for(const mode of scriptedOnly?['scripted_transcript']:['typed','scripted_transcript'])for(let i=0;i<30;i++){
  const warmupMs=await warm();
  const prompt=prompts[i%prompts.length],url=prompt.match(/https:\/\/\S+/)?.[0]?.replace(/\.$/,'')||(/গুগল/.test(prompt)?'https://ai.google.dev/gemini-api/docs/models':/ওপেনএআই/.test(prompt)?'https://developers.openai.com/api/docs/models':undefined);
  current={mode,index:i+1,prompt,operation:url?{name:'read_web_page',args:{url}}:{name:'list_directory',args:{directory:project}},events:[],warmupMs,connectionWarm:true,receivedAt:Date.now()};report.requests.push(current);
  voice.progressUnavailable=false;
  if(mode==='typed')voice.sendText(prompt);
  else {voice.receive({serverContent:{inputTranscription:{text:prompt,finished:false}}});await sleep(1200);current.receivedAt=Date.now();voice.receive({serverContent:{inputTranscription:{text:'',finished:true}}});proposal();}
  const deadline=Date.now()+75000;
  while(voice.taskActive||voice.pumping||voice.userQueue.length){if(Date.now()>deadline){current.error='75-second request deadline';break;}await sleep(20);}
  current.firstAudioMs=current.firstAudio?current.firstAudio-current.receivedAt:null;
  current.completeMs=current.events.find(e=>e.message.endsWith('Acknowledgment finished'))?.at-current.receivedAt;
  current.visibleMs=current.visibleAt-current.receivedAt;
  current.dispatchAfterDrainMs=current.toolStart&&current.drainAt?current.toolStart-current.drainAt:null;
  current.generationStart=current.events.find(e=>e.message.endsWith('Acknowledgment generation started'))?.at;
  current.unsuccessful=!!current.error||!current.toolStart||current.events.some(e=>e.message.endsWith('Acknowledgment generation unavailable; action not dispatched'));
  save();console.log(label,mode,i+1,JSON.stringify({first:current.firstAudioMs,complete:current.completeMs,failed:current.unsuccessful}));
  if(current.error)throw Error('Request timed out; stop the run to prevent cross-request contamination.');
 }
 report.summary=Object.fromEntries(['typed','scripted_transcript'].map(mode=>{const rows=report.requests.filter(r=>r.mode===mode);return [mode,{count:rows.length,unsuccessful:rows.filter(r=>r.unsuccessful).map(r=>r.index),firstAudioMedianMs:percentile(rows.map(r=>r.firstAudioMs).filter(v=>v!==null),.5),firstAudioP95Ms:percentile(rows.map(r=>r.firstAudioMs).filter(v=>v!==null),.95),completionP95Ms:percentile(rows.map(r=>r.completeMs).filter(Number.isFinite),.95),dispatchAfterDrainP95Ms:percentile(rows.map(r=>r.dispatchAfterDrainMs).filter(v=>v!==null),.95)}];}));
 console.log(JSON.stringify(report.summary));
})().catch(error=>{report.error=error.message;console.error(error.message);process.exitCode=1;}).finally(()=>{voice?.stop();save();});
