const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Fixed PowerShell program; the path is data in an environment variable. Never
// interpolate a user/model path into a command or execute the selected file.
const observationScript = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$wanted=$env:ORVIX_FAST_EXPLORER_FOLDER
$selected=$env:ORVIX_FAST_EXPLORER_ITEM
$selectionApplied=$false
$shell=New-Object -ComObject Shell.Application
$deadline=[DateTime]::UtcNow.AddMilliseconds(2200)
do {
  foreach($window in @($shell.Windows())) {
    try {
      if(-not $window.Visible -or [IO.Path]::GetFileName($window.FullName) -ine 'explorer.exe'){continue}
      $folder=[string]$window.Document.Folder.Self.Path
      if($folder.TrimEnd([char]92) -ine $wanted.TrimEnd([char]92)){continue}
      if($selected -and $env:ORVIX_FAST_EXPLORER_SELECT -eq '1' -and -not $selectionApplied){
        $item=$window.Document.Folder.ParseName([IO.Path]::GetFileName($selected))
        if($null -ne $item){$window.Document.SelectItem($item,29);$selectionApplied=$true;Start-Sleep -Milliseconds 80}
      }
      $items=@($window.Document.SelectedItems() | ForEach-Object { [string]$_.Path })
      if($selected -and -not ($items | Where-Object { $_ -ieq $selected })){continue}
      @{verified=$true;folder=$folder;selectedPaths=$items;windowHandle=[long]$window.HWND} | ConvertTo-Json -Compress -Depth 4
      exit 0
    } catch {}
  }
  Start-Sleep -Milliseconds 80
} while([DateTime]::UtcNow -lt $deadline)
@{verified=$false;folder=$wanted} | ConvertTo-Json -Compress
`;

function observeExplorer(folder, selected, selectRequested=false) {
  return new Promise(resolve => {
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(observationScript,'utf16le').toString('base64')],
      {windowsHide:true,timeout:6000,maxBuffer:128*1024,env:{...process.env,ORVIX_FAST_EXPLORER_FOLDER:folder,ORVIX_FAST_EXPLORER_ITEM:selected || '',ORVIX_FAST_EXPLORER_SELECT:selectRequested?'1':'0'}},
      (error, stdout) => { try {resolve({...JSON.parse(stdout.trim()),...(error?{observationError:true}:{})});} catch {resolve({verified:false,observationError:true});} });
  });
}

function createFastExplorer({shell, paths, getSettings=()=>({desktopEnabled:false}), observe=observeExplorer}) {
  const operations=new Map();
  const cancelled=new Set();
  function resolveTarget(raw) {
    if(typeof raw!=='string'||!raw.trim()||raw.length>2000||/[\x00-\x1f]/.test(raw))return {status:'invalid_path',message:'Provide one local file or folder path.'};
    const input=raw.trim().replace(/^(["'])(.*)\1$/,'$2');
    if(/^[\\/]{2}|^[a-z][a-z0-9+.-]*:/i.test(input)&&! /^[a-z]:[\\/]/i.test(input))return {status:'invalid_path',message:'Use a local drive path, not a URL, shell command, or network location.'};
    const alias=/^(desktop|documents|downloads|home)(?:[\\/](.*))?$/i.exec(input);
    const candidates=alias ? [path.resolve(paths[alias[1].toLowerCase()],alias[2]||'')] : path.isAbsolute(input)?[path.resolve(input)]:[paths.desktop,paths.home,paths.workspace].filter(Boolean).map(base=>path.resolve(base,input));
    const matches=[...new Set(candidates.filter(candidate=>fs.existsSync(candidate)).map(candidate=>fs.realpathSync.native(candidate)))];
    if(!matches.length)return {status:'not_found',message:'That local path does not exist. Discover its exact location with list_directory/search_files or ask for the path.'};
    if(matches.length>1)return {status:'needs_selection',paths:matches,message:'More than one local path matches. Ask which one; nothing was opened.'};
    const canonical=matches[0];
    if(!path.isAbsolute(canonical)||/^\\\\/.test(canonical))return {status:'invalid_path',message:'Only local drive paths are supported.'};
    const stat=fs.statSync(canonical);
    if(!stat.isDirectory()&&!stat.isFile())return {status:'invalid_path',message:'The target is not a regular file or directory.'};
    return {status:'ok',path:canonical,type:stat.isDirectory()?'folder':'file'};
  }
  async function execute(input) {
    if(getSettings()?.desktopEnabled!==true)return {status:'disabled',dispatched:false,message:'Fast desktop control is disabled. Enable it in Fast settings to open File Explorer.'};
    if(!['open','reveal'].includes(input.mode || 'open'))return {status:'invalid_request',dispatched:false,message:'Choose open or reveal.'};
    let target;
    try {target=resolveTarget(input.path);}catch{return {status:'unavailable',dispatched:false,message:'The local path could not be inspected.'};}
    if(target.status!=='ok')return {...target,dispatched:false};
    const reveal=input.mode==='reveal'||target.type==='file';
    const folder=reveal?path.dirname(target.path):target.path,selected=reveal?target.path:undefined;
    try {
      // Always open a directory. Files are selected with Explorer's own API,
      // avoiding execution and Windows 11's hidden showItemInFolder window.
      const error=await shell.openPath(folder);if(error)return {...target,status:'failed',dispatched:false,message:String(error).slice(0,300)};
    } catch {return {...target,status:'failed',completionUnknown:true,dispatched:true,message:'Explorer dispatch failed or its effect is uncertain; observe before retrying.'};}
    let verification;
    try {verification=await observe(folder,selected,reveal);}catch {verification={verified:false,observationError:true};}
    if(verification?.observationError){
      // A cold/busy Explorer probe can time out after the window has opened.
      // Reconcile once with observation only; never dispatch or select again.
      try {verification={...await observe(folder,selected,false),probeAttempts:2};}catch {verification={verified:false,observationError:true,probeAttempts:2};}
    }
    // Check the observer's returned paths as well as its boolean.
    const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
    const verified=verification?.verified===true&&same(verification.folder,folder)&&(!selected||Array.isArray(verification.selectedPaths)&&verification.selectedPaths.some(item=>same(item,selected)));
    return {...target,status:verified?'ok':'dispatched',mode:reveal?'reveal':'open',dispatched:true,completionUnknown:!verified,
      verification:{...verification,verified},message:verified?(reveal?'The exact item is selected in File Explorer.':'File Explorer is showing the requested folder.'):'Explorer was requested, but its visible target could not be verified. Do not claim it opened or automatically repeat the request.'};
  }
  function open(input={}) {
    const id=input.operationId;
    if(typeof id!=='string'||!/^[\w:-]{1,100}$/.test(id))return Promise.resolve({status:'invalid_request',dispatched:false,message:'A unique operation ID is required.'});
    const signature=JSON.stringify([input.path,input.mode || 'open']),prior=operations.get(id);
    if(prior)return prior.signature===signature?prior.promise:Promise.resolve({status:'invalid_request',dispatched:false,message:'An operation ID cannot be reused for a different target.'});
    if(cancelled.has(id))return Promise.resolve({status:'cancelled',dispatched:false});
    if(operations.size>=300)return Promise.resolve({status:'limit_reached',dispatched:false,message:'Explorer operation limit reached for this app session.'});
    const promise=execute(input);operations.set(id,{signature,promise});return promise;
  }
  function cancel(id){
    if(typeof id!=='string'||!/^[\w:-]{1,100}$/.test(id))return {status:'invalid_request',dispatched:false};
    if(cancelled.size<300)cancelled.add(id);
    return {status:operations.has(id)?'cancellation_requested':'cancelled',dispatched:operations.has(id)};
  }
  return {open,cancel,resolveTarget};
}
function registerFastExplorerIpc(ipcMain,{requireSender,explorer,serialize=run=>run()}) {
  ipcMain.handle('orvix:fast-open-explorer',(event,input)=>{requireSender(event);if(input?.cancel===true)return explorer.cancel(input.operationId);return serialize(()=>explorer.open(input));});
}
module.exports={createFastExplorer,registerFastExplorerIpc,observeExplorer};
