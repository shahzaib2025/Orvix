const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path'), Module=require('node:module');
function load(file, sdk){
  const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',external:['@google/genai'],write:false,logLevel:'silent'}).outputFiles[0].text;
  const mod=new Module(__filename,module);mod.paths=module.paths;
  if(sdk){const base=mod.require.bind(mod);mod.require=name=>name==='@google/genai'?{...base(name),GoogleGenAI:sdk}:base(name);}
  mod._compile(code,__filename);return mod.exports;
}
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');
const {simpleFastCheck,simpleFastAcknowledgment,simpleFastWorkProgress}=load('simpleFastFlow.ts');
const {modelCatalogs,unsupportedModelNames}=load('simpleFastResearch.ts');
const {FastProgressVoice,progressContext,validProgress}=load('fastProgressVoice.ts');
const {FastProgressPreview,canPreviewProgress}=load('fastProgressPreview.ts');
const {knownFirstRead,retainedInformationFollowup}=load('simpleFastResearch.ts');
const {conversationLanguage}=load('fastConversation.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('queue did not reach the expected state');}
function fixture(t, Class=SimpleFastVoiceSession){
  const events=[],entries=[],logs=[],sent=[],audio={playing:false};
  global.window={speechSynthesis:{getVoices:()=>[],cancel:()=>events.push('cancelSpeech')},orvixDesktop:{
    logLive:(kind,message,details)=>logs.push({kind,message,details}),
    listDirectory:async args=>{events.push('execute:'+args.directory);return {status:'ok',entries:[]};},
    readSearchPage:async args=>{events.push('read:'+args.url);return {status:'ok',source:'direct_page',url:args.url,content:'A readable source page with actual factual information and supporting details.'};},
    searchWeb:async()=>({status:'ok',results:[]}),onFastWorkEvent:()=>()=>{},
    getFastSettings:async()=>({desktopEnabled:true}),getPcSnapshot:async()=>null,
    createLiveToken:async()=>({token:'TEST_TOKEN',model:'fixture-live'}),
  }};
  const voice=new Class([],{onStatus:s=>events.push('status:'+s),onTranscript:e=>entries.push({...e}),onProgress:e=>events.push('stage:'+e.text)});
  voice.stopped=false;voice.language='en';voice.session={sendToolResponse:x=>sent.push({type:'tool',...x}),sendClientContent:x=>sent.push({type:'client',...x}),sendRealtimeInput:x=>sent.push({type:'audio',...x}),close(){}};
  voice.audioEngine={get hasPlayback(){return audio.playing;},hasMicrophone:false,ensureContext:async()=>{},playAudio:()=>events.push('audio'),close(){audio.playing=false;},getAudioLevel:()=>0,enableMicrophone:async(...args)=>{audio.capture=args;},onPlaybackDrained:()=>{for(const resolve of voice.playbackWaiters)resolve();voice.playbackWaiters.clear();}};
  voice.narrator={render:async text=>{events.push('render:'+text);return ['PCM'];},close(){}};
  voice.progressVoice={prepare:async()=>{},close(){},generate:async context=>{
    const text=context.stage==='task'?`Understood. I’ll examine ${context.goal}.`:`I’m preparing ${context.operation.name} for ${context.goal||'your request'}.`;
    let audio=[];try{audio=await voice.narrator.render(text);}catch{/* Synthetic generated text with unavailable audio exercises native fallback. */}
    return {text,audio,generationMs:0};
  }};
  voice.taskStartedAt=Date.now();
  audio.drain=()=>{audio.playing=false;voice.audioEngine.onPlaybackDrained();};
  t.after(()=>voice.stop());return {voice,events,entries,logs,sent,audio};
}

test('saved profile reaches Fast startup even when companion memories are empty',async t=>{
  let config;
  class SDK{constructor(){this.live={connect:async input=>{config=input.config;return {sendClientContent(){},close(){}};}};}}
  const {SimpleFastVoiceSession:Class}=load('simpleFastVoice.ts',SDK),f=fixture(t,Class);
  const profile={name:'Test Person',displayName:'Test',occupation:'Student',company:'Test Team',interests:'chess, coding',bio:'Learning design',location:'Dhaka',language:'Bangla',timezone:'Asia/Dhaka',website:'https://example.com',email:'test@example.com',phone:'000000',avatar:'IMAGE_MUST_NOT_BE_SENT'};
  f.voice.stopped=true;f.voice.session=null;f.voice.updateIdentity(profile);
  window.orvixDesktop.recallCompanionMemories=async()=>({status:'ok',records:[],revision:0});
  await f.voice.start(false);
  for(const [key,value] of Object.entries(profile))if(key!=='avatar')assert.ok(config.systemInstruction.includes(JSON.stringify(value)),key);
  assert.doesNotMatch(config.systemInstruction,/IMAGE_MUST_NOT_BE_SENT/);
  assert.match(config.systemInstruction,/empty, disabled or unavailable memory lookup does not erase this profile/);
});
test('live profile edits update provider context without starting an assistant response',t=>{
  const f=fixture(t);
  f.voice.updateIdentity({name:'Previous Name',interests:'Previous Interest'});
  f.voice.updateIdentity({name:'Updated Name'});
  const latest=f.sent.at(-1);
  assert.equal(latest.turnComplete,false);
  assert.match(JSON.stringify(latest),/Updated Name/);
  assert.doesNotMatch(JSON.stringify(latest),/Previous Name|Previous Interest/);
  assert.match(latest.turns[0].parts[0].text,/do not respond or start speaking/);
  const prompt=f.voice.requestPrompt('What is my name?');
  assert.match(prompt,/Updated Name/);assert.doesNotMatch(prompt,/Previous Name|Previous Interest/);
});
test('spoken requests receive the current profile including removal of old fields',async t=>{
  const f=fixture(t);f.voice.updateIdentity({name:'Old Name'});
  await f.voice.enableMicrophone();f.voice.updateIdentity({displayName:'Current Name',interests:'Music'});
  f.audio.capture[1]('start');
  const context=f.sent.at(-1);
  assert.equal(context.turnComplete,false);assert.match(JSON.stringify(context),/Current Name|Music/);
  assert.doesNotMatch(JSON.stringify(context),/Old Name/);
  f.voice.updateIdentity(null);f.audio.capture[1]('start');
  assert.match(context.turns[0].parts[0].text,/wait for the spoken request/);
  assert.doesNotMatch(JSON.stringify(f.sent.at(-1)),/Current Name|Music/);
});
test('empty and disabled recall results retain current profile facts and memory status',async t=>{
  const f=fixture(t);f.voice.updateIdentity({name:'Profile Name',occupation:'Designer'});
  for(const status of ['ok','disabled','unavailable']){
    window.orvixDesktop.recallCompanionMemories=async()=>({status,records:[],revision:5});
    const result=await f.voice.dispatch('recall_companion_memories',{query:'Do you know me?'});
    assert.equal(result.status,status);assert.deepEqual(result.records,[]);
    assert.deepEqual(result.savedProfile.fields,{name:'Profile Name',occupation:'Designer'});
    assert.match(result.profileContext,/does not erase this profile/);
  }
  f.voice.updateIdentity({name:'Changed Name'});
  const result=await f.voice.dispatch('recall_companion_memories',{query:'my name'});
  assert.deepEqual(result.savedProfile.fields,{name:'Changed Name'});
});
test('profile clearing supplies an empty snapshot without filling missing personal details',t=>{
  const f=fixture(t);f.voice.updateIdentity(null);
  assert.match(f.sent.at(-1).turns[0].parts[0].text,/Profile page\): \{\}/);
  const {savedUserProfile}=load('userProfileContext.ts');
  assert.deepEqual(savedUserProfile({name:'  ',avatar:'private-image'}),{});
});

function catalogReader(f,failed=false){
  window.orvixDesktop.readSearchPage=async args=>{
    f.events.push('read:'+args.url);
    return failed?{status:'unavailable',url:args.url,message:'HTTP 403'}:{status:'ok',source:'direct_page',url:args.url,
      content:args.url.includes('openai')?'GPT-6.1 Sol is documented for coding and professional work. This API catalog does not establish app availability.':'Gemini 4 Argon is documented for enterprise intelligence and software engineering. This API catalog does not establish app availability.'};
  };
}
const comparison='Achha, ChatGPT latest model gula and Google latest model gula compare koro to.';
test('browser reuse explains available tabs and pins the resolved tab before the next action',async t=>{
  const f=fixture(t),calls=[],contexts=[];
  const tabs=[{ref:'session:tab:1',url:'https://www.youtube.com/',active:true},{ref:'session:tab:2',url:'https://www.youtube.com/watch?v=other'}];
  window.orvixDesktop.browserObserve=async()=>({observation:{tabs,totalTabs:2}});
  window.orvixDesktop.updateFastTask=async()=>({id:'browser-task'});
  window.orvixDesktop.executeFast=async(_task,kind,args)=>{assert.equal(kind,'browser_act');calls.push(args);return {status:'ok',resolvedTarget:{ref:'session:tab:1'},verification:{verified:true}};};
  f.voice.acknowledge=async context=>{contexts.push(context);return true;};
  f.voice.beginTask('Search YouTube for jazz then search for piano');
  await f.voice.runTool({id:'browser1',name:'browser_act',args:{action:'youtube_search',target:'current',args:{query:'jazz',tabPolicy:'new'}}});
  await f.voice.runTool({id:'browser2',name:'browser_act',args:{action:'youtube_search',target:'session:tab:2',args:{query:'piano'}}});
  assert.equal(calls.length,2);assert.equal(calls[0].args.tabPolicy,'reuse');assert.equal(calls[0].target,undefined);
  assert.equal(calls[1].target,'session:tab:1');assert.deepEqual(contexts[0].browserTarget,{site:'youtube.com',count:2});
});
test('uncertain browser mutation is not replayed during recovery',async t=>{
  const f=fixture(t);let dispatches=0;
  window.orvixDesktop.browserObserve=async()=>({observation:{tabs:[],totalTabs:0}});
  window.orvixDesktop.updateFastTask=async()=>({id:'browser-task'});
  window.orvixDesktop.executeFast=async()=>{dispatches++;return {status:'dispatched',completionUnknown:true};};
  f.voice.acknowledge=async()=>true;f.voice.beginTask('Open YouTube in a new tab');
  const args={action:'tab_open',args:{url:'https://www.youtube.com/'}};
  await f.voice.runTool({id:'uncertain-browser',name:'browser_act',args});
  const retry=await f.voice.runTool({id:'retry-browser',name:'browser_act',args});
  assert.equal(retry.result.status,'already_observed');assert.equal(retry.result.completionUnknown,true);assert.equal(dispatches,1);
});
test('Stop during browser inventory refresh prevents acknowledgment and dispatch',async t=>{
  const f=fixture(t);let finish,dispatches=0,acknowledgments=0;
  window.orvixDesktop.browserObserve=()=>new Promise(resolve=>finish=resolve);
  window.orvixDesktop.executeFast=async()=>{dispatches++;return {status:'ok'};};
  f.voice.acknowledge=async()=>{acknowledgments++;return true;};f.voice.beginTask('Open YouTube');
  const pending=f.voice.runTool({name:'browser_act',args:{action:'tab_open',args:{url:'https://www.youtube.com/'}}});
  await until(()=>!!finish);f.voice.stop();finish({observation:{tabs:[]}});
  assert.equal((await pending).result.status,'cancelled');assert.equal(dispatches,0);assert.equal(acknowledgments,0);
});
function windowExecutor(f, results) {
  window.orvixDesktop.updateFastTask=async()=>({id:'window-task'});
  window.orvixDesktop.executeFast=async(_task,kind,args)=>{f.events.push('window:'+args.action);assert.equal(kind,'window_act');return typeof results==='function'?results(args):results.shift();};
}
test('focus minimize and maximize dispatch without generating acknowledgment and check native state',async t=>{
  const f=fixture(t);windowExecutor(f,()=>({status:'ok',verification:{verified:true}}));
  f.voice.progressVoice.generate=()=>assert.fail('quick window success must not acknowledge');
  for(const action of ['focus','minimize','maximize']) {
    const receipt=await f.voice.runTool({id:action,name:'manage_window',args:{action,appName:'fixture'}});
    assert.equal(receipt.result.stepCheck.verified,true);
  }
  assert.equal(f.events.filter(e=>e.startsWith('window:')).length,3);
  assert.equal(f.entries.length,0);
});
test('a definite window failure explains recovery and drains speech before its single retry',async t=>{
  const f=fixture(t);windowExecutor(f,[{status:'failed',handle:42,verification:{verified:false}},{status:'ok',verification:{verified:true}}]);
  let finish;f.voice.audioEngine.playAudio=()=>f.audio.playing=true;
  f.voice.progressVoice.generate=async(context)=>{assert.equal(context.recovery,'window_retry');assert.equal(context.previous.status,'failed');await new Promise(resolve=>finish=resolve);return {text:'That did not work; I will try again.',audio:['PCM'],generationMs:0};};
  const pending=f.voice.runTool({id:'focus',name:'manage_window',args:{action:'focus',appName:'fixture'}});
  await until(()=>!!finish);assert.equal(f.events.filter(e=>e==='window:focus').length,1);
  finish();await until(()=>f.audio.playing);assert.equal(f.events.filter(e=>e==='window:focus').length,1);
  f.audio.drain();const receipt=await pending;assert.equal(receipt.result.stepCheck.verified,true);assert.equal(f.events.filter(e=>e==='window:focus').length,2);
});
test('a second failed window attempt is reported and cannot be automatically repeated',async t=>{
  const f=fixture(t);windowExecutor(f,()=>({status:'failed',verification:{verified:false}}));
  const args={action:'maximize',appName:'fixture'};
  const first=await f.voice.runTool({id:'first',name:'manage_window',args});assert.equal(first.result.stepCheck.verified,false);assert.match(first.result.instruction,/do not retry/);
  const duplicate=await f.voice.runTool({id:'again',name:'manage_window',args});assert.equal(duplicate.result.status,'already_observed');assert.equal(f.events.filter(e=>e==='window:maximize').length,2);
});
test('uncertain window effect and approval do not trigger apology or automatic retry',async t=>{
  const f=fixture(t);windowExecutor(f,[{status:'dispatched',completionUnknown:true},{status:'confirmation_required',approvalId:'review'}]);
  f.voice.progressVoice.generate=()=>assert.fail('uncertainty and approval are not failures');
  const uncertain=await f.voice.runTool({name:'manage_window',args:{action:'focus',appName:'fixture'}});assert.equal(uncertain.result.stepCheck.uncertain,true);
  const approval=await f.voice.runTool({name:'manage_window',args:{action:'minimize',appName:'other'}});assert.equal(approval.result.stepCheck.approval,true);assert.equal(f.events.filter(e=>e.startsWith('window:')).length,2);
});
test('closing and restoring windows retain the ordinary explanation ordering',async t=>{
  const f=fixture(t);windowExecutor(f,()=>({status:'ok',verification:{verified:true}}));let explained=0;
  f.voice.progressVoice.generate=async()=>{explained++;assert.equal(f.events.filter(e=>e.startsWith('window:')).length,explained-1);return {text:'I will change this window.',audio:['PCM'],generationMs:0};};
  for(const action of ['close','restore'])await f.voice.runTool({name:'manage_window',args:{action,appName:'fixture'}});
  assert.equal(explained,2);
});
test('Stop during a window recovery explanation prevents retry dispatch',async t=>{
  const f=fixture(t);windowExecutor(f,()=>({status:'failed',verification:{verified:false}}));let finish;
  f.voice.progressVoice.generate=async()=>{await new Promise(resolve=>finish=resolve);return {text:'I will try again.',audio:['PCM'],generationMs:0};};
  const pending=f.voice.runTool({name:'manage_window',args:{action:'focus',appName:'fixture'}});await until(()=>!!finish);f.voice.stop();finish();await pending;assert.equal(f.events.filter(e=>e==='window:focus').length,1);
});
test('a nonblocking window proposal cannot deliver a premature provider report',async t=>{
  const f=fixture(t);let finish;windowExecutor(f,()=>new Promise(resolve=>finish=resolve));f.voice.beginTask('Focus fixture');
  f.voice.receive({toolCall:{functionCalls:[{id:'focus',name:'manage_window',args:{action:'focus',appName:'fixture'}}]}});await until(()=>!!finish);
  f.voice.receive({serverContent:{outputTranscription:{text:'The window is focused.'},turnComplete:true}});await tick();assert.equal(f.entries.some(e=>e.phase==='final'),false);
  finish({status:'ok',verification:{verified:true}});await until(()=>f.sent.length===1);assert.equal(f.sent[0].type,'tool');assert.equal(f.entries.some(e=>e.phase==='final'),false);
});
test('native window result uses the bounded state check without converting mismatch to success',()=>{
  const {windowActionResult}=require('../electron/fast-windows.cjs');
  assert.equal(windowActionResult({ok:true,action:'maximize',verified:false}).status,'failed');
  assert.equal(windowActionResult({ok:true,action:'minimize',verified:true}).verification.verified,true);
  assert.equal(windowActionResult({ok:false,action:'focus',verified:true}).status,'ok');
  assert.equal(windowActionResult({ok:false,action:'focus',completionUnknown:true}).status,'dispatched');
});
test('quick window declaration uses NON_BLOCKING while other tools retain their behavior',async t=>{
  let config;class SDK{constructor(){this.live={connect:async input=>{config=input.config;return {sendClientContent(){},close(){}};}};}}
  const {SimpleFastVoiceSession:Class}=load('simpleFastVoice.ts',SDK);const f=fixture(t,Class);f.voice.stopped=true;f.voice.session=null;await f.voice.start(false);
  assert.ok(config.tools[0].functionDeclarations.every(d=>d.behavior===(d.name==='manage_window'?'NON_BLOCKING':'BLOCKING')));
});
test('quick window HTTP uncertainty never falls through to a second CLI mutation',async()=>{
  const fs=require('fs'),{EventEmitter}=require('events');let cliCalls=0;
  const mod=new Module(__filename,module);mod.paths=module.paths;const base=mod.require.bind(mod);
  mod.require=name=>name==='http'?{request:()=>{const req=new EventEmitter();req.write=()=>{};req.destroy=()=>{};req.end=()=>queueMicrotask(()=>req.emit('timeout'));return req;}}:name==='child_process'?{execFile:()=>cliCalls++}:base(name);
  mod._compile(fs.readFileSync(path.join(__dirname,'../electron/window-control.cjs'),'utf8'),__filename);
  const result=await mod.exports.manageWindow({action:'focus',appName:'fixture'});assert.equal(result.completionUnknown,true);assert.equal(cliCalls,0);
});
test('unavailable recovery speech leaves the failed quick action unrepeated',async t=>{
  const f=fixture(t);windowExecutor(f,()=>({status:'failed',verification:{verified:false}}));f.voice.progressVoice.generate=async()=>{throw Error('Unavailable');};
  const result=await f.voice.runTool({name:'manage_window',args:{action:'focus',appName:'fixture'}});assert.equal(result.result.quickWindowRetryExhausted,true);assert.equal(f.events.filter(e=>e==='window:focus').length,1);
});
test('progress generation streams its own wording and never invokes the exact-text renderer',async t=>{
  const f=fixture(t);let finish;
  f.voice.narrator.render=()=>assert.fail('progress must not re-render a canned sentence');
  f.voice.progressVoice.generate=async(context,language,signal,timeout,onAudio,onText)=>{
    assert.equal(context.goal,'Compare current catalogs');assert.equal(context.operation.name,'list_directory');
    onText('I will inspect the requested folder.');onAudio('FIRST');
    await new Promise(resolve=>finish=resolve);onAudio('LAST');return {text:'I will inspect the requested folder.',audio:['FIRST','LAST'],generationMs:10};
  };
  f.voice.taskText='Compare current catalogs';const action=f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});
  await until(()=>!!finish);assert.equal(f.events.filter(e=>e==='audio').length,1);assert.equal(f.events.includes('execute:A'),false);
  finish();await action;assert.equal(f.events.filter(e=>e==='audio').length,2);assert.equal(f.events.includes('execute:A'),true);
  assert.ok(f.entries.some(e=>e.text==='I will inspect the requested folder.'&&e.delivery==='complete'));
});
test('a streamed acknowledgment waits for its final playback buffers before executing',async t=>{
  const f=fixture(t);let finish;f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  f.voice.progressVoice.generate=async(_context,_language,_signal,_timeout,onAudio)=>{onAudio('FIRST');await new Promise(resolve=>finish=resolve);onAudio('LAST');return {text:'I will inspect this folder.',audio:['FIRST','LAST'],generationMs:10};};
  const pending=f.voice.runTool({name:'list_directory',args:{directory:'A'}});await until(()=>!!finish);f.audio.drain();assert.equal(f.events.includes('execute:A'),false);
  finish();await until(()=>f.audio.playing);assert.equal(f.events.includes('execute:A'),false);f.audio.drain();await pending;assert.equal(f.events.includes('execute:A'),true);
});
test('the progress model composes a new sentence from context rather than selecting stored examples',async()=>{
  const voice=new FastProgressVoice(),sent=[];voice.session={sendClientContent:x=>sent.push(x),close(){}};
  const pending=voice.generate(progressContext('task','Research Florian BD'),'en',new AbortController().signal);await tick();
  assert.match(JSON.stringify(sent[0]),/Research Florian BD/);assert.doesNotMatch(JSON.stringify(sent[0]),/Read this exact|Understood|ঠিক আছে/);
  voice.receive({serverContent:{outputTranscription:{text:'I will investigate Florian BD and its competitors.'},modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  const result=await pending;assert.equal(result.text,'I will investigate Florian BD and its competitors.');assert.deepEqual(result.audio,['PCM']);voice.close();
});
test('the startup deadline cannot interrupt a progress sentence once audio has started',async()=>{
  const voice=new FastProgressVoice(),audio=[];voice.session={sendClientContent(){},close(){assert.equal(voice.pending,undefined);}};
  const pending=voice.generate(progressContext('task','Read the catalog'),'en',new AbortController().signal,20,chunk=>audio.push(chunk));await tick();
  voice.receive({serverContent:{outputTranscription:{text:'I will read the catalog.'},modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]}}});
  await new Promise(resolve=>setTimeout(resolve,40));assert.ok(voice.pending);voice.receive({serverContent:{turnComplete:true}});await pending;assert.deepEqual(audio,['PCM']);voice.close();
});
test('a failed generated acknowledgment prevents dispatch and does not trap the next user request',async t=>{
  const f=fixture(t);f.voice.progressVoice.generate=async()=>{throw Error('Startup deadline');};
  f.voice.beginTask('List my Desktop files');const result=await f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});assert.equal(result.result.dispatched,false);assert.equal(f.events.includes('execute:A'),false);
  f.voice.taskAckPending=false;f.voice.turnText='Work finished';await f.voice.report();assert.doesNotMatch(f.entries.find(e=>e.phase==='final').text,/Work finished/);
  f.voice.sendText('Hello');await until(()=>f.sent.length===1);assert.equal(f.voice.taskText,'Hello');assert.equal(f.voice.progressUnavailable,false);
});
test('generated acknowledgment failure resolves the provider call without executing it',async t=>{
  const f=fixture(t);f.voice.taskActive=true;f.voice.progressVoice.generate=async()=>{throw Error('Startup deadline');};
  f.voice.receive({toolCall:{functionCalls:[{id:'pending',name:'list_directory',args:{directory:'A'}}]}});await until(()=>f.sent.length===1);
  assert.equal(f.sent[0].functionResponses[0].id,'pending');assert.equal(f.sent[0].functionResponses[0].response.dispatched,false);assert.equal(f.events.includes('execute:A'),false);
});
test('progress context omits entered credentials, private values and URL query tokens',()=>{
  const context=progressContext('tool','Type password SUPER_SECRET','desktop_act',{action:'type',text:'SUPER_SECRET',target:'PRIVATE_REF'});
  assert.doesNotMatch(JSON.stringify(context),/SUPER_SECRET|PRIVATE_REF/);
  const page=progressContext('tool','Read a source','read_web_page',{url:'https://example.com/path?token=SUPER_SECRET'});assert.equal(page.operation.subject,'example.com');
  assert.equal(validProgress('I have completed the task.'),false);assert.equal(validProgress('আমি কাজটি শেষ করেছি।'),false);assert.equal(validProgress('I will read the current catalog.'),true);
  assert.equal(validProgress('আমি এখন ফ্লোরিয়ান বিডি-র অফিসিয়াল সাইটটি'),false);
});
test('an incomplete generated phrase is completed after its playback drains and before execution',async t=>{
  const f=fixture(t);let attempts=0;f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  f.voice.progressVoice.generate=async(context,_language,_signal,_deadline,onAudio)=>{attempts++;onAudio('PCM');if(attempts===1)throw Error('Progress explanation was incomplete.');assert.equal(context.repair,true);return {text:'I will inspect the requested folder.',audio:['PCM'],generationMs:0};};
  const action=f.voice.runTool({name:'list_directory',args:{directory:'A'}});await until(()=>f.audio.playing);assert.equal(attempts,1);assert.equal(f.events.includes('execute:A'),false);f.audio.drain();
  await until(()=>attempts===2&&f.audio.playing);assert.equal(f.events.includes('execute:A'),false);f.audio.drain();await action;assert.equal(f.events.includes('execute:A'),true);assert.equal(attempts,2);
});
test('a task acknowledgment naming the first catalog read also explains that exact first tool',async t=>{
  const f=fixture(t);catalogReader(f);const contexts=[];
  f.voice.progressVoice.generate=async context=>{contexts.push(context);return {text:context.operation.subject==='Google'?'I will read Google’s original catalog page.':'I will read OpenAI’s original catalog page.',audio:['PCM'],generationMs:0};};
  f.voice.sendText(comparison);await until(()=>f.sent.length===1);f.voice.receive({toolCall:{functionCalls:[{id:'search',name:'web_search',args:{query:'latest models'}}]}});await until(()=>f.sent.length===2);
  assert.equal(contexts.length,2);assert.equal(contexts[0].stage,'task');assert.equal(contexts[1].stage,'tool');assert.equal(f.events.filter(e=>e.startsWith('read:')).length,2);
});
test('failed speech before a granted PC action returns an explicit unexecuted receipt',async t=>{
  const f=fixture(t);let executed=0;window.orvixDesktop.resumeApprovedFastAction=async()=>{executed++;return {status:'ok'};};f.voice.progressVoice.generate=async()=>{throw Error('No generated progress');};
  const receipt={name:'desktop_act',args:{action:'click'},result:{status:'confirmation_required',approvalId:'review'}};
  await f.voice.runApprovedAction({id:'review',receipt});assert.equal(executed,0);assert.equal(receipt.result.dispatched,false);assert.equal(f.voice.pendingResponses.length,1);
});
test('the generated voice connection warms once, reuses the existing model and exposes no tools',async()=>{
  let connections=0,configuration;class SDK{constructor(){this.live={connect:async input=>{connections++;configuration=input;return {close(){},sendClientContent(){}};}};}}
  global.window={orvixDesktop:{createLiveToken:async profile=>{assert.equal(profile,'Fast');return {token:'TEST_TOKEN',model:'unchanged-fast-model'};}}};
  const {FastProgressVoice:Class}=load('fastProgressVoice.ts',SDK),voice=new Class();await Promise.all([voice.prepare(),voice.prepare()]);await voice.prepare();
  assert.equal(connections,1);assert.equal(configuration.model,'unchanged-fast-model');assert.equal(configuration.config.tools,undefined);assert.match(configuration.config.systemInstruction,/fresh.*natural.*acknowledgment/);voice.close();
});
test('prepared research speech stays silent until the full utterance ends, then streams without another generation',async t=>{
  const f=fixture(t);let finish,calls=0;f.voice.audioEngine.playAudio=()=>{f.events.push('audio');f.audio.playing=true;};
  f.voice.progressVoice.generate=async(_context,_language,_signal,_timeout,onAudio,onText)=>{calls++;onText('I will research Florian BD.');onAudio('EARLY');await new Promise(resolve=>finish=resolve);onAudio('LAST');return {text:'I will research Florian BD.',audio:['EARLY','LAST'],generationMs:50};};
  f.voice.receive({serverContent:{inputTranscription:{text:'Research Florian BD and its competitors'}}});await until(()=>!!finish);
  assert.equal(f.voice.taskActive,false);assert.equal(f.events.includes('audio'),false);assert.equal(f.entries.some(e=>e.role==='assistant'),false);assert.equal(f.sent.length,0);
  f.voice.receive({serverContent:{inputTranscription:{text:' in Bangladesh.',finished:true}}});await until(()=>f.audio.playing);
  assert.equal(calls,1);assert.equal(f.sent.length,0);f.audio.drain();assert.equal(f.sent.length,0);
  finish();await until(()=>f.audio.playing);assert.equal(f.sent.length,0);f.audio.drain();await tick();assert.equal(calls,1);assert.equal(f.voice.taskAckPending,false);
  assert.ok(f.entries.some(e=>e.phase==='progress'&&e.delivery==='complete'));
});
test('a correction in the final utterance discards prepared audio and generates for the corrected request',async t=>{
  const f=fixture(t);const contexts=[];let aborts=0;
  f.voice.progressVoice.generate=async(context,_language,signal,_timeout,onAudio)=>{
    contexts.push(context);if(contexts.length===1){onAudio('OBSOLETE');return await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Error('Discarded'));}));}
    return {text:'I will research the corrected topic.',audio:['NEW'],generationMs:0};
  };
  const played=[];f.voice.audioEngine.playAudio=chunk=>played.push(chunk);
  f.voice.receive({serverContent:{inputTranscription:{text:'Research Florian BD and its competitors'}}});await until(()=>contexts.length===1);
  f.voice.receive({serverContent:{inputTranscription:{text:' actually research Daraz instead.',finished:true}}});await until(()=>contexts.length===2);await tick();
  assert.equal(aborts,1);assert.deepEqual(played,['NEW']);assert.match(contexts[1].goal,/Daraz/);
});
test('new publishers changing the planned first source invalidate the prepared explanation',async t=>{
  const f=fixture(t);const contexts=[];f.voice.progressVoice.generate=async context=>{contexts.push(context);return {text:context.operation.subject==='Google'?'I will read Google’s page.':'I will read OpenAI’s page.',audio:[context.operation.subject],generationMs:0};};
  const played=[];f.voice.audioEngine.playAudio=chunk=>played.push(chunk);
  f.voice.receive({serverContent:{inputTranscription:{text:'Research the latest GPT model'}}});await until(()=>contexts.length===1);await tick();
  f.voice.receive({serverContent:{inputTranscription:{text:' and compare with Gemini latest model.',finished:true}}});await until(()=>contexts.length===2);await tick();
  assert.equal(contexts[0].operation.subject,'OpenAI');assert.equal(contexts[1].operation.subject,'Google');assert.deepEqual(played,['Google']);
});
test('preparation leaves microphone forwarding enabled and does not repeat generation on matching partials',async t=>{
  const f=fixture(t);let generated=0;f.voice.progressVoice.generate=async()=>{generated++;return {text:'I will research Florian BD.',audio:['PCM'],generationMs:0};};
  await f.voice.enableMicrophone();f.voice.receive({serverContent:{inputTranscription:{text:'Research Florian BD and its competitors'}}});await tick();
  f.audio.capture[0]('MIC');assert.ok(f.sent.some(s=>s.type==='audio'));
  f.voice.receive({serverContent:{inputTranscription:{text:' in Bangladesh'}}});await tick();assert.equal(generated,1);assert.equal(f.events.includes('audio'),false);
});
test('Stop discards prepared speech, and late generator chunks cannot play in a restarted session',async t=>{
  const f=fixture(t);let onChunk,finish,aborts=0;f.voice.progressVoice.generate=async(_context,_language,signal,_timeout,onAudio)=>{onChunk=onAudio;signal.addEventListener('abort',()=>aborts++);await new Promise(resolve=>finish=resolve);return {text:'I will research this topic.',audio:['PCM'],generationMs:0};};
  f.voice.receive({serverContent:{inputTranscription:{text:'Research Florian BD and its competitors'}}});await until(()=>!!finish);f.voice.stop();assert.equal(aborts,1);
  f.voice.stopped=false;onChunk('LATE');finish();await tick();assert.equal(f.events.includes('audio'),false);assert.equal(f.voice.progressPreview,undefined);
});
test('failed preparation is retried with fresh generated wording after input ends',async t=>{
  const f=fixture(t);let attempts=0;f.voice.progressVoice.generate=async()=>{if(++attempts===1)throw Error('Transient failure');return {text:'I will research Florian BD.',audio:['NEW'],generationMs:0};};
  f.voice.receive({serverContent:{inputTranscription:{text:'Research Florian BD and its competitors'}}});await tick();
  f.voice.receive({serverContent:{inputTranscription:{finished:true}}});await until(()=>attempts===2);await tick();assert.equal(f.voice.progressUnavailable,false);assert.equal(f.events.filter(e=>e==='audio').length,1);
});
test('completed prepared speech cannot be reused across a new topic, language, or stale listening window',async()=>{
  const context=progressContext('task','Research Florian BD and competitors'),voice={generate:async()=>({text:'I will research Florian BD.',audio:['PCM'],generationMs:0})};
  const preview=new FastProgressPreview(voice,'Research Florian BD and competitors','en',context);await preview.result;
  assert.equal(preview.matches('Research Florian BD and competitors in Bangladesh','en',context),true);
  assert.equal(preview.matches('Research Daraz and competitors in Bangladesh','en',context),false);assert.equal(preview.matches(preview.input,'bn',context),false);
  preview.startedAt=Date.now()-13_000;assert.equal(preview.matches(preview.input,'en',context),false);preview.discard();
});
test('preparation skips greetings, ambiguous fragments, private inputs, mutations and cancelled requests',()=>{
  for(const text of ['Hello how are you today','Search','Research Florian BD but do not search','Research competitors and send an email','Research API key SUPER_SECRET and compare','Google latest models খুঁজো না','Research Florian BD नहीं'])assert.equal(canPreviewProgress(text),false,text);
  assert.equal(canPreviewProgress('ফ্লোরিয়ান বিডি সম্পর্কে গবেষণা করে তুলনা করো'),true);
});
test('a model request waits for the topic before generating instead of reconnecting on every word',async t=>{
  const f=fixture(t);let generated=0;f.voice.progressVoice.generate=async context=>{generated++;assert.equal(context.operation.subject,'Google');return {text:'I will read Google’s page.',audio:['PCM'],generationMs:0};};
  f.voice.receive({serverContent:{inputTranscription:{text:'Research the latest Google'}}});await tick();assert.equal(generated,0);
  f.voice.receive({serverContent:{inputTranscription:{text:' Gemini models'}}});await tick();assert.equal(generated,1);
});
test('Stop and a fresh warmup cannot be overwritten by an earlier pending authentication',async()=>{
  let oldAuth,requests=0;class SDK{constructor(){this.live={connect:async()=>({sendClientContent(){},close(){}})};}}
  global.window={orvixDesktop:{createLiveToken:()=>++requests===1?new Promise(resolve=>oldAuth=resolve):Promise.resolve({token:'TEST_TOKEN',model:'same-model'})}};
  const {FastProgressVoice:Class}=load('fastProgressVoice.ts',SDK),voice=new Class();const old=voice.prepare();voice.close();await voice.prepare();const current=voice.session;
  oldAuth({token:'TEST_TOKEN',model:'same-model'});await old;assert.equal(voice.session,current);assert.equal(requests,2);voice.close();
});
test('Stop rejects progress generation immediately even while authentication is pending',async()=>{
  let finishAuth;global.window={orvixDesktop:{createLiveToken:()=>new Promise(resolve=>finishAuth=resolve)}};
  const voice=new FastProgressVoice(),controller=new AbortController();const pending=voice.generate(progressContext('task','Read the catalog'),'en',controller.signal);controller.abort();
  await assert.rejects(pending,/interrupted/);assert.equal(voice.pending,undefined);finishAuth({token:'TEST_TOKEN',model:'same-model'});await tick();voice.close();
});
test('natural comparison returns the first catalog result before Gemini chooses the second read',async t=>{
  const f=fixture(t);catalogReader(f);let searches=0;window.orvixDesktop.searchWeb=async()=>{searches++;return {status:'ok'};};
  f.voice.beginTask(comparison);f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  f.voice.receive({toolCall:{functionCalls:[{id:'lookup',name:'web_search',args:{query:'latest Google and OpenAI models'}}]}});
  await until(()=>f.audio.playing);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,0);f.audio.drain();
  await until(()=>f.audio.playing);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,0);f.audio.drain();
  await until(()=>f.sent.length===1);assert.equal(searches,0);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);
  const first=f.sent[0].functionResponses[0];assert.equal(first.id,'lookup');assert.equal(first.name,'web_search');assert.equal(first.response.sourcePages.length,1);
  assert.equal(first.response.actualOperation.name,'read_web_page');assert.equal(first.response.workProgress.remainingSources.length,1);
  assert.equal(f.voice.modelResearch.verified,false);
  f.voice.receive({toolCall:{functionCalls:[{id:'second',name:'read_web_page',args:{url:first.response.workProgress.remainingSources[0]}}]}});
  await until(()=>f.audio.playing);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);f.audio.drain();
  await until(()=>f.sent.length===2);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,2);
  assert.equal(f.voice.modelResearch.verified,true);
  assert.equal(f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')&&e.details.tool==='read_web_page'&&e.details.stage==='tool').length,2);
});
test('a premature final resumes one remaining read at a time without a separate final-review turn',async t=>{
  const f=fixture(t);catalogReader(f);f.voice.beginTask(comparison);
  f.voice.receive({serverContent:{outputTranscription:{text:'GPT-99 is the latest model.'},modelTurn:{parts:[{inlineData:{data:'UNSUPPORTED',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  await until(()=>f.sent.length===1);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);
  assert.equal(f.entries.some(e=>e.phase==='final'),false);assert.match(JSON.stringify(f.sent[0]),/Actual results/);
  f.voice.receive({toolCall:{functionCalls:[{id:'second',name:'read_web_page',args:{url:f.voice.nextCatalogSource()}}]}});await until(()=>f.sent.length===2);
  f.voice.receive({serverContent:{outputTranscription:{text:'The catalogs document GPT-6.1 and Gemini 4 for their respective uses; app availability remains unknown.'},turnComplete:true}});
  await until(()=>f.entries.some(e=>e.phase==='final'&&e.delivery==='complete'));
  assert.match(f.entries.find(e=>e.phase==='final').text,/GPT-6.1/);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,2);assert.equal(f.sent.length,2);
});
test('failed catalog reads remain bounded with failure receipts and an unverified result for Gemini',async t=>{
  const f=fixture(t);catalogReader(f,true);f.voice.beginTask(comparison);
  f.voice.receive({toolCall:{functionCalls:[{id:'lookup',name:'web_search',args:{query:'latest models'}}]}});
  await until(()=>f.sent.length===1);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);
  for(let i=1;i<4;i++){
    const next=f.voice.nextCatalogSource();assert.ok(next);
    f.voice.receive({toolCall:{functionCalls:[{id:'read'+i,name:'read_web_page',args:{url:next}}]}});await until(()=>f.sent.length===i+1);
  }
  const reads=f.events.filter(e=>e.startsWith('read:'));
  assert.equal(reads.length,4);assert.notEqual(reads[0],reads[1]);assert.equal(f.voice.modelResearch.verified,false);
  await f.voice.runTool({id:'again',name:'read_web_page',args:{url:modelCatalogs.Google}});assert.equal(f.events.filter(e=>e.startsWith('read:')).length,4);
  assert.ok(f.voice.receipts.every(r=>r.result.status==='unavailable'));assert.equal(f.sent[0].functionResponses[0].response.status,'unavailable');
  assert.equal(f.sent[0].functionResponses[0].response.stepCheck.verified,false);
  f.voice.turnText='The catalog pages were unavailable.';await f.voice.report();assert.equal(f.entries.find(e=>e.phase==='final').text,f.voice.history.at(-1).text);assert.match(f.entries.find(e=>e.phase==='final').text,/catalog pages were unavailable/);
});
test('query paraphrases share a two-search budget while independent reads remain available',async t=>{
  const f=fixture(t);let searches=0;window.orvixDesktop.searchWeb=async()=>{searches++;return {status:'unavailable'};};
  for(let i=0;i<8;i++)await f.voice.runTool({id:'q'+i,name:'web_search',args:{query:'OpenAI GPT models variation '+i}});
  assert.equal(searches,2);await f.voice.runTool({id:'other',name:'web_search',args:{query:'Google Gemini models'}});assert.equal(searches,3);
  await f.voice.runTool({id:'page',name:'read_web_page',args:{url:'https://example.com/fact'}});assert.ok(f.events.includes('read:https://example.com/fact'));
});
test('publisher filtering follows the query subject in comparisons without constraining general Google research',async t=>{
  const f=fixture(t);const queries=[];window.orvixDesktop.searchWeb=async args=>{queries.push(args.query);return {status:'ok',results:[{url:'https://openai.com/fact'},{url:'https://ai.google.dev/fact'}]};};
  f.voice.taskText=comparison;const open=await f.voice.dispatch('web_search',{query:'OpenAI latest GPT models official'});await f.voice.dispatch('web_search',{query:'Google current Gemini models'});
  assert.match(queries[0],/^site:openai.com /);assert.match(queries[1],/^site:ai.google.dev /);assert.equal(open.results.length,1);
  f.voice.taskText='Research Google advertising competitors';await f.voice.dispatch('web_search',{query:'Google advertising market share'});assert.equal(queries[2],'Google advertising market share');
});
test('a failed comparison survives vague follow-ups and asks a clarification rather than inventing names',async t=>{
  const f=fixture(t);f.voice.beginTask(comparison);f.voice.beginTask('Pahle apne tattu bula, pehle.');
  assert.equal(f.voice.taskAckPending,false);assert.equal(f.voice.modelResearch.verified,false);
  const result=await f.voice.runTool({id:'guess',name:'web_search',args:{query:'latest models'}});assert.equal(result.result.status,'needs_clarification');
  f.voice.turnText='GPT-5.5 is the latest model and Gemini 3.5 Flash is newer.';await f.voice.report();
  assert.doesNotMatch(f.entries.find(e=>e.phase==='final').text,/GPT-5.5|Gemini 3.5/);assert.match(f.entries.find(e=>e.phase==='final').text,/Do you mean|কোন/);
});
test('ordinary non-reference turns deliver the model reply without a final evidence gate',async t=>{
  const f=fixture(t);f.voice.beginTask(comparison);f.voice.beginTask('bailar');f.voice.turnText='GPT-5.5 and Gemini 3.5 Flash are the latest models.';await f.voice.report();
  assert.equal(f.entries.find(e=>e.phase==='final').text,'GPT-5.5 and Gemini 3.5 Flash are the latest models.');
});
test('specific follow-ups retain actual source excerpts while unrelated conversation stays ordinary',async t=>{
  const f=fixture(t);catalogReader(f);f.voice.beginTask(comparison);
  for(const url of Object.values(modelCatalogs))await f.voice.runTool({name:'read_web_page',args:{url}});
  f.voice.beginTask('Compare the previous models for software work');assert.equal(f.voice.receipts.length,0);assert.equal(f.voice.modelResearch.verified,true);
  assert.match(f.voice.researchContext(),/GPT-6.1 Sol/);f.voice.turnText='GPT-6.1 supports coding; Gemini 4 supports enterprise engineering.';await f.voice.report();
  assert.match(f.entries.find(e=>e.phase==='final').text,/GPT-6.1/);
  f.voice.beginTask('Hello');assert.equal(f.voice.modelResearchTurn,false);assert.equal(f.voice.taskAckPending,false);assert.equal(f.voice.researchContext(),'');
  f.voice.turnText='Hello! How can I help?';await f.voice.report();assert.match(f.entries.at(-1).text,/How can I help/);
});
test('the legacy model-name matcher retains compatibility, including Bangla digits',()=>{
  assert.equal(unsupportedModelNames('GPT-5.5 and Gemini 3.5',['GPT-6.1 and Gemini 4']),true);
  assert.equal(unsupportedModelNames('জিপিটি ৬.১ এবং জেমিনি ৪',['GPT-6.1 and Gemini 4']),false);
  assert.equal(unsupportedModelNames('Gemini 4',['Gemini 4.1']),true);
});
test('final model wording and its existing PCM pass directly to delivery without a model-name gate',async t=>{
  const f=fixture(t);catalogReader(f);f.voice.beginTask(comparison);
  for(const url of Object.values(modelCatalogs))await f.voice.runTool({name:'read_web_page',args:{url}});
  f.voice.turnText='GPT-5.5 and Gemini 3.5 are the latest models';f.voice.turnAudio=['PRIMARY'];
  f.voice.narrator.render=()=>assert.fail('the direct final answer must not be rewritten or re-rendered');
  await f.voice.report();const answer=f.entries.find(e=>e.phase==='final').text;
  assert.match(answer,/^GPT-5.5 and Gemini 3.5 are the latest models/);assert.match(answer,/https:\/\/ai.google.dev/);
  f.voice.narrator.render=async()=>['PCM'];
  f.voice.beginTask('Pahle apne tattu bula, pehle.');f.voice.turnText='Earlier information';await f.voice.report();assert.doesNotMatch(f.entries.at(-1).text,/https:/);
});
test('Hindi conversational uncertainty receives no work promise',async t=>{
  const f=fixture(t);f.voice.beginTask('क्या करूं?');assert.equal(f.voice.taskAckPending,false);
});
test('rejected catalog proposals are also bounded rather than allowing an infinite model loop',async t=>{
  const f=fixture(t);f.voice.beginTask(comparison);
  for(let i=0;i<60;i++)await f.voice.runTool({id:'q'+i,name:'web_search',args:{query:'latest Google models'}});
  const over=await f.voice.runTool({id:'over',name:'web_search',args:{query:'latest Google models'}});assert.equal(over.result.status,'limit_reached');assert.equal(f.voice.budgetExhausted,true);
});
test('a speech transcript mismatch does not force the next explanation into a silent cooldown',async t=>{
  const f=fixture(t);let attempts=0;f.voice.narrator.render=async()=>{if(++attempts===1)throw Error('Speech did not match');return ['PCM'];};
  await f.voice.speak('First complete explanation','progress','read_web_page');await f.voice.speak('Second complete explanation','progress','read_web_page');
  assert.equal(attempts,2);const delivery=f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')).map(e=>e.details.delivery);assert.deepEqual(delivery,['visible_only','complete']);
});
test('missing speech transcription is logged accurately and does not suppress the next voice attempt',async t=>{
  const f=fixture(t);let attempts=0;f.voice.narrator.render=async()=>{if(++attempts===1)throw Error('Acknowledgment transcript was missing.');return ['PCM'];};
  await f.voice.speak('First explanation','progress','read_web_page');await f.voice.speak('Second explanation','progress','read_web_page');
  assert.equal(attempts,2);assert.ok(f.logs.some(e=>e.details?.reason==='missing_transcript'));
});

test('typed action selection overlaps acknowledgment but tools remain behind full playback',async t=>{
  const f=fixture(t);let render;
  f.voice.narrator.render=()=>new Promise(resolve=>render=resolve);
  f.voice.sendText('List the files on Desktop');await until(()=>!!render);
  assert.equal(f.sent.length,1);assert.ok(f.events.some(e=>e.startsWith('stage:')));
  f.voice.receive({toolCall:{functionCalls:[{id:'early',name:'list_directory',args:{directory:'A'}}]}});
  f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};render(['PCM']);await until(()=>f.audio.playing);assert.equal(f.events.includes('execute:A'),false);assert.equal(f.sent.length,1);
  render=undefined;f.audio.drain();await until(()=>!!render);render(['PCM']); // per-tool explanation is still required
  await until(()=>f.audio.playing);assert.equal(f.events.includes('execute:A'),false);f.audio.drain();await until(()=>f.sent.length===2);
  assert.equal(f.sent.filter(e=>e.type==='client').length,1);assert.ok(f.entries.some(e=>e.phase==='progress'&&/Understood/.test(e.text)));
});
test('a batch executes one action and defers later calls until Gemini receives its result',async t=>{
  const f=fixture(t);f.voice.taskActive=true;let firstResolve,started=0,max=0,active=0;
  f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  window.orvixDesktop.listDirectory=args=>{active++;max=Math.max(max,active);started++;f.events.push('execute:'+args.directory);return new Promise(resolve=>{if(started===1)firstResolve=()=>{active--;resolve({status:'ok'});};else{active--;resolve({status:'ok'});}});};
  f.voice.receive({toolCall:{functionCalls:[{id:'one',name:'list_directory',args:{directory:'A'}},{id:'two',name:'list_directory',args:{directory:'B'}}]}});
  await until(()=>f.audio.playing);assert.equal(started,0);
  f.audio.drain();await until(()=>!!firstResolve);await tick();assert.equal(started,1);
  firstResolve();await until(()=>f.sent.length===1);assert.equal(started,1);
  assert.deepEqual(f.sent[0].functionResponses.map(r=>r.id),['one','two']);
  assert.equal(f.sent[0].functionResponses[1].response.status,'deferred');assert.equal(f.sent[0].functionResponses[1].response.dispatched,false);
  assert.equal(f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')).length,1);
  f.voice.receive({toolCall:{functionCalls:[{id:'reconsidered-two',name:'list_directory',args:{directory:'B'}}]}});
  await until(()=>f.audio.playing);assert.equal(started,1);f.audio.drain();await until(()=>f.sent.length===2);assert.equal(started,2);assert.equal(max,1);
  assert.equal(f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')).length,2);
});
test('tools arriving during existing playback wait for the entire queue to drain',async t=>{
  const f=fixture(t);f.audio.playing=true;f.voice.taskActive=true;
  f.voice.receive({toolCall:{functionCalls:[{id:'one',name:'list_directory',args:{directory:'A'}}]}});await tick();
  assert.equal(f.events.some(e=>e.startsWith('execute:')),false);assert.equal(f.entries.length,0);
  f.audio.drain();await until(()=>f.sent.length===1);assert.ok(f.events.includes('execute:A'));
});
test('a report finishes before another queued user request starts',async t=>{
  const f=fixture(t);f.voice.taskActive=true;f.voice.serverBusy=true;
  f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  f.voice.receive({serverContent:{outputTranscription:{text:'Here is the completed result.'},turnComplete:true}});
  await until(()=>f.audio.playing);f.voice.sendText('List another directory');await tick();assert.equal(f.sent.length,0);
  f.audio.drain();await until(()=>f.audio.playing);assert.equal(f.sent.length,1); // preparation, no execution
  f.audio.drain();await until(()=>f.sent.length===1);
  assert.equal(f.entries.filter(e=>e.phase==='final'&&e.delivery==='complete').length,1);
});
test('microphone forwarding pauses during speech/work, without a local interruption callback',async t=>{
  const f=fixture(t);await f.voice.enableMicrophone();assert.equal(f.audio.capture.length,1);
  const capture=f.audio.capture[0];capture('idle');assert.equal(f.sent.length,1);
  for(const flag of ['taskActive','speaking','serverBusy','pumping']){f.voice[flag]=true;capture('noise');f.voice[flag]=false;}
  f.audio.playing=true;capture('echo');f.audio.drain();assert.equal(f.sent.length,1);assert.equal(f.events.includes('cancelSpeech'),false);
});
test('completed microphone transcription triggers the task acknowledgment before a tool arrives',async t=>{
  const f=fixture(t);f.voice.receive({serverContent:{inputTranscription:{text:'List my Desktop files',finished:true}}});
  await until(()=>f.entries.some(e=>e.phase==='progress'&&e.delivery==='complete'));
  assert.equal(f.voice.taskActive,true);assert.equal(f.events.some(e=>e.startsWith('execute:')),false);
});
test('provider interruption discards unplayed output without cancelling speech playback',async t=>{
  const f=fixture(t);f.voice.turnText='Unplayed text';f.audio.playing=true;
  f.voice.receive({serverContent:{interrupted:true}});await tick();assert.equal(f.audio.playing,true);assert.equal(f.voice.turnText,'');assert.equal(f.events.includes('cancelSpeech'),false);f.audio.drain();
});
test('pre-tool model narration is not played or displayed halfway',async t=>{
  const f=fixture(t);f.voice.taskActive=true;
  f.voice.receive({serverContent:{outputTranscription:{text:'I am halfway through a sentence'},modelTurn:{parts:[{inlineData:{data:'UNPLAYED',mimeType:'audio/pcm;rate=24000'}}]}}});
  assert.equal(f.events.includes('audio'),false);assert.equal(f.entries.length,0);
  f.voice.receive({toolCall:{functionCalls:[{id:'one',name:'list_directory',args:{directory:'A'}}]}});await until(()=>f.sent.length===1);
  assert.ok(f.entries.every(e=>!e.text.includes('halfway')));
});
test('IN_PROGRESS is not treated as a completed response',async t=>{
  const f=fixture(t);f.voice.taskActive=true;f.voice.serverBusy=true;
  f.voice.receive({serverContent:{outputTranscription:{text:'Draft'},turnComplete:true,interactionStatus:'IN_PROGRESS'}});await tick();assert.equal(f.entries.length,0);
  f.voice.receive({serverContent:{interactionStatus:'IDLE'}});await until(()=>f.entries.some(e=>e.phase==='final'&&e.delivery==='complete'));
});
test('an empty completed turn yields an accurate unfinished report instead of silently hanging',async t=>{
  const f=fixture(t);f.voice.taskActive=true;f.voice.serverBusy=true;
  f.voice.receive({serverContent:{turnComplete:true}});await until(()=>f.entries.some(e=>e.phase==='final'&&e.delivery==='complete'));
  assert.match(f.entries.find(e=>e.phase==='final').text,/reply did not finish/);assert.equal(f.voice.taskActive,false);
});
test('duplicate function IDs return the cached receipt with exactly one dispatch',async t=>{
  const f=fixture(t);f.voice.taskActive=true;const call={id:'same',name:'list_directory',args:{directory:'A'}};
  f.voice.receive({toolCall:{functionCalls:[call,call]}});await until(()=>f.sent.length===1);
  f.voice.receive({toolCall:{functionCalls:[call]}});await until(()=>f.sent.length===2);
  assert.equal(f.events.filter(e=>e==='execute:A').length,1);assert.deepEqual(f.sent[0].functionResponses,f.sent[1].functionResponses);
});
test('an uncertain mutation is not repeated under a new function ID',async t=>{
  const f=fixture(t);let attempts=0;f.voice.dispatch=async()=>{attempts++;return {status:'timeout',completionUnknown:true};};
  const call={id:'one',name:'browser_act',args:{action:'click',target:'observed'}};
  await f.voice.runTool(call);const again=await f.voice.runTool({...call,id:'two'});
  assert.equal(attempts,1);assert.equal(again.result.completionUnknown,true);assert.equal(again.result.status,'already_observed');
  assert.match(again.result.instruction,/uncertainty rather than replaying/);
  f.voice.turnText='The action result is uncertain.';await f.voice.report();assert.equal(f.entries.find(e=>e.phase==='final').text,'The action result is uncertain.');
});
test('stop while an explanation renders prevents the pending action',async t=>{
  const f=fixture(t);let finish;f.voice.narrator.render=()=>new Promise(resolve=>finish=resolve);
  const pending=f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});await until(()=>!!finish);f.voice.stop();finish(['PCM']);await pending;
  assert.equal(f.events.includes('execute:A'),false);assert.equal(f.events.includes('audio'),false);
});
test('provider tool cancellation lets the explanation finish but prevents an undispatched action',async t=>{
  const f=fixture(t);let finish;f.voice.narrator.render=()=>new Promise(resolve=>finish=resolve);
  const pending=f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});await until(()=>!!finish);
  f.voice.receive({toolCallCancellation:{ids:['one']}});finish(['PCM']);const result=await pending;
  assert.equal(result.result.dispatched,false);assert.equal(f.events.includes('execute:A'),false);assert.equal(f.events.includes('cancelSpeech'),false);
});
test('stop during PC task setup prevents late dispatch and cancels the obsolete task',async t=>{
  const f=fixture(t);let setup,executed=0,cancelled;
  window.orvixDesktop.updateFastTask=()=>new Promise(resolve=>setup=resolve);window.orvixDesktop.executeFast=async()=>executed++;
  window.orvixDesktop.cancelFastTask=id=>cancelled=id;
  const pending=f.voice.runTool({id:'one',name:'browser_act',args:{action:'navigate'}});await until(()=>!!setup);f.voice.stop();setup({id:'obsolete'});await pending;
  assert.equal(executed,0);assert.equal(cancelled,'obsolete');
});
test('a late result after Stop does not contaminate a restarted session',async t=>{
  const f=fixture(t);let finish;f.voice.dispatch=()=>new Promise(resolve=>finish=resolve);
  const pending=f.voice.runTool({id:'one',name:'browser_act',args:{action:'click'}});await until(()=>!!finish);f.voice.stop();f.voice.stopped=false;f.voice.lifecycle++;f.voice.receipts=[];
  finish({status:'ok',completion:'verified_step'});await pending;assert.equal(f.voice.receipts.length,0);
});
test('native speech fallback waits for onend before executing; no timeout cancels it',async t=>{
  const f=fixture(t);let utterance;global.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};t.after(()=>delete global.SpeechSynthesisUtterance);
  f.voice.narrator.render=async()=>{throw Error('Unavailable');};window.speechSynthesis.getVoices=()=>[{lang:'en-US'}];window.speechSynthesis.speak=u=>utterance=u;
  const pending=f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});await until(()=>!!utterance);await tick();assert.equal(f.events.includes('execute:A'),false);
  utterance.onend();await pending;assert.equal(f.events.includes('execute:A'),true);assert.equal(f.events.includes('cancelSpeech'),false);
});
test('native fallback allows asynchronously loaded voices to become available before giving up',async t=>{
  const f=fixture(t);let loaded=false,changed,utterance;
  global.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};t.after(()=>delete global.SpeechSynthesisUtterance);
  window.speechSynthesis.getVoices=()=>loaded?[{lang:'en-US'}]:[];
  window.speechSynthesis.addEventListener=(_,fn)=>changed=fn;window.speechSynthesis.removeEventListener=()=>{};window.speechSynthesis.speak=u=>utterance=u;
  f.voice.narrator.render=async()=>{throw Error('Unavailable');};
  const pending=f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});await until(()=>!!changed);assert.equal(f.events.includes('execute:A'),false);
  loaded=true;changed();await until(()=>!!utterance);assert.equal(f.events.includes('execute:A'),false);utterance.onend();await pending;assert.equal(f.events.includes('execute:A'),true);
});
test('missing generated and installed audio leaves the action undispatched',async t=>{
  const f=fixture(t);let renders=0;f.voice.narrator.render=async()=>{renders++;throw Error('No audio');};
  await f.voice.runTool({id:'one',name:'list_directory',args:{directory:'A'}});await f.voice.runTool({id:'two',name:'list_directory',args:{directory:'B'}});
  assert.equal(renders,2);assert.equal(f.events.filter(e=>e.startsWith('execute:')).length,0);assert.equal(f.voice.progressUnavailable,true);assert.ok(f.entries.every(e=>e.delivery==='interrupted'));assert.ok(f.logs.some(e=>e.details?.delivery==='visible_only'));
});
test('search and source reading are separate, acknowledged operations without hidden review calls',async t=>{
  const f=fixture(t);let searches=0,reads=0;
  window.orvixDesktop.searchWeb=async()=>{searches++;return {status:'ok',results:[{url:'https://example.com/fact'}]};};
  window.orvixDesktop.readSearchPage=async()=>{reads++;return {status:'ok',source:'direct_page',url:'https://example.com/fact',content:'Fact page'};};
  window.orvixDesktop.reviewFastCompletion=()=>assert.fail('legacy review must not be called');
  await f.voice.runTool({id:'search',name:'web_search',args:{query:'pollination'}});assert.equal(searches,1);assert.equal(reads,0);
  await f.voice.runTool({id:'read',name:'read_web_page',args:{url:'https://example.com/fact'}});assert.equal(reads,1);assert.equal(f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')).length,2);
});
test('a final answer is not replaced when only one publisher page was read',async t=>{
  const f=fixture(t);f.voice.taskText='Compare latest Google Gemini and OpenAI GPT models';
  await f.voice.runTool({id:'google',name:'read_web_page',args:{url:'https://ai.google.dev/gemini-api/docs/models'}});
  f.voice.turnText='Here is the model comparison.';await f.voice.report();assert.match(f.entries.find(e=>e.phase==='final').text,/^Here is the model comparison\./);
});
test('explicit source requests still tell Gemini which page remains without a final-answer gate',async t=>{
  const f=fixture(t);f.voice.taskText='Read https://example.com/one and https://example.com/two';
  const receipt=await f.voice.runTool({id:'one',name:'read_web_page',args:{url:'https://example.com/one'}});
  assert.deepEqual(receipt.result.remainingRequestedSources,['https://example.com/two']);
  f.voice.turnText='Only the first page was available.';await f.voice.report();assert.match(f.entries.find(e=>e.phase==='final').text,/^Only the first page was available\./);assert.doesNotMatch(f.entries.find(e=>e.phase==='final').text,/https:\/\/example.com\/two/);
});
test('a Bangla request to reread the previous sources carries both URLs into the next turn',async t=>{
  const f=fixture(t);f.voice.lastSourceUrls=['https://example.com/one','https://example.com/two'];
  f.voice.sendText('আগের দুটি পৃষ্ঠা আবার পড়ে দেখো');await until(()=>f.sent.length===1);
  assert.deepEqual(f.voice.requestedSources,f.voice.lastSourceUrls);assert.match(JSON.stringify(f.sent[0]),/fresh reads of ALL/);
});
test('final replies following a search are delivered directly without a source-read gate',async t=>{
  const f=fixture(t);await f.voice.runTool({id:'one',name:'web_search',args:{query:'fact'}});f.voice.turnText='This unverified claim is true';await f.voice.report();
  assert.equal(f.entries.find(e=>e.phase==='final').text,'This unverified claim is true');
});
test('failed lookup receipts stay unverified while the final model reply is delivered directly',async t=>{
  const f=fixture(t);f.voice.dispatch=async()=>({status:'unavailable'});
  const receipt=await f.voice.runTool({id:'weather',name:'get_weather',args:{city:'Dhaka'}});assert.equal(receipt.result.status,'unavailable');assert.equal(receipt.result.stepCheck.verified,false);
  f.voice.turnText='The current temperature is 26 degrees.';await f.voice.report();assert.equal(f.entries.find(e=>e.phase==='final').text,'The current temperature is 26 degrees.');
});
test('appending written source URLs preserves primary final audio without rendering again',async t=>{
  const f=fixture(t);f.voice.receipts=[{name:'read_web_page',args:{url:'https://example.com/fact'},result:{status:'ok',source:'direct_page',url:'https://example.com/fact'}}];
  f.voice.turnText='Here is the supported finding. https://example.com/fact';f.voice.turnAudio=['PRIMARY'];
  f.voice.narrator.render=()=>assert.fail('matching primary speech should be used');await f.voice.report();
  assert.equal(f.events.filter(e=>e==='audio').length,1);assert.match(f.entries.find(e=>e.phase==='final').text,/https:\/\/example.com\/fact/);
});
test('three failed attempts block only the same operation; independent reads remain possible',async t=>{
  const f=fixture(t);let attempts=0;f.voice.dispatch=async(_,args)=>{attempts++;return {status:args.directory==='A'?'failed':'ok'};};
  for(let i=0;i<3;i++)await f.voice.runTool({id:'a'+i,name:'list_directory',args:{directory:'A'}});
  const blocked=await f.voice.runTool({id:'four',name:'list_directory',args:{directory:'A'}});assert.equal(blocked.result.status,'blocked');
  await f.voice.runTool({id:'b',name:'list_directory',args:{directory:'B'}});assert.equal(attempts,4);
});
test('budget exhaustion stops dispatch and reports an incomplete task',async t=>{
  const f=fixture(t);f.voice.taskActive=true;f.voice.receipts=Array.from({length:60},()=>({name:'list_directory',args:{},result:{status:'ok'}}));
  f.voice.receive({toolCall:{functionCalls:[{id:'over',name:'list_directory',args:{directory:'A'}},{id:'over2',name:'list_directory',args:{directory:'B'}}]}});
  await until(()=>f.entries.some(e=>e.phase==='final'&&e.delivery==='complete'));assert.equal(f.events.some(e=>e.startsWith('execute:')),false);assert.match(f.entries.find(e=>e.phase==='final').text,/limit.*60.*incomplete/);
});
test('send failures retain results and reconnect once instead of spinning or executing again',async t=>{
  const f=fixture(t);f.voice.taskActive=true;let recovery=0;f.voice.recoverConnection=async()=>{recovery++;};f.voice.session.sendToolResponse=()=>{throw Error('closed');};
  f.voice.receive({toolCall:{functionCalls:[{id:'one',name:'list_directory',args:{directory:'A'}}]}});await until(()=>recovery===1);
  assert.equal(f.voice.pendingResponses.length,1);assert.equal(f.voice.session,null);await tick();assert.equal(recovery,1);assert.equal(f.events.filter(e=>e==='execute:A').length,1);
});
test('terminal disconnection waits for speech and restores ordinary approval handling',async t=>{
  const f=fixture(t);let queueMode;
  window.orvixDesktop.setFastApprovalQueue=async enabled=>queueMode=enabled;
  f.voice.taskActive=true;f.audio.playing=true;const pending=f.voice.endConnection();await tick();assert.equal(f.voice.stopped,false);
  f.audio.drain();await pending;assert.equal(f.voice.stopped,true);assert.equal(queueMode,false);
  assert.ok(f.entries.some(e=>e.phase==='final'&&e.delivery==='interrupted'&&/not confirmed complete/.test(e.text)));
});
test('pending approval remains uncompleted; approved results enter the same queue after speech',async t=>{
  const f=fixture(t);f.voice.taskId='pc';f.voice.dispatch=async()=>({status:'confirmation_required'});
  const pending=await f.voice.runTool({id:'one',name:'browser_act',args:{action:'click'}});assert.equal(pending.result.stepCheck.approval,true);assert.equal(pending.result.stepCheck.verified,false);
  f.voice.turnText='The action needs approval.';await f.voice.report();assert.equal(f.entries.find(e=>e.phase==='final').text,'The action needs approval.');
  f.audio.playing=true;f.voice.onWorkEvent({type:'result',taskId:'pc',action:'browser_act',result:{status:'ok',completion:'verified_step'}});await tick();assert.equal(f.sent.length,0);
  f.audio.drain();await until(()=>f.sent.length===1);assert.equal(f.sent[0].type,'client');assert.match(JSON.stringify(f.sent[0]),/approved_action_result/);
});
test('connection config disables automatic interruption and exposes nonblocking window management only',async t=>{
  let config;
  class SDK{constructor(){this.live={connect:async input=>{config=input.config;return {sendClientContent(){},close(){}};}};}}
  const {SimpleFastVoiceSession:Class}=load('simpleFastVoice.ts',SDK);const f=fixture(t,Class);f.voice.stopped=true;f.voice.session=null;await f.voice.start(false);
  assert.equal(config.realtimeInputConfig.activityHandling,'NO_INTERRUPTION');const declarations=config.tools[0].functionDeclarations;
  assert.ok(declarations.every(d=>d.behavior===(d.name==='manage_window'?'NON_BLOCKING':'BLOCKING')));
  for(const name of ['plan_task','review_task','work_browser','run_workflow'])assert.ok(!declarations.some(d=>d.name===name));
});
test('Stop followed by Start during authentication cannot leave the new session silently disconnected',async t=>{
  let connections=0;class SDK{constructor(){this.live={connect:async()=>{connections++;return {sendClientContent(){},close(){}};}};}}
  const {SimpleFastVoiceSession:Class}=load('simpleFastVoice.ts',SDK);const f=fixture(t,Class);f.voice.stopped=true;f.voice.session=null;let firstAuth,calls=0;
  window.orvixDesktop.createLiveToken=()=>++calls===1?new Promise(resolve=>firstAuth=resolve):Promise.resolve({token:'TEST',model:'fixture'});
  const first=f.voice.start(false);await until(()=>!!firstAuth);f.voice.stop();const second=f.voice.start(false);
  firstAuth({token:'STALE_TEST',model:'fixture'});await Promise.all([first,second]);
  assert.equal(f.voice.stopped,false);assert.ok(f.voice.session);assert.equal(connections,1);assert.equal(calls,2);
});
test('simple PC mode executes a compound request without requiring a model plan, retaining approval checks',async()=>{
  const {createFastWork}=require('../electron/fast-work.cjs');let calls=0;
  const work=createFastWork({browser:{act:async()=>{calls++;return {status:'ok',verification:{verified:true}};},cancel(){}},desktop:{cancel(){}}});
  const task=work.update({text:'Search Google then open a second page and compare them',replace:true,executionMode:'simple'});
  const result=await work.execute(task.id,'browser_act',{action:'navigate',args:{url:'https://example.com'}});assert.equal(result.status,'ok');assert.equal(calls,1);
  const approval=await work.execute(task.id,'browser_act',{action:'history_delete'});assert.equal(approval.status,'confirmation_required');assert.equal(calls,1);work.cancel(task.id);
});
test('checks distinguish a verified action, uncertain effect, and approval',()=>{
  assert.equal(simpleFastCheck('browser_act',{status:'ok'}).stepCheck.verified,false);
  assert.equal(simpleFastCheck('browser_act',{status:'ok',completion:'verified_step'}).stepCheck.verified,true);
  assert.equal(simpleFastCheck('browser_act',{status:'partial'}).stepCheck.uncertain,true);
  assert.equal(simpleFastCheck('browser_act',{status:'confirmation_required'}).stepCheck.approval,true);
  assert.equal(simpleFastCheck('write_file',{status:'ok',action:'created',path:'test.txt',bytes:4}).stepCheck.verified,true);
  assert.equal(simpleFastCheck('write_file',{status:'write_failed'}).stepCheck.verified,false);
});
test('clipboard reads remain fresh independent reads, rather than cached mutations',async t=>{
  const f=fixture(t);let reads=0;window.orvixDesktop.manageClipboard=async()=>({status:'ok',action:'read',text:String(++reads)});
  const first=await f.voice.runTool({id:'first',name:'manage_clipboard',args:{action:'read'}});
  const second=await f.voice.runTool({id:'second',name:'manage_clipboard',args:{action:'read'}});
  assert.equal(reads,2);assert.equal(first.result.stepCheck.verified,true);assert.equal(second.result.text,'2');
});
test('approval results resolve the exact pending action without verifying a different one',async t=>{
  const f=fixture(t);f.voice.taskId='pc';f.voice.serverBusy=true;
  const a={name:'browser_act',args:{action:'click'},result:simpleFastCheck('browser_act',{status:'confirmation_required',approvalId:'a'})};
  const b={name:'browser_act',args:{action:'click'},result:simpleFastCheck('browser_act',{status:'confirmation_required',approvalId:'b'})};f.voice.receipts=[a,b];
  f.voice.onWorkEvent({type:'result',taskId:'pc',approvalId:'b',action:'click',result:{status:'ok'}});
  assert.equal(a.result.stepCheck.approval,true);assert.equal(b.result.stepCheck.approval,false);assert.equal(b.result.stepCheck.verified,false);
});
test('accepted PC actions join the voice queue and wait for their complete explanation',async t=>{
  const f=fixture(t);let resumed=0;f.voice.taskId='pc';f.voice.taskActive=false;
  f.voice.receipts=[{name:'browser_act',args:{action:'click'},result:simpleFastCheck('browser_act',{status:'confirmation_required',approvalId:'approved'})}];
  window.orvixDesktop.resumeApprovedFastAction=async()=>{resumed++;return {status:'ok',completion:'verified_step'};};
  f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};f.audio.playing=true;
  f.voice.onWorkEvent({type:'approval_closed',taskId:'pc',approvalId:'approved',accepted:true});await tick();assert.equal(resumed,0);
  f.audio.drain();await until(()=>f.audio.playing);assert.equal(resumed,0);f.audio.drain();await until(()=>f.sent.length===1);
  assert.equal(resumed,1);assert.equal(f.voice.receipts[0].result.stepCheck.verified,true);
});
test('native approval IPC defers execution only for the active simple queue',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),text=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
  const code=text.slice(text.indexOf('let simpleFastApprovalQueue = false;'),text.indexOf('\nlet pcMonitorProcess'));
  const handlers=new Map();let executions=0,accepted=false;
  vm.runInNewContext(code,{ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},requireMainWindow(){},fastWork:{decide:(_,yes)=>{accepted=yes;return true;},resumeApproval:()=>{assert.equal(accepted,true);executions++;return {status:'ok'};}}});
  await handlers.get('orvix:fast-approval-queue')({},true);await handlers.get('orvix:fast-approve')({},'id',true);assert.equal(executions,0);
  await handlers.get('orvix:fast-resume-approved')({},'id');assert.equal(executions,1);
  await handlers.get('orvix:fast-approval-queue')({},false);await handlers.get('orvix:fast-approve')({},'second',true);assert.equal(executions,2);
});
test('PC explanations name the actual operation without exposing entered secrets',()=>{
  assert.match(simpleFastAcknowledgment('manage_window',{action:'minimize'},'en'),/minimizing/);
  assert.match(simpleFastAcknowledgment('browser_act',{action:'key',args:{key:'Enter'}},'en'),/pressing Enter/);
  assert.match(simpleFastAcknowledgment('browser_act',{action:'navigate'},'bn'),/ওয়েব ঠিকানা/);
  assert.doesNotMatch(simpleFastAcknowledgment('browser_act',{action:'type',args:{text:'SECRET123'}},'en'),/SECRET123/);
});

test('known first reads start after the opening explanation without an initial main-model draft',async t=>{
  const f=fixture(t);catalogReader(f);f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  f.voice.progressVoice.generate=async()=>({text:'I will read Google’s original page.',audio:['PCM'],generationMs:0});
  f.voice.sendText('Research Google latest Gemini models');await until(()=>f.audio.playing);
  assert.equal(f.sent.length,0);assert.equal(f.events.some(e=>e.startsWith('read:')),false);
  f.audio.drain();await until(()=>f.sent.length===1);
  assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);assert.match(JSON.stringify(f.sent[0]),/Actual results/);
  assert.equal(f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')).length,1);
  assert.equal(f.events.filter(e=>e==='stage:Check').length,1);
});

test('Bangla current-model work chooses the known first part without an extra search',async t=>{
  const f=fixture(t);f.voice.beginTask('গুগল আর ওপেনএআই-এর বর্তমান API মডেলের তথ্য পড়ে তুলনা করো।');
  assert.deepEqual(f.voice.catalogSources,[modelCatalogs.Google,modelCatalogs.OpenAI]);assert.equal(f.voice.nextCatalogSource(),modelCatalogs.Google);
});

test('exhausted source retries remain visible as obstacles rather than instructions to repeat them',async t=>{
  const f=fixture(t);catalogReader(f,true);f.voice.beginTask(comparison);
  for(const url of Object.values(modelCatalogs))for(let i=0;i<2;i++)await f.voice.runTool({name:'read_web_page',args:{url}});
  const progress=f.voice.workProgress();assert.equal(progress.remainingSources.length,2);assert.equal(progress.blockedSources.length,2);
  assert.match(f.voice.receipts.at(-1).result.instruction,/retry limit/);assert.equal(f.voice.nextCatalogSource(),undefined);
});

test('a multistep task keeps the original goal and actual results across dependent calls',async t=>{
  const f=fixture(t);const goal='Find the report file, read its content, then save a summary.';
  window.orvixDesktop.listDirectory=async()=>({status:'ok',entries:[{name:'report.txt',path:'C:/reports/report.txt'}]});
  window.orvixDesktop.readFile=async args=>{assert.equal(args.path,'C:/reports/report.txt');return {status:'ok',text:'Sales increased by 12 percent.'};};
  window.orvixDesktop.writeFile=async args=>{assert.match(args.content,/12 percent/);return {status:'ok',path:args.path,bytes:25,action:'created'};};
  f.voice.beginTask(goal);
  const calls=[{id:'find',name:'list_directory',args:{directory:'C:/reports'}},{id:'read',name:'read_file',args:{path:'C:/reports/report.txt'}},{id:'save',name:'write_file',args:{path:'C:/reports/summary.txt',content:'Sales grew by 12 percent.'}}];
  for(let i=0;i<calls.length;i++){
    f.voice.receive({toolCall:{functionCalls:[calls[i]]}});await until(()=>f.sent.length===i+1);
    const progress=f.sent[i].functionResponses[0].response.workProgress;
    assert.equal(progress.goal,goal);assert.equal(progress.steps.length,i+1);assert.ok(progress.steps.every(s=>s.outcome==='completed_step'));
    assert.equal(f.events.filter(e=>e==='stage:Check').length,i+1);
  }
  f.voice.receive({serverContent:{outputTranscription:{text:'I saved the summary with the reported 12 percent increase.'},turnComplete:true}});
  await until(()=>f.entries.some(e=>e.phase==='final'&&e.delivery==='complete'));
  assert.equal(f.sent.length,3);assert.equal(f.voice.receipts.length,3);
});

test('a failing step returns its obstacle before an independently chosen alternative runs',async t=>{
  const f=fixture(t);const contexts=[];window.orvixDesktop.searchWeb=async()=>({status:'unavailable',message:'Search provider unavailable'});
  f.voice.progressVoice.generate=async context=>{contexts.push(context);return {text:'I will inspect the next source.',audio:['PCM'],generationMs:0};};
  f.voice.beginTask('Research Florian BD from its website and compare its delivery options.');
  f.voice.receive({toolCall:{functionCalls:[{id:'search',name:'web_search',args:{query:'Florian BD delivery'}}]}});await until(()=>f.sent.length===1);
  const failed=f.sent[0].functionResponses[0].response;assert.equal(failed.stepCheck.verified,false);assert.match(failed.instruction,/alternative|obstacle/);assert.doesNotMatch(failed.instruction,/search leads only/);
  assert.equal(f.events.some(e=>e.startsWith('read:')),false);
  f.voice.receive({toolCall:{functionCalls:[{id:'alternative',name:'read_web_page',args:{url:'https://florianbd.com'}}]}});await until(()=>f.sent.length===2);
  assert.equal(contexts.at(-1).previous.status,'unavailable');assert.equal(contexts.at(-1).previous.verified,false);
  assert.deepEqual(f.sent[1].functionResponses[0].response.workProgress.steps.map(s=>s.outcome),['unfinished_step','completed_step']);
});

test('an uncertain effect defers its dependent batch action and is observed without replay',async t=>{
  const f=fixture(t);let mutations=0,observations=0;
  f.voice.dispatch=async(name)=>name==='browser_act'?(mutations++,{status:'timeout',completionUnknown:true}):(observations++,{status:'ok',page:{title:'Already submitted'}});
  f.voice.beginTask('Submit the search, then read the resulting page.');
  f.voice.receive({toolCall:{functionCalls:[{id:'submit',name:'browser_act',args:{action:'key',key:'Enter'}},{id:'stale-next',name:'browser_act',args:{action:'click'}}]}});
  await until(()=>f.sent.length===1);assert.equal(mutations,1);assert.equal(f.sent[0].functionResponses[1].response.dispatched,false);
  assert.equal(f.sent[0].functionResponses[0].response.workProgress.steps[0].outcome,'uncertain');
  f.voice.receive({toolCall:{functionCalls:[{id:'observe',name:'browser_observe',args:{}}]}});await until(()=>f.sent.length===2);
  assert.equal(observations,1);assert.equal(mutations,1);
  const context=progressContext('tool',f.voice.taskText,'browser_observe',{},f.voice.receipts[0]);assert.equal(context.previous.uncertain,true);assert.equal(context.previous.approval,false);
});

test('extra proposals arriving during execution are deferred rather than using an unseen result',async t=>{
  const f=fixture(t);let finish,executions=0;
  window.orvixDesktop.listDirectory=async()=>{executions++;await new Promise(resolve=>finish=resolve);return {status:'ok',entries:[]};};
  f.voice.taskActive=true;f.voice.receive({toolCall:{functionCalls:[{id:'first',name:'list_directory',args:{directory:'A'}}]}});await until(()=>!!finish);
  f.voice.receive({toolCall:{functionCalls:[{id:'late',name:'list_directory',args:{directory:'B'}}]}});finish();await until(()=>f.sent.length===1);
  assert.equal(executions,1);assert.equal(f.sent[0].functionResponses[1].id,'late');assert.equal(f.sent[0].functionResponses[1].response.status,'deferred');
});

test('cached and deferred IDs are not dispatched on provider redelivery',async t=>{
  const f=fixture(t);f.voice.taskActive=true;
  const calls=[{id:'one',name:'list_directory',args:{directory:'A'}},{id:'two',name:'list_directory',args:{directory:'B'}}];
  f.voice.receive({toolCall:{functionCalls:calls}});await until(()=>f.sent.length===1);
  f.voice.receive({toolCall:{functionCalls:calls}});await until(()=>f.sent.length===2);
  assert.equal(f.events.filter(e=>e.startsWith('execute:')).length,1);assert.equal(f.sent[1].functionResponses[1].response.dispatched,false);
  assert.equal(f.voice.workProgress().steps.length,1);
});

test('work progress is retained through reconnection without a second verification or mutation',async t=>{
  const f=fixture(t);f.voice.beginTask('Read a source then write a report.');
  const receipt=await f.voice.runTool({id:'read',name:'read_web_page',args:{url:'https://example.com'}});
  f.voice.pendingResponses.push(receipt);f.voice.session.sendToolResponse=()=>{throw Error('Disconnected');};
  f.voice.connect=async()=>{f.voice.restoredWithoutHandle=true;f.voice.session={sendClientContent:x=>f.sent.push(x),close(){}};f.voice.kick();};
  f.voice.submitResults();await until(()=>f.sent.length===1);
  assert.match(JSON.stringify(f.sent[0]),/Read a source then write a report/);assert.match(JSON.stringify(f.sent[0]),/completed_step/);
  assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);assert.equal(f.events.filter(e=>e==='stage:Check').length,1);
});

test('progress separates approval and unknown effects from verified steps',()=>{
  const receipts=[
    {name:'desktop_act',args:{},result:simpleFastCheck('desktop_act',{status:'confirmation_required'})},
    {name:'browser_act',args:{},result:simpleFastCheck('browser_act',{status:'timeout'})},
    {name:'read_file',args:{},result:simpleFastCheck('read_file',{status:'ok'})},
  ];
  const progress=simpleFastWorkProgress('Do three requested parts',receipts,[]);
  assert.deepEqual(progress.steps.map(s=>s.outcome),['awaiting_approval','uncertain','completed_step']);
  assert.equal(progress.goal,'Do three requested parts');assert.match(progress.instruction,/not completion of the whole goal/);
  const context=progressContext('tool','Inspect the screen','desktop_observe',{},receipts[0]);assert.equal(context.previous.approval,true);assert.equal(context.previous.uncertain,false);
});

test('explicit URL reading uses the opening explanation once for the exact operation',async t=>{
  const f=fixture(t),contexts=[];
  f.voice.progressVoice.generate=async context=>{contexts.push(context);return {text:'I am reading example.com’s page.',audio:['PCM'],generationMs:0};};
  f.voice.sendText('Read https://example.com/facts and report its contents.');
  await until(()=>f.sent.length===1);
  assert.equal(contexts.length,1);assert.equal(contexts[0].operation.subject,'example.com');
  assert.equal(f.events.filter(e=>e==='read:https://example.com/facts').length,1);
  assert.match(JSON.stringify(f.sent[0]),/Actual results/);
});

test('changed page arguments require a fresh explanation even with an identical URL',async t=>{
  const f=fixture(t),contexts=[];f.voice.beginTask('Read https://ai.google.dev/gemini-api/docs/models');
  f.voice.progressVoice.generate=async context=>{contexts.push(context);return {text:'I am reading Google’s model page.',audio:['PCM'],generationMs:0};};
  await f.voice.acknowledgeTask();
  await f.voice.runTool({name:'read_web_page',args:{url:modelCatalogs.Google,query:'pricing'}});
  assert.equal(contexts.length,2);assert.equal(contexts[1].stage,'tool');
});

test('operation key canonicalizes argument order but never logs private query values',async t=>{
  const f=fixture(t);f.voice.beginTask('Read https://ai.google.dev/gemini-api/docs/models');
  f.voice.progressVoice.generate=async()=>({text:'I am reading Google’s model page.',audio:['PCM'],generationMs:0});
  f.voice.firstOperation={name:'read_web_page',args:{query:'PRIVATE_TOKEN',url:modelCatalogs.Google}};
  await f.voice.acknowledgeTask();const generate=f.voice.progressVoice.generate;
  f.voice.progressVoice.generate=()=>assert.fail('same arguments reordered need no second explanation');
  await f.voice.runTool({name:'read_web_page',args:{url:modelCatalogs.Google,query:'PRIVATE_TOKEN'}});
  f.voice.progressVoice.generate=generate;assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE_TOKEN/);
});

test('known read selection rejects negation, hypothetical questions and unfinished requests',()=>{
  for(const text of ['Do not read https://example.com','Should I read https://example.com?','Read https://example.com and','Maybe compare latest Google models','Google latest model or OpenAI latest model?'])assert.equal(knownFirstRead(text,['Google']),undefined,text);
  assert.deepEqual(knownFirstRead('Please read https://example.com/fact.',[]),{name:'read_web_page',args:{url:'https://example.com/fact'}});
  assert.equal(knownFirstRead('Cite https://example.com but answer from memory.',[]),undefined);
  assert.equal(knownFirstRead('Read https://example.com/data?filter=or.',[]).args.url,'https://example.com/data?filter=or');
});

test('main answer buffered during preparation is delivered only after acknowledgment drain',async t=>{
  const f=fixture(t);let finish;
  f.voice.progressVoice.generate=async(_c,_l,_s,_d,a)=>{a('ACK');await new Promise(r=>finish=r);return {text:'I will inspect the workspace.',audio:['ACK'],generationMs:0};};
  f.voice.audioEngine.playAudio=()=>{f.audio.playing=true;};
  f.voice.sendText('List the workspace files');await until(()=>!!finish);
  f.voice.receive({serverContent:{outputTranscription:{text:'Here is the answer.'},turnComplete:true}});await tick();
  assert.equal(f.entries.some(e=>e.phase==='final'),false);finish();await tick();assert.equal(f.entries.some(e=>e.phase==='final'),false);
  f.audio.drain();await until(()=>f.entries.some(e=>e.phase==='final'));assert.equal(f.sent.filter(e=>e.type==='client').length,1);
});

test('Stop during concurrent selection discards buffered proposals and late speech',async t=>{
  const f=fixture(t);let finish;
  f.voice.progressVoice.generate=async(_c,_l,_s,_d,a)=>{await new Promise(r=>finish=r);a('LATE');return {text:'I will inspect the workspace.',audio:['LATE'],generationMs:0};};
  f.voice.sendText('List the workspace files');await until(()=>!!finish);
  f.voice.receive({toolCall:{functionCalls:[{id:'old',name:'list_directory',args:{directory:'A'}}]}});
  f.voice.stop();finish();await tick();await tick();assert.equal(f.events.includes('execute:A'),false);assert.equal(f.events.includes('audio'),false);
});

test('completed voice input is never resent while main proposals are being generated',async t=>{
  const f=fixture(t);
  f.voice.receive({serverContent:{inputTranscription:{text:'List the workspace files',finished:true}}});
  await until(()=>f.logs.some(e=>e.message.endsWith('Acknowledgment finished')));
  assert.equal(f.sent.length,0);assert.equal(f.voice.requestSubmitted,true);
  f.voice.receive({toolCall:{functionCalls:[{id:'voice',name:'list_directory',args:{directory:'A'}}]}});await until(()=>f.sent.length===1);
  assert.equal(f.sent[0].type,'tool');assert.equal(f.events.filter(e=>e==='execute:A').length,1);
});

test('retained-information followup skips work speech but later actions still get explanations',async t=>{
  const f=fixture(t);f.voice.history.push({role:'assistant',text:'We read both pages.',delivery:'complete'});
  f.voice.sendText('আগের পড়া একই তথ্য থেকে বাংলায় দুই বাক্যে তুলনাটি বলো। নতুন তথ্য বা নতুন খোঁজ লাগবে না।');
  await until(()=>f.sent.length===1);assert.equal(f.voice.taskAckPending,false);assert.equal(f.entries.some(e=>e.phase==='progress'),false);assert.equal(f.voice.language,'bn');
  f.voice.receive({toolCall:{functionCalls:[{id:'unexpected',name:'list_directory',args:{directory:'A'}}]}});await until(()=>f.sent.length===2);
  assert.equal(f.logs.filter(e=>e.message.endsWith('Acknowledgment finished')).length,1);
});

test('no retained answer and fresh retrieval instructions cannot skip the opening explanation',async t=>{
  const f=fixture(t);const old='Compare previous information without new research.';
  assert.equal(retainedInformationFollowup(old),true);f.voice.beginTask(old);assert.equal(f.voice.taskAckPending,true);
  f.voice.history.push({role:'assistant',text:'Read evidence.',delivery:'complete'});
  f.voice.beginTask('Reread previous pages and compare without new research.');assert.equal(f.voice.taskAckPending,true);
});

test('explicit language directives honor intervening style and length words',()=>{
  assert.equal(conversationLanguage('বাংলায় দুই বাক্যে তুলনাটি বলো।','en'),'bn');
  assert.equal(conversationLanguage('ইংরেজিতে সংক্ষেপে উত্তর দাও।','bn'),'en');
  assert.equal(conversationLanguage('Reply briefly in English.','bn'),'en');
  assert.equal(conversationLanguage('Reply in English. তারপর বাংলায় দুই বাক্যে বলো।','en'),'bn');
  assert.equal(conversationLanguage('Tell me about English literature.','bn'),'bn');
  assert.equal(conversationLanguage('Do not reply in English.','bn'),'bn');
  assert.equal(conversationLanguage('বাংলায় বলো না।','en'),'en');
});

test('prepared speech is discarded when URL parameters change within the same publisher',async t=>{
  const f=fixture(t);const text='Please read https://example.com/data?version=one';
  const context=progressContext('task',text,'read_web_page',{url:'https://example.com/data?version=one'});
  const preview=new FastProgressPreview(f.voice.progressVoice,text,'en',context,'operation-one');await preview.result;
  assert.equal(preview.matches(text,'en',context,'operation-two'),false);preview.discard();
});

test('cold progress preparation is shared and readiness resets after connection loss',async t=>{
  let connections=0,config,finish;class SDK{live={connect:async value=>{connections++;config=value;await new Promise(r=>finish=r);return {close(){}};}};}
  const {FastProgressVoice:Voice}=load('fastProgressVoice.ts',SDK);fixture(t);const voice=new Voice();t.after(()=>voice.close());
  let losses=0;voice.onConnectionLost=()=>losses++;
  assert.equal(voice.readiness,'disconnected');const a=voice.prepare(),b=voice.prepare();await until(()=>!!finish);assert.equal(voice.readiness,'preparing');finish();await Promise.all([a,b]);
  assert.equal(connections,1);assert.equal(voice.readiness,'ready');config.callbacks.onclose();config.callbacks.onerror();assert.equal(losses,1);assert.equal(voice.readiness,'disconnected');
});

test('idle acknowledgment warmup retries once, while Stop and active tasks prevent reconnects',async t=>{
  const f=fixture(t);let preparations=0;f.voice.progressVoice.prepare=async()=>{preparations++;};
  f.voice.warmProgressAfterLoss();f.voice.warmProgressAfterLoss();await tick();assert.equal(preparations,1);
  f.voice.progressWarmupRetried=false;f.voice.taskActive=true;f.voice.warmProgressAfterLoss();assert.equal(preparations,1);
  f.voice.taskActive=false;f.voice.stop();f.voice.warmProgressAfterLoss();assert.equal(preparations,1);
});

test('compact operation prompt omits the full task and preserves exact subject and language',async()=>{
  const voice=new FastProgressVoice(),sent=[];voice.session={sendClientContent:value=>sent.push(value),close(){}};
  const task='Read Google then OpenAI then compare pricing then write a lengthy report';
  const result=voice.generate(progressContext('task',task,'read_web_page',{url:modelCatalogs.Google}),'bn',new AbortController().signal);await tick();
  const prompt=JSON.parse(sent[0].turns[0].parts[0].text);assert.equal(prompt.goal,undefined);assert.equal(prompt.operation.subject,'Google');assert.match(prompt.language,/Bangla/);
  voice.receive({serverContent:{outputTranscription:{text:'গুগলের মডেল পৃষ্ঠাটি পড়ছি।'},modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});await result;voice.close();
});

test('overlong complete speech finishes and is logged rather than cut to enforce length',async t=>{
  const f=fixture(t),sentence='I will read the requested publisher page and carefully inspect all its available documentation before moving to the next action in this task.';
  assert.equal(validProgress(sentence),true);f.voice.progressVoice.generate=async()=>({text:sentence,audio:['PCM'],generationMs:0});
  await f.voice.runTool({name:'list_directory',args:{directory:'A'}});assert.ok(f.logs.some(e=>e.message.endsWith('Acknowledgment exceeded preferred length')));assert.equal(f.events.includes('execute:A'),true);
});

test('provider startup timeout rejects without playing late chunks or dispatching a tool',async()=>{
  const voice=new FastProgressVoice();let closed=0;voice.session={sendClientContent(){},close(){closed++;}};
  const audio=[];await assert.rejects(voice.generate(progressContext('task','Inspect workspace files'),'en',new AbortController().signal,15,c=>audio.push(c)),/timed out/);
  voice.receive({serverContent:{modelTurn:{parts:[{inlineData:{data:'LATE',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  assert.equal(closed,1);assert.deepEqual(audio,[]);assert.equal(voice.readiness,'disconnected');
});

test('PC registration overlaps speech but Stop cancels its late task without execution',async t=>{
  const f=fixture(t);let register,finish;const cancelled=[];
  window.orvixDesktop.updateFastTask=()=>new Promise(r=>register=r);window.orvixDesktop.cancelFastTask=id=>cancelled.push(id);window.orvixDesktop.executeFast=()=>assert.fail('registration is not action execution');
  f.voice.progressVoice.generate=()=>new Promise(r=>finish=r);
  const action=f.voice.runTool({name:'desktop_observe',args:{scope:'screen'}});await until(()=>!!register&&!!finish);
  f.voice.stop();register({id:'late-task'});finish({text:'I will inspect the screen.',audio:['LATE'],generationMs:0});await action;
  assert.deepEqual(cancelled,['late-task']);assert.equal(f.events.includes('audio'),false);
});

test('a finished microphone URL request performs its selected read without resending the utterance',async t=>{
  const f=fixture(t);let generated=0;
  f.voice.progressVoice.generate=async()=>{generated++;return {text:'I am reading example.com’s page.',audio:['PCM'],generationMs:0};};
  f.voice.receive({serverContent:{inputTranscription:{text:'Read https://example.com/facts and report its contents.',finished:true},outputTranscription:{text:'Premature answer without reading.'},turnComplete:true}});
  await until(()=>f.sent.length===1);assert.equal(generated,1);assert.equal(f.events.filter(e=>e==='read:https://example.com/facts').length,1);
  assert.match(JSON.stringify(f.sent[0]),/Actual results/);assert.equal(f.voice.firstOperation,undefined);
});

test('typed receipt status is synchronous even while generation is still pending',async t=>{
  const f=fixture(t);f.voice.progressVoice.generate=async()=>{throw Error('unavailable');};
  f.voice.sendText('List the workspace files');assert.ok(f.events.some(e=>e.startsWith('stage:Preparing')));
  await until(()=>f.sent.length===1);assert.ok(f.logs.some(e=>e.message.endsWith('Action selection started')));
});

test('complete finite English operation verbs do not cause unnecessary phrase repairs',()=>{
  for(const action of ['listing','retrieving','observing','writing','saving','opening','typing','scrolling','accessing'])assert.equal(validProgress(`I am ${action} the requested item.`),true,action);
  assert.equal(validProgress('The requested workspace file list.'),false);assert.equal(validProgress('I am done with the task.'),false);
});

test('explicit multi-page work reads every requested page freshly before accepting a premature answer',async t=>{
  const f=fixture(t);catalogReader(f);
  f.voice.modelResearch={goal:'Previous comparison',publishers:['Google','OpenAI'],verified:true,pages:[{name:'read_web_page',args:{url:modelCatalogs.OpenAI},result:{status:'ok',source:'direct_page',url:modelCatalogs.OpenAI,content:'Previous-turn OpenAI evidence'}}]};
  f.voice.progressVoice.generate=async context=>({text:`I am reading ${context.operation.subject}’s page.`,audio:['PCM'],generationMs:0});
  f.voice.sendText(`Reply in English. Read ${modelCatalogs.Google} and ${modelCatalogs.OpenAI} one at a time, then compare their contents.`);
  await until(()=>f.sent.length===1);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,1);
  f.voice.receive({serverContent:{outputTranscription:{text:'A premature comparison using old OpenAI data.'},turnComplete:true}});
  await until(()=>f.sent.length===2);assert.equal(f.events.filter(e=>e.startsWith('read:')).length,2);assert.equal(f.entries.some(e=>e.phase==='final'),false);
  assert.match(JSON.stringify(f.sent[1]),/Actual results/);assert.equal(f.events.filter(e=>e==='stage:Check').length,2);
  f.voice.receive({serverContent:{outputTranscription:{text:'Both pages have now been read.'},turnComplete:true}});await until(()=>!f.voice.taskActive);
});

test('required page cache preserves argument changes and does not suppress unrelated research',async t=>{
  const f=fixture(t);f.voice.beginTask('Read https://example.com/facts and research its competitors.');
  const contexts=[];f.voice.progressVoice.generate=async context=>{contexts.push(context);return {text:'I am reading example.com’s page.',audio:['PCM'],generationMs:0};};
  await f.voice.runTool({name:'read_web_page',args:{url:'https://example.com/facts'}});
  await f.voice.runTool({name:'read_web_page',args:{url:'https://example.com/facts',query:'prices'}});
  assert.equal(f.events.filter(e=>e.startsWith('read:')).length,2);assert.equal(contexts.length,2);
  let searched=0;window.orvixDesktop.searchWeb=async()=>{searched++;return {status:'ok',results:[]};};await f.voice.runTool({name:'web_search',args:{query:'example competitors'}});assert.equal(searched,1);
});
