import type {FastProgressVoice, GeneratedProgress, ProgressContext} from "./fastProgressVoice";

// Prepare only a read/research explanation. Nothing is spoken or executed from
// an unfinished utterance. A correction discards it before playback can begin.
const normalize=(text:string)=>text.trim().toLowerCase().replace(/[.,!?।]+/g," ").replace(/\s+/g," ").trim();
export function canPreviewProgress(text:string){
  return text.trim().split(/\s+/).length>=4&&text.length>=20&&
    /\b(?:research|search|read|compare|comparison|models?|modelgula|modelgular|weather|forecast)\b|গবেষণা|খুঁজ|খোঁজ|পড়|পড়|তুলনা|মডেল|আবহাওয়া|আবহাওয়া/i.test(text)&&
    !/\b(?:not|no|never|don['’]?t|cancel|stop|instead|actually|rather|except|sorry|wait|password|secret|token|key|type|click|press|delete|write|save|send|buy)\b|\bdo\s+not\b|(?:^|\s)না(?:\s|[।.!?,]|$)|নয়|নয়|বাতিল|থাম|বরং|বদল|বাদ\s|করোনা|পাসওয়ার্ড|গোপন|মুছ|চাপ|লিখ|পাঠা|नहीं|मत|nahi|mat karo/i.test(text);
}

export class FastProgressPreview {
  readonly startedAt=Date.now();
  private controller=new AbortController();
  private chunks:string[]=[];
  private text="";
  private done=false;
  private discarded=false;
  private onAudio?: (chunk:string)=>void;
  private onText?: (text:string)=>void;
  readonly result:Promise<GeneratedProgress|undefined>;
  constructor(voice:FastProgressVoice,readonly input:string,readonly language:"bn"|"en",readonly context:ProgressContext,private operationKey?:string){
    this.result=voice.generate(context,language,this.controller.signal,6000,chunk=>{
      if(this.discarded)return;
      if(this.onAudio)this.onAudio(chunk);else this.chunks.push(chunk);
    },text=>{if(!this.discarded){this.text=text;this.onText?.(text);}})
      .then(result=>result,()=>undefined).finally(()=>{this.done=true;});
  }
  matches(input:string,language:"bn"|"en",context:ProgressContext,operationKey?:string){
    const prefix=normalize(this.input),full=normalize(input);
    return !this.discarded&&Date.now()-this.startedAt<=12_000&&this.language===language&&canPreviewProgress(input)&&
      (full===prefix||full.startsWith(prefix+" "))&&
      JSON.stringify(this.context.operation)===JSON.stringify(context.operation)&&this.operationKey===operationKey;
  }
  attach(onAudio:(chunk:string)=>void,onText:(text:string)=>void){
    if(this.discarded)return;
    this.onAudio=onAudio;this.onText=onText;
    if(this.text)onText(this.text);
    for(const chunk of this.chunks)onAudio(chunk);
    this.chunks=[];
  }
  discard(){
    this.discarded=true;this.chunks=[];this.onAudio=undefined;this.onText=undefined;
    if(!this.done)this.controller.abort();
  }
}
