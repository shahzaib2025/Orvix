import {useSyncExternalStore} from 'react';
import type {TinyRuntimeControl} from './desktop';

export type TinyRuntimeHealthState = {status:string;lastSeenAt:number;idle?:boolean;control?:TinyRuntimeControl;activeMonitors?:number;activeRuns?:number;protectionStatus?:string};
let snapshot:TinyRuntimeHealthState|undefined, timer:ReturnType<typeof setInterval>|undefined, refreshTimer:ReturnType<typeof setTimeout>|undefined;
let cleanups:(()=>void)[] = [], reading:Promise<void>|undefined, generation=0, revision=0;
const listeners=new Set<()=>void>();
const publish=(value:TinyRuntimeHealthState)=>{snapshot=value;for(const listener of listeners)listener();};
export function refreshTinyRuntimeHealth() {
  if(reading)return reading;
  const bridge=window.orvixDesktop, epoch=generation, version=revision;
  if(!bridge?.tinyRuntimeHealth)return Promise.resolve();
  const request=bridge.tinyRuntimeHealth().then(value=>{if(epoch===generation&&version===revision)publish(value);}).catch(()=>{if(epoch===generation&&version===revision)publish({status:'unavailable',lastSeenAt:0});}).finally(()=>{if(reading===request){reading=undefined;if(epoch===generation&&version!==revision&&listeners.size)void refreshTinyRuntimeHealth();}});
  reading=request;
  return reading;
}
function subscribe(listener:()=>void) {
  listeners.add(listener);
  if(listeners.size===1){
    const bridge=window.orvixDesktop;
    const request=()=>{if(!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=undefined;void refreshTinyRuntimeHealth();},100);};
    const control=bridge?.onTinyRuntimeControl?.(value=>{revision++;publish({...snapshot,status:snapshot?.status??'responding',lastSeenAt:Date.now(),control:value});request();});
    const agents=bridge?.onTinyAgentEvent?.(event=>{if(event.kind!=='snapshot')request();});
    const workflows=bridge?.onTinyWorkflowEvent?.(request);
    cleanups=[control,agents,workflows].filter((item):item is ()=>void=>!!item);
    // One fallback for all consumers; normal changes arrive through subscriptions.
    timer=setInterval(()=>{if(!document.hidden)void refreshTinyRuntimeHealth();},5000);
    document.addEventListener('visibilitychange',request);
    cleanups.push(()=>document.removeEventListener('visibilitychange',request));
    void refreshTinyRuntimeHealth();
  }
  return()=>{listeners.delete(listener);if(!listeners.size){generation++;reading=undefined;clearInterval(timer);clearTimeout(refreshTimer);timer=undefined;refreshTimer=undefined;for(const off of cleanups)off();cleanups=[];snapshot=undefined;}};
}
export const useTinyRuntimeHealth=()=>useSyncExternalStore(subscribe,()=>snapshot);
