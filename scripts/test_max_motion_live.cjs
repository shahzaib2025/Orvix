// Live validation through the production Orvix engine. No injected layout, starter or substitute model.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { app, safeStorage } = require('electron');
app.setPath('userData', path.join(process.env.APPDATA, 'Orvix'));
const { createSearchKeyStore } = require('../electron/search-key-store.cjs');
const { configureSearchKeys } = require('../electron/serper-search.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { installFileConsole } = require('./file-console.cjs');
const stamp = Date.now();
const none = process.argv.includes('--none-design');
const comparison = process.argv.includes('--profile-comparison');
const originality = process.argv.includes('--originality-comparison');
const stateRoot = path.resolve(__dirname, '../scratch/' + (none ? 'none-design-live-' : originality ? 'design-originality-live-' : comparison ? 'design-profile-comparison-' : 'max-motion-live-') + stamp);
const output = path.join(process.env.USERPROFILE, 'Desktop', (none ? 'Orvix-None-Design-Test-' : originality ? 'Orvix-Originality-Fix-Tests-' : comparison ? 'Orvix-Three-Design-Comparison-' : 'Orvix-MAX-Motion-Tests-') + stamp);
fs.mkdirSync(stateRoot); fs.mkdirSync(output); installFileConsole(path.join(stateRoot, 'runner.log'));
const recordRoot = path.join(app.getPath('userData'), 'agent-task-records');
const taskManifest = JSON.parse(fs.readFileSync(path.join(recordRoot, 'index.json'), 'utf8'));
const selected = taskManifest.files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))
  .map(file => { try { const data = JSON.parse(fs.readFileSync(path.join(recordRoot, file), 'utf8')); return { modelId: data.modelId, variant: data.thinkingVariant ?? null, updatedAt: data.updatedAt ?? 0 }; } catch { return null; } })
  .filter(record => record?.modelId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
if (!selected?.modelId.startsWith('opencode/')) throw Error('The selected model is not a native OpenCode model; no substitution.');
const maxSkill = none ? null : require('../electron/agent/skill-library.cjs').selectedSkill('website_design', 'max');
const report = { output, stateRoot, model: selected.modelId, variant: selected.variant, maxSkillHash: maxSkill?.contentHash ?? null, startedAt: new Date().toISOString(), runs: [] };
const save = () => fs.writeFileSync(path.join(stateRoot, 'report.json'), JSON.stringify(report, null, 2));
const casesFile = process.argv.find(arg => arg.startsWith('--cases='))?.slice(8);
const cases = casesFile ? JSON.parse(fs.readFileSync(path.resolve(casesFile), 'utf8')) : [
  { label: '01-Open-Website', specialty: null, brief: 'Create a complete professional website for FIELDWORK, a fictional landscape architecture studio. Invent its visual identity and make it detailed and engaging. Use relevant photographs through Google image search and direct image URLs, without downloading image files. Label project examples as illustrative and do not invent clients, awards or testimonials. The primary action is an accessible project inquiry form with honest local-only confirmation.' },
  { label: '02-Twenty-Sections-3D', specialty: '3d-website', brief: 'Create a twenty-section professional website for KINETIC, a fictional exhibition about movement and electric mobility. Invent its visual identity and develop twenty meaningful content sections. Include a purposeful Three.js experience. Use relevant photographs through Google image search and direct image URLs, without downloading image files. Clearly mark illustrative exhibition content and do not invent real product claims, customers or statistics. The primary action is an accessible visit-planning form with honest local-only confirmation.' }
];
if (!Array.isArray(cases) || !cases.length || cases.some(item => !/^[a-z0-9-]+$/i.test(item.label) || typeof item.brief !== 'string' || !item.brief.trim() || ![null, '3d-website'].includes(item.specialty) || !['none','normal','medium','max'].includes(item.profile ?? 'max'))) throw Error('Invalid live benchmark cases.');
if (comparison && (cases.length !== 3 || new Set(cases.map(item => item.brief)).size !== 1 || new Set(cases.map(item => item.profile)).size !== 3 || cases.some(item => item.modelId || Object.hasOwn(item, 'variant')))) throw Error('Comparison requires the same brief and selected model/reasoning for three different profiles.');
if (originality && (cases.length !== 2 || new Set(cases.map(item => item.brief)).size !== 1 || cases.some(item => item.profile !== 'max' || item.modelId || Object.hasOwn(item, 'variant')))) throw Error('Originality comparison requires two fresh MAX tasks with the same brief, selected model and reasoning.');
if (none && (cases.length !== 1 || cases[0].profile !== 'none' || cases[0].modelId !== 'opencode/muse-spark-1.3-contributor-free' || cases[0].variant !== 'xhigh')) throw Error('None test requires one fresh Muse Spark 1.3 xhigh case.');
if (none) { report.savedSelection = { model: report.model, variant: report.variant }; report.model = cases[0].modelId; report.variant = cases[0].variant; }
report.noneDesign = none;
report.comparison = comparison;
report.originalityComparison = originality;
report.caseSource = casesFile ? path.resolve(casesFile) : null;
const sharedEngineRoot = path.join(stateRoot, 'shared-engine');
if (originality) {
  const source = process.argv.find(arg => arg.startsWith('--prior-report='))?.slice(15);
  if (!source) throw Error('Supply the actual prior generation report to seed sanitized design notes.');
  const previous = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
  const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
  const targetStore = createTaskMemoryStore({getPath:()=>sharedEngineRoot});
  report.historySeed = [];
  for (const run of previous.runs) {
    const previousStore = createTaskMemoryStore({getPath:()=>path.join(run.root,'engine')});
    const record = previousStore.read(run.taskId);
    if (!record?.designReview?.brief?.direction || !record.changedFiles?.length) continue;
    targetStore.write(run.taskId,{status:'completed', changedFiles:['index.html'],designReview:{brief:record.designReview.brief}});
    report.historySeed.push({taskId:run.taskId,profile:run.profile,source:path.resolve(source)});
  }
  if (!report.historySeed.length) throw Error('Prior report had no recorded website briefs.');
}
let runtime, engine, timer;
save();
app.whenReady().then(async () => {
  const store = createSearchKeyStore(app, safeStorage); configureSearchKeys(store);
  report.googleReady = store.snapshot().keys.some(key => key.status === 'ready'); save();
  for (const item of cases) {
    const project = path.join(output, item.label), root = path.join(stateRoot, item.label);
    fs.mkdirSync(project); fs.mkdirSync(root);
    runtime = createOpenCodeWorkers(path.join(root, 'runtime'));
    configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
    const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(90000));
    // Explicit benchmark overrides never change the user's saved model settings.
    const modelId = item.modelId ?? selected.modelId;
    const variant = Object.hasOwn(item, 'variant') ? item.variant : selected.variant;
    const model = catalog.models.find(candidate => candidate.id === modelId);
    if (catalog.error || catalog.stale || !model || variant && !model.variants.includes(variant)) throw Error(catalog.error || 'Requested model/reasoning is unavailable; no fallback.');
    const profile = item.profile ?? 'max';
    const selectedSkill = profile === 'none' ? null : require('../electron/agent/skill-library.cjs').selectedSkill('website_design', profile);
    const run = { ...item, profile, skillId: selectedSkill?.id ?? null, skillHash: selectedSkill?.contentHash ?? null, briefHash: crypto.createHash('sha256').update(item.brief).digest('hex'), project, root, model: model.id, variant, status: 'building', startedAt: new Date().toISOString(), events: [] };
    report.runs.push(run); save();
    const begun = Date.now(), taskId = 'max-motion-' + crypto.randomUUID();
    run.taskId = taskId;
    run.engineRoot = originality ? sharedEngineRoot : path.join(root, 'engine');
    engine = createAgentEngine({ getPath: () => run.engineRoot, getVersion: () => 'max-motion-live' }, { getKey: () => '' }, event => {
      if (['tool', 'activity'].includes(event.type)) { run.events.push({ atMs: Date.now() - begun, type: event.type, name: event.name, phase: event.phase, failed: event.failed, message: event.message }); save(); }
      if (event.type === 'approval') engine.decide(event.approvalId, false);
      if (event.type === 'question') { run.question = event.question; engine.cancel(taskId); }
    });
    try {
      if (originality) {
        run.priorDesignCount = require('../electron/agent/design-diversity.cjs').recentDesignsFor(engine.taskMemory,taskId,item.brief + '\nBuild in this already-created new Desktop folder: ' + project + '. Do not read other generated sites.','Full access').length;
        if (!run.priorDesignCount) throw Error('Originality test must actually receive the seeded recent design notes.');
      }
      await engine.workspaces.open(taskId, project, async () => true);
      timer = setTimeout(() => engine.cancel(taskId), 1200000);
      const result = await engine.run({ taskId, requestId: 'build', modelId: model.id, thinkingVariant: variant, designProfile: profile, designReviewMode: 'fast', specialty: item.specialty, accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: item.brief + '\nBuild in this already-created new Desktop folder: ' + project + '. Do not read other generated sites.' }] });
      run.status = 'returned'; run.result = result.text; run.verification = result.verification; run.usage = result.usage;
      if (none) {
        const memory = engine.taskMemory.read(taskId);
        run.noneEvidence = { loadedWebsiteSkills: (memory?.loadedSkills ?? []).filter(skill => /website_/.test(skill.id)), designReviewStatus: memory?.designReview?.status, automaticDesignStages: (memory?.usageStages ?? []).filter(stage => /design_review|originality|design_revision/.test(stage.stage)), automaticDesignCalls: run.events.filter(event => /set_design_brief|design_review|design_originality/.test(event.name ?? '')), sourceFiles: fs.readdirSync(project) };
        run.noneEvidence.passed = !run.noneEvidence.loadedWebsiteSkills.length && run.noneEvidence.designReviewStatus === 'not_needed' && !run.noneEvidence.automaticDesignStages.length && !run.noneEvidence.automaticDesignCalls.length;
      }
    } catch (error) { run.status = 'failed'; run.error = error.message; }
    finally { clearTimeout(timer); run.durationMs = Date.now() - begun; run.finishedAt = new Date().toISOString(); save(); engine.shutdown(); engine = null; await runtime.shutdown(); runtime = null; }
  }
}).catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer); engine?.shutdown(); await runtime?.shutdown(); report.finishedAt = new Date().toISOString(); save();
  fs.copyFileSync(path.join(stateRoot, 'report.json'), path.join(output, 'generation-report.json'));
  app.exit(report.error ? 1 : 0);
});
