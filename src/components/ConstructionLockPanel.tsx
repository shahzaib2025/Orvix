import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {FolderLock,ShieldAlert,Unlock,RefreshCw,Trash2,Check,Copy,FolderOpen,Bell,X} from 'lucide-react';
import type {ConstructionLockControl,ConstructionLockListing,ConstructionLockPreview} from '../desktop';
import TinyLazyDetails from './TinyLazyDetails';
const finished=new Set(['unlocked','failed','access_unverified','access_attention','checking_access']);
const labels:Record<string,string>={active:'Windows protection active',preparing:'Preparing protection',awaiting_windows_approval:'Waiting for Windows approval',restoring:'Restoring original permissions',recovery_required:'Recovery needs attention',checking_access:'Checking your access',unlocked:'Access restored and checked',failed:'Protection was not activated',access_unverified:'Permissions restored · access not yet checked',access_attention:'Permissions restored · access needs attention'};
const errorText=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
export default function ConstructionLockPanel(){
  const bridge=window.orvixDesktop;
  const [listing,setListing]=useState<ConstructionLockListing|null>(null),[expanded,setExpanded]=useState(false),[targets,setTargets]=useState('');
  const [mode,setMode]=useState<'write'|'read_write'>('read_write'),[minutes,setMinutes]=useState(60),[review,setReview]=useState<ConstructionLockPreview|null>(null);
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState(''),[healthError,setHealthError]=useState(''),[message,setMessage]=useState(''),[lastChecked,setLastChecked]=useState(0);
  const [staging,setStaging]=useState(''),[cancelling,setCancelling]=useState(false),[cancelRequested,setCancelRequested]=useState(false),[slow,setSlow]=useState(false),[attemptLimit,setAttemptLimit]=useState(20);
  const mounted=useRef(true),busyRef=useRef(false),version=useRef(0),command=useRef(0),reading=useRef<Promise<void>|null>(null),cancelAccepted=useRef(false),latest=useRef<ConstructionLockListing|null>(null);
  const paths=useMemo(()=>targets.split(/\r?\n/).map(value=>value.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean),[targets]);
  const lock=listing?.lock,locked=!!lock&&!finished.has(lock.status),activation=busy==='Activating'||listing?.operation?.kind==='activation';
  const blocked=!!busy||locked||!!listing?.operation;
  const mustReviewAccess=!!lock&&!new Set(['unlocked','failed']).has(lock.status);
  const input=()=>({targets:paths,mode,durationMinutes:minutes});
  const apply=useCallback((value:ConstructionLockListing)=>{
    const strings=(items:unknown)=>Array.isArray(items)&&items.every(item=>typeof item==='string');
    const optionalString=(item:unknown)=>item==null||typeof item==='string';
    if(!value||typeof value.supported!=='boolean'||value.lock&&(
      !strings(value.lock.targets)||typeof value.lock.id!=='string'||typeof value.lock.status!=='string'||!optionalString(value.lock.error)||!optionalString(value.lock.auditHealth)||!optionalString(value.lock.recoveryDirectory)||
      !Array.isArray(value.lock.attempts)||value.lock.attempts.some(item=>!item||typeof item.id!=='string'||typeof item.path!=='string'||!optionalString(item.process))||
      value.lock.verification?.issues&&(!Array.isArray(value.lock.verification.issues)||value.lock.verification.issues.some(item=>!item||typeof item.reason!=='string'||!optionalString(item.path)||!optionalString(item.message)))
    )||value.recoveries&&(!Array.isArray(value.recoveries)||value.recoveries.some(item=>!item||typeof item.id!=='string'||typeof item.status!=='string'||!strings(item.targets)))||value.messageStatus&&(!['requested','acknowledged','failed'].includes(value.messageStatus.status)||!optionalString(value.messageStatus.error)))throw Error('Protection returned incomplete status data. Last-known information is retained; refresh or inspect recovery.');
    latest.current=value;
    setListing(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);
  },[]);
  const refresh=useCallback(()=>{
    if(reading.current)return reading.current;
    if(!bridge?.listConstructionLocks){setHealthError('Construction Lock is unavailable in this desktop build.');return Promise.resolve();}
    const requestVersion=++version.current;
    const request=bridge.listConstructionLocks().then(value=>{if(mounted.current&&requestVersion===version.current){apply(value);setHealthError('');setLastChecked(Date.now());}}).catch(cause=>{if(mounted.current&&requestVersion===version.current)setHealthError(errorText(cause));}).finally(()=>{if(reading.current===request)reading.current=null;});
    reading.current=request;return request;
  },[bridge,apply]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;version.current++;reading.current=null;};},[]);
  useEffect(()=>{
    let live=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{if(!document.hidden)await refresh();if(live)timer=setTimeout(()=>void poll(),busyRef.current||listing?.operation||lock&&!finished.has(lock.status)?1000:10000);};
    const visible=()=>{if(!document.hidden)void refresh();};void poll();document.addEventListener('visibilitychange',visible);
    return()=>{live=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[refresh,!!busy,lock?.status,listing?.operation?.kind]);
  useEffect(()=>{setReview(null);},[targets,mode,minutes]);
  useEffect(()=>{if(!busy){setSlow(false);return;}const timer=setTimeout(()=>setSlow(true),20000);return()=>clearTimeout(timer);},[busy]);
  async function run(label:string,action:()=>Promise<unknown>){
    if(busyRef.current)return;busyRef.current=true;command.current++;version.current++;setBusy(label);setError('');setMessage('');setCancelRequested(false);cancelAccepted.current=false;
    try{
      const result=await action();if(!mounted.current)return;version.current++;
      if(result&&typeof result==='object'){
        if('supported'in result){apply(result as ConstructionLockListing);setLastChecked(Date.now());setHealthError('');if(label==='Activating'){setReview(null);if(cancelAccepted.current)setMessage('Cancellation finished. Review the confirmed protection and access status above.');setCancelRequested(false);}} 
        else if('ready'in result)setReview(result as ConstructionLockPreview);
        else if('message'in result)setMessage(String(result.message));
      }
    }catch(cause){if(mounted.current){if(label==='Activating'&&cancelAccepted.current&&/cancelled before permissions changed/.test(errorText(cause)))setMessage('Activation cancelled before permissions changed.');else setError(errorText(cause));if(label==='Activating'){setReview(null);setCancelRequested(false);}void refresh();}}
    finally{busyRef.current=false;command.current++;if(mounted.current)setBusy(null);}
  }
  const control=(value:ConstructionLockControl)=>{if(!bridge?.controlConstructionLock)return Promise.reject(Error('Reopen the updated Windows desktop build to use this control.'));return bridge.controlConstructionLock(value);};
  async function pick(kind:'file'|'folder'){
    if(blocked)return;
    await run('Choosing path',async()=>{const selected=await bridge?.pickTinyAgentPath(kind);if(selected&&mounted.current){const existing=new Set(paths.map(value=>value.replace(/[\\/]+$/,'').toLowerCase()));if(existing.has(selected.replace(/[\\/]+$/,'').toLowerCase()))setMessage('This path is already selected.');else if(paths.length>=12)throw Error('Choose at most 12 paths.');else setTargets([...paths,selected].join('\n'));}});
  }
  async function cancel(){
    if(cancelling||cancelRequested)return;setCancelling(true);setError('');version.current++;const requestedCommand=command.current;
    try{const result=await control({action:'cancel_activation'});if(mounted.current&&requestedCommand===command.current&&(busyRef.current||latest.current?.operation?.kind==='activation')){if('supported'in result)apply(result);cancelAccepted.current=true;setCancelRequested(true);setMessage('Cancellation requested. Cancel the Windows approval prompt too if it is open. Waiting for Windows to settle.');}}
    catch(cause){if(mounted.current&&requestedCommand===command.current)setError(errorText(cause));}
    finally{if(mounted.current)setCancelling(false);void refresh();}
  }
  return <section className="tiny-construction" aria-label="Construction Lock">
    <div className="tiny-panel-head"><div><span>FILE PROTECTION</span><strong><FolderLock size={17}/> Construction Lock</strong></div><button aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Hide settings':'Protect files or folders'}</button></div>
    <p>Choose paths, check the selection, then review and activate. Windows enforces protection until you unlock it, its timer ends, or Orvix closes. Leaving this page keeps the lock active.</p>
    <div className="construction-toolbar"><button disabled={!bridge} onClick={()=>void refresh()}><RefreshCw size={14}/>Refresh status</button><button disabled={!!busy||!bridge?.controlConstructionLock} onClick={()=>void run('Testing message',()=>control({action:'test_message'}))}><Bell size={14}/>Test restriction message</button>{lastChecked>0&&<small>Last checked {new Date(lastChecked).toLocaleTimeString()}</small>}</div>
    {healthError&&<div className="tiny-error" role="alert"><strong>Live status unavailable</strong><p>{healthError}</p><p>Last-known protection may still be active. Refresh status or inspect the saved recovery journal.</p></div>}
    {busy&&<p role="status" className="construction-operation">{busy}… {slow?'Still awaiting confirmation. No success has been reported.':''}</p>}
    {activation&&<div className="construction-operation"><p>{cancelRequested||listing?.operation?.cancelRequested?'Cancellation requested · waiting for Windows acknowledgement':'Activation is pending. The selected paths are not confirmed protected yet.'}</p><button disabled={cancelling||cancelRequested||listing?.operation?.cancelRequested} onClick={()=>void cancel()}><X size={14}/>{cancelling?'Requesting cancellation…':'Cancel activation'}</button></div>}
    {lock&&<div className="tiny-construction-status" role="status">
      <strong>{listing.operation?.kind==='check_access'?'Checking your access':labels[lock.status]??lock.status.replaceAll('_',' ')}</strong>{lock.expiresAt>0&&locked&&<span>Automatic unlock: {new Date(lock.expiresAt).toLocaleString()}</span>}<span>Access monitoring: {finished.has(lock.status)?'stopped':lock.auditHealth}</span>
      <ul className="construction-paths">{lock.targets.map((target,index)=><li key={target}><span>{target}</span><button disabled={!!busy} aria-label={`Show protected path ${index+1} in Explorer`} onClick={()=>void run('Opening Explorer',()=>control({action:'reveal_target',id:lock.id,index}))}><FolderOpen size={14}/>Show in Explorer</button></li>)}</ul>
      {lock.status==='active'&&lock.auditHealth!=='watching'&&<p className="tiny-error" role="alert">Windows access monitoring needs attention. Denied attempts may not produce a message. Refresh status or unlock the selection.</p>}{lock.error&&<p className="tiny-error">{lock.error}</p>}{lock.verification?.issues?.map((issue,index)=><p key={index}>{issue.path??'Access check'}: {issue.reason.replaceAll('_',' ')}{issue.message?' · '+issue.message:''}</p>)}
      <div className="construction-toolbar">{!locked&&<button disabled={!!busy||!!listing.operation} onClick={()=>{setTargets(lock.targets.join('\n'));setMode(lock.mode);setExpanded(true);setReview(null);}}>Use these paths again</button>}{locked&&<button className="tiny-primary" disabled={!!busy||!!listing?.operation} onClick={()=>void run('Unlocking and checking access',()=>bridge!.unlockConstructionLock(lock.id))}><Unlock size={15}/>{lock.status==='recovery_required'?'Recover original permissions':'Unlock now'}</button>}{['unlocked','access_attention','access_unverified'].includes(lock.status)&&<button disabled={!!busy} onClick={()=>void run('Checking access',()=>control({action:'check_access',id:lock.id}))}><Check size={14}/>{lock.status==='unlocked'?'Check access':'Check access again'}</button>}<button disabled={!!busy} onClick={()=>void run('Copying recovery details',()=>control({action:'copy_recovery',id:lock.id}))}><Copy size={14}/>Copy recovery details</button>{lock.recoveryLauncher&&<button disabled={!!busy} onClick={()=>void run('Opening recovery',()=>control({action:'reveal_recovery',id:lock.id}))}><FolderOpen size={14}/>Show standalone recovery</button>}</div>
      {lock.status==='recovery_required'&&<p>Permissions may still be restricted. Recovery uses the saved journal and may ask for Windows administrator approval. {lock.recoveryDirectory}</p>}
      {listing.messageStatus&&<p className={listing.messageStatus.status==='failed'?'tiny-error':''}>Restriction message: {listing.messageStatus.status==='acknowledged'?'acknowledged':listing.messageStatus.status==='requested'?'requested · awaiting acknowledgement':'failed'}{listing.messageStatus.error?' · '+listing.messageStatus.error:''}</p>}{listing.messageStatus?.status==='failed'&&lock.status==='active'&&<button disabled={!!busy} onClick={()=>void run('Retrying message',()=>control({action:'retry_message'}))}>Retry restriction message</button>}
    </div>}
    {!!listing?.recoveries?.length&&<details open><summary>Earlier locks needing recovery</summary>{listing.recoveries.map(item=><div key={item.id}><p>{item.targets.join(', ')} · {item.status.replaceAll('_',' ')}</p><div className="construction-toolbar"><button disabled={!!busy||locked} onClick={()=>void run('Recovering earlier lock',()=>bridge!.unlockConstructionLock(item.id))}>Recover this earlier lock</button><button disabled={!!busy} onClick={()=>void run('Copying recovery details',()=>control({action:'copy_recovery',id:item.id}))}>Copy this recovery</button><button disabled={!!busy} onClick={()=>void run('Opening recovery',()=>control({action:'reveal_recovery',id:item.id}))}>Show this recovery</button></div></div>)}</details>}
    {expanded&&<div className="tiny-construction-form">
      {listing?.supported===false&&<p>Construction Lock is available on Windows.</p>}
      <label className="tiny-field">Protected paths, one per line<textarea aria-label="Construction protected paths" rows={3} value={targets} disabled={blocked} onChange={event=>setTargets(event.target.value)} placeholder="Choose up to 12 work files or folders"/></label>
      <div className="construction-toolbar"><button disabled={blocked||!bridge} onClick={()=>void pick('file')}>Add file</button><button disabled={blocked||!bridge} onClick={()=>void pick('folder')}>Add folder</button><button disabled={blocked||!paths.length} onClick={()=>setTargets('')}><Trash2 size={14}/>Clear selection</button><button disabled={blocked||paths.length<2} onClick={()=>{const unique=new Map<string,string>();for(const value of paths){const key=value.replace(/[\\/]+$/,'').toLowerCase();if(!unique.has(key))unique.set(key,value);}setTargets([...unique.values()].join('\n'));setMessage('Duplicate paths removed.');}}>Remove duplicates</button></div>
      {!!paths.length&&<ul className="construction-paths">{paths.map((target,index)=><li key={index}><span>{target}</span><button disabled={blocked} aria-label={`Remove selected path ${index+1}`} onClick={()=>setTargets(paths.filter((_,i)=>i!==index).join('\n'))}><X size={14}/>Remove</button></li>)}</ul>}
      <div className="tiny-builder-times"><label className="tiny-field">Restriction<select aria-label="Construction restriction" disabled={blocked} value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="read_write">Block opening and modification</option><option value="write">Block modification; allow reading</option></select></label><label className="tiny-field">Automatic unlock after minutes<input aria-label="Construction duration minutes" disabled={blocked} type="number" min={1} max={480} value={minutes} onChange={event=>setMinutes(Number(event.target.value))}/></label></div>
      <div className="construction-toolbar" aria-label="Protection duration presets">{[5,15,30,60,120].map(value=><button key={value} disabled={blocked} aria-pressed={minutes===value} onClick={()=>setMinutes(value)}>{value} min</button>)}</div>
      <button className="tiny-primary" disabled={blocked||!listing?.supported||!!healthError||!paths.length||!bridge?.previewConstructionLock} onClick={()=>void run('Checking selected paths',()=>bridge!.previewConstructionLock(input()))}><Check size={15}/>Check selected paths</button>
      {mustReviewAccess&&!locked&&<p>Finish the current lock’s access review before activating another selection.</p>}{review&&<section className="construction-review" aria-label="Reviewed protection selection"><strong>{review.ready?'Selection checked · review before activation':'Selection needs attention'}</strong><p>{review.mode==='write'?'Reading stays available; modification is blocked.':'Opening and modification are blocked.'} Automatic unlock {review.durationMinutes} minutes after activation is confirmed.</p><ul>{review.targets.map(target=><li key={target.path}>{target.path} · {target.kind} · {target.entries} entries · {target.status}{target.message?' · '+target.message:''}</li>)}</ul><p>Checked {new Date(review.checkedAt).toLocaleTimeString()}. Windows checks the paths again before changing permissions.</p><div className="construction-toolbar"><button disabled={!!busy} onClick={()=>setReview(null)}>Clear review</button>{review.ready&&<button className="tiny-primary" disabled={blocked||mustReviewAccess||!!healthError||!review.reviewId} onClick={()=>void run('Activating',()=>bridge!.startConstructionLock({...input(),reviewId:review.reviewId}))}><FolderLock size={15}/>Activate Windows protection</button>}</div></section>}
      <div className="tiny-staging-option"><strong>Work on a verified copy</strong><p>Keep originals accessible while AI work stays in a separate copy until you review it.</p><button disabled={blocked||!paths.length||!bridge?.createTinyStagingCopy} onClick={()=>void run('Creating staging copy',async()=>{const destination=await bridge!.pickTinyAgentPath('folder');if(!destination)return;const value=await bridge!.createTinyStagingCopy({targets:paths,destination});if(mounted.current)setStaging(value.directory);})}>Choose destination & create staging copy</button>{staging&&<p role="status">Copy verified: {staging}. Publishing back is manual.</p>}</div>
      <p className="tiny-construction-note"><ShieldAlert size={16}/>Windows administrator approval is required. Close open files first. Folder contents are included; already viewed content may remain visible. A message depends on Windows capturing a denied attempt; repeated attempts are combined. Recovery stays available if a check fails.</p>
    </div>}
    {error&&<div className="tiny-error" role="alert"><strong>Action needs attention</strong><p>{error.length>350?error.slice(0,350)+'…':error}</p>{error.length>350&&<TinyLazyDetails summary="Show full diagnostic">{()=> <pre>{error}</pre>}</TinyLazyDetails>}</div>}{message&&<p role="status" className="construction-feedback">{message}</p>}
    {!!lock?.attempts.length&&<TinyLazyDetails summary={`Recent denied access attempts (${lock.attempts.length})`}>{()=> <>{lock.attempts.slice(-attemptLimit).reverse().map(attempt=><p key={attempt.id}>{new Date(attempt.at).toLocaleString()} · {attempt.path} · {attempt.process||'Unknown application'}</p>)}{lock.attempts.length>attemptLimit&&<button onClick={()=>setAttemptLimit(value=>value+50)}>Show more attempts</button>}</>}</TinyLazyDetails>}
  </section>;
}
