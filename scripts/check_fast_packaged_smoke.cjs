const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const reportFile=path.join(__dirname,'check_fast_packaged_smoke.report.json');
const report={scope:'Packaged main, preload and renderer in matching Electron runtime; isolated userData; no installer, microphone or audible speaker validation.',status:'running',checks:[]};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
save();
process.once('uncaughtException',error=>{report.status='failed';report.error=error.message;report.finishedAt=new Date().toISOString();save();app.exit(1);});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-packaged-smoke-'));
app.setPath('userData',temp);app.setName('OrvixPackagedSmoke');process.argv.push('--hidden');
const asar=path.join(root,'release-fast-multistep/win-unpacked/resources/app.asar');
const crypto=require('node:crypto');
for(const file of ['electron/fast-ledger.cjs','electron/fast-work.cjs','electron/fast-worker.cjs','electron/main.cjs','electron/preload.cjs','shared/work-tools.json','dist/index.html']) {
 if(!fs.readFileSync(path.join(asar,file)).equals(fs.readFileSync(path.join(root,file))))throw new Error('Packaged content differs: '+file);
 report.checks.push('Packaged bytes match '+file);
}
require(path.join(asar,'electron/main.cjs'));
const timer=setTimeout(()=>finish(new Error('Startup timed out')),45000);
function finish(error){clearTimeout(timer);report.status=error?'failed':'passed';if(error)report.error=error.message;report.finishedAt=new Date().toISOString();save();app.exit(error?1:0);}
app.whenReady().then(async()=>{
 try {
  let window;const deadline=Date.now()+15000;
  while(Date.now()<deadline){window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));if(window&&!window.webContents.isLoading())break;await new Promise(r=>setTimeout(r,100));}
  if(!window)throw new Error('Packaged renderer did not load');
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const b=window.orvixDesktop;
    if(!b||!b.registerFastPlan||!b.reviewFastCompletion||!b.getFastContext)throw new Error('Fast bridge unavailable');
    const t=await b.updateFastTask({text:'Observe one page then observe another',replace:true});
    const p=await b.registerFastPlan(t.id,{revision:t.revision,requirements:[{id:'one',text:'First observation',kind:'outcome'},{id:'two',text:'Second observation',kind:'outcome'}],steps:[{id:'s1',title:'First',tool:'browser_observe',requirementIds:['one'],dependsOn:[],expected:'Observed page'},{id:'s2',title:'Second',tool:'browser_observe',requirementIds:['two'],dependsOn:['s1'],expected:'Observed page'}]});
    const dependency=await b.beginFastEvidence(t.id,'browser_observe',{stepId:'s2',revision:t.revision});
    const review=await b.reviewFastCompletion(t.id,{revision:t.revision,answer:'Both observations have finished and were independently verified.'});
    return {plan:p.status,dependency:dependency.status,falseCompletion:review.completed,context:(await b.getFastContext(t.id)).requirements.length,rendererText:document.body.innerText.length};
  })()`);
  if(result.plan!=='ok'||result.dependency!=='dependency_pending'||result.falseCompletion!==false||result.rendererText<50)throw new Error('Packaged bridge contract failed: '+JSON.stringify(result));
  report.result=result;report.checks.push('Real renderer/preload/IPC plan registration, dependency rejection and false-completion rejection');finish();
 }catch(error){finish(error);}
});
