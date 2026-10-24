const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, requestOpenCode } = require('../electron/agent/opencode-model.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { unusedPort } = require('../electron/agent/opencode-headless.cjs');

test('worker port selection avoids Fetch-blocked ports even on Windows with low ephemeral ranges', async () => {
  for (let index = 0; index < 4; index++) {
    const port = await unusedPort();
    assert.ok(port >= 49152 && port <= 65535);
  }
});

test('greeting text arrives before completion, excludes reasoning and does not duplicate snapshots or the final reply', { timeout: 5000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-stream-latency-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/fixture-free', name: 'Fixture', route: 'chat', variants: [], input: ['text'] }] }));
  let controller, release, first;
  const finished = new Promise(resolve => { release = resolve; });
  const firstText = new Promise(resolve => { first = resolve; });
  const send = event => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  const taskWorker = { exclusive: (_, callback) => callback({ workdir: root,
    events: async () => ({ body: new ReadableStream({ start(value) { controller = value; } }) }),
    api: async (endpoint, options = {}) => {
      if (endpoint === '/session') return { id: 'greeting' };
      if (endpoint.endsWith('/message') && options.method === 'POST') {
        assert.equal(options.body.agent, 'orvix_conversation', 'greetings must use the compact conversational agent');
        send({ type: 'message.updated', properties: { info: { id: 'answer', role: 'assistant', sessionID: 'greeting' } } });
        for (const part of [
          { id: 'reason', type: 'reasoning', text: 'Private reasoning' },
          { id: 'ignored', type: 'text', text: 'Hidden', ignored: true },
          { id: 'synthetic', type: 'text', text: 'Internal', synthetic: true },
          { id: 'text', type: 'text', text: '' },
        ]) send({ type: 'message.part.updated', properties: { part: { ...part, messageID: 'answer', sessionID: 'greeting' } } });
        send({ type: 'message.part.delta', properties: { messageID: 'answer', partID: 'text', sessionID: 'greeting', field: 'text', delta: 'Hello' } });
        send({ type: 'message.part.updated', properties: { part: { id: 'text', type: 'text', text: 'Hello', messageID: 'answer', sessionID: 'greeting' } } });
        send({ type: 'message.part.updated', properties: { part: { id: 'text', type: 'text', text: 'He', messageID: 'answer', sessionID: 'greeting' } } });
        send({ type: 'message.part.updated', properties: { part: { id: 'text', type: 'text', messageID: 'answer', sessionID: 'greeting' } } });
        send({ type: 'message.part.delta', properties: { messageID: 'answer', partID: 'text', sessionID: 'greeting', field: 'text', delta: ' there.' } });
        await finished;
        return { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Hello there.' }] };
      }
      return true;
    },
  }) };
  const runtime = { status: () => ({}),
    exclusive: () => { throw new Error('A greeting must not wait in the shared review queue.'); },
    forTask: taskId => { assert.equal(taskId, 'latency-test'); return taskWorker; },
  };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  const chunks = [];
  let complete = false;
  const result = requestOpenCode({ sessionId: 'latency-test', purpose: 'conversation', modelId: 'opencode/fixture-free', history: [{ role: 'user', content: 'Hi' }], onDelta: delta => { chunks.push(delta); first(); } }, 'Answer directly.')
    .then(reply => { complete = true; return reply; });
  t.after(() => release());
  await firstText;
  assert.equal(complete, false, 'first visible text must not wait for response completion');
  assert.equal(chunks.join(''), 'Hello');
  release();
  assert.equal((await result).text, 'Hello there.');
  assert.equal(chunks.join(''), 'Hello there.');
});

test('keep-alive warms the exact task worker and repeated preparation reuses it', async () => {
  const calls = [];
  const manager = createOpenCodeWorkers('fixture-root', { create: (directory, options) => {
    calls.push({ directory, options });
    return { connect: async () => {}, setKeepAlive() {}, status: () => ({}), shutdown() {} };
  } });
  try {
    await manager.setKeepAlive(true, 'active-task');
    assert.equal(calls.length, 2);
    await manager.connectTask('active-task');
    assert.equal(calls.length, 2, 'warming must reuse the same isolated task worker');
    assert.throws(() => manager.connectTask('../outside'), /Invalid OpenCode task identity/);
  } finally { manager.shutdown(); }
});
