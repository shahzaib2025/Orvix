// Bounded final inspection through Orvix's existing preview API. No source edits.
const fs = require('node:fs'), path = require('node:path');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const report = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const options = JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const run = report.runs.find(item=>item.label === options.label);
if (!run || run.status === 'building') throw Error('Inspect only a finished sample.');
const output = path.join(run.project,'final-inspection'); fs.mkdirSync(output,{recursive:true});
const server = JSON.parse(fs.readFileSync(path.join(report.output,'preview-url.json'),'utf8'));
const imageStore = createImageStore({getPath:()=>path.join(report.stateRoot,'final-inspection')});
(async()=>{
  for (const reduced of [false,true]) {
    const key = reduced ? 'reduced' : 'normal';
    const result = await previewWebsite({url:server.url + run.label+'/',taskId:run.label,requestId:key,signal:AbortSignal.timeout(55000),imageStore,
      viewports:[{width:1440,height:900},{width:390,height:844}],full_page:false,selector:reduced ? options.reducedSelector : options.selector,
      reduced_motion:reduced,workflow:options.workflow,...(!reduced && options.motion ? {motion:options.motion} : {})});
    fs.writeFileSync(path.join(output,key+'-result.json'),JSON.stringify(result,null,2));
    for(const [index,view] of result.views.entries()) {
      fs.copyFileSync(view.image.file,path.join(output,key+'-'+(index ? 'mobile':'desktop')+'.jpg'));
      console.log(JSON.stringify({label:run.label,key,viewport:view.label,overflow:view.metrics.horizontalOverflow,broken:view.metrics.brokenImages,
        errors:view.errors,violations:view.accessibility.violations.map(x=>({id:x.id,targets:x.targets})),workflow:view.workflow.status,motionFrames:view.motion?.frames?.length}));
    }
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
