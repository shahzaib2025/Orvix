const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { installSessionSafety } = require('../electron/session-safety.cjs');

const root = path.resolve(__dirname, '..');

test('Windows lock and suspend events still reach the renderer and listeners clean up', () => {
  const powerMonitor = new EventEmitter();
  const sent = [];
  const main = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
  const safety = installSessionSafety({ powerMonitor, getMainWindow: () => main });

  safety.start();
  safety.start();
  for (const event of ['lock-screen', 'unlock-screen', 'suspend', 'resume']) assert.equal(powerMonitor.listenerCount(event), 1);
  for (const event of ['lock-screen', 'unlock-screen', 'suspend', 'resume']) powerMonitor.emit(event);
  assert.deepEqual(sent.map(([, value]) => value.state), ['locked', 'unlocked', 'suspended', 'resumed']);
  assert.ok(sent.every(([channel]) => channel === 'orvix:session-state'));

  safety.stop();
  safety.stop();
  for (const event of ['lock-screen', 'unlock-screen', 'suspend', 'resume']) assert.equal(powerMonitor.listenerCount(event), 0);
});

test('the former automatic conversation and inactivity-lock feature is absent from app wiring', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const app = read('src/App.tsx');
  const settings = read('src/components/SettingsPage.tsx');
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const types = read('src/desktop.d.ts');
  const sessionSafety = read('electron/session-safety.cjs');

  assert.doesNotMatch(app + settings, /PcCompanion|pc-companion|Automatic conversation|Lock after two minutes/i);
  assert.doesNotMatch(main + preload + types, /pc-companion|presence-settings|presence-control|setPresenceSettings|getPresenceSettings/i);
  assert.match(app, /onSessionState/);
  assert.match(preload, /orvix:session-state/);
  assert.doesNotMatch(sessionSafety, /LockWorkStation|setInterval|spawn\(/);
});
