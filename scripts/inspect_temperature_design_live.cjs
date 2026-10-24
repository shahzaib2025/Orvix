const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const root = path.resolve(process.argv[2]);
const experiment = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8'));
const selectedLabel = process.argv[3];
const imageRoot = path.join(experiment.output, '_inspection');
fs.mkdirSync(imageRoot, { recursive: true });
const report = { experiment: root, modelId: experiment.modelId, profile: experiment.designProfile, runs: [] };
if (selectedLabel && fs.existsSync(path.join(root, 'inspection.json'))) {
  report.runs = JSON.parse(fs.readFileSync(path.join(root, 'inspection.json'), 'utf8')).runs.filter(run => run.label !== selectedLabel);
}
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(experiment.output, '.' + pathname);
    if (file !== experiment.output && !file.startsWith(experiment.output + path.sep)) { response.writeHead(403).end(); return; }
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});
let browser;
const metrics = () => {
  const box = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { tag: element.tagName, class: String(element.className?.baseVal ?? element.className ?? ''), text: (element.innerText ?? element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').slice(0, 100),
      x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), opacity: style.opacity,
      font: style.fontFamily, columns: style.gridTemplateColumns };
  };
  return { title: document.title, width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
    heading: document.querySelector('h1') ? box(document.querySelector('h1')) : null,
    primaryRegions: [...document.querySelectorAll('main,main>*,[class*=hero],[class*=visual],[class*=stage]')].map(box).filter(item => item.width > 30 && item.height > 20).slice(0, 22),
    brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.currentSrc),
    imageStates: [...document.images].map(image => ({ url: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth })),
    images: [...document.images].map(box), svgs: [...document.querySelectorAll('svg')].length,
    motion: { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, activeAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length } };
};
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(file => fs.existsSync(file));
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-first-run', '--disable-background-networking'] });
  for (const run of experiment.runs.filter(item => (!selectedLabel || item.label === selectedLabel) && ['returned', 'failed'].includes(item.status) && fs.existsSync(path.join(item.project, 'index.html')))) {
    const inspected = { label: run.label, temperature: run.temperature, generationStatus: run.status, generationError: run.error, durationMs: run.durationMs, views: [] };
    report.runs.push(inspected);
    for (const [label, viewport, reducedMotion] of [['desktop', { width: 1440, height: 900 }, 'no-preference'], ['mobile', { width: 390, height: 844 }, 'no-preference'], ['reduced', { width: 1440, height: 900 }, 'reduce']]) {
      const context = await browser.newContext({ viewport, reducedMotion });
      const page = await context.newPage(), errors = [], failedRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(path.basename(run.project))}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 4000))]));
        await page.evaluate(() => Promise.race([Promise.all([...document.images].map(image => image.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 15000))]));
        await page.waitForTimeout(2000);
        const view = { label, metrics: await page.evaluate(metrics), errors, failedRequests };
        inspected.views.push(view);
        view.screenshot = path.join(imageRoot, run.label + '-' + label + '.png');
        await page.screenshot({ path: view.screenshot, fullPage: true });
        await page.addScriptTag({ content: require('axe-core').source });
        view.accessibility = await page.evaluate(async () => {
          const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
          return { violations: result.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.length })), incomplete: result.incomplete.map(item => item.id) };
        });
        if (label !== 'reduced') {
          const candidates = page.locator('button, a[role="button"]');
          let action;
          for (let index = 0; index < await candidates.count(); index++) {
            const candidate = candidates.nth(index);
            if (await candidate.isVisible() && !(await candidate.evaluate(element => !!element.closest('dialog,[role="dialog"]'))) && /demo|preview|greeting|create|write|compose|try|start|send|personal/i.test(await candidate.innerText())) { action = candidate; break; }
          }
          if (!action) view.flow = { passed: false, reason: 'No visible primary demo action found' };
          else {
            await action.click();
            const dialogs = page.locator('dialog:visible,[role="dialog"]:visible');
            const dialog = page.locator('dialog,[role="dialog"]').first();
            await dialog.waitFor({ state: 'visible', timeout: 2000 });
            const opened = await dialogs.count() > 0;
            await page.keyboard.press('Escape');
            let escapeClosed = false;
            try { await dialog.waitFor({ state: 'hidden', timeout: 2000 }); escapeClosed = true; } catch {}
            await action.click();
            await dialog.waitFor({ state: 'visible', timeout: 2000 });
            const close = dialog.getByRole('button', { name: /close/i }).first();
            let closeWorked = false;
            if (await close.count()) {
              await close.click();
              try { await dialog.waitFor({ state: 'hidden', timeout: 2000 }); closeWorked = true; } catch {}
            }
            view.flow = { opened, escapeClosed, closeWorked, passed: opened && escapeClosed && closeWorked };
          }
        }
      } catch (error) { inspected.views.push({ label, error: error.message }); }
      finally { await context.close(); fs.writeFileSync(path.join(root, 'inspection.json'), JSON.stringify(report, null, 2)); }
    }
  }
  console.log(JSON.stringify({ inspected: report.runs.map(run => ({ label: run.label, views: run.views.map(view => ({ label: view.label, overflow: view.metrics ? view.metrics.documentWidth > view.metrics.width : null, errors: view.errors, flow: view.flow, error: view.error })) })), imageRoot }, null, 2));
})().catch(error => { report.error = error.message; console.error(error.stack); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); server.closeAllConnections(); server.close(); fs.writeFileSync(path.join(root, 'inspection.json'), JSON.stringify(report, null, 2)); });
