const {_electron}=require('playwright-core');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const report={scope:'Current source Electron main/preload and production renderer; typed command and real selected-display capture; no physical microphone/speaker check; no frames saved',checks:{}};
const reportFile=path.join(root,'scratch/screen-command-desktop.report.json');
(async()=>{
 let desktop;
 try{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  desktop=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'screen_command_validation_bootstrap.cjs')],env,timeout:60000});
  await desktop.evaluate(({app})=>{if(!app.getPath('userData').endsWith('screen-command-validation-user-data'))throw Error('Validation must use isolated data.');});
  let page;
  for(let attempt=0;attempt<100&&!page;attempt++){page=desktop.windows().find(p=>p.url().endsWith('/index.html'));if(!page)await new Promise(r=>setTimeout(r,200));}
  assert.ok(page,'Main renderer not found');
  await page.waitForSelector('.home-prompt-input',{timeout:30000});
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));main.webContents.setAudioMuted(true);main.show();main.focus();});
  await page.locator('.home-prompt-input').fill('Screen sharing turn kar do.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForSelector('.screen-picker',{timeout:10000});report.checks.exactPhraseOpensPicker=true;
  await page.locator('.screen-source:has(svg.lucide-monitor)').first().click();
  await page.waitForFunction(()=>document.querySelector('.screen-sharing-status')||document.querySelector('.screen-picker-error')||document.querySelector('.simple-voice-status.is-error'),null,{timeout:60000});
  const errors=await page.locator('.screen-picker-error,.simple-voice-status.is-error').allTextContents();assert.deepEqual(errors,[]);
  await page.waitForSelector('#root .screen-frame-preview img',{timeout:15000});
  report.checks.sharingActive=await page.locator('.simple-screen-button').first().getAttribute('aria-pressed')==='true';assert.equal(report.checks.sharingActive,true);
  report.checks.previewCaption=await page.locator('#root .screen-frame-preview figcaption').innerText();assert.match(report.checks.previewCaption,/Live/);
  await page.locator('.home-prompt-input').fill('screen sharing turn off kar do');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForSelector('#root .screen-frame-preview',{state:'detached',timeout:10000});
  report.checks.offCommandStopsCapture=await page.locator('.simple-screen-button').first().getAttribute('aria-pressed')==='false';assert.equal(report.checks.offCommandStopsCapture,true);
  report.passed=true;
 }catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
 finally{
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(desktop&&desktop.process().exitCode===null){try{require('node:child_process').execFileSync('taskkill',['/PID',String(desktop.process().pid),'/T','/F'],{stdio:'ignore'});}catch{desktop.process().kill();}}
 }
})();
