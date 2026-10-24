// Isolated real desktop display and read-only sensor observations; no account or setting changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-agent-native-'));
  try {
    const env = { ...process.env, ORVIX_AGENT_NATIVE_FIXTURE: root }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename], { env, windowsHide: true, encoding: 'utf8', timeout: 40000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    process.exitCode = result.status === 0 ? 0 : 1;
  } finally { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-agent-native-')); fs.rmSync(root, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  const { createNotifications } = require('../electron/notifications.cjs');
  const { verifyNativeWorkflow } = require('../electron/agent/native-workflow.cjs');
  const { readNativeSnapshot } = require('../electron/agent/native-snapshot.cjs');
  app.setPath('userData', process.env.ORVIX_AGENT_NATIVE_FIXTURE);
  app.whenReady().then(async () => {
    const statuses = new Map();
    const center = createNotifications({ BrowserWindow, ipcMain, screen, onStatus: value => statuses.set(value.id, { ...statuses.get(value.id), ...value }) });
    try {
      center.warmup();
      const result = await verifyNativeWorkflow({ signal: new AbortController().signal, steps: [{ action: 'notification_test' }, { action: 'assert_notification', timeout_ms: 15000 }], snapshot: async () => ({}), notifyTest: async () => center.notify('Orvix agent workflow check', 'Verifying actual desktop notification display.'), notificationStatus: id => statuses.get(id) });
      assert.equal(result.status, 'passed', JSON.stringify(result));
      assert.ok(BrowserWindow.getAllWindows().some(window => window.isVisible() && window.getTitle() === 'Orvix Notification'));
      console.log('PASS: native workflow observed a real visible desktop card and its renderer acknowledgement.');
      const file = path.join(process.env.LOCALAPPDATA, 'PCMonitorTest', 'current-state.json');
      const snapshot = readNativeSnapshot(file);
      const available = Object.entries(snapshot.sensors ?? {}).filter(([, sensor]) => Number.isFinite(sensor.value));
      if (snapshot.status === 'ok' && available.length) {
        const sensorResult = await verifyNativeWorkflow({ signal: new AbortController().signal, snapshot: async () => readNativeSnapshot(file), steps: available.map(([sensor]) => ({ action: 'assert_sensor', sensor, operator: 'at_least', expected: 0 })) });
        assert.equal(sensorResult.status, 'passed', JSON.stringify(sensorResult));
        console.log('PASS: fresh live PC Monitor readings observed for ' + available.map(([name]) => name).join(', ') + '; device settings unchanged.');
      } else console.log('UNAVAILABLE: live PC Monitor sensor readings; no fabricated sensor success.');
    } finally { center.stop(); app.quit(); }
  }).catch(error => { console.error(error); app.exit(1); });
}
