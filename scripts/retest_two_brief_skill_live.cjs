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
const directionMode = false;
const stamp = 1792355669496, root = path.resolve('scratch/two-brief-skill-1792355669496');
const output = path.join(os.homedir(), 'Desktop', 'Orvix-Two-Brief-Skill-1792355669496');
fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(output, { recursive: true });
const report = JSON.parse(fs.readFileSync(path.join(root,'report.json'))); delete report.finishedAt; report.retryStartedAt=new Date().toISOString();
const save = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
report.sourceHashes = Object.fromEntries(["electron/agent/design-comparison.cjs","electron/agent/opencode-headless.cjs","electron/agent/opencode-model.cjs","electron/agent/engine.cjs","electron/agent/model-client.cjs","electron/agent/design-diversity.cjs","electron/agent/visual-asset-search.cjs","electron/agent/skills/browser_verification/SKILL.md",'electron/agent/opencode-agent.cjs', 'electron/agent/design-review.cjs', 'electron/agent/task-skill-router.cjs', 'electron/agent/steer-policy.cjs', 'electron/agent/skills/visual_composition/SKILL.md', 'electron/agent/skills/website_design/SKILL.md'].map(file => [file, hash(fs.readFileSync(file))]));
if (report.historicalReference) report.historicalReference.sourceHashesMatch = Object.entries(report.historicalReference.sourceHashes).every(([file,digest]) => report.sourceHashes[file] === digest);
save();
let pool, engine, stopping=false;
const stop=()=>{stopping=true;const current=report.runs.findLast(run=>run.status==='running');if(engine&&current)engine.cancel(current.taskId);else pool?.shutdown();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
const stopWatcher=setInterval(()=>{if(fs.existsSync(path.join(root,'STOP')))stop();},1000);stopWatcher.unref();
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
  const cases = [1].map(n => ({ label: '0'+n+'-Default', designProfile: 'normal', exploration: false }));
  for (const [index, trial] of cases.entries()) {
    if(stopping)break;
    const project = path.join(output, trial.label), data = path.join(root, 'shared-engine');
    fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(data, { recursive: true });
    // Reuse only the just-verified catalog, never any task/design state.
    fs.copyFileSync(path.join(preflight, 'opencode-free-catalog.json'), path.join(data, 'opencode-free-catalog.json'));
    const run = { ...trial, project, temperature: 0.7, taskId: report.runs[0].taskId, startedAt: new Date().toISOString(), status: 'running', events: [], traces: [], promptAudits: [] };
    const request = report.brief + (trial.exploration ? '\n\n' + report.exploration : '') + '\n\nUse the already-created authorized project folder: ' + project;
    run.expectedSkills = selectTaskSkills(request, { designProfile: trial.designProfile, policy: createSkillPolicy(trial.designProfile, request) }).map(skill => skill.id).sort();
    assert.ok(run.expectedSkills.includes('visual_composition'), 'Build request must not be classified as report-only');
    const matched = report.runs.find(item => item.designProfile === trial.designProfile);
    if (matched) assert.deepEqual(run.expectedSkills, matched.expectedSkills, 'Matched profile arms must receive identical automatic skill bundles');
    report.runs.push(run); save();
    pool = createOpenCodeWorkers(path.join(root, trial.label + '-runtime'));
    configureOpenCodeCatalog(data, pool); configureOpenCodeModel(pool);
    const start = Date.now();
    engine = createAgentEngine({ getPath: () => data, getVersion: () => 'two-brief-skill-experiment' }, { getKey: () => '' }, event => {
      if (['tool', 'activity', 'clarification'].includes(event.type)) {
        run.events.push({ atMs: Date.now() - start, type: event.type, name: event.name, phase: event.phase, failed: event.failed,
          detail: String(event.message ?? event.detail ?? '').slice(0, 350), input: String(event.input ?? '').slice(0, 800), output: String(event.output ?? '').slice(0, 1000) }); save();
      }
    }, null, { runNativeSession: async options => {
      const capture = { modelId: options.modelId, variant: options.variant ?? null, readOnly: options.readOnly === true,
        systemPrompt: options.systemPrompt ?? '', parts: options.parts };
      const file = trial.label + '-fixed-planner-delivered-prompt-' + run.promptAudits.length + '.json';
      fs.writeFileSync(path.join(root, file), JSON.stringify(capture, null, 2));
      const text = capture.systemPrompt + '\n' + capture.parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
      const supplied = skills.listSkills().filter(entry => text.includes(skills.readSkill(entry.id).instructions)).map(entry => entry.id);
      if (!capture.readOnly) assert.deepEqual([...supplied].sort(), run.expectedSkills, 'Full automatic skill instructions must reach the live native prompt');
      run.promptAudits.push({ file, readOnly: capture.readOnly, characters: text.length, systemHash: hash(capture.systemPrompt), fullSkillInstructionsDelivered: supplied,
        mandatoryNativeBriefInstruction: text.includes('For a fresh whole website, or a new standalone hero, use orvix_visual_set_design_brief'),
        hasNonePolicy: text.includes('None is selected'), websiteProfileSkillDelivered: supplied.some(id => /^website_design(?:_|$)/.test(id)) });
      save();
      return runOpenCodeSession({ ...options, onRequest: async trace => { run.traces.push(trace); save(); await options.onRequest?.(trace); } });
    } });
    await engine.workspaces.open(run.taskId, project, async () => true);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; engine.cancel(run.taskId); }, 25 * 60 * 1000);
    try {
      const result = await engine.run({ taskId: run.taskId, requestId: 'trial-retry-' + index, modelId: report.modelId,
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
    clearInterval(stopWatcher);save(); console.log(JSON.stringify({ root, output, runs: report.runs.map(({ label, status, durationMs }) => ({ label, status, durationMs })), error: report.error, providerBlocker: report.providerBlocker, sourceUnchanged: report.sourceUnchanged })); });



