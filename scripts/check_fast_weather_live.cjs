// Production Fast controller, Gemini Live and Open-Meteo, with typed input
// and simulated PCM scheduling. This does not test a microphone or speakers.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
if(!process.argv.includes('--live'))throw Error('Pass --live to make real Gemini and weather requests.');
const root=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(root);
const {createLiveToken}=require('../electron/live-auth.cjs'),{getWeather}=require('../electron/weather.cjs');
const recorded=process.argv.includes('--recorded-weather');
// Measurements captured by the earlier real Open-Meteo check at 16:45.
// This mode exercises real Gemini delivery during a weather-service outage.
const samples={Dhaka:['32.4','light drizzle'],Chattogram:['29.4','partly cloudy'],Rajshahi:['30.9','clear sky'],Khulna:['28','mainly clear'],Barishal:['27.9','mainly clear'],Sylhet:['29.4','clear sky'],Rangpur:['29.6','clear sky'],Mymensingh:['31.1','clear sky']};
const m=new Module(__filename,module);m.paths=module.paths;
m._compile(require('esbuild').buildSync({entryPoints:[path.join(root,'src/simpleFastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text,__filename);
const file=path.join(root,recorded?'benchmarks/fast-weather-recorded-data-20261014.json':'benchmarks/fast-weather-completion-20261014.json');
const report={scope:recorded?'Production Fast and real Gemini Live with recorded Open-Meteo measurements from 2026-10-14 16:45 Asia/Dhaka; typed input and simulated PCM timing, no fresh weather requests or physical audio.':'Production Fast with real Gemini Live and Open-Meteo; typed request, simulated PCM timing; no physical microphone or speakers.',startedAt:new Date().toISOString(),events:[],transcripts:[],weather:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
const timers=new Set();let v,playing=0,audioUntil=0,done,rejectRun;
const schedule=(callback,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},Math.max(0,ms));timers.add(timer);};
global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{
 createLiveToken,getFastSettings:async()=>({desktopEnabled:false}),getPcSnapshot:async()=>null,recallCompanionMemories:async()=>({records:[]}),
 logLive(kind,message,details){report.events.push({at:Date.now(),kind,message,details});},
 async getWeather(args){const startedAt=Date.now(),sample=samples[args.location];const result=recorded?{status:'ok',location:args.location+', Bangladesh',temperature:sample[0]+' degrees C',conditions:sample[1],observedAt:'2026-10-14T16:45',timezone:'Asia/Dhaka',source:'Open-Meteo (recorded measurement)'}:await getWeather(args);report.weather.push({args,result,startedAt,finishedAt:Date.now()});return result;},
}};
(async()=>{
 const completion=new Promise((resolve,reject)=>{done=resolve;rejectRun=reject;});
 v=new m.exports.SimpleFastVoiceSession([{role:'assistant',text:'বাংলাদেশের আটটি বিভাগ হলো ঢাকা, চট্টগ্রাম, রাজশাহী, খুলনা, বরিশাল, সিলেট, রংপুর এবং ময়মনসিংহ।'}],{
  onStatus(status,detail){if(status==='error')rejectRun(Error(detail||'Fast connection failed'));if(status==='listening'&&report.submittedAt&&report.transcripts.some(entry=>entry.phase==='final'&&entry.delivery==='complete'))done();},
  onTranscript(entry){report.transcripts.push({...entry,at:Date.now()});},
 });
 v.audioEngine={
  get hasPlayback(){return playing>0;},
  playAudio(encoded,onStart){const duration=Buffer.from(encoded,'base64').length/48,start=Math.max(audioUntil,Date.now())+5;audioUntil=start+duration;playing++;
   if(onStart)schedule(onStart,start-Date.now());schedule(()=>{playing--;if(!playing){for(const resolve of v.playbackWaiters)resolve();v.playbackWaiters.clear();}},audioUntil-Date.now());return start;},
  clearPlayback(){playing=0;audioUntil=0;for(const timer of timers)clearTimeout(timer);timers.clear();},close(){this.clearPlayback();},
 };
 v.stopped=false;await v.connect();
 schedule(()=>rejectRun(Error('Weather live check exceeded 150 seconds.')),150000);
 report.request='ওগুলো দিয়াগুলো আমাকে দাও। কি যেন বলে ওয়েদার রিপোর্টটা আমাকে দাও।';report.submittedAt=Date.now();v.sendText(report.request);
 await completion;
 const acknowledgments=report.transcripts.filter(entry=>entry.phase==='progress'&&entry.delivery==='complete');
 const finals=report.transcripts.filter(entry=>entry.phase==='final'&&entry.delivery==='complete');
 const collection=report.events.find(entry=>entry.message.endsWith('Weather collection completed'));
 const reportReady=report.events.find(entry=>entry.message.endsWith('Report ready'));
 const playback=report.events.find(entry=>entry.message.endsWith('Report playback started'));
 const onsets=report.events.filter(entry=>entry.message.endsWith('Acknowledgment audio onset'));
 report.summary={weatherCalls:report.weather.length,successfulWeatherCalls:report.weather.filter(entry=>entry.result.status==='ok').length,
  acknowledgmentCount:acknowledgments.length,uniqueAcknowledgments:new Set(acknowledgments.map(entry=>entry.text)).size,finalCount:finals.length,
  firstAcknowledgmentMs:onsets[0]?.at-report.submittedAt,collectionMs:collection?.details.collectionMs,
  finalReadyMs:reportReady?.at-report.submittedAt,finalPlaybackMs:playback?.at-report.submittedAt,
  finalText:finals.at(-1)?.text,acknowledgments:acknowledgments.map(entry=>entry.text)};
 assert.equal(report.weather.length,8);assert.equal(acknowledgments.length,8);assert.equal(new Set(acknowledgments.map(entry=>entry.text)).size,8);assert.equal(finals.length,1);
 for(const city of ['ঢাকা','চট্টগ্রাম','রাজশাহী','খুলনা','বরিশাল','সিলেট','রংপুর','ময়মনসিংহ'])assert.ok(report.summary.finalText.normalize('NFKC').includes(city.normalize('NFKC')),city);
 assert.ok(!report.summary.finalText.includes('উত্তরটি সম্পূর্ণভাবে পাওয়া যায়নি'));
 report.passed=true;console.log(JSON.stringify(report.summary,null,2));
})().catch(error=>{report.passed=false;report.error=error.message;process.exitCode=1;console.error(error.message);})
 .finally(()=>{v?.stop();for(const timer of timers)clearTimeout(timer);report.finishedAt=new Date().toISOString();save();console.log(file);});
