const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {details,providerError,retryAfterMs,recoveryMetadata}=require('../electron/agent/provider-failure.cjs');
const {transientFailure,terminalQuota,providerRetryDelay}=require('../electron/agent/model-failure-policy.cjs');
const {createProviderAuthLease}=require('../electron/agent/opencode-provider-auth.cjs');
const {decodeReply}=require('../electron/agent/opencode-model.cjs');
const {createRunJournal}=require('../electron/agent/run-journal.cjs');
const {requestWithRetry}=require('../electron/agent/model-retry.cjs');

test('structured quota, rate limit, access and network failures have distinct recovery policies',()=>{
 for(const [statusCode,code,kind,retry] of [[429,'insufficient_quota','quota',false],[429,'rate_limit_exceeded','rate_limit',true],[403,'FreeTierError','access',false],[401,'unauthorized','authentication',false],[402,'billing_required','quota',false],[503,'unavailable','transient',true]]){
  const error=Object.assign(new Error('Provider declined the request'),{statusCode,providerCode:code});
  assert.equal(details(error).kind,kind);assert.equal(transientFailure(error),retry);assert.equal(terminalQuota(error),kind==='quota');
 }
 assert.equal(transientFailure(Error('Connection reset by server')),true);
 assert.equal(transientFailure(Object.assign(Error('fetch failed'),{noRetry:true})),false);
 assert.equal(details(Object.assign(Error('Limited'),{status:429,terminalQuota:true})).kind,'quota');
 assert.equal(details(Object.assign(Error('Denied'),{providerCode:'invalid_api_key'})).kind,'authentication');
});
test('Retry-After seconds and dates survive provider decoding and are not shortened by backoff caps',()=>{
 assert.equal(retryAfterMs(new Headers({'Retry-After':'125'})),125000);
 assert.equal(retryAfterMs({'Retry-After':'Thu, 01 Jan 1970 00:00:05 GMT'},1000),4000);
 assert.equal(retryAfterMs({'retry-after':'bad'}),null);
 let error;
 try{decodeReply({info:{error:{name:'APIError',data:{message:'Slow down',statusCode:429,responseHeaders:{'retry-after':'125'},responseBody:JSON.stringify({error:{code:'rate_limit_exceeded'}})}}}},{name:'Fixture'});}catch(value){error=value;}
 assert.equal(details(error).kind,'rate_limit');assert.equal(error.retryAfterMs,125000);assert.equal(providerRetryDelay(error,9),125000);
 assert.equal(Object.hasOwn(error,'responseBody'),false);
});
test('retry waits for the advertised delay and Stop interrupts that wait',async()=>{
 const controller=new AbortController();let requests=0,observed;
 await assert.rejects(requestWithRetry({signal:controller.signal,retryPolicy:{baseDelayMs:0,maxDelayMs:0}},event=>{observed=event.delayMs;controller.abort();},async()=>{requests++;throw Object.assign(Error('rate limited'),{statusCode:429,retryAfterMs:3600000});}),/cancelled/);
 assert.equal(requests,1);assert.equal(observed,3600000);
});
test('recovery metadata keeps the cause without retaining credentials, headers or raw bodies',()=>{
 const error=providerError('Denied Bearer oc_sk_abcdefghijk api_key=secret-value',{statusCode:403,code:'FreeTierError',headers:new Headers({'authorization':'secret'}),responseBody:JSON.stringify({secret:'private-body'})});
 const metadata=recoveryMetadata(error);
 assert.equal(metadata.kind,'access');assert.doesNotMatch(JSON.stringify(metadata),/abcdefghijk|secret-value|private-body|authorization/);
 assert.doesNotMatch(recoveryMetadata(Error('"api_key":"quoted-secret" access_token=token-secret')).message,/quoted-secret|token-secret/);
});

test('direct HTTP transport preserves typed quota and Retry-After without keeping the response body',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 const {request}=require('../electron/agent/model-client.cjs');
 global.fetch=async()=>Response.json({error:{code:'insufficient_quota',message:'Account limit reached'},private:'do-not-retain'},{status:429,headers:{'retry-after':'90'}});
 await assert.rejects(request({modelId:'cerebras/gpt-oss-120b',history:[{role:'user',content:'hi'}],tools:[],key:'fixture-key',signal:new AbortController().signal}),error=>{
  assert.equal(details(error).kind,'quota');assert.equal(error.retryAfterMs,90000);assert.equal(error.terminalQuota,true);
  assert.doesNotMatch(JSON.stringify(error),/do-not-retain/);return true;
 });
});
test('native auth is provisioned through the official local API and invalidates each location only after a key change',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-provider-auth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let key='fixture-key-one';const calls=[];const auth=createProviderAuthLease(root,()=>key),api=async(route,options)=>{calls.push({route,...options});return true;};
 assert.deepEqual(await auth.prepare(api),{configured:true});
 assert.equal(calls[0].route,'/auth/opencode');assert.equal(calls[0].body.key,key);
 await auth.prepareLocation(api,root);await auth.prepareLocation(api,root);assert.equal(calls.filter(c=>c.route==='/instance/dispose').length,1);
 assert.equal(auth.redact('A '+key+' B'),'A [redacted] B');await auth.clear(api);
 await auth.prepare(api);await auth.prepareLocation(api,root);assert.equal(calls.filter(c=>c.route==='/instance/dispose').length,1);
 key='fixture-key-two';await auth.prepare(api);await auth.prepareLocation(api,root);await auth.prepareLocation(api,path.join(root,'other'));
 assert.equal(calls.filter(c=>c.route==='/instance/dispose').length,3);await auth.clear(api);
});
test('native credential cleanup survives a dead runtime and preserves unrelated private entries',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-auth-cleanup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const auth=createProviderAuthLease(root,()=> 'fixture-secret');await auth.prepare(async()=>true);
 const file=path.join(root,'data/opencode/auth.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({opencode:{type:'api',key:'fixture-secret'},other:{type:'api',key:'keep'}}));
 await auth.clear(async()=>{throw Error('dead runtime');});
 assert.deepEqual(JSON.parse(fs.readFileSync(file)),{other:{type:'api',key:'keep'}});
});
test('saved access/quota failures explain the blocker while preserving explicit safe recovery',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-provider-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const journal=createRunJournal({getPath:()=>root});
 for(const kind of ['quota','access','authentication']){
  journal.write({taskId:kind,requestId:'request',history:[],nativeSession:{sessionID:'retained',status:'failed',failure:{kind}}});
  const recovery=journal.recover(kind);assert.equal(recovery.safe,true);assert.match(recovery.reason,/explicitly resume/);assert.match(recovery.reason,/Progress is retained/);
 }
});
