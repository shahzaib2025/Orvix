const {test}=require('node:test');
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,external:['@google/genai'],logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');
const {routeFastRequest}=load('fastLatency.ts');
const {divisionWeatherLocations,weatherScope,weatherOnlyRequest,weatherLocation,weatherEvidence,weatherAnswerCovers,groundedWeatherReport}=load('fastWeather.ts');
const {preparedToolAcknowledgment}=load('fastPreparedAcknowledgment.ts');
const {FastNarrator}=load('fastNarrator.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<200;i++){if(check())return;await tick();}assert.fail('Expected operation did not start');}
const history=[{role:'assistant',text:'বাংলাদেশের আটটি বিভাগ: ঢাকা, চট্টগ্রাম, রাজশাহী, খুলনা, বরিশাল, সিলেট, রংপুর, ময়মনসিংহ।'}];
const incident='ওগুলো দিয়াগুলো আমাকে দাও। কি যেন বলে ওয়েদার রিপোর্টটা আমাকে দাও।';
const result=place=>({status:'ok',location:place.query,conditions:'clear sky',temperature:'28 degrees C',humidity:'60%',windSpeed:'10 km/h',observedAt:'2026-10-14T15:30',timezone:'Asia/Dhaka',source:'Open-Meteo'});
function fixture(t,text=incident){
 const events=[],transcripts=[],sent=[];let playing=0;
 global.window={speechSynthesis:{cancel(){},getVoices:()=>[]},orvixDesktop:{logLive(_kind,message,details){events.push({message,details});}}};
 const v=new SimpleFastVoiceSession(history,{onStatus(){},onTranscript:entry=>transcripts.push({...entry})});
 v.stopped=false;v.kick=()=>{};v.beginTask(text);v.taskAckPending=false;
 v.audioEngine={get hasPlayback(){return playing>0;},playAudio(pcm,onStart){playing++;setTimeout(()=>{events.push({message:'onset',pcm});onStart?.();},2);setTimeout(()=>{playing--;if(!playing){for(const resolve of v.playbackWaiters)resolve();v.playbackWaiters.clear();}},12);return Date.now()+2;},clearPlayback(){playing=0;},close(){playing=0;}};
 v.session={sendClientContent:request=>sent.push({type:'client',request,playing:playing>0}),sendToolResponse:request=>sent.push({type:'tool',request,playing:playing>0}),close(){}};
 v.progressVoice={readiness:'ready',close(){},generate:async()=>assert.fail('Prepared city speech must need no provider generation')};
 v.narrator={close(){},render:async()=>['RENDERED_REPORT']};
 v.dispatch=async(name,args)=>{events.push({message:'dispatch',name,args});return result(weatherLocation(args.location));};
 t.after(()=>v.stop());return {v,events,transcripts,sent};
}
test('the incident transcript routes to weather and resolves the eight supplied cities',()=>{
 for(const text of [incident,'ওয়েদার রিপোর্ট দাও','weather report dao','আবহাওয়ার রিপোর্ট দাও'])assert.equal(routeFastRequest(text),'lookup');
 assert.equal(weatherScope(incident,history).length,8);
 assert.deepEqual(weatherScope('weather in Dhaka and Tokyo',history),[]);
 assert.deepEqual(weatherScope('weather in dhaka and tokyo',history),[]);
 assert.deepEqual(weatherScope('ঢাকা ও কলকাতার ওয়েদার দাও',history),[]);
 assert.deepEqual(weatherScope('all divisions weather in India',history),[]);
 assert.deepEqual(weatherScope('all divisions weather in China',history),[]);
 assert.deepEqual(weatherScope('all divisions weather',[]),[]);
 assert.equal(weatherScope('all divisions weather in Bangladesh',[]).length,8);
 assert.equal(weatherScope('weather report of all divisions',history).length,8);
 assert.deepEqual(weatherScope('ওগুলোর weather দাও',[]),[]);
 for(const text of ['Dhaka and Chattogram weather then PC status','Dhaka and Chattogram weather and current time','ঢাকা ও চট্টগ্রামের আবহাওয়া দাও তারপর ফাইল খুলো'])assert.equal(weatherOnlyRequest(text),false);
});
test('every division has distinct prepared speech naming its city in both languages',()=>{
 for(const language of ['bn','en']){
  const phrases=[];
  for(const place of divisionWeatherLocations){
   const clip=preparedToolAcknowledgment({stage:'tool',goal:'Check weather',operation:{name:'get_weather',subject:place.query}},language);
   assert.ok(clip);assert.equal(weatherLocation(clip.text)?.key,place.key,clip.text);assert.equal(clip.generationMs,0);
   assert.ok(clip.audio.length);assert.ok(clip.text.split(/\s+/).length>=2);assert.ok(clip.text.split(/\s+/).length<=6);phrases.push(clip.text);
  }
  assert.equal(new Set(phrases).size,8);
 }
});
test('eight requested cities are collected once with eight spoken notices and one final model request',async t=>{
 const f=fixture(t);f.v.calls=[{id:'first-city',name:'get_weather',args:{location:'Dhaka'}}];
 const original=f.v.dispatch;
 f.v.dispatch=async(name,args)=>{f.v.receive({serverContent:{turnComplete:true}});return original(name,args);};
 await f.v.collectWeather();
 const calls=f.events.filter(event=>event.message==='dispatch');assert.equal(calls.length,8);
 assert.equal(new Set(calls.map(call=>weatherLocation(call.args.location).key)).size,8);
 assert.ok(calls.every(call=>/^[A-Za-z ,]+$/.test(call.args.location)));
 assert.equal(f.transcripts.filter(entry=>entry.phase==='progress'&&entry.delivery==='complete').length,8);
 for(const call of calls){const at=f.events.indexOf(call);assert.equal(f.events.slice(0,at).filter(event=>event.message==='onset').length,calls.indexOf(call)+1);}
 assert.equal(f.sent.filter(entry=>entry.type==='client').length,1);
 const prompt=f.sent.find(entry=>entry.type==='client').request.turns[0].parts[0].text;
 for(const place of divisionWeatherLocations)assert.ok(prompt.includes(place.query));
 assert.match(prompt,/28 degrees C|observedAt|Open-Meteo/);
 assert.equal(f.sent.filter(entry=>entry.type==='tool'&&entry.request.functionResponses[0].id==='first-city').length,1);
 assert.equal(f.sent.find(entry=>entry.type==='tool').request.functionResponses[0].scheduling,'SILENT');
 assert.equal(f.v.receipts.length,8);assert.equal(f.v.weatherCollectionReady,true);
});
test('empty completion before real audio creates no error report or duplicate final',async t=>{
 const f=fixture(t);await f.v.collectWeather();
 f.v.receive({serverContent:{turnComplete:true}});
 assert.equal(f.v.turnComplete,false);assert.equal(f.v.serverBusy,true);
 assert.equal(f.transcripts.filter(entry=>entry.phase==='final').length,0);
 const answer=groundedWeatherReport(f.v.weatherLocations,f.v.receipts,'bn');
 f.v.receive({serverContent:{outputTranscription:{text:answer},modelTurn:{parts:[{inlineData:{data:'COMPLETE_WEATHER',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
 await f.v.pump();await f.v.pump();
 assert.equal(f.transcripts.filter(entry=>entry.phase==='final'&&entry.delivery==='complete').length,1);
 assert.equal(f.v.taskActive,false);assert.equal(f.v.turnComplete,false);
 assert.equal(f.v.history.filter(entry=>entry.role==='assistant'&&/ডিগ্রি/.test(entry.text)).length,1);
});
test('late PCM and tool proposals during final delivery cannot overwrite the accepted report',async t=>{
 const f=fixture(t);await f.v.collectWeather();let finish;
 const answer=groundedWeatherReport(f.v.weatherLocations,f.v.receipts,'bn');
 f.v.turnText=answer;f.v.turnAudio=['VALID_REPORT'];f.v.turnComplete=true;f.v.serverBusy=false;f.v.awaitingResultContent=false;
 f.v.speak=()=>new Promise(resolve=>finish=resolve);
 const pending=f.v.pump();await until(()=>!!finish);
 f.v.receive({serverContent:{outputTranscription:{text:'ময়মনসিংহের আকাশ পরিষ্কার।'},modelTurn:{parts:[{inlineData:{data:'STALE_PCM',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
 f.v.receive({toolCall:{functionCalls:[{id:'late-city',name:'get_weather',args:{location:'Mymensingh'}}]}});
 finish(true);await pending;await f.v.pump();
 assert.equal(f.v.history.at(-1).text,answer);assert.equal(f.v.turnText,'');assert.equal(f.v.turnAudio.length,0);
 assert.equal(f.events.filter(event=>event.message==='dispatch').length,8);
});
test('a last-city-only answer is replaced using all retained measurements without new lookups',async t=>{
 const f=fixture(t);await f.v.collectWeather();f.v.turnText='ময়মনসিংহের আকাশ পরিষ্কার।';f.v.turnAudio=['LAST_CITY'];
 const reports=[];f.v.speak=async(text,_phase,_tool,audio)=>{reports.push({text,audio});return true;};
 await f.v.report();assert.equal(reports.length,1);assert.equal(reports[0].audio,undefined);
 for(const place of divisionWeatherLocations)assert.ok(reports[0].text.includes(place.bn));
 assert.match(reports[0].text,/ঢাকা: 28/);assert.match(reports[0].text,/তাপমাত্রা ডিগ্রি সেলসিয়াসে/);assert.equal(f.events.filter(event=>event.message==='dispatch').length,8);
});
test('one failed city is reported as unavailable while independent cities still finish',async t=>{
 const f=fixture(t),original=f.v.dispatch;
 f.v.dispatch=async(name,args)=>weatherLocation(args.location).key==='khulna'?{status:'unavailable',message:'Weather service busy'}:original(name,args);
 await f.v.collectWeather();const evidence=weatherEvidence(f.v.weatherLocations,f.v.receipts);
 assert.equal(evidence.filter(item=>item.state==='complete').length,7);
 const report=groundedWeatherReport(f.v.weatherLocations,f.v.receipts,'bn');assert.match(report,/খুলনা: আবহাওয়ার নির্ভরযোগ্য তথ্য পাওয়া যায়নি/);
 assert.equal(f.v.receipts.length,8);assert.equal(f.sent.filter(entry=>entry.type==='client').length,1);
});
test('slow independent weather reads overlap with a two-request limit and serialized notices',async t=>{
 const f=fixture(t),original=f.v.dispatch;let active=0,peak=0;
 f.v.dispatch=async(name,args)=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,40));active--;return original(name,args);};
 await f.v.collectWeather();assert.equal(peak,2);assert.equal(active,0);assert.equal(f.v.receipts.length,8);
 assert.equal(f.transcripts.filter(entry=>entry.phase==='progress'&&entry.delivery==='complete').length,8);
});
test('interruption during collection prevents all remaining dispatches and final generation',async t=>{
 const f=fixture(t);let finish;f.v.dispatch=async()=>new Promise(resolve=>finish=resolve);
 const pending=f.v.collectWeather();await until(()=>!!finish);f.v.interruptCurrent('typed');finish(result(divisionWeatherLocations[0]));await pending;
 assert.equal(f.v.receipts.length,0);assert.ok(f.v.interruptedWork.some(receipt=>receipt.name==='get_weather'));
 assert.equal(f.sent.filter(entry=>entry.type==='client').length,0);assert.equal(f.v.weatherCollecting,false);
});
test('read-only results reach the model before speech drains, without forced interruption or duplicate settlement',async t=>{
 const f=fixture(t,'Search solar energy');f.v.dispatch=async()=>({status:'ok',results:[]});
 const receipt=await f.v.runTool({id:'read-once',name:'web_search',args:{query:'solar energy'}});
 const sent=f.sent.filter(entry=>entry.type==='tool');assert.equal(sent.length,1);assert.equal(sent[0].playing,true);
 assert.equal(sent[0].request.functionResponses[0].scheduling,'WHEN_IDLE');
 f.v.pendingResponses.push(receipt);f.v.submitResults();assert.equal(f.sent.filter(entry=>entry.type==='tool').length,1);
});
test('tomorrow fallback uses the requested forecast instead of current temperature',()=>{
 const receipt={name:'get_weather',args:{location:'Dhaka'},result:{...result(divisionWeatherLocations[0]),forecast:[{date:'2026-10-15',conditions:'light rain',high:'31 degrees C',low:'24 degrees C'}]}};
 const report=groundedWeatherReport([divisionWeatherLocations[0]],[receipt],'bn','tomorrow weather in Dhaka');
 assert.match(report,/31 ডিগ্রি|24 ডিগ্রি|হালকা বৃষ্টি/);assert.doesNotMatch(report,/28 ডিগ্রি/);
});
test('a weather alias cannot trigger a duplicate first read, while different forecast options stay distinct',async t=>{
 const f=fixture(t,'weather in Chattogram');f.v.dispatch=async(_name,args)=>result(weatherLocation(args.location));
 await f.v.runTool({id:'alias-one',name:'get_weather',args:{location:'Chittagong'}});
 assert.equal(f.v.firstOperation,undefined);
 await f.v.runTool({id:'alias-two',name:'get_weather',args:{location:'Chattogram'}});assert.equal(f.v.receipts.length,1);
 await f.v.runTool({id:'future',name:'get_weather',args:{location:'Chattogram',forecastDays:2}});assert.equal(f.v.receipts.length,2);
});
test('an unavailable city acknowledgment ends collection without dispatching unannounced requests or hanging',async t=>{
 const f=fixture(t);f.v.preparedAcknowledgment=()=>undefined;f.v.progressVoice.generate=async()=>{throw Error('Unavailable');};f.v.narrator.render=async()=>{throw Error('Unavailable');};
 await f.v.collectWeather();assert.equal(f.v.progressUnavailable,true);assert.equal(f.v.serverBusy,false);assert.equal(f.v.turnComplete,true);
 assert.equal(f.events.filter(event=>event.message==='dispatch').length,0);f.v.speak=async()=>false;
 await f.v.pump();assert.equal(f.v.taskActive,false);
});
test('a complete weather reply can finish after audio settles even if the provider omits turnComplete',async t=>{
 const f=fixture(t);await f.v.collectWeather();const answer=groundedWeatherReport(f.v.weatherLocations,f.v.receipts,'bn');
 f.v.receive({serverContent:{outputTranscription:{text:answer},modelTurn:{parts:[{inlineData:{data:'WEATHER',mimeType:'audio/pcm;rate=24000'}}]}}});
 await new Promise(resolve=>setTimeout(resolve,1300));assert.equal(f.v.turnComplete,true);await f.v.pump();
 assert.equal(f.transcripts.filter(entry=>entry.phase==='final'&&entry.delivery==='complete').length,1);
});
test('weather speech renderer requires exact reviewed words before settling without a boundary',async t=>{
 const v=new FastNarrator();v.language='bn';v.session={sendClientContent(){},close(){}};t.after(()=>v.close());
 const pending=v.render('ঢাকা: 28, আকাশ পরিষ্কার।','bn',new AbortController().signal,{retry:false,timeoutMs:3000,settleWhenExact:true});await tick();
 v.receive({serverContent:{outputTranscription:{text:'ঢাকা: ২৮, আকাশ পরিষ্কার।'},modelTurn:{parts:[{inlineData:{data:'EXACT_AUDIO',mimeType:'audio/pcm;rate=24000'}}]}}});
 assert.deepEqual(await pending,['EXACT_AUDIO']);assert.equal(v.session,undefined);
});
test('a last-city fragment without a completion signal is repaired from the completed collection',async t=>{
 const f=fixture(t);await f.v.collectWeather();const reports=[];f.v.speak=async text=>{reports.push(text);return true;};
 f.v.receive({serverContent:{outputTranscription:{text:'ময়মনসিংহের আকাশ পরিষ্কার।'},modelTurn:{parts:[{inlineData:{data:'LAST_CITY',mimeType:'audio/pcm;rate=24000'}}]}}});
 await new Promise(resolve=>setTimeout(resolve,1300));await f.v.pump();assert.equal(reports.length,1);
 for(const place of divisionWeatherLocations)assert.ok(reports[0].includes(place.bn));assert.equal(f.v.taskActive,false);
});
test('weather coverage rejects invented temperatures, omitted conditions and a missing forecast',()=>{
 const receipts=divisionWeatherLocations.map(place=>({name:'get_weather',args:{location:place.query},result:result(place)}));
 const correct=groundedWeatherReport(divisionWeatherLocations,receipts,'bn');assert.equal(weatherAnswerCovers(correct,divisionWeatherLocations,receipts),true);
 assert.equal(weatherAnswerCovers(correct.replace('ঢাকা: 28','ঢাকা: 40'),divisionWeatherLocations,receipts),false);
 assert.equal(weatherAnswerCovers(correct.replace('ঢাকা: 28, আকাশ পরিষ্কার।','ঢাকা: 28।'),divisionWeatherLocations,receipts),false);
 assert.equal(weatherAnswerCovers(correct,divisionWeatherLocations,receipts,'tomorrow weather in all divisions'),false);
});
test('an old final-speech cleanup cannot clear a newer turn speaking state',async t=>{
 const f=fixture(t,'hi');let finish;f.v.narrator.render=()=>new Promise(resolve=>finish=resolve);
 const speech=f.v.speak('হ্যালো।','final');await until(()=>!!finish);f.v.interruptCurrent('typed');f.v.beginTask('কেমন আছো?');f.v.speaking=true;
 finish(['STALE']);await speech;assert.equal(f.v.speaking,true);
});
