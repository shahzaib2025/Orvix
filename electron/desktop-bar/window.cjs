const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createOwnedHelpers } = require('./helpers.cjs');

function createDesktopBarView({ app, BrowserWindow, ipcMain, screen, shell, onClose, onFailure = () => {}, createHelpers = createOwnedHelpers }) {
const WIDGET_WIDTH = 620, BAR_HEIGHT = 52, COLLAPSED_HEIGHT = 52, CLOCK_WIDTH = 125, CLOCK_HEIGHT = 90, EXPANDED_HEIGHT = 404;
let widget, clockWidget, clockReady = false, motionBusy = true, exitStarted = false, dockAnchor, expandedLayout = false, renderingTimer, windowDragging = false;
let startPromise, resolveStart, rejectStart, startupTimer, disposePromise, failureReported = false;
const timers = new Set(), handlers = new Set(), subscriptions = [];
const helpers = createHelpers({ onFailure: failure => fail(failure) });
function later(fn, ms) {
  if (exitStarted) return undefined;
  const timer = setTimeout(() => { timers.delete(timer); if (!exitStarted) fn(); }, ms);
  timers.add(timer); timer.unref?.(); return timer;
}
function cancel(timer) { clearTimeout(timer); timers.delete(timer); }
function subscribe(emitter, name, callback) { emitter.on(name, callback); subscriptions.push(() => emitter.removeListener(name, callback)); }
function senderAllowed(event) { return !exitStarted && widget && !widget.isDestroyed() && event.sender === widget.webContents && event.senderFrame === widget.webContents.mainFrame; }
function handle(name, callback) {
  ipcMain.handle(name, (event, ...args) => { if (!senderAllowed(event)) throw new Error('Desktop top bar request denied.'); return callback(event, ...args); });
  handlers.add(name);
}
function listen(name, callback) {
  const listener = (event, ...args) => { if (senderAllowed(event)) callback(event, ...args); };
  subscribe(ipcMain, name, listener);
}
function fail(failure) {
  if (exitStarted || failureReported) return;
  failureReported = true;
  const error = failure instanceof Error ? failure : new Error(String(failure));
  rejectStart?.(error);
  onFailure(error);
}
function maybeReady() {
  if (!exitStarted && clockReady && !motionBusy && widget && !widget.isDestroyed()) {
    cancel(startupTimer); resolveStart?.();
  }
}
function secureWindow(window, file) {
  const url = pathToFileURL(path.join(__dirname, file)).href;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, next) => { if (next !== url) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) fail(new Error(description || 'Desktop top bar failed to load.')); });
  window.webContents.on('render-process-gone', () => fail(new Error('Desktop top bar stopped unexpectedly.')));
}
function fitDisplay() {
  if (exitStarted || !widget || widget.isDestroyed()) return;
  const current = widget.getBounds(), area = screen.getDisplayMatching(current).workArea;
  const width = Math.min(WIDGET_WIDTH, area.width - 16);
  const height = Math.min(current.height, area.height - 16);
  widget.setBounds({ width, height, x: Math.max(area.x + 8, Math.min(current.x, area.x + area.width - width - 8)), y: Math.max(area.y + 8, Math.min(current.y, area.y + area.height - height - 8)) });
  dockAnchor = undefined; setWidgetShape(expandedLayout); positionClock();
}
function resumeWidgetRendering() {
  if (exitStarted) return;
  cancel(renderingTimer);
  if (widget && !widget.isDestroyed()) widget.webContents.setBackgroundThrottling(false);
}

function parkWidgetRendering(delay = 420) {
  cancel(renderingTimer);
  renderingTimer = later(() => {
    if (!motionBusy && widget && !widget.isDestroyed()) widget.webContents.setBackgroundThrottling(true);
  }, delay);
}

function keepWidgetOnTop() {
  if (!widget || widget.isDestroyed() || exitStarted) return;
  if (!widget.isAlwaysOnTop()) widget.setAlwaysOnTop(true, 'screen-saver');
  if (clockWidget && !clockWidget.isDestroyed() && clockWidget.isVisible()) {
    if (!clockWidget.isAlwaysOnTop()) clockWidget.setAlwaysOnTop(true, 'screen-saver');
  }
}

function positionClock() {
  if (!widget || widget.isDestroyed() || !clockWidget || clockWidget.isDestroyed()) return;
  const bounds = widget.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(area.x, Math.min(bounds.x + bounds.width - 24 - CLOCK_WIDTH, area.x + area.width - CLOCK_WIDTH));
  const below = bounds.y + BAR_HEIGHT;
  const y = below + CLOCK_HEIGHT <= area.y + area.height ? below : Math.max(area.y, bounds.y - CLOCK_HEIGHT);
  clockWidget.setBounds({ x, y, width: CLOCK_WIDTH, height: CLOCK_HEIGHT });
}

function showClock(visible) {
  if (!clockWidget || clockWidget.isDestroyed()) return;
  if (!visible) { clockWidget.hide(); return; }
  positionClock();
  if (clockReady && !expandedLayout && !motionBusy && !windowDragging && !exitStarted) {
    clockWidget.showInactive();
  }
}

handle('orvix:desktop-bar:controls', async () => {
  try {
    return await helpers.runControls('Read');
  } catch (error) {
    return { volume: null, brightness: null, brightnessSupported: false, error: error.message };
  }
});

handle('orvix:desktop-bar:set-volume', async (_event, value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return { ok: false, error: 'Choose a volume from 0 to 100.' };
  try {
    return await helpers.runControls('Volume', Math.max(0, Math.min(100, amount)));
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

handle('orvix:desktop-bar:set-brightness', async (_event, value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return { ok: false, error: 'Choose a brightness from 0 to 100.' };
  try {
    return await helpers.runControls('Brightness', Math.max(0, Math.min(100, amount)));
  } catch (error) {
    return { ok: false, error: error.message };
  }
});


handle('orvix:desktop-bar:launch', async (_event, action) => {
  if (action === 'browser') { await shell.openExternal('https://www.google.com'); return { ok: true }; }
  if (action === 'settings') { await shell.openExternal('ms-settings:'); return { ok: true }; }
  if (action === 'search' || action === 'lock') return helpers.runShortcut(action === 'search' ? 'Search' : 'Lock');
  const applications = { calculator: 'calc.exe', notepad: 'notepad.exe', 'task-manager': 'Taskmgr.exe' };
  if (!Object.hasOwn(applications, action)) throw new Error('That shortcut is not available.');
  const failure = await shell.openPath(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', applications[action]));
  return failure ? { ok: false, error: failure } : { ok: true };
});
handle('orvix:desktop-bar:wake', event => {
  if (!widget || widget.isDestroyed() || event.sender !== widget.webContents) return false;
  resumeWidgetRendering();
  parkWidgetRendering();
  return true;
});

handle('orvix:desktop-bar:expanded', (event, expanded, requestedHeight) => {
  if (!widget || widget.isDestroyed() || motionBusy || (expanded && windowDragging) || event.sender !== widget.webContents) return false;
  resumeWidgetRendering();
  const display = screen.getDisplayMatching(widget.getBounds());
  const { workArea } = display;
  const current = widget.getBounds();
  if (expanded && !expandedLayout) dockAnchor = { x: current.x, y: current.y };
  const anchor = dockAnchor || current;
  const width = Math.min(WIDGET_WIDTH, workArea.width - 16);
  const desiredHeight = Number.isFinite(requestedHeight) ? Math.ceil(requestedHeight) : EXPANDED_HEIGHT;
  const height = Math.min(expanded ? Math.max(BAR_HEIGHT + 100, desiredHeight) : COLLAPSED_HEIGHT, workArea.height - 16);
  const x = Math.max(workArea.x + 8, Math.min(anchor.x, workArea.x + workArea.width - width - 8));
  const y = Math.max(workArea.y + 8, Math.min(anchor.y, workArea.y + workArea.height - height - 8));
  expandedLayout = Boolean(expanded);
  if (expanded) showClock(false);
  if (current.x !== x || current.y !== y || current.width !== width || current.height !== height) {
    widget.setBounds({ x, y, width, height });
  }
  setWidgetShape(Boolean(expanded));
  widget.setIgnoreMouseEvents(false);
  if (!expanded) showClock(true);
  if (!expanded) dockAnchor = undefined;
  parkWidgetRendering();
  return { ok: true, panelMaxHeight: height - BAR_HEIGHT - 12 };
});

function motionDistance() {
  const { workArea } = screen.getDisplayMatching(widget.getBounds());
  return Math.max(0, Math.round(workArea.y + workArea.height / 2 - widget.getBounds().y - BAR_HEIGHT / 2));
}

listen('orvix:desktop-bar:motion-complete', (event, phase) => {
  if (!widget || widget.isDestroyed() || event.sender !== widget.webContents) return;
  if (phase === 'open' && !exitStarted) {
    widget.setBounds({ ...widget.getBounds(), height: COLLAPSED_HEIGHT });
    setWidgetShape(false);
    widget.setIgnoreMouseEvents(false);
    motionBusy = false;
    showClock(true);
    parkWidgetRendering(1300);
    maybeReady();
  }
});

function setWidgetShape(expanded = expandedLayout) {
  if (!widget || widget.isDestroyed()) return;
  const { width, height } = widget.getBounds();
  const visibleHeight = expanded ? Math.max(0, height - 8) : Math.min(height, BAR_HEIGHT);
  const radius = Math.min(25, Math.floor(width / 2), Math.floor(visibleHeight / 2));
  // Match the CSS corners instead of cutting 25px off both sides of the end caps.
  const shape = [];
  if (visibleHeight > radius * 2) {
    shape.push({ x: 0, y: radius, width, height: visibleHeight - radius * 2 });
  }
  for (let row = 0; row < radius; row++) {
    const dy = radius - row - 0.5;
    const inset = Math.floor(radius - Math.sqrt(radius * radius - dy * dy));
    shape.push({ x: inset, y: row, width: width - inset * 2, height: 1 });
    shape.push({ x: inset, y: visibleHeight - row - 1, width: width - inset * 2, height: 1 });
  }
  if (shape.length) widget.setShape(shape);
}

function pointerInsideWidget() {
  if (!widget || widget.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const bounds = widget.getBounds();
  const contentHeight = expandedLayout ? bounds.height - 8 : BAR_HEIGHT;
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  if (x < 0 || x >= bounds.width || y < 0 || y >= contentHeight) return false;
  const radius = Math.min(25, bounds.width / 2, contentHeight / 2);
  if (x < radius && y < radius) return (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2;
  if (x >= bounds.width - radius && y < radius) return (x - (bounds.width - radius)) ** 2 + (y - radius) ** 2 <= radius ** 2;
  if (x < radius && y >= contentHeight - radius) return (x - radius) ** 2 + (y - (contentHeight - radius)) ** 2 <= radius ** 2;
  if (x >= bounds.width - radius && y >= contentHeight - radius) return (x - (bounds.width - radius)) ** 2 + (y - (contentHeight - radius)) ** 2 <= radius ** 2;
  return true;
}

handle('orvix:desktop-bar:pointer-inside', event => {
  if (!widget || widget.isDestroyed() || event.sender !== widget.webContents) return false;
  return pointerInsideWidget();
});


function createWidget() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(WIDGET_WIDTH, workArea.width - 16);
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = workArea.y + 18;

  widget = new BrowserWindow({
    width,
    height: Math.max(COLLAPSED_HEIGHT, Math.round(workArea.height / 2) + COLLAPSED_HEIGHT),
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    hasShadow: false,
    show: false,
    skipTaskbar: true,
    title: 'Orvix Quick Access',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'orvix-desktop-bar',
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  const setDragging = dragging => {
    if (windowDragging === dragging) return;
    windowDragging = dragging;
    widget.webContents.send('orvix:desktop-bar:drag-state', dragging);
    if (dragging) showClock(false);
    else showClock(true);
  };
  widget.hookWindowMessage(0x00a1, wParam => { if (wParam.readUInt32LE(0) === 2) setDragging(true); });
  widget.hookWindowMessage(0x0231, () => setDragging(true));
  widget.hookWindowMessage(0x0232, () => setDragging(false));
  widget.setShape([{ x: 0, y: 0, width, height: widget.getBounds().height }]);
  widget.setIgnoreMouseEvents(true, { forward: false });
  widget.setAlwaysOnTop(true, 'screen-saver');
  widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  clockWidget = new BrowserWindow({
    width: CLOCK_WIDTH, height: CLOCK_HEIGHT, x: x + width - 24 - CLOCK_WIDTH, y: y + BAR_HEIGHT,
    frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    focusable: false, resizable: false, movable: false, skipTaskbar: true, hasShadow: false,
    webPreferences: { backgroundThrottling: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'orvix-desktop-bar' },
  });
  secureWindow(clockWidget, 'clock.html');
  clockWidget.setAlwaysOnTop(true, 'screen-saver');
  clockWidget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  clockWidget.setIgnoreMouseEvents(true, { forward: false });
  // A hidden view sharing a throttled renderer can wait for its first paint
  // until it is shown. Document readiness avoids that visibility deadlock.
  clockReady = false;
  clockWidget.webContents.on('did-finish-load', () => { clockReady = true; showClock(true); maybeReady(); });
  clockWidget.loadFile(path.join(__dirname, 'clock.html')).catch(fail);
  secureWindow(widget, 'index.html');
  widget.setMenuBarVisibility(false);
  let windowReady = false;
  let pageLoaded = false;
  let entranceStarted = false;
  const startEntrance = () => {
    if (!windowReady || !pageLoaded || entranceStarted || exitStarted || !widget || widget.isDestroyed()) return;
    entranceStarted = true;
    motionBusy = true;
    showClock(false);
    resumeWidgetRendering();
    widget.setIgnoreMouseEvents(true, { forward: false });
    const distance = motionDistance();
    widget.setBounds({ ...widget.getBounds(), height: Math.max(EXPANDED_HEIGHT, distance + COLLAPSED_HEIGHT + 8) });
    setWidgetShape(true);
    widget.webContents.send('orvix:desktop-bar:motion', { phase: 'open', distance });
  };
  widget.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace || exitStarted) return;
    showClock(false);
    pageLoaded = false;
    entranceStarted = false;
    motionBusy = true;
    windowDragging = false;
    expandedLayout = false;
    if (dockAnchor) widget.setBounds({ ...widget.getBounds(), ...dockAnchor, height: COLLAPSED_HEIGHT });
    dockAnchor = undefined;
    resumeWidgetRendering();
    widget.setIgnoreMouseEvents(true, { forward: false });
    setWidgetShape(true);
  });
  const showLoadedWidget = () => {
    if (windowReady || exitStarted || !widget || widget.isDestroyed()) return;
    widget.setIgnoreMouseEvents(true, { forward: false });
    widget.showInactive();
    windowReady = true;
    startEntrance();
  };
  // Document readiness can show the transparent entrance surface without waiting
  // for a hidden first paint, including after rapid creation/destruction cycles.
  widget.webContents.on('did-finish-load', () => { pageLoaded = true; showLoadedWidget(); startEntrance(); });
  widget.once('ready-to-show', showLoadedWidget);
  widget.loadFile(path.join(__dirname, 'index.html')).catch(fail);
  widget.on('close', event => {
    if (!exitStarted) { event.preventDefault(); onClose(); }
  });
  widget.on('blur', () => {
    if (widget && !widget.isDestroyed()) widget.webContents.send('orvix:desktop-bar:blur');
  });
  widget.on('hide', () => { cancel(renderingTimer); widget?.webContents.setBackgroundThrottling(true); });
  widget.on('show', () => {
    resumeWidgetRendering();
    parkWidgetRendering();
  });
  widget.on('will-move', (_event, bounds) => {
    if (expandedLayout && !motionBusy) dockAnchor = { x: bounds.x, y: bounds.y };
  });
  widget.on('closed', () => { widget = undefined; if (!exitStarted) fail(new Error('Desktop top bar window closed unexpectedly.')); });
  clockWidget.on('closed', () => { clockWidget = undefined; if (!exitStarted) fail(new Error('Desktop clock window closed unexpectedly.')); });
  for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) subscribe(screen, name, fitDisplay);
}


function deactivate() {
  if (exitStarted) return;
  exitStarted = true;
  rejectStart?.(new Error('Desktop top bar was turned off.'));
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const name of handlers) ipcMain.removeHandler(name);
  handlers.clear();
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  helpers.deactivate();
  for (const window of [clockWidget, widget]) {
    if (window && !window.isDestroyed()) { window.hide(); window.unhookAllWindowMessages?.(); window.destroy(); }
  }
  widget = undefined; clockWidget = undefined;
}
function dispose() {
  deactivate();
  if (!disposePromise) disposePromise = helpers.dispose().catch(error => { disposePromise = undefined; throw error; });
  return disposePromise;
}
return {
  start() {
    if (startPromise) return startPromise;
    startPromise = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    try { createWidget(); startupTimer = later(() => fail(new Error('Desktop top bar did not become ready.')), 10000); }
    catch (failure) { fail(failure); }
    return startPromise;
  },
  deactivate, dispose,
  diagnostics: () => ({ windows: [widget, clockWidget].filter(window => window && !window.isDestroyed()).length, timers: timers.size, handlers: handlers.size + subscriptions.length, ...helpers.diagnostics() }),
};
}
module.exports = { createDesktopBarView };

