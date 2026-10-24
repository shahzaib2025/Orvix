// Final bounded inspection through Orvix's existing preview API; no model call or website edit.
const fs = require('node:fs'), path = require('node:path');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const run = report.runs.find(item => item.profile === 'max');
const output = path.join(run.project, 'final-inspection');
fs.mkdirSync(output, { recursive: true });
const imageStore = createImageStore({ getPath: () => path.join(report.stateRoot, 'final-inspection') });
const preview = JSON.parse(fs.readFileSync(path.join(report.output, 'preview-url.json'), 'utf8'));
const base = { url: preview.url + run.label + '/', taskId: 'max-text-svg-final', imageStore,
  viewports: [{ label: 'desktop', width: 1440, height: 900 }, { label: 'mobile', width: 390, height: 844 }] };
const workflow = [
  { action: 'fill', selector: '#f-name', value: 'Jamie Tester' },
  { action: 'fill', selector: '#f-email', value: 'test@example.org' },
  { action: 'select', selector: '#f-kind', value: 'Land or season study' },
  { action: 'fill', selector: '#f-brief', value: 'Test inquiry: a landscape photography commission and one framed art print for a quiet reading room.' },
  { action: 'check', selector: '#f-ok', enabled: true },
  { action: 'press', selector: '#inquiryForm button[type="submit"]', key: 'Enter' },
  { action: 'assert', assertion: { kind: 'visible', selector: '#formResult', expected: 'visible' } },
  { action: 'assert', assertion: { kind: 'text', selector: '#formResult', expected: 'Jamie Tester', contains: true } }
];
(async () => {
  for (const reduced of [false, true]) {
    const key = reduced ? 'reduced' : 'normal';
    const result = await previewWebsite({ ...base, requestId: key, signal: AbortSignal.timeout(55000), reduced_motion: reduced, full_page: false, selector: reduced ? '#process' : '.hero', workflow });
    fs.writeFileSync(path.join(output, key + '-result.json'), JSON.stringify(result, null, 2));
    for (const view of result.views) {
      fs.copyFileSync(view.image.file, path.join(output, key + '-' + view.label + '.jpg'));
      console.log(JSON.stringify({ key, label: view.label, capture: view.capture, overflow: view.metrics.horizontalOverflow,
        broken: view.metrics.brokenImages, errors: view.errors, violations: view.accessibility.violations,
        workflow: view.workflow.status, failedSteps: view.workflow.steps.filter(step => step.status === 'failed') }));
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
