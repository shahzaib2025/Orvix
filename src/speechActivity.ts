// Detect sustained activity in echo-cancelled microphone PCM, never in output audio.
// This fast local cutoff supplements Gemini's speech recognition; it does not replace it.
export class SpeechActivityDetector {
  constructor(private silenceMs=600) {}
  private noiseFloor = 0.002;
  private onsetMs = 0;
  private quietMs = 0;
  private active = false;

  push(samples: Int16Array): "start" | "end" | undefined {
    if (!samples.length) return;
    const durationMs = samples.length / 16;
    let power = 0, peak = 0, crossings = 0;
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i] / 32768;
      power += value * value; peak = Math.max(peak, Math.abs(value));
      if (i && (samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
    }
    const rms = Math.sqrt(power / samples.length);
    const threshold = Math.max(0.008, this.noiseFloor * 3);
    const crossingRate = crossings / (durationMs / 1000);
    const voiced = rms >= (this.active ? threshold * 0.55 : threshold)
      && crossingRate >= 70 && crossingRate <= 6500 && peak / Math.max(rms, 0.00001) >= 1.55;
    if (!this.active && rms < threshold) this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
    if (voiced) {
      this.quietMs = 0; this.onsetMs += durationMs;
      if (!this.active && this.onsetMs >= 100) { this.active = true; return "start"; }
    } else {
      this.onsetMs = 0;
      if (this.active) {
        this.quietMs += durationMs;
        if (this.quietMs >= this.silenceMs) { this.active = false; this.quietMs = 0; return "end"; }
      }
    }
  }
}
