const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { validId, safeValue } = require('./agent/durable-store.cjs');
const { normalizeDefinition, flattenSteps, resolveOutputs, always } = require('./tiny-workflow-contract.cjs');
const { evaluate } = require('./tiny-agents.cjs');
const { observe } = require('./tiny-agent-changes.cjs');
const { consumeEvents, fields: nativeFields } = require('./tiny-agent-event-stream.cjs');
const { scheduleState } = require('./tiny-agent-options.cjs');
const { withResources } = require('./workflow-resources.cjs');
const { readHistoryPage } = require('./tiny-workflow-history.cjs');
const terminal = new Set(['verified', 'cancelled', 'failed']);
const activeStates = new Set(['running', 'waiting', 'queued', 'paused', 'stopping', 'needs_attention']);
const readOnly = step => ['research', 'verify', 'wait', 'delay', 'branch', 'parallel'].includes(step.type);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
function createTinyWorkflows(app, adapters = {}, options = {}) {
    const now = options.now ?? Date.now, base = path.join(app.getPath('userData'), 'tiny-workflows');
    const checkpoint = path.join(base, 'checkpoint.json'), historyFile = path.join(base, 'events.jsonl');
    let state = { version: 1, sequence: 0, definitions: [], runs: [], requests: {}, notices: [] }, storageError = null, timer = null, timerIntervalMs = null, stopped = true, voiceActive = false;
    const running = new Map(), triggerState = new Map(), voice = new Map();
    let liveCursor = null;
    const signalWaiters = new Set(), idleWaiters = new Set();
    const wakeSignals = () => { for (const wake of [...signalWaiters]) wake(); };
    function waitForSignal(milliseconds, signal) {
        return new Promise(resolve => {
            if (signal.aborted) return resolve();
            const done = () => { clearTimeout(timer); signalWaiters.delete(done); signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, Math.max(1, milliseconds));
            signalWaiters.add(done); signal.addEventListener('abort', done, { once: true });
        });
    }
    function flushed(file, value, append = false) {
        const fd = fs.openSync(file, append ? 'a' : 'w', 0o600);
        try {
            fs.writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(safeValue(value)));
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    function replaceFile(source, target) { for (let attempt = 0; attempt < 5; attempt++) {
        try {
            fs.renameSync(source, target);
            return;
        }
        catch (error) {
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 4)
                throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
        }
    } }
    fs.mkdirSync(base, { recursive: true });
    let found = false, recoveredBackup = false;
    for (const file of [checkpoint, checkpoint + '.bak']) {
        if (!fs.existsSync(file))
            continue;
        found = true;
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (saved.version !== 1 || !Array.isArray(saved.definitions) || !Array.isArray(saved.runs) || !Array.isArray(saved.notices) || !saved.requests || typeof saved.requests !== 'object' || Array.isArray(saved.requests) || !Number.isInteger(saved.sequence))
                throw new Error('Invalid workflow checkpoint.');
            state = saved;
            recoveredBackup = file.endsWith('.bak');
            found = false;
            break;
        }
        catch { }
    }
    if (found)
        storageError = 'Workflow storage cannot be read. Restore its checkpoint; existing history has been preserved.';
    function persist(event) {
        if (storageError)
            throw new Error(storageError);
        try {
            options.beforePersist?.(state, event);
            archiveCompletedRuns();
            const temp = checkpoint + '.tmp';
            flushed(temp, state);
            if (fs.existsSync(checkpoint)) {
                let prior;
                try {
                    prior = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
                }
                catch { }
                if (prior?.version === 1) {
                    flushed(checkpoint + '.bak.tmp', prior);
                    replaceFile(checkpoint + '.bak.tmp', checkpoint + '.bak');
                }
            }
            replaceFile(temp, checkpoint);
            if (event)
                flushed(historyFile, JSON.stringify(safeValue(event)) + '\n', true);
            syncTimer();
        }
        catch (error) {
            storageError = 'Workflow checkpoint unavailable: ' + error.message;
            for (const controller of running.values())
                controller.abort();
            adapters.emit?.({ kind: 'workflow_error', sequence: ++state.sequence, message: storageError });
            throw new Error(storageError);
        }
    }
    function event(kind, run, detail = {}) {
        const value = { id: randomUUID(), sequence: ++state.sequence, kind, at: now(), runId: run?.id, definitionId: run?.definitionId, revision: run?.revision, ...safeValue(detail) };
        if (run) { run.lastProgressAt = value.at; run.updatedAt = value.at; }
        persist(value);
        const record = state.definitions.find(item => item.id === value.definitionId);
        const progress = kind === 'worker_progress' && run && state.runs.slice(-200).some(item=>item.id===run.id);
        adapters.emit?.({ ...value, patch: { ...(progress ? {runUpdate:{id:run.id,revision:run.revision,status:run.status,reason:run.reason,updatedAt:run.updatedAt,lastProgressAt:run.lastProgressAt,questions:safeValue(run.questions)}} : {run:run ? publicRun(run) : undefined}),
            definition: !progress && record ? { ...latest(record), approvedRevision: record.approvedRevision, enabled: record.enabled } : undefined,
            ...(['all_workflows_stopping','reviewed_work_resumed'].includes(kind)?{definitions:state.definitions.map(record=>({...latest(record),approvedRevision:record.approvedRevision,enabled:record.enabled}))}:{}),
            notices: state.notices.slice(-100), storageError, storageWarning: state.storageWarning } });
        return value;
    }
    function latest(record) { return record.versions.at(-1); }
    function archiveCompletedRuns() {
        const keep = options.hotRunLimit ?? 200;
        const completed = state.runs.filter(run => terminal.has(run.status) && !run.questions.length && !Object.values(run.steps).some(step => step.completionUnknown));
        if (completed.length <= keep) return;
        const directory = path.join(base, 'archive'); fs.mkdirSync(directory, { recursive: true });
        const archived = new Set();
        for (const run of completed.slice(0, completed.length - keep)) {
            const record = state.definitions.find(item => item.id === run.definitionId);
            if (record) record.usedRevisions = [...new Set([...(record.usedRevisions ?? []), run.revision])];
            const file = path.join(directory, validId(run.id) + '.json');
            flushed(file + '.tmp', run); replaceFile(file + '.tmp', file);
            archived.add(run.id);
        }
        state.runs = state.runs.filter(run => !archived.has(run.id));
        // Mutation receipts and approved revisions remain in the checkpoint.
        // An archived one-off cannot gain a fresh execution grant.
    }
    function recordFor(id) {
        const record = state.definitions.find(item => item.id === id);
        if (!record)
            throw new Error('Choose an exact workflow ID.');
        return record;
    }
    function runFor(id) {
        let run = state.runs.find(item => item.id === id);
        if (!run) { try { run = JSON.parse(fs.readFileSync(path.join(base, 'archive', validId(id) + '.json'), 'utf8')); if (run.id !== id) run = null; } catch {} }
        if (!run)
            throw new Error('Choose an exact run ID.');
        return run;
    }
    function publicRun(run) { const { definition, ...value } = run; const preview = output => output && { ...output, text: output.text?.slice(0, 6000), artifact: output.artifact ? { ...output.artifact, content: output.artifact.content?.slice(0, 30000) } : undefined, task: undefined, actual: undefined }; return { ...value, steps: Object.fromEntries(Object.entries(value.steps).map(([id, step]) => [id, { ...step, output: preview(step.output) }])), outputs: Object.fromEntries(Object.entries(value.outputs).map(([id, output]) => [id, preview(output)])), evidence: value.evidence.slice(-10), evidenceCount: value.evidence.length }; }
    function list() { return structuredClone({ sequence: state.sequence, storageError, storageWarning: state.storageWarning, notices: state.notices.slice(-100), definitions: state.definitions.map(record => ({ ...latest(record), approvedRevision: record.approvedRevision, enabled: record.enabled })), runs: state.runs.slice(-200).reverse().map(publicRun) }); }
    function history(input = {}) {
        return readHistoryPage(historyFile, state.sequence, input);
    }
    function inspect(input = {}) {
        const record = input.id ? recordFor(input.id) : input.runId ? recordFor(runFor(input.runId).definitionId) : null;
        if (!record)
            return list();
        const definition = input.runId ? runFor(input.runId).definition : latest(record);
        if (input.voiceSessionId) {
            const session = voice.get(input.voiceSessionId);
            if (session)
                session.review = { id: record.id, revision: definition.revision, turn: session.turn,questionIds:input.runId?runFor(input.runId).questions.map(question=>question.id):[] };
        }
        const selectedRun = input.runId ? runFor(input.runId) : null, offset = Math.max(0, Number(input.evidenceOffset) || 0);
        const related = state.runs.filter(run => run.definitionId === record.id).slice(-20).reverse();
        if (selectedRun && !related.some(run => run.id === selectedRun.id)) related.unshift(selectedRun);
        return structuredClone({ definition, enabled: record.enabled, approvedRevision: record.approvedRevision, runs: related.map(publicRun), evidence: { records: selectedRun?.evidence.slice(offset, offset + 50) ?? [], nextOffset: selectedRun && selectedRun.evidence.length > offset + 50 ? offset + 50 : null }, history: history({ runId: input.runId, after: input.after }), capabilities: adapters.capabilities?.() ?? {}, storageError });
    }
    function memo(input, operation) {
        validId(input.requestId);
        const signature = fingerprint({ ...input, requestId: undefined });
        const old = state.requests[input.requestId];
        if (old) {
            if (old.signature !== signature)
                throw new Error('A request ID cannot authorize different operations.');
            if (old.error)
                throw new Error(old.error);
            if (!old.result)
                throw new Error('This request was interrupted. Inspect saved drafts/runs before issuing a new request.');
            return structuredClone(old.result);
        }
        state.requests[input.requestId] = { signature };
        persist();
        let result;
        try {
            result = operation();
        }
        catch (error) {
            if (!storageError) {
                state.requests[input.requestId] = { signature, error: error.message };
                persist();
            }
            throw error;
        }
        state.requests[input.requestId] = { signature, result: safeValue(result) };
        persist();
        return structuredClone(result);
    }
    function draft(input) {
        return memo(input, () => {
            const definition = normalizeDefinition(input.definition ?? input), record = input.id ? recordFor(input.id) : { id: randomUUID(), versions: [], approvedRevision: null, enabled: false };
            if (input.id && input.revision !== latest(record).revision)
                throw new Error('This draft changed; reload its current revision.');
            const value = { ...definition, id: record.id, revision: (latest(record)?.revision ?? 0) + 1, approved: false, createdAt: now() };
            record.versions.push(value);
            if (!input.id)
                state.definitions.push(record);
            event('draft_saved', null, { definitionId: record.id, revision: value.revision });
            return { status: 'review_required', definition: value, message: 'Draft saved. Review its exact steps, targets and checks before approval.' };
        });
    }
    function recordVoiceInput(input) {
        validId(input.sessionId);
        if (typeof input.text !== 'string' || input.text.length > 16000 || !['Fast', 'Thinking'].includes(input.profile))
            throw new Error('Invalid human voice input.');
        const session = voice.get(input.sessionId) ?? { turn: 0, review: null };
        if (session.inputId !== input.inputId)
            session.turn++;
        session.inputId = input.inputId;
        session.text = input.text;
        session.profile = input.profile;
        voice.set(input.sessionId, session);
        while (voice.size > 10)
            voice.delete(voice.keys().next().value);
        return true;
    }
    function validateVoiceApproval(input, definition) {
        if (!input.voiceSessionId)
            return;
        const session = voice.get(input.voiceSessionId), review = session?.review;
        const human = (session?.text ?? '').trim();
        const explicit = /^(?:(?:yes|okay|ok)[,.! ]*|(?:please\s+)?(?:approve|enable|start|run)\b|i\s+approve\b|হ্যাঁ|অনুমোদন|চালু কর|শুরু কর)/i.test(human) && !/[?]|\b(don't|do not|not yet|never|cancel|no|if|unless)\b|না[।.! ]*$/i.test(human);
        if (!review || review.id !== definition.id || review.revision !== definition.revision || session.turn <= review.turn || !explicit||input.questionId&&!review.questionIds?.includes(input.questionId))
            throw new Error('Review this exact workflow, then explicitly approve it in a new human turn.');
    }
    function queue(definition, input = {}) {
        const existing = state.runs.filter(run => run.definitionId === definition.id && activeStates.has(run.status));
        if (definition.execution.mode === 'single' && existing.length) {
            event('overlap_ignored', existing[0]);
            return { status: 'already_running', runId: existing[0].id };
        }
        if (definition.execution.mode === 'restart' && existing.length) {
            for (const run of existing) {
                run.restartRequested = true;
                running.get(run.id)?.abort();
            }
            if (existing.some(run => running.has(run.id))) {
                event('restart_waiting', existing[0]);
                existing[0].restartRequested = structuredClone(definition);
                persist();
                return { status: 'waiting_for_cancellation', runId: existing[0].id };
            }
            for (const run of existing)
                run.status = 'cancelled';
        }
        if (existing.filter(run => activeStates.has(run.status)).length >= definition.execution.maxRuns) {
            event('queue_full', existing[0]);
            return { status: 'capacity_reached', message: 'The reviewed run capacity is full.' };
        }
        const id = randomUUID(), run = { id, definitionId: definition.id, revision: definition.revision, definition: structuredClone(definition), status: 'queued', createdAt: now(), updatedAt: now(), steps: {}, outputs: {}, evidence: [], questions: [], trigger: safeValue(input.trigger ?? null), reason: 'Waiting for a runner.' };
        state.runs.push(run);
        event('run_queued', run);
        schedulePump();
        return { status: 'queued', runId: id, definitionId: definition.id, revision: definition.revision };
    }
    function approve(record, input) {
        const definition = latest(record);
        if (input.revision !== definition.revision)
            throw new Error('Approval is stale. Review the current revision.');
        validateVoiceApproval(input, definition);
        const readiness = adapters.validateDefinition?.(definition);
        if (readiness?.status === 'setup_required')
            return readiness;
        if (definition.approved) {
            if (record.enabled)
                return { status: 'already_approved', definitionId: record.id, revision: definition.revision };
            if (!definition.recurring && (record.usedRevisions?.includes(definition.revision) || state.runs.some(run => run.definitionId === record.id && run.revision === definition.revision)))
                return { status: 'already_completed', message: 'This one-off approval has already been used. Review a new revision for another run.' };
            record.enabled = true;
            triggerState.delete(record.id);
            event('definition_enabled', null, { definitionId: record.id, revision: definition.revision });
            return { status: 'watching', definitionId: record.id, revision: definition.revision };
        }
        if (definition.mode === 'Plan')
            return { status: 'plan_only', message: 'Plan mode saves a draft and does not enable work.' };
        definition.approved = true;
        record.approvedRevision = definition.revision;
        record.enabled = true;
        triggerState.delete(record.id);
        event('definition_approved', null, { definitionId: record.id, revision: definition.revision });
        return definition.trigger || definition.schedule.mode !== 'always' ? { status: 'watching', definitionId: record.id, revision: definition.revision } : queue(definition);
    }
    function manage(input) {
        return memo(input, () => {
            if (input.action === 'review' || input.action === 'inspect')
                return inspect({ id: input.id, runId: input.runId, voiceSessionId: input.voiceSessionId });
            if (input.action === 'duplicate') {
                const original = latest(recordFor(input.id)), copy = { id: randomUUID(), versions: [], approvedRevision: null, enabled: false };
                if (input.revision !== original.revision)
                    throw new Error('Reload the current draft revision before duplicating it.');
                copy.versions.push({ ...structuredClone(original), id: copy.id, revision: 1, approved: false, name: original.name + ' copy', createdAt: now() });
                state.definitions.push(copy);
                event('draft_saved', null, { definitionId: copy.id, revision: 1 });
                return { status: 'review_required', definition: copy.versions[0] };
            }
            if (input.action === 'approve')
                return approve(recordFor(input.id), input);
            if (input.action === 'start') {
                const record = recordFor(input.id), def = record.versions.find(value => value.revision === record.approvedRevision);
                if (!def?.approved || !record.enabled || input.revision !== def.revision)
                    throw new Error('Review and approve this revision before starting.');
                if (!def.recurring && state.runs.some(run => run.definitionId === def.id && run.revision === def.revision))
                    throw new Error('This approval was one-off; duplicate or revise the draft for another run.');
                return queue(def);
            }
            if (input.action === 'disable') {
                const record = recordFor(input.id);
                if (input.revision !== latest(record).revision)
                    throw new Error('Reload the current revision.');
                record.enabled = false;
                event('definition_disabled', null, { definitionId: record.id });
                return { status: 'disabled' };
            }
            const run = runFor(input.runId);
            if (input.revision !== run.revision)
                throw new Error('This run revision changed; review it again.');
            if (input.action === 'update_run') {
                if (!['paused', 'needs_attention'].includes(run.status) || running.has(run.id))
                    throw new Error('Pause this task and wait for its current operation to stop before reviewing remaining work.');
                if (Object.values(run.steps).some(step => step.completionUnknown))
                    throw new Error('Inspect interrupted effects before changing this run.');
                const record = recordFor(run.definitionId), definition = latest(record);
                if (input.newRevision !== definition.revision || definition.revision <= run.revision)
                    throw new Error('Choose and review the exact new draft revision.');
                validateVoiceApproval(input, definition);
                if (definition.mode === 'Plan')
                    throw new Error('Plan mode cannot execute remaining work.');
                const readiness = adapters.validateDefinition?.(definition);
                if (readiness?.status === 'setup_required')
                    return readiness;
                const oldSteps = flattenSteps(run.definition.steps), newSteps = flattenSteps(definition.steps);
                for (const [id, current] of Object.entries(run.steps))
                    if (current.status === 'done') {
                        const old = oldSteps.find(step => step.id === id), next = newSteps.find(step => step.id === id);
                        if (!next || fingerprint(old) !== fingerprint(next))
                            throw new Error('A completed step changed. Draft a separate repair using its saved outputs instead of replaying completed work.');
                    }
                definition.approved = true;
                record.approvedRevision = definition.revision;
                record.enabled = true;
                run.definition = structuredClone(definition);
                run.revision = definition.revision;
                for (const [id, current] of Object.entries(run.steps))
                    if (current.status !== 'done') {
                        delete run.steps[id];
                        delete run.outputs[id];
                    }
                run.questions = [];
                delete run.stopRequested; delete run.executionStoppedAt;
                run.status = 'queued';
                run.reason = 'Revised remaining work reviewed and approved.';
                event('run_revision_approved', run);
                triggerState.delete(record.id);
                schedulePump();
                return { status: 'queued', runId: run.id, revision: run.revision };
            }
            if (input.action === 'pause' || input.action === 'cancel') {
                const cancel = input.action === 'cancel';
                if (terminal.has(run.status)) return { status: run.status, runId: run.id };
                run.stopRequested = cancel ? 'cancelled' : 'paused';
                run.status = running.has(run.id) ? 'stopping' : run.stopRequested;
                run.reason = running.has(run.id) ? 'Stopping execution; waiting for the current operation to acknowledge.' : 'Execution stopped. Previously completed effects are retained.';
                running.get(run.id)?.abort();
                adapters.cancelRun?.(run.id);
                event(run.status === 'stopping' ? 'run_stopping' : cancel ? 'run_cancelled' : 'run_paused', run);
                return { status: run.status, runId: run.id };
            }
            if (input.action === 'resume' || input.action === 'retry') {
                if (terminal.has(run.status))
                    throw new Error('This run has finished. Review a new draft instead.');
                if (running.has(run.id))
                    throw new Error('Wait until the current operation stops before continuing.');
                const unknown = Object.values(run.steps).find(step => step.completionUnknown);
                if (unknown)
                    throw new Error('An effect has an uncertain outcome. Inspect it and resolve its result before continuing.');
                for (const item of Object.values(run.steps))
                    if (item.status === 'needs_attention')
                        item.status = 'pending';
                run.questions = [];
                run.status = 'queued';
                run.reason = 'Continue requested.';
                event('run_resumed', run);
                schedulePump();
                return { status: 'queued', runId: run.id };
            }
            if (input.action === 'answer') {
                const question = run.questions.find(value => value.id === input.questionId);
                if (!question)
                    throw new Error('This question is no longer pending.');
                if ((question.kind === 'approval' || question.kind === 'worker_approval') && input.accepted === true)
                    validateVoiceApproval(input, run.definition);
                if (question.kind === 'effect_unknown')
                    throw new Error('Inspect the actual effect; a spoken assertion cannot establish verification.');
                if (question.kind === 'approval') {
                    if (input.accepted !== true) {
                        run.status = 'paused';
                        run.reason = 'Approval declined.';
                    }
                    else {
                        run.steps[question.stepId].approved = true;
                        run.steps[question.stepId].status = 'pending';
                        run.status = 'queued';
                    }
                }
                else if (question.kind === 'worker_approval')
                    adapters.decideWorker?.(question.approvalId, input.accepted === true);
                else if (question.kind === 'worker_question')
                    adapters.answerWorker?.(question.questionId, String(input.answer ?? ''));
                run.questions = run.questions.filter(item => item.id !== question.id);
                event('question_answered', run, { questionId: question.id });
                schedulePump();
                return { status: run.status };
            }
            if (input.action === 'resolve') {
                const step = flattenSteps(run.definition.steps).find(item => item.id === input.stepId), current = run.steps[input.stepId];
                if (!step || !current?.completionUnknown)
                    throw new Error('Choose an uncertain step.');
                run.reason = 'Inspecting the actual interrupted effect.';
                event('effect_inspection_started', run, { stepId: step.id });
                void Promise.resolve().then(() => adapters.inspectEffect?.(step, resolveOutputs(step.input ?? {}, run.outputs), { runId: run.id, definition: run.definition, requestId: current.requestId })).then(result => {
                    if (result?.verified === true) {
                        run.outputs[step.id] = safeValue(result.output);
                        setStep(run, step, { status: 'done', completionUnknown: false, output: safeValue(result.output) });
                        run.reason = 'The interrupted effect was independently observed. You may continue.';
                    }
                    else if (result?.safeToResume === true) {
                        setStep(run, step, { status: 'pending', completionUnknown: false });
                        run.reason = 'The project engine has a safe checkpoint. You may continue.';
                    }
                    else
                        run.reason = result?.message || 'The effect could not be verified. Review a repair before repeating it.';
                    run.questions = run.questions.filter(question => question.stepId !== step.id || run.steps[step.id].completionUnknown);
                    event('effect_inspected', run, { stepId: step.id, message: run.reason });
                }).catch(error => { run.reason = error.message; event('effect_inspection_failed', run, { message: error.message }); });
                return { status: 'checking', runId: run.id };
            }
            if (input.action === 'repair') {
                const def = run.definition;
                function remaining(list) {
                    return list.flatMap(step => {
                        const current = run.steps[step.id];
                        if (['done', 'skipped'].includes(current?.status))
                            return [];
                        if (current?.completionUnknown)
                            return [];
                        const copy = structuredClone(step);
                        if (copy.then) {
                            copy.then = remaining(copy.then);
                            copy.else = remaining(copy.else);
                            if (!copy.then.length)
                                return copy.else;
                        }
                        if (copy.branches) {
                            copy.branches = copy.branches.map(remaining).filter(branch => branch.length);
                            if (copy.branches.length < 2)
                                return copy.branches[0] ?? [];
                        }
                        if (copy.input)
                            copy.input = replaceCompleted(copy.input, run.outputs);
                        return [copy];
                    });
                }
                const steps = remaining(def.steps), ids = new Set(flattenSteps(steps).map(step => step.id)), acceptance = def.acceptance.filter(criterion => ids.has(criterion.stepId));
                if (!acceptance.length || Object.values(run.steps).some(step => step.completionUnknown))
                    return { status: 'repair_required', run: structuredClone(run), message: 'Inspect uncertain effects first, then draft observed checks for the remaining work. Completed effects will not be replayed.' };
                const normalized = normalizeDefinition({ ...def, name: def.name + ' repair', mode: 'Repair', trigger: null, schedule: { mode: 'always', timezone: def.schedule.timezone }, recurring: false, steps, acceptance });
                const copy = { id: randomUUID(), approvedRevision: null, enabled: false, versions: [] };
                copy.versions.push({ ...normalized, id: copy.id, revision: 1, approved: false, createdAt: now() });
                state.definitions.push(copy);
                event('repair_drafted', run, { definitionId: copy.id });
                return { status: 'review_required', definition: copy.versions[0] };
            }
            throw new Error('Unsupported workflow control.');
        });
    }
    function snapshot() { return adapters.snapshot?.() ?? null; }
    function conditionResult(condition) {
        const value = snapshot();
        function fresh(c) {
            if (c.op !== 'predicate')
                return c.children.every(fresh);
            if (c.signal === 'always')
                return true;
            const sensor = ['file_exists', 'folder_new_file', 'browser_download', 'network_online', 'cpu_percent', 'memory_percent', 'disk_free_percent'].includes(c.signal);
            const at = sensor ? require('./tiny-signal-freshness.cjs').observationAt(value, c.signal, c.target) : value?.PcObservedAt ?? value?.at ?? 0;
            return value && at && now() - Number(at) <= (['network_online', 'disk_free_percent'].includes(c.signal) ? 45000 : 15000);
        }
        return fresh(condition) ? evaluate(condition, value, now()) : null;
    }
    function setStep(run, step, patch, kind = 'step_updated') { const current = run.steps[step.id] ?? { id: step.id, title: step.title, type: step.type, status: 'pending' }; run.steps[step.id] = { ...current, ...patch }; run.updatedAt = now(); event(kind, run, { step: run.steps[step.id] }); }
    class Attention extends Error {
    }
    function attention(run, step, reason, unknown = false) {
        setStep(run, step, { status: 'needs_attention', reason, completionUnknown: unknown });
        run.status = 'needs_attention';
        run.reason = reason;
        if (unknown && !run.questions.some(q => q.stepId === step.id))
            run.questions.push({ id: randomUUID(), stepId: step.id, kind: 'effect_unknown', question: reason });
        event('run_needs_attention', run, { message: reason });
        throw new Attention(reason);
    }
    function skip(run, list) {
        for (const step of flattenSteps(list))
            if (!run.steps[step.id])
                setStep(run, step, { status: 'skipped', reason: 'Branch not selected.' });
    }
    async function executeList(run, list, controller) {
        for (const step of list) {
            if (stopped || controller.signal.aborted || !['running', 'waiting'].includes(run.status))
                return;
            await executeStep(run, step, controller);
        }
    }
    async function executeStep(run, step, controller) {
        const saved = run.steps[step.id];
        if (['done', 'skipped'].includes(saved?.status))
            return;
        if (saved?.completionUnknown)
            attention(run, step, 'An interrupted effect must be inspected before continuing.', true);
        if (step.type === 'delay' || step.type === 'wait') {
            const current = saved ?? {};
            if (!current.deadline)
                setStep(run, step, { status: 'waiting', startedAt: now(), deadline: now() + (step.type === 'delay' ? step.seconds : step.timeoutSeconds) * 1000, baseline: step.type === 'wait' ? conditionResult(step.condition) : null });
            while (!controller.signal.aborted && !stopped) {
                const status = run.steps[step.id], actual = step.type === 'wait' ? conditionResult(step.condition) : true;
                if (step.type === 'delay' && now() >= status.deadline || step.type === 'wait' && actual === true && (!step.event || status.observedFalse === true)) {
                    run.outputs[step.id] = { verified: true, at: now() };
                    setStep(run, step, { status: 'done', completedAt: now() });
                    return;
                }
                if (step.type === 'wait' && actual === false && !status.observedFalse)
                    setStep(run, step, { observedFalse: true });
                if (now() >= status.deadline)
                    attention(run, step, actual === null ? 'Wait expired: current readings are unavailable.' : 'Wait expired before its condition/event.');
                const remaining = Math.max(1, status.deadline - now());
                if (step.type === 'delay') await sleep(remaining, controller.signal);
                else await waitForSignal(Math.min(remaining, adapters.signalEvents ? 3000 : 100), controller.signal);
            }
            return;
        }
        if (step.type === 'branch') {
            const selected = saved?.selected ?? conditionResult(step.condition);
            if (selected === null)
                attention(run, step, 'Branch conditions are unavailable or stale.');
            setStep(run, step, { status: 'running', selected });
            skip(run, selected ? step.else : step.then);
            await executeList(run, selected ? step.then : step.else, controller);
            if (!controller.signal.aborted && ['running', 'waiting'].includes(run.status)) {
                run.outputs[step.id] = { status: 'ok', selected, outputs: Object.fromEntries(flattenSteps(selected ? step.then : step.else).filter(child => run.outputs[child.id]).map(child => [child.id, run.outputs[child.id]])) };
                setStep(run, step, { status: 'done', completedAt: now() });
            }
            return;
        }
        if (step.type === 'parallel') {
            setStep(run, step, { status: 'running' });
            const results = await Promise.allSettled(step.branches.map(branch => executeList(run, branch, controller)));
            if (results.some(result => result.status === 'rejected'))
                throw new Attention('A parallel branch needs attention.');
            if (!controller.signal.aborted && ['running', 'waiting'].includes(run.status)) {
                run.outputs[step.id] = { status: 'ok', branches: step.branches.map(branch => Object.fromEntries(flattenSteps(branch).filter(child => run.outputs[child.id]).map(child => [child.id, run.outputs[child.id]]))) };
                setStep(run, step, { status: 'done', completedAt: now() });
            }
            return;
        }
        if (step.type === 'approval' && !saved?.approved) {
            setStep(run, step, { status: 'needs_attention', reason: 'Waiting for the reviewed checkpoint approval.' });
            run.questions.push({ id: randomUUID(), stepId: step.id, kind: 'approval', question: step.input?.message || step.title });
            run.status = 'needs_attention';
            run.reason = 'Your approval is required.';
            event('approval_required', run);
            throw new Attention(run.reason);
        }
        if (step.type === 'approval') {
            run.outputs[step.id] = { status: 'ok', approved: true, at: now() };
            setStep(run, step, { status: 'done', completedAt: now() });
            return;
        }
        const input = resolveOutputs(step.input ?? {}, run.outputs);
        setStep(run, step, { status: 'running', requestId: saved?.requestId ?? `${run.id}-${step.id}`, startedAt: now(), completionUnknown: false });
        let output;
        try {
            if (step.type === 'verify' && input.kind === 'condition') {
                const actual = conditionResult(input.condition);
                output = { status: actual === true ? 'verified' : 'unavailable', verified: actual === true, actual, at: now() };
            }
            else if (step.type === 'verify' && input.kind === 'output') {
                const value = input.value, passed = input.equals !== undefined ? JSON.stringify(value) === JSON.stringify(input.equals) : value?.verified === true || value?.status === 'ok';
                output = { status: passed ? 'verified' : 'failed', verified: passed, actual: value, at: now() };
            }
            else {
                const keys = adapters.resources?.(step, input, run.definition) ?? [];
                output = await withResources(keys, () => {
                    const beforeDispatch = () => {
                        if (controller.signal.aborted) throw new Error('Cancelled before dispatch.');
                        if (!readOnly(step)) setStep(run, step, { completionUnknown: true }, 'effect_dispatching');
                    };
                    if (!adapters.dispatchBarrier) beforeDispatch();
                    return executeAdapter(step, input, { runId: run.id, definition: run.definition, requestId: run.steps[step.id].requestId, previousOutput: run.outputs[step.id], signal: controller.signal, beforeDispatch, progress: value => workerProgress(run, step, value) });
                }, controller.signal);
            }
        }
        catch (error) {
            if (controller.signal.aborted)
                return;
            attention(run, step, error.message, !readOnly(step) && run.steps[step.id].completionUnknown === true);
        }
        if (controller.signal.aborted || stopped) {
            if (output?.verified === true) {
                run.outputs[step.id] = safeValue(output);
                setStep(run, step, { status: 'done', completionUnknown: false, completedAt: now(), output: safeValue(output) });
            }
            return;
        }
        if (!output || !['ok', 'verified', 'launched', 'queued', 'awaiting_verification'].includes(output.status)) {
            run.outputs[step.id] = safeValue(output ?? {});
            attention(run, step, output?.message || output?.reason || 'This step is incomplete.', output?.completionUnknown === true);
        }
        if (step.type === 'verify' && output.verified !== true || step.type === 'project' && output.verified !== true)
            attention(run, step, 'The acceptance checks are not verified.');
        run.outputs[step.id] = safeValue(output);
        setStep(run, step, { status: 'done', completionUnknown: false, completedAt: now(), output: safeValue(output) });
        if (output?.verified) {
            run.evidence.push({ id: randomUUID(), stepId: step.id, at: now(), evidence: output.evidence ?? output });
            persist();
        }
    }
    async function executeAdapter(step, input, context) { const retryable = ['research', 'verify'].includes(step.type); for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const result = await adapters.execute(step, input, context);
            if (!retryable || !['unavailable', 'busy', 'timed_out'].includes(result?.status) || attempt === 2 || context.signal.aborted)
                return result;
        }
        catch (error) {
            if (!retryable || attempt === 2 || context.signal.aborted)
                throw error;
        }
        context.progress({ type: 'activity', message: 'Retrying a read with the same request ID.' });
        await sleep(attempt === 0 ? 150 : 400, context.signal);
    } throw new Error('Read retries exhausted.'); }
    function workerProgress(run, step, value) {
        if (stopped || terminal.has(run.status) || run.stopRequested || running.get(run.id)?.signal.aborted)
            return;
        if (value.type === 'stream' || value.phase === 'delta')
            return;
        const payload = safeValue({ ...value, delta: undefined, screenshot: undefined, text: typeof value.text === 'string' ? value.text.slice(0, 4000) : value.text, output: typeof value.output === 'string' ? value.output.slice(0, 6000) : value.output });
        if (value.type === 'approval' || value.type === 'clarification') {
            const kind = value.type === 'approval' ? 'worker_approval' : 'worker_question';
            if (!run.questions.some(item => item.kind === kind && item.approvalId === value.approvalId && item.questionId === value.questionId))
                run.questions.push({ ...payload, id: randomUUID(), stepId: step.id, kind });
            run.reason = 'Worker needs your input.';
            notice(run, true);
        }
        event('worker_progress', run, { stepId: step.id, worker: payload });
    }
    function deliverNotice(record) {
        const run = runFor(record.runId);
        record.status = 'dispatching';
        persist();
        void Promise.resolve(adapters.notify?.({ noticeId: record.id, runId: run.id, definitionId: run.definitionId, title: run.definition.name, body: record.body, status: run.status })).then(result => { record.delivery = result?.id; if (['pending', 'dispatching'].includes(record.status))
            record.status = result?.status ?? 'unavailable'; persist(); }).catch(() => {
            record.status = 'needs_retry';
            if (!storageError)
                persist();
        });
    }
    function notificationStatus(value) {
        const record = state.notices.find(item => item.id === value.id);
        if (record) {
            if(record.status==='cancelled')return;
            record.status = value.status;
            record.error = value.reason;
            event('notification_status', runFor(record.runId), { noticeId: record.id, status: value.status, message: value.reason });
        }
        else {
            for (const run of state.runs)
                for (const [id, output] of Object.entries(run.outputs))
                    if (output?.id === value.id) {
                        output.deliveryStatus = value.status;
                        event('notification_status', run, { stepId: id, noticeId: value.id, status: value.status, message: value.reason });
                    }
        }
    }
    function notice(run, required = false) {
        if (!required && !['verified', 'needs_attention', 'failed'].includes(run.status))
            return;
        const key = `${run.id}:${run.status}:${run.reason}:${required ? run.questions.map(question => question.id).join(',') : ''}`;
        if (state.notices.some(item => item.key === key))
            return;
        const record = { id: randomUUID(), key, runId: run.id, status: 'pending', body: run.reason };
        state.notices.push(record);
        persist();
        deliverNotice(record);
    }
    async function runJob(run) {
        const controller = new AbortController();
        running.set(run.id, controller);
        run.status = 'running';
        run.reason = 'Working through the approved steps.';
        try {
            event('run_started', run);
            await executeList(run, run.definition.steps, controller);
            if (!controller.signal.aborted && run.status === 'running') {
                const unmet = run.definition.acceptance.filter(criterion => run.steps[criterion.stepId]?.status !== 'done' || run.outputs[criterion.stepId]?.verified !== true);
                run.status = unmet.length ? 'needs_attention' : 'verified';
                run.reason = unmet.length ? 'Some acceptance checks remain unverified.' : 'All approved acceptance checks are verified.';
                event(unmet.length ? 'run_needs_attention' : 'run_verified', run);
            }
        }
        catch (error) {
            if (!controller.signal.aborted && !(error instanceof Attention) && !storageError) {
                run.status = 'needs_attention';
                run.reason = error.message;
                event('run_needs_attention', run, { message: error.message });
            }
        }
        finally {
            running.delete(run.id);
            try {
            if (!storageError) {
                if (controller.signal.aborted && ['running', 'waiting', 'stopping'].includes(run.status)) {
                    run.status = run.stopRequested ?? 'paused';
                    run.executionStoppedAt = now();
                    run.effectsUncertain = Object.values(run.steps).some(step => step.completionUnknown);
                    run.reason = run.effectsUncertain ? 'Execution stopped. An interrupted effect needs inspection; it will not be repeated automatically.' : 'Execution stopped at its checkpoint. Completed effects are retained.';
                    event(run.status === 'cancelled' ? 'run_cancelled' : 'run_paused', run);
                }
                notice(run);
                const replacement = run.restartRequested;
                delete run.restartRequested;
                if (replacement && typeof replacement === 'object' && !stopped && !Object.values(run.steps).some(step => step.completionUnknown)) {
                    run.status = 'cancelled';
                    event('run_cancelled', run);
                    queue(replacement);
                }
                schedulePump();
            }
            } finally { if (!running.size) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear(); } }
        }
    }
    let pumpPending = false;
    function schedulePump() {
        if (stopped || storageError || pumpPending)
            return;
        pumpPending = true;
        queueMicrotask(() => { pumpPending = false; pump(); });
    }
    function pump() {
        if (stopped || storageError)
            return;
        for (const run of state.runs.filter(run => run.status === 'queued')) {
            const active = state.runs.filter(other => other.definitionId === run.definitionId && (running.has(other.id)||run.definition.execution.mode!=='parallel'&&other.id!==run.id&&['paused','needs_attention'].includes(other.status)&&other.createdAt<=run.createdAt));
            if (active.length >= (run.definition.execution.mode === 'parallel' ? run.definition.execution.maxRuns : 1))
                continue;
            void runJob(run).catch(error => { if (!storageError)
                adapters.emit?.({ kind: 'workflow_error', sequence: ++state.sequence, message: error.message }); });
        }
    }
    function tick() {
        wakeSignals();
        if (stopped || storageError)
            return;
        try {
            for (const record of state.definitions.filter(record => record.enabled)) {
                const def = record.versions.find(value => value.revision === record.approvedRevision);
                if (!def || (!def.trigger && def.schedule.mode === 'always'))
                    continue;
                if (!def.recurring && (record.usedRevisions?.includes(def.revision) || state.runs.some(run => run.definitionId === record.id && run.revision === def.revision)))
                    continue;
                let runtime = triggerState.get(record.id);
                if (!runtime) {
                    runtime = { last: null, holdAt: null, watches: new Map(), scheduleKey: record.scheduleKey };
                    triggerState.set(record.id, runtime);
                }
                const schedule = scheduleState(def.schedule, now(), runtime.scheduleKey);
                if (!schedule.allowed)
                    continue;
                const actual = def.trigger ? conditionResult(def.trigger.condition) : true;
                let fire = false;
                if (def.trigger?.change) {
                    const fresh = snapshot();
                    if (fresh && now() - Number(fresh.PcObservedAt ?? fresh.at ?? 0) <= 15000)
                        fire = observe(def.trigger.change, runtime.watches, fresh, now()).changes.length > 0 && actual === true;
                }
                else if (def.trigger) {
                    if (runtime.last === null) {
                        runtime.last = actual;
                        continue;
                    }
                    if (actual === false)
                        runtime.holdAt = null;
                    if (actual === true && runtime.last === false)
                        runtime.holdAt = now();
                    fire = actual === true && runtime.holdAt !== null && now() - runtime.holdAt >= def.trigger.holdSeconds * 1000;
                    if (fire)
                        runtime.holdAt = null;
                    if (actual !== null)
                        runtime.last = actual;
                }
                else {
                    if (!schedule.key)
                        schedule.key = new Intl.DateTimeFormat('en-CA', { timeZone: def.schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now()) + ':' + def.schedule.start;
                    fire = runtime.scheduleKey !== schedule.key;
                }
                if (fire) {
                    runtime.scheduleKey = schedule.key;
                    record.scheduleKey = schedule.key;
                    queue(def, { trigger: { at: now(), snapshot: safeValue(snapshot()) } });
                }
            }
            pump();
        }
        catch (error) {
            if (!storageError)
                adapters.emit?.({ kind: 'workflow_error', message: error.message, sequence: state.sequence });
        }
    }
    function sensorRules() {
        const requirements = state.definitions.flatMap(record => {
            const def = record.versions.find(value => value.revision === record.approvedRevision);
            if (!record.enabled || !def) return [];
            const alreadyRan = !def.recurring && (record.usedRevisions?.includes(def.revision) || state.runs.some(run => run.definitionId === record.id && run.revision === def.revision));
            const conditions=[def.trigger?.condition,...flattenSteps(def.steps).map(step=>step.condition??step.input?.condition)].filter(Boolean);
            return alreadyRan ? [] : conditions.map(condition=>({enabled:true,draft:false,condition,trigger:def.trigger?.change}));
        });
        // A run keeps its own approved revision, even after future triggers are disabled.
        // Completed/paused one-offs must release all otherwise-unused sensors.
        for (const run of state.runs) if (['running','waiting','queued'].includes(run.status) || running.has(run.id) && !run.stopRequested) {
            for (const step of flattenSteps(run.definition.steps)) if (!['done','skipped'].includes(run.steps[step.id]?.status)) {
                const condition = step.condition ?? step.input?.condition;
                if (condition) requirements.push({enabled:true,draft:false,condition});
            }
        }
        return requirements;
    }
    function start() {
        if (!stopped || storageError)
            return;
        stopped = false;
        if (recoveredBackup) {
            recoveredBackup = false;
            state.storageWarning = 'Recovered the backup checkpoint. Future triggers are disabled until you review a new revision; interrupted effects require inspection.';
            for (const record of state.definitions)
                record.enabled = false;
            for (const run of state.runs) {
                for (const step of flattenSteps(run.definition.steps))
                    if (run.steps[step.id]?.status === 'running' && !readOnly(step))
                        run.steps[step.id].completionUnknown = true;
            }
            event('backup_recovered', null, { message: state.storageWarning });
        }
        for (const run of state.runs)
            if (['running', 'waiting', 'stopping'].includes(run.status) || run.appStopped) {
                delete run.appStopped;
                const unknown = Object.values(run.steps).some(step => step.completionUnknown);
                run.status = run.stopRequested ?? (unknown ? 'needs_attention' : 'queued');
                run.effectsUncertain = unknown;
                if (run.stopRequested) run.executionStoppedAt = now();
                run.reason = run.stopRequested ? 'Execution stopped when Orvix exited. Completed effects are retained; inspect any uncertain effects.' : unknown ? 'An interrupted effect needs inspection before recovery.' : 'Recovered a saved checkpoint.';
                event('run_recovered', run);
                if (unknown)
                    notice(run);
            }
        for (const record of state.notices)
            if (!['confirmed', 'cancelled', 'needs_retry', 'failed'].includes(record.status))
                deliverNotice(record);
        syncTimer();
        tick();
    }
    function setVoiceActive(active) {
        voiceActive = active === true;
        syncTimer();
    }
    function syncTimer() {
        const hasScheduledDefinition = state.definitions.some(record => {
            if (!record.enabled) return false;
            const def = record.versions.find(value => value.revision === record.approvedRevision);
            if (!def) return false;
            const alreadyRan = !def.recurring && (record.usedRevisions?.includes(def.revision) || state.runs.some(run => run.definitionId === record.id && run.revision === def.revision));
            return !alreadyRan && (!!def.trigger || def.schedule.mode !== 'always');
        });
        const hasActiveRun = state.runs.some(run => ['running', 'waiting', 'queued'].includes(run.status));
        const hasPendingNotice = state.notices.some(notice => !['confirmed', 'cancelled', 'needs_retry', 'failed'].includes(notice.status));
        const intervalMs = stopped || (!hasScheduledDefinition && !hasActiveRun && !hasPendingNotice) ? null : voiceActive ? 250 : 5000;
        if (timer && intervalMs === timerIntervalMs) return;
        if (timer) clearInterval(timer);
        timer = intervalMs ? setInterval(tick, intervalMs) : null;
        timer?.unref?.();
        timerIntervalMs = intervalMs;
    }
    function stop() {
        if (stopped)
            return;
        stopped = true;
        clearInterval(timer);
        timer = null;
        timerIntervalMs = null;
        for (const [id, controller] of running) {
            if (['running', 'waiting'].includes(runFor(id).status))
                runFor(id).appStopped = true;
            controller.abort();
            adapters.cancelRun?.(id);
        }
        if (!storageError)
            persist();
    }
    function ingest(next, observedAt = now()) {
        if (stopped || storageError)
            return;
        const capture = consumeEvents(next?.SignalEvents, liveCursor, Math.min(now(), observedAt));
        liveCursor = capture.cursor;
        if (capture.baseline)
            for (const runtime of triggerState.values())
                runtime.watches.clear();
        if (capture.gap)
            event('capture_gap', null, { message: capture.gap });
        for (const value of capture.events) {
            if (next.SignalSources?.[value.Signal] !== value.Device)
                continue;
            for (const record of state.definitions.filter(item => item.enabled)) {
                const def = record.versions.find(item => item.revision === record.approvedRevision), runtime = triggerState.get(record.id);
                if (!def?.trigger?.change || !runtime)
                    continue;
                const watches = def.trigger.change.watches.filter(watch => watch.signal === value.Signal);
                if (!watches.length)
                    continue;
                const fresh = { ...next, [nativeFields[value.Signal]]: value.Value, PcObservedAt: value.observedAt, ...(value.Signal === 'volume_percent' ? { VolumePrecise: value.Value } : {}) };
                observe({ ...def.trigger.change, watches }, runtime.watches, fresh, value.observedAt, { settle: false, receiptAt: value.ReceiptUtcMs, origin: 'native', context: value.Context, sequence: value.Sequence });
            }
        }
        tick();
    }
    function resetSignals() { triggerState.clear(); liveCursor = null; }
    function pauseAll(reason = 'Stopped by you.') {
        const definitions = state.definitions.filter(record => record.enabled).map(record => ({ id: record.id, revision: record.approvedRevision }));
        for (const record of state.definitions) record.enabled = false;
        const runs = state.runs.filter(run => (running.has(run.id)||['running','waiting','queued','stopping'].includes(run.status)) && run.stopRequested !== 'cancelled').map(run => run.id);
        for (const id of runs) { const run=runFor(id); delete run.restartRequested; manage({ action:'pause',runId:id,revision:run.revision,requestId:randomUUID() }); run.reason=running.has(id)?'Stopping; waiting for the current operation.':reason; }
        for(const record of state.notices)if(!['confirmed','cancelled'].includes(record.status)){record.status='cancelled';adapters.cancelNotice?.(record.id);}
        event('all_workflows_stopping',null,{message:reason});return {definitions,runs};
    }
    function resumeSaved(saved) {
        if (running.size) throw new Error('Wait for execution to acknowledge stopping before starting again.');
        const blocked=[];
        for (const value of saved.definitions ?? []) { const record=state.definitions.find(record=>record.id===value.id); if(record && record.approvedRevision===value.revision && latest(record).revision===value.revision && latest(record).approved) record.enabled=true; }
        for (const id of saved.runs ?? []) { const run=state.runs.find(run=>run.id===id); if(!run || run.status!=='paused')continue; if(Object.values(run.steps).some(step=>step.completionUnknown)){blocked.push(id);continue;} manage({action:'resume',runId:id,revision:run.revision,requestId:randomUUID()}); }
        event('reviewed_work_resumed',null,{blocked});tick();return {blocked};
    }
    return { list, history, inspect, draft, manage, recordVoiceInput, start, stop, pauseAll, resumeSaved, setVoiceActive, tick, ingest, sensorRules, resetSignals, notificationStatus, capabilities: () => adapters.capabilities?.() ?? {}, waitForIdle: () => running.size ? new Promise(resolve => idleWaiters.add(resolve)) : Promise.resolve(), workerProgress, storagePath: base };
}
function sleep(milliseconds, signal) {
    return new Promise(resolve => {
        if (signal.aborted)
            return resolve();
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, milliseconds);
        signal.addEventListener('abort', done, { once: true });
    });
}
function replaceCompleted(value, outputs) {
    if (!value || typeof value !== 'object')
        return value;
    if (value.fromStep && outputs[value.fromStep] !== undefined)
        return resolveOutputs(value, outputs);
    if (Array.isArray(value))
        return value.map(item => replaceCompleted(item, outputs));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceCompleted(item, outputs)]));
}
module.exports = { createTinyWorkflows };
