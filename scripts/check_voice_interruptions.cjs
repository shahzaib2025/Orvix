const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path'), Module=require('node:module');
const esbuild=require('esbuild');
function load(file) {const out=esbuild.buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(out.outputFiles[0].text,__filename);return mod.exports;}
const {SpeechActivityDetector}=load('speechActivity.ts');
const {FastVoiceSession}=load('fastVoice.ts');
const {AudioEngine}=load('audioEngine.ts');
const {fastRequestIntent}=load('fastRequest.ts');
const {fastWeatherTaskFor,BANGLADESH_DIVISION_CITIES,recordWeatherResult,weatherAnswerCoversCities}=load('fastTask.ts');
const quiet=()=>new Int16Array(800);
const speech=(gain=0.04)=>Int16Array.from({length:800},(_,i)=>Math.round(32768*gain*(Math.sin(i*2*Math.PI*160/16000)+0.6*Math.sin(i*2*Math.PI*320/16000)+0.35*Math.sin(i*2*Math.PI*960/16000))));
function fixture() {
  const played=[], sent=[], recovered=[], cancelled=[], statuses=[], logs=[], entries=[];let clears=0, ttsStops=0;
  const timers=new Map();let timerId=0;
  global.window={setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),orvixDesktop:{logLive:(...args)=>logs.push(args),cancelFastTask:id=>cancelled.push(id),cancelBrowserRequests:ids=>cancelled.push(...ids)},speechSynthesis:{cancel:()=>ttsStops++,getVoices:()=>[]}};
  const voice=new FastVoiceSession([],{onStatus:status=>statuses.push(status),onTranscript:entry=>entries.push({...entry})});
  voice.stopped=false;voice.workTaskId='current';voice.taskRequest='Search bees';
  voice.responseAudioSeen=true; // Existing fixtures represent an already audible reply.
  voice.audioEngine={hasPlayback:true,clearPlayback(){clears++;this.hasPlayback=false;},playAudio:value=>played.push(value)};
  voice.session={sendRealtimeInput:v=>sent.push(v),sendToolResponse:v=>sent.push(v),sendClientContent:v=>recovered.push(v)};
  const output=data=>({serverContent:{modelTurn:{parts:[{inlineData:{data,mimeType:'audio/pcm;rate=24000'}}]}}});
  const settleTranscriptGrace=()=>{const id=voice.transcriptionGraceTimer;const fn=timers.get(id);timers.delete(id);fn?.();};
  return {voice,played,sent,recovered,cancelled,statuses,logs,entries,output,settleTranscriptGrace,get clears(){return clears;},get ttsStops(){return ttsStops;}};
}
test('sustained microphone activity starts within 100ms; brief noise and hum do not interrupt',()=>{
  const detector=new SpeechActivityDetector();for(let i=0;i<20;i++)assert.equal(detector.push(quiet()),undefined);
  assert.equal(detector.push(speech()),undefined);assert.equal(detector.push(speech()),'start');
  const click=new SpeechActivityDetector();assert.equal(click.push(speech(0.15)),undefined);for(let i=0;i<12;i++)assert.equal(click.push(quiet()),undefined);
  const hum=new SpeechActivityDetector();for(let n=0;n<20;n++)assert.equal(hum.push(Int16Array.from({length:800},(_,i)=>Math.round(3000*Math.sin(i*2*Math.PI*60/16000)))),undefined);
});

test('English and Bangla report questions preserve evidence while new topics replace work',()=>{
  for(const text of ['give me the report','why did you stop working','have you finished the research','রিপোর্ট দাও','কাজটা শেষ করলে না কেন']) {
    assert.equal(fastRequestIntent(text),'continue');
    const f=fixture();const evidence={name:'web_search',response:{status:'ok'}};
    f.voice.taskEvidence=[evidence];f.voice.retainedResults=[{epoch:f.voice.taskEpoch,...evidence}];
    const epoch=f.voice.taskEpoch;
    assert.equal(f.voice.applyUserRequest(text),'continue');
    assert.equal(f.voice.workTaskId,'current');assert.equal(f.voice.taskEpoch,epoch);
    assert.equal(f.voice.taskEvidence[0],evidence);assert.equal(f.voice.retainedResults.length,1);
  }
  for(const text of ['give me a report about solar panels','stop','Research another company'])
    assert.equal(fastRequestIntent(text),text==='stop'?'cancel':'replace');
});

test('a search retained before a missing server interruption boundary has bounded connection recovery',async()=>{
  const f=fixture();let finish,searches=0,closed=0,reconnects=0;
  f.voice.audioEngine.hasPlayback=false;f.voice.serverResponseActive=true;
  window.orvixDesktop.searchWeb=()=>++searches===1?new Promise(resolve=>finish=resolve):Promise.resolve({status:'ok',results:[]});
  window.orvixDesktop.readSearchPage=async()=>({status:'unavailable'});
  f.voice.session.close=()=>closed++;
  f.voice.scheduleReconnect=()=>{reconnects++;f.voice.session=null;};
  const pending=f.voice.handleToolCalls([{id:'search',name:'web_search',args:{query:'marketplaces'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.handleLocalActivity('start');
  finish({status:'ok',results:[]});await pending;f.voice.handleLocalActivity('end');f.settleTranscriptGrace();
  assert.equal(f.sent.length,0);assert.equal(f.voice.retainedResults.length,1);assert.notEqual(f.voice.responseWaitTimer,undefined);
  const oldGeneration=f.voice.generation;
  f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,oldGeneration);
  assert.equal(closed,1);assert.equal(reconnects,1);assert.equal(f.voice.generation,oldGeneration+1);
  f.voice.session={sendClientContent:x=>f.recovered.push(x),sendToolResponse:x=>f.sent.push(x)};
  f.voice.interruptionAcknowledged=true;f.voice.flushRetainedResults();
  assert.equal(f.recovered.length,1);assert.equal(f.sent.length,0,'Old function ID must not cross connections');
  assert.equal(f.voice.retainedResults.length,0);assert.equal(f.voice.responseWaitAttempt,1);
  assert.match(JSON.stringify(f.recovered[0]),/no_relevant_sources/);
  f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);
  assert.equal(f.statuses.at(-1),'error');assert.equal(reconnects,1,'Recovery stays bounded');
});

test('an abandoned turn boundary recovers an awaiting report without replaying tools',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.awaitingAnswer=true;f.voice.serverResponseActive=true;
  f.voice.taskEvidence=[{name:'web_search',response:{status:'no_relevant_sources'}}];
  f.voice.armResponseWait();f.voice.handleLocalActivity('start');f.voice.handleLocalActivity('end');f.settleTranscriptGrace();
  f.voice.handleMessage({serverContent:{turnComplete:true}});
  assert.equal(f.recovered.length,1);assert.notEqual(f.voice.responseWaitTimer,undefined);
  assert.match(JSON.stringify(f.recovered[0]),/no_relevant_sources/);assert.equal(f.sent.length,0);
});

test('blocked research speaks the reviewed findings and missing outcome rather than a generic failure',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.sessionLanguage='en';
  const context={revision:1,status:'blocked',steps:[],requirements:[{id:'searches',text:'Search attempts reported',status:'verified'},{id:'ranking',text:'A supported marketplace ranking',status:'blocked'}]};
  window.orvixDesktop.getFastContext=async()=>context;
  window.orvixDesktop.reviewFastCompletion=async()=>({status:'blocked',completed:false,context,review:{issues:['No readable local sources']}});
  const answer='Two searches ran. The ranking remains unknown because no relevant readable source was verified.';
  await f.voice.handleToolCalls([{id:'review',name:'review_task',args:{answer,coverage:[{requirementId:'searches',answerQuote:'Two searches ran.',evidenceIds:[]},{requirementId:'ranking',answerQuote:'The ranking remains unknown because no relevant readable source was verified.',evidenceIds:[],unknown:true}]}}]);
  const summary=f.voice.browserOutcomes.get('task_review');
  assert.match(summary,/Two searches ran/);assert.match(summary,/A supported marketplace ranking/);assert.match(summary,/No readable local sources/);
  f.voice.handleMessage({serverContent:{outputTranscription:{text:answer},turnComplete:true}});
  assert.match(JSON.stringify(f.recovered[0]),/Two searches ran/);assert.match(JSON.stringify(f.recovered[0]),/No readable local sources/);
  assert.equal(f.entries.some(e=>e.delivery==='complete'),false);
  f.voice.handleMessage({serverContent:{outputTranscription:{text:summary},...f.output('REPORT_AUDIO').serverContent,turnComplete:true}});
  assert.deepEqual(f.played,['REPORT_AUDIO']);assert.match(f.entries.at(-1).text,/Not verified in this attempt: A supported marketplace ranking/);
});

test('a rejected answer cannot put a false completion claim or unsupported fact in the spoken report',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.sessionLanguage='en';
  const context={revision:1,status:'blocked',steps:[],requirements:[{id:'policy',text:'Verified return policy',status:'blocked'}]};
  window.orvixDesktop.getFastContext=async()=>context;
  window.orvixDesktop.reviewFastCompletion=async()=>({status:'blocked',completed:false,context,review:{issues:['Return policy source missing']}});
  await f.voice.handleToolCalls([{id:'review',name:'review_task',args:{answer:'I completed all tasks. The company guarantees 90-day returns.',coverage:[]}}]);
  const summary=f.voice.browserOutcomes.get('task_review');
  assert.doesNotMatch(summary,/I completed|90-day/);assert.match(summary,/Return policy source missing/);
});
test('model-owned unknown obstacles and repair commands never enter the spoken partial report',()=>{
  const f=fixture();f.voice.sessionLanguage='en';
  f.voice.taskContext={status:'blocked',steps:[],requirements:[{id:'identity',text:'Verify business identity',status:'blocked',obstacle:'The business does not exist.'}],evidence:[]};
  const report=f.voice.incompleteTaskReport({status:'blocked',review:{issues:['Two completion repair attempts exhausted without new evidence or verified progress. Report the remaining obstacle; do not repeat this review.']}});
  assert.doesNotMatch(report,/does not exist|do not repeat|Report the remaining/);assert.match(report,/recovery limit/);
});
test('complete eight-city weather answer is delivered without regenerating the summary',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;
  f.voice.weatherTask=fastWeatherTaskFor('Weather for all eight Bangladesh divisions');
  for(const city of BANGLADESH_DIVISION_CITIES) recordWeatherResult(f.voice.weatherTask,city,{status:'ok',location:`${city}, Bangladesh`,temperature:'28°C'});
  f.voice.handleMessage({serverContent:{outputTranscription:{text:BANGLADESH_DIVISION_CITIES.map(city=>`${city}: 28 degrees Celsius.`).join(' ')},turnComplete:true}});
  assert.equal(f.recovered.length,0);assert.equal(f.entries.at(-1).delivery,'complete');assert.equal(f.voice.weatherTask,null);
  assert.equal(weatherAnswerCoversCities('Dhaka is 28 degrees Celsius.'),false);
  assert.equal(weatherAnswerCoversCities('ঢাকা চট্টগ্রাম রাজশাহী খুলনা বরিশাল সিলেট রংপুর ময়মনসিংহ তাপমাত্রা ২৮ ডিগ্রি।'),false);
  assert.equal(weatherAnswerCoversCities(['ঢাকা','চট্টগ্রাম','রাজশাহী','খুলনা','বরিশাল','সিলেট','রংপুর','ময়মনসিংহ'].map(city=>`${city}: ২৮ ডিগ্রি।`).join(' ')),true);
  assert.equal(weatherAnswerCoversCities('Dhaka is 28 degrees. Chattogram is 27 degrees. Rajshahi and Khulna both report clear skies, with temperatures of 26.7 and 27.3 degrees, respectively. Barishal is 27 degrees. Sylhet is 24 degrees. Rangpur is 26 degrees. Mymensingh is 26 degrees.'),true);
});
test('text-only Live reply requests audio once without rerunning tools',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.responseAudioSeen=false;
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'The observed weather is 28 degrees Celsius.'},turnComplete:true}});
  assert.equal(f.recovered.length,1);assert.ok(!f.entries.some(entry=>entry.delivery==='complete'));
  let effects=0;window.orvixDesktop.getWeather=async()=>{effects++;return {status:'ok'};};
  await f.voice.handleToolCalls([{id:'repeat',name:'get_weather',args:{location:'Dhaka'}}]);assert.equal(effects,0);
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'The observed weather is 28 degrees Celsius.'},...f.output('SPOKEN_REPLY').serverContent,turnComplete:true}});
  assert.equal(f.recovered.length,1);assert.equal(f.entries.at(-1).delivery,'complete');assert.deepEqual(f.played,['SPOKEN_REPLY']);
});
test('repeated missing audio cannot be marked as complete delivery',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.responseAudioSeen=false;
  for(let attempt=0;attempt<2;attempt++) f.voice.handleMessage({serverContent:{outputTranscription:{text:'The reply text is available.'},turnComplete:true}});
  assert.equal(f.recovered.length,1);assert.equal(f.entries.at(-1).delivery,'interrupted');assert.equal(f.statuses.at(-1),'error');
});
test('ordinary search rejects unrelated top results without opening them',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.taskRequest='find florianbd com';let reads=0;
  window.orvixDesktop.searchWeb=async()=>({status:'ok',results:[{title:'Hurricane Ian',url:'https://en.wikipedia.org/wiki/Hurricane_Ian'},{title:'A Floridian Sunset',url:'https://nasa.gov/image-article/a-floridian-sunset/'}]});
  window.orvixDesktop.readSearchPage=async({url})=>{reads++;assert.equal(url,'https://florianbd.com/');return {status:'unavailable',url,message:'Supplied domain unreachable in this fixture'};};
  await f.voice.handleToolCalls([{id:'ordinary',name:'web_search',args:{query:'florianbd com'}}]);
  assert.equal(reads,1);assert.equal(f.sent[0].functionResponses[0].response.status,'no_relevant_sources');
  assert.equal(f.sent[0].functionResponses[0].response.verifiedCount,0);
});
test('delayed final reply gets one evidence-only recovery request and then explicit incomplete status',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.awaitingAnswer=true;f.voice.sessionLanguage='en';
  f.voice.taskEvidence=[{name:'browser_act',response:{status:'ok',completionStatement:'Page opened.'}}];
  f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);
  assert.equal(f.recovered.length,1);assert.match(JSON.stringify(f.recovered[0]),/replay actions/);
  assert.equal(f.sent.length,0);assert.equal(f.cancelled.length,0);
  f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);
  assert.equal(f.recovered.length,1);assert.equal(f.statuses.at(-1),'error');
  assert.ok(f.logs.some(log=>log[1]==='[FastVoice] Final reply incomplete'));
  assert.ok(!f.entries.some(entry=>entry.delivery==='complete'));
});
test('response wait cannot interrupt active work, playback, or a newer task',()=>{
  const f=fixture();f.voice.awaitingAnswer=true;
  f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);
  assert.equal(f.recovered.length,0,'Playing audio is not a stalled response');
  f.voice.audioEngine.hasPlayback=false;f.voice.activeToolCalls.add('running');
  f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);assert.equal(f.recovered.length,0);
  f.voice.activeToolCalls.clear();f.voice.handleResponseWaitTimeout(f.voice.taskEpoch-1,f.voice.generation);
  assert.equal(f.recovered.length,0);
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'The task findings are complete.'},turnComplete:true}});
  assert.equal(f.voice.responseWaitTimer,undefined);
});
test('final-reply recovery cannot replay a completed action or restart research',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.responseWaitAttempt=1;let effects=0;
  window.orvixDesktop.browserAct=async()=>{effects++;return {status:'ok'};};
  window.orvixDesktop.searchWeb=async()=>{effects++;return {results:[]};};
  await f.voice.handleToolCalls([{id:'replay',name:'browser_act',args:{action:'click'}},{id:'new-search',name:'web_search',args:{query:'extra search'}}]);
  assert.equal(effects,0);assert.ok(f.sent[0].functionResponses.every(result=>result.response.status==='blocked'));
  assert.equal(f.voice.responseWaitAttempt,1,'A tool response must not reset the bounded recovery budget');
});
test('short pauses preserve the utterance and 600ms silence ends local activity',()=>{
  const d=new SpeechActivityDetector();d.push(speech());assert.equal(d.push(speech()),'start');
  for(let i=0;i<5;i++)assert.equal(d.push(quiet()),undefined);assert.equal(d.push(speech()),undefined);
  for(let i=0;i<11;i++)assert.equal(d.push(quiet()),undefined);assert.equal(d.push(quiet()),'end');
  d.push(speech());assert.equal(d.push(speech()),'start');
});
test('local speech stops audio and TTS immediately while preserving pending work and research',()=>{
  const f=fixture();f.voice.serverResponseActive=true;f.voice.browserSpeech={};f.voice.activeToolCalls.add('queued');
  const task={objective:'Research bees'};f.voice.researchTask=task;
  const started=performance.now();f.voice.handleLocalActivity('start');
  assert.ok(performance.now()-started<500);assert.equal(f.clears,1);assert.ok(f.ttsStops>=1);assert.equal(f.cancelled.length,0);assert.equal(f.voice.cancelledToolCalls.has('queued'),false);assert.equal(f.voice.researchTask,task);assert.ok(f.voice.activeToolCalls.has('queued'));assert.equal(f.statuses.at(-1),'listening');
});
test('text research reaches Live before retrieval and requests focused real tool calls',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;let searches=0;
  window.orvixDesktop.searchWeb=async()=>{searches++;return {results:[]};};
  f.voice.sendText('Research Florian BD and compare its competitors and policies');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(searches,0,'Model must choose the subject query before retrieval');
  assert.match(JSON.stringify(f.recovered[0]),/web_search.*short, focused queries/);
  assert.match(JSON.stringify(f.recovered[0]),/Florian BD/);
});
  test('Bangla answer instruction overrides a previous English research turn',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.sessionLanguage='en';
  f.voice.sendText('বাংলায় উত্তর দাও। Pathao আর Uber নিয়ে গবেষণা করো।');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.voice.sessionLanguage,'bn');
  assert.match(JSON.stringify(f.recovered[0]),/Answer only in Bangla/);
  });
  test('page-only research rejects an unwanted search without calling the backend',async()=>{
    const f=fixture();f.voice.audioEngine.hasPlayback=false;let searches=0;
    window.orvixDesktop.searchWeb=async()=>{searches++;return {results:[]};};
    f.voice.sendText('Research the safety policy on this page. Do not search for other pages.');
    await new Promise(resolve=>setImmediate(resolve));
    await f.voice.handleToolCalls([{id:'unwanted-search',name:'web_search',args:{query:'Uber safety'}}]);
    assert.equal(searches,0);assert.equal(f.sent.at(-1).functionResponses[0].response.status,'blocked');
  });
test('direct policy read cannot bypass inherited country scope',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;let reads=0;
  window.orvixDesktop.readSearchPage=async()=>{reads++;return {status:'ok',content:'Foreign deadline'};};
  f.voice.taskRequest='Research Daraz Bangladesh returns';
  f.voice.sendText('Audit our earlier return policy comparison');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.voice.researchTask.market,'Bangladesh');
  await f.voice.handleToolCalls([{id:'foreign-policy',name:'read_web_page',args:{url:'https://www.daraz.pk/return-policy'}}]);
  assert.equal(reads,0);assert.equal(f.sent.at(-1).functionResponses[0].response.status,'out_of_scope');
});
test('completed research retains earlier continuation findings and excludes uncited candidates',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;
  f.voice.researchTask={kind:'open-research',objective:'Research Daraz returns',requiredTopics:[],queries:['Daraz returns'],failedPages:[],sources:[{status:'verified',title:'Unrelated candidate',url:'https://example.com/unrelated',publisher:'Example'}],continuationCount:2,answerChars:160,answerText:'Earlier findings: Daraz requires evidence of purchase and return eligibility must be checked on the original policy page.'};
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'Final conclusion: check your exact product category before submitting a return.'},turnComplete:true}});
  const answer=f.entries.findLast(entry=>entry.phase==='final'&&entry.delivery==='complete');
  assert.match(answer.text,/Earlier findings/);assert.match(answer.text,/Final conclusion/);
  assert.doesNotMatch(answer.text,/example.com\/unrelated/);
  assert.match(f.voice.history.at(-1).text,/Earlier findings/);
});
test('disconnect resumes an unfinished reply from retained evidence after reconnect',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.serverResponseActive=true;f.voice.awaitingAnswer=true;
  f.voice.resumeHandle='unfinished-server-interaction';
  const task={objective:'Research Daraz returns'};f.voice.researchTask=task;
  f.voice.taskEvidence=[{name:'web_search',response:{status:'ok',researchEvidence:'Official Bangladesh return page was fetched'}}];
  f.voice.preserveDisconnectedTurn();
  assert.equal(f.voice.serverResponseActive,false);assert.equal(f.voice.interruptedReplyPending,true);
  assert.equal(f.voice.resumeHandle,undefined,'An unfinished server interaction must not be restored');
  f.voice.session={sendClientContent:input=>f.recovered.push(input),sendToolResponse:input=>f.sent.push(input)};
  f.voice.flushRetainedResults();
  assert.equal(f.recovered.length,1);assert.match(JSON.stringify(f.recovered[0]),/Official Bangladesh return page/);
  assert.match(JSON.stringify(f.recovered[0]),/Do not repeat verified effects/);
  assert.equal(f.voice.researchTask,task);assert.equal(f.cancelled.length,0);assert.equal(f.voice.awaitingAnswer,true);
});
test('late audio is discarded through the old turn boundary; the next complete reply plays',()=>{
  const f=fixture();f.voice.serverResponseActive=true;f.voice.handleLocalActivity('start');f.voice.handleMessage(f.output('OLD'));
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();f.voice.handleMessage(f.output('STILL_OLD'));assert.deepEqual(f.played,[]);
  f.voice.handleMessage({...f.output('OLD_FINAL'),serverContent:{...f.output('OLD_FINAL').serverContent,turnComplete:true}});assert.deepEqual(f.played,[]);
  f.voice.handleMessage({...f.output('NEW'),serverContent:{...f.output('NEW').serverContent,turnComplete:true}});assert.deepEqual(f.played,['NEW']);
});
test('a correction transcript survives the server interruption acknowledgement',()=>{
  const f=fixture();f.voice.serverResponseActive=true;f.voice.handleLocalActivity('start');
  f.voice.handleMessage({serverContent:{inputTranscription:{text:'না, অন্য গানটি চালাও'}}});
  f.voice.handleMessage({serverContent:{interrupted:true}});assert.equal(f.voice.transcript.user.text,'না, অন্য গানটি চালাও');
  f.voice.handleMessage(f.output('OLD'));assert.deepEqual(f.played,[]);
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();f.voice.handleMessage(f.output('CORRECTION_REPLY'));assert.deepEqual(f.played,['CORRECTION_REPLY']);
});
test('local Windows speech after a completed server turn can be cut off without a server interruption event',()=>{
  const f=fixture();f.voice.serverResponseActive=false;f.voice.browserSpeech={};f.voice.handleLocalActivity('start');
  assert.ok(f.ttsStops);f.voice.handleMessage(f.output('OVERLAP'));assert.deepEqual(f.played,[]);
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();f.voice.handleMessage(f.output('NEW'));assert.deepEqual(f.played,['NEW']);
});
test('model output arriving while the user is already talking is silenced',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.handleLocalActivity('start');f.voice.handleMessage(f.output('EARLY'));
  assert.equal(f.clears,1);assert.deepEqual(f.played,[]);assert.equal(f.voice.localSpeaking,true);
});
test('microphone PCM continues to stream during interruption',async()=>{
  const f=fixture();let pcm,activity;f.voice.audioEngine.enableMicrophone=async(a,b)=>{pcm=a;activity=b;};await f.voice.enableMicrophone();
  activity('start');pcm('MIC_DURING_CUTOFF');assert.equal(f.sent[0].audio.data,'MIC_DURING_CUTOFF');activity('end');pcm('MIC_AFTER_CUTOFF');assert.equal(f.sent[1].audio.data,'MIC_AFTER_CUTOFF');
  assert.doesNotMatch(JSON.stringify(f.logs),/MIC_DURING_CUTOFF|MIC_AFTER_CUTOFF/);
});
test('AudioEngine stops every scheduled playback source, including future audio',()=>{
  const audio=new AudioEngine();let stopped=0;audio.playing.add({stop:()=>stopped++});audio.playing.add({stop:()=>stopped++});audio.playAt=42;
  assert.equal(audio.hasPlayback,true);audio.clearPlayback();assert.equal(stopped,2);assert.equal(audio.hasPlayback,false);assert.equal(audio.playAt,0);
});
test('explicit cancellation during interruption prevents the next queued action and late narration',async()=>{
  const f=fixture();let finish, executions=0;
  window.orvixDesktop.browserAct=()=>{executions++;return new Promise(resolve=>finish=resolve);};
  const pending=f.voice.handleToolCalls([{id:'inflight',name:'browser_act',args:{action:'tab_open'}},{id:'queued',name:'browser_act',args:{action:'tab_open'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.handleLocalActivity('start');f.voice.sendText('cancel');finish({status:'ok',verification:{verified:true}});await pending;
  assert.equal(executions,1);assert.equal(f.voice.browserOutcomes.size,0);assert.equal(f.sent.length,0);
});

test('a completed search survives acoustic interruption and returns on a quiet turn boundary',async()=>{
  const f=fixture();let finish,reads=0;f.voice.audioEngine.hasPlayback=false;f.voice.serverResponseActive=true;
  window.orvixDesktop.searchWeb=()=>finish?Promise.resolve({results:[]}):new Promise(resolve=>finish=resolve);
  window.orvixDesktop.readSearchPage=async({url})=>{reads++;return {status:'ok',source:'direct_page',url,title:'Africanized bees',content:'Verified bee facts about Africanized honey bees'};};
  const pending=f.voice.handleToolCalls([{id:'search',name:'web_search',args:{query:'Africanized honey bee'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.handleLocalActivity('start');
  finish({results:[{title:'Africanized bees',url:'https://example.com/bees'}]});await pending;
  assert.equal(reads,1);assert.equal(f.sent.length,0);assert.equal(f.cancelled.length,0);
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();f.voice.handleMessage({serverContent:{turnComplete:true}});
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].functionResponses[0].id,'search');assert.match(f.sent[0].functionResponses[0].response.querySources[0].content,/Verified bee facts/);
  assert.equal(f.voice.retainedResults.length,0);
});

test('server-cancelled call evidence resumes the task without replying to its cancelled ID',async()=>{
  const f=fixture();let finish;f.voice.audioEngine.hasPlayback=false;f.voice.serverResponseActive=true;
  window.orvixDesktop.searchWeb=()=>finish?Promise.resolve({results:[]}):new Promise(resolve=>finish=resolve);
  window.orvixDesktop.readSearchPage=async({url})=>({status:'ok',source:'direct_page',url,title:'Bee evidence',content:'Bee evidence: bees pollinate plants.'});
  const pending=f.voice.handleToolCalls([{id:'cancelled-search',name:'web_search',args:{query:'bees'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.handleLocalActivity('start');
  f.voice.handleMessage({toolCallCancellation:{ids:['cancelled-search']},serverContent:{interrupted:true}});
  finish({status:'ok',results:[{title:'Bees evidence',url:'https://example.com/bees'}]});await pending;
  assert.equal(f.cancelled.includes('current'),false);assert.equal(f.recovered.length,0);
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();
  assert.equal(f.sent.length,0);assert.equal(f.recovered.length,1);assert.match(JSON.stringify(f.recovered[0]),/Bee evidence/);assert.doesNotMatch(JSON.stringify(f.recovered[0]),/cancelled-search/);
});

test('new task discards an old search result, even when that search finishes later',async()=>{
  const f=fixture();let finish;f.voice.audioEngine.hasPlayback=false;
  window.orvixDesktop.searchWeb=()=>new Promise(resolve=>finish=resolve);
  let reads=0;window.orvixDesktop.readSearchPage=async()=>{reads++;return {status:'unavailable'};};
  const pending=f.voice.handleToolCalls([{id:'old',name:'web_search',args:{query:'bees'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.sendText('Open Calculator');
  finish({status:'ok',results:[{title:'Old evidence'}]});await pending;
  assert.equal(reads,0);assert.equal(f.sent.length,0);assert.equal(f.voice.retainedResults.length,0);assert.ok(f.cancelled.includes('current'));
});

test('partial transcripts settle once; a status follow-up keeps task identity and approval',async()=>{
  const f=fixture();const updates=[];f.voice.audioEngine.hasPlayback=false;
  window.orvixDesktop.updateFastTask=async input=>{updates.push(input);return {id:input.taskId||'new'};};
  f.voice.handleMessage({serverContent:{inputTranscription:{text:'are you'}}});
  f.voice.handleMessage({serverContent:{inputTranscription:{text:'are you done?',finished:true}}});
  await f.voice.workTaskPending;
  assert.equal(updates.length,1);assert.equal(updates[0].text,'are you done?');assert.equal(updates[0].continuation,true);assert.equal(f.voice.workTaskId,'current');assert.equal(f.cancelled.length,0);
});

test('reviewed executor results received while speaking are retained and delivered later',()=>{
  const f=fixture();f.voice.handleLocalActivity('start');
  f.voice.handleWorkEvent({type:'result',taskId:'current',action:'navigate',result:{status:'ok',verification:{verified:true}}});
  assert.equal(f.recovered.length,0);assert.equal(f.voice.retainedResults.length,1);
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();assert.equal(f.recovered.length,1);assert.match(JSON.stringify(f.recovered[0]),/পেজটি খোলা হয়েছে/);
});

test('delivery completes only after playback drains; cutting it off leaves it interrupted',()=>{
  for(const interrupt of [false,true]) {
    const f=fixture();f.voice.updateTranscript('assistant','A spoken answer');
    f.voice.handleMessage({serverContent:{turnComplete:true}});
    assert.equal(f.entries.at(-1).delivery,'interrupted');assert.equal(f.statuses.at(-1),'responding');
    if(interrupt)f.voice.handleLocalActivity('start');
    f.voice.audioEngine.hasPlayback=false;f.voice.finishAssistantDelivery();
    assert.equal(f.entries.at(-1).delivery,interrupt?'interrupted':'complete');
  }
});

test('missing Bangla voice retries exact Live confirmation once and rejects unsafe audio',()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;
  f.voice.browserOutcomes.set('navigate','পেজটি খুলেছে।');f.voice.browserModelText='Everything was purchased';f.voice.browserAudio=['UNSAFE'];
  f.voice.handleMessage({serverContent:{turnComplete:true}});
  assert.equal(f.recovered.length,1);assert.deepEqual(f.played,[]);
  assert.notEqual(f.voice.responseWaitTimer,undefined,'Missing confirmation audio must keep its recovery timer');
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'পেজটি খুলেছে।'},modelTurn:{parts:[{inlineData:{data:'SAFE',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  assert.deepEqual(f.played,['SAFE']);assert.equal(f.recovered.length,1);
});

test('a truthful spoken report longer than 31 seconds is retained, while oversized audio stays bounded',()=>{
  for(const oversized of [false,true]) {
    const f=fixture();f.voice.audioEngine.hasPlayback=false;
    const report='The source was checked. The competitor comparison remains unverified.';
    f.voice.browserOutcomes.set('task_review',report);
    const audio='A'.repeat(oversized?11_520_004:2_100_000);
    f.voice.handleMessage({serverContent:{outputTranscription:{text:report},modelTurn:{parts:[{inlineData:{data:audio,mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
    assert.equal(f.played.length,oversized?0:1);assert.equal(f.recovered.length,oversized?1:0);
    if(oversized) {assert.equal(f.voice.browserAudio.length,0);assert.ok(f.logs.some(log=>log[1].includes('buffer limit')));}
    else assert.equal(f.entries.at(-1).delivery,'complete');
  }
});

test('an explicitly reviewed partial report is not audited again with changed coverage quotes',async()=>{
  const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.sessionLanguage='en';let reviews=0;
  const context={revision:1,status:'blocked',steps:[],requirements:[{id:'facts',text:'Verified facts',status:'blocked'}]};
  window.orvixDesktop.getFastContext=async()=>context;
  window.orvixDesktop.reviewFastCompletion=async()=>{reviews++;return {status:'blocked',completed:false,context,review:{issues:['Evidence unavailable']}};};
  await f.voice.handleToolCalls([{id:'review',name:'review_task',args:{answer:'The facts remain unknown.',coverage:[]}}]);
  const summary=f.voice.browserOutcomes.get('task_review');
  f.voice.handleMessage({serverContent:{outputTranscription:{text:summary},...f.output('PARTIAL_REPORT').serverContent,turnComplete:true}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reviews,1);assert.equal(f.entries.at(-1).delivery,'complete');assert.match(f.entries.at(-1).text,/Evidence unavailable/);
});

test('an interrupted verified acknowledgement gets a fresh reply without replaying its action',()=>{
  const f=fixture();f.voice.serverResponseActive=true;
  f.voice.taskEvidence=[{name:'browser_act',response:{status:'ok',verification:{verified:true},completionStatement:'The requested page opened.'}}];
  f.voice.handleLocalActivity('start');f.voice.handleMessage({serverContent:{interrupted:true}});f.voice.handleLocalActivity('end');f.settleTranscriptGrace();
  assert.equal(f.recovered.length,1);assert.match(JSON.stringify(f.recovered[0]),/The requested page opened/);assert.match(JSON.stringify(f.recovered[0]),/Do not repeat verified effects/);
  assert.deepEqual([...f.voice.browserOutcomes.values()],['The requested page opened.']);
  assert.deepEqual(f.played,[]);f.voice.flushRetainedResults();assert.equal(f.recovered.length,1);
});

test('interrupted queued mutations wait for the old server boundary and a settled user instruction',async()=>{
  const f=fixture();let finish,executions=0;
  window.orvixDesktop.browserAct=()=>{executions++;return executions===1?new Promise(resolve=>finish=resolve):Promise.resolve({status:'ok',verification:{verified:true}});};
  const pending=f.voice.handleToolCalls([{id:'first',name:'browser_act',args:{action:'tab_open'}},{id:'second',name:'browser_act',args:{action:'tab_open'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.serverResponseActive=true;f.voice.handleLocalActivity('start');finish({status:'ok',verification:{verified:true}});
  f.voice.handleLocalActivity('end');f.settleTranscriptGrace();await new Promise(resolve=>setImmediate(resolve));assert.equal(executions,1);
  f.voice.handleMessage({serverContent:{inputTranscription:{text:'stop',finished:true},interrupted:true}});
  await pending;assert.equal(executions,1);assert.equal(f.sent.length,0);
});

test('a search finishing after reconnect is supplied as context, not an invalid old call ID',async()=>{
  const f=fixture();let finish;f.voice.audioEngine.hasPlayback=false;
  window.orvixDesktop.searchWeb=()=>finish?Promise.resolve({results:[]}):new Promise(resolve=>finish=resolve);
  window.orvixDesktop.readSearchPage=async({url})=>({status:'ok',source:'direct_page',url,title:'Retained bee facts',content:'Retained bee facts: bees pollinate plants.'});
  const pending=f.voice.handleToolCalls([{id:'old-session-call',name:'web_search',args:{query:'bees'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.generation++;f.voice.session={sendClientContent:input=>f.recovered.push(input),sendToolResponse:input=>f.sent.push(input)};
  finish({status:'ok',results:[{title:'Retained bees facts',url:'https://example.com/bees'}]});await pending;
  assert.equal(f.sent.length,0);assert.equal(f.recovered.length,1);assert.match(JSON.stringify(f.recovered[0]),/Retained bee facts/);assert.doesNotMatch(JSON.stringify(f.recovered[0]),/old-session-call/);
});

test('an empty final transcription signal commits the buffered request once',async()=>{
  const f=fixture();const updates=[];f.voice.audioEngine.hasPlayback=false;
  window.orvixDesktop.updateFastTask=async input=>{updates.push(input);return {id:'new'};};
  f.voice.handleMessage({serverContent:{inputTranscription:{text:'Open Calculator'}}});
  f.voice.handleMessage({serverContent:{inputTranscription:{finished:true}}});await f.voice.workTaskPending;
  assert.equal(updates.length,1);assert.equal(updates[0].text,'Open Calculator');assert.equal(updates[0].replace,true);
});

test('work_browser replaces its pending status with the verified operation acknowledgement',async()=>{
  const f=fixture();f.voice.sessionLanguage='en';window.orvixDesktop.executeFast=async()=>({status:'ok',verification:{verified:true}});
  await f.voice.handleToolCalls([{id:'search-operation',name:'work_browser',args:{operation:'search',query:'Africanized honey bee facts'}}]);
  const statement=f.sent[0].functionResponses[0].response.completionStatement;
  assert.equal(statement,'The requested search page opened.');assert.equal(f.voice.browserOutcomes.size,1);
  f.voice.handleMessage({serverContent:{outputTranscription:{text:statement},modelTurn:{parts:[{inlineData:{data:'VERIFIED_SEARCH_AUDIO',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  assert.deepEqual(f.played,['VERIFIED_SEARCH_AUDIO']);assert.equal(f.entries.at(-1).delivery,'complete');assert.equal(f.recovered.length,0);
});
test('server-only interruption also drops the abandoned event audio and accepts a fresh reply',()=>{
  const f=fixture();f.voice.handleMessage({serverContent:{interrupted:true,...f.output('OLD').serverContent}});assert.deepEqual(f.played,[]);
  f.voice.handleMessage(f.output('NEW'));assert.deepEqual(f.played,['NEW']);
});
test('a recoverable completion audit continues before committing a final reply',()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.auditRepairPending='Register the missing plan and review its outcomes.';
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'I finished the job.'},turnComplete:true}});
 assert.equal(f.recovered.length,1);assert.match(f.recovered[0].turns[0].parts[0].text,/missing plan/);assert.equal(f.entries.some(e=>e.phase==='final'),false);assert.equal(f.voice.awaitingAnswer,true);
 f.voice.applyUserRequest('A new task');assert.equal(f.voice.auditRepairPending,undefined);assert.equal(f.voice.auditRepairAttempts,0);
});
test('completion-audit repair requests are bounded at two and preserve existing effects',async()=>{
 const f=fixture();const context={revision:1,planRequired:true,steps:[],requirements:[],status:'partial'};
 window.orvixDesktop.getFastContext=async()=>context;window.orvixDesktop.reviewFastCompletion=async()=>({status:'partial',completed:false,context,review:{missingRequirements:['request']},repairInstruction:'Register a plan'});
 for(let i=0;i<3;i++)await f.voice.handleToolCalls([{id:'review-'+i,name:'review_task',args:{answer:'Existing observed results remain unchanged.',coverage:[]}}]);
 assert.equal(f.voice.auditRepairAttempts,2);assert.equal(f.voice.auditRepairPending,undefined);assert.equal(f.cancelled.length,0);
});
test('registering a plan reports progress without replacing the eventual answer',async()=>{
 const f=fixture();const context={revision:1,planRequired:false,steps:[],requirements:[],status:'working'};
 window.orvixDesktop.getFastContext=async()=>context;window.orvixDesktop.registerFastPlan=async()=>({status:'ok',context});
 await f.voice.handleToolCalls([{id:'plan',name:'plan_task',args:{requirements:[],steps:[]}}]);
 assert.equal(f.voice.browserOutcomes.has('task_plan'),false);assert.equal(f.cancelled.length,0);
});
test('the fallback audit repairs missing coverage when the model skipped review_task',async()=>{
 const f=fixture();f.voice.taskContext={revision:1,planRequired:true,steps:[],requirements:[{id:'request',text:'Both requested outcomes',status:'pending'}],status:'partial'};f.voice.finalLedgerReady=true;
 window.orvixDesktop.getFastContext=async()=>f.voice.taskContext;window.orvixDesktop.reviewFastCompletion=async()=>({status:'partial',completed:false,context:f.voice.taskContext,review:{missingRequirements:['request']},repairInstruction:'Register the missing plan'});
 f.voice.updateTranscript('assistant','Both results were observed but no reviewed completion was supplied.');
 await f.voice.reviewFinalAnswer(f.voice.transcript.assistant.text);
 assert.equal(f.voice.finalLedgerReady,false);assert.match(f.voice.auditRepairPending,/missing plan/);assert.equal(f.voice.auditRepairAttempts,1);
});
test('exhausted plan repair preserves a final explanation and blocks new effects',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.researchTask=null;let effects=0;
 window.orvixDesktop.executeFast=async()=>{effects++;return {status:'blocked',protocolBlocked:true,message:'Plan repair exhausted; task remains incomplete.'};};
 await f.voice.handleToolCalls([{id:'blocked-step',name:'desktop_observe',args:{scope:'windows'}}]);
 assert.equal(effects,1);assert.equal(f.voice.awaitingAnswer,true);assert.equal(f.voice.responseWaitAttempt,1);assert.notEqual(f.statuses.at(-1),'error');
 await f.voice.handleToolCalls([{id:'repeat-step',name:'desktop_observe',args:{scope:'windows'}}]);assert.equal(effects,1);
});
test('function execution questions read the workflow explanation and preserve explicit pagination',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.taskRequest='Explain who executes a function call and what the application sends back.';f.voice.researchTask=null;
 const inputs=[];window.orvixDesktop.readSearchPage=async input=>{inputs.push(input);return {status:'ok',url:input.url,source:'direct_page',content:'Execute Function Code (Your Responsibility): execute in your application. Send the result back to the model.'};};
 await f.voice.handleToolCalls([{id:'focused-read',name:'read_web_page',args:{url:'https://ai.google.dev/gemini-api/docs/function-calling'}}]);
 assert.equal(inputs[0].query,'How function calling works');
 await f.voice.handleToolCalls([{id:'explicit-read',name:'read_web_page',args:{url:'https://ai.google.dev/gemini-api/docs/function-calling',offset:0}}]);assert.equal(inputs[1].query,undefined);assert.equal(inputs[1].offset,0);
});

test('recovery waits for independently delivered transcription and never cancels a follow-up job',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.serverResponseActive=true;f.voice.awaitingAnswer=true;
 f.voice.taskEvidence=[{name:'get_weather',response:{status:'ok',location:'Dhaka, Bangladesh',temperature:'30 C'}}];
 const updates=[];window.orvixDesktop.updateFastTask=async input=>{updates.push(input);return {id:'current'};};
 f.voice.handleLocalActivity('start');f.voice.handleMessage({serverContent:{interrupted:true}});f.voice.handleLocalActivity('end');
 assert.equal(f.recovered.length,0,'Do not inject a continuation before transcription settles');
 f.voice.handleMessage({serverContent:{inputTranscription:{text:'বলো শেষ করো।',finished:true}}});await f.voice.workTaskPending;
 assert.equal(updates[0].intent,'continue');assert.equal(f.voice.workTaskId,'current');assert.equal(f.cancelled.length,0);
});
test('a delayed interruption after a recovery cannot send the same recovery again',()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.serverResponseActive=true;f.voice.awaitingAnswer=true;
 f.voice.taskEvidence=[{name:'get_weather',response:{status:'ok'}}];
 f.voice.handleLocalActivity('start');f.voice.handleMessage({serverContent:{interrupted:true}});f.voice.handleLocalActivity('end');f.settleTranscriptGrace();
 assert.equal(f.recovered.length,1);
 f.voice.handleMessage({serverContent:{interrupted:true}});f.voice.flushRetainedResults();assert.equal(f.recovered.length,1);
 f.voice.handleMessage(f.output('RECOVERED_REPLY'));assert.deepEqual(f.played,['RECOVERED_REPLY']);
});
test('greetings preserve the current job without creating, reviewing or completing an execution task',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;let updates=0,reviews=0,deliveries=0;
 window.orvixDesktop.updateFastTask=async()=>{updates++;return {id:'unexpected'};};
 window.orvixDesktop.reviewFastCompletion=async()=>{reviews++;return {completed:false};};
 window.orvixDesktop.setFastDelivery=async()=>{deliveries++;};
 assert.equal(f.voice.prepareWorkTask('Hello.',false),'conversation');await f.voice.workTaskPending;
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'Hello! How are you?'},...f.output('GREETING').serverContent,turnComplete:true}});
 assert.equal(updates,0);assert.equal(reviews,0);assert.equal(deliveries,0);assert.equal(f.voice.workTaskId,'current');assert.equal(f.cancelled.length,0);
 assert.ok(!f.entries.some(entry=>/partial|যাচাই বাকি/.test(entry.text)));assert.deepEqual(f.played,['GREETING']);
});
test('unsupported research audio is held until review and replaced by a truthful partial report',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.evidenceAnswerPending=true;f.voice.researchTask=null;
 const context={revision:1,goal:'Find Florian BD',requirements:[{id:'request',text:'Find Florian BD',status:'pending'},{id:'source-answer',text:'Verify business identity',kind:'research',status:'blocked'}],steps:[],evidence:[],budget:{actions:1}};
 window.orvixDesktop.getFastContext=async()=>context;
 window.orvixDesktop.reviewFastCompletion=async()=>({completed:false,status:'blocked',context,review:{issues:['No relevant source was verified.']}});
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'Florian BD does not exist and has no public footprint.'},...f.output('UNSUPPORTED_CLAIM').serverContent}});
 assert.deepEqual(f.played,[]);
 f.voice.handleMessage({serverContent:{turnComplete:true}});await new Promise(resolve=>setImmediate(resolve));
 const report=[...f.voice.browserOutcomes.values()].join(' ');assert.doesNotMatch(report,/does not exist|no public footprint/);assert.match(report,/যাচাই|অপূর্ণ/);
 assert.deepEqual(f.played,[]);assert.doesNotMatch(JSON.stringify(f.recovered),/does not exist|no public footprint/);
 f.voice.handleMessage({serverContent:{outputTranscription:{text:report},...f.output('TRUTHFUL_REPORT').serverContent,turnComplete:true}});
 assert.deepEqual(f.played,['TRUTHFUL_REPORT']);assert.equal(f.voice.taskContext.requirements[1].status,'blocked');
});

test('streamed repeated words and numbers retain their exact reviewed audio',()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.finalLedgerReady=true;
 const report='Review failed: HTTP 403, 403, 403. Please please retry later.';
 f.voice.browserOutcomes.set('task_report',report);
 for(const text of ['Review failed: HTTP ','403, ','403, ','403. ','Please ','please ','retry later.'])
   f.voice.handleMessage({serverContent:{outputTranscription:{text}}});
 f.voice.handleMessage({...f.output('REPEATED_FACTS'),serverContent:{...f.output('REPEATED_FACTS').serverContent,turnComplete:true}});
 assert.deepEqual(f.played,['REPEATED_FACTS']);assert.equal(f.recovered.length,0);assert.equal(f.entries.at(-1).text,report);
 const plain=fixture();plain.voice.updateTranscript('assistant','Please ',true);plain.voice.updateTranscript('assistant','please ',true);
 assert.equal(plain.voice.transcript.assistant.text,'Please please ');
});

test('missing audio waits for completion review before choosing the reply to read',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.responseAudioSeen=false;f.voice.researchTask=null;
 let resolve;window.orvixDesktop.getFastContext=async()=>({revision:1,steps:[],requirements:[]});
 window.orvixDesktop.reviewFastCompletion=()=>new Promise(done=>resolve=done);
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'I am starting now.'},turnComplete:true}});
 await new Promise(done=>setImmediate(done));
 assert.equal(f.recovered.length,0);assert.equal(f.voice.speechReplyText,undefined);
 resolve({completed:false,status:'partial',context:{revision:1,steps:[],requirements:[],evidence:[],budget:{actions:0}},review:{issues:['No work was verified.']}});
 await new Promise(done=>setImmediate(done));
 assert.doesNotMatch(JSON.stringify(f.recovered),/Read this existing reply.*I am starting now/);
});

test('a redundant weather plan retains the controller checklist and its verified work',async()=>{
 const f=fixture();f.voice.weatherTask=fastWeatherTaskFor('Weather for Dhaka');
 const context={revision:1,planRequired:false,steps:[{id:'weather-dhaka',tool:'get_weather',state:'verified'}],requirements:[{id:'weather-dhaka',kind:'weather'}]};
 let registrations=0;window.orvixDesktop.getFastContext=async()=>context;
 window.orvixDesktop.registerFastPlan=async()=>{registrations++;return {status:'invalid_request'};};
 await f.voice.handleToolCalls([{id:'redundant-plan',name:'plan_task',args:{requirements:[{id:'request'}],steps:[]}}]);
 assert.equal(registrations,0);assert.equal(f.sent[0].functionResponses[0].response.reused,true);
 assert.equal(f.voice.taskContext.steps[0].state,'verified');
});

test('an unresponsive socket can restart with retained evidence without racing another start',async()=>{
 const f=fixture();let closes=0;f.voice.session.close=()=>closes++;f.voice.audioEngine.hasPlayback=false;f.voice.awaitingAnswer=true;
 f.voice.responseWaitAttempt=1;const generation=f.voice.generation;
 f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,generation);
 assert.equal(closes,1);assert.equal(f.voice.session,null);assert.equal(f.voice.generation,generation+1);
 assert.equal(f.statuses.at(-1),'error');assert.ok(f.entries.some(entry=>entry.phase==='final'&&/unconfirmed|সম্পন্ন/.test(entry.text)));
 const evidence={name:'get_weather',response:{status:'ok',temperature:'31.5 C'}};
 f.voice.taskEvidence=[evidence];let connections=0,release;
 f.voice.audioEngine.ensureContext=async()=>{};
 f.voice.connect=async()=>{connections++;await new Promise(resolve=>release=resolve);f.voice.session={close(){}};};
 const restart=f.voice.start(false);await new Promise(resolve=>setImmediate(resolve));
 await f.voice.start(false);assert.equal(connections,1);release();await restart;
 assert.equal(f.voice.workTaskId,'current');assert.equal(f.voice.taskEvidence[0],evidence);
});

test('weather forwards custom plan IDs and does not cache or autofill controller rejections',async()=>{
 const f=fixture();f.voice.weatherTask=fastWeatherTaskFor('Weather for Rangpur and Rajshahi');
 f.voice.taskContext={revision:1,steps:[{id:'get-rangpur-weather',title:'Get weather for Rangpur',tool:'get_weather'},{id:'get-rajshahi-weather',title:'Get weather for Rajshahi',tool:'get_weather'}]};
 const observed=[];let reads=0;
 window.orvixDesktop.beginFastEvidence=async(id,name,args)=>{observed.push(args);return args.stepId==='get-rangpur-weather'?{status:'ok',stepId:args.stepId}:{status:'step_required',message:'Supply the planned step ID'};};
 window.orvixDesktop.recordFastEvidence=async()=>({evidenceId:'weather-proof'});
 window.orvixDesktop.getWeather=async()=>{reads++;return {status:'ok',location:'Rangpur, Bangladesh',temperature:'27 C'};};
 await f.voice.handleToolCalls([{id:'weather',name:'get_weather',args:{location:'Rangpur',stepId:'get-rangpur-weather'}}]);
 assert.equal(observed[0].stepId,'get-rangpur-weather');assert.equal(reads,1);assert.equal(f.voice.weatherTask.results.get('Rangpur').status,'ok');
 await f.voice.handleToolCalls([{id:'weather-rejected',name:'get_weather',args:{location:'Rajshahi',stepId:'wrong'}}]);
 assert.equal(reads,1);assert.equal(f.voice.weatherTask.attempts.has('Rajshahi'),false);assert.equal(f.voice.weatherTask.results.has('Rajshahi'),false);
 assert.equal(f.sent.at(-1).functionResponses[0].response.status,'step_required');
});
test('weather comparisons avoid web research and concrete research plans have no generic seeded outcomes',async()=>{
 const f=fixture();f.voice.applyUserRequest('বাংলায় উত্তর দাও। get_weather দিয়ে রংপুর এবং রাজশাহীর আবহাওয়া তুলনা করো।');
 assert.equal(f.voice.researchTask,null);assert.deepEqual(f.voice.weatherTask.cities,['Rangpur','Rajshahi']);
 let plans=0;window.orvixDesktop.updateFastTask=async()=>({id:'research'});
 window.orvixDesktop.getFastContext=async()=>({id:'research',revision:1,planRequired:true,steps:[],requirements:[{id:'request',text:'Research Florian BD and compare a competitor'}],evidence:[],budget:{actions:0}});
 window.orvixDesktop.registerFastPlan=async()=>{plans++;return {status:'ok'};};
 f.voice.prepareWorkTask('Research Florian BD and compare a competitor',false);await f.voice.workTaskPending;
 assert.equal(plans,0);assert.equal(f.voice.taskContext.requirements.length,1);assert.equal(f.voice.taskContext.planRequired,true);
});

test('the reply watchdog measures output silence instead of interrupting an actively streamed long report',()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.evidenceAnswerPending=true;f.voice.awaitingAnswer=true;
 f.voice.armResponseWait();const first=f.voice.responseWaitTimer;
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'A long source-backed report '},...f.output('BUFFERED').serverContent}});
 const second=f.voice.responseWaitTimer;assert.notEqual(second,first);
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'continues while its evidence is being checked.'}}});
 assert.notEqual(f.voice.responseWaitTimer,second);assert.equal(f.recovered.length,0);assert.equal(f.voice.responseWaitAttempt,0);
});

test('reply recovery may review retained evidence while blocking new tool effects',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.responseWaitAttempt=1;
 const context={revision:1,planRequired:false,steps:[],requirements:[],evidence:[],budget:{actions:1}};
 let reviews=0,effects=0;window.orvixDesktop.getFastContext=async()=>context;
 window.orvixDesktop.reviewFastCompletion=async()=>{reviews++;return {completed:true,status:'completed',context};};
 window.orvixDesktop.browserAct=async()=>{effects++;return {status:'ok'};};
 await f.voice.handleToolCalls([{id:'retained-review',name:'review_task',args:{answer:'The observed result is ready.',coverage:[]}}]);
 await f.voice.handleToolCalls([{id:'new-effect',name:'browser_act',args:{action:'tab_open'}}]);
 assert.equal(reviews,1);assert.equal(f.sent[0].functionResponses[0].response.completed,true);assert.equal(effects,0);
});
test('unfinished research recovery permits source repairs but completed reply recovery blocks them',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.responseWaitAttempt=1;
 f.voice.researchTask=load('fastResearch.ts').fastResearchTaskFor('Research bee pollination');
 let searches=0;window.orvixDesktop.searchWeb=async()=>{searches++;return {status:'ok',results:[]};};
 window.orvixDesktop.readSearchPage=async()=>({status:'unavailable'});
 await f.voice.handleToolCalls([{id:'repair',name:'web_search',args:{query:'bee pollination'}}]);assert.ok(searches>0);
 const prior=searches;f.voice.finalLedgerReady=true;
 await f.voice.handleToolCalls([{id:'replay',name:'web_search',args:{query:'bee pollination again'}}]);assert.equal(searches,prior);
});
test('terminal transport failure reports interrupted delivery and preserves the task instead of cancelling it',()=>{
 const f=fixture();f.voice.audioEngine={hasPlayback:false,clearPlayback(){},close(){}};f.voice.session.close=()=>{};
 const proof={name:'read_web_page',response:{status:'ok',content:'Observed source'}};f.voice.taskEvidence=[proof];
 f.voice.taskContext={id:'current',requirements:[],steps:[],evidence:[]};
 const epoch=f.voice.taskEpoch;f.voice.stop(true);
 assert.equal(f.cancelled.includes('current'),false);assert.equal(f.voice.taskEpoch,epoch);assert.deepEqual(f.voice.taskEvidence,[proof]);assert.equal(f.voice.workTaskId,'current');
 assert.equal(f.entries.at(-1).phase,'final');assert.equal(f.entries.at(-1).delivery,'interrupted');assert.match(f.entries.at(-1).text,/delivery-interrupted/);
 assert.equal(f.voice.interruptedReplyPending,true);
});
test('search results expose actual page evidence IDs instead of inviting use of the search aggregate as a quote',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;
 const work=require('../electron/fast-work.cjs').createFastWork({browser:{}}),task=work.update({text:'Search bee pollination'});
 f.voice.workTaskId=task.id;f.voice.taskRequest='Search bee pollination';f.voice.taskContext=work.taskContext(task.id);
 Object.assign(window.orvixDesktop,{beginFastEvidence:async(id,tool,input)=>work.beginEvidence(id,tool,input),recordFastEvidence:async(id,token,tool,input,result)=>work.recordEvidence(id,token,tool,input,result),searchWeb:async()=>({status:'ok',results:[{url:'https://example.com/bees',title:'Bee pollination facts'}]}),readSearchPage:async({url})=>({status:'ok',source:'direct_page',url,title:'Bee pollination',content:'Bee pollination helps crops reproduce.'})});
 await f.voice.handleToolCalls([{id:'search-page-proof',name:'web_search',args:{query:'bee pollination'}}]);
 const response=f.sent[0].functionResponses[0].response,page=response.querySources[0];
 assert.ok(page.evidenceId);assert.notEqual(page.evidenceId,response.evidenceId);assert.equal(page.sourcePassageId,page.evidenceId+':excerpt');
 const observed=work.taskContext(task.id).evidence.find(e=>e.id===page.evidenceId);assert.equal(observed.tool,'read_web_page');assert.equal(observed.sourceUrl,page.url);assert.equal(observed.verified,true);
});

test('text dispatch waits for the current ledger and arms initial response recovery',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;let release;
 window.orvixDesktop.updateFastTask=()=>new Promise(resolve=>release=()=>resolve({id:'prepared'}));
 window.orvixDesktop.getFastContext=async()=>({id:'prepared',revision:1,planRequired:false,requirements:[],steps:[],budget:{actions:0}});
 f.voice.sendText('Observe my windows');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.recovered.length,0);release();await f.voice.workTaskPending;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.recovered.length,1);assert.match(f.recovered[0].turns[0].parts[0].text,/prepared/);assert.notEqual(f.voice.responseWaitTimer,undefined);
});

test('a metadata-only function boundary cannot erase the timeout or finish an empty report',()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.awaitingAnswer=true;f.voice.pendingToolResponse=true;f.voice.armResponseWait();
 f.voice.handleMessage({serverContent:{generationComplete:true}});
 assert.equal(f.voice.awaitingAnswer,true);assert.notEqual(f.voice.responseWaitTimer,undefined);assert.equal(f.entries.some(entry=>entry.phase==='final'),false);
 f.voice.handleMessage({serverContent:{outputTranscription:{text:'The retained result is ready.'},...f.output('FINAL').serverContent,turnComplete:true}});
 assert.equal(f.voice.responseWaitTimer,undefined);assert.equal(f.entries.at(-1).delivery,'complete');
});

test('a silent initial connection reconnects once and permits only the still-pending controller work',async()=>{
 const f=fixture();f.voice.audioEngine.hasPlayback=false;f.voice.awaitingAnswer=true;f.voice.taskContext={revision:1,budget:{actions:0}};
 let closes=0,reconnects=0,effects=0;f.voice.session.close=()=>closes++;f.voice.scheduleReconnect=()=>{reconnects++;f.voice.session=null;};
 f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);
 assert.equal(closes,1);assert.equal(reconnects,1);assert.equal(f.voice.initialResponseRecovery,true);assert.equal(f.voice.responseWaitAttempt,1);
 f.voice.session={sendToolResponse:input=>f.sent.push(input),sendClientContent:input=>f.recovered.push(input),close:()=>closes++};
 window.orvixDesktop.executeFast=async()=>{effects++;return {status:'ok',observation:{windows:[]}};};
 await f.voice.handleToolCalls([{id:'pending-read',name:'desktop_observe',args:{scope:'windows'}}]);assert.equal(effects,1);
 f.voice.handleResponseWaitTimeout(f.voice.taskEpoch,f.voice.generation);assert.equal(reconnects,1);assert.equal(f.statuses.at(-1),'error');
});
