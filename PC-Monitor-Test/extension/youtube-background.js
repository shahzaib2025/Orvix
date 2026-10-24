const YOUTUBE_WS = 'ws://127.0.0.1:49492';
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com']);
let youtubeSocket = null;
let youtubeConnecting = false;
let youtubeReady = false;
let youtubeReconnect = null;
let youtubeHeartbeat = null;
let youtubeCommandQueue = Promise.resolve();
let youtubeChoices = null;
let lastYoutubeTabId = null;
let youtubeCommandId = null;

function youtubeTrace(stage, details = {}) {
  const safe = Object.fromEntries(Object.entries(details).filter(([key]) => ['tabId', 'status', 'type', 'count', 'playbackState', 'videoFound', 'elapsedMs', 'action'].includes(key)));
  const message = { type: 'trace', id: (typeof OrvixBrowser !== 'undefined' ? OrvixBrowser.currentRequestId() : '') || youtubeCommandId || '', stage, ...safe };
  console.log('[Orvix YouTube]', stage, safe);
  if (youtubeReady && youtubeSocket?.readyState === WebSocket.OPEN) {
    try { youtubeSocket.send(JSON.stringify(message)); } catch { /* Diagnostics must not interrupt playback. */ }
  }
}

function youtubeCheckpoint() { if (typeof OrvixBrowser !== 'undefined') OrvixBrowser.checkpoint(); }
const wait = async ms => { youtubeCheckpoint(); await new Promise(resolve => setTimeout(resolve, ms)); youtubeCheckpoint(); };

function isYoutubeTab(tab) {
  if (!tab || tab.incognito) return false;
  try { const url = new URL(tab.url); return url.protocol === 'https:' && YOUTUBE_HOSTS.has(url.hostname); }
  catch { return false; }
}

async function youtubeTabs() {
  return (await chrome.tabs.query({})).filter(isYoutubeTab);
}

async function pageMessage(tabId, type, extra = {}, documentId) {
  youtubeTrace('content script request', { tabId, type });
  const timeoutMs = type === 'youtube-play' ? 8_000 : type === 'youtube-pause' ? 4_000 : 1_500;
  const send = async () => {
    youtubeCheckpoint();
    let timer;
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(tabId, { type, ...extra }, documentId ? { documentId } : undefined),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('YouTube tab did not respond.')), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  try {
    let result = await send();
    if (type === 'youtube-play' && result?.status === 'autoplay_blocked' && typeof OrvixBrowser !== 'undefined') {
      const recovered = await OrvixBrowser.trustedYoutubePlay(tabId);
      if (recovered) result = recovered;
    }
    youtubeTrace('content script response', { tabId, type, status: result?.status, message: result?.message, count: result?.results?.length, videoFound: result?.videoFound, playbackState: result?.playbackState, title: result?.title });
    return result;
  }
  catch (error) {
    youtubeTrace('content script error', { tabId, type, message: String(error) });
    if (!/receiving end does not exist|could not establish connection/i.test(String(error))) throw error;
    const tab = await chrome.tabs.get(tabId);
    if (!isYoutubeTab(tab)) throw error;
    youtubeCheckpoint();
    await chrome.scripting.executeScript({ target: documentId ? { tabId, documentIds: [documentId] } : { tabId }, files: ['youtube.js'] });
    youtubeTrace('content script injected; retrying', { tabId, type });
    return send();
  }
}

async function findYoutubeTab() {
  const tabs = await youtubeTabs();
  const windows=await chrome.windows.getAll({});
  return OrvixTabRouting.choose({tabs,windows},'https://www.youtube.com/')?.tab||null;
}

async function showTab(tab) {
  youtubeCheckpoint();
  youtubeTrace('focusing YouTube tab', { tabId: tab.id, url: tab.url });
  const window = await chrome.windows.get(tab.windowId);
  youtubeCheckpoint();
  if (window.state === 'minimized') await chrome.windows.update(window.id, { state: 'normal' });
  youtubeCheckpoint();
  await chrome.windows.update(window.id, { focused: true });
  youtubeCheckpoint();
  return chrome.tabs.update(tab.id, { active: true });
}

async function waitForPage(tabId, predicate, type, ms = 10_000) {
  youtubeTrace('waiting for page', { tabId, type });
  const end = Date.now() + ms;
  while (Date.now() < end) {
    youtubeCheckpoint();
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    // A newly created tab can briefly report about:blank (or its old URL)
    // while Chrome commits the YouTube navigation.
    if (isYoutubeTab(tab) && predicate(tab)) {
      try {
        const result = await pageMessage(tabId, type);
        if (result && (type === 'youtube-results' ? result.results?.length : type === 'youtube-state' ? result.videoFound : true)) return result;
      } catch { /* Content script loads after navigation. */ }
    }
    await wait(300);
  }
  const finalTab = await chrome.tabs.get(tabId).catch(() => null);
  youtubeTrace('page wait timed out', { tabId, type, url: finalTab?.url, elapsedMs: ms });
  return null;
}

function normalized(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchScore(query, title) {
  const q = normalized(query);
  const t = normalized(title);
  if (q === t) return 1;
  if (!q || !t) return 0;
  const words = [...new Set(q.split(' '))];
  const titleWords = new Set(t.split(' '));
  const overlap = words.filter(word => titleWords.has(word)).length / words.length;
  return Math.min(.98, overlap * .72 + (t.includes(q) ? .2 : 0) + (t.startsWith(q) ? .06 : 0));
}

async function playCandidate(tabId, candidate) {
  let target = new URL(candidate.url);
  if (candidate.kind === 'playlist') {
    if (!YOUTUBE_HOSTS.has(target.hostname) || target.pathname !== '/playlist' || !target.searchParams.get('list')) return { status: 'invalid_request', message: 'Invalid playlist.' };
    const list = target.searchParams.get('list');
    youtubeCheckpoint();
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!isYoutubeTab(tab)) return { status: 'unavailable', message: 'The selected tab changed.' };
    await showTab(tab);
    await chrome.tabs.update(tabId, { url: target.href });
    const playlist = await waitForPage(tabId, tab => { try { const url = new URL(tab.url); return url.pathname === '/playlist' && url.searchParams.get('list') === list; } catch { return false; } }, 'youtube-playlist');
    if (!playlist?.url || playlist.list !== list) return { status: 'unavailable', message: 'The playlist has no readable playable video.' };
    target = new URL(playlist.url);
    if (!YOUTUBE_HOSTS.has(target.hostname) || target.pathname !== '/watch' || target.searchParams.get('list') !== list) return { status: 'invalid_request', message: 'The playlist target changed.' };
  }
  if (!YOUTUBE_HOSTS.has(target.hostname) || target.pathname !== '/watch' || !target.searchParams.get('v')) {
    return { status: 'invalid_request', message: 'The selected result is not a YouTube video.' };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isYoutubeTab(tab)) return { status: 'unavailable', message: 'The YouTube tab was closed or changed.' };
  await showTab(tab);
  youtubeCheckpoint();
  await chrome.tabs.update(tabId, { url: target.href });
  youtubeTrace('navigating to selected video', { tabId, url: candidate.url, title: candidate.title });
  const videoId = target.searchParams.get('v');
  const state = await waitForPage(tabId, current => {
    try { const url = new URL(current.url); return url.pathname === '/watch' && url.searchParams.get('v') === videoId; }
    catch { return false; }
  }, 'youtube-state');
  if (!state?.videoFound) return { status: 'unavailable', message: 'The YouTube video did not load.', title: candidate.title };
  let result = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { result = await pageMessage(tabId, 'youtube-play'); }
    catch { result = null; }
    if (result?.status === 'ok' || result?.status === 'autoplay_blocked') break;
    await wait(250);
  }
  if (result?.status === 'ok') lastYoutubeTabId = tabId;
  return { ...(result || { status: 'unavailable', message: 'Could not verify YouTube playback.' }), title: result?.title || candidate.title, channel: candidate.channel, tabId };
}

async function searchAndPlay(query, selectedTabId) {
  youtubeTrace('search starting', { message: query });
  if (typeof query !== 'string' || !query.trim()) return { status: 'invalid_request', message: 'A video title is required.' };
  youtubeChoices = null;
  let tab = selectedTabId ? await chrome.tabs.get(selectedTabId).catch(()=>null) : await findYoutubeTab();
  if(selectedTabId&&!isYoutubeTab(tab))return {status:'stale_target',message:'The requested YouTube tab closed or changed site.'};
  if (!tab) {
    youtubeCheckpoint();
    tab = await chrome.tabs.create({ url: 'https://www.youtube.com/', active: true });
  }
  if (!tab) return { status: 'unavailable', message: 'Chrome could not open a YouTube tab.' };
  youtubeTrace('YouTube tab selected', { tabId: tab.id, url: tab.url });
  await showTab(tab);
  const wanted = query.trim();
  const resultsUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(wanted)}`;
  // A newly created tab can be selected before its first document commits.
  // Wait for that observation; do not navigate twice to recover a cold tab.
  const initialDeadline = Date.now() + 4_000;
  let previous = null;
  do {
    youtubeCheckpoint();
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (!current || !isYoutubeTab(current)) return { status: 'stale_target', message: 'The YouTube tab closed or changed site before search.' };
    tab = current;
    previous = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
    if (previous?.documentId) break;
    await wait(100);
  } while (Date.now() < initialDeadline);
  if (!previous?.documentId) return { status: 'unavailable', message: 'Could not identify the current YouTube document.' };
  youtubeCheckpoint();
  if (tab.url === resultsUrl) await chrome.tabs.reload(tab.id);
  else await chrome.tabs.update(tab.id, { url: resultsUrl });
  youtubeTrace('navigating to fresh search document', { tabId: tab.id, url: resultsUrl });
  const deadline = Date.now() + 20_000;
  let page = null, documentId = null;
  while (Date.now() < deadline) {
    youtubeCheckpoint();
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
    let matches = false;
    try { const url = new URL(frame?.url); matches = YOUTUBE_HOSTS.has(url.hostname) && url.pathname === '/results' && url.searchParams.get('search_query') === wanted; } catch { }
    if (frame?.documentId && frame.documentId !== previous.documentId && matches) {
      if (documentId && documentId !== frame.documentId) return { status: 'stale_target', message: 'YouTube changed while reading search results.' };
      documentId = frame.documentId;
      try {
        const snapshot = await pageMessage(tab.id, 'youtube-results', { query: wanted }, documentId);
        const latest = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
        if (latest.documentId !== documentId) return { status: 'stale_target', message: 'YouTube changed while reading search results.' };
        if (latest.url !== frame.url) {
          const current = new URL(latest.url);
          if (!YOUTUBE_HOSTS.has(current.hostname) || current.pathname !== '/results' || current.searchParams.get('search_query') !== wanted) return { status: 'stale_target', message: 'YouTube changed while reading search results.' };
          // YouTube canonicalizes query encoding during load. Read again from
          // the same document at its current URL before accepting any rows.
          await wait(150);
          continue;
        }
        if (snapshot?.query === wanted && snapshot.url === frame.url && snapshot.ready && snapshot.results?.length) { page = snapshot; break; }
      } catch { /* New content script or result rows may still be loading. */ }
    }
    await wait(150);
  }
  const results = Array.isArray(page?.results) ? page.results.filter(item => item?.title && item?.url) : [];
  if (!results.length) return { status: 'unavailable', message: 'YouTube search did not return readable video results.', query: wanted };
  const ranked = results.map(item => ({ ...item, score: matchScore(wanted, item.title) })).sort((a, b) => b.score - a.score);
  youtubeTrace('search results ranked', { count: ranked.length, title: ranked[0]?.title });
  const clear = ranked.length === 1 || (ranked[0].score === 1 && ranked[1].score < 1) || (ranked[0].score >= .85 && ranked[0].score - ranked[1].score >= .32);
  if (clear) return playCandidate(tab.id, ranked[0]);
  const requestId = crypto.randomUUID();
  const visibleResults = results.slice(0, 6);
  const options = visibleResults.map((item, index) => ({ number: index + 1, candidateId: `${requestId}:${index + 1}`, kind: item.kind || 'video', title: item.title, channel: item.channel }));
  youtubeChoices = { requestId, tabId: tab.id, documentId, query: wanted, results: visibleResults, expiresAt: Date.now() + 120_000 };
  return { status: 'needs_selection', message: 'Videos and playlists in page order. Ask the user to choose a number.', query: wanted, documentId, options };
}

async function selectAndPlay(candidateId) {
  const choice = youtubeChoices;
  if (!choice) return { status: 'selection_required', message: 'No saved YouTube choices are available. Run a fresh search before selecting.' };
  if (Date.now() > choice.expiresAt) { youtubeChoices = null; return { status: 'expired', message: 'The saved YouTube choices exceeded their validity period. Search again.' }; }
  const [requestId, rawIndex] = String(candidateId || '').split(':');
  const index = Number(rawIndex) - 1;
  if (requestId !== choice.requestId || !Number.isInteger(index) || !choice.results[index]) return { status: 'invalid_request', message: 'Choose a candidateId from the latest search results.' };
  const frame = await chrome.webNavigation.getFrame({ tabId: choice.tabId, frameId: 0 }).catch(() => null);
  let matches = false;
  try { const url = new URL(frame?.url); matches = url.pathname === '/results' && url.searchParams.get('search_query') === choice.query; } catch { }
  if (frame?.documentId !== choice.documentId || !matches) { youtubeChoices = null; return { status: 'stale_target', message: 'The search page changed. Search again before selecting a video.' }; }
  youtubeChoices = null;
  return playCandidate(choice.tabId, choice.results[index]);
}

async function playbackTarget(action, targetTitle, selectedTabId) {
  const tabs = (await youtubeTabs()).filter(tab=>!selectedTabId||tab.id===selectedTabId);
  if (!tabs.length) return { error: { status: 'unavailable', message: 'No YouTube tab is open in Chrome.' } };
  const candidates = (await Promise.all(tabs.map(async tab => {
    try { return { tab, state: await pageMessage(tab.id, 'youtube-state') }; }
    catch { return null; /* Closed, discarded, or unresponsive tabs are skipped. */ }
  }))).filter(Boolean);
  if (!candidates.length) return { error: { status: 'unavailable', message: 'No open YouTube tab can be controlled. Reload the tab and try again.' } };
  let matching = candidates.filter(item => item.state?.videoFound);
  if (targetTitle) matching = matching.filter(item => normalized(item.state.title).includes(normalized(targetTitle)));
  if (!matching.length) return { error: { status: 'unavailable', message: targetTitle ? `No playable YouTube tab matches "${targetTitle}".` : 'No playable YouTube video is open.' } };
  const preferred = matching.find(item => item.tab.id === lastYoutubeTabId);
  const desired = action === 'pause' ? 'playing' : 'paused';
  const eligible = matching.filter(item => item.state.playbackState === desired);
  if (preferred && preferred.state.playbackState === desired) return { target: preferred };
  if (eligible.length === 1) return { target: eligible[0] };
  if (eligible.length > 1) return { error: { status: 'ambiguous_target', message: 'More than one YouTube video matches. Ask for its title and try again with targetTitle.', options: eligible.map(item => ({ title: item.state.title, playbackState: item.state.playbackState })) } };
  if (preferred) return { target: preferred };
  if (matching.length === 1) return { target: matching[0] };
  return { error: { status: 'ambiguous_target', message: 'Specify which YouTube video to control.', options: matching.map(item => ({ title: item.state.title, playbackState: item.state.playbackState })) } };
}

async function pauseOrResume(action, targetTitle, selectedTabId) {
  const selected = await playbackTarget(action, targetTitle, selectedTabId);
  if (selected.error) return selected.error;
  const tab = selected.target.tab;
  const targetWindow = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!targetWindow) return { status: 'unavailable', message: 'The Chrome window was closed.' };
  const browserWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const previouslyFocusedChrome = browserWindows.find(window => window.focused)?.id || null;
  const previousTab = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0]?.id || null;
  let result = { status: 'failed', message: 'YouTube control did not complete.' };
  let changedContext = false;
  let restoredTab = true;
  let restoredBrowserWindow = true;
  try {
    changedContext = true;
    await showTab(tab);
    result = await pageMessage(tab.id, action === 'pause' ? 'youtube-pause' : 'youtube-play');
    if (!result || typeof result !== 'object') result = { status: 'failed', message: 'YouTube did not confirm playback state.' };
    if (result.status === 'ok') lastYoutubeTabId = tab.id;
  } catch (error) {
    result = { status: 'unavailable', message: error?.message || 'The YouTube tab became unavailable.' };
  } finally {
    if (changedContext) {
      if (previousTab && previousTab !== tab.id) {
        try { await chrome.tabs.update(previousTab, { active: true }); } catch { restoredTab = false; }
      }
      if (targetWindow.state === 'minimized') {
        try { await chrome.windows.update(tab.windowId, { state: 'minimized' }); } catch { restoredBrowserWindow = false; }
      }
      if (previouslyFocusedChrome && previouslyFocusedChrome !== tab.windowId) {
        try { await chrome.windows.update(previouslyFocusedChrome, { focused: true }); } catch { restoredBrowserWindow = false; }
      }
    }
  }
  if (result.status === 'ok' && (!restoredTab || !restoredBrowserWindow)) {
    result = { ...result, status: 'partial', message: 'Playback changed, but the previous Chrome tab or window could not be fully restored.' };
  }
  return { ...result, tabId: tab.id, switchedToYoutube: changedContext, restoredTab, restoredBrowserWindow };
}

async function runYoutubeCommand(message) {
  try {
    if (message.action === 'search_and_play') return await searchAndPlay(message.query,message.tabId);
    if (message.action === 'select_and_play') {
      if(message.tabId&&youtubeChoices?.tabId!==message.tabId)return {status:'stale_target',message:'The choice belongs to a different YouTube tab.'};
      return await selectAndPlay(message.candidateId);
    }
    if (message.action === 'pause' || message.action === 'resume') return await pauseOrResume(message.action, message.targetTitle,message.tabId);
    return { status: 'invalid_request', message: 'Unsupported YouTube action.' };
  } catch (error) {
    return { status: error?.status || 'failed', completionUnknown:true, message: error?.message || 'Chrome could not complete the YouTube action.' };
  }
}

function scheduleYoutubeReconnect() {
  console.log('[Orvix YouTube] Reconnecting in 3 seconds');
  clearTimeout(youtubeReconnect);
  youtubeReconnect = setTimeout(connectYoutube, 3000);
}

async function connectYoutube() {
  if (browserName() !== 'Chrome' || youtubeConnecting || youtubeSocket && (youtubeSocket.readyState === WebSocket.OPEN || youtubeSocket.readyState === WebSocket.CONNECTING)) return;
  youtubeConnecting = true;
  let socket;
  let token;
  try {
    ({ token } = await chrome.storage.local.get('token'));
    if (!/^[a-f0-9]{64}$/i.test(token || '')) { console.warn('[Orvix YouTube] No valid saved pairing token'); return; }
    console.log('[Orvix YouTube] Connecting with saved pairing to', YOUTUBE_WS);
    socket = new WebSocket(YOUTUBE_WS);
    youtubeSocket = socket;
    youtubeReady = false;
  } catch { scheduleYoutubeReconnect(); return; }
  finally { youtubeConnecting = false; }
  socket.onopen = async () => {
    const browser = typeof OrvixBrowser !== 'undefined' ? OrvixBrowser : null;
    const capabilities = browser ? await browser.capabilities() : null;
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
      type: 'hello', browser: 'Chrome', token,
      ...(browser ? { protocolVersion: 2, sessionId: browser.sessionId, extensionVersion: chrome.runtime.getManifest().version, capabilities } : {})
    }));
  };
  socket.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message?.type === 'ready') {
      youtubeReady = true;
      void chrome.storage.local.set({ browserConnection: 'connected' });
      youtubeTrace('authenticated; YouTube channel ready');
      if (typeof OrvixBrowser !== 'undefined') void OrvixBrowser.publish();
      clearInterval(youtubeHeartbeat);
      youtubeHeartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }));
      }, 20_000);
      return;
    }
    if (!youtubeReady || typeof message.id !== 'string') return;
    if (message.type === 'browser-cancel' && typeof OrvixBrowser !== 'undefined') { OrvixBrowser.cancel(message.id); return; }
    if (message.type === 'browser-command' && typeof OrvixBrowser !== 'undefined') {
      OrvixBrowser.run(message).then(result => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id: message.id, result }));
      });
      return;
    }
    if (message.type !== 'command') return;
    youtubeCommandQueue = youtubeCommandQueue.catch(() => { }).then(async () => {
      youtubeCommandId = message.id;
      youtubeTrace('command received', { message: message.action });
      try {
        const result = typeof OrvixBrowser !== 'undefined'
          ? await OrvixBrowser.run({ id: message.id, kind: 'legacy', input: message, deadline: Date.now() + 35000 })
          : await runYoutubeCommand(message);
        youtubeTrace('command completed', { status: result?.status, message: result?.message, playbackState: result?.playbackState });
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id: message.id, result }));
      } finally { youtubeCommandId = null; }
    });
  };
  socket.onclose = event => {
    console.warn('[Orvix YouTube] Connection closed', event.code, event.reason);
    if (youtubeSocket !== socket) return;
    if (typeof OrvixBrowser !== 'undefined') OrvixBrowser.cancelAll();
    void chrome.storage.local.set({ browserConnection: event.code === 1008 ? 'saved token rejected' : 'disconnected; reconnecting' });
    youtubeSocket = null;
    youtubeReady = false;
    clearInterval(youtubeHeartbeat);
    scheduleYoutubeReconnect();
  };
  socket.onerror = () => { };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.token) return;
  youtubeSocket?.close();
  youtubeSocket = null;
  clearTimeout(youtubeReconnect);
  void connectYoutube();
});
for (const event of ['onAdded', 'onRemoved']) chrome.permissions?.[event]?.addListener(() => { youtubeSocket?.close(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconcile') void connectYoutube(); });
chrome.runtime.onStartup.addListener(() => { void connectYoutube(); });
chrome.runtime.onInstalled.addListener(() => { void connectYoutube(); });
chrome.tabs.onUpdated?.addListener((tabId, change, tab) => {
  if (youtubeCommandId && isYoutubeTab(tab) && (change.url || change.status)) {
    youtubeTrace('tab changed', { tabId, url: change.url || tab.url, status: change.status });
  }
});
void connectYoutube();
