const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOutbox } = require('../electron/tiny-agent-outbox.cjs');
const { createTinyAgents } = require('../electron/tiny-agents.cjs');
const { readState, writeState } = require('../electron/tiny-agent-store.cjs');
function outboxFixture(provider) {
  let at = 10000, saved, writes = 0; const state = { outbox: [] }, calls = [], statuses = [], cancelled = [];
  const options = { state, persist: () => { writes++; saved = structuredClone(state); }, now: () => at, eligible: () => true,
    notify: (title, body, meta) => { assert.equal(saved.outbox.find(i => i.id === meta.id).attempt, meta.attempt); calls.push({...meta}); return provider?.(meta) || {status:'queued'}; },
    cancel: (...args) => cancelled.push(args), changed: (item, status) => statuses.push({id:item.id,status}) };
  const box = createOutbox(options);
  return { box, state, calls, statuses, cancelled, options, saved: () => saved, writes: () => writes, advance: ms => {at+=ms;box.pump(at);}, at: () => at };
}
test('intent and nonce are saved before delivery; stale acknowledgements cannot confirm a retry', () => {
  const f=outboxFixture();const item=f.box.enqueue('T','B',{ruleId:'r'});f.box.pump();
  const old=f.calls[0];assert.equal(item.status,'preparing');f.box.status({...old,status:'failed',message:'crash'});
  f.advance(999);assert.equal(f.calls.length,1);f.advance(1);const current=f.calls[1];
  assert.equal(current.id,old.id);assert.notEqual(current.attempt,old.attempt);
  assert.equal(f.box.status({...old,status:'shown'}),false);assert.notEqual(item.status,'confirmed');
  assert.equal(f.box.status({...current,status:'shown'}),true);assert.equal(item.status,'confirmed');
  f.advance(100000);assert.equal(f.calls.length,2);
});
test('six total attempts use bounded backoff, retain failure and allow manual retry', () => {
  const f=outboxFixture(()=>{throw Error('renderer failed');});const item=f.box.enqueue('T','B',{ruleId:'r'});f.box.pump();
  for(const delay of [1000,2000,4000,8000,16000]){f.advance(delay-1);const count=f.calls.length;f.advance(1);assert.equal(f.calls.length,count+1);}
  assert.equal(item.attempts,6);assert.equal(item.status,'needs_retry');assert.equal(f.saved().outbox[0].error,'renderer failed');
  f.advance(100000);assert.equal(f.calls.length,6);f.box.retry(item.id);assert.equal(f.calls.length,7);assert.equal(item.attempts,1);
});
test('restart recovers saved and unconfirmed attempts with the same delivery ID; confirmed IDs stay deduplicated', () => {
  for(const stage of ['saved','queued','preparing','displaying','confirmed']) {
    const f=outboxFixture();const item=f.box.enqueue('T','B',{ruleId:'r'});f.options.persist();
    if(stage!=='saved'){f.box.pump();f.box.status({...f.calls[0],status:stage==='confirmed'?'shown':stage});}
    const state=structuredClone(f.saved()), calls=[];
    const recovered=createOutbox({...f.options,state,persist:()=>{},notify:(_t,_b,m)=>{calls.push(m);return {status:'queued'};}});recovered.pump();
    assert.equal(calls.length,stage==='confirmed'?0:1);if(calls.length){assert.equal(calls[0].id,item.id);assert.notEqual(calls[0].attempt,item.attempt);}
  }
});
test('pausing or deleting cancels persisted pending deliveries and their provider windows', () => {
  const f=outboxFixture();const item=f.box.enqueue('T','B',{ruleId:'r'});f.box.pump();const attempt=item.attempt;
  f.box.cancelRule('r');assert.equal(f.saved().outbox[0].status,'cancelled');assert.deepEqual(f.cancelled[0],[item.id,attempt]);
  assert.equal(f.box.status({id:item.id,attempt,status:'shown'}),false);f.advance(60000);assert.equal(f.calls.length,1);
});
test('an unsuccessful checkpoint prevents display and preserves an attempt for later recovery', () => {
  const f=outboxFixture();let failed=true;const box=createOutbox({...f.options,persist:()=>{if(failed)throw Error('disk full');f.options.persist();}});
  const item=box.enqueue('T','B',{ruleId:'r'});assert.throws(()=>box.pump(),/disk full/);assert.equal(f.calls.length,0);assert.equal(item.status,'saved');assert.equal(item.attempts,0);
  failed=false;box.pump();assert.equal(f.calls.length,1);
});
test('a corrupt primary checkpoint loads the previous complete backup', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-store-')), target=path.join(dir,'state.json');
  try{writeState(target,{version:1,rules:[],history:[{id:'old'}]});writeState(target,{version:1,rules:[],history:[{id:'new'}]});fs.writeFileSync(target,'{"broken"');assert.equal(readState(target).history[0].id,'old');}
  finally{for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
const base = 100000;
const event = (seq, value, time, signal='brightness_percent', device='screen') => ({Sequence:seq,Signal:signal,Value:value,Device:device,ReceiptUtcMs:time,MonotonicMs:time,Origin:'native'});
const batch = (events=[], extra={}) => ({Session:'session',FirstSequence:events[0]?.Sequence||1,LastSequence:events.at(-1)?.Sequence||0,Dropped:0,Events:events,...extra});
function engineFixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-reliable-')), calls=[];
  const app={getPath:()=>dir}, effects={notify:(title,body,meta)=>{calls.push({title,body,...meta});return {status:'shown'};}};
  const engine=createTinyAgents(app,effects), input={name:'Precise changes',trigger:{type:'change',watches:[{signal:'brightness_percent'}],settleSeconds:1},action:{type:'notify',message:''}};
  const id=engine.draft(input).rule.id;engine.approve(id);
  const ingest=(value,events,at,extra={})=>engine.ingest({Brightness:value,SignalSources:{brightness_percent:'screen'},SignalEvents:events,...extra},at);
  return {engine,calls,id,dir,app,effects,input,ingest,close:()=>{for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}};
}
test('native bursts reset settling even when successive polled snapshots have the same final value', () => {
  const f=engineFixture();try {
    f.ingest(50,batch(),base);f.ingest(51,batch([event(1,51,base+100)]),base+100);
    const events=[event(1,51,base+100),event(2,80,base+600),event(3,51,base+700)];
    f.ingest(51,batch(events),base+750);f.engine.tick(base+1100);assert.equal(f.calls.length,0);
    f.engine.tick(base+1699);assert.equal(f.calls.length,0);f.engine.tick(base+1700);assert.equal(f.calls.length,1);
    assert.match(f.calls[0].body,/50% → 51%/);assert.equal(f.calls[0].changes[0].receiptAt,base+700);assert.equal(f.calls[0].changes[0].origin,'native');
    f.ingest(51,batch(events),base+1800);assert.equal(f.calls.length,1);
  }finally{f.close();}
});
test('overflow, journal error and companion restart establish a fresh baseline and surface a gap once', () => {
  const f=engineFixture();try {
    f.ingest(50,batch(),base);f.ingest(51,batch([event(1,51,base+100)]),base+100);
    const gap=batch([event(5,90,base+200)],{Dropped:3});f.ingest(90,gap,base+200);f.engine.tick(base+2000);assert.equal(f.calls.length,0);
    f.ingest(90,gap,base+2100);assert.equal(f.engine.list().history.filter(i=>i.kind==='capture_gap').length,1);
    f.ingest(20,batch([],{Session:'new'}),base+2200);f.engine.tick(base+3300);assert.equal(f.calls.length,0);
    const error=batch([],{Session:'new',Error:'disk full'});f.ingest(20,error,base+3400);f.ingest(20,error,base+3500);assert.equal(f.engine.list().history.filter(i=>i.kind==='capture_gap').length,2);
  }finally{f.close();}
});
test('callbacks from an old device cannot alter its replacement; restart does not replay closed-time changes', () => {
  const f=engineFixture();try {
    f.ingest(50,batch(),base);f.ingest(10,batch([event(1,90,base+100)]),base+100,{SignalSources:{brightness_percent:'new-screen'}});f.engine.tick(base+1200);assert.equal(f.calls.length,0);
    const reopened=createTinyAgents(f.app,f.effects);reopened.ingest({Brightness:90,SignalSources:{brightness_percent:'screen'},SignalEvents:batch([event(2,90,base+1300)])},base+1400);reopened.tick(base+2500);assert.equal(f.calls.length,0);
  }finally{f.close();}
});
test('change consumption and all notification actions share one durable intent checkpoint', () => {
  const f=engineFixture();try {
    f.ingest(50,batch(),base);f.ingest(51,batch([event(1,51,base+100)]),base+100);f.engine.tick(base+1100);
    const saved=readState(path.join(f.dir,'tiny-agents.json'));assert.equal(saved.rules[0].pendingNotification,null);assert.equal(saved.outbox.length,1);assert.equal(saved.outbox[0].status,'confirmed');assert.equal(saved.signalCursor.sequence,1);
  }finally{f.close();}
});
test('a poll predating the callback cannot override its value; a later poll reconciles a missed event', () => {
  const f=engineFixture();try {
    f.ingest(50,batch(),base);
    const events=batch([event(1,51,base+100)],{ObservedMonotonicMs:base+150});
    f.ingest(50,events,base+150,{SignalPollMonotonicMs:{brightness_percent:base+50}});
    f.engine.tick(base+1100);assert.equal(f.calls.length,1);assert.match(f.calls[0].body,/50% → 51%/);
    f.ingest(52,events,base+1200,{SignalPollMonotonicMs:{brightness_percent:base+1150}});
    f.engine.tick(base+2200);assert.equal(f.calls.length,2);assert.match(f.calls[1].body,/51% → 52%/);assert.equal(f.calls[1].changes[0].origin,'poll');
  }finally{f.close();}
});
test('an interrupted sixth attempt stays failed after restart instead of exceeding the retry limit', () => {
  const f=outboxFixture();f.state.outbox.push({id:'final',ruleId:'r',title:'T',body:'B',status:'displaying',attempts:6,attempt:'old'});
  const recovered=createOutbox(f.options);recovered.pump();assert.equal(f.calls.length,0);assert.equal(f.state.outbox[0].status,'needs_retry');
});
test('confirmation write failure does not escape IPC and is flushed after storage recovers', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-confirmation-')), notices=[];
  const engine=createTinyAgents({getPath:()=>dir},{notify:(_t,_b,meta)=>{notices.push(meta);return {status:'queued'};}});
  const original=fs.renameSync;
  try {
    const id=engine.draft({name:'Storage fixture',condition:{op:'predicate',signal:'always',comparator:'eq',value:true},action:{type:'notify',message:'T'}}).rule.id;
    engine.approve(id);assert.equal(notices.length,1);
    fs.renameSync=(from,to)=>{if(to===path.join(dir,'tiny-agents.json'))throw Error('Fixture disk unavailable');return original(from,to);};
    assert.doesNotThrow(()=>engine.notificationStatus({...notices[0],status:'shown'}));assert.match(engine.list().storageError,/disk unavailable/);
    fs.renameSync=original;engine.tick();assert.equal(engine.list().storageError,null);assert.equal(readState(path.join(dir,'tiny-agents.json')).outbox[0].status,'confirmed');assert.equal(notices.length,1);
  }finally{fs.renameSync=original;for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
