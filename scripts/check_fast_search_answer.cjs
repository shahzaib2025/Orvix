const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',external:['@google/genai'],write:false,logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {conversationLanguage}=load('fastConversation.ts');
const {searchStatusOnly,searchStatusQuestion,explicitReplyLanguageMismatch,searchTopicGoal,preserveSearchSourceConstraint}=load('fastSearchAnswer.ts');
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');
test('tool language and spoken output language stay separate',()=>{
 const cases=[
 ['Use an English search query and give a short Bangla answer; say if search is unavailable.','bn'],
 ['Search in English and reply in Bangla.','bn'],
 ['Reply in English, use Bangla queries.','en'],
 ['Read an English page and answer concisely.','bn'],
 ['Do not search again; reply in Bangla.','bn'],
 ['Answer in English then speak Bangla.','bn'],
 ['Do not explain in English.','bn'],
 ['Tell me about English literature.','bn'],
 ['Explain function calling in one English sentence.','en'],
 ['Bangla script-e choto uttor dao.','bn'],
 ];
 for(const [prompt,want] of cases)assert.equal(conversationLanguage(prompt,'bn'),want,prompt);
 assert.equal(conversationLanguage(cases[0][0],'en'),'bn');
 assert.equal(conversationLanguage('Do not search again; reply in Bangla.','en'),'bn');
});
test('status-only replies differ from topic content and explicit status questions',()=>{
 for(const s of ['Search is available and functioning normally.','Search returned 5 results.','সার্চ স্বাভাবিকভাবে কাজ করছে।','সার্চ সুবিধাটি বর্তমানে সচল আছে এবং কাজ করছে।','যেহেতু সার্চ পরিষেবাটি কাজ করছে, তাই এটি উপলব্ধ বলেই ধরা যায়।','সার্চ সুবিধাটি','Search','Search is'])assert.equal(searchStatusOnly(s),true,s);
 for(const s of ['Solar panels convert sunlight into electricity.','Search results explain that solar panels convert sunlight.','সোলার প্যানেল সূর্যের আলো থেকে বিদ্যুৎ তৈরি করে।','Insufficient evidence about this company is available.'])assert.equal(searchStatusOnly(s),false,s);
 assert.equal(searchStatusQuestion('Is web search working?'),true);
 assert.equal(searchStatusQuestion('Search for solar panels; say if search is unavailable.'),false);
 assert.equal(explicitReplyLanguageMismatch('Search is working.','Give a Bangla answer.','bn'),true);
 assert.equal(explicitReplyLanguageMismatch('Solar panels কাজ করে।','Give a Bangla answer.','bn'),false);
});
function fixture(t){const sent=[],spoken=[];global.window={orvixDesktop:{logLive(){}},speechSynthesis:{cancel(){}}};
 const v=new SimpleFastVoiceSession([],{onStatus(){},onTranscript(){}});v.stopped=false;v.kick=()=>{};v.session={sendClientContent:x=>sent.push(x),close(){}};
 v.audioEngine={hasPlayback:false,close(){},clearPlayback(){},playAudio:()=>{throw Error('Wrong answer must not stream');}};
 v.speak=async text=>{spoken.push(text);return true;};v.beginTask('Search solar panel basics. Give a short Bangla answer; say if search is unavailable.');
 v.receipts=[{name:'web_search',args:{query:'solar panel basics'},result:{status:'ok',results:[{url:'https://example.com/',title:'Solar panels',snippet:'Solar panels convert sunlight into electricity.'}],stepCheck:{verified:true}}}];v.resultSubmittedAt=Date.now();
 t.after(()=>v.stop());return {v,sent,spoken};
}
test('wrong-language operational reply stays buffered and repairs from retained evidence',async t=>{
 const f=fixture(t);assert.equal(f.v.canStreamSearchReply({outputTranscription:{text:'Search is available and functioning normally.'}}),false);
 f.v.turnText='Search is available and functioning normally.';await f.v.report();
 assert.equal(f.sent.length,1);assert.equal(f.spoken.length,0);assert.equal(f.v.receipts.length,1);
 assert.match(f.sent[0].turns[0].parts[0].text,/Solar panels convert sunlight/);
 assert.match(f.sent[0].turns[0].parts[0].text,/Bengali script/);
 f.v.turnText='সার্চের ফল অনুযায়ী, সোলার প্যানেল সূর্যের আলো থেকে বিদ্যুৎ তৈরি করে।';f.v.serverBusy=false;await f.v.report();
 assert.equal(f.sent.length,1);assert.equal(f.spoken.length,1);assert.match(f.spoken[0],/সূর্যের আলো/);
});
test('repair is bounded and never invents a successful topic answer',async t=>{
 const f=fixture(t);f.v.turnText='সার্চ কাজ করছে।';await f.v.report();f.v.turnText='সার্চ কাজ করছে।';await f.v.report();
 assert.equal(f.sent.length,1);assert.equal(f.spoken.length,1);assert.match(f.spoken[0],/উত্তর তৈরি হয়নি/);
});
test('page-backed replies also retain English audio until the requested Bangla is available',t=>{
 const f=fixture(t);f.v.taskText='Read this page. Give a short Bangla answer.';f.v.plan=undefined;f.v.receipts=[{name:'read_web_page',args:{url:'https://example.com/'},result:{status:'ok',source:'direct_page',content:'Solar panels convert sunlight.',stepCheck:{verified:true}}}];
 assert.equal(f.v.canStreamResearchReply({outputTranscription:{text:'Solar panels convert sunlight.'}}),false);
 assert.equal(f.v.canStreamResearchReply({outputTranscription:{text:'সোলার প্যানেল সূর্যের আলো থেকে বিদ্যুৎ তৈরি করে।'}}),true);
});

test('controller result replacement ignores the old interruption and boundary, then accepts the new answer',t=>{
 const f=fixture(t);f.v.controllerRestart={at:Date.now(),interrupted:false};f.v.serverBusy=true;
 f.v.receive({serverContent:{interrupted:true}});
 assert.equal(f.v.responseInterrupted,false);assert.equal(f.v.serverBusy,true);
 f.v.receive({serverContent:{turnComplete:true,interactionStatus:'IDLE'}});
 assert.equal(f.v.turnComplete,false);assert.equal(f.v.serverBusy,true);
 f.v.receive({serverContent:{outputTranscription:{text:'সোলার প্যানেল সূর্যের আলো থেকে বিদ্যুৎ তৈরি করে।'}}});
 assert.equal(f.v.controllerRestart,undefined);assert.match(f.v.turnText,/সোলার/);
});
test('new microphone activity still honors a genuine interruption after tool results',t=>{
 const f=fixture(t);f.v.controllerRestart={at:Date.now()-20,interrupted:false};f.v.inputSpeechStartedAt=Date.now();
 f.v.receive({serverContent:{interrupted:true}});
 assert.equal(f.v.responseInterrupted,true);assert.equal(f.v.controllerRestart,undefined);
});
test('a known Bengali multistep page read stays in the evidence route',t=>{
 const f=fixture(t);f.v.beginTask('প্রথমে https://example.com/ পড়ো, তারপর https://ai.google.dev/gemini-api/docs/function-calling পড়ো।');
 assert.equal(f.v.route,'lookup');assert.equal(f.v.streamConversation,false);
});
test('conditional failure aside is absent from planning and progress, with source restrictions retained',t=>{
 const f=fixture(t);f.v.beginTask('Search solar panels from official sources; say if search is unavailable.');
 assert.match(f.v.workProgress().goal,/official sources/);assert.doesNotMatch(JSON.stringify(f.v.plan)+JSON.stringify(f.v.workProgress()),/say if search/);
});
test('dispatch preserves an explicit official-source restriction without altering other queries',()=>{
 assert.equal(preserveSearchSourceConstraint('solar panel basics','Search solar panels from official sources.'),'solar panel basics official sources');
 assert.equal(preserveSearchSourceConstraint('solar panel basics official sources','Search solar panels from official sources.'),'solar panel basics official sources');
 assert.equal(preserveSearchSourceConstraint('site:energy.gov solar panels','Search solar panels from official sources.'),'site:energy.gov solar panels');
 assert.equal(preserveSearchSourceConstraint('solar panel basics','Search solar panels.'),'solar panel basics');
});
test('official-source attribution waits for one acknowledged original-page read',async t=>{
 const f=fixture(t);f.v.taskText='Search solar panels from official sources. Give a Bangla answer.';f.v.plan=undefined;
 f.v.receipts[0].result.results[0].url='https://www.energy.gov/solar';
 assert.equal(f.v.canStreamSearchReply({outputTranscription:{text:'সোলার প্যানেল আলো থেকে বিদ্যুৎ তৈরি করে।'}}),false);
 let reads=0;f.v.runTool=async call=>{reads++;assert.equal(call.args.url,'https://www.energy.gov/solar');const receipt={name:call.name,args:call.args,result:{status:'unavailable'}};f.v.receipts.push(receipt);return receipt;};f.v.submitResults=()=>{};
 await f.v.report();assert.equal(reads,1);assert.equal(f.v.officialSourceToRead(),undefined);assert.equal(f.spoken.length,0);
 f.v.receipts[0].result.results[0].url='https://energy.gov.evil.example/solar';f.v.receipts=f.v.receipts.slice(0,1);
 assert.equal(f.v.officialSourceToRead(),undefined);
});
test('a connective between source summaries does not invent a provider comparison',()=>{
 const {scopeResearchAnswer}=load('fastResearchClaims.ts');
 const result=scopeResearchAnswer('example.com ডকুমেন্টেশনের উদাহরণ হিসেবে ব্যবহৃত হয়। অন্যদিকে, জেমিনি এপিআই-এর ফাংশন কলিং বাহ্যিক টুল ও এপিআই সংযুক্ত করে।',['Example Domain is used for documentation examples.','Function calling connects Gemini models to external tools and APIs.'],'bn');
 assert.equal(result.changed,false);
 assert.equal(scopeResearchAnswer('Google focuses on voice whereas OpenAI focuses on cost.',[],'en').comparison,true);
});

test('conditional search failure aside does not replace the topic',()=>{assert.equal(searchTopicGoal('Explain solar panels; say if search is unavailable.'),'Explain solar panels.');assert.equal(searchTopicGoal('Explain solar panels; say if tickets are unavailable.'),'Explain solar panels; say if tickets are unavailable.');const {knownFirstRead}=load('simpleFastResearch.ts');assert.equal(knownFirstRead('https://example.com/ page ta pore bolo eta ki',[]).name,'read_web_page');assert.equal(knownFirstRead('https://example.com/ pore na bolo',[]),undefined);});
