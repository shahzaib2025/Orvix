const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { requestWithRetry } = require('../electron/agent/model-retry.cjs');
const { request } = require('../electron/agent/model-client.cjs');

test('greetings use one model response without project scans, planning, tools, or evidence ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-fast-conversation-'));
  const events = [];
  const calls = [];
  let reviews = 0;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => 'fixture-key' }, event => events.push(event), () => {}, {
    requestModel: async options => {
      calls.push(options);
      return { text: 'Model-written reply: good to hear from you.', calls: [], usage: { total_tokens: 9 } };
    },
    reviewModel: async () => { reviews++; throw new Error('A greeting must not enter review.'); },
  });
  try {
    engine.projectMaps.refresh = () => { throw new Error('A greeting must not scan a workspace.'); };
    for (const [index, prompt] of ['hi', 'yo', 'how are u?'].entries()) {
      const result = await engine.run({
        taskId: `chat-${index}`, requestId: `turn-${index}`, modelId: 'opencode/big-pickle', accessMode: 'Controlled', specialty: '3d-website',
        messages: [{ role: 'user', content: 'Build a website.' }, { role: 'assistant', content: 'Previous code and report. '.repeat(1000) }, { role: 'user', content: prompt }],
      });
      assert.equal(result.text, 'Model-written reply: good to hear from you.');
      assert.equal(result.verification.status, 'not_needed');
      assert.equal(engine.execution.read(`chat-${index}`, `turn-${index}`), null);
    }
    assert.equal(calls.length, 3);
    assert.ok(calls.every(item => item.purpose === 'conversation' && item.tools.length === 0));
    assert.ok(calls.every(item => item.history.length === 1 && item.history[0].role === 'user' && item.history[0].content.length < 20), 'a greeting must not resend earlier coding history');
    assert.ok(calls.every(item => item.retryPolicy.maxRetries === 0 && item.timeoutMs === 30000));
    assert.equal(reviews, 0);
    assert.equal(events.some(event => event.type === 'activity' && /Interpreting|acceptance|reviewing/i.test(event.message ?? '')), false);
  } finally {
    engine.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the conversation retry policy fails promptly instead of entering the long generic retry loop', async () => {
  const controller = new AbortController();
  let attempts = 0;
  let retryEvents = 0;
  await assert.rejects(requestWithRetry({
    signal: controller.signal,
    retryPolicy: { maxRetries: 0 },
    timeoutMs: 30000,
  }, () => { retryEvents++; }, async options => {
    attempts++;
    assert.equal('retryPolicy' in options, false);
    assert.equal(options.timeoutMs, 30000);
    throw new Error('fetch failed');
  }), /fetch failed/);
  assert.equal(attempts, 1);
  assert.equal(retryEvents, 0);
});

test('independent review retry policy stops after two short retries', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const retries = [];
  await assert.rejects(requestWithRetry({
    signal: controller.signal,
    purpose: 'completion_review',
    retryPolicy: { baseDelayMs: 0, maxDelayMs: 0 },
  }, event => retries.push(event), async () => {
    attempts++;
    throw new Error('HTTP 503 temporarily unavailable');
  }), /HTTP 503/);
  assert.equal(attempts, 3);
  assert.deepEqual(retries.map(item => item.attempt), [1, 2]);
  assert.deepEqual(retries.map(item => item.delayMs), [0, 0]);
});

test('direct Go conversation requests honor the short timeout and return a clear timeout error', async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  try {
    await assert.rejects(request({
      modelId: 'opencode-go/glm-5.3-flash', history: [{ role: 'user', content: 'yo' }], tools: [],
      purpose: 'conversation', accessMode: 'Plan', key: 'fixture-key', sessionId: 'fixture',
      signal: new AbortController().signal, timeoutMs: 1000,
    }), /Model request timed out after 1 seconds/);
  } finally {
    global.fetch = originalFetch;
  }
});
