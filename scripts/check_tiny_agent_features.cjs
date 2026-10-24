const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTinyAgents, validateRule } = require('../electron/tiny-agents.cjs');
const { validateSchedule, scheduleState, nextRun } = require('../electron/tiny-agent-options.cjs');
const { createTinyAgentSensors } = require('../electron/tiny-agent-sensors.cjs');
const base = Date.parse('2026-10-01T06:00:00Z');
function rule(signal = 'battery_percent', value = 80, extra = {}) { return { name: 'Fixture', condition: { op: 'predicate', signal, comparator: typeof value === 'number' ? 'gte' : 'eq', value }, action: { type: 'notify', message: 'Fixture alert' }, ...extra }; }
function pc(changes = {}) { return { BatteryPercent: 20, Windows: [{ App: 'editor', Active: true }], Activity: { IdleSeconds: 0, IsIdle: false, IsPresentationOrFullscreen: false, NotificationState: 'Normal' }, ...changes }; }
function fixture(effects = {}) {
  if (effects.notify) { const syncNotify = effects.notify; effects = { ...effects, notify: (...args) => { syncNotify(...args); return { status: 'shown' }; } }; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-features-'));
  const app = { getPath: () => dir };
  const engine = createTinyAgents(app, effects);
  return { engine, dir, reopen: () => createTinyAgents(app, effects), close() { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); } };
}
function add(engine, input) { const id = engine.draft(input).rule.id; engine.approve(id); return id; }
test('daily schedule uses the selected timezone and survives restart without duplicate runs', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    add(f.engine, rule('always', true, { schedule: { mode: 'daily', start: '12:00', timezone: 'Asia/Dhaka', days: [4] } }));
    f.engine.tick(base); f.engine.tick(base + 1000); assert.equal(fired, 1);
    f.reopen().tick(base + 2000); assert.equal(fired, 1);
    assert.equal(scheduleState(validateSchedule({ mode: 'daily', start: '12:00', timezone: 'Asia/Dhaka', days: [4] }), base).allowed, true);
  } finally { f.close(); }
});
test('missed schedules catch up only when configured; overnight windows use the starting weekday', () => {
  const skip = validateSchedule({ mode: 'daily', start: '09:00', timezone: 'UTC', days: [4] });
  assert.equal(scheduleState(skip, Date.parse('2026-10-01T10:00:00Z')).allowed, false);
  assert.equal(scheduleState({ ...skip, missed: 'catch_up' }, Date.parse('2026-10-01T10:00:00Z')).allowed, true);
  const window = validateSchedule({ mode: 'window', start: '22:00', end: '06:00', days: [4], timezone: 'UTC' });
  assert.equal(scheduleState(window, Date.parse('2026-10-02T02:00:00Z')).allowed, true);
  assert.equal(scheduleState(window, Date.parse('2026-10-01T02:00:00Z')).allowed, false);
  assert.equal(nextRun(skip, base), Date.parse('2026-10-01T09:00:00Z'));
});
test('once reminders can run without PC data and persist their occurrence key', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try { add(f.engine, rule('always', true, { schedule: { mode: 'once', at: base, timezone: 'UTC', missed: 'catch_up' } })); f.engine.tick(base); f.reopen().tick(base + 5000); assert.equal(fired, 1); } finally { f.close(); }
});
test('live condition testing reports values and hold progress without executing or writing', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const input = rule('battery_percent', 80, { holdSeconds: 30 }); const id = add(f.engine, input);
    f.engine.ingest(pc({ BatteryPercent: 85 }), base); const before = fs.readFileSync(path.join(f.dir, 'tiny-agents.json'), 'utf8');
    const preview = f.engine.preview(id, base + 5000); assert.equal(preview.conditions[0].actual, 85); assert.equal(preview.holdRemaining, 25); assert.equal(fired, 0);
    f.engine.preview(input, base + 5000); assert.equal(fs.readFileSync(path.join(f.dir, 'tiny-agents.json'), 'utf8'), before);
  } finally { f.close(); }
});
test('resuming publishes ready availability on its first snapshot', () => {
  const events = []; const f = fixture({ onChange: e => events.push(e) });
  try { const id = add(f.engine, rule()); f.engine.setEnabled(id, false); f.engine.setEnabled(id, true); events.length = 0; f.engine.ingest(pc(), base); assert.ok(events.some(e => e.kind === 'availability' && e.listing.rules[0].availability === 'ready')); } finally { f.close(); }
});
test('quiet hours queue one notification and retain its original explanation through restart', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const input = rule('battery_percent', 80, { policy: { quietHours: { enabled: true, start: '22:00', end: '08:00' } }, schedule: { mode: 'always', timezone: 'UTC' } });
    const id = add(f.engine, input); const night = Date.parse('2026-10-01T23:00:00Z');
    f.engine.ingest(pc({ BatteryPercent: 90 }), night); f.engine.ingest(pc({ BatteryPercent: 91 }), night + 1000); assert.equal(fired, 0);
    assert.equal(f.engine.preview(id, night).deferred, true);
    const restarted = f.reopen(); restarted.tick(Date.parse('2026-10-02T08:00:00Z')); assert.equal(fired, 1);
    assert.equal(restarted.list().history.find(e => e.kind === 'triggered').trace[0].actual, 90);
    restarted.tick(Date.parse('2026-10-02T08:00:01Z')); assert.equal(fired, 1);
  } finally { f.close(); }
});
test('presentation deferral waits for reliable data and pause cancels a pending alert', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = add(f.engine, rule('always', true, { policy: { deferFullscreen: true } }));
    f.engine.ingest(pc({ Activity: { IsPresentationOrFullscreen: true } }), base); assert.equal(fired, 0);
    f.engine.ingest(pc(), base + 1000); assert.equal(fired, 1);
    const second = add(f.engine, rule('battery_percent', 80, { policy: { deferFullscreen: true } }));
    f.engine.ingest(pc({ BatteryPercent: 90, Activity: { IsPresentationOrFullscreen: true } }), base + 2000); f.engine.setEnabled(second, false);
    f.engine.ingest(pc(), base + 3000); assert.equal(fired, 1); assert.equal(f.engine.preview(id, base + 3000).deferred, false);
  } finally { f.close(); }
});
test('snooze persists and clearing snooze delivers a queued notification once', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try { const id = add(f.engine, rule()); f.engine.snooze(id, 1800); f.engine.ingest(pc({ BatteryPercent: 90 }), Date.now()); assert.equal(fired, 0); const restarted = f.reopen(); assert.ok(restarted.list().rules[0].snoozedUntil > Date.now()); restarted.snooze(id, 0); restarted.tick(); assert.equal(fired, 1); } finally { f.close(); }
});
test('daily run limits and cooldown persist across restart and reset by local day', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    add(f.engine, rule('battery_percent', 80, { policy: { maxPerDay: 1 }, schedule: { mode: 'always', timezone: 'UTC' } }));
    f.engine.ingest(pc({ BatteryPercent: 90 }), base); f.engine.ingest(pc(), base + 1000); f.engine.ingest(pc({ BatteryPercent: 90 }), base + 2000); assert.equal(fired, 1);
    const restarted = f.reopen(); restarted.ingest(pc(), base + 3000); restarted.ingest(pc({ BatteryPercent: 90 }), base + 4000); assert.equal(fired, 1);
    restarted.ingest(pc(), base + 86400000); restarted.ingest(pc({ BatteryPercent: 90 }), base + 86401000); assert.equal(fired, 2);
  } finally { f.close(); }
});
test('active-use totals exclude idle, locked and sleep gaps; totals survive restart', () => {
  const f = fixture();
  try {
    const id = add(f.engine, rule('active_seconds', 100));
    f.engine.ingest(pc(), base); f.engine.ingest(pc(), base + 5000);
    f.engine.ingest(pc({ Activity: { IsIdle: true, IdleSeconds: 90 } }), base + 10000);
    f.engine.ingest(pc(), base + 15000); f.engine.ingest(pc({ Activity: { IsIdle: false, IdleSeconds: 0, NotificationState: 'Not Present (Locked/Away)' } }), base + 20000);
    f.engine.ingest(pc(), base + 25000); f.engine.ingest(pc(), base + 60000);
    assert.equal(f.engine.preview(id, base + 60000).conditions[0].actual, 5);
    const restarted = f.reopen(); restarted.ingest(pc(), base + 61000); assert.equal(restarted.preview(id, base + 61000).conditions[0].actual, 5);
    const nextDay = base + 86400000; restarted.ingest(pc(), nextDay); assert.equal(restarted.preview(id, nextDay).conditions[0].actual, 0);
  } finally { f.close(); }
});
test('duplicate creates an independent draft with the same schedule/actions and no activation', () => {
  const f = fixture();
  try { const id = add(f.engine, rule()); const copy = f.engine.duplicate(id).rule; assert.notEqual(copy.id, id); assert.equal(copy.draft, true); assert.equal(copy.enabled, false); assert.deepEqual(copy.condition, f.engine.list().rules.find(r => r.id === id).condition); } finally { f.close(); }
});
test('ordered actions stop after a failure and do not reach shutdown', async () => {
  const calls = []; const f = fixture({ notify: () => calls.push('notify'), executeAction: async a => { calls.push(a.type); throw new Error('Missing app'); }, shutdown: () => calls.push('shutdown') });
  try {
    add(f.engine, rule('battery_percent', 80, { actions: [{ type: 'notify' }, { type: 'focus_app', target: 'missing' }, { type: 'shutdown' }] }));
    f.engine.ingest(pc(), base); f.engine.ingest(pc({ BatteryPercent: 90 }), base + 1000); await f.engine.waitForActions();
    assert.deepEqual(calls, ['notify', 'focus_app']); assert.equal(f.engine.list().shutdownPending, null); assert.ok(f.engine.list().history.some(e => e.kind === 'action_failed'));
  } finally { f.close(); }
});
test('pausing during an asynchronous action prevents subsequent actions', async () => {
  let release, notified = 0; const f = fixture({ executeAction: () => new Promise(r => { release = r; }), notify: () => notified++ });
  try { const id = add(f.engine, rule('battery_percent', 80, { actions: [{ type: 'open_url', target: 'https://example.com' }, { type: 'notify' }] })); f.engine.ingest(pc(), base); f.engine.ingest(pc({ BatteryPercent: 90 }), base + 1000); f.engine.setEnabled(id, false); release(); await f.engine.waitForActions(); assert.equal(notified, 0); } finally { f.close(); }
});
test('download and folder payloads are consumed once; distinct new events can fire immediately', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = add(f.engine, rule('browser_download', 'complete'));
    const payload = n => ({ at: base + n*1000, Downloads: [{ id: n, state: 'complete', filename: 'test.pdf', sequence: n }], System: {}, Files: {} });
    f.engine.ingestSensors(payload(1), base + 1000); f.engine.ingestSensors(payload(1), base + 2000); assert.equal(fired, 1);
    f.engine.ingestSensors(payload(2), base + 3000); assert.equal(fired, 2);
    assert.equal(f.engine.preview(id, base + 30000).result, null);
  } finally { f.close(); }
});
test('system health measurements evaluate independently of stale PC data', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = add(f.engine, rule('cpu_percent', 90));
    f.engine.ingestSensors({ at: base, System: { cpu_percent: 95, memory_percent: 60, network_online: true, disks: { 'C:': 5 } }, Files: {} }, base);
    assert.equal(fired, 1); assert.equal(f.engine.preview(id, base).conditions[0].actual, 95); assert.equal(f.engine.preview(id, base + 16000).result, null);
  } finally { f.close(); }
});
test('validation rejects unsafe URLs, malformed schedules, nonfinal shutdown, and event hold/repeats', () => {
  assert.throws(() => validateRule(rule('always', true, { actions: [{ type: 'open_url', target: 'javascript:alert(1)' }] })), /http/);
  assert.throws(() => validateRule(rule('always', true, { actions: [{ type: 'shutdown' }, { type: 'notify' }] })), /final/);
  assert.throws(() => validateRule(rule('always', true, { schedule: { mode: 'daily', start: '25:01', timezone: 'UTC' } })), /HH:MM/);
  assert.throws(() => validateRule(rule('browser_download', 'complete', { holdSeconds: 20 })), /instant/);
});
test('file and download collectors ignore baseline entries and expose new transitions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-sensor-fixture-'));
  fs.writeFileSync(path.join(dir, 'old.pdf'), 'old'); let result, state = 'in_progress';
  const folder = rule('folder_new_file', '.pdf'); folder.condition.comparator = 'contains'; folder.condition.target = dir;
  const sensors = createTinyAgentSensors({ listRules: () => [{ ...folder, enabled: true }, { ...rule('browser_download', 'complete'), enabled: true }], observeDownloads: async () => ({ status: 'ok', observation: { items: [{ id: 1, state, filename: 'test.pdf' }] } }), onUpdate: x => { result = x; } });
  try {
    await sensors.start(); assert.deepEqual(result.Files[dir].names, []); assert.deepEqual(result.Downloads, []);
    fs.writeFileSync(path.join(dir, 'new.pdf'), 'new'); state = 'complete'; await sensors.sample();
    assert.deepEqual(result.Files[dir].names, []); await sensors.sample();
    assert.deepEqual(result.Files[dir].names, ['new.pdf']); assert.equal(result.Downloads.length, 1); const sequence = result.Downloads[0].sequence;
    await sensors.sample(); assert.equal(result.Downloads.length, 1); assert.equal(result.Downloads[0].sequence, sequence);
  } finally { sensors.stop(); fs.unlinkSync(path.join(dir, 'old.pdf')); if (fs.existsSync(path.join(dir, 'new.pdf'))) fs.unlinkSync(path.join(dir, 'new.pdf')); fs.rmdirSync(dir); }
});
test('a scheduled hold can complete after the scheduled minute ends', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try { add(f.engine, rule('always', true, { holdSeconds: 120, schedule: { mode: 'daily', start: '06:00', timezone: 'UTC', days: [4] } })); f.engine.tick(base); f.engine.tick(base + 60000); assert.equal(fired, 0); f.engine.tick(base + 120000); assert.equal(fired, 1); } finally { f.close(); }
});
test('returned-network rules establish a baseline instead of announcing existing connectivity', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try { add(f.engine, rule('network_online', true, { fireOnApproval: false })); const update = (online, now) => f.engine.ingestSensors({ at: now, System: { network_online: online } }, now); update(true, base); assert.equal(fired, 0); update(false, base + 1000); update(true, base + 2000); assert.equal(fired, 1); } finally { f.close(); }
});
test('unavailable window data never arms a shutdown crossing', () => {
  const f = fixture();
  try { add(f.engine, rule('window_state', 'minimized', { condition: { op: 'predicate', signal: 'window_state', comparator: 'eq', value: 'minimized', target: 'editor' }, action: { type: 'shutdown' } })); f.engine.tick(base); f.engine.ingest({ Windows: [{ App: 'editor', State: 'minimized' }] }, base + 1000); assert.equal(f.engine.list().shutdownPending, null); } finally { f.close(); }
});
test('cooldown applies across crossings and restarting the engine', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try { add(f.engine, rule('battery_percent', 80, { policy: { cooldownSeconds: 60 } })); f.engine.ingest(pc({ BatteryPercent: 90 }), base); const restarted = f.reopen(); restarted.ingest(pc(), base + 1000); restarted.ingest(pc({ BatteryPercent: 90 }), base + 2000); assert.equal(fired, 1); restarted.ingest(pc({ BatteryPercent: 90 }), base + 61000); assert.equal(fired, 2); } finally { f.close(); }
});
test('templates and natural-language tools produce valid extended drafts', () => {
  const Module = require('node:module'), esbuild = require('esbuild');
  const compile = file => { const built = esbuild.buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }); const m = new Module(__filename); m._compile(built.outputFiles[0].text, __filename); return m.exports; };
  const { templates } = compile('src/tinyAgentCatalog.ts');
  for (const t of templates) { const rows = t.rows.map(p => ({ ...p, target: p.signal === 'folder_new_file' ? os.tmpdir() : p.signal === 'app_active_seconds' ? 'editor' : p.target })); assert.doesNotThrow(() => validateRule({ name: t.name, condition: { op: 'all', children: rows }, action: { type: 'notify', message: t.message }, trigger: t.trigger, schedule: t.schedule, policy: t.policy, holdSeconds: t.holdSeconds, fireOnApproval: t.fireOnApproval })); }
  const { tinyAgentDraftFromModel } = compile('src/tinyAgentTools.ts');
  const converted = tinyAgentDraftFromModel({ name: 'Model reminder', match: 'all', conditions: [{ signal: 'always', comparator: 'eq', value_boolean: true }], action_type: 'notify', schedule: { mode: 'daily', start: '09:00', timezone: 'Asia/Dhaka' }, policy: { maxPerDay: 1 }, fire_on_approval: false });
  assert.equal(validateRule(converted).fireOnApproval, false); assert.equal(validateRule(converted).schedule.timezone, 'Asia/Dhaka');
});
test('OR event rules do not duplicate when an older payload expires', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    add(f.engine, rule('always', true, { condition: { op: 'any', children: [ { op: 'predicate', signal: 'folder_new_file', comparator: 'contains', value: '.pdf', target: os.tmpdir() }, { op: 'predicate', signal: 'browser_download', comparator: 'eq', value: 'complete' } ] } }));
    const downloads = [{ filename: 'one.pdf', state: 'complete', sequence: 2 }];
    f.engine.ingestSensors({ at: base, Files: { [os.tmpdir()]: { names: ['one.pdf'], sequence: 1 } }, Downloads: downloads }, base); assert.equal(fired, 1);
    f.engine.ingestSensors({ at: base + 1000, Files: { [os.tmpdir()]: { names: [], sequence: 1 } }, Downloads: downloads }, base + 1000); assert.equal(fired, 1);
    f.engine.ingestSensors({ at: base + 2000, Files: { [os.tmpdir()]: { names: [], sequence: 1 } }, Downloads: [...downloads, { filename: 'two.pdf', state: 'complete', sequence: 3 }] }, base + 2000); assert.equal(fired, 2);
  } finally { f.close(); }
});
