// Live, isolated task through the production executor. No credential values are logged.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCredentials } = require('../electron/agent/credentials.cjs');
const { createTaskStore } = require('../electron/agent/task-store.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { loadOpenCodeEnv } = require('../electron/agent/load-opencode-env.cjs');
const { readNativeSnapshot } = require('../electron/agent/native-snapshot.cjs');
const { safeValue, atomicWrite } = require('../electron/agent/durable-store.cjs');
const { runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
app.setName('Orvix');
app.whenReady().then(async () => {
  loadOpenCodeEnv(path.resolve(__dirname, '..'));
  const credentials = createCredentials(app, safeStorage);
  const latest = createTaskStore(app).read().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const modelId = latest?.modelId || 'opencode/mimo-v2.6-flash-free';
  const base = path.resolve(__dirname, '..', 'benchmarks', '.runs');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'pc-status-'));
  const runtime = createOpenCodeHeadless(path.join(root, 'runtime'), process.env.ORVIX_STATUS_PROBE_BINARY ? { binary: process.env.ORVIX_STATUS_PROBE_BINARY } : {});
  configureOpenCodeCatalog(app.getPath('userData'), runtime);
  configureOpenCodeModel(runtime);
  const taskId = 'pc-status-' + crypto.randomUUID(), requestId = crypto.randomUUID();
  const startedAt = Date.now(), events = [], requests = [], tools = new Map();
  const elapsed = () => Date.now() - startedAt;
  let engine, result, error, firstAcknowledgementMs = null, firstToolMs = null, phase;
  const reportFile = path.join(root, 'report.json');
  const timelineFile = path.join(root, 'timeline.json');
  const save = () => atomicWrite(timelineFile, { modelId, prompt: 'chk the pc status', events, requests });
  engine = createAgentEngine({ getPath: () => path.join(root, 'data'), getVersion: () => app.getVersion() }, credentials, packet => {
    if (['activity', 'tool', 'approval', 'clarification'].includes(packet.type) || packet.type === 'model_progress' && packet.progressKind === 'agent_update' || packet.type === 'stream' && packet.phase === 'delta') {
      events.push(safeValue({ atMs: elapsed(), type: packet.type, phase: packet.phase, name: packet.name, callId: packet.callId, failed: packet.failed, kind: packet.kind, command: packet.command, message: packet.message, text: packet.text ?? packet.delta, input: packet.input, output: packet.output, detail: packet.detail, durationMs: packet.durationMs })); save();
    }
    if (packet.type === 'model_progress' && packet.progressKind === 'agent_update' && packet.text) firstAcknowledgementMs ??= elapsed();
    if (packet.type === 'tool') {
      if (packet.phase === 'started') { firstToolMs ??= elapsed(); tools.set(packet.callId, { name: packet.name, startedMs: elapsed() }); console.log(`[${(elapsed()/1000).toFixed(1)}s] Tool: ${packet.name}`); }
      if (packet.phase === 'completed') Object.assign(tools.get(packet.callId) || {}, { durationMs: packet.durationMs, failed: packet.failed, output: safeValue(packet.output) });
    }
    if (packet.type === 'run_state' && phase !== packet.run?.phase) { phase = packet.run?.phase; console.log(`[${(elapsed()/1000).toFixed(1)}s] ${phase}`); }
    // Observation only: retain and decline any unexpected approval rather than silently authorizing it.
    if (packet.type === 'approval') {
      const command = String(packet.command || '').replace(/^bash:\s*/i, '').trim();
      const readOnly = /\b(?:Get-CimInstance|Get-Process|Get-Counter|Get-PSDrive|Get-ComputerInfo|Get-Volume|Get-NetAdapter|Get-NetIPConfiguration|Get-NetIPAddress|Test-Connection)\b/i.test(command)
        && !/\b(?:Set|Remove|New|Stop|Restart|Invoke|Clear|Add|Enable|Disable|Copy|Move|Export|Rename)-[\w-]+\b|\b(?:Start|Stop)-Process\b|Out-File|Set-Content|Add-Content|(?:^|[|;\s])>{1,2}(?:\s|$)/i.test(command.replace(/\bNew-TimeSpan\b/gi, 'TimeSpanQuery'));
      console.log(`[${(elapsed()/1000).toFixed(1)}s] Approval: ${packet.kind}; read-only=${readOnly}; ${command.slice(0, 180)}`);
      engine.decide(packet.approvalId, packet.kind === 'host_command' && readOnly ? 'host' : false);
    }
  }, () => {}, {
    nativeSnapshot: async () => readNativeSnapshot(path.join(process.env.LOCALAPPDATA, 'PCMonitorTest', 'current-state.json')),
    runNativeSession: async input => {
      const row = { purpose: 'native_opencode_session', startedMs: elapsed(), status: 'running' }; requests.push(row); save();
      try { const answer = await runOpenCodeSession(input); Object.assign(row, { durationMs: elapsed()-row.startedMs, status: 'completed', toolProposals: null }); return answer; }
      catch (caught) { Object.assign(row, { durationMs: elapsed()-row.startedMs, status: 'failed', error: safeValue(caught.message) }); throw caught; }
      finally { save(); }
    }
  });
  const timer = setInterval(() => console.log(`[${(elapsed()/1000).toFixed(1)}s] Active: ${phase}; ${requests.length} model requests; ${tools.size} tools`), 30000);
  // This probe ends after five minutes so its diagnostics cannot run indefinitely.
  const watchdog = setTimeout(() => { console.log('Probe exceeded five minutes; cancelling.'); engine.cancel(taskId); }, 300000);
  try {
    console.log(`Live prompt: chk the pc status; model=${modelId}; report=${reportFile}`);
    result = await engine.run({ taskId, requestId, modelId, thinkingVariant: latest?.thinkingVariant, accessMode: 'Controlled', accessModeVersion: 2, messages: [{ role: 'user', content: 'chk the pc status' }] });
  } catch (caught) { error = safeValue(caught.message || String(caught)); }
  finally { clearInterval(timer); clearTimeout(watchdog); }
  const report = { modelId, prompt: 'chk the pc status', isolatedRuntimeCopy: Boolean(process.env.ORVIX_STATUS_PROBE_BINARY), startedAt: new Date(startedAt).toISOString(), durationMs: elapsed(), firstAcknowledgementMs, firstToolMs, error: error || null, reply: result?.text || null, verification: result?.verification || null, tools: [...tools.values()], requests, timelineFile, note: 'Live provider and real Windows observation through the production executor; isolated saved task state. Does not measure page rendering.' };
  atomicWrite(reportFile, report); engine.shutdown(); runtime.shutdown();
  console.log(JSON.stringify({ modelId, durationMs: report.durationMs, firstAcknowledgementMs, firstToolMs, toolCalls: tools.size, providerRequests: requests.length, error: report.error, reply: report.reply, reportFile }));
  app.exit(error ? 1 : 0);
}).catch(error => { console.error(safeValue(error.message)); app.exit(1); });
