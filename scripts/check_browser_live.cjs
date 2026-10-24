const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright-core');
const { createYoutubeControl } = require('../electron/youtube-control.cjs');

// All mutations use a disposable browser profile and local fixture server.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-browser-live-'));
const extension = path.join(root, 'extension');
fs.cpSync(path.join(__dirname, '../PC-Monitor-Test/extension'), extension, { recursive: true });
fs.mkdirSync(path.join(root, 'PCMonitorTest'));
const token = randomBytes(32).toString('hex');
fs.writeFileSync(path.join(root, 'PCMonitorTest/pairing-token.txt'), token);
process.env.LOCALAPPDATA = root;
let context, launches = 0, base;
fs.mkdirSync(path.join(root, 'profile', 'Default'), { recursive: true });
fs.writeFileSync(path.join(root, 'profile', 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: path.join(root, 'downloads'), prompt_for_download: false } }));
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/download')) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fixture.txt"' });
    res.end('orvix browser fixture'); return;
  }
  if (req.url.startsWith('/slow-download')) {
    const bytes = 2 * 1024 * 1024, offset = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
    res.writeHead(offset ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="slow-fixture.txt"', 'Content-Length': bytes - offset, 'Accept-Ranges': 'bytes', ...(offset ? { 'Content-Range': `bytes ${offset}-${bytes - 1}/${bytes}` } : {}) });
    let sent = offset;
    const timer = setInterval(() => { const count = Math.min(16384, bytes - sent); res.write(Buffer.alloc(count)); sent += count; if (sent >= bytes) { clearInterval(timer); res.end(); } }, 40);
    req.on('close', () => clearInterval(timer)); return;
  }
  if (req.url === '/audio.wav') {
    const samples = 8000 * 8, wav = Buffer.alloc(44 + samples * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0), end = Number(/bytes=\d+-(\d+)/.exec(req.headers.range || '')?.[1] || wav.length - 1);
    res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) }); res.end(wav.subarray(start, end + 1)); return;
  }
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/frame') { res.end('<title>Child frame</title><label>Frame field<input id="frame-input"></label>'); return; }
  if (req.url === '/spotify') { res.end('<title>Spotify</title><h1>Spotify fixture</h1>'); return; }
  if (req.url === '/other') { res.end('<title>Other</title><h1>Other fixture</h1>'); return; }
  res.end(`<title>Orvix form</title><style>body{font:20px Arial;padding:20px}button,input,select{margin:10px}#source,#destination{display:inline-block;padding:30px;border:1px solid}iframe{height:100px;width:500px}</style>
    <label>Name<input id="name"></label><label>Agree<input id="agree" type="checkbox"></label>
    <label>Choice<select id="choice"><option value="a">A</option><option value="b">B</option></select></label>
    <button id="submit" onclick="document.querySelector('#result').dataset.count=Number(document.querySelector('#result').dataset.count||0)+1;document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value">Save</button><p id="result">Pending</p>
    <button id="disabled" disabled>Disabled</button><button id="replace" onclick="document.querySelector('#replace').outerHTML='<button id=replacement>Replacement</button>'">Replace</button>
    <input type="file" aria-label="Upload fixture" style="display:none"><div id="shadow"></div><canvas width="100" height="50" aria-label="Visual target" onclick="document.querySelector('#result').textContent='Visual clicked'"></canvas><audio controls preload="auto" aria-label="Fixture media" src="/audio.wav"></audio>
    <iframe src="${base?.replace('127.0.0.1', 'localhost')}/frame"></iframe>
    <div id="source" role="button" aria-label="Drag source">Source</div><div id="destination" role="button" aria-label="Drag destination">Destination</div><p id="drag-result">Waiting for drag</p>
    <div role="button" aria-label="Native source" draggable="true" style="display:inline-block;padding:20px" ondragstart="event.dataTransfer.setData('text/plain','fixture')">Native source</div><div role="button" aria-label="Native destination" style="display:inline-block;padding:20px" ondragover="event.preventDefault()" ondrop="event.preventDefault();document.querySelector('#drag-result').textContent='Native dropped'">Native destination</div>
    <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>Shadow field<input id="shadow-input"></label>';
      let dragging=false;document.querySelector('#source').onmousedown=()=>dragging=true;document.querySelector('#destination').onmouseup=()=>{if(dragging)document.querySelector('#drag-result').textContent='Dragged';dragging=false};</script><div style="height:1500px">Scrollable area</div>`);
});
const control = createYoutubeControl({ port: 0, startChrome: async () => { await launch(); return { status: 'started' }; }, connectionTimeoutMs: 25000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await predicate()) return; await sleep(100); } throw new Error('Timed out waiting for fixture state.'); }
async function launch() {
  if (context) return;
  launches++;
  context = await chromium.launchPersistentContext(path.join(root, 'profile'), { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], acceptDownloads: true });
}
async function request(action, target, args, expect) {
  const started = Date.now();
  const result = await control.browserRequest('act', { action, ...(target ? { target } : {}), ...(args ? { args } : {}), ...(expect ? { expect } : {}) });
  console.log(`Fixture ${action}: ${result.status} (${Date.now() - started}ms)`);
  return result;
}
function ok(result) { assert.equal(result.status, 'ok', JSON.stringify(result.error || result)); assert.equal(result.verification.verified, true); return result; }
async function pageObserve(target, extra = {}) { const result = await control.browserRequest('observe', { scope: 'page', target, ...extra }); assert.equal(result.status, 'ok', JSON.stringify(result.error)); return result.observation; }
function element(observation, name) { const found = observation.elements.find(e => e.name === name); assert.ok(found, `Missing control ${name}`); return found.ref; }
(async () => {
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  await until(() => control.port);
  fs.writeFileSync(path.join(extension, 'youtube-background.js'), fs.readFileSync(path.join(extension, 'youtube-background.js'), 'utf8').replace('ws://127.0.0.1:49492', `ws://127.0.0.1:${control.port}`));
  assert.equal((await control.browserRequest('observe', { scope: 'browser' })).status, 'unavailable'); assert.equal(launches, 0);
  await launch();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => console.log('Companion:', message.text()));
  await worker.evaluate(token => chrome.storage.local.set({ token }), token);
  await worker.evaluate(() => connectYoutube());
  await until(() => control.browserStatus().connected);
  console.log('Paired disposable companion once.');
  const form = ok(await request('tab_open', null, { url: base })).resolvedTarget.ref;
  const spotify = ok(await request('tab_open', null, { url: `${base}/spotify` })).resolvedTarget.ref;
  ok(await request('tab_activate', 'Spotify'));
  assert.equal((await request('tab_activate', 'Chrome')).status, 'not_found');
  const duplicate = ok(await request('tab_duplicate', spotify)).resolvedTarget.ref;
  assert.equal((await request('tab_activate', 'Spotify')).status, 'needs_selection');
  ok(await request('tab_close', duplicate));
  assert.equal((await request('tab_activate', duplicate)).status, 'stale_target');
  ok(await request('tab_activate', form));
  ok(await request('tab_activate', 'active'));
  ok(await request('tab_mute', form, { enabled: true })); ok(await request('tab_mute', form, { enabled: false }));
  ok(await request('tab_pin', form, { enabled: true })); ok(await request('tab_pin', form, { enabled: false }));
  ok(await request('tab_move', spotify, { index: 0 }));
  const group = ok(await request('group_create', null, { tabRefs: [form, spotify], title: 'Fixture', color: 'blue' })).resolvedTarget.ref;
  ok(await request('group_update', group, { title: 'Updated', collapsed: true })); ok(await request('group_update', group, { collapsed: false }));
  ok(await request('group_remove', null, { tabRefs: [form, spotify] }));
  let obs = await pageObserve(form);
  ok(await request('type', element(obs, 'Name'), { text: 'Orvix fixture' }));
  ok(await request('check', form, { ref: element(obs, 'Agree'), enabled: true }));
  ok(await request('select', form, { ref: element(obs, 'Choice'), value: 'B' }));
  ok(await request('click', form, { ref: element(obs, 'Save') }, { kind: 'text', value: 'Saved Orvix fixture' }));
  ok(await request('key', form, { ref: element(obs, 'Save'), key: 'Enter' }, { kind: 'text', value: 'Saved Orvix fixture' }));
  const count = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => document.querySelector('#result').dataset.count }))[0].result, Number(form.split(':').at(-1)));
  assert.equal(count, '2', 'A key press must not click its target first or submit twice');
  assert.equal((await request('click', form, { ref: element(obs, 'Disabled') })).status, 'failed');
  const oldElement = element(obs, 'Replace');
  assert.equal((await request('click', form, { ref: oldElement })).status, 'dispatched');
  assert.equal((await request('click', form, { ref: oldElement })).status, 'stale_target');
  obs = await pageObserve(form);
  ok(await request('type', form, { ref: element(obs, 'Shadow field'), text: 'Shadow works' }));
  ok(await request('type', form, { ref: element(obs, 'Frame field'), text: 'Frame works' }));
  const file = path.join(root, 'upload.txt'); fs.writeFileSync(file, 'fixture');
  ok(await request('upload', form, { ref: element(obs, 'Upload fixture'), files: [file] }));
  ok(await request('click', form, { ref: element(obs, 'Visual target'), x: 20, y: 20 }, { kind: 'text', value: 'Visual clicked' }));
  const media = element(obs, 'Fixture media');
  ok(await request('media_play', media)); ok(await request('media_pause', media)); ok(await request('media_volume', media, { volume: .4 })); ok(await request('media_mute', media, { enabled: true })); ok(await request('media_seek', media, { seconds: 2 }));
  ok(await request('drag', form, { ref: element(obs, 'Drag source'), destinationRef: element(obs, 'Drag destination') }, { kind: 'text', value: 'Dragged' }));
  ok(await request('drag', form, { ref: element(obs, 'Native source'), destinationRef: element(obs, 'Native destination') }, { kind: 'text', value: 'Native dropped' }));
  ok(await request('scroll', form, { y: 600 }));
  const cancellable = control.browserRequest('act', { action: 'wait', target: form, expect: { kind: 'text', value: 'NEVER PRESENT' }, requestId: 'cancel-wait', args: { timeoutMs: 10000 } });
  const queued = control.browserRequest('act', { action: 'tab_open', args: { url: `${base}/other` }, requestId: 'cancel-queued' });
  await sleep(100); control.cancelBrowser(['cancel-wait', 'cancel-queued']);
  assert.equal((await cancellable).status, 'cancelled'); assert.equal((await queued).status, 'cancelled');
  await worker.evaluate(async () => { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); await chrome.debugger.detach({ tabId: tabs[0].id }).catch(() => {}); });
  const image = await pageObserve(form, { screenshot: true }); assert.equal(image.screenshot.mimeType, 'image/jpeg'); assert.ok(image.screenshot.data.length < 524288);
  const bookmark = ok(await request('bookmark_create', null, { title: 'Fixture', url: base })).resolvedTarget.ref;
  ok(await request('bookmark_update', bookmark, { title: 'Fixture updated' }));
  assert.ok((await control.browserRequest('observe', { scope: 'bookmarks', query: 'Fixture updated' })).observation.items.some(e => e.ref === bookmark));
  ok(await request('bookmark_delete', bookmark));
  ok(await request('navigate', form, { url: `${base}/other` })); ok(await request('back', form)); ok(await request('forward', form)); ok(await request('reload', form)); ok(await request('zoom', form, { factor: 1.25 }));
  const history = await control.browserRequest('observe', { scope: 'history', query: `${base}/other` }); assert.ok(history.observation.items.length); ok(await request('history_delete', history.observation.items[0].ref));
  const download = ok(await request('download_start', null, { url: `${base}/download` })).resolvedTarget.ref;
  await until(async () => (await control.browserRequest('observe', { scope: 'downloads' })).observation.items.some(d => d.ref === download && d.state === 'complete'));
  const slow = ok(await request('download_start', null, { url: `${base}/slow-download` })).resolvedTarget.ref;
  ok(await request('download_pause', slow)); ok(await request('download_resume', slow)); ok(await request('download_cancel', slow));
  const win = ok(await request('window_create', null, { url: `${base}/other` })).resolvedTarget.ref;
  ok(await request('window_resize', win, { width: 900, height: 700 })); ok(await request('window_minimize', win)); ok(await request('window_focus', win)); ok(await request('window_maximize', win)); ok(await request('window_restore', win));
  const movedGroup = ok(await request('group_create', null, { tabRefs: [form], title: 'Move fixture' })).resolvedTarget.ref;
  ok(await request('group_add', null, { tabRefs: [spotify], groupRef: movedGroup }));
  ok(await request('group_move', movedGroup, { windowRef: win, index: -1 }));
  const beforeClose = await control.browserRequest('observe', { scope: 'browser' }), anotherWindow = beforeClose.observation.windows.find(w => w.ref !== win).ref;
  ok(await request('group_move', movedGroup, { windowRef: anotherWindow, index: 0 }));
  ok(await request('group_remove', null, { tabRefs: [form, spotify] }));
  ok(await request('tab_activate', form)); ok(await request('tab_activate', 'next'));
  ok(await request('window_close', win));
  await request('tab_close', spotify);
  const closed = await control.browserRequest('observe', { scope: 'sessions' }); assert.ok(closed.observation.items.length); ok(await request('tab_restore', closed.observation.items[0].ref));
  await context.close(); context = null; await until(() => !control.browserStatus().connected);
  const reopened = ok(await request('tab_open', null, { url: `${base}/spotify` })); assert.equal(launches, 2);
  assert.equal((await request('tab_activate', form)).status, 'stale_target'); assert.ok(reopened.resolvedTarget.ref);
  const newWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await newWorker.evaluate(() => youtubeSocket.close()); await until(() => !control.browserStatus().connected);
  await until(() => control.browserStatus().connected); assert.equal(launches, 2);
  if (process.argv.includes('--youtube')) {
    await context.close(); context = null; await until(() => !control.browserStatus().connected);
    let playback = await request('youtube_search', null, { query: 'Ed Sheeran Shape of You Official Music Video' });
    if (playback.status === 'needs_selection') playback = await request('youtube_select', null, { candidateId: playback.options[0].candidateId });
    ok(playback); assert.equal(playback.playbackState, 'playing'); assert.equal(launches, 3);
    ok(await request('youtube_pause')); ok(await request('youtube_resume'));
    console.log('Actual YouTube playback passed after full browser shutdown using saved pairing.');
  }
  if (process.argv.includes('--voice')) await checkVoice();
  console.log('Live browser checks passed: exact targets, tabs/windows/groups, forms, shadow DOM, cross-origin frames, replacement, drag, upload, screenshot, browser data and saved-pairing automatic startup.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await context?.close(); control.close(); await new Promise(resolve => server.close(resolve));
  if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
});

async function checkVoice() {
  const browser = await control.browserRequest('observe', { scope: 'browser', query: 'Spotify' });
  if (!browser.observation.tabs.some(tab => tab.title === 'Spotify')) ok(await request('tab_open', null, { url: `${base}/spotify` }));
  const { GoogleGenAI, Modality } = require('@google/genai');
  const { loadLiveEnv } = require('../electron/live-env.cjs');
  const { createLiveToken } = require('../electron/live-auth.cjs');
  const Module = require('node:module'), esbuild = require('esbuild');
  const compiled = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/fastFlow.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const loaded = new Module(path.join(__dirname, '.browser-live-voice.cjs'), module); loaded.filename = path.join(__dirname, '.browser-live-voice.cjs'); loaded.paths = module.paths; loaded._compile(compiled.outputFiles[0].text, loaded.filename);
  loadLiveEnv(path.join(__dirname, '..'));
  const { token: liveToken, model } = await createLiveToken('Fast', 'LOW');
  const ai = new GoogleGenAI({ apiKey: liveToken, httpOptions: { apiVersion: 'v1alpha' } });
  let live, active, pending = 0;
  const imageResults = [];
  try {
    live = await ai.live.connect({ model, config: { responseModalities: [Modality.AUDIO], outputAudioTranscription: {},
      systemInstruction: loaded.exports.buildFastSystemInstruction(new Date().toISOString().slice(0, 10), 'Speak English for this browser acceptance test.', '', ''),
      tools: [{ functionDeclarations: require('../shared/browser-tools.json').functionDeclarations }] }, callbacks: {
      onopen() {}, onerror: error => active?.reject(new Error(error.message || 'Live browser test failed')), onclose: event => active?.reject(new Error(`Live browser test closed (${event.code})`)),
      onmessage: message => {
        const calls = message.toolCall?.functionCalls;
        if (calls?.length) {
          pending++;
          void (async () => {
            const responses = [];
            for (const call of calls) {
              const result = await control.browserRequest(call.name === 'browser_observe' ? 'observe' : 'act', { ...call.args, requestId: call.id });
              const screenshot = result.observation?.screenshot;
              if (screenshot?.data) { const { data, ...metadata } = screenshot; live.sendRealtimeInput({ video: { data, mimeType: screenshot.mimeType } }); result.observation.screenshot = { ...metadata, delivered: true }; imageResults.push(true); }
              active?.calls.push({ name: call.name, action: call.args?.action, status: result.status, verification: result.verification?.verified,
                formSaved: result.observation?.text?.includes('Saved Voice fixture') && result.observation?.elements?.some(e => e.name === 'Name' && e.value === 'Voice fixture') && result.observation?.elements?.some(e => e.name === 'Agree' && e.checked === true) && result.observation?.elements?.some(e => e.name === 'Choice' && e.value === 'b') });
              responses.push({ id: call.id, name: call.name, response: result });
            }
            live.sendToolResponse({ functionResponses: responses });
          })().catch(error => active?.reject(error)).finally(() => pending--);
        }
        if (message.serverContent?.turnComplete && pending === 0 && active?.calls.length && active.predicate(active.calls)) active.resolve();
      }
    } });
    const scenarios = [
      ['Open a new tab.', calls => calls.some(c => c.action === 'tab_open' && c.status === 'ok')],
      ['Go to YouTube.', calls => calls.some(c => ['navigate', 'tab_open'].includes(c.action) && c.status === 'ok')],
      ['Switch to the Spotify tab.', calls => calls.some(c => c.action === 'tab_activate' && c.status === 'ok')],
      ['Unmute this tab.', calls => calls.some(c => c.action === 'tab_mute' && c.status === 'ok')],
      [`Open ${base} in a new tab. Fill Name with Voice fixture, check Agree, select B in Choice, then click Save and verify the confirmation text.`, calls => calls.some(c => c.formSaved)],
      ['Observe the current page with browser_observe(scope=page, screenshot=true), then tell me the page title.', calls => calls.some(c => c.name === 'browser_observe' && c.status === 'ok') && imageResults.length > 0]
    ];
    for (let i = 0; i < scenarios.length; i++) {
      const [text, predicate] = scenarios[i]; let timer;
      const settled = new Promise((resolve, reject) => { active = { resolve, reject, calls: [], predicate }; timer = setTimeout(() => reject(new Error(`Live voice scenario ${i + 1} timed out: ${JSON.stringify(active.calls)}`)), 90_000); });
      try { live.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }); await settled; console.log(`Fast live scenario ${i + 1} passed: ${active.calls.map(c => `${c.action || c.name}:${c.status}`).join(', ')}`); }
      finally { clearTimeout(timer); active = null; }
    }
    console.log('Configured Fast live model passed browser commands, verified form workflow and screenshot input.');
  } finally { live?.close(); }
}
