// This content script is installed only on YouTube. It never evaluates model supplied code.
(() => {
if (globalThis.__orvixYoutubeControlReady) return;
globalThis.__orvixYoutubeControlReady = true;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com']);
let resultsChangedAt=Date.now();
new MutationObserver(records=>{
  if(records.some(record=>record.target?.closest?.('ytd-search')||[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches?.('ytd-search, ytd-video-renderer, ytd-playlist-renderer')||node.querySelector?.('ytd-search')))))resultsChangedAt=Date.now();
}).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['href','title']});

function currentVideo() {
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

function videoInfo() {
  const video = currentVideo();
  return {
    title: document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || document.title.replace(/\s+- YouTube$/, '').trim(),
    playbackState: video ? (video.paused ? 'paused' : 'playing') : 'unavailable',
    videoFound: !!video,
  };
}

function searchResults() {
  const items = [];
  const seen = new Set();
  for (const row of document.querySelectorAll('ytd-search ytd-video-renderer, ytd-search ytd-playlist-renderer')) {
    if (!row.getClientRects().length) continue;
    const playlist = row.tagName.toLowerCase() === 'ytd-playlist-renderer';
    const anchor = row.querySelector(playlist ? 'a#video-title[href*="list="]' : 'a#video-title[href*="/watch?"]');
    if (!anchor) continue;
    let url;
    try { url = new URL(anchor.href, location.href); } catch { continue; }
    if (!YOUTUBE_HOSTS.has(url.hostname) || (playlist ? !['/playlist', '/watch'].includes(url.pathname) : url.pathname !== '/watch')) continue;
    const videoId = url.searchParams.get(playlist ? 'list' : 'v');
    const key = `${playlist ? 'playlist' : 'video'}:${videoId}`;
    if (!videoId || seen.has(key)) continue;
    const title = (anchor.getAttribute('title') || anchor.textContent || '').trim();
    if (!title) continue;
    seen.add(key);
    items.push({ kind: playlist ? 'playlist' : 'video', title: title.slice(0, 180), channel: (row.querySelector('#channel-name a')?.textContent || row.querySelector('#channel-name')?.textContent || '').trim().slice(0, 100), url: playlist ? `https://www.youtube.com/playlist?list=${encodeURIComponent(videoId)}` : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` });
    if (items.length >= 8) break;
  }
  return items;
}

async function playback(action) {
  const video = currentVideo();
  if (!video) return { status: 'unavailable', message: 'The YouTube page has no playable video.', ...videoInfo() };
  if (action === 'pause') video.pause();
  else {
    try { await video.play(); }
    catch (error) {
      return { status: error?.name === 'NotAllowedError' ? 'autoplay_blocked' : 'failed', message: error?.message || 'YouTube could not start playback.', ...videoInfo() };
    }
  }
  await new Promise(resolve => setTimeout(resolve, 350));
  const info = videoInfo();
  const wanted = action === 'pause' ? 'paused' : 'playing';
  return { status: info.playbackState === wanted ? 'ok' : 'failed', message: info.playbackState === wanted ? '' : `The video is ${info.playbackState}; expected ${wanted}.`, ...info };
}

function submitSearch(query) {
  const field = document.querySelector('input#search, input[name="search_query"]');
  if (!(field instanceof HTMLInputElement)) return { submitted: false };
  field.focus();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setValue) setValue.call(field, query);
  else field.value = query;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  const button = document.querySelector('button#search-icon-legacy, ytd-searchbox button[aria-label="Search"]');
  if (button instanceof HTMLElement) button.click();
  else if (field.form) field.form.requestSubmit();
  else return { submitted: false };
  return { submitted: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!YOUTUBE_HOSTS.has(location.hostname) || !message || typeof message !== 'object') return;
  if (message.type === 'youtube-results') {
    const query = new URL(location.href).searchParams.get('search_query');
    const results = searchResults();
    const loading = document.querySelector('ytd-search[aria-busy="true"], ytd-search [aria-busy="true"], yt-page-navigation-progress[aria-valuenow]:not([aria-valuenow="100"])');
    sendResponse({ url: location.href, query, ready: document.readyState === 'complete' && !loading && location.pathname === '/results' && (!message.query || query === message.query) && results.length > 0 && Date.now()-resultsChangedAt>=250, results });
    return;
  }
  if (message.type === 'youtube-state') { sendResponse(videoInfo()); return; }
  if (message.type === 'youtube-playlist') {
    const list = new URL(location.href).searchParams.get('list');
    const link = [...document.querySelectorAll('ytd-playlist-video-renderer a[href*="/watch?"]')].map(anchor => {
      try { return new URL(anchor.href, location.href); } catch { return null; }
    }).find(url => url && YOUTUBE_HOSTS.has(url.hostname) && url.pathname === '/watch' && url.searchParams.get('v') && url.searchParams.get('list') === list);
    sendResponse({ url: link?.href, list }); return;
  }
  if (message.type === 'youtube-search') {
    sendResponse(typeof message.query === 'string' && message.query.trim() ? submitSearch(message.query.trim()) : { submitted: false });
    return;
  }
  if (message.type === 'youtube-pause' || message.type === 'youtube-play') {
    playback(message.type === 'youtube-pause' ? 'pause' : 'play').then(sendResponse).catch(error => sendResponse({ status: 'failed', message: error.message }));
    return true;
  }
});
})();
