const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {isolatedConfig}=require('../electron/agent/opencode-headless.cjs');
const {isReadOnlyCommand,isDiagnosisOnly}=require('../electron/agent/read-only-command.cjs');
const {terminalQuota,transientFailure}=require('../electron/agent/model-failure-policy.cjs');
const {requestWithRetry}=require('../electron/agent/model-retry.cjs');
const {createChangeStore}=require('../electron/agent/change-store.cjs');
const {createRunJournal}=require('../electron/agent/run-journal.cjs');
const {configureOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {createRuntimeLease}=require('../electron/agent/opencode-runtime-lease.cjs');
const {createRunState}=require('../electron/agent/run-state.cjs');
function temporary(t,prefix){const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return root;}

test('runtime ownership stores encrypted auth, verifies health and never clears another owner',async t=>{
 const root=temporary(t,'orvix-owner-');const storage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text).map(byte=>byte^173),decryptString:buffer=>Buffer.from(buffer).map(byte=>byte^173).toString()};
 const lease=createRuntimeLease(root,{safeStorage:storage}),record=lease.save(process.pid,9340,'private-local-server-auth','owned.exe');
 assert.equal(fs.readFileSync(path.join(root,'runtime-owner.json'),'utf8').includes('private-local-server-auth'),false);
 let healthCalls=0;const restored=await lease.reconnect(async(url,options)=>{healthCalls++;assert.equal(url,'http://127.0.0.1:9340/global/health');assert.equal(options.headers.Authorization,'private-local-server-auth');return{ok:true,json:async()=>({healthy:true})};});assert.equal(restored.pid,process.pid);assert.equal(healthCalls,1);
 lease.clear('another-owner');assert.ok(lease.read());lease.clear(record.owner);assert.equal(lease.read(),null);
});

test('runtime reconnection refuses an unrecoverable credential and a live different app owner',async t=>{
 const root=temporary(t,'orvix-owner-guard-'),lease=createRuntimeLease(root,{safeStorage:{isEncryptionAvailable:()=>false}});lease.save(process.pid,9340,'private','owned.exe');
 await assert.rejects(lease.reconnect(async()=>{throw Error('must not fetch');}),/authentication cannot be recovered/);
 const file=path.join(root,'runtime-owner.json'),record=lease.read();fs.writeFileSync(file,JSON.stringify({...record,parentPid:process.ppid}));
 await assert.rejects(lease.reconnect(async()=>{throw Error('must not fetch');}),/live owner process/);
});
test('native agents have no iteration cap and automatic compaction preserves task constraints',()=>{
 const c=isolatedConfig();assert.equal(c.agent.build.steps,undefined);assert.equal(c.agent.plan.steps,undefined);assert.equal(c.compaction.auto,true);assert.equal(c.compaction.prune,true);assert.notEqual(c.agent.compaction.disable,true);assert.match(c.agent.compaction.prompt,/latest human request/);assert.match(c.agent.compaction.prompt,/interrupted operations/);
});

test('long run working history stays bounded while timing totals and archived records survive restart',t=>{
 const root=temporary(t,'orvix-long-history-'),app={getPath:()=>root},state=createRunState(app),id=state.begin({taskId:'task',requestId:'request',modelId:'fixture',accessMode:'Full access',messages:[]});
 state.tool(id,{callId:'active',name:'read',phase:'started'});
 for(let i=0;i<620;i++)state.tool(id,{callId:'call-'+i,name:'bash',phase:'completed',failed:i%10===0,durationMs:5});
 assert.equal(state.latest('task').toolCount,621);assert.equal(state.latest('task').activeTool.id,'active');assert.equal(state.scorecard().tools.find(row=>row.name==='bash').count,620);assert.equal(state.scorecard().tools.find(row=>row.name==='bash').failed,62);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'agent-attempts',id+'.json'),'utf8'));assert.equal(saved.tools.length,200);assert.equal(fs.readFileSync(path.join(root,'agent-attempts',id+'.tools.jsonl'),'utf8').trim().split('\n').length,421);
 const restarted=createRunState(app);assert.equal(restarted.latest('task').toolCount,621);assert.equal(restarted.scorecard().tools.find(row=>row.name==='bash').totalMs,3100);restarted.forget('task');assert.equal(fs.existsSync(path.join(root,'agent-attempts',id+'.tools.jsonl')),false);
});
test('only conservative observation commands bypass write tracking',()=>{
 for(const command of ['Get-ChildItem -LiteralPath "C:\\project with spaces"','Get-Content package.json | Select-Object -First 8','Get-Process; Get-Location','rg --files src','pwd'])assert.equal(isReadOnlyCommand(command),true,command);
 for(const command of ['Remove-Item x','Get-Content x > report.txt','Get-Content x; npm install','rg --pre="node edit.js" src','node -e "require(\"fs\").writeFileSync(\"x\",\"y\")"','Get-Content $secret','type %EVIL%','Get-ChildItem | ForEach-Object { Remove-Item $_ }','npx tsc --noEmit','Get-Content "unterminated'])assert.equal(isReadOnlyCommand(command),false,command);
 assert.equal(isDiagnosisOnly('Find the bugs, dont edit anything'),true);assert.equal(isDiagnosisOnly('Yes, implement the repair'),false);
 assert.equal(isDiagnosisOnly('Fix the bug; do not change the API behavior'),false);assert.equal(isDiagnosisOnly('Fix the read-only table display'),false);assert.equal(isDiagnosisOnly('Find problems, dont code'),true);
});
test('temporary limits recover while quota and authentication failures terminate',()=>{
 for(const message of ['HTTP 429: temporarily rate limited','fetch failed ECONNRESET','OpenCode event connection closed','Cannot connect to API: socket closed','HTTP 503'])assert.equal(transientFailure(new Error(message)),true,message);
 for(const message of ['HTTP 429 insufficient_quota','HTTP 402 Payment required','HTTP 403 access denied','HTTP 401 invalid key','Task cancelled.'])assert.equal(transientFailure(new Error(message)),false,message);
 assert.equal(terminalQuota('daily limit reached'),true);
});
test('executor retries past the old two-attempt cap without running tools again',async()=>{
 let calls=0,retries=0;const signal=new AbortController().signal;
 const result=await requestWithRetry({signal,retryPolicy:{baseDelayMs:0}},()=>retries++,async()=>{if(++calls<7)throw Error('fetch failed');return{text:'done'};});
 assert.equal(result.text,'done');assert.equal(calls,7);assert.equal(retries,6);
});
test('reviews and explicit retry bounds stay bounded; cancellation stops backoff',async()=>{
 let calls=0;await assert.rejects(requestWithRetry({purpose:'completion_review',signal:new AbortController().signal,retryPolicy:{baseDelayMs:0}},null,async()=>{calls++;throw Error('HTTP 503');}),/503/);assert.equal(calls,3);
 calls=0;await assert.rejects(requestWithRetry({signal:new AbortController().signal,retryPolicy:{maxRetries:0}},null,async()=>{calls++;throw Error('HTTP 503');}),/503/);assert.equal(calls,1);
 const controller=new AbortController();await assert.rejects(requestWithRetry({signal:controller.signal},()=>controller.abort(),async()=>{throw Error('fetch failed');}),/cancelled/);
});
test('file-scoped tracking works in a project above 6000 files and survives restart',async t=>{
 const root=temporary(t,'orvix-large-scope-'),project=path.join(root,'project'),data=path.join(root,'data');fs.mkdirSync(project);
 for(let i=0;i<6005;i++)fs.writeFileSync(path.join(project,'unrelated-'+i+'.txt'),'unchanged');
 const file=path.join(project,'target.js');fs.writeFileSync(file,'before');const app={getPath:()=>data};const store=createChangeStore(app);
 await assert.rejects(store.register('task',project),/cannot be tracked completely/);
 await store.registerFiles('task',[file]);fs.writeFileSync(file,'after');await store.scan('task');assert.equal(store.list('task').length,1);assert.equal(store.diff('task',file).before,'before');assert.equal(store.diff('task',file).after,'after');
 const restarted=createChangeStore(app);fs.writeFileSync(file,'after restart');await restarted.scan('task');assert.equal(restarted.diff('task',file).before,'before');assert.equal(restarted.diff('task',file).after,'after restart');
 restarted.restore('task',file);await restarted.scan('task');assert.equal(fs.readFileSync(file,'utf8'),'before');assert.equal(restarted.list('task').length,0);
});
test('scoped tracking records creation/deletion and unchanged scans do not rewrite the manifest',async t=>{
 const root=temporary(t,'orvix-scope-stable-'),file=path.join(root,'project','new.js');fs.mkdirSync(path.dirname(file));const store=createChangeStore({getPath:()=>path.join(root,'data')});
 await store.registerFiles('task',[file]);const initial=store.fingerprintRevision('task');await store.scan('task');assert.equal(store.fingerprintRevision('task'),initial);
 fs.writeFileSync(file,'created');await store.scan('task');assert.equal(store.list('task')[0].kind,'created');const stable=store.fingerprintRevision('task');await store.scan('task');assert.equal(store.fingerprintRevision('task'),stable);
 fs.unlinkSync(file);await store.scan('task');assert.equal(store.list('task').length,0);
 const existing=path.join(root,'project','old.js');fs.writeFileSync(existing,'keep');await store.registerFiles('task',[existing]);fs.unlinkSync(existing);await store.scan('task');assert.equal(store.list('task')[0].kind,'deleted');
});
test('scoped registration retains concurrent file records and excludes credential files',async t=>{
 const root=temporary(t,'orvix-scope-concurrent-'),store=createChangeStore({getPath:()=>path.join(root,'data')});const a=path.join(root,'a.js'),b=path.join(root,'b.js');fs.writeFileSync(a,'a');fs.writeFileSync(b,'b');
 await Promise.all([store.registerFiles('task',[a]),store.registerFiles('task',[b])]);fs.writeFileSync(a,'aa');fs.writeFileSync(b,'bb');await store.scan('task');assert.equal(store.list('task').length,2);
 await assert.rejects(store.registerFiles('task',[path.join(root,'.env')]),/Protected/);
});
test('native checkpoints expose reconnection without replaying unknown operations',t=>{
 const root=temporary(t,'orvix-native-checkpoint-'),journal=createRunJournal({getPath:()=>root});journal.write({taskId:'task',requestId:'request',modelId:'opencode/fixture-free',history:[],accessMode:'Full access',nativeSession:{sessionID:'retained',status:'failed',pendingTools:{call:{name:'write',status:'running'}}}});
 const saved=journal.recover('task');assert.equal(saved.safe,true);assert.match(saved.reason,/Reconnect/);assert.equal(saved.state.nativeSession.pendingTools.call.name,'write');
 journal.write({...saved.state,nativeSession:{...saved.state.nativeSession,status:'completed'}});assert.equal(journal.recover('task').safe,false);
});
function nativeFixture(t,kind){
 const root=temporary(t,'orvix-session-continuity-');fs.writeFileSync(path.join(root,'opencode-free-catalog.json'),JSON.stringify({updatedAt:Date.now(),models:[{id:'opencode/fixture-free',name:'Fixture',route:'chat',variants:[],input:['text']}]}));
 const calls=[],messages=[],checkpoints=[],activity=[];let stream,rounds=0,busy=false,serial=0,mutations=0,context='',failedGet=false;
 const emit=event=>{if(stream?.desiredSize!==null)stream.enqueue(Buffer.from('data: '+JSON.stringify(event)+'\n\n'));};
 const storeAssistant=(text,error,parts=[])=>{const info={id:'msg_ai_'+(++serial),sessionID:'retained',role:'assistant',parentID:messages.findLast(m=>m.info.role==='user')?.info.id,time:{created:serial,completed:serial},finish:error?'error':'stop',tokens:{input:7,output:3,reasoning:1,total:11},...(error?{error}:{})};const message={info,parts:[...(text?[{type:'text',text,messageID:info.id}]:[]),...parts]};messages.push(message);return message;};
 const finish=(text='Done')=>{const message=storeAssistant(text);busy=false;emit({type:'message.updated',properties:{info:message.info}});emit({type:'session.idle',properties:{sessionID:'retained'}});};
 const runtime={status:()=>({}),exclusive:async(_,callback)=>callback({workdir:root,supportsAsyncPrompts:true,
  api:async(endpoint,options={})=>{
   calls.push({endpoint,method:options.method,body:options.body ? structuredClone(options.body) : undefined});
   if(endpoint==='/session'&&options.method==='POST')return{id:'retained'};
   if(endpoint==='/session/retained')return{id:'retained'};
   if(endpoint==='/session/status')return busy?{retained:{type:'busy'}}:{};
   if(endpoint==='/permission'||endpoint==='/question')return[];
   if(endpoint.startsWith('/session/retained/message')&&options.method!=='POST'){if(endpoint.includes('?'))return messages;if(kind==='final-get'&&!failedGet){failedGet=true;throw Error('fetch failed');}const id=endpoint.split('/').at(-1);return messages.find(m=>m.info.id===id)??messages;}
   if(endpoint==='/session/retained/message'&&options.body?.noReply){context=options.body.parts[0].text;messages.push({info:{id:options.body.messageID,role:'user',sessionID:'retained'},parts:options.body.parts});return messages.at(-1);}
   if(endpoint.endsWith('/prompt_async')){
    rounds++;busy=true;messages.push({info:{id:options.body.messageID,sessionID:'retained',role:'user'},parts:options.body.parts});
    queueMicrotask(()=>{
     emit({type:'message.updated',properties:{info:messages.at(-1).info}});
     if(kind==='quota-resume'&&options.body.parts[0].text==='Original authorized task'){
      mutations++;emit({type:'message.part.updated',properties:{part:{sessionID:'retained',type:'tool',tool:'write',id:'part-before-quota',callID:'write-once',messageID:'msg_ai_tool',state:{status:'completed',input:{filePath:path.join(root,'retained.txt')},output:'Written once',time:{start:1,end:2}}}}});
     }
     if(kind==='quota'||kind==='quota-resume'&&rounds===1){storeAssistant('',{name:'APIError',data:{message:'insufficient_quota',statusCode:429}});busy=false;emit({type:'session.error',properties:{sessionID:'retained',error:{name:'APIError',data:{message:'insufficient_quota',statusCode:429}}}});return;}
     if(kind==='transient'&&rounds===1){storeAssistant('',{name:'APIError',data:{message:'Temporary upstream problem',statusCode:503}});busy=false;emit({type:'session.error',properties:{sessionID:'retained',error:{name:'APIError',data:{message:'Temporary upstream problem',statusCode:503}}}});return;}
     if(kind==='disconnect'){mutations++;storeAssistant('Recovered answer',null,[{type:'tool',tool:'write',callID:'once',id:'part-once',state:{status:'completed',input:{filePath:path.join(root,'output.js')},output:'Written',time:{start:1,end:2}}}]);busy=false;stream.close();return;}
     if(kind==='compaction'||kind==='compaction-disconnect')emit({type:'session.compacted',properties:{sessionID:'retained'}});
     if(kind==='compaction-disconnect'){storeAssistant('After compaction');busy=false;setTimeout(()=>stream.close(),10);return;}
     if(kind==='long'){for(let i=0;i<40;i++)emit({type:'message.part.updated',properties:{part:{sessionID:'retained',type:'tool',tool:'read',id:'part-'+i,callID:'call-'+i,messageID:'msg_ai_tool',state:{status:'completed',input:{filePath:'source'+i+'.js'},output:'Observed',time:{start:i,end:i+1}}}}});}
     finish();
    });
    if(kind==='accepted-timeout')throw Error('fetch failed: response acknowledgment lost');
    return null;
   }
   return true;
  },events:async()=>({body:new ReadableStream({start(controller){stream=controller;}})})})};
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const run=options=>runOpenCodeSession({taskId:'task',modelId:'opencode/fixture-free',parts:[{type:'text',text:'Original authorized task'}],timeoutMs:12000,onCheckpoint:state=>checkpoints.push(state),onRecovery:text=>activity.push(text),...options});
 return{run,calls,messages,checkpoints,activity,get rounds(){return rounds;},get mutations(){return mutations;},get context(){return context;},storeAssistant};
}
test('native execution records more than 24 tool steps in one retained session',async t=>{
 const f=nativeFixture(t,'long'),r=await f.run();assert.equal(r.text,'Done');assert.equal(f.rounds,1);assert.ok(f.checkpoints.length>=40);assert.equal(f.calls.some(c=>c.method==='DELETE'),false);assert.equal(f.checkpoints.at(-1).status,'completed');
});
test('transient native provider failure continues the same session without the original prompt',async t=>{
 const f=nativeFixture(t,'transient'),r=await f.run();assert.equal(r.text,'Done');assert.equal(f.rounds,2);const posts=f.calls.filter(c=>c.endpoint.endsWith('/prompt_async'));assert.equal(posts[0].body.parts[0].text.includes('Original authorized task'),true);assert.equal(posts[1].body.parts[0].text.includes('Original authorized task'),false);assert.ok(f.activity.some(x=>/Temporary provider/.test(x)));
});
test('SSE reconnection retrieves completion without repeating a mutation or prompt',async t=>{
 const f=nativeFixture(t,'disconnect'),r=await f.run();assert.equal(r.text,'Recovered answer');assert.equal(f.rounds,1);assert.equal(f.mutations,1);assert.ok(f.activity.some(x=>/reconnecting/.test(x)));assert.equal(f.checkpoints.at(-1).pendingTools.once,undefined);
});
test('quota failures remain terminal and retain a failed checkpoint',async t=>{
 const f=nativeFixture(t,'quota');await assert.rejects(f.run(),/insufficient_quota/);assert.equal(f.rounds,1);assert.equal(f.checkpoints.at(-1).status,'failed');assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
});

test('a human explicitly resumes after a quota reset without replaying the original task',async t=>{
 const f=nativeFixture(t,'quota-resume');await assert.rejects(f.run(),/insufficient_quota/);
 const saved=f.checkpoints.at(-1);assert.equal(saved.failure.kind,'quota');assert.equal(f.rounds,1);
 const reply=await f.run({resumeSession:saved});assert.equal(reply.text,'Done');assert.equal(f.rounds,2);
 const requests=f.calls.filter(c=>c.endpoint.endsWith('/prompt_async'));
 assert.notEqual(requests[1].body.parts[0].text,'Original authorized task');
 assert.notEqual(requests[0].body.messageID,requests[1].body.messageID);
 assert.equal(f.mutations,1);assert.equal(f.checkpoints.at(-1).completedTools,1);
 assert.match(requests[1].body.parts[0].text,/Reconcile current files/);
});
test('Stop cancels reconnect backoff promptly',async t=>{
 const f=nativeFixture(t,'disconnect'),controller=new AbortController();const started=Date.now();await assert.rejects(f.run({signal:controller.signal,onRecovery:()=>controller.abort()}),/cancelled/);assert.ok(Date.now()-started<2000);assert.equal(f.rounds,1);assert.equal(f.checkpoints.at(-1).status,'stopped');
});
test('compaction restores exact instructions without another model generation',async t=>{
 const f=nativeFixture(t,'compaction'),r=await f.run({onCompactionContext:()=> 'Exact skill instructions; current request is diagnosis only.'});assert.equal(r.text,'Done');assert.match(f.context,/Exact skill instructions; current request is diagnosis only\./);assert.equal(f.rounds,1);assert.equal(f.calls.filter(c=>c.body?.noReply).length,1);
});
test('resume reads the completed retained session without submitting a new task',async t=>{
 const f=nativeFixture(t,'normal');f.messages.push({info:{id:'msg_original',role:'user',sessionID:'retained'},parts:[]});f.storeAssistant('Already finished');const r=await f.run({resumeSession:{sessionID:'retained',modelId:'opencode/fixture-free',variant:null,status:'failed'}});assert.equal(r.text,'Already finished');assert.equal(f.rounds,0);
});
test('unknown interrupted mutations block further prompts while retaining the session',async t=>{
 const f=nativeFixture(t,'normal');await assert.rejects(f.run({resumeSession:{sessionID:'retained',modelId:'opencode/fixture-free',variant:null,pendingTools:{unknown:{name:'write',status:'running'}}}}),/unknown outcome/);assert.equal(f.rounds,0);assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
});

test('accepted POST with lost acknowledgment is reconciled by exact message ID without resubmission',async t=>{
 const f=nativeFixture(t,'accepted-timeout'),r=await f.run();assert.equal(r.text,'Done');assert.equal(f.rounds,1);const id=f.calls.find(c=>c.endpoint.endsWith('/prompt_async')).body.messageID;assert.match(id,/^msg_[a-f0-9]{12}[A-Za-z0-9]{14}$/);
});

test('a failed final result GET retrieves completed work instead of starting another generation',async t=>{
 const f=nativeFixture(t,'final-get'),r=await f.run();assert.equal(r.text,'Done');assert.equal(f.rounds,1);
});

test('noReply compaction context does not hide completion after a stream disconnect',async t=>{
 const f=nativeFixture(t,'compaction-disconnect'),r=await f.run({onCompactionContext:()=> 'Exact retained instructions'});assert.equal(r.text,'After compaction');assert.equal(f.rounds,1);assert.ok(f.context.includes('Exact retained instructions'));
});

test('native resume preserves accumulated usage and completed tool counts without recounting',async t=>{
 const f=nativeFixture(t,'long'),original=await f.run();const saved=structuredClone(f.checkpoints.at(-1));assert.equal(saved.completedTools,40);
 const resumed=await f.run({resumeSession:saved});assert.deepEqual(resumed.usage,original.usage);assert.equal(f.checkpoints.at(-1).completedTools,40);assert.equal(f.rounds,1);
});
