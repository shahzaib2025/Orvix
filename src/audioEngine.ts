// Web Audio engine for Orvix Voice Sessions
// Handles 16kHz PCM capture (microphone) via AudioWorklet and 24kHz PCM playback queue.
import { SpeechActivityDetector } from "./speechActivity";

export const inputWorklet = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.chunk = new Int16Array(800);
    this.offset = 0;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i];
      this.count++;
      this.phase += 16000 / sampleRate;
      if (this.phase >= 1) {
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.chunk[this.offset++] = value < 0 ? value * 32768 : value * 32767;
        this.phase -= 1;
        this.sum = 0;
        this.count = 0;
        if (this.offset === this.chunk.length) {
          this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
          this.chunk = new Int16Array(800);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('orvix-pcm-capture', PcmCapture);
`;

export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 8192) {
    binary += String.fromCharCode(...view.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function mergeTranscript(previous: string, next: string): string {
  const piece = next.trim();
  if (!piece || previous === piece || previous.endsWith(piece)) return previous;
  if (piece.startsWith(previous)) return piece;
  return `${previous}${/\s$/.test(previous) || /^[.,!?;:]/.test(piece) ? "" : " "}${piece}`;
}

// Live output transcription is streamed in deltas. Repeated words and numbers
// are real speech and must not be removed by cumulative-input deduplication.
export function appendTranscription(previous: string, next: string): string {
  return previous + next;
}

export class AudioEngine {
  private captureEpoch = 0;
  private microphoneStarting?: Promise<void>;
  private lastInputAt = 0;
  private captureError = "";
  private context: AudioContext | null = null;
  private media: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private levelSamples = new Uint8Array(1024);
  private playing = new Set<AudioBufferSourceNode>();
  private playAt = 0;
  onPlaybackDrained?: () => void;

  get hasMicrophone(): boolean {
    return this.microphoneState==='active'||this.microphoneState==='muted';
  }
  get microphoneState(): "off"|"starting"|"active"|"muted"|"error" {
    if(this.microphoneStarting)return "starting";
    if(this.captureError)return "error";
    if(!this.media)return "off";
    const track=this.media.getAudioTracks()[0];
    if(!track||track.readyState!=='live')return "error";
    if(!track.enabled||track.muted)return "muted";
    if(this.context?.state!=='running'||Date.now()-this.lastInputAt>2000)return "error";
    return "active";
  }
  get hasPlayback(): boolean { return this.playing.size > 0; }

  get audioContext(): AudioContext | null {
    return this.context;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  async enableMicrophone(onPcmChunk: (base64Pcm: string) => void, onActivity?: (activity: "start" | "end") => void, timing?:{silenceMs:number}): Promise<void> {
    if(this.microphoneStarting)return this.microphoneStarting;
    const pending=this.startMicrophone(onPcmChunk,onActivity,timing);
    this.microphoneStarting=pending;
    try {await pending;}finally{if(this.microphoneStarting===pending)this.microphoneStarting=undefined;}
  }
  private async startMicrophone(onPcmChunk: (base64Pcm: string) => void, onActivity?: (activity: "start" | "end") => void, timing?:{silenceMs:number}): Promise<void> {
    if(this.media?.getAudioTracks().some(track=>track.readyState==='live')&&this.capture&&!this.captureError&&this.context?.state==='running'&&Date.now()-this.lastInputAt<2000)return;
    const epoch=++this.captureEpoch;
    const context = await this.ensureContext();
    if(epoch!==this.captureEpoch)throw new Error('Voice session was stopped.');
    this.releaseMicrophone();this.captureError="";
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is unavailable in this app.");
    }

    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if(epoch!==this.captureEpoch){media.getTracks().forEach(track=>track.stop());throw new Error('Voice session was stopped.');}
    this.media=media;this.lastInputAt=Date.now();
    for(const track of media.getAudioTracks())track.onended=()=>{if(this.media===media)this.captureError='Microphone disconnected.';};

    try {
      const workletUrl = URL.createObjectURL(new Blob([inputWorklet], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      if(epoch!==this.captureEpoch)throw new Error('Voice session was stopped.');

      this.source = context.createMediaStreamSource(this.media);
      this.capture = new AudioWorkletNode(context, "orvix-pcm-capture");
      this.sink = context.createGain();
      this.sink.gain.value = 0;

      const detector = onActivity ? new SpeechActivityDetector(timing?.silenceMs) : null;
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if(epoch!==this.captureEpoch)return;
        this.lastInputAt=Date.now();
        const activity = detector?.push(new Int16Array(event.data));
        try{if(activity)onActivity?.(activity);onPcmChunk(toBase64(event.data));}catch{this.captureError='Microphone transmission failed.';}
      };
      this.capture.onprocessorerror=()=>{if(epoch===this.captureEpoch)this.captureError='Microphone capture failed.';};

      this.source.connect(this.capture);
      this.capture.connect(this.sink);

      this.inputAnalyser = context.createAnalyser();
      this.inputAnalyser.fftSize = 1024;
      this.inputAnalyser.smoothingTimeConstant = 0.75;
      this.source.connect(this.inputAnalyser);
      this.inputAnalyser.connect(this.sink);

      this.sink.connect(context.destination);
    } catch (error) {
      if(epoch===this.captureEpoch){this.releaseMicrophone();this.captureError='Microphone capture failed.';}
      throw error;
    }
  }

  playAudio(encoded: string, onStart?: () => void): number | undefined {
    const context = this.context;
    if (!context || context.state !== "running") return;

    const raw = atob(encoded);
    const count = Math.floor(raw.length / 2);
    const buffer = context.createBuffer(1, count, 24_000);
    const samples = buffer.getChannelData(0);

    for (let i = 0; i < count; i++) {
      let sample = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      if (sample & 0x8000) sample -= 0x10000;
      samples[i] = sample / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    if (!this.outputAnalyser) {
      this.outputAnalyser = context.createAnalyser();
      this.outputAnalyser.fftSize = 1024;
      this.outputAnalyser.smoothingTimeConstant = 0.75;
      this.outputAnalyser.connect(context.destination);
    }

    source.connect(this.outputAnalyser);
    source.onended = () => {
      if (this.playing.delete(source) && this.playing.size === 0) this.onPlaybackDrained?.();
    };
    this.playing.add(source);

    this.playAt = Math.max(this.playAt, context.currentTime + 0.03);
    const scheduledAt = Date.now() + Math.max(0, this.playAt - context.currentTime) * 1000;
    const firstSound = onStart ? samples.findIndex(sample => Math.abs(sample) > 0.001) : -1;
    source.start(this.playAt);
    if (onStart && firstSound >= 0) {
      const onset = this.playAt + firstSound / buffer.sampleRate;
      // Audio-clock onset, not PCM arrival or generation completion. A paused
      // context cannot authorize dispatch, and cleared sources cannot fire late.
      const check = () => {
        if (!this.playing.has(source) || context.state === 'closed') return;
        if (context.state === 'running' && context.currentTime >= onset) { onStart(); return; }
        setTimeout(check, 10);
      };
      setTimeout(check, Math.max(0, (onset - context.currentTime) * 1000));
    }
    this.playAt += buffer.duration;
    return scheduledAt;
  }

  clearPlayback(): void {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.playing.clear();
    this.playAt = 0;
  }

  getAudioLevel(): number {
    const rms = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(this.levelSamples);
      let power = 0;
      for (const sample of this.levelSamples) {
        const value = (sample - 128) / 128;
        power += value * value;
      }
      return Math.sqrt(power / this.levelSamples.length);
    };
    return Math.min(1, Math.max(rms(this.inputAnalyser), rms(this.outputAnalyser)) * 4);
  }

  private releaseMicrophone(): void {
    if (this.capture) {
      this.capture.disconnect();
      this.capture = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect();
      this.inputAnalyser = null;
    }
    if (this.sink) {
      this.sink.disconnect();
      this.sink = null;
    }
    if (this.media) {
      this.media.getTracks().forEach(track => track.stop());
      this.media = null;
    }
  }
  close(): void {
    this.captureEpoch++;
    this.clearPlayback();this.releaseMicrophone();this.captureError="";
    if(this.outputAnalyser){this.outputAnalyser.disconnect();this.outputAnalyser=null;}
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }
}
