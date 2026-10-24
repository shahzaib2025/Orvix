const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path'),Module=require('node:module');
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,external:['@google/genai'],logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');
const {FastProgressVoice,validProgress}=load('fastProgressVoice.ts');
const {toolAcknowledgment}=load('fastToolAcknowledgment.ts');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(t){
  const events=[],transcripts=[];let playing=0;
  global.window={speechSynthesis:{cancel(){},getVoices:()=>[]},orvixDesktop:{logLive(_kind,message,details){events.push({message,details});}}};
  const v=new SimpleFastVoiceSession([],{onStatus(){},onTranscript:e=>transcripts.push(e)});
  // These fixtures exercise the bounded generation/recovery path separately
  // from the bundled speech path tested below.
  v.preparedAcknowledgment=()=>undefined;
  v.stopped=false;v.kick=()=>{};v.beginTask('Do these requested operations');v.language='bn';
  v.audioEngine={get hasPlayback(){return playing>0;},playAudio(_pcm,onStart){playing++;setTimeout(()=>{events.push({message:'onset'});onStart?.();},5);setTimeout(()=>{playing--;if(!playing){for(const r of v.playbackWaiters)r();v.playbackWaiters.clear();}},15);return Date.now()+5;},clearPlayback(){playing=0;},close(){playing=0;}};
  v.progressVoice={readiness:'ready',close(){},generate:async c=>({text:toolAcknowledgment(c,'bn'),audio:['PCM'],generationMs:1})};
  v.narrator={close(){},render:async()=>['PCM']};
  v.dispatch=async(name,args)=>{events.push({message:'dispatch',name,args});return {status:'ok'};};v.ensureTask=async()=>{};
  t.after(()=>v.stop());return {v,events,transcripts};
}
test('each of five sequential tools starts after its own spoken phrase; results wait for drain',async t=>{
 const f=fixture(t),calls=[{name:'browser_act',args:{action:'youtube_search',args:{query:'Anupam Roy'}}},{name:'browser_observe',args:{scope:'page'}},{name:'browser_act',args:{action:'click',args:{target:'observed'}}},{name:'browser_act',args:{action:'pause',args:{}}},{name:'list_directory',args:{path:'Desktop'}}];
 for(let i=0;i<calls.length;i++){const before=f.events.length;await f.v.runTool({...calls[i],id:'call-'+i});const e=f.events.slice(before);assert.equal(e.filter(x=>x.message==='dispatch').length,1);assert.ok(e.findIndex(x=>x.message==='onset')<e.findIndex(x=>x.message==='dispatch'));assert.equal(f.v.audioEngine.hasPlayback,false);}
 const complete=f.transcripts.filter(x=>x.delivery==='complete');assert.equal(complete.length,5);for(const e of complete){assert.ok(validProgress(e.text),e.text);assert.ok(e.text.trim().split(/\s+/).length>=2);}
});

test('bundled speech gives every multistep tool immediate onset even with provider offline',async t=>{
 const f=fixture(t);delete f.v.preparedAcknowledgment;
 const {preparedToolAcknowledgment}=load('fastPreparedAcknowledgment.ts');f.v.preparedAcknowledgment=preparedToolAcknowledgment;
 let generations=0;f.v.progressVoice.generate=async()=>{generations++;throw Error('Provider offline');};
 const delays=[];
 for(const call of [{name:'web_search',args:{query:'solar panels'}},{name:'read_web_page',args:{url:'https://example.com'}},{name:'browser_observe',args:{}},{name:'browser_act',args:{action:'pause'}},{name:'list_directory',args:{path:'Desktop'}}]){
   const start=performance.now(),before=f.events.length;
   await f.v.runTool(call);const events=f.events.slice(before),onset=events.find(e=>e.message.endsWith('Acknowledgment audio onset'));
   assert.ok(onset,'Own speech onset');assert.ok(onset.details.elapsedMs<100);delays.push(onset.details.elapsedMs);
   assert.ok(events.findIndex(e=>e.message==='onset')<events.findIndex(e=>e.message==='dispatch'));
   assert.ok(performance.now()-start<1000);
 }
 assert.equal(generations,0);assert.equal(f.transcripts.filter(e=>e.delivery==='complete').length,5);
});

test('browser inventory does not delay or precede the spoken action notice',async t=>{
 const f=fixture(t);window.orvixDesktop.browserObserve=async()=>{f.events.push({message:'inventory'});return {observation:{tabs:[]}};};
 // Real dispatch preflight resides inside execute, before the injected dispatch.
 await f.v.runTool({name:'browser_act',args:{action:'youtube_search',args:{query:'song'}}});
 assert.ok(f.events.findIndex(e=>e.message==='onset')<f.events.findIndex(e=>e.message==='inventory'));
});

test('PC status request forces an acknowledged read before provider reporting',async t=>{
 const f=fixture(t);f.v.beginTask('accha pc status dekho to');assert.equal(f.v.firstOperation.name,'get_pc_status');
 await f.v.runTool(f.v.firstOperation);assert.equal(f.transcripts.filter(e=>e.delivery==='complete').length,1);
});

test('every action category has usable prepared Bangla and English speech',()=>{
 const {preparedToolAcknowledgment}=load('fastPreparedAcknowledgment.ts');
 const calls=[{name:'web_search'},{name:'read_web_page'},{name:'get_pc_status'},...['search','pause','play','select','open','minimize','maximize','restore','focus','close','click','scroll'].map(action=>({name:'browser_act',action})),{name:'list_directory'},{name:'read_file'},{name:'write_file'},{name:'get_weather'},{name:'unknown'}];
 for(const language of ['bn','en'])for(const operation of calls){
   const clip=preparedToolAcknowledgment({stage:'tool',goal:'Private content must not enter prepared speech',operation},language);
   assert.ok(clip,language+' '+JSON.stringify(operation));assert.ok(validProgress(clip.text),clip.text);
   assert.ok(clip.text.trim().split(/\s+/).length>=2);assert.equal(clip.generationMs,0);
   const pcm=Buffer.from(clip.audio.join(''),'base64');assert.equal(pcm.length%2,0);assert.ok(pcm.length>2400);
   let first=0;while(first+1<pcm.length&&Math.abs(pcm.readInt16LE(first))<=33)first+=2;
   assert.ok(first/48<=25,'Leading silence must remain under 25 ms');
 }
});

test('work selection receives an immediate notice but conversation has none',async t=>{
 const f=fixture(t);f.v.beginTask('Open YouTube and play a song');assert.equal(f.v.taskAckPending,true);
 await f.v.acknowledgeTask();assert.equal(f.transcripts.filter(e=>e.delivery==='complete').length,1);
 f.v.beginTask('hi');assert.equal(f.v.taskAckPending,false);
});

test('non-blocking read results settle once with WHEN_IDLE scheduling',async t=>{
 const f=fixture(t),responses=[];f.v.session={sendToolResponse:r=>responses.push(r),close(){}};
 const receipt=await f.v.runTool({id:'nonblocking',name:'web_search',args:{query:'example'}});
 assert.equal(f.v.audioEngine.hasPlayback,false);f.v.pendingResponses.push(receipt);f.v.submitResults();
 assert.equal(responses.length,1);assert.equal(responses[0].functionResponses[0].scheduling,'WHEN_IDLE');
 assert.equal(responses[0].functionResponses[0].willContinue,false);
});
test('timeout recovers with action-specific speech before dispatch',async t=>{
 const f=fixture(t);f.v.progressVoice.generate=async()=>{throw Error('Progress generation timed out.');};
 await f.v.runTool({id:'fallback',name:'browser_act',args:{action:'youtube_search',args:{query:'song'}}});
 assert.equal(f.events.filter(e=>e.message==='dispatch').length,1);assert.ok(f.events.findIndex(e=>e.message==='onset')<f.events.findIndex(e=>e.message==='dispatch'));assert.equal(f.transcripts.at(-1).delivery,'complete');assert.equal(f.transcripts.at(-1).text,'আচ্ছা, খুঁজে দেখি।');
});
test('quick window mutations also receive their own phrase',async t=>{
 const f=fixture(t);const receipt=await f.v.runTool({id:'window',name:'manage_window',args:{appName:'Notepad',action:'minimize'}});
 assert.equal(receipt.result.status,'ok');assert.equal(f.transcripts.filter(e=>e.delivery==='complete').length,1);assert.ok(f.events.findIndex(e=>e.message==='onset')<f.events.findIndex(e=>e.message==='dispatch'));
});
test('empty provider audio also recovers instead of silently running the tool',async t=>{
 const f=fixture(t);f.v.progressVoice.generate=async()=>({text:'আচ্ছা, খুঁজে দেখি।',audio:[],generationMs:1});
 await f.v.runTool({name:'browser_act',args:{action:'youtube_search',args:{query:'song'}}});assert.equal(f.events.filter(e=>e.message==='dispatch').length,1);assert.ok(f.events.some(e=>e.message.endsWith('Acknowledgment voice recovering')));
});
test('all speech failures leave the tool undispatched',async t=>{
 const f=fixture(t);f.v.progressVoice.generate=async()=>{throw Error('timeout');};f.v.narrator.render=async()=>{throw Error('renderer unavailable');};
 const result=await f.v.runTool({name:'browser_act',args:{action:'youtube_search',args:{query:'song'}}});assert.equal(result.result.status,'acknowledgment_unavailable');assert.equal(result.result.dispatched,false);assert.equal(f.events.filter(e=>e.message==='dispatch').length,0);
});
test('silent PCM without audio onset cannot release dispatch',async t=>{
 const f=fixture(t);f.v.audioEngine.playAudio=()=>undefined;
 const result=await f.v.runTool({name:'browser_observe',args:{scope:'page'}});assert.equal(result.result.dispatched,false);assert.equal(f.events.filter(e=>e.message==='dispatch').length,0);
});
test('interruption while preparing fallback prevents stale speech and dispatch',async t=>{
 const f=fixture(t);let finish;f.v.progressVoice.generate=async()=>{throw Error('timeout');};f.v.narrator.render=()=>new Promise(r=>finish=r);
 const pending=f.v.runTool({name:'browser_observe',args:{scope:'page'}});while(!finish)await tick();f.v.interruptCurrent('typed');finish(['PCM']);await pending;assert.equal(f.events.filter(e=>e.message==='dispatch').length,0);assert.equal(f.events.filter(e=>e.message==='onset').length,0);
});
test('validated buffered acknowledgment may finish after startup deadline',async t=>{
 const v=new FastProgressVoice();v.session={sendClientContent(){},close(){}};t.after(()=>v.close());
 const pending=v.generate({stage:'tool',goal:'Find song',operation:{name:'browser_act',action:'youtube_search'},acceptCompleteLength:false},'bn',new AbortController().signal,80);
 await tick();v.receive({serverContent:{modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]}}});await new Promise(r=>setTimeout(r,120));
 v.receive({serverContent:{outputTranscription:{text:'আচ্ছা, গানটা খুঁজে দেখি।'},turnComplete:true}});assert.equal((await pending).audio.length,1);
});
test('one-word provider speech is repaired before any playback',async t=>{
 const v=new FastProgressVoice();let sends=0;v.session={sendClientContent(){sends++;},close(){}};t.after(()=>v.close());
 const pending=v.generate({stage:'tool',goal:'Find song',operation:{name:'browser_act',action:'youtube_search'}},'bn',new AbortController().signal,500);await tick();
 v.receive({serverContent:{outputTranscription:{text:'আচ্ছা।'},turnComplete:true}});assert.equal(sends,2);
 v.receive({serverContent:{outputTranscription:{text:'আচ্ছা, গানটা খুঁজে দেখি।'},modelTurn:{parts:[{inlineData:{data:'PCM',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});assert.equal((await pending).text,'আচ্ছা, গানটা খুঁজে দেখি।');
});
