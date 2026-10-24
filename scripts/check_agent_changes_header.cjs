const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

async function main() {
  const bundle = await require('esbuild').build({ stdin: { contents: `
    import {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import AgentChanges from './src/components/AgentChanges';
    const root='C:/MockWorkspace/NASSIK-Plant-and-Pot', paths=['index.html','style.css','app.js','products.js','catalog.html','theme.css','src/components/a-very-long-workspace-component-name.tsx'];
    const changed=paths.slice(0,6).map((name,index)=>({path:root+'/'+name,folder:root,kind:'modified',binary:false,added:[900,300,300,300,200,194][index],deleted:0}));
    window.fixture={actions:[],confirmations:0,reads:0,diffs:0};
    window.confirm=()=>{window.fixture.confirmations++;return true;};
    window.orvixDesktop={
      async readAgentWorkspaceFile(task,file){window.fixture.reads++;return {path:file,content:'<!doctype html>\\n<main>Workspace file preview</main>',binary:false,tooLarge:false,size:70};},
      async listAgentWorkspaceFiles(){return {root,files:paths.map(name=>({path:root+'/'+name,relativePath:name})),total:paths.length,truncated:false};},
      async getAgentDiff(){window.fixture.diffs++;return {before:'old',after:'new',binary:false};},
      async restoreAgentChange(task,file){window.fixture.actions.push(['restore',task,file]);return file?changed.filter(change=>change.path!==file):[];},
    };
    function Fixture(){
      const [width,setWidth]=useState(960),[minimized,setMinimized]=useState(false),[maximized,setMaximized]=useState(false),[dock,setDock]=useState('right'),[files,setFiles]=useState(changed);
      window.fixture.resize=setWidth;
      return <div id="pane-host" style={{width:minimized?48:maximized?1000:width,height:460,display:'flex',position:'relative'}}>
        <AgentChanges taskId="fixture" workspaces={[root]} files={files} dockSide={dock} width={width} minimized={minimized} maximized={maximized}
          onResize={setWidth} onDockChange={side=>{setDock(side);window.fixture.actions.push(['dock',side]);}}
          onToggleMinimize={()=>setMinimized(value=>!value)} onToggleMaximize={()=>setMaximized(value=>!value)}
          onClose={()=>window.fixture.actions.push(['close'])} onUpdated={setFiles}/>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, bundle: true, write: false, outfile: 'fixture.js', jsx: 'automatic', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? js : `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:24px;background:#111214;color:#eee;font-family:Segoe UI,sans-serif}${css}.agent-changes-panel{flex:1}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const panel = page.locator('.agent-changes-panel'), more = page.locator('.agent-changes-overflow > summary'), details = page.locator('.agent-changes-overflow');
    const menu = details.locator('.agent-changes-overflow-menu');
    await page.getByRole('tab', { name: 'index.html' }).waitFor();
    const resize = async width => {
      await page.evaluate(value => window.fixture.resize(value), width);
      await page.waitForFunction(value => Math.abs(document.getElementById('pane-host').getBoundingClientRect().width - value) < 1, width);
    };
    const checkGeometry = async () => {
      const bounds = await page.locator('.agent-changes-head').evaluate(header => {
        const h = header.getBoundingClientRect(), tabs = header.querySelector('.agent-editor-tabs').getBoundingClientRect(), actions = header.querySelector('.agent-changes-actions').getBoundingClientRect();
        const filebar = document.querySelector('.agent-changes-filebar');
        const view = filebar.querySelector('.agent-file-view-switch').getBoundingClientRect(), fileActions = filebar.querySelector('.agent-file-actions').getBoundingClientRect();
        return { height: h.height, overflows: header.scrollWidth > header.clientWidth + 1, overlaps: tabs.right > actions.left + 1, actionsOutside: actions.right > h.right + 1,
          filebarHeight: filebar.getBoundingClientRect().height, filebarOverflows: filebar.scrollWidth > filebar.clientWidth + 1, narrow: h.width <= 760,
          toolsAligned: Math.abs((view.top + view.bottom) / 2 - (fileActions.top + fileActions.bottom) / 2) < 1 };
      });
      assert.equal(bounds.height, 44); assert.equal(bounds.overflows, false); assert.equal(bounds.overlaps, false); assert.equal(bounds.actionsOutside, false);
      assert.equal(bounds.filebarOverflows, false); assert.ok(bounds.filebarHeight <= (bounds.narrow ? 76 : 44), 'path and tools use at most two compact rows');
      assert.equal(bounds.toolsAligned, true, 'file actions stay aligned with the view switch');
    };
    const screenshot = async name => {
      if (!process.env.ORVIX_UI_SCREENSHOT_DIR) return;
      const directory = path.resolve(process.env.ORVIX_UI_SCREENSHOT_DIR); fs.mkdirSync(directory, { recursive: true });
      await panel.screenshot({ path: path.join(directory, name + '.png') });
    };
    assert.equal(await more.isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Dock changes on left', exact: true }).isVisible(), true);
    await checkGeometry(); await screenshot('header-wide');

    for (const width of [760, 640, 570, 480, 420, 320, 280]) {
      await resize(width); await more.waitFor({ state: 'visible' }); await checkGeometry();
      assert.equal(await page.locator('.agent-changes-actions > button:not(.agent-changes-close):visible').count(), 0, 'secondary actions are consolidated before tabs get crowded');
      assert.equal(await page.getByRole('button', { name: 'Close changes', exact: true }).isVisible(), true);
    }
    const fileMore = page.getByLabel('More file actions', {exact:true}), fileMenu = page.locator('.agent-file-actions-overflow .agent-changes-overflow-menu');
    await resize(570); await checkGeometry(); await screenshot('filebar-screenshot-width');
    assert.equal(await fileMore.isVisible(), false);
    let reads = await page.evaluate(() => window.fixture.reads);
    await page.getByRole('button', {name:'Refresh current file', exact:true}).click();
    await page.waitForFunction(count => window.fixture.reads > count, reads);
    await resize(420); await fileMore.click(); await fileMenu.waitFor({state:'visible'}); await screenshot('filebar-compact-menu');
    const fileMenuBounds = await fileMenu.boundingBox(), filePanelBounds = await panel.boundingBox();
    assert.ok(fileMenuBounds.x >= filePanelBounds.x && fileMenuBounds.x + fileMenuBounds.width <= filePanelBounds.x + filePanelBounds.width, 'file actions stay inside the pane');
    await page.keyboard.press('Escape'); assert.equal(await fileMore.evaluate(el=>el===document.activeElement), true);
    await page.keyboard.press('Enter'); await fileMenu.waitFor({state:'visible'});
    await fileMenu.getByRole('button', {name:'Refresh current file', exact:true}).click();
    assert.equal(await fileMenu.isVisible(), false);
    await page.getByRole('button', {name:'Changes', exact:true}).click();
    await page.waitForFunction(() => window.fixture.diffs === 1);
    await fileMore.click(); await fileMenu.getByRole('button', {name:'Refresh current file', exact:true}).click();
    await page.waitForFunction(() => window.fixture.diffs === 2);
    await page.getByRole('button', {name:'Code', exact:true}).click();
    await fileMore.click(); await page.locator('.agent-changes-preview').click({position:{x:20,y:180}});
    assert.equal(await fileMenu.isVisible(), false);
    await fileMore.click(); await resize(960); await page.waitForFunction(()=>!document.querySelector('.agent-file-actions-overflow').open);
    await resize(420); assert.equal(await fileMenu.isVisible(), false);
    await screenshot('filebar-narrow');
    await resize(640); await more.click(); await menu.waitFor({ state: 'visible' }); await screenshot('header-compact-menu');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.agent-changes-overflow').open);
    assert.equal(await more.evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Enter'); await menu.waitFor({ state: 'visible' });
    await menu.getByRole('button', { name: 'Dock on left', exact: true }).click();
    assert.equal(await details.getAttribute('open'), null);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions.at(-1)), ['dock', 'left']);

    await more.click(); await page.locator('.agent-changes-preview').click({ position: { x: 20, y: 180 } });
    assert.equal(await details.getAttribute('open'), null, 'outside clicks dismiss the menu');
    await more.click(); await resize(960); await page.waitForFunction(() => !document.querySelector('.agent-changes-overflow').open);
    await resize(640); assert.equal(await details.getAttribute('open'), null, 'resizing back does not reopen a stale menu');
    await more.click(); await menu.getByRole('button', { name: 'Maximize pane', exact: true }).click();
    await page.getByRole('button', { name: 'Restore split view', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Restore split view', exact: true }).click(); await more.waitFor({ state: 'visible' });

    await more.click(); await menu.getByRole('button', { name: 'Open file…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Open workspace file' }).waitFor();
    await page.getByRole('option', { name: /style.css/ }).click();
    await page.getByRole('button', { name: 'Open another workspace file', exact: true }).click();
    await page.getByRole('option', { name: /a-very-long-workspace-component-name/ }).click();
    await resize(280); await checkGeometry();
    await page.waitForFunction(() => {
      const strip = document.querySelector('.agent-editor-tab-strip').getBoundingClientRect(), tab = document.querySelector('.agent-editor-tab.selected').getBoundingClientRect();
      return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    });
    assert.equal(await page.getByRole('button', { name: 'Open another workspace file', exact: true }).isVisible(), false);
    await screenshot('header-narrow');
    await page.getByRole('button', { name: 'Open workspace file', exact: true }).click();
    const pickerBounds = await page.getByRole('dialog', { name: 'Open workspace file' }).boundingBox(), panelBounds = await panel.boundingBox();
    assert.ok(pickerBounds.x >= panelBounds.x && pickerBounds.x + pickerBounds.width <= panelBounds.x + panelBounds.width + 1, 'file picker stays within the narrow pane');
    await page.keyboard.press('Escape');
    await more.click(); await menu.getByRole('button', { name: 'Minimize pane', exact: true }).click();
    await page.getByRole('button', { name: 'Restore changes pane', exact: true }).waitFor();
    assert.equal(await panel.evaluate(element => Math.round(element.getBoundingClientRect().width)), 48);
    await page.getByRole('button', { name: 'Restore changes pane', exact: true }).click(); await checkGeometry();
    await page.getByRole('tab', {name:'index.html'}).click();
    await fileMore.click(); await fileMenu.getByRole('button', {name:'Restore this file', exact:true}).click();
    await page.waitForFunction(() => window.fixture.confirmations === 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions.at(-1)), ['restore','fixture','~/Desktop/NASSIK-Plant-and-Pot/index.html']);
    await more.click(); await menu.getByRole('button', { name: 'Restore all changes', exact: true }).click();
    await page.waitForFunction(() => window.fixture.confirmations === 2 && window.fixture.actions.some(action => action[0] === 'restore' && action[2] === undefined));
    assert.equal(await details.getAttribute('open'), null);
    await page.getByRole('button', { name: 'Close changes', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixture.actions.at(-1)), ['close']);
    assert.deepEqual(errors, []);
    console.log('PASS: Header and filebar fit 280–960px with long paths and six-file totals; compact file actions, code/diff refresh, keyboard/outside dismissal, tabs, docking, resizing, restore and close work.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
