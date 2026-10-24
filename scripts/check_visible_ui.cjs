// Real browser coverage of hidden display work and unchanged active rendering.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

async function main() {
  const root = path.resolve(__dirname, '..');
  const halo = fs.readFileSync(path.join(root, 'src/components/HaloVisualizer.tsx'), 'utf8').replace(/\r\n/g, '\n');
  // Preserve the pre-optimization scheduler for a pixel/callback comparison.
  const legacy = halo.replace('      frame = 0;\n      if (document.hidden) return;\n', '')
    .replace(/    const syncVisibility = \(\) => \{[\s\S]*?    \};\n  \}, \[session, reducedMotion\]\);/, '    frame = requestAnimationFrame(draw);\n    return () => cancelAnimationFrame(frame);\n  }, [session, reducedMotion]);');
  assert.notEqual(legacy, halo);
  const bundle = await require('esbuild').build({
    stdin: { contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import Halo from './src/components/HaloVisualizer';
      import Legacy from 'legacy-halo';
      import { useVisibleInterval } from './src/useVisibleInterval';
      import { AgentTurnStatus } from './src/components/AgentActivityTimeline';
      const originalNow = Date.now; let offset = 0, hidden = false, frameId = 0;
      const frames = new Map();
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Date.now = () => originalNow() + offset;
      window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
      window.cancelAnimationFrame = id => frames.delete(id);
      let polls = 0, lastRefresh = 0;
      function Fixture() {
        const [enabled, setEnabled] = useState(true), [visible, setVisible] = useState(true), [reduced, setReduced] = useState(false);
        const [startedAt] = useState(() => Date.now() - 3000);
        useVisibleInterval(() => { polls++; lastRefresh = Date.now(); }, enabled ? 1000 : null);
        window.fixture.setEnabled = setEnabled; window.fixture.setVisible = setVisible; window.fixture.setReduced = setReduced;
        return <><div id="current"><Halo session={null} reducedMotion={reduced}/></div><div id="legacy"><Legacy session={null} reducedMotion={reduced}/></div>
          <AgentTurnStatus startedAt={startedAt} status="pending" visible={visible} turnId="fixture" hasDetails={true}><p>Existing working details</p></AgentTurnStatus></>;
      }
      const root = createRoot(document.getElementById('root'));
      window.fixture = {
        hide(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
        advance(ms) { offset += ms; },
        flush(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); },
        snapshot() { return { polls, lastRefresh, frames: frames.size, time: Date.now() }; },
        equalPixels() { return document.querySelector('#current canvas').toDataURL() === document.querySelector('#legacy canvas').toDataURL(); },
        unmount() { root.unmount(); }
      };
      root.render(<Fixture/>);
    `, resolveDir: root, loader: 'tsx' },
    plugins: [{ name: 'legacy', setup(build) {
      build.onResolve({ filter: /^legacy-halo$/ }, () => ({ path: 'legacy-halo', namespace: 'legacy' }));
      build.onLoad({ filter: /.*/, namespace: 'legacy' }, () => ({ contents: legacy, loader: 'tsx', resolveDir: path.join(root, 'src/components') }));
    } }], bundle: true, write: false, outfile: path.join(root, 'scratch/visible-ui-fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await require('playwright-core').chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.fixture?.setVisible, undefined, { polling: 50 });
    await page.evaluate(() => { for (let i = 0; i < 100; i++) window.fixture.flush(i * 16.667); });
    assert.equal(await page.evaluate(() => window.fixture.equalPixels()), true, 'active canvas pixels must match the previous renderer');
    const before = await page.evaluate(() => window.fixture.snapshot());
    assert.equal(before.frames, 2, 'both visible versions retain their original frame rate');
    await page.waitForTimeout(1100);
    assert.ok((await page.evaluate(() => window.fixture.snapshot())).polls > before.polls, 'visible clock refreshes');
    await page.evaluate(() => window.fixture.hide(true));
    const hidden = await page.evaluate(() => window.fixture.snapshot());
    assert.equal(hidden.frames, 1, 'only the legacy renderer continues drawing while hidden');
    await page.evaluate(() => { for (let i = 0; i < 100; i++) window.fixture.flush(2000 + i * 16.667); window.fixture.advance(60000); });
    await page.waitForTimeout(1100);
    assert.equal((await page.evaluate(() => window.fixture.snapshot())).polls, hidden.polls, 'no display timer callbacks while hidden');
    await page.evaluate(() => window.fixture.hide(false));
    await page.waitForFunction(() => window.fixture.snapshot().lastRefresh >= window.fixture.snapshot().time - 100, undefined, { polling: 50 });
    assert.equal((await page.evaluate(() => window.fixture.snapshot())).frames, 2, 'animation resumes immediately on restore');
    const label = page.locator('.agent-turn-status').first();
    await page.waitForFunction(() => document.querySelector('.agent-turn-status').textContent.includes('1m'), undefined, { polling: 50 });
    await page.evaluate(() => window.fixture.setVisible(false));
    await page.waitForTimeout(50);
    const paused = await label.textContent();
    await page.evaluate(() => window.fixture.advance(60000));
    await page.waitForTimeout(1100);
    assert.equal(await label.textContent(), paused, 'hidden Agent page does not tick while background work continues');
    await page.evaluate(() => window.fixture.setVisible(true));
    await page.waitForFunction(() => document.querySelector('.agent-turn-status').textContent.includes('2m'), undefined, { polling: 50 });
    await page.getByRole('button', { name: /Minimize working details/ }).click();
    assert.equal(await page.getByRole('button', { name: /Maximize working details/ }).getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => window.fixture.setEnabled(false)); await page.waitForTimeout(50);
    const disabled = await page.evaluate(() => window.fixture.snapshot());
    await page.waitForTimeout(1100);
    assert.equal((await page.evaluate(() => window.fixture.snapshot())).polls, disabled.polls, 'disabled clocks stop');
    await page.evaluate(() => window.fixture.setReduced(true)); await page.waitForTimeout(50);
    await page.evaluate(() => window.fixture.flush(100000));
    assert.equal((await page.evaluate(() => window.fixture.snapshot())).frames, 0, 'reduced motion keeps static rendering');
    await page.evaluate(() => window.fixture.unmount());
    const unmounted = await page.evaluate(() => window.fixture.snapshot());
    await page.waitForTimeout(1100);
    assert.deepEqual(await page.evaluate(() => window.fixture.snapshot().polls), unmounted.polls, 'unmount releases timers');
    assert.equal(unmounted.frames, 0, 'unmount releases frames');
    assert.deepEqual(errors, []);
    console.log('PASS: unchanged active canvas pixels/frame rate, zero hidden display ticks/frames, immediate elapsed-time catch-up, hidden Agent page, working-details controls, reduced motion, and complete unmount cleanup.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
