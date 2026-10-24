import bank from './fastAckClips.json';
import { toolAcknowledgment } from './fastToolAcknowledgment';
import type { ProgressContext, GeneratedProgress } from './fastProgressVoice';

// Bundled, reviewed generic speech. No network, private task text or generation
// occurs on this path. Audio is PCM16 at 24 kHz, as required by AudioEngine.
export function preparedToolAcknowledgment(context: ProgressContext, language: 'bn' | 'en'): GeneratedProgress | undefined {
  if(context.researchNotice)return undefined;
  const clip = (bank as Record<string, { text: string; audio: string[] }>)[toolAcknowledgment(context, language)];
  return clip ? { ...clip, generationMs: 0 } : undefined;
}
