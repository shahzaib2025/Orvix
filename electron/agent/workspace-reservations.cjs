const path = require('node:path');
const { canonicalTarget } = require('./workspace-manager.cjs');

function createWorkspaceReservations() {
  const held = new Map(), waiting = new Map(), queues = new Map();
  const normalize = root => {
    const target = canonicalTarget(path.resolve(root));
    return process.platform === 'win32' ? target.toLowerCase() : target;
  };
  const overlaps = (a, b) => a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep) || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
  const blockers = (id, roots) => [...held].filter(([other, owned]) => other !== id && roots.some(root => owned.some(value => overlaps(root, value)))).map(([other]) => other);
  function wake() { for (const item of waiting.values()) item.retry(); }
  function release(taskId) { held.delete(taskId); wake(); }
  async function acquire(taskId, roots, signal, onWait = () => {}) {
    if (signal.aborted) throw new Error('Task cancelled.');
    const wanted = [...new Set([...(held.get(taskId) ?? []), ...roots.map(normalize)])];
    if (!wanted.length) return;
    const blocked = blockers(taskId, wanted);
    if (!blocked.length) { held.set(taskId, wanted); return; }
    // Reject a cycle instead of leaving two sessions permanently waiting on each other.
    const reaches = (id, seen = new Set()) => {
      if (id === taskId) return true;
      if (seen.has(id)) return false; seen.add(id);
      return (waiting.get(id)?.blocked ?? []).some(next => reaches(next, seen));
    };
    if (blocked.some(id => reaches(id))) throw new Error('Workspace reservation conflict between sessions. Finish one session before adding this project.');
    onWait(blocked);
    await new Promise((resolve, reject) => {
      const finish = error => { waiting.delete(taskId); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const abort = () => finish(new Error('Task cancelled.'));
      const item = { blocked, retry() {
        if (signal.aborted) return abort();
        item.blocked = blockers(taskId, wanted);
        if (!item.blocked.length) { held.set(taskId, wanted); finish(); }
      } };
      waiting.set(taskId, item); signal.addEventListener('abort', abort, { once: true }); item.retry();
    });
  }
  function reserve(taskId, roots, signal, onWait) {
    const job = (queues.get(taskId) ?? Promise.resolve()).catch(() => {}).then(() => acquire(taskId, roots, signal, onWait));
    queues.set(taskId, job);
    const cleanup = () => { if (queues.get(taskId) === job) queues.delete(taskId); };
    job.then(cleanup, cleanup);
    return job;
  }
  return { reserve, release, inspect: () => ({ held: Object.fromEntries(held), waiting: Object.fromEntries([...waiting].map(([id, item]) => [id, item.blocked])) }) };
}
module.exports = { createWorkspaceReservations };
