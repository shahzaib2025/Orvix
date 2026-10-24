const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createTinyRuntime } = require('../electron/tiny-runtime.cjs');
const { withResources } = require('../electron/workflow-resources.cjs');
const {handleTinyWindowClose,stopTinyRuntimeAndUnlock}=require('../electron/tiny-window-lifecycle.cjs');
const always = { op: 'predicate', signal: 'always', comparator: 'eq', value: true };
const definition = steps => ({ name: 'Runtime fixture', goal: 'Verify a disposable workflow', mode: 'Work', steps, scope: { paths: [], apps: [], domains: [] }, models: {}, execution: { mode: 'single' }, schedule: { mode: 'always', timezone: 'UTC' }, acceptance: [{ stepId: 'check', text: 'Observed check' }] });
const until = async check => { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error('Fixture timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } };

test('worker progress keeps completed reports in host state without retransmitting their contents',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-progress-'));let release;const events=[];
    const runtime=await createTinyRuntime({getPath:()=>directory},{onWorkflowEvent:event=>events.push(event)},{validateDefinition:()=>({status:'ready'}),execute:async(step,_input,context)=>{
        if(step.id==='report')return {status:'ok',text:'Saved report'.repeat(500),artifact:{content:'Verified content'.repeat(1800),hash:'fixture'}};
        context.progress({type:'activity',message:'Current work'});return new Promise(resolve=>{release=()=>resolve({status:'ok'});});
    }});
    try{
        await runtime.control({action:'start'});
        const draft=await runtime.workflows.draft({requestId:randomUUID(),definition:definition([{id:'report',type:'research',input:{query:'fixture report'}},{id:'work',type:'research',input:{query:'fixture work'}},{id:'check',type:'verify',input:{kind:'condition',condition:always}}])});
        await runtime.workflows.manage({action:'approve',id:draft.definition.id,revision:1,requestId:randomUUID()});await until(()=>!!release&&events.some(event=>event.worker?.message==='Current work'));
        const progress=events.find(event=>event.worker?.message==='Current work');assert.equal(progress.patch.run,undefined);assert.equal(progress.patch.runUpdate.revision,1);assert.ok(JSON.stringify(progress).length<3000);
        assert.match(runtime.workflows.list().runs[0].outputs.report.text,/Saved report/);assert.equal(runtime.workflows.list().runs[0].outputs.report.artifact.hash,'fixture');
        release();await until(()=>runtime.workflows.list().runs[0].status==='verified');
    }finally{release?.();await runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('worker commits receipts off the host thread and stops only after its effect acknowledges', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-runtime-'));
    let release, dispatched = false, frames = 0; const events = [];
    const runtime = await createTinyRuntime({ getPath: () => directory }, { onWorkflowEvent: event => events.push(event) }, {
        capabilities: () => ({}), validateDefinition: () => ({ status: 'ready' }),
        execute: async () => { dispatched = true; return new Promise(resolve => { release = () => resolve({ status: 'ok', verified: true }); }); },
    });
    await runtime.control({action:'start'});
    const timer = setInterval(() => frames++, 2);
    try {
        const result = await runtime.workflows.draft({ requestId: randomUUID(), definition: definition([{ id: 'effect', type: 'research', input: { query: 'fixture' } }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }]) });
        const receipt = await runtime.workflows.manage({ action: 'approve', id: result.definition.id, revision: 1, requestId: randomUUID() });
        assert.ok(receipt.runId); await until(() => dispatched);
        const stop = await runtime.workflows.manage({ action: 'cancel', runId: receipt.runId, revision: 1, requestId: randomUUID() });
        assert.equal(stop.status, 'stopping'); assert.equal(runtime.workflows.list().runs[0].status, 'stopping');
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(runtime.workflows.list().runs[0].status, 'stopping');
        release(); await until(() => runtime.workflows.list().runs[0].status === 'cancelled');
        assert.ok(events.some(event => event.kind === 'run_stopping' && event.patch.run.status === 'stopping'));
        assert.ok(frames > 0);
        const history = await runtime.workflows.history({ runId: receipt.runId });
        assert.ok(history.records.some(event => event.kind === 'run_cancelled'));
        assert.ok(fs.existsSync(path.join(directory, 'tiny-workflows', 'checkpoint.json')));
    } finally { release?.(); clearInterval(timer); await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('runtime death rejects requests and reports recovery without replaying effects', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-runtime-'));
    const errors = [];
    const runtime = await createTinyRuntime({ getPath: () => directory }, { onError: error => errors.push(error.message) }, {});
    try { await runtime.worker.terminate(); await until(() => errors.length); await assert.rejects(runtime.workflows.history(), /runtime exited/); }
    finally { await runtime.close().catch(() => {}); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('cancelling while a shared resource is occupied does not dispatch or mark an uncertain effect', async () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-resource-'));let release, calls=0;
    const hold=withResources(['interaction'],()=>new Promise(resolve=>{release=resolve;}));await until(()=>!!release);
    const runtime=await createTinyRuntime({getPath:()=>directory},{},{resources:()=>['interaction'],validateDefinition:()=>({status:'ready'}),execute:async()=>{calls++;return {status:'ok'};}});
    await runtime.control({action:'start'});
    try {
        const plan=definition([{id:'effect',type:'action',action:{type:'focus_app',target:'fixture'}},{id:'check',type:'verify',input:{kind:'condition',condition:always}}]); plan.scope.apps=['fixture'];
        const result=await runtime.workflows.draft({requestId:randomUUID(),definition:plan});
        const receipt=await runtime.workflows.manage({action:'approve',id:result.definition.id,revision:1,requestId:randomUUID()});
        await until(()=>runtime.workflows.list().runs[0]?.steps.effect?.status==='running');
        await runtime.workflows.manage({action:'cancel',runId:receipt.runId,revision:1,requestId:randomUUID()});
        await until(()=>runtime.workflows.list().runs[0]?.status==='cancelled');assert.equal(calls,0);assert.equal(runtime.workflows.list().runs[0].effectsUncertain,false);
    }finally{release();await hold;await runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('an actual worker checkpoint failure blocks the host effect and remains visible in cached state', async () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-dispatch-fault-'));let checks=0,effects=0,release;
    const gate=new Promise(resolve=>{release=resolve;});
    const runtime=await createTinyRuntime({getPath:()=>directory},{onWorkflowEvent:event=>{if(event.kind==='worker_progress')release();}},{validateDefinition:async()=>{if(++checks===2){await gate;fs.mkdirSync(path.join(directory,'tiny-workflows','checkpoint.json.tmp'));}return {status:'ready'};},execute:async()=>{effects++;return {status:'ok'};}});
    await runtime.control({action:'start'});
    try {
        const plan=definition([{id:'effect',type:'action',action:{type:'focus_app',target:'fixture'}},{id:'check',type:'verify',input:{kind:'condition',condition:always}}]);plan.scope.apps=['fixture'];
        const result=await runtime.workflows.draft({requestId:randomUUID(),definition:plan});await runtime.workflows.manage({action:'approve',id:result.definition.id,revision:1,requestId:randomUUID()});
        await until(()=>!!runtime.workflows.list().storageError);assert.equal(effects,0);assert.match(runtime.workflows.list().storageError,/checkpoint/i);
        const checkpoint=JSON.parse(fs.readFileSync(path.join(directory,'tiny-workflows','checkpoint.json'),'utf8'));assert.equal(checkpoint.runs[0].steps.effect.completionUnknown,false);
    }finally{await runtime.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});}
});
test('Stop all waits for acknowledgement, prevents later steps, and reopening cannot silently restart work', async () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-stop-start-'));let release,calls=0;
    const app={getPath:()=>directory},adapters={validateDefinition:()=>({status:'ready'}),execute:async()=>{calls++;return new Promise(resolve=>{release=()=>resolve({status:'ok',verified:true});});}};
    let runtime=await createTinyRuntime(app,{},adapters);
    try {
        assert.equal(runtime.health().control.status,'stopped');assert.equal(runtime.health().control.backgroundEnabled,false);
        const result=await runtime.workflows.draft({requestId:randomUUID(),definition:definition([{id:'read',type:'research',input:{query:'fixture'}},{id:'check',type:'verify',input:{kind:'condition',condition:always}}])});
        await assert.rejects(runtime.workflows.manage({action:'approve',id:result.definition.id,revision:1,requestId:randomUUID()}),/stopped/);
        await runtime.control({action:'start'});const receipt=await runtime.workflows.manage({action:'approve',id:result.definition.id,revision:1,requestId:randomUUID()});await until(()=>!!release);
        const stop=runtime.control({action:'stop'});await until(()=>runtime.health().control.status==='stopping');assert.equal(runtime.workflows.list().runs[0].steps.check,undefined);
        await assert.rejects(runtime.control({action:'start'}),/stopping/);release();await stop;
        assert.equal(runtime.health().control.status,'stopped');assert.equal(runtime.workflows.list().runs[0].status,'paused');
        await runtime.close();runtime=await createTinyRuntime(app,{},adapters);assert.equal(runtime.health().control.status,'stopped');assert.equal(runtime.workflows.list().runs[0].status,'paused');assert.equal(calls,1);
        await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,1);
        await runtime.control({action:'start'});await until(()=>runtime.workflows.list().runs[0].status==='verified');assert.equal(calls,1);assert.equal(runtime.workflows.list().runs[0].id,receipt.runId);
    }finally{release?.();await runtime.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});}
});
test('closing quits by default; hiding requires explicit background consent and stops voice',()=>{
    for(const enabled of [undefined,false,true]){const events=[];handleTinyWindowClose({preventDefault:()=>events.push('prevent')},{control:{status:'running',backgroundEnabled:enabled},stopVoice:()=>events.push('voice stopped'),hide:()=>events.push('hidden'),quit:()=>events.push('quit'),notify:()=>events.push('background notice')});assert.deepEqual(events,enabled===true?['prevent','voice stopped','hidden','background notice']:['prevent','voice stopped','quit']);}
});
test('the close gate waits for both worker acknowledgement and file recovery and refuses an unverified lock',async()=>{
    let stop,unlock,closed=false;const pending=stopTinyRuntimeAndUnlock({control:()=>new Promise(resolve=>{stop=resolve;})},{unlock:()=>new Promise(resolve=>{unlock=resolve;})}).then(()=>{closed=true;});stop({status:'stopped'});await Promise.resolve();assert.equal(closed,false);unlock({lock:{status:'unlocked'}});await pending;assert.equal(closed,true);
    await assert.rejects(stopTinyRuntimeAndUnlock({control:async()=>({status:'stopped'})},{unlock:async()=>({lock:{status:'recovery_required'}})}),/file access needs attention/);
});
