const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{chromium}=require('playwright-core');
const root=path.resolve('scratch/diagram-browser-'+Date.now());fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(path.join(root,'fixture.tsx'),`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Report from '../../src/components/AgentReport';function App(){const[text,setText]=useState('');window.setReport=setText;return <Report text={text}/>};createRoot(document.getElementById('root')).render(<App/>);`);
esbuild.buildSync({entryPoints:[path.join(root,'fixture.tsx')],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:path.join(root,'fixture.js')});
fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="frame-src about:"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>body{background:#17191c;color:#ddd;font-family:system-ui;margin:16px}#root{max-width:800px;margin:auto}</style><div id="root"></div><script src="fixture.js"></script>');
let networkProbes=0;
const server=http.createServer((req,res)=>{if(req.url==='/probe')networkProbes++;const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','fixture.js','fixture.css'].includes(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));});
let browser;let checks=0;
const fence=(lang,source,closed=true)=>'```'+lang+'\n'+source+(closed?'\n```':'');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1000,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.setReport);
 const set=source=>page.evaluate(source=>window.setReport(source),source);
 const check=async(name,fn)=>{await fn();checks++;console.log('Passed:',name);};
 await check('closed flowchart renders labels, zoom and source switch',async()=>{
  await set(fence('mermaid','flowchart LR\n A["Request"] --> B["Agent"] --> C["Result"]'));
  await page.locator('.agent-diagram-svg svg').waitFor();assert.match(await page.locator('.agent-diagram-svg').textContent(),/Request/);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Reset diagram zoom'}).textContent(),'125%');
  await page.getByRole('button',{name:'Code',exact:true}).click();assert.match(await page.locator('pre').textContent(),/flowchart LR/);
  await page.getByRole('button',{name:'Preview',exact:true}).click();await page.locator('.agent-diagram-svg svg').waitFor();
 });
 await check('unfinished stream waits, then renders the completed source',async()=>{
  await set(fence('mermaid','flowchart LR\n A -->',false));await page.getByRole('status').filter({hasText:'Waiting'}).waitFor();assert.equal(await page.locator('.agent-diagram-svg svg').count(),0);
  await set(fence('mermaid','sequenceDiagram\n Alice->>Bob: Hello'));await page.locator('.agent-diagram-svg svg').waitFor();assert.match(await page.locator('.agent-diagram-svg').textContent(),/Hello/);
 });
 await check('invalid source and oversized diagrams have readable fallback',async()=>{
  await set(fence('mermaid','this is invalid syntax'));await page.getByRole('status').filter({hasText:'Could not render'}).waitFor();assert.equal(await page.locator('body > div[id^="dorvix"]').count(),0);
  await set(fence('mermaid','x'.repeat(40001)));await page.getByRole('status').filter({hasText:'too large'}).waitFor();
 });
 await check('HTML labels and click actions cannot execute in the host',async()=>{
  await set(fence('mermaid','flowchart LR\n A["<img src=x onerror=window.pwned=1>"] --> B["Safe"]\n click B "javascript:window.pwned=1"'));
  await page.locator('.agent-diagram-svg svg').waitFor();assert.equal(await page.locator('.agent-diagram-svg img,.agent-diagram-svg a,.agent-diagram-svg foreignObject').count(),0);assert.equal(await page.evaluate(()=>window.pwned),undefined);
 });
 await check('interactive visual starts only on request; controls work in isolated frame',async()=>{
  const source='<button id="change">Change value</button><output id="value">1</output><script>document.getElementById("change").onclick=()=>document.getElementById("value").textContent="2";try{parent.document.body.dataset.pwned="yes"}catch{};try{localStorage.setItem("x","x")}catch{};</script>';
  await set(fence('orvix-visual',source));assert.equal(await page.locator('iframe').count(),0);await page.getByRole('button',{name:'Run visual',exact:true}).click();
  const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Change value'}).click();assert.equal(await frame.locator('#value').textContent(),'2');assert.equal(await page.evaluate(()=>document.body.dataset.pwned),undefined);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');assert.equal(await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content').then(s=>s.includes("connect-src 'none'")),true);
  await set(fence('orvix-visual','<p>Replacement</p>'));assert.equal(await page.locator('iframe').count(),0);await page.getByRole('button',{name:'Run visual',exact:true}).click();await page.getByRole('button',{name:'Stop visual',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);
 });
 await check('mobile diagram stays inside page and exposes labels',async()=>{
  await page.setViewportSize({width:375,height:850});await set(fence('mermaid','flowchart TD\n A["Request"] --> B["Agent"] --> C["Result"]'));await page.locator('.agent-diagram-svg svg').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(root,'mobile.png'),fullPage:true});
 });
 await check('sandbox blocks network requests and frame navigation',async()=>{
  const url='http://127.0.0.1:'+server.address().port+'/probe';
  await set(fence('orvix-visual','<button id="probe">Probe</button><script>document.getElementById("probe").onclick=()=>{fetch('+JSON.stringify(url)+').catch(()=>{});const img=new Image();img.src='+JSON.stringify(url)+';document.body.appendChild(img);location.href='+JSON.stringify(url)+';};</script>'));
  await page.getByRole('button',{name:'Run visual',exact:true}).click();await page.frameLocator('iframe').getByRole('button',{name:'Probe',exact:true}).click();await page.waitForTimeout(500);assert.equal(networkProbes,0);
 });
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,root}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
