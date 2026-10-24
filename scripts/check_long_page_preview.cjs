const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { chromium } = require('playwright-core');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { listenBrowserLoopback } = require('../electron/agent/browser-loopback.cjs');

test('long desktop/mobile overview retains real layout and bottom content within pixel and byte limits', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-long-preview-'));
  const server = http.createServer((_, response) => response.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Long content</title><style>body{margin:0}section{box-sizing:border-box;height:600px;background:#fff;color:#111;padding:24px}section:first-child{background:#f00}section:last-child{background:#00f;color:white}@media(max-width:600px){section{height:1200px}}</style><main>'
    + Array.from({ length: 31 }, (_, index) => `<section><h2>Content purpose ${index + 1}</h2><p>Readable independent content.</p></section>`).join('') + '</main></html>'));
  await listenBrowserLoopback(server);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}/`, taskId: 'long-page', requestId: 'overview', signal: AbortSignal.timeout(50000), imageStore: createImageStore({ getPath: () => root }), browserSession: { get: async () => browser }, full_page: true });
  const decoder = await browser.newPage();
  for (const view of result.views) {
    assert.equal(view.metrics.viewportWidth, view.width);
    assert.equal(view.metrics.documentHeight, view.width > 600 ? 18600 : 37200);
    assert.equal(view.metrics.horizontalOverflow, false);
    assert.equal(view.capture.fullPage, true);
    assert.ok(view.capture.overview.scale < 1);
    assert.equal(view.capture.preparation.restoredY, 0);
    assert.ok(fs.statSync(view.image.file).size <= 1_000_000);
    const decoded = await decoder.evaluate(async data => {
      const image = new Image(); image.src = 'data:image/jpeg;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.drawImage(image, 5, image.naturalHeight - 5, 1, 1, 0, 0, 1, 1);
      return { width: image.naturalWidth, height: image.naturalHeight, bottom: [...context.getImageData(0, 0, 1, 1).data] };
    }, fs.readFileSync(view.image.file).toString('base64'));
    assert.ok(decoded.width * decoded.height <= 24_000_000);
    assert.ok(decoded.height <= 16001);
    assert.ok(decoded.bottom[2] > 220 && decoded.bottom[0] < 30, JSON.stringify(decoded));
  }
});
