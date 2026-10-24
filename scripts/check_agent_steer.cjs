const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentEngine } = require('../electron/agent/engine.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-steer-'));
  const app = { getPath: () => root };
  const project = fs.mkdtempSync(path.join(__dirname, 'agent-steer-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"steer-fixture"}');
  return {
    root, project, app,
    cleanup: () => {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('steer validation rejects empty instructions or inactive tasks', () => {
  const f = fixture();
  let engine;
  try {
    engine = createAgentEngine(f.app, { getKey: () => 'key' }, () => {}, () => {});
    assert.throws(() => engine.steer('non-existent', 'Do something'), /no active run/);
    assert.throws(() => engine.steer('non-existent', ''), /empty/);
  } finally {
    engine?.shutdown();
    f.cleanup();
  }
});

test('mid-flight steer halts remaining batch actions and injects prioritized directive into next step', async () => {
  const f = fixture();
  let engine, step = 0;
  const events = [];
  const choiceFile = path.join(f.project, 'choice.txt');
  const steerFile = path.join(f.project, 'steered.txt');

  const call = (name, args, id) => ({ id, name, args });
  const answer = calls => ({
    text: '', calls, route: 'chat',
    raw: { content: null, tool_calls: calls.map(item => ({ id: item.id, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.args) } })) }
  });

  try {
    engine = createAgentEngine(
      f.app,
      { getKey: () => 'fixture-key' },
      event => {
        events.push(event);
        if (event.type === 'tool' && event.callId === 'first-write' && event.phase === 'completed') {
          engine.steer('task-steer', 'Stop writing choice.txt immediately! Write steered.txt instead with content: STEERED_SUCCESS');
        }
      },
      () => {},
      {
        nativeSnapshot: async () => ({ status: 'unavailable', reason: 'Fixture' }),
        reviewModel: async ({ purpose, history }) => {
          let value;
          if (purpose === 'request_understanding') {
            value = { goal: 'Create file', feature: 'file', trigger: '', expectedBehavior: 'Create requested file', exclusions: [], assumptions: [], examples: [], questions: [] };
          } else if (purpose === 'execution_requirements') {
            value = { requirements: [{ text: 'Create the requested file in the selected project.', verification_types: ['focused'] }] };
          } else if (purpose === 'acceptance_planning') {
            const reqMatch = /Requirements:\n([^\n]+)\nObserved project sources/.exec(history[0].content);
            const requirements = reqMatch ? JSON.parse(reqMatch[1]) : [];
            value = { status: 'approved', criteria: requirements.map(req => ({ id: 'c-' + req.id, requirementId: req.id, description: 'File created', observable: 'exists', negativeCase: 'The requested file is absent.', method: 'observation' })), missingRequirements: [] };
          } else {
            value = { status: 'approved', reason: 'Approved' };
          }
          return { text: JSON.stringify(value), calls: [] };
        },
        requestModel: async ({ history }) => {
          if (step++ === 0) {
            return answer([call('open_workspace', { directory: f.project }, 'open')]);
          }
          if (step === 2) {
            return answer([
              call('write_file', { file: choiceFile, content: 'Initial text' }, 'first-write'),
              call('write_file', { file: choiceFile, content: 'Second unwanted text' }, 'second-write')
            ]);
          }
          if (step === 3) {
            const steerMsg = history.find(item => item.role === 'user' && typeof item.content === 'string' && item.content.includes('USER STEER DIRECTIVE — CRITICAL MANDATE'));
            assert.ok(steerMsg, 'Must find steer directive in history');
            assert.match(steerMsg.content, /STEERED_SUCCESS/);

            const toolResults = history.filter(item => item.role === 'tool');
            const secondResult = toolResults.find(item => item.tool_call_id === 'second-write');
            assert.ok(secondResult, 'Halted tool call must have a result for model protocol');
            assert.match(secondResult.content, /Execution halted before this tool.*steer directive/);

            return answer([call('write_file', { file: steerFile, content: 'STEERED_SUCCESS' }, 'steer-write')]);
          }
          return { text: 'Acknowledged and fulfilled the steer directive.', calls: [], route: 'chat', raw: { content: 'Done' } };
        }
      }
    );

    const result = await engine.run({
      taskId: 'task-steer',
      requestId: 'turn-1',
      modelId: 'opencode/big-pickle',
      accessMode: 'Full access',
      accessModeVersion: 2,
      messages: [{ role: 'user', content: 'Create choice.txt' }]
    });

    assert.ok(result);
    assert.equal(fs.existsSync(steerFile), true);
    assert.equal(fs.readFileSync(steerFile, 'utf8'), 'STEERED_SUCCESS');

    const steerEvent = events.find(e => e.type === 'steer');
    assert.ok(steerEvent, 'Must emit steer event');
    assert.match(steerEvent.steerText, /STEERED_SUCCESS/);

    const memory = engine.taskMemory.read('task-steer');
    assert.ok(memory.recentActions.some(action => action.includes('Steered:')));
  } finally {
    engine?.shutdown();
    f.cleanup();
  }
});
