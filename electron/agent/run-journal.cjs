const fs = require('node:fs');
const path = require('node:path');
const { appendResult } = require('./model-client.cjs');
const { getContextBudget } = require('./context-manager.cjs');

function createRunJournal(app) {
  const base = path.join(app.getPath('userData'), 'agent-runs');
  fs.mkdirSync(base, { recursive: true });
  function file(taskId) {
    if (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('Invalid task ID.');
    return path.join(base, `${taskId}.json`);
  }
  function read(taskId) {
    try {
      const state = JSON.parse(fs.readFileSync(file(taskId), 'utf8'));
      if (!state || state.taskId !== taskId || !Array.isArray(state.history)) return null;
      return state.accessModeVersion === 2 ? state : {
        ...state, accessMode: state.accessMode === 'Full access' ? 'Controlled' : state.accessMode
      };
    } catch { return null; }
  }
  function metadata(taskId) {
    const state = read(taskId);
    const recovery = recover(state);
    const historyBytes = state ? Buffer.byteLength(JSON.stringify(state.history)) : 0;
    const contextBudget = state ? getContextBudget(state.modelId, state.context?.contextLimitTokens, state.context?.budgetSource) : null;
    return state ? { requestId: state.requestId, safe: recovery.safe, recoveryReason: recovery.reason, completedTools: state.nativeSession?.completedTools ?? state.pendingBatch?.results?.length ?? 0, activeOperation: state.pendingBatch?.active ?? Object.values(state.nativeSession?.pendingTools ?? {})[0] ?? null, lastVerifiedState: state.verifiedFingerprint ?? null, updatedAt: state.updatedAt,
      modelId: state.modelId, accessMode: state.accessMode, thinkingVariant: state.thinkingVariant, specialty: state.specialty ?? null, designProfile: state.designProfile ?? null,
      context: { historyBytes, estimatedTokens: Math.ceil(historyBytes / 4),
        budgetTokens: contextBudget.contextLimitTokens,
        budgetSource: contextBudget.budgetSource,
        contextLimitTokens: state.context?.contextLimitTokens ?? null,
        modelId: state.modelId,
        contextSource: state.context?.usageCompacted ? 'estimate' : state.context?.lastInputTokens ? 'provider' : 'estimate',
        estimateBasis: 'engine-history',
        lastInputTokens: state.context?.usageCompacted ? null : state.context?.lastInputTokens ?? null,
        compactions: state.context?.compactions ?? 0, measuredAt: state.updatedAt } } : null;
  }
  function write(state) {
    const target = file(state.taskId);
    const data = JSON.stringify({ ...state, accessModeVersion: 2, updatedAt: Date.now() });
    if (Buffer.byteLength(data) > 8_000_000) throw new Error('Run history is too large to checkpoint safely.');
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, data, { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, target); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 5) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
      }
    }
  }
  function forget(taskId) { try { fs.unlinkSync(file(taskId)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return { read, metadata, write, forget, recover: taskId => recover(read(taskId)) };
}

function recover(state) {
  if (!state) return { safe: false, reason: 'No saved checkpoint.', state: null };
  if (state.nativeSession) {
    const session = state.nativeSession;
    if (!/^[\w-]+$/.test(session.sessionID ?? '')) return { safe: false, reason: 'Invalid native session checkpoint.', state };
    if (session.status === 'completed') return { safe: false, reason: 'Native execution completed; do not replay it.', state };
    if (['authentication','access','quota'].includes(session.failure?.kind)) {
      const reason = session.failure.kind === 'quota' ? 'Provider quota or balance is exhausted.' : session.failure.kind === 'access' ? 'Provider access is blocked.' : 'Provider authentication needs attention.';
      return {safe:true,reason:reason+' Progress is retained. Resolve the provider issue, then explicitly resume; completed actions will not be replayed.',state};
    }
    return { safe: true, reason: 'Reconnect to the retained native session and reconcile its recorded tool results; never replay the original request.', state };
  }
  if (state.safe) return { safe: true, reason: 'Saved between operations.', state };
  const batch = state.pendingBatch;
  if (!batch?.answer || !Array.isArray(batch.results)) return { safe: false, reason: 'The interrupted operation has no durable completion record.', state };
  if (batch.active?.mutates) return { safe: false, reason: `The outcome of ${batch.active.name} is unknown. Review its effects before retrying; it will not be replayed automatically.`, state };
  const recovered = structuredClone(state);
  const results = recovered.pendingBatch.answer.calls.map(call => recovered.pendingBatch.results.find(result => result.id === call.id) ?? { id: call.id, text: 'No completed output was saved for this operation. It was interrupted or not started. Re-inspect current state and replan; do not infer success.', images: [] });
  appendResult(batch.answer.route, recovered.history, recovered.pendingBatch.answer, results, batch.acceptsImages === true);
  recovered.history.push({ role: 'user', content: 'Recovered after an interruption. Completed tool results above are saved observations and must not be replayed. The remaining proposed actions were discarded. Refresh current files, project/runtime state and checks before choosing the next action.' });
  recovered.safe = true; recovered.step = (state.step ?? 0) + 1; recovered.pendingBatch = null;
  return { safe: true, reason: 'Completed operations retained; remaining actions require a fresh plan.', state: recovered };
}

module.exports = { createRunJournal, recover };
