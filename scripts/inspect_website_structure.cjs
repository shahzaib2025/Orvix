const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {previewWebsite,createPreviewSession}=require('../electron/agent/preview-website.cjs');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const {observedComposition}=require('../electron/agent/design-composition.cjs');
const {compositionSignature,signatureSimilarity,sourceEvidence}=require('./website_design_benchmark_helpers.cjs');
async function inspect(root){
  root=path.resolve(root);
  const report=JSON.parse(fs.readFileSync(path.join(root,'results.json'),'utf8'));
  const controller=new AbortController(),browserSession=createPreviewSession(controller.signal);
  const imageStore=createImageStore({getPath:()=>path.join(root,'structure-inspection')});
  const rows=[];
  try {
    for(const run of report.runs){
      const project=fs.realpathSync(run.project),relative=path.relative(fs.realpathSync(root),project);
      if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Project outside benchmark root');
      const server=http.createServer((req,res)=>{
        try {const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(project,'.'+(name==='/'?'/index.html':name));
          if(!file.startsWith(project+path.sep))throw Error('Outside project');
          const body=fs.readFileSync(file),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
          res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);
        }catch{res.writeHead(404);res.end('Not found');}
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      try {
        const capture=await previewWebsite({url:'http://127.0.0.1:'+server.address().port,taskId:run.id,requestId:'structure-audit',full_page:true,viewports:[{width:1440,height:900}],signal:AbortSignal.timeout(60000),imageStore,browserSession});
        const source=sourceEvidence(project),fingerprint=crypto.createHash('sha256').update(JSON.stringify(source.sourceHashes)).digest('hex');
        const memoryFile=path.join(root,report.history==='shared'?'engine':run.id+'/engine','agent-memory',run.id+'.json');
        const brief=fs.existsSync(memoryFile)?JSON.parse(fs.readFileSync(memoryFile,'utf8')).designReview?.brief:null;
        rows.push({id:run.id,profile:run.profile,brief,sourceHashes:source.sourceHashes,observedComposition:observedComposition(capture.views,fingerprint),signature:compositionSignature(capture.views[0]),images:capture.views.map(view=>view.image.file)});
        console.log('Captured '+run.id);
      }finally{await new Promise(resolve=>server.close(resolve));}
    }
  }finally{await browserSession.stop();}
  const pairs=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)pairs.push({left:rows[i].id,right:rows[j].id,similarity:signatureSimilarity(rows[i].signature,rows[j].signature)});
  const result={capturedAt:new Date().toISOString(),runs:rows,pairs};
  fs.writeFileSync(path.join(root,'structure-audit.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(pairs));return result;
}
if(require.main===module){const base=path.resolve(__dirname,'..','scratch','website-design-benchmark');inspect(process.argv[2]||fs.readFileSync(path.join(base,'latest.txt'),'utf8').trim()).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={inspect};
