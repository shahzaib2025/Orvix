import type { TinyWorkflowListing } from './desktop';
type Bridge = Pick<NonNullable<Window['orvixDesktop']>, 'listTinyWorkflows' | 'onTinyWorkflowEvent'>;
export function subscribeTinyWorkflows(bridge: Bridge, update: (value: TinyWorkflowListing) => void, error?: (cause: unknown) => void) {
    let live = true, generation = 0, sequence = -1, snapshot: TinyWorkflowListing | undefined;
    let pending: TinyWorkflowListing | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (value: TinyWorkflowListing, routine = false) => {
        if (routine) {
            pending = value;
            if (!timer) timer = setTimeout(() => { timer = undefined; const next = pending; pending = undefined; if (live && next) update(next); }, 100);
        } else {
            clearTimeout(timer); timer = undefined; pending = undefined; update(value);
        }
    };
    const refresh = () => {
        const current = ++generation;
        void bridge.listTinyWorkflows().then(value => {
            if (live && current === generation && value.sequence >= sequence) {
                sequence = value.sequence;
                snapshot = value;
                publish(value);
            }
        }).catch(cause => {
            if (live && current === generation)
                error?.(cause);
        });
    };
    const off = bridge.onTinyWorkflowEvent(event => {
        if (!live || event.sequence <= sequence)
            return;
        if (snapshot && event.sequence === sequence + 1 && event.patch) {
            generation++;
            const { run:fullRun, runUpdate, definition, definitions, ...rest } = event.patch;
            const previous=runUpdate&&snapshot.runs.find(run=>run.id===runUpdate.id&&run.revision===runUpdate.revision);
            if (runUpdate && !previous) { sequence=event.sequence;refresh();return; }
            const run=fullRun??(previous?{...previous,...runUpdate}:undefined);
            snapshot = { ...snapshot, ...rest, sequence: event.sequence,
                runs: run ? [run, ...snapshot.runs.filter(item => item.id !== run.id)].slice(0, 200) : snapshot.runs,
                definitions: definitions ?? (definition ? [...snapshot.definitions.filter(item => item.id !== definition.id), definition] : snapshot.definitions) };
            sequence = event.sequence;
            // Paint routine progress at most ten times a second. Approvals,
            // stop acknowledgements, failures and terminal states stay immediate.
            publish(snapshot, event.kind === 'worker_progress' && !['approval','clarification'].includes(String(event.worker?.type)));
            return;
        }
        sequence = event.sequence;
        refresh();
    });
    refresh();
    return () => { live = false; generation++; clearTimeout(timer); pending = undefined; off(); };
}
