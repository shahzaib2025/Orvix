const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-settings-ui-'));
  const bundle = await require('esbuild').build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import SettingsPage from './src/components/SettingsPage';
      import './src/styles.css';
      import './src/theme.css';
      const memory = { enabled:true, revision:0, contextFloor:0, records:[], limit:250, textLimit:500, error:'' };
      const fast = { desktopEnabled:false, workerEnabled:false, workerModel:'', transcriptionHints:false, conversationRefinementEnabled:false };
      const startup = { supported:true, enabled:false, appId:'com.orvix.desktop' };
      const desktopBar = { supported:true, enabled:false, status:'off', error:'' };
      const desktopBarListeners = new Set();
      window.simulateDesktopBarFailure = () => {
        Object.assign(desktopBar, { enabled: false, status: 'error', error: 'A control helper needs to stop.' });
        desktopBarListeners.forEach(callback => callback({ ...desktopBar }));
      };
      const memoryListeners = new Set();
      window.orvixDesktop = {
        async getFastSettings() { return { ...fast }; },
        async configureFast(change) { Object.assign(fast, change); return { ...fast }; },
        async getStartupSettings() { return { ...startup }; },
        async setStartupAtLogin(enabled) { startup.enabled = enabled; return { ...startup }; },
        async getDesktopBarState() { return { ...desktopBar }; },
        onDesktopBarStateChanged(callback) { desktopBarListeners.add(callback); return () => desktopBarListeners.delete(callback); },
        async setDesktopBarEnabled(enabled) {
          Object.assign(desktopBar, { enabled, status: enabled ? 'starting' : 'stopping', error: '' });
          desktopBarListeners.forEach(callback => callback({ ...desktopBar }));
          await new Promise(resolve => setTimeout(resolve, 30));
          desktopBar.status = enabled ? 'on' : 'off';
          desktopBarListeners.forEach(callback => callback({ ...desktopBar }));
          return { ...desktopBar };
        },
        async listCompanionMemories() { return { ...memory, records:[...memory.records] }; },
        onCompanionMemoryChanged(callback) { memoryListeners.add(callback); return () => memoryListeners.delete(callback); },
        async configureCompanionMemory(change) { Object.assign(memory, change); return { ...memory, records:[...memory.records] }; },
        async saveCompanionMemory(input) { memory.records.push({ id:'memory-1', text:input.text, kind:input.kind, scope:input.scope, projectId:input.projectId, updatedAt:Date.now(), occurredAt:input.occurredAt, expiresAt:input.expiresAt, expired:false, source:input.source }); return { ...memory, records:[...memory.records] }; },
        async forgetCompanionMemory(id) { memory.records = memory.records.filter(item => item.id !== id); return { ...memory, records:[...memory.records] }; },
        async clearCompanionMemories() { memory.records = []; return { ...memory, records:[] }; }
      };
      function Fixture() { const [reduceMotion, setReduceMotion] = React.useState(false); return <div className="page-view"><div className="page-content"><SettingsPage projects={[{id:'project-1',name:'FlorianBD'}]} reduceMotion={reduceMotion} setReduceMotion={setReduceMotion}/></div></div>; }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `, resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, outfile: path.join(temp, 'settings-fixture.js'), jsx: 'automatic',
    format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(javascript); return; }
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{width:100%;height:100%;margin:0}body{background:#0a0a0a;color:#eee;font-family:Segoe UI,sans-serif}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  const executablePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
  ].find(file => fs.existsSync(file));
  if (!executablePath) throw new Error('No supported Chrome or Edge executable was found for the Settings UI check.');
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await require('playwright-core').chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    const capture = process.argv.includes('--capture');
    const captureScrollablePage = async file => {
      await page.evaluate(() => {
        const view = document.querySelector('.page-view');
        if (!view) return;
        view.dataset.captureOriginalStyle = view.getAttribute('style') || '';
        view.style.height = `${view.scrollHeight}px`;
        view.style.overflow = 'visible';
      });
      await page.screenshot({ path: file, fullPage: true });
      await page.evaluate(() => {
        const view = document.querySelector('.page-view');
        if (!view) return;
        const style = view.dataset.captureOriginalStyle;
        if (style) view.setAttribute('style', style); else view.removeAttribute('style');
        delete view.dataset.captureOriginalStyle;
      });
    };
    if (capture) { const out = path.join(root, 'scratch'); fs.mkdirSync(out, { recursive: true }); await captureScrollablePage(path.join(out, 'settings-page-desktop.png')); }
    assert.equal(await page.locator('.settings-index').count(), 0, 'settings use a single-column layout without a decorative index');
    assert.equal(await page.locator('.pc-companion').count(), 0, 'automatic conversation and lock controls are removed');
    assert.equal(await page.getByText('Automatic conversation', { exact: true }).count(), 0, 'automatic conversation copy is absent');
    assert.equal(await page.getByText('Lock after two minutes of inactivity', { exact: true }).count(), 0, 'inactivity lock control is absent');
    assert.equal(await page.getByText('Conversations and projects are saved on this device.', { exact: true }).count(), 1, 'local storage description remains present');
    assert.equal(await page.getByRole('switch', { name: 'Reduce motion' }).getAttribute('aria-checked'), 'false');
    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    assert.equal(await page.getByRole('switch', { name: 'Reduce motion' }).getAttribute('aria-checked'), 'true', 'motion control is interactive');
    await page.getByLabel('Use saved memories').uncheck();
    assert.equal(await page.getByLabel('Use saved memories').isChecked(), false, 'memory preference remains interactive');
    await page.getByRole('switch', { name: 'Start Orvix at sign-in' }).click();
    await page.getByText('Orvix will start minimized when you sign in.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Start Orvix at sign-in' }).getAttribute('aria-checked'), 'true', 'Windows startup control retains its saved state');
    const desktopBarSwitch = page.getByRole('switch', { name: 'Show desktop top bar' });
    assert.equal(await desktopBarSwitch.getAttribute('aria-checked'), 'false', 'top bar defaults off');
    await desktopBarSwitch.click();
    await page.getByText('On · Available above your other windows.', { exact: true }).waitFor();
    assert.equal(await desktopBarSwitch.getAttribute('aria-checked'), 'true');
    await desktopBarSwitch.click();
    await page.getByText('Off · No top bar or controls are running.', { exact: true }).waitFor();
    assert.equal(await desktopBarSwitch.getAttribute('aria-checked'), 'false');
    await page.evaluate(() => window.simulateDesktopBarFailure());
    await page.getByText('A control helper needs to stop.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop top bar controls' }).click();
    await page.getByText('Off · No top bar or controls are running.', { exact: true }).waitFor();
    await page.getByRole('switch', { name: 'Windows app control' }).click();
    await page.getByText('Saved. New voice sessions use the updated settings.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Windows app control' }).getAttribute('aria-checked'), 'true', 'Fast profile control retains its save flow');
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.querySelector('.page-view').scrollWidth > document.querySelector('.page-view').clientWidth + 1);
    assert.equal(desktopOverflow, false, 'desktop layout has no horizontal overflow');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.querySelector('.page-view').scrollTop = 0; });
    await page.waitForTimeout(100);
    if (capture) await captureScrollablePage(path.join(root, 'scratch', 'settings-page-mobile.png'));
    const diagnostics = await page.evaluate(() => ({
      innerWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
      pageWidth: document.querySelector('.page-view').clientWidth, pageScrollWidth: document.querySelector('.page-view').scrollWidth,
      overflowing: [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })).filter(item => item.right > window.innerWidth + 1).slice(0, 12),
    }));
    const mobileOverflow = diagnostics.documentWidth > diagnostics.innerWidth || diagnostics.pageScrollWidth > diagnostics.pageWidth + 1;
    if (mobileOverflow) console.error('Mobile overflow diagnostics:', JSON.stringify(diagnostics));
    assert.equal(mobileOverflow, false, 'mobile layout has no horizontal overflow');
    assert.equal(await page.locator('.settings-index').count(), 0, 'mobile settings remain a simple single column');
    await page.setViewportSize({ width: 320, height: 740 });
    const compactOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.querySelector('.page-view').scrollWidth > document.querySelector('.page-view').clientWidth + 1);
    assert.equal(compactOverflow, false, 'compact mobile layout has no horizontal overflow');
    assert.deepEqual(errors, [], 'page renders without browser exceptions');
    console.log('Settings UI passed: simple layout, removed companion controls, setting interactions, save feedback, browser errors, and desktop/mobile overflow.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
