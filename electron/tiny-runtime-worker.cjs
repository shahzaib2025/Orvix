// Durable engines live off Electron's main thread. Effects remain in the host.
const { parentPort, workerData } = require('node:worker_threads');
const { createTinyAgents } = require('./tiny-agents.cjs');
const { createTinyWorkflows } = require('./tiny-workflows.cjs');
const { createRuntimeControl } = require('./tiny-runtime-control.cjs');
const pending = new Map(); let sequence = 0, readiness = {};
const send = value => parentPort.postMessage(value);
function effect(method, args, context) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const abort = () => send({ type: 'abort', id });
        pending.set(id, { resolve, reject, progress: context?.progress, beforeDispatch: context?.beforeDispatch, cleanup: () => context?.signal?.removeEventListener('abort', abort) });
        send({ type: 'effect', id, method, args });
        context?.signal?.addEventListener('abort', abort, { once: true });
        if (context?.signal?.aborted) abort();
    });
}
const fire = (method, args) => { void effect(method, args).catch(error => send({ type: 'diagnostic', message: error.message })); };
const app = { getPath: () => workerData.userData };
const agents = createTinyAgents(app, {
    notify: (...args) => effect('notifyAgent', args),
    cancelNotification: (...args) => fire('cancelNotification', args),
    executeAction: (...args) => effect('executeAction', args),
    shutdown: () => fire('shutdown', []),
    onChange: event => send({ type: 'agentEvent', event }),
});
const workflows = createTinyWorkflows(app, {
    signalEvents: true,
    snapshot: agents.getSnapshot,
    capabilities: () => workerData.capabilities,
    validateDefinition: definition => readiness[definition.id + ':' + definition.revision] ?? { status: 'setup_required', message: 'Review capability availability again before approval.' },
    dispatchBarrier: true,
    execute: (step, input, context) => effect('execute', [step, input, { ...context, signal: undefined, progress: undefined, beforeDispatch: undefined }], context),
    inspectEffect: (...args) => effect('inspectEffect', args),
    notify: (...args) => effect('notifyWorkflow', args),
    cancelRun: (...args) => fire('cancelRun', args),
    cancelNotice: id => fire('cancelNotification',[id]),
    decideWorker: (...args) => fire('decideWorker', args),
    answerWorker: (...args) => fire('answerWorker', args),
    emit: event => send({ type: 'workflowEvent', event, sensorRules: workflows.sensorRules() }),
});
let heartbeat = null, voiceRequested = false;
const control=createRuntimeControl(workerData.userData,agents,workflows,state=>{
    const enabled = state.status === 'running';
    agents.setVoiceActive(enabled && voiceRequested); workflows.setVoiceActive(enabled && voiceRequested);
    if (state.status !== 'stopped' && !heartbeat) { heartbeat = setInterval(() => send({type:'heartbeat',at:Date.now()}),Math.max(50,workerData.heartbeatMs??5000)); heartbeat.unref(); }
    if (state.status === 'stopped' && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    send({type:'control',state});
});
function publish(id, value, error) {
    send({ type: 'reply', id, value, error, agents: agents.list(), workflows: workflows.list(), sensorRules: workflows.sensorRules() });
}
parentPort.on('message', async message => {
    if (message.type === 'dispatchReady') {
        try { const request = pending.get(message.id); if (!request) throw new Error('The effect is no longer pending.'); request.beforeDispatch?.(); send({ type: 'dispatchAck', id: message.id }); }
        catch (error) { send({ type: 'dispatchAck', id: message.id, error: error.message }); } return;
    }
    if (message.type === 'result') {
        const request = pending.get(message.id); if (!request) return;
        pending.delete(message.id); request.cleanup();
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value);
        return;
    }
    if (message.type === 'progress') { pending.get(message.id)?.progress?.(message.value); return; }
    if (message.type !== 'call') return;
    try {
        readiness = { ...readiness, ...message.readiness };
        if (message.engine === 'runtime' && message.method === 'ingest') {
            agents.ingest(...message.args);
            workflows.ingest(message.args[0], message.args[2] ?? message.args[1]);
            // A high frequency observation must not copy all definitions/history.
            send({ type: 'reply', id: message.id }); return;
        }
        if (message.engine === 'runtime' && message.method === 'close') {
            await control.stop('Orvix is closing. Work stays stopped until you start it again.');
            workflows.stop(); agents.stop();
            // The checkpoint is already durable, even if an external worker cannot stop promptly.
            publish(message.id, { checkpointed: true }); return;
        }
        if(message.engine==='runtime'&&message.method==='control'){const value=await control.manage(message.args[0]);publish(message.id,value);return;}
        if(!control.allows(message.engine,message.method,message.args))throw new Error('Tiny Agents are stopped. Use Start reviewed agents before enabling or continuing work.');
        const engine = message.engine === 'agents' ? agents : workflows;
        if (typeof engine[message.method] !== 'function') throw new Error('Unknown runtime operation.');
        if (message.method === 'setVoiceActive') { voiceRequested = message.args[0] === true; message.args = [voiceRequested && control.state().status === 'running']; }
        const value = await engine[message.method](...message.args);
        if (message.engine === 'agents' && message.method === 'ingestSensors') workflows.tick();
        control.forget(message.engine,message.method,message.args);
        if (['ingestSensors', 'setVoiceActive', 'tick', 'preview', 'history', 'inspect', 'recordVoiceInput', 'capabilities', 'waitForIdle', 'waitForActions'].includes(message.method)) send({ type: 'reply', id: message.id, value });
        else publish(message.id, value);
    } catch (error) { publish(message.id, undefined, error.message); }
});
void control.initialize().then(()=>{agents.start();workflows.start();send({ type: 'ready', agents: agents.list(), workflows: workflows.list(), sensorRules: workflows.sensorRules() });}).catch(error=>{setImmediate(()=>{throw error;});});
