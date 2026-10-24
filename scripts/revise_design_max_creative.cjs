const fs=require('node:fs'),path=require('node:path');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const desktop=path.resolve(process.argv[2]),source=path.join(desktop,'MAX','After-Fix'),project=path.join(desktop,'MAX','Creative-Revision');
if(fs.existsSync(project))throw Error('Revision directory already exists');
fs.mkdirSync(project);for(const name of fs.readdirSync(source))if(!['generation.json','inspection.json','screenshots'].includes(name))fs.cpSync(path.join(source,name),path.join(project,name),{recursive:true});
const root=fs.mkdtempSync(path.resolve(__dirname,'..','scratch','max-creative-'));
const prompt=`Continue the existing EMBERLINE lighting studio website in ${project}. The user wants three or four NEW creative attention-hook sections: the page should feel like a crafted premium experience with meaningful discovery throughout, beyond its existing pinned Three Forms scene. Their quality reference is https://www.shopify.com/editions/winter2026 . I inspected the reference: its opening uses an immersive illustrated world with foreground subjects and a compact central navigation composition; selecting a chapter changes its presentation through a textured transition. Use its ambition in art direction, depth, scale and chapter identity as inspiration. Do not copy its Renaissance artwork, branding, layout, assets or section order.
Invent THREE OR FOUR distinct new sections for EMBERLINE yourself, grounded in sculptural lighting, how it shapes space, its materials, or choosing a piece. Each must have useful content, a memorable composition and a different visible interaction or scroll-responsive behavior; repeated fades, matching cards, alternating split layouts and generic SVG pendants alone do not meet this request. Explain the ideas briefly in the existing storyboard, then implement. Keep one pinned scene overall unless a second serves an unmistakably different purpose; no extra pinning merely to lengthen the page. You can recompose supporting areas to connect the new sections naturally, avoiding redundant material or lab content. Use convincing visual material or detailed subject-specific graphics, with honest demo wording and no invented brand claims. Existing find_visual_assets can supply context if useful; attribution and truthful product representation matter.
Preserve the working inquiry, mobile menu, collection interactions, existing stack, package/server and all necessary content. Keep cohesive boundaries, transparent hero navigation and readable mobile/reduced-motion alternatives. Keep natural scrolling and support reverse motion. No new mandatory animation library, endless render loop or smooth-scroll replacement. Use the existing bounded preview inspection, including mobile, primary action, representative new section motion and pinned progression/release/reverse. Correct concrete defects in one batch, without a separate critic or automatic polishing loop. Do not claim Shopify-level visual quality merely because tests pass. Report what you actually saw and material limitations.`;
const result={root,project,source,prompt,model:'opencode/muse-spark-1.3-contributor-free',variant:'xhigh',profile:'max',status:'starting',startedAt:new Date().toISOString(),events:[]};
// Progress is harness data, not website source: keep it outside the inspected workspace.
const save=()=>{const json=JSON.stringify(result,null,2);fs.writeFileSync(path.join(root,'generation.json'),json);if(result.finishedAt)fs.writeFileSync(path.join(project,'generation.json'),json);};save();
const runtime=createOpenCodeHeadless(path.join(root,'runtime'));let engine,timer;const start=Date.now();
const cancel=()=>engine?.cancel('creative-max');process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
(async()=>{
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const c=await refreshOpenCodeCatalog(true,AbortSignal.timeout(30000)),m=c.models.find(x=>x.id===result.model);
 if(c.error||c.stale||!m?.variants.includes('xhigh')||!m.input.includes('image'))throw Error(c.error||'Exact Muse xhigh image-capable model unavailable');
 engine=createAgentEngine({getPath:()=>path.join(root,'engine'),getVersion:()=> 'creative-revision'},{getKey:()=>''},e=>{
  if(e.type==='tool'||e.type==='activity'){const event={atMs:Date.now()-start,type:e.type,name:e.name,phase:e.phase,failed:e.failed,message:e.message,output:e.output?.slice(0,1600)};result.events.push(event);save();if(e.phase==='completed'||e.type==='activity')console.log(Math.round(event.atMs/1000)+'s '+(e.name??e.message)+(e.failed?' FAILED':''));}
  if(e.type==='approval')engine.decide(e.approvalId,false);
  if(e.type==='question'){result.question=e.question;cancel();}
 });
 await engine.workspaces.open('creative-max',project,async()=>true);result.status='building';save();timer=setTimeout(cancel,900000);
 const reply=await engine.run({taskId:'creative-max',requestId:'creative-revision',modelId:m.id,thinkingVariant:'xhigh',designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
 result.status='agent_completed';result.text=reply.text;result.usage=reply.usage;result.verification=reply.verification;result.changedFiles=reply.changes.map(x=>x.path);
})().catch(e=>{result.status='failed';result.error=e.message;console.error(e.message);process.exitCode=1}).finally(async()=>{clearTimeout(timer);engine?.shutdown();await runtime.shutdown();result.durationMs=Date.now()-start;result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:result.status,durationMs:result.durationMs,project}));});
