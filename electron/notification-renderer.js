'use strict';
let activeNotice = null, countdownTimer = null;
function render(notice) {
  if (!notice || (activeNotice?.id === notice.id && activeNotice?.attempt === notice.attempt)) return;
  activeNotice = notice; clearInterval(countdownTimer);
  const card = document.getElementById('card');
  card.classList.toggle('shutdown', notice.kind === 'shutdown');
  document.getElementById('title').textContent = notice.title;
  document.getElementById('body').textContent = notice.body;
  document.getElementById('time').textContent = 'now';
  const act = action => window.orvixNotice.action(action, notice.id, notice.attempt);
  document.getElementById('dismiss').onclick = () => act('dismiss');
  document.getElementById('open').onclick = () => act('open');
  document.getElementById('open').hidden = notice.kind === 'shutdown';
  document.getElementById('cancel').hidden = notice.kind !== 'shutdown';
  document.getElementById('cancel').onclick = () => act('cancel_shutdown');
  if (notice.kind === 'shutdown') {
    const tick = () => { document.getElementById('state').textContent = 'Shutdown in ' + Math.max(0, Math.ceil((notice.endsAt - Date.now()) / 1000)) + 's'; };
    tick(); countdownTimer = setInterval(tick, 250);
  } else document.getElementById('state').textContent = 'Tiny Agent';
  let hovering = false;
  const sync = () => { if (notice.kind !== 'shutdown') act(hovering || card.contains(document.activeElement) ? 'pause' : 'resume'); };
  card.onmouseenter = () => { hovering = true; sync(); };
  card.onmouseleave = () => { hovering = false; sync(); };
  card.onfocusin = sync; card.onfocusout = () => setTimeout(sync, 0);
  // Delivery does not depend on animation frames in a hidden window.
  window.orvixNotice.ready(notice.id, notice.attempt);
}
window.orvixNotice.onVisible(({ id, attempt }) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (activeNotice?.id === id && activeNotice?.attempt === attempt && document.visibilityState === 'visible') window.orvixNotice.displayed(id, attempt);
  }));
});
window.orvixNotice.onUpdate(render);
window.orvixNotice.loaded();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeNotice) window.orvixNotice.action('dismiss', activeNotice.id, activeNotice.attempt);
});

