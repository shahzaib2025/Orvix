const path = require('node:path');
const fs = require('node:fs');
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
  app.setPath('userData', process.env.ORVIX_SEARCH_UI_DIR);
  app.whenReady().then(async () => {
    const { createSearchKeyStore } = require('../electron/search-key-store.cjs');
    const search = require('../electron/search.cjs');
    const window = new BrowserWindow({ show: false, width: 1280, height: 850, webPreferences: { preload: path.resolve('electron/preload.cjs') } });
    const store = createSearchKeyStore(app, safeStorage, snapshot => window.webContents.send('orvix:search-keys-changed', snapshot));
    search.configureSearchKeys(store);
    ipcMain.handle('orvix:search-keys-list', () => store.snapshot());
    ipcMain.handle('orvix:search-keys-add', (_, value) => store.add(value));
    ipcMain.handle('orvix:search-keys-update', (_, id, value) => store.update(id, value));
    ipcMain.handle('orvix:search-keys-delete', (_, id) => store.remove(id));
    ipcMain.handle('orvix:search', (_, value) => search.searchWeb(value));
    ipcMain.handle('orvix:tiny-agents-list', () => ({ rules: [], history: [], deliveries: [], shutdownPending: null }));
    ipcMain.handle('orvix:opencode-status', () => ({ zen: { configured: false }, go: { configured: false } }));
    ipcMain.handle('orvix:fast-settings', () => ({ desktopEnabled: false, workerEnabled: false }));
    await window.loadFile(path.resolve('dist/index.html'));
  });
} else {
  (async () => {
    const assert = require('node:assert/strict');
    const os = require('node:os');
    const { _electron } = require('playwright-core');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-search-ui-'));
    const liveKey = process.env.ORVIX_SEARCH_UI_KEY; delete process.env.ORVIX_SEARCH_UI_KEY;
    const env = { ...process.env, ORVIX_SEARCH_UI_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
    let application = await _electron.launch({ args: [path.resolve(__filename)], env });
    const errors = [];
    try {
      const page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.getByRole('button', { name: 'Thinking', exact: true }).click();
      const keyButton = await page.locator('.search-keys-trigger').boundingBox(), depth = await page.locator('.thinking-depth').boundingBox();
      assert(keyButton.x + keyButton.width <= depth.x);
      await page.getByRole('button', { name: 'Fast', exact: true }).click();
      await page.getByRole('button', { name: 'Open Search API Keys' }).click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.querySelector('.search-key-dialog').contains(document.activeElement)), true);
      await page.getByLabel('Label', { exact: true }).fill('UI first');
      await page.getByLabel('API key', { exact: true }).fill('fixture-key-000000000000000001');
      await page.getByLabel('Current remaining credits').fill('10');
      await page.getByRole('button', { name: 'Save key', exact: true }).click();
      await page.getByRole('button', { name: 'Pause UI first' }).waitFor();
      await page.getByRole('button', { name: 'Pause UI first' }).click();
      await page.getByRole('button', { name: 'Enable UI first' }).waitFor();
      await page.getByRole('button', { name: 'Edit UI first' }).click();
      await page.getByLabel('Reconcile account balance').fill('8');
      await page.getByRole('button', { name: 'Save balance' }).click();
      await page.getByRole('button', { name: 'Delete UI first' }).click();
      await page.getByRole('button', { name: 'Delete key', exact: true }).click();
      await page.getByText('Add your first Serper key').waitFor();
      if (liveKey) {
        await page.getByLabel('Label', { exact: true }).fill('Live verification');
        await page.getByLabel('API key', { exact: true }).fill(liveKey);
        await page.getByRole('button', { name: 'Save key', exact: true }).click();
        await page.getByRole('button', { name: 'Pause Live verification' }).waitFor();
        const result = await page.evaluate(() => window.orvixDesktop.searchWeb({ query: 'Google latest Gemini models official' }));
        assert.equal(result.provider, 'Serper'); assert.equal(result.status, 'ok'); assert(result.results.length > 0);
        const status = await page.evaluate(() => window.orvixDesktop.listSearchKeys());
        assert.equal(status.totals.queries, 1); assert.equal(status.totals.successes, 1); assert.equal(status.keys[0].credits, 1);
        console.log(JSON.stringify({ live: 'passed', provider: result.provider, query: result.query, count: result.count, titles: result.results.map(r => r.title), counters: status.totals }));
        await page.getByRole('button', { name: 'Delete Live verification' }).click(); await page.getByRole('button', { name: 'Delete key', exact: true }).click();
      }
      await page.evaluate(async () => {
        for (let i = 0; i < 12; i++) await window.orvixDesktop.addSearchKey({ label: 'Pagination ' + (i + 1), key: 'pagination-fixture-key-00000' + i, remaining: 2500 });
      });
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByText('Page 2 of 2').waitFor();
      await page.getByRole('button', { name: 'Previous', exact: true }).click();
      await page.evaluate(() => { document.querySelector('.search-key-dialog-body').scrollTop = 0; });
      await page.screenshot({ path: path.resolve('scratch/search-key-manager-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.querySelector('.search-key-dialog').scrollWidth <= document.querySelector('.search-key-dialog').clientWidth), true);
      await page.screenshot({ path: path.resolve('scratch/search-key-manager-mobile.png') });
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const trigger = await page.locator('.search-keys-trigger').boundingBox(), modes = await page.locator('.mode-switch').boundingBox();
      assert(trigger.x >= modes.x + modes.width);
      assert(Math.abs(trigger.y + trigger.height / 2 - modes.y - modes.height / 2) < 3);
      assert.equal(await page.locator('.search-key-card').count(), 0);
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.screenshot({ path: path.resolve('scratch/search-key-home.png') });
      await page.evaluate(() => {
        localStorage.setItem('orvix.homeConversations.v2', JSON.stringify([{ id: 'layout-check', profile: 'Fast', title: 'Conversation layout check', updatedAt: Date.now(), messages: Array.from({ length: 24 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', text: 'Conversation layout acceptance message ' + i, mode: 'Fast', phase: 'final' })) }]));
        localStorage.setItem('orvix.activeHomeConversations.v2', JSON.stringify({ Fast: 'layout-check', Thinking: null }));
      });
      await page.reload(); await page.locator('.conversation-layout').waitFor();
      const composer = await page.locator('.conversation-composer').boundingBox(), home = await page.locator('.home-view').boundingBox();
      assert(composer.y + composer.height <= home.y + home.height + 2);
      assert.deepEqual(errors, []);
      await application.close();
      application = await _electron.launch({ args: [path.resolve(__filename)], env });
      const restarted = await application.firstWindow();
      await restarted.getByRole('button', { name: 'Open Search API Keys' }).waitFor();
      const persisted = await restarted.evaluate(() => window.orvixDesktop.listSearchKeys());
      assert.equal(persisted.keys.length, 12); assert.equal(persisted.pools.length, 12);
      assert.deepEqual(errors, []); console.log('Search key UI: add, pause, edit, delete, modal, mobile, Escape and Home layout passed.');
    } finally { await application.close(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
