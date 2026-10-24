const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createPreviewServer } = require('../electron/agent/preview-server.cjs');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const root = process.argv[2] ? path.resolve(process.argv[2]) : fs.readFileSync(path.resolve(__dirname, '..', 'scratch', 'website-design-benchmark', 'latest.txt'), 'utf8').trim();
const report = JSON.parse(fs.readFileSync(path.join(root, 'results.json')));
const output = path.join(root, 'portfolio-validation.json');
const records = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : {};
(async () => {
  for (const run of report.runs.filter(run => run.case === 'portfolio' && run.status !== 'running' && !records[run.id])) {
    const controller = new AbortController();
    const servers = createPreviewServer(controller.signal);
    try {
      const quotedNode = process.execPath.replace(/'/g, "''");
      const launch = await servers.start(`& '${quotedNode}' server.cjs`, run.project);
      assert.equal(launch.status, 'ready');
      const workflow = [
        { action: 'assert', assertion: { kind: 'visible', selector: '[data-testid="identity-project"]' } },
        { action: 'assert', assertion: { kind: 'visible', selector: '[data-testid="editorial-project"]' } },
        { action: 'click', selector: '[data-filter="identity"]' },
        { action: 'assert', assertion: { kind: 'hidden', selector: '[data-testid="editorial-project"]' } },
        { action: 'click', selector: '[data-filter="all"]' },
        { action: 'assert', assertion: { kind: 'visible', selector: '[data-testid="identity-project"]' } },
        { action: 'assert', assertion: { kind: 'visible', selector: '[data-testid="editorial-project"]' } }
      ];
      const capture = await previewWebsite({ url: launch.url, taskId: run.id, requestId: 'supplemental-all-projects', full_page: true, workflow, signal: AbortSignal.timeout(90000), imageStore: createImageStore({ getPath: () => path.join(root, run.id, 'engine') }) });
      records[run.id] = { at: new Date().toISOString(), launch, capture, note: 'Supplemental All-filter restoration and full-page evidence, separate from original matched benchmark prompt.' };
      fs.writeFileSync(output, JSON.stringify(records, null, 2));
      assert.ok(capture.views.every(view => view.workflow.status === 'passed'));
      console.log(run.id, 'All filter restores identity/editorial projects on desktop/mobile');
      console.log(capture.views.map(view => view.image.file).join('\n'));
    } finally { controller.abort(); servers.stopAll(); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
