// Bounded live provider trial. All runtime records are isolated; the real project
// is inspected without edits, installations or project verification commands.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..', 'scratch', 'long-running-live-' + Date.now());
  fs.mkdirSync(root, { recursive: true });
  const env = { ...process.env, ORVIX_LONG_RUNNING_TRIAL: root }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'ignore' });
  const deadline = setTimeout(() => { fs.writeFileSync(path.join(root, 'launcher-timeout.txt'), 'The bounded live test did not finish within 230 seconds.'); child.kill(); }, 230000);
  child.once('error', error => { clearTimeout(deadline); process.stderr.write(error.message); process.exitCode = 1; });
  child.once('exit', () => {
    clearTimeout(deadline);
    const file = path.join(root, 'result.json');
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { passed: false, error: 'No completed live report.' };
    process.stdout.write(JSON.stringify({ report: file, ...report }, null, 2) + '\n'); process.exitCode = report.passed ? 0 : 1;
  });
} else {
  const { app } = require('electron');
  const root = process.env.ORVIX_LONG_RUNNING_TRIAL;
  app.setPath('userData', root);
  app.whenReady().then(async () => {
    const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
    const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
    const { createRuntimeLease } = require('../electron/agent/opencode-runtime-lease.cjs');
    const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
    const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
    const { createAgentEngine } = require('../electron/agent/engine.cjs');
    const { readEnvValue } = require('../electron/agent/credentials.cjs');
    const key = process.env.ORVIX_OPENCODE_ZEN_KEY?.trim() || readEnvValue(fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8'), 'ORVIX_OPENCODE_ZEN_KEY');
    const target = path.resolve(__dirname, '..'), taskId = 'long-running-live', events = [];
    const report = { at: new Date().toISOString(), target, scope: 'Live read-only diagnosis, injected client SSE disconnect, retained-session retrieval, encrypted worker ownership. Not a sustained uptime test.' };
    const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
    const log = text => fs.appendFileSync(path.join(root, 'activity.log'), new Date().toISOString() + ' ' + text + '\n');
    let injected = false;
    async function trialFetch(url, options) {
      const response = await fetch(url, options);
      if (!String(url).includes('/event') || injected || !response.ok || !response.body) return response;
      injected = true;
      const reader = response.body.getReader(); let closed = false, timer;
      const body = new ReadableStream({
        start(controller) {
          timer = setTimeout(() => { if (closed) return; closed = true; report.injectedDisconnect = true; log('Injected client event-stream disconnect; server remains running.'); controller.close(); void reader.cancel().catch(() => {}); }, 1500);
          void (async () => { try { while (!closed) { const { done, value } = await reader.read(); if (closed) break; if (done) { closed = true; controller.close(); break; } controller.enqueue(value); } } catch (error) { if (!closed) { closed = true; controller.error(error); } } finally { clearTimeout(timer); } })();
        }, cancel() { closed = true; clearTimeout(timer); return reader.cancel(); }
      });
      return new Response(body, { status: response.status, headers: response.headers });
    }
    const runtime = createOpenCodeWorkers(root, { create: directory => createOpenCodeHeadless(directory, { fetch: trialFetch, getProviderKey: () => key }) });
    configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
    const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => { events.push(event); if (event.type === 'activity') log(event.message); });
    let watchdog;
    try {
      const requestedModel = process.argv.find(value => value.startsWith('--model='))?.slice(8);
      if (requestedModel) {
        report.modelId = requestedModel;
        report.thinkingVariant = process.argv.find(value => value.startsWith('--variant='))?.slice(10);
      } else {
      const recordsRoot = path.join(process.env.APPDATA, 'Orvix', 'agent-task-records');
      const records = JSON.parse(fs.readFileSync(path.join(recordsRoot, 'index.json'), 'utf8')).files
        .filter(file => /^[a-f0-9]{64}\.json$/.test(file)).map(file => JSON.parse(fs.readFileSync(path.join(recordsRoot, file), 'utf8')))
        .filter(record => record.modelId?.startsWith('opencode/')).sort((a, b) => b.updatedAt - a.updatedAt);
      assert.ok(records.length, 'No saved native model selection.');
      report.modelId = records[0].modelId; report.thinkingVariant = records[0].thinkingVariant;
      }
      save();
      const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(60000));
      assert.ok(!catalog.error && !catalog.stale, catalog.error || 'Stale catalog');
      assert.ok(catalog.models.some(model => model.id === report.modelId), 'Saved model is unavailable; no silent model fallback.');
      const files = ['electron/agent/opencode-headless.cjs', 'electron/agent/read-only-command.cjs'];
      const hashes = () => files.map(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(target, file))).digest('hex'));
      const before = hashes();
      await engine.workspaces.open(taskId, target, async () => true);
      watchdog = setTimeout(() => engine.cancel(taskId), 180000);
      const start = Date.now();
      const result = await engine.run({ taskId, requestId: 'read-only-large-folder', modelId: report.modelId, thinkingVariant: report.thinkingVariant, accessMode: 'Full access', accessModeVersion: 2, designProfile: 'none',
        messages: [{ role: 'user', content: `Read-only diagnosis of ${target}. Do not edit, modify, create or delete files. Do not install anything, run a build, launch previews or inspect secrets. Read electron/agent/opencode-headless.cjs and electron/agent/read-only-command.cjs using native read. Run exactly one simple observation command with native bash: Get-ChildItem -LiteralPath "${path.join(target, 'electron', 'agent')}" | Measure-Object. Then give a concise factual report: does the build agent have a hardcoded steps limit, is automatic compaction enabled, and what does isReadOnlyCommand do? Do not investigate unrelated problems or run more checks.` }] });
      report.durationMs = Date.now() - start; report.text = result.text; report.usage = result.usage;
      report.tools = events.filter(event => event.type === 'tool' && event.phase === 'completed').map(event => ({ name: event.name, failed: event.failed, evidenceId: event.evidenceId }));
      report.recovery = events.filter(event => event.type === 'activity' && /reconnect|retained session/i.test(event.message)).map(event => event.message);
      report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(hashes()); report.changes = result.changes.length;
      assert.ok(report.sourceUnchanged && report.changes === 0, 'Live diagnosis changed project source.');
      assert.ok(report.tools.some(tool => tool.name === 'read' && !tool.failed), 'No successful native source read.');
      assert.ok(report.tools.some(tool => tool.name === 'bash' && !tool.failed), 'No successful read-only shell command.');
      assert.ok(!report.tools.some(tool => tool.failed), 'A native action failed during the trial.');
      assert.ok(report.injectedDisconnect && report.recovery.length, 'Injected disconnection did not exercise recovery.');
      const workerRoot = path.join(root, 'opencode-workers', crypto.createHash('sha256').update(taskId).digest('hex'), 'opencode-headless');
      const lease = createRuntimeLease(workerRoot), restored = await lease.reconnect(fetch, AbortSignal.timeout(5000));
      assert.equal(restored.pid, runtime.forTask(taskId).status().pid); report.encryptedOwnerReconnected = true;
      const sessions = await runtime.forTask(taskId).exclusive(null, ({ api }) => api('/session', { directory: target }));
      assert.ok(sessions.length, 'No retained builder session.');
      const startResume = Date.now();
      const resumed = await runOpenCodeSession({ taskId, modelId: report.modelId, variant: report.thinkingVariant, timeoutMs: 15000, parts: [],
        resumeSession: { sessionID: sessions[0].id, directory: target, modelId: report.modelId, variant: report.thinkingVariant ?? null },
        onPermission: async () => false, onCheckpoint: () => {}, onRequest: request => { if (request.kind === 'builder') report.resumeTrace = 'metadata-only'; } });
      report.retainedReplyRetrieved = resumed.text === result.text || resumed.text.includes('compaction');
      report.resumeMs = Date.now() - startResume;
      assert.ok(report.retainedReplyRetrieved, 'Retained reply differs from the observed completion.');
      report.passed = true;
    } catch (error) { report.passed = false; report.error = error.message; }
    finally {
      clearTimeout(watchdog);
      const status = runtime.status(), pids = [status.pid, ...Object.values(status.workers ?? {}).map(worker => worker.pid)].filter(pid => Number.isInteger(pid));
      engine.shutdown(); runtime.shutdown();
      const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
      for (let attempt = 0; attempt < 20 && pids.some(alive); attempt++) await new Promise(resolve => setTimeout(resolve, 250));
      report.ownedWorkersStopped = !pids.some(alive);
      if (!report.ownedWorkersStopped) { report.passed = false; report.error = 'An isolated trial worker remained alive after shutdown.'; }
      save(); app.exit(report.passed ? 0 : 1);
    }
  }).catch(error => { fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ passed: false, error: error.message })); app.exit(1); });
}
