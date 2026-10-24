const crypto = require('node:crypto');
const { atomicWrite, readJson } = require('./agent/durable-store.cjs');

const MAX_ITEMS = 120;
const COPY = Object.freeze({
  completed: { title: 'Agent task completed', body: 'Your task has finished. Open Orvix to review it.' },
  failed: { title: 'Agent task stopped', body: 'Open Orvix to review its status.' },
  stopped: { title: 'Agent task stopped', body: 'Open Orvix to review its status.' },
  question: { title: 'Your Agent is waiting for an answer', body: 'A task is paused until you reply. Open Orvix to continue.' },
  permission: { title: 'Your Agent needs approval', body: 'A task is waiting for your approval. Open Orvix to review it.' },
});

function nonEmpty(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200; }

function classifyAgentEvent(event) {
  if (!event || !nonEmpty(event.taskId) || !nonEmpty(event.requestId)) return null;
  if (event.type === 'run_state') {
    const status = event.run?.status;
    if (status === 'running') return null;
    if (status === 'completed') return { kind: 'completed', taskId: event.taskId, requestId: event.requestId };
    if (status === 'failed') return { kind: 'failed', taskId: event.taskId, requestId: event.requestId };
    if (status === 'cancelled' || status === 'interrupted') return { kind: 'stopped', taskId: event.taskId, requestId: event.requestId };
    return null;
  }
  if (event.type === 'clarification' && event.phase !== 'remove' && nonEmpty(event.questionId)) {
    return { kind: 'question', taskId: event.taskId, requestId: event.requestId, questionId: event.questionId };
  }
  if (event.type === 'approval' && event.phase !== 'remove' && nonEmpty(event.approvalId)) {
    return { kind: 'permission', taskId: event.taskId, requestId: event.requestId, approvalId: event.approvalId };
  }
  return null;
}

function stableNotificationId(event) {
  const key = event.kind === 'question' ? `question:${event.taskId}:${event.requestId}:${event.questionId}`
    : event.kind === 'permission' ? `permission:${event.taskId}:${event.requestId}:${event.approvalId}`
      : `terminal:${event.taskId}:${event.requestId}`;
  return `agent-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function toastXml(item) {
  const launch = `orvix-agent:${item.id}`;
  const action = item.kind === 'question' ? 'Open question' : item.kind === 'permission' ? 'Review approval' : 'Open Orvix';
  return `<toast launch="${escapeXml(launch)}"><visual><binding template="ToastGeneric"><text>${escapeXml(item.title)}</text><text>${escapeXml(item.body)}</text></binding></visual><actions><action content="${escapeXml(action)}" arguments="${escapeXml(launch)}" activationType="foreground"/></actions></toast>`;
}

function activationNotificationId(value) {
  if (typeof value !== 'string') return null;
  const match = /^orvix-agent:(agent-[a-f0-9]{32})$/.exec(value);
  return match?.[1] ?? null;
}

function createAgentNotifications({ file, Notification, platform = process.platform, shouldToast = () => true, onChange = () => {}, onOpen = () => {}, onAttention = () => {}, onNativeToast = () => {}, now = Date.now, write = atomicWrite, read = readJson }) {
  let items = [];
  let storageError = null;
  let loadFailed = false;
  const toastRefs = new Map();
  const activated = new Map();

  try {
    const saved = read(file, { version: 1, items: [] });
    if (saved && saved.version === 1 && Array.isArray(saved.items)) {
      items = saved.items.filter(item => item && typeof item.id === 'string' && Object.hasOwn(COPY, item.kind)
        && nonEmpty(item.taskId) && nonEmpty(item.requestId) && Number.isFinite(item.createdAt))
        .slice(0, MAX_ITEMS).map(item => ({
          id: item.id, kind: item.kind, taskId: item.taskId, requestId: item.requestId,
          ...(nonEmpty(item.questionId) ? { questionId: item.questionId } : {}),
          ...(nonEmpty(item.approvalId) ? { approvalId: item.approvalId } : {}),
          ...COPY[item.kind], createdAt: item.createdAt,
          readAt: Number.isFinite(item.readAt) ? item.readAt : null,
          delivery: ['suppressed', 'shown', 'failed', 'unsupported', 'requested'].includes(item.delivery) ? item.delivery : 'unsupported',
          ...(item.delivery === 'failed' ? { deliveryError: 'Windows did not display this notification.' } : {}),
        }));
    } else if (saved !== null) {
      throw new Error('Saved notification feed is invalid.');
    }
  } catch (error) {
    loadFailed = true;
    storageError = error instanceof Error ? error.message : 'Saved notification feed cannot be read.';
  }

  const snapshot = () => ({ items: items.map(item => ({ ...item })), storageError });
  function publish() { try { onChange(snapshot()); } catch { /* The notification feed remains available through its read API. */ } }
  function persist() {
    if (loadFailed) return false;
    try {
      write(file, { version: 1, items });
      storageError = null;
      return true;
    } catch {
      storageError = 'Notification updates could not be saved on this device.';
      return false;
    }
  }
  function update(id, changes) {
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return false;
    items = items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item);
    persist(); publish();
    return true;
  }
  function targetFor(item) {
    return {
      type: 'agent', notificationId: item.id, eventKind: item.kind,
      taskId: item.taskId, requestId: item.requestId,
      ...(item.questionId ? { questionId: item.questionId } : {}),
      ...(item.approvalId ? { approvalId: item.approvalId } : {}),
    };
  }
  function openOnce(id) {
    const item = items.find(value => value.id === id);
    if (!item) return false;
    const previous = activated.get(id) ?? 0;
    if (activated.has(id) && now() - previous < 1500) return false;
    activated.set(id, now());
    while (activated.size > 50) activated.delete(activated.keys().next().value);
    markRead(id);
    try { onOpen(targetFor(item)); } catch { /* A later inbox click can still open the saved task. */ }
    return true;
  }
  function handleActivation(details) {
    if (details?.type !== 'click' && details?.type !== 'action') return false;
    const id = activationNotificationId(details.arguments);
    return id ? openOnce(id) : false;
  }
  if (platform === 'win32' && typeof Notification?.handleActivation === 'function') {
    try { Notification.handleActivation(handleActivation); } catch { /* Toast clicks in the current process still use instance events. */ }
  }

  function showToast(item) {
    let supported = false;
    try { supported = platform === 'win32' && typeof Notification === 'function' && typeof Notification.isSupported === 'function' && Notification.isSupported(); }
    catch { supported = false; }
    if (!supported) {
      update(item.id, { delivery: 'unsupported', deliveryError: undefined });
      return;
    }
    const canRouteActivation = typeof Notification.handleActivation === 'function';
    let retriedBasicToast = false;
    const fail = () => {
      toastRefs.delete(item.id);
      // Custom Toast XML is useful for cold-start routing on recent Electron.
      // If this runtime or Windows rejects it, retry with Electron's basic title/body toast.
      if (canRouteActivation && !retriedBasicToast) {
        retriedBasicToast = true;
        update(item.id, { delivery: 'requested', deliveryError: undefined });
        showBasicToast();
      } else update(item.id, { delivery: 'failed', deliveryError: 'Windows did not display this notification.' });
    };
    function showBasicToast() {
      try {
        const toast = new Notification({ id: item.id.slice(-32), groupId: 'orvix-agent', groupTitle: 'Orvix Agent', title: item.title, body: item.body });
        toast.on('show', () => {
          update(item.id, { delivery: 'shown', deliveryError: undefined });
          try { onNativeToast({ id: item.id, kind: item.kind }); } catch { /* The toast remains visible if shortcut repair fails. */ }
        });
        toast.on('failed', fail);
        toast.on('click', () => openOnce(item.id));
        toast.on('close', () => toastRefs.delete(item.id));
        toastRefs.set(item.id, toast);
        while (toastRefs.size > 60) toastRefs.delete(toastRefs.keys().next().value);
        toast.show();
      } catch { fail(); }
    }
    if (!canRouteActivation) { showBasicToast(); return; }
    try {
      const toast = new Notification({ id: item.id.slice(-32), groupId: 'orvix-agent', groupTitle: 'Orvix Agent', toastXml: toastXml(item) });
      toast.on('show', () => {
        update(item.id, { delivery: 'shown', deliveryError: undefined });
        try { onNativeToast({ id: item.id, kind: item.kind }); } catch { /* The toast remains visible if shortcut repair fails. */ }
      });
      toast.on('failed', fail);
      toast.on('click', () => openOnce(item.id));
      toast.on('close', () => toastRefs.delete(item.id));
      toastRefs.set(item.id, toast);
      while (toastRefs.size > 60) toastRefs.delete(toastRefs.keys().next().value);
      toast.show();
    } catch { fail(); }
  }

  function handleEvent(event) {
    const classified = classifyAgentEvent(event);
    if (!classified) return null;
    const id = stableNotificationId(classified);
    const existing = items.find(item => item.id === id);
    if (existing) return { ...existing };
    let foreground = false;
    try { foreground = platform === 'win32' && shouldToast() === false; } catch { /* Keep the durable inbox path if window state cannot be read. */ }
    const item = {
      id, ...classified, ...COPY[classified.kind], createdAt: now(), readAt: null,
      delivery: foreground ? 'suppressed' : 'requested',
    };
    items = [item, ...items].slice(0, MAX_ITEMS);
    persist(); publish();
    if (!foreground) {
      if (item.kind === 'question' || item.kind === 'permission') {
        try { onAttention({ ...item }); } catch { /* Native toast delivery and the durable inbox remain available. */ }
      }
      showToast(item);
    }
    return { ...item };
  }
  function markRead(id) {
    return update(id, { readAt: now() });
  }
  function markAllRead() {
    const readAt = now();
    items = items.map(item => item.readAt === null ? { ...item, readAt } : item);
    persist(); publish();
    return snapshot();
  }

  return { handleEvent, handleActivation, open: openOnce, list: snapshot, markRead, markAllRead };
}

module.exports = { classifyAgentEvent, stableNotificationId, activationNotificationId, toastXml, createAgentNotifications };
