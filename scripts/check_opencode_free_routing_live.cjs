const fs = require('node:fs');
const path = require('node:path');
const { createOpenCodeHeadless } = require('../electron/agent/opencode-headless.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

const root = path.resolve(__dirname, '..', 'scratch', 'opencode-free-routing-' + Date.now());
const fixture = path.join(root, 'project');
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'orvix-free-routing-fixture', private: true }));
const marker = 'ORVIX_FREE_MODEL_READ_7319';
fs.writeFileSync(path.join(fixture, 'probe.txt'), marker + '\n');
const runtime = createOpenCodeHeadless(root);
configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
const report = { scope: 'Actual free-provider responses and native read in an isolated fixture; no user projects or credentials.', results: [] };
const events = [], permissions = [];
const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, event => events.push(event), null, {
  runNativeSession: options => runOpenCodeSession({ ...options, onPermission: request => {
    permissions.push({ name: request.permission ?? request.type, patterns: request.patterns, metadata: request.metadata });
    return options.onPermission(request, options.directory);
  } }),
});
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
(async () => {
  const catalog = await refreshOpenCodeCatalog(true, new AbortController().signal);
  if (catalog.error || catalog.stale) throw new Error(catalog.error || 'Stale catalog');
  console.log('Live free models: ' + catalog.models.map(model => model.id).join(', '));
  const selected = process.argv.slice(2).filter(value => !value.startsWith('--'));
  const models = catalog.models.filter(model => !selected.length || selected.includes(model.id));
  if (!models.length) throw new Error('None of the requested models is in the live free catalog.');
  models.sort((a, b) => (b.id.includes('muse-spark') ? 1 : 0) - (a.id.includes('muse-spark') ? 1 : 0));
  for (const [index, model] of models.entries()) {
    for (const mode of process.argv.includes('--greeting-only') ? ['greeting'] : process.argv.includes('--read-only') ? ['read'] : process.argv.includes('--edit-only') ? ['edit'] : ['greeting', 'read']) {
      const taskId = 'free-' + index + '-' + mode;
      const start = Date.now(), eventStart = events.length, permissionStart = permissions.length;
      const result = { modelId: model.id, mode };
      let watchdog;
      try {
        if (mode !== 'greeting') await engine.workspaces.open(taskId, fixture, async () => true);
        if (mode === 'edit') fs.writeFileSync(path.join(fixture, 'probe.txt'), marker + '\n');
        watchdog = setTimeout(() => engine.cancel(taskId), 45000);
        const response = await engine.run({ taskId, requestId: taskId + '-turn', modelId: model.id, accessMode: mode === 'edit' ? 'Full access' : 'Plan', accessModeVersion: 2,
          messages: [{ role: 'user', content: mode === 'greeting' ? 'yo' : mode === 'edit' ? 'Replace probe.txt with exactly ORVIX_FREE_MODEL_EDIT_9472 followed by one newline, using edit or write. Read it back and report the marker. Do not run shell commands or change other files.' : 'Read probe.txt with the read tool and reply with the exact marker in it. Do not use shell commands or change files.' }] });
        result.text = response.text;
        const tools = events.slice(eventStart).filter(event => event.type === 'tool' && event.phase === 'completed');
        result.tools = tools.map(tool => ({ name: tool.name, input: tool.input, failed: tool.failed, output: tool.output }));
        result.passed = mode === 'greeting' ? response.verification.status === 'not_needed' && tools.length === 0 && !events.slice(eventStart).some(event => event.type === 'approval')
          : mode === 'edit' ? response.text.includes('ORVIX_FREE_MODEL_EDIT_9472') && tools.some(tool => ['edit', 'write'].includes(tool.name) && !tool.failed) && tools.some(tool => tool.name === 'read' && !tool.failed) && fs.readFileSync(path.join(fixture, 'probe.txt'), 'utf8') === 'ORVIX_FREE_MODEL_EDIT_9472\n'
          : response.text.includes(marker) && tools.some(tool => tool.name === 'read' && !tool.failed) && fs.readFileSync(path.join(fixture, 'probe.txt'), 'utf8') === marker + '\n';
      } catch (error) { result.error = error.message; result.passed = false; }
      finally { clearTimeout(watchdog); }
      result.durationMs = Date.now() - start;
      result.permissions = permissions.slice(permissionStart);
      report.results.push(result); save();
      console.log(JSON.stringify({ modelId: model.id, mode, passed: result.passed, seconds: Math.round(result.durationMs / 100) / 10, text: result.text, error: result.error, tools: result.tools, permissions: result.permissions }));
    }
  }
  report.passed = report.results.every(result => result.passed);
  if (!report.passed) process.exitCode = 1;
})().catch(error => { report.error = error.message; process.exitCode = 1; })
  .finally(() => { save(); engine.shutdown(); runtime.shutdown(); console.log('Report: ' + path.join(root, 'result.json')); });
