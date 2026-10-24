const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-preview-check-'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/skip' || request.url === '/bad-skip') {
      response.end(`<!doctype html><html lang="en"><head><title>Skip link fixture</title><style>.skip{position:absolute;left:-9999px;top:0;background:black;color:white;padding:8px}${request.url === '/skip' ? '.skip:focus{left:8px;top:8px}' : ''}</style></head><body><a class="skip" href="#main">Skip to content</a><main id="main"><h1>Content</h1><p>Visible content</p></main></body></html>`);
      return;
    }
    if (request.url === '/settings' || request.url === '/nonpersistent') {
      const restore = request.url === '/settings';
      response.end(`<!doctype html><html lang="en"><head><title>Settings fixture</title></head><body><main><h1>Settings</h1><label>Brightness alerts<input id="alerts" type="checkbox"></label><label>Name<input id="name"></label><label>Mode<select id="mode"><option value="changes">Changes</option><option value="threshold">Threshold</option></select></label><button id="save">Save</button><p id="result">Ready</p></main><script>
        const alerts = document.querySelector('#alerts'), name = document.querySelector('#name'), mode = document.querySelector('#mode');
        if (${restore}) { const saved = JSON.parse(localStorage.getItem('monitorSettings') || 'null'); if (saved) { alerts.checked = saved.alerts; name.value = saved.name; mode.value = saved.mode; } }
        document.querySelector('#save').onclick = () => { localStorage.setItem('monitorSettings', JSON.stringify({alerts:alerts.checked,name:name.value,mode:mode.value})); document.querySelector('#result').textContent = 'Saved'; };
      </script></body></html>`); return;
    }
    response.end(request.url === '/broken' 
      ? '<!doctype html><html><body><div style="width:1400px">Overflow</div><img src="missing.png"><script>console.error("Fixture browser error")</script></body></html>'
      : '<!doctype html><html><head><title>Preview fixture</title></head><body><h1>Fixture</h1><button id="run">Go</button><p id="state">Ready</p><script>document.querySelector("#run").onclick=()=>{document.querySelector("#state").textContent="Done"}</script></body></html>');
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    for (const route of ['/skip','/bad-skip']) {
      const captured = await previewWebsite({ url:`http://127.0.0.1:${port}${route}`,taskId:'skip',requestId:route.slice(1),signal:new AbortController().signal,imageStore:createImageStore({getPath:()=>root}) });
      assert.ok(captured.views.every(view=>view.metrics.viewportClippedContent.some(item=>item.text==='Skip to content') === (route==='/bad-skip')));
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    const result = await previewWebsite({ url: `http://127.0.0.1:${port}/`, taskId: 'fixture', requestId: 'fixture',
      signal: new AbortController().signal, imageStore: createImageStore({ getPath: () => root }),
      interactions: [{ action: 'click', selector: '#run' }], assertions: [{ selector: '#state', text: 'Done' }] });
    assert.equal(result.views.length, 2);
    assert.equal(result.views[0].metrics.title, 'Preview fixture');
    assert.equal(typeof result.views[0].metrics.loadMilliseconds, 'number');
    assert.equal(typeof result.views[0].metrics.cumulativeLayoutShift, 'number');
    assert.equal(result.views[0].interactions[0].status, 'performed');
    assert.equal(result.views[0].assertions[0].status, 'passed');
    assert.ok(fs.existsSync(result.views[0].image.file));
    assert.ok(Array.isArray(result.views[0].accessibility.violations));
    const comparison = await previewWebsite({ url: `http://127.0.0.1:${port}/`, taskId: 'fixture', requestId: 'compare',
      signal: new AbortController().signal, imageStore: createImageStore({ getPath: () => root }),
      reference: result.views[0].image });
    assert.equal(comparison.referenceImage.file, result.views[0].image.file);
    assert.equal(typeof comparison.views[0].referenceDifference, 'number');
    const broken = await previewWebsite({ url: `http://127.0.0.1:${port}/broken`, taskId: 'fixture', requestId: 'broken',
      signal: new AbortController().signal, imageStore: createImageStore({ getPath: () => root }) });
    assert.equal(broken.views[1].metrics.horizontalOverflow, true);
    assert.ok(broken.views[0].errors.some(error => error.includes('Fixture browser error')));
    assert.ok(broken.views[0].accessibility.violations.length > 0);
    const workflow = [
      { action: 'fill', selector: '#name', value: 'Brightness monitor' },
      { action: 'check', selector: '#alerts', enabled: true },
      { action: 'select', selector: '#mode', value: 'changes' },
      { action: 'click', selector: '#save' },
      { action: 'assert', assertion: { kind: 'text', selector: '#result', expected: 'Saved' } },
      { action: 'assert', assertion: { kind: 'storage', key: 'monitorSettings', expected: JSON.stringify({alerts:true,name:'Brightness monitor',mode:'changes'}) } },
      { action: 'reload' },
      { action: 'assert', assertion: { kind: 'checked', selector: '#alerts', expected: true, timeout_ms: 100 } },
      { action: 'assert', assertion: { kind: 'value', selector: '#name', expected: 'Brightness monitor' } },
      { action: 'assert', assertion: { kind: 'value', selector: '#mode', expected: 'changes' } },
    ];
    const settings = await previewWebsite({ url: `http://127.0.0.1:${port}/settings`, taskId: 'fixture', requestId: 'settings', signal: new AbortController().signal, imageStore: createImageStore({getPath: () => root}), workflow });
    assert.equal(settings.views.length, 2);
    for (const view of settings.views) { assert.equal(view.workflow.status, 'passed'); assert.equal(view.workflow.assertionCount, 5); assert.equal(view.workflow.steps.length, 10); }
    const nonpersistent = await previewWebsite({ url: `http://127.0.0.1:${port}/nonpersistent`, taskId: 'fixture', requestId: 'nonpersistent', signal: new AbortController().signal, imageStore: createImageStore({getPath: () => root}), workflow });
    for (const view of nonpersistent.views) { assert.equal(view.workflow.status, 'failed'); assert.equal(view.workflow.steps.at(-1).kind, 'checked'); assert.equal(view.workflow.steps.at(-1).actual, false); }
    const noProof = await previewWebsite({ url: `http://127.0.0.1:${port}/settings`, taskId: 'fixture', requestId: 'no-proof', signal: new AbortController().signal, imageStore: createImageStore({getPath: () => root}), workflow: [{action:'fill',selector:'#name',value:'No assertion'}] });
    assert.ok(noProof.views.every(view => view.workflow.status === 'skipped'));
    console.log('Desktop and mobile: interactions, screenshots, accessibility, saved settings after reload, failed persistence detection and no-assertion rejection passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
