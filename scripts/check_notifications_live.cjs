// Isolated Electron integration test. No account, PC monitor, or real shutdown.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-notification-live-'));
  env.ORVIX_NOTIFICATION_TEST_DIR = testDir;
  const result = spawnSync(require('electron'), [__filename], {
    cwd: path.join(__dirname, '..'), env, windowsHide: true, encoding: 'utf8', timeout: 45000,
  });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) console.error(result.error.message);
  // Delete only the exact temporary fixture created by this launcher.
  const resolved = path.resolve(testDir);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('orvix-notification-live-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch (error) { console.error(`Test fixture cleanup: ${error.message}`); }
  }
  process.exitCode = result.status === 0 && !result.error ? 0 : 1;
} else {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  const { EventEmitter } = require('node:events');
  const { createNotifications } = require('../electron/notifications.cjs');
  const { createAgentNotifications } = require('../electron/agent-notifications.cjs');
  const { createTinyAgents } = require('../electron/tiny-agents.cjs');
  const dir = process.env.ORVIX_NOTIFICATION_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-notification-live-'));
  app.setPath('userData', dir);
  let center; let engine; let agentFeed; let source;
  const reports = []; const opened = []; const cancelled = [];
  const failingRules = new Set();
  let shutdowns = 0;
  let stateReads = 0;
  class InboxFixtureNotification extends EventEmitter {
    static isSupported() { return true; }
    static handleActivation() {}
    show() { this.emit('show'); }
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate, description, timeout = 10000) {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeout) throw new Error(`Timed out: ${description}. Statuses: ${reports.map(item => item.status).join(', ')}`);
      await wait(50);
    }
  }
  async function noticeWindow(id) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window === source || window.getTitle() !== 'Orvix Notification') continue;
      const actualId = await window.webContents.executeJavaScript('window.orvixNotice.data().then(notice => notice?.id)');
      if (actualId === id) return window;
    }
    return null;
  }
  async function shown(id) {
    await until(() => reports.some(item => item.id === id && item.status === 'shown'), 'renderer readiness and actual window display');
    const window = await noticeWindow(id);
    assert.ok(window && window.isVisible(), 'notification window must really be visible');
    return window;
  }
  app.whenReady().then(async () => {
    try {
      center = createNotifications({ BrowserWindow, ipcMain, screen,
        onStatus: item => {
          reports.push(item); engine?.notificationStatus(item);
        },
        onOpen: item => { opened.push(item.ruleId); source.webContents.send('orvix:notification-open', {ruleId:item.ruleId}); },
        onCancelShutdown: id => { cancelled.push(id); engine.cancelShutdown(); center.cancelShutdown(); },
      });
      center.warmup();
      engine = createTinyAgents({ getPath: () => dir }, {
        notify: (...args) => { if (failingRules.has(args[2]?.ruleId)) throw new Error('Fixture display failure'); return center.notify(...args); },
        cancelNotification: (id, attempt) => center.cancel(id, attempt), shutdown: () => shutdowns++,
        onChange: item => { if (source && !source.isDestroyed()) source.webContents.send('orvix:tiny-agent-event', item); },
      });
      ipcMain.handle('orvix:tiny-agents-list', () => { stateReads++; return engine.list(); });
      ipcMain.handle('orvix:tiny-agents-retry-notification', (_event, id) => engine.retryNotification(id));
      ipcMain.handle('orvix:tiny-agents-preview', (_event, input) => engine.preview(input));
      ipcMain.handle('orvix:agent-notifications-read', () => agentFeed?.list() ?? { items: [], storageError: null });
      ipcMain.handle('orvix:agent-notifications-mark-read', (_event, id) => agentFeed?.markRead(id) ?? false);
      ipcMain.handle('orvix:agent-notifications-mark-all-read', () => agentFeed?.markAllRead() ?? { items: [], storageError: null });
      source = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../electron/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      agentFeed = createAgentNotifications({
        file: path.join(dir, 'agent-notifications.json'), Notification: InboxFixtureNotification, platform: 'win32', shouldToast: () => true,
        onChange: value => { if (source && !source.isDestroyed()) source.webContents.send('orvix:agent-notifications', value); },
      });
      await source.loadFile(path.join(__dirname, '../dist/index.html'));
      await source.webContents.executeJavaScript(`new Promise(resolve => {
        const timer = setInterval(() => { if(document.querySelector('.notification-bell')) { clearInterval(timer); resolve(true); } }, 30);
        setTimeout(() => { clearInterval(timer); resolve(false); }, 6000);
      })`).then(ready => assert.ok(ready, 'actual React app must mount its notification inbox'));
      const beforeFocus = BrowserWindow.getFocusedWindow();
      const initialReads = stateReads;
      const question = agentFeed.handleEvent({ type: 'clarification', phase: 'started', taskId: 'question-task', requestId: 'question-run', questionId: 'question-id' });
      const text = 'Battery is at 80%. <img src=x onerror=alert(1)> বাংলা বিজ্ঞপ্তি';
      const id = engine.draft({ name: 'Notification delivery fixture', condition: { op: 'predicate', signal: 'battery_percent', comparator: 'lte', value: 80 }, action: { type: 'notify', message: text } }).rule.id;
      engine.approve(id);
      engine.ingest({ BatteryPercent: 90 }, 1000);
      engine.ingest({ BatteryPercent: 80 }, 2000);
      engine.ingest({ BatteryPercent: 79 }, 3000);
      const normal = reports.find(item => item.ruleId === id && item.status === 'queued');
      assert.ok(normal, 'rule crossing must queue a notification');
      const window = await shown(normal.id);
      const normalDelivery = reports.find(r => r.id === normal.id && r.status === "shown");
      console.log("METRIC: warm card delivery " + normalDelivery.deliveryMs + "ms");
      assert.ok(normalDelivery.deliveryMs < 500, "warm delivery must finish within 500ms");
      assert.equal(BrowserWindow.getFocusedWindow(), beforeFocus, 'notification must not steal focus');
      assert.equal(reports.filter(item => item.ruleId === id && item.status === 'shown').length, 1);
      const layout = await window.webContents.executeJavaScript(`(() => {
        const card = document.getElementById('card'), body = document.getElementById('body');
        const content = document.querySelector('.content').getBoundingClientRect();
        const footer = document.querySelector('footer').getBoundingClientRect();
        return { title: document.getElementById('title').textContent, text: body.textContent,
          injectedImages: body.querySelectorAll('img').length, width: card.getBoundingClientRect().width,
          viewport: innerWidth, bodyFits: content.bottom <= footer.top,
          cancelHidden: document.getElementById('cancel').hidden,
          nodeExposed: typeof require !== 'undefined' };
      })()`);
      assert.equal(layout.title, 'Notification delivery fixture'); assert.equal(layout.text, text);
      assert.equal(layout.injectedImages, 0); assert.equal(layout.nodeExposed, false);
      assert.ok(layout.width <= layout.viewport); assert.ok(layout.bodyFits, 'content must not overlap actions');
      assert.equal(layout.cancelHidden, true);
      fs.writeFileSync(path.join(__dirname, '../scratch/notification-card-preview.png'), (await window.webContents.capturePage()).toPNG());
      console.log('PASS: real rule → IPC → sandboxed renderer → visible desktop card; Bangla, safe text, layout, no focus theft, no duplicate.');
      assert.ok(engine.list().history.some(item => item.kind === 'notification_shown' && item.noticeId === normal.id));
      const reopened = createTinyAgents({ getPath: () => dir });
      assert.ok(reopened.list().history.some(item => item.noticeId === normal.id && item.body === text));
      const inbox = await source.webContents.executeJavaScript(`new Promise(resolve => {
        const timer = setInterval(() => {
          const bell = document.querySelector('.notification-bell');
          if (bell?.getAttribute('aria-label').includes('unread')) {
            clearInterval(timer); bell.click();
            setTimeout(() => resolve({badge: document.querySelector('.notification-badge')?.textContent,
              content: document.querySelector('.notification-panel')?.textContent}), 50);
          }
        }, 30);
        setTimeout(() => { clearInterval(timer); resolve(null); }, 5000);
      })`);
      assert.ok(inbox); assert.equal(inbox.badge, '2'); assert.ok(inbox.content.includes(text));
      assert.ok(inbox.content.includes('WAITING FOR YOUR ANSWER'));
      assert.ok(inbox.content.includes('Open question'));
      assert.ok(inbox.content.includes(question.body));
      source.showInactive(); await wait(2700);
      fs.writeFileSync(path.join(__dirname, '../scratch/agent-question-notification-card.png'), (await source.webContents.capturePage()).toPNG());
      source.hide();
      assert.equal(stateReads, initialReads, 'live notification updates must not need additional listing requests');
      await source.webContents.executeJavaScript(`document.querySelector('[aria-label="Mark all notifications as read"]').click()`);
      await wait(100);
      assert.equal(await source.webContents.executeJavaScript(`document.querySelector('.notification-badge') === null`), true);
      console.log('PASS: actual React inbox shows saved content, unread badge, and mark-as-read.');
      await window.webContents.executeJavaScript(`window.orvixNotice.data().then(n => window.orvixNotice.action('open', n.id, n.attempt))`);
      await until(() => opened.includes(id) && !window.isVisible(), 'open target callback and card cleanup');
      const selectedTitle = await source.webContents.executeJavaScript(`new Promise(resolve => {
        const started = Date.now();
        const timer = setInterval(() => {
          const title = document.querySelector('.tiny-detail h2')?.textContent;
          if (title === 'Notification delivery fixture' || Date.now() - started > 5000) { clearInterval(timer); resolve(title); }
        }, 50);
      })`);
      assert.equal(selectedTitle, 'Notification delivery fixture');
      console.log('PASS: View agent routes the exact rule; notification content survives reload.');

      const changeId = engine.draft({ name: 'Brightness change delivery', trigger: { type: 'change', watches: [{ signal: 'brightness_percent' }], settleSeconds: 1 }, action: { type: 'notify', message: '' } }).rule.id;
      engine.approve(changeId);
      const changeAt = Date.now();
      engine.ingest({ Brightness: 50 }, changeAt);
      engine.ingest({ Brightness: 51 }, changeAt + 100);
      engine.tick(changeAt + 1099);
      assert.equal(reports.filter(item => item.ruleId === changeId && item.status === 'queued').length, 0, 'change must wait for settling');
      engine.tick(changeAt + 1100);
      engine.ingest({ Brightness: 51 }, changeAt + 1500);
      const changed = reports.find(item => item.ruleId === changeId && item.status === 'queued');
      assert.ok(changed);
      const changeWindow = await shown(changed.id);
      assert.match(await changeWindow.webContents.executeJavaScript("document.getElementById('body').textContent"), /Brightness: 50% → 51%/);
      assert.equal(reports.filter(item => item.ruleId === changeId && item.status === 'queued').length, 1);
      fs.writeFileSync(path.join(__dirname, '../scratch/tiny-agent-change-notification.png'), (await changeWindow.webContents.capturePage()).toPNG());
      await changeWindow.webContents.executeJavaScript("window.orvixNotice.data().then(n => window.orvixNotice.action('open', n.id, n.attempt))");
      await until(() => opened.includes(changeId) && !changeWindow.isVisible(), 'change notification opens its agent');
      await wait(100);
      assert.equal(await source.webContents.executeJavaScript("document.querySelector('.tiny-detail h2')?.textContent"), 'Brightness change delivery');
      engine.setEnabled(changeId, false);
      console.log('PASS: one-point brightness change → settled event → actual visible notification → exact agent; no duplicate.');

      const shutdownId = engine.draft({ name: 'Safe shutdown fixture', condition: { op: 'predicate', signal: 'battery_percent', comparator: 'lte', value: 20 }, action: { type: 'shutdown' } }).rule.id;
      engine.approve(shutdownId);
      engine.ingest({ BatteryPercent: 90 }, Date.now());
      engine.ingest({ BatteryPercent: 10 }, Date.now());
      const shutdown = reports.find(item => item.ruleId === shutdownId && item.status === 'queued');
      assert.ok(shutdown);
      const shutdownWindow = await shown(shutdown.id);
      const countdown = await shutdownWindow.webContents.executeJavaScript(`({ cancelVisible: !document.getElementById('cancel').hidden, openHidden: document.getElementById('open').hidden, text: document.getElementById('state').textContent })`);
      assert.equal(countdown.cancelVisible, true); assert.equal(countdown.openHidden, true);
      assert.match(countdown.text, /Shutdown in \d+s/);
      await shutdownWindow.webContents.executeJavaScript(`window.orvixNotice.data().then(n => window.orvixNotice.action('cancel_shutdown', n.id, n.attempt))`);
      await until(() => cancelled.includes(shutdownId) && !shutdownWindow.isVisible(), 'shutdown cancellation and card removal');
      assert.equal(engine.list().shutdownPending, null); assert.equal(shutdowns, 0);
      console.log('PASS: real countdown card and cancellation; no operating-system shutdown invoked.');
      const final = center.notify('Dismiss fixture', 'Closing this notification only dismisses its card.');
      const finalWindow = await shown(final.id);
      await finalWindow.webContents.executeJavaScript(`window.orvixNotice.data().then(n => window.orvixNotice.action('dismiss', n.id, n.attempt))`);
      await until(() => !finalWindow.isVisible(), 'dismiss cleanup');
      assert.ok(reports.some(item => item.id === final.id && item.status === 'dismissed'));
      // Measure a burst with the main page still hidden: no card waits 8 seconds
      // behind another one, and pushed inbox results need no page reload.
      const burstStarted = Date.now();
      let newest; const burst = [];
      for (let i=0;i<8;i++) { newest = center.notify('Instant update '+i, 'No page refresh required.'); burst.push(newest.id); }
      const newestWindow = await shown(newest.id);
      const newestReport = reports.find(item => item.id === newest.id && item.status === 'shown');
      assert.ok(burst.every(id => reports.some(r => r.id === id && r.status === 'shown')), 'every burst card must be confirmed before replacement');
      assert.ok(newestReport.deliveryMs < 8000, 'burst queue must make progress after the minimum visibility time');
      console.log('METRIC: newest burst card delivery '+newestReport.deliveryMs+'ms; burst completed in '+(Date.now()-burstStarted)+'ms');
      await newestWindow.webContents.executeJavaScript(`window.orvixNotice.data().then(n => window.orvixNotice.action('dismiss', n.id, n.attempt))`);
      const preview = center.notify('Battery reached 80%', 'Your battery is at 80%. You can unplug your charger.');
      const previewWindow = await shown(preview.id);
      fs.writeFileSync(path.join(__dirname, '../scratch/notification-card-preview.png'), (await previewWindow.webContents.capturePage()).toPNG());
      assert.ok(!reports.some(item => item.status === 'failed'), 'no delivery failures');
      const retryRule = engine.draft({ name: 'Retry fixture', condition: { op: 'predicate', signal: 'always', comparator: 'eq', value: true }, action: { type: 'notify', message: 'Recovered after manual retry.' } }).rule.id;
      failingRules.add(retryRule); engine.approve(retryRule);
      let retryAt = Date.now();
      for (const delay of [1000, 2000, 4000, 8000, 16000]) { retryAt += delay + 10; engine.tick(retryAt); }
      const retained = engine.list().deliveries.find(i => i.ruleId === retryRule);
      assert.equal(retained.status, 'needs_retry'); assert.equal(retained.attempts, 6);
      failingRules.delete(retryRule);
      await source.webContents.executeJavaScript("if (!document.querySelector('.notification-panel')) document.querySelector('.notification-bell').click()");
      await wait(150);
      assert.equal(await source.webContents.executeJavaScript("document.querySelector('.notification-retry')?.textContent.includes('Needs retry')"), true);
      await source.webContents.executeJavaScript("document.querySelector('.notification-retry button').click()");
      const retryWindow = await shown(retained.id);
      await until(() => engine.list().deliveries.find(i => i.id === retained.id)?.status === 'confirmed', 'manual retry display confirmation');
      assert.equal(await retryWindow.webContents.executeJavaScript("document.getElementById('body').textContent"), 'Recovered after manual retry.');
      await wait(100);
      assert.equal(await source.webContents.executeJavaScript("document.querySelector('.notification-retry') === null"), true);
      console.log('PASS: six failed attempts retained in the actual inbox; Retry button confirms the same delivery ID and clears Needs retry.');
      console.log('PASS: dismiss and cleanup. Live Electron integration passed.');
      process.exitCode = 0;
    } catch (error) { console.error(error.stack); process.exitCode = 1; }
    finally {
      center?.stop(); engine?.stop();
      if (source && !source.isDestroyed()) source.destroy();
      app.exit(process.exitCode || 0);
    }
  }).catch(error => { console.error(error.stack); app.exit(1); });
}
