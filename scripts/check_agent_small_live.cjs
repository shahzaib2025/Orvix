// One live provider task through the production executor, with independent grading.
// Credentials are obtained through the existing service and are never printed.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createCredentials } = require('../electron/agent/credentials.cjs');
const { loadOpenCodeEnv } = require('../electron/agent/load-opencode-env.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { requestWithRetry } = require('../electron/agent/model-retry.cjs');
const { safeValue, atomicWrite } = require('../electron/agent/durable-store.cjs');

app.setName('Orvix');
app.whenReady().then(async () => {
  const repo = path.resolve(__dirname, '..');
  loadOpenCodeEnv(repo);
  const credentials = createCredentials(app, safeStorage);
  const configured = credentials.status();
  const modelId = process.argv.find(value => value.startsWith('--model='))?.slice(8)
    ?? (configured.go.configured ? 'opencode-go/deepseek-v4.1-flash' : 'opencode/space-bunny-free');
  if (!credentials.getKey(modelId.startsWith('opencode-go/') ? 'go' : 'zen')) throw Error('No matching configured OpenCode credential is available for the live test.');
  const runBase = path.join(repo, 'benchmarks', '.runs'); fs.mkdirSync(runBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(runBase, 'small-task-'));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const manifest = JSON.stringify({ name: 'orvix-small-live-task', private: true, type: 'module', scripts: { test: 'node --test math.test.js' } }, null, 2) + '\n';
  const tests = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.js';\ntest('positive integers', () => assert.equal(add(2, 3), 5));\ntest('zero', () => assert.equal(add(0, 0), 0));\ntest('negative input', () => assert.equal(add(-2, 3), 1));\n";
  const original = '// Keep this comment.\nexport function add(a, b) {\n  return a - b;\n}\n';
  fs.writeFileSync(path.join(project, 'package.json'), manifest);
  fs.writeFileSync(path.join(project, 'math.test.js'), tests);
  fs.writeFileSync(path.join(project, 'math.js'), original);
  const reportFile = path.join(root, 'report.json');
  const timelineFile = path.join(root, 'timeline.json');
  const cases = [[2, 3, 5], [0, 0, 0], [-2, 3, 1], [-5, -7, -12], [1.25, 2.5, 3.75], [8, 0, 8], [1000000, -999999, 1]];
  const gradingEnvironment = { ...process.env };
  delete gradingEnvironment.ORVIX_OPENCODE_ZEN_KEY;
  delete gradingEnvironment.ORVIX_OPENCODE_GO_KEY;
  function grade() {
    const source = fs.readFileSync(path.join(project, 'math.js'), 'utf8');
    const code = `import assert from 'node:assert/strict'; import {add} from ${JSON.stringify(pathToFileURL(path.join(project, 'math.js')).href)}; for (const [a,b,expected] of ${JSON.stringify(cases)}) assert.equal(add(a,b),expected); console.log('7 independent cases passed');`;
    const result = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true, env: gradingEnvironment });
    const preserved = source.includes('// Keep this comment.') && source.includes('export function add(a, b)')
      && fs.readFileSync(path.join(project, 'package.json'), 'utf8') === manifest && fs.readFileSync(path.join(project, 'math.test.js'), 'utf8') === tests;
    return { passed: result.status === 0 && preserved, cases: cases.length, preserved, output: safeValue((result.stdout || result.stderr || result.error?.message || '').slice(0, 2000)) };
  }
  const baseline = grade();
  if (baseline.passed) throw Error('Fixture must fail before the agent starts.');
  const taskId = 'small-live-' + crypto.randomUUID(); const requestId = crypto.randomUUID();
  const events = [], requests = [];
  const toolRows = new Map();
  let engine, result, error = null, firstEditMs = null, firstVerifiedFixMs = null, lastPhase = null;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const event = packet => {
    if (['tool', 'activity', 'approval'].includes(packet.type) || packet.type === 'model_progress' && packet.progressKind === 'agent_update') {
      events.push(safeValue({ atMs: elapsed(), type: packet.type, phase: packet.phase, name: packet.name, callId: packet.callId, failed: packet.failed, durationMs: packet.durationMs, message: packet.message, text: packet.text, detail: packet.detail, evidenceId: packet.evidenceId }));
      atomicWrite(timelineFile, { modelId, events, requests });
    }
    if (packet.type === 'tool') {
      if (packet.phase === 'started') { toolRows.set(packet.callId, { name: packet.name, atMs: elapsed(), status: 'running' }); console.log(`[${(elapsed() / 1000).toFixed(1)}s] Tool: ${packet.name}`); }
      if (packet.phase === 'completed') {
        const row = toolRows.get(packet.callId) ?? { name: packet.name }; Object.assign(row, { durationMs: packet.durationMs, status: packet.failed ? 'failed' : 'completed' }); toolRows.set(packet.callId, row);
        if (['apply_edit', 'write_file', 'apply_patch_batch'].includes(packet.name) && !packet.failed && firstVerifiedFixMs === null) {
          firstEditMs ??= elapsed(); if (grade().passed) { firstVerifiedFixMs = elapsed(); console.log(`[${(firstVerifiedFixMs / 1000).toFixed(1)}s] Independent check: fix correct`); }
        }
      }
    }
    if (packet.type === 'run_state' && packet.run?.phase !== lastPhase) { lastPhase = packet.run?.phase; console.log(`[${(elapsed() / 1000).toFixed(1)}s] Phase: ${lastPhase}`); }
  };
  const isInside = directory => { const rel = path.relative(project, path.resolve(directory)); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
  const progressTimer = setInterval(() => console.log(`[${(elapsed() / 1000).toFixed(1)}s] Still active: ${lastPhase || 'starting'}; ${toolRows.size} tool calls; ${requests.length} provider requests`), 30000);
  try {
    engine = createAgentEngine({ getPath: () => path.join(root, '.orvix-data'), getVersion: () => 'live-small-task' }, credentials, event, () => {}, {
      // Keep this test inside its fixture; use ordinary approvals otherwise.
      workflowAuthorize: ({ kind, directory, command }) => {
        if (!isInside(directory)) return false;
        if (kind === 'workspace') return true;
        // Match normal Full access behavior in the approved test directory.
        // In particular, preservation assertions may need ordinary node -e commands.
        if (['command', 'host_command'].includes(kind)) return 'host';
        return false;
      },
      requestModel: async (input, onRetry) => {
        const row = { purpose: input.purpose ?? 'executor', startedMs: elapsed(), status: 'running' }; requests.push(row);
        try { const answer = await requestWithRetry(input, onRetry); Object.assign(row, { durationMs: elapsed() - row.startedMs, status: 'completed', toolProposals: answer.calls?.length ?? 0 }); return answer; }
        catch (caught) { Object.assign(row, { durationMs: elapsed() - row.startedMs, status: 'failed', error: safeValue(caught.message) }); throw caught; }
        finally { atomicWrite(timelineFile, { modelId, events, requests }); }
      },
    });
    process.on('SIGINT', () => engine.cancel(taskId));
    console.log(`Live task: repair addition; model=${modelId}; fixture=${root}`);
    result = await engine.run({ taskId, requestId, modelId, accessMode: 'Full access', accessModeVersion: 2,
      messages: [{ role: 'user', content: `Small coding task: in ${project}, fix add(a, b) in math.js so it adds its two numeric arguments instead of subtracting. Preserve the comment and exported function signature. Edit only math.js; keep math.test.js and package.json unchanged. Run npm run test from that project and report the actual outcome briefly. Work only in this isolated project folder.` }] });
  } catch (caught) { error = safeValue(caught instanceof Error ? caught.message : String(caught)); }
  finally { clearInterval(progressTimer); }
  const durationMs = elapsed(); const finalGrade = grade();
  const externalTests = spawnSync('node', ['--test', 'math.test.js'], { cwd: project, encoding: 'utf8', windowsHide: true, env: gradingEnvironment });
  const report = { modelId, taskId, requestId, startedAt: new Date(startedAt).toISOString(), durationMs, firstEditMs, firstVerifiedFixMs, error,
    baselinePassed: baseline.passed, independent: finalGrade,
    existingTests: { passed: externalTests.status === 0, output: safeValue((externalTests.stdout || externalTests.stderr).slice(0, 5000)) },
    agentVerification: result?.verification ?? null, reply: result?.text ?? null, providerRequests: requests,
    toolCalls: toolRows.size, failedTools: [...toolRows.values()].filter(row => row.status === 'failed').length, tools: [...toolRows.values()],
    scorecard: engine?.runState.scorecard(), project, timelineFile,
    note: 'One live provider trial through the production executor. Independent behavior checks are external to the model. UI rendering and broad model reliability are not measured by this trial.' };
  atomicWrite(reportFile, report); engine?.shutdown();
  console.log(JSON.stringify({ modelId, durationMs, firstVerifiedFixMs, independentPassed: finalGrade.passed, existingTestsPassed: externalTests.status === 0, toolCalls: report.toolCalls, failedTools: report.failedTools, providerRequests: requests.length, error, reportFile }));
  app.exit(error || !finalGrade.passed || externalTests.status !== 0 ? 1 : 0);
}).catch(error => { console.error(safeValue(error.message)); app.exit(1); });
