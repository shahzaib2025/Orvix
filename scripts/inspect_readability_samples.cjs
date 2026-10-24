// Inspect existing experiment pages without changing their sources.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const {inspectReadableContent}=require('../electron/agent/readable-content.cjs');
const root=path.resolve(process.argv[2]),experiment=JSON.parse(fs.readFileSync(path.join(root,'report.json')));
const report={root,startedAt:new Date().toISOString(),views:[]};
(async()=>{
 const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file)),headless:true});
 try{
  for(const run of experiment.runs)for(const [label,viewport,reducedMotion] of [['desktop',{width:1440,height:900},'no-preference'],['mobile',{width:390,height:844},'no-preference'],['reduced',{width:1440,height:900},'reduce']]){
   const context=await browser.newContext({viewport,reducedMotion});
   try{
    const page=await context.newPage();await page.goto(pathToFileURL(path.join(run.project,'index.html')).href,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,8000))]));await page.waitForTimeout(2000);
    const result=await page.evaluate(inspectReadableContent);report.views.push({sample:run.label,view:label,...result});
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync(path.join(root,'readability-validation.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.views.map(view=>({sample:view.sample,view:view.view,failures:view.failures,skipped:view.skipped})),null,2));
})().catch(error=>{report.error=error.message;fs.writeFileSync(path.join(root,'readability-validation.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;});
