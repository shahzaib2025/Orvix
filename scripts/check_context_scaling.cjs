const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getContextBudget,
  foldObservationText,
  pruneOlderObservations,
  createContextManager,
  openCodeInputTokens,
} = require('../electron/agent/context-manager.cjs');

test('OpenCode token events ignore missing or zero-filled counts instead of reporting false zero usage', () => {
  assert.equal(openCodeInputTokens(undefined), null);
  assert.equal(openCodeInputTokens({}), null);
  assert.equal(openCodeInputTokens({ input: 0, cache: { read: 0, write: 0 } }), null);
  assert.equal(openCodeInputTokens({ input: 0.5 }), null);
  assert.equal(openCodeInputTokens({ input: 120, cache: { read: 30, write: 2 } }), 152);
  assert.equal(openCodeInputTokens({ cache: { read: 40 } }), 40);
});

test('model metadata sets context budget and unconfigured models are clearly marked as fallback', () => {
  const known = getContextBudget('opencode/model-with-metadata', 131072);
  assert.equal(known.contextLimitTokens, 131072);
  assert.equal(known.budgetSource, 'model');
  assert.equal(known.triggerInputTokens, 117964);
  assert.equal(known.limitBytes, 117964 * 4);
  assert.equal(known.keepRecentSteps, 4);

  const fallback = getContextBudget('nara/model-without-metadata');
  assert.equal(fallback.contextLimitTokens, 200000);
  assert.equal(fallback.budgetSource, 'fallback');
  assert.equal(fallback.triggerInputTokens, 180000);
  assert.equal(fallback.limitBytes, 180000 * 4);
  assert.equal(fallback.keepRecentSteps, 4);
});

test('foldObservationText leaves short text intact and safely condenses large multi-line outputs', () => {
  const shortText = 'Small output 42 lines';
  assert.equal(foldObservationText(shortText), shortText);

  const longText = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: export const item${i} = true;`).join('\n');
  assert.ok(longText.length > 1200);

  const folded = foldObservationText(longText);
  assert.ok(folded.length < longText.length);
  assert.ok(folded.includes('Line 1:'));
  assert.ok(folded.includes('Line 50:'));
  assert.ok(folded.includes('[... Output folded for context efficiency'));

  // Folding must be idempotent
  assert.equal(foldObservationText(folded), folded);
});

test('pruneOlderObservations protects recent steps and folds older steps for chat and responses routes', () => {
  // Simulate 5 steps in OpenAI chat tool call format
  const history = [
    { role: 'user', content: 'Do task' },
    // Step 1 (older)
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(4000) },
    // Step 2 (older)
    { role: 'assistant', content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: 'y'.repeat(4000) },
    // Step 3 (recent step 3)
    { role: 'assistant', content: '', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c3', content: 'z'.repeat(4000) },
    // Step 4 (recent step 2)
    { role: 'assistant', content: '', tool_calls: [{ id: 'c4', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c4', content: 'w'.repeat(4000) },
    // Step 5 (recent step 1)
    { role: 'assistant', content: '', tool_calls: [{ id: 'c5', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c5', content: 'v'.repeat(4000) },
  ];

  // Keep 3 recent steps
  const foldedCount = pruneOlderObservations(history, 3);
  assert.equal(foldedCount, 2);

  // Step 1 and 2 tool results are folded
  assert.ok(history[2].content.includes('[... Output folded for context efficiency'));
  assert.ok(history[4].content.includes('[... Output folded for context efficiency'));

  // Step 3, 4, 5 tool results remain 100% full fidelity
  assert.equal(history[6].content.length, 4000);
  assert.equal(history[8].content.length, 4000);
  assert.equal(history[10].content.length, 4000);
});

test('createContextManager inherits model budget and extracts rich declarations into memory', () => {
  const history = [{ role: 'user', content: 'Inspect code' }];
  const messages = [{ role: 'user', content: 'Inspect code' }];
  const context = createContextManager(history, messages, null, null, { modelId: 'opencode-go/deepseek-v4-pro' });

  const metrics = context.metrics();
  assert.equal(metrics.limitBytes, 180000 * 4);
  assert.equal(metrics.targetBytes, Math.floor(180000 * 3));
  assert.equal(metrics.budgetTokens, 200000);
  assert.equal(metrics.budgetSource, 'fallback');
  assert.equal(metrics.contextSource, 'estimate');

  // Record a read_file tool observation
  const mockCode = `
export class AgentService {
  constructor() {}
  run() {}
}
export function initializeEngine() {}
const helperUtil = 42;
`;
  context.recordTool('read_file', { file: 'src/agent.ts' }, mockCode);

  const snapshot = context.snapshot();
  assert.equal(snapshot.modelId, 'opencode-go/deepseek-v4-pro');
  assert.ok(snapshot.notes.some(n => n.includes('AgentService') && n.includes('initializeEngine')));

  // Verify restore retains modelId
  const restoredContext = createContextManager(history, messages, snapshot, null);
  assert.equal(restoredContext.metrics().limitBytes, 180000 * 4);
  assert.equal(restoredContext.metrics().budgetSource, 'fallback', 'restoring an assumed limit must not relabel it as model metadata');
});

test('provider usage ignores zero and compacts at 90% of the model limit', () => {
  const history = [{ role: 'user', content: 'Keep working on this request.' }];
  const messages = [{ role: 'user', content: 'Keep working on this request.' }];
  const context = createContextManager(history, messages, null, null, { modelId: 'opencode-go/kimi-k3' });
  history.push({ role: 'assistant', content: 'Reading project context.' }, { role: 'tool', content: 'x'.repeat(50000) });
  context.recordSegment(1);
  assert.equal(context.observeUsage({ input_tokens: 0 }), false);
  assert.equal(context.observeUsage({ input_tokens: 0.5 }), false);
  assert.equal(context.metrics().lastInputTokens, null);
  assert.equal(context.observeUsage({ input_tokens: 0, prompt_tokens: 80 }), true, 'use another positive provider field when an empty alias is present');
  assert.equal(context.metrics().lastInputTokens, 80);

  context.observeUsage({ input_tokens: 179999 });
  assert.equal(context.compactIfNeeded([], [], null), null);

  context.observeUsage({ input_tokens: 180000 });
  const compacted = context.compactIfNeeded([], [], null);
  assert.ok(compacted, 'provider-reported usage should compact even while history bytes remain below the hard ceiling');
  assert.ok(compacted.afterBytes < compacted.beforeBytes);
  assert.equal(context.metrics().compactions, 1);
  assert.equal(context.metrics().budgetTokens, 200000);
  assert.equal(context.metrics().lastInputTokens, null, 'pre-compaction provider usage must not be displayed as current usage');
  assert.equal(context.metrics().contextSource, 'estimate');
});

test('serialized history compacts at its model-adjusted estimate ceiling', () => {
  const history = [{ role: 'user', content: 'Inspect the project.' }];
  const messages = [{ role: 'user', content: 'Inspect the project.' }];
  const context = createContextManager(history, messages, null, null, { modelId: 'opencode/big-pickle' });
  const emptyMessageBytes = Buffer.byteLength(JSON.stringify([...history, { role: 'assistant', content: '' }]));
  const contentLength = context.getBudget().limitBytes - emptyMessageBytes;
  history.push({ role: 'assistant', content: 'x'.repeat(contentLength) });
  context.recordSegment(1);
  assert.equal(Buffer.byteLength(JSON.stringify(history)), context.getBudget().limitBytes);

  const compacted = context.compactIfNeeded([], [], null);
  assert.ok(compacted, 'history at the 200K estimate should compact');
  assert.equal(context.metrics().compactions, 1);
});
