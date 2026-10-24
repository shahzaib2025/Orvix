const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { previewWebsite, createPreviewSession } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const root = path.resolve(process.argv[2] ?? '');
if (!fs.existsSync(path.join(root, 'result.json'))) throw Error('Supply a saved Design MAX run directory.');
const run = JSON.parse(fs.readFileSync(path.join(root, 'result.json')));
const project = path.join(root, 'project'), screenshots = path.join(root, 'screenshots'); fs.mkdirSync(screenshots, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(project, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(project + path.sep) || !mime[path.extname(file)]) throw Error('Outside preview assets');
    response.writeHead(200, { 'content-type': mime[path.extname(file)] }); response.end(fs.readFileSync(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
const controller = new AbortController(), browserSession = createPreviewSession(controller.signal);
const report = { root, agentStatus: run.status, profile: run.actualDesignProfile, status: 'inspecting' };
const save = () => fs.writeFileSync(path.join(root, 'inspection.json'), JSON.stringify(report, null, 2));
const copyViews = (result, suffix) => { for (const view of result.views) fs.copyFileSync(view.image.file, path.join(screenshots, `${view.label}-${suffix}.jpg`)); };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const options = { url: `http://127.0.0.1:${server.address().port}`, taskId: 'aster-test', signal: controller.signal, imageStore: createImageStore({ getPath: () => path.join(root, 'independent') }), browserSession };
  report.hero = await previewWebsite({ ...options, requestId: 'hero' }); copyViews(report.hero, 'hero'); save(); console.log('Hero screenshots saved');
  report.full = await previewWebsite({ ...options, requestId: 'full', full_page: true }); copyViews(report.full, 'full'); save(); console.log('Full page screenshots saved');
  report.motion = await previewWebsite({ ...options, requestId: 'motion', viewports: [{ width: 1440, height: 900 }], motion: { section: '#journey', observe_selectors: ['#journey-stage', '[data-story-copy]', '[data-story-media]', '#visit'], input: 'wheel', settle_ms: 350,
    checkpoints: [{ progress: 0, label: 'entry' }, { progress: 0.45, label: 'middle' }, { progress: 0.9, label: 'last-chapter' }, { progress: 1.1, label: 'release' }, { progress: 0.45, label: 'reverse-middle' }, { progress: 0, label: 'reverse-entry' }] } });
  for (const frame of report.motion.views[0].motion.frames) fs.copyFileSync(frame.image.file, path.join(screenshots, `motion-${frame.label}.jpg`)); save(); console.log('Motion checkpoint screenshots saved');
  report.flow = await previewWebsite({ ...options, requestId: 'visit', workflow: [{ action: 'click', selector: 'header [data-action="book"]' }, { action: 'assert', assertion: { kind: 'visible', selector: '#visit' } }, { action: 'fill', selector: '#visit-email', value: 'visitor@example.com' }, { action: 'click', selector: '[data-action="submit-visit"]' }, { action: 'assert', assertion: { kind: 'text', selector: '[data-testid="visit-state"]', expected: 'Visit request received' } }] });
  report.reduced = await previewWebsite({ ...options, requestId: 'reduced', reduced_motion: true, viewports: [{ width: 390, height: 844 }], full_page: true }); copyViews(report.reduced, 'reduced');
  report.summary = report.flow.views.map(view => ({ label: view.label, flow: view.workflow.status, overflow: view.metrics.horizontalOverflow, brokenImages: view.metrics.brokenImages, errors: view.errors, accessibilityViolations: view.accessibility.violations.length }));
  report.status = report.summary.every(view => view.flow === 'passed' && !view.overflow && !view.brokenImages && !view.errors.length) ? 'functional_checks_passed' : 'issues_found';
  save(); console.log(JSON.stringify({ status: report.status, screenshots, summary: report.summary }));
})().catch(error => { report.status = 'inspection_failed'; report.error = String(error.message ?? error); save(); console.error(report.error); process.exitCode = 1; }).finally(async () => { await browserSession.stop(); await new Promise(resolve => server.close(resolve)); });
