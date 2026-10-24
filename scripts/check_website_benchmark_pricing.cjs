const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const root = process.argv[2] ? path.resolve(process.argv[2]) : fs.readFileSync(path.resolve(__dirname, '..', 'scratch', 'website-design-benchmark', 'latest.txt'), 'utf8').trim();
const report = JSON.parse(fs.readFileSync(path.join(root, 'results.json')));
const output = path.join(root, 'pricing-validation.json');
const records = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : {};
(async () => {
  for (const run of report.runs.filter(run => run.case === 'saas' && run.status !== 'running' && !records[run.id])) {
    const html = fs.readFileSync(path.join(run.project, 'index.html'), 'utf8');
    const prices = [...html.matchAll(/data-monthly="([\d.]+)"\s+data-annual="([\d.]+)"/g)].map(match => ({ monthly: match[1], annual: match[2], selector: `[data-monthly="${match[1]}"][data-annual="${match[2]}"]` }));
    // Explicit expectations after inspecting this retained sample, not production logic.
    if (!prices.length && run.id === 'saas-fast' && html.includes('data-price="team"')) prices.push({ monthly: '64', annual: '51', selector: '[data-price="team"]' });
    assert.ok(prices.some(price => price.monthly !== price.annual), 'No actual changed-price target discovered in this sample; inspect its markup before adapting this supplemental check.');
    const server = http.createServer((request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const target = path.resolve(run.project, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!target.startsWith(run.project + path.sep)) throw Error('Outside project');
        response.writeHead(200, { 'content-type': { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' }[path.extname(target)] ?? 'application/octet-stream' }); response.end(fs.readFileSync(target));
      } catch { response.writeHead(404); response.end(); }
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const workflow = [
        ...prices.map(price => ({ action: 'assert', assertion: { kind: 'text', selector: price.selector, expected: '$' + price.monthly } })),
        { action: 'click', selector: '[data-action="annual"]' },
        ...prices.map(price => ({ action: 'assert', assertion: { kind: 'text', selector: price.selector, expected: '$' + price.annual } })),
        { action: 'click', selector: '[data-action="monthly"]' },
        ...prices.map(price => ({ action: 'assert', assertion: { kind: 'text', selector: price.selector, expected: '$' + price.monthly } }))
      ];
      const capture = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}`, taskId: run.id, requestId: 'supplemental-pricing', workflow, signal: AbortSignal.timeout(90000), imageStore: createImageStore({ getPath: () => path.join(root, run.id, 'engine') }) });
      records[run.id] = { at: new Date().toISOString(), prices, views: capture.views.map(view => ({ label: view.label, workflow: view.workflow })), note: 'Supplemental actual-value assertions, separate from the original matched benchmark prompt.' };
      fs.writeFileSync(output, JSON.stringify(records, null, 2));
      assert.ok(capture.views.every(view => view.workflow.status === 'passed'));
      console.log(run.id, 'actual monthly -> annual -> monthly price assertions passed on desktop/mobile');
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
