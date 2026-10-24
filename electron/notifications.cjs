const path = require('node:path');
const { randomUUID } = require('node:crypto');
const HEIGHT = 192, GAP = 12, MIN_VISIBLE = 1500;
function createNotifications({ BrowserWindow, ipcMain, screen, onStatus, onOpen, onCancelShutdown, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  const active = new Map(), slots = new Set(), queue = []; let stopped = false, queueTimer = null;
  const report = (notice, status, message) => onStatus?.({ ...notice, status, message, ...(status === 'shown' ? { shownAt: now(), deliveryMs: now() - notice.queuedAt } : {}) });
  const area = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const capacity = () => Math.max(1, Math.min(3, Math.floor((area().height - 24) / (HEIGHT + GAP))));
  function position() {
    const bounds = area(); let offset = 12;
    for (const item of active.values()) {
      const width = Math.min(388, bounds.width - 24);
      item.slot.window.setBounds({ x: bounds.x + bounds.width - width - 12, y: Math.max(bounds.y + 12, bounds.y + bounds.height - offset - HEIGHT), width, height: HEIGHT });
      offset += HEIGHT + GAP;
    }
  }
  function finish(item) {
    if (active.get(item.notice.id) !== item) return;
    clearTimer(item.timer); active.delete(item.notice.id); item.slot.item = null;
    if (!item.slot.window.isDestroyed()) item.slot.window.hide(); position();
  }
  function schedule(item) {
    clearTimer(item.timer); item.timer = setTimer(() => { finish(item); pump(); }, item.remaining); item.startedAt = now();
  }
  function send(item) {
    if (item.slot.ready && active.get(item.notice.id) === item) item.slot.window.webContents.send('orvix:notice-update', item.notice);
  }
  function createSlot() {
    const window = new BrowserWindow({ title: 'Orvix Notification', width: 388, height: HEIGHT,
      frame: false, transparent: true, backgroundColor: '#00000000', show: false,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'notification-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const slot = { window, ready: false, item: null }; slots.add(slot);
    const fail = message => {
      const item = slot.item; slots.delete(slot);
      if (item) finish(item);
      if (!window.isDestroyed()) window.destroy();
      if (item && !item.shown) report(item.notice, 'failed', message); pump();
    };
    window.on('closed', () => fail('Notification window closed before confirmation.'));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => fail('Notification renderer stopped.'));
    window.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame !== false && code !== -3) fail('Notification load failed: ' + description); });
    Promise.resolve(window.loadFile(path.join(__dirname, 'notification.html'))).catch(error => fail('Notification could not load: ' + error.message));
    return slot;
  }
  function pump() {
    clearTimer(queueTimer); queueTimer = null; if (stopped) return;
    while (queue.length) {
      if (active.size >= capacity()) {
        const replace = [...active.values()].find(i => i.shown && !i.paused && i.notice.kind !== 'shutdown' && now() - i.shownAt >= MIN_VISIBLE);
        if (!replace) break;
        report(replace.notice, 'superseded', 'Card saved in notifications.'); finish(replace);
      }
      const notice = queue.shift();
      if (notice.kind === 'shutdown' && notice.endsAt <= now()) { report(notice, 'failed', 'Shutdown countdown expired before display.'); continue; }
      try {
        const slot = [...slots].find(s => !s.item && !s.window.isDestroyed()) || createSlot();
        const item = { slot, notice, shown: false, remaining: notice.kind === 'shutdown' ? Math.max(1, notice.endsAt - now()) : 8000, timer: null, startedAt: 0, paused: false };
        slot.item = item; active.set(notice.id, item); position();
        item.timer = setTimer(() => { finish(item); report(notice, 'failed', 'Notification renderer did not confirm display.'); pump(); }, 5000);
        report(notice, 'preparing', 'Preparing desktop card.'); send(item);
      } catch (error) { report(notice, 'failed', 'Notification could not open: ' + error.message); }
    }
    if (queue.length) {
      const eligible = [...active.values()].filter(i => i.shown && !i.paused && i.notice.kind !== 'shutdown');
      if (eligible.length) queueTimer = setTimer(pump, Math.max(1, Math.min(...eligible.map(i => MIN_VISIBLE - (now() - i.shownAt)))));
    }
  }
  const findSlot = event => [...slots].find(slot => slot.window.webContents === event.sender && event.senderFrame === slot.window.webContents.mainFrame);
  const find = event => findSlot(event)?.item;
  const matches = (item, id, attempt) => item && item.notice.id === id && item.notice.attempt === attempt;
  ipcMain.handle('orvix:notice-data', event => find(event)?.notice ?? null);
  ipcMain.on('orvix:notice-loaded', event => { const slot = findSlot(event); if (slot) { slot.ready = true; if (slot.item) send(slot.item); } });
  ipcMain.on('orvix:notice-ready', (event, id, attempt) => {
    const item = find(event); if (!matches(item, id, attempt) || item.displaying) return;
    try {
      item.displaying = true; item.slot.window.showInactive();
      report(item.notice, 'displaying', 'Desktop card is visible; awaiting frame confirmation.');
      item.slot.window.webContents.send('orvix:notice-visible', { id, attempt });
    } catch (error) { finish(item); report(item.notice, 'failed', 'Notification could not show: ' + error.message); pump(); }
  });
  ipcMain.on('orvix:notice-displayed', (event, id, attempt) => {
    const item = find(event); if (!matches(item, id, attempt) || !item.displaying || item.shown || !item.slot.window.isVisible()) return;
    item.shown = true; item.shownAt = now(); schedule(item);
    report(item.notice, 'shown', 'Desktop notification display confirmed.'); pump();
  });
  ipcMain.on('orvix:notice-action', (event, action, id, attempt) => {
    const item = find(event); if (!matches(item, id, attempt) || !item.shown) return;
    if (action === 'dismiss') { report(item.notice, 'dismissed', 'Notification dismissed.'); finish(item); pump(); }
    else if (action === 'open') { onOpen?.(item.notice); finish(item); pump(); }
    else if (action === 'cancel_shutdown' && item.notice.kind === 'shutdown') { onCancelShutdown?.(item.notice.ruleId); finish(item); pump(); }
    else if (action === 'pause' && !item.paused && item.notice.kind !== 'shutdown') {
      item.remaining = Math.max(1, item.remaining - (now() - item.startedAt)); clearTimer(item.timer); item.paused = true;
    } else if (action === 'resume' && item.paused) { item.paused = false; schedule(item); pump(); }
  });
  function cancel(id, attempt) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id && (!attempt || queue[i].attempt === attempt)) queue.splice(i, 1);
    const item = active.get(id); if (item && (!attempt || item.notice.attempt === attempt)) finish(item); pump();
  }
  return {
    warmup() { if (!stopped && !slots.size) { try { createSlot(); } catch {} } },
    notify(title, body, meta = {}) {
      const notice = { id: meta.id || randomUUID(), attempt: meta.attempt || randomUUID(), title: String(title).slice(0, 80), body: String(body).slice(0, 1000), ruleId: meta.ruleId || null, kind: meta.kind === 'shutdown' ? 'shutdown' : 'notify', createdAt: meta.createdAt || now(), queuedAt: now(), endsAt: meta.endsAt || null };
      if (stopped) { report(notice, 'failed', 'Orvix is shutting down.'); return { status: 'failed', id: notice.id }; }
      if (active.has(notice.id) || queue.some(i => i.id === notice.id)) return { status: 'queued', id: notice.id };
      if (notice.kind === 'shutdown') queue.unshift(notice); else queue.push(notice); report(notice, 'queued', 'Notification waiting for display.'); pump(); return { status: 'queued', id: notice.id };
    },
    cancel,
    cancelShutdown() { for (const notice of [...queue, ...[...active.values()].map(i => i.notice)]) if (notice.kind === 'shutdown') cancel(notice.id); },
    stop() {
      stopped = true; clearTimer(queueTimer); queue.length = 0;
      for (const item of [...active.values()]) finish(item);
      for (const slot of [...slots]) if (!slot.window.isDestroyed()) slot.window.destroy(); slots.clear();
    },
  };
}
module.exports = { createNotifications };
