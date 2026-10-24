import { useState } from 'react';
import type { TinyIncident, TinyPredicate } from '../desktop';
import { comparisons, numeric, signalNames } from '../tinyAgentCatalog';
export default function TinyIncidentControls({ value, entry, onChange }: {value?:TinyIncident;entry:TinyPredicate;onChange:(value:TinyIncident|undefined)=>void}) {
  const [json, setJson] = useState(value ? JSON.stringify(value.recoveryCondition) : ''), [invalid, setInvalid] = useState(false);
  const simple = value?.recoveryCondition.op === 'predicate' ? value.recoveryCondition : undefined;
  return <fieldset className="tiny-editor-section"><legend>Incident & recovery</legend><label className="tiny-check"><input type="checkbox" checked={!!value} onChange={e => {
    const low = ['lt','lte'].includes(entry.comparator);
    const next = e.target.checked ? {recoveryCondition:{...entry,comparator:numeric.has(entry.signal)?low?'gte':'lte':'eq',value:numeric.has(entry.signal)?Math.max(0,Number(entry.value)+(low?5:-5)):typeof entry.value==='boolean'?!entry.value:entry.value},recoveryHoldSeconds:5,notifyRecovery:true} : undefined;
    setJson(next ? JSON.stringify(next.recoveryCondition) : ''); setInvalid(false); onChange(next);
  }}/>Notify once when the incident starts, then track recovery</label>{value && <>
    <p>The main condition enters the incident after its hold. Missing readings keep an open incident unresolved.</p>
    {simple && <div className="tiny-builder-times"><span>Recovery signal: {signalNames[simple.signal]}</span><label className="tiny-field">Recovery comparison<select value={simple.comparator} onChange={e => onChange({...value,recoveryCondition:{...simple,comparator:e.target.value}})}>{Object.entries(comparisons).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="tiny-field">Recovery value<input value={String(simple.value)} type={numeric.has(simple.signal)?'number':'text'} onChange={e => onChange({...value,recoveryCondition:{...simple,value:numeric.has(simple.signal)?Number(e.target.value):typeof simple.value==='boolean'?e.target.value==='true':e.target.value}})}/></label></div>}
    <label className="tiny-field">Recovery must hold for seconds<input type="number" min="0" max="86400" value={value.recoveryHoldSeconds} onChange={e => onChange({...value,recoveryHoldSeconds:Number(e.target.value)})}/></label>
    <label className="tiny-check"><input type="checkbox" checked={value.notifyRecovery} onChange={e => onChange({...value,notifyRecovery:e.target.checked})}/>Notify when recovery is observed</label>
    <details><summary>Advanced recovery condition</summary><label className="tiny-field">Structured condition<textarea aria-invalid={invalid} value={json} onFocus={() => {if(!invalid)setJson(JSON.stringify(value.recoveryCondition));}} onChange={e => {setJson(e.target.value);try {const parsed=JSON.parse(e.target.value);if(!parsed || !parsed.op)throw Error();onChange({...value,recoveryCondition:parsed});setInvalid(false);}catch{setInvalid(true);}}}/></label>{invalid && <p role="alert">Finish the recovery condition before saving.</p>}</details>
  </>}</fieldset>;
}
