// Manual integration check against the paired Chrome extension and current desktop.
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { getForegroundHandle } = require('../electron/window-control.cjs');

(async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: path.join(__dirname, '..'),
    executablePath: require('electron'),
  });
  let page;
  let chromeHandle = 0;
  let playing = false;
  try {
    page = await app.firstWindow();
    await page.waitForFunction(() => !!window.orvixDesktop?.youtubeAction, { timeout: 15_000 });
    await page.waitForTimeout(3000);
    console.log('MONITOR ' + JSON.stringify({ foregroundHandle: await getForegroundHandle() }));
    let started = await page.evaluate(() => window.orvixDesktop.youtubeAction({ action: 'search_and_play', query: 'Me at the zoo original 2005 jawed' }));
    console.log('SEARCH ' + JSON.stringify(started));
    if (started.status === 'needs_selection') {
      const match = started.options?.find(item => /me at the zoo/i.test(item.title || '') && /jawed/i.test(item.channel || ''));
      if (!match) throw new Error('The original video was not among the choices.');
      started = await page.evaluate(candidateId => window.orvixDesktop.youtubeAction({ action: 'select_and_play', candidateId }), match.candidateId);
      console.log('SELECT ' + JSON.stringify(started));
    }
    if (started.status !== 'ok' || started.playbackState !== 'playing') throw new Error('Could not verify live playback through Orvix.');
    playing = true;

    let chromeWindow;
    for (let i = 0; i < 6 && !chromeWindow; i++) {
      const snapshot = await page.evaluate(() => window.orvixDesktop.getPcSnapshot());
      if (i === 0) console.log('WINDOWS ' + JSON.stringify({ count: snapshot?.Windows?.length || 0, chromeTitles: snapshot?.Windows?.filter(item => item.App?.toLowerCase() === 'chrome').map(item => item.Title).slice(0, 5) || [] }));
      chromeWindow = snapshot?.Windows?.find(item => item.App?.toLowerCase() === 'chrome' && /me at the zoo/i.test(item.Title || ''));
      if (!chromeWindow) await page.waitForTimeout(500);
    }
    if (!chromeWindow?.Handle) throw new Error('Could not identify the YouTube Chrome window by current title; minimized-window check skipped.');
    chromeHandle = chromeWindow.Handle;
    const minimized = await page.evaluate(handle => window.orvixDesktop.manageWindow({ action: 'minimize', handle }), chromeHandle);
    console.log('MINIMIZE ' + JSON.stringify({ ok: minimized.ok, status: minimized.status }));
    if (!minimized.ok) throw new Error('Chrome window could not be minimized.');

    const paused = await page.evaluate(() => window.orvixDesktop.youtubeAction({ action: 'pause', targetTitle: 'Me at the zoo' }));
    console.log('PAUSE ' + JSON.stringify(paused));
    playing = paused.playbackState === 'playing';
    if (paused.status !== 'ok' || paused.playbackState !== 'paused' || !paused.restoredTab || !paused.restoredBrowserWindow || !paused.restoredForeground) {
      throw new Error('Pause or context restoration was not fully verified.');
    }
  } finally {
    if (page && playing) {
      try { console.log('CLEANUP_PAUSE ' + JSON.stringify(await page.evaluate(() => window.orvixDesktop.youtubeAction({ action: 'pause', targetTitle: 'Me at the zoo' })))); }
      catch { /* Reported by the main failure. */ }
    }
    if (page && chromeHandle) {
      try { await page.evaluate(handle => window.orvixDesktop.manageWindow({ action: 'restore', handle }), chromeHandle); }
      catch { /* Do not hide the main result. */ }
    }
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
