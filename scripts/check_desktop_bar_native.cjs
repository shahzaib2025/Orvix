// Native integration harness. Invoked by the resource check, never by the feature.
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createDesktopBar } = require('../electron/desktop-bar.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const reportFile = process.env.ORVIX_DESKTOP_BAR_REPORT || path.join(root, 'scratch', 'desktop-bar-native.json');
const stageFile = reportFile + '.stage.json';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-bar-native-'));
app.setPath('userData', temp);
const checks = [], errors = [], created = [], handlers = new Map();
const shapes = new WeakMap();
const hooks = new WeakMap();
let failLoads = false;
const ipc = {
  handle(name, callback) { handlers.set(name, callback); ipcMain.handle(name, callback); },
  removeHandler(name) { handlers.delete(name); ipcMain.removeHandler(name); },
  on: ipcMain.on.bind(ipcMain), removeListener: ipcMain.removeListener.bind(ipcMain),
};
function TrackedWindow(options) {
  const window = new BrowserWindow(options); created.push(window);
  const setShape = window.setShape.bind(window);
  window.setShape = rectangles => { shapes.set(window, rectangles); setShape(rectangles); };
  const windowHooks = new Map(); hooks.set(window, windowHooks);
  const hookWindowMessage = window.hookWindowMessage.bind(window);
  window.hookWindowMessage = (message, callback) => { windowHooks.set(message, callback); hookWindowMessage(message, callback); };
  if (failLoads) window.loadFile = () => Promise.reject(new Error('Simulated native load failure'));
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
  window.webContents.on('console-message', (_event, details) => {
    const message = typeof details === 'object' ? details.message : '';
    if (/Uncaught|Refused to/.test(message)) errors.push(message);
  });
  return window;
}
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const stage = name => fs.writeFileSync(stageFile, JSON.stringify({ stage: name, at: Date.now(), pid: process.pid }));
async function waitFor(check, timeout = 25000) {
  const start = Date.now(); while (!check()) { if (Date.now() - start > timeout) throw new Error('Native check timed out'); await sleep(100); }
}
let controller;
async function main() {
  await app.whenReady();
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await host.loadURL('data:text/html,<title>Orvix validation host</title>');
  controller = createDesktopBar({ app, BrowserWindow: TrackedWindow, ipcMain: ipc, screen, shell, file: path.join(temp, 'settings.json') });
  const baselineDisplayListeners = ['display-added', 'display-removed', 'display-metrics-changed'].map(name => screen.listenerCount(name));
  const baselineIpcListeners = ipcMain.listenerCount('orvix:desktop-bar:motion-complete');
  await controller.initialize();
  check('default off creates no windows', created.length === 0);
  stage('baseline'); await sleep(process.argv.includes('--performance') ? 10000 : 300);
  stage('enabling'); check('native enable completes', (await controller.setEnabled(true)).status === 'on');
  let bar = created.find(window => !window.isDestroyed() && window.getTitle() === 'Quick access');
  let clock = created.find(window => !window.isDestroyed() && window.getTitle() === 'Orvix clock');
  check('bar and clock are visible', bar?.isVisible() && clock?.isVisible());
  check('clock is populated', await clock.webContents.executeJavaScript("document.getElementById('clockHours').textContent !== '--' && !document.hidden"));
  check('unrelated window is denied control IPC', (() => { try { handlers.get('orvix:desktop-bar:controls')({ sender: host.webContents, senderFrame: host.webContents.mainFrame }); return false; } catch { return true; } })());
  check('subframes are denied control IPC', (() => { try { handlers.get('orvix:desktop-bar:controls')({ sender: bar.webContents, senderFrame: {} }); return false; } catch { return true; } })());
  const collapsedBounds = bar.getBounds();
  const shape = shapes.get(bar);
  check('rounded mask preserves both side edges', shape.some(rect => rect.x === 0 && rect.width === collapsedBounds.width && rect.y <= 24 && rect.y + rect.height > 24));
  await fs.promises.writeFile(path.join(path.dirname(reportFile), 'desktop-bar-native-collapsed.png'), (await bar.capturePage()).toPNG());
  const firstTime = await clock.webContents.executeJavaScript("document.getElementById('clockTime').dateTime");
  const measuring = process.argv.includes('--performance');
  if (measuring) bar.setIgnoreMouseEvents(true, { forward: false });
  stage('collapsed'); await sleep(process.argv.includes('--performance') ? 62000 : 300);
  check('collapsed bar and clock remain visible', bar.isVisible() && clock.isVisible());
  if (process.argv.includes('--performance')) check('clock refreshes across a minute', firstTime !== await clock.webContents.executeJavaScript("document.getElementById('clockTime').dateTime"));
  // Real desktop pointer/activation events must not race the explicit expansion
  // assertions. Restore both guards before testing actual hover behavior.
  const blurListeners = bar.listeners('blur');
  for (const listener of blurListeners) bar.removeListener('blur', listener);
  await bar.webContents.executeJavaScript('sliderDragging = true');
  stage('expanding');
  await bar.webContents.executeJavaScript('(async () => { await setExpanded(true); if (controlsRequest) await controlsRequest; })()');
  if (measuring) bar.setIgnoreMouseEvents(true, { forward: false });
  check('clock hides while expanded', !clock.isVisible());
  check('panel is expanded', await bar.webContents.executeJavaScript("document.getElementById('deck').dataset.panelState === 'expanded'"));
  check('system controls return a result', await bar.webContents.executeJavaScript("!document.getElementById('panelStatus').textContent.includes('Warming up')"));
  await fs.promises.writeFile(path.join(path.dirname(reportFile), 'desktop-bar-native-expanded.png'), (await bar.capturePage()).toPNG());
  if (process.argv.includes('--performance')) await waitFor(() => controller.diagnostics().helpers === 0);
  stage('expanded'); await sleep(measuring ? 62000 : 300);
  stage('functional');
  check('expanded panel remains open', await bar.webContents.executeJavaScript("document.getElementById('deck').dataset.panelState === 'expanded'"));
  await bar.webContents.executeJavaScript('sliderDragging = false');
  bar.setIgnoreMouseEvents(false);
  for (const listener of blurListeners) bar.on('blur', listener);
  await bar.webContents.executeJavaScript('setExpanded(false)');
  check('clock returns after collapse', clock.isVisible());
  await bar.webContents.executeJavaScript("deck.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))");
  await sleep(650);
  check('hover waits before expanding', await bar.webContents.executeJavaScript('!isExpanded'));
  await sleep(750);
  check('hover expands after one second', await bar.webContents.executeJavaScript('isExpanded'));
  await bar.webContents.executeJavaScript("deck.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))");
  check('pointer exit immediately starts collapse', await bar.webContents.executeJavaScript('!isExpanded'));
  await sleep(250);
  hooks.get(bar).get(0x0231)(); await sleep(25);
  await bar.webContents.executeJavaScript("deck.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))");
  await sleep(1100);
  check('native drag suppresses hover expansion', await bar.webContents.executeJavaScript('!isExpanded && windowDragging'));
  hooks.get(bar).get(0x0232)(); await sleep(25);
  await bar.webContents.executeJavaScript("deck.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))");
  const originalBounds = bar.getBounds();
  bar.setBounds({ ...originalBounds, x: -10000, y: -10000 });
  screen.emit('display-metrics-changed');
  const fitted = bar.getBounds(), workArea = screen.getDisplayMatching(fitted).workArea;
  check('display changes bring the bar into a work area', fitted.x >= workArea.x && fitted.y >= workArea.y && fitted.x + fitted.width <= workArea.x + workArea.width && fitted.y + fitted.height <= workArea.y + workArea.height);
  bar.setBounds(originalBounds); screen.emit('display-metrics-changed');
  bar.webContents.reload(); await waitFor(() => !bar.webContents.isLoading()); await sleep(2900);
  check('clock returns after main page reload', clock.isVisible());
  await bar.webContents.executeJavaScript('setExpanded(true)');
  check('pending or idle controls helper exists', controller.diagnostics().helpers > 0);
  const off = await controller.setEnabled(false);
  check('Off waits for native helper exit', off.status === 'off' && controller.diagnostics().helpers === 0);
  check('Off destroys both windows', created.every(window => window.isDestroyed()));
  check('Off removes every feature IPC handler', handlers.size === 0);
  check('Off removes feature timers', controller.diagnostics().timers === 0);
  check('Off removes screen listeners', baselineDisplayListeners.every((count, i) => screen.listenerCount(['display-added', 'display-removed', 'display-metrics-changed'][i]) === count));
  check('Off removes IPC event listeners', ipcMain.listenerCount('orvix:desktop-bar:motion-complete') === baselineIpcListeners);
  for (let i = 0; i < 20; i++) {
    const on = controller.setEnabled(true); await sleep(25); const stop = controller.setEnabled(false); await Promise.all([on, stop]);
    check(`cancelled entrance ${i + 1} cleans up`, controller.diagnostics().windows === 0 && controller.diagnostics().helpers === 0 && handlers.size === 0);
  }
  const restarted = await controller.setEnabled(true);
  check(`restart after cancellations succeeds: ${restarted.error || restarted.status}`, restarted.status === 'on');
  bar = created.find(window => !window.isDestroyed() && window.getTitle() === 'Quick access');
  bar.webContents.forcefullyCrashRenderer();
  await waitFor(() => controller.getState().status === 'error');
  check('renderer crash removes all resources', controller.diagnostics().windows === 0 && controller.diagnostics().helpers === 0 && handlers.size === 0);
  failLoads = true;
  await controller.setEnabled(true);
  await waitFor(() => controller.getState().status === 'error');
  check('failed native startup leaves no resources', controller.diagnostics().windows === 0 && controller.diagnostics().helpers === 0 && handlers.size === 0);
  failLoads = false;
  await controller.setEnabled(true);
  await controller.shutdown();
  check('shutdown preserves enabled preference', JSON.parse(fs.readFileSync(path.join(temp, 'settings.json'))).enabled === true);
  check('shutdown removes windows and helpers', controller.diagnostics().windows === 0 && controller.diagnostics().helpers === 0);
  check('no preload or script errors', errors.length === 0);
  stage('off'); await sleep(process.argv.includes('--performance') ? 5000 : 100);
  fs.writeFileSync(reportFile, JSON.stringify({ passed: true, checks, errors, runtime: process.versions, processId: process.pid }, null, 2));
  host.destroy(); app.exit(0);
}
main().catch(async error => {
  try { await controller?.shutdown(); } catch {}
  fs.writeFileSync(reportFile, JSON.stringify({ passed: false, checks, errors, failure: error.stack }, null, 2));
  app.exit(1);
});
