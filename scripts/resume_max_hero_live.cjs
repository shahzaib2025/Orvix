// Continue the unfinished, authorized OPTIC sample through Orvix's production engine.
const fs=require('node:fs'),path=require('node:path');
const {app,safeStorage}=require('electron');
app.setPath('userData',path.join(process.env.APPDATA,'Orvix'));
const {installFileConsole}=require('./file-console.cjs');
const {createSearchKeyStore}=require('../electron/search-key-store.cjs');
const {configureSearchKeys}=require('../electron/serper-search.cjs');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const file=path.resolve(process.argv[2]),report=JSON.parse(fs.readFileSync(file,'utf8'));
const clarity=process.argv.includes('--clarity');
const run=report.runs.find(item=>item.label==='02-OPTIC-3D-Hero');
installFileConsole(path.join(report.stateRoot,'resume-runner.log'));
const eligible=run&&fs.existsSync(path.join(run.project,'index.html'))&&(run.status==='building'||run.status==='returned'&&(clarity||/action was blocked/i.test(run.result??'')));
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
const started=Date.now();
let engine,runtime,timer;
app.whenReady().then(async()=>{
 if(!eligible)throw Error('Expected the unfinished OPTIC sample; no source or model substitution.');
 run.attempts??=[];
 run.attempts.push({status:run.status,durationMs:run.durationMs,result:run.result,reason:clarity?'One targeted correction from observed headline/fallback weaknesses.':'Verification attempted a protected Temp path; work retained in the approved project.'});
 run.resumedAt=new Date().toISOString();run.status='building';run.events.push({attempt:'resume',atMs:0,type:'activity',message:'Continuing OPTIC with project-local verification files.'});save();
 configureSearchKeys(createSearchKeyStore(app,safeStorage));
 runtime=createOpenCodeHeadless(path.join(run.root,clarity?'clarity-runtime':'resumed-runtime'));
 configureOpenCodeCatalog(run.root,runtime);configureOpenCodeModel(runtime);
 const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(90000));
 const model=catalog.models.find(item=>item.id===run.model);
 if(catalog.error||catalog.stale||!model||run.variant&&!model.variants.includes(run.variant))throw Error('Original model/reasoning unavailable; no substitution.');
 engine=createAgentEngine({getPath:()=>path.join(run.root,'engine'),getVersion:()=> 'max-hero-resume'}, {getKey:()=>''},event=>{
  if(['tool','activity'].includes(event.type)){run.events.push({attempt:'resume',atMs:Date.now()-started,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message});save();}
  if(event.type==='approval')engine.decide(event.approvalId,false);
  if(event.type==='question'){run.question=event.question;engine.cancel(run.taskId);}
 });
 await engine.workspaces.open(run.taskId,run.project,async()=>true);
 timer=setTimeout(()=>engine.cancel(run.taskId),clarity?480000:600000);
 const feedback=clarity?'Make the targeted corrections to this newly created MAX website hero, preserving OPTIC art direction, controls and the camera-optics scene. Observed defects: (1) At desktop width the character-split headline wraps inside the word light and loses readable word spacing. Preserve whole-word wrapping and spaces when animating characters; inspect font-ready desktop/mobile and reduced motion. (2) The page silently catches every createBench error and labels the result WebGL unavailable. Record the original error in the browser console, distinguish WebGL context failure from other JavaScript/asset initialization failures, and repair any actual source defect found without weakening browser security. (3) In the available preview the main subject visual is a static SVG fallback. When motion is enabled, give that existing optical diagram purposeful lightweight ambient light/ray movement after the entrance while stationary, with owned pause/cleanup and a readable static reduced-motion state. Do not claim Three.js motion was observed if only the fallback ran. Exercise the real optical-study button and controls with unique source-backed selectors; preserve their usable fallback behavior. Use only the existing project and bounded preview/targeted correction; no new site, unrelated assets, Temp/AppData writes, settings or polishing loop. This is only one hero, not a full website.': 'Create the remaining implementation of this newly requested single MAX website hero in its existing approved folder. The previous run stopped when a verification script targeted protected Temp/opencode/optic-check.mjs. Keep any generated verification script inside this project, for example scratch/optic-check.mjs; do not write into AppData, Temp or internal runtime directories, and do not weaken permissions. Existing HTML, CSS and JavaScript may already be complete: inspect them first and preserve the chosen OPTIC art direction and camera-optics experience. Correct material defects and finish the primary optical-study preview, responsive and reduced-motion states. Deliver only this hero and its preview, not a full website. Honor the original brief: '+run.brief;
 const result=await engine.run({taskId:run.taskId,requestId:clarity?'hero-clarity-repair':'resume-hero',modelId:run.model,thinkingVariant:run.variant,designProfile:'max',designReviewMode:'fast',specialty:'3d-website',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:feedback+'\nFolder: '+run.project+'. Do not read unrelated generated projects. Use the existing preview budget to observe the actual desktop/mobile page, its primary action and main scene after the entrance while stationary; report only recorded results.'}]});
 run.status='returned';run.result=result.text;run.verification=result.verification;run.usage=result.usage;
}).catch(error=>{if(run){run.status='failed';run.error=error.message;}}).finally(async()=>{
 if(!run){app.exit(1);return;}
 clearTimeout(timer);engine?.shutdown();await runtime?.shutdown();run.resumeDurationMs=Date.now()-started;run.durationMs=run.resumeDurationMs;
 run.durationBasis='Resumed attempt only; the original partial attempt is recorded separately in attempts.';
 run.finishedAt=new Date().toISOString();report.finishedAt=run.finishedAt;save();fs.copyFileSync(file,path.join(report.output,'generation-report.json'));app.exit(run.status==='returned'?0:1);
});
