// Real provider exercise through the Orvix executor. Options only; no website.
const fs = require('node:fs'), path = require('node:path');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const root = fs.mkdtempSync(path.resolve(__dirname, '../scratch/design-options-stream-live-'));
const runtime = createOpenCodeHeadless(path.join(root, 'runtime'));
const report = { root, scope: 'One real options-only generation through Orvix, no website construction', updates: [], status: 'starting' };
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
let engine, timer, started;
(async () => {
  try {
    configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
    const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(45000));
    if (catalog.error || catalog.stale) throw Error(catalog.error || 'Provider catalog is stale');
    const requested = process.argv[2];
    const candidates = requested ? [requested] : ['opencode/space-bunny-free', 'opencode/glm-5.3-free', 'opencode/mimo-v2.6-flash-free'];
    const model = candidates.map(id => catalog.models.find(model => model.id === id)).find(Boolean);
    if (!model) throw Error('None of the previously authorized test models is available: ' + candidates.join(', '));
    report.model = model.id; report.variant = model.variants.includes('high') ? 'high' : model.variants[0];
    console.log(JSON.stringify({ root, model: report.model, variant: report.variant }));
    engine = createAgentEngine({ getPath: () => path.join(root, 'engine'), getVersion: () => 'options-stream-test' }, { getKey: () => '' }, event => {
      if (event.type === 'model_progress' && event.progressId === 'website-design-options') {
        const elapsedMs = Date.now() - started;
        report.updates.push({ elapsedMs, phase: event.phase, characters: event.text?.length ?? 0 });
        if (event.phase === 'update' && report.firstDraftMs == null) {
          report.firstDraftMs = elapsedMs;
          fs.writeFileSync(path.join(root, 'first-live-draft.md'), event.text ?? '');
          console.log(JSON.stringify({ stage: 'first_live_draft', elapsedMs, characters: event.text?.length }));
        }
        if (event.text) fs.writeFileSync(path.join(root, 'latest-live-draft.md'), event.text);
        save();
      }
      if (event.type === 'approval') engine.decide(event.approvalId, false);
    });
    started = Date.now(); report.status = 'generating'; save();
    timer = setTimeout(() => engine.cancel('live-options'), 180000);
    const reply = await engine.run({ taskId: 'live-options', requestId: 'turn', modelId: model.id, thinkingVariant: report.variant, designProfile: 'max', designReviewMode: 'off', accessMode: 'Plan', accessModeVersion: 2,
      messages: [{ role: 'user', content: 'Use website_layout_options to develop two distinct website layout options for a fictional independent sound-design studio. Choose one and give its selected layout blueprint. This is an options-only task: do not build a website, create project files, run commands, or inspect existing projects. Follow the public Option A, Option B, Selected option, Selection reason, Selected layout blueprint order. Write the actual public deliverable visibly as you develop it so I can watch the options stream. Keep both options credible, roughly 120 words each, and keep the selected blueprint concise, with five developed section purposes. No fabricated client names or awards.' }] });
    report.durationMs = Date.now() - started;
    fs.writeFileSync(path.join(root, 'final-response.md'), reply.text);
    const drafts = report.updates.filter(update => update.phase === 'update');
    report.liveSnapshots = drafts.length;
    report.distinctDraftLengths = new Set(drafts.map(update => update.characters)).size;
    report.status = drafts.length > 1 && report.distinctDraftLengths > 1 && report.firstDraftMs < report.durationMs ? 'passed' : 'no_incremental_provider_output';
    save(); console.log(JSON.stringify({ status: report.status, model: report.model, durationMs: report.durationMs, firstDraftMs: report.firstDraftMs, liveSnapshots: report.liveSnapshots, root }));
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    report.status = 'failed'; report.error = error.message; report.durationMs = started ? Date.now() - started : null;
    save(); console.error(JSON.stringify({ status: report.status, error: report.error, root })); process.exitCode = 1;
  } finally { clearTimeout(timer); await engine?.shutdown(); await runtime.shutdown(); save(); }
})();
