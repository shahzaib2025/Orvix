const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'PC-Monitor-Test', 'extension', 'youtube-background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'PC-Monitor-Test', 'extension', 'manifest.json'), 'utf8'));

function environment({ existingYoutube = true, minimized = false, results = [], blocked = false, discarded = false, scriptMissingUntilReload = false, delayedDocument = false, delayedResults = false, canonicalize = false, changeQueryDuringRead = false, delayedInitialDocument = false } = {}) {
  let nextId = 10;
  let contentScriptReady = !scriptMissingUntilReload;
  const tabs = [{ id: 1, windowId: 1, url: 'https://example.com/', active: !existingYoutube || minimized, title: 'Other tab' }];
  if (existingYoutube) tabs.push({ id: 2, windowId: 1, url: 'https://www.youtube.com/', active: !minimized, title: 'YouTube' });
  if (existingYoutube && !minimized) tabs[0].active = false;
  const windows = [{ id: 1, state: minimized ? 'minimized' : 'normal', focused: !minimized }];
  const state = new Map();
  const documents = new Map([[2, 'old-document']]);
  let documentRevision = 0;
  let pendingDocument;
  let resultReads = 0;
  let initialReads = 0, navigations = 0;
  const getTab = id => {
    const tab = tabs.find(item => item.id === id);
    if (!tab) throw new Error('No tab');
    return tab;
  };
  const chrome = {
    tabs: {
      query: async filter => tabs.filter(tab => filter?.active ? tab.active && (!filter.windowId || tab.windowId === filter.windowId) : true).map(tab => ({ ...tab })),
      get: async id => ({ ...getTab(id) }),
      create: async options => {
        tabs.forEach(tab => { tab.active = false; });
        const tab = { id: nextId++, windowId: 1, url: options.url, active: true, title: 'YouTube' };
        tabs.push(tab);
        return { ...tab };
      },
      update: async (id, options) => {
        const tab = getTab(id);
        if (options.active) { tabs.filter(item => item.windowId === tab.windowId).forEach(item => { item.active = false; }); tab.active = true; }
        if (options.url) {
          navigations++;
          tab.url = options.url;
          const replace = () => documents.set(id, `document-${++documentRevision}`);
          if (delayedDocument) pendingDocument = replace;
          else replace();
        }
        return { ...tab };
      },
      reload: async id => { getTab(id); documents.set(id, `document-${++documentRevision}`); contentScriptReady = true; },
      sendMessage: async (id, message, options) => {
        const tab = getTab(id);
        if (!contentScriptReady) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (discarded) throw new Error('Tab discarded');
        if (message.type === 'youtube-search') return { submitted: false };
        if (message.type === 'youtube-results') {
          if (canonicalize) tab.url = tab.url.replace(/%20/g, '+');
          if (changeQueryDuringRead) tab.url = 'https://www.youtube.com/results?search_query=Different';
          if (options?.documentId) assert.equal(options.documentId, documents.get(id), 'Read only the new document');
          if (delayedResults && ++resultReads === 1) return { results: [], ready: false, url: tab.url, query: message.query };
          return { results, ready: true, url: tab.url, query: new URL(tab.url).searchParams.get('search_query') };
        }
        if (message.type === 'youtube-state') return { videoFound: new URL(tab.url).pathname === '/watch', title: 'Chosen video', playbackState: state.get(id) || 'playing' };
        if (message.type === 'youtube-playlist') { const list = new URL(tab.url).searchParams.get('list'); return { list, url: `https://www.youtube.com/watch?v=first&list=${encodeURIComponent(list)}` }; }
        if (message.type === 'youtube-pause') { state.set(id, 'paused'); return { status: 'ok', title: 'Chosen video', playbackState: 'paused' }; }
        if (message.type === 'youtube-play') {
          if (blocked) return { status: 'autoplay_blocked', title: 'Chosen video', playbackState: 'paused', message: 'Browser blocked autoplay.' };
          state.set(id, 'playing'); return { status: 'ok', title: 'Chosen video', playbackState: 'playing' };
        }
      },
    },
    webNavigation: { getFrame: async ({ tabId }) => delayedInitialDocument && !navigations && (delayedInitialDocument === 'never' || ++initialReads <= 2) ? null : ({ documentId: documents.get(tabId) || 'initial-document', url: getTab(tabId).url }) },
    windows: {
      get: async id => ({ ...windows.find(item => item.id === id) }),
      getAll: async () => windows.map(item => ({ ...item })),
      update: async (id, options) => { const target = windows.find(item => item.id === id); Object.assign(target, options); return { ...target }; },
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
    scripting: { executeScript: async ({ target }) => { getTab(target.tabId); contentScriptReady = true; } },
    alarms: { onAlarm: { addListener() {} } },
    runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  };
  const context = vm.createContext({ chrome, browserName: () => 'Chrome', WebSocket: class {}, URL, crypto, setTimeout, clearTimeout, setInterval, clearInterval, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PC-Monitor-Test', 'extension', 'browser-tab-routing.js'), 'utf8'), context);
  vm.runInContext(source, context);
  const run = input => vm.runInContext(`runYoutubeCommand(${JSON.stringify(input)})`, context);
  return { run, tabs, windows, state, context, get navigations() { return navigations; }, commit: () => pendingDocument?.() };
}

(async () => {
  const video = id => ({ title: 'Target song', channel: 'Artist', url: `https://www.youtube.com/watch?v=${id}` });
  let env = environment({ results: [video('one')] });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).playbackState, 'playing');
  assert.equal(env.tabs.find(tab => tab.id === 2).active, true);

  env = environment({ results: [video('one'), video('two')], delayedResults: true });
  const loadedChoices = await env.run({ action: 'search_and_play', query: 'Target song' });
  assert.equal(loadedChoices.status, 'needs_selection', 'Wait for result rows after navigation');
  const repeatedChoices = await env.run({ action: 'search_and_play', query: 'Target song' });
  assert.notEqual(loadedChoices.documentId, repeatedChoices.documentId, 'Repeated searches require a fresh document');
  assert.equal((await env.run({ action: 'select_and_play', candidateId: loadedChoices.options[0].candidateId })).status, 'invalid_request', 'Old candidate IDs cannot select from a newer query');

  env = environment({ results: [video('one'), video('two')], canonicalize: true });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'needs_selection', 'Equivalent query encoding must trigger a fresh read, not a stale-target failure');
  env = environment({ results: [video('one'), video('two')], changeQueryDuringRead: true });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'stale_target', 'A different decoded query during reading must still be rejected');

  env = environment({ results: [video('one'), video('two')], delayedDocument: true });
  let completed = false;
  const fresh = env.run({ action: 'search_and_play', query: 'Target song' }).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(completed, false, 'A new URL with an old document must not complete a search');
  env.commit();
  const freshChoices = await fresh;
  assert.equal(freshChoices.status, 'needs_selection');
  env.tabs.find(tab => tab.id === 2).url = 'https://www.youtube.com/results?search_query=Different';
  assert.equal((await env.run({ action: 'select_and_play', candidateId: freshChoices.options[0].candidateId })).status, 'stale_target');

  env = environment({ results: [video('one')] });
  env.tabs.find(tab => tab.id === 2).url = 'about:blank';
  setTimeout(() => { env.tabs.find(tab => tab.id === 2).url = 'https://www.youtube.com/results?search_query=Target%20song'; }, 100);
  const delayed = await vm.runInContext("waitForPage(2, tab => new URL(tab.url).pathname === '/results', 'youtube-results', 1000)", env.context);
  assert.equal(delayed.results.length, 1);

  env = environment({ existingYoutube: false, results: [video('one')] });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'ok');
  assert.equal(env.tabs.filter(tab => tab.url.includes('youtube.com')).length, 1);

  env = environment({ existingYoutube: false, results: [video('one')], delayedInitialDocument: true });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'ok', 'Cold document readiness waits before navigation');
  assert.equal(env.navigations, 2, 'Exactly one search navigation and one chosen-video navigation');
  assert.equal(env.tabs.filter(tab => tab.url.includes('youtube.com')).length, 1, 'Cold recovery reuses the created tab');

  env = environment({ existingYoutube: false, results: [video('one')], delayedInitialDocument: 'never' });
  const missingDocument = await env.run({ action: 'search_and_play', query: 'Target song' });
  assert.equal(missingDocument.status, 'unavailable', 'A missing initial document stops at the readiness deadline');
  assert.equal(env.navigations, 0, 'No search or playback mutation may run without an initial observed document');

  env = environment({ results: [video('one')], delayedInitialDocument: 'never' });
  setTimeout(() => { env.tabs.find(tab => tab.id === 2).url = 'https://example.com/'; }, 50);
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'stale_target');
  assert.equal(env.navigations, 0, 'A changed site cannot receive a stale search');

  env = environment({ results: [video('one')], scriptMissingUntilReload: true });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'ok');

  env = environment({ scriptMissingUntilReload: true });
  env.tabs.find(tab => tab.id === 2).url = 'https://www.youtube.com/watch?v=one';
  assert.equal((await env.run({ action: 'pause' })).playbackState, 'paused');

  env = environment({ results: [video('one'), video('two')] });
  const choices = await env.run({ action: 'search_and_play', query: 'Target song' });
  assert.equal(choices.status, 'needs_selection');
  assert.equal(choices.options.length, 2);
  assert.equal((await env.run({ action: 'select_and_play', candidateId: choices.options[1].candidateId })).status, 'ok');
  assert.match(env.tabs.find(tab => tab.id === 2).url, /v=two/);

  env = environment({ results: [{ kind:'playlist', title:'Target song', channel:'Artist', url:'https://www.youtube.com/playlist?list=PLfixture' }, video('one')] });
  const playlistChoices = await env.run({ action:'search_and_play', query:'Target song' });
  assert.equal(playlistChoices.options[0].kind, 'playlist', 'Playlist ordering is preserved');
  assert.equal((await env.run({action:'select_and_play',candidateId:playlistChoices.options[0].candidateId})).playbackState,'playing');
  assert.match(env.tabs.find(tab=>tab.id===2).url,/v=first&list=PLfixture/);

  env = environment({ existingYoutube: true, minimized: true });
  env.tabs.find(tab => tab.id === 2).url = 'https://www.youtube.com/watch?v=one';
  const paused = await env.run({ action: 'pause' });
  assert.equal(paused.playbackState, 'paused');
  assert.equal(paused.restoredTab, true);
  assert.equal(paused.restoredBrowserWindow, true);
  assert.equal(env.tabs.find(tab => tab.id === 1).active, true);
  assert.equal(env.windows[0].state, 'minimized');
  assert.equal((await env.run({ action: 'resume' })).playbackState, 'playing');
  assert.equal(env.windows[0].state, 'minimized');

  env = environment({ results: [video('one')], blocked: true });
  assert.equal((await env.run({ action: 'search_and_play', query: 'Target song' })).status, 'autoplay_blocked');
  env = environment({ existingYoutube: true, discarded: true });
  env.tabs.find(tab => tab.id === 2).url = 'https://www.youtube.com/watch?v=one';
  assert.equal((await env.run({ action: 'pause' })).status, 'unavailable');

  const youtubeScript = manifest.content_scripts.find(item => item.js.includes('youtube.js'));
  assert.deepEqual(youtubeScript.matches, ['https://www.youtube.com/*', 'https://youtube.com/*']);
  const fast = fs.readFileSync(path.join(__dirname, '..', 'src', 'fastVoice.ts'), 'utf8');
  const thinking = fs.readFileSync(path.join(__dirname, '..', 'src', 'thinkingVoice.ts'), 'utf8');
  assert.match(fast, /browserTools/);
  assert.doesNotMatch(fast, /youtubeTool|name === "youtube_action"/);
  assert.doesNotMatch(thinking, /youtubeTool|youtube_action/);
  console.log('YouTube control checks passed: existing/new tab, choices, pause/resume restoration, blocked autoplay, discarded tab and Fast-only browser tools.');
})().catch(error => { console.error(error); process.exitCode = 1; });
