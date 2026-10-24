const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {createTinyAgentSensors}=require('../electron/tiny-agent-sensors.cjs');
const {readHistoryPage}=require('../electron/tiny-workflow-history.cjs');
const {createTinyRuntime}=require('../electron/tiny-runtime.cjs');
const {createTinyWorkflows}=require('../electron/tiny-workflows.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Fixture deadline exceeded');await sleep(10);}};
const condition=(signal,target)=>({op:'predicate',signal,comparator:signal==='folder_new_file'?'contains':'eq',value:signal==='folder_new_file'?'.txt':true,...(target?{target}:{})});
const rule=(signal,target)=>({enabled:true,draft:false,condition:condition(signal,target)});
const always={op:'predicate',signal:'always',comparator:'eq',value:true};
const temp=(t,managed=false)=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-lightweight-'));if(!managed)t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;};

test('no rules allocate no sensor watches or timers; only requested CPU and memory collectors run',async t=>{
  let rules=[],cpu=0,memory=0,network=0,disk=0;
  const sensors=createTinyAgentSensors({listRules:()=>rules,onUpdate:()=>{},cpuProbe:()=>{cpu++;return {idle:cpu*10,total:cpu*20};},memoryProbe:()=>{memory++;return 50;},networkProbe:async()=>{network++;return true;},diskProbe:async()=>{disk++;return {};}});
  t.after(()=>sensors.stop());await sensors.refresh();assert.equal(sensors.diagnostics().scheduled,false);assert.equal(cpu,0);
  rules=[rule('memory_percent')];await sensors.refresh();assert.equal(memory,1);assert.equal(cpu,0);assert.equal(network,0);assert.equal(disk,0);
  rules=[rule('cpu_percent')];sensors.refresh();await until(()=>cpu>0);assert.equal(memory,1);
  rules=[];sensors.refresh();const before={cpu,memory};await sleep(50);assert.deepEqual({cpu,memory},before);assert.equal(sensors.diagnostics().watchers,0);assert.equal(sensors.diagnostics().scheduled,false);
});

test('changing requirements during an in-flight probe samples the new sensor promptly',async t=>{
  let rules=[rule('network_online')],release,current;
  const sensors=createTinyAgentSensors({listRules:()=>rules,networkProbe:()=>new Promise(resolve=>{release=resolve;}),memoryProbe:()=>37,onUpdate:value=>{current=value;}});
  t.after(()=>sensors.stop());const first=sensors.refresh();await until(()=>!!release);rules=[rule('memory_percent')];sensors.refresh();release(true);await first;await until(()=>current?.System.memory_percent===37);assert.equal(sensors.diagnostics().network,1);
});

test('removing a dirty folder releases its watch and cannot leave a repeated scan loop',async t=>{
  const base=temp(t),first=path.join(base,'first'),second=path.join(base,'second');fs.mkdirSync(first);fs.mkdirSync(second);
  const {EventEmitter}=require('node:events'),handles=new Map();let rules=[rule('folder_new_file',first),rule('folder_new_file',second)];
  const sensors=createTinyAgentSensors({listRules:()=>rules,watchFactory:(directory,_options,callback)=>{const handle=new EventEmitter();handle.close=()=>{};handle.change=callback;handles.set(directory,handle);return handle;},onUpdate:()=>{}});
  t.after(()=>sensors.stop());await sensors.refresh();handles.get(first).change('change','fixture.txt');rules=[rule('folder_new_file',second)];sensors.refresh();await until(()=>sensors.diagnostics().samples>=2);const before=sensors.diagnostics().samples;await sleep(400);assert.equal(sensors.diagnostics().samples,before);assert.equal(sensors.diagnostics().watchers,2);
});

test('folder rules share watches, ignore existing files and detect stable arrivals without unrelated probes',async t=>{
  const directory=temp(t);fs.writeFileSync(path.join(directory,'existing.txt'),'old');let current,updates=0;
  const sensors=createTinyAgentSensors({listRules:()=>[rule('folder_new_file',directory),rule('folder_new_file',directory)],onUpdate:value=>{current=value;updates++;},cpuProbe:()=>{throw Error('Unrequested CPU probe');},memoryProbe:()=>{throw Error('Unrequested memory probe');}});
  t.after(()=>sensors.stop());await sensors.refresh();assert.deepEqual(current.Files[directory].names,[]);assert.equal(sensors.diagnostics().watchers,2);
  const initial=sensors.diagnostics().folderScans;await sleep(250);assert.equal(sensors.diagnostics().folderScans,initial);
  fs.writeFileSync(path.join(directory,'arrival.txt'),'new');await until(()=>current.Files[directory].names.includes('arrival.txt'));
  assert.equal(current.Files[directory].sequence,1);assert.ok(updates>=3);sensors.stop();
  const stopped=updates;fs.writeFileSync(path.join(directory,'after-stop.txt'),'stopped');await sleep(250);assert.equal(updates,stopped);assert.equal(sensors.diagnostics().watchers,0);assert.equal(sensors.diagnostics().scheduled,false);
  await sensors.start();assert.deepEqual(current.Files[directory].names,[]);
});

test('a missing Windows file watch recovers by scanning and stale asynchronous results cannot publish after stop',async t=>{
  const directory=temp(t),file=path.join(directory,'missing.txt');let current;
  const sensors=createTinyAgentSensors({listRules:()=>[rule('file_exists',file)],watchFactory:()=>{throw Error('watch unavailable');},onUpdate:value=>{current=value;}});
  t.after(()=>sensors.stop());await sensors.start();assert.equal(current.Files[file].exists,false);fs.writeFileSync(file,'fixture');await sensors.sample(Date.now()+10001,false);assert.equal(current.Files[file].exists,true);
  sensors.stop();let release,updates=0;
  const pending=createTinyAgentSensors({listRules:()=>[rule('network_online')],networkProbe:()=>new Promise(resolve=>{release=resolve;}),onUpdate:()=>updates++});
  const first=pending.start();await until(()=>!!release);pending.stop();release(true);await first;assert.equal(updates,0);assert.equal(pending.diagnostics().scheduled,false);
});

test('renamed/recreated folders establish a new baseline and reacquire their watcher',async t=>{
  const base=temp(t),directory=path.join(base,'watched'),moved=path.join(base,'moved');fs.mkdirSync(directory);let current;
  const sensors=createTinyAgentSensors({listRules:()=>[rule('folder_new_file',directory)],onUpdate:value=>{current=value;}});
  t.after(()=>sensors.stop());await sensors.start();fs.renameSync(directory,moved);await until(()=>current.Files[directory]?.error);
  fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'existing.txt'),'baseline');await until(()=>!current.Files[directory]?.error);assert.deepEqual(current.Files[directory].names,[]);
  fs.writeFileSync(path.join(directory,'arrival.txt'),'new');await until(()=>current.Files[directory]?.names.includes('arrival.txt'));assert.equal(sensors.diagnostics().watchers,2);
});

test('a recovery-only sensor is requested and disk checks use the configured native filesystem target',async t=>{
  let current;
  const sensors=createTinyAgentSensors({listRules:()=>[{...rule('always'),incident:{recoveryCondition:condition('memory_percent')}}],memoryProbe:()=>42,onUpdate:value=>{current=value;}});
  t.after(()=>sensors.stop());await sensors.refresh();assert.equal(current.System.memory_percent,42);
  if(process.platform!=='win32')return;
  const drive=path.parse(process.cwd()).root.slice(0,2).toUpperCase();
  const disk=createTinyAgentSensors({listRules:()=>[rule('disk_free_percent',drive)],onUpdate:value=>{current=value;}});
  t.after(()=>disk.stop());await disk.refresh();assert.equal(current.Observations['disk_free_percent:'+drive].status,'ready');assert.ok(current.System.disks[drive]>=0&&current.System.disks[drive]<=100);
});

test('history pages bound reads, preserve split UTF-8, paginate both ways and exclude uncommitted records',t=>{
  const directory=temp(t),file=path.join(directory,'events.jsonl');
  const events=Array.from({length:170},(_,index)=>({sequence:index+1,runId:index%2?'other':'chosen',message:'✓汉字'.repeat(1000)}));
  fs.writeFileSync(file,events.map(event=>JSON.stringify(event)).join('\n')+'\n{broken\n');
  const latest=readHistoryPage(file,169);assert.equal(latest.records.length,50);assert.equal(latest.records.at(-1).sequence,169);assert.equal(latest.records[0].message,events[0].message);
  const previous=readHistoryPage(file,169,{before:latest.next});assert.equal(previous.records.at(-1).sequence,latest.records[0].sequence-1);
  const first=readHistoryPage(file,169,{after:0,runId:'chosen'});assert.equal(first.records[0].sequence,1);assert.equal(first.records.at(-1).sequence,99);
  const next=readHistoryPage(file,169,{after:first.next,runId:'chosen'});assert.equal(next.records[0].sequence,101);assert.equal(next.records.at(-1).sequence,169);assert.equal(next.next,null);
  assert.equal(readHistoryPage(path.join(directory,'absent'),0).records.length,0);
});

test('stopped runtime suppresses heartbeat, native traffic and disk writes; Start and preview still use the newest reading',async t=>{
  const directory=temp(t,true);let snapshots=0,beats=0;
  const runtime=await createTinyRuntime({getPath:()=>directory},{onChange:event=>{if(event.kind==='snapshot')snapshots++;}},{},{heartbeatMs:100});
  t.after(async()=>{try{await runtime.close();}finally{fs.rmSync(directory,{recursive:true,force:true});}});runtime.worker.on('message',message=>{if(message.type==='heartbeat')beats++;});
  runtime.agents.setVoiceActive(true);runtime.workflows.setVoiceActive(true);
  const checkpoint=path.join(directory,'tiny-workflows','checkpoint.json'),before=fs.statSync(checkpoint).mtimeMs;
  for(let i=0;i<100;i++)runtime.agents.ingest({BatteryPercent:i});await sleep(300);
  assert.equal(snapshots,0);assert.equal(beats,0);assert.equal(fs.statSync(checkpoint).mtimeMs,before);assert.equal(runtime.health().idle,true);
  await runtime.control({action:'start'});await until(()=>beats>0);assert.equal(snapshots,1);assert.equal(runtime.health().idle,false);
  await runtime.control({action:'stop'});const previous=beats;await sleep(250);assert.equal(beats,previous);
  runtime.agents.ingest({BatteryPercent:10});const start=runtime.control({action:'start'}),stop=runtime.control({action:'stop'});await Promise.all([start,stop]);assert.equal(runtime.health().control.status,'stopped');
});

test('published readings wake workflow event waits promptly; Stop cancels a long delay without polling',async t=>{
  const directory=temp(t,true);let snapshot={at:Date.now(),PcObservedAt:Date.now(),BatteryPercent:80},reads=0;
  const wf=createTinyWorkflows({getPath:()=>directory},{signalEvents:true,snapshot:()=>{reads++;return snapshot;},execute:async()=>({verified:true})});
  t.after(()=>{try{wf.stop();}finally{fs.rmSync(directory,{recursive:true,force:true});}});wf.start();
  const draft=wf.draft({requestId:randomUUID(),definition:{name:'Event wait',goal:'Observe a new reading',mode:'Work',steps:[{id:'wait',type:'wait',event:true,timeoutSeconds:5,condition:{op:'predicate',signal:'battery_percent',comparator:'gt',value:70}},{id:'check',type:'verify',input:{kind:'condition',condition:always}}],acceptance:[{stepId:'check',text:'Observed'}]}}).definition;
  wf.manage({action:'approve',id:draft.id,revision:1,requestId:randomUUID()});await until(()=>wf.list().runs[0]?.steps.wait);
  const before=reads;await sleep(300);assert.equal(reads,before);
  snapshot={at:Date.now(),PcObservedAt:Date.now(),BatteryPercent:60};wf.ingest(snapshot);await sleep(10);
  snapshot={at:Date.now(),PcObservedAt:Date.now(),BatteryPercent:80};wf.ingest(snapshot);await until(()=>wf.list().runs[0].status==='verified');
  const delayed=wf.draft({requestId:randomUUID(),definition:{name:'Delay',goal:'Cancellable wait',mode:'Work',steps:[{id:'delay',type:'delay',seconds:600},{id:'check',type:'verify',input:{kind:'condition',condition:always}}],acceptance:[{stepId:'check',text:'Observed'}]}}).definition;
  wf.manage({action:'approve',id:delayed.id,revision:1,requestId:randomUUID()});await until(()=>wf.list().runs[0]?.steps.delay?.status==='waiting');
  wf.pauseAll();await Promise.race([wf.waitForIdle(),sleep(500).then(()=>{throw Error('Stop did not acknowledge promptly');})]);assert.equal(wf.list().runs[0].status,'paused');
});

test('both status views share one subscription, reject stale responses and clean up on unmount',async()=>{
  const ts=require('typescript'),source=fs.readFileSync(path.join(__dirname,'..','src','tinyRuntimeSubscription.ts'),'utf8');
  const exports={},unsubscribers=[],handlers={},requests=[];let intervals=0,subscriptions=0,last;
  const observe=name=>callback=>{subscriptions++;handlers[name]=callback;return()=>{subscriptions--;delete handlers[name];};};
  const bridge={tinyRuntimeHealth:()=>new Promise(resolve=>requests.push(resolve)),onTinyRuntimeControl:observe('control'),onTinyAgentEvent:observe('agent'),onTinyWorkflowEvent:observe('workflow')};
  const context={exports,window:{orvixDesktop:bridge},document:{hidden:false,addEventListener:()=>{},removeEventListener:()=>{}},setTimeout,clearTimeout,setInterval:()=>{intervals++;return 1;},clearInterval:()=>intervals--,require:name=>{assert.equal(name,'react');return {useSyncExternalStore:(subscribe,get)=>{unsubscribers.push(subscribe(()=>{last=get();}));return get();}};}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  exports.useTinyRuntimeHealth();exports.useTinyRuntimeHealth();assert.equal(intervals,1);assert.equal(subscriptions,3);assert.equal(requests.length,1);
  handlers.control({status:'stopping',backgroundEnabled:false});requests[0]({status:'responding',lastSeenAt:1,control:{status:'running'}});await sleep(0);assert.equal(last.control.status,'stopping');assert.equal(requests.length,2);
  requests[1]({status:'responding',lastSeenAt:2,control:{status:'stopped'}});await sleep(0);assert.equal(last.control.status,'stopped');
  unsubscribers[0]();assert.equal(intervals,1);unsubscribers[1]();assert.equal(intervals,0);assert.equal(subscriptions,0);
});

test('completed one-offs release sensors while an active run retains its own approved requirements',async t=>{
  const directory=temp(t,true),target=path.join(directory,'fixture.txt');fs.writeFileSync(target,'fixture');
  let release;const wf=createTinyWorkflows({getPath:()=>directory},{snapshot:()=>({at:Date.now(),Files:{[target]:{exists:true}}}),execute:async()=>new Promise(resolve=>{release=()=>resolve({status:'ok'});})});
  t.after(()=>{try{release?.();wf.stop();}finally{fs.rmSync(directory,{recursive:true,force:true});}});wf.start();
  const definition=wf.draft({requestId:randomUUID(),definition:{name:'One off',goal:'Check a file',mode:'Work',steps:[{id:'research',type:'research',input:{query:'fixture'}},{id:'check',type:'verify',input:{kind:'condition',condition:condition('file_exists',target)}}],acceptance:[{stepId:'check',text:'File observed'}]}}).definition;
  wf.manage({action:'approve',id:definition.id,revision:1,requestId:randomUUID()});await until(()=>!!release);assert.equal(wf.sensorRules()[0].condition.target,target);
  wf.manage({action:'disable',id:definition.id,revision:1,requestId:randomUUID()});assert.equal(wf.sensorRules()[0].condition.target,target);
  release();await until(()=>wf.list().runs[0].status==='verified');assert.deepEqual(wf.sensorRules(),[]);await wf.waitForIdle();
});

test('a failed run-start checkpoint releases idle waiters and never dispatches the effect',async t=>{
  const directory=temp(t,true);let calls=0;
  const wf=createTinyWorkflows({getPath:()=>directory},{execute:async()=>{calls++;return {status:'ok'};}},{beforePersist:(_state,event)=>{if(event?.kind==='run_started')throw Error('Fixture storage failure');}});
  t.after(()=>{wf.stop();fs.rmSync(directory,{recursive:true,force:true});});wf.start();
  const definition=wf.draft({requestId:randomUUID(),definition:{name:'Storage failure',goal:'Do not dispatch',mode:'Work',steps:[{id:'research',type:'research',input:{query:'fixture'}},{id:'check',type:'verify',input:{kind:'condition',condition:always}}],acceptance:[{stepId:'check',text:'Observed'}]}}).definition;
  wf.manage({action:'approve',id:definition.id,revision:1,requestId:randomUUID()});await sleep(0);
  await Promise.race([wf.waitForIdle(),sleep(500).then(()=>{throw Error('Idle waiter leaked after failed checkpoint');})]);assert.equal(calls,0);assert.match(wf.list().storageError,/Fixture storage failure/);
});
