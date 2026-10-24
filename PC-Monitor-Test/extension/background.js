const ENDPOINT = 'http://127.0.0.1:49491/snapshot';
const videos = new Map();
let timer;
let sending = false;
let sendAgain = false;

function browserName() {
  return navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome';
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(send, 250);
}

async function send() {
  if (sending) { sendAgain = true; return; }
  sending = true;
  try {
    const { token } = await chrome.storage.local.get('token');
    if (!token) return;
    const all = await chrome.tabs.query({});
    const tabs = all.filter(tab => !tab.incognito).map(tab => ({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || '',
      url: tab.url || '',
      active: !!tab.active,
      audible: !!tab.audible,
      muted: !!tab.mutedInfo?.muted
    }));
    const ids = new Set(tabs.map(tab => tab.id));
    for (const id of videos.keys()) if (!ids.has(id)) videos.delete(id);
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PC-Monitor-Token': token },
      body: JSON.stringify({ browser: browserName(), tabs, videos: [...videos.values()] })
    });
    await chrome.storage.local.set({ connection: response.ok ? 'connected' : `HTTP ${response.status}` });
  } catch {
    await chrome.storage.local.set({ connection: 'monitor unavailable' });
  } finally {
    if (typeof OrvixBrowser !== 'undefined') void OrvixBrowser.publish();
    sending = false;
    if (sendAgain) { sendAgain = false; schedule(); }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'video-state' || !sender.tab || sender.tab.incognito) return;
  videos.set(sender.tab.id, { tabId: sender.tab.id, title: message.title || '', playing: !!message.playing, muted: !!message.muted });
  schedule();
});
chrome.tabs.onCreated.addListener(schedule);
chrome.tabs.onUpdated.addListener(schedule);
chrome.tabs.onActivated.addListener(schedule);
chrome.tabs.onRemoved.addListener(tabId => { videos.delete(tabId); schedule(); });
chrome.tabs.onMoved.addListener(schedule);
chrome.windows.onCreated.addListener(schedule);
chrome.windows.onRemoved.addListener(schedule);
chrome.windows.onFocusChanged.addListener(schedule);
chrome.windows.onBoundsChanged?.addListener(schedule);
for (const event of ['onCreated', 'onUpdated', 'onMoved', 'onRemoved']) chrome.tabGroups?.[event]?.addListener(schedule);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.token) schedule(); });
chrome.alarms.create('reconcile', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconcile') schedule(); });
chrome.runtime.onStartup.addListener(schedule);
chrome.runtime.onInstalled.addListener(schedule);
schedule();
importScripts('browser-tab-routing.js', 'browser-background.js', 'youtube-background.js');
