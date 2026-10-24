// Experiments only: no production prompts, skills, profile routing or settings
// are modified. A transparent wrapper records the real native context.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const skills = require('../electron/agent/skill-library.cjs');
const assert = require('node:assert/strict');
const { selectTaskSkills } = require('../electron/agent/task-skill-router.cjs');
const { createSkillPolicy } = require('../electron/agent/skill-policy.cjs');
const directionMode = process.argv.includes('--visual-directions');
const stamp = Date.now(), root = path.resolve('scratch/' + (directionMode ? 'hero-directions-' : 'hero-exploration-') + stamp);
const output = path.join(os.homedir(), 'Desktop', (directionMode ? 'Orvix-Hero-Directions-' : 'Orvix-Hero-Exploration-') + stamp);
fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(output, { recursive: true });
const report = { root, output, startedAt: new Date().toISOString(), modelId: process.argv[2] || 'opencode/mimo-v2.6-flash-free', variant: null,
  temperature: 0.7, designProfile: 'mixed', reviewMode: 'off',
  brief: 'Create one finished premium website hero for FlorianBD, a fictional greeting-card and personal-message shop. Use a white theme; invent the composition, typography, imagery and appropriate motion. Communicate what the shop offers and make its primary action clear. That action opens an accessible local greeting-demo dialog with a close control and Escape dismissal. No backend, fabricated customer evidence or performance claims. Use plain HTML/CSS/JavaScript with index.html as entry. Images may use suitable direct URLs; do not generate or download project images. Build only this single hero, with no additional website sections. Then use the existing managed preview once at desktop and mobile widths and exercise the primary action using exact selectors from your HTML. Make at most one targeted correction if needed, report observed results, and stop.',
  exploration: 'For this experiment, first develop three brief ASCII wireframes with materially different spatial relationships, visual hierarchy and reading order. Font/color changes and simply swapping left and right do not count. Invent the candidates from this subject rather than selecting from a fixed layout menu. Keep the three sketches and your selected concept within the existing storyboard text (under 2500 characters); identify which concept you selected and its content/clarity reason. Select for both communication and a distinctive composition, rather than automatically choosing your first familiar draft. After recording the brief, save those same concise sketches and selection in concepts.md for inspection, then implement only the selected concept. Keep exploration notes out of the visitor-facing page. No additional approval or review stage.',
  controls: 'Fresh state, output folder, native session and worker per arm. Same model/default reasoning/0.7 and human brief except the explicit exploration treatment and output path. No prior project source, screenshots or design history supplied. Review off. None still lists shared visual_composition as available; distinguish catalog availability from successful instruction reads in the tool trace. Three small samples cannot establish universal novelty or a causal guarantee.',
  runs: [], captures: [] };
if (directionMode) {
  report.experimentTitle = 'Three fresh runs: complete visual directions';
  report.exploration = 'For this experiment, first explore three complete visual directions for this subject. Each must differ materially in spatial composition and reading hierarchy, typography approach, imagery/media role, and visual character (including accent treatment and motion), while respecting the white theme. Merely changing fonts or colors on one arrangement does not count, nor do side swaps. Invent the ideas from the shop and its primary action, without a fixed menu of hero layouts, random font selection or mandatory decorative objects. For each candidate, record a tiny ASCII spatial sketch plus concise type/media/character choices; keep all three, the selection reason and mobile order together within the existing storyboard text (under 2500 characters). Choose the direction with the strongest communication and distinctive first impression, rather than automatically selecting the familiar first idea. Record the brief before construction, then save these same concise directions in concepts.md for inspection, and build only the selected direction. Keep exploration notes out of the visitor-facing page. During the already-requested preview, compare the actual hero with its selected composition, typography and media role; if it materially drifts back to a familiar arrangement, use the existing single targeted correction allowance to restore the chosen direction. No extra approval, critic, planning stage or automatic polishing loop.';
  report.controls = 'Three repeated fresh Default tasks use the identical human brief, complete-direction treatment, model/default reasoning, requested temperature 0.7 and skill bundle. Only their fresh task/session/workspace identifiers and destination paths differ. No earlier project source, screenshots or design-history notes are supplied to any builder. Review off. Compare cross-run composition AND visual identity. The earlier Default sample is a historical reference, not a newly randomized control.';
  report.limits = 'Three fresh treatment runs, one model and one subject; the earlier Default reference was generated separately. This tests observed repeatability and variety, not a causal guarantee or universal uniqueness. Native prompt audits verify matched full skill delivery and requested temperature, not provider-side sampling internals. Production design guidance remains unchanged.';
  const baselineFile = path.resolve('scratch/hero-exploration-1792330409012/report.json');
  if (fs.existsSync(baselineFile)) {
    const previous = JSON.parse(fs.readFileSync(baselineFile));
    report.historicalReference = { reportFile: baselineFile, output: previous.output, label: '02-Default', modelId: previous.modelId, temperature: previous.temperature, sourceHashes: previous.sourceHashes };
  }
}
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
report.sourceHashes = Object.fromEntries(['electron/agent/opencode-agent.cjs', 'electron/agent/design-review.cjs', 'electron/agent/task-skill-router.cjs', 'electron/agent/steer-policy.cjs', 'electron/agent/skills/visual_composition/SKILL.md', 'electron/agent/skills/website_design/SKILL.md'].map(file => [file, hash(fs.readFileSync(file))]));
if (report.historicalReference) report.historicalReference.sourceHashesMatch = Object.entries(report.historicalReference.sourceHashes).every(([file,digest]) => report.sourceHashes[file] === digest);
save();
let pool, engine;
(async () => {
  const preflight = path.join(root, 'preflight'); fs.mkdirSync(preflight, { recursive: true });
  pool = createOpenCodeWorkers(preflight);
  configureOpenCodeCatalog(preflight, pool); configureOpenCodeModel(pool);
  const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(60000));
  if (catalog.error || catalog.stale) throw Error(catalog.error || 'Stale catalog');
  report.model = catalog.models.find(model => model.id === report.modelId);
  if (!report.model?.supportsTemperature) throw Error('Selected model does not advertise temperature support; no substitution.');
  const ready = await runOpenCodeSession({ taskId: 'hero-preflight', modelId: report.modelId, timeoutMs: 120000,
    onPermission: async () => false, onRequest: trace => { report.preflightSampling = trace.sampling; save(); },
    parts: [{ type: 'text', text: 'Reply exactly HERO_READY. Do not call tools.' }] });
  report.providerPreflight = { text: ready.text, usage: ready.usage }; save();
  if (!ready.text.includes('HERO_READY')) throw Error('Provider preflight did not return the requested marker.');
  pool.shutdown(); pool = null;
  const cases = directionMode ? [1,2,3].map(index => ({ label: '0' + index + '-Default-Directions', designProfile: 'normal', exploration: true })) : [
    { label: '01-None', designProfile: 'none', exploration: false },
    { label: '02-Default', designProfile: 'normal', exploration: false },
    { label: '03-Default-Three-Concepts', designProfile: 'normal', exploration: true },
  ];
  for (const [index, trial] of cases.entries()) {
    const project = path.join(output, trial.label), data = path.join(root, trial.label + '-engine');
    fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(data, { recursive: true });
    // Reuse only the just-verified catalog, never any task/design state.
    fs.copyFileSync(path.join(preflight, 'opencode-free-catalog.json'), path.join(data, 'opencode-free-catalog.json'));
    const run = { ...trial, project, temperature: 0.7, taskId: 'hero-' + crypto.randomUUID(), startedAt: new Date().toISOString(), status: 'running', events: [], traces: [], promptAudits: [] };
    const request = report.brief + (trial.exploration ? '\n\n' + report.exploration : '') + '\n\nUse the already-created authorized project folder: ' + project;
    run.expectedSkills = selectTaskSkills(request, { designProfile: trial.designProfile, policy: createSkillPolicy(trial.designProfile, request) }).map(skill => skill.id).sort();
    assert.ok(run.expectedSkills.includes('visual_composition'), 'Build request must not be classified as report-only');
    const matched = report.runs.find(item => item.designProfile === trial.designProfile);
    if (matched) assert.deepEqual(run.expectedSkills, matched.expectedSkills, 'Matched profile arms must receive identical automatic skill bundles');
    report.runs.push(run); save();
    pool = createOpenCodeWorkers(path.join(root, trial.label + '-runtime'));
    configureOpenCodeCatalog(data, pool); configureOpenCodeModel(pool);
    const start = Date.now();
    engine = createAgentEngine({ getPath: () => data, getVersion: () => 'hero-exploration-experiment' }, { getKey: () => '' }, event => {
      if (['tool', 'activity', 'clarification'].includes(event.type)) {
        run.events.push({ atMs: Date.now() - start, type: event.type, name: event.name, phase: event.phase, failed: event.failed,
          detail: String(event.message ?? event.detail ?? '').slice(0, 350), input: String(event.input ?? '').slice(0, 800), output: String(event.output ?? '').slice(0, 1000) }); save();
      }
    }, null, { runNativeSession: async options => {
      const capture = { modelId: options.modelId, variant: options.variant ?? null, readOnly: options.readOnly === true,
        systemPrompt: options.systemPrompt ?? '', parts: options.parts };
      const file = trial.label + '-delivered-prompt-' + run.promptAudits.length + '.json';
      fs.writeFileSync(path.join(root, file), JSON.stringify(capture, null, 2));
      const text = capture.systemPrompt + '\n' + capture.parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
      const supplied = skills.listSkills().filter(entry => text.includes(skills.readSkill(entry.id).instructions)).map(entry => entry.id);
      assert.deepEqual([...supplied].sort(), run.expectedSkills, 'Full automatic skill instructions must reach the live native prompt');
      run.promptAudits.push({ file, characters: text.length, systemHash: hash(capture.systemPrompt), fullSkillInstructionsDelivered: supplied,
        mandatoryNativeBriefInstruction: text.includes('For a fresh whole website, or a new standalone hero, use orvix_visual_set_design_brief'),
        hasNonePolicy: text.includes('None is selected'), websiteProfileSkillDelivered: supplied.some(id => /^website_design(?:_|$)/.test(id)) });
      save();
      return runOpenCodeSession({ ...options, onRequest: async trace => { run.traces.push(trace); save(); await options.onRequest?.(trace); } });
    } });
    await engine.workspaces.open(run.taskId, project, async () => true);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; engine.cancel(run.taskId); }, 15 * 60 * 1000);
    try {
      const result = await engine.run({ taskId: run.taskId, requestId: 'trial-' + index, modelId: report.modelId,
        designProfile: trial.designProfile, designReviewMode: 'off', accessMode: 'Full access', accessModeVersion: 2,
        messages: [{ role: 'user', content: request }] });
      Object.assign(run, { status: 'returned', text: result.text, verification: result.verification, usage: result.usage,
        files: result.changes?.map(change => change.path), durationMs: Date.now() - start });
    } catch (error) {
      Object.assign(run, { status: 'failed', error: error.message, harnessTimeout: timedOut, durationMs: Date.now() - start });
      if (/HTTP (401|403|429)|quota|credit/i.test(error.message)) { report.providerBlocker = error.message; break; }
    } finally {
      clearTimeout(timer); run.runtime = pool.status(); engine.shutdown(); pool.shutdown(); engine = null; pool = null;
      run.finishedAt = new Date().toISOString(); save();
      console.log(JSON.stringify({ label: run.label, status: run.status, durationMs: run.durationMs, error: run.error, promptAudits: run.promptAudits, project }));
    }
  }
})().catch(error => { report.error = error.message; process.exitCode = 1; })
  .finally(() => { engine?.shutdown(); pool?.shutdown(); report.finishedAt = new Date().toISOString();
    report.sourceUnchanged = Object.entries(report.sourceHashes).every(([file, digest]) => hash(fs.readFileSync(file)) === digest);
    save(); console.log(JSON.stringify({ root, output, runs: report.runs.map(({ label, status, durationMs }) => ({ label, status, durationMs })), error: report.error, providerBlocker: report.providerBlocker, sourceUnchanged: report.sourceUnchanged })); });
