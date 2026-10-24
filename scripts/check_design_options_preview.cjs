const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

async function main() {
  const optionText = [
    'SELECTED — Option B: Index Spine.',
    '',
    'Option A — Image Field: a full-bleed architectural photograph gives the building first priority.',
    'First viewport: one quiet image, a small studio label, and a low-left Selected work link.',
    'Section plan: image-led project study, material notes, and a closing visit.',
    '',
    'Option B — Index Spine: a typography-led work list sits beside a measured elevation drawing.',
    'First viewport: the practice statement takes the left column while six numbered projects form the right-hand index.',
    'Section plan: origin essay, selected projects, process line, studio portrait, and contact locator.',
    'Selection reason: the index puts the work before the promise and gives the page a distinct drawing language.',
    'Selected direction can proceed.'
  ].join('\n');
  const root = 'C:\\Fixture\\Florian Studio';
  const reportPath = `${root}\\field-report.md`;
  const changedPath = `${root}\\index.html`;
  const unchangedPath = `${root}\\notes.txt`;
  const sourcePath = `${root}\\app.js`;
  const imagePath = `${root}\\diagram.svg`;
  const screenshotDirectory = path.resolve(__dirname, `../scratch/shared-pane-preview-${Date.now()}`);
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const imageData = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#182640"/><stop offset="1" stop-color="#9c6e60"/></linearGradient><linearGradient id="panel" x2="0" y2="1"><stop stop-color="#f4e9d7"/><stop offset="1" stop-color="#c9a990"/></linearGradient></defs><rect width="960" height="540" fill="url(#bg)"/><circle cx="740" cy="140" r="92" fill="#f2cc8f" opacity=".9"/><path d="M0 410 170 250l126 115 156-220 186 250 116-118 206 176v87H0Z" fill="#24384a" opacity=".86"/><path d="M120 432h610l-68-188H220Z" fill="url(#panel)"/><path d="M184 432V300l88-55 88 55v132M360 432V300l88-55 88 55v132M536 432V300l88-55 88 55v132" fill="none" stroke="#76594f" stroke-width="9"/><path d="M92 472h680" stroke="#f5ead9" stroke-width="3" opacity=".8"/><text x="60" y="82" fill="#fff9ee" font-family="sans-serif" font-size="22" letter-spacing="5">WORKSPACE IMAGE PREVIEW</text></svg>').toString('base64');
  const items = [{ kind: 'progress', id: 'website-design-options', category: 'agent_update', providerId: 'fixture', providerLabel: 'Fixture', modelId: 'fixture', text: optionText, status: 'completed', startedAt: 1 }];
  const files = [{ path: changedPath, folder: root, kind: 'modified', binary: false, added: 2, deleted: 1, diffAvailable: true }];
  const bundle = await require('esbuild').build({ stdin: { contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {AgentActivityTimeline} from './src/components/AgentActivityTimeline';
    import {designOptionsPresentation} from './src/components/designOptionsPresentation';
    import AgentChanges from './src/components/AgentChanges';
    import './src/components/agent-workspace.css'; import './src/components/agent-changes.css';
    const root=${JSON.stringify(root)}, reportPath=${JSON.stringify(reportPath)}, changedPath=${JSON.stringify(changedPath)}, unchangedPath=${JSON.stringify(unchangedPath)}, sourcePath=${JSON.stringify(sourcePath)}, imagePath=${JSON.stringify(imagePath)}, imageData=${JSON.stringify(imageData)};
    const items=${JSON.stringify(items)}, files=${JSON.stringify(files)};
    window.fixture={reads:[],previews:[],diffs:[]};
    window.orvixDesktop={
      listAgentWorkspaceFiles:async(_task,workspace)=>({root:workspace,files:[reportPath,changedPath,unchangedPath,sourcePath,imagePath].map(file=>({path:file,relativePath:file.slice(root.length+1)})),total:5,truncated:false}),
      readAgentWorkspaceFile:async(_task,file)=>{window.fixture.reads.push(file);const content=file===reportPath?'# Field Notes\\n\\nA carefully formatted report preview.\\nSecond line for code view.':file===changedPath?'<!doctype html>\\n<h1>Source code</h1>':file===sourcePath?'function greet(name) {\\n  return "Hello, " + name + "!";\\n}\\n\\nconsole.log(greet("Orvix"));':file===imagePath?'<svg xmlns="http://www.w3.org/2000/svg"><title>Workspace diagram</title></svg>':'These notes are plain text.';return {path:file,content,binary:false,tooLarge:false,size:content.length};},
      previewAgentFile:async(_task,file)=>{window.fixture.previews.push(file);return file===reportPath?{path:file,name:'field-report.md',size:90,modifiedAt:1,kind:'text',content:'# Field Notes\\n\\nA carefully formatted report preview.\\nSecond line for code view.'}:file===imagePath?{path:file,name:'diagram.svg',size:130,modifiedAt:1,kind:'image',mime:'image/svg+xml',data:imageData}:{path:file,name:'index.html',size:130,modifiedAt:1,kind:'html',content:'<h1>Changed page</h1><script>parent.window.fixture.pwned=true</script>'};},
      getAgentDiff:async(_task,file)=>{window.fixture.diffs.push(file);return {before:'<h1>Old</h1>',after:'<h1>Changed</h1>',binary:false};},
      getAgentTurnDiff:async(_task,_turn,file)=>window.orvixDesktop.getAgentDiff('task',file),
      actOnAgentFile:async()=>({ok:true}),restoreAgentChange:async()=>files,
    };
    function Fixture(){const[open,setOpen]=useState(false),[direction,setDirection]=useState(null),[draft,setDraft]=useState(null);window.fixture.updateOptions=(text,running)=>setDraft({text,running});const currentItems=draft?[{...items[0],text:draft.text,status:draft.running?'running':'completed'}]:items;const liveChoices=draft?designOptionsPresentation(draft.text,draft.running):null;return <div className={'agent-dashboard'+(open?' changes-open changes-right':'')}><div className="agent-thread-shell"><AgentActivityTimeline items={currentItems} pending={draft?.running??false} onOpenDesignOptionPreview={(value,option)=>{setDirection({choices:value,option});setOpen(true)}}/><button id="open-changes" onClick={()=>{setDirection(null);setOpen(true)}}>Open changes</button></div>{open&&<AgentChanges key={direction?'options':'files'} taskId="task" initialFile={direction?null:reportPath} initialMode="preview" designOptions={direction?{...direction,choices:liveChoices??direction.choices}:null} workspaces={[root]} files={files} dockSide="right" width={500} minimized={false} maximized={false} onDockChange={()=>{}} onResize={()=>{}} onToggleMinimize={()=>{}} onToggleMaximize={()=>{}} onClose={()=>setOpen(false)} onUpdated={()=>{}}/>}</div>};
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, bundle: true, write: false, outfile: 'fixture.js', jsx: 'automatic', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? js : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0}body{background:#111214;color:#eee;font-family:Segoe UI,sans-serif}${css}.agent-dashboard{display:grid;grid-template-columns:minmax(0,1fr) 500px;grid-template-rows:minmax(0,1fr);height:100%;position:relative;background:#171819}.agent-thread-shell{grid-column:1;overflow:auto;padding:24px}.agent-dashboard.changes-open{grid-template-columns:minmax(0,1fr) minmax(360px,min(var(--agent-changes-width,500px),68vw))}.agent-dashboard.changes-open .agent-changes-panel{grid-column:2}.agent-dashboard.changes-open.changes-right .agent-changes-resize{left:0}@media(max-width:900px){.agent-dashboard.changes-open{grid-template-columns:minmax(0,1fr)}.agent-dashboard.changes-open .agent-changes-panel{position:absolute;inset:0 0 0 auto;width:96%;z-index:20}}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => require('node:fs').existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const capture = name => page.screenshot({ path: path.join(screenshotDirectory, name), animations: 'disabled' });
    const assertSingleControlRow = async label => {
      const geometry = await pane.locator('.agent-changes-filebar').evaluate(bar => {
        const rect = selector => {
          const element = bar.querySelector(selector);
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
        };
        const controls = ['.agent-workspace-breadcrumbs', '.agent-workspace-change-summary', '.agent-file-view-switch', '.agent-file-actions'].map(rect).filter(Boolean);
        return { height: bar.getBoundingClientRect().height, scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, centerSpread: Math.max(...controls.map(item => (item.top + item.bottom) / 2)) - Math.min(...controls.map(item => (item.top + item.bottom) / 2)), controlsInside: controls.every(item => item.left >= bar.getBoundingClientRect().left && item.right <= bar.getBoundingClientRect().right + 1) };
      });
      assert.ok(geometry.height <= 48, `${label}: file path and view controls occupy one compact row`);
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${label}: the combined row does not overflow horizontally`);
      assert.ok(geometry.centerSpread <= 2, `${label}: path, change count, view controls, and actions share the same baseline`);
      assert.equal(geometry.controlsInside, true, `${label}: all row controls remain inside the pane`);
    };

    await page.getByRole('button', { name: /Preview Option A/ }).click();
    const pane = page.locator('.agent-changes-panel');
    await pane.waitFor({ state: 'visible' });
    assert.match(await page.locator('.agent-design-options-badge').textContent(), /Option B Selected/i, 'the selected direction is recognized when its announcement precedes the detailed option blocks');
    assert.ok(await page.locator('.agent-design-option.is-selected[aria-label*="Option B"]').count(), 'the matching card reflects the selected direction');
    assert.equal(await page.locator('.agent-file-panel').count(), 0, 'options use the existing workspace pane, not a second sidebar');
    assert.equal(await page.locator('.agent-design-options-preview').count(), 0, 'no separate options viewer is mounted');
    assert.match(await pane.locator('.agent-design-options-preview-article').innerText(), /Image Field/);
    assert.equal(await pane.getByRole('tab', { name: /Option [AB]/ }).count(), 2, 'A and B are file-style tabs in the shared pane');
    assert.equal(await pane.getByRole('tab', { name: /Option A/ }).getAttribute('aria-selected'), 'true');
    assert.equal(await pane.getByRole('button', { name: 'Changes', exact: true }).count(), 0, 'design options have no irrelevant Changes view');
    await capture('01-option-a-preview.png');

    await pane.getByRole('button', { name: 'Code', exact: true }).click();
    assert.ok(await pane.locator('.agent-source-line-number').count() >= 4, 'option Code view shows read-only line numbers');
    assert.match(await pane.locator('.agent-source-scroll').innerText(), /full-bleed architectural photograph/);
    await capture('02-option-a-code.png');
    await pane.getByRole('tab', { name: /Option A/ }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await pane.getByRole('tab', { name: /Option B/ }).getAttribute('aria-selected'), 'true', 'keyboard switches the A/B file-style tabs');
    await pane.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.match(await pane.locator('.agent-design-options-preview-article').innerText(), /Selection rationale/);
    assert.match(await pane.locator('.agent-design-options-preview-article').innerText(), /the work before the promise/);
    assert.match(await pane.locator('.agent-design-options-preview-selected').textContent(), /Selected for build/i, 'reading the other option never changes the build selection');
    await capture('03-option-b-preview.png');

    await pane.getByRole('button', { name: 'Open workspace file' }).click();
    await pane.getByRole('option', { name: /field-report\.md/ }).click();
    assert.equal(await pane.getByRole('button', { name: 'Changes', exact: true }).count(), 0, 'unchanged reports do not expose a Changes control');
    await pane.getByRole('button', { name: 'Preview', exact: true }).click();
    await pane.getByRole('heading', { name: 'Field Notes' }).waitFor();
    assert.match(await pane.innerText(), /carefully formatted report preview/);
    await capture('04-markdown-preview.png');
    await pane.getByRole('button', { name: 'Code', exact: true }).click();
    assert.ok(await pane.locator('.agent-source-line-number').count() >= 3, 'report Code view uses numbered read-only lines');
    await capture('05-markdown-code.png');

    await pane.getByRole('button', { name: 'Open workspace file' }).click();
    await pane.getByRole('option', { name: /index\.html/ }).click();
    assert.equal(await pane.getByRole('button', { name: 'Changes', exact: true }).count(), 1, 'changed files expose Changes');
    assert.equal(await pane.getByRole('button', { name: 'Preview', exact: true }).count(), 1, 'previewable changed files expose Preview');
    await assertSingleControlRow('desktop');
    await pane.getByRole('button', { name: 'Changes', exact: true }).click();
    await pane.getByText('<h1>Changed</h1>', { exact: true }).waitFor();
    await pane.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = pane.locator('iframe[title="Preview of index.html"]');
    await frame.waitFor();
    assert.equal(await frame.getAttribute('sandbox'), '', 'HTML preview remains sandboxed');
    assert.equal(await page.evaluate(() => window.fixture.pwned), undefined, 'HTML preview cannot execute scripts in the app');
    await page.waitForTimeout(300);
    await capture('06-html-preview.png');

    await pane.getByRole('button', { name: 'Open workspace file' }).click();
    await pane.getByRole('option', { name: /app\.js/ }).click();
    assert.equal(await pane.getByRole('button', { name: 'Changes', exact: true }).count(), 0, 'unchanged JavaScript exposes no Changes control');
    assert.equal(await pane.getByRole('button', { name: 'Preview', exact: true }).count(), 0, 'ordinary source files expose Code only');
    await pane.locator('.agent-source-line-number').first().waitFor();
    assert.match(await pane.locator('.agent-source-scroll').innerText(), /console\.log/);
    await capture('07-javascript-code.png');

    await pane.getByRole('button', { name: 'Open workspace file' }).click();
    await pane.getByRole('option', { name: /diagram\.svg/ }).click();
    assert.equal(await pane.getByRole('button', { name: 'Code', exact: true }).count(), 1, 'SVG remains available as source');
    assert.equal(await pane.getByRole('button', { name: 'Preview', exact: true }).count(), 1, 'SVG offers its visual Preview');
    await pane.getByRole('button', { name: 'Preview', exact: true }).click();
    const image = pane.locator('.agent-file-panel-image img');
    await image.waitFor();
    assert.equal(await image.evaluate(element => element.complete && element.naturalWidth > 0), true, 'SVG image preview renders');
    await capture('08-svg-image-preview.png');

    await pane.getByRole('button', { name: 'Close changes' }).click();
    await pane.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Preview Option B/ }).click();
    await page.locator('.agent-changes-panel').waitFor();
    const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, panel: document.querySelector('.agent-changes-panel').getBoundingClientRect().toJSON() }));
    assert.ok(geometry.width <= geometry.viewport, 'mobile page has no horizontal overflow');
    assert.ok(geometry.panel.left >= 0 && geometry.panel.right <= geometry.viewport + 1, 'the shared pane remains within the mobile viewport');
    await capture('09-mobile-option-preview.png');
    await pane.getByRole('button', { name: 'Open workspace file' }).click();
    await pane.getByRole('option', { name: /index\.html/ }).click();
    assert.equal(await pane.getByRole('button', { name: 'Code', exact: true }).count(), 1, 'mobile changed files keep Code');
    assert.equal(await pane.getByRole('button', { name: 'Changes', exact: true }).count(), 1, 'mobile changed files keep Changes');
    assert.equal(await pane.getByRole('button', { name: 'Preview', exact: true }).count(), 1, 'mobile changed files keep Preview');
    await assertSingleControlRow('mobile');
    await capture('10-mobile-controls-row.png');
    await page.locator('.agent-changes-panel [role="tab"]').first().focus();
    await page.keyboard.press('Escape');
    await page.locator('.agent-changes-panel').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const draftA = 'Option A — Image Field\nA building fills the first viewport above a small action.';
    await page.evaluate(text => window.fixture.updateOptions(text, true), draftA);
    await page.locator('.agent-design-options[aria-busy="true"]').waitFor();
    assert.equal(await page.locator('.agent-design-options-grid .agent-design-option').count(), 2, 'both cards exist as soon as the first option begins');
    assert.match(await page.locator('.agent-design-option').nth(1).innerText(), /Waiting for this option/);
    await page.getByRole('button', { name: /Preview Option A/ }).click();
    await capture('11-streaming-option-a.png');
    await pane.getByRole('button', { name: 'Code', exact: true }).click();
    const longDraft = draftA + '\n\n' + Array.from({ length: 65 }, (_, index) => `Spatial decision ${index + 1}: a shared rail gives the photography and action a clear reading order.`).join('\n');
    await page.evaluate(text => window.fixture.updateOptions(text, true), longDraft);
    await page.waitForFunction(() => document.querySelector('.agent-source-scroll')?.textContent.includes('Spatial decision 65'));
    assert.equal(await pane.locator('.agent-source-line-number').count() > 65, true, 'the whole long draft is visible as numbered Code');
    assert.match(await pane.getByRole('button', { name: 'Code', exact: true }).getAttribute('aria-pressed'), /true/, 'a content update preserves the chosen view');
    await pane.locator('.agent-source-scroll').evaluate(element => { element.scrollTop = 300; });
    const beforeScroll = await pane.locator('.agent-source-scroll').evaluate(element => element.scrollTop);
    const both = longDraft + '\n\nOption B — Work Index\nAn inspectable project index leads into an annotated section drawing.';
    await page.evaluate(text => window.fixture.updateOptions(text, true), both);
    await page.waitForFunction(() => document.querySelectorAll('.agent-design-option')[1]?.textContent.includes('inspectable project index'));
    assert.equal(await pane.locator('.agent-source-scroll').evaluate(element => element.scrollTop), beforeScroll, 'streaming does not reset the reader scroll position');
    await pane.getByRole('tab', { name: /Option B/ }).click();
    await pane.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.evaluate(text => window.fixture.updateOptions(text, true), both + '\nIts mobile reading order starts with project rows.');
    await page.waitForFunction(() => document.querySelector('.agent-design-options-preview-copy')?.textContent.includes('mobile reading order'));
    assert.equal(await pane.getByRole('tab', { name: /Option B/ }).getAttribute('aria-selected'), 'true', 'updates preserve the A/B reading selection');
    await capture('12-streaming-both-options.png');
    const finished = both + '\n\nSelected option: B\nSelection reason: B exposes the work immediately.\n\nSelected layout blueprint\nA shared rail aligns the project index and navigation.\n\nSelected direction can proceed.';
    await page.evaluate(text => window.fixture.updateOptions(text, false), finished);
    await page.waitForFunction(() => !document.querySelector('.agent-design-options[aria-busy="true"]'));
    assert.match(await pane.innerText(), /A shared rail aligns the project index/);
    assert.equal(await page.locator('.agent-design-options-grid').count(), 1, 'completion updates the original cards without adding a second set');
    await pane.getByRole('button', { name: 'Code', exact: true }).click();
    assert.match(await pane.locator('.agent-source-scroll').innerText(), /Selected layout blueprint/);
    await capture('13-completed-stream-code.png');
    await pane.getByRole('button', { name: 'Open workspace file' }).click();
    await pane.getByRole('option', { name: /app\.js/ }).click();
    await pane.locator('.agent-source-line-number').first().waitFor();
    await page.evaluate(text => window.fixture.updateOptions(text, false), finished + '\nOne final public note.');
    assert.match(await pane.getByRole('tab', { name: /app\.js/ }).getAttribute('aria-selected'), /true/, 'a final content update leaves a workspace file open');
    await page.setViewportSize({ width: 390, height: 844 });
    await pane.getByRole('tab', { name: /Option B/ }).click();
    await pane.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'streamed options fit mobile');
    await capture('14-streamed-mobile-preview.png');
    assert.deepEqual(errors, []);
    console.log(`PASS: one shared pane handles A/B directions, Markdown Preview/Code, JavaScript Code, SVG Preview, changed HTML Code/Changes/Preview, sandboxing, keyboard navigation and mobile fit. Screenshots: ${screenshotDirectory}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
