// Actual free-provider work in isolated scratch projects; no user project or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const root = path.resolve(__dirname, '..', 'scratch', 'parallel-agent-live-' + Date.now());
const project = path.join(root, 'website'); fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'package.json'), '{"name":"orvix-parallel-fixture","private":true}');
const workers = createOpenCodeWorkers(root), events = [], timers = [];
configureOpenCodeCatalog(root, workers); configureOpenCodeModel(workers);
const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => events.push({ ...event, observedAt: Date.now() }));
const report = { scope: 'Simultaneous live website creation and documentation research with the same free model.', root, results: [], workerSamples: [] };
let sample;
async function run(taskId, modelId, prompt, mode) {
  const record = { taskId, startedAt: Date.now() }; report.results.push(record);
  const watchdog = setTimeout(() => engine.cancel(taskId), 150000); timers.push(watchdog);
  try {
    const result = await engine.run({ taskId, requestId: taskId + '-turn', modelId, accessMode: mode, accessModeVersion: 2, designReviewMode: 'off', messages: [{ role: 'user', content: prompt }] });
    record.text = result.text; record.changes = result.changes.map(item => item.path); record.usage = result.usage;
  } catch (error) { record.error = error.message; }
  finally { clearTimeout(watchdog); record.completedAt = Date.now(); record.durationMs = record.completedAt - record.startedAt; }
}
(async () => {
  const catalog = await refreshOpenCodeCatalog(true, new AbortController().signal);
  assert.ok(!catalog.error && !catalog.stale, catalog.error || 'Stale catalog');
  const model = catalog.models.find(item => item.id === (process.argv[2] || 'opencode/mimo-v2.6-flash-free'));
  assert.ok(model, 'Requested model is absent from the current verified free catalog'); report.modelId = model.id;
  await engine.workspaces.open('parallel-website', project, async () => true);
  sample = setInterval(() => report.workerSamples.push({ at: Date.now(), workers: workers.status().workers }), 250);
  const website = run('parallel-website', model.id, `Create a tiny plain HTML/CSS/JS website in the existing folder ${project}. Use native write tools with absolute paths to create exactly index.html, style.css, and script.js. The HTML must link style.css and script.js and contain the heading ORVIX_PARALLEL_WEBSITE. CSS should style the body. JS should log ORVIX_PARALLEL_WEBSITE. Read back index.html. No install, shell, preview, design review, external browsing or additional files. This is a small execution test.`, 'Full access');
  const deadline = Date.now() + 60000;
  while (!workers.status().workers['parallel-website']?.running && Date.now() < deadline && !report.results[0].completedAt) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(report.results[0].completedAt, undefined, 'Website finished before research could be started');
  const research = run('parallel-research', model.id, 'Research CSS media queries by fetching https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Using_media_queries with webfetch. Summarize two useful facts for responsive websites and cite that URL. Use the fetched document as evidence. Do not read local files, use shell, write files, or build a website.', 'Plan');
  await Promise.all([website, research]);
  report.tools = events.filter(item => item.type === 'tool' && item.phase === 'completed').map(({ taskId, name, failed, observedAt }) => ({ taskId, name, failed, observedAt }));
  report.overlapMs = Math.min(...report.results.map(item => item.completedAt)) - Math.max(...report.results.map(item => item.startedAt));
  report.distinctWorkersObserved = report.workerSamples.some(item => { const a = item.workers['parallel-website'], b = item.workers['parallel-research']; return a?.running && b?.running && a.pid !== b.pid; });
  report.filesValid = ['index.html', 'style.css', 'script.js'].every(file => fs.existsSync(path.join(project, file))) && fs.readFileSync(path.join(project, 'index.html'), 'utf8').includes('ORVIX_PARALLEL_WEBSITE');
  report.researchEvidence = report.tools.some(item => item.taskId === 'parallel-research' && item.name === 'webfetch' && !item.failed) && report.results.find(item => item.taskId === 'parallel-research')?.text?.includes('developer.mozilla.org');
  report.passed = report.results.every(item => !item.error) && report.overlapMs > 0 && report.distinctWorkersObserved && report.filesValid && report.researchEvidence;
  if (!report.passed) process.exitCode = 1;
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
  clearInterval(sample); for (const timer of timers) clearTimeout(timer); engine.shutdown(); workers.shutdown();
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, workerSamples: report.workerSamples.length }, null, 2));
});
