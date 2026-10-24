// Real acknowledgment provider + production tool controller; synthetic tools
// and timed PCM playback. No computer control or physical microphone/speakers.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(root);
const prepared=process.argv.includes('--prepared');
const file=path.join(root,prepared?'scratch/fast-prepared-ack.report.json':'scratch/fast-every-tool-ack-live.report.json');
const report={scope:'Real Gemini acknowledgment generation and fallback speech; production runTool; five synthetic tools and simulated PCM scheduling, no physical audio.',calls:[],events:[],transcripts:[]};
if(prepared)report.scope='Bundled provider-generated PCM, production runTool, five synthetic tools with simulated onset/drain; provider generation disabled, no microphone or speakers.';
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken,logLive:(kind,message,details)=>{report.events.push({kind,message,details,at:Date.now()});save();}}};
const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(root,'src/simpleFastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text,__filename);
let v,current,playing=0;const timers=new Set();
(async()=>{
 v=new m.exports.SimpleFastVoiceSession([],{onStatus(){},onTranscript:e=>{report.transcripts.push({...e,at:Date.now()});save();}});v.stopped=false;v.kick=()=>{};v.beginTask('Search a song, inspect the page, read https://example.com/ directly, search information, and list files');v.language='bn';v.ensureTask=async()=>{};
 const schedule=(f,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);f();},ms);timers.add(timer);};
 v.audioEngine={get hasPlayback(){return playing>0;},playAudio(encoded,onStart){const pcm=Buffer.from(encoded,'base64');let sound=false;for(let i=0;i+1<pcm.length;i+=2)if(Math.abs(pcm.readInt16LE(i))>33){sound=true;break;}playing++;current.audioChunks++;if(sound&&onStart)schedule(()=>{current.onsetAt??=Date.now();onStart();},10);schedule(()=>{playing--;if(!playing){for(const r of v.playbackWaiters)r();v.playbackWaiters.clear();}},40);return Date.now()+10;},clearPlayback(){playing=0;},close(){playing=0;}};
 v.dispatch=async(name)=>{current.dispatchedAt=Date.now();return {status:'ok',synthetic:true,...(name==='read_web_page'?{source:'direct_page',url:'https://example.com/',content:'Synthetic tool result for acknowledgment testing only.'}:{})};};
 const generate=v.progressVoice.generate.bind(v.progressVoice);let first=true;
 const receiveProgress=v.progressVoice.receive.bind(v.progressVoice);
 v.progressVoice.receive=message=>{if(current)(current.providerEvents??=[]).push({at:Date.now(),text:message.serverContent?.outputTranscription?.text,status:message.serverContent?.interactionStatus,complete:message.serverContent?.turnComplete,interrupted:message.serverContent?.interrupted,parts:message.serverContent?.modelTurn?.parts?.map(p=>({text:p.text,mimeType:p.inlineData?.mimeType,bytes:p.inlineData?.data?.length}))});receiveProgress(message);};
 const receive=v.narrator.receive.bind(v.narrator);
 v.narrator.receive=message=>{if(current&&message.serverContent?.outputTranscription?.text)(current.fallbackTranscription??=[]).push(message.serverContent.outputTranscription.text);receive(message);};
 v.progressVoice.generate=(...args)=>{if(prepared)throw Error('Provider offline: no generation permitted');if(first){first=false;throw Error('Injected startup timeout to exercise real speech fallback.');}return generate(...args);};
 const calls=[{name:'browser_act',args:{action:'youtube_search',args:{query:'Anupam Roy'}}},{name:'browser_observe',args:{scope:'page'}},{name:'read_web_page',args:{url:'https://example.com/'}},{name:'web_search',args:{query:'solar panel efficiency official documentation'}},{name:'list_directory',args:{path:'Desktop'}}];
 for(let i=0;i<calls.length;i++){
   current={index:i+1,...calls[i],startedAt:Date.now(),audioChunks:0,injectedFailure:i===0};report.calls.push(current);const start=report.transcripts.length;
   const receipt=await v.runTool({...calls[i],id:'live-ack-'+i});current.endedAt=Date.now();current.resultStatus=receipt.result.status;
   const delivered=report.transcripts.slice(start).filter(e=>e.phase==='progress'&&e.delivery==='complete');current.acknowledgments=delivered.map(e=>e.text);
   current.onsetDelayMs=current.onsetAt-current.startedAt;current.passed=delivered.length===1&&current.audioChunks>0&&current.onsetAt<=current.dispatchedAt;
   save();console.log(JSON.stringify({...current,providerEvents:undefined}));
 }
 report.passed=report.calls.every(c=>c.passed);report.onsetMs=report.calls.map(c=>c.onsetDelayMs);report.medianOnsetMs=[...report.onsetMs].sort((a,b)=>a-b)[2];report.slowestOnsetMs=Math.max(...report.onsetMs);if(prepared)assert.ok(report.slowestOnsetMs<100,'Local onset under 100 ms');assert.equal(report.passed,true,'Each tool must have spoken acknowledgment before dispatch');
})().catch(error=>{report.error=error.message;process.exitCode=1;console.error(error.message);}).finally(()=>{v?.stop();for(const timer of timers)clearTimeout(timer);save();console.log(file);});
