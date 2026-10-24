// Production native route, fresh storage per run; no substitute model or custom visual recipe.
const fs = require('node:fs'), path = require('node:path');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { installFileConsole } = require('./file-console.cjs');
const crypto = require('node:crypto');
const sourceHashes = Object.fromEntries(['opencode-agent.cjs', 'opencode-model.cjs', 'design-review.cjs', 'preview-website.cjs', 'preview-server.cjs', 'tools.cjs', 'skills/website_design/SKILL.md', 'skills/website_design_medium/SKILL.md', 'skills/website_design_max/SKILL.md'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../electron/agent', file))).digest('hex')]));
const output = process.env.DESIGN_TEST_OUTPUT || path.join(process.env.USERPROFILE, 'Desktop', 'Orvix-Design-Fix-Tests-' + Date.now());
fs.mkdirSync(output, { recursive: true }); installFileConsole(path.join(output, 'test.log'));
const prompt = 'make a new website for florian bd shop for their greatings and make it in a new folder got it in desktop make a new folder then do got it make it in white theme and super professional';
const cases = [
  { label: 'Default', profile: 'normal', googlePreference: true, prompt },
  { label: 'Medium', profile: 'medium', googlePreference: true, prompt },
  { label: 'MAX', profile: 'max', googlePreference: true, prompt },
  { label: 'Fresh-Medium-A', profile: 'medium', googlePreference: true, reviewMode: 'off', prompt },
  { label: 'Fresh-Medium-B', profile: 'medium', googlePreference: true, reviewMode: 'off', prompt },
  { label: 'Concept-Medium-A', profile: 'medium', googlePreference: true, reviewMode: 'off', prompt },
  { label: 'Concept-Medium-B', profile: 'medium', googlePreference: true, reviewMode: 'off', prompt },
  { label: 'Original-Medium-A', profile: 'medium', googlePreference: true, prompt },
  { label: 'Original-Medium-B', profile: 'medium', googlePreference: true, prompt },
  { label: 'Original-MAX', profile: 'max', googlePreference: true, prompt },
  { label: 'System-Medium-A', profile: 'medium', googlePreference: true, prompt },
  { label: 'System-Medium-B', profile: 'medium', googlePreference: true, prompt },
  { label: 'Medium-A', profile: 'medium', prompt },
  { label: 'Medium-B', profile: 'medium', prompt },
  { label: 'MAX-A', profile: 'max', prompt },
  { label: 'MAX-Google', profile: 'max', prompt },
  { label: 'MAX-Repair', projectLabel: 'MAX-Google', existing: true, profile: 'max', prompt: 'Repair the existing Florian BD website in the open workspace. Preserve its design and features. The latest real browser scan found serious color-contrast failures at .craft-copy > .eyebrow and .visit-grid > div:nth-child(1) > .eyebrow on desktop and mobile. Fix those two observed defects, then capture current desktop/mobile and reduced-motion views, verify the live greeting action, and report actual checks. Do not redesign, replace images or do new research.' },
  { label: 'Medium-Architecture', profile: 'medium', prompt: 'Make a new website for a fictional architecture studio called Northline. Make it in a new Desktop folder, white theme and super professional. Use illustrative project content honestly.' },
];
const reportFile = path.join(output, 'report.json');
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { output, model: 'opencode/muse-spark-1.3-contributor-free', variant: 'xhigh', startedAt: new Date().toISOString(), runs: [] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
let runtime, engine;
const completion = (async () => {
  for (const item of cases.filter(item => !process.env.DESIGN_TEST_CASE || process.env.DESIGN_TEST_CASE.split(',').includes(item.label))) {
    const project = path.join(output, item.projectLabel || item.label), stateRoot = path.join(output, item.label + '-State');
    if (!item.existing) fs.mkdirSync(project);
    else if (!fs.existsSync(path.join(project, 'index.html'))) throw Error('Existing repair project is missing.');
    fs.mkdirSync(stateRoot);
    runtime = createOpenCodeHeadless(path.join(stateRoot, 'runtime'));
    configureOpenCodeCatalog(stateRoot, runtime); configureOpenCodeModel(runtime);
    const catalog = await refreshOpenCodeCatalog(true, AbortSignal.timeout(45000));
    const model = catalog.models.find(model => model.id === report.model);
    if (catalog.error || catalog.stale || !model?.variants.includes('xhigh') || !model.input.includes('image')) throw Error(catalog.error || 'Requested image-capable Muse Spark 1.3 xhigh unavailable; no fallback.');
    delete report.finishedAt;
    const run = { ...item, project, sourceHashes, startedAt: new Date().toISOString(), events: [], sessions: [] }; report.runs.push(run); save();
    engine = createAgentEngine({ getPath: () => path.join(stateRoot, 'engine'), getVersion: () => 'design-quality-live' }, { getKey: () => '' }, event => {
      if (['tool', 'activity'].includes(event.type)) run.events.push({ type: event.type, name: event.name, phase: event.phase, failed: event.failed, message: event.message, detail: event.detail });
      if (event.type === 'approval') engine.decide(event.approvalId, false);
      if (event.type === 'question') engine.cancel('design-test');
      save();
    }, null, { runNativeSession: async options => {
      const session = { kind: options.readOnly ? 'review' : 'builder', startedAt: new Date().toISOString() }; run.sessions.push(session); save();
      const parts = structuredClone(options.parts);
      session.systemPrompt = options.systemPrompt || null;
      if (!options.readOnly) parts.unshift({ type: 'text', text: item.existing ? `Diagnostic filesystem context: repair the existing website at ${project}. Preserve its established visual identity and functionality. Do not read other websites or create another folder. Do not install dependencies. Report limitations honestly.` : `Diagnostic filesystem context: the new Desktop project folder requested by the human has already been created at ${project}. Build that new website here. Do not read other websites or create another folder. This context defines location only; invent the design yourself. Use plain HTML/CSS/JS. Do not install dependencies. Report limitations honestly.` });
      if (!options.readOnly && (item.googlePreference || item.label === 'MAX-Google')) parts.unshift({ type: 'text', text: 'The human has additionally requested Google image search and direct image URLs, without downloading website image assets. Use that source preference for this test. This is additional context beyond the repeated Florian prompt.' });
      fs.writeFileSync(path.join(stateRoot, `session-${run.sessions.length}-input.json`), JSON.stringify(parts.map(part => part.type === 'file' ? { ...part, url: '<image supplied; see captured image evidence>' } : part), null, 2));
      const begun = Date.now();
      try {
        const reply = await runOpenCodeSession({ ...options, parts, timeoutMs: options.readOnly ? 120000 : 600000 });
        session.durationMs = Date.now() - begun; session.reply = reply.text; session.usage = reply.usage; session.stoppedReason = reply.stoppedReason;
        if (!options.readOnly && run.sessions.filter(session => session.kind === 'builder').length === 1) fs.cpSync(project, path.join(output, item.label + '-Initial'), { recursive: true });
        save(); return reply;
      } catch (error) { session.error = error.message; session.durationMs = Date.now() - begun; save(); throw error; }
    } });
    const begun = Date.now(), timer = setTimeout(() => engine.cancel('design-test'), 1000000);
    const cancelPoll = setInterval(() => { if (fs.existsSync(path.join(output, 'cancel'))) engine?.cancel('design-test'); }, 500);
    try {
      await engine.workspaces.open('design-test', project, async () => true);
      const result = await engine.run({ taskId: 'design-test', requestId: 'build', modelId: model.id, thinkingVariant: 'xhigh', designProfile: item.profile, designReviewMode: item.reviewMode || 'fast', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: item.prompt }] });
      run.result = result.text; run.verification = result.verification; run.status = 'returned';
    } catch (error) { run.status = 'error'; run.error = error.message; }
    finally { clearTimeout(timer); clearInterval(cancelPoll); run.durationMs = Date.now() - begun; save(); engine.shutdown(); engine = null; await runtime.shutdown(); runtime = null; }
  }
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => { engine?.shutdown(); await runtime?.shutdown(); report.finishedAt = new Date().toISOString(); save(); });
module.exports = completion;
