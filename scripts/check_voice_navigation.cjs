// Test real App navigation with a controlled transport; no API or microphone use.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');
const mockVoice = `export class VoiceSession {
  hasMicrophone = false;
  constructor(profile, depth, history, callbacks) { this.callbacks = callbacks; window.voiceTest.sessions.push(this); }
  async start(microphone) {
    this.callbacks.onStatus('connecting');
    if (window.voiceTest.deferStart) await new Promise(resolve => { this.finishStart = resolve; });
    this.hasMicrophone = microphone; this.callbacks.onStatus('listening');
  }
  async enableMicrophone() { this.hasMicrophone = true; }
  updateIdentity() {}
  getAudioLevel() { return 0; }
  sendText() { this.callbacks.onStatus('responding'); }
  stop() { window.voiceTest.stops++; this.hasMicrophone = false; this.callbacks.onStatus('off'); }
}`;
async function main() {
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './src/App'; createRoot(document.getElementById('root')).render(<App />);`, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.css': 'empty' },
    plugins: [{ name: 'controlled-voice', setup(build) {
      build.onResolve({ filter: /^\.\/liveVoice$/ }, () => ({ path: 'voice', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: mockVoice, loader: 'js' }));
      // Unrelated agent pages are stubbed; App and its navigation remain real.
      build.onResolve({ filter: /(?:components\/|\.\/)(AgentDashboard|TinyAgentsPage)$/ }, args => ({ path: args.path, namespace: 'page-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'page-fixture' }, () => ({ contents: 'export default function Page(){return null}', loader: 'js' }));
    } }],
  });
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.voiceTest = { sessions: [], stops: 0, deferStart: false };
      localStorage.setItem('orvix.homeMode', 'Fast');
      window.orvixDesktop = {
        getFastSettings: async () => ({ desktopEnabled: false, workerEnabled: false, workerModel: 'gemini-3.8-flash', transcriptionHints: false, conversationRefinementEnabled: false }),
        configureFast: async input => ({ desktopEnabled: false, workerEnabled: false, workerModel: 'gemini-3.8-flash', transcriptionHints: false, conversationRefinementEnabled: false, ...input }),
        onFastWorkEvent: () => () => {},
        listTinyAgents: async () => ({ rules: [], history: [], shutdownPending: null }),
        onTinyAgentEvent: () => () => {},
        onNotificationOpen: listener => { window.voiceTest.notification = listener; return () => {}; },
        getAgentNotifications: async () => ({ items: [], storageError: null }),
        onAgentNotifications: () => () => {},
        markAgentNotificationRead: async () => false,
        markAllAgentNotificationsRead: async () => ({ items: [], storageError: null }),
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector('[aria-label="Start voice conversation"]') || !document.getElementById('root').firstChild);
    assert.deepEqual(errors, [], 'App must render without fixture bridge errors');
    const counts = () => page.evaluate(() => ({ sessions: window.voiceTest.sessions.length, stops: window.voiceTest.stops }));
    const nav = label => page.locator('.sidebar .nav-item').filter({ hasText: label }).first().click();
    await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click();
    for (const label of ['Settings', 'Tools', 'Agent', 'Tiny Agents', 'Support', 'Reporting']) {
      await nav(label);
      assert.equal(await page.getByRole('button', { name: 'Return to chat' }).count(), 1);
      assert.deepEqual(await counts(), { sessions: 1, stops: 0 });
      if (label === 'Settings') {
        const refinement = page.getByRole('switch', { name: 'Experimental recognition hints', exact: true });
        await refinement.waitFor();
        assert.equal(await refinement.getAttribute('aria-checked'), 'false');
        await refinement.click();
        await page.waitForFunction(() => document.querySelector('[aria-label="Experimental recognition hints"]').getAttribute('aria-checked') === 'true');
        assert.equal(await page.getByRole('switch', { name: 'Adaptive reasoning worker', exact: true }).count(), 0);
        assert.equal(await page.getByRole('switch', { name: 'Conversation refinement', exact: true }).count(), 0);
        assert.deepEqual(await counts(), { sessions: 1, stops: 0 });
      }
    }
    await page.getByRole('button', { name: 'Open profile', exact: true }).click();
    assert.deepEqual(await counts(), { sessions: 1, stops: 0 });
    await page.evaluate(() => window.voiceTest.notification({ ruleId: 'fixture' }));
    await page.getByRole('button', { name: 'Return to chat' }).click();
    await page.getByRole('textbox', { name: 'Ask Orvix', exact: true }).fill('Remember this navigation test');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await nav('Settings');
    await page.evaluate(() => {
      const c = window.voiceTest.sessions[0].callbacks;
      c.onTranscript({ id: 'reply', role: 'assistant', text: 'Reply delivered while on Settings', phase: 'final' });
      c.onStatus('listening');
    });
    await page.getByRole('button', { name: 'Return to chat' }).click();
    assert.equal(await page.getByText('Reply delivered while on Settings', { exact: true }).count(), 1);
    await page.locator('.history-item').first().click();
    assert.deepEqual(await counts(), { sessions: 1, stops: 0 });
    await nav('Tools');
    await page.getByRole('button', { name: 'Stop voice conversation', exact: true }).click();
    assert.deepEqual(await counts(), { sessions: 1, stops: 1 });
    assert.equal(await page.getByRole('button', { name: 'Return to chat' }).count(), 0);
    await nav('Home');
    await page.evaluate(() => { window.voiceTest.deferStart = true; });
    await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click();
    await nav('Settings');
    assert.deepEqual(await counts(), { sessions: 2, stops: 1 });
    await page.evaluate(() => window.voiceTest.sessions[1].finishStart());
    await page.waitForFunction(() => document.querySelector('.persistent-voice-bar')?.textContent.includes('Listening'));
    await page.getByRole('button', { name: 'Return to chat' }).click();
    await page.getByRole('button', { name: 'Thinking', exact: true }).click();
    assert.deepEqual(await counts(), { sessions: 2, stops: 2 });
    await page.evaluate(() => {
      const c = window.voiceTest.sessions[1].callbacks;
      c.onStatus('responding');
      c.onTranscript({ id: 'late', role: 'assistant', text: 'Stale reply', phase: 'final' });
    });
    await nav('Settings');
    assert.equal(await page.getByRole('button', { name: 'Return to chat' }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('Voice navigation checks passed: pages, notifications, connecting state, background replies, same-chat return, explicit stop, profile switch, and stale callbacks.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
