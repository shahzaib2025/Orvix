const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel}=require('../electron/agent/opencode-model.cjs');
const {createAgentEngine}=require('../electron/agent/engine.cjs');
const desktop=path.resolve(process.argv[2]),baseline=JSON.parse(fs.readFileSync(path.join(desktop,'comparison.json'))).runs.find(x=>x.profile==='max');
const project=path.join(desktop,'MAX','After-Fix'),root=fs.mkdtempSync(path.resolve(__dirname,'..','scratch','max-same-prompt-'));
if(fs.existsSync(project))throw Error('The fresh rerun directory already exists; refusing to overwrite it.');
fs.mkdirSync(project);
fs.copyFileSync(path.join(baseline.project,'package.json'),path.join(project,'package.json'));
const server=fs.readFileSync(path.join(baseline.project,'server.cjs'),'utf8').replace("r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));","const body=fs.readFileSync(f);r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});r.end(body);").replace("r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));","const body=fs.readFileSync(f);r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});r.end(body);");
fs.writeFileSync(path.join(project,'server.cjs'),server);
fs.writeFileSync(path.join(project,'index.html'),'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>New website</title></head><body><main></main></body></html>');
const prompt=baseline.prompt.replaceAll(baseline.project,project);
const report={root,project,prompt,baselineProject:baseline.project,model:'opencode/muse-spark-1.3-contributor-free',variant:'xhigh',profile:'max',actualDesignProfile:'max',status:'starting',startedAt:new Date().toISOString(),samePromptExceptProjectPath:prompt.replaceAll(project,'<project>')===baseline.prompt.replaceAll(baseline.project,'<project>'),events:[]};
report.sourceHashes=Object.fromEntries(['skills/website_design/SKILL.md','visual-mcp.cjs','visual-images.cjs','visual-asset-search.cjs','preview-website.cjs'].map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../electron/agent',n))).digest('hex')]));
const save=()=>{fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));if(report.finishedAt)fs.writeFileSync(path.join(project,'generation.json'),JSON.stringify(report,null,2));};save();
const runtime=createOpenCodeHeadless(path.join(root,'runtime'));let engine,timer,start;
const stop=()=>engine?.cancel('same-prompt-max');process.on('SIGINT',stop);process.on('SIGTERM',stop);
(async()=>{
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const c=await refreshOpenCodeCatalog(true,AbortSignal.timeout(30000)),m=c.models.find(x=>x.id===report.model);
 if(c.error||c.stale||!m?.variants.includes('xhigh')||!m.input.includes('image'))throw Error(c.error||'Exact Muse xhigh image-capable model unavailable');
 start=Date.now();report.status='building';save();console.log('PROJECT '+project);
 engine=createAgentEngine({getPath:()=>path.join(root,'engine'),getVersion:()=> 'same-prompt-rerun'},{getKey:()=>''},e=>{
  if(e.type==='tool'||e.type==='activity'){const item={atMs:Date.now()-start,type:e.type,name:e.name,phase:e.phase,failed:e.failed,message:e.message,output:e.output?.slice(0,1800)};report.events.push(item);save();if(e.phase==='completed'||e.type==='activity')console.log(Math.round(item.atMs/1000)+'s '+(e.name??e.message)+(e.failed?' FAILED':''));}
  if(e.type==='approval')engine.decide(e.approvalId,false);
  if(e.type==='question'){report.question=e.question;stop();}
 });
 await engine.workspaces.open('same-prompt-max',project,async()=>true);timer=setTimeout(stop,900000);
 const reply=await engine.run({taskId:'same-prompt-max',requestId:'build',modelId:m.id,thinkingVariant:'xhigh',designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
 report.status='agent_completed';report.text=reply.text;report.usage=reply.usage;report.verification=reply.verification;report.changedFiles=reply.changes.map(x=>x.path);
})().catch(e=>{report.status='failed';report.error=e.message;console.error(e.message);process.exitCode=1}).finally(async()=>{clearTimeout(timer);engine?.shutdown();await runtime.shutdown();report.durationMs=start?Date.now()-start:null;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,durationMs:report.durationMs,project}));});
