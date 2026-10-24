const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

const project = path.join(__dirname, '..');
function loadTypeScript(entry) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(project, entry)], bundle: true, platform: 'node', format: 'cjs',
    write: false, external: ['@google/genai'], logLevel: 'silent',
  });
  const filename = path.join(project, 'scripts', '.thinking-flow-check.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(result.outputFiles[0].text, filename);
  return loaded.exports;
}

async function main() {
  const { describeThinkingToolStart, describeThinkingToolResult, buildThinkingSystemInstruction, isVoiceSystemError, failedTurnHistoryReply } = loadTypeScript('src/thinkingFlow.ts');
  assert.match(buildThinkingSystemInstruction('2026-09-28', 'Speak English.', ''), /EVERY user turn/);
  assert.match(describeThinkingToolStart('web_search', { query: 'Gemini releases' }), /Gemini releases/);
  assert.match(describeThinkingToolResult('web_search', { status: 'ok', count: 3 }, 'en'), /3 possible sources/);
  assert.match(describeThinkingToolResult('web_search', { status: 'no_results' }, 'en'), /no useful results/);
  assert.match(describeThinkingToolResult('read_file', { status: 'permission_denied' }, 'en'), /did not return a confirmed successful result/);
  assert.match(describeThinkingToolResult('search_files', { status: 'no_matches' }, 'en'), /no matches/);
  assert.equal(isVoiceSystemError('দুঃখিত, একটি সিস্টেম ত্রুটির কারণে এই মুহূর্তে সম্ভব হচ্ছে না।'), true);
  assert.equal(isVoiceSystemError('Unfortunately, a system error has occurred.'), true);
  assert.equal(isVoiceSystemError('লগস ছাড়া সুনির্দিষ্টভাবে বলা সম্ভব নয় সমস্যাটি ফাংশন কলিংয়ের নাকি প্রোভাইডার সাইডের।'), false);
  assert.equal(isVoiceSystemError('I am unable to determine the cause without diagnostic logs.'), false);
  assert.match(describeThinkingToolResult('list_directory', { status: 'ok', folderCount: 28, fileCount: 12, truncated: true }, 'en'), /28 folders and 12 files.*partial list/);
  assert.match(failedTurnHistoryReply, /will wait for a new request/);

  global.window = {
    setTimeout, clearTimeout,
    orvixDesktop: {
      logLive() {},
      searchWeb: async () => ({ status: 'ok', count: 2, results: [{ title: 'A' }, { title: 'B' }] }),
    },
  };
  const { ThinkingVoiceSession } = loadTypeScript('src/thinkingVoice.ts');
  const history = [];
  const transcripts = [];
  const progress = [];
  const statuses = [];
  const responses = [];
  const session = new ThinkingVoiceSession('LOW', history, {
    onStatus: status => statuses.push(status),
    onTranscript: value => transcripts.push({ ...value }),
    onProgress: value => progress.push(value),
  });
  session.stopped = false;
  session.sessionLanguage = 'en';
  session.session = {
    sendClientContent() {},
    sendToolResponse: value => responses.push(value),
    close() {},
  };
  session.sendText('Check Gemini releases');
  session.handleMessage({ serverContent: {
    outputTranscription: { text: 'I see what you mean. I am checking the releases.' },
    turnComplete: true, interactionStatus: 'IN_PROGRESS',
  } });
  assert.equal(transcripts.at(-1).phase, 'progress');
  const interimId = transcripts.at(-1).id;
  assert.equal(history.filter(item => item.role === 'assistant').length, 0);

  session.handleMessage({ toolCall: { functionCalls: [{ id: 'search-1', name: 'web_search', args: { query: 'Gemini releases' } }] } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(responses.length, 1);
  assert.ok(progress.some(item => item.phase === 'working' && item.text.includes('Gemini releases')));
  assert.ok(progress.some(item => item.phase === 'finding' && item.text.includes('2 possible sources')));

  session.handleMessage({ serverContent: {
    outputTranscription: { text: 'I found two leads. Here is the answer.' },
    turnComplete: true, interactionStatus: 'IDLE',
  } });
  assert.equal(transcripts.at(-1).phase, 'final');
  assert.notEqual(transcripts.at(-1).id, interimId);
  assert.equal(history.filter(item => item.role === 'assistant').length, 1);
  assert.equal(statuses.at(-1), 'listening');
  session.sendText('Try a second task');
  session.handleMessage({ serverContent: {
    outputTranscription: { text: 'I am sorry, but a system error occurred.' },
    turnComplete: true, interactionStatus: 'IDLE',
  } });
  assert.equal(statuses.at(-1), 'listening');
  assert.ok(progress.some(item => item.text.includes('without calling a tool')));
  session.session = { sendClientContent() {}, sendToolResponse() {}, close() {} };
  session.setStatus('listening');
  session.sendText('Try a third task');
  session.handleMessage({ serverContent: {
    outputTranscription: { text: 'দুঃখিত, একটি সিস্টেম ত্রুটির কারণে এই অনুরোধটি প্রক্রিয়াজাত করা সম্ভব হচ্ছে না।' },
    turnComplete: true, interactionStatus: 'IDLE',
  } });
  assert.equal(statuses.at(-1), 'listening');
  session.stop();
  console.log('Thinking flow checks passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
