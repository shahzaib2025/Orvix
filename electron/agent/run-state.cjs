const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite, readJson, validId, safeValue } = require('./durable-store.cjs');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
function regressionObservations(checks) {
  const baselines = checks.filter(check => check.phase === 'reproduce' && check.status === 'passed' && check.exitCode === 0);
  let compared = 0, failed = 0;
  for (const baseline of baselines) {
    const current = checks.filter(check => check.phase !== 'reproduce' && !check.stale && !check.superseded && check.command === baseline.command && check.directory === baseline.directory && ['passed', 'failed'].includes(check.status)).at(-1);
    if (current) { compared++; if (current.status === 'failed') failed++; }
  }
  return { compared, failed };
}
function score(records) {
  const ended = records.filter(record => terminal.has(record.status));
  const coding = ended.filter(record => record.coding && !['cancelled', 'interrupted'].includes(record.status));
  const verified = record => record.status === 'completed' && record.verified === true;
  const first = new Map();
  for (const record of coding.slice().sort((a, b) => a.startedAt - b.startedAt)) { const key = record.taskId + ':' + record.requestId; if (!first.has(key)) first.set(key, record); }
  const repeats = new Map();
  for (const record of coding.filter(record => record.initialFingerprint)) { const key = digest([record.requestSignature, record.modelId, record.accessMode, record.thinkingVariant, record.initialFingerprint]); const group = repeats.get(key) ?? []; group.push(record); repeats.set(key, group); }
  const groups = [...repeats.values()].filter(group => group.length > 1);
  const tools = new Map();
  for (const record of records) for (const tool of record.tools ?? []) { const row = tools.get(tool.name) ?? { name: tool.name, count: 0, failed: 0, interrupted: 0, totalMs: 0, measured: 0, maxMs: 0 }; row.count++; row.failed += tool.status === 'failed' ? 1 : 0; row.interrupted += tool.status === 'interrupted' ? 1 : 0; const ms = tool.durationMs ?? 0; if (tool.durationMs !== null && tool.durationMs !== undefined) row.measured++; row.totalMs += ms; row.maxMs = Math.max(row.maxMs, ms); tools.set(tool.name, row); }
  for (const record of records) for (const archived of record.archivedToolStats ?? []) {
    const row = tools.get(archived.name) ?? { name: archived.name, count: 0, failed: 0, interrupted: 0, totalMs: 0, measured: 0, maxMs: 0 };
    for (const key of ['count', 'failed', 'interrupted', 'totalMs', 'measured']) row[key] += archived[key] ?? 0;
    row.maxMs = Math.max(row.maxMs, archived.maxMs ?? 0); tools.set(row.name, row);
  }
  const resumed = coding.filter(record => record.resumed);
  const compared = coding.reduce((sum, record) => sum + (record.regressions?.compared ?? 0), 0);
  const failedChecks = coding.reduce((sum, record) => sum + (record.regressions?.failed ?? 0), 0);
  return {
    attempts: records.length, active: records.filter(record => record.status === 'running').length,
    verified: coding.filter(verified).length, partial: coding.filter(record => record.status === 'completed' && !record.verified).length,
    failed: ended.filter(record => record.status === 'failed').length, cancelled: ended.filter(record => record.status === 'cancelled').length, interrupted: ended.filter(record => record.status === 'interrupted').length,
    firstAttempt: { passed: [...first.values()].filter(verified).length, total: first.size, rate: first.size ? [...first.values()].filter(verified).length / first.size : null },
    repeatConsistency: { passedGroups: groups.filter(group => group.every(verified)).length, groups: groups.length, rate: groups.length ? groups.filter(group => group.every(verified)).length / groups.length : null },
    recovery: { passed: resumed.filter(verified).length, total: resumed.length, rate: resumed.length ? resumed.filter(verified).length / resumed.length : null },
    regressions: { compared, failed: failedChecks, rate: compared ? failedChecks / compared : null },
    unsupportedClaimsBlocked: ended.reduce((sum, record) => sum + (record.unsupportedClaimsBlocked ?? 0), 0), falseCompletionRate: null,
    tools: [...tools.values()].map(row => ({ ...row, averageMs: row.measured ? row.totalMs / row.measured : null })).sort((a, b) => b.totalMs - a.totalMs),
    note: 'Observed runs, not a benchmark accuracy score. Verified requires current requirements/checks. Consistency groups need the same recorded starting source state and model. False-completion rate requires external grading; blocked claim warnings are reported separately. Regression counts compare observed previously passing commands only.'
  };
}
function createRunState(app) {
  const base = path.join(app.getPath('userData'), 'agent-attempts');
  const records = new Map();
  fs.mkdirSync(base, { recursive: true });
  for (const name of fs.readdirSync(base).filter(name => /^[\w-]+\.json$/.test(name) && !name.endsWith('.result.json'))) {
    const record = readJson(path.join(base, name)); if (record?.version !== 1 || !record.id) continue;
    if (record.status === 'running' && fs.existsSync(path.join(base, record.id + '.result.json'))) { const saved = readJson(path.join(base, record.id + '.result.json')); record.status = 'completed'; record.completedAt = saved._attemptCompletion?.completedAt ?? Date.now(); record.phase = 'completed'; record.verified = saved._attemptCompletion?.verified === true; record.unsupportedClaimsBlocked = saved._attemptCompletion?.unsupportedClaimsBlocked ?? 0; record.regressions = regressionObservations(saved.verification?.checks ?? []); atomicWrite(path.join(base, name), record); }
    if (record.status === 'running') { record.status = 'interrupted'; record.phase = 'interrupted'; record.completedAt = Date.now(); record.error = 'The application stopped before this attempt saved a final result.'; for (const tool of record.tools ?? []) if (tool.status === 'running') { tool.status = 'interrupted'; tool.durationMs = null; } atomicWrite(path.join(base, name), record); }
    records.set(record.id, record);
  }
  function archiveTools(record) {
    const archived = [];
    while (record.tools.length > 200) {
      const index = record.tools.findIndex(tool => tool.status !== 'running');
      if (index < 0) break; // Active work must remain visible and cancellable.
      const [tool] = record.tools.splice(index, 1); archived.push(tool);
      record.archivedToolStats ??= [];
      let row = record.archivedToolStats.find(item => item.name === tool.name);
      if (!row) { row = { name: tool.name, count: 0, failed: 0, interrupted: 0, totalMs: 0, measured: 0, maxMs: 0 }; record.archivedToolStats.push(row); }
      row.count++; row.failed += tool.status === 'failed' ? 1 : 0; row.interrupted += tool.status === 'interrupted' ? 1 : 0;
      row.totalMs += tool.durationMs ?? 0; row.maxMs = Math.max(row.maxMs, tool.durationMs ?? 0);
      row.measured += tool.durationMs != null ? 1 : 0; record.archivedToolCount = (record.archivedToolCount ?? 0) + 1;
    }
    if (archived.length) fs.appendFileSync(path.join(base, validId(record.id) + '.tools.jsonl'), archived.map(tool => JSON.stringify(safeValue(tool))).join('\n') + '\n', { mode: 0o600 });
  }
  const persist = record => { archiveTools(record); atomicWrite(path.join(base, validId(record.id) + '.json'), record); records.set(record.id, record); return view(record); };
  function view(record) { if (!record) return null; const { requestSignature, tools, initialFingerprint, archivedToolStats, archivedToolCount, ...metadata } = record; return { ...metadata, toolCount: (tools?.length ?? 0) + (archivedToolCount ?? 0), activeTool: tools?.findLast(tool => tool.status === 'running') ?? null }; }
  function latest(taskId, requestId) { validId(taskId); if (requestId) validId(requestId); return [...records.values()].filter(record => record.taskId === taskId && (!requestId || record.requestId === requestId)).sort((a, b) => b.startedAt - a.startedAt || b.sequence - a.sequence)[0] ?? null; }
  return {
    begin(input) { const record = { version: 1, id: crypto.randomUUID(), taskId: validId(input.taskId), requestId: validId(input.requestId), modelId: input.modelId, accessMode: input.accessMode, thinkingVariant: input.thinkingVariant ?? null, resumed: input.resume === true, requestSignature: digest(input.messages), initialFingerprint: null, startedAt: Date.now(), lastProgressAt: Date.now(), phaseStartedAt: Date.now(), sequence: records.size, status: 'running', phase: 'starting', tools: [], coding: false, verified: false }; persist(record); return record.id; },
    update(id, update) { const record = records.get(id); if (!record || record.status !== 'running') return view(record); Object.assign(record, safeValue(update)); return persist(record); },
    progress(id) { const record = records.get(id); if (!record || record.status !== 'running') return view(record); record.lastProgressAt = Date.now(); return view(record); },
    tool(id, event) { const record = records.get(id); if (!record || record.status !== 'running') return; let tool = record.tools.find(tool => tool.id === event.callId); if (!tool) { tool = { id: event.callId, name: event.name, startedAt: event.startedAt ?? Date.now(), status: 'running' }; record.tools.push(tool); } if (event.phase === 'completed') Object.assign(tool, { status: event.failed ? 'failed' : 'completed', durationMs: event.durationMs ?? Date.now() - tool.startedAt }); record.phase = event.phase === 'completed' ? 'planning' : event.name; record.phaseStartedAt = Date.now(); record.lastProgressAt = Date.now(); if (/^(write_file|apply_edit|delete_file|apply_patch_batch|semantic_rename|verify_work)$/.test(event.name) && record.accessMode !== 'Plan') record.coding = true; return persist(record); },
    finish(id, { result, error, verified = false, unsupportedClaimsBlocked = 0, interrupted = false }) { const record = records.get(id); if (!record) return null; if (result) atomicWrite(path.join(base, record.id + '.result.json'), { ...result, _attemptCompletion: { verified, unsupportedClaimsBlocked, completedAt: Date.now() } }); record.status = result ? 'completed' : interrupted ? 'interrupted' : /cancelled/i.test(String(error)) ? 'cancelled' : 'failed'; record.completedAt = Date.now(); record.phase = record.status; record.error = interrupted ? 'The application stopped before this attempt saved a final result.' : error ? safeValue(String(error)) : null; record.verified = verified; record.unsupportedClaimsBlocked = unsupportedClaimsBlocked; record.coding ||= record.accessMode !== 'Plan' && Boolean(result?.turnReport?.changes?.length || result?.verification?.checks?.length); record.regressions = regressionObservations(result?.verification?.checks ?? []); for (const tool of record.tools) if (tool.status === 'running') { tool.status = 'interrupted'; tool.durationMs = null; } return persist(record); },
    latest: (taskId, requestId) => view(latest(taskId, requestId)),
    result(taskId, requestId) { const record = latest(taskId, requestId); return record?.status === 'completed' ? readJson(path.join(base, record.id + '.result.json')) : null; },
    list: taskId => [...records.values()].filter(record => !taskId || record.taskId === taskId).map(view),
    scorecard: taskId => score([...records.values()].filter(record => !taskId || record.taskId === taskId)),
    forget(taskId) { validId(taskId); for (const [id, record] of records) if (record.taskId === taskId) { for (const suffix of ['.json', '.result.json', '.tools.jsonl']) { const file = path.join(base, validId(id) + suffix); try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } } records.delete(id); } }
  };
}
module.exports = { createRunState, score, regressionObservations };
