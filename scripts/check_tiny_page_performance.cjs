const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright-core');
const root=path.resolve(__dirname,'..');
async function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-page-perf-'));
  let desktop;
  try{
    const env={...process.env,ORVIX_TINY_UI_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'check_tiny_agents_ui.cjs')],env,timeout:30000});
    const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('button',{name:'Tiny Agents',exact:true}).click();await page.getByRole('region',{name:'Agent Workshop',exact:true}).waitFor();
    await page.locator('#startup-splash').waitFor({state:'detached'});
    await desktop.evaluate(({BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows()[0],base=global.tinyFixture.workflows.list().sequence;
      const condition={op:'predicate',signal:'always',comparator:'eq',value:true};
      const steps=Array.from({length:40},(_,index)=>({id:'check-'+index,title:'Observed result '+index,type:'verify',input:{kind:'condition',condition}}));
      const definition={id:'page-performance',revision:1,approved:true,enabled:false,name:'Page performance fixture',goal:'Inspect synthetic local outputs',mode:'Review',execution:{mode:'single',maxRuns:1},schedule:{mode:'always',timezone:'UTC'},steps,scope:{paths:[],apps:[],domains:[]},models:{},acceptance:steps.map(step=>({stepId:step.id,text:'Observed'}))};
      const outputs=Object.fromEntries(steps.map((step,index)=>[step.id,{status:'verified',verified:true,text:('Result '+index+'\n').repeat(600),artifact:{path:'fixture-'+index+'.txt',content:'Synthetic report line.\n'.repeat(1300),hash:'fixture'}}]));
      const run={id:'page-performance-run',definitionId:definition.id,revision:1,status:'running',reason:'Synthetic progress fixture',createdAt:Date.now(),updatedAt:Date.now(),steps:Object.fromEntries(steps.map(step=>[step.id,{...step,status:'done'}])),outputs,questions:[],evidence:[]};
      window.webContents.send('orvix:tiny-workflow-event',{sequence:base+1,kind:'definition_drafted',patch:{definition}});
      window.webContents.send('orvix:tiny-workflow-event',{sequence:base+2,kind:'run_started',runId:run.id,patch:{run}});
      global.tinyFixture.perf={base:base+2,run,definition};
    });
    const workshop=page.getByRole('region',{name:'Agent Workshop',exact:true});
    await workshop.getByRole('button',{name:'Page performance fixture',exact:false}).click();
    await workshop.getByRole('region',{name:'Live workflow work'}).waitFor();
    const client=await page.context().newCDPSession(page);await client.send('Performance.enable');
    const metrics=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(value=>[value.name,value.value]));
    const before=await metrics();
    await page.evaluate(()=>{window.tinyFrames=[];window.tinyLongTasks=[];let previous=performance.now();window.tinyFrame=()=>{const now=performance.now();window.tinyFrames.push(now-previous);previous=now;window.tinyFrameId=requestAnimationFrame(window.tinyFrame);};window.tinyFrameId=requestAnimationFrame(window.tinyFrame);window.tinyObserver=new PerformanceObserver(list=>window.tinyLongTasks.push(...list.getEntries().map(entry=>entry.duration)));window.tinyObserver.observe({type:'longtask',buffered:false});});
    await desktop.evaluate(({BrowserWindow},compact)=>new Promise(resolve=>{
      const window=BrowserWindow.getAllWindows()[0],fixture=global.tinyFixture.perf;let count=0;
      const timer=setInterval(()=>{count++;fixture.run.updatedAt=Date.now();fixture.run.reason='Synthetic progress '+count;const {id,revision,status,reason,updatedAt,questions}=fixture.run;window.webContents.send('orvix:tiny-workflow-event',{sequence:fixture.base+count,kind:'worker_progress',runId:fixture.run.id,patch:compact?{runUpdate:{id,revision,status,reason,updatedAt,questions}}:{run:fixture.run}});if(count===40){clearInterval(timer);resolve();}},50);
    }),!process.argv.includes('--baseline'));
    await page.waitForFunction(()=>document.querySelector('.wf-run-status span')?.textContent==='Synthetic progress 40');
    const after=await metrics();
    const result=await page.evaluate(()=>{cancelAnimationFrame(window.tinyFrameId);window.tinyObserver.disconnect();const sorted=window.tinyFrames.sort((a,b)=>a-b);return {frames:sorted.length,frameP95Ms:sorted[Math.floor(sorted.length*.95)],maxFrameMs:sorted.at(-1),longTasks:window.tinyLongTasks,collapsedPreCharacters:[...document.querySelectorAll('.wf-workshop details:not([open]) pre')].reduce((total,node)=>total+node.textContent.length,0),domNodes:document.querySelectorAll('.tiny-page *').length};});
    for(const field of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount'])result[field]=after[field]-before[field];
    const started=performance.now();await workshop.getByRole('button',{name:'New workflow',exact:true}).click();await page.getByRole('dialog',{name:'Build workflow'}).waitFor();result.openBuilderMs=performance.now()-started;
    await page.getByRole('button',{name:'Close workflow builder'}).click();
    if(!process.argv.includes('--baseline')){
      assert.equal(result.collapsedPreCharacters,0,'closed result/configuration panels must not render expensive content');
      const output=workshop.locator('details').filter({has:page.getByText('Observed result 0 · Observed verification',{exact:true})}).first();
      await output.locator('summary').first().click();await output.locator('pre').first().waitFor();assert.ok((await output.textContent()).includes('Synthetic report line.'));
      await output.locator('summary').first().click();assert.equal(await output.locator('pre').count(),0,'closing a result releases its heavy subtree');
    }
    assert.deepEqual(errors,[]);
    const file=path.join(root,'scratch',process.argv.includes('--baseline')?'tiny-page-performance-before.json':'tiny-page-performance-after.json');fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({file,...result},null,2));
  }finally{await desktop?.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('orvix-page-perf-'));fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
