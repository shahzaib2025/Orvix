const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { request } = require('../electron/agent/model-client.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const directory = path.resolve(__dirname, '..', 'scratch', 'opencode-headless-live');
fs.mkdirSync(directory, { recursive: true });
const runtime = createOpenCodeHeadless(directory);
configureOpenCodeCatalog(directory, runtime); configureOpenCodeModel(runtime);
const results = { at: new Date().toISOString(), checks: [] };
let engine;
function save() { fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(results, null, 2)); }
(async () => {
  const before = runtime.status();
  if (before.running || before.starting) throw new Error('Runtime started eagerly.');
  const catalog = await refreshOpenCodeCatalog(true, new AbortController().signal);
  if (catalog.error || catalog.stale) throw new Error(catalog.error || 'Catalog is stale.');
  results.models = catalog.models; results.excluded = catalog.excluded;
  results.health = await runtime.exclusive(null, ({ api }) => api('/global/health'));
  results.checks.push('on-demand startup and live free catalog');
  const pid = runtime.status().pid;
  if (process.platform === 'win32' && Number.isInteger(pid)) results.process = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${pid} | Select-Object Id,CPU,@{Name='workingSetMB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}},@{Name='privateMB';Expression={[math]::Round($_.PrivateMemorySize64/1MB,1)}} | ConvertTo-Json`], { windowsHide: true, encoding: 'utf8' }));
  save();
  if (process.argv.includes('--live')) {
    const modelId = 'opencode/mimo-v2.6-flash-free';
    const signal = new AbortController().signal;
    const start = Date.now();
    const greeting = await request({ modelId, history: [{ role: 'user', content: 'hi' }], tools: [], purpose: 'conversation', signal, timeoutMs: 60000 });
    results.greeting = { text: greeting.text, usage: greeting.usage, durationMs: Date.now() - start };
    results.checks.push('MiMo live greeting through official runtime'); save();
    const fixture = fs.mkdtempSync(path.join(directory, 'fixture-'));
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'orvix-headless-fixture', private: true }));
    const file = path.join(fixture, 'probe.txt'); fs.writeFileSync(file, 'HEADLESS_READ_MARKER_7319\n');
    const observed = []; let approvalAction = null;
    const engineData = path.join(directory, `engine-${Date.now()}`); results.engineData = engineData;
    engine = createAgentEngine({ getPath: () => engineData, getVersion: () => 'test' }, { getKey: () => '' }, event => {
      observed.push(event); if (event.type === 'approval' && approvalAction) queueMicrotask(() => approvalAction(event));
    });
    engine.workspaces.forget('headless-live-read'); engine.workspaces.forget('headless-live-edit');
    await engine.workspaces.open('headless-live-read', fixture, async () => true);
    const read = await engine.run({ taskId: 'headless-live-read', requestId: 'headless-live-read-1', modelId, accessMode: 'Plan', accessModeVersion: 2,
      messages: [{ role: 'user', content: 'Read probe.txt with the read tool and report the exact marker it contains. Do not use shell commands or change files.' }] });
    if (!read.text.includes('HEADLESS_READ_MARKER_7319') || !observed.some(event => event.type === 'tool' && event.name === 'read' && event.phase === 'completed' && !event.failed)) throw new Error('Native read was not observed through Orvix.');
    if (fs.readFileSync(file, 'utf8') !== 'HEADLESS_READ_MARKER_7319\n') throw new Error('Plan mode changed the fixture.');
    results.read = { text: read.text, tools: observed.filter(event => event.type === 'tool').map(event => ({ name: event.name, phase: event.phase, failed: event.failed, evidenceId: event.evidenceId })) };
    results.checks.push('Orvix Plan mode: native file read and persisted tool evidence'); save();
    await engine.workspaces.open('headless-live-edit', fixture, async () => true);
    const edited = await engine.run({ taskId: 'headless-live-edit', requestId: 'headless-live-edit-1', modelId, accessMode: 'Full access', accessModeVersion: 2,
      messages: [{ role: 'user', content: 'Change probe.txt to contain exactly HEADLESS_EDIT_MARKER_9472 followed by a newline, using the edit or write tool. Read it back and report its contents. Do not run shell commands.' }] });
    if (fs.readFileSync(file, 'utf8') !== 'HEADLESS_EDIT_MARKER_9472\n' || !edited.changes.some(change => change.path === file)) throw new Error('Native file edit was not captured in Orvix changes.');
    engine.changes.restore('headless-live-edit', file);
    if (fs.readFileSync(file, 'utf8') !== 'HEADLESS_READ_MARKER_7319\n') throw new Error('Restore did not recover the pre-edit contents.');
    if (edited.changes.length !== 1) throw new Error('Unrelated files were included in the fixture changes.');
    results.edit = { text: edited.text, usage: edited.usage, trackedChanges: edited.changes.length, restored: true, fixture };
    results.checks.push('Orvix Full access: native edit, tracked diff, and actual restore'); save();
    if (process.argv.includes('--approvals')) {
      for (const task of ['headless-live-approved', 'headless-live-declined', 'headless-live-cancel']) { engine.workspaces.forget(task); await engine.workspaces.open(task, fixture, async () => true); }
      approvalAction = event => engine.decide(event.approvalId, 'host');
      const approved = await engine.run({ taskId: 'headless-live-approved', requestId: 'approved-1', modelId, accessMode: 'Controlled', accessModeVersion: 2,
        messages: [{ role: 'user', content: 'Use the write tool to replace ALL of probe.txt with exactly HEADLESS_APPROVED_MARKER followed by exactly ONE newline. Do not append another newline or use shell commands. Read it back to confirm the replacement.' }] });
      if (fs.readFileSync(file, 'utf8') !== 'HEADLESS_APPROVED_MARKER\n' || !observed.some(event => event.type === 'approval' && event.taskId === 'headless-live-approved')) throw new Error('Controlled approval did not execute its reviewed edit.');
      engine.changes.restore('headless-live-approved', file);
      results.approved = { text: approved.text, changes: approved.changes.length }; results.checks.push('live Controlled approval and restore'); save();
      approvalAction = event => engine.decide(event.approvalId, false);
      const declined = await engine.run({ taskId: 'headless-live-declined', requestId: 'declined-1', modelId, accessMode: 'Controlled', accessModeVersion: 2,
        messages: [{ role: 'user', content: 'Use the edit tool to replace the contents of probe.txt with DECLINED_SHOULD_NOT_APPEAR. If approval is declined, stop and report that; do not try alternative tools.' }] });
      if (fs.readFileSync(file, 'utf8') !== 'HEADLESS_READ_MARKER_7319\n' || !observed.some(event => event.type === 'approval' && event.taskId === 'headless-live-declined')) throw new Error('Declined edit changed the fixture or skipped approval.');
      results.declined = { text: declined.text, unchanged: true }; results.checks.push('live Controlled decline prevents write'); save();
      approvalAction = () => engine.cancel('headless-live-cancel');
      try {
        await engine.run({ taskId: 'headless-live-cancel', requestId: 'cancel-1', modelId, accessMode: 'Controlled', accessModeVersion: 2,
          messages: [{ role: 'user', content: 'Use the edit tool to change probe.txt to CANCELLED_SHOULD_NOT_APPEAR. Do not use shell commands.' }] });
        throw new Error('Cancelled native turn returned success.');
      } catch (error) { if (!/Task cancelled/.test(error.message)) throw error; }
      if (fs.readFileSync(file, 'utf8') !== 'HEADLESS_READ_MARKER_7319\n') throw new Error('Cancelled approval changed the fixture.');
      results.checks.push('live cancellation while waiting for approval'); save();
      const thinking = await runOpenCodeSession({ modelId: 'opencode/space-bunny-free', variant: 'low', parts: [{ type: 'text', text: 'hi' }], signal, timeoutMs: 75000, onPermission: async () => false });
      results.thinking = { modelId: 'opencode/space-bunny-free', variant: 'low', text: thinking.text, usage: thinking.usage }; results.checks.push('Space Bunny Free live low thinking variant'); save();
    }
    engine.shutdown();
  }
  const sessions = await runtime.exclusive(null, ({ api }) => api('/session'));
  if (Array.isArray(sessions) && sessions.length) throw new Error('Temporary model sessions were not cleaned up.');
  results.checks.push('temporary session cleanup');
  runtime.shutdown();
  if (runtime.status().running || runtime.status().pid) throw new Error('Shutdown retained its runtime.');
  results.checks.push('owned runtime shutdown'); save();
  await new Promise(resolve => setTimeout(resolve, 500));
  try { process.kill(pid, 0); throw new Error('Owned OpenCode process remained alive after shutdown.'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  results.checks.push('actual process exit'); save();
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { results.error = error.message; engine?.shutdown(); runtime.shutdown(); save(); console.error(error.stack); process.exitCode = 1; });
