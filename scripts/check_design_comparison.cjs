const test=require('node:test'),assert=require('node:assert/strict');
const {boundedComparison,compactRecords,compactBrief}=require('../electron/agent/design-comparison.cjs');
const {createDesignDiversity}=require('../electron/agent/design-diversity.cjs');
const {createDesignReview}=require('../electron/agent/design-review.cjs');
const {createVisualAssetLookup}=require('../electron/agent/visual-asset-search.cjs');
const signal=()=>new AbortController().signal;
const brief={audience:'Readers',primary_action:'Read',direction:'A full-width typographic opening',signature:'Dominant text',responsive:'Stacked',storyboard:'Large full-width headline above a small bottom artwork; supporting sections follow.'};
const composition={version:1,hero:{relationship:'text-left-media-right',media:'image',text:{x:.1,y:.2,width:.4,height:.4},focal:{x:.6,y:.2,width:.3,height:.5}},sections:[{purpose:'hero',layout:'columns',columns:2,groupCount:2,media:['image'],x:0,y:0,width:1,height:1}]};
const prior=[{taskId:'earlier',brief:{direction:'Split text and tilted paper artwork'},observedComposition:{version:1,views:[{width:1440,composition}]}}];
test('one failed comparison is retried with real provider cancellation and the reply is validated',async()=>{
 let calls=0,firstSignal;
 const result=await boundedComparison(async(_p,_i,_purpose,options)=>{
  calls++;if(calls===1){firstSignal=options.signal;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
  assert.ok(firstSignal.aborted);return{text:'{"status":"distinct","summary":"Different"}'};
 },'compact',{signal:signal(),timeoutMs:10,validate:x=>assert.ok(x.status)});
 assert.equal(calls,2);assert.equal(result.retryUsed,true);assert.equal(result.value.status,'distinct');
});
test('invalid replies exhaust only one retry; quota errors are not retried',async()=>{
 let calls=0;
 const failed=await boundedComparison(async()=>{calls++;return{text:'invalid'};},'compact');
 assert.equal(calls,2);assert.equal(failed.value.status,'unavailable');
 calls=0;await boundedComparison(async()=>{calls++;throw Error('HTTP 403');},'compact');assert.equal(calls,1);
});
test('outer cancellation is propagated instead of becoming an unverified comparison',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(boundedComparison(async()=>assert.fail('No call'),'',{signal:controller.signal}));
});
test('cancelling an active comparison aborts its provider request and prevents retry',async()=>{
 const controller=new AbortController();let calls=0,providerSignal;
 const pending=boundedComparison(async(_p,_i,_purpose,options)=>{
  calls++;providerSignal=options.signal;
  return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Cancelled provider')),{once:true}));
 },'',{signal:controller.signal});
 controller.abort(Error('Stop requested'));
 await assert.rejects(pending,/Stop requested|Cancelled provider/);assert.equal(calls,1);assert.ok(providerSignal.aborted);
});
test('sanitized compact evidence excludes URLs, copy and private fields, caps records and retains hero geometry',()=>{
 const records=compactRecords(Array.from({length:8},()=>({...prior[0],privateChat:'secret',image:{file:'private.png'}})));
 assert.equal(records.length,3);assert.equal(records[0].observed[0].hero.relationship,'text-left-media-right');
 assert.doesNotMatch(JSON.stringify(records),/secret|private.png/);
 assert.equal(compactBrief({...brief,storyboard:'x'.repeat(10000)}).storyboard.length,1500);
});
test('retry use persists across candidates/resume and unavailable is not cached as accepted',async()=>{
 let calls=0;const compare=async()=>{calls++;throw Error('Provider offline');};
 const guard=createDesignDiversity({prior,signal:signal(),compare});
 assert.equal((await guard.check(brief)).status,'unavailable');assert.equal(calls,2);assert.equal(guard.snapshot().accepted,null);
 const restored=createDesignDiversity({prior,signal:signal(),compare,saved:guard.snapshot()});
 await restored.check({...brief,direction:'Another arrangement'});assert.equal(calls,3);assert.equal(restored.snapshot().retryUsed,true);
});
test('reported comparison count reflects the compact three-record evidence set',async()=>{
 const records=Array.from({length:6},(_,i)=>({...prior[0],taskId:'earlier-'+i}));
 const guard=createDesignDiversity({prior:records,signal:signal(),compare:async()=>({text:'{"status":"distinct","summary":"Different against supplied records"}'})});
 assert.equal((await guard.check(brief)).compared,3);
});
for(const profile of ['normal','medium','max'])test(`${profile} rendered drift has one correction, two source checks and no visual critic under Off`,async()=>{
 let rendered=0;const purposes=[];
 const design=createDesignReview({enabled:true,profile,mode:'off',brief:'Create a new website',priorDesigns:prior,signal:signal(),evidence:{record:()=>({id:'test'})},
  review:async(_text,_images,purpose)=>{purposes.push(purpose);return{text:JSON.stringify(purpose==='originality'?{status:'distinct',summary:'Different proposal'}:
   ++rendered===1?{status:'drifted',summary:'Reverted to prior split',observation:'Headline/action occupy the same left block and focal artwork the same right column',matchedTaskId:'earlier'}:{status:'matches',summary:'Chosen geometry observed'})};}});
 await design.setBrief(brief);
 const result=()=>({views:[{width:1440,metrics:{composition}}]});
 const first=result();await design.capture(first,{},'source-1');
 assert.equal(first.compositionCheck.status,'drifted');assert.match((await design.evaluate('source-1')).feedback,/single targeted correction/);
 assert.equal((await design.evaluate('source-1')).feedback,undefined);
 await design.capture(result(),{},'source-1');assert.equal(rendered,1);
 await design.capture(result(),{},'source-2');assert.equal(rendered,2);
 assert.equal((await design.evaluate('source-2')).feedback,undefined);
 await design.capture(result(),{},'source-3');assert.equal(rendered,2);
 assert.match(design.summary(),/unverified after the final source/);
 assert.deepEqual(purposes,['originality','composition','composition']);assert.equal(design.snapshot().reviews.length,0);
});
test('None, repair and fidelity do not acquire rendered comparison',async()=>{
 for(const [profile,request] of [['none','Create a website'],['max','Fix this website'],['medium','Recreate the same design of this website']]){
  const design=createDesignReview({enabled:profile!=='none',profile,mode:'off',brief:request,priorDesigns:prior,signal:signal(),evidence:{record:()=>({id:'test'})},review:async()=>assert.fail('Excluded work')});
  await design.capture({views:[{width:1440,metrics:{composition}}]}, {},'source');
  assert.equal(design.snapshot().renderChecks,undefined);
 }
});
test('Off summaries expose unavailable originality rather than suggesting approval',async()=>{
 const design=createDesignReview({enabled:true,profile:'normal',mode:'off',brief:'Create a website',priorDesigns:prior,signal:signal(),evidence:{record:()=>({id:'test'})},review:async()=>{throw Error('Provider offline');}});
 await design.setBrief(brief);assert.match(design.summary(),/Originality unverified/);assert.equal(design.snapshot().diversity.accepted,null);
});
test('asset lookup reuses identical searches, preserves unavailable provider and resets for a new run',async()=>{
 let calls=0;const search=async input=>{calls++;return{status:'unavailable',query:input.query,message:'No Serper keys configured.',provider:'google'};};
 const lookup=createVisualAssetLookup(search),input={provider:'google',query:'Paper',signal:signal()};
 await lookup(input);assert.equal((await lookup({...input,query:'Different paper'})).cached,true);assert.equal(calls,1);
 await createVisualAssetLookup(search)(input);assert.equal(calls,2);
 let successCalls=0;const success=createVisualAssetLookup(async()=>{successCalls++;return{status:'found',results:[]};});
 await Promise.all([success(input),success({...input,query:' paper '})]);assert.equal(successCalls,1);
});
test('direct composition inspection uses its own read-only system contract',()=>{
 const {instructionsFor}=require('../electron/agent/model-client.cjs');
 assert.match(instructionsFor(null,'Plan','design_composition'),/status:"matches"\|"drifted"\|"unavailable"/);
});
test('ordinary read-only conversation does not select the JSON analysis agent',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
 const {configureOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-analysis-scope-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'opencode-free-catalog.json'),JSON.stringify({updatedAt:Date.now(),models:[{id:'opencode/fixture',name:'Fixture',route:'chat',input:['text'],variants:[]}]}));
 const agents=[];
 const runtime={status:()=>({}),exclusive:async(_signal,callback)=>callback({workdir:root,
  api:async(endpoint,options)=>{
   if(endpoint==='/session')return{id:'scoped'};
   if(endpoint.endsWith('/message')){agents.push(options.body.agent);return{info:{},parts:[{type:'text',text:'Hello'}]};}
   return true;
  },events:async()=>({body:new ReadableStream({start(){}})})})};
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 assert.equal((await runOpenCodeSession({modelId:'opencode/fixture',readOnly:true,parts:[]})).text,'Hello');
 await runOpenCodeSession({modelId:'opencode/fixture',readOnly:true,analysis:true,parts:[]});
 assert.deepEqual(agents,['build','orvix_review']);
});
