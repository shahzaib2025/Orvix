const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {inspectReadableContent,readableContentFailures}=require('../electron/agent/readable-content.cjs');
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
const fixture=`<!doctype html><style>
body{margin:0;font:32px Arial}h1,p{margin:0}#safe{position:absolute;left:40px;top:20px;font-size:48px}
#covered{position:absolute;left:40px;top:150px;font-size:48px}
#scenery{position:absolute;left:40px;top:150px;width:600px;height:60px;background:white;z-index:5;pointer-events:none}
#clipped{position:absolute;left:40px;top:300px;font-size:72px;line-height:.55;overflow:hidden}
#scroller{position:absolute;left:40px;top:450px;width:500px;height:70px;overflow:auto}
#faded{position:absolute;left:40px;top:600px;opacity:0}#animated{position:absolute;left:40px;top:650px;animation:arrive 10s linear}
#scaled{position:absolute;left:700px;top:300px;width:300px;font-size:48px;line-height:1.3;overflow:hidden;transform:scale(1.3);transform-origin:0 0}
@keyframes arrive{from{transform:translateY(20px)}to{transform:none}}
</style><h1 id="safe">Readable headline</h1><p id="covered">This copy is covered</p><div id="scenery" aria-hidden="true"></div><h1 id="clipped">gyp</h1><h1 id="scaled">Legible gyp</h1><div id="scroller"><p>Scrollable content<br>More readable lines<br>More content below</p></div><p id="faded">Hidden entrance</p><p id="animated">Active entrance</p>`;

test('opaque pointer-inert scenery and tight masks are detected without flagging readable text, scrollers or active entrances',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1200,height:900}});await page.setContent(fixture);
 const before=await page.locator('#scenery').getAttribute('style');
 const result=await page.evaluate(inspectReadableContent);
 assert.ok(result.failures.some(row=>row.element==='#covered'&&row.kind==='text_occluded'),JSON.stringify(result));
 assert.ok(result.failures.some(row=>row.element==='#clipped'&&row.kind==='text_mask_clipping'),JSON.stringify(result));
 assert.ok(!result.failures.some(row=>row.element==='#safe'||row.element==='#scaled'||row.element==='#faded'||row.element==='#animated'||row.element==='p'));
 assert.ok(result.skipped.some(row=>row.element==='#animated'));
 assert.equal(await page.locator('#scenery').getAttribute('style'),before,await page.locator('#scenery').evaluate(el=>el.outerHTML));
 assert.equal(await page.locator('#scenery').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
 await page.locator('#scenery').evaluate(el=>el.style.background='transparent');
 await page.locator('#clipped').evaluate(el=>{el.style.lineHeight='1.4';el.style.overflow='visible';});
 const fixed=await page.evaluate(inspectReadableContent);
 assert.deepEqual(fixed.failures,[],JSON.stringify(fixed));
});

test('readability failures include motion checkpoints and unavailable viewport inspection',()=>{
 assert.equal(readableContentFailures({metrics:{readableContent:{status:'unavailable',reason:'test'}}})[0].kind,'readable_content_unavailable');
 assert.equal(readableContentFailures({motion:{frames:[{label:'release',progress:1,observations:{readableContent:{failures:[{kind:'text_occluded'}]}}}]}})[0].state,'release');
 assert.equal(readableContentFailures({motion:{frames:[{label:'release',observations:{readableContent:{status:'unavailable',reason:'test'}}}]}})[0].kind,'readable_content_unavailable');
});

for(const route of ['native','direct'])test(`${route} preview reports ordinary text occlusion and masks as failed layout under None`,{timeout:45000},async t=>{
 const os=require('node:os'),http=require('node:http');
 const {createAgentEngine}=require('../electron/agent/engine.cjs');
 const {listenBrowserLoopback}=require('../electron/agent/browser-loopback.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-readable-')),project=fs.mkdtempSync(path.join(__dirname,'readable-fixture-'));
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.equal(path.dirname(project),__dirname);fs.rmSync(project,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});});
 fs.writeFileSync(path.join(project,'index.html'),fixture);fs.writeFileSync(path.join(project,'package.json'),'{}');
 const server=http.createServer((_,response)=>response.end(fixture));await listenBrowserLoopback(server);t.after(()=>new Promise(resolve=>server.close(resolve)));
 const args={directory:project,url:`http://127.0.0.1:${server.address().port}`,viewports:[{width:1200,height:900}]};let called=false;
 const dependencies=route==='native'?{runNativeSession:async options=>{
  const bridge=await options.visualTools({acceptsImages:true,signal:options.signal});try{
   const response=await(await fetch(bridge.config.url,{method:'POST',headers:{...bridge.config.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'preview_website',arguments:args}})})).json();assert.notEqual(response.result.isError,true);
  }finally{await bridge.close();}return{text:'Inspected existing page; no source changed.'};
 }}:{requestModel:async()=>{
  if(called)return{text:'Inspected existing page; no source changed.',calls:[],route:'chat',raw:{content:'Inspected'}};
  called=true;return{text:'',calls:[{id:'readable',name:'preview_website',args}],route:'chat',raw:{content:null,tool_calls:[{id:'readable',type:'function',function:{name:'preview_website',arguments:JSON.stringify(args)}}]}};
 },reviewModel:async()=>({text:'{"status":"approved","reason":"fixture"}',calls:[]})};
 const engine=createAgentEngine({getPath:()=>root},{getKey:()=>route==='direct'?'fixture-key':''},()=>{},null,dependencies);t.after(()=>engine.shutdown());await engine.workspaces.open('readable',project,async()=>true);
 const result=await engine.run({taskId:'readable',requestId:'r',modelId:route==='native'?'opencode/mimo-v2.6-flash-free':'opencode-go/deepseek-v4-flash-vision-exp',designProfile:'none',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:'Inspect this existing website without changing files.'}]});
 const layout=result.verification.checks.find(check=>check.phase==='layout');assert.equal(layout?.status,'failed');assert.match(layout.output,/text_occluded|text_mask_clipping/);assert.equal(result.verification.designReview.status,'not_needed');
});
