// Paced, real-provider transport/tool soak. It changes only its own scratch ledger.
// This measures session continuity, not website quality or guaranteed availability.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createVisualMcp } = require('../electron/agent/visual-mcp.cjs');
const { abortableDelay } = require('../electron/agent/model-failure-policy.cjs');
const { recoveryMetadata } = require('../electron/agent/provider-failure.cjs');
const { readEnvValue } = require('../electron/agent/credentials.cjs');
if (!process.argv.includes('--live')) throw Error('Pass --live to run the paced provider soak.');
const argument = (name, fallback) => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
const minutes = Number(argument('--minutes', '120'));
const intervalMs = Number(argument('--interval-ms', '60000'));
if (!(minutes >= 1 && minutes <= 240 && intervalMs >= 1000 && intervalMs <= 60000)) throw Error('Use 1–240 minutes and a 1–60 second interval.');
const root = path.resolve('scratch/provider-soak-' + Date.now());
fs.mkdirSync(root, { recursive: true });
const key = process.env.ORVIX_OPENCODE_ZEN_KEY?.trim() || readEnvValue(fs.readFileSync('.env', 'utf8'), 'ORVIX_OPENCODE_ZEN_KEY');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const report = { startedAt: new Date().toISOString(), scope: 'Paced native session/tool continuity; not UI quality or guaranteed uptime.',
  root, modelId: 'opencode/deepseek-v4.1-flash-free', variant: 'high', requestedMinutes: minutes, commits: 0, recoveries: [], injectedDisconnect: false };
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
const log = message => { fs.appendFileSync(path.join(root, 'activity.log'), new Date().toISOString() + ' ' + message + '\n'); console.log(message); };
let streamController, originalReader, streamClosed = false;
async function trialFetch(url, options) {
  const response = await fetch(url, options);
  if (!String(url).includes('/event') || report.injectedDisconnect || !response.ok || !response.body) return response;
  originalReader = response.body.getReader();
  const reader = originalReader;
  return new Response(new ReadableStream({
    start(output) {
      streamController = output; streamClosed = false;
      void (async () => {
        try {
          while (!streamClosed) {
            const { done, value } = await reader.read();
            if (streamClosed) break;
            if (done) { streamClosed = true; output.close(); break; }
            output.enqueue(value);
          }
        } catch (error) { if (!streamClosed) { streamClosed = true; output.error(error); } }
      })();
    }, cancel() { streamClosed = true; return reader.cancel(); },
  }), { status: response.status, headers: response.headers });
}
const workers = createOpenCodeWorkers(root, { create: directory => createOpenCodeHeadless(directory, { fetch: trialFetch, getProviderKey: () => key }) });
configureOpenCodeCatalog(root, workers); configureOpenCodeModel(workers);
const taskId = 'provider-soak';
let current, nextAt = Date.now(), deadline, deliveredDone = false, checkpoint, bridge, timer;
const definitions = [
  { name: 'next_case', description: 'Wait for the next paced case. If done=true, finish; otherwise calculate a+b and commit_case before requesting another.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'commit_case', description: 'Commit the exact current case once with its calculated integer sum.', parameters: { type: 'object', properties: { id: { type: 'string' }, sum: { type: 'integer' } }, required: ['id', 'sum'], additionalProperties: false } },
];
async function call(name, args, signal) {
  if (name === 'next_case') {
    if (current && !current.committed) throw Error('Commit the outstanding case before requesting another.');
    await abortableDelay(Math.max(0, nextAt - Date.now()), signal);
    if (Date.now() >= deadline) { deliveredDone = true; return { done: true, commits: report.commits }; }
    current = { id: crypto.randomUUID(), a: crypto.randomInt(100), b: crypto.randomInt(100), committed: false };
    nextAt = Date.now() + intervalMs;
    return { done: false, id: current.id, a: current.a, b: current.b };
  }
  assert.equal(name, 'commit_case');
  assert.ok(current && args.id === current.id, 'Unknown case');
  assert.equal(args.sum, current.a + current.b, 'Wrong sum');
  if (current.committed) { report.duplicateAttempts = (report.duplicateAttempts ?? 0) + 1; save(); return { alreadyCommitted: true }; }
  fs.appendFileSync(path.join(root, 'ledger.jsonl'), JSON.stringify({ id: args.id, sum: args.sum, at: new Date().toISOString() }) + '\n');
  current.committed = true; report.commits++; report.elapsedMs = Date.now() - deadline + minutes * 60000;
  save(); log('Committed case ' + report.commits);
  if (report.commits === 3 && !report.injectedDisconnect && streamController && !streamClosed) {
    report.injectedDisconnect = true; streamClosed = true; streamController.close(); void originalReader.cancel().catch(() => {});
    save(); log('Injected one client SSE disconnect. The server remains running.');
  }
  return { committed: true, next: 'Call next_case; continue until done=true.' };
}
(async () => {
  save(); log('REPORT ' + path.join(root, 'report.json'));
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(60000));
  assert.ok(!catalog.error && !catalog.stale, catalog.error || 'Stale model catalog');
  assert.ok(catalog.models.some(model => model.id === report.modelId && model.variants.includes(report.variant)), 'Requested model/variant unavailable; no fallback.');
  deadline = Date.now() + minutes * 60000;
  timer = setTimeout(() => controller.abort(), minutes * 60000 + 180000);
  const reply = await runOpenCodeSession({ taskId, modelId: report.modelId, variant: report.variant, directory: root, signal: controller.signal,
    parts: [{ type: 'text', text: 'Run a paced reliability check using ONLY orvix_visual_next_case and orvix_visual_commit_case. Request next_case, calculate a+b, commit_case with the supplied id and sum, repeat until next_case returns done=true. Waiting is intentional. Do not stop early or use any other tools. When done, report the commit count.' }],
    visualTools: async ({ signal, acceptsImages }) => (bridge = await createVisualMcp({ definitions, call, signal, acceptsImages, imageStore: { read() { throw Error('No images in this test'); } } })),
    onPermission: async request => /^orvix_visual_(?:next_case|commit_case)$/.test(request.permission),
    onCheckpoint: state => { checkpoint = state; fs.writeFileSync(path.join(root, 'checkpoint.json'), JSON.stringify(state, null, 2)); },
    onRecovery: message => { report.recoveries.push(message); save(); log(message); },
  });
  report.text = reply.text; report.usage = reply.usage;
  assert.ok(deliveredDone, 'Model stopped before the paced test finished.');
  assert.ok(report.injectedDisconnect && report.recoveries.length, 'The disconnect/recovery path was not observed.');
  const ledger = fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(new Set(ledger.map(row => row.id)).size, report.commits, 'Duplicate ledger mutation');
  report.passed = true;
})().catch(error => { report.passed = false; report.failure = recoveryMetadata(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer);
  const workerRoot = path.join(root, 'opencode-workers', crypto.createHash('sha256').update(taskId).digest('hex'), 'opencode-headless');
  try { report.nativeCredentialRemainsOnDisk = !!JSON.parse(fs.readFileSync(path.join(workerRoot, 'data/opencode/auth.json'), 'utf8')).opencode; }
  catch (error) { report.nativeCredentialRemainsOnDisk = error.code !== 'ENOENT'; }
  workers.shutdown();
  report.checkpointStatus = checkpoint?.status; report.finishedAt = new Date().toISOString();
  report.elapsedMs = deadline ? Date.now() - deadline + minutes * 60000 : 0;
  save(); log('Finished: ' + (report.passed ? 'passed' : report.failure?.kind || 'failed'));
});
