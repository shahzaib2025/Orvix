// Real disposable Chromium + production Fast handler. --model adds Gemini Live
// text-input/audio-output checks. No microphone, audible playback, or user profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright-core');
const { createYoutubeControl } = require('../electron/youtube-control.cjs');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-fast-acceptance-'));
const extension = path.join(root, 'extension');
fs.cpSync(path.join(project, 'PC-Monitor-Test/extension'), extension, { recursive: true });
fs.mkdirSync(path.join(root, 'PCMonitorTest'));
const token = randomBytes(32).toString('hex');
fs.writeFileSync(path.join(root, 'PCMonitorTest/pairing-token.txt'), token);
process.env.LOCALAPPDATA = root;
const report = { startedAt: new Date().toISOString(), browser: 'disposable headless Chromium', microphone: false, checks: [], modelTurns: [] };
const conversation = process.argv.includes('--conversation');
const reportFile = path.join(__dirname, `check_fast_browser_acceptance${conversation ? '.conversation' : process.argv.includes('--youtube') ? '.youtube' : ''}.report.json`);
let context, currentModelTurn, liveVoice, tabFixtureServer;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await sleep(100); } throw new Error('Acceptance wait timed out'); }
const control = createYoutubeControl({ port: 0, startChrome: async () => { throw new Error('Unexpected browser launch'); } });
function pass(name, details = {}) { report.checks.push({ name, status: 'passed', ...details }); console.log('PASS ' + name); }
const built = esbuild.buildSync({ entryPoints: [path.join(project, 'src/fastVoice.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.fast-browser-acceptance.cjs'), module);
loaded.filename = path.join(__dirname, '.fast-browser-acceptance.cjs'); loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { FastVoiceSession } = loaded.exports;
global.window = { setTimeout, clearTimeout, orvixDesktop: {
  getPcSnapshot: async () => null,
  browserObserve: async input => {
    const result = await control.browserRequest('observe', input);
    currentModelTurn?.observations.push({ scope: input.scope, status: result.status, url: result.observation?.url });
    return result;
  },
  browserAct: async input => {
    const result = await control.browserRequest('act', input);
    currentModelTurn?.actions.push({ action: input.action, status: result.status, verified: result.verification?.verified, completionUnknown: result.completionUnknown });
    return result;
  },
  cancelBrowserRequests: ids => control.cancelBrowser(ids),
  logLive: (kind, message, details) => {
    if (kind === 'warn' || kind === 'error') currentModelTurn?.diagnostics.push({ kind, message });
    if (message === '[FastVoice] Tool call completed') currentModelTurn?.toolCompletions.push({ name: details.name, status: details.status });
  },
} };
function googleHtml(url) {
  const q = new URL(url).searchParams.get('q');
  return '<title>Google</title><form action="/search"><label>Search<input type="search" name="q" aria-label="Search"></label><button>Search</button></form>' + (q ? '<h1 id="results">Search results</h1>' : '');
}
function youtubeHtml(url) {
  const query = new URL(url).searchParams.get('search_query') || 'OLD';
  // Previous implementation can submit this form using SPA navigation, while
  // old rows remain visible for 650 ms. Production fix navigates a new document.
  return `<title>YouTube</title><style>ytd-search,ytd-video-renderer{display:block;padding:8px}</style>
    <form><input id="search" name="search_query"><button id="search-icon-legacy">Search</button></form><ytd-search></ytd-search>
    <script>
    const initial=${JSON.stringify(query).replace(/</g, '\\u003c')};
    function render(query){document.querySelector('ytd-search').innerHTML=[1,2].map(i=>'<ytd-video-renderer><a id="video-title" href="/watch?v=shared'+i+'" title="'+query+' fixture '+i+'">'+query+' fixture '+i+'</a><div id="channel-name">Test channel</div></ytd-video-renderer>').join('');}
    setTimeout(()=>render(initial),500);
    document.querySelector('form').onsubmit=e=>{e.preventDefault();const query=document.querySelector('input').value;history.pushState({},'', '/results?search_query='+encodeURIComponent(query));setTimeout(()=>render(query),650);};
    </script>`;
}
async function runModelTurn(voice, prompt, expected = () => voice.browserConfirmationDelivered && voice.browserOutcomes.has('key')) {
  const turn = { prompt, actions: [], observations: [], toolCalls: [], toolCompletions: [], sourceReads: [], diagnostics: [], playedAudioChunks: 0, rawTranscription: [], receivedAudioChunks: 0, admittedConfirmationChunks: 0, startedAt: new Date().toISOString(), expected };
  report.modelTurns.push(turn); currentModelTurn = turn;
  let timer;
  try {
    const completed = new Promise((resolve, reject) => {
      turn.finish = resolve; turn.fail = reject;
      timer = setTimeout(() => reject(new Error('Gemini tool conversation turn exceeded its time limit')), conversation ? 90000 : 60000);
    });
    voice.sendText(prompt);
    const answer = await completed;
    turn.answer = answer; turn.status = 'completed';
    assert.ok(turn.toolCalls.length > 0, 'Every conversation message must trigger a real model function call');
    return turn;
  } finally { clearTimeout(timer); delete turn.finish; delete turn.fail; delete turn.expected; currentModelTurn = null; }
}
(async () => {
  await until(() => control.port);
  const filename = path.join(extension, 'youtube-background.js');
  fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace('ws://127.0.0.1:49492', `ws://127.0.0.1:${control.port}`));
  context = await chromium.launchPersistentContext(path.join(root, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--mute-audio'] });
  await context.route('https://www.google.com/**', route => route.fulfill({ contentType: 'text/html', body: googleHtml(route.request().url()) }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: youtubeHtml(route.request().url()) }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => chrome.storage.local.set({ token }), token);
  await worker.evaluate(() => connectYoutube());
  await until(() => control.browserStatus().connected);
  const googlePage = await context.newPage();
  await googlePage.goto('https://www.google.com/');
  assert.equal(await googlePage.locator('input[name=q]').count(), 1, 'Google route fixture must be installed before navigation');
  let tabRef;
  await until(async () => {
    const inventory = await control.browserRequest('observe', { scope: 'browser' });
    tabRef = inventory.observation?.tabs?.find(tab => tab.url === 'https://www.google.com/')?.ref;
    return tabRef;
  });
  const rejected = await control.browserRequest('act', { action: 'key', target: tabRef, args: { key: 'Enter' } });
  assert.equal(rejected.status, 'invalid_target_type'); assert.equal(rejected.completionUnknown, false);
  pass('Real bridge rejects a tab-targeted Enter before input');
  const sharedWork=require('../electron/fast-work.cjs').createFastWork({browser:{observe:input=>control.browserRequest('observe',input),act:input=>control.browserRequest('act',input)}});
  const ledgerTask=sharedWork.update({text:'Navigate the current page then open a new tab'});
  assert.equal(sharedWork.registerPlan(ledgerTask.id,{revision:ledgerTask.revision,requirements:[{id:'navigation',text:'Expected current URL',kind:'outcome'},{id:'new-tab',text:'Expected new tab URL',kind:'outcome'}],steps:[{id:'navigate',title:'Navigate',tool:'browser_act',action:'navigate',requirementIds:['navigation'],dependsOn:[],expected:'Exact expected URL'},{id:'tab-open',title:'Open tab',tool:'browser_act',action:'tab_open',requirementIds:['new-tab'],dependsOn:['navigate'],expected:'Exact new tab URL'}]}).status,'ok');
  const ledgerUrl='https://www.google.com/search?q=ledger';
  const navigated=await sharedWork.execute(ledgerTask.id,'browser_act',{stepId:'navigate',revision:ledgerTask.revision,action:'navigate',target:tabRef,args:{url:ledgerUrl},expect:{kind:'url',value:ledgerUrl}});
  assert.equal(navigated.status,'ok');assert.equal(navigated.verification.verified,true);assert.equal(googlePage.url(),ledgerUrl);
  // Extension-created tabs can begin navigation before Playwright attaches its
  // route interception. Serve this outcome directly instead of racing that hook.
  tabFixtureServer=require('node:http').createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Verified new tab</title><h1>Verified new tab</h1>');});
  await new Promise(resolve=>tabFixtureServer.listen(0,'127.0.0.1',resolve));
  const newTabUrl=`http://127.0.0.1:${tabFixtureServer.address().port}/new-tab`;
  const opened=await sharedWork.execute(ledgerTask.id,'browser_act',{stepId:'tab-open',revision:ledgerTask.revision,action:'tab_open',args:{url:newTabUrl},expect:{kind:'url',value:newTabUrl}});
  report.sharedController={navigate:navigated.status,tabOpen:opened.status,verification:opened.verification,observation:opened.observation};
  assert.equal(opened.status,'ok');assert.equal(opened.verification.verified,true);assert.ok(context.pages().some(page=>page.url()===newTabUrl));
  pass('Shared Fast controller strips ledger metadata: real Chrome navigation and tab_open independently verified');
  await control.browserRequest('act',{action:'tab_activate',target:tabRef});
  const finals = [], audio = [];
  const voice = new FastVoiceSession([], { onStatus() {}, onTranscript: value => finals.push(value) });
  voice.stopped = false; voice.sessionLanguage = 'en'; voice.session = { sendToolResponse() {}, sendClientContent() {} };
  voice.audioEngine.clearPlayback = () => {}; voice.audioEngine.playAudio = data => audio.push(data);
  await voice.handleToolCalls([{ id: 'bad-enter', name: 'browser_act', args: { action: 'key', target: tabRef, args: { key: 'Enter' } } }]);
  await voice.handleToolCalls([{ id: 'observe-after-failure', name: 'browser_observe', args: { scope: 'page', target: tabRef } }]);
  voice.handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'WRONG_CONFIRMATION', mimeType: 'audio/pcm' } }] } } });
  voice.handleMessage({ serverContent: { outputTranscription: { text: 'I pressed Enter; results are showing.' }, turnComplete: true } });
  assert.equal(audio.length, 0); assert.match(finals.find(value => value.phase === 'final').text, /not completed/);
  pass('Actual failed Enter + successful inspection cannot admit synthetic success audio');
  const typed = await voice.invokeBrowser('browser_act', { action: 'type', target: tabRef, args: { text: 'open code' } }, 'actual-type');
  if (typed.status !== 'ok') {
    const inspected = await control.browserRequest('observe', { scope: 'page', target: tabRef });
    report.recoveryDiagnostic = { url: inspected.observation?.url, inputs: inspected.observation?.elements?.filter(element => element.editable).map(element => ({ name: element.name, type: element.type, disabled: element.disabled, visible: element.visible })) };
    console.log('RECOVERY ' + JSON.stringify(report.recoveryDiagnostic));
  }
  assert.equal(typed.status, 'ok');
  const entered = await voice.invokeBrowser('browser_act', { action: 'key', target: tabRef, args: { key: 'Enter' }, expect: { kind: 'url', value: 'https://www.google.com/search?q=open+code' } }, 'actual-enter');
  assert.equal(entered.status, 'ok'); assert.equal(entered.verification.verified, true);
  pass('Production Fast handler recovers Google input and verifies Enter submission');
  const youtubePage = await context.newPage();
  await youtubePage.goto('https://www.youtube.com/results?search_query=OLD');
  await youtubePage.waitForSelector('ytd-video-renderer');
  const first = await control.browserRequest('act', { action: 'youtube_search', args: { query: 'Bangla Gaan' } });
  assert.equal(first.status, 'needs_selection'); assert.ok(first.options.every(option => option.title.startsWith('Bangla Gaan')));
  const second = await control.browserRequest('act', { action: 'youtube_search', args: { query: 'Bangla Lofi Song' } });
  assert.equal(second.status, 'needs_selection'); assert.ok(second.options.every(option => option.title.startsWith('Bangla Lofi Song')));
  assert.notEqual(first.documentId, second.documentId);
  assert.equal(second.options[0].title, 'Bangla Lofi Song fixture 1');
  const oldChoice = await control.browserRequest('act', { action: 'youtube_select', args: { candidateId: first.options[0].candidateId } });
  assert.equal(oldChoice.status, 'invalid_request');
  pass('Real Chrome delayed YouTube DOM: fresh queries, shared video IDs, page order, expired choices');
  if (process.argv.includes('--youtube')) {
    await context.unroute('https://www.youtube.com/**');
    await worker.evaluate(() => {
      const original = pageMessage;
      globalThis.acceptanceSnapshots = [];
      pageMessage = async (...args) => {
        const result = await original(...args);
        if (args[1] === 'youtube-results' && result?.ready && result.results?.length) {
          globalThis.acceptanceSnapshots.push({ query: result.query, url: result.url, documentId: args[3], titles: result.results.map(item => item.title) });
        }
        return result;
      };
    });
    report.realYoutube = [];
    for (const query of ['Bangla Gaan', 'Bangla Lofi Song']) {
      const started = Date.now();
      const result = await control.browserRequest('act', { action: 'youtube_search', args: { query } });
      const snapshot = await worker.evaluate(() => globalThis.acceptanceSnapshots.at(-1));
      report.realYoutube.push({ query, status: result.status, elapsedMs: Date.now() - started, snapshot, message: result.message });
      if (!['ok', 'needs_selection', 'autoplay_blocked'].includes(result.status)) {
        report.publicSiteDiagnostic = await Promise.all(context.pages().map(async page => ({ url: page.url(), title: await page.title().catch(() => ''), body: await page.locator('body').innerText({ timeout: 2000 }).then(text => text.slice(0, 1500)).catch(() => '') })));
      }
      assert.ok(['ok', 'needs_selection', 'autoplay_blocked'].includes(result.status), 'Public YouTube must return fresh candidates or play a clearly ranked candidate');
      assert.equal(snapshot?.query, query);
      assert.equal(new URL(snapshot.url).searchParams.get('search_query'), query);
    }
    assert.notEqual(report.realYoutube[0].snapshot.documentId, report.realYoutube[1].snapshot.documentId);
    pass('Public YouTube consecutive Bangla queries read fresh documents and result lists');
  }
  if (process.argv.includes('--model') || conversation) {
    require('../electron/live-env.cjs').loadLiveEnv(project);
    window.orvixDesktop.createLiveToken = require('../electron/live-auth.cjs').createLiveToken;
    if (conversation) {
      const bridge = window.orvixDesktop, listeners = new Set();
      const work = require('../electron/fast-work.cjs').createFastWork({
        browser: { observe: input => bridge.browserObserve(input), act: input => bridge.browserAct(input), cancel: ids => control.cancelBrowser(ids) },
        desktop: {}, emit: event => { for (const listener of listeners) listener(event); },
      });
      bridge.updateFastTask = async input => work.update(input);
      bridge.cancelFastTask = id => work.cancel(id);
      bridge.getFastTask = async id => work.task(id);
      bridge.getFastSettings = async () => work.settings();
      bridge.onFastWorkEvent = listener => { listeners.add(listener); return () => listeners.delete(listener); };
      bridge.executeFast = (id, name, input) => name === 'work_browser' ? work.workflow(id, input) : work.execute(id, name, input);
      const { searchWeb, readSearchResultPage } = require('../electron/search.cjs');
      bridge.searchWeb = searchWeb;
      bridge.readSearchPage = async input => {
        const page = await readSearchResultPage(input);
        currentModelTurn?.sourceReads.push({ url: input.url, status: page.status, source: page.source, contentChars: (page.content || '').length });
        return page;
      };
    }
    liveVoice = new FastVoiceSession([], {
      onStatus: (status, detail) => { if (status === 'error') currentModelTurn?.fail?.(new Error(detail)); },
      onTranscript: value => {
        if (value.phase !== 'final' || value.delivery !== 'complete' || !currentModelTurn) return;
        // Native Live can end an acknowledgement segment before an async
        // observation completes. Wait for the keyboard workflow, not that segment.
        if (currentModelTurn.expected?.(currentModelTurn, value.text)) currentModelTurn.finish?.(value.text);
        else (currentModelTurn.intermediateFinals ||= []).push(value.text);
      },
    });
    liveVoice.audioEngine.ensureContext = async () => {};
    liveVoice.audioEngine.playAudio = () => { if (currentModelTurn) { currentModelTurn.playedAudioChunks++; if (liveVoice.browserConfirmationDelivered) currentModelTurn.admittedConfirmationChunks++; } };
    liveVoice.audioEngine.clearPlayback = () => {};
    liveVoice.sessionLanguage = 'en';
    const handleMessage = liveVoice.handleMessage.bind(liveVoice);
    liveVoice.handleMessage = message => {
      if (currentModelTurn) for (const call of message.toolCall?.functionCalls || []) currentModelTurn.toolCalls.push({ name: call.name, action: call.args?.action, operation: call.args?.operation, scope: call.args?.scope });
      if (currentModelTurn && message.serverContent) {
        const content = message.serverContent;
        if (content.outputTranscription?.text) currentModelTurn.rawTranscription.push(content.outputTranscription.text);
        currentModelTurn.receivedAudioChunks += (content.modelTurn?.parts || []).filter(part => part.inlineData?.mimeType?.startsWith('audio/pcm')).length;
      }
      handleMessage(message);
    };
    await liveVoice.start(false);
    await control.browserRequest('act', { action: 'tab_activate', target: tabRef });
    await control.browserRequest('act', { action: 'navigate', target: tabRef, args: { url: 'https://www.google.com/' } });
    if (conversation) {
      report.scope = 'Real Gemini Live, production Fast handler and work executor, disposable Chromium with controlled Google/YouTube pages, real public web search/page reads. Text input; audio chunks counted, not audibly played.';
      const inspected = await runModelTurn(liveVoice,
        'Reply in English. Use browser_observe to inspect the current Google tab and tell me its URL and the visible search input label. Do not answer from memory.',
        turn => turn.observations.some(item => item.status === 'ok' && item.url?.startsWith('https://www.google.com')));
      assert.match(inspected.answer, /google\.com/i);
      pass('Conversation 1: real model calls browser observation and answers from the current page');
      const searched = await runModelTurn(liveVoice,
        'Reply in English. Search Google for Africanized honey bee facts using work_browser. Verify the requested query in the resulting URL, then tell me what finished.',
        turn => turn.actions.some(item => item.action === 'search' && item.status === 'ok' && item.verified === true));
      assert.equal(new URL(googlePage.url()).searchParams.get('q'), 'Africanized honey bee facts');
      assert.equal(searched.answer, 'The requested search page opened.', 'Verified search must replace the pending status in its acknowledgement');
      assert.ok(searched.admittedConfirmationChunks > 0, 'Verified action acknowledgement must contain admitted Live audio');
      pass('Conversation 2: real model calls work_browser, verifies the query and finishes acknowledgement');
      const facts = await runModelTurn(liveVoice,
        'Reply in Bangla. Use web_search to find three facts about Africanized honey bees, then read one relevant source with read_web_page and give me the three facts with that source URL. Do not just say that you will search.',
        (turn, answer) => turn.toolCalls.some(call => call.name === 'web_search') && turn.sourceReads.some(page => page.status === 'ok') && answer.length >= 150 && /https?:\/\//.test(answer));
      assert.ok(facts.playedAudioChunks > 0);assert.match(facts.answer, /[\u0980-\u09ff]/);
      pass('Conversation 3: real public search and page retrieval finish a substantive Bangla answer');
      const rechecked = await runModelTurn(liveVoice,
        'Reply in Bangla. Use browser_observe again to inspect the Google tab and confirm which search query is currently open.',
        turn => turn.observations.some(item => item.status === 'ok' && item.url?.includes('Africanized')));
      assert.match(rechecked.answer, /Africanized|আফ্রিক|হানি|মৌমাছি/i);
      pass('Conversation 4: another real tool call rechecks browser state within the same live conversation');
    } else {
      const turn = await runModelTurn(liveVoice, 'Answer only in English. On the Google tab, type open code in its Search box, then press Enter. Verify the URL https://www.google.com/search?q=open+code. Use the page control references.');
      assert.ok(turn.actions.some(action => action.action === 'type' && action.status === 'ok'));
      assert.ok(turn.actions.some(action => action.action === 'key' && action.status === 'ok'));
      assert.match(turn.answer, /verified/);
      pass('Gemini Live using production Fast handler completes verified type + Enter', { playedAudioChunks: turn.playedAudioChunks, admittedConfirmationChunks: turn.admittedConfirmationChunks });
    }
  }
  report.status = 'passed';
})().catch(error => { report.status = 'failed'; report.error = error.message; console.error(error); process.exitCode = 1; }).finally(async () => {
  liveVoice?.stop();
  await context?.close(); control.close();
  if(tabFixtureServer)await new Promise(resolve=>tabFixtureServer.close(resolve));
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  const absoluteRoot = path.resolve(root), temp = path.resolve(os.tmpdir());
  if (path.dirname(absoluteRoot) === temp && path.basename(absoluteRoot).startsWith('orvix-fast-acceptance-')) fs.rmSync(absoluteRoot, { recursive: true, force: true });
});
