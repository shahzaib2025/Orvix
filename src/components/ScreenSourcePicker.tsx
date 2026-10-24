import {useEffect,useRef,useState} from 'react';
import {Eye,Monitor,AppWindow,X,LoaderCircle} from 'lucide-react';
export type ScreenSource={id:string;name:string;kind:'screen'|'window';thumbnail:string};
export default function ScreenSourcePicker({onSelect,onClose}:{onSelect:(source:ScreenSource)=>Promise<void>;onClose:()=>void}){
  const [sources,setSources]=useState<ScreenSource[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{let alive=true;const prior=document.activeElement as HTMLElement|null;dialog.current?.focus();
    window.orvixDesktop?.listScreenSources().then(items=>{if(alive){setSources(items);setLoading(false);}}).catch(()=>{if(alive){setError('Could not load screens. Close this panel and try again.');setLoading(false);}});
    return()=>{alive=false;prior?.focus();};
  },[]);
  const select=async(source:ScreenSource)=>{setBusy(true);setError('');try{await onSelect(source);}catch(error){setError(error instanceof Error?error.message:'Screen sharing could not start.');setBusy(false);}};
  return <div className="screen-picker-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="screen-picker" role="dialog" aria-modal="true" aria-labelledby="screen-picker-title" tabIndex={-1} ref={dialog} onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();onClose();}
      if(event.key==='Tab'){const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);if(!buttons.length){event.preventDefault();return;}const first=buttons[0],last=buttons.at(-1)!;if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}}
    }}>
      <header><span className="screen-picker-emblem"><Eye size={23}/></span><div><p>LIVE VISION</p><h2 id="screen-picker-title">Let Orvix see your screen</h2></div><button className="screen-picker-close" aria-label="Close screen chooser" onClick={onClose}><X size={20}/></button></header>
      <p className="screen-picker-intro">Choose a screen or window to share. Ask a question whenever you need help.</p>
      {loading?<div className="screen-picker-loading"><LoaderCircle size={22}/>Finding available screens…</div>:<div className="screen-source-grid">{sources.map(source=><button key={source.id} className="screen-source" disabled={busy} onClick={()=>void select(source)}><div className="screen-source-image"><img src={source.thumbnail} alt="" /></div><span>{source.kind==='screen'?<Monitor size={16}/>:<AppWindow size={16}/>}<strong>{source.name}</strong></span></button>)}</div>}
      {busy&&<p role="status" className="screen-picker-loading">Starting live screen sharing…</p>}
      {!loading&&!sources.length&&!error&&<p role="status">No screens or windows are available.</p>}
      {error&&<p className="screen-picker-error" role="alert">{error}</p>}
      <footer><span className="screen-picker-privacy-dot"/>Only your chosen view is shared. Stop anytime with the eye button.</footer>
    </div>
  </div>;
}
