// Serialized into the preview page. No application globals or dependencies.
function inspectViewportFit() {
  const tolerance = 3;
  const essential = 'a,button,input,select,textarea,h1,h2,h3,p,li,label,figcaption,pre,table,img[alt]:not([alt=""]),svg[role="img"],[role="img"][aria-label],[data-fit-essential]';
  const shown = element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    for (let node = element; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (node.getAttribute('aria-hidden') === 'true' || css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= .01) return false;
    }
    return true;
  };
  const name = element => element.id ? '#' + element.id : element.tagName.toLowerCase() + (element.classList[0] ? '.' + element.classList[0] : '');
  const box = element => { const r = element.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
  // Dense vector drawings must not exhaust the candidate budget before later
  // story sections. SVG descendants do not form CSS sticky/fixed boxes.
  const all = [...document.querySelectorAll('body *')].filter(element => element.namespaceURI === 'http://www.w3.org/1999/xhtml' || element.localName === 'svg').slice(0, 2500);
  const activePins = new Set();
  try { for (const trigger of window.ScrollTrigger?.getAll?.() ?? []) if (trigger.isActive && trigger.pin) activePins.add(trigger.pin); } catch {}
  const roots = all.filter(element => {
    if (!shown(element)) return false;
    const css = getComputedStyle(element), r = element.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return false;
    if (activePins.has(element) || css.position === 'fixed') return true;
    if (css.position !== 'sticky') return false;
    const top = parseFloat(css.top), bottom = parseFloat(css.bottom);
    return Number.isFinite(top) && Math.abs(r.top - top) <= tolerance
      || Number.isFinite(bottom) && Math.abs(innerHeight - r.bottom - bottom) <= tolerance;
  }).filter((element, _index, candidates) => !candidates.some(other => other !== element && other.contains(element))).slice(0, 12);
  const chrome = [...document.querySelectorAll('header,nav,[role="banner"],footer,[role="contentinfo"]')].filter(element => {
    if (!shown(element)) return false;
    const css = getComputedStyle(element), r = element.getBoundingClientRect();
    return ['fixed','sticky'].includes(css.position) && r.width >= innerWidth * .5 && r.height < innerHeight * .4;
  });
  const failures = [], lockedRegions = [];
  for (const root of roots) {
    let usableTop = 0, usableBottom = innerHeight;
    for (const bar of chrome) {
      if (bar.contains(root) || root.contains(bar)) continue;
      const r = bar.getBoundingClientRect();
      if (r.top <= tolerance && r.bottom > 0) usableTop = Math.max(usableTop, r.bottom);
      if (r.bottom >= innerHeight - tolerance && r.top < innerHeight) usableBottom = Math.min(usableBottom, r.top);
    }
    const clipped = [];
    const elements = [...(root.matches(essential) ? [root] : []), ...root.querySelectorAll(essential)].slice(0, 160);
    for (const element of elements) {
      if (!shown(element)) continue;
      // Prefer the specific reading/control node over its containing list/table.
      if (element.matches('li,table') && element.querySelector(essential)) continue;
      const r = element.getBoundingClientRect();
      let top = usableTop, bottom = usableBottom, scrollable = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/^(auto|scroll)$/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight + tolerance
          && bounds.top >= usableTop - tolerance && bounds.bottom <= usableBottom + tolerance) { scrollable = true; break; }
        if (/^(hidden|clip)$/.test(css.overflowY)) {
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
        if (parent === root) break;
      }
      if (scrollable || r.top >= top - tolerance && r.bottom <= bottom + tolerance) continue;
      clipped.push({ element: name(element), text: (element.textContent || element.getAttribute('alt') || element.getAttribute('aria-label') || '').trim().slice(0, 100),
        ...box(element), clippedAbove: Math.round(Math.max(0, top - r.top)), clippedBelow: Math.round(Math.max(0, r.bottom - bottom)) });
      if (clipped.length === 6) break;
    }
    const region = { root: name(root), position: getComputedStyle(root).position, ...box(root), usableTop: Math.round(usableTop), usableBottom: Math.round(usableBottom), clipped };
    lockedRegions.push(region);
    if (clipped.length) failures.push(region);
  }
  return { viewportWidth: innerWidth, viewportHeight: innerHeight, lockedRegions, failures,
    limitation: 'Bounded current-state check of readable semantic content in active fixed/sticky or publicly observable pins. Partial visibility is not full fit. Decorative artwork, transparent entrances and fitting internal scrollers are excluded. Custom transform pins without a public active state may require explicit motion inspection.' };
}
function viewportFitFailures(view) {
  return [...(view.metrics?.viewportFit?.status === 'unavailable' ? [{ state: 'viewport', unavailable: true, reason: view.metrics.viewportFit.reason }] : []),
    ...(view.metrics?.viewportFit?.failures ?? []).map(value => ({ state: 'viewport', ...value })),
    ...(view.motion?.frames ?? []).flatMap(frame => (frame.observations?.viewportFit?.failures ?? []).map(value => ({ state: frame.label, progress: frame.progress, ...value })))].slice(0, 12);
}
module.exports = { inspectViewportFit, viewportFitFailures };
