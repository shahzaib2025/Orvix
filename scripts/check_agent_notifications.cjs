const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAgentNotifications, classifyAgentEvent, activationNotificationId } = require('../electron/agent-notifications.cjs');
const { ensureWindowsNotificationShortcuts, ensureWindowsTaskbarShortcut, ensureWindowsNotificationAppRegistration, getNotificationAppUserModelId, getTaskbarAppUserModelId } = require('../electron/windows-notification-shortcuts.cjs');

class FakeNotification extends EventEmitter {
  static supported = true;
  static activationHandler = null;
  static created = [];
  static isSupported() { return this.supported; }
  static handleActivation(callback) { this.activationHandler = callback; }
  constructor(options) { super(); this.options = options; FakeNotification.created.push(this); }
  show() { this.emit('show'); }
}

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-agent-notification-'));
  const file = path.join(directory, 'agent-notifications.json');
  FakeNotification.created = [];
  FakeNotification.activationHandler = null;
  const service = createAgentNotifications({ file, Notification: FakeNotification, platform: 'win32', ...options });
  return { directory, file, service };
}

test('Agent event classification ignores heartbeats, progress, and resolved requests', () => {
  assert.equal(classifyAgentEvent({ type: 'run_state', taskId: 'task', requestId: 'run', run: { status: 'running' } }), null);
  assert.equal(classifyAgentEvent({ type: 'stream', taskId: 'task', requestId: 'run' }), null);
  assert.equal(classifyAgentEvent({ type: 'approval', taskId: 'task', requestId: 'run', approvalId: 'approval', phase: 'remove' }), null);
  assert.equal(classifyAgentEvent({ type: 'clarification', taskId: 'task', requestId: 'run', questionId: 'question', phase: 'remove' }), null);
  assert.equal(classifyAgentEvent({ type: 'run_state', taskId: 'task', requestId: 'run', run: { status: 'completed' } }).kind, 'completed');
  assert.equal(classifyAgentEvent({ type: 'run_state', taskId: 'task', requestId: 'run', run: { status: 'failed' } }).kind, 'failed');
  assert.equal(classifyAgentEvent({ type: 'run_state', taskId: 'task', requestId: 'run', run: { status: 'interrupted' } }).kind, 'stopped');
});

test('terminal events are deduplicated and persisted without private event content', () => {
  const { directory, file, service } = fixture({ shouldToast: () => true });
  const event = { type: 'run_state', taskId: 'task-1', requestId: 'run-1', run: { status: 'completed' }, result: { text: 'private response' } };
  const first = service.handleEvent(event);
  const second = service.handleEvent(event);
  assert.equal(first.id, second.id);
  assert.equal(service.list().items.length, 1);
  assert.equal(FakeNotification.created.length, 1);
  assert.equal(service.list().items[0].delivery, 'shown');
  const saved = fs.readFileSync(file, 'utf8');
  assert.match(saved, /Agent task completed/);
  assert.doesNotMatch(saved, /private response/);
  assert.match(FakeNotification.created[0].options.toastXml, /orvix-agent:/);
  const restarted = createAgentNotifications({ file, Notification: FakeNotification, platform: 'win32', shouldToast: () => true });
  assert.equal(restarted.handleEvent(event).id, first.id, 'persisted event identity deduplicates after restart');
  assert.equal(FakeNotification.created.length, 1, 'a restored event does not alert again');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('questions and approvals persist only concise copy and exact routing identifiers', () => {
  const { directory, file, service } = fixture();
  const question = service.handleEvent({ type: 'clarification', taskId: 'task-2', requestId: 'run-2', questionId: 'question-2', question: 'private question body', command: 'private command' });
  const permission = service.handleEvent({ type: 'approval', taskId: 'task-3', requestId: 'run-3', approvalId: 'approval-3', command: 'private command' });
  assert.equal(question.kind, 'question');
  assert.equal(permission.kind, 'permission');
  const saved = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(saved, /private question body|private command/);
  assert.equal(service.list().items.length, 2);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a minimized Agent question sends an actionable toast and requests a taskbar attention cue', () => {
  const attention = [];
  const opened = [];
  const { directory, service } = fixture({ shouldToast: () => true, onAttention: item => attention.push(item), onOpen: target => opened.push(target) });
  const item = service.handleEvent({ type: 'clarification', taskId: 'task-question', requestId: 'run-question', questionId: 'question-waiting', phase: 'started' });
  assert.equal(service.list().items[0].delivery, 'shown');
  assert.equal(FakeNotification.created.length, 1);
  assert.match(FakeNotification.created[0].options.toastXml, /content="Open question"/);
  assert.match(FakeNotification.created[0].options.toastXml, /A task is paused until you reply/);
  assert.equal(attention.length, 1);
  assert.equal(attention[0].kind, 'question');
  assert.equal(FakeNotification.activationHandler({ type: 'action', arguments: `orvix-agent:${item.id}` }), true);
  assert.equal(opened[0].questionId, 'question-waiting');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a shown native toast invokes the Windows shortcut identity repair callback', () => {
  const shown = [];
  const { directory, service } = fixture({ shouldToast: () => true, onNativeToast: item => shown.push(item) });
  const item = service.handleEvent({ type: 'clarification', taskId: 'task-toast-repair', requestId: 'run-toast-repair', questionId: 'question-toast-repair' });
  assert.deepEqual(shown, [{ id: item.id, kind: 'question' }]);
  assert.equal(service.list().items[0].delivery, 'shown');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('focused Orvix suppresses the toast but stores an unread inbox event', () => {
  const { directory, service } = fixture({ shouldToast: () => false });
  const item = service.handleEvent({ type: 'approval', taskId: 'task-4', requestId: 'run-4', approvalId: 'approval-4' });
  assert.equal(item.delivery, 'suppressed');
  assert.equal(item.readAt, null);
  assert.equal(FakeNotification.created.length, 0);
  assert.equal(service.list().items[0].delivery, 'suppressed');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('native notification failures remain in the feed with a generic error', () => {
  const { directory, service } = fixture();
  FakeNotification.prototype.show = function () { this.emit('failed', {}, 'private OS detail'); };
  const item = service.handleEvent({ type: 'run_state', taskId: 'task-5', requestId: 'run-5', run: { status: 'failed' }, error: 'private task detail' });
  const saved = fs.readFileSync(path.join(directory, 'agent-notifications.json'), 'utf8');
  assert.equal(service.list().items[0].delivery, 'failed');
  assert.equal(service.list().items[0].deliveryError, 'Windows did not display this notification.');
  assert.doesNotMatch(saved, /private OS detail|private task detail/);
  FakeNotification.prototype.show = function () { this.emit('show'); };
  fs.rmSync(directory, { recursive: true, force: true });
});

test('older Electron runtimes use the supported basic Windows toast and keep live click routing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-agent-notification-legacy-'));
  const opened = [];
  class LegacyNotification extends EventEmitter {
    static isSupported() { return true; }
    static created = [];
    constructor(options) { super(); this.options = options; LegacyNotification.created.push(this); }
    show() { this.emit('show'); }
  }
  const service = createAgentNotifications({ file: path.join(directory, 'feed.json'), Notification: LegacyNotification, platform: 'win32', onOpen: target => opened.push(target) });
  const item = service.handleEvent({ type: 'approval', taskId: 'task-legacy', requestId: 'run-legacy', approvalId: 'approval-legacy' });
  assert.equal(service.list().items[0].delivery, 'shown');
  assert.equal(LegacyNotification.created.length, 1);
  assert.equal(LegacyNotification.created[0].options.title, 'Your Agent needs approval');
  assert.equal(LegacyNotification.created[0].options.body, 'A task is waiting for your approval. Open Orvix to review it.');
  assert.equal('toastXml' in LegacyNotification.created[0].options, false);
  LegacyNotification.created[0].emit('click');
  assert.equal(opened[0].notificationId, item.id);
  assert.equal(opened[0].approvalId, 'approval-legacy');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a rejected custom toast retries once with a basic native notification', () => {
  const { directory, service } = fixture({ shouldToast: () => true });
  FakeNotification.created = [];
  FakeNotification.prototype.show = function () {
    if (FakeNotification.created.length === 1) this.emit('failed', {}, 'Custom toast rejected');
    else this.emit('show');
  };
  service.handleEvent({ type: 'run_state', taskId: 'task-fallback', requestId: 'run-fallback', run: { status: 'completed' } });
  assert.equal(FakeNotification.created.length, 2);
  assert.match(FakeNotification.created[0].options.toastXml, /<toast/);
  assert.equal(FakeNotification.created[1].options.title, 'Agent task completed');
  assert.equal(FakeNotification.created[1].options.body, 'Your task has finished. Open Orvix to review it.');
  assert.equal(service.list().items[0].delivery, 'shown');
  FakeNotification.prototype.show = function () { this.emit('show'); };
  fs.rmSync(directory, { recursive: true, force: true });
});

test('toast and inbox activation route to the exact Agent turn and request', () => {
  const { directory, service } = fixture();
  const opened = [];
  const routed = createAgentNotifications({
    file: path.join(directory, 'routed.json'), Notification: FakeNotification, platform: 'win32', onOpen: target => opened.push(target),
  });
  const item = routed.handleEvent({ type: 'approval', taskId: 'task-6', requestId: 'run-6', approvalId: 'approval-6' });
  const launch = `orvix-agent:${item.id}`;
  assert.equal(activationNotificationId(launch), item.id);
  assert.equal(FakeNotification.activationHandler({ type: 'click', arguments: launch }), true);
  assert.deepEqual(opened[0], {
    type: 'agent', notificationId: item.id, eventKind: 'permission', taskId: 'task-6', requestId: 'run-6', approvalId: 'approval-6',
  });
  assert.notEqual(routed.list().items[0].readAt, null);
  assert.equal(routed.markRead(item.id), true);
  assert.notEqual(routed.list().items[0].readAt, null);
  assert.equal(routed.markAllRead().items[0].readAt, routed.list().items[0].readAt);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('shortcut repair updates flat NSIS and nested MSI Start Menu links', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-start-menu-'));
  const programs = path.join(directory, 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const flat = path.join(programs, 'Orvix.lnk');
  const nested = path.join(programs, 'Orvix', 'Orvix.lnk');
  fs.mkdirSync(path.dirname(flat), { recursive: true });
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(flat, 'shortcut'); fs.writeFileSync(nested, 'shortcut');
  const links = new Map([[flat.toLowerCase(), { target: 'C:\\Program Files\\Orvix\\Orvix.exe', args: '' }], [nested.toLowerCase(), { target: 'C:\\Program Files\\Orvix\\Orvix.exe', args: '--hidden' }]]);
  const writes = [];
  const shell = {
    readShortcutLink: link => links.get(link.toLowerCase()),
    writeShortcutLink: (link, operation, details) => { writes.push({ link, operation, details }); links.set(link.toLowerCase(), details); return true; },
  };
  const result = ensureWindowsNotificationShortcuts({
    app: { isPackaged: true, getPath: () => 'C:\\Program Files\\Orvix\\Orvix.exe' }, shell,
    appUserModelId: 'com.orvix.desktop', toastActivatorClsid: '{4b0412c9-10f3-489a-a7b7-2ae842eeed7d}',
    platform: 'win32', env: { APPDATA: path.join(directory, 'Roaming'), PROGRAMDATA: path.join(directory, 'ProgramData') },
  });
  assert.equal(result.updated, 2);
  assert.equal(result.created, false);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.operation === 'update' && write.details.appUserModelId === 'com.orvix.desktop' && write.details.toastActivatorClsid));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('shortcut repair creates a user Start Menu shortcut when installers left none', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-start-menu-empty-'));
  let created;
  const result = ensureWindowsNotificationShortcuts({
    app: { isPackaged: true, getPath: () => 'C:\\Program Files\\Orvix\\Orvix.exe' },
    shell: { readShortcutLink: () => { throw new Error('missing'); }, writeShortcutLink: (link, operation, details) => { created = { link, operation, details }; return true; } },
    appUserModelId: 'com.orvix.desktop', toastActivatorClsid: '{4b0412c9-10f3-489a-a7b7-2ae842eeed7d}',
    platform: 'win32', env: { APPDATA: path.join(directory, 'Roaming'), PROGRAMDATA: path.join(directory, 'ProgramData') },
  });
  assert.equal(result.created, true);
  assert.equal(created.operation, 'create');
  assert.equal(created.details.target, 'C:\\Program Files\\Orvix\\Orvix.exe');
  assert.equal(created.details.appUserModelId, 'com.orvix.desktop');
  assert.equal(created.details.toastActivatorClsid, '{4b0412c9-10f3-489a-a7b7-2ae842eeed7d}');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('packaged and development notifications use Orvix-owned Windows identities', () => {
  assert.equal(getNotificationAppUserModelId('com.orvix.desktop', true), 'com.orvix.desktop');
  assert.equal(getNotificationAppUserModelId('com.orvix.desktop', false), 'com.orvix.desktop.development.orvix.v3');
  assert.notEqual(getNotificationAppUserModelId('com.orvix.desktop', false), 'com.orvix.desktop.development',
    'development toasts must not collide with an existing Electron Start Menu identity');
  assert.notEqual(getNotificationAppUserModelId('com.orvix.desktop', false), 'C:\\Program Files\\Electron\\electron.exe');
});

test('development taskbar identity stays stable and separate from the toast identity', () => {
  const taskbarAppUserModelId = getTaskbarAppUserModelId('com.orvix.desktop', false);
  const notificationAppUserModelId = getNotificationAppUserModelId('com.orvix.desktop', false);
  assert.equal(taskbarAppUserModelId, 'com.orvix.desktop.development');
  assert.equal(getTaskbarAppUserModelId('com.orvix.desktop', true), 'com.orvix.desktop');
  assert.notEqual(taskbarAppUserModelId, notificationAppUserModelId);
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(mainSource, /const windowAppUserModelId = getTaskbarAppUserModelId\(appId, app\.isPackaged\)/);
  assert.match(mainSource, /app\.setAppUserModelId\(notificationAppUserModelId\)/,
    'native toasts must keep their separate notification identity');
  assert.match(mainSource, /ensureWindowsTaskbarShortcut\(\{ app, shell, appUserModelId: windowAppUserModelId/,
    'Windows must have a matching Orvix shortcut for its taskbar window identity');
});

test('development taskbar shortcut is created and repaired with the stable window identity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-taskbar-shortcut-'));
  const links = new Map();
  const writes = [];
  const app = { isPackaged: false, getPath: () => 'C:\\Users\\HP\\Orvix\\electron.exe' };
  const options = {
    app, shell: {
      readShortcutLink: link => {
        const value = links.get(link.toLowerCase());
        if (!value) throw new Error('missing');
        return value;
      },
      writeShortcutLink: (link, operation, details) => {
        writes.push({ link, operation, details });
        links.set(link.toLowerCase(), details);
        return true;
      },
    },
    appUserModelId: getTaskbarAppUserModelId('com.orvix.desktop', false),
    iconPath: path.join(__dirname, '..', 'build', 'icons', 'icon.ico'),
    platform: 'win32', development: true,
    entryPath: 'C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\electron\\main.cjs',
    env: { APPDATA: path.join(directory, 'Roaming') },
  };
  try {
    const created = ensureWindowsTaskbarShortcut(options);
    const repaired = ensureWindowsTaskbarShortcut(options);
    assert.equal(created.created, true);
    assert.equal(repaired.updated, 1);
    assert.equal(writes.length, 2);
    assert.equal(path.win32.basename(writes[0].link), 'Orvix Development.lnk');
    assert.equal(writes[0].details.appUserModelId, 'com.orvix.desktop.development');
    assert.equal(writes[0].details.icon, options.iconPath);
    assert.equal(writes[1].operation, 'update');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the branded Windows shortcut is registered before assigning the toast identity', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const earlyShortcut = mainSource.indexOf('const earlyShortcutResult = repairWindowsNotificationShortcut(true)');
  const appIdentity = mainSource.indexOf('app.setAppUserModelId(notificationAppUserModelId)');
  assert.ok(earlyShortcut >= 0 && earlyShortcut < appIdentity,
    'register the Orvix Start Menu identity before Windows sees the development app AUMID');
  assert.match(mainSource, /Re-run after Electron startup[\s\S]*?repairWindowsNotificationShortcut\(\)/,
    'repair Electron.lnk if startup reclaims the Orvix AUMID');
  assert.match(mainSource, /let notificationShortcutRepairTimer = null;/,
    'declare the debounced post-toast shortcut repair timer');
  assert.match(mainSource, /onNativeToast:\s*\(\)\s*=>\s*\{/,
    'repair the generic Electron shortcut after Windows displays a toast');
});

test('development notification registration sets the Windows app name and icon', () => {
  const calls = [];
  const iconPath = path.join(__dirname, '..', 'build', 'icons', 'icon.png');
  const appUserModelId = getNotificationAppUserModelId('com.orvix.desktop', false);
  const result = ensureWindowsNotificationAppRegistration({
    appUserModelId, displayName: 'Orvix', iconPath, platform: 'win32',
    execFileSync: (...args) => calls.push(args),
  });
  assert.deepEqual(result, { registered: true, skipped: false, errors: [] });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1], [
    'add', `HKCU\\Software\\Classes\\AppUserModelId\\${appUserModelId}`,
    '/v', 'DisplayName', '/t', 'REG_EXPAND_SZ', '/d', 'Orvix', '/f',
  ]);
  assert.deepEqual(calls[1][1], [
    'add', `HKCU\\Software\\Classes\\AppUserModelId\\${appUserModelId}`,
    '/v', 'IconUri', '/t', 'REG_EXPAND_SZ', '/d', iconPath, '/f',
  ]);
});

test('development launches register a branded Start Menu shortcut for Windows toasts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-start-menu-dev-'));
  const links = new Map();
  const writes = [];
  const shell = {
    readShortcutLink: link => {
      const value = links.get(link.toLowerCase());
      if (!value) throw new Error('missing');
      return value;
    },
    writeShortcutLink: (link, operation, details) => {
      writes.push({ link, operation, details });
      links.set(link.toLowerCase(), details);
      return true;
    },
  };
  const options = {
    app: { isPackaged: false, getPath: () => 'C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\node_modules\\electron\\dist\\electron.exe' },
    shell, appUserModelId: getNotificationAppUserModelId('com.orvix.desktop', false),
    toastActivatorClsid: '{4b0412c9-10f3-489a-a7b7-2ae842eeed7d}', platform: 'win32', development: true,
    entryPath: 'C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\electron\\main.cjs',
    iconPath: 'C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\build\\icons\\icon.ico',
    env: { APPDATA: path.join(directory, 'Roaming') },
  };
  const electronShortcut = path.win32.join(options.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
  links.set(electronShortcut.toLowerCase(), {
    target: options.app.getPath('exe'), args: '', description: 'Electron', icon: '', iconIndex: 0,
    appUserModelId: options.appUserModelId, toastActivatorClsid: '{103c4f2a-ffa1-4f4b-86c4-b69aca496fe0}',
  });
  const missingIcon = ensureWindowsNotificationShortcuts({ ...options, iconPath: undefined });
  const created = ensureWindowsNotificationShortcuts(options);
  const updated = ensureWindowsNotificationShortcuts(options);
  assert.equal(missingIcon.created, false);
  assert.match(missingIcon.errors[0], /Orvix icon/);
  assert.equal(created.created, true);
  assert.equal(updated.updated, 1);
  assert.equal(writes.length, 3);
  assert.equal(path.win32.basename(writes[0].link), 'Electron.lnk');
  assert.equal(writes[0].details.appUserModelId, options.app.getPath('exe'), 'the generic Electron shortcut must not claim Orvix notifications');
  assert.equal(path.win32.basename(writes[1].link), 'Orvix.lnk');
  assert.equal(path.win32.dirname(writes[1].link), path.win32.join(options.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  assert.equal(writes[1].details.target, options.app.getPath('exe'));
  assert.equal(writes[1].details.args, '"C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\electron\\main.cjs"');
  assert.equal(writes[1].details.appUserModelId, options.appUserModelId);
  assert.equal(writes[1].details.icon, options.iconPath);
  assert.equal(writes[2].details.icon, options.iconPath);
  assert.equal(writes[2].details.appUserModelId, options.appUserModelId);
  assert.equal(writes[1].details.toastActivatorClsid, options.toastActivatorClsid);
  fs.rmSync(directory, { recursive: true, force: true });
});
