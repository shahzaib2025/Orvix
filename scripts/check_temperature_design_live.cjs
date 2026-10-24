// Controlled layout experiment: same model, reasoning, human brief, application
// source and profile; fresh independent state/output for every generation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const stamp = Date.now();
const root = path.resolve('scratch/temperature-design-' + stamp);
const output = path.join(os.homedir(), 'Desktop', 'Orvix-Temperature-Comparison-' + stamp);
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const report = { root, output, startedAt: new Date().toISOString(), modelId: process.argv[2] || 'opencode/mimo-v2.6-flash-free', variant: null,
  designProfile: 'normal', reviewMode: 'off',
  brief: 'Create only one finished premium hero section for FlorianBD, a fictional greeting-card and personal-message shop. Use a coherent white theme and invent the visual concept, typography, composition and appropriate motion. The first screen must communicate the shop and feel professionally art directed. Include a primary action that opens a concise accessible local greeting-demo dialog, with close and Escape behavior. No backend, invented customer evidence or performance claims. Plain HTML/CSS/JavaScript with index.html as entry. Versioned CDN libraries only if useful; real image URLs are permitted, no photo downloads or generation. This is a deliberately bounded SINGLE HERO experiment: no full website, extra sections, pinned storytelling, pricing, forms or additional planning/review stages. Use your available preview tool once with desktop and mobile views and check the action; make at most one targeted correction if necessary. Deliver the working hero and stop.',
  controls: 'Two default-sampling and two temperature-0.6 generations. Same brief except authorized output path; same model/default reasoning, Default design profile and disabled independent review. Fresh task, memory, native worker and workspace each time; no earlier designs or source supplied. No seed override. This small sample cannot establish universal novelty or a causal quality improvement.', runs: [] };
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
let pool, engine;
(async () => {
  const discovery = createOpenCodeHeadless(path.join(root, 'preflight'), { buildTemperature: null });
  try {
    configureOpenCodeCatalog(path.join(root, 'preflight'), discovery);
    fs.mkdirSync(path.join(root, 'preflight'), { recursive: true });
    const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(60000));
    if (catalog.error || catalog.stale) throw Error(catalog.error || 'Stale catalog');
    const model = catalog.models.find(item => item.id === report.modelId);
    if (!model?.supportsTemperature) throw Error('Selected model does not advertise temperature support');
    report.model = model; save();
    configureOpenCodeModel(discovery);
    const ready = await runOpenCodeSession({ modelId: report.modelId, readOnly: true, timeoutMs: 90000, onPermission: async () => false,
      parts: [{ type: 'text', text: 'Reply exactly TEMPERATURE_READY. Do not call tools.' }] });
    report.providerPreflight = { text: ready.text, usage: ready.usage }; save();
    if (!ready.text.includes('TEMPERATURE_READY')) throw Error('Provider preflight did not return the requested marker');
  } finally { discovery.shutdown(); }
  // Interleave the arms so a time/order effect is less easily mistaken for a setting effect.
  for (const [index, temperature] of [null, 0.6, null, 0.6].entries()) {
    const label = `${String(index + 1).padStart(2, '0')}-${temperature === null ? 'Default-Sampling' : 'Temperature-06'}`;
    const project = path.join(output, label), data = path.join(root, label + '-engine');
    fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(data, { recursive: true });
    const run = { label, project, temperature, taskId: 'temp-' + crypto.randomUUID(), startedAt: new Date().toISOString(), events: [], status: 'running' };
    report.runs.push(run); save();
    pool = createOpenCodeWorkers(path.join(root, label + '-runtime'), {
      create: (directory, options) => createOpenCodeHeadless(directory, { buildTemperature: options?.buildTemperature === null ? null : temperature }),
    });
    configureOpenCodeCatalog(data, pool); configureOpenCodeModel(pool);
    const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(60000));
    if (catalog.error || catalog.stale) throw Error(catalog.error || 'Stale catalog');
    const started = Date.now();
    engine = createAgentEngine({ getPath: () => data, getVersion: () => 'temperature-comparison' }, { getKey: () => '' }, event => {
      if (['tool', 'activity', 'thinking', 'question', 'clarification'].includes(event.type)) {
        run.events.push({ atMs: Date.now() - started, type: event.type, name: event.name, phase: event.phase, failed: event.failed,
          detail: String(event.message ?? event.detail ?? '').slice(0, 300), input: String(event.input ?? '').slice(0, 600), output: String(event.output ?? '').slice(0, 500) });
        save();
      }
    });
    await engine.workspaces.open(run.taskId, project, async () => true);
    let watchdogExpired = false;
    const timer = setTimeout(() => { watchdogExpired = true; engine.cancel(run.taskId); }, 12 * 60 * 1000);
    try {
      const result = await engine.run({ taskId: run.taskId, requestId: 'generate-' + index, modelId: report.modelId,
        designProfile: 'normal', designReviewMode: 'off', accessMode: 'Full access', accessModeVersion: 2,
        messages: [{ role: 'user', content: report.brief + '\n\nUse the already-created authorized project folder: ' + project }] });
      Object.assign(run, { status: 'returned', text: result.text, verification: result.verification, usage: result.usage,
        files: result.changes?.map(change => change.path), durationMs: Date.now() - started });
    } catch (error) {
      Object.assign(run, { status: 'failed', error: error.message, harnessTimeout: watchdogExpired, durationMs: Date.now() - started });
      if (/HTTP (401|403|429)|quota|credit/i.test(error.message)) { report.blocker = error.message; break; }
    } finally {
      clearTimeout(timer); run.runtime = pool.status(); engine.shutdown(); pool.shutdown(); engine = null; pool = null;
      run.finishedAt = new Date().toISOString(); save();
      console.log(JSON.stringify({ label, status: run.status, durationMs: run.durationMs, error: run.error, project }));
    }
  }
})().catch(error => { report.error = error.message; process.exitCode = 1; })
  .finally(() => { engine?.shutdown(); pool?.shutdown(); report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ root, output, runs: report.runs.map(({ label, status, durationMs }) => ({ label, status, durationMs })), error: report.error, blocker: report.blocker })); });
