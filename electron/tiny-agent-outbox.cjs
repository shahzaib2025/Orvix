const { randomUUID } = require('node:crypto');
const RETRY_MS = [1000, 2000, 4000, 8000, 16000];
const TERMINAL = new Set(['confirmed', 'cancelled']);

// State and notification intent share the engine's atomic checkpoint.
function createOutbox({ state, persist, notify, cancel, changed, eligible, obsolete, now = Date.now }) {
  state.outbox ||= [];
  for (const item of state.outbox) {
    if (!TERMINAL.has(item.status) && item.status !== 'needs_retry') {
      item.status = item.attempts >= 6 ? 'needs_retry' : 'saved'; item.attempt = null; item.nextAt = 0;
      if (item.status === 'needs_retry') item.error ||= 'The final display attempt was interrupted; retry is required.';
    }
  }
  function enqueue(title, body, meta) {
    const item = { id: randomUUID(), title, body, ruleId: meta.ruleId, kind: 'notify',
      createdAt: now(), status: 'saved', attempts: 0, nextAt: 0, ...meta };
    state.outbox.push(item);
    // Only completed records can be pruned. Failed or waiting notices stay reviewable.
    const terminal = state.outbox.filter(i => TERMINAL.has(i.status)).slice(-200);
    state.outbox = [...state.outbox.filter(i => !TERMINAL.has(i.status)), ...terminal];
    return item;
  }
  function fail(item, message, at) {
    if (TERMINAL.has(item.status) || item.status === 'needs_retry') return;
    cancel?.(item.id, item.attempt);
    item.lastAttempt = item.attempt; item.attempt = null;
    item.error = message;
    item.status = item.attempts >= 6 ? 'needs_retry' : 'saved';
    item.nextAt = at + (RETRY_MS[item.attempts - 1] || 1000);
    persist(); changed(item, item.status === 'needs_retry' ? 'failed' : 'retrying', message);
  }
  function status(value, at = now()) {
    const item = state.outbox.find(i => i.id === value.id);
    if (!item || TERMINAL.has(item.status) || item.status === 'needs_retry' || !value.attempt || item.attempt !== value.attempt) return false;
    if (value.status === 'shown') {
      item.status = 'confirmed'; item.shownAt = at; delete item.error;
      persist(); changed(item, 'shown', value.message, value);
    } else if (value.status === 'failed') fail(item, value.message || 'Display failed.', at);
    else if (['queued', 'preparing', 'displaying'].includes(value.status)) {
      item.status = value.status;
      // Queued cards can legitimately wait behind confirmed cards. The center
      // owns their queue; only a card assigned a window has a display deadline.
      item.deadline = value.status === 'queued' ? null : at + 5000;
      persist(); changed(item, value.status, value.message, value);
    }
    return true;
  }
  function pump(at = now()) {
    for (const item of [...state.outbox]) {
      if (TERMINAL.has(item.status)) continue;
      const reason = obsolete?.(item, at);
      if (reason) { item.status = 'cancelled'; item.cancelledAt = at; item.error = reason; persist(); cancel?.(item.id, item.attempt); changed(item, 'expired', reason); continue; }
      if (item.status === 'needs_retry' || !eligible(item, at)) continue;
      if (['queued', 'preparing', 'displaying'].includes(item.status)) {
        if (item.deadline && at >= item.deadline) fail(item, 'Display confirmation timed out.', at);
        continue;
      }
      if (at < item.nextAt) continue;
      const prior = { status: item.status, attempt: item.attempt, attempts: item.attempts, deadline: item.deadline };
      item.status = 'preparing'; item.attempt = randomUUID(); item.attempts++;
      item.deadline = at + 5000;
      try { persist(); } catch (error) { Object.assign(item, prior); throw error; } // Never call a provider before the attempt is durable.
      try {
        if (!notify) throw new Error('Notification delivery is unavailable.');
        const result = notify(item.title, item.body, { ...item });
        if (result && typeof result.then === 'function') {
          const attempt = item.attempt;
          void result.then(value => { if (['shown', 'failed'].includes(value?.status)) status({ id: item.id, attempt, ...value }); }).catch(error => {
            if (item.attempt === attempt) fail(item, error.message, now());
          });
        }
        // A synchronous provider must explicitly confirm display. Undefined is
        // not an acknowledgement; Electron reports via the nonce-bound callback.
        if (result?.status === 'shown') status({ ...item, status: 'shown' }, at);
        else if (result?.status === 'failed') status({ ...item, status: 'failed', message: result.message }, at);
      } catch (error) { fail(item, error.message, at); }
    }
  }
  function cancelRule(ruleId) {
    const items = state.outbox.filter(i => i.ruleId === ruleId && !TERMINAL.has(i.status));
    for (const item of items) { item.status = 'cancelled'; item.cancelledAt = now(); }
    if (items.length) { persist(); for (const item of items) cancel?.(item.id, item.attempt); }
  }
  function retry(id) {
    const item = state.outbox.find(i => i.id === id);
    if (!item || item.status !== 'needs_retry' || !eligible(item, now())) throw new Error('This notification cannot be retried.');
    item.status = 'saved'; item.attempts = 0; item.nextAt = 0; item.attempt = null;
    persist(); pump();
  }
  return { enqueue, pump, status, cancelRule, retry };
}
module.exports = { createOutbox };
