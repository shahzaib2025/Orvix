const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), Module = require('node:module');
const { createCompanionMemory, installCompanionMemory, topics } = require('../electron/companion-memory.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-memory-'));
  const key = crypto.randomBytes(32); let fail = false, time = Date.now();
  const safeStorage = { isEncryptionAvailable: () => true, encryptString(text) {
    if (fail) throw Error('Injected encryption failure');
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  }, decryptString(value) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString(); } };
  const create = () => createCompanionMemory({ directory, safeStorage, now: () => time });
  const store = create();
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, create, directory, safeStorage, advance: () => time += 1000, fail: value => fail = value, now: () => time };
}
function load(file) {
  const code = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src', file)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' }).outputFiles[0].text;
  const m = new Module(__filename, module); m.paths = module.paths; m._compile(code, __filename); return m.exports;
}
test('explicit notes persist across restart, with encrypted content and original provenance', t => {
  const f = fixture(t), text = 'PRIVATE-CANARY-1739 I prefer short Banglish replies';
  const first = f.store.upsert({ text, kind: 'preference', source: { type: 'user_message', conversationId: 'chat-1', messageId: 'msg-1', profile: 'Fast' } });
  assert.equal(first.records.length, 1); assert.equal(first.records[0].occurredAt, null);
  assert.equal(first.records[0].source.messageId, 'msg-1');
  assert.equal(fs.readFileSync(f.store.target).includes(Buffer.from(text)), false);
  assert.equal(fs.readFileSync(f.store.target).includes(Buffer.from('PRIVATE-CANARY')), false);
  f.store.close(); const reopened = f.create(); assert.equal(reopened.snapshot().records[0].text, text); reopened.close();
});
test('preferences recall across Bangla, Banglish and English without an embedding model', t => {
  const { store } = fixture(t); store.upsert({ text: 'আমি ছোট করে বাংলিশে উত্তর পছন্দ করি', kind: 'preference' });
  for (const query of ['short reply preference', 'choto reply', 'ছোট উত্তর', 'which language do I prefer']) assert.equal(store.recall({ query }).records.length, 1, query);
  assert.ok(topics('বাংলা ভাষা').includes('language')); assert.ok(topics('short kore bolo').includes('brevity'));
});
test('events keep their actual date separately from the recorded date', t => {
  const f = fixture(t), occurredAt = f.now() - 86_400_000;
  const value = f.store.upsert({ text: 'Worked on screen sharing', kind: 'event', occurredAt });
  const recalled = f.store.recall({ query: 'screen sharing' }).records[0];
  assert.equal(recalled.occurredAt, occurredAt); assert.equal(recalled.recordedAt, value.records[0].updatedAt); assert.notEqual(recalled.occurredAt, recalled.recordedAt);
});
test('guesses, screen sources and secrets cannot be stored as confirmed notes', t => {
  const { store } = fixture(t);
  for (const input of [{ text: 'You might be busy', kind: 'inference' }, { text: 'Save this', source: { type: 'screen' } }, { text: 'password: secret-12345' }]) assert.throws(() => store.upsert(input));
  assert.equal(store.snapshot().records.length, 0);
});
test('expired notes are excluded and expiry is visible in the editor snapshot', t => {
  const f = fixture(t); f.store.upsert({ text: 'Working on screen sharing', kind: 'event', expiresAt: f.now() + 500 }); f.advance();
  assert.equal(f.store.recall({ query: 'screen sharing' }).records.length, 0); assert.equal(f.store.snapshot().records[0].expired, true);
});
test('project notes never leak into unrelated scopes', t => {
  const { store } = fixture(t); store.upsert({ text: 'Project screen code ABC-17', scope: 'project', projectId: 'project-1' });
  assert.equal(store.recall({ query: 'screen code' }).records.length, 0);
  assert.equal(store.recall({ query: 'screen code', projectId: 'project-2' }).records.length, 0);
  assert.equal(store.recall({ query: 'screen code', projectId: 'project-1' }).records.length, 1);
});
test('retrieval is relevant, bounded to five notes and bounded in UTF-8 bytes', t => {
  const { store } = fixture(t);
  for (let i = 0; i < 12; i++) store.upsert({ text: `Screen preference ${i} ${'বাংলা '.repeat(65)}`, kind: 'preference' });
  const result = store.recall({ query: 'screen' }); assert.ok(result.records.length > 0 && result.records.length <= 5);
  assert.ok(Buffer.byteLength(JSON.stringify(result.records)) <= 3500);
  assert.equal(store.recall({ query: 'unrelated astronomy' }).records.length, 0);
  assert.equal(store.recall({ query: 'Do I prefer coffee?' }).records.length, 0);
});
test('duplicate, oversized, invalid source, invalid dates and missing edit IDs are rejected', t => {
  const { store } = fixture(t); store.upsert({ text: 'I prefer short replies' });
  for (const input of [{ text: 'i PREFER short replies' }, { text: 'a'.repeat(501) }, { text: 'note', source: { type: 'manual', messageId: '../escape' } }, { text: 'note', occurredAt: 'invalid' }, { text: 'note', id: 'unknown' }]) assert.throws(() => store.upsert(input));
  assert.equal(store.snapshot().records.length, 1);
});
test('editing, disabling and forgetting invalidate context and never resurrect a removed version', t => {
  const f = fixture(t), initial = f.store.upsert({ text: 'I prefer English', kind: 'preference' });
  const edited = f.store.upsert({ id: initial.records[0].id, text: 'I prefer Banglish' });
  assert.ok(edited.contextFloor > initial.contextFloor);
  const disabled = f.store.configure({ enabled: false }); assert.ok(disabled.contextFloor > edited.contextFloor); assert.equal(f.store.recall({ query: 'language' }).status, 'disabled');
  f.store.configure({ enabled: true }); f.store.remove(initial.records[0].id); f.store.close();
  const reopened = f.create(); assert.equal(reopened.snapshot().records.length, 0); assert.equal(reopened.recall({ query: 'English Banglish' }).records.length, 0); reopened.close();
});
test('encryption failure rolls back the write without reporting false success', t => {
  const f = fixture(t), saved = f.store.upsert({ text: 'Existing confirmed note' }); f.fail(true);
  assert.throws(() => f.store.upsert({ text: 'New uncommitted note' }), /previous state/);
  assert.equal(f.store.snapshot().revision, saved.revision); assert.equal(f.store.snapshot().records.length, 1);
  f.fail(false); f.store.close(); const reopened = f.create(); assert.equal(reopened.snapshot().records[0].text, 'Existing confirmed note'); reopened.close();
});
test('corrupt encrypted data fails closed and is not overwritten', t => {
  const f = fixture(t); f.store.upsert({ text: 'Keep this' }); f.store.close();
  const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(f.store.target); db.exec("UPDATE memory SET payload=x'010203'"); db.close();
  const before = fs.readFileSync(f.store.target), reopened = f.create(); assert.match(reopened.snapshot().error, /not replaced/);
  assert.throws(() => reopened.upsert({ text: 'Overwrite bad database' })); reopened.close(); assert.deepEqual(fs.readFileSync(f.store.target), before);
});
test('encryption unavailability does not create plaintext files', t => {
  const f = fixture(t), store = createCompanionMemory({ directory: path.join(f.directory, 'unavailable'), safeStorage: { isEncryptionAvailable: () => false } });
  assert.match(store.snapshot().error, /unavailable/); assert.throws(() => store.upsert({ text: 'Do not persist' })); assert.equal(fs.existsSync(store.target), false); store.close();
});
test('all memory IPC endpoints require the main window and its main frame', t => {
  const { store } = fixture(t), handlers = {}, events = [], frame = {}, sender = { mainFrame: frame, send: (...args) => events.push(args) }, main = { isDestroyed: () => false, webContents: sender };
  installCompanionMemory({ ipcMain: { handle: (name, handler) => handlers[name] = handler }, getMainWindow: () => main, store });
  for (const handler of Object.values(handlers)) { assert.throws(() => handler({ sender: {}, senderFrame: frame })); assert.throws(() => handler({ sender, senderFrame: {} })); }
  const good = { sender, senderFrame: frame }; handlers['orvix:memory-save'](good, { text: 'Confirmed note' });
  assert.equal(events.length, 1); assert.equal(events[0][0], 'orvix:memory-changed'); assert.equal(events[0][1].revision, 1);
  assert.equal(handlers['orvix:memory-list'](good).records.length, 1);
});
test('commands recognize explicit multilingual requests, not casual discussion or quoted screen content', () => {
  const { memoryCommand } = load('companionMemory.ts');
  for (const input of ['remember this: I prefer Banglish', 'mone rakho I prefer Banglish', 'মনে রাখো আমি ছোট উত্তর পছন্দ করি']) assert.equal(memoryCommand(input).action, 'remember', input);
  for (const input of ['show my memories', 'মেমোরি দেখাও', 'memories dekhao']) assert.equal(memoryCommand(input).action, 'show', input);
  for (const input of ['forget I prefer English', 'ভুলে যাও আমি ইংরেজি পছন্দ করি']) assert.equal(memoryCommand(input).action, 'forget', input);
  for (const input of ['Do you remember my name?', 'The screen says remember this', 'please explain memory', 'I forgot my password']) assert.equal(memoryCommand(input), null, input);
  assert.equal(memoryCommand('remember this').text, '');
  assert.equal(memoryCommand('remember this:').text, '');
  assert.equal(memoryCommand('remember this:I prefer Banglish').text, 'I prefer Banglish');
});
test('forget matching never chooses arbitrarily and stale history is excluded after context reset', () => {
  const { matchMemoryToForget, canRestoreMemoryHistory } = load('companionMemory.ts');
  const records = [{ id: '1', text: 'I prefer short English replies' }, { id: '2', text: 'I prefer short Banglish replies' }];
  assert.equal(matchMemoryToForget(records, 'short').length, 2); assert.equal(matchMemoryToForget(records, 'I prefer short Banglish replies')[0].id, '2');
  assert.equal(canRestoreMemoryHistory(undefined, 0), true); assert.equal(canRestoreMemoryHistory(undefined, 100), false); assert.equal(canRestoreMemoryHistory(100, 100), false); assert.equal(canRestoreMemoryHistory(101, 100), true);
});
test('memory recall traces omit private note contents', () => {
  const { thinkingTraceSnapshot } = load('thinkingDiagnostics.ts');
  const output = thinkingTraceSnapshot({ response: { privateMemory: true, status: 'ok', records: [{ text: 'PRIVATE-NOTE-9382' }] } });
  assert.equal(output.redacted, true); assert.equal(JSON.stringify(output).includes('PRIVATE-NOTE-9382'), false);
});
test('memory progress uses readable wording and reports empty or disabled recall honestly', () => {
  const { memoryContext } = load('companionMemory.ts');
  assert.match(memoryContext({status:'ok',records:[]}), /missing note is normal, not a system error/);
  const { describeThinkingToolStart, describeThinkingToolResult } = load('thinkingFlow.ts');
  assert.equal(describeThinkingToolStart('recall_companion_memories', {}, 'en'), 'Checking your saved memories...');
  assert.match(describeThinkingToolResult('recall_companion_memories', {status:'ok',records:[]}, 'en'), /No matching/);
  assert.match(describeThinkingToolResult('recall_companion_memories', {status:'disabled',records:[]}, 'en'), /disabled/);
  assert.match(describeThinkingToolResult('recall_companion_memories', {status:'ok',records:[{}]}, 'en'), /relevant saved/);
});
test('both profiles consume finalized memory voice commands and ignore partial command transcripts', () => {
  global.window = { setTimeout: () => 0, clearTimeout() {}, orvixDesktop: { logLive() {} } };
  for (const [file, klass, args] of [['simpleFastVoice.ts', 'SimpleFastVoiceSession', [[], null]], ['thinkingVoice.ts', 'ThinkingVoiceSession', ['LOW', [], null]]]) {
    let count = 0; const callbacks = { onStatus() {}, onTranscript() {}, onMemoryCommand() { count++; return true; } }; args[args.length - 1] = callbacks;
    const Voice = load(file)[klass], voice = new Voice(...args); voice.stopped = false;
    voice.session = { sendToolResponse() {}, sendClientContent() {}, sendRealtimeInput() {}, close() {} };
    const receive = message => file === 'simpleFastVoice.ts' ? voice.receive(message) : voice.handleMessage(message);
    receive({ serverContent: { inputTranscription: { text: 'remember this', finished: false } } }); assert.equal(count, 0);
    receive({ serverContent: { inputTranscription: { text: ': I prefer Banglish', finished: true }, interactionStatus: 'IN_PROGRESS' } });
    assert.equal(count, 1, file); assert.equal(voice.taskActive ?? voice.awaitingAnswer, false, file); voice.stop();
  }
});
test('early provider audio or tool calls cannot turn a partial memory command into a task', () => {
  global.window = { setTimeout: () => 0, clearTimeout() {}, orvixDesktop: { logLive() {} } };
  for (const [file, klass, args] of [['simpleFastVoice.ts', 'SimpleFastVoiceSession', [[], null]], ['thinkingVoice.ts', 'ThinkingVoiceSession', ['LOW', [], null]]]) {
    let count = 0, cancelled = 0;
    args[args.length - 1] = { onStatus() {}, onTranscript() {}, onMemoryCommand(text) { count++; assert.equal(text, 'remember this: I prefer short replies'); return true; } };
    const Voice = load(file)[klass], voice = new Voice(...args); voice.stopped = false;
    voice.session = { sendToolResponse() { cancelled++; }, sendClientContent() {}, sendRealtimeInput() {}, close() {} };
    const receive = message => file === 'simpleFastVoice.ts' ? voice.receive(message) : voice.handleMessage(message);
    receive({ serverContent: { inputTranscription: { text: 'remember this', finished: false }, modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    assert.equal(count, 0); assert.equal(voice.taskActive ?? voice.awaitingAnswer, false);
    receive({ toolCall: { functionCalls: [{ id: 'write-1', name: 'write_file', args: { content: 'wrong action' } }] }, serverContent: { outputTranscription: { text: 'I saved it' } } });
    assert.equal(cancelled, 1); assert.equal(count, 0);
    receive({ serverContent: { inputTranscription: { text: ': I prefer short replies', finished: true } } }); assert.equal(count, 1); voice.stop();
  }
});
test('note count is bounded and clearing also invalidates provider history', t => {
  const f = fixture(t);
  for (let i = 0; i < 250; i++) f.store.upsert({ text: `Confirmed fact ${i}` });
  assert.throws(() => f.store.upsert({ text: 'Overflow note' }), /full/);
  const before = f.store.snapshot(); const after = f.store.clear(); assert.equal(after.records.length, 0); assert.ok(after.contextFloor > before.contextFloor);
});
test('both profiles discard resumption handles and frames on stop', () => {
  global.window = { clearTimeout() {}, orvixDesktop: { logLive() {} } };
  for (const [file, klass, args] of [['simpleFastVoice.ts', 'SimpleFastVoiceSession', [[], { onStatus() {}, onTranscript() {} }]], ['thinkingVoice.ts', 'ThinkingVoiceSession', ['LOW', [], { onStatus() {}, onTranscript() {} }]]]) {
    const Voice = load(file)[klass], voice = new Voice(...args); voice.stopped = false; voice.resumeHandle = 'old-private-context'; voice.screenFrame = 'old-frame'; voice.screenSharing = true;
    voice.session = { close() {} }; voice.stop(); assert.equal(voice.resumeHandle, undefined); assert.equal(voice.screenFrame, undefined); assert.equal(voice.screenSharing, false);
  }
});
