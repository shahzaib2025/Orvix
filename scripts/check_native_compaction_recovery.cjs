const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { compactionCheckpoint } = require('../electron/agent/native-compaction-recovery.cjs');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const message = "OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building.";
const error = { name: 'APIError', data: { message, statusCode: 403 } };
const failedSummary = { info: { id: 'summary', role: 'assistant', agent: 'compaction', summary: true, error, time: { created: 2, completed: 3 } }, parts: [] };
const failure = Object.assign(new Error(message), { statusCode: 403 });

test('checkpoint requires confirmed compaction rejection and settled tools', () => {
  assert.ok(compactionCheckpoint([failedSummary], failure));
  assert.equal(compactionCheckpoint([{ ...failedSummary, info: { ...failedSummary.info, agent: 'build' } }], failure), null);
  assert.equal(compactionCheckpoint([failedSummary], Object.assign(new Error('Forbidden'), { statusCode: 403 })), null);
  assert.equal(compactionCheckpoint([failedSummary], failure, { pending: { status: 'running' } }), null);
  assert.equal(compactionCheckpoint([{ info: {}, parts: [{ type: 'tool', state: { status: 'running' } }] }, failedSummary], failure), null);
});

test('checkpoint bounds history and omits source edits while retaining exact paths and outcomes', () => {
  const messages = Array.from({ length: 200 }, (_, i) => ({ info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'edit', callID: 'call-' + i,
    state: { status: 'completed', input: { filePath: 'C:\\project\\page.html', newString: 'DO_NOT_REPLAY_THIS_EDIT' }, output: 'Updated ' + i + ' ' + 'x'.repeat(2000) } }] }));
  const text = compactionCheckpoint([...messages, failedSummary], failure);
  assert.ok(text.length < 62000);
  assert.match(text, /page.html/); assert.match(text, /Updated 199/);
  assert.doesNotMatch(text, /DO_NOT_REPLAY_THIS_EDIT/);
});

async function fixture(t, { agent = 'compaction', pending = false, repeat = false, readOnly = false, cancel = false, resume = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-native-compaction-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/fixture-free', name: 'Fixture', route: 'chat', variants: [], input: ['text'] }] }));
  let stream, sessions = 0, failureCalls = 0;
  const prompts = [], requests = [], checkpoints = [], notices = [], recoveryEvents = [], histories = new Map();
  const controller = new AbortController();
  const first = { info: { id: 'tool-message', role: 'assistant', agent: 'build', time: { created: 1, completed: 2 }, tokens: { input: 100, output: 10 } }, parts: [{ id: 'tool-part', messageID: 'tool-message', type: 'tool', tool: 'write', callID: 'write-once',
    state: { status: pending ? 'running' : 'completed', input: { filePath: path.join(root, 'page.html'), content: 'should not replay' }, output: 'File created' } }] };
  const failed = { ...failedSummary, info: { ...failedSummary.info, agent } };
  if (resume) histories.set('session-old', [first, failed]);
  const frame = event => Buffer.from('data: ' + JSON.stringify(event) + '\n\n');
  const runtime = { status: () => ({}), async exclusive(_, callback) { return callback({ workdir: root, supportsAsyncPrompts: true,
    async api(endpoint, options = {}) {
      requests.push([endpoint, options.method]);
      if (endpoint === '/session' && options.method === 'POST') return { id: 'session-' + ++sessions };
      if (endpoint === '/session/session-old') return { id: 'session-old' };
      if (endpoint.endsWith('/prompt_async')) {
        prompts.push(options.body);
        const id = endpoint.split('/')[2], failedRound = !resume && prompts.length === 1 || repeat;
        const history = failedRound ? [first, failed] : [{ info: { id: 'done', role: 'assistant', agent: 'build', finish: 'stop', time: { created: 4, completed: 5 }, tokens: { input: 5, output: 2 } }, parts: [{ type: 'text', text: 'Remaining checks completed.' }] }];
        // A repeat compaction before new work must stop instead of looping.
        histories.set(id, repeat && prompts.length > 1 ? [failed] : history);
        queueMicrotask(() => {
          for (const item of histories.get(id)) {
            stream.enqueue(frame({ type: 'message.updated', properties: { info: { ...item.info, sessionID: id } } }));
            for (const part of item.parts) stream.enqueue(frame({ type: 'message.part.updated', properties: { part: { ...part, sessionID: id } } }));
          }
          if (failedRound) {
            if (cancel) controller.abort();
            else stream.enqueue(frame({ type: 'session.error', properties: { sessionID: id, error } }));
          } else stream.enqueue(frame({ type: 'session.idle', properties: { sessionID: id } }));
        });
        return true;
      }
      if (endpoint === '/session/status') return {};
      if (endpoint === '/permission' || endpoint === '/question') return [];
      if (endpoint.includes('/message')) {
        const history = histories.get(endpoint.split('/')[2]) ?? [];
        return endpoint.includes('?') ? history : history.at(-1);
      }
      return true;
    }, async events() { return { body: new ReadableStream({ start(value) { stream = value; } }) }; }
  }); } };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const run = () => runOpenCodeSession({ taskId: 'test', modelId: 'opencode/fixture-free', signal: controller.signal, readOnly,
    parts: [{ type: 'text', text: 'CURRENT USER REQUEST: finish existing site.' }], timeoutMs: 4000,
    ...(resume ? { resumeSession: { sessionID: 'session-old', directory: root, modelId: 'opencode/fixture-free', variant: null } } : {}),
    onCompactionContext: () => 'LATEST STEER: report only; active folder is unchanged.',
    onCheckpoint: value => checkpoints.push(value), onFailure: () => failureCalls++,
    onRecovery: value => notices.push(value), onEvent: event => { if (event.type === 'orvix.compaction.recovered') recoveryEvents.push(event); } });
  return { run, prompts, requests, checkpoints, notices, recoveryEvents, get failureCalls() { return failureCalls; } };
}

test('native compaction 403 continues in fresh session without replay or loss of usage and steering', async t => {
  const f = await fixture(t); const reply = await f.run();
  assert.equal(reply.text, 'Remaining checks completed.'); assert.equal(f.prompts.length, 2);
  const text = f.prompts[1].parts.map(p => p.text).join('\n');
  assert.match(text, /Continue only the remaining/); assert.match(text, /LATEST STEER: report only/); assert.match(text, /File created/);
  assert.equal(f.failureCalls, 0); assert.equal(f.recoveryEvents.length, 1); assert.equal(f.notices.length, 1);
  assert.equal(reply.usage.input_tokens, 105); assert.equal(reply.usage.output_tokens, 12);
  assert.ok(f.checkpoints.some(c => c.continuity?.sourceSessionID === 'session-1' && c.status === 'completed'));
  assert.equal(f.requests.some(([url, method]) => method === 'DELETE' && url.includes('/session/')), false);
});

for (const [name, options] of [['builder access denial', { agent: 'build' }], ['uncertain running tool', { pending: true }], ['independent reviewer', { readOnly: true }], ['cancellation', { cancel: true }]]) {
  test(name + ' does not start another session', async t => { const f = await fixture(t, options); await assert.rejects(f.run()); assert.equal(f.prompts.length, 1); assert.equal(f.recoveryEvents.length, 0); });
}
test('repeated rejection without new work stops instead of spinning', async t => {
  const f = await fixture(t, { repeat: true }); await assert.rejects(f.run(), /free tier/); assert.equal(f.prompts.length, 2);
});
test('explicit resume recognizes a retained failed compaction before resubmitting to the broken session', async t => {
  const f = await fixture(t, { resume: true }); const reply = await f.run(); assert.equal(reply.text, 'Remaining checks completed.');
  assert.equal(f.prompts.length, 1); assert.equal(f.recoveryEvents[0].properties.sourceSessionID, 'session-old');
});
