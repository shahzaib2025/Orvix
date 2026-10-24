const test = require('node:test');
const assert = require('node:assert/strict');
const { createDesignOptionsStream, storyboardFromPartialJson } = require('../electron/agent/design-options-stream.cjs');
const { collectStream } = require('../electron/agent/model-stream.cjs');
const { createDesignReview } = require('../electron/agent/design-review.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 90));
const optionText = 'Option A — Image Field\nA building fills the screen above a small action.\n\nOption B — Work Index\nA project index leads into an annotated section drawing.\n\nSelected option: B\nSelection reason: B gives visitors an inspectable work list.\n\nSelected layout blueprint\nThe header shares the project index rail.';

test('live drafts arrive before completion, retain long public text and finish in the same record', async () => {
  const events = [];
  const stream = createDesignOptionsStream({ enabled: true, emit: event => events.push(event) });
  try {
    stream.text('public', 'I will develop the options.\n\nOption A — Image Field');
    assert.equal(events.length, 1);
    assert.equal(events[0].phase, 'update');
    stream.text('public', '\n' + 'Developed public architecture. '.repeat(280), true);
    await tick();
    assert.ok(events.at(-1).text.length > 4000);
    stream.text('public', '\n\n' + optionText.slice(optionText.indexOf('Option B')), true);
    await tick();
    const full = events.at(-1).text;
    stream.tool({ id: 'digest', name: 'orvix_visual_set_design_brief', input: { storyboard: 'Option A: image.\nOption B: index.\nSelected option: B' } });
    stream.checking('Option A: image.\nOption B: index.\nSelected option: B');
    assert.match(events.at(-1).text, /Comparing the selected direction/);
    assert.ok(events.at(-1).text.includes('Developed public architecture. '.repeat(250)));
    stream.record('Selected option: B', 'Selected direction can proceed.');
    assert.equal(events.at(-1).phase, 'complete');
    assert.ok(events.at(-1).text.includes('Selected layout blueprint'));
    assert.equal((events.at(-1).text.match(/Option B — Work Index/g) ?? []).length, 1);
    assert.ok(full.length > 4000);
    assert.equal(new Set(events.map(event => event.progressId)).size, 1);
  } finally { stream.dispose(); }
});

test('partial JSON decodes only complete characters; unrelated tools and disabled workflows never publish', () => {
  assert.equal(storyboardFromPartialJson('{"storyboard":"Option A\\nA \\u2'), 'Option A\nA ');
  assert.equal(storyboardFromPartialJson('{"storyboard":"Option A\\nA \\u2192 \\"'), 'Option A\nA → "');
  assert.equal(storyboardFromPartialJson('{"direction":"hidden"'), '');
  const events = [];
  const stream = createDesignOptionsStream({ enabled: true, emit: event => events.push(event) });
  stream.tool({ id: 'read', name: 'read', arguments: JSON.stringify({ storyboard: optionText }) });
  assert.equal(events.length, 0);
  stream.tool({ id: 'brief', name: 'set_design_brief', arguments: '{"storyboard":"Option A' });
  assert.equal(events[0].phase, 'update');
  assert.match(events[0].text, /Option A/);
  stream.reset();
  assert.equal(events.at(-1).phase, 'remove');
  stream.dispose();
  const disabled = createDesignOptionsStream({ enabled: false, emit: event => events.push(event) });
  const count = events.length;
  disabled.text('a', optionText); disabled.tool({ id: 'b', name: 'set_design_brief', input: { storyboard: optionText } }); disabled.record(optionText, 'Done');
  assert.equal(events.length, count);
  disabled.dispose();
});

for (const route of ['chat', 'responses', 'messages']) test(`${route} tool-input chunks expose a public storyboard before the provider completes`, async () => {
  let controller;
  const updates = [];
  const stream = createDesignOptionsStream({ enabled: true, emit: event => updates.push(event) });
  const response = new Response(new ReadableStream({ start(value) { controller = value; } }));
  const send = value => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
  const collecting = collectStream(route, response, () => {}, () => {}, input => stream.tool(input));
  let complete = false;
  collecting.then(() => { complete = true; });
  const raw = JSON.stringify({ storyboard: optionText });
  const boundary = raw.indexOf('Option B');
  if (route === 'chat') {
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'brief', function: { name: 'set_design_brief', arguments: raw.slice(0, boundary) } }] } }] });
  } else if (route === 'responses') {
    send({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'brief', name: 'set_design_brief', arguments: '' } });
    send({ type: 'response.function_call_arguments.delta', output_index: 0, delta: raw.slice(0, boundary) });
  } else {
    send({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'brief', name: 'set_design_brief', input: {} } });
    send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: raw.slice(0, boundary) } });
  }
  await tick();
  assert.equal(complete, false);
  assert.ok(updates.length > 0, 'a real chunk must reach the viewer while response completion is held');
  assert.match(updates.at(-1).text, /Image Field/);
  assert.doesNotMatch(updates.at(-1).text, /Work Index/);
  if (route === 'chat') {
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: raw.slice(boundary) } }] } }] });
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
  } else if (route === 'responses') {
    send({ type: 'response.function_call_arguments.delta', output_index: 0, delta: raw.slice(boundary) });
    send({ type: 'response.completed', response: {} });
  } else {
    send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: raw.slice(boundary) } });
    send({ type: 'content_block_stop', index: 0 }); send({ type: 'message_stop' });
  }
  controller.close();
  await collecting;
  stream.finish();
  assert.match(updates.at(-1).text, /Work Index/);
  assert.equal(updates.at(-1).phase, 'complete');
  stream.dispose();
});

test('comparison cannot hide a finished draft while the comparison request is still pending', async () => {
  let release;
  const events = [];
  const design = createDesignReview({ enabled: true, brief: 'Make a new website.', profile: 'max', mode: 'off', signal: new AbortController().signal,
    evidence: { record: () => ({ id: 'fixture' }) }, emit: event => events.push(event),
    priorDesigns: [{ taskId: 'earlier', brief: { direction: 'A frame', storyboard: 'An archive' } }],
    review: () => new Promise(resolve => { release = () => resolve({ text: JSON.stringify({ status: 'distinct', similarities: [], summary: 'Different relationships.' }) }); }) });
  const recording = design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'A project index', signature: 'Measured work', responsive: 'Rows stack', storyboard: optionText });
  await tick();
  assert.ok(release, 'comparison has started');
  assert.match(events.findLast(event => event.progressId === 'website-design-options').text, /Comparing the selected direction/);
  assert.equal(events.findLast(event => event.progressId === 'website-design-options').phase, 'update');
  release(); await recording;
  assert.equal(events.findLast(event => event.progressId === 'website-design-options').phase, 'complete');
  design.optionsStream.dispose();
});

test('an interrupted partial draft stays readable and is never labelled complete construction', () => {
  const controller = new AbortController(), events = [];
  const stream = createDesignOptionsStream({ enabled: true, signal: controller.signal, emit: event => events.push(event) });
  stream.text('partial', 'Option A — A developing idea\nA single public composition.');
  controller.abort(); stream.finish(true); stream.dispose();
  assert.equal(events.at(-1).phase, 'complete');
  assert.match(events.at(-1).text, /draft is incomplete/);
  assert.doesNotMatch(events.at(-1).text, /Selected direction can proceed/);
});

test('the direct Orvix executor streams its public option deliverable before a terminal provider error', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createAgentEngine } = require('../electron/agent/engine.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-options-direct-')), events = [];
  let called = false;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => 'fixture' }, event => events.push(event), () => {}, {
    reviewModel: async () => ({ text: JSON.stringify({ goal: 'Plan website layout options', feature: 'Website options', expectedBehavior: 'Two public options', questions: [], assumptions: [] }), calls: [] }),
    requestModel: async options => {
      called = true;
      options.onDelta('Option A — Image Field\nA readable public design.');
      assert.match(events.find(event => event.progressId === 'website-design-options').text, /readable public design/);
      options.onDelta('\n\nOption B — Work Index\nAnother public design.');
      await tick();
      assert.match(events.findLast(event => event.progressId === 'website-design-options').text, /Another public design/);
      throw new Error('Fixture terminal provider error');
    },
  });
  try {
    await assert.rejects(engine.run({ taskId: 'stream-direct', requestId: 'turn', modelId: 'opencode/big-pickle', designProfile: 'medium', accessMode: 'Plan', accessModeVersion: 2,
      messages: [{ role: 'user', content: 'Develop two website layout options only. Do not build a website.' }] }), /Fixture terminal provider error/);
    assert.equal(called, true);
    const final = events.findLast(event => event.progressId === 'website-design-options');
    assert.match(final.text, /draft is incomplete/);
    assert.equal(final.phase, 'complete');
  } finally {
    await engine.shutdown();
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
});
