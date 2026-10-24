const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path'), Module=require('node:module');
function load(file){const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(code,__filename);return mod.exports;}
const {FastVoiceSession}=load('fastVoice.ts'), {fastToolAcknowledgment}=load('fastAcknowledgment.ts'), {FastNarrator}=load('fastNarrator.ts');
function fixture(){
  const entries=[],logs=[],events=[],sent=[];
  global.window={setTimeout:()=>1,clearTimeout(){},speechSynthesis:{cancel(){},getVoices:()=>[]},orvixDesktop:{logLive:(...args)=>logs.push(args),listDirectory:async()=>{events.push('execute');return {status:'ok',entries:[]};}}};
  const voice=new FastVoiceSession([],{onStatus(){},onTranscript:e=>entries.push({...e})});
  voice.stopped=false;voice.acknowledgmentEnabled=true;voice.sessionLanguage='en';voice.taskRequest='List the requested directory';
  voice.session={sendToolResponse:x=>sent.push(x),sendClientContent:x=>sent.push(x)};
  const audio=voice.audioEngine;audio.clearPlayback=()=>{};audio.playAudio=()=>{events.push('audio');};
  voice.narrator={render:async text=>{events.push(text);return ['PCM'];},close(){}};
  return {voice,entries,logs,events,sent,audio};
}
test('Google, OpenAI, comparison and failed recovery wording follows the actual stage',()=>{
  const context={goal:'Compare Google and OpenAI latest models',requirements:[],steps:[]};
  assert.match(fastToolAcknowledgment('web_search',{query:'Google latest Gemini models'},'en',context),/Google’s latest/);
  assert.match(fastToolAcknowledgment('web_search',{query:'OpenAI latest GPT models'},'bn',context),/ওপেনএআই-এর নতুন/);
  assert.match(fastToolAcknowledgment('review_task',{},'bn',context),/তুলনা/);
  assert.match(fastToolAcknowledgment('read_web_page',{url:'https://ai.google.dev/models'},'bn',context,{name:'web_search',response:{status:'failed'}}),/আগের চেষ্টায় যাচাই করা ফল পাওয়া যায়নি/);
  for(const lang of ['en','bn'])assert.doesNotMatch(fastToolAcknowledgment('web_search',{query:'OpenAI latest'},lang,context),/received|completed|পেয়েছি|সম্পন্ন/);
  assert.doesNotMatch(fastToolAcknowledgment('review_task',{},'en',{goal:'Read contact information',requirements:[],steps:[]}),/comparing/);
});
test('uncertain mutations acknowledge reconciliation without claiming success',()=>{
  const text=fastToolAcknowledgment('browser_observe',{},'en',undefined,{name:'browser_act',response:{status:'partial',completionUnknown:true}});
  assert.match(text,/uncertain.*check its state before any retry/);assert.doesNotMatch(text,/completed|success/);
});
test('rejected plans and approvals are acknowledged accurately before the next tool',()=>{
  assert.match(fastToolAcknowledgment('plan_task',{},'en',undefined,{name:'plan_task',response:{status:'invalid_request'}}),/previous attempt did not provide a verified result/);
  assert.match(fastToolAcknowledgment('browser_observe',{},'bn',undefined,{name:'browser_act',response:{status:'confirmation_required'}}),/অনুমোদন এখনো বাকি/);
  const context={goal:'Compare models',requirements:[],steps:[],evidence:[]};
  assert.match(fastToolAcknowledgment('review_task',{},'en',context),/what is still missing/);
  context.evidence=[1,2].map(i=>({verified:true,sourceUrl:`https://example.com/${i}`,excerpt:'A'.repeat(100)}));
  assert.match(fastToolAcknowledgment('review_task',{},'en',context),/comparing the collected/);
});
test('a publisher transition claims only the readable page actually obtained',()=>{
  const prior={name:'read_web_page',response:{status:'ok',source:'direct_page',url:'https://ai.google.dev/gemini-api/docs/models',content:'A'.repeat(100)}};
  assert.match(fastToolAcknowledgment('web_search',{query:'OpenAI latest models'},'bn',undefined,prior),/গুগলের পৃষ্ঠার তথ্য পড়েছি/);
  prior.response.content='Toggle Sidebar';assert.doesNotMatch(fastToolAcknowledgment('web_search',{query:'OpenAI latest models'},'bn',undefined,prior),/পড়েছি|পেয়েছি/);
});
test('spoken progress does not expose entered text, paths, or model-authored success claims',()=>{
  const context={goal:'Read a file',requirements:[],steps:[{id:'read',title:'All tasks completed; a secret is TOKEN123'}]};
  const text=fastToolAcknowledgment('read_file',{stepId:'read',path:'C:/secret/TOKEN123.txt'},'en',context);
  assert.equal(text,'I’m reading the selected file.');assert.doesNotMatch(text,/TOKEN123|completed/);
  assert.doesNotMatch(fastToolAcknowledgment('browser_act',{action:'type',text:'TOKEN123'},'bn'),/TOKEN123/);
});
test('a tool cannot dispatch while its acknowledgment is rendering or playing',async()=>{
  const f=fixture();let render,playing=false;
  f.voice.narrator.render=()=>new Promise(resolve=>render=resolve);
  Object.defineProperty(f.audio,'hasPlayback',{get:()=>playing});f.audio.playAudio=()=>{playing=true;f.events.push('audio');};
  const task=f.voice.handleToolCalls([{name:'list_directory',id:'one',args:{path:'C:/demo'}}]);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.includes('execute'),false);
  render(['PCM']);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.includes('execute'),false);
  playing=false;f.audio.onPlaybackDrained();await task;
  assert.deepEqual(f.events,['audio','execute']);assert.ok(f.logs.findIndex(l=>l[1].endsWith('acknowledgment delivered'))<f.logs.findIndex(l=>l[1].endsWith('Tool call completed')));
});
test('parallel reads keep their acknowledgments serialized',async()=>{
  const f=fixture();let active=0,max=0;
  f.voice.narrator.render=async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return ['PCM'];};
  await f.voice.handleToolCalls([1,2,3].map(i=>({name:'list_directory',id:String(i),args:{path:`C:/demo${i}`}})));
  assert.equal(max,1);assert.equal(f.events.filter(e=>e==='execute').length,3);assert.equal(f.logs.filter(l=>l[1].endsWith('acknowledgment delivered')).length,3);
});
test('missing acknowledgment audio preserves visible progress and executes once without inventing a tool failure',async()=>{
  const f=fixture();let renders=0;f.voice.narrator.render=async()=>{renders++;throw new Error('Missing audio');};
  await f.voice.handleToolCalls([{name:'list_directory',id:'one',args:{path:'C:/demo'}}]);
  await f.voice.handleToolCalls([{name:'list_directory',id:'two',args:{path:'C:/other'}}]);
  assert.equal(f.events.filter(e=>e==='execute').length,2);assert.equal(renders,1);
  assert.doesNotMatch(JSON.stringify(f.sent),/Failed:|Missing audio/);assert.equal(f.entries.some(e=>e.delivery==='complete'),false);
  assert.equal(f.logs.some(l=>l[1]==='[FastVoice] Tool call failed'),false);
  assert.ok(f.entries.every(e=>!e.text.includes('previous attempt')));
});
test('a user correction during rendering prevents the old action',async()=>{
  const f=fixture();let finish;f.voice.narrator.render=()=>new Promise(resolve=>finish=resolve);
  const task=f.voice.handleToolCalls([{name:'list_directory',id:'one',args:{path:'C:/old'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.userRequestSerial++;f.voice.acknowledgmentAbort.abort();finish(['PCM']);await task;
  assert.equal(f.events.includes('execute'),false);assert.equal(f.events.includes('audio'),false);
});

test('an acoustic interruption before dispatch is cancellation rather than a failed tool operation',async()=>{
  const f=fixture();let finish;f.voice.narrator.render=()=>new Promise(resolve=>finish=resolve);
  const action=f.voice.handleToolCalls([{name:'list_directory',id:'interrupted',args:{path:'C:/demo'}}]);
  await new Promise(resolve=>setImmediate(resolve));f.voice.acknowledgmentAbort.abort();finish(['PCM']);await action;
  assert.equal(f.events.includes('execute'),false);assert.match(JSON.stringify(f.sent),/"dispatched":false/);
  assert.equal(f.logs.some(l=>l[1]==='[FastVoice] Tool call failed'),false);assert.equal(f.voice.acknowledgmentPrevious,undefined);
});
test('internal research search and each source read get separate acknowledgments',async()=>{
  const f=fixture();const ack=[];f.voice.acknowledgeTool=async(name,args)=>ack.push([name,args]);
  window.orvixDesktop.searchWeb=async()=>({status:'ok',results:[{title:'Bee pollination',url:'https://example.com/bees',snippet:'Bees pollinate plants'}]});
  window.orvixDesktop.readSearchPage=async()=>({status:'ok',source:'direct_page',title:'Bees',url:'https://example.com/bees',content:'Bees pollinate plants and help flowering plants reproduce.'});
  const {fastResearchTaskFor}=load('fastResearch.ts');const task=fastResearchTaskFor('Search online about bee pollination');f.voice.researchTask=task;
  await f.voice.ensureResearch(task,'bee pollination');assert.ok(ack.some(a=>a[0]==='web_search'));assert.ok(ack.some(a=>a[0]==='read_web_page'));
});
test('blocked reviewed report survives local interruption and rejects resumed unsupported audio',()=>{
  const f=fixture();f.voice.acknowledgmentEnabled=false;f.voice.finalLedgerReady=true;f.voice.ledgerAnswerReviewed=false;
  const report='Task blocked. The comparison is unverified.';f.voice.lastLedgerReview={answer:report};f.voice.browserOutcomes.set('task_review',report);f.voice.serverResponseActive=true;
  f.voice.interruptLocally();assert.equal(f.voice.browserOutcomes.get('task_review'),report);
  f.voice.localSpeaking=false;f.voice.interruptionAcknowledged=true;
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'Both latest models are verified.'},modelTurn:{parts:[{inlineData:{data:'UNSUPPORTED',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  assert.equal(f.events.includes('audio'),false);assert.ok(f.entries.every(e=>!e.text.includes('Both latest')));
});
test('replayed reports update the original transcript instead of duplicating it',()=>{
  const f=fixture();f.voice.acknowledgmentEnabled=false;f.voice.finalLedgerReady=true;
  const report='Task blocked. The comparison is unverified.';f.voice.lastLedgerReview={answer:report};f.voice.browserOutcomes.set('task_review',report);
  f.voice.handleMessage({serverContent:{turnComplete:true}});const id=f.voice.reviewedReportTranscript.id;
  f.voice.resetBrowserConfirmation(true);f.voice.handleMessage({serverContent:{turnComplete:true}});
  assert.equal(f.voice.reviewedReportTranscript.id,id);assert.equal(new Set(f.entries.filter(e=>e.text===report).map(e=>e.id)).size,1);
  f.voice.browserOutcomes.set('task_review','Task blocked. Review unavailable.');f.voice.browserConfirmationDelivered=false;
  f.voice.handleMessage({serverContent:{turnComplete:true}});assert.equal(f.voice.reviewedReportTranscript.id,id);
});

test('a terminal review survives recovery and repeated tool proposals without dispatching again',async()=>{
  const f=fixture();f.voice.finalLedgerReady=true;f.voice.terminalReviewSerial=f.voice.userRequestSerial;
  f.voice.browserOutcomes.set('task_review','Review unavailable; the answer remains unverified.');
  await f.voice.handleToolCalls([{name:'review_task',id:'repeat-review',args:{}},{name:'list_directory',id:'repeat-action',args:{path:'C:/demo'}}]);
  assert.equal(f.events.length,0);assert.match(JSON.stringify(f.sent),/Review has ended/);
  f.voice.retainedResults=[{epoch:f.voice.taskEpoch,name:'review_task',reviewed:true,response:{status:'blocked'}}];
  f.voice.flushRetainedResults();assert.match(JSON.stringify(f.sent),/Recover only spoken delivery/);
  f.voice.applyUserRequest('Research another topic online');assert.equal(f.voice.terminalReviewSerial,undefined);
});

test('research draft transcription remains hidden until answer verification',()=>{
  const f=fixture();f.voice.evidenceAnswerPending=true;
  f.voice.handleMessage({serverContent:{outputTranscription:{text:'An unsupported model is definitely the latest.'},modelTurn:{parts:[{text:'An unsupported model is definitely the latest.'}]}}});
  assert.equal(f.entries.length,0);assert.match(f.voice.browserModelText,/unsupported model/);
});

test('Fast display replaces persisted drafts and duplicate reports while Thinking retains its answer segments',()=>{
  const source=require('node:fs').readFileSync(path.join(__dirname,'../src/App.tsx'),'utf8');
  const fn=source.slice(source.indexOf('function messagesForDisplay('),source.indexOf('\nfunction App()'));
  const code=require('esbuild').transformSync(fn+'\nmodule.exports={messagesForDisplay};',{loader:'ts',format:'cjs'}).code;
  const mod=new Module(__filename,module);mod._compile(code,__filename);const display=mod.exports.messagesForDisplay;
  const messages=[{id:'user',mode:'Fast',role:'user',text:'Latest models?'},{id:'draft',mode:'Fast',role:'assistant',text:'Unreviewed release claim'},{id:'report-one',mode:'Fast',role:'assistant',phase:'final',text:'First blocked report'},{id:'report-two',mode:'Fast',role:'assistant',phase:'final',text:'Current blocked report'}];
  assert.equal(display(messages)[1].text,'Current blocked report');
  assert.equal(display(messages.map(m=>({...m,mode:'Thinking'})))[1].text,'Unreviewed release claim\n\nFirst blocked report\n\nCurrent blocked report');
});

test('reviewer outage reports readable sources without internal requirements or rejected claims',()=>{
  const f=fixture();f.voice.sessionLanguage='bn';f.voice.taskContext={requirements:[{id:'source-answer',status:'pending'}],steps:[],evidence:[{verified:true,sourceUrl:'https://ai.google.dev/gemini-api/docs/models',excerpt:'Official catalog'}]};
  const report=f.voice.incompleteTaskReport({status:'blocked',reviewUnavailable:true},{answer:'Unproven model announcement',coverage:[]});
  assert.match(report,/যাচাইয়ের সেবাটি/);assert.match(report,/ai.google.dev/);assert.doesNotMatch(report,/source-answer|HTTP|Unproven|Answer the requested/);
});

test('automatic one-source review supplies exact provenance without deciding semantic success',async()=>{
  const f=fixture();f.voice.acknowledgmentEnabled=false;f.voice.workTaskId='task';let submitted;
  const context={revision:1,requirements:[{id:'request',status:'pending'},{id:'source-answer',status:'pending',kind:'research'}],steps:[],evidence:[{id:'page',verified:true,sourceUrl:'https://ai.google.dev/gemini-api/docs/models',sourcePassageId:'page:excerpt',excerpt:'Current model information'}]};
  window.orvixDesktop.getFastContext=async()=>context;
  window.orvixDesktop.reviewFastCompletion=async(id,input)=>{submitted=input;return {status:'blocked',completed:false,reviewUnavailable:true,context};};
  await f.voice.reviewFinalAnswer('A draft that still needs independent verification.');
  assert.deepEqual(submitted.coverage,[{requirementId:'source-answer',answerQuote:submitted.answer,evidenceIds:['page']}]);
  assert.equal(submitted.claims[0].sourcePassageId,'page:excerpt');assert.equal(submitted.claims[0].sourceQuote,undefined);assert.equal(f.voice.ledgerAnswerReviewed,false);
});

test('Romanized Bangla current-model lookup reads the publisher catalog and rejects third-party releases',async()=>{
  const {fastResearchTaskFor,gatherFastResearch,fastResearchSourceIssue}=load('fastResearch.ts');
  const task=fastResearchTaskFor('google er letest model gular tottho deo to');assert.ok(task);
  assert.match(fastResearchSourceIssue(task,'https://techplanet.today/post/invented-google-release'),/official source/);
  const operations=[];
  const bridge={searchWeb:async input=>{operations.push(['search',input.query]);throw new Error('Not needed');},readSearchPage:async({url})=>{operations.push(['read',url]);return {status:'ok',source:'direct_page',url,title:'Gemini models',content:'The official Gemini model catalog describes current models and supported capabilities.'};}};
  const sources=await gatherFastResearch(task,bridge,()=>{},'latest Google AI Gemini models 2026');
  assert.deepEqual(operations,[['read','https://ai.google.dev/gemini-api/docs/models']]);assert.equal(sources[0].status,'verified');
});

test('a failed model catalog uses one focused official lookup without reading secondary results',async()=>{
  const {fastResearchTaskFor,gatherFastResearch}=load('fastResearch.ts');const task=fastResearchTaskFor('Research Google latest models');const reads=[],queries=[];
  const sources=await gatherFastResearch(task,{searchWeb:async({query})=>{queries.push(query);return {status:'ok',results:[{url:'https://techplanet.today/post/invented-google-release',title:'Google latest Gemini model'}]};},readSearchPage:async({url})=>{reads.push(url);return {status:'unavailable',url};}},()=>{},'Google latest models');
  assert.equal(queries.length,1);assert.match(queries[0],/site:ai.google.dev/);assert.deepEqual(reads,['https://ai.google.dev/gemini-api/docs/models']);assert.equal(sources[0].status,'unavailable');
});

test('native acknowledgment fallback waits for actual speech completion',async()=>{
  const f=fixture();let utterance;global.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  window.speechSynthesis={getVoices:()=>[{lang:'en-US'}],cancel(){},speak:value=>{utterance=value;}};
  f.voice.narrator.render=async()=>{throw new Error('Unavailable');};
  try {
    const action=f.voice.handleToolCalls([{name:'list_directory',id:'native',args:{path:'C:/demo'}}]);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.includes('execute'),false);assert.match(utterance.text,/selected folder/);
    utterance.onend();await action;assert.equal(f.events.filter(e=>e==='execute').length,1);assert.ok(f.logs.some(l=>l[2]?.renderer==='native'));
  }finally{delete global.SpeechSynthesisUtterance;}
});
function narratorFixture(){const narrator=new FastNarrator();narrator.language='en';narrator.session={sendClientContent(){},close(){}};return narrator;}
test('the narrator releases audio only when the complete transcription matches',async()=>{
  const narrator=narratorFixture();const rendered=narrator.renderAttempt('Checking the source.','en',new AbortController().signal);
  narrator.receive({serverContent:{outputTranscription:{text:'Checking the source.'},modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]}}});
  let done=false;rendered.then(()=>done=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  narrator.receive({serverContent:{turnComplete:true}});assert.deepEqual(await rendered,['PCM']);narrator.close();
});
test('the narrator rejects extra claims and missing audio',async()=>{
  for(const extra of [true,false]){const narrator=narratorFixture();const rendered=narrator.renderAttempt('Checking the source.','en',new AbortController().signal);
    narrator.receive({serverContent:{outputTranscription:{text:extra?'Checking the source. All work is done.':'Checking the source.'},...(extra?{modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]}}:{}),turnComplete:true}});
    await assert.rejects(rendered,/missing|match/);narrator.close();}
});
test('missing transcription is distinguished from missing audio and altered speech',async()=>{
  const narrator=narratorFixture();const rendered=narrator.renderAttempt('Checking the source.','en',new AbortController().signal);
  narrator.receive({serverContent:{modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
  await assert.rejects(rendered,/transcript was missing/);narrator.close();
});
test('narrator cancellation closes its voice connection without executing any tools',async()=>{
  const narrator=narratorFixture(),controller=new AbortController();const rendered=narrator.render('Checking the source.','en',controller.signal);controller.abort();await assert.rejects(rendered,/interrupted/);assert.equal(narrator.session,undefined);
});
test('speech rendering retries once, caches only validated audio, and obeys cancellation',async()=>{
  const narrator=new FastNarrator();let attempts=0;
  narrator.renderAttempt=async()=>{if(++attempts===1)throw new Error('Transcript missing');return ['PCM'];};
  assert.deepEqual(await narrator.render('Checking a source.','en',new AbortController().signal),['PCM']);assert.equal(attempts,2);
  await narrator.render('Checking a source.','en',new AbortController().signal);assert.equal(attempts,2);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(narrator.render('Checking a source.','en',cancelled.signal),/interrupted/);
  const failing=new FastNarrator();let failures=0;failing.renderAttempt=async()=>{failures++;throw new Error('Unavailable');};
  await assert.rejects(failing.render('Checking a source.','en',new AbortController().signal),/Unavailable/);assert.equal(failures,2);assert.equal(failing.cache.size,0);
});
