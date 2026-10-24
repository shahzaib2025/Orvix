// Real Chromium UI checks with isolated clipboard doubles; never changes the user's clipboard.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{chromium}=require('playwright-core');
const root=path.resolve('scratch/report-browser-'+Date.now());fs.mkdirSync(root,{recursive:true});
const source='# Results 😀\r\n\r\nOriginal **Markdown** and বাংলা.\r\n\r\n## Checks\r\n- Passed fixture\r\n\r\n### Detail\r\nNested text\r\n\r\n| Option | Benefit | Tradeoff | Evidence |\r\n| :--- | :---: | ---: | --- |\r\n| **Local** | `a\\|b` | None | Observed |\r\n| Browser | | Permission | Unverified | extra cell |\r\n\r\n## Same\r\nFirst\r\n\r\n## Same\r\nSecond\r\n\r\n```js\r\n  const hi = "😀";\r\n\treturn hi;\r\n```\r\n';
const report={root,checks:[],errors:[]};
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import AgentReport from '../../src/components/AgentReport';import{ReplyActions,UserMessageCopy}from'../../src/components/AgentMessageCopy';
import{copyTextToClipboard}from'../../src/clipboard';import{parseAgentReport}from'../../src/components/agentReportParser';
import'../../src/components/agent-dashboard.css';import'../../src/components/agent-workspace.css';import'../../src/components/agent-report.css';
window.directCopy=copyTextToClipboard;window.parseReport=parseAgentReport;window.calls=[];
window.configureClipboard=(mode)=>{window.calls=[];window.orvixDesktop={manageClipboard:async({text})=>{window.calls.push({route:'desktop',text});if(mode==='pending')return new Promise(resolve=>window.resolveCopy=()=>resolve({status:'ok'}));if(mode==='desktop')return{status:'ok'};if(mode==='desktop-status')return{status:'error'};throw Error('Desktop unavailable');}};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.calls.push({route:'browser',text});if(mode==='browser'||mode==='desktop-status')return;throw Error('Browser unavailable');}}});
document.execCommand=(command)=>{window.calls.push({route:'selection',command});if(mode==='fallback'||mode==='fail'){const data=new DataTransfer();const e=new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);window.calls.push({route:'copy-event',text:data.getData('text/plain')});}return mode==='fallback';};};
window.configureClipboard('desktop');
function Fixture(){const[text,setText]=useState(${JSON.stringify(source)});window.setReport=setText;return <main className="agent-dashboard"><div className="agent-user-bubble"><UserMessageCopy text={text}/></div><div className="agent-response"><div className="agent-response-body"><AgentReport text={text}/><ReplyActions text={text}/></div></div><input id="focus-target" defaultValue="restore selection"/><p id="selection-target">Retain this selected text.</p></main>};
createRoot(document.getElementById('root')).render(<Fixture/>);`;
fs.writeFileSync(path.join(root,'fixture.tsx'),entry);
esbuild.buildSync({entryPoints:[path.join(root,'fixture.tsx')],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:path.join(root,'fixture.js')});
fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>html{background:#17191c;color:#ddd;font-family:Inter,"Segoe UI",sans-serif}body{margin:0}main.agent-dashboard{display:block;max-width:840px;margin:32px auto;padding:0 22px;box-sizing:border-box}.agent-response-body{min-width:0}.agent-user-bubble{margin-bottom:15px}input{margin-top:20px}</style><div id="root"></div><script src="fixture.js"></script>');
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','fixture.js','fixture.css'].includes(name)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
let browser;
async function check(name,fn){await fn();report.checks.push(name);console.log('Passed:',name);}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('table').waitFor();
 const lastText=async()=>page.evaluate(()=>window.calls.findLast(c=>c.text!==undefined)?.text);
 const reset=mode=>page.evaluate(mode=>window.configureClipboard(mode),mode);
 const copy=async(label,nth=0)=>{await reset('desktop');await page.getByRole('button',{name:label,exact:true}).nth(nth).click();await page.waitForFunction(()=>window.calls.length>0);return lastText();};
 await check('whole-response and message controls copy the original CRLF Markdown',async()=>{
  assert.equal(await copy('Copy response'),source);assert.equal(await copy('Copy message'),source);
 });
 await check('parent section includes nested headings; duplicates use independent ranges',async()=>{
  assert.equal(await copy('Copy section: Checks'),source.slice(source.indexOf('## Checks'),source.indexOf('## Same')));
  assert.equal(await copy('Copy section: Same',0),'## Same\r\nFirst\r\n\r\n');
  assert.equal(await copy('Copy section: Same',1),source.slice(source.lastIndexOf('## Same')));
 });
 await check('table and code controls exclude labels and retain exact source',async()=>{
  assert.equal(await copy('Copy table'),source.slice(source.indexOf('| Option'),source.indexOf('\r\n## Same')));
  assert.equal(await copy('Copy code'),'  const hi = "😀";\r\n\treturn hi;\r\n');
 });
 await check('desktop exceptions and explicit failure use browser clipboard',async()=>{
  for(const mode of ['browser','desktop-status']){await reset(mode);await page.getByRole('button',{name:'Copy table',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.route==='browser'));assert.equal((await page.evaluate(()=>window.calls)).length,2);assert.equal(await lastText(),source.slice(source.indexOf('| Option'),source.indexOf('\r\n## Same')));}
 });
 await check('selection fallback copies original CRLF via copy event and restores input focus/range',async()=>{
  await reset('fallback');const result=await page.evaluate(async()=>{const input=document.querySelector('#focus-target');input.focus();input.setSelectionRange(2,8,'backward');await window.directCopy('😀\r\n  exact\r\n');return{active:document.activeElement.id,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,remaining:document.querySelectorAll('textarea').length};});
  assert.deepEqual(result,{active:'focus-target',start:2,end:8,direction:'backward',remaining:0});assert.equal(await lastText(),'😀\r\n  exact\r\n');
 });
 await check('fallback restores DOM text selection on success and failure',async()=>{
  for(const mode of ['fallback','fail']){await reset(mode);const result=await page.evaluate(async()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#selection-target'));const s=getSelection();s.removeAllRanges();s.addRange(range);const original=s.toString();let failed=false;try{await window.directCopy('source');}catch{failed=true;}return{original,restored:s.toString(),failed,remaining:document.querySelectorAll('textarea').length};});assert.equal(result.restored,result.original);assert.equal(result.failed,mode==='fail');assert.equal(result.remaining,0);}
 });
 await check('complete failure is accessible and never reports Copied',async()=>{
  await reset('fail');const button=page.getByRole('button',{name:'Copy response',exact:true});await button.click();const control=button.locator('..');await control.getByRole('status').filter({hasText:'Could not copy'}).waitFor();assert.equal(await button.innerText(),'Copy response');assert.equal(await page.evaluate(()=>document.querySelectorAll('textarea').length),0);assert.ok(await button.evaluate(e=>document.activeElement===e));await page.waitForTimeout(2300);assert.equal(await control.getByRole('status').innerText(),'');
 });
 await check('success feedback requires confirmation and resets after 2.2 seconds',async()=>{
  await reset('pending');const button=page.getByRole('button',{name:'Copy code',exact:true});await button.click();assert.equal(await button.innerText(),'Copy code');await page.evaluate(()=>window.resolveCopy());await page.waitForFunction(()=>document.querySelector('[aria-label="Copy code"]').textContent==='Copied');await page.waitForTimeout(2300);assert.equal(await button.innerText(),'Copy code');
 });
 await check('stale async copy does not mark a replacement historical reply as copied',async()=>{
  await reset('pending');await page.getByRole('button',{name:'Copy response',exact:true}).click();await page.evaluate(()=>window.setReport('## Historical\r\nSaved reply unchanged.'));await page.getByRole('heading',{name:'Historical'}).waitFor();await page.evaluate(()=>window.resolveCopy());await page.waitForTimeout(50);assert.equal(await page.getByRole('button',{name:'Copy response',exact:true}).innerText(),'Copy response');await reset('desktop');await page.getByRole('button',{name:'Copy response',exact:true}).click();assert.equal(await lastText(),'## Historical\r\nSaved reply unchanged.');
 });
 await check('unfinished fences and empty code copy exactly',async()=>{
  for(const [text,expected]of [['## Partial\r\n```js\r\n  incomplete\r\n','  incomplete\r\n'],['```\n```','']]){await page.evaluate(text=>window.setReport(text),text);await page.getByRole('button',{name:'Copy code',exact:true}).waitFor();assert.equal(await copy('Copy code'),expected);}
 });
 await page.evaluate(text=>window.setReport(text),source);await page.getByRole('table').waitFor();
 await check('desktop view has no page overflow and controls are keyboard reachable',async()=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'Copy section: Results 😀',exact:true}).focus();await page.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="Copy section: Results 😀"]').parentElement).opacity==='1');await page.keyboard.press('Enter');assert.equal(await lastText(),source);await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement.tagName==='BUTTON'));
  await page.screenshot({path:path.join(root,'desktop.png'),fullPage:true});
 });
 const mobile=await browser.newPage({viewport:{width:375,height:900},isMobile:true,hasTouch:true});await mobile.goto('http://127.0.0.1:'+server.address().port);await mobile.getByRole('table').waitFor();
 await check('narrow touch view confines table overflow and keeps copy toolbar fixed',async()=>{
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const wrap=mobile.locator('.agent-report-table-wrap');assert.ok(await wrap.evaluate(e=>e.scrollWidth>e.clientWidth));const button=mobile.getByRole('button',{name:'Copy table',exact:true});const before=await button.boundingBox();await wrap.evaluate(e=>e.scrollLeft=10000);const after=await button.boundingBox();assert.equal(before.x,after.x);assert.ok(after.x>=0&&after.x+after.width<=375);assert.equal(await button.locator('..').evaluate(e=>getComputedStyle(e).opacity),'1');await button.click();assert.equal(await mobile.evaluate(()=>window.calls[0].text),source.slice(source.indexOf('| Option'),source.indexOf('\r\n## Same')));await mobile.screenshot({path:path.join(root,'mobile.png'),fullPage:true});
 });
 await check('keyboard arrows scroll the focused table',async()=>{
  const wrap=mobile.locator('.agent-report-table-wrap');await wrap.evaluate(e=>e.scrollLeft=0);await wrap.focus();await mobile.keyboard.press('ArrowRight');await mobile.waitForTimeout(300);assert.ok(await wrap.evaluate(e=>e.scrollLeft>0));
 });
 const livePath=process.argv[2];if(livePath){
  const live=fs.readFileSync(path.resolve(livePath),'utf8');await page.evaluate(text=>window.setReport(text),live);await page.getByRole('table').waitFor();
  await check('live generated report renders a useful table and copies original table/section/response',async()=>{
   const spans=await page.evaluate(text=>window.parseReport(text),live);const table=spans.find(b=>b.kind==='table'),heading=spans.find(b=>b.kind==='heading');assert.ok(table?.rows.length>=3);assert.equal(await copy('Copy table'),live.slice(table.start,table.end));assert.equal(await copy('Copy section: '+heading.title),live.slice(heading.start,heading.sectionEnd));assert.equal(await copy('Copy response'),live);await page.screenshot({path:path.join(root,'live.png'),fullPage:true});
  });
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
})().catch(e=>{report.error=e.stack;console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,report:path.join(root,'report.json')}));});
