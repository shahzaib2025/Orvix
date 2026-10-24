// Voice Session Facade for Orvix.
// Routes requests to either FastVoiceSession or ThinkingVoiceSession based on user profile.

import { SimpleFastVoiceSession as FastVoiceSession } from "./simpleFastVoice";
import { connectTinyWorkflowVoice, recordTinyWorkflowHumanInput } from './tinyAgentTools';
import { screenSharingCommand } from './screenSharingCommands';
import { isMemoryControl } from './companionMemory';
import { ThinkingVoiceSession, formatUserIdentityContext } from "./thinkingVoice";
import type {
  ThinkingDepth,
  UserIdentity,
  VoiceProgress,
  VoiceStatus,
  VoiceTranscript,
} from "./thinkingVoice";

export type VoiceProfile = "Fast" | "Thinking";
export type { ThinkingDepth, UserIdentity, VoiceProgress, VoiceStatus, VoiceTranscript };
export { formatUserIdentityContext };

export interface VoiceCallbacks {
  onSpeechCaption?: (value: { text?: string; speaking: boolean }) => void;
  onStatus: (status: VoiceStatus, detail?: string) => void;
  onTranscript: (value: VoiceTranscript) => void;
  onProgress?: (value: VoiceProgress) => void;
  onScreenSharingCommand?: (text: string) => boolean;
  onMemoryCommand?: (text: string) => boolean;
}

export class VoiceSession {
  private delegate: FastVoiceSession | ThinkingVoiceSession;
  private readonly workflowSessionId=crypto.randomUUID();
  private unsubscribeWorkflow?:()=>void;
  private unsubscribeBackground?:()=>void;
  private voiceStatus:VoiceStatus='off';
  private notices:string[]=[];
  private noticeTimer?:ReturnType<typeof setTimeout>;

  constructor(
    readonly profile: VoiceProfile,
    readonly depth: ThinkingDepth,
    history: { role: "user" | "assistant"; text: string; delivery?: "complete" | "interrupted" }[],
    callbacks: VoiceCallbacks,
    userIdentity?: UserIdentity | null,
    memoryProjectId?: string
  ) {
    const connectedCallbacks:VoiceCallbacks={...callbacks,onStatus:(status,detail)=>{this.voiceStatus=status;callbacks.onStatus(status,detail);this.scheduleNotice();},onTranscript:value=>{if(value.role==='user'&&!isMemoryControl(value.text)&&!screenSharingCommand(value.text)&&!value.text.startsWith('System workflow observation')) recordTinyWorkflowHumanInput(this.profile,value.id,value.text,this.workflowSessionId);callbacks.onTranscript(value);}};
    if (profile === "Fast") {
      this.delegate = new FastVoiceSession(history, connectedCallbacks, userIdentity);
    } else {
      this.delegate = new ThinkingVoiceSession(depth, history, connectedCallbacks, userIdentity);
    }
    this.delegate.setMemoryProject(memoryProjectId);
  }

  get hasMicrophone(): boolean {
    return this.delegate.hasMicrophone;
  }
  get microphoneState() { return this.delegate.microphoneState; }

  getAudioLevel(): number {
    return this.delegate.getAudioLevel();
  }

  async start(microphone = true): Promise<void> {
    this.unsubscribeBackground=window.orvixDesktop?.onWindowBackgrounded?.(()=>this.stop());
    connectTinyWorkflowVoice(this.workflowSessionId);
    this.unsubscribeWorkflow=window.orvixDesktop?.onTinyWorkflowEvent?.(event=>{if(['run_verified','run_needs_attention','approval_required'].includes(event.kind)||event.kind==='worker_progress'&&['approval','clarification'].includes(String(event.worker?.type))) {this.notices.push(`Run ${event.runId}: ${event.kind}. ${event.message??''}`);this.scheduleNotice();}});
    return this.delegate.start(microphone);
  }

  private scheduleNotice() {if(this.noticeTimer||this.voiceStatus!=='listening'||!this.notices.length) return;this.noticeTimer=setTimeout(()=>{this.noticeTimer=undefined;if(this.voiceStatus==='listening'&&this.notices.length) this.delegate.sendText('System workflow observation (not human input or authorization): '+this.notices.splice(0).join('; ')+'. Briefly announce these observed outcomes and offer review if needed. Do not start, approve or cancel anything.');},1500);}

  async enableMicrophone(): Promise<void> {
    return this.delegate.enableMicrophone();
  }

  sendText(text: string): void {
    recordTinyWorkflowHumanInput(this.profile,crypto.randomUUID(),text,this.workflowSessionId);
    this.delegate.sendText(text);
  }
  setScreenSharing(active:boolean):void {this.delegate.setScreenSharing(active);}
  sendScreenFrame(frame:string|import("./screenSharing").ScreenFrame):boolean {return this.delegate.sendScreenFrame(frame);}

  updateIdentity(identity?: UserIdentity | null): void {
    this.delegate.updateIdentity(identity);
  }

  stop(): void {
    this.unsubscribeBackground?.();this.unsubscribeBackground=undefined;
    this.unsubscribeWorkflow?.();this.unsubscribeWorkflow=undefined;clearTimeout(this.noticeTimer);this.noticeTimer=undefined;this.notices=[];connectTinyWorkflowVoice(undefined,this.workflowSessionId);
    this.delegate.setScreenSharing(false);this.delegate.stop();
  }
}
