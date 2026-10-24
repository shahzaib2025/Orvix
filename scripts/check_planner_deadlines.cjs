const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {configureOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {createEvidenceStore}=require('../electron/agent/evidence-store.cjs');
const {createExecutionMapStore}=require('../electron/agent/execution-map.cjs');
const {createDecisionPlanner}=require('../electron/agent/decision-planning.cjs');

function native(t,{progress=true,finish=true,setupMs=0,finishAfterMs=220}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-planner-deadline-'));let stream,interval,completion;const calls=[];
 t.after(()=>{clearInterval(interval);clearTimeout(completion);fs.rmSync(root,{recursive:true,force:true});});
 fs.writeFileSync(path.join(root,'opencode-free-catalog.json'),JSON.stringify({updatedAt:Date.now(),models:[{id:'opencode/fixture-free',name:'Fixture',route:'chat',variants:[],input:['text']}]}));
 const send=(type,properties)=>stream.enqueue(Buffer.from('data: '+JSON.stringify({type,properties:{sessionID:'deadline-session',...properties}})+'\n\n'));
 const runtime={status:()=>({}),exclusive:async(signal,callback)=>callback({workdir:root,supportsAsyncPrompts:true,
  prepareLocation:async(_directory,signal)=>{if(setupMs)await require('../electron/agent/opencode-headless.cjs').abortable(new Promise(resolve=>setTimeout(resolve,setupMs)),signal);},
  events:async()=>({body:new ReadableStream({start(c){stream=c;},cancel(){clearInterval(interval);clearTimeout(completion);}})}),
  api:async(endpoint,options={})=>{calls.push(endpoint);
   if(endpoint==='/session')return{id:'deadline-session'};
   if(endpoint.endsWith('/prompt_async')){
    send('message.updated',{info:{id:'assistant-1',role:'assistant',sessionID:'deadline-session',time:{created:Date.now()}}});
    interval=setInterval(()=>send(progress?'message.part.delta':'session.status',progress?{messageID:'assistant-1',delta:'x',field:'text'}:{status:{type:'busy'}}),25);
    if(finish)completion=setTimeout(()=>{clearInterval(interval);send('session.idle',{});},finishAfterMs);
    return null;
   }
   if(endpoint.endsWith('/message/assistant-1'))return{info:{id:'assistant-1',role:'assistant',time:{completed:Date.now()}},parts:[{type:'text',text:'{"status":"approved"}'}]};
   return true;
  }})};
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);return calls;
}
test('streaming analysis survives its inactivity interval and returns once completed',async t=>{
 const calls=native(t);const result=await runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,analysis:true,timeoutMs:600,idleTimeoutMs:90});
 assert.equal(JSON.parse(result.text).status,'approved');assert.equal(calls.filter(p=>p.endsWith('/prompt_async')).length,1);
});
test('busy events cannot keep a stalled planner alive',async t=>{
 const calls=native(t,{progress:false});await assert.rejects(runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,analysis:true,timeoutMs:600,idleTimeoutMs:90}),/response stalled/);
 assert.ok(calls.some(p=>p.endsWith('/abort')));assert.equal(calls.filter(p=>p.endsWith('/prompt_async')).length,1);
});
test('continuous output cannot exceed the total deadline',async t=>{
 native(t,{finish:false});await assert.rejects(runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,analysis:true,timeoutMs:180,idleTimeoutMs:90}),/task timed out/);
});
test('external cancellation interrupts an actively progressing planner',async t=>{
 native(t,{finish:false});const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),110);t.after(()=>clearTimeout(timer));
 await assert.rejects(runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,analysis:true,timeoutMs:600,idleTimeoutMs:90,signal:controller.signal}),/cancelled/);
});
test('a cold conversation gets its full response budget after bounded preparation, without replaying the prompt',async t=>{
 const calls=native(t,{setupMs:180,finishAfterMs:50});
 const result=await runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,conversation:true,timeoutMs:120,preparationTimeoutMs:600});
 assert.equal(JSON.parse(result.text).status,'approved');
 assert.equal(calls.filter(p=>p.endsWith('/prompt_async')).length,1);
});
test('conversation preparation has its own deadline and submits no prompt when it expires',async t=>{
 const calls=native(t,{setupMs:180});
 await assert.rejects(runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,conversation:true,timeoutMs:120,preparationTimeoutMs:60}),/preparation timed out before submitting/);
 assert.equal(calls.filter(p=>p.endsWith('/prompt_async')).length,0);
});
test('user cancellation remains effective during cold conversation preparation',async t=>{
 const calls=native(t,{setupMs:180}),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),50);t.after(()=>clearTimeout(timer));
 await assert.rejects(runOpenCodeSession({modelId:'opencode/fixture-free',parts:[],readOnly:true,conversation:true,timeoutMs:120,preparationTimeoutMs:600,signal:controller.signal}),/cancelled/);
 assert.equal(calls.filter(p=>p.endsWith('/prompt_async')).length,0);
});
test('a resumed run retries unavailable acceptance once, while reusing approved plans',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-planner-resume-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app={getPath:()=>root},evidence=createEvidenceStore(app),execution=createExecutionMapStore(app,evidence);
 execution.ensure('task','turn','Repair the requested behavior','Full access');execution.update('task','turn',{replace_initial_goal:true,requirements:[{id:'behavior',text:'Requested behavior works',verification_types:['focused']}]});
 const args={execution,evidence,taskId:'task',requestId:'turn',signal:new AbortController().signal,publish(){}};let unavailableCalls=0;
 const first=createDecisionPlanner({...args,review:async()=>{unavailableCalls++;throw Error('OpenCode task timed out');}});
 assert.equal((await first.preflight({})).status,'unavailable');await first.preflight({});assert.equal(unavailableCalls,1);
 let retryCalls=0;const resumed=createDecisionPlanner({...args,review:async()=>{retryCalls++;return JSON.stringify({status:'approved',missingRequirements:[],reason:'Observed check planned',criteria:[{id:'works',requirementId:'behavior',description:'Behavior',observable:'Actual behavior matches requested result',negativeCase:'Incorrect behavior fails',method:'command'}]});}});
 assert.equal((await resumed.preflight({})).status,'approved');await resumed.preflight({});assert.equal(retryCalls,1);
 const approved=createDecisionPlanner({...args,review:async()=>{throw Error('Approved plan must be reused');}});assert.equal((await approved.preflight({})).status,'approved');
});
