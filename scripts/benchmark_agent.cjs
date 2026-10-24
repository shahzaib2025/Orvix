const fs = require('node:fs');
const path = require('node:path');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { loadOpenCodeEnv } = require('../electron/agent/load-opencode-env.cjs');
const { cases } = require('../benchmarks/cases.cjs');
const { auditReply } = require('../electron/agent/claim-audit.cjs');

loadOpenCodeEnv(path.resolve(__dirname, '..'));
const modelId = process.argv.find(value => value.startsWith('--model='))?.slice('--model='.length) ?? 'opencode/space-bunny-free';
const caseFilter = process.argv.find(value => value.startsWith('--case='))?.slice('--case='.length).toLowerCase() ?? null;
const key = process.env[modelId.startsWith('opencode-go/') ? 'ORVIX_OPENCODE_GO_KEY' : 'ORVIX_OPENCODE_ZEN_KEY'];
if (!key) { console.error('Configure the matching OpenCode key before running the benchmark.'); process.exitCode = 1; }
const runBase = path.resolve(__dirname, '..', 'benchmarks', '.runs');
fs.mkdirSync(runBase, { recursive: true });

async function runCase(item, index) {
  const root = fs.mkdtempSync(path.join(runBase, 'orvix-bench-'));
  const app = { getPath: name => { if (name !== 'userData') throw new Error('Unexpected app path.'); return path.join(root, '.orvix-data'); } };
  const events = [];
  let engine;
  const scope = path.resolve(root);
  try {
    for (const [relative, content] of Object.entries(item.files)) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const taskId = `benchmark-${index}`;
    const requestId = `request-${index}`;
    engine = createAgentEngine(app, { getKey: () => key }, event => {
      events.push(event);
      if (event.type === 'approval') {
        if (event.kind === 'workspace' && typeof event.directory === 'string') {
          const target = path.resolve(event.directory);
          const withinFixture = target === scope || target.startsWith(`${scope}${path.sep}`);
          engine.decide(event.approvalId, withinFixture);
        } else if (event.kind === 'command' && typeof event.directory === 'string'
          && path.resolve(event.directory) === path.join(scope, 'project')
          && item.allowedCommands?.includes(event.command)) engine.decide(event.approvalId, 'host');
        else engine.decide(event.approvalId, false);
      }
    });
    const startedAt = Date.now();
    let result;
    let error = null;
    try {
      result = await engine.run({ requestId, taskId, modelId, accessMode: 'Full access',
        messages: [{ role: 'user', content: item.prompt(root) }] });
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    const grade = item.grade(root, fs, result);
    const regressions = item.regressions?.(root, fs) ?? [];
    const checkEvidence = result?.verification?.checks ?? [];
    const unsupportedCheckClaims = auditReply(result?.text ?? '', result?.verification, false).length;
    return { name: item.name, passed: grade.passed && regressions.length === 0 && unsupportedCheckClaims === 0,
      criterion: grade.detail, regressions, durationMs: Date.now() - startedAt,
      error, reply: String(result?.text ?? '').slice(0, 4000),
      changes: engine.changes.list(taskId), workspaces: engine.workspaces.list(taskId).length,
      toolCalls: events.filter(event => event.type === 'tool' && event.phase === 'completed').length,
      toolErrors: events.filter(event => event.type === 'tool' && event.phase === 'completed' && event.failed).length,
      toolErrorDetails: events.filter(event => event.type === 'tool' && event.phase === 'completed' && event.failed)
        .map(event => ({ name: event.name, detail: event.detail, input: String(event.input ?? '').slice(0, 500), output: String(event.output ?? '').slice(0, 300) })),
      unsupportedCheckClaims, checkPhases: checkEvidence.map(check => ({ phase: check.phase, status: check.status, stale: check.stale === true })),
      declinedCommands: events.filter(event => event.type === 'approval' && event.kind !== 'workspace').length,
      verification: result?.verification?.status ?? null };
  } finally {
    engine?.shutdown();
    const real = fs.realpathSync(root);
    if (path.dirname(real) !== fs.realpathSync(runBase) || !path.basename(real).startsWith('orvix-bench-')) throw new Error('Refusing to remove a directory outside the benchmark fixture area.');
    fs.rmSync(real, { recursive: true, force: true });
  }
}

(async () => {
  if (!key) return;
  const results = [];
  const selected = cases.map((item, index) => ({ item, index })).filter(({ item }) => !caseFilter || item.name.toLowerCase().includes(caseFilter));
  if (!selected.length) throw new Error('No benchmark case matched the filter.');
  for (let position = 0; position < selected.length; position++) {
    const { item, index } = selected[position];
    console.log(`[Benchmark] ${position + 1}/${selected.length}: ${item.name}`);
    results.push(await runCase(item, index));
  }
  const report = { modelId, createdAt: new Date().toISOString(), passed: results.filter(item => item.passed).length,
    total: results.length, toolErrors: results.reduce((sum, item) => sum + item.toolErrors, 0),
    regressions: results.reduce((sum, item) => sum + item.regressions.length, 0),
    unsupportedCheckClaims: results.reduce((sum, item) => sum + item.unsupportedCheckClaims, 0), cases: results };
  const output = path.resolve(__dirname, '..', caseFilter ? 'benchmark-results-targeted.json' : 'benchmark-results.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`[Benchmark] ${report.passed}/${report.total} passed. Report: ${output}`);
  if (report.passed !== report.total) process.exitCode = 1;
})().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
