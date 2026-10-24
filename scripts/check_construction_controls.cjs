const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createConstructionLocks,restrictionDialogOptions}=require('../electron/construction-lock.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Fixture timed out');await sleep(10);}};
const sid='S-1-5-21-1-2-3-1000';
function fixture(effects={}){
  const base=path.resolve(__dirname,'..','scratch','construction-controls-'+randomUUID()),directory=path.join(base,'state'),target=path.join(base,'work');
  fs.mkdirSync(target,{recursive:true});fs.mkdirSync(directory);fs.writeFileSync(path.join(target,'draft.txt'),'original fixture');
  const engine=createConstructionLocks({getPath:()=>directory,getAppPath:()=>String.raw`C:\Orvix`},effects);
  return {base,directory,target,engine,input:{targets:[target],mode:'read_write',durationMinutes:15},cleanup(){engine.stop();assert.equal(path.dirname(base),path.resolve(__dirname,'..','scratch'));assert.ok(path.basename(base).startsWith('construction-controls-'));fs.rmSync(base,{recursive:true,force:true});}};
}
test('metadata preview counts entries, preserves content, and never requests elevation',async()=>{
  let calls=0;const f=fixture({runPowerShell:async()=>{calls++;throw Error('Unexpected launch');}});
  try{const result=await f.engine.preview(f.input);assert.equal(result.ready,true);assert.equal(result.totalEntries,2);assert.equal(result.targets[0].kind,'folder');assert.ok(result.reviewId);assert.equal(calls,0);assert.equal(fs.readFileSync(path.join(f.target,'draft.txt'),'utf8'),'original fixture');assert.equal(f.engine.list().lock,null);}
  finally{f.cleanup();}
});
test('unavailable, overlapping, hard-linked and oversized selections cannot get an activation review',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.engine.preview({...f.input,targets:[path.join(f.base,'absent')]})).ready,false);
    await assert.rejects(f.engine.preview({...f.input,targets:[f.target,path.join(f.target,'draft.txt')]}),/overlapping/);
    const alias=path.join(f.base,'alias.txt');fs.linkSync(path.join(f.target,'draft.txt'),alias);const linked=await f.engine.preview(f.input);assert.equal(linked.ready,false);assert.match(linked.targets[0].message,/Hard-linked/);fs.unlinkSync(alias);
    const result=await require('../electron/construction-preview.cjs').inspectSelection(f.input,1);assert.equal(result.ready,false);assert.equal(result.reviewId,undefined);
  }finally{f.cleanup();}
});
test('an activation review cannot authorize changed paths, duration, mode or a reused token',async()=>{
  let calls=0,release;const f=fixture({runPowerShell:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  try{
    const review=await f.engine.preview(f.input);
    for(const changed of [{durationMinutes:30},{mode:'write'},{targets:[path.join(f.target,'draft.txt')]}])await assert.rejects(f.engine.start({...f.input,...changed,reviewId:review.reviewId}),/review is stale/);
    assert.equal(calls,0);const start=f.engine.start({...f.input,reviewId:review.reviewId});await until(()=>!!release);const cancelled=f.engine.cancelActivation();assert.equal(cancelled.operation.cancelRequested,true);release({stdout:sid});await assert.rejects(start,/cancelled before permissions changed/);
    assert.equal(calls,1);assert.equal(f.engine.list().operation,null);assert.equal(f.engine.list().lock,null);
    await assert.rejects(f.engine.start({...f.input,reviewId:review.reviewId}),/review is stale/);
  }finally{release?.({stdout:sid});f.cleanup();}
});
test('cancelled Windows approval leaves durable markers and waits for restoration acknowledgement',async()=>{
  let launches=0,release,session;const f=fixture({workerAlive:()=>true,runPowerShell:async()=>{if(!launches++)return {stdout:sid};return new Promise(resolve=>{release=resolve;});},accessProbe:async(mode,current)=>{session=current.directory;return mode==='Capture'?{id:current.id,sid,entries:[{path:f.target,identity:'fixture'}]}:{id:current.id,status:'verified',checked:2,issues:[]};}});
  try{
    const review=await f.engine.preview(f.input),start=f.engine.start({...f.input,reviewId:review.reviewId});let finished=false;start.then(()=>{finished=true;});await until(()=>!!release);
    const status=f.engine.cancelActivation();assert.equal(status.operation.phase,'cancelling');assert.ok(fs.existsSync(path.join(session,'cancel-request.json')));assert.ok(fs.existsSync(path.join(session,'unlock')));assert.equal(finished,false);
    fs.writeFileSync(path.join(session,'manifest.json'),JSON.stringify({status:'unlocked',updatedAt:Date.now(),targets:f.input.targets,attempts:[]}));release({stdout:'12345'});
    const result=await start;assert.equal(result.lock.status,'unlocked');assert.equal(result.operation,null);assert.equal(f.engine.list().operation,null);assert.equal(fs.readFileSync(path.join(f.target,'draft.txt'),'utf8'),'original fixture');
  }finally{release?.({stdout:'12345'});f.cleanup();}
});
test('a cancellation during activation polling cannot return an active success before Windows restores',async()=>{
  let launches=0,session;const f=fixture({workerAlive:()=>true,runPowerShell:async()=>{if(!launches++)return {stdout:sid};fs.writeFileSync(path.join(session,'manifest.json'),JSON.stringify({status:'preparing',updatedAt:Date.now(),targets:f.input.targets,attempts:[]}));return {stdout:'12345'};},accessProbe:async(mode,current)=>{session=current.directory;return mode==='Capture'?{id:current.id,sid,entries:[{path:f.target}]}:{id:current.id,status:'verified',checked:2,issues:[]};}});
  try{
    const start=f.engine.start(f.input);let finished=false;start.then(()=>{finished=true;});await until(()=>launches===2);f.engine.cancelActivation();fs.writeFileSync(path.join(session,'manifest.json'),JSON.stringify({status:'active',updatedAt:Date.now(),targets:f.input.targets,attempts:[]}));await sleep(250);assert.equal(finished,false);
    fs.writeFileSync(path.join(session,'manifest.json'),JSON.stringify({status:'unlocked',updatedAt:Date.now(),targets:f.input.targets,attempts:[]}));const result=await start;assert.equal(result.lock.status,'unlocked');assert.equal(result.operation,null);
  }finally{f.cleanup();}
});
test('failed native messages remain persisted, can be retried, and are not reported as acknowledged',async()=>{
  let fail=true;const f=fixture({showRestricted:async()=>{if(fail)throw Error('Fixture native dialog failed');}});
  const id=randomUUID(),session=path.join(f.directory,'construction-locks',id);fs.mkdirSync(session);
  fs.writeFileSync(path.join(f.directory,'construction-locks','current.json'),JSON.stringify({id,targets:[f.target]}));
  fs.writeFileSync(path.join(session,'manifest.json'),JSON.stringify({status:'active',updatedAt:Date.now(),targets:[f.target],auditHealth:'watching',attempts:[{id:'attempt-1',path:f.target,at:new Date().toISOString()}]}));
  f.engine.stop();const engine=createConstructionLocks({getPath:()=>f.directory,getAppPath:()=>String.raw`C:\Orvix`},{showRestricted:async()=>{if(fail)throw Error('Fixture native dialog failed');}});
  try{
    await until(()=>engine.list().messageStatus?.status==='failed');assert.match(engine.list().messageStatus.error,/Fixture native/);assert.equal(JSON.parse(fs.readFileSync(path.join(session,'notification.json'),'utf8')).status,'failed');
    fail=false;const result=await engine.retryMessage();assert.equal(result.messageStatus.status,'acknowledged');
    assert.equal(JSON.stringify(engine.details(id)).includes('sddl'),false);assert.throws(()=>engine.details('unknown'),/known recovery/);
  }finally{engine.stop();f.cleanup();}
});
test('synthetic message tests are explicit and missing message capabilities fail visibly',async()=>{
  const f=fixture();
  try{const options=restrictionDialogOptions({synthetic:true});assert.match(options.message,/Test/);assert.match(options.detail,/No files were locked/);await assert.rejects(f.engine.testMessage(),/unavailable/);assert.equal(f.engine.list().lock,null);}
  finally{f.cleanup();}
});
