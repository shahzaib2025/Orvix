const fs = require('node:fs'), path = require('node:path');
const { previewWebsite, createPreviewSession } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const desktop = path.resolve(process.argv[2]), url = process.argv[3];
const evidenceRoot = fs.mkdtempSync(path.resolve(__dirname, '..', 'scratch', 'comparison-inspection-'));
const signal = new AbortController().signal, session = createPreviewSession(signal);
(async () => {
  for (const label of process.argv[4] ? [process.argv[4]] : ['Default', 'Medium', 'MAX']) {
    const folder = path.join(desktop, label);
    if (!fs.existsSync(path.join(folder, 'generation.json'))) continue;
    const run = JSON.parse(fs.readFileSync(path.join(folder, 'generation.json')));
    if (run.status !== 'agent_completed' && process.argv[8] !== '--allow-partial') continue;
    const screenshots = path.join(folder, 'screenshots'); fs.mkdirSync(screenshots, { recursive: true });
    const options = { url: url + '/' + label + '/', taskId: 'comparison-' + label.replace(/[^\w-]/g,'-'), signal, imageStore: createImageStore({ getPath: () => evidenceRoot }), browserSession: session };
    const report = process.argv[6] === 'flow-only' ? JSON.parse(fs.readFileSync(path.join(folder, 'inspection.json'))) : { label, model: 'Muse Spark 1.3', variant: 'xhigh', generationStatus: run.status, generationDurationMs: run.durationMs };
    for (const [name, captures] of process.argv[6] === 'flow-only' ? [] : [['hero', {}], ['full', { full_page: true }]]) {
      const result = await previewWebsite({ ...options, ...captures, requestId: name });
      report[name] = result.views.map(view => ({ label: view.label, metrics: view.metrics, errors: view.errors, violations: view.accessibility.violations, capture: view.capture }));
      for (const view of result.views) fs.copyFileSync(view.image.file, path.join(screenshots, view.label + '-' + name + '.jpg'));
    }
    if (process.argv[5]) {
      const workflow = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
      const result = await previewWebsite({ ...options, workflow, requestId: 'primary-action' });
      report.primaryAction = result.views.map(view => ({ label: view.label, workflow: view.workflow, errors: view.errors }));
    }
    if (process.argv[7]) {
      const motion = JSON.parse(fs.readFileSync(process.argv[7], 'utf8'));
      const result = await previewWebsite({ ...options, motion, requestId: 'motion', viewports: [{width:1440,height:900}] });
      report.motion = result.views.map(view => view.motion);
      for (const frame of result.views[0].motion.frames) fs.copyFileSync(frame.image.file, path.join(screenshots, 'motion-' + frame.label + '.jpg'));
      const reduced = await previewWebsite({ ...options, requestId: 'reduced', reduced_motion: true, full_page: true, viewports: [{width:390,height:844}] });
      report.reduced = reduced.views.map(view => ({ metrics: view.metrics, errors: view.errors }));
      fs.copyFileSync(reduced.views[0].image.file, path.join(screenshots, 'mobile-reduced.jpg'));
    }
    fs.writeFileSync(path.join(folder, 'inspection.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ label, durationMs: run.durationMs, views: report.full.map(v => ({ label: v.label, overflow: v.metrics.horizontalOverflow, brokenImages: v.metrics.brokenImages, errors: v.errors, violations: v.violations.map(x => x.id) })) }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => session.stop());
