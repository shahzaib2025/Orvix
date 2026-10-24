const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { withResources } = require('./workflow-resources.cjs');
async function createTinyRuntime(app, effects, adapters, options = {}) {
    const runtimeDirectory = __dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
    const worker = new Worker(path.join(runtimeDirectory, 'tiny-runtime-worker.cjs'), { workerData: { userData: app.getPath('userData'), capabilities: adapters.capabilities?.() ?? {}, heartbeatMs:options.heartbeatMs??5000 } });
    const pending = new Map(), effectsInFlight = new Map(), dispatchAcks = new Map();
    let sequence = 0, closed = false, failure, agentListing, workflowListing, nativePending, rules = [], pendingSince=0,lastSeenAt = Date.now(), controlState={status:'starting',backgroundEnabled:false};
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const fail = error => {
        if (closed || failure) return;
        failure = error; readyReject(error);
        for (const request of pending.values()) request.reject(error);
        pending.clear();
        for (const controller of effectsInFlight.values()) controller.abort();
        for (const request of dispatchAcks.values()) request.reject(error);
        dispatchAcks.clear();
        if (workflowListing) { workflowListing.storageError = 'The durable runtime stopped. Restart Orvix to recover checkpoints. ' + error.message;
            workflowListing.sequence++;
            effects.onWorkflowEvent?.({ kind: 'workflow_error', sequence: workflowListing.sequence, message: workflowListing.storageError, patch: {storageError:workflowListing.storageError} }); }
        if (agentListing) { agentListing.storageError = 'The durable runtime stopped. Restart Orvix to recover checkpoints.'; effects.onChange?.({kind:'storage_error',listing:agentListing}); }
        effects.onError?.(error);
    };
    worker.on('error', fail);
    worker.on('exit', code => { if (!closed) fail(new Error('Tiny runtime exited (' + code + ').')); });
    worker.on('message', async message => {
        lastSeenAt = Date.now();
        if (message.type === 'heartbeat') return;
        if(message.type==='control'){controlState=message.state;effects.onControl?.(controlState);return;}
        if (message.type === 'dispatchAck') { const request = dispatchAcks.get(message.id); dispatchAcks.delete(message.id); if(request) message.error ? request.reject(new Error(message.error)) : request.resolve(); return; }
        if (message.agents) agentListing = message.agents;
        if (message.workflows) workflowListing = message.workflows;
        if (message.sensorRules) rules = message.sensorRules;
        if (message.type === 'ready') { readyResolve(); return; }
        if (message.type === 'reply') { const request = pending.get(message.id); pending.delete(message.id); if (request) message.error ? request.reject(new Error(message.error)) : request.resolve(message.value); return; }
        if (message.type === 'agentEvent') { if (message.event.listing) agentListing = message.event.listing; effects.onChange?.(message.event); return; }
        if (message.type === 'workflowEvent') {
            const event = message.event, patch = event.patch;
            if (event.kind === 'workflow_error' && workflowListing) {
                workflowListing = { ...workflowListing, sequence: Math.max(workflowListing.sequence,event.sequence), storageError: event.message };
                event.patch = { ...patch, storageError: event.message };
            }
            if (patch && workflowListing) {
                const previous=patch.runUpdate&&workflowListing.runs.find(run=>run.id===patch.runUpdate.id&&run.revision===patch.runUpdate.revision);
                const run=patch.run??(previous?{...previous,...patch.runUpdate}:undefined);
                workflowListing = { ...workflowListing, ...patch, sequence: event.sequence,
                runs: run ? [run, ...workflowListing.runs.filter(item => item.id !== run.id)].slice(0, 200) : workflowListing.runs,
                definitions: patch.definitions ?? (patch.definition ? [...workflowListing.definitions.filter(item => item.id !== patch.definition.id), patch.definition] : workflowListing.definitions) };
                delete workflowListing.run; delete workflowListing.runUpdate; delete workflowListing.definition; }
            effects.onWorkflowEvent?.(event); return;
        }
        if (message.type === 'abort') { effectsInFlight.get(message.id)?.abort(); dispatchAcks.get(message.id)?.reject(new Error('Cancelled before dispatch.')); dispatchAcks.delete(message.id); return; }
        if (message.type === 'diagnostic') { effects.onError?.(new Error(message.message)); return; }
        if (message.type !== 'effect') return;
        const controller = new AbortController(); effectsInFlight.set(message.id, controller);
        const progress = value => { if (!closed) worker.postMessage({ type: 'progress', id: message.id, value }); };
        try {
            let value;
            if (message.method === 'execute') {
                const [step, input, context] = message.args;
                progress({ type: 'activity', message: 'Waiting for reviewed resources to become available.' });
                value = await withResources(adapters.resources?.(step, input, context.definition) ?? [], async () => {
                    const readiness = await adapters.validateDefinition?.(context.definition);
                    if (readiness?.status === 'setup_required') throw new Error(readiness.message || 'Reviewed capabilities are unavailable.');
                    await new Promise((resolve, reject) => {
                        dispatchAcks.set(message.id, { resolve, reject });
                        worker.postMessage({ type: 'dispatchReady', id: message.id });
                    });
                    if (controller.signal.aborted) throw new Error('Cancelled before dispatch.');
                    return adapters.execute(step, input, { ...context, signal: controller.signal, progress });
                }, controller.signal);
            } else if (message.method === 'executeAction') value = await withResources(['interaction'], () => effects.executeAction(...message.args), controller.signal);
            else {
                const callback = ({ notifyAgent: effects.notify, notifyWorkflow: adapters.notify, ...adapters, cancelNotification: effects.cancelNotification, shutdown: effects.shutdown })[message.method];
                if (!callback) throw new Error('Unsupported runtime effect.');
                value = await callback(...message.args);
            }
            if (!closed) worker.postMessage({ type: 'result', id: message.id, value });
        } catch (error) { if (!closed) worker.postMessage({ type: 'result', id: message.id, error: error.message }); }
        finally { effectsInFlight.delete(message.id); dispatchAcks.delete(message.id); }
    });
    function call(engine, method, args = [], readiness) {
        if (closed || failure) return Promise.reject(failure ?? new Error('Tiny runtime is closed.'));
        const id = ++sequence;
        if (!pending.size) pendingSince=Date.now();
        return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ type: 'call', id, engine, method, args, readiness }); });
    }
    const fire = (engine, method, args) => { void call(engine, method, args).catch(error => effects.onError?.(error)); };
    await ready;
    const agents = { list: () => structuredClone(agentListing), sensorRules: () => agentListing.rules.filter(rule=>rule.enabled&&!rule.draft).map(({condition,trigger,incident})=>({enabled:true,draft:false,condition,trigger,incident})) }, workflows = { list: () => structuredClone(workflowListing), sensorRules: () => rules, capabilities: () => adapters.capabilities?.() ?? {} };
    for (const method of ['draft', 'approve', 'setEnabled', 'remove', 'cancelShutdown', 'preview', 'snooze', 'duplicate', 'retryNotification', 'pauseAll', 'waitForActions']) agents[method] = (...args) => call('agents', method, args);
    agents.remove=async id=>{await call('agents','setEnabled',[id,false]);await call('agents','waitForActions',[id]);return call('agents','remove',[id]);};
    for (const method of ['inspect', 'history', 'draft', 'recordVoiceInput', 'waitForIdle']) workflows[method] = (...args) => call('workflows', method, args);
    workflows.manage = async input => {
        let readiness;
        if (['approve', 'enable', 'start', 'update_run'].includes(input.action)) {
            const id = input.id ?? workflowListing.runs.find(run => run.id === input.runId)?.definitionId;
            if (id) { const { definition } = await call('workflows', 'inspect', [{ id }]);
                readiness = { [definition.id + ':' + definition.revision]: await adapters.validateDefinition?.(definition) ?? { status: 'ready' } }; }
        }
        return call('workflows', 'manage', [input], readiness);
    };
    for (const method of ['notificationStatus', 'reset', 'ingestSensors', 'setVoiceActive', 'tick']) agents[method] = (...args) => fire('agents', method, args);
    for (const method of ['notificationStatus', 'resetSignals', 'setVoiceActive', 'tick']) workflows[method] = (...args) => fire('workflows', method, args);
    // One message keeps native observations and workflow conditions in order.
    agents.ingest = (...args) => { if (controlState.status === 'stopped') { args[1] ??= Date.now(); args[2] ??= args[1]; nativePending = args; } else fire('runtime', 'ingest', args); };
    const flushNative = async () => { if (nativePending) { const args = nativePending; nativePending = undefined; await call('runtime','ingest',args); } };
    agents.preview = async (...args) => { await flushNative(); return call('agents','preview',args); };
    agents.reset = (...args) => { nativePending=undefined; fire('agents','reset',args); };
    workflows.ingest = () => {};
    agents.start = workflows.start = () => {};
    agents.stop = workflows.stop = () => {};
    let closing;
    function health() {
        const idle=controlState.status==='stopped';
        const unresponsive=idle ? pending.size>0 && Date.now()-pendingSince>15000 : Date.now()-lastSeenAt>15000;
        return {status:failure?'unavailable':closed?'stopped':unresponsive?'unresponsive':'responding',idle,lastSeenAt,control:controlState,
            activeMonitors:agentListing?.rules.filter(rule=>rule.enabled||rule.executing).length??0,
            activeRuns:workflowListing?.runs.filter(run=>['running','waiting','queued','stopping','needs_attention'].includes(run.status)).length??0};
    }
    return { agents, workflows, control: input=>{if(input.action==='start')void flushNative().catch(error=>effects.onError?.(error));return call('runtime','control',[input]);}, health, close: () => closing ??= (async () => {
        try { await call('runtime', 'close'); }
        finally {
            for (const controller of effectsInFlight.values()) controller.abort();
            for (const request of dispatchAcks.values()) request.reject(new Error('Orvix is exiting.'));
            dispatchAcks.clear(); closed = true;
            for (const request of pending.values()) request.reject(new Error('Orvix is exiting. Inspect its recovery checkpoint after restart.'));
            pending.clear(); await worker.terminate();
        }
    })(), worker };
}
module.exports = { createTinyRuntime };
