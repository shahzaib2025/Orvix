const fs = require('node:fs');
const { runBrowserWorkflow } = require('./browser-workflow.cjs');
const { URL } = require('node:url');
const { createPreviewBrowser } = require('./preview-browser.cjs');
const { validateMotion, captureMotion } = require('./motion-preview.cjs');
const { captureComposition } = require('./design-composition.cjs');
const { inspectViewportFit } = require('./viewport-fit.cjs');
const { inspectReadableContent } = require('./readable-content.cjs');

function createPreviewSession(signal) {
  return createPreviewBrowser(signal, () => require('playwright-core').chromium.launch({ executablePath: browserPath(), headless: true, args: ['--no-first-run', '--disable-background-networking'] }));
}

function localUrl(value) {
  const url = new URL(String(value));
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Preview only accepts a local HTTP URL without credentials.');
  return url.href;
}

function browserPath() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error('Local preview needs Chrome or Edge installed on this computer.');
  return found;
}

function captureOptions({ viewports, full_page, selector, reduced_motion } = {}) {
  const selected = viewports ?? [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
  if (!Array.isArray(selected) || !selected.length || selected.length > 4) throw new Error('Choose one to four viewport sizes.');
  for (const view of selected) if (![view.width, view.height].every(size => Number.isInteger(size) && size >= 240 && size <= 2560)) throw new Error('Viewport dimensions must be integers from 240 to 2560.');
  if (full_page !== undefined && typeof full_page !== 'boolean') throw new Error('full_page must be boolean.');
  if (reduced_motion !== undefined && typeof reduced_motion !== 'boolean') throw new Error('reduced_motion must be boolean.');
  if (selector !== undefined && (typeof selector !== 'string' || !selector.trim() || selector.length > 300)) throw new Error('Provide a bounded section selector.');
  if (selector && full_page) throw new Error('Choose section capture or full-page capture.');
  return selected.map((view, index) => ({ ...view, label: viewports ? `viewport-${index + 1}` : index === 0 ? 'desktop' : 'mobile' }));
}

async function prepareFullPage(page, signal) {
  const originalY = await page.evaluate(() => scrollY), started = Date.now();
  let traversedTo = 0, bottomReached = false, steps = 0;
  try {
    for (; steps < 40 && Date.now() - started < 5000; steps++) {
      signal.throwIfAborted();
      const state = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight }));
      const bottom = Math.max(0, state.height - state.viewport);
      const target = Math.min(bottom, steps * Math.max(1, Math.floor(state.viewport * 0.75)));
      await page.evaluate(y => scrollTo({top:y,behavior:'instant'}), target);
      await page.waitForTimeout(75);
      traversedTo = target;
      if (target >= bottom) { bottomReached = true; steps++; break; }
    }
  } finally {
    // Whole-page screenshots must start at the top. Restoring the workflow's
    // lower scroll position can paint fixed navigation halfway down the image.
    if (!signal.aborted) { await page.evaluate(() => scrollTo({top:0,behavior:'instant'})); await page.waitForTimeout(150); }
  }
  return { steps, traversedTo, bottomReached, restoredY: await page.evaluate(() => scrollY), originalY,
    note: 'Bounded natural scroll activates scroll reveals/lazy content, then returns to the top for whole-page composition and fixed navigation. This is a traversed page, not an untouched initial state. Coverage may be partial and motion smoothness is not measured.' };
}

async function previewWebsite({ url, taskId, requestId, signal, imageStore, reference, interactions, assertions, workflow, viewports, full_page = false, selector, reduced_motion = false, browserSession, motion }) {
  const axe = require('axe-core');
  const target = localUrl(url);
  const selectedViews = captureOptions({ viewports, full_page, selector, reduced_motion });
  validateMotion(motion, selectedViews.length);
  if (signal.aborted) throw new Error('Task cancelled.');
  const session = browserSession ?? createPreviewSession(signal);
  let browser;
  try { browser = await session.get(); }
  catch (error) { if (!browserSession) await session.stop(); throw error; }
  const abort = () => { void browser.close(); };
  signal.addEventListener('abort', abort, { once: true });
  const views = [];
  try {
    for (const view of selectedViews) {
      if (signal.aborted) throw new Error('Task cancelled.');
      const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1, reducedMotion: reduced_motion ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      const errors = [];
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
      page.on('pageerror', error => errors.push(error.message.slice(0, 300)));
      page.on('requestfailed', request => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`.slice(0, 300)));
      try {
        await page.addInitScript(() => {
          window.__orvixLab = { lcp: 0, cls: 0 };
          try { new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__orvixLab.lcp = entry.startTime; })
            .observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported browser metric */ }
          try { new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__orvixLab.cls += entry.value; })
            .observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported browser metric */ }
        });
        await page.route('**/*', route => {
          if (route.request().isNavigationRequest()) {
            try { localUrl(route.request().url()); } catch { return route.abort(); }
          }
          return route.continue();
        });
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(350);
        const actionResults = [];
        for (const action of (Array.isArray(interactions) ? interactions : [])) {
          const selector = String(action.selector ?? '').slice(0, 300);
          try {
            const element = page.locator(selector);
            if (await element.count() !== 1) throw new Error('Interaction needs exactly one matching element.');
            if (action.action === 'click') await element.click({ timeout: 2500 });
            else if (action.action === 'fill') await element.fill(String(action.value ?? '').slice(0, 1000), { timeout: 2500 });
            else throw new Error('Unsupported interaction.');
            actionResults.push({ selector, action: action.action, status: 'performed' });
          } catch (error) { actionResults.push({ selector, status: 'failed', message: String(error).slice(0, 180) }); }
        }
        // Top-level assertions describe the final state after either action API.
        // Running them before workflow clicks creates false failures.
        const workflowResult = workflow?.length ? await runBrowserWorkflow(page, workflow, { signal, localUrl }) : null;
        const assertionResults = [];
        for (const assertion of (Array.isArray(assertions) ? assertions : [])) {
          const selector = String(assertion.selector ?? '').slice(0, 300);
          const expected = String(assertion.text ?? '').slice(0, 500);
          try {
            const element = page.locator(selector);
            if (await element.count() !== 1) throw new Error('Assertion needs exactly one matching element.');
            const actual = (await element.textContent({ timeout: 2500 })) ?? '';
            assertionResults.push({ selector, expected, status: actual.includes(expected) ? 'passed' : 'failed', actual: actual.slice(0, 250) });
          } catch (error) { assertionResults.push({ selector, expected, status: 'failed', message: String(error).slice(0, 180) }); }
        }
        if (workflowResult?.status === 'skipped' && workflowResult.steps.length === workflow.length
          && !workflowResult.steps.some(step => step.status === 'failed')
          && assertionResults.length && assertionResults.every(assertion => assertion.status === 'passed')) {
          workflowResult.status = 'passed';
          workflowResult.assertionCount += assertionResults.length;
        }
        const motionResult = motion ? await captureMotion(page, motion, { signal, imageStore, taskId, requestId, label: view.label }) : undefined;
        const fullPagePreparation = full_page ? await prepareFullPage(page, signal) : undefined;
        const metrics = await page.evaluate(() => {
          const root = document.documentElement;
          const controls = [...document.querySelectorAll('button,input,select,textarea')];
          const resources = performance.getEntriesByType('resource');
          const viewportClippedContent = [...document.querySelectorAll('a,button,input,select,textarea,h1,h2,p')].filter(el => {
            const bounds = el.getBoundingClientRect();
            if (!bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.top >= innerHeight || (bounds.left >= -2 && bounds.right <= innerWidth + 2)) return false;
            if (!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return false;
            // A keyboard skip link can be intentionally off-screen until focused.
            // Verify its semantic destination and actual focus layout rather than
            // ignoring every off-screen link (which could hide real clipping).
            if (el.matches('a[href^="#"]') && bounds.right < 0 && el.tabIndex >= 0) {
              const destination = document.getElementById(el.getAttribute('href').slice(1));
              if (destination?.matches('main,[role="main"],section,form') || destination?.closest('main,[role="main"]')) {
                const previous = document.activeElement;
                el.focus({preventScroll:true});
                const focused = el.getBoundingClientRect();
                const usable = document.activeElement === el && focused.width > 0 && focused.height > 0
                  && focused.left >= 0 && focused.right <= innerWidth && focused.top >= 0 && focused.bottom <= innerHeight
                  && el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
                if (previous instanceof HTMLElement && previous !== document.body) previous.focus({preventScroll:true});
                else el.blur();
                if (usable) return false;
              }
            }
            // Horizontal scrollers intentionally expose partial items. Body/root
            // clipping is not a substitute for fitting ordinary content.
            for (let parent=el.parentElement; parent && parent!==document.body && parent!==root; parent=parent.parentElement) {
              if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth>parent.clientWidth+2) return false;
            }
            return true;
          }).slice(0,20).map(el => { const b=el.getBoundingClientRect(); return {tag:el.tagName,id:el.id,text:(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,120),left:Math.round(b.left),right:Math.round(b.right)}; });
          return { title: document.title, viewportWidth: innerWidth, documentWidth: root.scrollWidth,
            documentHeight: root.scrollHeight,
            prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 40).map(el => ({ level: el.tagName, text: el.textContent.trim().slice(0, 160) })),
            designSignals: [...document.querySelectorAll('header,nav,main,section,footer,h1,h2,button')].slice(0, 40).map(el => {
              const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
              return { tag: el.tagName, id: el.id, x: Math.round(bounds.x), y: Math.round(bounds.y + scrollY), width: Math.round(bounds.width), height: Math.round(bounds.height),
                fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color, backgroundColor: style.backgroundColor, display: style.display };
            }),
            horizontalOverflow: root.scrollWidth > innerWidth + 2,
            hiddenAttributeOverrides: [...document.querySelectorAll('[hidden]')]
              .filter(el => el.getAttribute('hidden').toLowerCase() !== 'until-found'
                && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
              .slice(0, 8).map(el => ({ tag: el.tagName, id: el.id,
                text: (el.textContent || '').trim().slice(0, 120), display: getComputedStyle(el).display })),
            viewportClippedContent,
            unlabeledControls: controls.filter(el => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.labels?.length && !el.textContent?.trim() && !el.getAttribute('title')).length,
            brokenImages: [...document.images].filter(img => img.complete && img.naturalWidth === 0).length,
            pendingImages: [...document.images].filter(img => !img.complete).length,
            imagesMissingAlt: [...document.images].filter(img => !img.hasAttribute('alt')).length,
            interactiveControls: controls.length,
            loadMilliseconds: Math.round(performance.getEntriesByType('navigation')[0]?.duration ?? 0),
            firstContentfulPaintMilliseconds: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0),
            largestContentfulPaintMilliseconds: Math.round(window.__orvixLab?.lcp ?? 0),
            cumulativeLayoutShift: Math.round((window.__orvixLab?.cls ?? 0) * 1000) / 1000,
            resourceCount: resources.length,
            transferredKilobytes: Math.round(resources.reduce((sum, item) => sum + (item.transferSize || 0), 0) / 1024) };
        });
        // Reuse this browser visit; no extra capture or model review is needed.
        try { metrics.composition = await page.evaluate(captureComposition); } catch { metrics.composition = null; }
        try { metrics.viewportFit = await page.evaluate(inspectViewportFit); } catch (error) { metrics.viewportFit = { status: 'unavailable', reason: String(error.message).slice(0, 200) }; }
        try { metrics.readableContent = await page.evaluate(inspectReadableContent); } catch (error) { metrics.readableContent = { status: 'unavailable', reason: String(error.message).slice(0, 200) }; }
        let accessibility;
        try {
          await page.addScriptTag({ content: axe.source });
          accessibility = await page.evaluate(async () => {
            const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
            return { violations: result.violations.map(item => ({ id: item.id, impact: item.impact, affected: item.nodes.length,
              targets: item.nodes.slice(0, 3).map(node => node.target.join(' ')) })), incomplete: result.incomplete.length };
          });
        } catch (error) { accessibility = { error: String(error).slice(0, 250) }; }
        let capture;
        const captureTarget = selector ? page.locator(selector) : page;
        if (selector && await captureTarget.count() !== 1) throw new Error('Section capture needs exactly one matching element.');
        if (selector) {
          const bounds = await captureTarget.boundingBox();
          if (!bounds || bounds.width * bounds.height > 24_000_000) throw new Error('Section is hidden or exceeds the 24 megapixel capture limit.');
        }
        // Long MAX pages still need overview evidence. Scale the raster at the
        // browser surface, retaining the real CSS viewport/layout and limits.
        const overviewScale = full_page ? Math.min(1, Math.sqrt(23_500_000 / (metrics.documentHeight * metrics.documentWidth)),
          16000 / metrics.documentHeight, 16000 / metrics.documentWidth) : 1;
        let overview;
        if (overviewScale < 1) {
          overview = { scale: overviewScale, cssWidth: metrics.documentWidth, cssHeight: metrics.documentHeight,
            note: 'Scaled whole-page overview at the original CSS viewport. Small text and detailed motion need section captures; bounded traversal may leave off-screen reveals unobserved.' };
          const cdp = await context.newCDPSession(page);
          try {
            for (const quality of [72, 55, 40]) {
              let timer;
              try {
                const result = await Promise.race([
                  cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: true,
                    clip: { x: 0, y: 0, width: metrics.documentWidth, height: metrics.documentHeight, scale: overviewScale } }),
                  new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scaled overview capture timed out.')), 15000); }),
                ]);
                capture = Buffer.from(result.data, 'base64');
              } finally { clearTimeout(timer); }
              if (capture.length <= 1_000_000) break;
            }
          } finally { await cdp.detach().catch(() => {}); }
        } else {
          for (const quality of [72, 55, 40]) {
            capture = await captureTarget.screenshot({ type: 'jpeg', quality, animations: 'disabled', timeout: 15000, ...(selector ? {} : { fullPage: full_page }) });
            if (capture.length <= 1_000_000) break;
          }
        }
        const image = imageStore.savePreview(taskId, requestId, view.label, capture);
        let referenceDifference = null;
        if (reference && view.label === 'desktop') {
          try { referenceDifference = await page.evaluate(async ({ referenceData, referenceMime, actualData }) => {
            const decode = source => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source; });
            const a = await decode(`data:${referenceMime};base64,${referenceData}`);
            const b = await decode(`data:image/jpeg;base64,${actualData}`);
            const bitmap = image => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 375; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 600, 375); return context.getImageData(0, 0, 600, 375).data; };
            const first = bitmap(a), second = bitmap(b);
            let sum = 0, samples = 0;
            for (let index = 0; index < first.length; index += 16) { sum += Math.abs(first[index] - second[index]) + Math.abs(first[index + 1] - second[index + 1]) + Math.abs(first[index + 2] - second[index + 2]); samples += 3; }
            return Math.round(sum / (samples * 255) * 1000) / 10;
          }, { referenceData: imageStore.read(reference), referenceMime: reference.mime, actualData: capture.toString('base64') }); }
          catch { /* A numeric comparison is optional. */ }
        }
        views.push({ ...view, capture: { fullPage: full_page, selector: selector ?? null, reducedMotion: reduced_motion, ...(fullPagePreparation ? { preparation: fullPagePreparation } : {}), ...(overview ? { overview } : {}) }, metrics, accessibility, workflow: workflowResult, interactions: actionResults, assertions: assertionResults, errors: errors.slice(0, 20), image, referenceDifference, ...(motionResult ? { motion: motionResult } : {}) });
      } finally { await context.close(); }
    }
    return { url: target, views, images: views.flatMap(view => view.motion?.frames.map(frame => frame.image) ?? []), referenceImage: reference ? { file: reference.file, mime: reference.mime } : null,
      note: 'Load time and pixel difference are lab signals, not field Web Vitals or visual quality scores. Inspect the screenshots and interactions. Broken images are completed failed loads; pending images include off-screen lazy content and are not confirmed loaded.' };
  } finally { signal.removeEventListener('abort', abort); if (!browserSession) await session.stop(); }
}

module.exports = { previewWebsite, createPreviewSession, localUrl, captureOptions };
