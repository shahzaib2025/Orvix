const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTinyAgents, validateRule } = require('../electron/tiny-agents.cjs');

test('explicit approval notifies for an already true condition once, without a false delivered claim', () => {
  let calls = 0; const f = fixture({ notify: () => calls++ });
  try {
    const id = f.engine.draft(rule('battery_percent', 'lte', 80)).rule.id;
    f.engine.approve(id);
    f.engine.ingest(snapshot({ BatteryPercent: 75 }), 1000);
    f.engine.ingest(snapshot({ BatteryPercent: 74 }), 2000);
    assert.equal(calls, 1);
    assert.ok(f.engine.list().history.some(item => item.message === 'Condition met; notification requested.'));
    assert.ok(!f.engine.list().history.some(item => item.message === 'Notification delivered.'));
  } finally { f.close(); }
});

test('delivery exceptions are recorded and do not stop other agents', () => {
  const f = fixture({ notify: () => { throw new Error('Display unavailable'); } });
  try {
    for (const name of ['First', 'Second']) { const draft = rule('battery_percent', 'lte', 80); draft.name = name; f.engine.approve(f.engine.draft(draft).rule.id); }
    assert.doesNotThrow(() => f.engine.ingest(snapshot({ BatteryPercent: 70 }), 1000));
    assert.equal(f.engine.list().history.filter(item => item.kind === 'notification_retrying').length, 2);
  } finally { f.close(); }
});

test('re-reading an old monitor file cannot renew freshness or fire an alert', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = f.engine.draft(rule('battery_percent', 'lte', 80)).rule.id; f.engine.approve(id);
    f.engine.ingest(snapshot({ BatteryPercent: 90 }), 1000, 1000);
    f.engine.ingest(snapshot({ BatteryPercent: 70 }), 20000, 2000);
    assert.equal(fired, 0);
    assert.equal(f.engine.list().rules[0].availability, 'unavailable');
    f.engine.ingest(snapshot({ BatteryPercent: 70 }), 21000, 21000);
    assert.equal(fired, 1);
  } finally { f.close(); }
});

test('recorded notification content survives restart', () => {
  const f = fixture();
  try {
    f.engine.notificationStatus({ id: 'notice-1', ruleId: null, status: 'shown', title: 'Test title', body: 'Test body', message: 'Desktop notification shown.' });
    const item = f.reopen().list().history[0];
    assert.equal(item.kind, 'notification_shown'); assert.equal(item.noticeId, 'notice-1');
    assert.equal(item.title, 'Test title'); assert.equal(item.body, 'Test body');
  } finally { f.close(); }
});

function fixture(effects = {}) {
  if (effects.notify) { const syncNotify = effects.notify; effects = { ...effects, notify: (...args) => { syncNotify(...args); return { status: 'shown' }; } }; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-tiny-agent-'));
  const app = { getPath: name => { assert.equal(name, 'userData'); return dir; } };
  const engine = createTinyAgents(app, effects);
  return { engine, reopen: () => createTinyAgents(app, effects), close: () => {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
    fs.rmdirSync(dir);
  } };
}
function rule(signal, comparator, value, action = 'notify', extras = {}) {
  return { name: 'Test agent', condition: { op: 'all', children: [{ op: 'predicate', signal, comparator, value, ...extras }] },
    action: { type: action, message: 'Hello' }, holdSeconds: 0, repeatSeconds: 0 };
}
function snapshot(changes = {}) { return { Windows: [], Browsers: [], Media: [], Activity: { IdleSeconds: 0 }, BatteryPercent: 90, OnAcPower: false, Charging: false, Volume: 40, Muted: false, Brightness: 60, ...changes }; }

test('80 percent boundary is inclusive and fires only on a downward crossing', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = f.engine.draft(rule('battery_percent', 'lte', 80)).rule.id; f.engine.approve(id);
    f.engine.ingest(snapshot({ BatteryPercent: 90 }), 1000);
    f.engine.ingest(snapshot({ BatteryPercent: 81 }), 2000); assert.equal(fired, 0);
    f.engine.ingest(snapshot({ BatteryPercent: 80 }), 3000); assert.equal(fired, 1);
    f.engine.ingest(snapshot({ BatteryPercent: 79 }), 4000); assert.equal(fired, 1);
    f.engine.ingest(snapshot({ BatteryPercent: 85 }), 5000);
    f.engine.ingest(snapshot({ BatteryPercent: 80 }), 6000); assert.equal(fired, 2);
  } finally { f.close(); }
});

test('restart establishes baseline and never fires from an already true condition', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = f.engine.draft(rule('battery_percent', 'lte', 80)).rule.id; f.engine.approve(id);
    const restarted = f.reopen();
    restarted.ingest(snapshot({ BatteryPercent: 79 }), 1000); assert.equal(fired, 0);
    restarted.ingest(snapshot({ BatteryPercent: 90 }), 2000);
    restarted.ingest(snapshot({ BatteryPercent: 80 }), 3000); assert.equal(fired, 1);
  } finally { f.close(); }
});

test('all Chrome windows requires at least one and every matching window minimized', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = f.engine.draft(rule('window_state', 'eq', 'minimized', 'notify', { target: 'Chrome', scope: 'all' })).rule.id; f.engine.approve(id);
    f.engine.ingest(snapshot(), 1000);
    f.engine.ingest(snapshot({ Windows: [{ App: 'chrome', State: 'minimized' }, { App: 'chrome', State: 'normal' }] }), 2000);
    assert.equal(fired, 0);
    f.engine.ingest(snapshot({ Windows: [{ App: 'chrome', State: 'minimized' }, { App: 'chrome', State: 'minimized' }] }), 3000);
    assert.equal(fired, 1);
  } finally { f.close(); }
});

test('combined conditions, hold time, and repeat interval', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const draft = rule('battery_percent', 'lt', 30);
    draft.condition.children.push({ op: 'predicate', signal: 'idle_seconds', comparator: 'gte', value: 900 });
    draft.holdSeconds = 30; draft.repeatSeconds = 60;
    const id = f.engine.draft(draft).rule.id; f.engine.approve(id);
    f.engine.ingest(snapshot(), 1000);
    f.engine.ingest(snapshot({ BatteryPercent: 25, Activity: { IdleSeconds: 900 } }), 2000);
    f.engine.ingest(snapshot({ BatteryPercent: 25, Activity: { IdleSeconds: 930 } }), 31_999); assert.equal(fired, 0);
    f.engine.ingest(snapshot({ BatteryPercent: 25, Activity: { IdleSeconds: 931 } }), 32_000); assert.equal(fired, 1);
    f.engine.ingest(snapshot({ BatteryPercent: 25, Activity: { IdleSeconds: 990 } }), 91_999); assert.equal(fired, 1);
    f.engine.ingest(snapshot({ BatteryPercent: 25, Activity: { IdleSeconds: 990 } }), 92_000); assert.equal(fired, 2);
  } finally { f.close(); }
});

test('unavailable browser data cannot trigger and shutdown can be cancelled', () => {
  let shutdowns = 0; const f = fixture({ shutdown: () => shutdowns++ });
  try {
    const draft = rule('browser_tab', 'contains', 'example.com', 'shutdown', { target: 'Chrome', field: 'url' });
    const id = f.engine.draft(draft).rule.id; f.engine.approve(id);
    f.engine.ingest(snapshot(), 1000); assert.equal(f.engine.list().rules[0].availability, 'unavailable');
    const browser = [{ Name: 'Chrome', SeenUtc: new Date(2000).toISOString(), Tabs: [{ url: 'https://other.com' }], Videos: [] }];
    f.engine.ingest(snapshot({ Browsers: browser }), 2000);
    browser[0].Tabs[0].url = 'https://example.com'; browser[0].SeenUtc = new Date(3000).toISOString();
    f.engine.ingest(snapshot({ Browsers: browser }), 3000);
    assert.ok(f.engine.list().shutdownPending);
    assert.equal(f.engine.cancelShutdown(), true);
    f.engine.tick(34_000); assert.equal(shutdowns, 0);
    f.engine.ingest(snapshot({ Browsers: browser }), 80_000);
    assert.equal(f.engine.list().rules[0].availability, 'unavailable');
  } finally { f.close(); }
});

test('invalid signals and missing window targets are rejected', () => {
  assert.throws(() => validateRule(rule('arbitrary_code', 'eq', 'run')), /Unsupported signal/);
  assert.throws(() => validateRule(rule('window_state', 'eq', 'minimized')), /Choose an application/);
});

test('charging and AC connection are distinct signals', () => {
  let fired = 0; const f = fixture({ notify: () => fired++ });
  try {
    const id = f.engine.draft(rule('charging', 'eq', true)).rule.id; f.engine.approve(id);
    f.engine.ingest(snapshot({ OnAcPower: true, Charging: false }), 1000);
    assert.equal(fired, 0);
    f.engine.ingest(snapshot({ OnAcPower: true, Charging: true }), 2000);
    assert.equal(fired, 1);
  } finally { f.close(); }
});

test('editing an active rule disables it until the new draft is approved', () => {
  const f = fixture();
  try {
    const id = f.engine.draft(rule('battery_percent', 'lte', 80)).rule.id;
    f.engine.approve(id);
    assert.equal(f.engine.list().rules[0].enabled, true);
    f.engine.draft({ ...rule('battery_percent', 'lte', 75), id });
    assert.equal(f.engine.list().rules[0].enabled, false);
    assert.equal(f.engine.list().rules[0].draft, true);
    assert.throws(() => f.engine.setEnabled(id, true), /Review this draft/);
    f.engine.approve(id);
    assert.equal(f.engine.list().rules[0].enabled, true);
  } finally { f.close(); }
});

test('pending shutdown cancels automatically when the condition clears', () => {
  let shutdowns = 0; const f = fixture({ shutdown: () => shutdowns++ });
  try {
    const id = f.engine.draft(rule('window_state', 'eq', 'minimized', 'shutdown', { target: 'Chrome', scope: 'all' })).rule.id;
    f.engine.approve(id);
    f.engine.ingest(snapshot({ Windows: [{ App: 'chrome', State: 'normal' }] }), 1000);
    f.engine.ingest(snapshot({ Windows: [{ App: 'chrome', State: 'minimized' }] }), 2000);
    assert.ok(f.engine.list().shutdownPending);
    f.engine.ingest(snapshot({ Windows: [{ App: 'chrome', State: 'normal' }] }), 3000);
    assert.equal(f.engine.list().shutdownPending, null);
    f.engine.tick(33_000);
    assert.equal(shutdowns, 0);
  } finally { f.close(); }
});

test('approved shutdown fires only after countdown with a fresh true condition', () => {
  let shutdowns = 0; const f = fixture({ shutdown: () => shutdowns++ });
  try {
    const id = f.engine.draft(rule('window_state', 'eq', 'minimized', 'shutdown', { target: 'Chrome', scope: 'all' })).rule.id;
    f.engine.approve(id);
    const normal = snapshot({ Windows: [{ App: 'chrome', State: 'normal' }] });
    const minimized = snapshot({ Windows: [{ App: 'chrome', State: 'minimized' }] });
    f.engine.ingest(normal, 1000);
    f.engine.ingest(minimized, 2000);
    f.engine.ingest(minimized, 31_000);
    assert.equal(shutdowns, 0);
    f.engine.tick(32_000);
    assert.equal(shutdowns, 1);
  } finally { f.close(); }
});
