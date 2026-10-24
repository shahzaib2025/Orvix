const path = require('node:path');
const { validId, atomicWrite, readJson, safeValue, removeOwned } = require('./durable-store.cjs');
const proofTypes = new Set(['focused', 'typecheck', 'regression', 'build', 'user_flow', 'layout', 'accessibility', 'performance', 'research']);

function createExecutionMapStore(app, evidence) {
  const base = path.join(app.getPath('userData'), 'agent-execution');
  const target = (taskId, requestId) => path.join(base, validId(taskId), `${validId(requestId)}.json`);
  function read(taskId, requestId) { return readJson(target(taskId, requestId)); }
  function save(state) { atomicWrite(target(state.taskId, state.requestId), state); return state; }
  function ensure(taskId, requestId, objective, accessMode) {
    const previous = read(taskId, requestId);
    if (previous) return previous;
    return save({ version: 1, taskId, requestId, objective: String(objective), accessMode, revision: 0,
      requirements: [{ id: 'r-goal', text: String(objective), verificationTypes: accessMode === 'Plan' ? ['research'] : ['focused', 'user_flow'], placeholder: true }],
      actions: [], proofs: [], updatedAt: Date.now() });
  }
  function validateLinks(state, requirementIds = [], actionId) {
    if (!Array.isArray(requirementIds) || requirementIds.some(id => !state.requirements.some(item => item.id === id))) throw new Error('Unknown requirement ID. Read the execution map first.');
    if (actionId && !state.actions.some(item => item.id === actionId)) throw new Error('Unknown action ID.');
  }
  function update(taskId, requestId, input) {
    const current = read(taskId, requestId);
    if (!current) throw new Error('Execution map is unavailable.');
    if (!input.replace_initial_goal && !input.requirements?.length && !input.actions?.length) return current;
    const state = structuredClone(current);
    if (input.replace_initial_goal && input.requirements?.length) state.requirements = state.requirements.filter(item => !item.placeholder);
    for (const incoming of input.requirements ?? []) {
      validId(incoming.id);
      if (!String(incoming.text ?? '').trim()) throw new Error('Describe each requirement.');
      if (!Array.isArray(incoming.verification_types) || !incoming.verification_types.length || incoming.verification_types.some(type => !proofTypes.has(type))) throw new Error('Choose an observed verification type for each requirement.');
      const next = { id: incoming.id, text: String(incoming.text), verificationTypes: [...new Set(incoming.verification_types)] };
      const old = state.requirements.findIndex(item => item.id === next.id);
      if (old < 0) state.requirements.push(next);
      else {
        if (JSON.stringify(state.requirements[old]) !== JSON.stringify(next)) state.proofs = state.proofs.filter(proof => !proof.requirementIds.includes(next.id));
        state.requirements[old] = next;
      }
    }
    for (const incoming of input.actions ?? []) {
      validId(incoming.id);
      if (!String(incoming.title ?? '').trim() || !['inspect', 'edit', 'check', 'research'].includes(incoming.kind)) throw new Error('Describe the action and its kind.');
      const next = { id: incoming.id, title: String(incoming.title), kind: incoming.kind,
        requirementIds: incoming.requirement_ids ?? [], dependsOn: incoming.depends_on ?? [],
        state: incoming.state ?? 'pending', evidenceIds: incoming.evidence_ids ?? [], reason: String(incoming.reason ?? '') };
      if (!['pending', 'running', 'done', 'blocked'].includes(next.state)) throw new Error('Invalid action state.');
      validateLinks(state, next.requirementIds);
      if (!next.requirementIds.length) throw new Error('Link each action to a requirement.');
      const old = state.actions.findIndex(item => item.id === next.id);
      if (old < 0) state.actions.push(next); else state.actions[old] = next;
    }
    const visiting = new Set(), visited = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error('Action dependencies contain a cycle.');
      if (visited.has(id)) return;
      const action = state.actions.find(item => item.id === id);
      if (!action) throw new Error('An action dependency does not exist.');
      visiting.add(id); action.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
      if (action.state === 'running' || action.state === 'done') {
        if (action.dependsOn.some(dependency => state.actions.find(item => item.id === dependency).state !== 'done')) throw new Error('Finish dependent actions first.');
      }
      if (action.state === 'done') {
        if (!action.evidenceIds.length) throw new Error('A completed action needs observed evidence.');
        for (const id of action.evidenceIds) {
          const proof = evidence.metadata(taskId, requestId, id);
          if (proof.failed || proof.status === 'failed' || proof.status === 'skipped' || ['plan', 'model', 'checkpoint', 'recovery'].includes(proof.kind)) throw new Error('Planning or failed output cannot establish a completed action.');
          if (action.kind === 'check' && !(proof.kind === 'verification' && proof.status === 'passed' && (proof.phase === 'reproduce' ? proof.expectedExit === 'nonzero' && proof.exitCode !== null && proof.exitCode !== 0 && proof.expectedOutput : !state.acceptance || proof.reviewStatus === 'approved' && proof.acceptanceStamp === state.acceptance.stamp))) throw new Error('A check action needs passing observed verification; a baseline action needs a matched nonzero reproduction.');
          if (action.kind === 'edit' && !(proof.kind === 'file' && proof.phase === 'after' || proof.kind === 'tool' && ['create_folder', 'apply_edit', 'write_file', 'delete_file', 'apply_patch_batch', 'semantic_rename'].includes(proof.name))) throw new Error('An edit action needs a recorded file change.');
        }
        if (action.kind === 'check' && action.requirementIds.some(id => !action.evidenceIds.some(proofId => evidence.metadata(taskId, requestId, proofId).requirementIds?.includes(id)))) throw new Error('The combined check evidence does not cover every linked requirement.');
      }
    }
    state.actions.forEach(action => visit(action.id));
    state.revision++; state.updatedAt = Date.now();
    evidence.record(taskId, requestId, { kind: 'plan', name: 'execution_map', revision: state.revision }, JSON.stringify(state));
    return save(safeValue(state));
  }
  function observe(taskId, requestId, entry) {
    const state = read(taskId, requestId);
    if (!state) return;
    const ids = entry.requirementIds ?? [];
    validateLinks(state, ids, entry.actionId);
    if (ids.length) state.proofs = state.proofs.filter(item => !(JSON.stringify(item.requirementIds) === JSON.stringify(ids) && item.phase === entry.phase && item.command === (entry.command ?? entry.name) && item.directory === (entry.directory ?? '')));
    if (ids.length) state.proofs.push({ evidenceId: entry.id, requirementIds: ids, phase: entry.phase,
      status: entry.status, reviewStatus: entry.reviewStatus, acceptanceStamp: entry.acceptanceStamp, acceptanceIds: entry.acceptanceIds ?? [], stateFingerprint: entry.stateFingerprint, recordedAt: entry.recordedAt,
      reviewEvidenceId: entry.reviewEvidenceId,
      command: entry.command ?? entry.name, directory: entry.directory ?? '' });
    state.updatedAt = Date.now(); save(state);
  }
  function validateSupport(taskId, requestId, input) {
    const state = read(taskId, requestId);
    validateLinks(state, input.requirement_ids);
    const sourceRequestId = input.source_request_id ?? requestId;
    validId(sourceRequestId);
    const source = evidence.metadata(taskId, sourceRequestId, input.evidence_id);
    if (source.failed || !['file', 'tool'].includes(source.kind) || !['read_file', 'read_file_range', 'fetch_webpage', 'web_search', 'project_brief', 'project_map', 'semantic_code'].includes(source.name)) throw new Error('Research support requires an observed source.');
    if (!evidence.matches(taskId, sourceRequestId, source.id, input.expected_text)) throw new Error('The requested source text was not found in this evidence.');
    return source;
  }
  function support(taskId, requestId, input, review = {}) {
    const source = validateSupport(taskId, requestId, input);
    const entry = evidence.record(taskId, requestId, { kind: 'verification', name: 'research_support', phase: 'research',
      status: review.status === 'awaiting_final_review' ? 'observed' : 'supported', reviewStatus: review.status, acceptanceStamp: review.acceptanceStamp, acceptanceIds: review.acceptanceIds ?? [], requirementIds: input.requirement_ids, sourceEvidenceId: source.id, sourceRequestId: input.source_request_id ?? requestId, stateFingerprint: source.stateFingerprint }, input.expected_text);
    observe(taskId, requestId, entry);
    return entry;
  }
  function view(taskId, requestId, currentFingerprint) {
    const state = read(taskId, requestId);
    if (!state) return null;
    const requirements = state.requirements.map(requirement => {
      const latest = new Map();
      for (const proof of state.proofs.filter(item => item.requirementIds.includes(requirement.id))) latest.set(`${proof.phase}:${proof.command}:${proof.directory}`, proof);
      const relevant = [...latest.values()].filter(item => requirement.verificationTypes.includes(item.phase) || item.phase === 'observation' && item.reviewStatus === 'approved' && item.acceptanceStamp === state.acceptance?.stamp && item.acceptanceIds?.length && item.acceptanceIds.every(id => state.acceptance.criteria.some(criterion => criterion.id === id && criterion.requirementId === requirement.id && criterion.method === 'observation')));
      const fresh = relevant.filter(item => item.stateFingerprint === currentFingerprint);
      const status = fresh.some(item => item.status === 'failed') ? 'failed'
        : fresh.some(item => item.status === 'passed') ? 'verified'
          : fresh.some(item => item.status === 'supported') ? 'supported'
            : relevant.some(item => item.stateFingerprint !== currentFingerprint) ? 'stale' : 'pending';
      const requiredCriteria = state.acceptance?.criteria?.filter(item => item.requirementId === requirement.id) ?? [];
      const covered = fresh.filter(item => ['passed', 'supported'].includes(item.status) && item.reviewStatus === 'approved' && item.acceptanceStamp === state.acceptance?.stamp).flatMap(item => item.acceptanceIds ?? []);
      const reviewedStatus = state.acceptance && ['verified', 'supported'].includes(status) && (state.acceptance.status !== 'approved' || !requiredCriteria.length || requiredCriteria.some(item => !covered.includes(item.id))) ? 'pending' : status;
      return { ...requirement, status: reviewedStatus, evidenceIds: relevant.map(item => item.evidenceId) };
    });
    const { proofs, ...summary } = state;
    return { ...summary, proofCount: proofs.length, requirements, complete: requirements.length > 0 && requirements.every(item => ['verified', 'supported'].includes(item.status)) && state.actions.every(item => item.state === 'done'),
      verified: requirements.filter(item => item.status === 'verified').length, supported: requirements.filter(item => item.status === 'supported').length };
  }
  function annotate(taskId, requestId, fields) {
    const state = read(taskId, requestId);
    for (const key of ['intent', 'acceptance', 'selectedContext', 'runtime', 'projectSetup']) if (key in fields) state[key] = safeValue(fields[key]);
    if (fields.intent?.taskKind === 'research') {
      for (const requirement of state.requirements.filter(item => item.placeholder)) requirement.verificationTypes = ['research'];
    }
    if (fields.intent?.taskKind === 'computer') {
      for (const requirement of state.requirements.filter(item => item.placeholder)) requirement.verificationTypes = ['focused'];
    }
    state.updatedAt = Date.now(); return save(state);
  }
  function completeAction(taskId, requestId, entry) {
    if (!entry.actionId || entry.failed || entry.status === 'failed') return;
    const state = read(taskId, requestId), action = state.actions.find(item => item.id === entry.actionId);
    if (!action || action.dependsOn.some(id => state.actions.find(item => item.id === id)?.state !== 'done')) return;
    // Use the same evidence/dependency validation as explicit completion; no model status is trusted.
    try { update(taskId, requestId, { actions: [{ id: action.id, title: action.title, kind: action.kind, requirement_ids: action.requirementIds, depends_on: action.dependsOn, state: 'done', evidence_ids: [entry.id], reason: 'Completed from the linked observed tool result.' }] }); } catch { /* Insufficient evidence leaves this action pending. */ }
  }
  function validateResearchDelivery(taskId, requestId, coveredIds) {
    const state = read(taskId, requestId);
    const researchIds = state.acceptance?.criteria?.filter(item => state.requirements.find(req => req.id === item.requirementId)?.verificationTypes.every(type => type === 'research')).map(item => item.id) ?? [];
    for (const proof of state.proofs.filter(item => item.phase === 'research' && item.acceptanceStamp === state.acceptance?.stamp)) {
      proof.acceptanceIds = proof.acceptanceIds.filter(id => !researchIds.includes(id) || coveredIds.includes(id));
    }
    state.updatedAt = Date.now(); save(state);
  }
  function invalidateCompletionObservations(taskId, requestId, reviewId, criterionIds) {
    if (!reviewId) return;
    const state = read(taskId, requestId);
    state.proofs = state.proofs.map(proof => ['observation', 'research'].includes(proof.phase) && proof.reviewEvidenceId === reviewId ? { ...proof, acceptanceIds: proof.acceptanceIds.filter(id => criterionIds && !criterionIds.includes(id)) } : proof).filter(proof => !['observation', 'research'].includes(proof.phase) || proof.acceptanceIds.length);
    state.updatedAt = Date.now(); save(state);
  }
  function completeVerifiedChecks(taskId, requestId, currentFingerprint) {
    let state = read(taskId, requestId);
    for (const action of state.actions.filter(item => item.kind === 'check' && item.state !== 'done')) {
      const coverage = view(taskId, requestId, currentFingerprint);
      if (action.requirementIds.some(id => !['verified', 'supported'].includes(coverage.requirements.find(item => item.id === id)?.status))) continue;
      const proofs = state.proofs.filter(item => item.phase !== 'reproduce' && item.status === 'passed' && item.stateFingerprint === currentFingerprint && item.reviewStatus === 'approved' && item.acceptanceStamp === state.acceptance?.stamp && item.requirementIds.some(id => action.requirementIds.includes(id)));
      try {
        update(taskId, requestId, { actions: [{ id: action.id, title: action.title, kind: action.kind, requirement_ids: action.requirementIds, depends_on: action.dependsOn, state: 'done', evidence_ids: proofs.map(item => item.evidenceId), reason: 'Completed from combined current verification for all linked outcomes.' }] });
        state = read(taskId, requestId);
      } catch { /* Unsatisfied dependencies or absent evidence remain pending. */ }
    }
  }
  function forget(taskId) { removeOwned(base, path.join(base, validId(taskId))); }
  return { ensure, read, update, validateLinks, observe, validateSupport, support, view, annotate, completeAction, completeVerifiedChecks, validateResearchDelivery, invalidateCompletionObservations, forget };
}
module.exports = { createExecutionMapStore };
