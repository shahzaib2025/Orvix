// Synthesized user speech -> real Live input transcription -> generated ack.
// No physical microphone/speakers. Source reads are real, public, and sequential.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
const {readSearchResultPage}=require('../electron/search.cjs');
const report={scope:'Synthesized PCM user utterance, real Live input transcription and generated progress, real public page read. No physical microphone/speakers.',events:[],transcripts:[],operations:[]};
const file=path.join(project,'scratch/fast-audio-ack-live.report.json'),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
let voice,resolveReport,started;
global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{
  createLiveToken:require('../electron/live-auth.cjs').createLiveToken,getPcSnapshot:async()=>null,
  getFastSettings:async()=>({desktopEnabled:false,transcriptionHints:false}),onFastWorkEvent:()=>()=>{},
  logLive:(kind,message,details)=>{report.events.push({kind,message,details,at:Date.now()});save();if(message.endsWith('Report delivered'))resolveReport?.();},
  readSearchPage:async input=>{const item={input,startedAt:Date.now()};report.operations.push(item);try{return item.result=await readSearchResultPage(input);}finally{item.endedAt=Date.now();save();}},
  searchWeb:async()=>({status:'unavailable',message:'This audio startup probe is limited to its requested official page.'}),
}};
function load(file){const code=require('esbuild').buildSync({entryPoints:[path.join(project,'src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const loaded=new Module(__filename,module);loaded.paths=module.paths;loaded._compile(code,__filename);return loaded.exports;}
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts'),{FastNarrator}=load('fastNarrator.ts');
(async()=>{
  const inputVoice=new FastNarrator();
  try{
    const sentence='Research the latest Google Gemini models. Please use their official model catalog, read the page carefully, and then give a brief answer in English using only the information you find there.';
    const rendered=await inputVoice.render(sentence,'en',new AbortController().signal,{retry:false,timeoutMs:45_000});inputVoice.close();
    const pcm24=Buffer.concat(rendered.map(chunk=>Buffer.from(chunk,'base64'))),samples24=pcm24.length/2,samples16=Math.floor(samples24*2/3),pcm16=Buffer.alloc(samples16*2);
    for(let i=0;i<samples16;i++){const position=i*1.5,index=Math.floor(position),fraction=position-index;const a=pcm24.readInt16LE(index*2),b=pcm24.readInt16LE(Math.min(index+1,samples24-1)*2);pcm16.writeInt16LE(Math.round(a+(b-a)*fraction),i*2);}
    report.utterance={sentence,durationMs:samples16/16};
    voice=new SimpleFastVoiceSession([],{onStatus(){},onProgress(){},onTranscript:event=>{report.transcripts.push({...event,at:Date.now()});save();}});
    const receive=voice.receive.bind(voice);report.incoming=[];
    voice.receive=message=>{report.incoming.push({at:Date.now(),keys:Object.keys(message),input:message.serverContent?.inputTranscription,interactionStatus:message.serverContent?.interactionStatus});receive(message);save();};
    voice.audioEngine.ensureContext=async()=>{};voice.audioEngine.playAudio=()=>{};await voice.start(false);
    let timer;const done=new Promise(resolve=>{resolveReport=resolve;timer=setTimeout(()=>{report.error='150-second deadline';resolve();},150_000);});
    started=Date.now();report.inputStartedAt=started;
    for(let offset=0;offset<pcm16.length;offset+=6400){
      voice.session.sendRealtimeInput({audio:{data:pcm16.subarray(offset,offset+6400).toString('base64'),mimeType:'audio/pcm;rate=16000'}});
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    report.inputEndedAt=Date.now();voice.session.sendRealtimeInput({audioStreamEnd:true});save();await done;clearTimeout(timer);
    const prepared=report.events.find(e=>e.message.endsWith('Preparing generated acknowledgment while listening'));
    const adopted=report.events.find(e=>e.message.endsWith('Prepared acknowledgment matched completed request'));
    const playback=report.events.find(e=>e.message.endsWith('Acknowledgment playback started'));
    report.summary={preparedBeforeInputEnded:!!prepared&&prepared.at<report.inputEndedAt,adopted:!!adopted,firstPlaybackAfterInputEndMs:playback?playback.at-report.inputEndedAt:undefined,firstPlaybackStartupMs:playback?.details.startupMs,actualReads:report.operations.length,reportDelivered:!report.error&&report.events.some(e=>e.message.endsWith('Report delivered'))};
    save();console.log(JSON.stringify(report.summary));if(!report.summary.reportDelivered)process.exitCode=1;
  }finally{inputVoice.close();voice?.stop();save();}
})().catch(error=>{report.error=error.message;save();console.error(error.message);process.exitCode=1;});
