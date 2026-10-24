const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, context = {}) { const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; vm.runInNewContext(result, { exports: module.exports, module, require, console, Promise, setTimeout, clearTimeout, ...context }, { filename: file }); return module.exports; }
test('ordered committed patches update a run without fetching the full listing on every step', async () => {
    let callback, requests=0;const updates=[];
    const bridge={listTinyWorkflows:async()=>{requests++;return {sequence:0,definitions:[],runs:[]};},onTinyWorkflowEvent:fn=>{callback=fn;return()=>{};}};
    const dispose=load('src/tinyWorkflowSubscription.ts').subscribeTinyWorkflows(bridge,value=>updates.push(value));await Promise.resolve();
    callback({sequence:1,patch:{run:{id:'run',status:'running'}}});callback({sequence:2,patch:{run:{id:'run',status:'verified'}}});
    assert.equal(requests,1);assert.equal(updates.at(-1).runs.length,1);assert.equal(updates.at(-1).runs[0].status,'verified');dispose();
});

test('progress bursts share one paint; stop and approval updates bypass it and cannot be overwritten',async()=>{
    let callback,serial=0;const timers=new Map(),updates=[];
    const initial={sequence:0,definitions:[],runs:[{id:'run',status:'running',reason:'Initial'}]};
    const bridge={listTinyWorkflows:async()=>initial,onTinyWorkflowEvent:fn=>{callback=fn;return()=>{};}};
    const {subscribeTinyWorkflows}=load('src/tinyWorkflowSubscription.ts',{setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:key=>timers.delete(key)});
    const off=subscribeTinyWorkflows(bridge,value=>updates.push(value));await Promise.resolve();
    for(let sequence=1;sequence<=50;sequence++)callback({sequence,kind:'worker_progress',patch:{run:{id:'run',status:'running',reason:String(sequence)}}});
    assert.equal(timers.size,1);assert.equal(updates.length,1);const [key,paint]=[...timers][0];timers.delete(key);paint();assert.equal(updates.at(-1).runs[0].reason,'50');
    callback({sequence:51,kind:'worker_progress',patch:{run:{id:'run',status:'running'}}});
    callback({sequence:52,kind:'run_paused',patch:{run:{id:'run',status:'paused'}}});assert.equal(updates.at(-1).runs[0].status,'paused');assert.equal(timers.size,0);
    callback({sequence:53,kind:'worker_progress',worker:{type:'approval'},patch:{run:{id:'run',status:'running',questions:[{id:'approval'}]}}});assert.equal(updates.at(-1).runs[0].questions[0].id,'approval');assert.equal(timers.size,0);
    callback({sequence:54,kind:'worker_progress',patch:{run:{id:'run',status:'running'}}});off();assert.equal(timers.size,0);
});

test('compact progress preserves completed outputs; unknown run revisions request an authoritative snapshot',async()=>{
    let callback,requests=0,paint;const output={text:'Saved report',artifact:{hash:'unchanged'}};
    const initial={sequence:0,definitions:[],runs:[{id:'run',revision:1,status:'running',outputs:{report:output}}]},updates=[];
    const bridge={listTinyWorkflows:async()=>{requests++;return initial;},onTinyWorkflowEvent:fn=>{callback=fn;return()=>{};}};
    const {subscribeTinyWorkflows}=load('src/tinyWorkflowSubscription.ts',{setTimeout:fn=>{paint=fn;return 1;},clearTimeout:()=>{paint=undefined;}});
    const off=subscribeTinyWorkflows(bridge,value=>updates.push(value));await Promise.resolve();
    callback({sequence:1,kind:'worker_progress',patch:{runUpdate:{id:'run',revision:1,status:'running',reason:'Current progress'}}});paint();
    assert.equal(updates.at(-1).runs[0].reason,'Current progress');assert.equal(updates.at(-1).runs[0].outputs.report,output);assert.equal(requests,1);
    callback({sequence:2,kind:'worker_progress',patch:{runUpdate:{id:'run',revision:2,status:'running'}}});await Promise.resolve();assert.equal(requests,2);assert.equal(updates.at(-1).runs[0].revision,1);off();
});
test('subscription ignores old responses and events, refreshes after event gaps and detaches safely', async () => { const requests = [], updates = []; let callback, off = false; const bridge = { listTinyWorkflows: () => new Promise(resolve => requests.push(resolve)), onTinyWorkflowEvent: fn => { callback = fn; return () => { off = true; }; } }; const { subscribeTinyWorkflows } = load('src/tinyWorkflowSubscription.ts'); const dispose = subscribeTinyWorkflows(bridge, value => updates.push(value.sequence)); callback({ sequence: 3 }); requests[1]({ sequence: 3 }); await Promise.resolve(); requests[0]({ sequence: 1 }); await Promise.resolve(); callback({ sequence: 2 }); assert.deepEqual(updates, [3]); assert.equal(requests.length, 2); callback({ sequence: 9 }); requests[2]({ sequence: 9 }); await Promise.resolve(); assert.deepEqual(updates, [3, 9]); dispose(); assert.equal(off, true); callback({ sequence: 10 }); assert.equal(requests.length, 3); });
test('both-profile common tools preserve nested condition trees, settings and exact workflow mutation IDs', async () => { const tools = load('src/tinyAgentTools.ts', { window: {} }), nested = { op: 'all', children: [{ op: 'predicate', signal: 'always', comparator: 'eq', value: true }, { op: 'any', children: [{ op: 'predicate', signal: 'charging', comparator: 'eq', value: true }] }] }, raw = { name: 'Grouped', condition_json: JSON.stringify(nested), hold_seconds: 3, repeat_seconds: 60, actions: [{ type: 'notify', message: 'Notice' }], schedule: { mode: 'daily', timezone: 'Asia/Dhaka', start: '10:00', days: [1] }, policy: { maxPerDay: 2 }, district: 'garden' }; assert.equal(JSON.stringify(tools.tinyAgentDraftFromModel(raw).condition), JSON.stringify(nested)); let received; const bridge = { draftTinyWorkflow: async (input) => { received = input; return { status: 'review_required' }; }, listTinyWorkflows: async () => ({ definitions: [], runs: [], sequence: 0 }) }; await tools.invokeTinyAgentTool('draft_tiny_workflow', { definition_json: '{"name":"Reviewed"}', request_id: 'stable-mutation', id: 'exact-id', revision: 3 }, bridge); assert.equal(received.requestId, 'stable-mutation'); assert.equal(received.revision, 3); assert.equal(received.id, 'exact-id'); assert.equal((await tools.invokeTinyAgentTool('manage_tiny_workflow', { action: 'approve' }, bridge)).status, 'needs_review'); });
test('voice facade disconnect detaches from workflows and idle notices cannot become human authorization', async () => {
    let callbacks, cancelled = 0, off = 0, eventHandler, sent = [];
    class Delegate {
        constructor(...args) { callbacks = args[args.length === 3 ? 1 : 2]; }
        start() { callbacks.onStatus('listening'); return Promise.resolve(); }
        stop() { cancelled++; }
        sendText(text) { sent.push(text); callbacks.onTranscript({ id: 'injected', role: 'user', text }); }
        updateIdentity() { }
        setMemoryProject() { }
        setScreenSharing() { }
        getAudioLevel() { return 0; }
    }
    const recorded = [], window = { orvixDesktop: { onTinyWorkflowEvent: fn => { eventHandler = fn; return () => off++; } } };
    const pending = [];
    const { VoiceSession } = load('src/liveVoice.ts', { window, crypto: require('node:crypto'), setTimeout: fn => { pending.push(fn); return 1; }, clearTimeout: () => { }, require: name => name === './simpleFastVoice' ? { SimpleFastVoiceSession: Delegate } : name === './thinkingVoice' ? { ThinkingVoiceSession: Delegate } : name === './screenSharingCommands' ? { screenSharingCommand: () => false } : name === './companionMemory' ? { isMemoryControl: () => false } : name === './tinyAgentTools' ? { connectTinyWorkflowVoice: () => { }, recordTinyWorkflowHumanInput: (...args) => recorded.push(args) } : require(name) });
    for (const profile of ['Fast', 'Thinking']) {
        const voice = new VoiceSession(profile, 'MEDIUM', [], { onStatus: () => { }, onTranscript: () => { } });
        await voice.start(false);
        callbacks.onTranscript({ id: 'human', role: 'user', text: 'approve' });
        eventHandler({ kind: 'run_verified', runId: 'persistent-run', sequence: 1 });
        pending.shift()();
        assert.equal(recorded.length, profile === 'Fast' ? 1 : 2);
        voice.stop();
    }
    assert.equal(off, 2);
    assert.equal(cancelled, 2);
    assert.ok(sent.every(text => text.startsWith('System workflow observation')));
});
test('a late stop or input from the previous voice profile cannot detach or authorize the new session', async () => {
    const records = [], calls = [];
    const bridge = { recordTinyWorkflowVoiceInput: async value => records.push(value), manageTinyWorkflow: async value => { calls.push(value); return {}; } };
    const tools = load('src/tinyAgentTools.ts', { window: { orvixDesktop: bridge } });
    tools.connectTinyWorkflowVoice('old-session');
    tools.connectTinyWorkflowVoice('new-session');
    tools.connectTinyWorkflowVoice(undefined, 'old-session');
    tools.recordTinyWorkflowHumanInput('Fast', 'stale', 'approve', 'old-session');
    tools.recordTinyWorkflowHumanInput('Thinking', 'current', 'yes approve', 'new-session');
    await tools.invokeTinyAgentTool('manage_tiny_workflow', { action: 'approve', id: 'exact-id', revision: 1, request_id: 'stable' }, bridge);
    assert.equal(records.length, 1);
    assert.equal(records[0].sessionId, 'new-session');
    assert.equal(calls[0].voiceSessionId, 'new-session');
});
