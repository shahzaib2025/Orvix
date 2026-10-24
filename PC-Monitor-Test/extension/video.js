let last = '';
function report(force = false) {
  const playing = [...document.querySelectorAll('video')].filter(video => !video.paused && !video.ended);
  const state = { type: 'video-state', title: document.title || '', playing: playing.length > 0,
    muted: playing.length > 0 && playing.every(video => video.muted || video.volume === 0) };
  const signature = JSON.stringify(state);
  if (!force && signature === last) return;
  last = signature;
  chrome.runtime.sendMessage(state).catch(() => {});
}
for (const event of ['play', 'pause', 'ended', 'volumechange']) document.addEventListener(event, () => report(), true);
document.addEventListener('visibilitychange', () => report());
// Keep actual foreground YouTube playback fresh for automatic timing. There
// is no image capture or provider call here; hidden/non-YouTube tabs stay quiet.
setInterval(() => {
  if (document.visibilityState === 'visible' && /(^|\.)youtube\.com$/i.test(location.hostname) && location.pathname === '/watch' && document.querySelector('video')) report(true);
}, 5_000);
report();
