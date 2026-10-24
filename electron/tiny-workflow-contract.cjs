const path = require('node:path');
const { validateCondition } = require('./tiny-agents.cjs');
const { validateAction, validateSchedule } = require('./tiny-agent-options.cjs');
const { validateChange } = require('./tiny-agent-changes.cjs');
const { canonicalTarget, protectedPath } = require('./agent/workspace-manager.cjs');
const { validId } = require('./agent/durable-store.cjs');
const { isSensitiveFile, credentialDirectories } = require('./agent/file-policy.cjs');
const check = (ok, message) => {
    if (!ok)
        throw new Error(message);
};
const text = (value, limit = 2000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const always = { op: 'predicate', signal: 'always', comparator: 'eq', value: true };
const modes = ['Plan', 'Monitor', 'Work', 'Review', 'Repair'];
const stepTypes = ['action', 'delay', 'wait', 'branch', 'parallel', 'research', 'browser', 'desktop', 'project', 'write_report', 'verify', 'notify', 'approval'];
function localPath(value) {
    check(typeof value === 'string' && path.isAbsolute(value) && !value.startsWith('\\\\'), 'Choose an absolute local target.');
    const target = canonicalTarget(value);
    check(!protectedPath(target) && !isSensitiveFile(target) && !target.split(path.sep).some(part => credentialDirectories.has(part.toLowerCase())) && target !== path.parse(target).root, 'System, credential and drive-root targets are unavailable.');
    return target;
}
function references(value, refs = []) {
    if (!value || typeof value !== 'object')
        return refs;
    if (Object.hasOwn(value, 'fromStep')) {
        validId(value.fromStep);
        check(value.path === undefined || typeof value.path === 'string' && /^[\w.-]*$/.test(value.path), 'Use a simple output property path.');
        refs.push(value.fromStep);
    }
    else
        for (const item of Object.values(value))
            references(item, refs);
    return refs;
}
function normalizeDefinition(raw) {
    check(raw && typeof raw === 'object', 'A workflow draft is required.');
    const name = text(raw.name, 80), goal = text(raw.goal, 4000), mode = raw.mode ?? 'Work';
    check(name && goal, 'Give the workflow a name and a goal.');
    check(modes.includes(mode), 'Choose Plan, Monitor, Work, Review or Repair.');
    const policy = raw.execution ?? {}, execution = { mode: policy.mode ?? 'single', maxRuns: policy.maxRuns ?? (policy.mode === 'queued' ? 10 : policy.mode === 'parallel' ? 2 : 1) };
    check(['single', 'queued', 'restart', 'parallel'].includes(execution.mode), 'Choose a supported execution policy.');
    check(Number.isInteger(execution.maxRuns) && execution.maxRuns >= 1 && execution.maxRuns <= 10, 'Use a run capacity between 1 and 10.');
    if (['single', 'restart'].includes(execution.mode))
        execution.maxRuns = 1;
    const scope = { paths: (raw.scope?.paths ?? []).map(localPath), domains: (raw.scope?.domains ?? []).map(domain => {
            check(typeof domain === 'string' && /^[a-z0-9.-]+$/i.test(domain) && !domain.includes('..'), 'Choose an exact website hostname.');
            return domain.toLowerCase();
        }), apps: (raw.scope?.apps ?? []).map(value => { check(text(value, 120), 'Choose an application name.'); return text(value, 120); }) };
    check(scope.paths.length <= 12 && scope.domains.length <= 20 && scope.apps.length <= 12, 'Too many workflow targets.');
    const seen = new Set();
    let count = 0;
    function steps(items, available = new Set(), depth = 0) {
        check(depth <= 4 && Array.isArray(items) && items.length > 0, 'Use a nonempty step list with at most four nested levels.');
        return items.map(item => {
            check(++count <= 100, 'Use at most 100 workflow steps.');
            validId(item?.id);
            check(!seen.has(item.id), 'Step IDs must be unique.');
            seen.add(item.id);
            check(stepTypes.includes(item.type), 'Unsupported workflow step.');
            const step = { id: item.id, type: item.type, title: text(item.title, 160) || item.type };
            const payload = structuredClone(item.input ?? {});
            for (const ref of references(payload))
                check(available.has(ref), `Output ${ref} is not available before ${item.id}; forward, cyclic and cross-branch references are rejected.`);
            if (item.type === 'action') {
                step.action = validateAction(item.action);
                check(step.action.type !== 'shutdown', 'Use the existing reviewed shutdown agent with its cancellable countdown.');
            }
            else if (item.type === 'delay') {
                check(Number.isFinite(item.seconds) && item.seconds >= 0 && item.seconds <= 86400, 'Delay must be 0 to 86400 seconds.');
                step.seconds = item.seconds;
            }
            else if (item.type === 'wait') {
                step.condition = validateCondition(item.condition ?? always);
                step.event = item.event === true;
                step.timeoutSeconds = item.timeoutSeconds ?? 600;
                check(Number.isFinite(step.timeoutSeconds) && step.timeoutSeconds > 0 && step.timeoutSeconds <= 86400, 'Wait timeout must be greater than 0 and at most 86400 seconds.');
            }
            else if (item.type === 'branch') {
                step.condition = validateCondition(item.condition);
                step.then = steps(item.then, new Set(available), depth + 1);
                step.else = item.else?.length ? steps(item.else, new Set(available), depth + 1) : [];
            }
            else if (item.type === 'parallel') {
                check(Array.isArray(item.branches) && item.branches.length >= 2 && item.branches.length <= 4, 'Use two to four independent branches.');
                step.branches = item.branches.map(branch => steps(branch, new Set(available), depth + 1));
            }
            else {
                step.input = payload;
            }
            if (item.type === 'project') {
                step.input.goal = text(payload.goal || goal, 4000);
                step.input.modelId = text(payload.modelId || raw.models?.project, 120);
                step.input.thinkingVariant = payload.thinkingVariant ?? null;
                step.input.commands = (payload.commands ?? []).map(command => { const directory = localPath(command.directory); check(scope.paths.some(root => inside(root, directory)), 'Command directory is outside the reviewed project paths.'); check(text(command.command, 2000), 'Enter a command to preapprove.'); return { command: text(command.command, 2000), directory }; });
                check(step.input.modelId && scope.paths.length, 'Choose a project model and project paths before review.');
            }
            if (item.type === 'research')
                check(text(payload.query) || references(payload.query).length, 'A research query is required.');
            if (item.type === 'write_report') {
                step.input.target = localPath(payload.target);
                check(scope.paths.some(root => inside(root, step.input.target)), 'The report target must be inside the reviewed paths.');
                check(typeof payload.content === 'string' || references(payload.content).length, 'Choose report text or an earlier step output.');
            }
            if (item.type === 'verify') {
                check(['condition', 'file', 'output'].includes(payload.kind), 'Verification must check a condition, file or earlier output.');
                if (payload.kind === 'condition')
                    step.input.condition = validateCondition(payload.condition);
                if (payload.kind === 'file') {
                    step.input.target = localPath(payload.target);
                    check(scope.paths.some(root => inside(root, step.input.target)), 'Verification target is outside the reviewed paths.');
                    check(payload.exists === true || typeof payload.contains === 'string' && payload.contains.length > 0 || typeof payload.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(payload.sha256) || references(payload.sha256).length, 'Choose a nonempty file content, SHA-256 or existence check.');
                }
                if (payload.kind === 'output')
                    check(references(payload.value).length > 0, 'Output verification requires an earlier step reference.');
            }
            if (['browser', 'desktop'].includes(item.type)) {
                check(raw.models?.work && text(payload.goal || goal), 'Choose the reasoning-worker model and step goal.');
                check(item.type === 'browser' ? scope.domains.length : scope.apps.length, 'Choose exact worker targets before review.');
                step.input.goal = text(payload.goal || goal, 4000);
                step.input.actions = (payload.actions ?? []).map(action => { check(['browser_act', 'desktop_act', 'window_act'].includes(action.tool) && text(action.action, 100), 'Invalid reviewed worker action.'); return { tool: action.tool, action: action.action, args: structuredClone(action.args ?? {}) }; });
            }
            if (mode === 'Review' || mode === 'Plan')
                check(['research', 'verify', 'branch', 'parallel', 'delay', 'wait'].includes(step.type), `${mode} mode does not execute changing actions.`);
            available.add(item.id);
            return step;
        });
    }
    const list = steps(raw.steps);
    const flat = flattenSteps(list);
    if (execution.mode === 'restart')
        check(flat.every(step => ['delay', 'wait', 'branch', 'parallel', 'research', 'verify'].includes(step.type)), 'Restart is available only for read-only, restart-safe workflows.');
    for (const step of flat.filter(step => step.type === 'action')) {
        if (step.action.type === 'open_path')
            check(scope.paths.some(root => inside(root, localPath(step.action.target))), 'Action path is outside the reviewed targets.');
        if (step.action.type === 'open_url')
            check(scope.domains.includes(new URL(step.action.target).hostname.toLowerCase()), 'Action website is outside the reviewed domains.');
        if (['focus_app', 'minimize_app'].includes(step.action.type))
            check(scope.apps.includes(step.action.target), 'Action application is outside the reviewed apps.');
    }
    const trigger = raw.trigger ? { condition: validateCondition(raw.trigger.condition ?? always), ...(raw.trigger.change ? { change: validateChange(raw.trigger.change) } : {}), holdSeconds: raw.trigger.holdSeconds ?? 0 } : null;
    if (trigger)
        check(Number.isInteger(trigger.holdSeconds) && trigger.holdSeconds >= 0 && trigger.holdSeconds <= 86400 && (!trigger.change || trigger.holdSeconds === 0), 'Use valid hold time, or change settling instead of hold.');
    const schedule = validateSchedule(raw.schedule);
    const recurring = raw.recurring === true;
    check(!recurring || trigger || schedule.mode !== 'always', 'Recurring work requires a trigger or schedule.');
    if (mode === 'Monitor')
        check(trigger || schedule.mode !== 'always', 'Monitor mode needs a trigger or schedule.');
    const acceptance = (raw.acceptance ?? []).map(value => { check(value && text(value.text, 500) && seen.has(value.stepId), 'Each acceptance criterion must name a verification step.'); const step = flat.find(item => item.id === value.stepId); check(step.type === 'verify' || step.type === 'project', 'Acceptance requires an observed verification or verified project step.'); return { text: text(value.text, 500), stepId: value.stepId }; });
    check(acceptance.length > 0, 'Add at least one observed acceptance check.');
    return { name, goal, mode, district: ['workshop', 'garden', 'library', 'harbor'].includes(raw.district) ? raw.district : 'workshop', steps: list, scope, models: { work: text(raw.models?.work, 120), project: text(raw.models?.project, 120) }, execution, trigger, schedule, recurring, acceptance };
}
function inside(root, target) { const rel = path.relative(root.toLowerCase(), target.toLowerCase()); return rel === '' || !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function flattenSteps(list) { return list.flatMap(step => [step, ...flattenSteps(step.then ?? []), ...flattenSteps(step.else ?? []), ...(step.branches ?? []).flatMap(flattenSteps)]); }
function resolveOutputs(value, outputs) {
    if (!value || typeof value !== 'object')
        return value;
    if (Object.hasOwn(value, 'fromStep')) {
        let current = outputs[value.fromStep];
        for (const part of (value.path || '').split('.').filter(Boolean)) {
            check(!['__proto__', 'prototype', 'constructor'].includes(part), 'Invalid output property.');
            current = current?.[part];
        }
        check(current !== undefined, 'Requested step output is unavailable.');
        return structuredClone(current);
    }
    if (Array.isArray(value))
        return value.map(item => resolveOutputs(item, outputs));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveOutputs(item, outputs)]));
}
module.exports = { normalizeDefinition, flattenSteps, resolveOutputs, inside, modes, stepTypes, always };
