const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const root = process.argv[2] ? path.resolve(process.argv[2]) : fs.readFileSync(path.resolve(__dirname, '..', 'scratch', 'website-design-benchmark', 'latest.txt'), 'utf8').trim();
const report = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
const file = path.join(root, 'artifact-validation.json');
const records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
(async () => {
  for (const run of report.runs.filter(run => run.status === 'failed' && !records[run.id])) {
    if (fs.statSync(path.join(run.project, 'index.html')).size < 500) { records[run.id] = { status: 'no_generated_page', agentStatus: run.status }; continue; }
    const server = http.createServer((request, response) => {
      try { const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), target = path.resolve(run.project, '.' + (name === '/' ? '/index.html' : name));
        if (!target.startsWith(run.project + path.sep)) throw new Error('Outside project');
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
        response.writeHead(200, { 'content-type': mime[path.extname(target)] ?? 'application/octet-stream' }); response.end(fs.readFileSync(target));
      } catch { response.writeHead(404); response.end('Not found'); }
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const workflow = JSON.parse(/workflow: (\[[\s\S]*?\])\. Also inspect/.exec(run.prompt)[1]);
      const imageStore = createImageStore({ getPath: () => path.join(root, run.id, 'engine') }), url = `http://127.0.0.1:${server.address().port}`, signal = AbortSignal.timeout(90000);
      const finalHero = await previewWebsite({ url, taskId: run.id, requestId: 'postfailure-hero', signal, imageStore });
      const finalFullPage = await previewWebsite({ url, taskId: run.id, requestId: 'postfailure-flow', signal, imageStore, workflow, full_page: true });
      const checks = finalFullPage.views.map(view => ({ label: view.label, flow: view.workflow.status, overflow: view.metrics.horizontalOverflow, brokenImages: view.metrics.brokenImages, errors: view.errors, accessibilityViolations: view.accessibility?.violations ?? null }));
      records[run.id] = { at: new Date().toISOString(), agentStatus: run.status, note: 'Inspected saved source after the agent failed. This does not grant agent completion or successful independent-review status.', finalHero, finalFullPage, checks };
      console.log(run.id, JSON.stringify(checks));
    } catch (error) { records[run.id] = { error: String(error.message ?? error), agentStatus: run.status }; }
    finally { await new Promise(resolve => server.close(resolve)); fs.writeFileSync(file, JSON.stringify(records, null, 2)); }
  }
  fs.writeFileSync(file, JSON.stringify(records, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
