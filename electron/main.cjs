const { app, BrowserWindow, ipcMain, shell, screen, powerMonitor, powerSaveBlocker, safeStorage, session, Tray, Menu, dialog, desktopCapturer, Notification, clipboard } = require("electron");
const {installScreenSharing}=require('./screen-sharing.cjs');
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");
const { createTinyRuntime } = require('./tiny-runtime.cjs');
const { handleTinyWindowClose,stopTinyRuntimeAndUnlock } = require('./tiny-window-lifecycle.cjs');
const { createWorkflowAdapters } = require('./tiny-workflow-adapters.cjs');
const { withResources } = require('./workflow-resources.cjs');
let tinyWorkflows = null, workflowAdapters = null, tinyRuntime = null, tinyRuntimeClosed = false;
const { createConstructionLocks, restrictionDialogOptions } = require('./construction-lock.cjs');
const { createTinyAgentSensors } = require('./tiny-agent-sensors.cjs');
const { createNotifications } = require("./notifications.cjs");
const { createAgentNotifications } = require('./agent-notifications.cjs');
const { ensureWindowsNotificationShortcuts, ensureWindowsTaskbarShortcut, ensureWindowsNotificationAppRegistration, getNotificationAppUserModelId, getTaskbarAppUserModelId } = require('./windows-notification-shortcuts.cjs');
const { createStartupSettings } = require('./startup-settings.cjs');
const { createDesktopBar } = require('./desktop-bar.cjs');
let desktopBar = null, desktopBarQuitPromise = null, desktopBarQuitComplete = false;
const { createCredentials } = require("./agent/credentials.cjs");
const { configureKiloCatalog, refreshKiloCatalog } = require('./agent/kilo-catalog.cjs');
const { refreshAntigravityCatalog, getAntigravityStatus, startAntigravityServer, stopAntigravityServer } = require('./agent/antigravity-service.cjs');
const { createOpenCodeWorkers } = require('./agent/opencode-workers.cjs');
const { createOpenCodePreferences } = require('./agent/opencode-preferences.cjs');
const { configureOpenCodeCatalog, getOpenCodeCatalog, refreshOpenCodeCatalog } = require('./agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('./agent/opencode-model.cjs');
const { loadOpenCodeEnv } = require("./agent/load-opencode-env.cjs");
const { createAgentEngine } = require("./agent/engine.cjs");
const { createTaskStore } = require("./agent/task-store.cjs");
const { createLiveToken } = require("./live-auth.cjs");
const { appendThinkingTrace } = require("./thinking-trace.cjs");
const { loadLiveEnv } = require("./live-env.cjs");
const { getWeather } = require("./weather.cjs");
const { searchWeb, readSearchResultPage, configureSearchKeys } = require("./search.cjs");
const { createSearchKeyStore } = require('./search-key-store.cjs');
const { createClass10Textbooks } = require("./textbooks.cjs");
const { listDirectory, searchFiles, searchContent, readFile, writeFile } = require("./live-fs-tools.cjs");
const { createFastExplorer, registerFastExplorerIpc } = require('./fast-explorer.cjs');
const { manageClipboard } = require("./clipboard.cjs");
const { manageWindow, getForegroundHandle } = require("./window-control.cjs");
const {createFastFiles,registerFastFilesIpc,guardedFileWindowAction}=require('./fast-files.cjs');
const { windowActionResult } = require("./fast-windows.cjs");
const { createYoutubeControl } = require("./youtube-control.cjs");
const { createFastWork } = require('./fast-work.cjs');
const { createDesktopControl } = require('./desktop-control.cjs');
const { createFastWorker } = require('./fast-worker.cjs');
const class10Textbooks = createClass10Textbooks({ userDataPath: () => app.getPath("userData") });

const appId = "com.orvix.desktop";
const desktopIconPath = path.join(__dirname, "..", "build", "icons", "icon.ico");
const notificationIdentityIconPath = path.join(__dirname, "..", "build", "icons", "icon.png");
const notificationAppUserModelId = getNotificationAppUserModelId(appId, app.isPackaged);
const windowAppUserModelId = getTaskbarAppUserModelId(appId, app.isPackaged);
const toastActivatorClsid = '{4b0412c9-10f3-489a-a7b7-2ae842eeed7d}';
let notificationShortcutRepairTimer = null;
function repairWindowsNotificationShortcut(registerBranding = false) {
  const branding = registerBranding && !app.isPackaged
    ? ensureWindowsNotificationAppRegistration({ appUserModelId: notificationAppUserModelId, displayName: 'Orvix', iconPath: notificationIdentityIconPath })
    : { errors: [] };
  const shortcuts = ensureWindowsNotificationShortcuts({ app, shell, appUserModelId: notificationAppUserModelId,
    toastActivatorClsid, iconPath: desktopIconPath, development: !app.isPackaged,
    entryPath: app.isPackaged ? undefined : path.join(app.getAppPath(), 'electron', 'main.cjs') });
  const taskbarShortcut = ensureWindowsTaskbarShortcut({ app, shell, appUserModelId: windowAppUserModelId,
    iconPath: desktopIconPath, development: !app.isPackaged,
    entryPath: app.isPackaged ? undefined : path.join(app.getAppPath(), 'electron', 'main.cjs') });
  return { ...shortcuts, taskbarShortcut, errors: [...branding.errors, ...shortcuts.errors, ...taskbarShortcut.errors] };
}
// Register the branded shortcut before assigning the AUMID. Windows can cache
// the first shortcut it finds for an identity, which is often Electron.lnk in dev.
if (process.platform === 'win32') {
  try {
    const earlyShortcutResult = repairWindowsNotificationShortcut(true);
    if (earlyShortcutResult.errors.length) console.warn('[Notifications] Early Start Menu shortcut setup:', earlyShortcutResult.errors.join(' '));
  }
  catch (error) { console.warn('[Notifications] Early Start Menu shortcut setup failed:', error.message); }
}
const { createCompanionMemory, installCompanionMemory } = require('./companion-memory.cjs');
const companionMemory = createCompanionMemory({ directory: app.getPath('userData'), safeStorage });
installCompanionMemory({ ipcMain, getMainWindow: () => mainWindow, store: companionMemory });
const sessionSafety = require('./session-safety.cjs').installSessionSafety({powerMonitor,getMainWindow:()=>mainWindow});
app.whenReady().then(()=>sessionSafety.start());
app.on('will-quit',()=>sessionSafety.stop());
app.on('will-quit', () => companionMemory.close());
loadOpenCodeEnv(path.join(__dirname, ".."));
loadLiveEnv(path.join(__dirname, ".."));
app.setAppUserModelId(notificationAppUserModelId);
if (process.platform === 'win32' && typeof app.setToastActivatorCLSID === 'function') {
  try { app.setToastActivatorCLSID(toastActivatorClsid); }
  catch (error) { console.error('[Notifications] Windows toast activation registration failed:', error.message); }
}
console.log("[Orvix] Starting desktop app");
const ownsInstance = app.requestSingleInstanceLock();
const PET_WINDOW_WIDTH = 360;
const PET_WINDOW_HEIGHT = 430;
const PET_LEFT = 92;
const PET_TOP = 184;
let mainWindow = null;
const desktopControl = createDesktopControl();
const fastWork = createFastWork({
  groundingReviewer: require('./fast-grounding.cjs').createGroundingReviewer(),
  settingsFile: path.join(app.getPath('userData'), 'fast-work-settings.json'),
  browser: { observe: (input, signal) => fastBrowserRequest('observe', input, signal),
    act: (input, signal) => fastBrowserRequest('act', input, signal), cancel: ids => youtubeControl?.cancelBrowser(ids) },
  desktop: { observe: (input, signal) => withPcMonitorLease(() => desktopControl.observe(input, signal)),
    act: (input, signal) => withPcMonitorLease(() => desktopControl.act(input, signal)), cancel: ids => desktopControl.cancel(ids) },
  windows: { observe: (input, signal) => withPcMonitorLease(() => desktopControl.observe(input, signal)), act: async input => { const result = await guardedFileWindowAction(fastFiles,input,manageWindow); if (typeof result.verified !== 'boolean' && !result.completionUnknown && result.action === 'focus' && result.ok) result.verified = await getForegroundHandle() === result.handle; return windowActionResult(result); } },
  emit: event => { workflowAdapters?.workEvent(event); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:fast-work-event', event); },
  workflowAuthorize: input => workflowAdapters?.authorizeWork(input),
  metrics: event => console.log('[Orvix Fast work]', JSON.stringify(event)),
});
const fastWorker = createFastWorker(fastWork, { onMetric: event => console.log('[Orvix Fast worker]', JSON.stringify(event)) });
async function fastBrowserRequest(kind, input, signal) {
  if (signal?.aborted) return { status: 'cancelled' };
  const cancel = () => youtubeControl?.cancelBrowser([input.requestId]);
  signal?.addEventListener('abort', cancel, { once: true });
  try { return await youtubeControl?.browserRequest(kind, input) ?? { status: 'unavailable' }; }
  finally { signal?.removeEventListener('abort', cancel); }
}
let petWindow = null;
let petCaptureExcluded = false;
let petOutputState = { text: "", speaking: false };
let screenSharingController = null;
let petBoundsHistory = [];
function setPetCaptureExcluded(active) {
  if(active&&(process.platform!=='win32'||Number(require('node:os').release().split('.')[2])<19041))return false;
  petCaptureExcluded=active;
  if(petWindow&&!petWindow.isDestroyed()){
    petWindow.setContentProtection(active);
    return !active||petWindow.isContentProtected();
  }
  return true;
}
function getPetCaptureGuard(source) {
  if(!petCaptureExcluded)return null;
  const now=Date.now();petBoundsHistory=petBoundsHistory.filter(item=>now-item.at<2000);
  const currentPet=petWindow&&!petWindow.isDestroyed()?petWindow:null;
  if(currentPet?.isContentProtected()||!currentPet&&!petBoundsHistory.length)return {mode:'native',masks:[]};
  // Unconfirmed native exclusion requires a monitor-relative masking fallback.
  if(!source?.id.startsWith('screen:'))return null;
  const display=screen.getAllDisplays().find(d=>String(d.id)===source.display_id);
  if(!display)return null;
  const area=display.bounds;
  // Keep recent masks after hide/close too: a sampled bitmap can lag composition.
  const bounds=[...petBoundsHistory.map(item=>item.bounds),...(currentPet?[currentPet.getBounds()]:[])];
  return {mode:'masked',masks:bounds.map(b=>({x:(b.x-area.x-4)/area.width,y:(b.y-area.y-4)/area.height,width:(b.width+8)/area.width,height:(b.height+8)/area.height}))};
}
let activityTimer = null;
let petInteractive = false;
let credentials = null;
let searchKeys = null;
let agentEngine = null;
let openCodeHeadless = null;
let openCodePreferences = null;
let openCodeKeepAlive = false;
const deletingAgentTasks = new Set();
let taskStore = null;
let youtubeControl = null;
let activeAgentRunRequests = 0;
let agentPowerBlockerId = null;
let tinyAgents = null;
let constructionLocks = null;
let tinySensors = null;
let notifications = null;
let agentNotifications = null;
let startupSettings = null;
function refreshTinySensors() {
  const pending = tinySensors?.refresh();
  if (pending?.catch) void pending.catch(error => console.error('[Tiny Agents] Sensor refresh failed:', error.message));
}
async function executeWorkflowAction(action) {
  if(action.type==='open_url') return shell.openExternal(action.target);
  if(action.type==='open_path') {const error=await shell.openPath(action.target);if(error) throw new Error(error);return;}
  if(['focus_app','minimize_app'].includes(action.type)) {const result=await manageWindow({action:action.type==='focus_app'?'focus':'minimize',appName:action.target});if(!result?.ok) throw new Error(result?.error||'Application unavailable.');return;}
  throw new Error('Unsupported workflow action.');
}
const agentNotificationObservations = new Map();
let pcStatePoll = null;
const liveVoiceProfiles = new Set();
let tray = null;
let allowQuit = false;
const launchHidden = process.argv.includes("--hidden");
if (!ownsInstance) {
  console.log("[Orvix] An Orvix window is already open; focusing it instead");
  app.quit();
}

function createWindow(showOnReady = !launchHidden) {
  const window = new BrowserWindow({
    title: "Orvix",
    width: 1380,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    center: true,
    frame: false,
    show: false,
    backgroundColor: "#0d0d0d",
    icon: desktopIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });

  mainWindow = window;
  if (process.platform === 'win32') {
    window.setAppDetails({
      appId: windowAppUserModelId,
      appIconPath: desktopIconPath,
      appIconIndex: 0,
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Orvix',
    });
  }
  window.on('focus', () => window.flashFrame(false));
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) clearLiveVoiceRefresh(); });
  window.on('closed', () => { clearLiveVoiceRefresh(); });
  window.webContents.on('render-process-gone', () => { clearLiveVoiceRefresh(); });
  window.once("ready-to-show", () => { if (showOnReady) window.show(); });
  const replayTinyState = () => { if (tinyAgents) window.webContents.send('orvix:tiny-agent-event', { kind: 'sync', listing: tinyAgents.list() }); };
  window.on("show", () => { createPetWindow(); replayTinyState(); });
  window.on('restore', replayTinyState);
  window.on("close", event => {
    handleTinyWindowClose(event,{allowQuit,control:tinyRuntime?.health().control,
      stopVoice:()=>window.webContents.send('orvix:window-backgrounded'),
      hide:()=>{window.hide();closePetWindow();refreshTray();},quit:()=>app.quit(),
      notify:()=>notifications?.notify('Orvix is working in the tray','You enabled background Tiny Agents. Open Orvix or use Stop all in the tray to stop them.')});
  });
  window.webContents.on("did-finish-load", () => console.log("[Orvix] Local workspace loaded"));
  window.webContents.on("did-fail-load", (_event, code, description) => console.error(`[Orvix] Workspace load failed (${code}): ${description}`));
  window.on("closed", () => {
    console.log("[Orvix] Window closed");
    mainWindow = null;
    closePetWindow();
  });
  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
}

function getPetArea() {
  const areas = screen.getAllDisplays().map(display=>display.bounds);
  if(!areas.length)areas.push(screen.getPrimaryDisplay().bounds);
  const x=Math.min(...areas.map(area=>area.x)),y=Math.min(...areas.map(area=>area.y));
  const right=Math.max(...areas.map(area=>area.x+area.width)),bottom=Math.max(...areas.map(area=>area.y+area.height));
  const bounds=petWindow&&!petWindow.isDestroyed()?petWindow.getBounds():null;
  return {x,y,width:right-x,height:bottom-y,displays:areas.map(area=>({...area,x:area.x-x,y:area.y-y})),...(bounds?{petX:bounds.x-x+PET_LEFT,petY:bounds.y-y+PET_TOP}:{})};
}
function placePetAtGlobalAnchor(x,y) {
  if(!petWindow||petWindow.isDestroyed())return;
  // Transparent caption padding must not constrain the pet. The controller
  // owns body bounds and the angry return after an offscreen drag.
  petWindow.setPosition(Math.round(x-PET_LEFT),Math.round(y-PET_TOP),false);
  const now=Date.now();petBoundsHistory.push({at:now,bounds:petWindow.getBounds()});petBoundsHistory=petBoundsHistory.filter(item=>now-item.at<2000);
  petWindow.webContents.send('orvix:pet-position',getPetArea());
}
function refreshPetDisplays() {
  if(!petWindow||petWindow.isDestroyed())return;
  const bounds=petWindow.getBounds();
  const x=bounds.x+PET_LEFT,y=bounds.y+PET_TOP;
  const area=screen.getDisplayNearestPoint({x:x+88,y:y+80}).bounds;
  placePetAtGlobalAnchor(Math.max(area.x,Math.min(area.x+area.width-175,x)),Math.max(area.y,Math.min(area.y+area.height-205,y)));
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  petInteractive = false;
  petWindow = new BrowserWindow({
    title: "Orvix Pet",
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    x: area.x + Math.max(0, area.width - PET_WINDOW_WIDTH),
    y: area.y + Math.max(0, area.height - PET_WINDOW_HEIGHT),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow.setAlwaysOnTop(true, "screen-saver");
  if(petCaptureExcluded)petWindow.setContentProtection(true);
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.once("ready-to-show", () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.showInactive();
  });
  petWindow.on("closed", () => {
    petWindow = null;
    petInteractive = false;
  });
  petWindow.loadFile(path.join(__dirname, "..", "dist", "pet.html"));
  petWindow.webContents.once("did-finish-load", () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send("orvix:pet-output", petOutputState);
  });
}

function closePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.close();
  petWindow = null;
  petInteractive = false;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true);
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  }
}

function sendNotificationOpen(target) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:notification-open', target);
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function refreshTray() {
  if (!tray) return;
  const pending = tinyAgents?.list().shutdownPending;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Orvix", click: showMainWindow },
    { label: tinyRuntime?.health().control.status==='running' ? 'Stop all Tiny Agents' : 'Tiny Agents stopped', enabled: tinyRuntime?.health().control.status==='running', click: () => { void stopTinyWork().catch(error=>dialog.showErrorBox('Stopping needs attention',error.message)); } },
    ...(pending ? [{ label: "Cancel shutdown", click: () => tinyAgents?.cancelShutdown() }] : []),
    { type: "separator" },
    { label: "Quit Orvix", click: () => { allowQuit = true; app.quit(); } },
  ]));
  const control=tinyRuntime?.health().control;
  tray.setToolTip(pending ? 'Orvix · Shutdown pending' : 'Orvix · Tiny Agents '+(control?.status ?? 'starting')+(control?.backgroundEnabled?' · Background enabled':' · Close stops work'));
}

function notifyTinyAgent(title, body, meta) {
  if (!notifications) throw new Error('Notification service is not ready.');
  return notifications.notify(title, body, meta);
}

function startDesktopActivityMonitor() {
  if (activityTimer) clearInterval(activityTimer);
  activityTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isLoading()) return;
    if (powerMonitor.getSystemIdleTime() < 1) {
      petWindow.webContents.send("orvix:desktop-activity");
    }
  }, 1000);
}

ipcMain.handle("orvix:minimize", event => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle("orvix:toggle-maximize", event => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  window.isMaximized() ? window.unmaximize() : window.maximize();
  return window.isMaximized();
});
ipcMain.handle("orvix:close", event => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle("orvix:pet-screen-bounds", event => {
  if (!petWindow || event.sender !== petWindow.webContents) return null;
  return getPetArea();
});
ipcMain.on("orvix:pet-move", (event, x, y) => {
  if (!petWindow || event.sender !== petWindow.webContents || petWindow.isDestroyed()) return;
  if(event.senderFrame!==petWindow.webContents.mainFrame||!Number.isFinite(x)||!Number.isFinite(y))return;
  const area = getPetArea();
  placePetAtGlobalAnchor(area.x+x,area.y+y);
});
ipcMain.on("orvix:pet-interactive", (event, interactive) => {
  if (!petWindow || event.sender !== petWindow.webContents || petWindow.isDestroyed()) return;
  const next = Boolean(interactive);
  if (petInteractive === next) return;
  petInteractive = next;
  petWindow.setIgnoreMouseEvents(!next, { forward: true });
});
ipcMain.on("orvix:pet-close", event => {
  if (petWindow && event.sender === petWindow.webContents) closePetWindow();
});
function requireMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error("Unavailable from this window.");
}
ipcMain.on("orvix:pet-output-update", (event, value) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (event.senderFrame !== mainWindow.webContents.mainFrame) return;
  if (typeof value?.text === "string") petOutputState.text = value.text;
  if (typeof value?.speaking === "boolean") petOutputState.speaking = value.speaking;
  if (petWindow && !petWindow.isDestroyed() && !petWindow.webContents.isLoading()) {
    petWindow.webContents.send("orvix:pet-output", petOutputState);
  }
});
ipcMain.on("orvix:pet-output-ready", event => {
  if (petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents) {
    event.sender.send("orvix:pet-output", petOutputState);
  }
});
  ipcMain.handle("orvix:opencode-status", event => { requireMainWindow(event); return credentials.status(); });
  ipcMain.handle('orvix:agent-workers', event => { requireMainWindow(event); return openCodeHeadless?.status() ?? { running: false, keepAlive: openCodeKeepAlive, workers: {} }; });
ipcMain.handle('orvix:agent-worker-prepare', async (event, taskId, directory, modelId) => {
  requireMainWindow(event);
  if (directory !== undefined) {
    if (typeof directory !== 'string') throw new Error('Invalid OpenCode preparation folder.');
    agentEngine.workspaces.assert(taskId, directory);
  }
  if (modelId !== undefined && (typeof modelId !== 'string' || !/^opencode\/[\w.-]{1,150}$/.test(modelId))) throw new Error('Invalid OpenCode preparation model.');
  if (openCodeKeepAlive) await openCodeHeadless?.connectTask(taskId, undefined, directory, modelId);
});
ipcMain.handle('orvix:opencode-keepalive', async (event, value, taskId) => {
  requireMainWindow(event);
  if (value === undefined) return { keepAlive: openCodeKeepAlive };
  if (typeof value !== 'boolean') throw new Error('OpenCode keep-alive must be a boolean.');
  await openCodeHeadless?.setKeepAlive(value, taskId);
  const saved = openCodePreferences?.setKeepAlive(value) ?? { keepAlive: value };
  openCodeKeepAlive = saved.keepAlive;
  return { keepAlive: openCodeKeepAlive };
});
ipcMain.handle('orvix:opencode-models', async (event, force) => {
  requireMainWindow(event);
  const catalog = force === true ? await refreshOpenCodeCatalog(true) : getOpenCodeCatalog();
  if (force === true && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:opencode-catalog', catalog);
  return catalog;
});
ipcMain.handle('orvix:kilo-models', (event, force) => { requireMainWindow(event); return refreshKiloCatalog(force === true); });
ipcMain.handle('orvix:antigravity-models', (event, force) => { requireMainWindow(event); return refreshAntigravityCatalog(force === true); });
ipcMain.handle('orvix:antigravity-status', event => { requireMainWindow(event); return getAntigravityStatus(); });
ipcMain.handle('orvix:antigravity-start', event => { requireMainWindow(event); return startAntigravityServer(); });
ipcMain.handle('orvix:antigravity-stop', event => { requireMainWindow(event); return stopAntigravityServer(); });
ipcMain.handle("orvix:live-token", (event, profile, depth, recovery) => { requireMainWindow(event); return createLiveToken(profile, depth, recovery); });
ipcMain.on("orvix:voice-refresh", (event, profile, active) => {
  requireMainWindow(event);
  if (!['Fast', 'Thinking'].includes(profile) || typeof active !== 'boolean') return;
  const wasActive = liveVoiceProfiles.has(profile);
  if (active === wasActive) return;
  if (active) liveVoiceProfiles.add(profile);
  else liveVoiceProfiles.delete(profile);
  setLiveVoiceRefresh(liveVoiceProfiles.size > 0);
});
ipcMain.handle("orvix:weather", (event, input) => { requireMainWindow(event); return getWeather(input); });
const fastReadRequests = new Map();
async function runCancelableRead(event,input,run){
  requireMainWindow(event);
  const id=typeof input?.requestId==='string'?input.requestId:undefined;
  if(!id)return run(input);
  if(id.length>100||fastReadRequests.has(id))throw new Error('Invalid or duplicate read request ID.');
  const controller=new AbortController();fastReadRequests.set(id,{controller,sender:event.sender.id});
  try{return await run(input,{signal:controller.signal});}finally{fastReadRequests.delete(id);}
}
ipcMain.handle('orvix:cancel-fast-read',(event,id)=>{requireMainWindow(event);const request=fastReadRequests.get(id);if(request?.sender===event.sender.id)request.controller.abort();});
ipcMain.handle("orvix:search", (event, input) => runCancelableRead(event,input,searchWeb));
ipcMain.handle('orvix:search-keys-list', event => { requireMainWindow(event); return searchKeys.snapshot(); });
ipcMain.handle('orvix:search-keys-add', (event, input) => { requireMainWindow(event); return searchKeys.add(input); });
ipcMain.handle('orvix:search-keys-update', (event, id, input) => { requireMainWindow(event); return searchKeys.update(id, input); });
ipcMain.handle('orvix:search-keys-delete', (event, id) => { requireMainWindow(event); return searchKeys.remove(id); });
ipcMain.handle("orvix:read-search-page", (event, input) => runCancelableRead(event,input,readSearchResultPage));
ipcMain.handle("orvix:class10-book-search", async (event, input) => {
  requireMainWindow(event);
  return class10Textbooks.search(input, progress => {
    if (!event.sender.isDestroyed()) event.sender.send("orvix:textbook-progress", progress);
  });
});
ipcMain.handle("orvix:class10-book-pages", async (event, input) => {
  requireMainWindow(event);
  return class10Textbooks.readPages(input, progress => {
    if (!event.sender.isDestroyed()) event.sender.send("orvix:textbook-progress", progress);
  });
});
ipcMain.handle("orvix:live-read-file", (event, input) => { requireMainWindow(event); return readFile(input); });
const fastExplorer=createFastExplorer({shell,getSettings:()=>fastWork.settings(),paths:{
  get desktop(){return app.getPath('desktop');},get documents(){return app.getPath('documents');},
  get downloads(){return app.getPath('downloads');},get home(){return app.getPath('home');},workspace:path.resolve(__dirname,'..'),
}});
registerFastExplorerIpc(ipcMain,{requireSender:event=>{requireMainWindow(event);if(event.senderFrame!==event.sender.mainFrame)throw new Error('Unavailable from this frame.');},explorer:fastExplorer,serialize:run=>withResources(['interaction'],run)});
const fastFiles=createFastFiles({shell,resolveTarget:fastExplorer.resolveTarget,getSettings:()=>fastWork.settings()});
registerFastFilesIpc(ipcMain,{requireSender:event=>{requireMainWindow(event);if(event.senderFrame!==event.sender.mainFrame)throw new Error('Unavailable from this frame.');},files:fastFiles,serialize:run=>withResources(['interaction'],run)});
ipcMain.handle("orvix:live-write-file", (event, input) => { requireMainWindow(event); return writeFile(input); });
ipcMain.handle("orvix:clipboard", (event, input) => { requireMainWindow(event); return manageClipboard(input); });
ipcMain.handle("orvix:list-directory", (event, input) => { requireMainWindow(event); return listDirectory(input); });
ipcMain.handle("orvix:search-files", (event, input) => { requireMainWindow(event); return searchFiles(input); });
ipcMain.handle("orvix:search-content", (event, input) => { requireMainWindow(event); return searchContent(input); });
ipcMain.handle("orvix:manage-window", (event, input) => { requireMainWindow(event); return withResources(['interaction'],()=>manageWindow(input)); });
ipcMain.handle('orvix:fast-settings', event => { requireMainWindow(event); return fastWork.settings(); });
ipcMain.handle('orvix:startup-settings', event => {
  requireMainWindow(event);
  return startupSettings?.get() ?? { supported: false, enabled: false, appId };
});
ipcMain.handle('orvix:desktop-bar-state', event => {
  requireMainWindow(event);
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Unavailable from this frame.');
  return desktopBar?.getState() ?? { supported: process.platform === 'win32', enabled: false, status: 'off', error: '' };
});
ipcMain.handle('orvix:desktop-bar-set', (event, enabled) => {
  requireMainWindow(event);
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Unavailable from this frame.');
  if (!desktopBar) throw new Error('Desktop top bar settings are not ready yet.');
  return desktopBar.setEnabled(enabled);
});
ipcMain.handle('orvix:startup-settings-set', (event, enabled) => {
  requireMainWindow(event);
  if (typeof enabled !== 'boolean') throw new Error('Choose whether Orvix should start at sign-in.');
  if (!startupSettings) throw new Error('Startup settings are not ready yet.');
  return startupSettings.setStartAtLogin(enabled);
});
ipcMain.handle('orvix:fast-configure', async (event, input) => {
  requireMainWindow(event);
  if (input?.workerEnabled || input?.workerModel && fastWork.settings().workerEnabled) await fastWorker.validate(input.workerModel || fastWork.settings().workerModel);
  return fastWork.configure(input || {});
});
ipcMain.handle('orvix:fast-task', async (event, input) => { requireMainWindow(event); const task=fastWork.update(input); return fastWork.prepareWindowPlan(task.id); });
ipcMain.handle('orvix:fast-task-state', (event, id) => { requireMainWindow(event); return fastWork.task(id); });
ipcMain.handle('orvix:fast-plan', (event,id,input) => { requireMainWindow(event); return fastWork.registerPlan(id,input); });
ipcMain.handle('orvix:fast-review', (event,id,input) => { requireMainWindow(event); return fastWork.reviewCompletionGrounded(id,input); });
ipcMain.handle('orvix:fast-context', (event,id) => { requireMainWindow(event); return fastWork.taskContext(id); });
ipcMain.handle('orvix:fast-evidence-start', (event,id,tool,input) => { requireMainWindow(event); return fastWork.beginEvidence(id,tool,input); });
ipcMain.handle('orvix:fast-evidence-result', (event,id,token,tool,input,result) => { requireMainWindow(event); return fastWork.recordEvidence(id,token,tool,input,result); });
ipcMain.handle('orvix:fast-delivery', (event,id,state) => { requireMainWindow(event); return fastWork.delivery(id,state); });
ipcMain.handle('orvix:fast-execute', async (event, taskId, kind, input) => {
  requireMainWindow(event);
  if (kind === 'run_workflow') return fastWorker.run(taskId);
  if (kind === 'work_browser') return fastWork.workflow(taskId, input);
  const result = await fastWork.execute(taskId, kind, input);
  if (kind.endsWith('_act') && fastWork.settings().workerEnabled && result.task?.failures >= 2 && !['cancelled','confirmation_required','needs_selection'].includes(result.status)) {
    return { ...await fastWorker.run(taskId), routedToWorker: true };
  }
  return result;
});
ipcMain.on('orvix:fast-cancel', (event, taskId) => { requireMainWindow(event); fastWork.cancel(taskId); fastWorker.cancel(taskId); });
let simpleFastApprovalQueue = false;
ipcMain.handle('orvix:fast-approval-queue', (event, enabled) => {
  requireMainWindow(event); simpleFastApprovalQueue = enabled === true;
});
ipcMain.handle('orvix:fast-resume-approved', (event, id) => {
  requireMainWindow(event); return fastWork.resumeApproval(id);
});
ipcMain.handle('orvix:fast-approve', async (event, id, accepted) => {
  requireMainWindow(event); const found = fastWork.decide(id, accepted === true);
  if (found && accepted === true && !simpleFastApprovalQueue) await fastWork.resumeApproval(id);
  return found;
});

let pcMonitorProcess = null;
let pcHealthTimer = null;
let pcMonitorLeases = 0;

function pcMonitorIsRequired() {
  return liveVoiceProfiles.size > 0 || pcMonitorLeases > 0;
}

function ensurePcMonitorRunning() {
  if (!pcMonitorIsRequired()) return;
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, "PC-Monitor-Test", "bin", "PCMonitor.exe")
    : path.join(__dirname, "..", "PC-Monitor-Test", "bin", fs.existsSync(path.join(__dirname, "..", "PC-Monitor-Test", "bin", "PCMonitor.Fast.exe")) ? "PCMonitor.Fast.exe" : "PCMonitor.exe");
  if (!fs.existsSync(exePath)) return;
  if (pcMonitorProcess && !pcMonitorProcess.killed) return;
  try {
    const child = spawn(exePath, ["--quiet"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    pcMonitorProcess = child;
    child.on("error", err => {
      if (pcMonitorProcess === child) pcMonitorProcess = null;
      console.error("[Orvix] Could not start PCMonitor background daemon:", err);
    });
    child.on("exit", () => { if (pcMonitorProcess === child) pcMonitorProcess = null; });
    child.unref();
  } catch (err) {
    console.error("[Orvix] Could not start PCMonitor background daemon:", err);
  }
}

function stopPcMonitorRunning() {
  const child = pcMonitorProcess;
  pcMonitorProcess = null;
  if (child && !child.killed) {
    try { child.kill(); } catch {}
  }
}

function stopPcMonitorHealthTimer() {
  if (pcHealthTimer) clearInterval(pcHealthTimer);
  pcHealthTimer = null;
}

function stopPcStateWatcher() {
  if (stateReadTimer) clearTimeout(stateReadTimer);
  stateReadTimer = null;
  if (stateWatcher) {
    try { stateWatcher.close(); } catch {}
  }
  stateWatcher = null;
}

function syncPcMonitorLifecycle() {
  const voiceActive = liveVoiceProfiles.size > 0;
  if (!pcMonitorIsRequired()) {
    stopPcMonitorHealthTimer();
    stopPcStateWatcher();
    if (pcStatePoll) clearInterval(pcStatePoll);
    pcStatePoll = null;
    stopPcMonitorRunning();
    return;
  }

  ensurePcMonitorRunning();
  if (voiceActive) {
    startPcStateWatcher();
    if (pcStatePoll) clearInterval(pcStatePoll);
    pcStatePoll = stateWatcher ? null : setInterval(ingestPcState, 250);
    ingestPcState();
  } else {
    stopPcStateWatcher();
    if (pcStatePoll) clearInterval(pcStatePoll);
    pcStatePoll = null;
  }

  if (!pcHealthTimer) {
    pcHealthTimer = setInterval(() => {
      if (!pcMonitorIsRequired()) { syncPcMonitorLifecycle(); return; }
      const root = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
      const stateFile = path.join(root, "PCMonitorTest", "current-state.json");
      let fresh = false;
      try { fresh = Date.now() - fs.statSync(stateFile).mtimeMs < 15_000; } catch {}
      if (fresh) {
        if (liveVoiceProfiles.size > 0) ingestPcState();
        return;
      }
      stopPcMonitorRunning();
      ensurePcMonitorRunning();
    }, 15_000);
    pcHealthTimer.unref?.();
  }
}

function acquirePcMonitorLease() {
  pcMonitorLeases++;
  syncPcMonitorLifecycle();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pcMonitorLeases = Math.max(0, pcMonitorLeases - 1);
    syncPcMonitorLifecycle();
  };
}

async function withPcMonitorLease(operation) {
  const release = acquirePcMonitorLease();
  try { return await operation(); }
  finally { release(); }
}

function readPcState() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    const stateFile = path.join(localAppData, "PCMonitorTest", "current-state.json");
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    if (Date.now() - fs.statSync(stateFile).mtimeMs > 10000) return null;
    const raw = fs.readFileSync(stateFile, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getPcSnapshotWithWait(maxWaitMs = 1500) {
  const release = acquirePcMonitorLease();
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    const stateFile = path.join(localAppData, "PCMonitorTest", "current-state.json");
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (fs.existsSync(stateFile)) {
        try {
          if (Date.now() - fs.statSync(stateFile).mtimeMs > 10_000) throw new Error("PC monitor snapshot is stale.");
          const raw = fs.readFileSync(stateFile, "utf8").replace(/^\uFEFF/, "");
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.Windows) && parsed.Windows.length > 0) {
            return parsed;
          }
        } catch {
          // File may be partially written, wait for next tick
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return readPcState();
  } finally {
    release();
  }
}

let stateWatcher = null;
let stateReadTimer = null;
let lastStateModified = 0;

function ingestPcState() {
  const root = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const file = path.join(root, 'PCMonitorTest', 'current-state.json');
  try {
    const before = fs.statSync(file).mtimeMs;
    if (Date.now() - before > 10000) return;
    const state = readPcState();
    if (!state || fs.statSync(file).mtimeMs !== before) return;
    tinyAgents?.ingest(state, Date.now(), before);
    tinyWorkflows?.ingest(state,before);
    if (before !== lastStateModified) {
      lastStateModified = before;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:pc-event', state);
    }
  } catch { /* Atomic writes and transient sharing violations are retried by polling. */ }
}

function startPcStateWatcher() {
  if (stateWatcher) return;
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
  const stateDir = path.join(localAppData, "PCMonitorTest");
  try {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    stateWatcher = fs.watch(stateDir, (eventType, filename) => {
      if (filename && filename.toLowerCase().includes("current-state.json")) {
        clearTimeout(stateReadTimer);
        stateReadTimer = setTimeout(ingestPcState, 15);
      }
    });
  } catch {
    // Non-blocking
  }
  ingestPcState();
}

function setLiveVoiceRefresh(active) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setBackgroundThrottling(!active);
  }
  syncPcMonitorLifecycle();
  tinyAgents?.setVoiceActive(active);
  tinyWorkflows?.setVoiceActive(active);
}

function clearLiveVoiceRefresh() {
  liveVoiceProfiles.clear();
  setLiveVoiceRefresh(false);
}

ipcMain.handle("orvix:pc-snapshot", async () => {const snapshot=await getPcSnapshotWithWait(1500),BrowserContext=youtubeControl?.browserContext();return snapshot?{...snapshot,BrowserContext}:BrowserContext?.connected?{Windows:[],Browsers:[],Media:[],BrowserContext}:null;});
ipcMain.handle('orvix:browser-observe', (event, input) => { requireMainWindow(event); return youtubeControl?.browserRequest('observe', input) ?? { status: 'unavailable' }; });
ipcMain.handle('orvix:browser-act', (event, input) => withResources(['interaction'],async () => {
  requireMainWindow(event);
  const restore = ['youtube_pause', 'youtube_resume'].includes(input?.action);
  const foregroundHandle = restore ? await getForegroundHandle() : 0;
  const result = await youtubeControl?.browserRequest('act', input) ?? { status: 'unavailable' };
  if (restore) {
    const focus = foregroundHandle > 0 ? await manageWindow({ action: 'focus', handle: foregroundHandle }).catch(() => null) : null;
    result.restoredForeground = !!focus?.ok;
    if (result.status === 'ok' && !focus?.ok) {
      result.status = 'partial';
      result.message = 'Playback changed, but the previous desktop window could not be restored.';
    }
  }
  return result;
}));ipcMain.handle('orvix:browser-status', event => { requireMainWindow(event); return youtubeControl?.browserStatus() ?? { connected: false, capabilities: {} }; });
ipcMain.on('orvix:browser-cancel', (event, ids) => { requireMainWindow(event); if (Array.isArray(ids)) youtubeControl?.cancelBrowser(ids.filter(id => typeof id === 'string')); });
ipcMain.handle("orvix:youtube-action", (event, input) => withResources(['interaction'],async () => {
  requireMainWindow(event);
  console.log('[Orvix YouTube] Desktop IPC request', JSON.stringify(input));
  const action = input?.action;
  const restore = action === "pause" || action === "resume";
  const foregroundHandle = restore ? await getForegroundHandle() : 0;
  if (!youtubeControl) return { status: "unavailable", message: "YouTube control is not running." };
  let result;
  try {
    result = await youtubeControl.execute(input, foregroundHandle);
  } finally {
    if (restore) {
      const focus = foregroundHandle > 0 ? await manageWindow({ action: "focus", handle: foregroundHandle }) : null;
      if (result) {
        result.restoredForeground = !!focus?.ok;
        if (result.status === "ok" && !result.restoredForeground) {
          result.status = "partial";
          result.message = "YouTube playback changed, but the previous desktop window could not be restored.";
        }
      }
    }
  }
  console.log('[Orvix YouTube] Desktop IPC result', JSON.stringify(result));
  return result;
}));
function terminalSafeValue(value, key = "", depth = 0) {
  if (/api.?key|access.?token|refresh.?token|password|secret|authorization|cookie|credential|inline.?data|base64|resume.?handle/i.test(key)) return "[redacted]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 12000 ? `${value.slice(0, 12000)}… [truncated ${value.length - 12000} chars]` : value;
  if (depth >= 6) return "[nested details omitted]";
  if (Array.isArray(value)) return value.slice(0, 40).map(item => terminalSafeValue(item, key, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 80).map(([childKey, childValue]) => [childKey, terminalSafeValue(childValue, childKey, depth + 1)]));
  return String(value);
}

function logTerminalEvent(source, event, details) {
  const eventTime = typeof details?.at === "number" ? details.at : typeof details?.at === "string" ? Date.parse(details.at) : NaN;
  const time = new Date(Number.isFinite(eventTime) ? eventTime : Date.now()).toLocaleTimeString();
  const safe = terminalSafeValue(details);
  let serialized = safe && typeof safe === "object" && Object.keys(safe).length ? JSON.stringify(safe, null, 2) : "";
  if (serialized.length > 24000) serialized = `${serialized.slice(0, 24000)}\n… [event details shortened]`;
  const body = serialized ? `\n${serialized.split("\n").map(line => `  ${line}`).join("\n")}` : "";
  console.log(`[${time}] [${source}] ${event}${body}`);
}

ipcMain.on("orvix:live-log", (_event, type, message, details) => {
  if (typeof message === "string" && message.startsWith("[ThinkingVoice trace] ")) {
    requireMainWindow(_event);
    const traceFile = path.join(app.getPath("userData"), "logs", "thinking-live.jsonl");
    try {
      appendThinkingTrace(traceFile, details);
    } catch (error) {
      console.warn("[Orvix] Could not save Thinking trace:", error.message);
    }
    const data = details?.data?.data ?? details?.data ?? {};
    const labels = {
      connection_setup: "Connection setup", connection_ready: "Connection ready", turn_start: "Turn started",
      user_text_sent: "User text sent", user_transcription: "USER SAID", model_transcription: "MODEL SAID",
      tool_received: "MODEL REQUESTED TOOL", tool_completed: "TOOL RETURNED", tool_failed: "TOOL FAILED",
      tool_cancelled: "TOOL CANCELLED", tool_skipped: "TOOL SKIPPED", response_queued: "Tool response queued",
      response_submit: "Submitting tool result to model", response_submitted: "SDK accepted tool result submission (provider receipt not available)",
      response_submission_failed: "Tool result submission failed", turn_idle: "Turn finished",
      speech_interrupted: "Assistant speech interrupted", connection_close: "Connection closed",
      server_event: "Live API event", response_discarded: "Tool result discarded",
    };
    logTerminalEvent("Thinking", labels[details?.event] || details?.event || message, {
      at: details?.at, turnId: details?.turnId, sequence: details?.sequence, elapsedMs: details?.elapsedMs,
      ...data, traceTruncated: details?.data?.truncated || undefined, traceRedacted: details?.data?.redacted || undefined,
      ...(details?.event === "connection_setup" ? { traceFile } : {}),
    });
    return;
  }
  const time = new Date().toLocaleTimeString();
  const label = type === "error" ? "Error" : type === "warn" ? "Warning" : type.toUpperCase();
  const line = `[${time}] [Orvix Live ${label}] ${message}`;
  if (type === "error") {
    console.error(`\n------------------ [ORVIX ERROR DIAGNOSTIC: ${time}] ------------------`);
    console.error(line);
    if (details !== undefined && details !== null && details !== "") {
      if (typeof details === "object") {
        for (const [k, v] of Object.entries(terminalSafeValue(details))) {
          if (k === "stack" && typeof v === "string") {
            console.error(`   ${k}:`);
            v.split("\n").forEach(sLine => console.error(`     ${sLine}`));
          } else {
            console.error(`   ${k}:`, typeof v === "object" ? JSON.stringify(v, null, 2) : v);
          }
        }
      } else {
        console.error("   details:", details);
      }
    }
    console.error(`------------------------------------------------------------------------\n`);
  } else if (type === "warn") {
    if (details !== undefined && details !== "") logTerminalEvent("Orvix Warning", message, details);
    else console.warn(line);
  } else {
    if (details !== undefined && details !== "") logTerminalEvent(`Orvix Live ${label}`, message, details);
    else console.log(line);
  }
});
const agentProviderName = modelId => { const id = String(modelId ?? ''); if (id.startsWith('antigravity/')) return 'I/O'; if (id.startsWith('kilo/')) return 'Kilo'; const prefix = id.split('/')[0]; return ({ google: 'Google', groq: 'Groq', cerebras: 'Cerebras', nara: 'Nara', routeway: 'Routeway', requesty: 'Requesty', inception: 'Inception AI' })[prefix] ?? 'OpenCode'; };
ipcMain.handle("orvix:opencode-set-key", (event, tier, key) => { requireMainWindow(event); return credentials.setKey(tier, key); });
ipcMain.handle('orvix:agent-provider-key-change', (event, tier, input) => { requireMainWindow(event); return credentials.changeApiKey(tier, input); });
ipcMain.handle("orvix:agent-run", async (event, input) => {
  requireMainWindow(event);
  if (deletingAgentTasks.has(input?.taskId) || taskStore.isDeleted(input?.taskId)) return { ok: false, error: 'This chat is being deleted or has already been deleted. Start a new chat.' };
  activeAgentRunRequests++;
  const time = new Date().toLocaleTimeString();
  try {
    if (agentPowerBlockerId === null) agentPowerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    const imageCount = Array.isArray(input?.images) ? input.images.length : 0;
    console.log(`[${time}] [Orvix Agent TURN] Starting task ${String(input?.taskId ?? '').slice(0, 100)}${imageCount ? ` with ${imageCount} reference image(s)` : ''}`);
    logTerminalEvent("Agent", "USER REQUEST", { taskId: input?.taskId, requestId: input?.requestId, text: String(input?.messages?.at?.(-1)?.content ?? input?.goal ?? "") });
    // Commit the request before starting: renderer history is normally debounced.
    if (input && [input.taskId, input.requestId].every(value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)) && Array.isArray(input.messages)) {
      const saved = taskStore.read();
      const now = Date.now();
      const prompt = String(input.messages.at(-1)?.content ?? '').slice(0, 100000);
      let task = saved.find(item => item.id === input.taskId);
      if (!task) { task = { id: input.taskId, title: String(input.goal || prompt || 'Agent task').slice(0, 80), projectId: null, accessMode: input.accessMode, accessModeVersion: input.accessModeVersion, modelId: input.modelId, thinkingVariant: input.thinkingVariant, turns: [], updatedAt: now }; saved.push(task); }
      let turn = task.turns.find(item => item.id === input.requestId);
      // Keep review preference in the committed turn even if the renderer reloads.
      if (!turn) { turn = { id: input.requestId, prompt, sentContent: prompt, attachments: input.images?.map(image => image.name) ?? [], provider: agentProviderName(input.modelId), modelId: input.modelId, thinkingVariant: input.thinkingVariant, accessMode: input.accessMode, specialty: input.specialty, createdAt: now }; task.turns.push(turn); }
      if (!agentEngine.isRunning(input.taskId)) { turn.designProfile = input.designProfile ?? turn.designProfile ?? require('./agent/design-profile.cjs').resolveDesignProfile(undefined, input.designReviewMode ?? turn.designReviewMode); require('./agent/design-profile.cjs').resolveDesignProfile(turn.designProfile); input.designProfile = turn.designProfile; task.designProfile = turn.designProfile; turn.designReviewMode = input.designReviewMode ?? turn.designReviewMode ?? 'fast'; turn.provider = agentProviderName(input.modelId); turn.modelId = input.modelId; turn.thinkingVariant = input.thinkingVariant; task.modelId = input.modelId; task.thinkingVariant = input.thinkingVariant; turn.status = 'pending'; turn.runStartedAt = now; turn.completedAt = undefined; turn.error = undefined; task.updatedAt = now; taskStore.write(saved); }
    }
    const result = await agentEngine.run(input);
    console.log(`[${time}] [Orvix Agent TURN] Orvix: Response saved`);
    return { ok: true, result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Agent run failed.";
    console.error(`[${time}] [Orvix Agent Error] ${msg}`);
    return { ok: false, error: msg };
  } finally {
    activeAgentRunRequests--;
    if (activeAgentRunRequests === 0 && agentPowerBlockerId !== null) {
      powerSaveBlocker.stop(agentPowerBlockerId);
      agentPowerBlockerId = null;
    }
  }
});
ipcMain.on("orvix:agent-cancel", (event, taskId) => { requireMainWindow(event); agentEngine.cancel(taskId); });
ipcMain.handle("orvix:agent-steer", (event, taskId, text) => { requireMainWindow(event); return agentEngine.steer(taskId, text); });
ipcMain.handle("orvix:agent-approve", (event, approvalId, accepted) => { requireMainWindow(event); return agentEngine.decide(approvalId, accepted); });
ipcMain.handle("orvix:agent-approval-diff", (event, approvalId, file) => { requireMainWindow(event); return agentEngine.approvalDiff(approvalId, file); });
ipcMain.handle("orvix:agent-changes", (event, taskId) => { requireMainWindow(event); return agentEngine.changes.list(taskId); });
ipcMain.handle("orvix:agent-workspaces", (event, taskId) => { requireMainWindow(event); return agentEngine.workspaces.list(taskId); });
ipcMain.handle("orvix:agent-workspace-files", (event, taskId, root) => { requireMainWindow(event); return agentEngine.workspaceBrowser.list(taskId, root); });
ipcMain.handle("orvix:agent-workspace-file", (event, taskId, file) => { requireMainWindow(event); return agentEngine.workspaceBrowser.read(taskId, file); });
ipcMain.handle('orvix:agent-pending-approval', (event, taskId) => { requireMainWindow(event); return agentEngine.pendingApproval(taskId); });
ipcMain.handle('orvix:agent-scorecard', (event, taskId) => { requireMainWindow(event); return agentEngine.runState.scorecard(taskId); });
ipcMain.handle('orvix:agent-run-state', (event, taskId, requestId) => { requireMainWindow(event); return agentEngine.runState.latest(taskId, requestId); });
ipcMain.handle("orvix:agent-checkpoint", (event, taskId) => { requireMainWindow(event); return agentEngine.journal.metadata(taskId); });
ipcMain.handle('orvix:agent-question', (event, taskId, requestId) => { requireMainWindow(event); return agentEngine.pendingQuestion(taskId, requestId); });
ipcMain.handle('orvix:agent-answer-question', (event, questionId, answer) => { requireMainWindow(event); return agentEngine.answerQuestion(questionId, answer); });
ipcMain.handle('orvix:agent-review-image', (event, taskId, requestId, imageId) => {
  requireMainWindow(event);
  if (deletingAgentTasks.has(taskId) || taskStore.isDeleted(taskId)) throw new Error('This Agent task is no longer available.');
  const savedTask = taskStore.read().find(task => task.id === taskId);
  const savedTurn = savedTask?.turns?.find(turn => turn.id === requestId);
  const savedActivityAllowsImage = savedTurn?.activity?.some(item => item && typeof item === 'object'
    && item.name === 'design_review' && Array.isArray(item.reviewImages)
    && item.reviewImages.some(image => image?.id === imageId)) === true;
  return agentEngine.imageStore.readReviewImage(taskId, requestId, imageId, savedActivityAllowsImage);
});
ipcMain.handle("orvix:agent-task-memory", (event, taskId) => {
  requireMainWindow(event);
  const memory = agentEngine.taskMemory.read(taskId);
  return memory?.status === "running" && !agentEngine.isRunning(taskId)
    ? { ...memory, status: "stopped", stopReason: "The previous run ended before a final result was saved." }
    : memory;
});
ipcMain.handle('orvix:agent-execution', (event, taskId, requestId, refresh) => { requireMainWindow(event); return agentEngine.getExecution(taskId, requestId, { refresh: refresh === true }); });
ipcMain.handle('orvix:agent-evidence-list', (event, taskId, requestId, offset) => { requireMainWindow(event); return agentEngine.evidence.list(taskId, requestId, offset); });
ipcMain.handle('orvix:agent-evidence-read', (event, taskId, requestId, id, offset) => { requireMainWindow(event); return agentEngine.evidence.read(taskId, requestId, id, offset); });
ipcMain.handle("orvix:agent-sandbox-status", event => { requireMainWindow(event); return agentEngine.sandbox.status(); });
ipcMain.handle("orvix:agent-diff", (event, taskId, file) => { requireMainWindow(event); return agentEngine.changes.diff(taskId, file); });
ipcMain.handle("orvix:agent-turn-report", (event, taskId, requestId) => { requireMainWindow(event); return agentEngine.turnReports.report(taskId, requestId); });
ipcMain.handle("orvix:agent-turn-diff", (event, taskId, requestId, file) => { requireMainWindow(event); return agentEngine.turnReports.diff(taskId, requestId, file); });
ipcMain.handle("orvix:agent-restore", (event, taskId, file) => { requireMainWindow(event); if (agentEngine.isRunning(taskId)) throw new Error("Stop the agent before restoring changes."); return file ? agentEngine.changes.restore(taskId, file) : agentEngine.changes.restoreAll(taskId); });
ipcMain.handle("orvix:agent-forget", async (event, taskId) => {
  requireMainWindow(event);
  require('./agent/durable-store.cjs').validId(taskId);
  if (agentEngine.isRunning(taskId) || deletingAgentTasks.has(taskId)) throw new Error("Stop the agent before deleting its records.");
  deletingAgentTasks.add(taskId);
  try {
    await openCodeHeadless?.forget(taskId);
    agentEngine.runState.forget(taskId); agentEngine.evidence.forget(taskId); agentEngine.execution.forget(taskId);
    agentEngine.changes.forget(taskId); agentEngine.turnReports.forget(taskId); agentEngine.workspaces.forget(taskId);
    agentEngine.journal.forget(taskId); agentEngine.taskMemory.forget(taskId); agentEngine.imageStore.forget(taskId);
    taskStore.forget(taskId);
  } finally { deletingAgentTasks.delete(taskId); }
});
ipcMain.handle("orvix:agent-tasks-read", event => { requireMainWindow(event); return agentEngine.reconcileTasks(taskStore.read()); });
ipcMain.handle('orvix:agent-notifications-read', event => { requireMainWindow(event); return agentNotifications?.list() ?? { items: [], storageError: null }; });
ipcMain.handle('orvix:agent-notifications-mark-read', (event, id) => { requireMainWindow(event); return agentNotifications?.markRead(id) ?? false; });
ipcMain.handle('orvix:agent-notifications-mark-all-read', event => { requireMainWindow(event); return agentNotifications?.markAllRead() ?? { items: [], storageError: null }; });
ipcMain.handle("orvix:agent-tasks-write", (event, tasks) => { requireMainWindow(event); return taskStore.write(tasks); });
ipcMain.handle("orvix:tiny-agents-list", event => { requireMainWindow(event); return tinyAgents.list(); });
ipcMain.handle('orvix:tiny-workflows-list', event => { requireMainWindow(event); return tinyWorkflows.list(); });
ipcMain.handle('orvix:tiny-runtime-health', event => { requireMainWindow(event); return {...(tinyRuntime?.health() ?? { status: 'starting', lastSeenAt: 0 }),protectionStatus:constructionLocks?.status()}; });
async function stopTinyWork() {
  return stopTinyRuntimeAndUnlock(tinyRuntime,constructionLocks);
}
ipcMain.handle('orvix:tiny-runtime-control', async (event,input) => { requireMainWindow(event); if(input?.action==='stop')return stopTinyWork();return tinyRuntime.control(input); });
ipcMain.handle('orvix:tiny-workflows-capabilities', event => { requireMainWindow(event); return tinyWorkflows.capabilities(); });
ipcMain.handle('orvix:tiny-workflows-inspect', (event,input) => { requireMainWindow(event); return tinyWorkflows.inspect(input); });
ipcMain.handle('orvix:tiny-workflows-history', (event,input) => { requireMainWindow(event); return tinyWorkflows.history(input); });
ipcMain.handle('orvix:tiny-workflows-draft', (event,input) => { requireMainWindow(event); return tinyWorkflows.draft(input); });
ipcMain.handle('orvix:tiny-workflows-manage', (event,input) => { requireMainWindow(event); return tinyWorkflows.manage(input); });
ipcMain.handle('orvix:tiny-workflows-human-input', (event,input) => { requireMainWindow(event); return tinyWorkflows.recordVoiceInput(input); });
ipcMain.handle('orvix:construction-lock-list', event => { requireMainWindow(event); return constructionLocks.list(); });
ipcMain.handle('orvix:construction-lock-preview', (event,input) => {requireMainWindow(event);return constructionLocks.preview(input);});
ipcMain.handle('orvix:construction-lock-start', (event, input) => { requireMainWindow(event);if(!input?.reviewId)throw Error('Check and review the selected paths before activation.');return constructionLocks.start(input); });
ipcMain.handle('orvix:construction-lock-control', async(event,input)=>{
  requireMainWindow(event);
  if(input?.action==='cancel_activation')return constructionLocks.cancelActivation();
  if(input?.action==='check_access')return constructionLocks.checkAccess(input.id);
  if(input?.action==='test_message'){await constructionLocks.testMessage();return {message:'Test message acknowledged. No permissions changed.'};}
  if(input?.action==='retry_message')return constructionLocks.retryMessage();
  if(!['reveal_target','reveal_recovery','copy_recovery'].includes(input?.action))throw Error('Choose a supported Construction Lock control.');
  const record=constructionLocks.details(input.id);if(!record)throw Error('There is no lock or recovery journal to inspect.');
  if(input.action==='copy_recovery'){clipboard.writeText(JSON.stringify({id:record.id,status:record.status,targets:record.targets,recoveryDirectory:record.recoveryDirectory,recoveryLauncher:record.recoveryLauncher},null,2));return {message:'Recovery details copied.'};}
  if(input.action==='reveal_target'&&(!Number.isInteger(input.index)||input.index<0||input.index>=record.targets.length))throw Error('Choose a listed protected path.');
  const target=input.action==='reveal_recovery'?record.recoveryLauncher:record.targets?.[input.index];
  if(!target||!fs.existsSync(target))throw Error('The selected path is unavailable. Refresh status and inspect recovery.');
  shell.showItemInFolder(target);return {message:'Explorer reveal requested.'};
});
ipcMain.handle('orvix:construction-lock-unlock', (event, id) => { requireMainWindow(event); return constructionLocks.unlock(id); });
ipcMain.handle('orvix:construction-lock-recovery', event => { requireMainWindow(event); const file = constructionLocks.list().lock?.recoveryLauncher; if (file && fs.existsSync(file)) shell.showItemInFolder(file); });
ipcMain.handle('orvix:tiny-staging-create', (event, input) => { requireMainWindow(event); return require('./tiny-staging.cjs').createStagingCopy(input); });
ipcMain.handle("orvix:tiny-agents-draft", (event, input) => { requireMainWindow(event); return tinyAgents.draft(input); });
ipcMain.handle("orvix:tiny-agents-approve", (event, id) => { requireMainWindow(event); return tinyAgents.approve(id); });
ipcMain.handle("orvix:tiny-agents-enabled", (event, id, enabled) => { requireMainWindow(event); return tinyAgents.setEnabled(id, enabled); });
ipcMain.handle("orvix:tiny-agents-delete", (event, id) => { requireMainWindow(event); return tinyAgents.remove(id); });
ipcMain.handle("orvix:tiny-agents-cancel-shutdown", event => { requireMainWindow(event); return tinyAgents.cancelShutdown(); });
ipcMain.handle('orvix:tiny-agents-retry-notification', (event, id) => { requireMainWindow(event); return tinyAgents.retryNotification(id); });
ipcMain.handle('orvix:tiny-agents-preview', (event, input) => { requireMainWindow(event); return tinyAgents.preview(input); });
ipcMain.handle('orvix:tiny-agents-snooze', (event, id, seconds) => { requireMainWindow(event); return tinyAgents.snooze(id, seconds); });
ipcMain.handle('orvix:tiny-agents-duplicate', (event, id) => { requireMainWindow(event); return tinyAgents.duplicate(id); });
ipcMain.handle('orvix:tiny-agents-pick-path', async (event, kind) => {
  requireMainWindow(event);
  if (!['file', 'folder', 'app'].includes(kind)) throw new Error('Choose file, folder or app.');
  const result = await dialog.showOpenDialog(mainWindow, { title: kind === 'app' ? 'Choose an application' : `Choose a ${kind}`, properties: [kind === 'folder' ? 'openDirectory' : 'openFile'], ...(kind === 'app' ? { filters: [{ name: 'Applications', extensions: ['exe'] }] } : {}) });
  return result.canceled ? null : result.filePaths[0] || null;
});
ipcMain.handle('orvix:notification-test', event => {
  requireMainWindow(event);
  return notifications.notify('Your Orvix notifications are ready', 'This is a test notification. Tiny Agents will use this same delivery path when their conditions are met.', { kind: 'notify' });
});

if (ownsInstance) {
  app.on("second-instance", () => {
    const window = mainWindow;
    if (window) {
      showMainWindow();
    }
  });
  app.whenReady().then(async () => {
    startupSettings = createStartupSettings({
      app,
      file: path.join(app.getPath('userData'), 'startup-settings.json'),
      appId,
    });
    try { startupSettings.initialize(); }
    catch (error) { console.error('[Orvix] Could not apply the default-off sign-in setting:', error.message); }
    desktopBar = createDesktopBar({ app, BrowserWindow, ipcMain, screen, shell, onChange: state => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:desktop-bar-state-changed', state);
    } });
    screen.on('display-added',refreshPetDisplays);
    screen.on('display-removed',refreshPetDisplays);
    screen.on('display-metrics-changed',refreshPetDisplays);
    console.log("[Orvix] Desktop shell ready");
    if (process.platform === 'win32') {
      // Re-run after Electron startup in case it stamped its generic shortcut
      // with this process's AUMID while registering the app.
      const shortcutResult = repairWindowsNotificationShortcut(true);
      if (shortcutResult.errors.length) console.warn('[Notifications] Start Menu shortcut setup:', shortcutResult.errors.join(' '));
      else console.log(`[Notifications] Start Menu shortcuts ready (${shortcutResult.updated} updated${shortcutResult.created ? ', fallback created' : ''}).`);
    }
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const selectedDisplay=screenSharingController?.canGrantDisplayMediaPermission(webContents,details)===true;
      // Electron also requests 'media' with an empty mediaTypes list for display capture.
      callback(webContents === mainWindow?.webContents && (permission === 'display-capture' && selectedDisplay || permission === 'media' && (details.mediaTypes?.includes('audio') === true && !details.mediaTypes?.includes('video') || details.mediaTypes?.length===0 && selectedDisplay)));
    });
    screenSharingController=installScreenSharing({session:session.defaultSession,ipcMain,desktopCapturer,getMainWindow:()=>mainWindow,setPetCaptureExcluded,getPetCaptureGuard});
    credentials = createCredentials(app, safeStorage, { envFilePath: app.isPackaged
      ? path.join(app.getPath('userData'), '.env')
      : path.join(__dirname, '..', '.env') });
    openCodePreferences = createOpenCodePreferences(app.getPath('userData'));
    openCodeKeepAlive = openCodePreferences.getKeepAlive();
    openCodeHeadless = createOpenCodeWorkers(app.getPath('userData'),{getProviderKey:()=>credentials.getKey('zen'), keepAlive: openCodeKeepAlive});
    if (openCodeKeepAlive) void openCodeHeadless.connect().catch(error => console.error('[Orvix] OpenCode keep-alive startup failed:', error.message));
    configureOpenCodeCatalog(app.getPath('userData'), openCodeHeadless, catalog => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:opencode-catalog', catalog);
    });
    configureOpenCodeModel(openCodeHeadless);
    configureKiloCatalog(app.getPath('userData'), () => credentials.getKey('kilo'));
    void refreshKiloCatalog();
    searchKeys = createSearchKeyStore(app, safeStorage, data => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:search-keys-changed', data);
    });
    configureSearchKeys(searchKeys);
    taskStore = createTaskStore(app);
    agentNotifications = createAgentNotifications({
      file: path.join(app.getPath('userData'), 'agent-notifications.json'),
      Notification,
      platform: process.platform,
      shouldToast: () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        return !focusedWindow || focusedWindow.isDestroyed() || focusedWindow.isMinimized() || !focusedWindow.isVisible();
      },
      onChange: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:agent-notifications', value); },
      onOpen: target => { showMainWindow(); sendNotificationOpen(target); },
      onAttention: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(true);
      },
      onNativeToast: () => {
        const repair = () => {
          const result = repairWindowsNotificationShortcut();
          if (result.errors.length) console.warn('[Notifications] Post-toast shortcut repair:', result.errors.join(' '));
        };
        repair();
        if (notificationShortcutRepairTimer) clearTimeout(notificationShortcutRepairTimer);
        notificationShortcutRepairTimer = setTimeout(() => {
          notificationShortcutRepairTimer = null;
          repair();
        }, 750);
        notificationShortcutRepairTimer.unref?.();
      },
    });
    agentEngine = createAgentEngine(app, credentials, event => {
      if (event?.type !== "run_state" && !(event?.type === "model_progress" && event.progressKind === "provider_reasoning")
        && !(event?.type === "tool" && event.phase === "update")) {
        const titles = {
          activity: "Agent activity", tool: "Agent tool action", model_progress: `Model progress (${event.progressKind || "status"})`,
          stream: "MODEL SAID (stream)", changes: "Workspace changes", approval: "Approval state",
          clarification: "Agent needs clarification", execution: "Command execution", steer: "User steering",
          context: "Context update", workspaces: "Workspace selection",
        };
        logTerminalEvent("Agent", titles[event?.type] || `Agent ${event?.type || "event"}`, event);
      }
      agentNotifications?.handleEvent(event);
      workflowAdapters?.projectEvent(event);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("orvix:agent-event", event);
      }, file => shell.openPath(file), {
        workflowAuthorize: input => workflowAdapters?.authorizeProject(input),
        nativeSnapshot: async () => withPcMonitorLease(() => require('./agent/native-snapshot.cjs').readNativeSnapshot(path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'PCMonitorTest', 'current-state.json'), { ensureRunning: ensurePcMonitorRunning, readState: readPcState })),
        browserSnapshot: async () => {
          const result = await youtubeControl?.browserRequest('observe', { scope: 'browser' });
          return result ? { ...result, observedAt: Date.now() } : { status: 'unavailable', reason: 'Browser companion is unavailable.', observedAt: Date.now() };
        },
        notifyTest: async () => notifications ? notifications.notify('Orvix workflow verification', 'This notification checks actual desktop display.', { kind: 'notify' }) : { status: 'failed', reason: 'Notification service is unavailable.' },
        notificationStatus: id => agentNotificationObservations.get(id) ?? null,
      });
    // File delivery depends on the engine and must be ready before the renderer loads.
    require('./agent/file-delivery.cjs').registerFileDeliveryIpc(ipcMain, { getMainWindow: () => mainWindow, delivery: agentEngine.fileDelivery, shell });
    notifications = createNotifications({ BrowserWindow, ipcMain, screen,
      onStatus: value => {
        agentNotificationObservations.set(value.id, { ...agentNotificationObservations.get(value.id), ...value });
        while (agentNotificationObservations.size > 200) agentNotificationObservations.delete(agentNotificationObservations.keys().next().value);
        tinyAgents?.notificationStatus(value);
        tinyWorkflows?.notificationStatus(value);
      },
      onOpen: notice => {
        showMainWindow();
        sendNotificationOpen({ type: 'tiny-agent', ruleId: notice.ruleId ?? null });
      },
      onCancelShutdown: ruleId => {
        if (tinyAgents?.list().shutdownPending?.ruleId === ruleId) tinyAgents.cancelShutdown();
      },
    });
    notifications.warmup();
    constructionLocks = createConstructionLocks(app, {
      showRestricted: attempt => {showMainWindow();return dialog.showMessageBox(mainWindow,restrictionDialogOptions(attempt));},
      onMessageStatus:value=>{if(value.status==='failed')void Promise.resolve(notifications.notify('Orvix — restriction message needs attention','Windows captured a denied attempt, but the native message failed. Open Construction Lock to review and retry.',{id:'construction-message-'+value.attemptId,kind:'notify'})).catch(error=>console.error('[Construction Lock] Fallback notification:',error.message));},
    });
    youtubeControl = createYoutubeControl();
    workflowAdapters = createWorkflowAdapters({work:fastWork,worker:fastWorker,agent:()=>agentEngine,credentials,construction:()=>constructionLocks,search:searchWeb,readPage:readSearchResultPage,browserStatus:()=>youtubeControl.browserStatus(),executeAction:executeWorkflowAction,notify:async value=>notifications.notify(value.title,value.body,{id:value.noticeId,kind:'notify',ruleId:'workflow:'+value.definitionId})});
    tinyRuntime = await createTinyRuntime(app, {
      notify: notifyTinyAgent,
      cancelNotification: (id, attempt) => notifications?.cancel(id, attempt),
      executeAction: executeWorkflowAction,
      shutdown: () => { execFile("shutdown.exe", ["/s", "/t", "0"], { windowsHide: true }, error => {
        if (error) console.error("[Tiny Agents] Shutdown failed:", error.message);
      }); },
      onChange: event => {
        if (event.kind === 'shutdown_cancelled' || event.kind === 'shutdown') notifications?.cancelShutdown();
        if (event.kind !== 'snapshot') refreshTinySensors();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("orvix:tiny-agent-event", event);
        if (event.kind !== "snapshot") refreshTray();
      },
      onWorkflowEvent: event => { refreshTinySensors(); if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('orvix:tiny-workflow-event',event); },
      onError: error => console.error('[Tiny runtime]', error.message),
      onControl: value => { refreshTray(); if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('orvix:tiny-runtime-control',value); },
    }, workflowAdapters);
    tinyAgents = tinyRuntime.agents; tinyWorkflows = tinyRuntime.workflows;
    tray = new Tray(path.join(__dirname, "..", "build", "icons", "icon.ico"));
    tray.on("double-click", showMainWindow);
    refreshTray();
    tinySensors = createTinyAgentSensors({ listRules: () => [...tinyAgents.sensorRules(),...tinyWorkflows.sensorRules()],
      observeDownloads: async () => {
        const items = []; let cursor;
        for (let page = 0; page < 20; page++) {
          const result = await youtubeControl.browserRequest('observe', { scope: 'downloads', ...(cursor ? { cursor } : {}) });
          if (result.status !== 'ok') return result;
          items.push(...(result.observation?.items || [])); cursor = result.observation?.cursor;
          if (!cursor) break;
        }
        return { status: 'ok', observation: { items } };
      }, onUpdate: value => tinyAgents?.ingestSensors(value) });
     refreshTinySensors();
    createWindow();
    startDesktopActivityMonitor();
    void desktopBar.initialize().catch(error => console.error('[Desktop top bar]', error.message));
    app.on("activate", () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(true); });
    powerMonitor.on("suspend", () => {screenSharingController?.dispose();tinyAgents?.reset();tinyWorkflows?.resetSignals();});
    powerMonitor.on("resume", () => {tinyAgents?.reset();tinyWorkflows?.resetSignals();});
  });
}
app.on("window-all-closed", () => { if (allowQuit) app.quit(); });
app.on("before-quit", event => {
  if (desktopBar && !desktopBarQuitComplete) {
    event.preventDefault();
    if (!desktopBarQuitPromise) {
      desktopBarQuitPromise = desktopBar.shutdown().then(() => { desktopBarQuitComplete = true; app.quit(); })
        .catch(error => { showMainWindow(); dialog.showErrorBox('Desktop top bar has not stopped', error.message); })
        .finally(() => { desktopBarQuitPromise = null; });
    }
    return;
  }
  if (tinyRuntime && !tinyRuntimeClosed) {
    event.preventDefault();
    tinySensors?.stop();
    void stopTinyWork().then(()=>tinyRuntime.close()).then(() => { tinyRuntimeClosed = true; app.quit(); }).catch(error => { showMainWindow(); dialog.showErrorBox('Orvix has not closed',error.message+'\nExecution is stopped or stopping. Review its status before trying again.'); });
    return;
  }
  screenSharingController?.dispose();
  tinyWorkflows?.stop();
  constructionLocks?.stop();
  tinySensors?.stop();
  allowQuit = true;
  tinyAgents?.stop();
  notifications?.stop();
  if (pcStatePoll) clearInterval(pcStatePoll);
  pcStatePoll = null;
  if (stateReadTimer) clearTimeout(stateReadTimer);
  stateReadTimer = null;
  youtubeControl?.close();
  agentEngine?.shutdown();
  openCodeHeadless?.shutdown();
  if (agentPowerBlockerId !== null) {
    powerSaveBlocker.stop(agentPowerBlockerId);
    agentPowerBlockerId = null;
  }
  if (activityTimer) clearInterval(activityTimer);
  stopPcMonitorHealthTimer();
  closePetWindow();
  stopPcStateWatcher();
  stopPcMonitorRunning();
  console.log("[Orvix] Stopping desktop processes");
});
