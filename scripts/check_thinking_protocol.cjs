const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const sdk = require('@google/genai');
const fs = require('node:fs');
const os = require('node:os');

const connections = [];
const setupMessages = [];
const project = path.resolve(__dirname, '..');
const built = esbuild.buildSync({ entryPoints: [path.join(project, 'src/thinkingVoice.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.thinking-protocol-check.cjs'), module);
loaded.filename = path.join(__dirname, '.thinking-protocol-check.cjs');
loaded.paths = module.paths;
loaded.require = name => name === '@google/genai' ? { ...sdk, GoogleGenAI: class {
  live = { connect: async options => {
    const session = { responses: [], inputs: [], audio: [], closed: false,
      sendToolResponse(value) { this.responses.push(value); },
      sendClientContent(value) { this.inputs.push(value); },
      sendRealtimeInput(value) { this.audio.push(value); },
      close() { this.closed = true; },
    };
    connections.push({ options, session });
    for (const message of setupMessages.splice(0)) options.callbacks.onmessage(message);
    return session;
  } };
} } : require(name);
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { ThinkingVoiceSession } = loaded.exports;

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(overrides = {}, options = {}) {
  const statuses = [], transcripts = [], progress = [], logs = [], history = [];
  const bridge = { createLiveToken: async () => ({ token: 'fixture', model: 'gemini-3.8-live-extended-thinking' }),
    getWeather: async () => ({ status: 'ok', location: 'Dhaka', temperature: '30 degrees C' }),
    listDirectory: async () => ({ status: 'ok', directory: 'Desktop', files: [], folders: [] }),
    getPcSnapshot: async () => null, searchWeb: async () => ({ status: 'ok', results: [] }),
    tinyWorkflowCapabilities: async () => ({ status: 'ok', capabilities: [] }),
    logLive: (...args) => logs.push(args), ...overrides };
  global.window = { setTimeout, clearTimeout, orvixDesktop: bridge };
  const voice = new ThinkingVoiceSession('LOW', history, {
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onTranscript: value => transcripts.push({ ...value }), onProgress: value => progress.push(value),
  }, null, options);
  voice.audioEngine.ensureContext = async () => {};
  await voice.start(false);
  return { voice, statuses, transcripts, progress, logs, history, bridge, connection: connections.at(-1) };
}
const call = (id, name, args = {}) => ({ id, name, args });
const idle = voice => voice.handleMessage({ serverContent: { interactionStatus: 'IDLE', turnComplete: true } });

test('Thinking protocol and recovery', async t => {
  await t.test('initial setup enables resumption, compression and non-blocking tools', async () => {
    let startupListings = 0;
    const f = await fixture({ listDirectory: async () => { startupListings++; return { status: 'ok', directory: 'Desktop', files: ['stale.txt'], folders: [] }; } });
    try {
      assert.equal(startupListings, 0, 'startup cannot preload a stale directory listing in place of a requested tool call');
      assert.deepEqual(f.connection.options.config.sessionResumption, {});
      assert.deepEqual(f.connection.options.config.contextWindowCompression, { slidingWindow: {} });
      assert.equal(f.connection.options.config.thinkingConfig.thinkingLevel, 'LOW');
      assert.equal(f.connection.options.config.mediaResolution, sdk.MediaResolution.MEDIA_RESOLUTION_HIGH);
      assert.ok(f.connection.options.config.tools[0].functionDeclarations.every(d => d.behavior === 'NON_BLOCKING'));
      assert.doesNotMatch(f.connection.options.config.systemInstruction, /completely safe|NEVER say|premier online|1M-2M/);
    } finally { f.voice.stop(); }
  });
  await t.test('a selected research tool set excludes changing functions while retaining the production protocol', async () => {
    const f = await fixture({}, { toolNames: ['list_directory', 'web_search', 'read_web_page'] });
    try {
      assert.deepEqual(f.connection.options.config.tools[0].functionDeclarations.map(tool => tool.name).sort(), ['list_directory', 'read_web_page', 'web_search']);
      assert.ok(f.connection.options.config.tools[0].functionDeclarations.every(tool => tool.behavior === 'NON_BLOCKING'));
      assert.deepEqual(f.connection.options.config.sessionResumption, {});
    } finally { f.voice.stop(); }
  });
  await t.test('messages received during connection setup are buffered until the session exists', async () => {
    setupMessages.push({ sessionResumptionUpdate: { resumable: true, newHandle: 'early-handle' } }, { toolCall: { functionCalls: [call('early-call', 'get_weather')] } });
    const f = await fixture();
    try {
      await tick();
      assert.equal(f.voice.resumeHandle, 'early-handle');
      assert.equal(f.connection.session.responses[0].functionResponses[0].id, 'early-call');
    } finally { f.voice.stop(); }
  });
  await t.test('fillers and turnComplete without IDLE keep the request active', async () => {
    const f = await fixture();
    try {
      f.voice.sendText('Check the weather');
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'Checking...' }, turnComplete: true, interactionStatus: 'IN_PROGRESS' } });
      assert.equal(f.voice.awaitingAnswer, true);
      assert.equal(f.transcripts.at(-1).phase, 'progress');
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'Still checking...' }, turnComplete: true } });
      assert.equal(f.voice.awaitingAnswer, true);
      assert.equal(f.history.filter(x => x.role === 'assistant').length, 0);
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'It is 30 degrees.' }, interactionStatus: 'IDLE', turnComplete: true } });
      assert.equal(f.voice.awaitingAnswer, false);
      assert.equal(f.transcripts.at(-1).phase, 'final');
    } finally { f.voice.stop(); }
  });
  await t.test('each completed async tool responds without waiting for a slower tool', async () => {
    const slow = deferred();
    const f = await fixture({ searchWeb: () => slow.promise });
    try {
      f.voice.sendText('Get weather and search');
      const job = f.voice.handleToolCalls([call('fast', 'get_weather'), call('slow', 'web_search')]);
      await tick();
      assert.equal(f.connection.session.responses.length, 1);
      assert.equal(f.connection.session.responses[0].functionResponses[0].id, 'fast');
      idle(f.voice);
      assert.equal(f.voice.awaitingAnswer, true);
      slow.resolve({ status: 'ok', results: [] }); await job;
      assert.equal(f.connection.session.responses.length, 2);
      assert.equal(f.voice.awaitingAnswer, true);
      idle(f.voice);
      assert.equal(f.voice.awaitingAnswer, false);
    } finally { slow.resolve({ status: 'unavailable' }); f.voice.stop(); }
  });
  await t.test('workflow responses omit unsupported scheduling', async () => {
    const f = await fixture();
    try {
      await f.voice.handleToolCalls([call('workflow', 'tiny_workflow_capabilities')]);
      const response = f.connection.session.responses[0].functionResponses[0];
      assert.equal(response.id, 'workflow');
      assert.equal(response.name, 'tiny_workflow_capabilities');
      assert.ok(!('scheduling' in response));
    } finally { f.voice.stop(); }
  });
  await t.test('malformed, duplicate and cancelled calls never repeat effects', async () => {
    let writes = 0;
    const result = deferred();
    const f = await fixture({ writeFile: () => { writes++; return result.promise; } });
    try {
      const job = f.voice.handleToolCalls([call('write', 'write_file'), call('write', 'write_file'), { name: 'write_file' }]);
      f.voice.handleMessage({ toolCallCancellation: { ids: ['write'] } });
      result.resolve({ status: 'ok' }); await job;
      await f.voice.handleToolCalls([call('write', 'write_file')]);
      assert.equal(writes, 1);
      assert.equal(f.connection.session.responses.length, 0);
    } finally { result.resolve({ status: 'ok' }); f.voice.stop(); }
  });
  await t.test('failed tools and model apologies stay truthful and are not replayed', async () => {
    const f = await fixture({ writeFile: async () => ({ status: 'permission_denied' }) });
    try {
      f.voice.sendText('Write a file');
      await f.voice.handleToolCalls([call('denied', 'write_file')]);
      assert.equal(f.connection.session.responses[0].functionResponses[0].response.status, 'permission_denied');
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'I could not complete the write because permission was denied.' }, interactionStatus: 'IDLE' } });
      assert.equal(f.connection.session.inputs.length, 1);
      assert.match(f.transcripts.at(-1).text, /permission was denied/);
      assert.ok(f.progress.some(x => /সাফল্য নিশ্চিত হয়নি/.test(x.text)));
      f.voice.sendText('Check a file');
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'A system error occurred.' }, interactionStatus: 'IDLE' } });
      assert.equal(f.connection.session.inputs.length, 2);
      assert.ok(f.progress.some(x => /কোনো টুল না ডেকেই/.test(x.text)));
    } finally { f.voice.stop(); }
  });
  await t.test('1011 is retried as a server error; 1008 does not become quota', async () => {
    const f = await fixture();
    f.connection.options.callbacks.onclose({ code: 1011, reason: 'Internal error' });
    assert.equal(f.statuses.at(-1).status, 'reconnecting');
    assert.equal(f.voice.stopped, false);
    f.voice.stop();
    const g = await fixture();
    g.connection.options.callbacks.onclose({ code: 1008, reason: 'Project denied access' });
    assert.equal(g.statuses.at(-1).status, 'error');
    assert.match(g.statuses.at(-1).detail, /denied access/);
    assert.doesNotMatch(g.statuses.at(-1).detail, /quota/);
  });
  await t.test('resumed session receives outstanding result once without replaying its tool', async () => {
    const result = deferred(); let runs = 0;
    const f = await fixture({ searchWeb: () => { runs++; return result.promise; } });
    try {
      f.voice.sendText('Search');
      f.voice.handleMessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'resume-fixture' } });
      const job = f.voice.handleToolCalls([call('resume-tool', 'web_search')]);
      f.connection.options.callbacks.onclose({ code: 1011, reason: 'Internal error' });
      clearTimeout(f.voice.reconnectTimer); f.voice.reconnectTimer = undefined;
      result.resolve({ status: 'ok', results: [] }); await job;
      assert.equal(f.voice.pendingResponses.size, 1);
      await f.voice.connect(f.voice.generation);
      const next = connections.at(-1);
      assert.deepEqual(next.options.config.sessionResumption, { handle: 'resume-fixture' });
      assert.equal(next.session.responses.length, 1);
      assert.equal(runs, 1);
      f.connection.options.callbacks.onmessage({ serverContent: { interactionStatus: 'IDLE' } });
      assert.equal(f.voice.awaitingAnswer, true, 'old callbacks must be ignored');
    } finally { result.resolve({ status: 'ok' }); f.voice.stop(); }
  });
  await t.test('fresh reconnect discards old results and requests checking uncertain effects', async () => {
    const result = deferred();
    const f = await fixture({ writeFile: () => result.promise });
    try {
      f.voice.sendText('Write');
      const job = f.voice.handleToolCalls([call('lost-write', 'write_file')]);
      f.connection.options.callbacks.onclose({ code: 1011, reason: 'Internal error' });
      clearTimeout(f.voice.reconnectTimer); f.voice.reconnectTimer = undefined;
      await f.voice.connect(f.voice.generation);
      result.resolve({ status: 'ok' }); await job;
      assert.equal(connections.at(-1).session.responses.length, 0);
      assert.equal(f.voice.awaitingAnswer, false);
      assert.ok(f.progress.some(x => /সম্পন্ন কাজগুলো যাচাই/.test(x.text)));
    } finally { result.resolve({ status: 'ok' }); f.voice.stop(); }
  });
  await t.test('a finalized screen sharing voice command is consumed without a model reply', async () => {
    const f = await fixture();
    try {
      let command = '';
      f.voice.callbacks.onScreenSharingCommand = text => { command = text; return true; };
      f.voice.handleMessage({ serverContent: { inputTranscription: { text: 'screen share on koro', finished: true }, interactionStatus: 'IN_PROGRESS' } });
      assert.equal(command, 'screen share on koro');
      assert.equal(f.voice.suppressScreenCommandResponse, true);
      assert.equal(f.history.some(item => item.role === 'user' && item.text.includes('screen share')), false);
      const transcriptCount = f.transcripts.length;
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'Opening screen sharing.' }, turnComplete: true, interactionStatus: 'IDLE' } });
      assert.equal(f.transcripts.length, transcriptCount);
      assert.equal(f.voice.suppressScreenCommandResponse, false);
      assert.equal(f.voice.awaitingAnswer, false);
    } finally { f.voice.stop(); }
  });
  await t.test('microphone input continues while background reasoning runs', async () => {
    const f = await fixture();
    try {
      let capture;
      f.voice.audioEngine.enableMicrophone = async fn => { capture = fn; };
      await f.voice.enableMicrophone();
      f.voice.sendText('Think');
      capture('pcm-fixture');
      assert.equal(f.connection.session.audio[0].audio.mimeType, 'audio/pcm;rate=16000');
    } finally { f.voice.stop(); }
  });
  await t.test('GoAway reconnects and stop clears reconnect state', async () => {
    const f = await fixture();
    f.voice.handleMessage({ goAway: { timeLeft: '0.05s' } });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.connection.session.closed, true);
    assert.equal(f.statuses.at(-1).status, 'reconnecting');
    f.voice.stop();
    assert.equal(f.voice.goAwayTimer, undefined);
    assert.equal(f.voice.reconnectTimer, undefined);
    assert.equal(f.voice.resumeHandle, undefined);
  });
  await t.test('slow tool budgets, truthful output and stalled-request timeout', async () => {
    const helperBuild = esbuild.buildSync({ entryPoints: [path.join(project, 'src/thinkingProtocol.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
    const helpers = new Module(path.join(__dirname, '.thinking-helpers.cjs'), module);
    helpers.filename = path.join(__dirname, '.thinking-helpers.cjs');
    helpers._compile(helperBuild.outputFiles[0].text, helpers.filename);
    assert.equal(helpers.exports.thinkingToolTimeout('search_content'), 30_000);
    assert.equal(helpers.exports.thinkingToolTimeout('search_class10_textbook'), 720_000);
    const f = await fixture();
    try {
      assert.equal(f.voice.sanitizeToolOutput(undefined).status, 'unavailable');
      const minimized = { status: 'ok', action: 'minimize', app: 'Notepad' };
      assert.deepEqual(f.voice.sanitizeToolOutput(minimized), minimized);
      await assert.rejects(f.voice.withTimeout(new Promise(() => {}), 2, 'slow'), /timed out/);
      f.voice.sendText('Think');
      f.voice.lastServerActivityAt = Date.now() - 91_000;
      await new Promise(resolve => setTimeout(resolve, 1050));
      assert.equal(f.statuses.at(-1).status, 'error');
      assert.match(f.statuses.at(-1).detail, /Gemini/);
      assert.equal(f.voice.stopped, true);
    } finally { f.voice.stop(); }
  });
  await t.test('directory counts remain complete while the displayed names are partial', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-thinking-listing-'));
    try {
      for (let i = 0; i < 28; i++) fs.mkdirSync(path.join(tempRoot, `folder-${i}`));
      for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(tempRoot, `file-${i}.txt`), 'fixture');
      const result = await require('../electron/live-fs-tools.cjs').listDirectory({ directory: tempRoot });
      assert.equal(result.folderCount, 28);
      assert.equal(result.fileCount, 12);
      assert.equal(result.totalCount, 40);
      assert.equal(result.truncated, true);
      const f = await fixture({ listDirectory: async () => result });
      try {
        await f.voice.handleToolCalls([call('listing-counts', 'list_directory', { directory: tempRoot })]);
        const sent = f.connection.session.responses[0].functionResponses[0].response;
        assert.equal(sent.folderCount, 28);
        assert.equal(sent.fileCount, 12);
        assert.equal(sent.totalItems, 40);
        assert.equal(sent.shownFolderCount, 12);
        assert.equal(sent.truncated, true);
        assert.match(sent.message, /28 folders, 12 files/);
        assert.match(sent.message, /partial list/);
        const legacy = f.voice.sanitizeToolOutput({ directory: 'Desktop', totalCount: 40, folders: result.folders, files: result.files });
        assert.equal(legacy.folderCount, undefined, 'unknown folder totals cannot be inferred from a shortened list');
        assert.equal(legacy.truncated, true);
      } finally { f.voice.stop(); }
    } finally {
      assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir()));
      assert.ok(path.basename(tempRoot).startsWith('orvix-thinking-listing-'));
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
  await t.test('trace connects received call IDs to the exact outgoing payload and later server state', async () => {
    const f = await fixture();
    try {
      f.voice.sendText('Check weather');
      f.voice.handleMessage({ toolCall: { functionCalls: [call('trace-call', 'get_weather', { location: 'Dhaka' })] } });
      await tick();
      f.voice.handleMessage({ serverContent: { outputTranscription: { text: 'A system error occurred.' }, interactionStatus: 'IDLE', turnComplete: true } });
      const traces = f.logs.map(log => log[2]).filter(value => value?.event);
      const received = traces.find(value => value.event === 'tool_received');
      const submitted = traces.find(value => value.event === 'response_submit');
      assert.equal(received.data.id, 'trace-call');
      assert.equal(submitted.turnId, received.turnId);
      assert.deepEqual(submitted.data.functionResponses, f.connection.session.responses[0].functionResponses);
      assert.ok(traces.some(value => value.event === 'response_submitted' && /SDK send returned/.test(value.data.meaning)));
      assert.ok(traces.some(value => value.event === 'server_event' && value.data.interactionStatus === 'IDLE'));
      assert.ok(traces.some(value => value.event === 'turn_idle' && value.data.modelReportedFailure === true && value.data.toolCalls === 1));
      assert.ok(f.progress.some(value => /ক্লায়েন্ট 1টি টুলের সফল ফল/.test(value.text)), 'a model apology must not erase the successful local result');
      assert.ok(!f.logs.some(log => /Apology\/system error text detected/.test(log[1])));
    } finally { f.voice.stop(); }
  });
  await t.test('page excerpts retain their source, partial status and continuation cursor', async () => {
    const f = await fixture();
    try {
      const page = f.voice.sanitizeToolOutput({ status: 'ok', url: 'https://example.com/', content: 'x'.repeat(4500), source: 'direct_page', truncated: true, offset: 0, nextOffset: 4500, totalCharacters: 9000 });
      assert.equal(page.content.length, 4500);
      assert.equal(page.truncated, true);
      assert.equal(page.nextOffset, 4500);
      assert.equal(page.totalCharacters, 9000);
      const partial = f.voice.sanitizeToolOutput({ status: 'partial', url: 'https://example.com/', content: 'Unverified search excerpt', source: 'search_provider_text', message: 'Direct page failed' });
      assert.equal(partial.status, 'partial');
      assert.equal(partial.message, 'Direct page failed');
      assert.equal(partial.source, 'search_provider_text');
    } finally { f.voice.stop(); }
  });
  await t.test('diagnostic snapshots redact credentials and audio, bound payloads, and rotate the local trace', () => {
    const result = esbuild.buildSync({ entryPoints: [path.join(project, 'src/thinkingDiagnostics.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
    const helper = new Module(path.join(__dirname, '.thinking-diagnostics-check.cjs'), module);
    helper.filename = path.join(__dirname, '.thinking-diagnostics-check.cjs');
    helper._compile(result.outputFiles[0].text, helper.filename);
    const secret = 'private-test-credential';
    const snapshot = helper.exports.thinkingTraceSnapshot({ apiKey: secret, audio: { data: secret }, url: `https://example.com/?token=${secret}`, content: 'x'.repeat(50_000) });
    assert.ok(snapshot.redacted);
    assert.ok(snapshot.truncated);
    assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(secret));
    assert.ok(JSON.stringify(snapshot).length < 6000);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-thinking-trace-'));
    try {
      const file = path.join(tempRoot, 'thinking-live.jsonl');
      const { appendThinkingTrace } = require('../electron/thinking-trace.cjs');
      appendThinkingTrace(file, { event: 'response_submit', sessionId: 'fixture', ...snapshot }, 100);
      appendThinkingTrace(file, { event: 'turn_idle', sessionId: 'fixture', data: {} }, 100);
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).event, 'turn_idle');
      assert.equal(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')).event, 'response_submit');
    } finally {
      assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir()));
      assert.ok(path.basename(tempRoot).startsWith('orvix-thinking-trace-'));
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
