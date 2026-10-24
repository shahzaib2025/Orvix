import {useState} from 'react';
import {useTinyRuntimeHealth,refreshTinyRuntimeHealth} from '../tinyRuntimeSubscription';
import './tiny-execution-indicator.css';
export default function TinyExecutionIndicator({onOpen}:{onOpen:()=>void}) {
  const state=useTinyRuntimeHealth(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!state)return null;
  const control=state.control,working=control?.status==='running',stopping=control?.status==='stopping',protectedFiles=!!state.protectionStatus&&!['unlocked','failed'].includes(state.protectionStatus);
  return <div className="tiny-execution-indicator"><button onClick={onOpen} title={error||'View Tiny Agents execution and recovery'} aria-label="Open Tiny Agents execution status"><span aria-hidden="true" className={working||protectedFiles?'enabled':''}/>{state.status==='unavailable'?'Agents unavailable':stopping?'Agents stopping':protectedFiles?'File protection · review':working?`${state.activeMonitors??0} monitors · ${state.activeRuns??0} tasks`:'Agents stopped'}</button>{(working||stopping||busy||protectedFiles)&&<button disabled={busy||stopping} aria-label="Stop all Tiny Agents from any page" onClick={async()=>{setBusy(true);setError('');try{await window.orvixDesktop!.controlTinyRuntime({action:'stop'});await refreshTinyRuntimeHealth();}catch(cause){setError(String(cause));onOpen();}finally{setBusy(false);}}}>{busy||stopping?'Stopping…':'Stop all'}</button>}</div>;
}
