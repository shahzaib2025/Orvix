const { readState, writeState } = require('./tiny-agent-store.cjs');
const { consumeEvents, fields: nativeFields } = require('./tiny-agent-event-stream.cjs');
const { createOutbox } = require('./tiny-agent-outbox.cjs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateSchedule, validatePolicy, validateAction, localParts, inWindow, scheduleState, nextRun } = require('./tiny-agent-options.cjs');
const { validateChange, observe, reading, mergeChanges, formatChanges } = require('./tiny-agent-changes.cjs');

const SIGNALS = new Set(['battery_percent', 'on_ac', 'charging', 'window_state', 'active_app', 'idle_seconds', 'browser_tab', 'browser_video', 'media_session', 'volume_percent', 'muted', 'brightness_percent', 'always', 'active_seconds', 'app_active_seconds', 'fullscreen', 'network_online', 'cpu_percent', 'memory_percent', 'disk_free_percent', 'file_exists', 'folder_new_file', 'browser_download']);
const COMPARATORS = new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains']);
const NUMERIC = new Set(['battery_percent', 'idle_seconds', 'volume_percent', 'brightness_percent', 'active_seconds', 'app_active_seconds', 'cpu_percent', 'memory_percent', 'disk_free_percent']);
const BOOLEAN = new Set(['on_ac', 'charging', 'muted', 'always', 'fullscreen', 'network_online', 'file_exists']);
const browserFreshMs = 75_000;

function cleanText(value, limit = 120) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function assert(test, message) { if (!test) throw new Error(message); }

function validatePredicate(raw) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'A condition is required.');
  const signal = cleanText(raw.signal, 40);
  const comparator = cleanText(raw.comparator || 'eq', 16);
  assert(SIGNALS.has(signal), `Unsupported signal: ${signal || 'missing'}.`);
  assert(COMPARATORS.has(comparator), 'Unsupported comparison.');
  const value = raw.value;
  if (NUMERIC.has(signal)) {
    assert(typeof value === 'number' && Number.isFinite(value), `${signal} needs a number.`);
    if (!['idle_seconds', 'active_seconds', 'app_active_seconds'].includes(signal)) assert(value >= 0 && value <= 100, `${signal} must be between 0 and 100.`);
    else assert(value >= 0 && value <= 86400, 'Time must be between 0 and 86400 seconds.');
    assert(!['contains'].includes(comparator), 'A number cannot use contains.');
  } else if (BOOLEAN.has(signal)) {
    assert(typeof value === 'boolean' && ['eq', 'neq'].includes(comparator), `${signal} needs a true/false comparison.`);
  } else {
    assert(typeof value === 'string' && value.trim().length > 0 && value.length <= 200, `${signal} needs text.`);
    assert(['eq', 'neq', 'contains'].includes(comparator), `${signal} needs a text comparison.`);
  }
  const target = cleanText(raw.target, ['file_exists', 'folder_new_file'].includes(signal) ? 1024 : 120);
  const scope = cleanText(raw.scope || 'any', 8);
  const field = cleanText(raw.field, 30);
  if (signal === 'window_state') {
    assert(target, 'Choose an application for the window condition.');
    assert(['any', 'all'].includes(scope), 'Window scope must be any or all.');
    assert(['normal', 'maximized', 'minimized'].includes(String(value).toLowerCase()), 'Unsupported window state.');
  }
  if (signal === 'active_app') assert(target || typeof value === 'string', 'Choose an application.');
  if (signal === 'browser_tab') assert(['title', 'url', 'active', 'audible', 'muted'].includes(field), 'Choose a browser tab field.');
  if (signal === 'browser_video') assert(['title', 'playing', 'muted'].includes(field), 'Choose a browser video field.');
  if (['browser_tab', 'browser_video'].includes(signal) && ['active', 'audible', 'muted', 'playing'].includes(field)) assert(['eq', 'neq'].includes(comparator) && ['true', 'false'].includes(String(value).toLowerCase()), 'Browser state fields need a true/false equality comparison.');
  if (signal === 'media_session') assert(['title', 'artist', 'source'].includes(field), 'Choose a media field.');
  if (signal === 'app_active_seconds') assert(target, 'Choose an application for active time.');
  if (signal === 'disk_free_percent') assert(/^[A-Za-z]:$/.test(target), 'Choose a drive such as C:.');
  if (['file_exists', 'folder_new_file'].includes(signal)) assert(path.isAbsolute(target) && !target.startsWith('\\\\'), 'Choose an absolute local file or folder path.');
  if (signal === 'folder_new_file') assert(comparator === 'contains', 'Folder arrivals use a filename contains filter (use * for all files).');
  if (signal === 'browser_download') assert(comparator === 'eq' && ['complete', 'interrupted'].includes(value), 'Choose completed or failed downloads.');
  return { op: 'predicate', signal, comparator, value: typeof value === 'string' ? value.trim() : value, target, scope, field };
}

function validateCondition(raw, depth = 0) {
  assert(depth <= 4, 'Condition nesting is too deep.');
  if (raw?.op === 'predicate' || raw?.signal) return validatePredicate(raw);
  assert(raw && (raw.op === 'all' || raw.op === 'any') && Array.isArray(raw.children), 'Choose all or any conditions.');
  assert(raw.children.length > 0 && raw.children.length <= 12, 'Use between 1 and 12 conditions.');
  return { op: raw.op, children: raw.children.map(child => validateCondition(child, depth + 1)) };
}

function validateRule(raw) {
  assert(raw && typeof raw === 'object', 'A tiny agent rule is required.');
  const name = cleanText(raw.name, 80);
  assert(name, 'Give the tiny agent a name.');
  assert(raw.district === undefined || ['workshop', 'garden', 'library', 'harbor'].includes(raw.district), 'Choose an island work area.');
  const trigger = validateChange(raw.trigger);
  const condition = validateCondition(raw.condition ?? (trigger ? { op: 'predicate', signal: 'always', comparator: 'eq', value: true } : null));
  assert(raw.actions === undefined || Array.isArray(raw.actions), 'Actions must be a list.');
  const actions = (raw.actions ?? [raw.action]).map(validateAction);
  assert(actions.length > 0 && actions.length <= 6, 'Use between 1 and 6 actions.');
  assert(!actions.slice(0, -1).some(a => a.type === 'shutdown'), 'Shutdown must be the final action.');
  const action = actions[0];
  const holdSeconds = Number(raw.holdSeconds ?? 0);
  const repeatSeconds = Number(raw.repeatSeconds ?? 0);
  assert(Number.isInteger(holdSeconds) && holdSeconds >= 0 && holdSeconds <= 86400, 'Hold time must be 0 to 86400 seconds.');
  assert(Number.isInteger(repeatSeconds) && repeatSeconds >= 0 && repeatSeconds <= 86400, 'Repeat time must be 0 to 86400 seconds.');
  const predicates = condition.op === 'predicate' ? [condition] : conditionFactsForValidation(condition);
  if (predicates.some(p => ['folder_new_file', 'browser_download'].includes(p.signal))) assert(holdSeconds === 0 && repeatSeconds === 0, 'File arrivals and download events need instant conditions and no repeat interval.');
  assert(raw.fireOnApproval === undefined || typeof raw.fireOnApproval === 'boolean', 'Approval trigger setting must be true or false.');
  const schedule = validateSchedule(raw.schedule);
  if (trigger) {
    assert(actions.every(a => a.type === 'notify'), 'Change monitors support notification actions only.');
    assert(holdSeconds === 0 && repeatSeconds === 0, 'Change monitors use settling time instead of hold or repeat.');
    assert(['always', 'window'].includes(schedule.mode), 'Change monitors run continuously or during a time window.');
    assert(!predicates.some(p => ['folder_new_file', 'browser_download'].includes(p.signal)), 'Use state conditions to filter change monitors, not arrival events.');
  }
  let incident;
  if (raw.incident) {
    assert(!trigger && repeatSeconds === 0 && actions.every(action => action.type === 'notify'), 'Incident monitors use notification actions, threshold conditions and no repeat interval.');
    const recoveryHoldSeconds = raw.incident.recoveryHoldSeconds ?? 5;
    assert(Number.isInteger(recoveryHoldSeconds) && recoveryHoldSeconds >= 0 && recoveryHoldSeconds <= 86400, 'Recovery hold must be 0 to 86400 seconds.');
    incident = { recoveryCondition: validateCondition(raw.incident.recoveryCondition), recoveryHoldSeconds, notifyRecovery: raw.incident.notifyRecovery !== false };
  }
  return { name, ...(raw.district ? { district: raw.district } : {}), ...(incident ? { incident } : {}), condition, action, actions, ...(trigger ? { trigger } : {}), holdSeconds, repeatSeconds, fireOnApproval: trigger ? false : raw.fireOnApproval !== false, schedule, policy: validatePolicy(raw.policy) };
}
function conditionFactsForValidation(c) { return c.op === 'predicate' ? [c] : c.children.flatMap(conditionFactsForValidation); }

function compare(actual, op, expected) {
  if (actual === null || actual === undefined) return null;
  if (op === 'contains') return String(actual).toLowerCase().includes(String(expected).toLowerCase());
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return null;
    return ({ eq: actual === expected, neq: actual !== expected, lt: actual < expected, lte: actual <= expected, gt: actual > expected, gte: actual >= expected })[op] ?? null;
  }
  const a = typeof actual === 'string' ? actual.toLowerCase() : actual;
  const b = typeof expected === 'string' ? expected.toLowerCase() : expected;
  return op === 'eq' ? a === b : op === 'neq' ? a !== b : null;
}

function evaluatePredicate(p, snapshot, now) {
  if (p.signal === 'always') return compare(true, p.comparator, p.value);
  if (!snapshot) return null;
  if (snapshot.Observations && ['cpu_percent', 'memory_percent', 'network_online', 'disk_free_percent', 'file_exists', 'folder_new_file', 'browser_download'].includes(p.signal)) {
    const at = require('./tiny-signal-freshness.cjs').observationAt(snapshot, p.signal, p.target);
    if (!at || now - at > (['network_online', 'disk_free_percent'].includes(p.signal) ? 45000 : 15000)) return null;
  }
  const windows = Array.isArray(snapshot.Windows) ? snapshot.Windows : [];
  const browsers = Array.isArray(snapshot.Browsers) ? snapshot.Browsers : [];
  const media = Array.isArray(snapshot.Media) ? snapshot.Media : [];
  let actual;
  if (p.signal === 'battery_percent') actual = snapshot.BatteryPercent;
  if (p.signal === 'on_ac') actual = snapshot.OnAcPower;
  if (p.signal === 'charging') actual = snapshot.Charging;
  if (p.signal === 'idle_seconds') actual = snapshot.Activity?.IdleSeconds;
  if (p.signal === 'volume_percent') actual = snapshot.Volume;
  if (p.signal === 'muted') actual = snapshot.Muted;
  if (p.signal === 'brightness_percent') actual = snapshot.Brightness;
  if (p.signal === 'active_seconds') actual = snapshot.Focus?.total;
  if (p.signal === 'app_active_seconds') actual = snapshot.Focus ? Object.entries(snapshot.Focus.apps).filter(([name]) => name.toLowerCase().includes(p.target.toLowerCase())).reduce((sum, [, seconds]) => sum + seconds, 0) : null;
  if (p.signal === 'fullscreen') actual = snapshot.Activity?.IsPresentationOrFullscreen;
  if (p.signal === 'network_online' || p.signal === 'cpu_percent' || p.signal === 'memory_percent') actual = snapshot.System?.[p.signal];
  if (p.signal === 'disk_free_percent') actual = snapshot.System?.disks?.[p.target.toUpperCase()];
  if (p.signal === 'file_exists') actual = snapshot.Files?.[p.target]?.error ? null : snapshot.Files?.[p.target]?.exists;
  if (p.signal === 'folder_new_file') {
    const entry = snapshot.Files?.[p.target];
    return !entry || entry.error ? null : entry.names.some(name => p.value === '*' || name.toLowerCase().includes(p.value.toLowerCase()));
  }
  if (p.signal === 'browser_download') return !snapshot.Downloads ? null : snapshot.Downloads.some(d => d.state === p.value && (!p.target || String(d.filename).toLowerCase().includes(p.target.toLowerCase())));
  if (p.signal === 'active_app') actual = windows.find(w => w.Active)?.App;
  if (p.signal === 'window_state') {
    if (!Array.isArray(snapshot.Windows)) return null;
    const matches = windows.filter(w => String(w.App || '').toLowerCase().includes(p.target.toLowerCase()));
    if (!matches.length) return false;
    const checks = matches.map(w => compare(w.State, p.comparator, p.value));
    return p.scope === 'all' ? checks.every(Boolean) : checks.some(Boolean);
  }
  if (p.signal === 'browser_tab' || p.signal === 'browser_video') {
    const selected = browsers.filter(b => !p.target || String(b.Name || '').toLowerCase().includes(p.target.toLowerCase()));
    if (!selected.length || selected.some(b => !Number.isFinite(Date.parse(b.SeenUtc)) || now - Date.parse(b.SeenUtc) > browserFreshMs)) return null;
    const entries = selected.flatMap(b => p.signal === 'browser_tab' ? b.Tabs || [] : b.Videos || []);
    const field = p.field;
    const expected = ['true', 'false'].includes(String(p.value).toLowerCase()) && field !== 'title' && field !== 'url' ? String(p.value).toLowerCase() === 'true' : p.value;
    return entries.some(item => compare(item[field], p.comparator, expected) === true);
  }
  if (p.signal === 'media_session') return !Array.isArray(snapshot.Media) ? null : media.some(item => compare(item[p.field === 'source' ? 'Source' : p.field === 'artist' ? 'Artist' : 'Title'], p.comparator, p.value) === true);
  return compare(actual, p.comparator, p.value);
}

function evaluate(condition, snapshot, now) {
  if (condition.op === 'predicate') return evaluatePredicate(condition, snapshot, now);
  const results = condition.children.map(child => evaluate(child, snapshot, now));
  if (condition.op === 'all') return results.includes(false) ? false : results.includes(null) ? null : true;
  return results.includes(true) ? true : results.includes(null) ? null : false;
}

function createTinyAgents(app, effects = {}) {
  const target = path.join(app.getPath('userData'), 'tiny-agents.json');
  let state = { version: 1, rules: [], history: [], focus: { day: '', total: 0, apps: {} } };
  try {
    const saved = readState(target);
    if (saved?.version === 1 && Array.isArray(saved.rules) && Array.isArray(saved.history)) {
      state = { version: 1, rules: [], history: saved.history.slice(-200), focus: saved.focus || state.focus, outbox: saved.outbox || [], signalCursor: saved.signalCursor || null };
      for (const rule of saved.rules) {
        try { state.rules.push({ ...rule, ...validateRule(rule), enabled: Boolean(rule.enabled) && !rule.draft }); }
        catch (error) { console.error('[Tiny Agents] Skipped invalid rule:', error.message); }
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') console.error('[Tiny Agents] Could not load rules:', error.message); }
  const runtime = new Map();
  let snapshot = null;
  let liveCursor = null;
  const nativeValues = new Map();
  let snapshotAt = 0;
  let shutdownPending = null;
  let timer = null, timerIntervalMs = null, engineStarted = false;
  let voiceActive = false;
  let sensorSnapshot = null, previousActivity = null, lastFocusPersist = 0;
  let generation = 0;
  const executions = new Map();
  let deliveryNow = Date.now(), storageError = null;
  const outbox = createOutbox({ state, persist, now: () => deliveryNow, notify: effects.notify, cancel: effects.cancelNotification,
    obsolete: (item, at) => {
      const rule = state.rules.find(r => r.id === item.ruleId);
      if (!rule) return 'The monitor was removed.';
      if (rule.policy.expiresAfterSeconds && at - (item.detectedAt ?? item.createdAt) >= rule.policy.expiresAfterSeconds * 1000) return 'Alert expired before delivery.';
      if (rule.policy.discardRecovered && !item.recovery && (rule.incident ? !rule.incidentState?.open : !rule.trigger && evaluate(rule.condition, effectiveSnapshot(at), at) === false)) return 'The condition recovered before delivery.';
      return '';
    },
    eligible: (item, at) => { const rule = state.rules.find(r => r.id === item.ruleId); return !!rule?.enabled && !rule.draft && !blocked(rule, at, effectiveSnapshot(at)); },
    changed: (item, status, message, detail = {}) => history('notification_' + status, state.rules.find(r => r.id === item.ruleId), message || 'Notification status updated.', { noticeId: item.id, title: item.title, body: item.body, attempt: item.attempt, deliveryMs: detail.deliveryMs, shownAt: item.shownAt }) });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function effectiveSnapshot(now) {
    const pc = snapshot && now - snapshotAt <= 10_000 ? snapshot : null;
    const sensor = sensorSnapshot && now - sensorSnapshot.at <= 15_000 ? sensorSnapshot : null;
    return { ...(pc || {}), ...(sensor || {}), PcObservedAt: pc ? snapshotAt : null, Focus: pc?.Activity ? state.focus : null };
  }
  function conditionFacts(condition, fresh, now) {
    if (condition.op !== 'predicate') return condition.children.flatMap(c => conditionFacts(c, fresh, now));
    const p = condition;
    const scalar = { battery_percent: fresh?.BatteryPercent, on_ac: fresh?.OnAcPower, charging: fresh?.Charging, idle_seconds: fresh?.Activity?.IdleSeconds, volume_percent: fresh?.Volume, muted: fresh?.Muted, brightness_percent: fresh?.Brightness,
      active_seconds: fresh?.Focus?.total, fullscreen: fresh?.Activity?.IsPresentationOrFullscreen, always: true,
      cpu_percent: fresh?.System?.cpu_percent, memory_percent: fresh?.System?.memory_percent, network_online: fresh?.System?.network_online,
      disk_free_percent: fresh?.System?.disks?.[p.target?.toUpperCase()], file_exists: fresh?.Files?.[p.target]?.exists,
      folder_new_file: fresh?.Files?.[p.target]?.names?.filter(name => p.value === '*' || name.toLowerCase().includes(p.value.toLowerCase())).join(', ').slice(0, 240),
      browser_download: fresh?.Downloads?.filter(d => d.state === p.value && (!p.target || d.filename.toLowerCase().includes(p.target.toLowerCase()))).map(d => path.basename(d.filename)).join(', ').slice(0, 240),
      app_active_seconds: fresh?.Focus ? Object.entries(fresh.Focus.apps).filter(([name]) => name.toLowerCase().includes(p.target.toLowerCase())).reduce((sum, [, seconds]) => sum + seconds, 0) : null };
    const result = evaluatePredicate(p, fresh, now);
    return [{ ...p, actual: scalar[p.signal] ?? (p.signal === 'active_app' ? fresh?.Windows?.find(w => w.Active)?.App : null), result, reason: result === null ? 'Signal is missing or stale.' : result ? 'Condition passes.' : 'Condition does not pass.' }];
  }
  function blocked(rule, now, fresh) {
    if (rule.snoozedUntil > now) return `Snoozed until ${new Date(rule.snoozedUntil).toISOString()}.`;
    const policy = rule.policy;
    const parts = localParts(now, rule.schedule.timezone);
    if (policy.quietHours.enabled && inWindow(parts.minute, policy.quietHours.start, policy.quietHours.end)) return 'Waiting for quiet hours to end.';
    if (policy.deferFullscreen && typeof fresh.Activity?.IsPresentationOrFullscreen !== 'boolean') return 'Waiting for presentation status.';
    if (policy.deferFullscreen && fresh.Activity?.IsPresentationOrFullscreen) return 'Waiting for fullscreen or presentation to end.';
    return '';
  }
  function preview(input, now = Date.now()) {
    const rule = typeof input === 'string' ? state.rules.find(r => r.id === input) : validateRule(input);
    assert(rule, 'Tiny agent not found.');
    const fresh = effectiveSnapshot(now), run = runtime.get(rule.id), schedule = scheduleState(rule.schedule, now, rule.lastScheduleKey);
    const today = localParts(now, rule.schedule.timezone).date;
    const used = rule.alertDay === today ? rule.alertCount || 0 : 0;
    if (rule.trigger) {
      // Preview uses copies so testing never consumes an event or advances a baseline.
      const copies = new Map([...(run?.watches || [])].map(([k, v]) => [k, structuredClone(v)]));
      const check = observe(rule.trigger, copies, fresh, now);
      const result = check.previews.every(w => w.actual === null) ? null : check.changes.length > 0 && evaluate(rule.condition, fresh, now) === true && schedule.allowed;
      return { result, conditions: conditionFacts(rule.condition, fresh, now), watches: rule.trigger.watches.map(w => {
        const r = reading(w, fresh), s = run?.watches?.get(`${w.signal}:${w.target || ''}`);
        return { ...w, actual: r.actual, baseline: s?.baseline ?? r.actual, pending: s?.changedAt != null, settleRemaining: s?.changedAt == null ? 0 : Math.max(0, rule.trigger.settleSeconds - (now - s.changedAt) / 1000) };
      }), reason: rule.pendingNotification ? 'Change summary waiting for delivery.' : !schedule.allowed ? 'Outside the monitoring window.' : result === null ? 'Watched signals are missing or stale.' : result ? 'Settled change detected.' : check.previews.some(w => w.pending) ? 'Waiting for changes to settle.' : 'Watching for a change.', holdRemaining: 0, nextRunAt: nextRun(rule.schedule, now), deferred: !!rule.pendingNotification, runsToday: used, focusDay: state.focus.day };
    }
    const reason = !schedule.allowed ? 'Outside the schedule or this occurrence already ran.' : blocked(rule, now, fresh) || (rule.policy.maxPerDay && used >= rule.policy.maxPerDay ? 'Daily run limit reached.' : '') || (rule.policy.cooldownSeconds && now - (rule.lastTriggeredAt || 0) < rule.policy.cooldownSeconds * 1000 ? 'Waiting for cooldown.' : '') || (evaluate(rule.condition, fresh, now) === true ? 'Conditions pass.' : 'Waiting for conditions.');
    return { result: evaluate(rule.condition, fresh, now), conditions: conditionFacts(rule.condition, fresh, now), reason: rule.pendingNotification ? `Notification pending. ${blocked(rule, now, fresh) || 'Ready for delivery.'}` : reason, holdRemaining: run?.since == null ? rule.holdSeconds : Math.max(0, rule.holdSeconds - (now - run.since) / 1000), nextRunAt: nextRun(rule.schedule, now, rule.lastScheduleKey), deferred: !!rule.pendingNotification, runsToday: used, focusDay: state.focus.day };
  }
  function persist() { try { writeState(target, state); storageError = null; syncTimer(); } catch (error) { storageError = error.message; throw error; } }
  function emit(kind, detail = {}) { effects.onChange?.({ kind, ...detail, ...(kind !== 'snapshot' ? { listing: list() } : {}) }); }
  function history(kind, rule, message, detail = {}) { state.history.push({ id: randomUUID(), kind, ruleId: rule?.id || null, ruleName: rule?.name || '', message, at: Date.now(), ...detail }); state.history = state.history.slice(-200); persist(); emit(kind, { ruleId: rule?.id }); }
  function list() { return { storageError, deliveries: (state.outbox || []).map(item => ({ ...item })), rules: state.rules.map(rule => ({ ...rule, executing: executions.has(rule.id), availability: runtime.get(rule.id)?.availability || 'waiting' })), history: state.history.slice().reverse(), shutdownPending: shutdownPending && { ruleId: shutdownPending.ruleId, endsAt: shutdownPending.endsAt } }; }
  function draft(input) {
    const clean = validateRule(input);
    const editing = cleanText(input?.id, 80);
    const old = editing ? state.rules.find(rule => rule.id === editing) : null;
    if (editing) assert(old, 'Tiny agent not found.');
    const now = Date.now();
    if (old) outbox.cancelRule(old.id);
    if (old && shutdownPending?.ruleId === old.id) cancelShutdown();
    const rule = { ...clean, id: old?.id || randomUUID(), createdAt: old?.createdAt || now, updatedAt: now, enabled: false, draft: true, lastTriggeredAt: old?.lastTriggeredAt || null };
    if (old) state.rules.splice(state.rules.indexOf(old), 1, rule); else state.rules.unshift(rule);
    runtime.delete(rule.id);
    history('draft', rule, old ? 'Changes ready for review.' : 'New tiny agent ready for review.');
    return { status: 'review_required', rule, message: 'Review this tiny agent, then approve it by voice or on the Tiny Agents page.' };
  }
  function approve(id) {
    const rule = state.rules.find(item => item.id === id);
    assert(rule && rule.draft, 'No draft needs approval.');
    validateRule(rule);
    rule.draft = false; rule.enabled = true; rule.updatedAt = Date.now();
    runtime.delete(id);
    // Explicit approval may notify about an already true condition. A restart,
    // resume, or shutdown rule still needs an observed false-to-true crossing.
    if (!rule.trigger && rule.fireOnApproval && rule.actions.every(a => a.type === 'notify')) runtime.set(id, { armed: true, since: null, lastFired: null, availability: 'waiting' });
    history('enabled', rule, 'Tiny agent approved and enabled.');
    tick();
    return list();
  }
  function setEnabled(id, enabled) {
    const rule = state.rules.find(item => item.id === id);
    assert(rule, 'Tiny agent not found.');
    assert(!rule.draft || !enabled, 'Review this draft before enabling it.');
    rule.enabled = Boolean(enabled); rule.updatedAt = Date.now(); runtime.delete(id);
    if (!enabled) { rule.pendingNotification = null; outbox.cancelRule(id); }
    if (!enabled && shutdownPending?.ruleId === id) cancelShutdown();
    history(enabled ? 'enabled' : 'paused', rule, enabled ? 'Tiny agent resumed.' : 'Tiny agent paused.');
    return list();
  }
  function remove(id) {
    const rule = state.rules.find(item => item.id === id);
    assert(rule, 'Tiny agent not found.');
    if (shutdownPending?.ruleId === id) cancelShutdown();
    outbox.cancelRule(id);
    state.rules = state.rules.filter(item => item.id !== id); runtime.delete(id);
    history('deleted', rule, 'Tiny agent deleted.');
    return list();
  }
  function pauseAll() { for (const rule of state.rules) { rule.enabled = false; rule.pendingNotification = null; runtime.delete(rule.id); outbox.cancelRule(rule.id); } cancelShutdown(); persist(); emit('paused_all'); return list(); }
  function snooze(id, seconds) {
    const rule = state.rules.find(r => r.id === id); assert(rule, 'Tiny agent not found.');
    assert(Number.isInteger(seconds) && seconds >= 0 && seconds <= 604800, 'Snooze must be 0 to 604800 seconds.');
    rule.snoozedUntil = seconds ? Date.now() + seconds * 1000 : null;
    if (shutdownPending?.ruleId === id) cancelShutdown();
    history('snoozed', rule, seconds ? `Snoozed for ${seconds / 60} minutes.` : 'Snooze cleared.');
    return list();
  }
  function duplicate(id) { const rule = state.rules.find(r => r.id === id); assert(rule, 'Tiny agent not found.'); return draft({ ...rule, id: undefined, name: `${rule.name.slice(0, 73)} (copy)` }); }
  function cancelShutdown() {
    if (!shutdownPending) return false;
    const pending = shutdownPending; shutdownPending = null;
    const rule = state.rules.find(item => item.id === pending.ruleId);
    history('shutdown_cancelled', rule, 'Pending shutdown cancelled.');
    return true;
  }
  function runAction(rule, now, observedTrace) {
    rule.lastTriggeredAt = now;
    const notificationOnly = rule.actions.every(a => a.type === 'notify');
    if (notificationOnly) for (const action of rule.actions) outbox.enqueue(rule.name, action.message || rule.name, { ruleId: rule.id, kind: 'notify' });
    const trace = observedTrace || conditionFacts(rule.condition, effectiveSnapshot(now), now);
    history('triggered', rule, rule.action.type === 'notify' ? 'Condition met; notification requested.' : 'Conditions met; action sequence started.', { trace });
    if (notificationOnly) { outbox.pump(); return; }
    const run = runtime.get(rule.id), epoch = generation;
    const work = (async () => {
      let waited = false;
      for (const [index, action] of rule.actions.entries()) {
        if (epoch !== generation || state.rules.find(r => r.id === rule.id) !== rule || !rule.enabled || runtime.get(rule.id) !== run) return;
        try {
          if (action.type === 'notify') requestNotification(rule.name, action.message || rule.name, { ruleId: rule.id, kind: 'notify' });
          else if (action.type === 'shutdown') {
            const actionNow = waited ? Date.now() : now;
            if (evaluate(rule.condition, effectiveSnapshot(actionNow), actionNow) !== true || blocked(rule, actionNow, effectiveSnapshot(actionNow))) throw new Error('Shutdown condition is no longer available or true.');
            if (shutdownPending) throw new Error('Another shutdown countdown is already running.');
            shutdownPending = { ruleId: rule.id, endsAt: actionNow + 30_000 };
            requestNotification('Shutdown in 30 seconds', `${rule.name}. You can cancel this countdown.`, { ruleId: rule.id, kind: 'shutdown', endsAt: shutdownPending.endsAt });
            emit('shutdown_pending', { ruleId: rule.id, endsAt: shutdownPending.endsAt });
          } else {
            if (!effects.executeAction) throw new Error('This action is unavailable.');
            await effects.executeAction(action);
            waited = true;
            history('action_completed', rule, `Action ${index + 1}: ${action.type} completed.`);
          }
        } catch (error) { history('action_failed', rule, `Action ${index + 1}: ${error.message}`); return; }
      }
    })();
    if (rule.actions.some(a => !['notify', 'shutdown'].includes(a.type))) {
      executions.set(rule.id, work);
      emit('execution_started', { ruleId: rule.id });
      void work.finally(() => { if (executions.get(rule.id) === work) { executions.delete(rule.id); emit('execution_finished', { ruleId: rule.id }); } });
    }
  }
  function notificationStatus(value) {
    try {
      if (value.kind !== 'shutdown' && state.outbox?.some(i => i.id === value.id)) { outbox.status(value); return; }
      history('notification_' + value.status, state.rules.find(item => item.id === value.ruleId), value.message || 'Notification status updated.', { noticeId: value.id, title: value.title, body: value.body });
    } catch (error) {
      if (!storageError) throw error;
      emit('storage_error', { message: 'Notification confirmation could not be saved: ' + storageError });
    }
  }
  function requestNotification(title, body, meta) {
    if (meta.kind !== 'shutdown') { outbox.enqueue(title, body, meta); persist(); outbox.pump(); return; }
    try { effects.notify?.(title, body, meta); }
    catch (error) { notificationStatus({ ...meta, status: 'failed', message: error.message }); }
  }
  function retryNotification(id) { outbox.retry(id); return list(); }
  function tickChange(rule, fresh, now) {
    let run = runtime.get(rule.id);
    if (!run) { run = { watches: new Map(), availability: 'waiting' }; runtime.set(rule.id, run); }
    const observed = observe(rule.trigger, run.watches, fresh, now);
    const availability = observed.previews.every(w => w.actual === null) ? 'unavailable' : 'ready';
    if (availability !== run.availability) { run.availability = availability; emit('availability', { ruleId: rule.id }); }
    const scheduled = scheduleState(rule.schedule, now);
    if (observed.changes.length && scheduled.allowed && evaluate(rule.condition, fresh, now) === true) {
      const prior = rule.pendingNotification;
      rule.pendingNotification = { at: prior?.at ?? now, changes: mergeChanges(prior?.changes, observed.changes), trace: conditionFacts(rule.condition, fresh, now) };
      persist();
    }
    if (!rule.pendingNotification) return;
    if (rule.policy.expiresAfterSeconds && now - rule.pendingNotification.at >= rule.policy.expiresAfterSeconds * 1000) { rule.pendingNotification = null; run.deferred = false; history('notification_expired', rule, 'Change summary expired before delivery.'); return; }
    const today = localParts(now, rule.schedule.timezone).date;
    const wait = !scheduled.allowed ? 'Waiting for the monitoring window.' : blocked(rule, now, fresh) ||
      (rule.policy.maxPerDay && rule.alertDay === today && rule.alertCount >= rule.policy.maxPerDay ? 'Daily run limit reached.' : '') ||
      (rule.policy.cooldownSeconds && rule.lastTriggeredAt != null && now - rule.lastTriggeredAt < rule.policy.cooldownSeconds * 1000 ? 'Waiting for cooldown.' : '');
    if (wait) { if (!run.deferred) { run.deferred = true; history('deferred', rule, wait, { changes: rule.pendingNotification.changes }); } return; }
    const pending = rule.pendingNotification;
    rule.pendingNotification = null; run.deferred = false; rule.lastTriggeredAt = now;
    if (rule.alertDay !== today) { rule.alertDay = today; rule.alertCount = 0; }
    rule.alertCount = (rule.alertCount || 0) + 1;
    const summary = formatChanges(pending.changes);

    for (const action of rule.actions) outbox.enqueue(rule.name, `${action.message ? `${action.message}\n` : ''}${summary}\nDetected ${new Date(Math.max(...pending.changes.map(c => c.at))).toLocaleString()}`, { ruleId: rule.id, kind: 'notify', changes: pending.changes, settledAt: now, detectedAt: pending.at });
    history('triggered', rule, summary, { changes: pending.changes, trace: pending.trace, detectedAt: Math.max(...pending.changes.map(c => c.at)) });
    outbox.pump();
  }
  function tick(now = Date.now()) {
    try { tickInternal(now); }
    catch (error) {
      if (!storageError) throw error;
      emit('storage_error', { message: 'Notifications cannot be saved: ' + storageError });
    }
  }
  function tickIncident(rule, fresh, now) {
    let run = runtime.get(rule.id);
    if (!run) { run = { since: null, recoverySince: null, availability: 'waiting' }; runtime.set(rule.id, run); }
    const open = rule.incidentState?.open === true;
    const entryValue = evaluate(rule.condition, fresh, now);
    const value = open ? entryValue === null ? null : entryValue === true ? false : evaluate(rule.incident.recoveryCondition, fresh, now) : entryValue;
    const availability = value === null ? 'unavailable' : 'ready';
    if (run.availability !== availability) { run.availability = availability; emit('availability', { ruleId: rule.id }); }
    const field = open ? 'recoverySince' : 'since';
    if (!scheduleState(rule.schedule, now).allowed || value !== true) { run[field] = null; return; }
    if (run[field] == null) run[field] = now;
    if (now - run[field] < (open ? rule.incident.recoveryHoldSeconds : rule.holdSeconds) * 1000) return;
    if (!open) {
      const today = localParts(now, rule.schedule.timezone).date;
      if (rule.policy.maxPerDay && rule.alertDay === today && rule.alertCount >= rule.policy.maxPerDay || rule.policy.cooldownSeconds && rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.policy.cooldownSeconds * 1000) return;
      rule.incidentState = { id: randomUUID(), open: true, enteredAt: now };
      rule.lastTriggeredAt = now;
      if (rule.alertDay !== today) { rule.alertDay = today; rule.alertCount = 0; } rule.alertCount++;
    } else { rule.incidentState.open = false; rule.incidentState.recoveredAt = now; }
    run.since = null; run.recoverySince = null;
    if (!open || rule.incident.notifyRecovery) for (const action of rule.actions) outbox.enqueue(rule.name, `${open ? 'Recovered' : 'Incident detected'}: ${action.message || rule.name}`, { ruleId: rule.id, incidentId: rule.incidentState.id, recovery: open, detectedAt: now });
    history(open ? 'incident_recovered' : 'incident_entered', rule, open ? 'Observed recovery passed its sustained check.' : 'Observed incident passed its sustained check.', { incident: rule.incidentState, trace: conditionFacts(open ? rule.incident.recoveryCondition : rule.condition, fresh, now) });
    outbox.pump(now);
  }
  function tickInternal(now) {
    deliveryNow = now;
    if (storageError) { persist(); emit('storage_recovered'); }
    outbox.pump(now);
    const fresh = effectiveSnapshot(now);
    if (shutdownPending) {
      const sourceRule = state.rules.find(item => item.id === shutdownPending.ruleId);
      if (!sourceRule?.enabled || blocked(sourceRule, now, fresh) || evaluate(sourceRule.condition, fresh, now) !== true) cancelShutdown();
    }
    if (shutdownPending && now >= shutdownPending.endsAt) {
      const pending = shutdownPending; shutdownPending = null;
      const rule = state.rules.find(item => item.id === pending.ruleId);
      if (rule?.enabled) { history('shutdown', rule, 'Shutdown requested.'); effects.shutdown?.(); }
    }
    for (const rule of state.rules) {
      if (!rule.enabled || rule.draft) continue;
      if (rule.incident) { tickIncident(rule, fresh, now); continue; }
      if (rule.trigger) { tickChange(rule, fresh, now); continue; }
      let run = runtime.get(rule.id);
      let scheduled = scheduleState(rule.schedule, now, rule.lastScheduleKey);
      if (run?.scheduleCandidate && run.since !== null && rule.lastScheduleKey !== run.scheduleCandidate) scheduled = { allowed: true, key: run.scheduleCandidate };
      const value = scheduled.allowed ? evaluate(rule.condition, fresh, now) : false;
      if (!run) {
        run = { armed: ['daily', 'once'].includes(rule.schedule.mode), since: null, lastFired: null, deferred: !!rule.pendingNotification, availability: value === null ? 'unavailable' : 'ready' }; runtime.set(rule.id, run);
        if (value === false) run.armed = true;
        emit('availability', { ruleId: rule.id });
        if ((!run.armed || value !== true) && !run.deferred) continue;
      }
      const availability = value === null ? 'unavailable' : 'ready';
      if (run.availability !== availability) { run.availability = availability; emit('availability', { ruleId: rule.id }); }
      const blockedReason = blocked(rule, now, fresh);
      if (rule.pendingNotification && (rule.policy.expiresAfterSeconds && now - rule.pendingNotification.at >= rule.policy.expiresAfterSeconds * 1000 || rule.policy.discardRecovered && value === false)) {
        rule.pendingNotification = null; run.deferred = false; history('notification_expired', rule, 'Pending alert expired or recovered before delivery.');
      }
      if (run.deferred && !blockedReason && !executions.has(rule.id)) { const trace = rule.pendingNotification?.trace; run.deferred = false; rule.pendingNotification = null; runAction(rule, now, trace); }
      if (run.deferred) continue;
      if (value === false) { run.armed = true; run.since = null; run.scheduleCandidate = null; continue; }
      if (value === null) { run.since = null; run.scheduleCandidate = null; continue; }
      // Event collectors keep a short-lived payload. Each event is consumed once,
      // and a new arrival can fire even while the previous payload is still true.
      const facts = conditionFacts(rule.condition, fresh, now);
      const events = facts.filter(p => p.result === true && ['folder_new_file', 'browser_download'].includes(p.signal)).map(p => ({ key: `${p.signal}:${p.target}:${p.value}`, sequence: p.signal === 'folder_new_file' ? fresh.Files?.[p.target]?.sequence : Math.max(...(fresh.Downloads || []).filter(d => d.state === p.value && (!p.target || d.filename.toLowerCase().includes(p.target.toLowerCase()))).map(d => d.sequence)) }));
      run.consumedEvents ||= new Map();
      if (events.length) {
        if (!events.some(e => e.sequence > (run.consumedEvents.get(e.key) || 0))) continue;
        run.armed = true;
      }
      if (!run.armed) continue;
      if (run.since === null) run.since = now;
      if (scheduled.key) run.scheduleCandidate = scheduled.key;
      if (now - run.since < rule.holdSeconds * 1000) continue;
      if (run.lastFired !== null && rule.repeatSeconds && now - run.lastFired < rule.repeatSeconds * 1000) continue;
      if (executions.has(rule.id)) continue;
      const today = localParts(now, rule.schedule.timezone).date;
      if (rule.policy.maxPerDay && rule.alertDay === today && rule.alertCount >= rule.policy.maxPerDay) continue;
      if (rule.policy.cooldownSeconds && rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.policy.cooldownSeconds * 1000) continue;
      if (blockedReason && !rule.actions.every(a => a.type === 'notify')) continue;
      run.lastFired = now;
      if (!rule.repeatSeconds) run.armed = false;
      for (const event of events) run.consumedEvents.set(event.key, event.sequence);
      if (scheduled.key) rule.lastScheduleKey = scheduled.key;
      run.scheduleCandidate = null;
      if (rule.alertDay !== today) { rule.alertDay = today; rule.alertCount = 0; }
      rule.alertCount = (rule.alertCount || 0) + 1;
      if (blockedReason) {
        rule.lastTriggeredAt = now;
        rule.pendingNotification = { at: now, trace: facts };
        if (!run.deferred) { run.deferred = true; history('deferred', rule, blockedReason); }
      } else runAction(rule, now);
    }
  }
  function ingest(next, now = Date.now(), observedAt = now) {
    const day = localParts(now, zone).date;
    if (state.focus.day !== day) { state.focus = { day, total: 0, apps: {} }; previousActivity = null; }
    if (next?.Activity && now - observedAt <= 10000) {
      const active = !next.Activity.IsIdle && next.Activity.IdleSeconds < 60 && !/not.?present|locked|away/i.test(next.Activity.NotificationState || '');
      const appName = next.Windows?.find(w => w.Active)?.App || '';
      const seconds = previousActivity?.active && active && now - previousActivity.at <= 10000 ? Math.max(0, (now - previousActivity.at) / 1000) : 0;
      state.focus.total = Math.min(86400, state.focus.total + seconds);
      if (previousActivity?.app && seconds) state.focus.apps[previousActivity.app] = (state.focus.apps[previousActivity.app] || 0) + seconds;
      previousActivity = { active, app: appName, at: now };
      if (now - lastFocusPersist >= 30000) { lastFocusPersist = now; persist(); }
    } else previousActivity = null;
    const capture = consumeEvents(next?.SignalEvents, liveCursor, Math.min(now, observedAt));
    liveCursor = capture.cursor;
    state.signalCursor = capture.cursor;
    if (capture.baseline) {
      nativeValues.clear();
      for (const run of runtime.values()) if (run.watches) for (const key of [...run.watches.keys()]) if (Object.hasOwn(nativeFields, key.split(':')[0])) run.watches.delete(key);
    }
    if (capture.gap) history('capture_gap', null, capture.gap);
    for (const event of capture.events) {
      if (next.SignalSources?.[event.Signal] !== event.Device) continue; // Old endpoint callbacks cannot update its replacement.
      nativeValues.set(event.Signal, event);
      for (const rule of state.rules) {
        if (!rule.enabled || rule.draft || !rule.trigger || !runtime.get(rule.id)?.watches) continue;
        const watches = rule.trigger.watches.filter(w => w.signal === event.Signal);
        if (!watches.length) continue;
        const eventFresh = { ...next, [nativeFields[event.Signal]]: event.Value, PcObservedAt: event.observedAt, ...(event.Signal === 'volume_percent' ? { VolumePrecise: event.Value } : {}) };
        observe({ ...rule.trigger, watches }, runtime.get(rule.id).watches, eventFresh, event.observedAt, { settle: false, receiptAt: event.ReceiptUtcMs, origin: 'native', context: event.Context, sequence: event.Sequence });
      }
    }
    snapshot = { ...next };
    for (const [signal, event] of nativeValues) {
      const field = nativeFields[signal], polled = signal === 'volume_percent' ? next?.VolumePrecise ?? next?.Volume : next?.[field];
      const pollAt = next?.SignalPollMonotonicMs?.[signal];
      const reconciled = Number.isFinite(pollAt) ? pollAt > event.MonotonicMs && polled !== event.Value : signal === 'muted' ? polled !== event.Value : polled !== Math.round(event.Value);
      if (next?.SignalSources?.[signal] !== event.Device || reconciled) nativeValues.delete(signal);
      else { snapshot[field] = event.Value; if (signal === 'volume_percent') snapshot.VolumePrecise = event.Value; }
    }
    snapshotAt = Math.min(now, observedAt); tick(now);
    if ((capture.events.length || capture.baseline) && state.rules.some(rule=>rule.enabled&&!rule.draft)) persist(); emit('snapshot');
  }
  function ingestSensors(next, now = Date.now()) { sensorSnapshot = next; tick(now); }
  function reset() { snapshot = null; liveCursor = null; nativeValues.clear(); snapshotAt = 0; sensorSnapshot = null; previousActivity = null; runtime.clear(); generation++; cancelShutdown(); emit('reset'); }
  function syncTimer() {
    const hasBackgroundWork = shutdownPending || executions.size || state.rules.some(rule => rule.enabled && !rule.draft);
    const intervalMs = !engineStarted || !hasBackgroundWork ? null : voiceActive ? 250 : 5000;
    if (timer && intervalMs === timerIntervalMs) return;
    if (timer) clearInterval(timer);
    timer = intervalMs ? setInterval(() => tick(), intervalMs) : null;
    timerIntervalMs = intervalMs;
  }
  function setVoiceActive(active) { voiceActive = active === true; syncTimer(); }
  function start() { engineStarted = true; syncTimer(); }
  function stop() { engineStarted = false; shutdownPending = null; generation++; syncTimer(); persist(); }
  return { list, getSnapshot: () => structuredClone(effectiveSnapshot(Date.now())), draft, approve, setEnabled, remove, pauseAll, cancelShutdown, ingest, ingestSensors, tick, reset, start, stop, setVoiceActive, validateRule, evaluate, preview, snooze, duplicate, notificationStatus, retryNotification, waitForActions: id => id ? executions.get(id) ?? Promise.resolve() : Promise.all(executions.values()) };
}

module.exports = { createTinyAgents, validateRule, validateCondition, evaluate };
