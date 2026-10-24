// Bounded final inspection using Orvix's existing preview and motion capture tools.
const fs=require('node:fs'),path=require('node:path');
const {createStaticPreview}=require('../electron/agent/static-preview.cjs');
const {previewWebsite,createPreviewSession}=require('../electron/agent/preview-website.cjs');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const project=path.resolve(process.argv[2]), kind=process.argv[3];
const output=path.join(project,'final-inspection');fs.mkdirSync(output,{recursive:true});
const signal=AbortSignal.timeout(180000),session=createPreviewSession(signal);
const server=createStaticPreview(project);let report=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={url:`http://127.0.0.1:${server.address().port}/`,taskId:'max-final-'+kind,signal,browserSession:session,imageStore:createImageStore({getPath:()=>path.resolve('scratch/max-motion-final-inspection')})};
 const motion={section:kind==='fieldwork'?'#process':'#plate-08',input:'position',settle_ms:500,
  observe_selectors:kind==='fieldwork'?['.process__copy .pc h3','.process__media .pm.is-on img','.process__rail .rail[aria-selected="true"]']:['#flux','.charge__stage.is-active','[data-charge-pct]'],
  checkpoints:[{label:'entry',progress:0},{label:'progression-1',progress:.35},{label:'progression-2',progress:.7},{label:'end',progress:1},{label:'release',progress:1.1},{label:'reverse',progress:.35}]};
 const visitWorkflow=[{action:'fill',selector:'#f-name',value:'Acceptance Test'},{action:'fill',selector:'#f-email',value:'acceptance@example.com'},{action:'fill',selector:'#f-date',value:'2026-10-17'},{action:'select',selector:'#f-party',value:'2'},{action:'fill',selector:'#f-notes',value:'Step-free route, please.'},{action:'click',selector:'#visitForm button[type="submit"]'},{action:'assert',assertion:{kind:'text',selector:'#formStatus',expected:'Plan saved on this device.',contains:true}},{action:'assert',assertion:{kind:'visible',selector:'#planSaved'}}];
 const planned=kind==='fieldwork'?[{label:'hero-and-pin',selector:'.hero',motion},{label:'planting',selector:'#planting'},{label:'engagement',selector:'#engage'},{label:'reduced',selector:'#process',reduced_motion:true}]:[{label:'hero-and-pin',selector:'#plate-01',motion},{label:'supporting',selector:'#plate-09'},{label:'visit-action',selector:'#plate-19',workflow:visitWorkflow},{label:'reduced',selector:'#plate-08',reduced_motion:true}];
 const calls=process.argv[4]?planned.filter(call=>call.label===process.argv[4]):planned;
 if(process.argv[4]&&fs.existsSync(path.join(output,'inspection.json')))report=JSON.parse(fs.readFileSync(path.join(output,'inspection.json'),'utf8')).filter(item=>item.label!==process.argv[4]);
 for(const call of calls){
  const {label,...capture}=call;
  const result=await previewWebsite({...options,...capture,requestId:label});
  for(const view of result.views){
   fs.copyFileSync(view.image.file,path.join(output,label+'-'+view.label+'.jpg'));
   for(const [i,frame]of(view.motion?.frames??[]).entries())fs.copyFileSync(frame.image.file,path.join(output,label+'-'+view.label+'-motion-'+(i+1)+'.jpg'));
  }
  report.push({label,result});fs.writeFileSync(path.join(output,'inspection.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({label,views:result.views.map(v=>({label:v.label,overflow:v.metrics.horizontalOverflow,broken:v.metrics.brokenImages,pending:v.metrics.pendingImages,errors:v.errors,violations:v.accessibility.violations.map(x=>x.id),motion:v.motion?.frames.map(f=>({label:f.label,scrollY:f.observations.scrollY,targets:f.observations.targets.map(t=>({selector:t.selector,elements:t.elements.map(e=>({text:e.text,visible:e.visible,transform:e.transform,opacity:e.opacity}))}))}))}))}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await session.stop();server.close();});
