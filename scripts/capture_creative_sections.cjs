const fs=require('node:fs'),path=require('node:path');
const {previewWebsite,createPreviewSession}=require('../electron/agent/preview-website.cjs');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const project=path.resolve(process.argv[2]),url=process.argv[3],root=fs.mkdtempSync(path.resolve(__dirname,'../scratch/creative-sections-'));
const signal=AbortSignal.timeout(90000),session=createPreviewSession(signal),store=createImageStore({getPath:()=>root});
(async()=>{
 fs.mkdirSync(path.join(project,'screenshots'),{recursive:true});
 for(const name of ['rooms','inside','finder']){
  const r=await previewWebsite({url,selector:'#'+name,taskId:'creative-sections',requestId:name,signal,browserSession:session,imageStore:store,viewports:[{width:1440,height:900}]});
  fs.copyFileSync(r.views[0].image.file,path.join(project,'screenshots','section-'+name+'.jpg'));
  console.log(name+' captured');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>session.stop());
