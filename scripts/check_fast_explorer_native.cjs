// Real Electron preload/IPC and real Windows Explorer. --live also runs a
// typed Fast conversation with Gemini; audio scheduling is a fixture.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),live=process.argv.includes('--live');
const output=path.join(root,'scratch','fast-explorer-native-'+Date.now());fs.mkdirSync(output,{recursive:true});
const folder=path.join(output,'Songs'),note=path.join(folder,'নোট.txt');fs.mkdirSync(folder);fs.writeFileSync(note,'Fast Explorer test note.');
const html=path.join(output,'index.html');fs.writeFileSync(html,'<!doctype html><title>Fast Explorer IPC fixture</title>');
const code=`
const {app,BrowserWindow,ipcMain,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const root=${JSON.stringify(root)},output=${JSON.stringify(output)},folder=${JSON.stringify(folder)},note=${JSON.stringify(note)};
const {createFastExplorer,registerFastExplorerIpc}=require(path.join(root,'electron/fast-explorer.cjs'));
const report={scope:'Real Explorer window/selection verification and real Electron preload IPC; typed Live conversation when enabled, simulated audio playback.',native:[],turns:[]};
let voice,window,turn,finish;
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{
 const explorer=createFastExplorer({shell,getSettings:()=>({desktopEnabled:true}),paths:{desktop:app.getPath('desktop'),home:app.getPath('home'),documents:app.getPath('documents'),downloads:app.getPath('downloads'),workspace:root}});
 window=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'electron/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 registerFastExplorerIpc(ipcMain,{requireSender:event=>{assert.equal(event.sender,window.webContents);assert.equal(event.senderFrame,window.webContents.mainFrame);},explorer,serialize:run=>require(path.join(root,'electron/workflow-resources.cjs')).withResources(['interaction'],run)});
 await window.loadFile(${JSON.stringify(html)});
 for(const [index,input]of [{path:folder},{path:note,mode:'reveal'}].entries()){
   const started=performance.now();const result=await window.webContents.executeJavaScript('window.orvixDesktop.openFastExplorer('+JSON.stringify({...input,operationId:'native-'+index})+')');
   report.native.push({input,result,durationMs:performance.now()-started});save();assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(result.verification.verified,true);
 }
 if(${JSON.stringify(live)}){
   require(path.join(root,'electron/live-env.cjs')).loadLiveEnv(root);
   const originalWindow=global.window;
   global.window={speechSynthesis:{getVoices:()=>[],cancel(){}},orvixDesktop:{
     createLiveToken:require(path.join(root,'electron/live-auth.cjs')).createLiveToken,getFastSettings:async()=>({desktopEnabled:true}),getPcSnapshot:async()=>null,onFastWorkEvent:()=>()=>{},
     listDirectory:async input=>{const target=path.resolve(input.directory||'');assert.equal(target,folder,'Live test restricts directory reads to its fixture');turn.operations.push({name:'list_directory',input,at:performance.now()});return require(path.join(root,'electron/live-fs-tools.cjs')).listDirectory(input);},
     openFastExplorer:async input=>{assert.ok([folder,note,path.join(folder,'missing.txt')].includes(input.path),'Live test restricts openings to its fixture');const operation={name:'open_in_explorer',input,at:performance.now()};turn.operations.push(operation);return operation.result=await window.webContents.executeJavaScript('window.orvixDesktop.openFastExplorer('+JSON.stringify(input)+')');},
     logLive:(kind,message,details)=>{if(!turn)return;turn.events.push({kind,message,details,at:performance.now()});if(message.endsWith('Report delivered'))finish?.({delivery:details.delivery,renderer:details.renderer});save();}
   }};
   const bundle=require(path.join(root,'node_modules/esbuild')).buildSync({entryPoints:[path.join(root,'src/simpleFastVoice.ts')],platform:'node',format:'cjs',bundle:true,write:false,external:['@google/genai'],logLevel:'silent'}).outputFiles[0].text;
   const loaded=new Module(path.join(root,'scripts/.fast-explorer-native.cjs'),module);loaded.filename=path.join(root,'scripts/.fast-explorer-native.cjs');loaded.paths=Module._nodeModulePaths(path.join(root,'scripts'));loaded._compile(bundle,loaded.filename);
   voice=new loaded.exports.SimpleFastVoiceSession([],{onStatus:(status,detail)=>{if(status==='error')finish?.({error:detail});},onProgress(){},onTranscript:entry=>{if(turn&&entry.role==='assistant'){turn.transcripts.push(entry);if(entry.phase==='final')turn.answer=entry.text;}}});
   const originalReport=voice.report.bind(voice);voice.report=async(...args)=>{if(turn)turn.generatedAnswer=voice.turnText;return originalReport(...args);};
   voice.audioEngine.ensureContext=async()=>{};voice.audioEngine.playAudio=(_pcm,onStart)=>{if(turn)turn.audioChunks++;onStart?.();return Date.now();};
   await voice.start(false);
   const prompts=['List the contents of "'+folder+'". Reply briefly in English.','अच्छा, फोल्डर तो ओपन करो।','Show "'+note+'" selected in File Explorer. Reply briefly in English.','Show "'+path.join(folder,'missing.txt')+'" in File Explorer. Reply briefly in English.'];
   for(const prompt of prompts){
     turn={prompt,operations:[],events:[],transcripts:[],audioChunks:0};report.turns.push(turn);
     let timer;const done=new Promise(resolve=>{finish=resolve;timer=setTimeout(()=>resolve({error:'45-second turn deadline'}),45000);});
     voice.sendText(prompt);Object.assign(turn,await done);clearTimeout(timer);await new Promise(resolve=>setTimeout(resolve,100));
     turn.acknowledgedBeforeDispatch=turn.operations.every(op=>turn.events.some(e=>e.message.endsWith('Acknowledgment audio onset')&&e.details.tool===op.name&&e.at<=op.at));save();
     assert.ok(!turn.error,turn.error);assert.ok(turn.answer);assert.equal(turn.acknowledgedBeforeDispatch,true);assert.equal(turn.delivery,'complete');
   }
   assert.ok(report.turns[1].operations.some(op=>op.name==='open_in_explorer'&&op.result.verification.verified));
   assert.ok(report.turns[2].operations.some(op=>op.result?.mode==='reveal'&&op.result.verification.verified));
   assert.ok(report.turns[3].operations.some(op=>op.result?.status==='not_found'));assert.doesNotMatch(report.turns[3].answer,/is open|opened successfully/i);
   global.window=originalWindow;
 }
 report.passed=true;save();console.log('FAST_EXPLORER_NATIVE_OK '+JSON.stringify({output,native:report.native.map(n=>({status:n.result.status,mode:n.result.mode,durationMs:n.durationMs})),turns:report.turns.map(t=>({prompt:t.prompt,answer:t.answer,delivery:t.delivery,operations:t.operations.map(o=>o.name),acknowledgedBeforeDispatch:t.acknowledgedBeforeDispatch}))}));
}).catch(error=>{report.passed=false;report.error=error.message;save();console.error(error.stack);process.exitCode=1;}).finally(()=>{voice?.stop();window?.destroy();app.exit(report.passed?0:1);});
`;
fs.writeFileSync(path.join(output,'main.cjs'),code);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(output,'main.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
const timer=setTimeout(()=>child.kill(),live?210000:30000);child.on('close',status=>{clearTimeout(timer);fs.writeFileSync(path.join(output,'runtime.log'),logs);console.log(logs.slice(-5000));console.log('Report: '+path.join(output,'report.json'));if(status!==0)process.exitCode=1;});
