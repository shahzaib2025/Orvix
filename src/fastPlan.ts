import {routeFastRequest} from "./fastLatency";
import type {FastRoute} from "./fastLatency";
import { isWeatherRequest } from './fastWeather';
import { explorerRequest } from './fastExplorer';
import {fileOpenRequest} from './fastFiles';

// Request plan: a code-owned checklist for multi-part requests. It splits one
// spoken request into parts, routes each part on its own (so a chat part is
// answered directly instead of entering the work loop), and ticks parts off
// from observed tool results. It never executes anything.
export type PlanPart = {index:number;text:string;route:FastRoute;tools:string[]};
export type PlanState = "done"|"blocked"|"pending";
export type PlanReceipt = {name:string;result:Record<string,unknown>};

const toolsFor = (text:string):string[] => {
  if(fileOpenRequest(text))return ['open_local_file'];
  if(explorerRequest(text))return ['open_in_explorer'];
  if(/\blist\b.{0,25}\bcontents\b/i.test(text))return ['list_directory'];
  if(isWeatherRequest(text))return ["get_weather"];
  if(/clipboard|ক্লিপবোর্ড/i.test(text))return ["manage_clipboard"];
  if(/textbook|\bbooks?\b|বই/i.test(text))return ["search_class10_textbook","read_class10_textbook_pages"];
  if(/\b(?:youtube|yt|tabs?|browser|navigate|website|web page)\b|ইউটিউব|ব্রাউজার|ট্যাব/i.test(text))return ["browser_act","browser_observe"];
  if(/\bwindows?\b|উইন্ডো/i.test(text))return ["manage_window"];
  if(/\b(?:files?|folders?|director(?:y|ies)|desktop)\b|\b[\w-]+\.[a-z0-9]{1,5}\b|ফাইল|ফোল্ডার|ডেস্কটপ/i.test(text))return ["list_directory","read_file","search_files","search_content","write_file"];
  if(/\b(?:search|research|latest|letest|current|recent|news|price|pricing)\b|সার্চ|খুঁজ|গবেষণা|দাম/i.test(text))return ["web_search","read_web_page"];
  return [];
};

const SPLIT=/\s*(?:;|,\s*(?:and\s+)?(?:then\s+)?|\band then\b|\bafter that\b|\bthen\b|\balso\b|\band\b|তারপর|এবং|আর)\s+/i;
const BLOCKED=new Set(["blocked","limit_reached","search_limit","read_limit","unavailable","cancelled","needs_clarification"]);

// Returns undefined for single-part requests: those keep the existing loop.
export function buildPlan(text:string):PlanPart[]|undefined {
  // Requests naming URLs keep the loop's own required-source tracking.
  if(/https?:\/\//i.test(text))return undefined;
  const raw=text.trim().split(SPLIT).map(s=>s.trim()).filter(Boolean);
  if(raw.length<2||raw.length>8)return undefined;
  // "salt and pepper" must not become two parts: each part needs a few words.
  if(raw.some(part=>part.split(/\s+/).length<2))return undefined;
  const parts=raw.map((part,index)=>({index:index+1,text:part,route:fileOpenRequest(part)||explorerRequest(part)?'action' as FastRoute:routeFastRequest(part),tools:[] as string[]}));
  for(const part of parts){
    const specific=part.route=="local_fact"||part.route==="clarification"?[]:toolsFor(part.text);
    part.tools=specific.length?specific:(part.route==="action"||part.route==="lookup"?["*"]:[]);
    if(part.route==='conversation'&&specific.includes('list_directory'))part.route='lookup';
  }
  // A plan only matters when at least one part needs tools.
  return parts.some(p=>p.tools.length)?parts:undefined;
}

// Match each tool-needing part to its own observed receipts, in order.
export function planStatus(parts:PlanPart[], receipts:PlanReceipt[]){
  const used=new Set<number>();
  const evaluate=(part:PlanPart)=>{
    if(!part.tools.length)return {part,state:"done" as PlanState};
    const matches=receipts.map((r,i)=>({r,i})).filter(({r,i})=>!used.has(i)&&(part.tools.includes("*")||part.tools.includes(r.name)));
    const verified=matches.find(({r})=>(r.result.stepCheck as {verified?:boolean}|undefined)?.verified===true);
    if(verified){used.add(verified.i);return {part,state:"done" as PlanState};}
    const blocked=matches.find(({r})=>BLOCKED.has(String(r.result.status)));
    if(blocked){used.add(blocked.i);return {part,state:"blocked" as PlanState};}
    if(matches[0])used.add(matches[0].i);
    return {part,state:"pending" as PlanState};
  };
  // Specific parts claim their results first; wildcard parts take what is left.
  const done=new Map<number,{part:PlanPart;state:PlanState}>();
  for(const part of parts.filter(p=>!p.tools.includes("*")))done.set(part.index,evaluate(part));
  for(const part of parts.filter(p=>p.tools.includes("*")))done.set(part.index,evaluate(part));
  const states=parts.map(p=>done.get(p.index)!);
  const pending=states.filter(s=>s.state==="pending").map(s=>s.part);
  const blocked=states.filter(s=>s.state==="blocked").map(s=>s.part);
  return {states,pending,blocked,complete:pending.length===0};
}

export function planSummary(parts:PlanPart[], receipts:PlanReceipt[]){
  const status=planStatus(parts,receipts);
  return {
    parts:status.states.map(s=>({part:s.part.index,text:s.part.text,kind:s.part.tools.length?"work":"answer_directly",state:s.state})),
    remainingParts:status.pending.map(p=>p.index),
    blockedParts:status.blocked.map(p=>p.index),
    instruction:status.pending.length
      ?`Requested parts ${status.pending.map(p=>p.index).join(", ")} still have no verified result. Continue with the next unfinished part with ONE tool; a blocked part must not stop independent parts.`
      :status.blocked.length
        ?`Every part is finished or blocked. Report completed parts and state the concrete obstacle for blocked part(s) ${status.blocked.map(p=>p.index).join(", ")}.`
        :"Every requested part has a verified result. Give the final report covering each part, including chat parts.",
  };
}

export function planPrompt(parts:PlanPart[]){
  return "\nThis request has "+parts.length+" parts: "+parts.map(p=>`${p.index}) ${p.text}${p.tools.length?" [needs tools]":" [answer directly in the final report, no tools]"}`).join("; ")+
    ". Work through parts one tool at a time. If one part is blocked, continue the independent parts, then report each part's outcome.";
}
