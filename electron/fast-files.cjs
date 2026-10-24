const path=require('node:path'),{execFile}=require('node:child_process');
const states=new Set(['maximized','minimized','normal','focus','left','right','top_left','top_right','bottom_left','bottom_right']);
const allowed=new Set('txt md log csv tsv json xml yaml yml rtf pdf doc docx odt xls xlsx ods ppt pptx odp jpg jpeg png gif bmp webp tif tiff ico mp3 wav flac m4a aac ogg wma mp4 mkv mov avi webm wmv mpeg mpg'.split(' '));
function native(input){const script=path.join(__dirname,'fast-file-native.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');return new Promise(resolve=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,timeout:14000,maxBuffer:512*1024,env:{...process.env,ORVIX_FAST_FILE_INPUT:JSON.stringify(input)}},(error,stdout)=>{try{resolve(error?{status:'unavailable'}:JSON.parse(stdout.trim()));}catch{resolve({status:'unavailable'});}}));}
function titleMatches(title,file){
  const clean=String(title||'').replace(/^[*●•\s]+/,'').toLowerCase(),name=path.basename(file).toLowerCase(),stem=path.basename(file,path.extname(file)).toLowerCase();
  return [name,stem].filter(s=>s.length>0).some(s=>clean===s||clean.startsWith(s+' - ')||clean.startsWith(s+' — ')||clean.startsWith(s+' – ')||clean.startsWith(s+' ['));
}
function candidates(observation,file){
  const app=path.basename(observation.association||'').replace(/\.exe$/i,'').toLowerCase();
  // A document title alone is not evidence of its associated application.
  if(!app)return [];
  return (observation.windows||[]).filter(w=>titleMatches(w.title,file)&&String(w.app).toLowerCase()===app);
}
function stateMatches(w,state,restoreBounds){
  if(!w)return false;if(['maximized','minimized','normal'].includes(state))return w.state===state&&(state!=='normal'||!restoreBounds||['x','y','width','height'].every(k=>Math.abs(w[k]-restoreBounds[k])<=4));
  if(state==='focus')return w.active===true;
  if(!states.has(state))return false;
  const halfW=Math.floor(w.workWidth/2),halfH=Math.floor(w.workHeight/2),right=state.includes('right'),bottom=state.startsWith('bottom'),quarter=state.includes('_');
  return w.state==='normal'&&Math.abs(w.x-(w.workX+(right?halfW:0)))<=4&&Math.abs(w.y-(w.workY+(bottom?halfH:0)))<=4&&Math.abs(w.width-(right?w.workWidth-halfW:halfW))<=4&&Math.abs(w.height-(quarter?(bottom?w.workHeight-halfH:halfH):w.workHeight))<=4;
}
function createFastFiles({shell,resolveTarget,getSettings=()=>({desktopEnabled:false}),observe=native}){
  const operations=new Map(),cancelled=new Set(),remembered=new Map(),uncertainLaunches=new Set(),normalBounds=new Map();
  const result=(status,extra={})=>({status,dispatched:false,...extra});
  async function execute(input){
    if(getSettings()?.desktopEnabled!==true)return result('disabled',{message:'Enable Fast desktop control first.'});
    if(!['open','position','inspect'].includes(input.action||'open'))return result('invalid_request');
    if(['position','inspect'].includes(input.action)&&(!Number.isSafeInteger(input.handle)||input.handle<=0))return result('invalid_request');
    if(input.action==='inspect'){
      const observation=await observe({action:'observe',path:input.path});
      if(observation.status!=='observed')return result('unavailable',{message:'Window identity could not be observed.'});
      const eligible=input.path?candidates(observation,input.path):(observation.windows||[]);
      const window=eligible.find(w=>w.handle===input.handle&&(!input.identity||w.identity===input.identity));
      return result(window?'ok':'stale_target',{window,verification:{verified:!!window},message:window?'Window identity observed.':'The remembered file window is no longer available. Observe before acting.'});
    }
    const state=input.windowState||'maximized';if(!states.has(state))return result('invalid_request',{message:'Choose an observed window state or snap layout.'});
    let target;if(input.action!=='position'){
      try{target=resolveTarget(input.path);}catch{return result('unavailable');}
      if(target.status!=='ok')return {...target,dispatched:false};
      if(target.type!=='file')return result('invalid_request',{message:'Use open_in_explorer to open a folder.'});
      if(!allowed.has(path.extname(target.path).slice(1).toLowerCase()))return result('unsupported_file',{path:target.path,message:'This format cannot be launched automatically. Show it in Explorer; programs, scripts and installers need a separate explicit approval flow.'});
    }
    const file=target?.path,prior=file?remembered.get(file.toLowerCase()):undefined;
    let before=await observe({action:'observe',path:file||input.path});
    if(cancelled.has(input.operationId))return result('cancelled');
    if(before.status!=='observed')return result('unavailable',{message:'Window observation is unavailable; no file was launched.'});
    let matches=file?candidates(before,file):(input.path?candidates(before,input.path):before.windows).filter(w=>w.handle===input.handle);
    if(file&&input.handle!==undefined){
      const chosen=matches.find(w=>w.handle===input.handle);
      if(!chosen)return result('stale_target',{path:file,message:'The selected file window is no longer among the matching candidates. Observe again.'});
      matches=[chosen];
    }
    if(prior&&input.handle===undefined){const known=matches.find(w=>w.handle===prior.handle&&w.identity===prior.identity);if(known)matches=[known];}
    if(matches.length>1)return result('needs_selection',{path:file,options:matches,message:'More than one matching document window is open. Ask which window.'});
    let dispatched=false,reused=matches.length===1;
    if(!matches.length&&input.action==='position')return result('stale_target',{message:'That observed window is no longer available.'});
    if(!matches.length){
      if(uncertainLaunches.has(file.toLowerCase()))return result('dispatched',{path:file,completionUnknown:true,message:'An earlier launch of this file is unresolved. No additional launch was dispatched.'});
      uncertainLaunches.add(file.toLowerCase());
      try{const error=await shell.openPath(file);dispatched=true;if(error){uncertainLaunches.delete(file.toLowerCase());return result('failed',{path:file,message:String(error).slice(0,250)});}}catch{return result('dispatched',{path:file,dispatched:true,completionUnknown:true,message:'Launch outcome is uncertain. Observe before any retry.'});}
      if(cancelled.has(input.operationId))return result('cancelled',{path:file,dispatched:true,completionUnknown:true});
      before=await observe({action:'observe',path:file,waitMs:7000});matches=candidates(before,file);
      if(matches.length!==1)return result(matches.length>1?'needs_selection':'dispatched',{path:file,dispatched:true,completionUnknown:true,options:matches,message:'Opening was requested, but one associated file window could not be established. Do not launch it again.'});
    }
    const window=matches[0];
    if(input.identity&&window.identity!==input.identity)return result('stale_target',{message:'The window identity changed; observe again.'});
    if(file){remembered.set(file.toLowerCase(),window);uncertainLaunches.delete(file.toLowerCase());}
    const windowKey=window.handle+':'+window.identity;
    if(!normalBounds.has(windowKey)){
      const bounds=window.state==='normal'?{x:window.x,y:window.y,width:window.width,height:window.height}:{x:window.normalX,y:window.normalY,width:window.normalWidth,height:window.normalHeight};
      if(bounds.width>0&&bounds.height>0)normalBounds.set(windowKey,bounds);
    }
    const restoreBounds=state==='normal'?normalBounds.get(windowKey):undefined;
    if(cancelled.has(input.operationId))return result('cancelled',{path:file,dispatched});
    let observation=before;
    if(!stateMatches(window,state,restoreBounds)){
      observation=await observe({action:'apply',path:file||input.path,handle:window.handle,identity:window.identity,expectedTitle:window.title,state,restoreBounds});dispatched=true;
    }
    let actual=(observation.windows||[]).find(w=>w.handle===window.handle&&w.identity===window.identity);
    // One passive reconciliation is safe if asynchronous window placement is slow.
    if(!stateMatches(actual,state,restoreBounds)){observation=await observe({action:'observe',path:file});actual=(observation.windows||[]).find(w=>w.handle===window.handle&&w.identity===window.identity);}
    const verified=stateMatches(actual,state,restoreBounds)&&(!(file||input.path)||titleMatches(actual.title,file||input.path));
    if(cancelled.has(input.operationId))return result('cancelled',{path:file,dispatched,completionUnknown:!verified,completedEffects:verified?[{window:actual,state}]:[]});
    return result(verified?'ok':'dispatched',{path:file,dispatched,reused,window:actual||window,requestedState:state,restoreBounds,completionUnknown:!verified,verification:{verified,evidence:verified?'Associated file window and requested native state observed.':'Requested window state is not confirmed.'}});
  }
  function run(input={}){
    if(typeof input.operationId!=='string'||!/^[\w:-]{1,100}$/.test(input.operationId))return Promise.resolve(result('invalid_request'));
    if(cancelled.has(input.operationId))return Promise.resolve(result('cancelled'));
    const signature=JSON.stringify([input.action,input.path,input.handle,input.identity,input.windowState]),old=operations.get(input.operationId);
    if(old)return old.signature===signature?old.promise:Promise.resolve(result('invalid_request',{message:'Operation ID was reused for different arguments.'}));
    if(operations.size>=300)return Promise.resolve(result('limit_reached'));
    const promise=execute(input);operations.set(input.operationId,{signature,promise});return promise;
  }
  function cancel(id){if(typeof id==='string'&&cancelled.size<300)cancelled.add(id);return result('cancelled');}
  return {run,cancel};
}
function registerFastFilesIpc(ipcMain,{requireSender,files,serialize=run=>run()}){ipcMain.handle('orvix:fast-file-window',(event,input)=>{requireSender(event);return input?.cancel?files.cancel(input.operationId):serialize(()=>files.run(input));});}
async function guardedFileWindowAction(files,input,fallback){
  if(!input.fileWindowIdentity)return fallback(input);
  const operationId=()=>require('node:crypto').randomUUID();
  if(['restore','focus','minimize','maximize'].includes(input.action)){
    const state={restore:'normal',focus:'focus',minimize:'minimized',maximize:'maximized'}[input.action];
    const placed=await files.run({action:'position',path:input.fileWindowPath,handle:input.handle,identity:input.fileWindowIdentity,windowState:state,operationId:operationId()});
    return {...placed,action:input.action,handle:input.handle,app:placed.window?.app,title:placed.window?.title,verified:placed.verification?.verified===true,ok:placed.verification?.verified===true};
  }
  const check=await files.run({action:'inspect',path:input.fileWindowPath,handle:input.handle,identity:input.fileWindowIdentity,operationId:operationId()});
  if(check.status!=='ok')return check;
  const result=await fallback(input);
  if(input.action==='close'&&result.verified!==true){
    const after=await files.run({action:'inspect',handle:input.handle,identity:input.fileWindowIdentity,operationId:operationId()});
    if(after.status==='stale_target')return {...result,action:'close',verified:true,completionUnknown:false};
    return {...result,action:'close',verified:false,completionUnknown:true,message:'Window closing is unverified. An unsaved-changes prompt or other application dialog may need the user.'};
  }
  return result;
}
module.exports={createFastFiles,registerFastFilesIpc,guardedFileWindowAction,native,titleMatches,stateMatches,candidates};
