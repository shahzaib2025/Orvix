// Fixed page operations only. Page text never becomes executable instructions.
(() => {
  if (globalThis.__orvixBrowserPage) return;
  const documentKey = crypto.randomUUID();
  let sequence = 0;
  const nodes = new Map();
  const refs = new WeakMap();
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  function visible(el) {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function label(el) {
    const labelled = el.getAttribute('aria-labelledby')?.split(/\s+/).map(id => el.getRootNode().getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || '').join(' ');
    const externalLabel = el.labels?.[0]?.cloneNode(true);
    externalLabel?.querySelectorAll('input,select,textarea,button').forEach(control => control.remove());
    return norm(el.getAttribute('aria-label') || labelled || externalLabel?.textContent || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder')).slice(0, 180);
  }
  function describe(el) {
    const rect = el.getBoundingClientRect();
    return { ref: refs.get(el), role: el.getAttribute('role') || el.tagName.toLowerCase(), name: label(el),
      editable: el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(el.type),
      type: el.getAttribute('type') || '', disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      checked: typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked'),
      selected: el.selected ?? el.getAttribute('aria-selected'),
      value: el.type === 'password' || el.type === 'file' ? '[redacted]' : typeof el.value === 'string' ? el.value.slice(0, 500) : el.isContentEditable ? norm(el.innerText).slice(0, 500) : undefined,
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, visible: visible(el),
      media: el instanceof HTMLMediaElement ? { paused: el.paused, muted: el.muted, volume: el.volume, currentTime: el.currentTime } : undefined,
      options: el instanceof HTMLSelectElement ? [...el.options].slice(0, 50).map(option => ({ value: option.value, label: option.text, selected: option.selected, disabled: option.disabled || !!option.closest('optgroup')?.disabled })) : undefined };
  }
  function elements(root = document) {
    const found = [];
    function visit(container) {
      for (const el of container.querySelectorAll('*')) {
        if (el.matches('a[href],button,input,textarea,select,video,audio,canvas,summary,[role],[contenteditable="true"],[tabindex]') && (visible(el) || el.matches('input[type="file"]'))) found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    }
    visit(root);
    return found;
  }
  function observe({ query = '', offset = 0 } = {}) {
    for (const [ref, entry] of nodes) if (!entry.node.isConnected) nodes.delete(ref);
    const candidates = elements().filter(el => !query || label(el).toLowerCase().includes(query.toLowerCase()));
    const selected = candidates.slice(offset, offset + 100);
    for (const el of selected) {
      let ref = refs.get(el);
      const fingerprint = JSON.stringify([location.href, label(el), el.tagName, el.getAttribute('role'), el.getAttribute('type'), el.getAttribute('href')]);
      if (!ref || !nodes.has(ref) || nodes.get(ref).fingerprint !== fingerprint) { ref = `${documentKey}.${++sequence}`; refs.set(el, ref); }
      nodes.set(ref, { node: el, fingerprint });
    }
    return { documentKey, url: location.href, title: document.title, readyState: document.readyState,
      text: norm(document.body?.innerText).slice(0, 16000), elements: selected.map(describe),
      totalElements: candidates.length, nextOffset: offset + 100 < candidates.length ? offset + 100 : null,
      scroll: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight }, timestamp: Date.now() };
  }
  function get(ref) {
    const entry = nodes.get(ref);
    if (!entry || !entry.node.isConnected || entry.fingerprint !== JSON.stringify([location.href, label(entry.node), entry.node.tagName, entry.node.getAttribute('role'), entry.node.getAttribute('type'), entry.node.getAttribute('href')])) {
      return { status: 'stale_target', message: 'The page element changed. Inspect the fresh page before acting.', observation: observe() };
    }
    return entry.node;
  }
  function prepare({ ref, action, scroll = true }) {
    const el = get(ref);
    if (!(el instanceof Element)) return el;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || action === 'type' && el.readOnly) return { status: 'failed', message: 'The requested control is disabled or read-only.' };
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
    const marker = crypto.randomUUID();
    el.setAttribute('data-orvix-target', marker);
    return { status: 'ok', marker, ...describe(el), contentEditable: el.isContentEditable, action };
  }
  function operate({ action, ref, value, enabled, x = 0, y = 500, seconds, volume }) {
    if (action === 'scroll' && !ref) { scrollBy({ left: x, top: y, behavior: 'instant' }); return { status: 'ok', verified: true, scroll: { x: scrollX, y: scrollY } }; }
    const el = get(ref);
    if (!(el instanceof Element)) return el;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { status: 'failed', message: 'The control is disabled.' };
    if (action === 'focus') { el.focus?.({ preventScroll: true }); return { status: el.getRootNode().activeElement === el ? 'ok' : 'unsupported', message: 'Focus the exact identified control before keyboard input.' }; }
    if (action === 'select') {
      if (!(el instanceof HTMLSelectElement)) return { status: 'invalid_request', message: 'Target an observed select control.' };
      const enabledOptions = [...el.options].filter(option => !option.disabled && !option.closest('optgroup')?.disabled);
      const matching = enabledOptions.filter(option => option.value === value);
      const labels = enabledOptions.filter(option => option.text === value);
      const chosen = matching.length === 1 ? matching[0] : labels.length === 1 ? labels[0] : null;
      if (!chosen) return { status: 'invalid_request', message: 'Choose an exact enabled option value or a unique exact label.', element: describe(el) };
      el.value = chosen.value;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return { status: el.value === chosen.value ? 'ok' : 'failed', verified: el.value === chosen.value, element: describe(el) };
    }
    if (action === 'scroll') { el.scrollBy({ left: x, top: y, behavior: 'instant' }); return { status: 'ok', verified: true, scroll: { x: el.scrollLeft, y: el.scrollTop } }; }
    if (action.startsWith('media_')) {
      if (!(el instanceof HTMLMediaElement)) return { status: 'invalid_request', message: 'Target an observed audio/video element.' };
      return (async () => {
        try {
          if (action === 'media_play') await el.play();
          if (action === 'media_pause') el.pause();
          if (action === 'media_mute') el.muted = enabled;
          if (action === 'media_volume') el.volume = volume;
          if (action === 'media_seek') el.currentTime = seconds;
          await new Promise(resolve => setTimeout(resolve, 200));
          const ok = action === 'media_play' ? !el.paused : action === 'media_pause' ? el.paused : action === 'media_mute' ? el.muted === enabled : action === 'media_volume' ? Math.abs(el.volume - volume) < .01 : Math.abs(el.currentTime - seconds) < 1;
          return { status: ok ? 'ok' : 'failed', verified: ok, element: describe(el) };
        } catch (error) { return { status: error.name === 'NotAllowedError' ? 'autoplay_blocked' : 'failed', message: error.message }; }
      })();
    }
    if (action === 'state') return { status: 'ok', element: describe(el), fileCount: el.files?.length, fileNames: el.files ? [...el.files].map(file => file.name) : undefined, value: el.type === 'password' || el.type === 'file' ? undefined : el.isContentEditable ? norm(el.innerText) : el.value, checked: el.checked };
    return { status: 'unsupported', message: 'Unsupported page operation.' };
  }
  function youtubePlayControl() {
    if (!['youtube.com', 'www.youtube.com'].includes(location.hostname) || location.pathname !== '/watch') return { status: 'unsupported' };
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { status: 'unavailable' };
    if (!video.paused) return { status: 'already_playing' };
    const el = [...document.querySelectorAll('button.ytp-play-button, button.ytp-large-play-button')].find(visible);
    if (!el) return { status: 'unavailable' };
    const ref = `${documentKey}.${++sequence}`; refs.set(el, ref);
    nodes.set(ref, { node: el, fingerprint: JSON.stringify([location.href, label(el), el.tagName, el.getAttribute('role'), el.getAttribute('type'), el.getAttribute('href')]) });
    return { status: 'ok', ref, videoId: new URL(location.href).searchParams.get('v') };
  }
  globalThis.__orvixBrowserPage = { observe, prepare, operate, youtubePlayControl };
})();
