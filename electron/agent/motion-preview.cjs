const { inspectViewportFit } = require('./viewport-fit.cjs');
const { inspectReadableContent } = require('./readable-content.cjs');
function validateMotion(value, viewportCount) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['section', 'observe_selectors', 'checkpoints', 'settle_ms', 'input'].includes(key))) throw new Error('Choose a bounded motion capture.');
  if (typeof value.section !== 'string' || !value.section.trim() || value.section.length > 300) throw new Error('Motion needs a bounded section selector.');
  if (viewportCount > 2) throw new Error('Motion capture supports at most two viewports.');
  if (!Array.isArray(value.checkpoints) || !value.checkpoints.length || value.checkpoints.length > 6) throw new Error('Choose one to six motion checkpoints.');
  for (const point of value.checkpoints) {
    if (!point || Object.keys(point).some(key => !['progress', 'label'].includes(key)) || !Number.isFinite(point.progress) || point.progress < -0.1 || point.progress > 1.1) throw new Error('Motion progress must be between -0.1 and 1.1.');
    if (point.label !== undefined && (typeof point.label !== 'string' || !point.label.trim() || point.label.length > 60)) throw new Error('Use bounded motion labels.');
  }
  if (value.observe_selectors !== undefined && (!Array.isArray(value.observe_selectors) || value.observe_selectors.length > 6 || value.observe_selectors.some(selector => typeof selector !== 'string' || !selector.trim() || selector.length > 300))) throw new Error('Observe at most six bounded selectors.');
  if (value.settle_ms !== undefined && (!Number.isInteger(value.settle_ms) || value.settle_ms < 0 || value.settle_ms > 500)) throw new Error('Motion settling must be between 0 and 500 ms.');
  if (value.input !== undefined && !['position', 'wheel'].includes(value.input)) throw new Error('Choose position or wheel sampling.');
}
async function captureMotion(page, motion, { signal, imageStore, taskId, requestId, label }) {
  const section = page.locator(motion.section);
  const sectionCount=await section.count();
  if (sectionCount !== 1) throw new Error(`Motion section must match exactly one element; ${sectionCount} matched ${JSON.stringify(motion.section)}. Use the unique scene ID from the actual HTML; do not select all sections. Correct this payload once rather than guessing repeated previews.`);
  const start = Date.now(), frames = [];
  const originalY = await page.evaluate(() => scrollY);
  try {
    for (let index = 0; index < motion.checkpoints.length; index++) {
      if (signal.aborted) throw new Error('Task cancelled.');
      if (Date.now() - start > 20000) throw new Error('Motion capture exceeded its 20-second viewport budget.');
      const point = motion.checkpoints[index];
      const target = await section.evaluate((element, progress) => {
        const rect = element.getBoundingClientRect();
        return Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, rect.top + scrollY + progress * Math.max(0, rect.height - innerHeight)));
      }, point.progress);
      if (motion.input === 'wheel') {
        await page.mouse.move(30, 30);
        await page.mouse.wheel(0, target - await page.evaluate(() => scrollY));
      } else await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), target);
      await page.waitForTimeout(motion.settle_ms ?? 180);
      const observations = await page.evaluate(({ sectionSelector, selectors }) => {
        const rect = element => { const box = element.getBoundingClientRect(); return { top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom }; };
        const observe = element => {
          const box = rect(element), style = getComputedStyle(element);
          const svg = element.namespaceURI === 'http://www.w3.org/2000/svg' ? {
            attributes: Object.fromEntries(['d','points','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','width','height','transform','viewBox']
              .filter(name => element.hasAttribute(name)).map(name => [name, element.getAttribute(name).slice(0, 1600)])),
            stroke: style.stroke, fill: style.fill, strokeDasharray: style.strokeDasharray, strokeDashoffset: style.strokeDashoffset,
          } : undefined;
          let shown = box.width > 0 && box.height > 0;
          for (let current = element; current; current = current.parentElement) { const css = getComputedStyle(current); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) shown = false; }
          const inViewport = box.bottom > 0 && box.top < innerHeight && box.left < innerWidth && box.left + box.width > 0;
          return { tag: element.tagName, visible: shown && inViewport, fullyVisible: shown && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.left + box.width <= innerWidth, rect: box, text: (element.innerText ?? element.textContent ?? '').trim().slice(0, 700), opacity: style.opacity, visibility: style.visibility, transform: style.transform, position: style.position,
            svg, paint: { color: style.color, backgroundPosition: style.backgroundPosition, clipPath: style.clipPath, fontVariationSettings: style.fontVariationSettings, letterSpacing: style.letterSpacing },
            imageSources: [...(element.matches('img') ? [element] : element.querySelectorAll('img'))].slice(0, 4).map(image => ({ src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth })), backgroundImage: style.backgroundImage.slice(0, 500) };
        };
        return { scrollY, viewportHeight: innerHeight, section: observe(document.querySelector(sectionSelector)), targets: selectors.map(selector => ({ selector, count: document.querySelectorAll(selector).length, elements: [...document.querySelectorAll(selector)].slice(0, 4).map(observe) })) };
      }, { sectionSelector: motion.section, selectors: motion.observe_selectors ?? [motion.section] });
      observations.viewportFit = await page.evaluate(inspectViewportFit);
      try { observations.readableContent = await page.evaluate(inspectReadableContent); } catch(error) { observations.readableContent={status:'unavailable',reason:String(error.message).slice(0,200)}; }
      const capture = await page.screenshot({ type: 'jpeg', quality: 65, animations: 'allow', timeout: 4000 });
      if (capture.length > 1_000_000) throw new Error('Motion frame exceeds the image size limit.');
      const frameLabel = `${label}-motion-${index + 1}`;
      frames.push({ label: point.label ?? `checkpoint-${index + 1}`, progress: point.progress, targetY: target, observations, image: { ...imageStore.savePreview(taskId, requestId, label, capture), name: frameLabel } });
    }
    return { section: motion.section, input: motion.input ?? 'position', animations: 'enabled', frames, note: 'Sampled images and visible-state observations; these do not establish continuous smoothness or frame rate.' };
  } finally { if (!signal.aborted) await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), originalY).catch(() => {}); }
}
module.exports = { validateMotion, captureMotion };
