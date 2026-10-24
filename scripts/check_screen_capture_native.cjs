const { _electron } = require('playwright-core');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),Module=require('node:module');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..');
const asar=path.join(root,'scratch/screen-sharing-package/win-unpacked/resources/app.asar');
const cases=[
 ['Invoice number','AX-4831'],['Order status','READY'],['Customer code','CV-9206'],['Delivery date','2026-10-19'],
 ['Balance','729.40'],['Quantity','137'],['Postal code','48216'],['Tracking code','ZX-719-B'],
 ['Discount percent','18'],['Account ID','AC-2849'],['Error code','E-5037'],['Build version','4.12.8'],
 ['File name','report_Q7.csv'],['Selected tab','Details'],['Server region','Singapore'],['Zoom percent','125'],
 ['Circle color','red'],['Triangle color','blue'],['January bar value','42'],['February bar value','67'],
];
const fixture=`<html><head><style>body{margin:0;padding:26px;background:#edf1f5;color:#172337;font-family:Arial}h1{font-size:24px;margin:0 0 12px}p{font-size:14px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{background:white;border:1px solid #b8c2ce;border-radius:8px;padding:12px;min-height:40px}label{display:block;font-size:14px;margin-bottom:8px}input,select{font:16px Consolas,monospace;color:#162c47;background:white;border:1px solid #bbc6d4;width:90%;padding:7px}.shape{display:inline-block;vertical-align:middle;margin-right:16px}.bar{height:16px;background:#406bc6;margin-top:8px}</style></head><body><h1>Orvix desktop capture quality dashboard</h1><p>Controlled native UI fixture. Read the selected field exactly; do not infer values.</p><div class="grid">${cases.map(([label,value],i)=>`<div class="card"><label>${label}</label>${i===16?'<svg class="shape" width="38" height="38"><circle cx="19" cy="19" r="18" fill="red"/></svg>':i===17?'<svg class="shape" width="38" height="38"><path d="M19 0L38 38H0Z" fill="blue"/></svg>':i>=18?`<strong style="font:16px Consolas">${value}</strong><div class="bar" style="width:${value}%"></div>`:i===13?`<select><option>${value}</option></select>`:`<input readonly value="${value}">`}</div>`).join('')}</div></body></html>`;
const report={scope:'Packaged Orvix main/preload/renderer under Electron 38; actual Windows whole-display capture of a controlled UI fixture; no physical microphone or speakers',native:{},profiles:[]};
const guardsOnly=process.argv.includes('--guards');
const packagedExecutable=process.argv.includes('--packaged');
const file=path.join(root,process.argv.includes('--ui')?'scratch/screen-capture-ui.report.json':guardsOnly?'scratch/screen-capture-guards.report.json':'scratch/screen-capture-native.report.json');
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
function safeRefusal(answer){return /unreadable|cannot|can\x27t|unable|not visible|not readable|no readable|clearer|(?:please|need|provide|share).{0,40}(?:fresh|view|screen)|স্ক্রিন.{0,25}(?:দেখতে|পড়তে|পড়তে).{0,20}(?:পারছি না|যাচ্ছে না)|অপাঠ্য/i.test(answer)&&!answer.includes('GUARD-8462');}
if(process.argv.includes('--regrade')){
 const recorded=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const profile of recorded.profiles){for(const guard of profile.guards||[])guard.safe=safeRefusal(guard.answer);profile.passed=profile.guards?.length===3&&profile.guards.every(g=>g.safe&&!g.error)&&!profile.error;}
 recorded.gradingNote='Recognize explicit Bangla refusal as well as English; provider answers are unchanged.';
 recorded.passed=recorded.profiles.length===2&&recorded.profiles.every(p=>p.passed)&&!recorded.error;
 fs.writeFileSync(file,JSON.stringify(recorded,null,2));console.log(JSON.stringify({passed:recorded.passed,profiles:recorded.profiles.map(p=>({profile:p.profile,passed:p.passed}))}));process.exit(recorded.passed?0:1);
}
const selectedProfile=process.argv.find(arg=>arg.startsWith('--profile='))?.split('=')[1];
if(selectedProfile&&fs.existsSync(file))report.profiles=JSON.parse(fs.readFileSync(file,'utf8')).profiles.filter(p=>p.profile!==selectedProfile);
const bundle=require('esbuild').buildSync({stdin:{resolveDir:root,loader:'tsx',contents:`
import {LiveScreenCapture} from './src/screenSharing';
import ScreenSharePreview from './src/components/ScreenSharePreview';
import {createRoot} from 'react-dom/client';import React from 'react';
const state:any={frame:null,preview:null,count:0};(window as any).__nativeScreen=state;
state.start=async()=>{
 const bridge=window.orvixDesktop!;const source=(await bridge.listScreenSources()).find(s=>s.kind==='screen')!;
 await bridge.selectScreenSource(source.id);state.lease=await bridge.setPetCaptureExcluded(true);
 const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:5,max:5}},audio:false});
 const div=document.createElement('div');div.id='native-screen-test-preview';document.body.append(div);const view=createRoot(div);state.view=view;
 state.maskEnabled=true;state.capture=new LiveScreenCapture(frame=>{state.frame=frame;state.count++;return true;},()=>{},message=>{state.error=message;},frame=>{state.preview=frame;view.render(<ScreenSharePreview frame={frame} sourceName={source.name}/>);},()=>state.maskEnabled?bridge.getScreenCaptureGuard(state.lease):Promise.resolve({mode:'native',masks:[]}));
 await state.capture.start(stream);
};state.stop=async()=>{state.capture?.stop();state.view?.unmount();document.getElementById('native-screen-test-preview')?.remove();await window.orvixDesktop!.setPetCaptureExcluded(false,state.lease);state.frame=null;state.preview=null;};
`},jsx:'automatic',bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent'}).outputFiles[0].text;
function voiceClass(file,klass){const code=require('esbuild').buildSync({entryPoints:[path.join(root,'src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const m=new Module(__filename,module);m.paths=module.paths;m._compile(code,__filename);return m.exports[klass];}
async function magenta(frame){const img=await loadImage(Buffer.from(frame.jpeg,'base64')),canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,img.width,img.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>190&&pixels[i+1]<90&&pixels[i+2]>190)count++;return count;}
(async()=>{let app,page,voice,frameTimer;
 try{
 require('../electron/live-env.cjs').loadLiveEnv(root);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const isolatedData=path.join(root,'scratch/screen-capture-executable-user-data');
 app=await _electron.launch({executablePath:packagedExecutable?path.join(root,'scratch/screen-sharing-package/win-unpacked/Orvix.exe'):require('electron'),args:packagedExecutable?['--user-data-dir='+isolatedData]:[path.join(__dirname,'screen_capture_validation_bootstrap.cjs'),asar],env,timeout:60000});
 if(packagedExecutable){const actualData=await app.evaluate(({app})=>app.getPath('userData'));assert.equal(path.resolve(actualData),path.resolve(isolatedData),'Packaged executable must use isolated user data');report.scope='Distributed Orvix.exe with isolated user data; actual Windows whole-display capture; typed provider queries and counted PCM; no physical microphone or speakers';}
 console.log('Packaged main loaded');for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().endsWith('/index.html'));if(!page)await new Promise(r=>setTimeout(r,200));}if(!page)throw Error('Packaged main renderer unavailable');await page.waitForSelector('.simple-screen-button',{state:'attached',timeout:30000});
 console.log('Packaged renderer loaded');await page.evaluate(code=>(0,eval)(code),bundle);
 report.native.display=await app.evaluate(async({BrowserWindow,screen},html)=>{
  const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));main.show();
  const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html'));
  if(!pet)throw Error('Pet window unavailable');await pet.webContents.executeJavaScript(`const marker=document.createElement('div');marker.id='capture-validation-marker';marker.style.cssText='position:fixed;inset:0;z-index:9999999;background:#ff00ff !important;pointer-events:none';document.body.append(marker);`);await pet.webContents.executeJavaScript(`document.querySelector('button[aria-label="Let pet rest"]')?.click()`);
  const bounds=screen.getPrimaryDisplay().bounds;
  const fixture=new BrowserWindow({...bounds,frame:false,show:false,alwaysOnTop:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  globalThis.__orvixScreenFixture=fixture;await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));fixture.setTitle('Orvix screen quality fixture');fixture.setAlwaysOnTop(true,'floating');fixture.show();pet.moveTop();
  return bounds;
 },fixture);
 report.native.protectionProbe=await app.evaluate(async({BrowserWindow})=>{const p=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html'));const before=p.isContentProtected();p.setContentProtection(true);await new Promise(r=>setTimeout(r,250));return {platform:process.platform,release:process.getBuiltinModule('os').release(),before,after:p.isContentProtected()};});console.log('Protection probe',JSON.stringify(report.native.protectionProbe));await page.evaluate(()=>window.__nativeScreen.start());
 await page.waitForFunction(()=>window.__nativeScreen.frame,{timeout:10000});
 // Baseline remains local only and is never submitted to a provider.
 await page.evaluate(()=>window.__nativeScreen.maskEnabled=false);
 report.native.petInfo=await app.evaluate(async({BrowserWindow})=>{const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html'));pet.setContentProtection(false);const b=pet.getBounds();pet.setPosition(b.x+1,b.y);await pet.webContents.executeJavaScript(`document.body.style.backgroundColor='#ff00ff'`);return {bounds:pet.getBounds(),visible:pet.isVisible(),background:await pet.webContents.executeJavaScript(`getComputedStyle(document.body).backgroundColor`)};});
 await page.waitForTimeout(2200);let frame=await page.evaluate(()=>window.__nativeScreen.frame);
 report.native.unprotectedMagentaPixels=await magenta(frame);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html')).setContentProtection(true));await page.evaluate(()=>window.__nativeScreen.maskEnabled=true);
 await page.waitForTimeout(2200);frame=await page.evaluate(()=>window.__nativeScreen.frame);
 report.native.protectedMagentaPixels=await magenta(frame);report.native.dimensions=[frame.width,frame.height];report.native.exclusionMode=frame.petExclusion;
 report.native.previewMatches=await page.evaluate(()=>window.__nativeScreen.frame===window.__nativeScreen.preview&&document.querySelector('#native-screen-test-preview img').src.endsWith(window.__nativeScreen.frame.jpeg));
 report.native.petVisible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html')).isVisible());
 console.log('Native probe',JSON.stringify(report.native));save();assert.ok(report.native.unprotectedMagentaPixels>500,'local pet marker was not visible in baseline');assert.ok(report.native.protectedMagentaPixels<20,'pet pixels remained in protected frame');assert.equal(report.native.petVisible,true);assert.equal(report.native.previewMatches,true);assert.ok(frame.width<=2560&&frame.height<=1440);
 console.log('Native capture:',JSON.stringify(report.native));save();
 if(process.argv.includes('--live')||guardsOnly){
 let current,resolveAnswer;
 global.window={setTimeout,clearTimeout,speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken,getPcSnapshot:async()=>null,getFastSettings:async()=>({desktopEnabled:false}),onFastWorkEvent:()=>()=>{},onTextbookProgress:()=>()=>{},logLive:(kind,message)=>{if(kind==='error')console.log(message);if(message.endsWith('Report delivered'))resolveAnswer?.();}}};
 for(const profile of selectedProfile?[selectedProfile]:['Fast','Thinking']){
 const entry={profile,cases:[],unsolicited:[],audioChunks:0};report.profiles.push(entry);
 const Class=profile==='Fast'?voiceClass('simpleFastVoice.ts','SimpleFastVoiceSession'):voiceClass('thinkingVoice.ts','ThinkingVoiceSession');
 const callbacks={onStatus:(status,detail)=>{if(status==='error'){entry.error=detail;resolveAnswer?.();}if(profile==='Thinking'&&status==='listening'&&current?.answer)resolveAnswer?.();},onTranscript:e=>{if(e.role==='assistant'&&e.phase==='final'){if(current){current.answer=e.text;}else entry.unsolicited.push(e.text);}},onProgress(){}};
 voice=profile==='Fast'?new Class([],callbacks):new Class('LOW',[],callbacks);voice.audioEngine.ensureContext=async()=>{};voice.audioEngine.playAudio=()=>entry.audioChunks++;
 try{
 await voice.start(false);voice.setScreenSharing(true);let sending=false;const refresh=async()=>{if(sending)return;sending=true;try{const frame=await page.evaluate(()=>window.__nativeScreen.frame);if(frame){const accepted=voice?.sendScreenFrame(frame);if(!accepted)console.log('Frame rejected',Date.now()-frame.capturedAt,voice?.screenSharing);}}finally{sending=false;}};await refresh();frameTimer=setInterval(()=>void refresh().catch(error=>console.log('Frame error',error.message)),1000);
 for(const [label,value] of guardsOnly?[]:cases){
 frame=await page.evaluate(()=>window.__nativeScreen.frame);assert.ok(frame&&Date.now()-frame.capturedAt<3500,'Native frame is stale');
 console.log('Question frame',Date.now()-frame.capturedAt,voice.screenSharing,Date.now()-voice.screenFrameAt);
 current={label,expected:value,answer:''};entry.cases.push(current);
 let deadline;await new Promise(resolve=>{resolveAnswer=resolve;deadline=setTimeout(()=>{current.error='60-second response deadline';resolve();},60000);voice.sendText(`Look at the CURRENT shared dashboard. What is the exact value shown for "${label}"? Answer only that value, briefly in English. If unreadable, say unreadable. Do not use earlier answers.`);});clearTimeout(deadline);resolveAnswer=undefined;
 current.match=current.answer.toLowerCase().includes(value.toLowerCase());console.log(JSON.stringify({profile,label,answer:current.answer,match:current.match,error:current.error}));save();current=undefined;await new Promise(r=>setTimeout(r,100));
 if(entry.error)break;
 }
 if(guardsOnly){
  entry.guards=[];
  const ask=async(label)=>{current={label,answer:''};entry.guards.push(current);let deadline;await new Promise(resolve=>{resolveAnswer=resolve;deadline=setTimeout(()=>{current.error='60-second response deadline';resolve();},60000);voice.sendText('What is the CURRENT exact Invoice number on the shared dashboard? If you cannot read it from a fresh frame, say so. Do not reuse previous values. Answer briefly in English.');});clearTimeout(deadline);resolveAnswer=undefined;current.safe=safeRefusal(current.answer);console.log('Guard',JSON.stringify(current));current=undefined;save();};
  await app.evaluate(async()=>globalThis.__orvixScreenFixture.webContents.executeJavaScript(`{const field=document.querySelector('input');field.value='GUARD-8462';field.style.fontSize='1px';}`));await page.waitForTimeout(2300);await refresh();await ask('Unreadable 1px text');
  clearInterval(frameTimer);frameTimer=undefined;await new Promise(r=>setTimeout(r,4100));await ask('Stale frame');
  voice.setScreenSharing(false);await ask('Sharing off');
  await app.evaluate(async()=>globalThis.__orvixScreenFixture.webContents.executeJavaScript(`{const field=document.querySelector('input');field.value='AX-4831';field.style.fontSize='16px';}`));
 }
 entry.exactMatches=entry.cases.filter(c=>c.match).length;entry.passed=(guardsOnly?entry.guards?.length===3&&entry.guards.every(g=>g.safe&&!g.error):entry.cases.length===20&&entry.exactMatches>=19)&&!entry.error;
 }catch(error){entry.error=error.message;}finally{clearInterval(frameTimer);frameTimer=undefined;voice.stop();voice=null;current=undefined;save();}
 }
 }
 await page.evaluate(()=>window.__nativeScreen.capture.stop());
 await page.waitForFunction(()=>document.querySelector('#native-screen-test-preview .is-stale'),null,{timeout:7000});report.native.stalePreview=true;
 await page.evaluate(()=>window.__nativeScreen.stop());
 if(process.argv.includes('--ui')){
  report.ui={};
  await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));main.webContents.setAudioMuted(true);main.show();main.focus();});
  const startFromPicker=async()=>{
   await page.locator('.simple-screen-button').click();await page.locator('.screen-source:has(svg.lucide-monitor)').first().click();
   await page.waitForFunction(()=>document.querySelector('.screen-sharing-status')||document.querySelector('.screen-picker-error')||document.querySelector('.simple-voice-status.is-error'),null,{timeout:60000});
   const uiErrors=await page.locator('.screen-picker-error,.simple-voice-status.is-error').allTextContents();if(uiErrors.length)throw Error('App screen-sharing error: '+uiErrors.join(' / '));
   await page.waitForSelector('.screen-sharing-status',{timeout:60000});await page.waitForSelector('#root .screen-frame-preview img',{timeout:15000});
  };
  await page.locator('.home-prompt-input').fill('screen share on koro');await page.getByRole('button',{name:'Send message'}).click();
  await page.waitForSelector('.screen-picker',{timeout:5000});report.ui.typedOpenCommand=true;
  await page.locator('.screen-picker').press('Escape');await page.waitForSelector('.screen-picker',{state:'detached',timeout:5000});report.ui.escapeClosesPicker=true;
  await startFromPicker();
  await page.locator('.home-prompt-input').fill('screen share off koro');await page.getByRole('button',{name:'Send message'}).click();await page.waitForSelector('.screen-sharing-status',{state:'detached',timeout:10000});report.ui.typedStopCommand=true;
  await startFromPicker();
  await page.locator('.simple-screen-button').click();await page.waitForSelector('.screen-sharing-status',{state:'detached',timeout:10000});report.ui.eyeStop=true;
  await startFromPicker();
  report.ui.started=await page.locator('.simple-screen-button').getAttribute('aria-pressed')==='true';report.ui.caption=await page.locator('#root .screen-frame-preview figcaption').innerText();
  assert.equal(report.ui.started,true);assert.match(report.ui.caption,/Live/);
  await page.locator('.screen-sharing-status button').click();await page.waitForSelector('#root .screen-frame-preview',{state:'detached',timeout:10000});
  report.ui.stopped=await page.locator('.simple-screen-button').getAttribute('aria-pressed')==='false';assert.equal(report.ui.stopped,true);
  await startFromPicker();await page.locator('.mode-switch button[aria-pressed="false"]').click();await page.waitForSelector('#root .screen-frame-preview',{state:'detached'});report.ui.profileCleanup=true;
  await startFromPicker();if(!(await page.locator('.history-new').isVisible()))await page.getByRole('button',{name:'Show chat history',exact:true}).click();await page.locator('.history-new').click();await page.waitForSelector('#root .screen-frame-preview',{state:'detached'});report.ui.newChatCleanup=true;
  await startFromPicker();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.waitForSelector('#root .screen-frame-preview',{state:'detached'});report.ui.navigationCleanup=true;
  console.log('App picker/preview/stop',JSON.stringify(report.ui));
 }
 report.native.protectionRestored=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html')).isContentProtected());assert.equal(report.native.protectionRestored,true);
 report.passed=process.argv.includes('--live')||guardsOnly?report.profiles.length===2&&report.profiles.every(p=>p.passed):true;save();if(!report.passed)process.exitCode=1;
 }catch(error){report.error=error.message;save();console.error(error);process.exitCode=1;}finally{clearInterval(frameTimer);voice?.stop();if(app&&app.process().exitCode===null){try{require('node:child_process').execFileSync('taskkill',['/PID',String(app.process().pid),'/T','/F'],{stdio:'ignore'});}catch{app.process().kill();}}}
})();
