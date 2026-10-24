// Isolated real Electron renderer. Actions are recorded, never sent to the OS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { createTinyRuntime } = require('../electron/tiny-runtime.cjs');
  app.setPath('userData', process.env.ORVIX_TINY_UI_DIR);
  app.whenReady().then(async () => {
    let window;
    const effects = [];
    const runtime = await createTinyRuntime(app, { notify: () => { effects.push('notify'); return {status:'shown'}; }, executeAction: async a => { effects.push(a.type); }, shutdown: () => { effects.push('shutdown'); },
      onChange: value => { if (window && !window.isDestroyed()) window.webContents.send('orvix:tiny-agent-event', value); },
      onWorkflowEvent: value => { if(window&&!window.isDestroyed())window.webContents.send('orvix:tiny-workflow-event',value); },
      onControl: value => {if(window&&!window.isDestroyed())window.webContents.send('orvix:tiny-runtime-control',value);},
    },{capabilities:()=>({workModel:'fixture-model'}),validateDefinition:()=>({status:'ready'}),notify:async()=>({status:'queued'})});
    const engine=runtime.agents, workflows=runtime.workflows;
    ipcMain.handle('orvix:tiny-runtime-health',()=>runtime.health());
    ipcMain.handle('orvix:tiny-runtime-control',(_event,input)=>runtime.control(input));
    for (const [name, fn] of Object.entries({
      list: () => engine.list(), draft: input => engine.draft(input), approve: id => engine.approve(id), enabled: (id, value) => engine.setEnabled(id, value), delete: id => engine.remove(id),
      preview: input => engine.preview(input), snooze: (id, seconds) => engine.snooze(id, seconds), duplicate: id => engine.duplicate(id), 'cancel-shutdown': () => engine.cancelShutdown(),
      'pick-path': () => process.env.ORVIX_TINY_UI_DIR,
    })) ipcMain.handle(`orvix:tiny-agents-${name}`, (_event, ...args) => fn(...args));
    ipcMain.handle('orvix:notification-test', () => ({ status: 'queued', id: 'fixture-notice' }));
    let construction = { supported: true, lock: null },constructionReview;
    const constructionFixture={failList:false,malformed:false,failMessage:false,failAccess:false,holdActivation:false,holdUnlock:false,events:[]};
    ipcMain.handle('orvix:construction-lock-list', () => {if(constructionFixture.failList)throw Error('Fixture protection status disconnected');if(constructionFixture.malformed==='attempts')return {...construction,lock:{...construction.lock,attempts:[null]}};if(constructionFixture.malformed==='issues')return {...construction,lock:{...construction.lock,verification:{issues:[{}]}}};if(constructionFixture.malformed)return {supported:true,lock:{id:'bad',status:'active',targets:null}};return construction;});
    ipcMain.handle('orvix:construction-lock-preview',(_event,input)=>{
      const value=require('../electron/construction-lock.cjs').validateInput(input);
      const ready=!value.targets.some(target=>target.includes('missing'));
      constructionReview={id:'fixture-review',signature:JSON.stringify(value)};
      return {...value,ready,reviewId:ready?constructionReview.id:undefined,checkedAt:Date.now(),totalEntries:value.targets.length,targets:value.targets.map(target=>({path:target,kind:'file',entries:1,status:ready?'ready':'unavailable',message:ready?undefined:'Fixture path does not exist'}))};
    });
    ipcMain.handle('orvix:construction-lock-start', (_event, input) => {
      const value=require('../electron/construction-lock.cjs').validateInput(input);
      if(input.reviewId!==constructionReview?.id||constructionReview.signature!==JSON.stringify(value))throw Error('Fixture review does not match');
      constructionFixture.events.push('activate');
      construction = { supported: true, lock: { id: 'construction-fixture', targets: value.targets, mode: value.mode, status: 'active', expiresAt: Date.now() + value.durationMinutes * 60000, error: null, auditHealth: 'watching', recoveryDirectory: process.env.ORVIX_TINY_UI_DIR, recoveryLauncher:'fixture-recover.cmd', attempts: [] } };
      if(constructionFixture.holdActivation){construction.lock.status='awaiting_windows_approval';construction.operation={kind:'activation',phase:'awaiting_windows_approval',id:construction.lock.id,cancelRequested:false};return new Promise(resolve=>{constructionFixture.releaseActivation=()=>{construction.lock.status='failed';construction.lock.error='Activation cancelled before permissions changed.';construction.operation=null;resolve(construction);};});}
      return construction;
    });
    ipcMain.handle('orvix:construction-lock-unlock', () => {constructionFixture.events.push('unlock');if(constructionFixture.holdUnlock){construction.lock.status='restoring';construction.operation={kind:'unlock',phase:'restoring',id:construction.lock.id,cancelRequested:false};return new Promise(resolve=>{constructionFixture.releaseUnlock=()=>{construction.operation=null;construction.lock.status='unlocked';resolve(construction);};});}construction.lock.status = 'unlocked';return construction;});
    ipcMain.handle('orvix:construction-lock-control',(_event,input)=>{
      constructionFixture.events.push(input.action);
      if(input.action==='cancel_activation'){construction.operation.cancelRequested=true;construction.operation.phase='cancelling';if(constructionFixture.holdCancellation){const snapshot=structuredClone(construction);return new Promise(resolve=>{constructionFixture.releaseCancellation=()=>resolve(snapshot);});}return construction;}
      if(input.action==='check_access'){construction.lock.status=constructionFixture.failAccess?'access_attention':'unlocked';construction.lock.verification={status:constructionFixture.failAccess?'attention':'verified',issues:constructionFixture.failAccess?[{reason:'baseline_missing',message:'The original access record is missing.'}]:[]};return construction;}
      if(input.action==='test_message'){if(constructionFixture.failMessage)throw Error('Fixture native message unavailable');return {message:'Test message acknowledged. No permissions changed.'};}
      return {message:input.action==='copy_recovery'?'Recovery details copied.':'Explorer reveal requested.'};
    });
    ipcMain.handle('orvix:pc-snapshot', () => null);
    ipcMain.handle('orvix:opencode-status', () => ({ zen: { configured: false }, go: { configured: false }, canPersist: false }));
    window = new BrowserWindow({ show: true, x: -10000, y: -10000, focusable: false, skipTaskbar: true, width: 1440, height: 1000, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    global.tinyFixture = { engine, effects, constructionFixture };
    for(const [name,fn] of Object.entries({list:()=>workflows.list(),capabilities:()=>({workModel:'fixture-model'}),inspect:input=>workflows.inspect(input),history:input=>workflows.history(input),draft:input=>workflows.draft(input),manage:input=>workflows.manage(input),'human-input':input=>workflows.recordVoiceInput(input)})) ipcMain.handle('orvix:tiny-workflows-'+name,(_event,input)=>fn(input));
    global.tinyFixture.workflows=workflows;
    let closed=false;app.on('before-quit',event=>{if(!closed){event.preventDefault();void runtime.close().finally(()=>{closed=true;app.quit();});}});
    engine.ingest({ BatteryPercent: 90, Windows: [{ App: 'editor', Active: true }], Activity: { IdleSeconds: 0, IsIdle: false, IsPresentationOrFullscreen: false } });
    global.tinyFixture.pc = { BatteryPercent: 90, Brightness: 50, Volume: 30, Muted: false, Windows: [{ App: 'editor', Active: true }], Activity: { IdleSeconds: 0, IsIdle: false, IsPresentationOrFullscreen: false } };
    engine.start();
    const pcTimer = setInterval(() => engine.ingest(global.tinyFixture.pc), 250);
    app.on('before-quit', () => { clearInterval(pcTimer); engine.stop(); });
    await window.loadFile(path.join(root, 'dist/index.html'));
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  async function main() {
    const { _electron } = require('playwright-core');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-tiny-ui-'));
    const env = { ...process.env, ORVIX_TINY_UI_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    let desktop;
    try {
      desktop = await _electron.launch({ executablePath: require('electron'), args: [__filename], env, timeout: 30000 });
      const page = await desktop.firstWindow();
      const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message); });
      await page.getByRole('button', { name: 'Tiny Agents', exact: true }).click();
      await page.getByRole('heading', { name: 'Tiny Agents', exact: true }).waitFor();
      await page.getByRole('button',{name:'Start reviewed agents',exact:true}).click();
      await page.getByText('Tiny Agents enabled',{exact:true}).waitFor();
      await page.locator('#startup-splash').waitFor({state:'detached'});
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:path.join(root,'scratch','tiny-agents-premium-overview.png'),animations:'disabled'});
      await page.getByRole('link',{name:'Monitors',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#tiny-monitors').getBoundingClientRect().top < 160);
      await page.screenshot({path:path.join(root,'scratch','tiny-agents-premium-monitors.png'),animations:'disabled'});
      await page.getByRole('link',{name:'Workshop',exact:true}).click();
      const workshop=page.getByRole('region',{name:'Agent Workshop',exact:true});
      await workshop.getByRole('button',{name:'New workflow',exact:true}).click();
      const builder=page.getByRole('dialog',{name:'Build workflow',exact:true});
      await builder.getByLabel('Name',{exact:true}).fill('Disposable workflow UI');
      await builder.getByLabel('Goal',{exact:true}).fill('Check a current battery fixture and follow a delay');
      await builder.getByLabel('Check',{exact:true}).selectOption('condition');
      await builder.getByLabel('Signal',{exact:true}).selectOption('battery_percent');
      await builder.getByLabel('Comparison',{exact:true}).selectOption('gte');
      await builder.getByLabel('Value',{exact:true}).fill('90');
      await builder.getByLabel('Add a building block').selectOption('delay');
      await builder.getByLabel('Exact seconds',{exact:true}).fill('1.5');
      await builder.getByRole('button',{name:'Close workflow builder'}).focus();
      await page.keyboard.press('Shift+Tab');
      assert.match(await page.evaluate(()=>document.activeElement.textContent),/Save for complete review/,'focus stays inside the workflow dialog');
      await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
      const accessibility=await page.evaluate(async()=>{const result=await window.axe.run('.wf-editor',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return result.violations.map(value=>({id:value.id,impact:value.impact,nodes:value.nodes.map(node=>node.target)}));});
      assert.deepEqual(accessibility,[],'workflow builder accessibility');
      await builder.getByRole('button',{name:'Save for complete review',exact:true}).click();
      await builder.waitFor({state:'hidden'});
      assert.equal(await desktop.evaluate(()=>global.tinyFixture.workflows.list().runs.length),0,'saving is review-only');
      await workshop.getByText('Synthetic preview · no execution',{exact:true}).click();
      await workshop.getByText('This walk-through uses the saved plan only.',{exact:false}).waitFor();
      assert.equal(await desktop.evaluate(()=>global.tinyFixture.workflows.list().runs.length),0,'synthetic preview does not execute');
      await workshop.getByText('Synthetic preview · no execution',{exact:true}).click();
      await workshop.getByRole('button',{name:'Approve this revision and run',exact:true}).click();
      await workshop.getByRole('region',{name:'Live workflow work'}).waitFor();
      const navigation=page.getByRole('button',{name:'Projects',exact:true});
      if(await navigation.count()) {await navigation.click();await page.getByRole('button',{name:'Tiny Agents',exact:true}).click();}
      await page.waitForFunction(()=>document.querySelector('.wf-run-status strong')?.textContent==='verified');
      await workshop.getByRole('button',{name:'Inspect this run’s approved revision 1',exact:true}).click();
      await workshop.getByRole('region',{name:'Approved run revision',exact:true}).waitFor();
      assert.equal(await desktop.evaluate(()=>global.tinyFixture.workflows.list().runs.length),1,'navigation does not duplicate runs');
      assert.equal(await desktop.evaluate(()=>global.tinyFixture.effects.length),0,'workflow fixtures send no OS effects');
      const sequences=await desktop.evaluate(async()=>(await global.tinyFixture.workflows.history()).records.map(value=>value.sequence));
      assert.deepEqual(sequences,[...sequences].sort((a,b)=>a-b));
      await page.setViewportSize({width:800,height:900});
      assert.equal(await workshop.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,'Workshop fits compact windows');
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await workshop.evaluate(element=>getComputedStyle(element).animationName),'none');
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:path.join(root,'scratch','tiny-workflow-workshop.png')});
      const workshopAccessibility=await page.evaluate(async()=>{const result=await window.axe.run('.wf-workshop',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return result.violations.map(value=>({id:value.id,impact:value.impact,nodes:value.nodes.map(node=>node.target)}));});
      assert.deepEqual(workshopAccessibility,[],'workflow review and work accessibility');
      const pageAccessibility=await page.evaluate(async()=>{const result=await window.axe.run('.tiny-page',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return result.violations.map(value=>({id:value.id,impact:value.impact,nodes:value.nodes.map(node=>node.target)}));});
      assert.deepEqual(pageAccessibility,[],'Tiny Agents page accessibility');
      assert.equal(await page.locator('.tiny-page').evaluate(element=>element.scrollWidth>element.clientWidth+1),false,'Tiny Agents page fits the window');
      assert.equal(await page.locator('.tiny-signal-orbit').evaluate(element=>getComputedStyle(element,'::after').animationName),'none','decorative motion respects reduced motion');
      const protection = page.getByRole('region', { name: 'Construction Lock', exact: true });
      await protection.getByRole('button', { name: 'Protect files or folders' }).click();
      await protection.getByLabel('Construction protected paths').fill('C:\\Disposable\\draft.txt');
      await protection.getByLabel('Construction duration minutes').fill('10');
      await protection.getByRole('button',{name:'Check selected paths',exact:true}).click();
      await protection.getByRole('region',{name:'Reviewed protection selection'}).waitFor();
      await protection.getByRole('button', { name: 'Activate Windows protection' }).click();
      await protection.getByText('Windows protection active', { exact: true }).waitFor();
      assert.equal(await protection.getByLabel('Construction protected paths').isDisabled(), true);
      await protection.getByRole('button', { name: 'Unlock now' }).click();
      await protection.getByText('Access restored and checked', { exact: true }).waitFor();
      assert.equal(await protection.getByText('Access monitoring: stopped', { exact: true }).count(), 1);
      assert.equal(await protection.getByLabel('Construction protected paths').isEnabled(), true);
      await page.setViewportSize({ width: 800, height: 900 });
      assert.equal(await protection.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'expanded construction settings must fit a compact window');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: path.join(root, 'scratch', 'construction-lock-panel.png') });
      await protection.getByRole('button', { name: 'Hide settings' }).click();
      await page.getByRole('button', { name: 'Templates', exact: true }).click();
      assert.equal(await page.locator('.tiny-templates button').count(), 12);
      await page.locator('.tiny-templates button').filter({ hasText: 'Weekday reminder' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Test conditions', exact: true }).click();
      await dialog.locator('.tiny-preview').waitFor();
      assert.match(await dialog.locator('.tiny-preview').innerText(), /Whenever the schedule is due/);
      assert.equal(await desktop.evaluate(() => global.tinyFixture.effects.length), 0, 'preview must never execute actions');
      const captures = path.join(root, 'scratch'); fs.mkdirSync(captures, { recursive: true });
      await page.screenshot({ path: path.join(captures, 'tiny-agent-schedule-preview.png') });
      await dialog.getByRole('button', { name: 'Save for review', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await desktop.evaluate(() => global.tinyFixture.engine.list().rules[0].draft), true);
      await page.getByRole('button', { name: 'Approve & enable', exact: true }).click();
      await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
      await page.getByRole('button', { name: '30 min', exact: true }).click();
      await page.getByRole('button', { name: 'Clear snooze', exact: true }).waitFor();
      assert.ok(await desktop.evaluate(() => global.tinyFixture.engine.list().rules[0].snoozedUntil > Date.now()));
      await page.getByRole('button', { name: 'Clear snooze', exact: true }).click();
      await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
      await page.locator('.tiny-detail h2').filter({ hasText: '(copy)' }).waitFor();
      assert.equal(await desktop.evaluate(() => global.tinyFixture.engine.list().rules.length), 2);
      assert.equal(await desktop.evaluate(() => global.tinyFixture.engine.list().rules[0].enabled), false);
      await page.getByRole('button', { name: 'New tiny agent', exact: true }).click();
      await dialog.getByLabel('Name', { exact: true }).fill('Sequence fixture');
      await dialog.getByLabel('Condition 1 value', { exact: true }).fill('20');
      await dialog.getByRole('button', { name: 'Add action', exact: true }).click();
      await dialog.getByLabel('Action 2 type', { exact: true }).selectOption('open_url');
      await dialog.getByLabel('Action 2 target', { exact: true }).fill('javascript:alert(1)');
      await dialog.getByRole('button', { name: 'Save for review', exact: true }).click();
      await dialog.getByRole('alert').waitFor(); assert.match(await dialog.getByRole('alert').innerText(), /http/);
      await dialog.getByLabel('Action 2 target', { exact: true }).fill('https://example.com');
      await dialog.getByLabel('Wait while fullscreen or presenting').check();
      await dialog.getByLabel('Use quiet hours').check();
      await dialog.getByLabel('Daily run limit (0 = unlimited)').fill('3');
      await dialog.getByLabel('Cooldown in seconds').fill('60');
      await dialog.getByRole('button', { name: 'Save for review', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const sequence = await desktop.evaluate(() => global.tinyFixture.engine.list().rules[0]);
      assert.equal(sequence.actions.length, 2); assert.equal(sequence.policy.maxPerDay, 3); assert.equal(sequence.policy.deferFullscreen, true);
      await page.getByRole('button', { name: 'Templates', exact: true }).click();
      await page.locator('.tiny-templates button').filter({ hasText: 'New PDF' }).click();
      await dialog.getByRole('button', { name: 'Browse condition 1 path' }).click();
      await page.waitForFunction(expected => document.querySelector('[aria-label="Condition 1 target"]')?.value === expected, dir);
      assert.equal(await dialog.getByLabel('Condition 1 target').inputValue(), dir);
      await dialog.getByRole('button', { name: 'Save for review', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await desktop.evaluate(() => global.tinyFixture.engine.list().rules[0].condition.children[0].signal), 'folder_new_file');
      await page.screenshot({ path: path.join(captures, 'tiny-agents-features-preview.png') });
      const overflow = await page.locator('.tiny-page').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, 'desktop tiny-agent page must fit');
      await page.setViewportSize({ width: 800, height: 900 });
      assert.equal(await page.locator('.tiny-page').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'compact tiny-agent page must fit');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'New tiny agent', exact: true }).click();
      await dialog.getByLabel('Trigger mode').selectOption('change');
      await dialog.getByLabel('Name', {exact:true}).fill('Brightness watch fixture');
      assert.equal(await dialog.getByLabel('Watch 1 signal').inputValue(),'brightness_percent');
      assert.equal(await dialog.getByLabel('Watch 1 minimum change').inputValue(),'1');
      assert.equal(await dialog.getByLabel('Change settling seconds').inputValue(),'1');
      assert.equal(await dialog.getByLabel('Action 1 type').locator('option').count(),1);
      await dialog.getByRole('button',{name:'Add watched signal',exact:true}).click();
      await dialog.getByLabel('Watch 2 signal').selectOption('muted');
      await dialog.getByRole('button',{name:'Test conditions',exact:true}).click();
      assert.match(await dialog.locator('.tiny-preview').innerText(),/Baseline: 50/);
      await dialog.evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({path:path.join(captures,'tiny-agent-change-builder.png')});
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1),false,'change builder must fit');
      await page.setViewportSize({width:800,height:900});
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1),false,'compact change builder must fit');
      await page.setViewportSize({width:1440,height:1000});
      await dialog.getByRole('button',{name:'Save for review',exact:true}).click();
      await dialog.waitFor({state:'hidden'});
      const changes = await desktop.evaluate(() => global.tinyFixture.engine.list().rules[0]);
      assert.equal(changes.trigger.watches.length,2); assert.equal(changes.fireOnApproval,false);
      await page.getByRole('button',{name:'Approve & enable',exact:true}).click();
      await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
      const countBefore=await desktop.evaluate(() => global.tinyFixture.effects.length);
      await desktop.evaluate(() => { global.tinyFixture.pc.Brightness=51; global.tinyFixture.pc.Muted=true; global.tinyFixture.engine.ingest(global.tinyFixture.pc); });
      await page.waitForFunction(() => document.querySelector('.tiny-activity-list')?.textContent.includes('Brightness: 50% → 51%'));
      assert.equal(await desktop.evaluate(() => global.tinyFixture.effects.length),countBefore+1);
      await page.getByRole('button',{name:'Edit rule',exact:true}).click();
      assert.equal(await dialog.getByLabel('Trigger mode').inputValue(),'change');
      assert.equal(await dialog.getByLabel('Watch 2 signal').inputValue(),'muted');
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.screenshot({path:path.join(captures,'tiny-agent-change-delivery.png')});
      await page.getByRole('button',{name:'Home',exact:true}).click();
      await page.getByRole('button',{name:'Stop all Tiny Agents from any page',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.tiny-execution-indicator')?.textContent.includes('Agents stopped'));
      assert.equal(await desktop.evaluate(()=>global.tinyFixture.engine.list().rules.some(rule=>rule.enabled)),false,'Stop all disables monitors when away from their page');
      const stoppedCount=await desktop.evaluate(()=>global.tinyFixture.effects.length);
      await desktop.evaluate(()=>{global.tinyFixture.pc.Brightness=70;global.tinyFixture.engine.ingest(global.tinyFixture.pc);});
      await page.waitForTimeout(1200);assert.equal(await desktop.evaluate(()=>global.tinyFixture.effects.length),stoppedCount,'stopped agents cannot keep producing effects');
      await page.getByRole('button',{name:'Tiny Agents',exact:true}).click();
      await page.getByText('Tiny Agents stopped',{exact:true}).waitFor();
      assert.equal(await page.getByRole('checkbox',{name:'Explicitly keep Tiny Agents running when I close the window'}).isChecked(),false);
      await page.getByRole('button',{name:'Start reviewed agents',exact:true}).click();
      await page.getByText('Tiny Agents enabled',{exact:true}).waitFor();
      assert.equal(await desktop.evaluate(()=>global.tinyFixture.engine.list().rules[0].enabled),true,'explicit Start restores the previously approved monitor');
      assert.deepEqual(errors, []);
      console.log('PASS: real Electron UI: explicit Start, global Stop from another page, no effects while stopped, background opt-in default off, plus templates, workflow review, changes, approvals, scheduling, keyboard/reduced motion and compact layout.');
    } catch (error) {
      if (desktop) { const pages = desktop.windows(); if (pages[0]) { console.error((await pages[0].locator('body').innerText()).slice(-3000)); fs.mkdirSync(path.join(root, 'scratch'), { recursive: true }); await pages[0].screenshot({ path: path.join(root, 'scratch/tiny-agents-ui-failure.png'), timeout: 5000 }).catch(() => {}); } }
      throw error;
    } finally {
      await desktop?.close();
      const target = path.resolve(dir);
      if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('orvix-tiny-ui-')) throw new Error('Unexpected fixture cleanup path');
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
