const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const bundled = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/components/agentTaskPresentation.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' });
const moduleFixture = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, { module: moduleFixture, exports: moduleFixture.exports });
const { taskProgress, completionEvidence, elapsedTime, isPreviewFile } = moduleFixture.exports;
const pending = { status: 'pending', createdAt: 1000 };
const tool = (name, input = '{}', status = 'running') => ({ kind: 'tool', name, input, detail: 'fixture.ts', id: name, startedAt: 1000, status });
const check = (overrides = {}) => ({ phase: 'build', label: 'Build', status: 'passed', command: 'npm run build', output: '', directory: 'fixture', durationMs: 1, ...overrides });
const turn = (verification, changes = []) => ({ status: 'done', createdAt: 1000, completedAt: 3000, turnReport: { changes, verification, comparisonsLimited: false, recordedAt: 3000 } });
const change = { path: 'fixture/index.html', folder: 'fixture', kind: 'modified', added: 20, deleted: 3, binary: false };

test('status follows current activity, with explicit question and permission priority', () => {
  assert.equal(taskProgress().stage, 'idle');
  assert.equal(taskProgress(pending).stage, 'thinking');
  const editing = { ...pending, activity: [tool('write_file')] };
  assert.equal(taskProgress(editing).stage, 'editing');
  assert.equal(taskProgress(editing, 'question').label, 'Waiting for your answer');
  assert.equal(taskProgress(editing, 'permission').label, 'Waiting for permission');
  assert.equal(taskProgress(editing).stage, 'editing');
  assert.equal(taskProgress({ ...editing, status: 'done' }).stage, 'finished');
  assert.equal(taskProgress({ ...pending, activity: [tool('write_file', '{}', 'completed')] }).stage, 'thinking');
});
test('commands only claim checking when their observed command is a check', () => {
  assert.equal(taskProgress({ ...pending, activity: [tool('bash', '{"command":"npm run build"}')] }).stage, 'checking');
  assert.equal(taskProgress({ ...pending, activity: [tool('run_command', '{"command":"Get-Content app.ts"}')] }).stage, 'working');
  assert.equal(taskProgress({ ...pending, activity: [tool('verify_work')] }).stage, 'checking');
  assert.equal(taskProgress({ ...pending, activity: [tool('apply_patch_batch')] }).stage, 'editing');
  assert.equal(taskProgress({ ...pending, activity: [tool('read_file')] }).label, 'Inspecting files');
  assert.equal(taskProgress({ ...pending, runState: { phase: 'connecting' } }).label, 'Connecting');
  assert.equal(taskProgress({ ...pending, runState: { phase: 'verification' } }).stage, 'checking');
  assert.equal(taskProgress({ ...pending, runState: { phase: 'write_file' } }).stage, 'editing');
});
test('missing evidence never claims that the job was verified', () => {
  assert.equal(completionEvidence(turn(null, [change])).tone, 'attention');
  assert.equal(completionEvidence(turn({ status: 'passed', checks: [] })).tone, 'attention');
  assert.equal(completionEvidence({ status: 'done', createdAt: 0 }).title, 'Reply ready');
  assert.equal(completionEvidence({ status: 'done', createdAt: 0 }).files.length, 0);
});
test('reproduction and superseded results do not count as final failures', () => {
  const result = completionEvidence(turn({ status: 'passed', checks: [check(), check({ phase: 'reproduce', status: 'failed' }), check({ superseded: true, status: 'failed' })] }, [change]));
  assert.equal(result.passed, 1); assert.equal(result.failed, 0); assert.equal(result.tone, 'success');
  assert.equal(result.added, 20); assert.equal(result.deleted, 3);
});
test('stale, skipped, pending and merely supported requirements stay visible', () => {
  for (const status of ['pending', 'supported', 'stale', 'failed']) {
    const result = completionEvidence(turn({ status: 'passed', checks: [check()], requirements: [{ id: 'a', text: 'Task', status }] }));
    assert.equal(result.tone, 'attention'); assert.match(result.issues.join(' '), /not yet verified/);
  }
  const result = completionEvidence(turn({ status: 'passed', checks: [check({ stale: true }), check({ status: 'skipped' })] }));
  assert.equal(result.passed, 0); assert.equal(result.unconfirmed, 2); assert.equal(result.tone, 'attention');
  assert.equal(completionEvidence(turn({ status: 'passed', checks: [check()], executionPending: true })).tone, 'attention');
});
test('terminal errors override earlier passing checks; current failures count', () => {
  const verified = turn({ status: 'passed', checks: [check()] });
  assert.equal(completionEvidence({ ...verified, status: 'error', runState: { status: 'cancelled' } }).title, 'Run stopped');
  assert.equal(completionEvidence({ ...verified, status: 'error' }).tone, 'error');
  const failed = completionEvidence(turn({ status: 'failed', checks: [check({ status: 'failed' })] }));
  assert.equal(failed.failed, 1); assert.equal(failed.tone, 'error');
});
test('file counts preserve unavailable comparisons and exclude folders from line counts', () => {
  const result = completionEvidence(turn(null, [{ ...change, diffAvailable: false }, { ...change, directory: true, added: 500 }]));
  assert.equal(result.files.length, 1); assert.equal(result.added, 20); assert.equal(result.limited, true);
});
test('interrupted turns show live per-turn edits and creations when the final report is not attached', () => {
  const edited = { ...change, path: 'fixture/index.html', kind: 'modified', added: 2, deleted: 1 };
  const created = { ...change, path: 'fixture/script.js', kind: 'created', added: 3, deleted: 0 };
  const result = completionEvidence({ status: 'error', runState: { status: 'interrupted', completedAt: 5000 }, createdAt: 1000,
    turnReport: { changes: [], recordedAt: 3000, comparisonsLimited: false, verification: null }, liveFileChanges: [edited, created] });
  assert.equal(result.title, 'Run needs attention'); assert.equal(result.changesRecorded, true);
  assert.deepEqual(result.files.map(file => file.path), [edited.path, created.path]);
  assert.equal(result.added, 5); assert.equal(result.deleted, 1);
});
test('time formatting and preview selection handle long jobs and source files', () => {
  assert.equal(elapsedTime(-1000), '0s'); assert.equal(elapsedTime(65000), '1m 5s'); assert.equal(elapsedTime(3600000), '1h 0m');
  assert.equal(isPreviewFile('C:\\project\\INDEX.HTML'), true); assert.equal(isPreviewFile('app.tsx'), false);
});
