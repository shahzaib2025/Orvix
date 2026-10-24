const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

async function main() {
  // Use the production build when no externally managed preview is supplied.
  let preview;
  let previewUrl = process.env.ORVIX_PREVIEW_URL;
  if (!previewUrl) {
    const dist = path.resolve(__dirname, '../dist');
    preview = require('node:http').createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
      if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
      fs.readFile(file, (error, content) => {
        if (error) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
        response.end(content);
      });
    });
    await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
    previewUrl = `http://127.0.0.1:${preview.address().port}/`;
  }
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const captures = path.resolve(__dirname, '../scratch/island-demo');
  fs.mkdirSync(captures, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1120 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE|shader|WebGL/i.test(message.text())) errors.push(message.text()); });
  const requests = [];
  page.on('request', request => { if (['xhr', 'fetch', 'websocket'].includes(request.resourceType()) && /tinyAgent|tiny-agent|api\/|generativelanguage/i.test(request.url())) requests.push(request.url()); });
  const capture = async options => {
    const pause = page.getByRole('button', { name: 'Pause scenery', exact: true });
    const wasRunning = await pause.count() > 0 && await pause.isEnabled();
    if (wasRunning) { await pause.click(); await page.waitForTimeout(200); }
    await page.screenshot(options);
    if (wasRunning) await page.getByRole('button', { name: 'Resume scenery', exact: true }).click();
  };
  try {
    await page.goto(previewUrl);
    await page.getByRole('button', { name: /^Support/ }).click();
    await page.locator('.island-renderer[data-world-ready="true"]').waitFor({ timeout: 30000 });
    await page.locator('#startup-splash').waitFor({ state: 'detached', timeout: 15000 });
    const canvas = page.locator('.island-renderer canvas');
    await page.waitForFunction(() => Number(document.querySelector('.island-renderer canvas')?.dataset.worldTime) > .8);
    assert.equal(await page.locator('.island-district-dock>button').count(), 4);
    await capture({ path: path.join(captures, 'haven-day-desktop.png') });
    await page.getByRole('button', { name: 'Pause scenery', exact: true }).click();
    const before = await canvas.getAttribute('data-world-time');
    await page.waitForTimeout(500);
    assert.equal(await canvas.getAttribute('data-world-time'), before, 'Pause freezes villagers and environmental simulation');
    await page.getByRole('button', { name: 'Resume scenery', exact: true }).click();
    await page.getByRole('button', { name: 'Scenery speed 1x', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Scenery speed 2x', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Moonlight', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('.island-renderer canvas')?.dataset.worldNight) > .93);
    await capture({ path: path.join(captures, 'haven-night-desktop.png') });
    await page.locator('.island-district-dock>button').filter({ hasText: 'The workshop' }).click();
    await page.locator('.island-live-roster h2').filter({ hasText: 'The workshop' }).waitFor();
    assert.equal(await page.locator('.island-district-dock>button.selected').count(), 1);
    await page.waitForTimeout(1000);
    await capture({ path: path.join(captures, 'haven-district-desktop.png') });
    await page.getByRole('button', { name: 'Close agent roster' }).click();
    assert.equal(await page.locator('.island-live-roster').count(), 0);
    await page.getByRole('button', { name: 'Reset island view' }).click();
    await page.getByRole('button', { name: 'Island tour' }).click();
    assert.equal(await page.getByRole('button', { name: 'Island tour' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Island tour' }).click();
    await page.getByRole('button', { name: 'Daylight', exact: true }).click();
    await page.getByRole('button', { name: 'Explore fullscreen' }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForTimeout(700);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture({ path: path.join(captures, 'haven-day-mobile.png'), fullPage: true });
    assert.equal(await page.locator('.island-page').evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'Mobile layout has no horizontal overflow');
    await page.locator('.island-district-dock>button').filter({ hasText: 'The gardens' }).click();
    await page.locator('.island-live-roster h2').filter({ hasText: 'The gardens' }).waitFor();
    await capture({ path: path.join(captures, 'haven-district-mobile.png'), fullPage: true });
    // Visiting another page destroys the renderer; returning builds a fresh world.
    await page.setViewportSize({ width: 1536, height: 1120 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.locator('.island-renderer canvas').count(), 0);
    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    await page.getByRole('button', { name: /^Support/ }).click();
    await page.locator('.island-renderer[data-world-ready="true"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Resume scenery', exact: true }).isDisabled(), true);
    const frozen = await canvas.getAttribute('data-world-time');
    await page.waitForTimeout(350);
    assert.equal(await canvas.getAttribute('data-world-time'), frozen, 'Reduced motion freezes automated animation');
    assert.deepEqual(errors, [], 'No renderer, shader, or browser errors');
    assert.deepEqual(requests, [], 'World does not call Tiny Agents or model APIs');
    console.log('Island demo passed: rendered WebGL, animation, pause/resume, speed, lighting, district focus, tour, responsive layout, reduced motion, disposal, and API isolation.');
    console.log('Visual captures: ' + captures);
  } finally { await browser.close(); if (preview) await new Promise(resolve => preview.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

