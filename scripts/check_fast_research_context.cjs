const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',external:['@google/genai'],write:false,logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {resolveResearchContinuation,scopeContinuationQuery,researchSearchPolicy}=load('fastResearchContext.ts');
const {requestedSourceNavigation,navigationResultMatches}=load('fastBrowserRouting.ts');
const {unsupportedModelNames,modelCatalogs,isModelPublisherSource}=load('simpleFastResearch.ts');
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');
const {globalAbsenceClaim,scopeResearchAnswer}=load('fastResearchClaims.ts');
const {routeFastRequest}=load('fastLatency.ts');
function fixture(t){
  const sent=[],spoken=[],operations=[],events=[];
  global.window={speechSynthesis:{cancel(){}},orvixDesktop:{logLive(){},searchWeb:async input=>{operations.push({name:'web_search',input});return {status:'ok',results:[]};},browserObserve:async()=>({status:'ok',observation:{tabs:[]}}),executeFast:async(_task,name,input)=>{events.push('execute');operations.push({name,input});return {status:'ok',verification:{verified:true},observation:{page:{url:input.args?.url}}};}}};
  const v=new SimpleFastVoiceSession([],{onStatus(){},onProgress(){},onTranscript(){}});
  v.stopped=false;v.language='en';v.session={sendClientContent:data=>sent.push(data),sendToolResponse:data=>sent.push(data),close(){}};
  v.audioEngine={hasPlayback:false,clearPlayback(){},close(){}};v.progressVoice={close(){}};v.narrator={close(){}};v.evidenceNarrator={close(){}};v.kick=()=>{};
  v.ensureTask=async()=>{v.taskId='fixture';};
  v.acknowledge=async(_context,onset)=>{events.push('ack_onset');onset?.();return true;};
  v.speak=async(text,_phase,_id,pcm)=>{spoken.push({text,pcm});return true;};t.after(()=>v.stop());
  return {v,sent,spoken,operations,events};
}
test('fresh current lookups bypass cache; dated history is not restricted to last week',()=>{
  assert.deepEqual(researchSearchPolicy('latest GPT models'),{refresh:true,freshness:'oneMonth'});
  assert.deepEqual(researchSearchPolicy('GPT leaks news'),{refresh:true,freshness:'oneWeek'});
  assert.deepEqual(researchSearchPolicy('GPT leaks in 2024'),{refresh:true});
  assert.deepEqual(researchSearchPolicy('what is a transformer'),{});
});
test('Terra follow-ups and publisher correction preserve one model subject',()=>{
  let prior='GPT upcoming model leaks';
  for(const request of ['terra er kono update?','terra model er','gpt er']){
    const context=resolveResearchContinuation(request,prior);
    assert.equal(context.continued,true);assert.deepEqual(context.publishers,['OpenAI']);assert.match(context.goal,/Subject reference: terra/i);
    const query=scopeContinuationQuery('Terra blockchain upgrade complete',context);
    assert.match(query,/OpenAI GPT.*terra.*model/i);assert.doesNotMatch(query,/blockchain|coin/i);prior=context.goal;
  }
});
test('new subjects, explicit crypto and supplied pages do not inherit model scope',()=>{
  for(const request of ['JBL latest model','Terra crypto chain update','new topic: weather','read https://example.com/'])assert.equal(resolveResearchContinuation(request,'GPT upcoming models').continued,false,request);
});
test('controller retains the GPT subject through the reported correction chain',async t=>{
  const {v,operations}=fixture(t);v.retainedResearch={goal:'GPT upcoming model leaks',receipts:[]};
  for(const request of ['terra er kono update?','terra model er','gpt er']){
    v.beginTask(request);assert.equal(v.route,'lookup');assert.equal(v.firstOperation.name,'web_search');assert.match(v.requestPrompt(),/OpenAI GPT.*model updates/);
    await v.dispatch('web_search',{query:'Terra crypto chain update'});
    const input=operations.at(-1).input;assert.match(input.query,/OpenAI GPT.*terra/i);assert.doesNotMatch(input.query,/crypto|chain/);assert.equal(input.refresh,true);assert.equal(input.freshness,'oneMonth');
    v.retainedResearch={goal:v.researchContinuation.goal,receipts:[]};
  }
  v.beginTask('JBL latest model');assert.equal(v.modelResearchTurn,false);assert.deepEqual(v.catalogSources,[]);
});
test('upcoming rumors retain third-party leads and require the current catalog too',async t=>{
  const {v,operations}=fixture(t);window.orvixDesktop.searchWeb=async input=>{operations.push({input});return {status:'ok',results:[{url:'https://example.com/report',snippet:'An attributed rumor, not confirmation.'}]};};
  v.beginTask('gpt er konmodel ashtese leak anujaye');assert.deepEqual(v.catalogSources,[modelCatalogs.OpenAI]);
  const result=await v.dispatch('web_search',{query:'OpenAI upcoming GPT leaks reports'});
  assert.equal(result.results.length,1);assert.doesNotMatch(operations[0].input.query,/site:openai/);assert.equal(operations[0].input.freshness,'oneWeek');
});
test('official silence is not inferred from an incomplete search in English or Banglish',()=>{
  for(const text of ['OpenAI has not announced its future GPT models.','OpenAI official bhabe future GPT models somporke kichu boleni.','No official announcement exists.','There are no recent updates on an OpenAI Terra model.','There are no updates on an OpenAI Terra model in the official registry.']){
    assert.equal(globalAbsenceClaim(text),true,text);const result=scopeResearchAnswer(text,['Old unconfirmed video rumor.'],'en');assert.equal(result.changed,true);assert.match(result.text,/could not establish/);
  }
  assert.equal(globalAbsenceClaim('I could not confirm an announcement from these sources.'),false);
});
test('exact model variants cannot borrow a different variant or version as evidence',()=>{
  assert.equal(unsupportedModelNames('GPT-8 Terra',['GPT-8 Sol is listed.']),true);
  assert.equal(unsupportedModelNames('GPT-8 Terra',['GPT-8.1 Terra is listed.']),true);
  assert.equal(unsupportedModelNames('GPT-8 Terra',['GPT-8 Terra is listed.']),false);
});
test('community posts on vendor domains are leads, not official publisher confirmation',()=>{
  assert.equal(isModelPublisherSource('https://community.openai.com/t/model-rumor',['OpenAI']),false);
  assert.equal(isModelPublisherSource('https://discuss.ai.google.dev/t/model-rumor',['Google']),false);
  assert.equal(isModelPublisherSource(modelCatalogs.OpenAI,['OpenAI']),true);
  assert.equal(isModelPublisherSource(modelCatalogs.Google,['Google']),true);
});
test('unsupported official-silence speech is discarded, not played as original PCM',async t=>{
  const {v,spoken}=fixture(t);v.beginTask('search GPT model rumors');v.firstOperation=undefined;v.turnText='OpenAI official bhabe future GPT models somporke kichu boleni.';v.turnAudio=['WRONG_PCM'];
  v.receipts=[{name:'read_web_page',args:{url:'https://example.com/rumor'},result:{status:'ok',source:'direct_page',content:'This is an old speculative model report, not a current official announcement.'}}];
  await v.report();assert.ok(spoken.length);assert.equal(spoken.at(-1).pcm,undefined);assert.doesNotMatch(spoken.at(-1).text,/kichu boleni/);
});
test('rumor claims stay buffered before final scoping',t=>{
  const {v}=fixture(t);v.beginTask('search GPT model leaks');v.resultSubmittedAt=Date.now();v.receipts=[{name:'web_search',args:{query:'GPT model leaks'},result:{status:'ok',results:[{snippet:'Old rumor'}],stepCheck:{verified:true}}}];
  assert.equal(v.canStreamSearchReply({outputTranscription:{text:'GPT-8 is unannounced.'}}),false);
  v.receipts=[{name:'read_web_page',args:{url:'https://example.com'},result:{status:'ok',source:'direct_page',content:'An old rumor',stepCheck:{verified:true}}}];
  assert.equal(v.canStreamResearchReply({outputTranscription:{text:'GPT-8 is unannounced.'}}),false);
});
test('numbered source opening follows displayed order and never guesses missing sources',()=>{
  const sources=['https://example.com/first','https://example.net/second'];
  assert.deepEqual(requestedSourceNavigation('acccha khulo 2nd ta',sources),{requested:true,url:sources[1]});
  assert.equal(requestedSourceNavigation('open the second one',sources).url,sources[1]);
  assert.equal(requestedSourceNavigation('দ্বিতীয় লিংকটি খুলে দাও',sources).url,sources[1]);
  assert.equal(requestedSourceNavigation('open the third one',sources).url,undefined);
  assert.equal(requestedSourceNavigation('take me to its website',sources,sources[1]).url,sources[1]);
  for(const text of ['do not open the second one','khulo na 2nd ta','read the second one'])assert.equal(requestedSourceNavigation(text,sources).requested,false);
});
test('selected source uses acknowledged visible navigation; page reading cannot substitute',async t=>{
  const {v,operations,events}=fixture(t);v.presentedSourceUrls=['https://example.com/first','https://example.net/second'];v.beginTask('acccha khulo 2nd ta');
  assert.equal(v.firstOperation.name,'browser_act');assert.equal(v.firstOperation.args.args.url,'https://example.net/second');
  assert.equal((await v.runTool({name:'read_web_page',args:{url:'https://example.net/second'}})).result.status,'navigation_required');
  const result=await v.runTool(v.firstOperation);assert.equal(result.result.stepCheck.verified,true);assert.deepEqual(events,['ack_onset','execute']);assert.equal(operations[0].name,'browser_act');assert.equal(operations[0].input.expect.value,'https://example.net/second');assert.equal(operations[0].input.args.tabPolicy,'reuse');
});
test('wrong destination and missing selection are rejected before any dispatch',async t=>{
  const {v,operations}=fixture(t);v.presentedSourceUrls=['https://example.com/first','https://example.net/second'];v.beginTask('open the second one');
  assert.equal((await v.runTool({name:'browser_act',args:{action:'navigate',args:{url:'https://example.com/wrong'}}})).result.status,'invalid_request');
  v.beginTask('open the third one');assert.equal(v.clarifySourceNavigation,true);assert.equal((await v.runTool({name:'browser_act',args:{action:'navigate',args:{url:'https://example.com/wrong'}}})).result.status,'needs_clarification');assert.equal(operations.length,0);
});
test('generic browser ok and blank tab do not establish the selected page opened',async t=>{
  const {v,spoken}=fixture(t),url='https://example.net/second';v.presentedSourceUrls=['https://example.com/first',url];v.beginTask('open the second one');v.firstOperation=undefined;
  v.receipts=[{name:'browser_act',args:{action:'navigate',args:{url}},result:{status:'ok',verification:{verified:true},stepCheck:{verified:true},observation:{page:{url:'about:blank'}}}}];v.turnText='I opened the requested website.';v.turnAudio=['WRONG_SUCCESS'];
  assert.equal(v.canStreamObservedReply(),false);await v.report();assert.equal(spoken.at(-1).pcm,undefined);assert.match(spoken.at(-1).text,/not confirmed open/);
  assert.equal(navigationResultMatches(url,{status:'ok',observation:{page:{url}}}),true);
});
test('rumor research reads an original report before delivering snippet claims',async t=>{
  const {v}=fixture(t);v.beginTask('GPT leaks news');v.firstOperation=undefined;v.turnText='The rumor is confirmed.';
  v.receipts=[{name:'web_search',args:{query:'GPT leaks news'},result:{status:'ok',results:[{url:'https://example.com/report',date:'3 months ago',snippet:'Unconfirmed rumor'}]}}];
  let read;v.runTool=async call=>{read=call;return {name:call.name,args:call.args,result:{status:'unavailable'}};};v.submitResults=()=>{};
  await v.report();assert.equal(read.name,'read_web_page');assert.equal(read.args.url,'https://example.com/report');
});
test('missing named variant uses the known full catalog when its landing page has no links',async t=>{
  const {v}=fixture(t);v.retainedResearch={goal:'GPT upcoming models',receipts:[]};v.beginTask('terra er kono update?');v.firstOperation=undefined;
  const full='https://developers.openai.com/api/docs/models/all';
  v.receipts=[{name:'web_search',args:{query:'OpenAI Terra'},result:{status:'ok',results:[]}},{name:'read_web_page',args:{url:modelCatalogs.OpenAI},result:{status:'ok',source:'direct_page',content:'A current catalog with only highlighted flagship models listed on this page.',links:[]}}];
  let call;v.runTool=async input=>{call=input;return {name:input.name,args:input.args,result:{status:'ok',source:'direct_page',url:full,content:'GPT-8 Terra is listed as an older model in this fixture.'}};};v.submitResults=()=>{};
  await v.report();assert.equal(call.name,'read_web_page');assert.equal(call.args.url,full);assert.equal(call.args.query,'terra');
});
test('negated or unfinished follow-ups do not select a fresh retrieval',()=>{
  for(const text of ['terra update koro na','do not check Terra model','Terra model and'])assert.equal(resolveResearchContinuation(text,'GPT model updates').continued,false);
});
test('implicit Banglish leaks requests route to retrieval',()=>{
  for(const text of ['gpt er leak somporke kisu jano?','gpt er konmodel ashtese? leak anujaye','Gemini model update'])assert.equal(routeFastRequest(text),'lookup');
});
