const { _electron } = require('playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged'), live = process.argv.includes('--live');
// The distributed app does not bundle developer credentials. Pass existing
// configured credentials privately into this isolated provider test process.
if (live) require('../electron/live-env.cjs').loadLiveEnv(root);
const directory = fs.mkdtempSync(path.join(root, 'scratch', 'memory-validation-'));
const reportPath = path.join(root, 'scratch', `companion-memory-${packaged ? 'packaged' : 'native'}${live ? '-live' : ''}.report.json`);
const report = { at: new Date().toISOString(), scope: 'Windows Electron app with isolated user data, actual DPAPI encrypted SQLite and UI; no physical microphone/speaker validation', packaged, live, checks: [], provider: [], passed: false };
const check = (name, action) => Promise.resolve().then(action).then(() => { report.checks.push(name); console.log('PASS', name); });
let app, page;
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: packaged ? path.join(root, 'scratch/memory-package/win-unpacked/Orvix.exe') : require('electron'),
    args: packaged ? ['--user-data-dir=' + directory] : [path.join(__dirname, 'companion_memory_validation_bootstrap.cjs'), '--memory-test-data=' + directory], env, timeout: 60000 });
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(value => value.url().endsWith('/index.html')); if (!page) await new Promise(resolve => setTimeout(resolve, 200)); }
  if (!page) throw Error('Orvix renderer unavailable');
  await page.waitForSelector('.memory-chat-controls', { timeout: 30000 });
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(directory));
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node }));
}
const snapshot = () => page.evaluate(() => window.orvixDesktop.listCompanionMemories());
const home = () => page.getByRole('button', { name: 'Home', exact: true }).click();
async function command(text) { await home(); const input = page.getByRole('textbox', { name: 'Ask Orvix', exact: true }); await input.fill(text); await input.press('Enter'); }
async function waitCount(count) { await page.waitForFunction(async expected => (await window.orvixDesktop.listCompanionMemories()).records.length === expected, count); }
async function ask(text, expected) {
  const prior = await page.locator('.message.assistant').count();
  const input = page.getByRole('textbox', { name: 'Ask Orvix', exact: true }); await input.fill(text); await input.press('Enter');
  try { await page.waitForFunction(({ prior, expected }) => {
    const values = [...document.querySelectorAll('.message.assistant .message-content')];
    const status = document.querySelector('.simple-voice-status')?.textContent || '';
    return !!document.querySelector('.simple-voice-status.is-error') || values.length > prior && status === '' && !!values.at(-1)?.querySelector('p')?.textContent?.trim();
  }, { prior, expected }, { timeout: 90000 }); }
  catch (failure) {
    report.lastProviderState = { expected, reply: (await page.locator('.message.assistant .message-content').allTextContents()).at(-1) || '',
      status: await page.locator('.simple-voice-status').allTextContents(), errors: await page.locator('.simple-voice-status.is-error').allTextContents() };
    throw failure;
  }
  const connectionError = await page.locator('.simple-voice-status.is-error').allTextContents();
  if (connectionError.length) throw Error(connectionError.join('; '));
  const answer = await page.locator('.message.assistant .message-content').last().innerText();
  if (!answer.includes(expected)) { report.lastProviderState = {expected,reply:answer}; throw Error(`Provider answer did not include expected ${expected}.`); }
  return answer;
}
(async () => {
  try {
    await launch();
    await check('manual save and actual encrypted SQLite', async () => {
      await page.getByRole('button', { name: 'Memories', exact: true }).click();
      await page.getByLabel('Add a memory', { exact: true }).fill('I prefer short Banglish replies CANARY-9281');
      await page.getByLabel('Memory kind', { exact: true }).selectOption('preference');
      await page.getByRole('button', { name: 'Add memory', exact: true }).click(); await waitCount(1);
      await page.screenshot({ path: path.join(root, 'scratch', 'companion-memory-ui.png'), fullPage: true });
      const value = await snapshot(); assert.equal(value.error, ''); assert.equal(value.records[0].source.type, 'manual');
      assert.equal(fs.readFileSync(path.join(directory, 'companion-memory.sqlite')).includes(Buffer.from('CANARY-9281')), false);
    });
    await check('edit replaces the note and advances the privacy boundary', async () => {
      const before = await snapshot(); await page.getByRole('button', { name: /^Edit memory:/ }).click();
      await page.getByLabel('Edit memory', { exact: true }).fill('I prefer short English replies CANARY-3847');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.waitForFunction(async () => (await window.orvixDesktop.listCompanionMemories()).records[0].text.includes('3847'));
      const after = await snapshot(); assert.equal(after.records[0].id, before.records[0].id); assert.ok(after.contextFloor > before.contextFloor);
    });
    await check('typed remember is local, source-tagged and absent from chat history', async () => {
      await command('remember this: My project code is MAPLE-7319'); await waitCount(2);
      const value = await snapshot(); assert.equal(value.records.find(item => item.text.includes('MAPLE')).source.type, 'user_message');
      const chats = await page.evaluate(() => localStorage.getItem('orvix.homeConversations.v2')); assert.equal(chats?.includes('MAPLE-7319') || false, false);
    });
    await check('ambiguous forget never deletes a note', async () => {
      await command('remember this: My second project code is CEDAR-1248'); await waitCount(3);
      await command('forget project code'); await page.waitForSelector('#memory-heading'); assert.equal((await snapshot()).records.length, 3);
    });
    await check('exact forget and multilingual show commands', async () => {
      await command('forget My second project code is CEDAR-1248'); await waitCount(2);
      await command('memories dekhao'); await page.waitForSelector('#memory-heading'); assert.equal((await snapshot()).records.some(item => item.text.includes('CEDAR')), false);
    });
    await check('disable retains notes and prevents recall', async () => {
      await page.getByLabel('Use saved memories', { exact: true }).click();
      await page.waitForFunction(async () => !(await window.orvixDesktop.listCompanionMemories()).enabled && !document.querySelector('.memory-enabled input').checked && !document.querySelector('.memory-enabled input').disabled);
      const value = await page.evaluate(() => window.orvixDesktop.recallCompanionMemories({ query: 'project code' })); assert.equal(value.status, 'disabled'); assert.equal(value.records.length, 0);
      await page.getByLabel('Use saved memories', { exact: true }).click();
      await page.waitForFunction(async () => (await window.orvixDesktop.listCompanionMemories()).enabled && document.querySelector('.memory-enabled input').checked && !document.querySelector('.memory-enabled input').disabled);
    });
    await check('restart persistence with actual DPAPI', async () => {
      await app.close(); app = null; page = null; await launch(); assert.equal((await snapshot()).records.length, 2);
      const value = await page.evaluate(() => window.orvixDesktop.recallCompanionMemories({ query: 'project code' })); assert.equal(value.records[0].text, 'My project code is MAPLE-7319');
    });
    if (live) {
      for (const profile of ['Fast', 'Thinking']) {
        await home(); await page.getByRole('button', { name: profile, exact: true }).click();
        const run = { profile, answers: [], passed: false }; report.provider.push(run);
        try {
          run.answers.push(await ask('Answer in English. What is my saved project code? Reply with only the code. Use saved memory if necessary.', 'MAPLE-7319'));
          run.answers.push(await ask('What is my saved reply language preference? Answer in English using only the language name.', 'English'));
          run.passed = true; console.log('PASS live recall', profile);
        } catch (failure) { run.error = failure.message; throw failure; }
      }
      await check('forget ends the active typed provider session and removes the saved code', async () => {
        await command('forget My project code is MAPLE-7319'); await waitCount(1);
        assert.equal(await page.locator('.simple-voice-status').count(), 0);
        const recall = await page.evaluate(() => window.orvixDesktop.recallCompanionMemories({ query: 'project code' })); assert.equal(recall.records.length, 0);
      });
      for (const profile of ['Fast', 'Thinking']) {
        await home(); await page.getByRole('button', { name: profile, exact: true }).click();
        const run = { profile, scenario: 'fresh session after forgetting, previous visible history excluded', answers: [], passed: false }; report.provider.push(run);
        try {
          const answer = await ask('What is my saved project code? Use saved memory. If no saved code is available, reply only UNKNOWN. Do not guess.', 'UNKNOWN');
          assert.equal(answer.includes('MAPLE-7319'), false); run.answers.push(answer); run.passed = true;
          console.log('PASS live forgetting', profile);
        } catch (failure) { run.error = failure.message; throw failure; }
      }
    }
    await check('clear-all confirmation and persistence of deletion', async () => {
      await command('show my memories'); await page.waitForSelector('#memory-heading');
      await page.getByRole('button', { name: 'Clear all', exact: true }).click(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.ok((await snapshot()).records.length > 0);
      await page.getByRole('button', { name: 'Clear all', exact: true }).click(); await page.getByRole('button', { name: 'Forget all memories', exact: true }).click(); await waitCount(0);
      await app.close(); app = null; page = null; await launch(); assert.equal((await snapshot()).records.length, 0);
    });
    await check('bounded storage and recall latency at 250 notes', async () => {
      report.performance = await app.evaluate(({ app, safeStorage }, modulePath) => {
        const path = process.getBuiltinModule('path'), fs = process.getBuiltinModule('fs');
        const requireModule = process.getBuiltinModule('module').createRequire(modulePath);
        const { createCompanionMemory } = requireModule(modulePath);
        const store = createCompanionMemory({ directory: path.join(app.getPath('userData'), 'benchmark'), safeStorage });
        const before = process.memoryUsage();
        const begin = performance.now();
        for (let i = 0; i < 250; i++) store.upsert({ text: `Screen note ${i}: ${'confirmed context '.repeat(24)}`, kind: 'fact' });
        const writeMs = performance.now() - begin;
        const times = [];
        for (let i = 0; i < 100; i++) { const start = performance.now(); store.recall({ query: 'screen context' }); times.push(performance.now() - start); }
        times.sort((a, b) => a - b); const after = process.memoryUsage();
        const result = { notes: store.snapshot().records.length, databaseBytes: fs.statSync(store.target).size,
          totalWriteMs: writeMs, recallMedianMs: times[50], recallP95Ms: times[95],
          mainProcessHeapDeltaBytes: after.heapUsed - before.heapUsed, mainProcessRssDeltaBytes: after.rss - before.rss,
          note: 'Observed within the isolated Electron main process; deltas include allocation/GC effects, not a steady-state whole-app RAM or idle CPU benchmark.' };
        store.clear(); store.close(); return result;
      }, packaged ? path.join(await app.evaluate(({app})=>app.getAppPath()), 'electron/companion-memory.cjs') : path.join(root, 'electron/companion-memory.cjs'));
      assert.equal(report.performance.notes, 250); assert.ok(report.performance.databaseBytes < 2_000_000); assert.ok(report.performance.recallP95Ms < 100);
    });
    report.passed = true;
  } catch (failure) { report.error = failure.stack || failure.message; console.error(report.error); process.exitCode = 1; }
  finally { if (app) await app.close().catch(() => {}); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log('Report', reportPath); }
})();
