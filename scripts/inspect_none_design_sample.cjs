// Observe the fresh None sample without editing its source or re-running the builder.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { listenBrowserLoopback } = require('../electron/agent/browser-loopback.cjs');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const reportFile = path.resolve(process.argv[2]);
const generation = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const run = generation.runs.find(item => item.profile === 'none');
if (!run?.noneEvidence?.passed) throw Error('A completed None routing sample is required.');
const project = path.resolve(run.project), output = path.resolve(generation.output);
const server = http.createServer((request, response) => {
  const target = path.resolve(project, '.' + (new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname));
  if (!target.startsWith(project + path.sep)) { response.writeHead(403); response.end(); return; }
  response.setHeader('content-type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[path.extname(target)] ?? 'application/octet-stream');
  try { response.end(fs.readFileSync(target)); } catch { response.writeHead(404); response.end(); }
});
(async () => {
  await listenBrowserLoopback(server);
  const app = { getPath: () => path.dirname(reportFile) }, signal = AbortSignal.timeout(60000);
  const result = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}/`, taskId: 'none-followup', requestId: 'inspect', signal, imageStore: createImageStore(app), full_page: true,
    workflow: [
      { action: 'click', selector: '#inquiry-form button[type="submit"]' },
      { action: 'assert', assertion: { kind: 'visible', selector: '#err-name' } },
      { action: 'fill', selector: '#f-name', value: 'None Mode Test' },
      { action: 'fill', selector: '#f-email', value: 'none@example.com' },
      { action: 'fill', selector: '#f-msg', value: 'Please tell me about the illustrative chair.' },
      { action: 'check', selector: '#f-consent', enabled: true },
      { action: 'click', selector: '#inquiry-form button[type="submit"]' },
      { action: 'assert', assertion: { kind: 'text', selector: '#form-status', expected: 'Received locally', contains: true } },
      { action: 'reload' },
      { action: 'assert', assertion: { kind: 'value', selector: '#f-name', expected: 'None Mode Test' } },
      { action: 'click', selector: '#clear-btn' },
      { action: 'assert', assertion: { kind: 'storage', key: 'oriel-inquiry-draft-v1', expected: null } },
    ] });
  const summary = { generationTimeMs: run.durationMs, model: run.model, variant: run.variant, noneRouting: run.noneEvidence, originalGenerationVerification: run.verification.status,
    originalFailure: 'The builder used exact text matching for a longer confirmation. Original evidence is retained in generation-report.json.',
    views: result.views.map(view => ({ label: view.label, workflow: view.workflow, metrics: view.metrics, accessibility: view.accessibility, errors: view.errors, image: view.image })) };
  for (const view of summary.views) { const file = path.join(output, `none-${view.label}.jpg`); fs.copyFileSync(view.image.file, file); view.screenshot = file; }
  fs.writeFileSync(path.join(output, 'inspection-report.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.views.map(view => ({ label: view.label, workflow: view.workflow.status, overflow: view.metrics.horizontalOverflow, brokenImages: view.metrics.brokenImages, errors: view.errors, screenshot: view.screenshot })), null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
