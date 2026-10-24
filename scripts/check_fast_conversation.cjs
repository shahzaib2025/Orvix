const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path'), Module=require('node:module'), fs=require('node:fs'), os=require('node:os');
function load(file) {const out=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(out.outputFiles[0].text,__filename);return mod.exports;}
const {conversationLanguage,restoredLanguage,reconnectConversation}=load('fastConversation.ts');
const {FastVoiceSession}=load('fastVoice.ts');
const {browserOutcomeText}=load('fastBrowserOutcome.ts');
const {createFastWork}=require('../electron/fast-work.cjs');
const {evaluate}=require('./evaluate_fast_conversation.cjs');
const protocol=require('../shared/fast-conversation-evaluation.json');
function fixture(history=[]) {
  const entries=[],sent=[],played=[],logs=[];global.window={setTimeout:()=>1,clearTimeout(){},orvixDesktop:{logLive:(...args)=>logs.push(args)},speechSynthesis:{cancel(){},getVoices:()=>[]}};
  const voice=new FastVoiceSession(history,{onStatus(){},onTranscript:entry=>entries.push({...entry})});
  voice.stopped=false;voice.conversationRefinementEnabled=true;
  voice.audioEngine={hasPlayback:false,clearPlayback(){this.hasPlayback=false;},playAudio:data=>played.push(data)};
  voice.session={sendClientContent:input=>sent.push(input),sendRealtimeInput(){}};
  return {voice,history,entries,sent,played,logs};
}
test('explicit switches persist; mixed-language content does not switch replies',()=>{
  assert.equal(conversationLanguage('Open Chrome and search বাংলা tutorial','bn'),'bn');
  assert.equal(conversationLanguage('ইংরেজিতে উত্তর দিন','bn'),'en');
  assert.equal(conversationLanguage('বাংলায় বলুন','en'),'bn');
  assert.equal(restoredLanguage([{role:'user',text:'Reply in English from now on'},{role:'user',text:'আরও সহজ করে বলুন'}]),'en');
});
test('reconnect limits history and preserves corrections, pending choices, and interrupted delivery',()=>{
  const history=Array.from({length:30},(_,i)=>({role:'user',text:`old ${i}`}));
  history.push({role:'user',text:'না, Chrome-এর সার্চ বক্স বলেছি।'},{role:'assistant',text:'Unfinished explanation',delivery:'interrupted'},{role:'assistant',text:'কোন অ্যাপটি খুলব?',delivery:'complete'});
  const restored=reconnectConversation(history,'en');assert.equal(restored.turns.length,24);assert.match(JSON.stringify(restored),/Chrome/);assert.match(restored.turns.at(-2).parts[0].text,/Interrupted reply/);assert.match(restored.context,/কোন অ্যাপটি খুলব/);assert.match(restored.context,/"language":"en"/);
  assert.equal(reconnectConversation([],'bn').turns.length,0);assert.doesNotMatch(reconnectConversation([],'bn').context,/Chrome/);
});
test('an interrupted question is not restored as a completed clarification',()=>{
  const restored=reconnectConversation([{role:'assistant',text:'Which one?',delivery:'interrupted'}],'bn');assert.match(restored.context,/"pendingClarification":null/);
});
test('text and spoken follow-ups retain language without extra model calls',async()=>{
  const f=fixture();f.voice.sendText('Reply in English');await f.voice.workTaskPending;await new Promise(resolve=>setImmediate(resolve));f.voice.sendText('আরও সহজ করে বলুন');await f.voice.workTaskPending;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sent.length,2);assert.equal(f.voice.sessionLanguage,'en');assert.match(f.sent.at(-1).turns[0].parts[0].text,/English/);
  f.voice.updateTranscript('user','বাংলায় উত্তর দিন');assert.equal(f.voice.sessionLanguage,'bn');
});
test('interruption updates history and persisted callback after the server turn completed',()=>{
  const f=fixture();f.voice.updateTranscript('assistant','A long explanation');f.voice.markAssistantDelivery('complete');f.voice.transcript.assistant=null;
  f.voice.audioEngine.hasPlayback=true;f.voice.handleLocalActivity('start');
  assert.equal(f.history.at(-1).delivery,'interrupted');assert.equal(f.entries.at(-1).delivery,'interrupted');
});
test('final delivery is marked complete; old histories remain accepted',()=>{
  const f=fixture([{role:'user',text:'Explain RAM'}]);f.voice.updateTranscript('assistant','RAM is working memory.');
  f.voice.handleMessage({serverContent:{modelTurn:{parts:[{inlineData:{data:'SPOKEN_REPLY',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});assert.equal(f.history.at(-1).delivery,'complete');assert.equal(f.entries.at(-1).delivery,'complete');
});
test('interrupting a new request does not relabel the previous delivered answer',()=>{
  const f=fixture();f.voice.updateTranscript('assistant','Previous answer');f.voice.markAssistantDelivery('complete');f.voice.transcript.assistant=null;
  f.voice.sendText('A new request');f.voice.handleLocalActivity('start');assert.equal(f.history[0].delivery,'complete');
});
test('verified natural confirmations do not turn failures or uncertainty into success',()=>{
  const f=fixture();assert.equal(f.voice.workOutcome('launch',{status:'ok',verification:{verified:true}}),'অ্যাপটি খুলেছে।');
  for (const status of ['partial','dispatched','timeout']) assert.match(f.voice.workOutcome('launch',{status,verification:{verified:true}}),/নিশ্চিত করা যায়নি/);
  assert.match(f.voice.workOutcome('launch',{status:'ok',completionUnknown:true,verification:{verified:true}}),/নিশ্চিত করা যায়নি/);
  assert.equal(browserOutcomeText('navigate',{}, {status:'ok',verification:{verified:true}},false,true),'পেজটি খুলেছে।');
  assert.match(browserOutcomeText('navigate',{}, {status:'ok',verification:{verified:false}},false,true),/নিশ্চিত করা যায়নি/);
  assert.match(browserOutcomeText('navigate',{}, {status:'ok'},false,true),/নিশ্চিত করা যায়নি/);
});
test('exact speech gate still rejects contradictory audio and keeps visible verified confirmation',()=>{
  const f=fixture();f.voice.browserOutcomes.set('navigate','পেজটি খুলেছে।');f.voice.browserModelText='Everything was purchased';f.voice.browserAudio=['UNSAFE'];
  f.voice.handleMessage({serverContent:{turnComplete:true}});assert.deepEqual(f.played,[]);assert.equal(f.entries.at(-1).text,'পেজটি খুলেছে।');
});
test('exact verified model audio is delivered without changing voice',()=>{
  const f=fixture();f.voice.browserOutcomes.set('navigate','পেজটি খুলেছে।');f.voice.browserModelText='পেজটি খুলেছে।';f.voice.browserAudio=['SAFE'];
  f.voice.handleMessage({serverContent:{turnComplete:true}});assert.deepEqual(f.played,['SAFE']);
});
test('refinement setting defaults off, validates, and survives settings reload',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-conversation-'));
  try {const settingsFile=path.join(dir,'settings.json'),options={settingsFile,browser:{},desktop:{}};const work=createFastWork(options);assert.equal(work.settings().conversationRefinementEnabled,false);assert.throws(()=>work.configure({conversationRefinementEnabled:'yes'}));work.configure({conversationRefinementEnabled:true});assert.equal(createFastWork(options).settings().conversationRefinementEnabled,true);} finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('timing logs contain no entered text or audio payload',()=>{
  const f=fixture();f.voice.sendText('PRIVATE_EXAMPLE');f.voice.playResponseAudio('PRIVATE_PCM');f.voice.playResponseAudio('SECOND_PCM');assert.equal(f.logs.filter(row=>row[1].includes('Response audio queued')).length,1);assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE_EXAMPLE|PRIVATE_PCM|SECOND_PCM/);
});
test('fresh connection restores conversation metadata; reconnect latches settings and uses no auxiliary generation',async()=>{
  const stub=`export const Modality={AUDIO:'AUDIO'},ActivityHandling={START_OF_ACTIVITY_INTERRUPTS:'interrupt'},StartSensitivity={START_SENSITIVITY_HIGH:'high'}; export class GoogleGenAI {constructor(){this.live={connect:async input=>{globalThis.connectionFixture.configs.push(input.config);return {sendClientContent:input=>globalThis.connectionFixture.sent.push(input),close(){}};}};}}`;
  const out=await require('esbuild').build({entryPoints:[path.join(__dirname,'../src/fastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'controlled-live',setup(build){build.onResolve({filter:/^@google\/genai$/},()=>({path:'sdk',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}));}}]});
  const mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(out.outputFiles[0].text,__filename);
  let enabled=true;global.connectionFixture={configs:[],sent:[]};
  global.window={setTimeout,clearTimeout,orvixDesktop:{createLiveToken:async()=>({token:'fixture',model:'gemini-3.8-live'}),getFastSettings:async()=>({conversationRefinementEnabled:enabled}),getPcSnapshot:async()=>null}};
  const voice=new mod.exports.FastVoiceSession([{role:'user',text:'Reply in English'},{role:'assistant',text:'Unfinished reply',delivery:'interrupted'}],{onStatus(){},onTranscript(){}});voice.stopped=false;
  await voice.connect(0);assert.equal(voice.sessionLanguage,'en');assert.match(connectionFixture.configs[0].systemInstruction,/professional desktop assistant/);assert.match(JSON.stringify(connectionFixture.sent),/Interrupted reply/);assert.match(JSON.stringify(connectionFixture.sent),/pendingClarification/);
  enabled=false;await voice.connect(0);assert.equal(voice.conversationRefinementEnabled,true);
  const fresh=new mod.exports.FastVoiceSession([],{onStatus(){},onTranscript(){}});fresh.stopped=false;await fresh.connect(0);assert.equal(fresh.conversationRefinementEnabled,false);assert.equal(fresh.sessionLanguage,'bn');assert.match(connectionFixture.configs.at(-1).systemInstruction,/warm, lively/);
  for(const config of connectionFixture.configs){assert.equal(config.realtimeInputConfig.automaticActivityDetection.silenceDurationMs,600);assert.equal(config.speechConfig,undefined);assert.equal(config.thinkingConfig,undefined);assert.equal(config.enableAffectiveDialog,undefined);}
  const declarations=connectionFixture.configs[0].tools.flatMap(group=>group.functionDeclarations || []);
  for(const name of ['web_search','read_web_page']){const tool=declarations.find(t=>t.name===name);assert.ok(tool.parameters.required.includes('stepId'),'Planned research cannot advertise its step identity as optional');assert.match(tool.parameters.properties.stepId.description,/unplanned single action/);}
  assert.equal(connectionFixture.configs.length,3);assert.ok(connectionFixture.sent.every(input=>input.turnComplete===false));
  delete global.connectionFixture;
});
function trials() {return protocol.scenarios.flatMap(s=>Array.from({length:5},(_,i)=>({caseId:s.id,trial:i+1,evidenceKind:'real_microphone',reviewer:'test fixture only',firstAudibleMs:1000,...(s.action?{verifiedCompletionMs:2000}:{}),success:true,questionsCovered:true,languageCorrect:true,reportedComplete:!!s.action && !s.unresolved,verified:true,unauthorizedAction:false,staleAudioResumed:false,additionalModelRequests:0,professionalTone:4,clarity:4,coherence:4,...(s.interruption?{interruptionClearMs:100}:{})})));}
test('release evaluator requires complete measurements and rejects synthetic evidence',()=>{
  assert.equal(protocol.scenarios.length,30);assert.equal(evaluate(trials(),trials()).passed,true);assert.equal(evaluate([],trials()).passed,false);
  const rows=trials();rows[0].evidenceKind='fixture';assert.equal(evaluate(trials(),rows).passed,false);
});
test('exhausted plan recovery publishes an unfinished report and blocks further reviews',async()=>{
 const f=fixture();f.voice.workTaskId='task';f.voice.taskContext={id:'task',revision:1,goal:'Research solar',latestRequest:'Research solar',status:'blocked',requirements:[{id:'missing',text:'Solar target',status:'pending'}],steps:[],evidence:[]};
 let plans=0,reviews=0;const responses=[];
 window.orvixDesktop.getFastContext=async()=>f.voice.taskContext;
 window.orvixDesktop.registerFastPlan=async()=>{plans++;return {status:'blocked',protocolBlocked:true,repairExhausted:true,message:'Plan repair exhausted',context:f.voice.taskContext};};
 window.orvixDesktop.reviewFastCompletion=async()=>{reviews++;return {completed:true};};
 f.voice.session.sendToolResponse=input=>responses.push(input);
 await f.voice.handleToolCalls([{id:'plan',name:'plan_task',args:{}}]);
 assert.equal(f.voice.protocolRecoveryExhausted,true);assert.equal(f.voice.finalLedgerReady,true);assert.match([...f.voice.browserOutcomes.values()].join(' '),/Solar target/);
 assert.match(f.sent.at(-1).turns[0].parts[0].text,/unfinished-task report/);
 await f.voice.handleToolCalls([{id:'review',name:'review_task',args:{answer:'Everything done'}}]);
 assert.equal(plans,1);assert.equal(reviews,0);assert.equal(responses.at(-1).functionResponses[0].response.status,'blocked');
 f.voice.applyUserRequest('Research a new solar question');assert.equal(f.voice.protocolRecoveryExhausted,false);
});
test('Live token recovery excludes only configured limited credentials and exposes no raw key',async()=>{
 const vm=require('node:vm'),crypto=require('node:crypto'),isolated={exports:{}},used=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/live-auth.cjs'),'utf8'),{module:isolated,process:{env:{GEMINI_API_KEY_A:'synthetic-key-a',GEMINI_API_KEY_B:'synthetic-key-b',GEMINI_API_KEY_PRIORITY:'A,B'}},require:name=>name==='@google/genai'?{GoogleGenAI:class{constructor({apiKey}){used.push(apiKey);this.authTokens={create:async()=>({name:'ephemeral-fixture'})};}}}:require(name)});
 const api=isolated.exports,first=await api.createLiveToken('Fast');
 assert.equal(first.model,'gemini-3.8-live');assert.equal(first.remainingKeys,1);assert.equal(first.keyId,crypto.createHash('sha256').update('synthetic-key-a').digest('hex').slice(0,16));
 const second=await api.createLiveToken('Fast','LOW',{excludedKeyIds:[first.keyId]});assert.equal(second.remainingKeys,0);assert.deepEqual(used,['synthetic-key-a','synthetic-key-b']);
 assert.doesNotMatch(JSON.stringify([first,second]),/synthetic-key/);
 await assert.rejects(api.createLiveToken('Fast','LOW',{excludedKeyIds:[first.keyId,second.keyId]}),/quota is unavailable/);
 await assert.rejects(api.createLiveToken('Fast','LOW',{excludedKeyIds:['not-a-fingerprint']}),/Invalid Live recovery/);
});
test('Live quota recovery preserves evidence and tries each configured credential at most once',async()=>{
 const stub=`export const Modality={AUDIO:'AUDIO'},ActivityHandling={START_OF_ACTIVITY_INTERRUPTS:'interrupt'},StartSensitivity={START_SENSITIVITY_HIGH:'high'}; export class GoogleGenAI {constructor(){this.live={connect:async input=>{globalThis.quotaFixture.callbacks.push(input.callbacks);return {sendClientContent(){},close(){}};}};}}`;
 const output=await require('esbuild').build({entryPoints:[path.join(__dirname,'../src/fastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'quota-live',setup(build){build.onResolve({filter:/^@google\/genai$/},()=>({path:'sdk',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}));}}]});
 const mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(output.outputFiles[0].text,__filename);
 global.quotaFixture={callbacks:[]};const options=[];let reconnects=0;
 global.window={setTimeout:()=>1,clearTimeout(){},speechSynthesis:{cancel(){}},orvixDesktop:{createLiveToken:async(_profile,_depth,recovery)=>{options.push(recovery);return {token:'fixture',model:'gemini-3.8-live',keyId:options.length===1?'aaaaaaaaaaaaaaaa':'bbbbbbbbbbbbbbbb',remainingKeys:options.length===1?1:0};},getFastSettings:async()=>({}),getPcSnapshot:async()=>null}};
 const voice=new mod.exports.FastVoiceSession([],{onStatus(){},onTranscript(){}});voice.stopped=false;voice.scheduleReconnect=()=>{reconnects++;voice.session=null;};
 voice.taskRequest='Research solar';voice.taskEvidence=[{name:'read_web_page',response:{status:'ok'}}];await voice.connect(0);
 quotaFixture.callbacks[0].onclose({code:1011,reason:'Resource exhausted quota'});
 assert.equal(voice.stopped,false);assert.equal(voice.taskEvidence.length,1);assert.equal(reconnects,1);
 await voice.connect(voice.generation);assert.deepEqual(options[1].excludedKeyIds,['aaaaaaaaaaaaaaaa']);
 quotaFixture.callbacks[0].onclose({code:1011,reason:'Resource exhausted quota'});assert.equal(reconnects,1,'Late old socket events cannot rotate again');
 quotaFixture.callbacks[1].onclose({code:1011,reason:'Resource exhausted quota'});assert.equal(voice.stopped,true);assert.equal(reconnects,1);
 delete global.quotaFixture;
});
test('release evaluator rejects false completion, stale speech, latency, rating and model-call regressions',()=>{
  for (const change of [r=>{r[0].reportedComplete=true;r[0].verified=false;},r=>r[0].unauthorizedAction=true,r=>r[0].staleAudioResumed=true,r=>r[0].additionalModelRequests=1,r=>r.find(x=>x.caseId==='interrupt-explanation').interruptionClearMs=501,r=>r.filter(x=>x.caseId==='simple-fact').forEach(x=>x.firstAudibleMs=1101),r=>r.forEach(x=>x.clarity=3),r=>r[0].questionsCovered=false]) {const rows=trials();change(rows);assert.equal(evaluate(trials(),rows).passed,false);}
});
