const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
function load(file) {
  const code = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src', file)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' }).outputFiles[0].text;
  const m = new Module(__filename, module); m.paths = module.paths; m._compile(code, __filename); return m.exports;
}
const { SimpleFastVoiceSession } = load('simpleFastVoice.ts');
const { routeFastRequest } = load('fastLatency.ts');
const { allWindowRequest } = load('fastTaskContinuity.ts');
const { formatFastPcContext } = load('pcContext.ts');
function fixture(t) {
  const progress = [], spoken = [], cancelled = [], sent = [];
  global.window = { orvixDesktop: { cancelFastTask: id => cancelled.push(id), logLive() {} }, speechSynthesis: { cancel() {} } };
  const v = new SimpleFastVoiceSession([], { onStatus() {}, onTranscript() {}, onProgress: p => progress.push(p) });
  v.stopped = false;
  v.session = { sendToolResponse: r => sent.push(r), sendClientContent: r => sent.push(r), close() {} };
  v.audioEngine = { hasPlayback: false, clearPlayback() {}, close() {} };
  v.progressVoice = { close() {} }; v.narrator = { close() {} };
  v.kick = () => {};
  v.speak = async (text, phase) => { spoken.push({ text, phase }); return true; };
  t.after(() => v.stop());
  return { v, progress, spoken, cancelled, sent };
}
test('Bengali music commands cannot accidentally contain a clock command', () => {
  for (const text of ['একটা ভালো গান ছাড়ো', 'একটা গান চালাও', 'Anupam Roy er gaan chalao']) assert.equal(routeFastRequest(text), 'action', text);
  for (const text of ['কটা বাজে?', 'কয়টা বাজে এখন?', 'কয়টা বাজে?', 'what is the time?']) assert.equal(routeFastRequest(text), 'local_fact', text);
  assert.equal(routeFastRequest('একটা গল্প বলো'), 'conversation');
});
test('startup microphone capture begins alongside Live setup and flushes its ordered lead-in', async t => {
  const { v } = fixture(t); let microphoneInput, releaseConnect; const sentAudio = [];
  window.orvixDesktop.setFastApprovalQueue = () => Promise.resolve();
  v.stopped = true;
  v.session = null;
  v.progressVoice.prepare = () => Promise.resolve();
  v.audioEngine = {
    hasPlayback: false,
    ensureContext: async () => {},
    enableMicrophone: async callback => { microphoneInput = callback; callback('startup-frame'); },
    close() {},
  };
  v.connect = async () => {
    await new Promise(resolve => { releaseConnect = resolve; });
    v.session = { sendRealtimeInput: input => sentAudio.push(input), sendClientContent() {}, close() {} };
    v.flushBufferedMicrophone();
  };
  const starting = v.start(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof microphoneInput, 'function', 'mic permission/capture should not wait for the Live handshake');
  assert.equal(sentAudio.length, 0, 'audio must wait for a session');
  microphoneInput('second-startup-frame');
  releaseConnect();
  await starting;
  microphoneInput('live-frame');
  assert.deepEqual(sentAudio.map(x => x.audio.data), ['startup-frame', 'second-startup-frame', 'live-frame']);
});
test('Bangla all-app minimize requests begin with a window inventory instead of an unrelated PC snapshot', t => {
  const { v } = fixture(t);
  const text = 'সবগুলা অ্যাপ মিনিমাইজ করে দাও';
  assert.equal(allWindowRequest(text), true);
  v.beginTask(text, true);
  assert.equal(v.wholeWindowTask, true);
  assert.deepEqual(v.firstOperation, { name: 'desktop_observe', args: { scope: 'windows' } });
});
test('PC status requests are recognized for the local compact status tool', t => {
  const { v } = fixture(t);
  v.beginTask('accha pc status dekho to', true);
  assert.equal(v.firstOperation.name, 'get_pc_status');
});
test('Fast PC context bounds paired browser metadata instead of embedding full snapshots', () => {
  const huge = 'private-browser-metadata-'.repeat(3000);
  const text = formatFastPcContext({
    Windows: [], Browsers: [], Media: [],
    BrowserContext: { connected: true, ageMs: 0, totalTabs: 1, tabs: [{ ref: 'tab-1', title: 'Current tab', url: 'https://example.com' }], windows: [{ metadata: huge }], capabilities: { metadata: huge } },
  });
  assert.ok(text.length < 5000, `expected compact context, got ${text.length} chars`);
  assert.match(text, /Current tab/);
  assert.doesNotMatch(text, /private-browser-metadata/);
});
test('fresh PC status sends a bounded summary instead of the raw monitor snapshot', async t => {
  const { v } = fixture(t);
  const huge = 'private-browser-metadata-'.repeat(3000);
  window.orvixDesktop.getPcSnapshot = async () => ({
    Windows: [], Browsers: [], Media: [],
    BrowserContext: { connected: true, ageMs: 0, totalTabs: 1, tabs: [{ ref: 'tab-1', title: 'Current tab', url: 'https://example.com' }], windows: [{ metadata: huge }], capabilities: { metadata: huge } },
    BatteryPercent: 75, Volume: 30,
  });
  const result = await v.dispatch('get_pc_status', {});
  assert.equal(result.snapshot, undefined);
  assert.ok(JSON.stringify(result).length < 7000);
  assert.match(result.summary, /Current tab/);
  assert.match(result.summary, /Battery: 75%/);
});
test('approval obstacle appears at retention and is spoken once without waiting for provider completion', async t => {
  const { v, progress, spoken } = fixture(t); v.beginTask('Open the protected page'); v.language = 'en';
  const receipt = v.retainToolResult('browser_act', { action: 'click', target: 'element' }, 'call-1', { status: 'confirmation_required', approvalId: 'approval-1' }, 'operation');
  assert.ok(progress.some(p => /needs your approval/.test(p.text)));
  assert.equal(v.turnComplete, false);
  await v.announceApproval(receipt); await v.announceApproval(receipt);
  assert.equal(spoken.length, 1); assert.match(spoken[0].text, /has not run/);
});
test('waiting approval is not retried as a provider stall', async t => {
  const { v } = fixture(t); v.beginTask('Open page'); v.serverBusy = true;
  v.receipts = [{ name: 'browser_act', args: {}, result: { approvalId: 'approval-1', stepCheck: { approval: true } } }];
  v.recoverConnection = async () => assert.fail('Must not reconnect for approval');
  v.armSilenceNotice(); assert.equal(v.silenceTimer, undefined);
  await v.recoverStalledResponse(); assert.equal(v.responseRecoveries, 0);
});
test('accepted approval unblocks the retained operation once without waiting for model', t => {
  const { v } = fixture(t); v.beginTask('Open page'); v.taskId = 'task'; v.serverBusy = true;
  const receipt = { name: 'browser_act', args: {}, result: { approvalId: 'approval-1', stepCheck: { approval: true } } }; v.receipts = [receipt];
  const event = { type: 'approval_closed', accepted: true, taskId: 'task', approvalId: 'approval-1' };
  v.onWorkEvent(event); v.onWorkEvent(event);
  assert.equal(v.serverBusy, false); assert.equal(v.approvedQueue.length, 1);
  assert.equal(v.approvedQueue[0].receipt, receipt);
});
test('approval accepted during narration remains ready after the original tool response is submitted', t => {
  const { v, sent } = fixture(t); v.beginTask('Open page'); v.taskId = 'task';
  const receipt = { id: 'call-1', name: 'browser_act', args: {}, result: { status: 'confirmation_required', approvalId: 'approval-1', stepCheck: { approval: true, verified: false } } };
  v.receipts = [receipt]; v.pendingResponses = [receipt];
  v.onWorkEvent({ type: 'approval_closed', accepted: true, taskId: 'task', approvalId: 'approval-1' });
  v.submitResults();
  assert.equal(sent.length, 1); assert.equal(v.serverBusy, false); assert.equal(v.approvedQueue.length, 1);
});
test('bare provider interruption preserves task, approvals, receipts and in-flight effects', t => {
  const { v, cancelled } = fixture(t); v.beginTask('Play Anupam Roy'); v.taskId = 'task';
  const receipt = { name: 'browser_act', args: {}, result: { approvalId: 'approval-1', stepCheck: { approval: true } } };
  v.receipts = [receipt]; v.activeOperations.set('call', { call: { id: 'call', name: 'browser_act', args: { action: 'click' } } });
  const lifecycle = v.lifecycle, signal = v.controller.signal;
  v.receive({ serverContent: { interrupted: true } });
  assert.equal(v.lifecycle, lifecycle); assert.equal(signal.aborted, false);
  assert.equal(v.taskActive, true); assert.equal(v.taskId, 'task'); assert.equal(v.receipts[0], receipt);
  assert.equal(v.activeOperations.size, 1); assert.deepEqual(cancelled, []);
  assert.equal(v.waitingApproval(), true); assert.equal(v.responseInterrupted, true);
});
test('interruption reports pending approval accurately without claiming a reconnect occurred', async t => {
  const { v, spoken } = fixture(t); v.beginTask('Play song'); v.language = 'en';
  v.receipts = [{ name: 'browser_act', args: {}, result: { approvalId: 'approval-1', stepCheck: { approval: true } } }];
  v.pauseProviderResponse(); await v.report();
  assert.match(spoken[0].text, /waiting for your approval/); assert.doesNotMatch(spoken[0].text, /reconnection|complete\./);
});
test('explicit replacement still cancels prior work and retains its observed outcomes', t => {
  const { v, cancelled } = fixture(t); v.beginTask('Play song'); v.taskId = 'task';
  v.receipts = [{ name: 'browser_act', args: {}, result: { status: 'ok' } }];
  v.interruptCurrent('typed');
  assert.deepEqual(cancelled, ['task']); assert.equal(v.taskActive, false); assert.equal(v.interruptedWork.length, 1);
});
test('quota disconnect is reported as quota with its unknown dimension', async t => {
  const { v } = fixture(t); const transcripts = []; v.callbacks.onTranscript = r => transcripts.push(r);
  v.language = 'en'; v.quotaFailure = true;
  await v.endConnection(); assert.match(transcripts[0].text, /quota error/); assert.match(transcripts[0].text, /exact limit is not identified/);
});
test('declined or expired approval immediately submits a truthful no-effect result', t => {
  const { v } = fixture(t); v.beginTask('Open page'); v.taskId = 'task'; v.serverBusy = true;
  v.receipts = [{ name: 'browser_act', args: {}, result: { approvalId: 'approval-1', stepCheck: { approval: true } } }];
  v.onWorkEvent({ type: 'result', taskId: 'task', approvalId: 'approval-1', result: { status: 'confirmation_declined', message: 'No effect was applied.' } });
  assert.equal(v.waitingApproval(), false); assert.equal(v.serverBusy, false);
  assert.equal(v.pendingResponses[0].result.status, 'confirmation_declined');
});
test('an effect completing after a bare provider interruption is retained once, never replayed', async t => {
  const { v, cancelled } = fixture(t); v.beginTask('Minimize Notepad'); v.taskAckPending = false; v.ensureTask = async () => {};
  // This test isolates retention of dispatched effects; speech is covered by
  // check_fast_every_tool_ack, including the new mandatory acknowledgment gate.
  v.acknowledge = async (_context, onStart) => { onStart?.(); return true; };
  let finish, effects = 0;
  v.dispatch = async () => { effects++; return new Promise(resolve => { finish = resolve; }); };
  const pending = v.runTool({ id: 'call-1', name: 'manage_window', args: { appName: 'Notepad', action: 'minimize' } });
  for (let i = 0; i < 30 && !finish; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(finish); v.receive({ serverContent: { interrupted: true } });
  finish({ status: 'ok', verification: { verified: true } });
  const result = await pending;
  assert.equal(result.result.status, 'ok'); assert.equal(v.receipts.length, 1);
  assert.equal(effects, 1); assert.deepEqual(cancelled, []);
  assert.equal((await v.runTool({ id: 'call-1', name: 'manage_window', args: { appName: 'Notepad', action: 'minimize' } })).result.status, 'ok');
  assert.equal(effects, 1);
});
