const fs=require('node:fs'),path=require('node:path');
const {app,safeStorage}=require('electron');
// Use the same Chromium encryption context as the app whose keys are loaded.
app.setPath('userData',path.join(process.env.APPDATA,'Orvix'));
const {createSearchKeyStore}=require('../electron/search-key-store.cjs');
const {configureSearchKeys}=require('../electron/serper-search.cjs');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const root=fs.mkdtempSync(path.resolve(__dirname,'../scratch/max-white-'));
// Electron may outlive its launching shell. Keep logs in a file instead of writing to closed pipes.
require('./file-console.cjs').installFileConsole(path.join(root,'runner.log'));
const project=path.join(process.env.USERPROFILE,'Desktop',process.env.ORVIX_SHOWCASE_FOLDER||'Orvix-MAX-White-Showcase');
if(fs.existsSync(project))throw Error('Refusing to overwrite an existing showcase.');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'emberline-white-showcase',private:true,scripts:{start:'node server.cjs'}}));
fs.writeFileSync(path.join(project,'server.cjs'),`const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer((q,r)=>{let file;try{file=path.resolve(root,'.'+decodeURIComponent(new URL(q.url,'http://localhost').pathname));}catch{r.writeHead(400);return r.end();}if(file!==root&&!file.startsWith(root+path.sep)){r.writeHead(403);return r.end();}try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');const body=fs.readFileSync(file);r.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});r.end(body);}catch{r.writeHead(404);r.end('Not found');}});
server.listen(0,'127.0.0.1',()=>console.log('PREVIEW_URL=http://127.0.0.1:'+server.address().port));`);
fs.writeFileSync(path.join(project,'index.html'),'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main></main></body></html>');
const prompt=`Build a fresh professional white-theme EMBERLINE lighting studio showcase in ${project}. This is an explicitly fictional demonstration: show lighting in beautiful spaces without invented customers, awards or statistics. The primary action is an accessible inquiry form with honest local-only confirmation. Use https://antigravity.google/ and https://videinfra.com/ as quality references for clean typography, media scale, composition and connected page rhythm; invent this site's own visual identity and structure.
The user rejected the earlier dull CSS/SVG shape-based product artwork. Choose convincing real photographs through find_visual_assets provider google, inspect original sources, retain required credits, and do not generate images or silently switch providers. Embed direct HTTPS image URLs: this is explicitly URL-only, so do not download image files into this project. Represent sourced lighting/interior photos honestly as inspiration imagery, not actual fictional products. If Google is unavailable report it clearly; only another genuinely available Google search route may satisfy the requested source, not an unverified substitute search engine. Never fabricate successful searches. Use suitable images prominently, not tiny pictures in repeated panels, and verify they load in the actual browser.
Design a substantial content-led page as one continuous layered journey. Invent several distinct useful attention moments, and intentional handoffs at every section boundary. Coordinate background, imagery, text and foreground through reveals, depth, image-scale/crop changes or subject-specific transitions. Some sections should remain calm. Normally one pinned scene; do not pin each section or stretch empty scroll runways. Avoid repeated cards, brown/amber/italic-serif luxury defaults and generic shape illustrations. No fixed section recipe. Let photographs inform the composition early. Preserve natural scrolling and reverse movement, readable mobile navigation, usable reduced motion and visible content if animations fail. Transparent hero navigation should gain a readable surface when needed after scrolling.
Use the supplied small static HTML/CSS/JS stack and server. Do not edit the server unless necessary. Optional dependencies only if the chosen interaction requires them; no mandatory smooth-scroll or WebGL. Record section purpose, composition, motion and neighbor handoffs briefly in the existing storyboard. Use the existing bounded preview inspection for desktop/mobile, primary action, representative boundaries and pinned entry/progression/release/reverse. Correct concrete defects in one batch. Report observed visual weaknesses honestly and separate them from code checks. Deliver all website files here.`;
const report={project,root,prompt,model:'opencode/muse-spark-1.3-contributor-free',variant:'xhigh',status:'starting',startedAt:new Date().toISOString(),events:[]};
const save=()=>{const json=JSON.stringify(report,null,2);fs.writeFileSync(path.join(root,'result.json'),json);if(report.finishedAt)fs.writeFileSync(path.join(project,'generation.json'),json);};
const runtime=createOpenCodeHeadless(path.join(root,'runtime'));let engine,timer;const start=Date.now();save();
app.whenReady().then(async()=>{
 const store=createSearchKeyStore(app,safeStorage);
 configureSearchKeys(store);report.google={configured:store.snapshot().keys.some(k=>k.status==='ready'),storageError:store.snapshot().storageError};save();
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(90000)),model=catalog.models.find(m=>m.id===report.model);
 if(catalog.error||catalog.stale||!model?.variants.includes('xhigh'))throw Error(catalog.error||'Muse Spark 1.3 xhigh unavailable');
 engine=createAgentEngine({getPath:()=>path.join(root,'engine'),getVersion:()=> 'white-showcase'},{getKey:()=>''},e=>{
  if(e.type==='tool'||e.type==='activity'){const item={atMs:Date.now()-start,type:e.type,name:e.name,phase:e.phase,failed:e.failed,message:e.message,output:e.output?.slice(0,1200)};report.events.push(item);save();if(e.phase==='completed'||e.type==='activity')console.log(Math.round(item.atMs/1000)+'s '+(e.name||e.message)+(e.failed?' FAILED':''));}
  if(e.type==='approval')engine.decide(e.approvalId,false);
  if(e.type==='question'){report.question=e.question;engine.cancel('white-max');}
 });
 await engine.workspaces.open('white-max',project,async()=>true);report.status='building';save();timer=setTimeout(()=>engine.cancel('white-max'),900000);
 const reply=await engine.run({taskId:'white-max',requestId:'showcase',modelId:model.id,thinkingVariant:'xhigh',designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
 report.status='agent_completed';report.text=reply.text;report.verification=reply.verification;report.usage=reply.usage;
}).catch(e=>{report.status='failed';report.error=e.message;console.error(e.message);process.exitCode=1;}).finally(async()=>{clearTimeout(timer);engine?.shutdown();await runtime.shutdown();report.durationMs=Date.now()-start;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,project,durationMs:report.durationMs}));app.exit(report.status==='agent_completed'?0:1);});
