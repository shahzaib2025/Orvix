const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const project=path.resolve(process.argv[2]),url=process.argv[3];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const records=[];
 try{
  for(const [label,target]of [['file','file:///'+path.join(project,'index.html').replace(/\\/g,'/')],['http',url]]){
   const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],consoleErrors=[],failedRequests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
   await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(1600);
   const runtime=await page.evaluate(()=>({gsap:!!window.gsap,scrollTriggers:window.ScrollTrigger?.getAll().length??0,lenisDocument:document.documentElement.classList.contains('lenis'),canvas:document.querySelector('#flux')?{width:document.querySelector('#flux').width,height:document.querySelector('#flux').height}:null}));
   records.push({label,target,errors,consoleErrors,failedRequests,runtime});await page.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(project,'launch-inspection.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records));
 if(records[1].errors.length||records[1].consoleErrors.length||records[1].failedRequests.some(r=>r.url.endsWith('/js/main.js'))||records[1].runtime.scrollTriggers===0)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
