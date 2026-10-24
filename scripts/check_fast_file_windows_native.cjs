// Real Electron IPC, default file association, Windows state/geometry checks.
// --live adds Gemini Fast conversation; audio scheduling is simulated.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),live=process.argv.includes('--live'),liveOnly=process.argv.includes('--live-only'),output=path.join(root,'scratch','fast-file-native-'+Date.now());fs.mkdirSync(output,{recursive:true});
const file=path.join(output,'Orvix-ফাইল-'+Date.now()+'.txt');fs.writeFileSync(file,'A saved test document for Fast window checks.');
fs.writeFileSync(path.join(output,'index.html'),'<!doctype html><title>Fast file IPC fixture</title>');
const source=`
const {app,BrowserWindow,ipcMain,shell}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const root=${JSON.stringify(root)},output=${JSON.stringify(output)},file=${JSON.stringify(file)},live=${live};
const {createFastFiles,registerFastFilesIpc,guardedFileWindowAction,native,stateMatches,titleMatches}=require(path.join(root,'electron/fast-files.cjs'));
const {createFastExplorer}=require(path.join(root,'electron/fast-explorer.cjs'));
const {manageWindow}=require(path.join(root,'electron/window-control.cjs'));
const {windowActionResult}=require(path.join(root,'electron/fast-windows.cjs'));
const report={scope:'Real Windows file association, native window state and geometry, Electron preload IPC. Optional typed Gemini conversation with simulated audio scheduling.',native:[],turns:[]};
let window,voice,last,finish,turn;const listeners=new Set(),save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{
 const resolver=createFastExplorer({shell,paths:{desktop:app.getPath('desktop'),documents:app.getPath('documents'),downloads:app.getPath('downloads'),home:app.getPath('home'),workspace:root}});
 const files=createFastFiles({shell,resolveTarget:resolver.resolveTarget,getSettings:()=>({desktopEnabled:true})});
 window=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'electron/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 registerFastFilesIpc(ipcMain,{requireSender:e=>{assert.equal(e.sender,window.webContents);assert.equal(e.senderFrame,window.webContents.mainFrame);},files,serialize:run=>require(path.join(root,'electron/workflow-resources.cjs')).withResources(['interaction'],run)});
 await window.loadFile(path.join(output,'index.html'));
 const invoke=input=>window.webContents.executeJavaScript('window.orvixDesktop.fastFileWindow('+JSON.stringify(input)+')');
 for(const [i,state]of (${liveOnly}?['maximized']:['maximized','minimized','maximized','normal','focus','left','right','top_left','top_right','bottom_left','bottom_right','normal']).entries()){
  const started=performance.now(),result=await invoke(i===0?{path:file,operationId:'native-open'}:{action:'position',handle:last.handle,identity:last.identity,path:file,windowState:state,operationId:'native-'+i+'-'+state});
  const settled=await native({action:'observe',path:file});const actual=settled.windows?.find(w=>w.handle===result.window?.handle&&w.identity===result.window?.identity);report.native.push({state,result,settledWindow:actual,durationMs:performance.now()-started});save();assert.equal(result.status,'ok',JSON.stringify(result));assert.ok(stateMatches(result.window,state,result.restoreBounds));if(state!=='focus')assert.ok(stateMatches(actual,state,result.restoreBounds),'Window state changed after its initial receipt: '+JSON.stringify(actual));else assert.ok(actual,'The focused window disappeared');last=result.window;
 }
 const reused=await invoke({path:file,operationId:'native-reuse'});report.reused=reused;assert.equal(reused.reused,true);assert.equal(reused.status,'ok');last=reused.window;save();
 const work=require(path.join(root,'electron/fast-work.cjs')).createFastWork({settingsFile:path.join(output,'settings.json'),browser:{},desktop:{},windows:{
  observe:async()=>{const result=await native({action:'observe'});return {status:'ok',observation:{windows:result.windows}};},
  act:async input=>{assert.equal(Number(input.handle),last.handle,'Only the fixture window may be controlled');return windowActionResult(await guardedFileWindowAction(files,input,manageWindow));}
 },emit:event=>{for(const listener of listeners)listener(event);}});work.configure({desktopEnabled:true});
 if(live){
  require(path.join(root,'electron/live-env.cjs')).loadLiveEnv(root);
  global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{
   createLiveToken:require(path.join(root,'electron/live-auth.cjs')).createLiveToken,getFastSettings:async()=>({desktopEnabled:true}),getPcSnapshot:async()=>null,
   onFastWorkEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},setFastApprovalQueue:async()=>true,
   updateFastTask:async input=>work.update(input),cancelFastTask:id=>work.cancel(id),resumeApprovedFastAction:id=>work.resumeApproval(id),
   fastFileWindow:async input=>{assert.ok(!input.path||input.path===file);if(input.cancel)return invoke(input);const op={tool:input.action==='position'?'position_window':input.action==='inspect'?'inspect':'open_local_file',input};turn.operations.push(op);const result=await invoke(input);op.result=result;save();return result;},
   executeFast:async(id,kind,input)=>{const op={tool:'manage_window',input};turn.operations.push(op);const result=await work.execute(id,kind,input);op.result=result;save();return result;},
   logLive:(kind,message,details)=>{if(!turn)return;turn.events.push({kind,message,details});if(message.endsWith('Report delivered'))finish?.({delivery:details.delivery,renderer:details.renderer});save();}
  }};
  const bundle=require(path.join(root,'node_modules/esbuild')).buildSync({entryPoints:[path.join(root,'src/simpleFastVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['@google/genai'],logLevel:'silent'}).outputFiles[0].text;
  const mod=new Module(path.join(root,'scripts/.fast-file-native.cjs'),module);mod.filename=path.join(root,'scripts/.fast-file-native.cjs');mod.paths=Module._nodeModulePaths(path.join(root,'scripts'));mod._compile(bundle,mod.filename);
  voice=new mod.exports.SimpleFastVoiceSession([],{onStatus:(status,detail)=>{if(status==='error')finish?.({error:detail});},onProgress(){},onTranscript:e=>{if(turn&&e.role==='assistant'){turn.transcripts.push(e);if(e.phase==='final')turn.answer=e.text;}}});
  voice.audioEngine.ensureContext=async()=>{};voice.audioEngine.playAudio=(_pcm,onset)=>{onset?.();return Date.now();};await voice.start(false);
  for(const [prompt,state]of [
   ['Open "'+file+'". Reply briefly in English.','maximized'],
   ['এটাকে মিনিমাইজ করো।','minimized'],
   ['Abar maximize koro.','maximized'],
   ['Put it on the left half. Reply in English.','left'],
   ['Put it in a small portion.',null],
   ['Put it in the bottom right corner.','bottom_right'],
   ['Restore it. Reply briefly in English.','normal']
  ]){
   turn={prompt,expectedState:state,operations:[],events:[],transcripts:[]};report.turns.push(turn);let timer;
   const done=new Promise(resolve=>{finish=resolve;timer=setTimeout(()=>resolve({error:'60-second turn deadline'}),60000);});voice.sendText(prompt);Object.assign(turn,await done);clearTimeout(timer);
   const observation=await native({action:'observe',path:file});turn.observedWindow=observation.windows.find(w=>w.handle===last.handle&&w.identity===last.identity);save();
   assert.ok(!turn.error,turn.error);assert.ok(turn.answer);assert.equal(turn.delivery,'complete');
   console.log('LIVE_TURN '+JSON.stringify({prompt,expectedState:state,actualState:turn.observedWindow?.state,answer:turn.answer}));
   if(state)assert.ok(stateMatches(turn.observedWindow,state,turn.operations.at(-1)?.result?.restoreBounds),JSON.stringify(turn));else assert.equal(turn.operations.length,0,'Unspecified layout must clarify before acting');
   await new Promise(r=>setTimeout(r,150));
  }
  voice.stop();voice=undefined;
 }
 const task=work.update({text:'Close the saved fixture file window',replace:true,executionMode:'simple'});
 const args={action:'close',handle:last.handle,appName:last.app,fileWindowIdentity:last.identity,fileWindowPath:file};
 const pending=await work.execute(task.id,'window_act',args);assert.equal(pending.status,'confirmation_required');report.closeApproval=pending;save();
 work.decide(pending.approvalId,true);const closed=await work.resumeApproval(pending.approvalId);report.closeResult=closed;save();assert.equal(closed.verification.verified,true,JSON.stringify(closed));
 const remaining=await native({action:'observe',path:file});assert.ok(!remaining.windows.some(w=>w.handle===last.handle&&w.identity===last.identity));report.passed=true;save();
 console.log(JSON.stringify({passed:true,output,native:report.native.map(n=>({state:n.state,durationMs:n.durationMs})),turns:report.turns.map(t=>({prompt:t.prompt,answer:t.answer,delivery:t.delivery}))},null,2));
}).catch(error=>{report.passed=false;report.error=error.message;save();console.error(error.stack);}).finally(async()=>{voice?.stop();if(last&&!report.passed){try{const inspection=await native({action:'observe',path:file});const owned=inspection.windows?.find(w=>w.handle===last.handle&&w.identity===last.identity&&titleMatches(w.title,file));if(owned)await manageWindow({action:'close',handle:owned.handle});}catch{}}window?.destroy();app.exit(report.passed?0:1);});
`;
fs.writeFileSync(path.join(output,'main.cjs'),source);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(output,'main.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
const timer=setTimeout(()=>child.kill(),live?540000:210000);child.on('close',code=>{clearTimeout(timer);fs.writeFileSync(path.join(output,'runtime.log'),log);console.log(log.slice(-7000));console.log('Report: '+path.join(output,'report.json'));if(code!==0)process.exitCode=1;});
