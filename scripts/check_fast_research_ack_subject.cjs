const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',external:['@google/genai'],write:false,logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {researchNotice,matchesResearchNotice,researchNoticeFallback}=load('fastResearchAcknowledgment.ts');
const {progressContext,FastProgressVoice}=load('fastProgressVoice.ts');
const {preparedToolAcknowledgment}=load('fastPreparedAcknowledgment.ts');
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');
const tick=()=>new Promise(r=>setImmediate(r));
const pcm={serverContent:{modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]}}};
const done=text=>({serverContent:{outputTranscription:{text},turnComplete:true}});
const read=()=>progressContext('tool','Compare GPT and Gemini models','read_web_page',{url:'https://developers.openai.com/api/docs/models?secret=TOKEN'});
function detail(c,previous='তথ্যটা খুঁজে দেখি।'){return {...c,researchNotice:researchNotice(c,previous,true)};}
function fixture(t){const voice=new FastProgressVoice(),sent=[];voice.session={sendClientContent:x=>sent.push(x),close(){}};t.after(()=>voice.close());return {voice,sent};}

test('first search keeps instant prepared speech; following read cannot use a generic clip',()=>{
 const c=progressContext('tool','Search GPT models','web_search',{query:'GPT models'});
 assert.equal(researchNotice(c,'',false),undefined);assert.ok(preparedToolAcknowledgment(c,'bn'));
 assert.equal(read().operation.subject,'GPT');assert.equal(preparedToolAcknowledgment(detail(read()),'bn'),undefined);
});
test('following operation names its own publisher, not the comparison partner or private URL data',()=>{
 const c=progressContext('tool','Compare GPT and Gemini','read_web_page',{url:'https://ai.google.dev/gemini-api/docs/pricing?key=TOKEN'});
 assert.equal(c.operation.subject,'Gemini');assert.doesNotMatch(JSON.stringify(detail(c)),/TOKEN/);
 const search=progressContext('tool','Compare AI models','web_search',{query:'site:openai.com GPT pricing latest'});
 assert.equal(researchNotice(search,'Reading Gemini.',true).subject,'GPT pricing');
});
test('English and Bangla subjects are required; repeated, generic or wrong-subject notices fail',()=>{
 const notice=detail(read()).researchNotice;
 for(const text of ['আচ্ছা, GPT-এর পেজটা পড়ে দেখি।','জিপিটির পেজটা পড়ছি।','Reading the GPT page.'])assert.equal(matchesResearchNotice(text,notice),true,text);
 for(const text of ['আচ্ছা, পেজটা পড়ে দেখি।','Reading the Gemini page.'])assert.equal(matchesResearchNotice(text,notice),false,text);
 assert.equal(matchesResearchNotice('Reading the GPT page.',{...notice,previousText:'Reading the GPT page!'}),false);
 assert.equal(matchesResearchNotice('গুগলের পেজটা পড়ছি।',{subject:'Google',previousText:''}),true);
});
test('failure wording retains subject and varies from the last notice',()=>{
 const c=detail(read());const first=researchNoticeFallback(c,'bn');assert.match(first,/GPT/);
 const next=researchNoticeFallback(detail(read(),first),'bn');assert.notEqual(next,first);assert.match(next,/GPT/);
 assert.match(researchNoticeFallback(c,'en'),/Reading.*GPT/);
 assert.equal(researchNotice(progressContext('tool','Open folder','open_in_explorer'),first,true),undefined);
});
test('generic follow-up audio is withheld and repaired once before subject-specific speech',async t=>{
 const f=fixture(t),played=[];const pending=f.voice.generate(detail(read()),'bn',new AbortController().signal,1000,x=>played.push(x));await tick();
 f.voice.receive(pcm);f.voice.receive(done('আচ্ছা, পেজটা পড়ে দেখি।'));assert.equal(played.length,0);assert.equal(f.sent.length,2);
 f.voice.receive(pcm);f.voice.receive(done('আচ্ছা, GPT-এর পেজটা পড়ে দেখি।'));const result=await pending;assert.match(result.text,/GPT/);assert.deepEqual(played,['PCM']);
});
test('persistent generic wording and false success never release audio',async t=>{
 const f=fixture(t),played=[];const pending=f.voice.generate(detail(read()),'en',new AbortController().signal,1000,x=>played.push(x));await tick();
 f.voice.receive(pcm);f.voice.receive(done('Reading the page.'));f.voice.receive(pcm);f.voice.receive(done('Reading the page.'));
 await assert.rejects(pending);assert.equal(played.length,0);
});
test('a success claim with the correct subject is still rejected before playback',async t=>{
 const f=fixture(t),played=[];const pending=f.voice.generate(detail(read()),'en',new AbortController().signal,1000,x=>played.push(x));await tick();
 f.voice.receive(pcm);f.voice.receive(done('I have completed reading the GPT page.'));await assert.rejects(pending);assert.equal(played.length,0);
});
test('wrong action is repaired even when the page subject is named',async t=>{
 const f=fixture(t);const pending=f.voice.generate(detail(read()),'en',new AbortController().signal,1000);await tick();
 f.voice.receive(pcm);f.voice.receive(done('Searching for GPT.'));assert.equal(f.sent.length,2);
 f.voice.receive(pcm);f.voice.receive(done('Reading the GPT page.'));assert.equal((await pending).text,'Reading the GPT page.');
});
test('stop during contextual generation discards old speech',async t=>{
 const f=fixture(t),controller=new AbortController(),played=[];const pending=f.voice.generate(detail(read()),'en',controller.signal,1000,x=>played.push(x));await tick();f.voice.receive(pcm);controller.abort();
 await assert.rejects(pending,/interrupted/);f.voice.receive(done('Reading the GPT page.'));assert.equal(played.length,0);
});
test('Fast selects a prepared first search and generated subject-specific next read',async t=>{
 global.window={speechSynthesis:{cancel(){},getVoices:()=>[]},orvixDesktop:{logLive(){}}};
 const generated=[],spoken=[];const v=new SimpleFastVoiceSession([],{onStatus(){},onTranscript:e=>{if(e.delivery==='complete')spoken.push(e.text);}});v.stopped=false;v.language='bn';
 v.audioEngine={hasPlayback:false,playAudio(_pcm,onset){onset?.();return Date.now();},close(){}};
 v.progressVoice={readiness:'ready',generate:async context=>{generated.push(context);return {text:'আচ্ছা, GPT-এর পেজটা পড়ে দেখি।',audio:['PCM'],generationMs:1};},close(){}};
 v.narrator={close(){}};v.evidenceNarrator={close(){}};t.after(()=>v.stop());
 assert.equal(await v.acknowledge(progressContext('tool','Search GPT','web_search',{query:'GPT'})),true);assert.equal(generated.length,0);
 assert.equal(await v.acknowledge(read()),true);assert.equal(generated.length,1);assert.equal(generated[0].researchNotice.subject,'GPT');assert.notEqual(spoken[0],spoken[1]);
 v.beginTask('Search another topic');assert.equal(v.recentAcknowledgments.length,0);
});
