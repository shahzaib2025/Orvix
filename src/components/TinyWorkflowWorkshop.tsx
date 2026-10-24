import { memo, useEffect, useRef, useState } from 'react';
import { Plus, Play, Pause, Check, Copy, X, ArrowUp, ArrowDown, ArrowUpRight, FileSearch, Code2, ScanLine, Workflow, Trash2 } from 'lucide-react';
import type { TinyCondition, TinyWorkflowDefinition as Definition, TinyWorkflowStep as Step, TinyWorkflowListing, TinyWorkflowEvent, TinyWorkflowRun, TinyWorkflowOutput } from '../desktop';
import type { KeyboardEvent } from 'react';
import projectModels from '../../electron/opencode-models.json';
import { subscribeTinyWorkflows } from '../tinyWorkflowSubscription';
import { newRow, signalNames, numeric, boolean, comparisons, defaultSchedule, describeCondition } from '../tinyAgentCatalog';
import TinyChangeControls, { defaultChangeTrigger } from './TinyChangeControls';
import AgentExecutionPanel from './AgentExecutionPanel';
import AgentVerificationResult from './AgentVerificationResult';
import AgentDiff from './AgentDiff';
import './tiny-workflows.css';
import TinyLazyDetails from './TinyLazyDetails';
const always: TinyCondition = { op: 'predicate', signal: 'always', comparator: 'eq', value: true };
const labels: Record<Step['type'], string> = { action: 'PC action', delay: 'Delay', wait: 'Wait for condition / event', branch: 'If / else', parallel: 'Parallel group', research: 'Research', browser: 'Browser worker', desktop: 'Desktop worker', project: 'Project worker', write_report: 'Save report', verify: 'Verify result', notify: 'Notify me', approval: 'Approval checkpoint' };
const flat = (steps: Step[]): Step[] => steps.flatMap(step => [step, ...flat(step.then ?? []), ...flat(step.else ?? []), ...(step.branches ?? []).flatMap(flat)]);
const id = () => crypto.randomUUID();
function JsonField({ label, value, onChange }: {
    label: string;
    value: unknown;
    onChange: (value: unknown) => void;
}) {
    const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2)), [error, setError] = useState('');
    return <label>{label}<textarea value={text} rows={3} aria-invalid={!!error} onChange={event => {
            setText(event.target.value);
            try {
                onChange(event.target.value ? JSON.parse(event.target.value) : undefined);
                setError('');
            }
            catch {
                setError('Finish the JSON value before saving.');
            }
        }}/>{error && <span role="alert">{error}</span>}</label>;
}
function PlanSteps({ steps }: {
    steps: Step[];
}) {
    const value = (input: unknown) => input && typeof input === 'object' && 'fromStep' in input ? 'Output of ' + String(input.fromStep) + (('path' in input && input.path) ? ' · ' + String(input.path) : '') : String(input ?? '');
    return <ol>{steps.map(step => <li key={step.id}><strong>{step.title}</strong> · {labels[step.type]}{step.type === 'delay' && <p>Wait exactly {step.seconds} seconds.</p>}{step.type === 'wait' && <p>{step.event ? 'Wait for a new event: ' : 'Wait until: '}{describeCondition(step.condition ?? always)} · timeout {step.timeoutSeconds}s</p>}{step.action && <p>{step.action.type.replaceAll('_', ' ')} · {step.action.target || step.action.message}</p>}{step.input && <p>{Object.entries(step.input).filter(([key]) => !['commands', 'actions', 'condition'].includes(key)).map(([key, item]) => <span className="wf-plan-value" key={key}>{key.replaceAll('_', ' ')}: {value(item)}</span>)}</p>}{step.type === 'project' && <p>Reviewed commands: {(step.input?.commands as {
                    command: string;
                    directory: string;
                }[] ?? []).map(command => command.command + ' in ' + command.directory).join('; ') || 'Extra commands require approval'}</p>}{step.type === 'branch' && <><p>If {describeCondition(step.condition ?? always)}</p><PlanSteps steps={step.then ?? []}/><p>Otherwise</p><PlanSteps steps={step.else ?? []}/></>}{step.branches?.map((branch, index) => <div key={index}><p>Independent branch {index + 1}</p><PlanSteps steps={branch}/></div>)}<TinyLazyDetails summary="Exact saved configuration">{()=> <pre>{JSON.stringify({ ...step, then: undefined, else: undefined, branches: undefined }, null, 2)}</pre>}</TinyLazyDetails></li>)}</ol>;
}
function dialogKeys(event: KeyboardEvent<HTMLElement>, close: () => void) {
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
    }
    if (event.key !== 'Tab')
        return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(item => item.offsetParent !== null);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
    }
    else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
    }
}
function block(type: Step['type']): Step {
    const step: Step = { id: id(), type, title: labels[type] };
    if (type === 'delay')
        step.seconds = 1;
    else if (type === 'wait') {
        step.condition = always;
        step.timeoutSeconds = 600;
        step.event = false;
    }
    else if (type === 'branch') {
        step.condition = newRow();
        step.then = [block('notify')];
        step.else = [block('notify')];
    }
    else if (type === 'parallel')
        step.branches = [[block('research')], [block('research')]];
    else if (type === 'action')
        step.action = { type: 'open_path', message: '', target: '' };
    else
        step.input = type === 'verify' ? { kind: 'file', target: '', exists: true } : type === 'research' ? { query: '' } : type === 'write_report' ? { target: '', content: '' } : type === 'project' ? { goal: '', modelId: '', commands: [] } : type === 'browser' || type === 'desktop' ? { goal: '', actions: [] } : { message: '' };
    return step;
}
function fresh(): Definition { return { name: '', goal: '', mode: 'Work', district: 'workshop', steps: [block('research'), block('write_report'), block('verify')], scope: { paths: [], domains: [], apps: [] }, models: { work: '', project: '' }, execution: { mode: 'single', maxRuns: 1 }, trigger: null, schedule: { ...defaultSchedule(), timezone: 'Asia/Dhaka' }, recurring: false, acceptance: [] }; }
function ConditionEditor({ value, onChange }: {
    value: TinyCondition;
    onChange: (value: TinyCondition) => void;
}) {
    if (value.op !== 'predicate')
        return <fieldset className="wf-condition"><legend><select aria-label="Condition group" value={value.op} onChange={e => onChange({ ...value, op: e.target.value as 'all' | 'any' })}><option value="all">All conditions</option><option value="any">Any condition</option></select></legend>{value.children.map((child, index) => <div key={index}><ConditionEditor value={child} onChange={next => onChange({ ...value, children: value.children.map((item, i) => i === index ? next : item) })}/><button type="button" disabled={value.children.length === 1} onClick={() => onChange({ ...value, children: value.children.filter((_, i) => i !== index) })}>Remove condition</button></div>)}<button type="button" onClick={() => onChange({ ...value, children: [...value.children, newRow()] })}>Add condition</button><button type="button" onClick={() => onChange({ ...value, children: [...value.children, { op: 'any', children: [newRow()] }] })}>Add group</button></fieldset>;
    return <div className="wf-fields"><label>Signal<select aria-label="Signal" value={value.signal} onChange={e => onChange(newRow(e.target.value))}>{Object.entries(signalNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Comparison<select aria-label="Comparison" value={value.comparator} onChange={e => onChange({ ...value, comparator: e.target.value })}>{Object.entries(comparisons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Value{boolean.has(value.signal) ? <select value={String(value.value)} onChange={e => onChange({ ...value, value: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select> : <input type={numeric.has(value.signal) ? 'number' : 'text'} value={String(value.value)} onChange={e => onChange({ ...value, value: numeric.has(value.signal) ? Number(e.target.value) : e.target.value })}/>}</label>{!['always', 'battery_percent', 'brightness_percent', 'volume_percent', 'on_ac', 'charging', 'idle_seconds', 'cpu_percent', 'memory_percent', 'network_online', 'fullscreen', 'muted', 'active_seconds'].includes(value.signal) && <label>Target<input value={value.target ?? ''} onChange={e => onChange({ ...value, target: e.target.value })}/></label>}{['window_state', 'browser_tab', 'browser_video', 'media_session'].includes(value.signal) && <><label>Scope<select value={value.scope ?? 'any'} onChange={e => onChange({ ...value, scope: e.target.value as 'any' | 'all' })}><option value="any">Any</option><option value="all">All</option></select></label><label>Field<input value={value.field ?? ''} onChange={e => onChange({ ...value, field: e.target.value })}/></label></>}<button type="button" onClick={() => onChange({ op: 'all', children: [value, newRow()] })}>Group conditions</button></div>;
}
function InputField({ label, value, previous, onChange }: {
    label: string;
    value: unknown;
    previous: Step[];
    onChange: (value: unknown) => void;
}) {
    const reference = value && typeof value === 'object' && 'fromStep' in value ? value as {
        fromStep: string;
        path?: string;
    } : null;
    return <label>{label}<select aria-label={`${label} source`} value={reference ? 'output' : 'text'} onChange={e => onChange(e.target.value === 'output' ? { fromStep: previous[0]?.id ?? '', path: 'text' } : '')}><option value="text">Enter value</option><option value="output" disabled={!previous.length}>Earlier step output</option></select>{reference ? <div className="wf-fields"><select aria-label={`${label} step`} value={reference.fromStep} onChange={e => onChange({ ...reference, fromStep: e.target.value })}>{previous.map(step => <option key={step.id} value={step.id}>{step.title}</option>)}</select><input aria-label={`${label} output property`} value={reference.path ?? ''} placeholder="text, artifact.hash, or blank for full output" onChange={e => onChange({ ...reference, path: e.target.value })}/></div> : <textarea aria-label={label} value={typeof value === 'string' ? value : JSON.stringify(value ?? '')} rows={2} onChange={e => onChange(e.target.value)}/>}</label>;
}
function Blocks({ steps, onChange, previous = [] }: {
    steps: Step[];
    onChange: (steps: Step[]) => void;
    previous?: Step[];
}) {
    const update = (index: number, next: Step) => onChange(steps.map((item, i) => i === index ? next : item));
    return <div className="wf-blocks">{steps.map((step, index) => {
            const available = [...previous, ...steps.slice(0, index)], input = step.input ?? {}, patch = (key: string, value: unknown) => update(index, { ...step, input: { ...input, [key]: value } });
            return <fieldset className="wf-block" key={step.id}><legend>{index + 1} · {labels[step.type]}</legend><div className="wf-block-heading"><input aria-label="Step title" value={step.title} onChange={e => update(index, { ...step, title: e.target.value })}/><button type="button" aria-label="Move step up" disabled={!index} onClick={() => { const copy = [...steps]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; onChange(copy); }}><ArrowUp size={15}/></button><button type="button" aria-label="Move step down" disabled={index === steps.length - 1} onClick={() => { const copy = [...steps]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; onChange(copy); }}><ArrowDown size={15}/></button><button type="button" aria-label="Remove step" onClick={() => onChange(steps.filter((_, i) => i !== index))}><Trash2 size={15}/></button></div>
            {step.type === 'delay' && <label>Exact seconds<input type="number" min="0" max="86400" step="any" value={step.seconds} onChange={e => update(index, { ...step, seconds: Number(e.target.value) })}/></label>}
            {['wait', 'branch'].includes(step.type) && <ConditionEditor value={step.condition ?? always} onChange={condition => update(index, { ...step, condition })}/>}
            {step.type === 'wait' && <div className="wf-fields"><label>Timeout in seconds<input type="number" min="0.1" step="any" value={step.timeoutSeconds} onChange={e => update(index, { ...step, timeoutSeconds: Number(e.target.value) })}/></label><label><input type="checkbox" checked={step.event === true} onChange={e => update(index, { ...step, event: e.target.checked })}/>Wait for a new event after entering this step</label></div>}
            {step.type === 'branch' && <><h4>If true</h4><Blocks steps={step.then ?? []} previous={available} onChange={then => update(index, { ...step, then })}/><h4>Otherwise</h4><Blocks steps={step.else ?? []} previous={available} onChange={other => update(index, { ...step, else: other })}/></>}
            {step.type === 'parallel' && <>{step.branches?.map((branch, i) => <div key={i}><h4>Independent branch {i + 1}</h4><Blocks steps={branch} previous={available} onChange={next => update(index, { ...step, branches: step.branches?.map((item, j) => i === j ? next : item) })}/></div>)}</>}
            {step.type === 'research' && <InputField label="Research question" value={input.query} previous={available} onChange={value => patch('query', value)}/>}
            {['browser', 'desktop', 'project'].includes(step.type) && <><label>Worker goal<textarea value={String(input.goal ?? '')} onChange={e => patch('goal', e.target.value)}/></label>{step.type === 'project' ? <><label>Project model ID<input value={String(input.modelId ?? '')} onChange={e => patch('modelId', e.target.value)}/></label><label>Thinking variant<input value={String(input.thinkingVariant ?? '')} onChange={e => patch('thinkingVariant', e.target.value || null)}/></label><details><summary>Exact commands reviewed for this scope</summary>{(input.commands as {
                            command: string;
                            directory: string;
                        }[] ?? []).map((command, i) => <div className="wf-fields" key={i}><label>Command<input value={command.command} onChange={e => patch('commands', (input.commands as {
                                command: string;
                                directory: string;
                            }[]).map((item, j) => i === j ? { ...item, command: e.target.value } : item))}/></label><label>Directory<input value={command.directory} onChange={e => patch('commands', (input.commands as {
                                command: string;
                                directory: string;
                            }[]).map((item, j) => i === j ? { ...item, directory: e.target.value } : item))}/></label><button type="button" onClick={() => patch('commands', (input.commands as unknown[]).filter((_, j) => i !== j))}>Remove</button></div>)}<button type="button" onClick={() => patch('commands', [...(input.commands as unknown[] ?? []), { command: '', directory: '' }])}>Add exact command</button></details></> : <details><summary>Reviewed worker actions</summary><p>Actions that require extra confirmation remain explicit checkpoints. Scope always limits websites and apps.</p><JsonField label="Action grants as structured JSON" value={input.actions ?? []} onChange={value => patch("actions", value)}/></details>}</>}
            {step.type === 'write_report' && <><label>Report path<input value={String(input.target ?? '')} onChange={e => patch('target', e.target.value)}/></label><InputField label="Report content" value={input.content} previous={available} onChange={value => patch('content', value)}/></>}
            {step.type === 'verify' && <><label>Check<select aria-label="Check" value={String(input.kind ?? 'file')} onChange={e => update(index, { ...step, input: e.target.value === 'condition' ? { kind: 'condition', condition: always } : e.target.value === 'output' ? { kind: 'output', value: { fromStep: available[0]?.id ?? '', path: '' } } : { kind: 'file', target: '', exists: true } })}><option value="file">File evidence</option><option value="condition">Observed condition</option><option value="output">Earlier output</option></select></label>{input.kind === 'file' ? <><label>File path<input value={String(input.target ?? '')} onChange={e => patch('target', e.target.value)}/></label><label>Required content<input value={String(input.contains ?? '')} onChange={e => patch('contains', e.target.value || undefined)}/></label><InputField label="Expected SHA-256" value={input.sha256 ?? ''} previous={available} onChange={value => patch('sha256', value || undefined)}/><label><input type="checkbox" checked={input.exists === true} onChange={e => patch('exists', e.target.checked)}/>Confirm file exists</label></> : input.kind === 'condition' ? <ConditionEditor value={input.condition as TinyCondition} onChange={value => patch('condition', value)}/> : <><InputField label="Observed output" value={input.value} previous={available} onChange={value => patch('value', value)}/><JsonField label="Expected value (JSON, optional)" value={input.equals} onChange={value => patch("equals", value)}/></>}</>}
            {['notify', 'approval'].includes(step.type) && <InputField label="Message" value={input.message ?? ''} previous={available} onChange={value => patch('message', value)}/>}
            {step.type === 'action' && <div className="wf-fields"><label>Action<select value={step.action?.type} onChange={e => update(index, { ...step, action: { type: e.target.value as NonNullable<Step['action']>['type'], target: '', message: '' } })}><option value="notify">Notify</option><option value="open_path">Open file / folder</option><option value="open_url">Open website</option><option value="focus_app">Focus app</option><option value="minimize_app">Minimize app</option></select></label><label>Target / message<input value={step.action?.type === 'notify' ? step.action.message : step.action?.target ?? ''} onChange={e => update(index, { ...step, action: { ...step.action!, [step.action?.type === 'notify' ? 'message' : 'target']: e.target.value } })}/></label></div>}
            </fieldset>;
        })}<label className="wf-add">Add a building block<select value="" onChange={e => {
            if (e.target.value)
                onChange([...steps, block(e.target.value as Step['type'])]);
        }}><option value="">Choose a block…</option>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>;
}
function ProjectOutput({ output }: {
    output: TinyWorkflowOutput;
}) {
    const [diff, setDiff] = useState<{
        before: string | null;
        after: string | null;
    } | null>(null), [error, setError] = useState('');
    return <><AgentVerificationResult result={output.verification}/>{output.workerTaskId && output.workerRequestId && <AgentExecutionPanel taskId={output.workerTaskId} requestId={output.workerRequestId}/>}<div>{output.changes?.map(change => <button key={change.path} onClick={() => { void window.orvixDesktop?.getAgentDiff(output.workerTaskId!, change.path).then(setDiff).catch(cause => setError(String(cause))); }}>{change.kind} · {change.path}</button>)}</div>{error && <p role="alert">{error}</p>}{diff && <AgentDiff before={diff.before} after={diff.after}/>}</>;
}
function TinyWorkflowWorkshop({ initialId, selectionRequest = 0 }: {
    initialId?: string | null;
    selectionRequest?: number;
}) {
    const bridge = window.orvixDesktop;
    const [listing, setListing] = useState<TinyWorkflowListing>({ sequence: 0, definitions: [], runs: [] }), [chosen, setChosen] = useState<string | null>(initialId ?? null), [runId, setRunId] = useState<string | null>(null), [draft, setDraft] = useState<Definition | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [review, setReview] = useState(false), [events, setEvents] = useState<TinyWorkflowEvent[]>([]), [next, setNext] = useState<number | null>(null), [capabilities, setCapabilities] = useState<Record<string, unknown>>({});
    const eventGeneration = useRef(0);
    const [visibleEvents,setVisibleEvents]=useState(100);
    const [runReview, setRunReview] = useState<{ runId: string; definition: Definition } | null>(null);
    useEffect(() => {
        if (!bridge?.listTinyWorkflows)
            return;
        return subscribeTinyWorkflows(bridge, setListing, cause => setError(String(cause)));
    }, [bridge]);
    useEffect(() => {
        setChosen(initialId ?? null);
        setRunId(null);
    }, [initialId, selectionRequest]);
    useEffect(() => { void bridge?.tinyWorkflowCapabilities?.().then(setCapabilities).catch(() => { }); }, [bridge]);
    const selected = listing.definitions.find(value => value.id === chosen), runs = listing.runs.filter(run => run.definitionId === chosen), run = runs.find(value => value.id === runId) ?? runs[0];
    useEffect(() => {
        const current = ++eventGeneration.current;
        let live = true, ready = false, sequence = 0;
        let paintTimer:ReturnType<typeof setTimeout>|undefined;
        const pendingEvents:TinyWorkflowEvent[]=[];
        setVisibleEvents(100);
        const buffered: TinyWorkflowEvent[] = [];
        if (!run?.id) {
            setEvents([]);
            return;
        }
        const catchUp = async (after: number) => {
            let cursor: number | null = after;
            while (live && cursor !== null) {
                const page = await bridge!.tinyWorkflowHistory({ runId: run.id, after: cursor });
                if (!live) return;
                setEvents(old => [...old, ...page.records.filter(item => !old.some(record => record.sequence === item.sequence))].sort((a,b) => a.sequence-b.sequence));
                cursor = page.next;
            }
        };
        const off = bridge?.onTinyWorkflowEvent(event => {
            if (ready && event.sequence > sequence + 1) void catchUp(sequence).catch(cause => { if(live)setError(String(cause)); });
            sequence = Math.max(sequence, event.sequence);
            if (event.runId !== run.id) return;
            if (!ready) buffered.push(event);
            else {
                pendingEvents.push(event);
                if (!paintTimer) paintTimer=setTimeout(()=>{paintTimer=undefined;const incoming=pendingEvents.splice(0);if(live)setEvents(old=>{const seen=new Set(old.map(item=>item.sequence));return [...old,...incoming.filter(item=>!seen.has(item.sequence))].sort((a,b)=>a.sequence-b.sequence);});},100);
            }
        });
        void bridge?.tinyWorkflowHistory({ runId: run.id }).then(value => {
            if (live && current === eventGeneration.current) {
                ready = true;
                sequence = Math.max(sequence, value.sequence);
                setEvents([...value.records, ...buffered.filter(event => event.sequence > value.sequence)].sort((a, b) => a.sequence - b.sequence));
                setNext(value.next);
            }
        }).catch(cause => setError(String(cause)));
        return () => { live = false; clearTimeout(paintTimer); off?.(); };
    }, [bridge, run?.id]);
    async function operation(work: () => Promise<unknown>) {
        setBusy(true);
        setError('');
        try {
            await work();
        }
        catch (cause) {
            setError(String(cause));
        }
        finally {
            setBusy(false);
        }
    }
    const control = (action: string, current: TinyWorkflowRun | undefined = run, extra: Record<string, unknown> = {}) => operation(async () => {
        const result = await bridge!.manageTinyWorkflow({ action, id: selected?.id, revision: current?.revision ?? selected?.revision, runId: current?.id, requestId: id(), ...extra });
        if (result.definition) {
            setChosen(result.definition.id!);
            setDraft(result.definition);
        }
        if (result.message)
            setError(result.message);
    });
    function create(kind: string) {
        const def = fresh();
        if (kind === 'folder') {
            def.name = 'Folder research report';
            def.goal = 'Research a new arrival and save a checked report';
            def.trigger = { condition: newRow('folder_new_file'), holdSeconds: 0 };
        }
        if (kind === 'review') {
            def.name = 'Review a result';
            def.mode = 'Review';
            def.goal = 'Inspect an existing file against my check';
            def.steps = [block('verify')];
        }
        if (kind === 'project') {
            def.name = 'Project helper';
            def.goal = 'Complete and verify project work';
            def.steps = [block('project')];
        }
        if (kind === 'blank') {
            def.steps = [block('verify')];
        }
        def.acceptance = flat(def.steps).filter(step => ['verify', 'project'].includes(step.type)).map(step => ({ stepId: step.id, text: 'Observed result satisfies the reviewed check' }));
        setDraft(def);
        setReview(false);
        setError('');
    }
    function editSelected() {
        if (!selected)
            return;
        setDraft(structuredClone(selected));
        setReview(false);
    }
    async function save() {
        if (!draft)
            return;
        const invalid = document.querySelector<HTMLElement>('.wf-editor [aria-invalid="true"]');
        if (invalid) {
            setError('Finish the structured JSON fields before saving this plan.');
            invalid.focus();
            return;
        }
        await operation(async () => { const result = await bridge!.draftTinyWorkflow({ id: draft.id, revision: draft.revision, requestId: id(), definition: { ...draft, scope: { paths: draft.scope.paths.map(value => value.trim()).filter(Boolean), domains: draft.scope.domains.map(value => value.trim()).filter(Boolean), apps: draft.scope.apps.map(value => value.trim()).filter(Boolean) } } }); setChosen(result.definition.id!); setDraft(null); setReview(true); });
    }
    async function loadMore() {
        if (next === null || !run)
            return;
        const current = eventGeneration.current;
        const value = await bridge!.tinyWorkflowHistory({ runId: run.id, before: next });
        if (current === eventGeneration.current) {
            setEvents(old => [...value.records.filter(item => !old.some(record => record.sequence === item.sequence)), ...old]);
            setVisibleEvents(count=>Math.max(count,events.length)+value.records.length);
            setNext(value.next);
        }
    }
    return <section className="wf-workshop" aria-label="Agent Workshop"><header className="wf-heading"><div><span className="wf-kicker"><Workflow size={14}/> AGENT WORKSHOP</span><h2>Design the work. Follow every step.</h2><p>Create with Fast or Thinking voice, or build a plan here. Review it once, then follow its work.</p></div><button className="tiny-primary" disabled={!bridge?.draftTinyWorkflow} onClick={() => create('blank')}><Plus size={16}/>New workflow</button></header>
 <div className="wf-starters">{[['folder', 'Folder → research → report', 'Turn a new arrival into a checked report'], ['project', 'Project helper', 'Work with your selected project model'], ['review', 'Review a result', 'Read evidence and find gaps']].map(([kind, title, description], index) => <button key={kind} disabled={!bridge?.draftTinyWorkflow} onClick={() => create(kind)}><span className="wf-starter-top" aria-hidden="true"><span className="wf-starter-icon">{kind === 'folder' ? <FileSearch size={20} strokeWidth={1.5}/> : kind === 'project' ? <Code2 size={20} strokeWidth={1.5}/> : <ScanLine size={20} strokeWidth={1.5}/>}</span><span className="wf-starter-number">0{index + 1}</span></span><strong>{title}</strong><span>{description}</span><ArrowUpRight className="wf-starter-arrow" size={16} aria-hidden="true"/></button>)}</div>
 {listing.storageWarning && <p role="status" className="wf-error">{listing.storageWarning}</p>}{(error || listing.storageError) && <p className="wf-error" role="alert">{error || listing.storageError}</p>}
 <div className="wf-layout"><nav aria-label="Workflow agents" className="wf-agents">{listing.definitions.length === 0 ? <p>Plans made with voice appear here.</p> : listing.definitions.map(def => <button className={def.id === chosen ? 'is-selected' : ''} key={def.id} onClick={() => { setChosen(def.id!); setRunId(null); setReview(false); }}><strong>{def.name}</strong><span>{def.mode} · revision {def.revision} · {def.approved ? 'Reviewed' : 'Draft'}{def.enabled ? ' · Enabled' : ''}</span></button>)}</nav>
 {selected ? <article className="wf-detail"><header><span className="wf-kicker">{selected.mode} · {selected.execution.mode} · REVISION {selected.revision}</span><h3>{selected.name}</h3><p>{selected.goal}</p><div className="wf-toolbar"><button disabled={busy} onClick={() => setReview(!review)}>Review complete plan</button><button disabled={busy} onClick={editSelected}>Edit a new revision</button><button disabled={busy} onClick={() => void control('duplicate', undefined, { revision: selected.revision })}><Copy size={14}/>Duplicate workflow</button>{selected.enabled && <button disabled={busy} onClick={() => void control('disable', undefined, { revision: selected.revision })}>Disable future triggers</button>}</div></header>
 {review && <section className="wf-review" aria-label="Complete workflow review"><h4>Reviewed scope</h4><p>{selected.recurring ? 'Repeats only on the listed trigger / schedule' : 'One run only'} · {selected.schedule.mode} · {selected.schedule.timezone} · {selected.execution.maxRuns} run capacity</p>{selected.schedule.mode !== 'always' && <pre>{JSON.stringify(selected.schedule, null, 2)}</pre>}{selected.trigger && <p>When: {describeCondition(selected.trigger.condition)} · hold {selected.trigger.holdSeconds}s{selected.trigger.change && ' · selected changes, ' + selected.trigger.change.settleSeconds + 's settling'}</p>}<p>Paths: {selected.scope.paths.join(', ') || 'None'}<br />Websites: {selected.scope.domains.join(', ') || 'None'}<br />Apps: {selected.scope.apps.join(', ') || 'None'}<br />Workers: {selected.models.work || 'Source reads only'} / {selected.models.project || 'No project model'}</p><PlanSteps steps={selected.steps}/><h4>Acceptance checks</h4>{run && ["paused", "needs_attention"].includes(run.status) && selected.revision! > run.revision && <button className="tiny-primary" disabled={busy} onClick={() => void control("update_run", run, { newRevision: selected.revision })}>Approve revised remaining work for this run</button>}<ul>{selected.acceptance.map(check => <li key={check.stepId}>{check.text}</li>)}</ul>{!selected.approved && selected.mode !== 'Plan' && <button className="tiny-primary" disabled={busy} onClick={() => void control('approve', undefined, { revision: selected.revision })}><Check size={16}/>Approve this revision and {selected.trigger || selected.schedule.mode !== 'always' ? 'watch' : 'run'}</button>}{selected.mode === 'Plan' && <p>Plan mode keeps this as a draft. Choose Work and review a new revision to execute.</p>}</section>}
  {review && selected.approved && !selected.enabled && selected.recurring && <button className="tiny-primary" disabled={busy} onClick={() => void control('approve', undefined, { revision: selected.revision })}>Re-enable this reviewed recurrence</button>}
  <TinyLazyDetails key={selected.id} summary="Synthetic preview · no execution">{()=> <><p>This walk-through uses the saved plan only. It does not read sensors, run tools or change files. Real results appear in the live timeline after approval.</p><PlanSteps steps={selected.steps}/></>}</TinyLazyDetails>
  {runs.length > 0 && <label>Run<select value={run?.id} onChange={e => setRunId(e.target.value)}>{runs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.status} · revision {item.revision}</option>)}</select></label>}
  {run && <button disabled={busy} onClick={() => void operation(async () => { const value = await bridge!.inspectTinyWorkflow({ runId: run.id }); setRunReview({ runId: run.id, definition: value.definition }); })}>Inspect this run’s approved revision {run.revision}</button>}
  {runReview?.runId === run?.id && runReview && <section className="wf-review" aria-label="Approved run revision"><h4>Approved revision {runReview.definition.revision} for this run</h4><p>{runReview.definition.goal}</p><PlanSteps steps={runReview.definition.steps}/><TinyLazyDetails summary="Exact approved scope, workers and checks">{()=> <pre>{JSON.stringify(runReview.definition, null, 2)}</pre>}</TinyLazyDetails></section>}
 {run && <section aria-label="Live workflow work"><div className="wf-run-status" role="status"><strong>{run.status.replaceAll('_', ' ')}</strong><span>{run.reason}</span><small>Receipt {run.id} · approved revision {run.revision} · saved {new Date(run.createdAt).toLocaleString()}</small><small>Current step: {Object.values(run.steps).filter(step=>['running','waiting'].includes(step.status)).map(step=>step.title).join(', ') || 'No step executing'} · last progress {new Date(run.lastProgressAt ?? run.updatedAt).toLocaleTimeString()}</small>{run.executionStoppedAt && <small>Execution stopped {new Date(run.executionStoppedAt).toLocaleString()}{run.effectsUncertain ? ' · effect inspection required' : ' · completed work retained'}</small>}</div><div className="wf-toolbar">{['running', 'waiting', 'queued'].includes(run.status) && <button disabled={busy} onClick={() => void control('pause')}><Pause size={14}/>Pause task</button>}{['paused', 'needs_attention'].includes(run.status) && <><button disabled={busy} onClick={() => void control('resume')}><Play size={14}/>Continue</button><button disabled={busy} onClick={() => void control('repair')}>Draft repair</button></>}{!['verified', 'cancelled', 'failed'].includes(run.status) && <button disabled={busy || run.status==='stopping'} onClick={() => void control('cancel')}>Cancel task</button>}</div>
 {run.questions.map(question => <div className="wf-question" key={question.id}><strong>{question.question ?? question.command ?? 'Input required'}</strong>{question.directory && <p>{question.directory}</p>}{question.kind === 'effect_unknown' ? <button disabled={busy} onClick={() => void control('resolve', run, { stepId: question.stepId })}>Inspect actual effect</button> : question.kind === 'worker_question' ? <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void control('answer', run, { questionId: question.id, answer: form.get('answer') }); }}><label>Your answer<input name="answer" required/></label><button disabled={busy}>Answer</button></form> : <><button disabled={busy} onClick={() => void control('answer', run, { questionId: question.id, accepted: true })}>Approve checkpoint</button><button disabled={busy} onClick={() => void control('answer', run, { questionId: question.id, accepted: false })}>Decline</button></>}</div>)}
 <ol className="wf-live-steps">{Object.values(run.steps).map(step => <li key={step.id}><strong>{step.title}</strong><span>{step.status}{step.reason ? ' · ' + step.reason : ''}{step.deadline ? ' · deadline ' + new Date(step.deadline).toLocaleTimeString() : ''}</span>{step.completionUnknown && <button disabled={busy} onClick={() => void control('resolve', run, { stepId: step.id })}>Inspect interrupted effect</button>}</li>)}</ol>
 <h4>Results and observed evidence</h4>{Object.entries(run.outputs).map(([key, output]) => <TinyLazyDetails key={run.id+key} summary={<>{run.steps[key]?.title ?? key} · {output.verified ? 'Observed verification' : output.status ?? 'Output'}</>}>{()=> <>{output.message && <p>{output.message}</p>}{output.text && <pre>{output.text}</pre>}{output.artifact && <><p>{output.artifact.path} · SHA-256 {output.artifact.hash}</p><pre>{output.artifact.content ?? 'Saved artifact; inspect its verification evidence.'}</pre></>}<ProjectOutput output={output}/><pre>{JSON.stringify(output.evidence ?? {}, null, 2)}</pre></>}</TinyLazyDetails>)}
 <h4>Notification delivery</h4>{listing.notices?.filter(notice => notice.runId === run.id).map(notice => <p key={notice.id}>Notification delivery: {notice.status === 'confirmed' ? 'Display confirmed' : notice.status}{notice.error ? ' · ' + notice.error : ''}</p>)}<h4>Live timeline</h4>{events.length>visibleEvents&&<button onClick={()=>setVisibleEvents(count=>count+100)}>Show earlier loaded activity ({events.length-visibleEvents})</button>}<ol className="wf-timeline">{events.slice(-visibleEvents).map(event => <li key={event.id ?? event.sequence}><time>{event.at ? new Date(event.at).toLocaleTimeString() : ''}</time><span>{event.kind.replaceAll('_', ' ')}{event.step ? ' · ' + event.step.title + ' · ' + event.step.status : ''}{event.message ? ' · ' + event.message : ''}{event.worker ? ' · ' + String(event.worker.message ?? event.worker.type ?? 'worker update') : ''}</span></li>)}</ol>{next !== null && <button onClick={() => void operation(loadMore)}>Load older evidence page</button>}</section>}
 </article> : <div className="wf-empty"><div className="wf-empty-mark" aria-hidden="true"><Workflow size={25} strokeWidth={1.4}/></div><h3>Your next workflow starts here.</h3><p>Pick a starter or ask either voice profile to draft a workflow. Your approved work continues while you explore Orvix.</p><span>Reviewed plans · precise targets · observed results</span></div>}</div>
 {draft && <div className="wf-editor-backdrop"><section className="wf-editor" role="dialog" aria-modal="true" aria-label="Build workflow" onKeyDown={event => dialogKeys(event, () => setDraft(null))}><header><div><span className="wf-kicker">BUILD A REVIEWABLE PLAN</span><h3>{draft.id ? 'Edit future work' : 'Your new little helper'}</h3></div><button aria-label="Close workflow builder" onClick={() => setDraft(null)}><X size={20}/></button></header><form onSubmit={e => { e.preventDefault(); void save(); }}><div className="wf-fields"><label>Name<input autoFocus required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label>Job mode<select value={draft.mode} onChange={e => setDraft({ ...draft, mode: e.target.value as Definition['mode'] })}>{['Plan', 'Monitor', 'Work', 'Review', 'Repair'].map(mode => <option key={mode}>{mode}</option>)}</select></label><label>Island home<select value={draft.district} onChange={e => setDraft({ ...draft, district: e.target.value as Definition['district'] })}>{['workshop', 'garden', 'library', 'harbor'].map(value => <option key={value}>{value}</option>)}</select></label></div><label>Goal<textarea required value={draft.goal} onChange={e => setDraft({ ...draft, goal: e.target.value })}/></label>
 <fieldset><legend>Permitted targets</legend>{(['paths', 'domains', 'apps'] as const).map(key => <label key={key}>{key === 'paths' ? 'Absolute folders / files' : key === 'domains' ? 'Exact website hostnames' : 'Exact application names'} (one per line)<textarea value={draft.scope[key].join('\n')} onChange={e => setDraft({ ...draft, scope: { ...draft.scope, [key]: e.target.value.split('\n') } })}/></label>)}<button type="button" onClick={() => void bridge?.pickTinyAgentPath('folder').then(path => {
                if (path)
                    setDraft({ ...draft, scope: { ...draft.scope, paths: [...draft.scope.paths.filter(Boolean), path] } });
            })}>Choose folder</button></fieldset>
 <div className="wf-fields"><label>Reasoning worker model<input placeholder={String(capabilities.workModel ?? 'Choose configured model')} value={draft.models.work} onChange={e => setDraft({ ...draft, models: { ...draft.models, work: e.target.value } })}/></label><label>Project provider / model ID<select value={draft.models.project} onChange={e => setDraft({ ...draft, models: { ...draft.models, project: e.target.value } })}><option value="">Choose the project model</option>{projectModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></div>
 <fieldset><legend>When should it work?</legend><label>Start<select value={draft.trigger ? 'trigger' : draft.schedule.mode === 'always' ? 'one-off' : 'schedule'} onChange={e => setDraft({ ...draft, trigger: e.target.value === 'trigger' ? { condition: newRow(), holdSeconds: 0 } : null, schedule: { ...draft.schedule, mode: e.target.value === 'schedule' ? 'daily' : 'always' } })}><option value="one-off">One-off after review</option><option value="trigger">On a selected condition / change</option><option value="schedule">On a schedule</option></select></label>{draft.trigger && <><ConditionEditor value={draft.trigger.condition} onChange={condition => setDraft({ ...draft, trigger: { ...draft.trigger!, condition } })}/><label><input type="checkbox" checked={!!draft.trigger.change} onChange={e => setDraft({ ...draft, trigger: { ...draft.trigger!, change: e.target.checked ? defaultChangeTrigger() : undefined, holdSeconds: 0 } })}/>Selected changes</label>{draft.trigger.change ? <TinyChangeControls trigger={draft.trigger.change} pickFile={apply => {
                        void bridge?.pickTinyAgentPath('file').then(path => {
                            if (path)
                                apply(path);
                        });
                    }} onChange={change => setDraft({ ...draft, trigger: { ...draft.trigger!, change } })}/> : <label>Hold for exact seconds<input type="number" min="0" value={draft.trigger.holdSeconds} onChange={e => setDraft({ ...draft, trigger: { ...draft.trigger!, holdSeconds: Number(e.target.value) } })}/></label>}</>}
 {(draft.schedule.mode !== 'always' || draft.trigger) && <><label>Schedule<select value={draft.schedule.mode} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, mode: e.target.value as Definition['schedule']['mode'] } })}>{['always', 'daily', 'window', 'once'].map(value => <option key={value}>{value}</option>)}</select></label>{draft.schedule.mode !== 'always' && <div className="wf-fields"><label>Timezone<input value={draft.schedule.timezone} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, timezone: e.target.value } })}/></label>{draft.schedule.mode === 'once' ? <><label>Date and time<input type="datetime-local" required value={Number.isFinite(draft.schedule.at) ? new Date(draft.schedule.at! - new Date(draft.schedule.at!).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={e => { const at = e.target.value ? new Date(e.target.value).getTime() : undefined; setDraft({ ...draft, schedule: { ...draft.schedule, at: Number.isFinite(at) ? at : undefined } }); }}/></label><label>Missed run<select value={draft.schedule.missed ?? 'skip'} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, missed: e.target.value as 'skip' | 'catch_up' } })}><option value="skip">Skip</option><option value="catch_up">Catch up</option></select></label></> : <><label>Start<input type="time" value={draft.schedule.start} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, start: e.target.value } })}/></label>{draft.schedule.mode === 'window' && <label>End<input type="time" value={draft.schedule.end} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, end: e.target.value } })}/></label>}<div className="wf-days">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => <label key={day}><input type="checkbox" checked={draft.schedule.days?.includes(i) ?? false} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, days: e.target.checked ? [...(draft.schedule.days ?? []), i] : (draft.schedule.days ?? []).filter(value => value !== i) } })}/>{day}</label>)}</div></>}</div>}</>}
 <label><input type="checkbox" checked={draft.recurring} disabled={!draft.trigger && draft.schedule.mode === 'always'} onChange={e => setDraft({ ...draft, recurring: e.target.checked })}/>Approve recurring runs for this trigger / schedule</label></fieldset>
 <div className="wf-fields"><label>Execution policy<select value={draft.execution.mode} onChange={e => { const mode = e.target.value as Definition['execution']['mode']; setDraft({ ...draft, execution: { mode, maxRuns: mode === 'queued' ? 10 : mode === 'parallel' ? 2 : 1 } }); }}>{['single', 'queued', 'restart', 'parallel'].map(mode => <option key={mode}>{mode}</option>)}</select></label>{['queued', 'parallel'].includes(draft.execution.mode) && <label>Maximum runs (active + queued)<input type="number" min="1" max="10" value={draft.execution.maxRuns} onChange={e => setDraft({ ...draft, execution: { ...draft.execution, maxRuns: Number(e.target.value) } })}/></label>}</div>
 <h4>Steps, in order</h4><Blocks steps={draft.steps} onChange={steps => setDraft({ ...draft, steps })}/><fieldset><legend>Acceptance criteria</legend>{draft.acceptance.map((check, index) => <div className="wf-fields" key={index}><label>What must be observed?<input required value={check.text} onChange={e => setDraft({ ...draft, acceptance: draft.acceptance.map((value, i) => i === index ? { ...value, text: e.target.value } : value) })}/></label><label>Verification step<select value={check.stepId} onChange={e => setDraft({ ...draft, acceptance: draft.acceptance.map((value, i) => i === index ? { ...value, stepId: e.target.value } : value) })}>{flat(draft.steps).filter(step => ['verify', 'project'].includes(step.type)).map(step => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label><button type="button" onClick={() => setDraft({ ...draft, acceptance: draft.acceptance.filter((_, i) => i !== index) })}>Remove</button></div>)}<button type="button" onClick={() => setDraft({ ...draft, acceptance: [...draft.acceptance, { text: '', stepId: flat(draft.steps).find(step => ['verify', 'project'].includes(step.type))?.id ?? '' }] })}>Add acceptance check</button></fieldset><p>Saving prepares a draft. Changing a running job keeps its current approved revision.</p>{error && <p role="alert" className="wf-error">{error}</p>}<footer><button type="button" onClick={() => setDraft(null)}>Cancel</button><button className="tiny-primary" disabled={busy || !draft.acceptance.length}><Check size={16}/>{busy ? 'Saving…' : 'Save for complete review'}</button></footer></form></section></div>}
 </section>;
}

export default memo(TinyWorkflowWorkshop);
