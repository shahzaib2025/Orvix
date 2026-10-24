const deck = document.getElementById('deck');
const panel = document.getElementById('quickPanel');
// Fail visibly and non-interactively while the native entrance handshake is pending.
deck.style.opacity = '1';
deck.inert = true;
const volumeSlider = document.getElementById('volumeSlider');
const brightnessSlider = document.getElementById('brightnessSlider');
const volumeValue = document.getElementById('volumeValue');
const brightnessValue = document.getElementById('brightnessValue');
const brightnessRow = document.getElementById('brightnessRow');
const brightnessHint = document.getElementById('brightnessHint');
const displayNote = document.getElementById('displayNote');
const panelStatus = document.getElementById('panelStatus');
const toast = document.getElementById('toast');
const isBrowserPreview = !window.quickDeck;
const previewControls = { volume: 65, brightness: 82 };
const bridge = window.quickDeck || {
  getControls: async () => ({ volume: previewControls.volume, brightness: previewControls.brightness, brightnessSupported: true }),
  setVolume: async value => {
    previewControls.volume = Math.max(0, Math.min(100, Math.round(Number(value))));
    return { ok: true, value: previewControls.volume, preview: true };
  },
  setBrightness: async value => {
    previewControls.brightness = Math.max(0, Math.min(100, Math.round(Number(value))));
    return { ok: true, value: previewControls.brightness, preview: true };
  },
  launch: async action => ({ ok: true, preview: true, action }),
  setExpanded: async () => true,
  onBlur: () => {},
  onHover: () => {},
  onDragState: () => {},
  onMotion: () => {},
  motionComplete: () => {},
  wake: async () => true,
  pointerInside: async () => deck.matches(':hover'),
};

if (isBrowserPreview) document.body.dataset.preview = 'true';
let isExpanded = false;
let toastTimer;
let motionBusy = true;
let motionAnimation;
let logoAnimation;
let motionVersion = 0;
let previewClosed = false;
let controlsRequest;
let controlsReadAt = 0;
let expansionVersion = 0;
let hoverOpenTimer;
let pointerWithin = false;
let keyboardMode = false;
let sliderDragging = false;
let hoverSuppressed = false;
let windowDragging = false;
let revealTimer;
let hoverRequestVersion = 0;
let panelSurfaceAnimation;
let panelContentAnimation;

function announce(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

function setSliderValue(slider, output, value) {
  const amount = Math.max(0, Math.min(100, Math.round(Number(value))));
  slider.value = String(amount);
  slider.style.setProperty('--fill', `${amount}%`);
  output.value = `${amount}%`;
  output.textContent = `${amount}%`;
}

function currentVisibleHeight() {
  const height = deck.getBoundingClientRect().height;
  const clip = getComputedStyle(deck).clipPath;
  const match = clip.match(/^inset\((.*?)\)/);
  if (!match) return height;
  const values = match[1].split('round')[0].trim().split(/\s+/);
  const bottom = parseFloat(values.length > 2 ? values[2] : values[0]) || 0;
  return Math.max(0, height - bottom);
}

async function setExpanded(next) {
  if (next && (motionBusy || previewClosed || windowDragging)) return;
  clearTimeout(hoverOpenTimer);
  if (next === isExpanded) return;
  const version = ++expansionVersion;
  // Reverse from the rendered position rather than restarting the transition.
  const visibleHeight = currentVisibleHeight();
  const contentStyle = getComputedStyle(panel);
  const contentOpacity = contentStyle.opacity;
  const contentTransform = contentStyle.transform === 'none' ? 'translateY(0px)' : contentStyle.transform;
  panelSurfaceAnimation?.cancel();
  panelContentAnimation?.cancel();
  panelSurfaceAnimation = undefined;
  panelContentAnimation = undefined;
  isExpanded = next;
  panel.inert = !next;
  panel.setAttribute('aria-hidden', String(!next));
  deck.dataset.expanded = String(next);
  deck.dataset.panelState = next ? 'opening' : 'closing';
  deck.classList.add('is-open', 'is-panel-animating');
  deck.classList.toggle('is-opening', next);
  deck.classList.toggle('is-closing', !next);
  if (next) panel.style.maxHeight = '';
  const fullHeight = deck.getBoundingClientRect().height;
  const barHeight = document.querySelector('.deck-bar').getBoundingClientRect().height + 3;
  const initialHeight = Math.min(fullHeight, Math.max(barHeight, visibleHeight));
  deck.style.clipPath = 'inset(0px 0px ' + Math.max(0, fullHeight - initialHeight) + 'px round 25px)';
  panel.style.opacity = contentOpacity;
  panel.style.transform = contentTransform;
  // Reserve native space before opening; release it only after closing finishes.
  let result;
  try { result = next ? await bridge.setExpanded(true, Math.ceil(fullHeight) + 12) : await bridge.wake(); }
  catch { result = false; }
  if (version !== expansionVersion) return;
  if (result === false && next) {
    isExpanded = false;
    deck.dataset.expanded = 'false';
    deck.dataset.panelState = 'collapsed';
    deck.classList.remove('is-open', 'is-opening', 'is-closing', 'is-panel-animating');
    deck.style.clipPath = '';
    panel.style.opacity = '';
    panel.style.transform = '';
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    return;
  }
  if (Number.isFinite(result?.panelMaxHeight)) panel.style.maxHeight = result.panelMaxHeight + 'px';
  const finalFullHeight = deck.getBoundingClientRect().height;
  const targetHeight = next ? finalFullHeight : barHeight;
  const distance = Math.abs(targetHeight - initialHeight);
  const fraction = Math.min(1, distance / Math.max(1, finalFullHeight - barHeight));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reducedMotion ? 1 : Math.max(55, (next ? 230 : 145) * fraction);
  const options = { duration, easing: next ? 'cubic-bezier(.2,.85,.25,1)' : 'cubic-bezier(.4,0,.6,1)', fill: 'both' };
  const fromClip = 'inset(0px 0px ' + Math.max(0, finalFullHeight - initialHeight) + 'px round 25px)';
  const toClip = 'inset(0px 0px ' + Math.max(0, finalFullHeight - targetHeight) + 'px round 25px)';
  const surface = deck.animate([{ clipPath: fromClip }, { clipPath: toClip }], options);
  const content = panel.animate([{ opacity: contentOpacity, transform: contentTransform }, { opacity: next ? 1 : 0, transform: next ? 'translateY(0px)' : 'translateY(-8px)' }], options);
  panelSurfaceAnimation = surface;
  panelContentAnimation = content;
  try { await Promise.all([surface.finished, content.finished]); } catch { return; }
  if (version !== expansionVersion) return;
  deck.classList.remove('is-panel-animating', 'is-opening', 'is-closing');
  if (!next) deck.classList.remove('is-open');
  deck.style.clipPath = '';
  panel.style.opacity = '';
  panel.style.transform = '';
  if (!next) panel.style.maxHeight = '';
  surface.cancel();
  content.cancel();
  panelSurfaceAnimation = undefined;
  panelContentAnimation = undefined;
  if (!next) {
    try { await bridge.setExpanded(false); } catch { /* Window may already be closing. */ }
    if (version !== expansionVersion) return;
  }
  deck.dataset.panelState = next ? 'expanded' : 'collapsed';
  if (next) refreshControls();
}

function scheduleOpen() {
  const request = ++hoverRequestVersion;
  clearTimeout(hoverOpenTimer);
  if (motionBusy || previewClosed || hoverSuppressed || windowDragging) return;
  bridge.wake().then(() => {
    if (request !== hoverRequestVersion || !pointerWithin || motionBusy || previewClosed || hoverSuppressed || windowDragging) return;
    hoverOpenTimer = setTimeout(() => { if (pointerWithin && !hoverSuppressed && !windowDragging) setExpanded(true); }, 1000);
  }).catch(() => {});
}
async function scheduleClose(verifyPointer = false) {
  const request = ++hoverRequestVersion;
  clearTimeout(hoverOpenTimer);
  if (sliderDragging || (keyboardMode && deck.contains(document.activeElement))) return;
  if (pointerWithin) return;
  if (verifyPointer && !isBrowserPreview) {
    let inside = false;
    try { inside = await bridge.pointerInside(); } catch { /* Close on a disconnected window. */ }
    if (request !== hoverRequestVersion || pointerWithin || sliderDragging) return;
    if (inside) { pointerWithin = true; return; }
  }
  setExpanded(false);
}

async function playMotion({ phase, distance }) {
  const version = ++motionVersion;
  motionBusy = true;
  clearTimeout(hoverOpenTimer);
  clearTimeout(revealTimer);
  motionAnimation?.cancel();
  logoAnimation?.cancel();
  document.querySelector('.motion-logo')?.remove();
  deck.classList.remove('is-revealing');
  document.querySelectorAll('.preview-motion-controls button').forEach(button => { button.disabled = true; });
  await setExpanded(false);
  if (version !== motionVersion) return;
  deck.inert = true;
  deck.classList.add('is-moving');
  deck.dataset.motion = phase;
  const width = deck.getBoundingClientRect().width;
  const smallInset = Math.max(0, (width - Math.min(64, width)) / 2);
  const middleInset = Math.max(0, (width - Math.min(380, width)) / 2);
  const travel = Math.max(0, distance);
  const frames = [
    { offset: 0, opacity: 0, transform: `translateY(${travel}px)`, clipPath: `inset(0 ${smallInset}px round 26px)` },
    { offset: .5, opacity: 0, transform: `translateY(${travel}px)`, clipPath: `inset(0 ${smallInset}px round 26px)` },
    { offset: .55, opacity: .65, transform: `translateY(${travel * .94}px)`, clipPath: `inset(0 ${smallInset}px round 26px)` },
    { offset: .78, opacity: 1, transform: `translateY(${travel * .4}px)`, clipPath: `inset(0 ${middleInset}px round 26px)` },
    { offset: 1, opacity: 1, transform: 'translateY(0px)', clipPath: 'inset(0 0px round 26px)' },
  ];
  const dock = deck.getBoundingClientRect();
  const brand = deck.querySelector('.brand-mark').getBoundingClientRect();
  const centerX = dock.left + width / 2 - 24;
  const centerY = dock.top + travel + 26 - 24;
  const targetX = brand.left + brand.width / 2 - 24;
  const targetY = brand.top + brand.height / 2 - 24;
  const logo = document.createElement('span');
  logo.className = 'brand-mark motion-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = '<img src="orvix-logo.png" alt="" />';
  document.body.append(logo);
  const logoFrames = [
    { offset: 0, opacity: 0, transform: `translate(${centerX}px, ${centerY + 8}px) scale(.85)` },
    { offset: 1 / 12, opacity: 1, transform: `translate(${centerX}px, ${centerY}px) scale(1)` },
    { offset: .5, opacity: 1, transform: `translate(${centerX}px, ${centerY}px) scale(1)` },
    { offset: .78, opacity: 1, transform: `translate(${centerX + (targetX - centerX) * .6}px, ${targetY + travel * .4}px) scale(1.08)` },
    { offset: 1, opacity: 1, transform: `translate(${targetX}px, ${targetY}px) scale(${brand.width / 48})` },
  ];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const directionFrames = values => phase === 'close' ? values.slice().reverse().map(frame => ({ ...frame, offset: 1 - frame.offset })) : values;
  const options = { duration: reducedMotion ? 1 : 2400, easing: 'linear', fill: 'both' };
  motionAnimation = deck.animate(directionFrames(frames), options);
  logoAnimation = logo.animate(directionFrames(logoFrames), options);
  try { await Promise.all([motionAnimation.finished, logoAnimation.finished]); }
  catch { if (version !== motionVersion) return; }
  if (version !== motionVersion) return;
  previewClosed = phase === 'close';
  deck.style.opacity = previewClosed ? '0' : '1';
  motionAnimation.cancel();
  motionAnimation = undefined;
  deck.classList.remove('is-moving');
  if (!previewClosed) {
    deck.classList.add('is-revealing');
    revealTimer = setTimeout(() => deck.classList.remove('is-revealing'), 1200);
  }
  logoAnimation.cancel();
  logoAnimation = undefined;
  logo.remove();
  deck.inert = previewClosed;
  motionBusy = false;
  bridge.motionComplete(phase);
  pointerWithin = deck.matches(':hover');
  if (pointerWithin && !previewClosed) scheduleOpen();
  updateClock();
  document.querySelectorAll('.preview-motion-controls button').forEach(button => { button.disabled = false; });
  const toggle = document.getElementById('previewMotionToggle');
  if (toggle) toggle.textContent = previewClosed ? 'Open widget' : 'Close widget';
}

document.querySelectorAll('.bar-shortcut').forEach((button, index) => {
  button.style.setProperty('--wave-index', index);
});
deck.addEventListener('animationend', event => {
  if (event.animationName === 'shortcut-wave' && event.target === deck.querySelector('.bar-shortcut:last-child')) {
    deck.classList.remove('is-revealing');
  }
});

bridge.onMotion(motion => playMotion(motion));
if (isBrowserPreview) {
  const controls = document.createElement('div');
  controls.className = 'preview-motion-controls';
  controls.setAttribute('aria-label', 'Preview animation controls');
  controls.innerHTML = '<button type="button" id="previewMotionReplay">Replay entrance</button><button type="button" id="previewMotionToggle">Close widget</button>';
  document.body.append(controls);
  const previewDistance = () => Math.max(0, window.innerHeight / 2 - deck.getBoundingClientRect().top - 26);
  document.getElementById('previewMotionReplay').addEventListener('click', () => playMotion({ phase: 'open', distance: previewDistance() }));
  document.getElementById('previewMotionToggle').addEventListener('click', () => playMotion({ phase: previewClosed ? 'open' : 'close', distance: previewDistance() }));
  requestAnimationFrame(() => playMotion({ phase: 'open', distance: previewDistance() }));
}

function minimizePanel() {
  ++hoverRequestVersion;
  clearTimeout(hoverOpenTimer);
  hoverSuppressed = true;
  setExpanded(false);
}

function setDragging(dragging) {
  windowDragging = dragging;
  if (dragging) minimizePanel();
}

bridge.onDragState(setDragging);
if (isBrowserPreview) {
  document.querySelector('.drag-handle').addEventListener('pointerdown', () => setDragging(true));
  document.addEventListener('pointerup', () => setDragging(false));
  document.addEventListener('pointercancel', () => setDragging(false));
}

bridge.onHover(inside => {
  if (motionBusy || previewClosed) return;
  pointerWithin = inside;
  if (inside) scheduleOpen();
  else { hoverSuppressed = false; scheduleClose(); }
});

deck.addEventListener('pointerenter', event => {
  if (event.pointerType === 'touch') return;
  pointerWithin = true;
  scheduleOpen();
});
deck.addEventListener('pointerleave', event => {
  pointerWithin = false;
  hoverSuppressed = false;
  scheduleClose(event.isTrusted);
});
deck.addEventListener('focusin', () => {
  if (keyboardMode) setExpanded(true);
});
deck.addEventListener('focusout', event => {
  if (!deck.contains(event.relatedTarget) && !pointerWithin) scheduleClose();
});
window.addEventListener('keydown', event => {
  if (event.key === 'Tab') keyboardMode = true;
  if (event.key === 'Escape') {
    hoverSuppressed = true;
    sliderDragging = false;
    setExpanded(false);
  }
});
document.addEventListener('pointerdown', event => {
  keyboardMode = false;
  if (panel.contains(event.target) && event.target.matches('input[type="range"]')) sliderDragging = true;
});
const finishSliderDrag = () => {
  sliderDragging = false;
  if (!pointerWithin) scheduleClose();
};
document.addEventListener('pointerup', finishSliderDrag);
document.addEventListener('pointercancel', finishSliderDrag);
bridge.onBlur(() => {
  pointerWithin = false;
  keyboardMode = false;
  sliderDragging = false;
  setExpanded(false);
});

document.querySelectorAll('[data-launch]').forEach(button => {
  button.addEventListener('click', async () => {
    hoverSuppressed = true;
    setExpanded(false);
    let result;
    try { result = await bridge.launch(button.dataset.launch); }
    catch { result = { ok: false, error: 'That shortcut could not be opened.' }; }
    if (result?.ok) {
      const name = button.querySelector('.launch-text strong')?.textContent || button.querySelector('span')?.textContent || button.title;
      announce(result.preview ? `Preview only · ${name} would open in the desktop widget` : `Opening ${name}…`);
    } else {
      announce(result?.error || 'That shortcut could not be opened.', true);
    }
  });
});

volumeSlider.addEventListener('input', () => setSliderValue(volumeSlider, volumeValue, volumeSlider.value));
brightnessSlider.addEventListener('input', () => setSliderValue(brightnessSlider, brightnessValue, brightnessSlider.value));

volumeSlider.addEventListener('change', async () => {
  const result = await bridge.setVolume(volumeSlider.value);
  if (result?.ok) announce(`Volume set to ${result.value}%`);
  else announce(result?.error || 'Could not change system volume.', true);
});

brightnessSlider.addEventListener('change', async () => {
  const result = await bridge.setBrightness(brightnessSlider.value);
  if (result?.ok) announce(`Brightness set to ${result.value}%`);
  else announce(result?.error || 'Could not change display brightness.', true);
});

async function loadControls() {
  const state = await bridge.getControls();
  if (Number.isFinite(state?.volume)) {
    setSliderValue(volumeSlider, volumeValue, state.volume);
    volumeSlider.disabled = false;
  }
  else {
    volumeSlider.disabled = true;
    volumeValue.textContent = '—';
  }

  if (state?.brightnessSupported && Number.isFinite(state.brightness)) {
    setSliderValue(brightnessSlider, brightnessValue, state.brightness);
    brightnessSlider.disabled = false;
    brightnessRow.classList.remove('is-unavailable');
    brightnessHint.textContent = 'Display level';
    displayNote.textContent = isBrowserPreview ? 'Preview only · no system changes' : 'Changes apply to this device';
  } else {
    brightnessSlider.disabled = true;
    brightnessValue.textContent = '—';
    brightnessRow.classList.add('is-unavailable');
    brightnessHint.textContent = 'Not supported by this display';
    displayNote.textContent = 'Brightness depends on your display';
  }

  const statusText = panelStatus.querySelector('span:nth-child(2)');
  if (isBrowserPreview) statusText.textContent = 'Preview mode · controls are simulated';
  else if (state?.error) statusText.textContent = 'Windows controls are unavailable';
  else if (Number.isFinite(state?.volume)) statusText.textContent = 'System controls are ready';
  else statusText.textContent = 'Waiting for Windows controls';
}

function refreshControls() {
  if (controlsRequest || Date.now() - controlsReadAt < 30000) return;
  controlsRequest = loadControls().then(() => { controlsReadAt = Date.now(); }).catch(() => {
    panelStatus.querySelector('span:nth-child(2)').textContent = 'Could not read device controls';
    if (isExpanded) announce('Could not read this device’s controls.', true);
  }).finally(() => { controlsRequest = undefined; });
}

// Transparent space beneath the bar must pass clicks through to the desktop.
if (!isBrowserPreview) {
  document.addEventListener('mousemove', event => {
    if (motionBusy) return;
    if (event.movementX || event.movementY) keyboardMode = false;
    const interactive = !previewClosed && deck.contains(event.target);
    if (interactive !== pointerWithin) {
      pointerWithin = interactive;
      if (interactive) scheduleOpen();
      else { hoverSuppressed = false; scheduleClose(event.isTrusted); }
    }
  });
  document.addEventListener('mouseleave', event => {
    if (!motionBusy) {
      pointerWithin = false;
      hoverSuppressed = false;
      scheduleClose(event.isTrusted);
    }
  });
}

const clockTime = document.getElementById('clockTime');
const clockHours = document.getElementById('clockHours');
const clockMinutes = document.getElementById('clockMinutes');
const clockDate = document.getElementById('clockDate');
const clockPeriod = document.getElementById('clockPeriod');
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
let clockTimer;
let clockValue;
function updateClock() {
  clearTimeout(clockTimer);
  if (document.hidden || previewClosed) return;
  const now = new Date();
  const parts = timeFormat.formatToParts(now);
  const part = type => parts.find(value => value.type === type)?.value || '';
  const value = `${now.toDateString()} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
  if (clockValue !== value) {
    clockHours.textContent = part('hour');
    clockMinutes.textContent = part('minute');
    clockPeriod.textContent = part('dayPeriod');
    clockDate.textContent = dateFormat.format(now);
    clockTime.dateTime = now.toISOString();
    clockTime.setAttribute('aria-label', timeFormat.format(now));
    if (clockValue && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clockTime.animate([{ opacity: .5, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, easing: 'ease-out' });
    }
    clockValue = value;
  }
  clockTimer = setTimeout(updateClock, 60000 - Date.now() % 60000 + 25);
}
document.addEventListener('visibilitychange', updateClock);
window.addEventListener('focus', updateClock);
updateClock();
