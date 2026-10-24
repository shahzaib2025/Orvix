const fs=require('node:fs'),path=require('node:path');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const desktop=path.resolve(process.argv[2]),project=path.join(desktop,'MAX');
const root=fs.mkdtempSync(path.resolve(__dirname,'..','scratch','comparison-max-repair-'));
fs.copyFileSync(path.join(project,'index.html'),path.join(root,'initial-index.html'));
fs.copyFileSync(path.join(project,'inspection.json'),path.join(root,'initial-inspection.json'));
for(const name of fs.readdirSync(path.join(project,'screenshots'))) if(name.endsWith('.jpg')) fs.copyFileSync(path.join(project,'screenshots',name),path.join(project,'screenshots','initial-'+name));
const runtime=createOpenCodeHeadless(path.join(root,'runtime'));
const result={root,project,model:'opencode/muse-spark-1.3-contributor-free',variant:'xhigh',status:'starting',events:[]};
const save=()=>fs.writeFileSync(path.join(project,'repair.json'),JSON.stringify(result,null,2));
let engine,timer;const start=Date.now();
(async()=>{
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const c=await refreshOpenCodeCatalog(true,AbortSignal.timeout(30000));
 const m=c.models.find(x=>x.id===result.model);
 if(c.error||c.stale||!m?.variants.includes('xhigh'))throw Error(c.error||'Exact Muse xhigh model unavailable');
 engine=createAgentEngine({getPath:()=>path.join(root,'engine'),getVersion:()=> 'comparison-repair'},{getKey:()=>''},e=>{
  if(e.type==='tool'||e.type==='activity'){result.events.push({atMs:Date.now()-start,type:e.type,name:e.name,phase:e.phase,failed:e.failed,message:e.message,output:e.output?.slice(0,1600)});save();if(e.phase==='completed'||e.type==='activity')console.log(Math.round((Date.now()-start)/1000)+'s '+(e.name??e.message));}
  if(e.type==='approval')engine.decide(e.approvalId,false);
  if(e.type==='question')engine.cancel('repair-max');
 });
 await engine.workspaces.open('repair-max',project,async()=>true);
 const prompt=`Repair concrete defects in the existing EMBERLINE MAX website in ${project}; preserve its art direction and content, package and server. Do not regenerate the site.
 Independent browser evidence at 390x844 shows right-side clipping: the mobile Menu button is cut off and hero copy/labels run past the visible viewport, even though overflow-hidden masks the overflow metric. Recompose those elements so navigation, labels and copy fit with readable side gutters.
 The desktop #daylight scene fails to hold its #stage lamp: native scrolling from scene entry to middle produces #stage.top=-698px and at the last chapter -1600px; the lamp disappears while captions change. Repair the sticky containment/overflow layout so the lamp remains visibly held during the chapter sequence, releases correctly, and reverses coherently. Keep a readable mobile and reduced-motion alternative with all content.
 Use existing managed preview tools for the corrected desktop/mobile and one bounded real motion sample. Workflow assertion syntax is {"action":"assert","assertion":{"kind":"visible","selector":"#stage"}}; kind is inside assertion, never on the workflow step. For motion use {"motion":{"section":"#daylight","observe_selectors":["#stage","#stageLabel",".chapter"],"checkpoints":[{"progress":0,"label":"entry"},{"progress":0.45,"label":"middle"},{"progress":0.9,"label":"last"},{"progress":1.1,"label":"release"},{"progress":0,"label":"reverse"}]}}. Captures are returned as visual evidence; do not try reading agent screenshot paths outside this workspace using read_visual_asset. Address these failures in a coherent batch without a general redesign or optional polish. Report observed limitations honestly.`;
 result.prompt=prompt;result.status='repairing';save();timer=setTimeout(()=>engine.cancel('repair-max'),600000);
 const reply=await engine.run({taskId:'repair-max',requestId:'repair',modelId:m.id,thinkingVariant:'xhigh',designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
 result.status='agent_completed';result.text=reply.text;result.usage=reply.usage;result.verification=reply.verification;
})().catch(e=>{result.status='failed';result.error=e.message;console.error(e.message);process.exitCode=1}).finally(async()=>{clearTimeout(timer);engine?.shutdown();await runtime.shutdown();result.durationMs=Date.now()-start;save();console.log(JSON.stringify({status:result.status,durationMs:result.durationMs}));});
