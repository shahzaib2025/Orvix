const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createPreviewBrowser } = require('../electron/agent/preview-browser.cjs');
const { previewWebsite, createPreviewSession } = require('../electron/agent/preview-website.cjs');
const { readSkill } = require('../electron/agent/skill-library.cjs');
const { instructionsFor } = require('../electron/agent/model-client.cjs');
const { toolResultContext } = require('../electron/agent/tool-result-context.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');

function fakeBrowser() {
  let connected = true;
  return { closes: 0, isConnected: () => connected, async close() { this.closes++; connected = false; } };
}
test('preview reuse shares launch, recovers disconnection and stops owned browsers', async () => {
  const controller = new AbortController(); let launches = 0;
  const session = createPreviewBrowser(controller.signal, async () => { launches++; return fakeBrowser(); });
  const [a, b] = await Promise.all([session.get(), session.get()]);
  assert.equal(a, b); assert.equal(launches, 1);
  await a.close(); const c = await session.get(); assert.notEqual(a, c); assert.equal(launches, 2);
  await session.stop(); assert.equal(c.closes, 1);
  await assert.rejects(session.get(), /cancelled/);
});
test('cancellation during launch closes the late process', async () => {
  const controller = new AbortController(); let release;
  const browser = fakeBrowser();
  const session = createPreviewBrowser(controller.signal, () => new Promise(resolve => { release = resolve; }));
  const getting = session.get(); await Promise.resolve();
  controller.abort(); release(browser);
  await assert.rejects(getting, /cancelled/);
  await session.stop(); assert.equal(browser.closes, 1);
});
test('a failed launch can be retried without retaining a rejected promise', async () => {
  let calls = 0; const browser = fakeBrowser();
  const session = createPreviewBrowser(new AbortController().signal, async () => { if (++calls === 1) throw new Error('Launch failed'); return browser; });
  await assert.rejects(session.get(), /Launch failed/);
  assert.equal(await session.get(), browser); await session.stop();
});
test('website skill stays complete while startup uses only the catalog', () => {
  const full = readSkill('website_design');
  const compact = readSkill('website_design', { sharedDesignGuidanceIncluded: true });
  assert.deepEqual(compact, full);
  assert.match(compact.instructions, /own ideas and judgment/);
  assert.match(full.instructions, /Creative responsibility/);
  assert.doesNotMatch(instructionsFor(null), /Do not let this skill create its own recognizable template/);
  assert.match(instructionsFor(null), /Bundled topic skills/);
  assert.match(instructionsFor(null), /For substantial work, when it is natural, start with one brief acknowledgment/);
  assert.match(instructionsFor(null), /Never wait for a separate acknowledgment or progress-generation call before using tools/);
  assert.match(instructionsFor(null), /For greetings and straightforward questions, answer directly/);
  assert.deepEqual(readSkill('bug_repair'), readSkill('bug_repair', { sharedDesignGuidanceIncluded: true }));
});
test('prompt output folding retains both ends and preserves failures and source reads', () => {
  const text = 'Exit 0\nBEGIN\n' + 'log\n'.repeat(3000) + '\nEND';
  const compact = toolResultContext('run_command', text, false);
  assert.ok(compact.length < text.length); assert.match(compact, /^Exit 0\nBEGIN/); assert.match(compact, /END$/);
  assert.equal(toolResultContext('run_command', text, true), text);
  assert.equal(toolResultContext('read_file_ranges', text, false), text);
  assert.equal(toolResultContext('run_command', text.replace('Exit 0', 'Exit 1'), false), text.replace('Exit 0', 'Exit 1'));
});
test('real preview reuse preserves fresh storage and closes all page contexts', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-speed-preview-'));
  const server = http.createServer((_request, response) => response.end('<!doctype html><html lang="en"><head><title>Reuse fixture</title></head><body><main><h1>Fixture</h1><p id="state"></p><button id="save" onclick="localStorage.setItem(\'saved\',\'yes\')">Save</button></main><script>document.querySelector(\'#state\').textContent=localStorage.getItem(\'saved\')||\'Fresh\'</script></body></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController(), session = createPreviewSession(controller.signal);
  t.after(async () => { await session.stop(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { url: `http://127.0.0.1:${server.address().port}`, taskId: 'fixture', requestId: 'reuse', signal: controller.signal, imageStore: createImageStore({ getPath: () => root }), browserSession: session };
  const browser = await session.get();
  const first = await previewWebsite({ ...options, workflow: [{ action: 'click', selector: '#save' }, { action: 'assert', assertion: { kind: 'storage', key: 'saved', expected: 'yes' } }] });
  assert.ok(first.views.every(view => view.workflow.status === 'passed'));
  assert.equal(browser.contexts().length, 0);
  const second = await previewWebsite({ ...options, workflow: [{ action: 'assert', assertion: { kind: 'text', selector: '#state', expected: 'Fresh' } }] });
  assert.ok(second.views.every(view => view.workflow.status === 'passed'));
  assert.equal(await session.get(), browser); assert.equal(browser.contexts().length, 0);
  await session.stop(); assert.equal(browser.isConnected(), false);
});
