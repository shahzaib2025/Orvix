// Live comparison only: existing experiment pages are read, never regenerated.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const {captureComposition}=require('../electron/agent/design-composition.cjs');
const {createDesignReview,createUsageLedger}=require('../electron/agent/design-review.cjs');
const {createOpenCodeWorkers}=require('../electron/agent/opencode-workers.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {comparisonInstructions}=require('../electron/agent/design-diversity.cjs');
const stamp=Date.now(),root=path.resolve('scratch/design-guard-off-'+stamp),output=path.join(os.homedir(),'Desktop','Orvix-Design-Guard-Validation-'+stamp);
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(output,{recursive:true});
const report={root,output,modelId:'opencode/mimo-v2.6-flash-free',startedAt:new Date().toISOString(),kind:'Live comparison with visual review off; no new website generation',tests:[]};
const save=()=>{for(const dir of [root,output])fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));};
let pool;
(async()=>{
 const previousRoot=path.resolve('scratch/hero-exploration-1792330409012'),previous=JSON.parse(fs.readFileSync(path.join(previousRoot,'report.json'))),run=previous.runs.find(item=>item.label==='02-Default');
 const memory=JSON.parse(fs.readFileSync(path.join(previousRoot,run.label+'-engine','agent-memory',run.taskId+'.json')));
 const brief=Object.fromEntries(['audience','primary_action','direction','signature','responsive','storyboard'].map(key=>[key,memory.designReview.brief[key]]));
 const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file)),headless:true});
 const views=[];
 try{for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});try{
   await page.goto(pathToFileURL(path.join(run.project,'index.html')).href,{waitUntil:'domcontentloaded'});
   await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,8000))]));await page.waitForTimeout(2000);
   views.push({width:viewport.width,composition:await page.evaluate(captureComposition)});
  }finally{await page.close();}
 }}finally{await browser.close();}
 const prior={taskId:'earlier-observed-default',brief,observedComposition:{version:1,views}};report.reference={brief,observedComposition:prior.observedComposition};save();
 pool=createOpenCodeWorkers(root);configureOpenCodeCatalog(root,pool);configureOpenCodeModel(pool);
 const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));if(catalog.error||catalog.stale)throw Error(catalog.error||'Stale catalog');
 if(!catalog.models.some(model=>model.id===report.modelId))throw Error('Exact model unavailable; no substitution');
 const ledger=createUsageLedger();
 const design=createDesignReview({enabled:true,brief:'Create a new premium website hero',mode:'off',profile:'normal',priorDesigns:[prior],ledger,signal:AbortSignal.timeout(240000),emit:()=>{},
  evidence:{record:(_task,_request,metadata,text)=>{const id='evidence-'+Date.now();fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify({metadata,text},null,2));return{id};}},
  review:async(prompt,images,purpose,options={})=>{
   if(purpose!=='originality'||images.length)throw Error('Unexpected visual critic call');
   return runOpenCodeSession({taskId:'comparison-only',modelId:report.modelId,readOnly:true,analysis:true,signal:options.signal,systemPrompt:comparisonInstructions,timeoutMs:options.timeoutMs??120000,onPermission:async()=>false,parts:[{type:'text',text:prompt}]});
  }});
 const controls=[
  {name:'renamed same expressive layout',expected:'repeated',proposal:{...brief,direction:'The Correspondence Studio. '+brief.direction.replace(/FlorianBD/g,'Correspondence Studio').replace(/ink-blue/gi,'rose')}},
  {name:'different typographic layout control',expected:'distinct',proposal:{audience:brief.audience,primary_action:brief.primary_action,direction:'A full-width monospaced typed message is the dominant hero, with a cobalt caret and a small card edge peeking from the bottom. No right-hand photographic stack. White theme.',signature:'Large typed message with live caret',responsive:'Full-width message, supporting copy, action, bottom card peek',storyboard:'The single hero is an open white field. Small wordmark at top. A large two-line monospaced message spans the upper-middle width, followed below by a narrow supporting paragraph and action. The only card is a small bottom-edge peek; there is no focal right media column. Mobile keeps that message/copy/action/peek order.'}},
 ];
 for(const control of controls){const start=Date.now();const result=await design.setBrief(control.proposal),allowed=design.constructionAllowed();report.tests.push({name:control.name,expected:control.expected,actual:result.originality.status,allowed,passed:result.originality.status===control.expected&&allowed===(control.expected==='distinct'),summary:result.originality.summary,durationMs:Date.now()-start});save();}
 await design.evaluate('no-new-source');report.visualReviewCount=design.snapshot().reviews.length;report.reviewMode=design.snapshot().mode;report.usageStages=ledger.snapshot();
})().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(()=>{pool?.shutdown();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({root,output,tests:report.tests,visualReviewCount:report.visualReviewCount,error:report.error},null,2));});
