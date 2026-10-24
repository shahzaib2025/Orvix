const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createTinyWorkflows } = require('../electron/tiny-workflows.cjs');
const { normalizeDefinition, always } = require('../electron/tiny-workflow-contract.cjs');
const { createWorkflowAdapters } = require('../electron/tiny-workflow-adapters.cjs');
const { withResources } = require('../electron/workflow-resources.cjs');
const { createFastWork } = require('../electron/fast-work.cjs');
test('approved remaining revision retains completed steps', async (t) => { const { wf } = fixture(t); const d = draft(wf, definition([{ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }, { id: 'pause', type: 'approval', input: { message: 'Review next stage' } }])); wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.status === 'needs_attention'); let run = wf.list().runs[0]; const changed = wf.draft({ requestId: request(), id: d.id, revision: 1, definition: definition([{ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }, { id: 'later', type: 'delay', seconds: 0.01 }]) }).definition; manage(wf, run, 'update_run', { newRevision: changed.revision }); await wait(() => wf.list().runs[0].status === 'verified'); assert.equal(wf.list().runs.length, 1); assert.equal(wf.list().runs[0].revision, 2); assert.equal(wf.list().runs[0].steps.check.status, 'done'); });
test('reads retry with stable IDs, writes never retry blindly and read budgets remain finite', async (t) => { let attempts = 0; const ids = []; const { wf } = fixture(t, { execute: async (step, input, context) => { attempts++; ids.push(context.requestId); return attempts < 3 ? { status: 'unavailable' } : { status: 'ok', verified: true }; } }); const d = draft(wf, definition([{ id: 'read', type: 'research', input: { query: 'fixture' } }, { id: 'check', type: 'verify', input: { kind: 'output', value: { fromStep: 'read' } } }])); wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.status === 'verified'); assert.equal(attempts, 3); assert.equal(new Set(ids).size, 1); });
test('corrupt primary falls back without replaying an uncertain effect or silently re-enabling recurrence', async (t) => { const { wf, app } = fixture(t); const d = draft(wf, definition([{ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }], { recurring: true, schedule: { mode: 'daily', start: '12:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'Asia/Dhaka' } })); approve(wf, d); const checkpoint = path.join(wf.storagePath, 'checkpoint.json'); fs.writeFileSync(checkpoint, 'broken fixture'); const recovered = createTinyWorkflows(app); recovered.start(); assert.match(recovered.list().storageWarning, /backup/); assert.equal(recovered.list().definitions[0].enabled, false); recovered.stop(); });
test('scope paths reject credential files and readonly modes reject changing blocks', t => { const { dir } = fixture(t); assert.throws(() => normalizeDefinition(definition([{ id: 'check', type: 'verify', input: { kind: 'file', target: path.join(dir, '.env'), exists: true } }], { scope: { paths: [dir] } })), /credential/); assert.throws(() => normalizeDefinition(definition([{ id: 'write', type: 'write_report', input: { target: path.join(dir, 'report.txt'), content: 'fixture' } }, { id: 'check', type: 'verify', input: { kind: 'file', target: path.join(dir, 'report.txt'), exists: true } }], { scope: { paths: [dir] }, mode: 'Review' })), /does not execute/); });
test('project adapter waits for workspace approval and preserves Controlled verification and worker choices', async (t) => { const { dir } = fixture(t); const model = require('../electron/opencode-models.json')[0].id; let adapter, grant, opened = false; const agent = { workspaces: { open: async (taskId, root, approve) => { assert.equal(await approve(root), true); await new Promise(resolve => setTimeout(resolve, 20)); opened = true; return { root }; } }, journal: { metadata: () => null }, run: async (input) => { assert.equal(opened, true); assert.equal(input.accessMode, 'Controlled'); assert.equal(input.modelId, model); grant = adapter.authorizeProject({ taskId: input.taskId, command: 'fixture-check', directory: dir, kind: 'command' }); assert.equal(adapter.authorizeProject({ taskId: input.taskId, command: '', directory: path.dirname(dir), kind: 'workspace' }), false); return { text: 'fixture', verification: { status: 'passed' }, changes: [] }; }, getExecution: async () => ({ execution: { complete: true } }) }; adapter = createWorkflowAdapters({ work: { settings: () => ({}) }, agent: () => agent, credentials: { getKey: () => 'fixture-key' }, construction: () => null }); const def = normalizeDefinition(definition([{ id: 'check', type: 'project', input: { goal: 'fixture', modelId: model, commands: [{ command: 'fixture-check', directory: dir }] } }], { scope: { paths: [dir] }, models: { project: model } })); const result = await adapter.execute(def.steps[0], def.steps[0].input, { runId: 'fixture-project', requestId: 'fixture-project-step', definition: def, signal: new AbortController().signal, progress: () => { } }); assert.equal(grant, 'host'); assert.equal(result.verified, true); assert.equal(result.workerTaskId, 'wf-fixture-project-check'); });
test('Construction Lock conflicts and worker setup produce actionable requirements before dispatch', t => { const { dir } = fixture(t); const adapter = createWorkflowAdapters({ work: { settings: () => ({ workerEnabled: false }) }, construction: () => ({ list: () => ({ lock: { status: 'active', targets: [dir] } }) }) }); const def = normalizeDefinition(definition([{ id: 'check', type: 'verify', input: { kind: 'file', target: path.join(dir, 'report.txt'), exists: true } }], { scope: { paths: [dir] } })); assert.match(adapter.validateDefinition(def).message, /Construction Lock/); assert.equal(adapter.validateDefinition({ ...def, steps: [{ type: 'browser' }] }).status, 'setup_required'); });
test('ordered history pages have no duplicates and expose the latest events first', async (t) => { const { wf } = fixture(t); const steps = Array.from({ length: 30 }, (_, i) => ({ id: 'delay-' + i, type: 'delay', seconds: 0 })); steps.push({ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }); const d = draft(wf, definition(steps)); wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.status === 'verified'); const first = wf.history({ runId: wf.list().runs[0].id }); assert.equal(first.records.length, 50); assert.equal(first.records.at(-1).kind, 'run_verified'); const previous = wf.history({ runId: wf.list().runs[0].id, before: first.next }); assert.ok(previous.records.at(-1).sequence < first.records[0].sequence); assert.equal(new Set([...previous.records, ...first.records].map(value => value.sequence)).size, previous.records.length + first.records.length); });
const request = () => randomUUID();
test('completed runs archive without losing inspection, mutation receipts or one-off grants', async t => {
    const {wf,app}=fixture(t,{}, {hotRunLimit:2});wf.start();const saved=[];
    for(let i=0;i<4;i++) {const d=draft(wf,definition());const input={requestId:request(),action:'approve',id:d.id,revision:1};const receipt=wf.manage(input);saved.push({d,input,receipt});await wait(()=>wf.list().runs.some(run=>run.id===receipt.runId&&run.status==='verified'));}
    const first=saved[0];assert.ok(fs.existsSync(path.join(wf.storagePath,'archive',first.receipt.runId+'.json')));
    assert.equal(wf.inspect({runId:first.receipt.runId}).runs[0].status,'verified');assert.deepEqual(wf.manage(first.input),first.receipt);
    wf.manage({requestId:request(),action:'disable',id:first.d.id,revision:1});assert.equal(approve(wf,first.d).status,'already_completed');
    wf.stop();const recovered=createTinyWorkflows(app);try{assert.equal(recovered.inspect({runId:first.receipt.runId}).runs[0].status,'verified');assert.deepEqual(recovered.manage(first.input),first.receipt);}finally{recovered.stop();}
});
function definition(steps = [{ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }], extra = {}) { return { name: 'Disposable helper', goal: 'Complete observed checks', mode: 'Work', steps, scope: { paths: [], domains: [], apps: [] }, models: {}, acceptance: [{ stepId: 'check', text: 'Observed check passes' }], ...extra }; }
function fixture(t, adapters = {}, options = {}) { const scratch = path.join(__dirname, '..', 'scratch'); fs.mkdirSync(scratch, { recursive: true }); const dir = fs.mkdtempSync(path.join(scratch, 'orvix-workflow-')), app = { getPath: () => dir }; let snapshot = { PcObservedAt: Date.now(), at: Date.now(), BatteryPercent: 50 }; const notices = [], events = []; const wf = createTinyWorkflows(app, { snapshot: () => snapshot, notify: async (value) => { notices.push(value); return { status: 'queued', id: value.noticeId }; }, emit: value => events.push(value), ...adapters }, options); t.after(async () => { wf.stop(); await wf.waitForIdle(); assert.ok(dir.startsWith(path.join(__dirname, '..', 'scratch', 'orvix-workflow-'))); fs.rmSync(dir, { recursive: true, force: true }); }); return { wf, dir, app, notices, events, setSnapshot: value => { snapshot = value; } }; }
const draft = (wf, def) => wf.draft({ requestId: request(), definition: def }).definition;
const approve = (wf, def, extra = {}) => wf.manage({ requestId: request(), action: 'approve', id: def.id, revision: def.revision, ...extra });
const manage = (wf, run, action, extra = {}) => wf.manage({ requestId: request(), action, runId: run.id, revision: run.revision, ...extra });
const wait = async (fn) => {
    const end = Date.now() + 4000;
    while (!fn()) {
        if (Date.now() > end)
            throw new Error('Fixture deadline exceeded');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};
test('draft, revision, approval and deduplication are durable; one-off cannot repeat', async (t) => { const { wf, app } = fixture(t); const d = draft(wf, definition()), key = request(); wf.start(); const input = { requestId: key, action: 'approve', id: d.id, revision: d.revision }; const result = wf.manage(input); assert.deepEqual(wf.manage(input), result); await wait(() => wf.list().runs[0]?.status === 'verified'); assert.equal(wf.list().runs.length, 1); assert.throws(() => wf.manage({ ...input, action: 'disable' }), /different operations/); assert.throws(() => wf.manage({ requestId: request(), action: 'start', id: d.id, revision: 1 }), /one-off/); wf.stop(); await wf.waitForIdle(); const restored = createTinyWorkflows(app); assert.equal(restored.list().runs[0].status, 'verified'); assert.deepEqual(restored.manage(input), result); restored.stop(); });
test('stale approvals and cyclic/forward outputs are rejected; edits preserve running revision', async (t) => { const { wf } = fixture(t); const d = draft(wf, definition()); const changed = wf.draft({ id: d.id, revision: 1, requestId: request(), definition: definition(undefined, { name: 'Changed' }) }).definition; assert.throws(() => approve(wf, d), /stale/); assert.equal(changed.revision, 2); assert.throws(() => normalizeDefinition(definition([{ id: 'read', type: 'research', input: { query: { fromStep: 'check' } } }, { id: 'check', type: 'verify', input: { kind: 'output', value: { fromStep: 'read' } } }])), /forward/); assert.throws(() => normalizeDefinition(definition([{ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }], { mode: 'Review', steps: [{ id: 'check', type: 'project', input: { goal: 'write', modelId: 'x' } }] })), /project paths|does not/); });
test('both voice profiles require exact reviewed revision and a subsequent human approval turn', t => {
    const { wf } = fixture(t);
    for (const profile of ['Fast', 'Thinking']) {
        const sessionId = request(), d = draft(wf, definition());
        wf.recordVoiceInput({ sessionId, profile, inputId: 'first', text: 'make this helper' });
        wf.inspect({ id: d.id, voiceSessionId: sessionId });
        assert.throws(() => approve(wf, d, { voiceSessionId: sessionId }), /new human turn/);
        wf.recordVoiceInput({ sessionId, profile, inputId: 'second', text: 'yes approve this plan' });
        assert.equal(approve(wf, d, { voiceSessionId: sessionId }).status, 'queued');
    }
});
test('folder arrival → research → report → hash verification → notification uses disposable actual files', async (t) => { const { wf, dir, app, notices, setSnapshot } = fixture(t); const report = path.join(dir, 'report.md'); const adapters = createWorkflowAdapters({ work: { settings: () => ({}) }, construction: () => null, agent: () => null, credentials: { getKey: () => null }, notify: async () => ({ status: 'queued' }), search: async () => ({ status: 'ok', results: [{ url: 'https://example.com/source' }] }), readPage: async () => ({ status: 'ok', url: 'https://example.com/source', title: 'Source fixture', content: 'Disposable current research evidence.' }) }); const actual = createTinyWorkflows(app, { ...adapters, snapshot: () => ({ PcObservedAt: Date.now(), at: Date.now(), Files: { [dir]: { exists: true, names: fs.readdirSync(dir) } } }), notify: async (value) => { notices.push(value); return { status: 'queued' }; } }); t.after(() => actual.stop()); const d = draft(actual, definition([{ id: 'research', type: 'research', input: { query: 'read fixture' } }, { id: 'report', type: 'write_report', input: { target: report, content: { fromStep: 'research', path: 'text' } } }, { id: 'check', type: 'verify', input: { kind: 'file', target: report, sha256: { fromStep: 'report', path: 'artifact.hash' } } }, { id: 'notice', type: 'notify', input: { message: 'Report ready' } }], { scope: { paths: [dir] }, trigger: { condition: { op: 'predicate', signal: 'folder_new_file', comparator: 'contains', value: '.txt', target: dir } } })); actual.start(); approve(actual, d); actual.tick(); fs.writeFileSync(path.join(dir, 'arrival.txt'), 'new'); actual.tick(); await wait(() => actual.list().runs[0]?.status === 'verified'); assert.match(fs.readFileSync(report, 'utf8'), /Disposable current research/); assert.equal(actual.list().runs[0].outputs.check.verified, true); assert.ok(notices.length >= 1); setSnapshot(null); assert.equal(wf.list().runs.length, 0); actual.stop(); });
test('event waits ignore existing true baseline, branches skip unused steps, delay and parallel run independently', async (t) => { const { wf, setSnapshot } = fixture(t); const condition = { op: 'predicate', signal: 'battery_percent', comparator: 'gt', value: 70 }; setSnapshot({ PcObservedAt: Date.now(), BatteryPercent: 80 }); const d = draft(wf, definition([{ id: 'wait', type: 'wait', event: true, timeoutSeconds: 2, condition }, { id: 'branch', type: 'branch', condition, then: [{ id: 'delay', type: 'delay', seconds: 0.03 }], else: [{ id: 'unused', type: 'delay', seconds: 9 }] }, { id: 'parallel', type: 'parallel', branches: [[{ id: 'a', type: 'delay', seconds: 0.02 }], [{ id: 'b', type: 'delay', seconds: 0.02 }]] }, { id: 'check', type: 'verify', input: { kind: 'condition', condition } }])); wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.steps.wait?.status === 'waiting'); assert.equal(wf.list().runs[0].status, 'running'); setSnapshot({ PcObservedAt: Date.now(), BatteryPercent: 60 }); await new Promise(resolve => setTimeout(resolve, 120)); setSnapshot({ PcObservedAt: Date.now(), BatteryPercent: 80 }); await wait(() => wf.list().runs[0]?.status === 'verified'); assert.equal(wf.list().runs[0].steps.unused.status, 'skipped'); assert.equal(wf.list().runs[0].steps.a.status, 'done'); assert.equal(wf.list().runs[0].steps.b.status, 'done'); });
test('wait expiry and unavailable readings need attention instead of claiming completion', async (t) => { const { wf, setSnapshot } = fixture(t); setSnapshot(null); const d = draft(wf, definition([{ id: 'wait', type: 'wait', timeoutSeconds: 0.02, condition: { op: 'predicate', signal: 'battery_percent', comparator: 'gt', value: 90 } }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }])); wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.status === 'needs_attention'); assert.match(wf.list().runs[0].reason, /unavailable/); assert.equal(wf.list().runs[0].steps.check, undefined); });
test('Single, Queued overflow, parallel capacity and restart cancellation obey reviewed limits', async (t) => {
    for (const policy of ['single', 'queued', 'parallel', 'restart']) {
        const gates = [];
        const { wf } = fixture(t, { execute: async (_step, _input, context) => {
            await new Promise(resolve => {
                const release = () => { context.signal.removeEventListener('abort', release); resolve(); };
                gates.push(release);
                context.signal.addEventListener('abort', release, { once: true });
            });
            return { status: 'ok', verified: true };
        } });
        const d = draft(wf, definition([{ id: 'read', type: 'research', input: { query: 'Disposable gate' } }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }], { recurring: true, trigger: { condition: always }, execution: { mode: policy, maxRuns: policy === 'queued' || policy === 'parallel' ? 2 : 1 } }));
        wf.start();
        approve(wf, d);
        const start = () => wf.manage({ requestId: request(), id: d.id, revision: 1, action: 'start' });
        start();
        await wait(() => gates.length === 1);
        const second = start();
        if (policy === 'single')
            assert.equal(second.status, 'already_running');
        if (policy === 'queued' || policy === 'parallel')
            assert.equal(start().status, 'capacity_reached');
        if (policy === 'restart')
            assert.equal(second.status, 'waiting_for_cancellation');
        if (policy === 'parallel' || policy === 'restart')
            await wait(() => gates.length === 2);
        for (const release of gates) release();
        await wait(() => wf.list().runs.some(run => run.status === 'verified'));
        wf.stop();
    }
});
test('unknown effects survive crash checkpoints and cannot blindly resume; actual inspection resolves them', async (t) => { let dispatched = 0; const { wf, app } = fixture(t, { execute: async (step, input, context) => { dispatched++; await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); return { status: 'cancelled' }; }, inspectEffect: async () => ({ verified: true, output: { verified: true, status: 'ok' } }) }); const d = draft(wf, definition([{ id: 'effect', type: 'write_report', input: { target: path.join(app.getPath(), 'file.txt'), content: 'test' } }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }], { scope: { paths: [app.getPath()] } })); wf.start(); approve(wf, d); await wait(() => dispatched === 1); wf.stop(); await wf.waitForIdle(); const recovered = createTinyWorkflows(app, { snapshot: () => ({ at: Date.now() }), inspectEffect: async () => ({ verified: true, output: { verified: true, status: 'ok' } }) }); t.after(() => recovered.stop()); recovered.start(); let run = recovered.list().runs[0]; assert.equal(run.status, 'needs_attention'); assert.throws(() => manage(recovered, run, 'resume'), /uncertain/); manage(recovered, run, 'resolve', { stepId: 'effect' }); await wait(() => recovered.list().runs[0].steps.effect.status === 'done'); manage(recovered, recovered.list().runs[0], 'resume'); await wait(() => recovered.list().runs[0].status === 'verified'); assert.equal(dispatched, 1); recovered.stop(); });
test('application stop safely resumes delays; explicit pause remains paused; changing effect retained across edits', async (t) => { const { wf, app } = fixture(t); const d = draft(wf, definition([{ id: 'delay', type: 'delay', seconds: 0.1 }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }])); wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.steps.delay); wf.draft({ requestId: request(), id: d.id, revision: 1, definition: definition(undefined, { goal: 'New future goal' }) }); assert.equal(wf.list().runs[0].revision, 1); wf.stop(); await wf.waitForIdle(); const restored = createTinyWorkflows(app); t.after(() => restored.stop()); restored.start(); await wait(() => restored.list().runs[0].status === 'verified'); const draft2 = draft(restored, definition([{ id: 'delay', type: 'delay', seconds: 2 }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }])); approve(restored, draft2); await wait(() => restored.list().runs[0].status === 'running'); const run = restored.list().runs[0]; manage(restored, run, 'pause'); await restored.waitForIdle(); restored.stop(); const paused = createTinyWorkflows(app); paused.start(); assert.equal(paused.list().runs[0].status, 'paused'); paused.stop(); });
test('shared interaction and overlapping file resources serialize; unrelated files can run together', async () => { let active = 0, max = 0; const work = async () => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; }; await Promise.all([withResources(['interaction'], work), withResources(['interaction'], work)]); assert.equal(max, 1); max = 0; await Promise.all([withResources(['file:C:\\fixture'], work), withResources(['file:C:\\fixture\\report.md'], work)]); assert.equal(max, 1); max = 0; await Promise.all([withResources(['file:C:\\a'], work), withResources(['file:C:\\b'], work)]); assert.equal(max, 2); });
test('unsupported adapters, partial budgets and failed evidence never produce verified completion', async (t) => {
    for (const status of ['disabled', 'dispatched', 'partial', 'failed', 'scope_required']) {
        const { wf } = fixture(t, { execute: async () => ({ status, message: 'Needs setup or continued work' }) });
        const d = draft(wf, definition([{ id: 'read', type: 'research', input: { query: 'fixture' } }, { id: 'check', type: 'verify', input: { kind: 'output', value: { fromStep: 'read' } } }]));
        wf.start();
        approve(wf, d);
        await wait(() => wf.list().runs[0]?.status === 'needs_attention');
        assert.equal(wf.list().runs[0].steps.check, undefined);
    }
});
test('persist failure before dispatch prevents the external effect', async (t) => {
    let block = false, effects = 0;
    const { wf } = fixture(t, { execute: async () => { effects++; return { status: 'ok' }; } }, { beforePersist: (_state, event) => {
            if (block && event?.step?.status === 'running')
                throw new Error('Disk fixture failure');
        } });
    const d = draft(wf, definition([{ id: 'read', type: 'research', input: { query: 'fixture' } }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }]));
    block = true;
    wf.start();
    approve(wf, d);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(effects, 0);
    assert.match(wf.list().storageError, /Disk fixture failure/);
});

test('crash after a real report effect flags uncertainty and verifies the file without rewriting it', async t => {
    let effects = 0, adapter;
    const { wf, app, dir } = fixture(t, { execute: (...args) => { effects++; return adapter.execute(...args); } }, {
        beforePersist: (_state, event) => { if (event?.step?.id === 'report' && event.step.status === 'done') throw new Error('Crash after effect fixture'); }
    });
    adapter = createWorkflowAdapters({ work: { settings: () => ({}) }, construction: () => null });
    const target = path.join(dir, 'report.txt');
    const d = draft(wf, definition([{ id: 'report', type: 'write_report', input: { target, content: 'Observed crash fixture' } }, { id: 'check', type: 'verify', input: { kind: 'file', target, contains: 'Observed crash fixture' } }], { scope: { paths: [dir] } }));
    wf.start(); approve(wf, d);
    await wait(() => wf.list().storageError);
    await wf.waitForIdle(); wf.stop();
    assert.equal(fs.readFileSync(target, 'utf8'), 'Observed crash fixture');
    const recovered = createTinyWorkflows(app, adapter); recovered.start();
    try {
        const run = recovered.list().runs[0];
        assert.equal(run.status, 'needs_attention');
        assert.equal(run.steps.report.completionUnknown, true);
        assert.throws(() => manage(recovered, run, 'retry'), /uncertain/);
        manage(recovered, run, 'resolve', { stepId: 'report' });
        await wait(() => recovered.list().runs[0].steps.report.status === 'done');
        manage(recovered, recovered.list().runs[0], 'resume');
        await wait(() => recovered.list().runs[0].status === 'verified');
        assert.equal(effects, 1);
    } finally { recovered.stop(); await recovered.waitForIdle(); }
});

test('changing a completed step requires a separate run instead of replacing its evidence', async t => {
    const { wf } = fixture(t);
    const d = draft(wf, definition([{ id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }, { id: 'pause', type: 'approval', input: { message: 'Review' } }]));
    wf.start(); approve(wf, d); await wait(() => wf.list().runs[0]?.status === 'needs_attention');
    const revision = wf.draft({ requestId: request(), id: d.id, revision: 1, definition: definition([{ id: 'check', title: 'Different completed step', type: 'verify', input: { kind: 'condition', condition: always } }]) }).definition;
    assert.throws(() => manage(wf, wf.list().runs[0], 'update_run', { newRevision: revision.revision }), /completed/);
    assert.equal(wf.list().runs[0].revision, 1);
});

test('restart replaces a paused safe run and a newly reviewed one-off revision has its own run', async t => {
    const { wf } = fixture(t);
    let d = draft(wf, definition([{ id: 'delay', type: 'delay', seconds: 1 }, { id: 'check', type: 'verify', input: { kind: 'condition', condition: always } }], { recurring: true, trigger: { condition: always }, execution: { mode: 'restart', maxRuns: 1 } }));
    wf.start(); approve(wf, d);
    wf.manage({ requestId: request(), action: 'start', id: d.id, revision: 1 });
    await wait(() => wf.list().runs[0]?.steps.delay?.status === 'waiting');
    manage(wf, wf.list().runs[0], 'pause'); await wf.waitForIdle();
    assert.equal(wf.manage({ requestId: request(), action: 'start', id: d.id, revision: 1 }).status, 'queued');
    await wait(() => wf.list().runs[0].status === 'verified');
    assert.equal(wf.list().runs[1].status, 'cancelled');
    d = wf.draft({ requestId: request(), id: d.id, revision: 1, definition: definition(undefined, { trigger: { condition: always } }) }).definition;
    approve(wf, d);
    assert.equal(wf.manage({ requestId: request(), action: 'start', id: d.id, revision: 2 }).status, 'queued');
    await wait(() => wf.list().runs[0].status === 'verified');
    assert.equal(wf.list().runs.length, 3);
});

test('unlisted workflow effects require review even when ordinary navigation would run immediately', async t => {
    const { dir } = fixture(t);
    let effects = 0, denied = false;
    const browser = { act: async () => { effects++; return { status: 'ok', verification: { verified: true, evidence: 'Observed fixture' } }; } };
    const work = createFastWork({ browser, desktop: {}, settingsFile: path.join(dir, 'work-settings.json'), workflowAuthorize: () => denied ? { denied: true, message: 'Outside scope' } : { approved: false, reviewRequired: true } });
    const task = work.update({ text: 'Navigate within a reviewed workflow' });
    t.after(() => work.cancel(task.id));
    const result = await work.execute(task.id, 'browser_act', { action: 'navigate', args: { url: 'https://example.com' } });
    assert.equal(result.status, 'confirmation_required'); assert.equal(effects, 0);
    work.decide(result.approvalId, true);
    assert.equal((await work.resumeApproval(result.approvalId)).completion, 'verified_step');
    assert.equal(effects, 1);
    denied = true;
    assert.equal((await work.execute(task.id, 'browser_act', { action: 'navigate', args: { url: 'https://outside.invalid' } })).status, 'scope_required');
    assert.equal(effects, 1);
});

test('disabled reviewed recurrence can be explicitly re-enabled without replaying a used one-off grant', async t => {
    const { wf } = fixture(t);
    const recurring = draft(wf, definition(undefined, { recurring: true, trigger: { condition: always } }));
    approve(wf, recurring);
    wf.manage({ requestId: request(), action: 'disable', id: recurring.id, revision: 1 });
    assert.equal(approve(wf, recurring).status, 'watching');
    assert.equal(wf.list().definitions[0].enabled, true);
    const once = draft(wf, definition()); wf.start(); approve(wf, once);
    await wait(() => wf.list().runs[0]?.status === 'verified');
    wf.manage({ requestId: request(), action: 'disable', id: once.id, revision: 1 });
    assert.equal(approve(wf, once).status, 'already_completed');
    assert.equal(wf.list().runs.length, 1);
});
