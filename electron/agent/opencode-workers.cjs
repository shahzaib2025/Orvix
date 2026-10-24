const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createOpenCodeHeadless } = require('./opencode-headless.cjs');
const { openCodeModel } = require('./opencode-catalog.cjs');
const DEFAULT_CONTEXT_LIMIT = 200000;

// Catalog discovery never borrows a task's MCP configuration or execution queue.
function createOpenCodeWorkers(directory, dependencies = {}) {
  const create = dependencies.create ?? ((root, options) => createOpenCodeHeadless(root, { getProviderKey: dependencies.getProviderKey, ...options }));
  let keepAlive = dependencies.keepAlive === true;
  let focusedTaskId = null;
  let warmTaskId = null;
  // Reviews share the catalog lane, so retain provider defaults in that lane.
  // Catalog/review work remains lazy and uses the normal idle timeout. Only
  // the focused task needs a resident worker to make its Ready state useful.
  const catalog = create(directory, { buildTemperature: null, keepAlive: false });
  const workers = new Map();
  const workerContextLimits = new Map();
  let closed = false;
  function focusTask(taskId) {
    if (focusedTaskId !== taskId) {
      // Retain one recently used task for its normal idle timeout. Older
      // workers retire after their in-flight jobs, keeping idle memory bounded.
      warmTaskId = focusedTaskId;
      focusedTaskId = taskId;
      for (const [id, worker] of workers) {
        if (id === focusedTaskId) worker.setKeepAlive?.(true);
        else if (id === warmTaskId) worker.setKeepAlive?.(false);
        else worker.retireIdle?.();
      }
    } else workers.get(taskId)?.setKeepAlive?.(true);
  }
  async function setKeepAlive(value, taskId) {
    if (typeof value !== 'boolean') throw new Error('OpenCode keep-alive must be a boolean.');
    if (taskId !== undefined && (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId))) throw new Error('Invalid OpenCode task identity.');
    const previous = keepAlive;
    keepAlive = value;
    catalog.setKeepAlive?.(false);
    if (value && taskId !== undefined) focusTask(taskId);
    else if (!value) {
      warmTaskId = null;
      for (const worker of workers.values()) worker.setKeepAlive?.(false);
    }
    if (value) {
      // Workspace/model preparation waits for the renderer's loaded task context.
      try { await Promise.all([catalog.connect?.(), taskId ? forTask(taskId).connect?.() : undefined]); }
      catch (error) {
        if (!previous) {
          keepAlive = false;
          catalog.setKeepAlive?.(false);
          for (const worker of workers.values()) worker.setKeepAlive?.(false);
        }
        throw error;
      }
    }
    return keepAlive;
  }
  function forTask(taskId, modelId) {
    if (closed) throw new Error('OpenCode workers are shutting down.');
    if (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('Invalid OpenCode task identity.');
    if (modelId !== undefined && (typeof modelId !== 'string' || !/^opencode\/[\w.-]{1,150}$/.test(modelId))) throw new Error('Invalid OpenCode preparation model.');
    const contextLimitTokens = openCodeModel(modelId)?.contextLength ?? DEFAULT_CONTEXT_LIMIT;
    const existing = workers.get(taskId);
    if (existing && workerContextLimits.get(taskId) !== contextLimitTokens) {
      if ((existing.status?.().queued ?? 0) > 0) throw new Error('Cannot change the OpenCode context profile while its task worker is active.');
      existing.shutdown?.();
      workers.delete(taskId);
      workerContextLimits.delete(taskId);
    }
    if (!workers.has(taskId)) {
      const key = crypto.createHash('sha256').update(taskId).digest('hex');
      const worker = create(path.join(directory, 'opencode-workers', key), { keepAlive: keepAlive && taskId === focusedTaskId, contextLimitTokens });
      workers.set(taskId, worker);
      workerContextLimits.set(taskId, contextLimitTokens);
      if (keepAlive && taskId !== focusedTaskId) worker.retireIdle?.();
    }
    return workers.get(taskId);
  }
  function connectTask(taskId, signal, directory, modelId) {
    const worker = forTask(taskId, modelId);
    if (keepAlive) {
      focusTask(taskId);
    }
    return worker.prepare ? worker.prepare(directory, signal, modelId) : worker.connect?.(signal);
  }
  return {
    forTask, exclusive: (...args) => catalog.exclusive(...args),
    async forget(taskId) {
      if (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('Invalid OpenCode task identity.');
      const worker = workers.get(taskId);
      if (worker?.status().queued) throw new Error('Stop the agent before deleting its runtime records.');
      worker?.shutdown();
      workers.delete(taskId);
      workerContextLimits.delete(taskId);
      const base = path.resolve(directory, 'opencode-workers');
      const target = path.resolve(base, crypto.createHash('sha256').update(taskId).digest('hex'));
      if (path.dirname(target) !== base) throw new Error('Invalid OpenCode cleanup path.');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
    setKeepAlive, connect: signal => catalog.connect?.(signal),
    connectTask,
    status: () => ({ ...catalog.status(), keepAlive, catalog: catalog.status(), workers: Object.fromEntries([...workers].map(([id, worker]) => [id, worker.status()])) }),
    shutdown: () => { closed = true; for (const worker of [catalog, ...workers.values()]) worker.shutdown(); workers.clear(); workerContextLimits.clear(); },
  };
}
module.exports = { createOpenCodeWorkers };
