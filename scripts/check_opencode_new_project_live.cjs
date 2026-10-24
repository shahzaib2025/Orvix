const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const stamp = Date.now();
const root = path.resolve(__dirname, '..', 'scratch', 'opencode-new-project-' + stamp);
const target = path.join(os.homedir(), 'Desktop', 'Orvix-agent-folder-check-' + stamp);
const runtime = createOpenCodeHeadless(root);
configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
const events = [];
const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => events.push(event));
const report = { scope: 'Live creation of a new disposable Desktop child folder with no initial workspace.', target };
let watchdog;
(async () => {
  const catalog = await refreshOpenCodeCatalog(true, new AbortController().signal);
  if (catalog.error || catalog.stale) throw new Error(catalog.error || 'Stale catalog');
  const modelId = process.argv[2] || 'opencode/mimo-v2.6-flash-free';
  const start = Date.now();
  watchdog = setTimeout(() => engine.cancel('new-project-check'), 90000);
  const result = await engine.run({ taskId: 'new-project-check', requestId: 'new-project-turn', modelId, accessMode: 'Full access', accessModeVersion: 2,
    messages: [{ role: 'user', content: `Create a NEW folder at exactly ${target}. Create only three tiny files in it: index.html containing a page with heading ORVIX_NEW_PROJECT_CHECK, style.css containing basic body styling, and script.js containing console.log("ORVIX_NEW_PROJECT_CHECK"). The folder does not exist. Start with a native write tool using the absolute index.html path; Orvix must prepare the folder during permission handling. Do not use shell or mkdir to create it. Then write the other two files with native write tools. Read back the HTML. Do not inspect other Desktop folders, install dependencies, launch a server, or delete anything. This is a folder-creation test, not a design task.` }] });
  report.modelId = modelId; report.durationMs = Date.now() - start; report.text = result.text;
  report.workspaces = engine.workspaces.list('new-project-check');
  report.changes = result.changes.map(change => change.path);
  report.tools = events.filter(event => event.type === 'tool' && event.phase === 'completed').map(event => ({ name: event.name, failed: event.failed, output: event.output }));
  report.passed = ['index.html', 'style.css', 'script.js'].every(file => fs.existsSync(path.join(target, file)))
    && fs.readFileSync(path.join(target, 'index.html'), 'utf8').includes('ORVIX_NEW_PROJECT_CHECK')
    && report.workspaces.includes(target) && !report.workspaces.includes(path.dirname(target))
    && report.changes.length === 3;
  if (!report.passed) process.exitCode = 1;
})().catch(error => { report.error = error.message; process.exitCode = 1; })
  .finally(() => { clearTimeout(watchdog); engine.shutdown(); runtime.shutdown(); fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); });
