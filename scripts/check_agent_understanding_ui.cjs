const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-agent-ui-'));
  const bundle = await require('esbuild').build({ stdin: { contents: `
    import { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { resolveAgentServerState } from './src/agentServerStatus';
    import './src/components/agent-dashboard.css';
    import AgentExecutionPanel from './src/components/AgentExecutionPanel'; import { AgentActivityTimeline, AgentTurnStatus } from './src/components/AgentActivityTimeline'; import AgentVerificationResult from './src/components/AgentVerificationResult'; import AgentDiff from './src/components/AgentDiff';
    const subscribers = new Set(); const lookups = new Map();
    window.fixture = { serverState:resolveAgentServerState, emit(event) { subscribers.forEach(callback => callback({taskId:'task',requestId:'turn',...event})); }, resolve(requestId,value) { lookups.get(requestId)?.(value); }, answer:null, fail:false, metadataReads:[], questionReads:0 };
    window.orvixDesktop = {
      onAgentEvent(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
      getAgentQuestion(taskId,requestId) { window.fixture.questionReads++; return new Promise(resolve => lookups.set(requestId,resolve)); },
      async answerAgentQuestion(id,answer) { if(window.fixture.fail) throw Error('Answer was not saved'); window.fixture.answer=answer; window.fixture.emit({type:'clarification',phase:'remove',questionId:id}); return true; },
      async getAgentExecution(task,turn,refresh) { window.fixture.metadataReads.push({task,turn,refresh}); return {execution:{objective:'Brightness changes',requirements:[{id:'r1',text:'One notice after a change',verificationTypes:['user_flow'],status:'pending',evidenceIds:['source']}],actions:[],complete:false,revision:1,updatedAt:Date.now(),intent:{status:'reviewed',goal:'Monitor brightness changes',feature:'Brightness',trigger:'Change',expectedBehavior:'One notification',examples:[{input:'50 to 51',expected:'One notice'}],assumptions:[]},acceptance:{status:'approved',criteria:[{id:'c1',description:'Display notice',observable:'Visible desktop card',negativeCase:'No baseline notice',method:'sensor'}]}},projects:[]}; },
      async listAgentEvidence() { return {records:[],nextOffset:null,total:0}; },
      async readAgentEvidence(task,turn,id,offset) { return {output:offset?'second':'first',nextOffset:offset?null:5}; }
    };
    function Fixture() { const [turn,setTurn]=useState('turn'); const [history,setHistory]=useState(false); const [thinking,setThinking]=useState('completed'); const reasoning={kind:'progress',id:'thinking',category:'reasoning_summary',providerId:'fixture',providerLabel:'Fixture model',modelId:'fixture/model',text:'Reasoning content',status:thinking,startedAt:0,durationMs:thinking==='completed'?9600:undefined}; const passed={status:'passed',reason:'',checks:[{label:'Production build',phase:'build',status:'passed',command:'npm run build',directory:'fixture',output:'passed',durationMs:20},{label:'Primary flow',phase:'user_flow',status:'passed',command:'browser flow',directory:'fixture',output:'passed',durationMs:30}]}; const notRun={status:'not_run',reason:'No separate verification suite was run.',checks:[]}; return <><button onClick={()=>setTurn('turn-b')}>Switch turn</button><button onClick={()=>setHistory(true)}>Show long history</button><button onClick={()=>setThinking('running')}>Start thinking</button><button onClick={()=>setThinking('completed')}>Finish thinking</button><AgentVerificationResult result={passed}/><AgentVerificationResult result={notRun}/><AgentDiff before={'old line\\nkeep'} after={'new line\\nkeep'}/><AgentActivityTimeline pending={false} items={["Checking the PC status first.",'Connecting to the lightweight OpenCode agent',{kind:"tool",id:"stopped",name:"write_file",detail:"style.css",startedAt:0,durationMs:326000,status:"completed",failed:true,output:"Error: Task cancelled."}]}/><AgentActivityTimeline pending={thinking==='running'} items={[reasoning]}/>{history ? Array.from({length:80},(_,index)=><AgentExecutionPanel key={index} taskId="task" requestId={"old-"+index}/>) : <AgentExecutionPanel taskId="task" requestId={turn} pending={true}/>}</>; }
    function LifecycleFixture() {
      const [state,setState]=useState({items:[],pending:true,main:false});
      const [workStartedAt]=useState(()=>Date.now()-10000);
      window.fixture.lifecycle=(items,pending=true)=>setState({items,pending,main:false});
      window.fixture.mainWork=(items,pending=true)=>setState({items,pending,main:true});
      const timeline=<AgentActivityTimeline items={state.items} pending={state.pending}/>;
      return <div id="thinking-lifecycle">{state.main ? <AgentTurnStatus startedAt={workStartedAt} completedAt={state.pending ? undefined : workStartedAt+10000} status={state.pending?'pending':'done'} turnId="fixture-work" hasDetails={true}>{timeline}</AgentTurnStatus> : timeline}</div>;
    }
    createRoot(document.getElementById('root')).render(<><Fixture/><LifecycleFixture/></>);
  `, resolveDir: path.join(__dirname, '..'), loader: 'tsx' }, bundle: true, write: false, outfile: path.join(root, 'fixture.js'), jsx: 'automatic', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? javascript : `<!doctype html><html><head><style>body{background:#181819;color:#eee;max-width:800px;margin:30px auto;font-family:Segoe UI,sans-serif}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));
    browser = await require('playwright-core').chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(await page.evaluate(() => [
      window.fixture.serverState({running:true,starting:true},false),
      window.fixture.serverState({running:false,starting:false},true),
      window.fixture.serverState({running:false,starting:false},false),
    ]), ['connected','starting','offline'], 'ready workers win over a lingering startup flag; active OpenCode requests do not appear offline before worker registration');
    assert.equal(await page.getByText('Connecting to the lightweight OpenCode agent',{exact:true}).count(),0,'connection chatter is hidden from the activity timeline');
    assert.equal(await page.getByText('Checking the PC status first.',{exact:true}).count(),0,'activity before the first tool group is hidden');
    const stoppedWork = page.locator('.agent-work-group-heading').first();
    await stoppedWork.waitFor(); assert.equal(await stoppedWork.getAttribute('aria-expanded'),'false','completed work starts collapsed'); await stoppedWork.click();
    await page.getByText('1 edit stopped',{exact:true}).waitFor(); assert.equal(await page.getByText('Edited 1 file',{exact:true}).count(),0); assert.equal(await page.locator('.agent-tool-group-heading').getAttribute('aria-expanded'),'false');
    const verificationCards = page.locator('.agent-verification-card'); assert.equal(await verificationCards.count(),2); assert.equal(await verificationCards.nth(0).getAttribute('open'),null,'verification starts minimized'); assert.match(await verificationCards.nth(0).locator('summary').first().innerText(),/2 current checks passed/); assert.match(await verificationCards.nth(1).locator('summary').first().innerText(),/Checks not run · No separate verification suite was run/); await verificationCards.nth(0).locator('summary').first().click(); assert.notEqual(await verificationCards.nth(0).getAttribute('open'),null,'click expands verification evidence');
    const unifiedDiff = page.locator('.agent-diff-view'); const diffRows = unifiedDiff.locator('.agent-diff-row'); assert.equal(await diffRows.count(),3); assert.equal(await diffRows.nth(0).getAttribute('class'),'agent-diff-row is-removed'); assert.equal(await diffRows.nth(1).getAttribute('class'),'agent-diff-row is-added'); assert.equal(await diffRows.nth(2).locator('[role="cell"]').count(),1,'unified diff uses one canvas per line'); assert.match(await diffRows.nth(0).innerText(),/old line/); assert.match(await diffRows.nth(1).innerText(),/new line/);
    const thinking = page.locator('.agent-thinking-toggle'); await thinking.waitFor(); assert.equal(await thinking.getAttribute('aria-expanded'),'false','finished reasoning starts minimized');
    await page.getByRole('button',{name:'Start thinking'}).click(); await page.waitForFunction(() => document.querySelector('.agent-thinking-toggle')?.getAttribute('aria-expanded') === 'true','active reasoning expands automatically');
    assert.equal(await thinking.locator('.agent-thinking-duration').count(),0,'active thinking does not show a completed duration');
    await thinking.click(); assert.equal(await thinking.getAttribute('aria-expanded'),'false','running reasoning can be minimized manually');
    await thinking.click(); assert.equal(await thinking.getAttribute('aria-expanded'),'true','running reasoning can be reopened manually');
    await page.getByRole('button',{name:'Finish thinking'}).click(); await page.waitForFunction(() => document.querySelector('.agent-thinking-toggle')?.getAttribute('aria-expanded') === 'false','completed reasoning minimizes automatically');
    assert.equal(await thinking.locator('.agent-tool-spinner').count(),0,'completed reasoning has no loading spinner'); assert.match(await thinking.locator('strong').innerText(),/Thought\s+-\s+9\.6s/,'completed reasoning shows its elapsed time');
    await thinking.click(); assert.equal(await thinking.getAttribute('aria-expanded'),'true','finished reasoning can be reopened');
    await page.getByRole('button',{name:'Start thinking'}).click();
    await page.getByRole('button',{name:'Finish thinking'}).click();
    assert.equal(await thinking.getAttribute('aria-expanded'),'false','another reasoning cycle minimizes again');
    await page.evaluate(() => {
      const reason=id=>({kind:'progress',id,category:'provider_reasoning',providerId:'fixture',providerLabel:'Fixture',modelId:'fixture/model',text:'Reasoning '+id,status:'running',startedAt:0});
      window.fixture.reason=reason;
      window.fixture.lifecycle([reason('old'),reason('current')]);
    });
    const lifecycle = page.locator('#thinking-lifecycle'); const cards=lifecycle.locator('.agent-thinking-toggle');
    await cards.nth(1).waitFor(); assert.equal(await cards.nth(0).getAttribute('aria-expanded'),'false','stale earlier reasoning minimizes while task runs');
    assert.equal(await cards.nth(0).locator('.agent-tool-spinner').count(),0,'stale reasoning has no loading spinner');
    assert.equal(await cards.nth(1).getAttribute('aria-expanded'),'true','latest reasoning expands');
    await page.evaluate(() => window.fixture.lifecycle([window.fixture.reason('old'),window.fixture.reason('current'),{kind:'tool',id:'next-tool',name:'read_file',detail:'app.ts',startedAt:0,status:'running'}]));
    await page.waitForFunction(() => [...document.querySelectorAll('#thinking-lifecycle .agent-thinking-toggle')].every(card=>card.getAttribute('aria-expanded')==='false'));
    assert.equal(await lifecycle.locator('.agent-thinking-toggle .agent-tool-spinner').count(),0,'tool phase ends all earlier thinking indicators');
    await page.evaluate(() => window.fixture.lifecycle([window.fixture.reason('current'),{kind:'progress',id:'wait',category:'waiting',providerLabel:'Fixture',status:'running'}],false));
    await page.waitForFunction(() => document.querySelectorAll('#thinking-lifecycle .agent-tool-spinner').length===0);
    assert.equal(await lifecycle.locator('.agent-progress-waiting').count(),0,'finished task hides stale waiting state');
    await page.evaluate(() => window.fixture.lifecycle([{kind:'progress',id:'waiting-only',category:'waiting',providerLabel:'Fixture',status:'running'}]));
    await lifecycle.locator('.agent-progress-waiting').waitFor();
    assert.equal(await lifecycle.locator('.agent-tool-spinner').count(),1,'live provider waiting indicator remains available');
    await page.evaluate(() => window.fixture.lifecycle([window.fixture.reason('before-update'),{kind:'progress',id:'update',category:'agent_update',providerLabel:'Fixture',text:'I have checked the file.',status:'completed'}]));
    await lifecycle.locator('.agent-live-output').waitFor();
    assert.equal(await cards.first().getAttribute('aria-expanded'),'false','assistant update minimizes preceding reasoning');
    assert.equal(await lifecycle.locator('.agent-tool-spinner').count(),0,'assistant update ends preceding loading state');
    await page.evaluate(() => {
      const update=(id,text)=>({kind:'progress',id,category:'agent_update',providerLabel:'Fixture',text,status:'completed',startedAt:0});
      const tool=(id,name)=>({kind:'tool',id,name,detail:name==='bash'?'Get-Content index.html':'index.html',input:'{}',output:'Command output',status:'completed',startedAt:0,durationMs:20});
      window.fixture.workItems=[update('intro','I’ll inspect the files and check the current behavior.'),tool('read-1','read'),{...window.fixture.reason('thought-1'),status:'completed'},tool('command-1','bash'),tool('command-2','bash'),update('findings','I found the cause. I’ll apply the change and check it.'),tool('edit-1','edit'),window.fixture.reason('thought-2')];
      window.fixture.update=update; window.fixture.tool=tool;
      window.fixture.lifecycle(window.fixture.workItems);
    });
    const workGroups=lifecycle.locator('.agent-work-group'); const workHeadings=lifecycle.locator('.agent-work-group-heading');
    await workGroups.nth(1).waitFor();
    assert.equal(await workGroups.count(),2,'acknowledgments separate work into distinct outer groups');
    assert.equal(await lifecycle.locator('.agent-work-group .agent-live-output').count(),0,'acknowledgment text is excluded from every group');
    assert.deepEqual(await lifecycle.locator('.agent-live-output').allTextContents(),['I’ll inspect the files and check the current behavior.','I found the cause. I’ll apply the change and check it.']);
    assert.deepEqual(await lifecycle.locator('.agent-activity-blocks > *').evaluateAll(nodes=>nodes.map(node=>node.classList.contains('agent-live-output')?'acknowledgment':'work')),['acknowledgment','work','acknowledgment','work'],'acknowledgments retain their position in the conversation');
    assert.match(await workHeadings.nth(0).innerText(),/Read files, ran commands/);
    assert.equal(await workHeadings.nth(0).getAttribute('aria-expanded'),'false','next acknowledgment closes preceding work');
    assert.equal(await workHeadings.nth(1).getAttribute('aria-expanded'),'true','current work opens while the task runs');
    await workHeadings.nth(0).focus(); await page.keyboard.press('Enter');
    assert.equal(await workHeadings.nth(0).getAttribute('aria-expanded'),'true','keyboard expands work');
    assert.equal(await workGroups.nth(0).locator('.agent-tool-group').count(),2,'existing tool-family groups remain inside the outer group');
    assert.equal(await workGroups.nth(0).locator('.agent-thinking-toggle').count(),1,'thought cards stay alongside tools');
    await workGroups.nth(0).locator('.agent-tool-group-heading').nth(1).click();
    assert.equal(await workGroups.nth(0).locator('.agent-tool-row-summary').count(),2,'expanding the nested command group reveals both commands');
    await workGroups.nth(0).locator('.agent-tool-row-summary').first().click();
    assert.match(await workGroups.nth(0).locator('.agent-tool-detail').innerText(),/Command output/,'individual command evidence still opens');
    if(process.env.ORVIX_UI_SCREENSHOT_DIR) { fs.mkdirSync(process.env.ORVIX_UI_SCREENSHOT_DIR,{recursive:true}); await lifecycle.screenshot({path:path.join(process.env.ORVIX_UI_SCREENSHOT_DIR,'activity-expanded.png')}); }
    await workHeadings.nth(1).click();
    await page.evaluate(()=>window.fixture.lifecycle([...window.fixture.workItems,window.fixture.tool('command-3','bash')]));
    assert.equal(await workHeadings.nth(0).getAttribute('aria-expanded'),'true','new work preserves an earlier manually expanded group');
    assert.equal(await workHeadings.nth(1).getAttribute('aria-expanded'),'false','streaming preserves a manually collapsed active group');
    await page.evaluate(()=>window.fixture.lifecycle([...window.fixture.workItems,window.fixture.update('done','The change is ready for the final check.')]));
    assert.equal(await workGroups.count(),2,'an acknowledgment without subsequent tools creates no empty group');
    await page.evaluate(()=>window.fixture.lifecycle([...window.fixture.workItems,window.fixture.update('done','The change is ready for the final check.'),{...window.fixture.tool('final-check','bash'),status:'running'}]));
    await workGroups.nth(2).waitFor();
    assert.equal(await workHeadings.nth(2).getAttribute('aria-expanded'),'true','new work after another acknowledgment is independent');
    await page.evaluate(()=>window.fixture.lifecycle([...window.fixture.workItems,window.fixture.update('done','The change is ready for the final check.'),{...window.fixture.tool('final-check','bash'),failed:true,output:'Verification failed'}],false));
    assert.equal(await workHeadings.nth(2).getAttribute('aria-expanded'),'false','finishing the task closes its latest work group');
    assert.match(await workHeadings.nth(2).innerText(),/Commands failed\s+1 failed/,'failed work is visible in the collapsed summary');
    await page.evaluate(()=>window.fixture.lifecycle([],false)); await workGroups.first().waitFor({state:'detached'});
    await page.evaluate(()=>window.fixture.lifecycle(window.fixture.workItems,false)); await workGroups.nth(1).waitFor();
    assert.deepEqual(await workHeadings.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-expanded'))),['false','false'],'restored completed work starts collapsed');
    if(process.env.ORVIX_UI_SCREENSHOT_DIR) await lifecycle.screenshot({path:path.join(process.env.ORVIX_UI_SCREENSHOT_DIR,'activity-collapsed.png')});
    await page.evaluate(()=>window.fixture.mainWork(window.fixture.workItems));
    const mainWork=lifecycle.locator('.agent-activity-toggle');
    await mainWork.waitFor(); assert.equal(await mainWork.getAttribute('aria-expanded'),'true','main Worked group is restored and opens for a live task');
    assert.match(await mainWork.innerText(),/Working for/);
    assert.equal(await lifecycle.locator('.agent-turn-work-details .agent-work-group').count(),2,'interval groups live inside the main Worked group');
    assert.equal(await lifecycle.locator('.agent-work-group .agent-live-output').count(),0,'main grouping still leaves acknowledgments outside interval groups');
    await mainWork.click(); assert.equal(await mainWork.getAttribute('aria-expanded'),'false','main group can be minimized independently');
    await page.evaluate(()=>window.fixture.mainWork([...window.fixture.workItems,window.fixture.tool('main-command','bash')]));
    assert.equal(await mainWork.getAttribute('aria-expanded'),'false','new activity preserves a manually minimized main group');
    await mainWork.focus(); await page.keyboard.press('Enter');
    assert.equal(await mainWork.getAttribute('aria-expanded'),'true','main group can be reopened with the keyboard');
    await page.evaluate(()=>window.fixture.mainWork(window.fixture.workItems,false));
    assert.equal(await mainWork.getAttribute('aria-expanded'),'false','main group minimizes on completion');
    assert.equal(await mainWork.innerText(),'Worked for 10s','main group uses the original elapsed-time label');
    await mainWork.click();
    assert.equal(await lifecycle.locator('.agent-live-output:visible').count(),2,'reopening main group reveals normal acknowledgments');
    assert.deepEqual(await lifecycle.locator('.agent-work-group-heading').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-expanded'))),['false','false'],'main reopening preserves minimized interval groups');
    if(process.env.ORVIX_UI_SCREENSHOT_DIR) await lifecycle.screenshot({path:path.join(process.env.ORVIX_UI_SCREENSHOT_DIR,'activity-main-worked.png')});
    await page.evaluate(()=>{
      const names=['browser_observe','preview_website','orvix_visual_preview_website','start_preview_server','orvix_visual_start_preview_server'];
      window.fixture.webTools=names.map((name,index)=>({...window.fixture.tool('web-tool-'+index,name),status:'running'}));
      window.fixture.lifecycle(window.fixture.webTools,true);
    });
    const websiteGroups=lifecycle.locator('.agent-tool-group'); const websiteHeadings=lifecycle.locator('.agent-tool-group-heading');
    await websiteHeadings.nth(2).waitFor(); assert.equal(await websiteGroups.count(),3,'website inspection calls remain grouped by tool family and sequence');
    assert.deepEqual(await websiteHeadings.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-expanded'))),['false','false','false'],'browser, preview and preview-server groups stay minimized while running');
    await websiteHeadings.nth(0).click(); await websiteHeadings.nth(1).click(); await websiteHeadings.nth(2).click();
    assert.deepEqual(await lifecycle.locator('.agent-tool-row-summary').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-expanded'))),['false','false','false','false','false'],'website tool detail rows stay minimized while running');
    await lifecycle.locator('.agent-tool-row-summary').first().click();
    await page.evaluate(()=>window.fixture.lifecycle(window.fixture.webTools.map(tool=>({...tool,status:'completed'})),false));
    await lifecycle.locator('.agent-work-group-heading').click();
    assert.deepEqual(await websiteHeadings.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-expanded'))),['true','true','true'],'manually opened website groups stay open after completion');
    assert.equal(await lifecycle.locator('.agent-tool-row-summary').first().getAttribute('aria-expanded'),'true','a manually opened website detail stays open after completion');
    await page.evaluate(()=>{const edits=[10,20,5].map((added,index)=>{const tool=window.fixture.tool('edit-total-'+index,'edit');tool.input=JSON.stringify({file:`page-${index}.html`,diff:{added,deleted:0}});return tool;});window.fixture.lifecycle(edits,false);});
    await lifecycle.locator('.agent-work-group-heading').click();
    const editHeading=lifecycle.locator('.agent-tool-group-heading'); await editHeading.waitFor();
    assert.equal(await editHeading.getAttribute('aria-expanded'),'false','completed edit group starts minimized');
    assert.match(await editHeading.locator('.agent-tool-group-lines').innerText(),/\+35\s+−0/,'minimized edit group totals line additions and deletions across edit calls');
    await editHeading.click(); assert.equal(await editHeading.locator('.agent-tool-group-lines').isVisible(),false,'expanded edit group hides the aggregate line total');
    await editHeading.click(); assert.match(await editHeading.locator('.agent-tool-group-lines').innerText(),/\+35\s+−0/,'minimizing the edit group restores the aggregate total');
    await page.evaluate(()=>window.fixture.lifecycle([]));
    const heading = page.locator('.agent-execution-heading'); await heading.waitFor(); assert.equal(await heading.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => window.fixture.emit({ type:'clarification',questionId:'q1',question:'Changes or threshold?',options:['Changes','Threshold'] }));
    await page.locator('.agent-clarification').waitFor();
    assert.equal(await page.locator('.agent-clarification-heading').innerText(),'Question'); assert.equal(await page.getByPlaceholder('Or write your own response').count(),1); assert.equal(await page.getByRole('button',{name:'Skip',exact:true}).count(),1);
    await page.evaluate(() => window.fixture.resolve('turn', {questionId:'old',question:'Stale lookup',options:[]}));
    assert.match(await page.locator('.agent-clarification').innerText(), /Changes or threshold/);
    assert.equal(await page.locator('.agent-execution-body').count(), 0, 'clarification must remain available outside collapsed details');
    await page.getByRole('button', {name:/Changes/}).click();
    await page.evaluate(() => {window.fixture.fail=true;});
    await page.getByRole('button', {name:'Send',exact:true}).click();
    await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /not saved/);
    await page.evaluate(() => {window.fixture.fail=false;});
    await page.getByRole('button', {name:'Send',exact:true}).click();
    await page.locator('.agent-clarification').waitFor({state:'hidden'}); assert.equal(await page.evaluate(() => window.fixture.answer), 'Changes');
    await page.evaluate(() => window.fixture.emit({ type:'clarification',questionId:'q-batch',question:'Which opening?',options:[{label:'Gallery',description:'Lead with a curated visual wall.'}],questions:[
      {question:'Which opening?',options:[{label:'Gallery',description:'Lead with a curated visual wall.'}]},
      {question:'What should the palette emphasize?',options:['Warm neutrals','Cool contrast']},
    ]}));
    await page.getByText('1 of 2',{exact:true}).waitFor(); await page.getByRole('button',{name:'Gallery'}).click();
    await page.getByRole('button',{name:'Next',exact:true}).click(); await page.getByText('2 of 2',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Cool contrast'}).click(); await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.locator('.agent-clarification').waitFor({state:'hidden'});
    assert.deepEqual(JSON.parse(await page.evaluate(() => window.fixture.answer)), ['Gallery','Cool contrast'], 'batch choices are submitted together in order');
    await heading.click(); assert.equal(await page.locator('.agent-execution-body details[open]').count(), 0, 'nested panels must start collapsed');
    await page.getByText('Request understanding · reviewed', {exact:true}).click(); assert.match(await page.locator('.agent-execution-body').innerText(), /50 to 51/);
    await page.getByText('Requirements & actions', {exact:true}).click();
    await page.getByRole('button', {name:'Read full evidence',exact:true}).click(); await page.getByRole('button', {name:'Load more',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.agent-evidence-viewer pre')?.textContent === 'firstsecond');
    await page.getByRole('button', {name:'Switch turn'}).click(); await page.waitForFunction(() => document.querySelector('.agent-execution-heading')?.getAttribute('aria-expanded') === 'false');
    const before = await page.evaluate(() => ({metadata:window.fixture.metadataReads.length,questions:window.fixture.questionReads}));
    await page.getByRole('button',{name:'Show long history',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.agent-execution-heading').length === 80);
    assert.deepEqual(await page.evaluate(() => ({metadata:window.fixture.metadataReads.length,questions:window.fixture.questionReads})),before,'closed historic turns must not start metadata or question requests');
    await page.locator('.agent-execution-heading').nth(79).click();
    await page.waitForFunction(() => window.fixture.metadataReads.at(-1)?.turn === 'old-79');
    assert.equal(await page.evaluate(() => window.fixture.metadataReads.length),before.metadata+1);
    assert.equal(await page.evaluate(() => window.fixture.metadataReads.at(-1).refresh),true,'opening one turn refreshes that turn');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: acknowledgment-separated work groups preserve plain updates, nested tools and thoughts, keyboard controls, streaming choices, completion and failure states; existing request/evidence and thinking UI regressions pass.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-agent-ui-')); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
