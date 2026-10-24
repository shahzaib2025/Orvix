// Exercise real App routes and AgentDashboard with a deferred IPC transport.
// No model calls, credentials, workspace writes, or production history changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function checkWorkspaceUpgrade(page, send) {
  const expectNoBar = async () => {
    assert.equal(await page.locator('.agent-workspace-bar').count(),0);
    assert.equal(await page.getByRole('group',{name:'Workspace layout'}).count(),0);
  };
  const closeChanges = () => page.getByRole('button',{name:'Close changes',exact:true}).click();
  const screenshot = async name => {
    if (!process.env.ORVIX_WORKSPACE_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.ORVIX_WORKSPACE_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.ORVIX_WORKSPACE_SCREENSHOT_DIR,name+'.png')});
  };
  const runsBefore = await page.evaluate(()=>window.agentNavigation.runs.length);
  await expectNoBar();
  await page.evaluate(()=>{window.agentNavigation.workspaces=['C:/workspace'];window.agentNavigation.emit({type:'workspaces',roots:['C:/workspace']});});
  const prompt = page.getByRole('textbox',{name:'Agent prompt',exact:true});
  await prompt.fill('Keep my draft when switching layouts');
  await page.getByRole('button',{name:'Open workspace files and changes',exact:true}).click();
  await page.getByRole('button',{name:'Open workspace file',exact:true}).click();
  await page.getByRole('option',{name:/index.html/}).click();
  await page.locator('.agent-source-view').waitFor();
  await page.getByLabel('More changes actions',{exact:true}).click();
  await page.locator('.agent-changes-overflow-menu').getByRole('button',{name:'Maximize pane',exact:true}).click();
  await page.getByRole('button',{name:'Restore split view',exact:true}).waitFor();
  await expectNoBar();
  await screenshot('workspace-code');
  await page.getByRole('button',{name:'Restore split view',exact:true}).click();
  assert.equal(await page.locator('.agent-changes-panel [role="separator"]').count(),1);
  await closeChanges(); assert.equal(await prompt.inputValue(),'Keep my draft when switching layouts');
  assert.equal(await page.evaluate(()=>window.agentNavigation.runs.length),runsBefore,'pane controls never send model requests');
  await send('Workspace progress fixture');
  await page.waitForFunction(()=>window.agentNavigation.getPending('a')?.messages.at(-1)?.content==='Workspace progress fixture');
  const edit = {type:'tool',callId:'workspace-edit',name:'write_file',detail:'index.html',phase:'started',input:{path:'C:/workspace/index.html'}};
  await page.evaluate(event=>window.agentNavigation.emit(event),edit);
  await page.evaluate(()=>window.agentNavigation.emit({type:'clarification',phase:'started',questionId:'workspace-question',question:'Which page should I check?',options:['Homepage']}));
  const question = page.getByRole('form',{name:'Agent question'});
  await question.waitFor(); await question.getByRole('button',{name:/Homepage/}).click();
  await question.getByRole('button',{name:'Send',exact:true}).click();
  await page.evaluate(()=>window.agentNavigation.emit({type:'approval',phase:'started',approvalId:'workspace-approval',command:'npm run build',directory:'C:/workspace',kind:'command',sandboxAvailable:false}));
  await page.getByRole('button',{name:'Not now',exact:true}).click();
  await page.evaluate(()=>{
    window.agentNavigation.emit({type:'tool',callId:'workspace-edit',name:'write_file',detail:'index.html',phase:'completed'});
    window.agentNavigation.emit({type:'tool',callId:'workspace-check',name:'verify_work',detail:'Build and flow checks',phase:'started'});
  });
  for (const width of [860,390]) {
    await page.setViewportSize({width,height:900});
    await expectNoBar();
  }
  await screenshot('workspace-mobile');
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>{
    const changes=[{path:'C:/workspace/index.html',folder:'C:/workspace',kind:'modified',binary:false,added:22,deleted:3}];
    const checks=[{label:'Build',command:'npm run build',directory:'C:/workspace',status:'passed',output:'Built',durationMs:20,phase:'build'},
      {label:'Homepage flow',command:'browser flow',directory:'C:/workspace',status:'failed',output:'Navigation failed',durationMs:30,phase:'user_flow'},
      {label:'Earlier test',command:'npm test',directory:'C:/workspace',status:'passed',output:'Earlier result',durationMs:10,phase:'regression',stale:true}];
    window.agentNavigation.complete('Workspace edits are ready; the homepage flow needs attention.','a',{changes,turnReport:{changes,recordedAt:Date.now(),comparisonsLimited:false,verification:{status:'failed',reason:'Homepage navigation needs a fix',checks,executionPending:true,requirements:[{id:'r1',text:'Homepage works',status:'pending',verificationTypes:['user_flow'],evidenceIds:[]}]}}});
  });
  const card=page.getByRole('region',{name:'Task completion summary'}).last();
  await card.getByText('Finished · review needed',{exact:true}).waitFor();
  assert.match(await card.innerText(),/1 check passed/); assert.match(await card.innerText(),/1 failed/);
  assert.match(await card.innerText(),/1 check needs a current result/); assert.match(await card.innerText(),/unfinished steps/); assert.match(await card.innerText(),/not yet verified/);
  await card.locator('.agent-completion-evidence > summary').click();
  await card.getByRole('button',{name:/index.html/}).waitFor();
  await card.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.getByRole('tab',{name:/index.html/}).waitFor();
  await closeChanges(); await card.scrollIntoViewIfNeeded(); await screenshot('workspace-completion');
  await card.getByRole('button',{name:/index.html/}).click();
  await page.getByTitle('Preview of index.html',{exact:true}).waitFor();
  assert.equal(await page.locator('.agent-changes-panel').count(),1,'file delivery opens the shared workspace pane');
  assert.equal(await page.locator('.agent-file-panel').count(),0,'file delivery does not create a second sidebar');
  await expectNoBar();
  await page.getByRole('button',{name:'Open workspace file',exact:true}).click();
  await page.getByRole('textbox',{name:'Search workspace files',exact:true}).fill('notes');
  await page.getByRole('option',{name:/notes.md/}).click();
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await page.getByRole('heading',{name:'Preview notes',exact:true}).waitFor();
  await screenshot('workspace-preview');
  await page.getByRole('button',{name:'Close changes',exact:true}).click();
  await card.getByRole('button',{name:'Continue in chat',exact:true}).click();
  assert.equal(await prompt.evaluate(el=>el===document.activeElement),true);
  await send('Workspace successful check fixture');
  await page.evaluate(()=>{
    const checks=[{label:'Build',command:'npm run build',directory:'C:/workspace',status:'passed',output:'Built',durationMs:20,phase:'build'}];
    window.agentNavigation.complete('The recorded build passed.','a',{turnReport:{changes:[],recordedAt:Date.now(),comparisonsLimited:false,verification:{status:'passed',reason:'',checks}}});
  });
  await page.getByRole('region',{name:'Task completion summary'}).last().getByText('Recorded checks passed',{exact:true}).waitFor();
  assert.equal(await page.locator('.agent-completion-card').last().getByText(/Completed fully/).count(),0);
  await expectNoBar();
  console.log('PASS: Workspace bar and layout buttons are removed; existing pane controls, questions, approvals, completion evidence and file previews still work at desktop/mobile sizes.');
}

async function main() {
  const bundle = await require('esbuild').build({
    stdin: { contents: "import {createRoot} from 'react-dom/client'; import App from './src/App'; import RenderErrorBoundary from './src/components/RenderErrorBoundary'; import './src/styles.css'; import './src/theme.css'; createRoot(document.getElementById('root')).render(<App/>); (window as any).mountBoundaryFixture = () => { const host = document.createElement('div'); host.id = 'boundary-fixture'; document.body.append(host); function Child() { if ((window as any).agentNavigation.boundaryShouldThrow) throw new Error('fixture render failure'); return <p>Agent child recovered</p>; } createRoot(host).render(<RenderErrorBoundary scope='Agent' compact><Child/></RenderErrorBoundary>); };", resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' },
    bundle: true, write: false, outfile: 'fixture.js', jsx: 'automatic', format: 'iife', platform: 'browser',
    loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'unused-voice', setup(build) {
      build.onResolve({ filter: /^\.\/liveVoice$/ }, () => ({ path: 'voice', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export class VoiceSession {}', loader: 'js' }));
    } }],
  });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? javascript : `<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (window.top !== window) return;
      let tasks = ['a', 'b'].map(id => ({ id, title: `Session ${id.toUpperCase()}`, projectId: null, accessMode: 'Plan', accessModeVersion: 2, designProfile: 'normal', designReviewMode: 'quality', modelId: 'opencode/space-bunny-free', updatedAt: Date.now(), turns: [{ id: `old-${id}`, prompt: `Initial ${id}`, attachments: [], provider: 'OpenCode', modelId: 'opencode/space-bunny-free', accessMode: 'Plan', reply: `Initial reply ${id}`, status: 'done', createdAt: Date.now(), completedAt: Date.now() }] }));
      tasks = JSON.parse(localStorage.getItem('agentNavigationSnapshot') || 'null') || tasks;
      const listeners = new Set(); const questions = new Map(); const pendingRuns = new Map(); const approvals = new Map();
      window.agentNavigation = {
        tasks, reads: 0, writes: 0, subscriptions: 0, cancellations: 0, runs: [], decisions: [], logs: [], pending: null, workspaces: [], fileReads: [], workerPolls: 0, workerSnapshot: { workers: {} },
        preparations: [], deferredWorkspaceLoads: {}, deferWorkspaceLoads: false,
        emit(event) {
          const normalized = { taskId: 'a', requestId: this.pending?.input.requestId ?? this.tasks.find(task => task.id === 'a').turns.at(-1).id, ...event };
          if (normalized.type === 'clarification' && normalized.requestId) {
            if (normalized.phase === 'remove') questions.delete(normalized.requestId);
            else if (normalized.questionId) questions.set(normalized.requestId, { questionId: normalized.questionId, question: normalized.question || '', options: normalized.options || [] });
          }
          if (normalized.type === 'approval' && normalized.taskId) {
            if (normalized.phase === 'remove') approvals.delete(normalized.taskId);
            else approvals.set(normalized.taskId, normalized);
          }
          listeners.forEach(listener => listener(normalized));
        },
        setQuestion(requestId, value) { questions.set(requestId, value); },
        setApproval(taskId, value) { approvals.set(taskId, value); },
        notificationOpen: null,
        complete(text, taskId = 'a', extra = {}) { pendingRuns.get(taskId).resolve({ ok: true, result: { text, modelId: 'fixture', usage: null, changes: [], ...extra } }); pendingRuns.delete(taskId); },
        fail(error, taskId = 'a') { pendingRuns.get(taskId).resolve({ ok: false, error }); pendingRuns.delete(taskId); },
        getPending(taskId) { return pendingRuns.get(taskId)?.input; },
      };
      let openCodeKeepAlive = false;
      const apiStatus = { canPersist: true, naraBaseUrl: 'https://router.bynara.id/v1', zen: { configured: false }, go: { configured: true }, kilo: { configured: true } };
      for (const tier of ['google', 'nara', 'groq', 'cerebras']) apiStatus[tier] = { configured: false, keys: [] };
      localStorage.setItem('orvix.activeAgentTask', 'a');
      localStorage.setItem('orvix.agentHistoryOpen', 'true');
      window.orvixDesktop = {
        logLive: (type, message, details) => window.agentNavigation.logs.push({ type, message, details }),
        getFastSettings: async () => ({ desktopEnabled: false, workerEnabled: false, workerModel: 'fixture', transcriptionHints: false, conversationRefinementEnabled: false }),
        onFastWorkEvent: () => () => {}, listTinyAgents: async () => ({ rules: [], history: [], shutdownPending: null }),
        onTinyAgentEvent: () => () => {}, onNotificationOpen: callback => { window.agentNavigation.notificationOpen = callback; return () => {}; },
        getAgentNotifications: async () => ({ items: [], storageError: null }), onAgentNotifications: () => () => {},
        markAgentNotificationRead: async () => false, markAllAgentNotificationsRead: async () => ({ items: [], storageError: null }),
        onCompanionMemoryChanged: () => () => {},
        listCompanionMemories: async () => ({ enabled: true, revision: 0, contextFloor: 0, records: [], limit: 250, textLimit: 500, error: '' }),
        readAgentTasks: async () => {
          window.agentNavigation.reads++; const snapshot = structuredClone(window.agentNavigation.tasks);
          if (localStorage.getItem('agentHydrationRace') === 'true') {
            localStorage.removeItem('agentHydrationRace'); await new Promise(resolve => setTimeout(resolve, 80));
            const turn = snapshot.find(task => task.id === 'a').turns.at(-1);
            window.agentNavigation.emit({ taskId: 'a', requestId: turn.id, type: 'run_state', run: { ...turn.runState, status: 'completed', phase: 'completed', completedAt: Date.now() }, result: { text: 'Completed during hydration', modelId: 'fixture', usage: null, changes: [] } });
          }
          return snapshot;
        },
        writeAgentTasks: async value => { window.agentNavigation.tasks = structuredClone(value); window.agentNavigation.writes++; localStorage.setItem('agentNavigationSnapshot', JSON.stringify(value)); return true; },
        getOpenCodeStatus: async () => structuredClone(apiStatus),
        getAgentWorkers: async () => { window.agentNavigation.workerPolls++; return structuredClone(window.agentNavigation.workerSnapshot); },
        prepareAgentWorker: async (taskId, directory, modelId) => { window.agentNavigation.preparations.push({taskId, directory, modelId}); },
        getOpenCodeKeepAlive: async () => ({ keepAlive: openCodeKeepAlive }),
        setOpenCodeKeepAlive: async value => { openCodeKeepAlive = value === true; return { keepAlive: openCodeKeepAlive }; },
        changeAgentProviderKey: async (tier, input) => {
          const keys = apiStatus[tier].keys;
          const index = keys.findIndex(key => key.id === input.id);
          if (input.operation === 'add') keys.push({ id: `fixture-${keys.length + 1}`, label: input.label || 'API key', maskedKey: '•••• ' + input.key.slice(-4), enabled: true, source: 'file', status: 'ready', cooldownUntil: 0, attempts: 0, successes: 0, failures: 0 });
          else if (input.operation === 'remove') keys.splice(index, 1);
          else if (input.operation === 'toggle') { keys[index].enabled = !keys[index].enabled; keys[index].status = keys[index].enabled ? 'ready' : 'paused'; }
          else if (input.operation === 'update') { keys[index].label = input.label; keys[index].maskedKey = '•••• ' + input.key.slice(-4); }
          apiStatus[tier].configured = keys.some(key => key.enabled); return structuredClone(apiStatus);
        },
        getOpenCodeModels: async force => { window.agentNavigation.catalogRefreshes = (window.agentNavigation.catalogRefreshes || 0) + Number(force === true); return { updatedAt: force ? Date.now() : 0, stale: !force, error: '', excluded: [{ id: 'opencode/unavailable-free', name: 'Unavailable fixture', reason: 'No compatible runtime metadata.' }], models: [
          { id: 'opencode/space-bunny-free', name: 'Space Bunny Free', route: 'chat', input: ['text', 'image'], variants: ['low', 'high'] },
          { id: 'opencode/fixture-new-free', name: 'New Free Fixture', route: 'chat', input: ['text'], variants: ['low'] },
        ] }; },
        getKiloModels: async () => ({ updatedAt: Date.now(), stale: false, error: '', models: [
          { id: 'kilo/fixture/code:free', apiModelId: 'fixture/code:free', name: 'Fixture Kilo', route: 'chat', access: 'free', input: ['text'], contextLength: 256000, variants: { instant: { enabled: false, effort: 'none' }, thinking: { enabled: true, effort: 'high' } }, mayTrainOnPrompts: false },
          { id: 'kilo/openai/gpt-6-luna', apiModelId: 'openai/gpt-6-luna', name: 'OpenAI: GPT-6 Luna', route: 'responses', access: 'byok', input: ['text', 'image'], contextLength: 1050000, variants: { none: { enabled: false, effort: 'none' }, high: { enabled: true, effort: 'high' } }, mayTrainOnPrompts: false },
        ] }),
        getAgentChanges: async () => [], getAgentWorkspaces: async taskId => window.agentNavigation.deferWorkspaceLoads
          ? new Promise(resolve => { window.agentNavigation.deferredWorkspaceLoads[taskId] = resolve; })
          : window.agentNavigation.workspaces, getAgentTaskMemory: async () => null,
        listAgentWorkspaceFiles: async (task, root) => ({ root, files: ['index.html','style.css','notes.md'].map(name=>({path:root+'/'+name,relativePath:name})), total: 3, truncated: false }),
        readAgentWorkspaceFile: async (task, file) => { window.agentNavigation.fileReads.push(file); return {path:file,content:'<main>Workspace preview fixture</main>',binary:false,tooLarge:false,size:42}; },
        previewAgentFile: async (task, file) => ({path:file,name:file.split('/').at(-1),size:42,modifiedAt:0,kind:file.endsWith('.md')?'text':'html',content:file.endsWith('.md')?'# Preview notes':'<main>Workspace preview fixture</main>',canOpen:true}),
        getAgentDiff: async () => ({before:'Before',after:'After',binary:false}), getAgentTurnDiff: async () => ({before:'Before',after:'After',binary:false}),
        getAgentScorecard: async () => ({ attempts: 1, active: 0, verified: 0, partial: 1, failed: 0, cancelled: 0, interrupted: 0, firstAttempt: { passed: 0, total: 1, rate: 0 }, repeatConsistency: { passedGroups: 0, groups: 0, rate: null }, recovery: { passed: 0, total: 0, rate: null }, regressions: { compared: 0, failed: 0, rate: null }, unsupportedClaimsBlocked: 0, falseCompletionRate: null, tools: [], note: 'Fixture observations, not model accuracy.' }),
        getAgentCheckpoint: async () => null, getAgentTurnReport: async () => null,
        getAgentExecution: async () => ({ execution: null, projects: [], freshness: 'saved' }),
        getAgentQuestion: async (task, request) => questions.get(request) ?? null,
        getAgentApproval: async taskId => approvals.get(taskId) ?? null,
        answerAgentQuestion: async (id, answer) => { window.agentNavigation.answer = answer; window.agentNavigation.emit({ type: 'clarification', phase: 'remove', questionId: id }); return true; },
        approveAgentCommand: async (approvalId, accepted) => { window.agentNavigation.decisions.push({ approvalId, accepted }); for (const [taskId, item] of approvals) if (item.approvalId === approvalId) approvals.delete(taskId); return true; },
        onAgentEvent(listener) { window.agentNavigation.subscriptions++; listeners.add(listener); return () => listeners.delete(listener); },
        runAgent(input) { window.agentNavigation.runs.push(input); return new Promise(resolve => { const pending = { input, resolve }; pendingRuns.set(input.taskId, pending); if (input.taskId === 'a') window.agentNavigation.pending = pending; }); },
        cancelAgent(taskId) { window.agentNavigation.cancellations++; window.agentNavigation.fail('Task cancelled.', taskId); },
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.sidebar').waitFor();
    assert.equal(await page.evaluate(() => window.agentNavigation.reads), 0, 'agent history should load only when first visited');
    const nav = name => page.locator('.sidebar .nav-item').filter({ hasText: name }).first().click();
    const session = async name => {
      const row = page.locator('.agent-history-item').filter({ hasText: name });
      if (!await row.isVisible()) await page.getByRole('button', { name: 'Show agent history', exact: true }).click();
      await row.click();
    };
    const prompt = page.getByRole('textbox', { name: 'Agent prompt', exact: true });
    const send = async text => { await prompt.fill(text); await page.getByRole('button', { name: 'Send prompt', exact: true }).click(); };
    const persisted = (count, status) => page.waitForFunction(({ count, status }) => {
      const turns = window.agentNavigation.tasks.find(task => task.id === 'a').turns;
      return turns.length === count && turns.at(-1).status === status;
    }, { count, status });

    if (process.env.ORVIX_SCORECARD_ONLY === '1') await page.evaluate(() => { window.agentNavigation.workspaces = ['C:/scorecard-workspace']; });
    await nav('Agent'); await page.getByText('Initial reply a', { exact: true }).waitFor();
    if (process.env.ORVIX_IDLE_UI_ONLY === '1' || process.argv.includes('--idle-ui')) {
      await page.waitForFunction(() => window.agentNavigation.workerPolls > 0);
      await page.evaluate(() => {
        window.fixtureHidden = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.fixtureHidden });
        window.fixtureHidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(50);
      const polls = await page.evaluate(() => window.agentNavigation.workerPolls);
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => window.agentNavigation.workerPolls), polls, 'hidden window stops display-only server polling');
      await page.evaluate(() => { window.fixtureHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(count => window.agentNavigation.workerPolls > count, polls, { timeout: 800 });
      await nav('Home');
      const awayPolls = await page.evaluate(() => window.agentNavigation.workerPolls);
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => window.agentNavigation.workerPolls), awayPolls, 'Agent page navigation stops its display polling');
      await nav('Agent');
      await page.waitForFunction(count => window.agentNavigation.workerPolls > count, awayPolls, { timeout: 800 });
      assert.equal(await page.evaluate(() => window.agentNavigation.runs.length), 0, 'display visibility never starts or stops model requests');
      assert.deepEqual(errors, []);
      console.log('PASS: real App server polling pauses hidden/away and refreshes immediately when visible, without model requests.');
      return;
    }
    if (process.env.ORVIX_SCORECARD_ONLY === '1') {
      await page.getByRole('button', { name: 'Open workspace files and changes', exact: true }).click();
      const pane = page.locator('.agent-changes-panel');
      await pane.waitFor();
      await pane.getByRole('button', { name: 'Open workspace file', exact: true }).click();
      await pane.locator('.agent-workspace-file-results [role="option"]').first().waitFor();
      await pane.locator('.agent-workspace-file-results [role="option"]').first().click();
      await pane.locator('.agent-changes-filebar').waitFor();
      await page.getByRole('button', { name: 'Coding run scorecard', exact: true }).click();
      const insightsTab = pane.getByRole('tab', { name: 'Run insights', exact: true });
      const scorecard = page.getByRole('region', { name: 'Coding run scorecard', exact: true });
      await scorecard.waitFor();
      assert.equal(await page.locator('.agent-changes-panel').count(), 1, 'scorecard remains inside the existing review pane');
      assert.equal(await page.locator('.agent-scorecard-pane').count(), 0, 'scorecard does not create a second pane');
      assert.equal(await insightsTab.getAttribute('aria-selected'), 'true', 'Run insights is selected in the existing editor tab strip');
      assert.equal(await pane.locator('.agent-editor-tab:not(.agent-insights-tab)').count(), 1, 'the open file tab remains beside Run insights');
      assert.equal(await pane.locator('.agent-changes-filebar').count(), 0, 'scorecard view hides file paths and Code/Changes controls');
      if (process.env.ORVIX_UI_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.ORVIX_UI_SCREENSHOT_DIR, { recursive: true });
        await pane.screenshot({ path: path.join(process.env.ORVIX_UI_SCREENSHOT_DIR, 'agent-scorecard-tab.png') });
      }
      await pane.locator('.agent-editor-tab:not(.agent-insights-tab) [role="tab"]').click();
      await pane.locator('.agent-changes-filebar').waitFor();
      await insightsTab.click();
      await pane.locator('.agent-changes-filebar').waitFor({ state: 'detached' });
      await pane.locator('.agent-scorecard-customize-button').click();
      const settings = page.getByRole('region', { name: 'Customize scorecard pills', exact: true });
      await settings.waitFor();
      if (process.env.ORVIX_UI_SCREENSHOT_DIR) await pane.screenshot({ path: path.join(process.env.ORVIX_UI_SCREENSHOT_DIR, 'agent-scorecard-customizer.png') });
      const verified = settings.getByRole('checkbox', { name: 'Verified', exact: true });
      assert.equal(await verified.isChecked(), true);
      await verified.uncheck();
      assert.doesNotMatch(await page.locator('.agent-scorecard-outcomes').innerText(), /verified/);
      await verified.check();
      await settings.getByRole('button', { name: 'Move Verified down', exact: true }).click();
      assert.match(await page.locator('.agent-scorecard-outcomes').innerText(), /^1 attempt\n1 partial\n0 verified/);
      await settings.getByRole('button', { name: 'Move Observed regressions up', exact: true }).click();
      const metricLabels = await page.locator('.agent-scorecard-metrics dt').allTextContents();
      assert.ok(metricLabels.indexOf('Observed regressions') < metricLabels.indexOf('Resumed runs verified'), 'metric cards can be reordered too');
      await settings.getByRole('button', { name: 'Reset scorecard layout', exact: true }).click();
      assert.match(await page.locator('.agent-scorecard-outcomes').innerText(), /^1 attempt\n0 verified\n1 partial/);
      await pane.locator('.agent-scorecard-customize-button').click();
      await pane.getByRole('button', { name: 'Close Run Insights tab', exact: true }).click();
      await pane.locator('.agent-editor-tab.agent-insights-tab').waitFor({ state: 'detached' });
      await pane.locator('.agent-changes-filebar').waitFor();
      await page.getByRole('button', { name: 'Coding run scorecard', exact: true }).click();
      await pane.locator('.agent-editor-tab.agent-insights-tab').waitFor();
      assert.equal(await pane.getByRole('tab', { name: 'Run insights', exact: true }).getAttribute('aria-selected'), 'true', 'toolbar action reopens a closed insights tab');
      await page.setViewportSize({ width: 430, height: 380 });
      const scorecardBounds = await pane.boundingBox();
      assert.ok(scorecardBounds && scorecardBounds.x >= 0 && scorecardBounds.x + scorecardBounds.width <= 431, 'shared pane fits a narrow viewport');
      assert.equal(await pane.locator('.agent-changes-scorecard-body').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'scorecard content has no horizontal overflow on narrow screens');
      const scrollResult = await pane.locator('.agent-changes-scorecard-body').evaluate(element => {
        const overflows = element.scrollHeight > element.clientHeight + 1;
        element.scrollTop = element.scrollHeight;
        return { overflows, moved: element.scrollTop > 0 };
      });
      assert.deepEqual(scrollResult, { overflows: true, moved: true }, 'long scorecard content scrolls vertically inside the shared pane');
      assert.equal(await pane.getByRole('button', { name: 'Customize scorecard pills', exact: true }).isVisible(), true, 'compact icon control remains available with an accessible name');
      await page.setViewportSize({ width: 1440, height: 960 });
      assert.deepEqual(errors, []);
      console.log('PASS: Run Insights switches with open files, closes and reopens from the toolbar, scrolls vertically, and supports customizing its pills and metrics.');
      return;
    }
    if (process.env.ORVIX_WORKSPACE_ONLY === '1') { await checkWorkspaceUpgrade(page, send); assert.deepEqual(errors, []); return; }
    await page.getByRole('button', { name: 'Keep OpenCode connected: Default', exact: true }).click({force: true});
    await page.waitForFunction(() => window.agentNavigation.preparations.length === 1);
    await page.evaluate(() => { window.agentNavigation.preparations = []; window.agentNavigation.deferWorkspaceLoads = true; });
    await session('Session B');
    await page.waitForFunction(() => !!window.agentNavigation.deferredWorkspaceLoads.b);
    assert.equal(await page.evaluate(() => window.agentNavigation.preparations.length), 0, 'switching cannot prepare the default or previous workspace while task roots are loading');
    await session('Session A');
    await page.waitForFunction(() => !!window.agentNavigation.deferredWorkspaceLoads.a);
    await page.evaluate(() => window.agentNavigation.deferredWorkspaceLoads.b(['C:/task-b']));
    assert.equal(await page.evaluate(() => window.agentNavigation.preparations.length), 0, 'a late result from the previous session cannot prepare the current task');
    await page.evaluate(() => window.agentNavigation.deferredWorkspaceLoads.a(['C:/task-a']));
    await page.waitForFunction(() => window.agentNavigation.preparations.length === 1);
    assert.deepEqual(await page.evaluate(() => window.agentNavigation.preparations), [{taskId:'a',directory:'C:/task-a',modelId:'opencode/space-bunny-free'}]);
    await session('Session A');
    assert.equal(await page.evaluate(() => window.agentNavigation.preparations.length), 1, 'reopening the current task must retain its loaded workspace');
    await page.evaluate(() => { delete window.agentNavigation.deferredWorkspaceLoads.b; });
    await session('Session B');
    await page.waitForFunction(() => !!window.agentNavigation.deferredWorkspaceLoads.b);
    await page.evaluate(() => window.agentNavigation.deferredWorkspaceLoads.b(['C:/task-b']));
    await page.waitForFunction(() => window.agentNavigation.preparations.length === 2);
    assert.deepEqual(await page.evaluate(() => window.agentNavigation.preparations[1]), {taskId:'b',directory:'C:/task-b',modelId:'opencode/space-bunny-free'});
    await page.getByRole('button', { name: 'Keep OpenCode connected: On', exact: true }).click({force: true});
    await page.evaluate(() => { window.agentNavigation.deferWorkspaceLoads = false; });
    await session('Session A');
    console.log('PASS: Session preparation waits for loaded task roots; late workspace results and repeated current-session clicks do not cause duplicate preparation.');
    if (process.env.ORVIX_PREPARATION_ONLY === '1') { assert.deepEqual(errors, []); return; }
    // Exercise measured textarea sizing with real CSS motion and real Enter-to-send handling.
    const composerTasks = await page.evaluate(() => structuredClone(window.agentNavigation.tasks));
    const longPrompt = Array.from({ length: 45 }, (_, index) => `Composer regression line ${index + 1}: this text should scroll inside the input.`).join('\n');
    const expectCompactComposer = async () => {
      await page.waitForFunction(() => {
        const input = document.querySelector('textarea[aria-label="Agent prompt"]');
        return input && !input.value && input.getBoundingClientRect().height <= 60 && input.scrollTop === 0 && getComputedStyle(input).overflowY === 'hidden';
      }, null, { timeout: 2500 });
    };
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      await prompt.fill(longPrompt);
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent prompt"]').getBoundingClientRect().height >= 250);
      await prompt.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await prompt.fill('Short draft');
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent prompt"]').getBoundingClientRect().height <= 60);
      await prompt.fill('');
      await expectCompactComposer();
      await prompt.fill(longPrompt);
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent prompt"]').getBoundingClientRect().height >= 250);
      await prompt.press('Enter');
      await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
      await expectCompactComposer();
      await prompt.fill(longPrompt);
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent prompt"]').getBoundingClientRect().height >= 250);
      await prompt.press('Enter');
      await page.getByRole('button', { name: 'Remove queued message', exact: true }).waitFor();
      await expectCompactComposer();
      await page.getByRole('button', { name: 'Remove queued message', exact: true }).click();
      await page.evaluate(() => window.agentNavigation.complete('Composer send test completed', 'a'));
      await page.getByRole('button', { name: 'Send prompt', exact: true }).waitFor();
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByTitle('Start a new agent task', { exact: true }).click();
    await prompt.fill(longPrompt);
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Agent prompt"]').getBoundingClientRect().height >= 250);
    await prompt.press('Enter');
    await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    await expectCompactComposer();
    await page.evaluate(() => { const run = window.agentNavigation.runs.at(-1); window.agentNavigation.complete('First message composer test completed', run.taskId); });
    await page.getByRole('button', { name: 'Send prompt', exact: true }).waitFor();
    if (process.env.ORVIX_COMPOSER_ONLY === '1') { console.log('PASS: Long drafts shrink after shortening, clearing, sending and queuing in normal/reduced motion and on the first message of a new chat.'); return; }
    await page.evaluate(tasks => { window.agentNavigation.tasks = tasks; localStorage.setItem('agentNavigationSnapshot', JSON.stringify(tasks)); localStorage.setItem('orvix.activeAgentTask', 'a'); }, composerTasks);
    await page.reload(); await nav('Agent'); await page.getByText('Initial reply a', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Configure provider keys', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Provider connections' });
    await settings.waitFor();
    const closeSettings = settings.getByRole('button', { name: 'Close provider settings', exact: true });
    await closeSettings.focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Other provider credentials', 'keyboard focus stays within the dialog');
    await page.keyboard.press('Tab'); assert.equal(await closeSettings.evaluate(element => element === document.activeElement), true);
    assert.equal(await settings.getByRole('tabpanel').count(), 1, 'one provider detail card is mounted at a time');
    await settings.getByRole('tab', { name: /Google/ }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await settings.getByRole('tab', { name: /Nara Router/ }).getAttribute('aria-selected'), 'true', 'arrow keys switch provider tabs');
    await settings.getByRole('tab', { name: /Nara Router/ }).click();
    assert.match(await settings.getByRole('tabpanel').innerText(), /Official endpoint configured/);
    assert.equal(await settings.getByLabel('Nara Router API Base URL').count(), 0, 'Nara uses its official endpoint without a URL field');
    await settings.getByRole('tab', { name: /Google/ }).click();
    await settings.getByLabel('Name (optional)').fill('First project');
    await settings.getByRole('textbox', { name: 'Google Gemini API key', exact: true }).fill('fixture-google-secret-one');
    await settings.getByRole('button', { name: 'Add key', exact: true }).click();
    await settings.getByText('First project', { exact: true }).waitFor();
    assert.equal(await settings.getByRole('textbox', { name: 'Google Gemini API key', exact: true }).inputValue(), '', 'saved secrets clear from the form');
    await settings.getByLabel('Name (optional)').fill('Second project');
    await settings.getByRole('textbox', { name: 'Google Gemini API key', exact: true }).fill('fixture-google-secret-two');
    await settings.getByRole('button', { name: 'Add key', exact: true }).click();
    await settings.getByText('Second project', { exact: true }).waitFor();
    assert.equal(await settings.locator('.agent-provider-key-item').count(), 2);
    await settings.getByRole('button', { name: 'Pause First project', exact: true }).click();
    await settings.getByRole('button', { name: 'Resume First project', exact: true }).waitFor();
    await settings.getByRole('button', { name: 'Replace Second project', exact: true }).click();
    await settings.getByRole('textbox', { name: 'Google Gemini API key', exact: true }).fill('fixture-replacement-key');
    await settings.getByRole('button', { name: 'Replace key', exact: true }).click();
    await settings.getByText('Key replaced in .env.', { exact: true }).waitFor();
    await settings.getByRole('tab', { name: /Groq/ }).click();
    assert.equal(await settings.locator('.agent-provider-key-item').count(), 0, 'provider key lists stay separate');
    await settings.getByRole('tab', { name: /Google/ }).click();
    assert.equal(await settings.locator('.agent-provider-key-item').count(), 2);
    if (process.env.ORVIX_UI_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.ORVIX_UI_SCREENSHOT_DIR, { recursive: true });
      await settings.screenshot({ path: path.join(process.env.ORVIX_UI_SCREENSHOT_DIR, 'api-key-pool-desktop.png') });
      await page.setViewportSize({ width: 430, height: 850 });
      const bounds = await settings.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 431, 'settings fit a narrow viewport');
      await settings.screenshot({ path: path.join(process.env.ORVIX_UI_SCREENSHOT_DIR, 'api-key-pool-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 960 });
    }
    await settings.getByRole('button', { name: 'Remove First project', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.agent-provider-key-item').length === 1);
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'Configure provider keys', exact: true }).evaluate(element => element === document.activeElement), true, 'closing restores focus to the opener');
    await page.getByRole('button', {name:'Choose API provider',exact:true}).click();
    const apiMenu = page.getByRole('group',{name:'API providers',exact:true});
    await apiMenu.getByRole('button',{name:'Google',exact:true}).click();
    const googleThinking = page.getByRole('group',{name:'Gemini 3.8 Flash thinking level',exact:true});
    await googleThinking.waitFor();
    assert.equal(await googleThinking.getByRole('button',{name:'Minimal',exact:true}).count(),0,'Gemini 3.8 must not advertise a rejected thinking level');
    assert.equal(await googleThinking.getByRole('button',{name:'Low',exact:true}).count(),1);
    await apiMenu.getByRole('button',{name:'Nara',exact:true}).click();
    assert.equal(await apiMenu.getByRole('button',{name:/Nemotron 3 Ultra Free/}).count(),0,'retired Nara models are not offered');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Website design profile: Default', exact: true }).click();
    const designProfileMenu = page.getByRole('menu', { name: 'Choose website design profile', exact: true });
    await designProfileMenu.waitFor();
    assert.deepEqual(await designProfileMenu.getByRole('menuitemradio').allTextContents(), [
      'NoneUse the model’s own judgment without automatic website skills or design reviews.',
      'DefaultUse Orvix’s normal website design skill.',
      'Design MediumAdd light motion and a more distinctive composition.',
      'Design MAXUse expressive composition and a signature experience.',
    ]);
    await designProfileMenu.getByRole('menuitemradio', { name: /^None/ }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('orvix.agentDesignProfile.v1')), 'none');
    await page.waitForFunction(() => window.agentNavigation.tasks.find(task => task.id === 'a').designProfile === 'none');
    await page.reload(); await nav('Agent');
    await page.getByRole('button', {name:'Website design profile: None', exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.agentNavigation.tasks.find(task => task.id === 'a').designReviewMode), 'quality');
    const keepAliveDefault = page.getByRole('button', { name: 'Keep OpenCode connected: Default', exact: true });
    await page.mouse.move(8, 110);
    assert.equal(await keepAliveDefault.evaluate(element => getComputedStyle(element).opacity), '0', 'default control stays tucked away until the OpenCode button is hovered or focused');
    await page.getByRole('button', { name: 'OpenCode', exact: true }).hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.agent-keepalive-control')).opacity === '1');
    await keepAliveDefault.click();
    const keepAliveOn = page.getByRole('button', { name: 'Keep OpenCode connected: On', exact: true });
    await keepAliveOn.waitFor({ state: 'visible' });
    assert.equal(await keepAliveOn.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.orvixDesktop.getOpenCodeKeepAlive().then(value => value.keepAlive)), true);
    await keepAliveOn.click();
    await page.getByRole('button', { name: 'Keep OpenCode connected: Default', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.orvixDesktop.getOpenCodeKeepAlive().then(value => value.keepAlive)), false);
    await page.getByRole('button', { name: 'OpenCode', exact: true }).click();
    await page.getByRole('menu', { name: 'OpenCode models' }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText(/2 free models/).waitFor();
    assert.equal(await page.evaluate(() => window.agentNavigation.catalogRefreshes), 1);
    await page.getByText('1 models unavailable for this agent', { exact: true }).click();
    await page.getByText('Unavailable fixture', { exact: true }).waitFor();
    await page.getByRole('menuitemradio', { name: 'New Free Fixture', exact: true }).hover();
    await page.locator('.agent-thinking-panel-head strong').filter({ hasText: 'New Free Fixture' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'High', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Low', exact: true }).click();
    await send('hi');
    await page.waitForFunction(() => window.agentNavigation.runs.length > 0);
    assert.equal(await page.evaluate(() => window.agentNavigation.runs.at(-1).designProfile), 'none');
    assert.equal(await page.evaluate(() => window.agentNavigation.runs.at(-1).designReviewMode), 'quality');
    const freeRun = await page.evaluate(() => window.agentNavigation.runs.at(-1));
    assert.equal(freeRun.modelId, 'opencode/fixture-new-free'); assert.equal(freeRun.thinkingVariant, 'low');
    assert.equal(await page.getByRole('dialog', { name: /keys/i }).count(), 0, 'free models must not require a Zen key');
    await page.evaluate(() => window.agentNavigation.complete('Hello from the free model')); await persisted(2, 'done');
    await page.getByRole('button', {name:'Website design profile: None', exact:true}).click();
    await page.getByRole('menuitemradio', {name:/Design MAX/}).click();
    assert.equal(await page.evaluate(() => window.agentNavigation.tasks.find(task => task.id === 'a').designReviewMode), 'quality');
    // Restore the initial navigation fixture so the existing route checks retain their original counts.
    await page.evaluate(() => { const task = window.agentNavigation.tasks.find(task => task.id === 'a'); task.turns.pop(); localStorage.setItem('agentNavigationSnapshot', JSON.stringify(window.agentNavigation.tasks)); });
    await page.reload(); await nav('Agent'); await page.getByText('Initial reply a', { exact: true }).waitFor();
    // A catalog refresh has its own clock; changing providers must retain the task clock.
    await page.evaluate(() => {
      const worker = { running: true, idleMs: 120000, idleExpiresAt: Date.now() + 83000 };
      window.agentNavigation.workerSnapshot = { workers: { a: worker }, catalog: { ...worker, idleExpiresAt: Date.now() + 119000 } };
    });
    const serverPill = page.locator('.agent-server-indicator');
    await page.waitForFunction(() => document.querySelector('.agent-server-indicator-state')?.textContent.startsWith('Stops in 1:2'));
    const countdown = async () => {
      const text = await serverPill.getAttribute('aria-label');
      const match = text.match(/Stops in (\d+):(\d+)/);
      assert.ok(match, `expected task countdown, received ${text}`);
      return Number(match[1]) * 60 + Number(match[2]);
    };
    let previousCountdown = await countdown();
    for (const name of ['Kilo', 'OpenCode', 'Kilo', 'OpenCode']) {
      const polls = await page.evaluate(() => window.agentNavigation.workerPolls);
      await page.getByRole('button', { name, exact: true }).hover();
      await page.getByRole('button', { name, exact: true }).click();
      assert.ok(await countdown() <= previousCountdown, 'provider selection must not reset status or change clocks');
      await page.waitForFunction(polls => window.agentNavigation.workerPolls > polls, polls);
      const current = await countdown();
      assert.ok(current <= previousCountdown, 'countdown stays on the task worker after polling');
      previousCountdown = current;
      await page.keyboard.press('Escape');
    }
    // A genuine task idle-deadline extension must still be displayed.
    await page.evaluate(() => { window.agentNavigation.workerSnapshot.workers.a.idleExpiresAt = Date.now() + 120000; });
    await page.waitForFunction(() => /Stops in (2:00|1:59)/.test(document.querySelector('.agent-server-indicator-state')?.textContent));
    await page.getByRole('button', { name: 'Kilo', exact: true }).click();
    await page.getByRole('menu', { name: 'Kilo models' }).waitFor();
    await page.getByRole('menuitemradio', { name: 'Fixture Kilo Free', exact: true }).focus();
    await page.getByRole('button', { name: 'Thinking', exact: true }).click();
    await page.getByText('Kilo Free · Thinking', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Choose model' }).click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'OpenAI: GPT-6 Luna BYOK', exact: true }).count(), 0);
    await page.getByRole('button', { name: /OpenAI models/ }).click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'Fixture Kilo Free', exact: true }).count(), 0);
    await page.getByRole('menuitemradio', { name: 'OpenAI: GPT-6 Luna BYOK', exact: true }).focus();
    assert.equal(await page.getByRole('button', { name: 'Max', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'High', exact: true }).click();
    await page.getByText('Kilo · OpenAI · High', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'API Base', exact: true }).count(), 0);
    await send('Keep working while I navigate');
    const kiloRun = await page.evaluate(() => window.agentNavigation.runs.at(-1));
    assert.equal(kiloRun.modelId, 'kilo/openai/gpt-6-luna');
    assert.equal(kiloRun.thinkingVariant, 'high');
    await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    {
      const polls = await page.evaluate(() => window.agentNavigation.workerPolls);
      await page.waitForFunction(polls => window.agentNavigation.workerPolls > polls, polls);
      await countdown(); // A Kilo request cannot turn the idle OpenCode server into Waiting/Working.
      await page.evaluate(() => { window.agentNavigation.workerSnapshot = { workers: {} }; });
    }
    await page.evaluate(() => window.agentNavigation.emit({ type: 'approval', approvalId: 'delete-review', kind: 'delete', command: 'Delete 2 files', directory: 'C:\\project', deletions: [
      { file: 'C:\\project\\obsolete.ts', bytes: 1400 }, { file: 'C:\\project\\unused.css', bytes: 800 },
    ] }));
    const approvalCard = page.getByRole('region', { name: 'Delete 2 files?' });
    await approvalCard.waitFor();
    assert.equal(await page.locator('.agent-composer-stack .agent-approval-card').count(), 1, 'permission approval is anchored directly above the composer');
    assert.equal(await page.getByRole('dialog', { name: 'Delete 2 files?' }).count(), 0, 'permission approval no longer blocks the whole workspace as a modal');
    await page.getByText('C:\\project\\obsolete.ts', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.agentNavigation.decisions.at(-1)), { approvalId: 'delete-review', accepted: false });
    const subscriptions = await page.evaluate(() => window.agentNavigation.subscriptions);
    for (const name of ['Tools', 'Settings', 'Home']) {
      await nav(name);
      assert.equal(await page.locator('.persistent-agent-page').getAttribute('hidden'), '');
      assert.equal(await page.getByRole('textbox', { name: 'Agent prompt' }).count(), 0, 'hidden agent UI must be absent from accessibility navigation');
    }
    await page.evaluate(() => {
      window.agentNavigation.emit({ type: 'tool', phase: 'started', callId: 'edit', name: 'write_file', detail: 'fixture.css', input: {}, startedAt: Date.now() });
      window.agentNavigation.emit({ type: 'stream', phase: 'reset' });
      window.agentNavigation.emit({ type: 'stream', phase: 'delta', delta: 'Working across ' });
      window.agentNavigation.emit({ type: 'activity', message: 'Progress delivered on Home' });
      window.agentNavigation.emit({ type: 'clarification', questionId: 'q-nav', question: 'Which fixture style?', options: ['Rounded', 'Square'] });
    });
    await nav('Agent');
    await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    await page.getByText('Progress delivered on Home', { exact: true }).waitFor();
    await page.getByText('Which fixture style?', { exact: true }).waitFor();
    assert.equal(await page.locator('.agent-composer-stack .agent-clarification').count(), 1, 'clarification card belongs above the composer');
    assert.equal(await page.locator('.agent-turn .agent-clarification').count(), 0, 'clarification card must not interrupt the message history');
    await page.getByRole('button', { name: /Rounded/ }).click();
    await page.getByRole('form', { name: 'Agent question' }).getByRole('button', { name: 'Send', exact: true }).click();
    assert.equal(await page.evaluate(() => window.agentNavigation.answer), 'Rounded');
    assert.equal(await page.evaluate(() => window.agentNavigation.reads), 1, 'navigation must not rehydrate or relabel a live turn');
    assert.equal(await page.evaluate(() => window.agentNavigation.subscriptions), subscriptions, 'page changes must retain live subscriptions');
    assert.equal(await page.locator('.agent-response-error').count(), 0);

    await page.evaluate(() => {
      const fixture = window.agentNavigation, run = fixture.getPending('a');
      fixture.setApproval('a', { taskId: 'a', requestId: run.requestId, approvalId: 'notification-approval-a', kind: 'host_command', command: 'Notification permission command', directory: 'C:\\project-a' });
      fixture.notificationOpen({ type: 'agent', notificationId: 'notification-item-a', eventKind: 'permission', taskId: 'a', requestId: run.requestId, approvalId: 'notification-approval-a' });
    });
    await page.getByText('Notification permission command', { exact: true }).waitFor();
    // The task list can be collapsed while the composer is visible. Check the
    // selected task's stable title rather than CSS-dependent rendered text.
    assert.match(await page.locator('.agent-history-item[aria-current="page"]').getAttribute('title'), /^Session A\nModel:/, 'permission notifications open their exact task');
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    assert.equal(await page.evaluate(() => window.agentNavigation.decisions.at(-1).approvalId), 'notification-approval-a', 'reopened permission uses the existing approval control');

    await page.evaluate(() => {
      const fixture = window.agentNavigation;
      fixture.setQuestion('old-b', { questionId: 'notification-question-b', question: 'Notification follow-up question?', options: ['Answer from inbox'] });
      fixture.notificationOpen({ type: 'agent', notificationId: 'notification-item-b', eventKind: 'question', taskId: 'b', requestId: 'old-b', questionId: 'notification-question-b' });
    });
    await page.getByText('Notification follow-up question?', { exact: true }).waitFor();
    assert.match(await page.locator('.agent-history-item[aria-current="page"]').getAttribute('title'), /^Session B\nModel:/, 'question notifications open their exact task');
    await page.getByRole('button', { name: /Answer from inbox/ }).click();
    await page.getByRole('form', { name: 'Agent question' }).getByRole('button', { name: 'Send', exact: true }).click();
    assert.equal(await page.evaluate(() => window.agentNavigation.answer), 'Answer from inbox', 'reopened question uses the existing clarification control');
    await page.evaluate(() => window.agentNavigation.emit({ taskId: 'b', requestId: 'old-b', type: 'run_state', run: { status: 'completed', phase: 'completed', startedAt: Date.now(), phaseStartedAt: Date.now(), lastProgressAt: Date.now(), completedAt: Date.now(), toolCount: 0 }, result: { text: 'Question answered', modelId: 'fixture', usage: null, changes: [] } }));

    await session('Session B');
    assert.equal(await page.getByRole('button', { name: 'Send prompt', exact: true }).isDisabled(), true);
    await prompt.fill('Independent research');
    assert.equal(await page.getByRole('button', { name: 'Send prompt', exact: true }).isEnabled(), true, 'Session A must not block Session B');
    await send('Independent research');
    assert.equal(await page.evaluate(() => window.agentNavigation.getPending('a').modelId), 'kilo/openai/gpt-6-luna');
    assert.equal(await page.evaluate(() => window.agentNavigation.getPending('b').modelId), 'opencode/space-bunny-free');
    await page.evaluate(() => {
      const fixture = window.agentNavigation, b = fixture.getPending('b');
      fixture.emit({ taskId: 'b', requestId: b.requestId, type: 'stream', phase: 'reset' });
      fixture.emit({ taskId: 'b', requestId: b.requestId, type: 'stream', phase: 'delta', delta: 'Research streaming separately' });
      fixture.emit({ type: 'approval', approvalId: 'approval-a', kind: 'host_command', command: 'Website command', directory: 'C:\\project-a' });
      fixture.emit({ taskId: 'b', requestId: b.requestId, type: 'approval', approvalId: 'approval-b', kind: 'host_command', command: 'Research command', directory: 'C:\\project-b' });
    });
    const sessionApproval = page.locator('.agent-composer-stack .agent-approval-card');
    await sessionApproval.waitFor();
    assert.match(await sessionApproval.innerText(), /Research command/);
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    assert.equal(await page.evaluate(() => window.agentNavigation.decisions.at(-1).approvalId), 'approval-b');
    await session('Session A'); await sessionApproval.waitFor();
    assert.match(await sessionApproval.innerText(), /Website command/);
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    assert.equal(await page.evaluate(() => window.agentNavigation.decisions.at(-1).approvalId), 'approval-a');
    await prompt.fill('Website draft');
    await page.locator('.agent-composer input[type=file]').setInputFiles({ name: 'website-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Website notes') });
    await page.getByRole('button', { name: 'Remove website-notes.txt', exact: true }).waitFor();
    await session('Session B');
    assert.equal(await page.getByRole('button', { name: 'Remove website-notes.txt', exact: true }).count(), 0);
    await prompt.fill('Research draft'); await session('Session A'); assert.equal(await prompt.inputValue(), 'Website draft');
    await page.getByRole('button', { name: 'Remove website-notes.txt', exact: true }).waitFor();
    await session('Session B'); assert.equal(await prompt.inputValue(), 'Research draft');
    await page.getByText('Research streaming separately', { exact: true }).waitFor();
    await page.evaluate(() => window.agentNavigation.complete('Research completed independently', 'b'));
    await page.getByRole('button', { name: 'Send prompt', exact: true }).waitFor();
    await session('Session A'); await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    await session('Session B');
    await send('Fail only research while website continues');
    await page.evaluate(() => window.agentNavigation.fail('Research provider throttled', 'b'));
    await page.getByText('Research provider throttled', { exact: true }).waitFor();
    await send('Cancel only research while website continues');
    await page.getByRole('button', { name: 'Stop response', exact: true }).click();
    await page.getByText('Task cancelled.', { exact: true }).waitFor();
    await session('Session A'); await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.agentNavigation.getPending('a')), 'website must survive research failure and cancellation');
    await session('Session B');
    await page.evaluate(() => {
      window.agentNavigation.emit({ type: 'tool', phase: 'completed', callId: 'edit', name: 'write_file', detail: 'fixture.css', output: 'File written', durationMs: 10 });
      window.agentNavigation.emit({ type: 'stream', phase: 'delta', delta: 'sessions' });
      for (let index = 0; index < 35; index++) window.agentNavigation.emit({ type: 'activity', message: `Background step ${index}` });
    });
    await page.waitForFunction(() => {
      const tasks = window.agentNavigation.tasks;
      const running = tasks.find(task => task.id === 'a').turns.at(-1);
      return running.status === 'pending' && running.activity?.filter(item => typeof item === 'string' && item.startsWith('Background step')).length === 35;
    });
    assert.equal(await page.evaluate(() => window.agentNavigation.tasks.find(task => task.id === 'b').turns.length), 4, 'background updates must not become turns in the displayed session');
    const pendingSaved = await page.evaluate(() => window.agentNavigation.tasks.find(task => task.id === 'a').turns.at(-1));
    assert.equal(pendingSaved.activity.find(item => item?.id === 'edit').status, 'completed');
    assert.equal(pendingSaved.activity.find(item => item?.id === 'edit').output, 'File written');
    await session('Session A');
    await page.getByText('Working across sessions', { exact: true }).waitFor();
    await session('Session B');
    await nav('Tools');
    await page.evaluate(() => window.agentNavigation.complete('Completed while another page and session were open'));
    await persisted(2, 'done');
    await nav('Agent');
    await page.locator('.agent-history-item').filter({ hasText: 'Session A' }).getByLabel('Unread result').waitFor();
    await session('Session A');
    assert.equal(await page.locator('.agent-history-item').filter({ hasText: 'Session A' }).getByLabel('Unread result').count(), 0);
    await page.getByText('Completed while another page and session were open', { exact: true }).waitFor();
    assert.equal(await page.locator('.agent-response-error').count(), 0);
    assert.equal(await page.evaluate(() => window.agentNavigation.cancellations), 1, 'only explicit research cancellation should be recorded');
    await prompt.fill('Next task');
    assert.equal(await page.getByRole('button', { name: 'Send prompt', exact: true }).isDisabled(), false);

    await send('Test an actual provider failure'); await nav('Settings');
    await page.evaluate(() => window.agentNavigation.fail('Fixture provider connection failed'));
    await persisted(3, 'error'); await nav('Agent');
    await page.getByText('Fixture provider connection failed', { exact: true }).waitFor();
    await send('Test explicit cancellation');
    await page.getByRole('button', { name: 'Stop response', exact: true }).click();
    await persisted(4, 'error');
    assert.equal(await page.evaluate(() => window.agentNavigation.cancellations), 2);
    assert.equal(await page.evaluate(() => window.agentNavigation.reads), 1);
    assert.equal(await page.evaluate(() => window.agentNavigation.runs.length), 6);
    await send('Continue across a full window reload');
    await persisted(5, 'pending');
    await page.evaluate(() => {
      const tasks = window.agentNavigation.tasks; const turn = tasks.find(task => task.id === 'a').turns.at(-1);
      turn.runState = { id: 'durable-attempt', taskId: 'a', requestId: turn.id, status: 'running', phase: 'write_file', startedAt: Date.now() - 70000, phaseStartedAt: Date.now() - 70000, lastProgressAt: Date.now() - 70000, toolCount: 1 };
      const b = tasks.find(task => task.id === 'b').turns.at(-1); b.status = 'pending'; delete b.reply;
      b.runState = { ...turn.runState, id: 'durable-b', taskId: 'b', requestId: b.id, phase: 'research' };
      localStorage.setItem('agentNavigationSnapshot', JSON.stringify(tasks));
    });
    await page.reload(); await nav('Agent');
    await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    await page.getByText(/write_file.*still waiting; no completed result received/).waitFor();
    assert.equal(await page.locator('.agent-response-error').count(), 2, 'only the earlier provider failure and deliberate cancellation remain errors');
    await page.evaluate(() => {
      const turn = window.agentNavigation.tasks.find(task => task.id === 'a').turns.at(-1);
      window.agentNavigation.emit({ type: 'run_state', run: { ...turn.runState, status: 'completed', completedAt: Date.now(), phase: 'completed' }, result: { text: 'Recovered terminal reply', modelId: 'fixture', usage: null, changes: [] } });
    });
    await page.getByText('Recovered terminal reply', { exact: true }).waitFor();
    await prompt.fill('Ready after recovery');
    assert.equal(await page.getByRole('button', { name: 'Send prompt', exact: true }).isDisabled(), false);
    await persisted(5, 'done');
    await session('Session B'); await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
    await page.evaluate(() => {
      const turn = window.agentNavigation.tasks.find(task => task.id === 'b').turns.at(-1);
      window.agentNavigation.emit({ taskId: 'b', requestId: turn.id, type: 'run_state', run: { ...turn.runState, status: 'completed', completedAt: Date.now(), phase: 'completed' }, result: { text: 'Recovered research reply', modelId: 'fixture', usage: null, changes: [] } });
    });
    await page.getByText('Recovered research reply', { exact: true }).waitFor(); await session('Session A');
    await page.getByRole('button', { name: 'Coding run scorecard', exact: true }).click();
    await page.getByRole('region', { name: 'Coding run scorecard' }).waitFor();
    assert.equal(await page.locator('.agent-changes-panel').count(), 1, 'scorecard opens within the shared review pane');
    assert.equal(await page.locator('.agent-scorecard-pane').count(), 0, 'scorecard does not open as a second pane');
    assert.equal(await page.locator('.agent-editor-tab.agent-insights-tab [role="tab"]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('.agent-changes-filebar').count(), 0, 'scorecard view hides file paths and code/change controls');
    assert.match(await page.locator('.agent-scorecard').innerText(), /False completion rate\nNot measured/);
    assert.equal((await page.locator('.agent-scorecard').innerText()).match(/Not measured/g).length, 4);
    await page.getByRole('button', { name: 'Customize scorecard pills', exact: true }).click();
    const scorecardSettings = page.getByRole('region', { name: 'Customize scorecard pills' });
    await scorecardSettings.waitFor();
    await scorecardSettings.getByRole('button', { name: 'Move Verified down' }).click();
    assert.match(await page.locator('.agent-scorecard-outcomes').innerText(), /^27 attempts\n0 partial\n2 verified/);
    await scorecardSettings.getByRole('button', { name: 'Reset scorecard layout' }).click();
    await page.getByRole('button', { name: 'Customize scorecard pills', exact: true }).click();
    assert.match(await page.locator('.agent-scorecard-outcomes').innerText(), /^27 attempts\n2 verified\n0 partial/);
    await page.evaluate(() => { window.agentNavigation.boundaryShouldThrow = true; window.mountBoundaryFixture(); });
    await page.getByRole('heading', { name: 'The Agent view hit a problem' }).waitFor();
    assert.match(await page.locator('#boundary-fixture').innerText(), /Diagnostic ID: /);
    const diagnostic = await page.evaluate(() => window.agentNavigation.logs.at(-1));
    assert.equal(diagnostic.type, 'error');
    assert.match(diagnostic.message, /fixture render failure/);
    assert.match(diagnostic.details.componentStack, /Child/);
    await page.evaluate(() => { window.agentNavigation.boundaryShouldThrow = false; });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('Agent child recovered', { exact: true }).waitFor();
    await page.evaluate(() => {
      const tasks = window.agentNavigation.tasks, turn = tasks.find(task => task.id === 'a').turns.at(-1);
      turn.status = 'pending'; delete turn.reply;
      turn.runState = { id: 'hydrating-attempt', taskId: 'a', requestId: turn.id, status: 'running', phase: 'thinking', startedAt: Date.now(), phaseStartedAt: Date.now(), lastProgressAt: Date.now(), toolCount: 0 };
      localStorage.setItem('agentNavigationSnapshot', JSON.stringify(tasks)); localStorage.setItem('agentHydrationRace', 'true');
    });
    await page.reload(); await nav('Agent'); await page.getByText('Completed during hydration', { exact: true }).waitFor();
    await prompt.fill('Ready after hydration race'); assert.equal(await page.getByRole('button', { name: 'Send prompt', exact: true }).isEnabled(), true);
    // None must survive the real dashboard queue and retry paths, including a later selector change.
    await page.getByRole('button', { name: /^Website design profile:/ }).click();
    await page.getByRole('menuitemradio', { name: /^None/ }).click();
    await send('None queue first');
    await page.waitForFunction(() => window.agentNavigation.getPending('a')?.designProfile === 'none');
    await prompt.fill('None queue next');
    await page.getByRole('button', { name: 'Queue message for next turn', exact: true }).click();
    const queuedRow = page.locator('.agent-queue-card');
    await queuedRow.getByText('None queue next', { exact: true }).waitFor();
    assert.equal(await queuedRow.getByRole('button', { name: 'Steer agent with queued message' }).count(), 1);
    await queuedRow.getByRole('button', { name: 'More options for queued message 1' }).click();
    await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit in composer' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu', { name: 'Queued message options' }).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.agentNavigation.complete('None first completed'));
    await page.waitForFunction(() => window.agentNavigation.getPending('a')?.messages.at(-1)?.content === 'None queue next');
    assert.equal(await page.evaluate(() => window.agentNavigation.getPending('a').designProfile), 'none');
    await page.evaluate(() => window.agentNavigation.fail('None retry fixture'));
    const noneError = page.locator('.agent-response-failure').filter({ hasText: 'None retry fixture' });
    await noneError.waitFor();
    await page.getByRole('button', { name: 'Website design profile: None', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /Design MAX/ }).click();
    await noneError.getByRole('button', { name: /^Retry/ }).click();
    await page.waitForFunction(() => window.agentNavigation.getPending('a')?.designProfile === 'none');
    await page.evaluate(() => window.agentNavigation.complete('None retry completed'));
    await page.getByText('None retry completed', { exact: true }).waitFor();
    await checkWorkspaceUpgrade(page, send);
    assert.deepEqual(errors, [], errors.join('\n'));
    console.log('PASS: None selection, reload, queue and retry retain profile and review policy; mixed-provider sessions, navigation, clarification, recovery and error boundaries pass.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
