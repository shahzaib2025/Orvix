const path = require('node:path');
const { Worker } = require('node:worker_threads');
function createBackgroundIndexer(app) {
  let worker = null, nextId = 0, idleTimer = null;
  const pending = new Map();
  function stop(error = new Error('Project indexer stopped.')) {
    clearTimeout(idleTimer); idleTimer = null;
    const old = worker; worker = null; void old?.terminate();
    for (const item of pending.values()) { item.signal.removeEventListener('abort', item.abort); item.reject(error); }
    pending.clear();
  }
  function idle() {
    if (pending.size || !worker) return;
    worker.unref(); clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop(), 120000); idleTimer.unref();
  }
  function getWorker() {
    if (worker) return worker;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(key)) delete env[key];
    const instance = new Worker(path.join(__dirname, 'project-map-worker.cjs'), { workerData: { userData: app.getPath('userData') }, env }); worker = instance;
    instance.on('message', message => {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); item.signal.removeEventListener('abort', item.abort);
      if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
      idle();
    });
    instance.on('error', error => { if (worker === instance) stop(error); });
    instance.on('exit', code => { if (worker === instance) stop(new Error(`Project indexer exited (${code}).`)); });
    return instance;
  }
  function refresh(root, taskId, signal) {
    if (signal.aborted) return Promise.reject(new Error('Task cancelled.'));
    clearTimeout(idleTimer); const instance = getWorker(); instance.ref(); const id = ++nextId;
    return new Promise((resolve, reject) => {
      const abort = () => { if (!pending.delete(id)) return; signal.removeEventListener('abort', abort); instance.postMessage({ id, cancel: true }); reject(new Error('Task cancelled.')); idle(); };
      pending.set(id, { resolve, reject, abort, signal }); signal.addEventListener('abort', abort, { once: true });
      instance.postMessage({ id, root, taskId }); if (signal.aborted) abort();
    });
  }
  return { refresh, shutdown: stop };
}
function waitForIndex(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('Task cancelled.'));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Task cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
module.exports = { createBackgroundIndexer, waitForIndex };
