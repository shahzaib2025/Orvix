const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const project=path.resolve(process.argv[2]);
const url=process.argv[3]||'http://127.0.0.1:2187/02-Twenty-Sections-3D/';
const report=[];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  for(const [label,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
   const page=await browser.newPage({viewport:{width,height}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.ScrollTrigger&&window.__kineticLenis);
   await page.waitForTimeout(1400);
   const snapshots=[];
   const inspect=async(stage,selector)=>{
    const data=await page.evaluate(selector=>Array.from(document.querySelectorAll(selector)).map(el=>{
     const cs=getComputedStyle(el),r=el.getBoundingClientRect();
     let opacity=1;for(let p=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
     return {text:el.innerText?.slice(0,65),opacity:cs.opacity,effectiveOpacity:opacity,visibility:cs.visibility,top:r.top,bottom:r.bottom,
      tweens:window.gsap.getTweensOf(el).map(t=>({from:!!t.vars.runBackwards,progress:t.progress(),opacity:t.vars.opacity,st:!!t.scrollTrigger}))};
    }),selector);
    snapshots.push({stage,selector,elements:data});
   };
   for(const selector of ['.premises li','.thesis__list article','.cascade__item','.chrono__list li','.card--programme','.visiting__grid article','.making__grid .card','.credits__grid article']){
    const target=await page.locator(selector).first().evaluate(el=>el.getBoundingClientRect().top+scrollY);
    await page.evaluate(y=>window.__kineticLenis.scrollTo(y,{immediate:true}),Math.max(0,target-height*.25));
    await page.waitForTimeout(1800);
    await inspect('entered',selector);
    await page.evaluate(()=>window.ScrollTrigger.refresh());await page.waitForTimeout(150);
    await inspect('refreshed',selector);
    await page.evaluate(()=>window.__kineticLenis.scrollTo(0,{immediate:true}));await page.waitForTimeout(100);
    await page.evaluate(y=>window.__kineticLenis.scrollTo(y,{immediate:true}),Math.max(0,target-height*.25));await page.waitForTimeout(400);
    await inspect('revisited',selector);
    if(selector==='.premises li'||selector==='.chrono__list li')await page.screenshot({path:path.join(project,'final-inspection',`visibility-${process.env.KINETIC_CHECK_LABEL||'before'}-${label}-${selector.includes('chrono')?'timeline':'cards'}.jpg`)});
   }
   // Exercise continuous traversal rather than judging only first items in groups.
   const content='[data-reveal], .archive__fig, .rail__card, .charge__topbar, .form, .foot__inner';
   const bottom=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
   for(let y=0;y<bottom;y+=height*.6){
    await page.evaluate(y=>window.__kineticLenis.scrollTo(y,{immediate:true}),y);await page.waitForTimeout(80);
   }
   await page.evaluate(y=>window.__kineticLenis.scrollTo(y,{immediate:true}),bottom);await page.waitForTimeout(1800);
   await inspect('whole-page-completed',content);
   await page.evaluate(()=>window.ScrollTrigger.refresh());await page.waitForTimeout(150);
   await inspect('whole-page-refreshed',content);
   for(let y=bottom;y>0;y-=height*.9){
    await page.evaluate(y=>window.__kineticLenis.scrollTo(y,{immediate:true}),y);await page.waitForTimeout(50);
   }
   await page.evaluate(()=>window.__kineticLenis.scrollTo(0,{immediate:true}));await page.waitForTimeout(500);
   await inspect('whole-page-reversed',content);
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(500);
   await inspect('reduced-content',content);
   await inspect('reduced-story','.charge__stage');
   report.push({label,errors,snapshots});await page.close();
  }
 }finally{await browser.close();}
 const name=`visibility-${process.env.KINETIC_CHECK_LABEL||'before'}.json`;
 fs.writeFileSync(path.join(project,'final-inspection',name),JSON.stringify(report,null,2));
 const hidden=report.flatMap(v=>v.snapshots.flatMap(s=>s.elements.filter(e=>(s.stage.startsWith('whole-page')||s.stage.startsWith('reduced')||(e.top<(v.label==='desktop'?900:844)*.8&&e.bottom>0))&&(e.effectiveOpacity<.9||e.visibility==='hidden')).map(e=>({viewport:v.label,stage:s.stage,selector:s.selector,text:e.text,opacity:e.effectiveOpacity}))));
 console.log(JSON.stringify({report:name,hidden,errors:report.flatMap(v=>v.errors)}));
 if(hidden.length||report.some(v=>v.errors.length))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
