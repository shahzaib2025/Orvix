// One user-requested refinement, recorded separately from the frozen comparison.
const fs = require('node:fs'), path = require('node:path');
const { app, safeStorage } = require('electron');
app.setPath('userData', path.join(process.env.APPDATA, 'Orvix'));
const { installFileConsole } = require('./file-console.cjs');
const { createSearchKeyStore } = require('../electron/search-key-store.cjs');
const { configureSearchKeys } = require('../electron/serper-search.cjs');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { selectedSkill } = require('../electron/agent/skill-library.cjs');
const baseline = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
const run = baseline.runs.find(item => item.profile === 'max');
if (!run || run.status !== 'returned') throw Error('Expected completed comparison MAX sample.');
const reportFile = path.join(baseline.stateRoot, 'max-text-svg-refinement.json');
if (fs.existsSync(reportFile)) throw Error('This bounded refinement has already been attempted.');
const report = { project: run.project, taskId: run.taskId, root: run.root, model: run.model, variant: run.variant, profile: 'max', requestId: 'text-svg-refinement', skillHash: selectedSkill('website_design', 'max').contentHash, motionSkillHash: selectedSkill('website_motion_max', 'max').contentHash, startedAt: new Date().toISOString(), status: 'starting', events: [] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
installFileConsole(path.join(baseline.stateRoot, 'max-text-svg-refinement.log'));
save();
let engine, runtime, timer;
const begun = Date.now();
app.whenReady().then(async () => {
  configureSearchKeys(createSearchKeyStore(app, safeStorage));
  runtime = createOpenCodeHeadless(path.join(run.root, 'text-svg-runtime'));
  configureOpenCodeCatalog(run.root, runtime); configureOpenCodeModel(runtime);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(90000));
  const model = catalog.models.find(item => item.id === run.model);
  if (catalog.error || catalog.stale || !model || run.variant && !model.variants.includes(run.variant)) throw Error('Original model/reasoning unavailable; no substitution.');
  engine = createAgentEngine({ getPath: () => path.join(run.root, 'engine'), getVersion: () => 'profile-max-text-svg-refinement' }, { getKey: () => '' }, event => {
    if (['tool', 'activity'].includes(event.type)) { report.events.push({ atMs: Date.now() - begun, type: event.type, name: event.name, phase: event.phase, failed: event.failed, message: event.message }); save(); }
    if (event.type === 'approval') engine.decide(event.approvalId, false);
    if (event.type === 'question') { report.question = event.question; engine.cancel(run.taskId); }
  });
  await engine.workspaces.open(run.taskId, run.project, async () => true);
  timer = setTimeout(() => engine.cancel(run.taskId), 600000);
  report.status = 'building'; save();
  const prompt = "The human likes this MAX website but asks for more attraction through richer text animation and more meaningful SVG animation. Refine this existing FIELDNOTE site in its current folder, preserving its identity, photographs, ten content sections, two different pinned scenes, working local inquiry form and factual labels. Read the updated selected website_design_max and website_motion_max managed skills. Invent the actual choreography and SVG artwork for this subject: richer hero text plus at least three substantial supporting text moments with distinct behavior, including scroll-progressive text; at least two meaningful SVG story treatments, including shape/structure change rather than just a static diagram, divider or icon. Keep reading areas calm and legible; no repeated effect applied everywhere, no arbitrary decorative blobs, no new full-site layout or image downloads. Correct the observed motion lifecycle faults in the existing source while doing this coherent motion refinement: startLenis currently adds an anonymous ticker callback which stopLenis never removes, causing a null.raf error after stop; keep/remove the exact named callback and avoid accumulation on reduced-motion changes. The hero's repeating parent contains an indefinitely repeating scan child, leaving other layers finished once; keep parent cycles finite or use independently owned ambient timelines, and avoid pointer motion overwriting the subject loop. Keep a useful complete mobile/reduced-motion composition and actual text wrapping, all controls and honest local-only behavior. Avoid unsupported copy such as claiming no third-party requests beyond fonts/images when this page also loads CDN scripts. Use one implementation batch and the existing bounded preview workflow to inspect desktop/mobile, meaningful text/SVG intermediate/reverse states and the primary action after final edits. Supply exact selectors and correct documented preview arguments, case-correct text and string-valued attribute assertions; previous invalid argument retries wasted time. Keep any helpers within the approved project, not protected Temp/AppData. Report only observed results and any unresolved weakness; do not launch an automatic polishing loop or alter Default/Medium.\nFolder: " + run.project;
  const result = await engine.run({ taskId: run.taskId, requestId: report.requestId, modelId: run.model, thinkingVariant: run.variant, designProfile: 'max', designReviewMode: 'fast', specialty: null, accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: prompt }] });
  report.status = 'returned'; report.result = result.text; report.verification = result.verification; report.usage = result.usage;
}).catch(error => { report.status = 'failed'; report.error = error.message; }).finally(async () => {
  clearTimeout(timer); engine?.shutdown(); await runtime?.shutdown(); report.durationMs = Date.now() - begun; report.finishedAt = new Date().toISOString(); save();
  fs.copyFileSync(reportFile, path.join(baseline.output, 'MAX-text-svg-refinement-report.json'));
  app.exit(report.status === 'returned' ? 0 : 1);
});
