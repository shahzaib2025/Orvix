import {useState} from 'react';
import type {ReactNode} from 'react';

// A closed native <details> hides its children visually but React still renders
// them. Defer reports, JSON and worker viewers until the user opens this panel.
export default function TinyLazyDetails({summary,children}:{summary:ReactNode;children:()=>ReactNode}) {
  const [open,setOpen]=useState(false);
  return <details open={open} onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}>
    <summary>{summary}</summary>{open&&children()}
  </details>;
}
