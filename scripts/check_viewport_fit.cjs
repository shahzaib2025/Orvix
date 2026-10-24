const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require('playwright-core');
const {inspectViewportFit,viewportFitFailures}=require('../electron/agent/viewport-fit.cjs');
const {previewWebsite}=require('../electron/agent/preview-website.cjs');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const {createDesignReview}=require('../electron/agent/design-review.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const {listenBrowserLoopback}=require('../electron/agent/browser-loopback.cjs');
const html=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Locked content fixture</title><style>
*{box-sizing:border-box}body{margin:0;color:#111;background:#fff}header{position:fixed;top:0;width:100%;height:64px;background:#fff;z-index:10}header p{margin:12px}aside{position:fixed;width:180px;background:white}p{margin:0}#bad{top:76px;left:0;height:480px;padding:20px}#bad p{height:390px}button{height:36px}#good{top:90px;left:1000px;height:100px}#scroller{top:90px;left:220px;height:200px;overflow-y:auto}#scroller ul{margin:0}#scroller li{height:40px}#masked{top:90px;left:620px;height:150px}#masked .mask{height:40px;overflow:hidden}#masked p{height:100px}#occluded{top:10px;left:850px;height:40px}#decor{top:90px;left:450px;height:900px}#entrance{top:90px;left:450px;height:80px}#entrance p{opacity:0;transform:translateY(700px)}main{padding-top:90px}#runway{height:1800px}#ordinary{height:1600px}
</style><header><p>Header</p></header><aside id="bad"><p>Reading content</p><button>Required action</button></aside><aside id="good"><p>Fits</p></aside><aside id="scroller"><ul>${Array.from({length:12},(_,i)=>`<li>Scrollable item ${i}</li>`).join('')}</ul></aside><aside id="masked"><div class="mask"><p>Content masked by ancestor</p></div></aside><aside id="occluded"><p>Behind header</p></aside><aside id="decor" aria-hidden="true"><p>Decorative off-screen scenery</p></aside><aside id="entrance"><p>Transparent entrance</p></aside><main><section id="runway"><h1>Ordinary scroll</h1></section><section id="ordinary"><p>Long normal-flow reading section</p></section></main></html>`;
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-fit-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});return root;}
async function serve(t){const server=http.createServer((_,r)=>r.end(html));await listenBrowserLoopback(server);t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}

test('measured fit detects locked copy/control overflow and header/ancestor occlusion, excluding normal flow, decoration, entrances and usable scrollers',async t=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1200,height:500}});await page.setContent(html);
 await page.evaluate(()=>{const drawing=document.createElementNS('http://www.w3.org/2000/svg','svg');drawing.setAttribute('aria-hidden','true');drawing.style.display='none';drawing.innerHTML='<path d="M0 0 L1 1"/>'.repeat(3200);document.body.prepend(drawing);});
 const fit=await page.evaluate(inspectViewportFit);
 assert.deepEqual(new Set(fit.failures.map(row=>row.root)),new Set(['#bad','#masked','#occluded']));
 assert.ok(fit.failures.find(row=>row.root==='#bad').clipped.some(row=>row.element==='button'&&row.clippedBelow>0));
 assert.equal(fit.failures.find(row=>row.root==='#occluded').usableTop,64);
 await page.locator('#masked p').evaluate(element=>element.style.opacity='.7');
 await page.setViewportSize({width:1200,height:900});const tall=await page.evaluate(inspectViewportFit);
 assert.ok(!tall.failures.some(row=>row.root==='#bad'));assert.ok(tall.failures.some(row=>row.root==='#masked'));
});

test('real preview and motion frames expose vertical failures even when legacy horizontal checks pass', {timeout:45000},async t=>{
 const root=temporary(t),url=await serve(t);
 const result=await previewWebsite({url,viewports:[{width:1200,height:500}],taskId:'fit',requestId:'frames',signal:AbortSignal.timeout(40000),imageStore:createImageStore({getPath:()=>root}),motion:{section:'#runway',observe_selectors:['#bad button'],settle_ms:50,checkpoints:[{progress:0},{progress:.4},{progress:0}]}});
 const view=result.views[0];assert.equal(view.metrics.horizontalOverflow,false);assert.deepEqual(view.metrics.viewportClippedContent,[]);
 assert.ok(view.metrics.viewportFit.failures.length);assert.ok(viewportFitFailures(view).some(row=>row.state!=='viewport'));
 assert.ok(view.motion.frames.every(frame=>frame.observations.targets[0].elements[0].visible&&!frame.observations.targets[0].elements[0].fullyVisible));
});

test('design review rejects frame-only locked clipping before a critic call',async()=>{
 const design=createDesignReview({enabled:true,brief:'Improve this existing website',profile:'medium',mode:'balanced',acceptsImages:true,signal:new AbortController().signal,taskId:'fit',requestId:'r',evidence:{record:()=>({id:'fit'})},emit:()=>{},review:async()=>assert.fail('Repair recorded clipping before visual review')});
 design.capture({views:[{label:'desktop',image:{file:'fixture'},metrics:{viewportFit:{failures:[]}},motion:{frames:[{label:'middle',observations:{viewportFit:{failures:[{root:'#story',clipped:[{element:'button',clippedBelow:70}]}]}}}]}}]}, {},'source');
 assert.match((await design.evaluate('source')).feedback,/locked_content_clipping/);
 assert.equal(design.snapshot().reviews.length,0);
 assert.equal(viewportFitFailures({metrics:{viewportFit:{status:'unavailable',reason:'Inspection unavailable'}}})[0].unavailable,true);
});

for(const route of ['native','direct'])test(`${route} execution reports measured vertical clipping as a failed layout check under None`,{timeout:45000},async t=>{
 const root=temporary(t),project=fs.mkdtempSync(path.join(__dirname,'fit-route-'));
 t.after(()=>{assert.equal(path.dirname(project),__dirname);fs.rmSync(project,{recursive:true,force:true});});
 fs.writeFileSync(path.join(project,'index.html'),html);fs.writeFileSync(path.join(project,'package.json'),'{}');const url=await serve(t);
 const args={directory:project,url,viewports:[{width:1200,height:500}]};let requested=false;
 const options=route==='native'?{runNativeSession:async options=>{
  const bridge=await options.visualTools({acceptsImages:true,signal:options.signal});try{
   const response=await(await fetch(bridge.config.url,{method:'POST',headers:{...bridge.config.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'preview_website',arguments:args}})})).json();assert.notEqual(response.result.isError,true);
  }finally{await bridge.close();}return{text:'Inspection complete; no files changed.'};
 }}:{requestModel:async()=>{
   if(requested)return{text:'Inspection complete; no files changed.',calls:[],route:'chat',raw:{content:'Inspection complete; no files changed.'}};
   requested=true;return{text:'',calls:[{id:'fit-preview',name:'preview_website',args}],route:'chat',raw:{content:null,tool_calls:[{id:'fit-preview',type:'function',function:{name:'preview_website',arguments:JSON.stringify(args)}}]}};
 },reviewModel:async()=>({text:'{"status":"approved","reason":"fixture"}',calls:[]})};
 const engine=createAgentEngine({getPath:()=>root},{getKey:()=>route==='direct'?'fixture-key':''},()=>{},null,options);t.after(()=>engine.shutdown());await engine.workspaces.open('fit-route',project,async()=>true);
 const result=await engine.run({taskId:'fit-route',requestId:'r',modelId:route==='native'?'opencode/mimo-v2.6-flash-free':'opencode-go/deepseek-v4-flash-vision-exp',designProfile:'none',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:'Inspect this existing website at a short viewport without changing files.'}]});
 const layout=result.verification.checks.find(check=>check.phase==='layout');assert.equal(layout?.status,'failed');assert.equal(result.verification.designReview.status,'not_needed');
});
