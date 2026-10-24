/**
 * Orvix Resonance • Core Audio Engine
 * Handles Web Audio API Context, Microphone Capture, File Player,
 * and Procedural Ambient Synth Generator with Multi-Band Telemetry Analysis.
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gainNode = null;
    this.source = null;
    
    // Audio Buffers & Arrays
    this.fftSize = 1024;
    this.frequencyData = new Uint8Array(this.fftSize / 2);
    this.timeDomainData = new Uint8Array(this.fftSize);

    // Filtered / Smoothed Telemetry
    this.telemetry = {
      bass: 0,
      mid: 0,
      treble: 0,
      energy: 0,
      peak: 0,
      smoothedBass: 0,
      smoothedMid: 0,
      smoothedTreble: 0,
      smoothedEnergy: 0
    };

    // Sensitivity boost factor
    this.sensitivity = 1.3;

    // Active state
    this.activeSourceType = null; // 'mic' | 'synth' | 'file' | null
    this.isPlaying = false;

    // File playback
    this.audioElement = null;
    this.fileSourceNode = null;

    // Mic stream
    this.micStream = null;

    // Procedural Synth Engine
    this.synthInterval = null;
    this.synthMasterGain = null;
  }

  /**
   * Initializes the AudioContext on first user gesture.
   */
  async init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.82;

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1.0;
      this.gainNode.connect(this.analyser);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Disconnects and cleans up previous active source.
   */
  cleanupCurrentSource() {
    // Stop synth if running
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
    if (this.synthMasterGain) {
      try { this.synthMasterGain.disconnect(); } catch (e) {}
      this.synthMasterGain = null;
    }

    // Stop mic stream
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }

    // Stop file audio
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }

    // Disconnect old source node
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }

    this.isPlaying = false;
    this.activeSourceType = null;
  }

  /**
   * Toggles Microphone input.
   */
  async toggleMic() {
    await this.init();

    if (this.activeSourceType === 'mic') {
      this.cleanupCurrentSource();
      return false;
    }

    this.cleanupCurrentSource();

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.source = this.ctx.createMediaStreamSource(this.micStream);
      // Connect to analyser (GainNode), but NOT to destination (ctx.destination) to avoid feedback screech!
      this.source.connect(this.gainNode);

      this.activeSourceType = 'mic';
      this.isPlaying = true;
      return true;
    } catch (err) {
      console.error('Microphone access denied or unavailable:', err);
      alert('Microphone permission was denied. Please allow microphone access or try the Demo Track.');
      this.cleanupCurrentSource();
      return false;
    }
  }

  /**
   * Toggles the Procedural Ambient Synth & Beats Generator.
   * Creates an evolving electronic soundscape with chords, sub-bass, and arps.
   */
  async toggleSynth() {
    await this.init();

    if (this.activeSourceType === 'synth') {
      this.cleanupCurrentSource();
      return false;
    }

    this.cleanupCurrentSource();

    // Create synth master bus with connection to speakers & analyser
    this.synthMasterGain = this.ctx.createGain();
    this.synthMasterGain.gain.value = 0.7;

    // Connect to analyser
    this.synthMasterGain.connect(this.gainNode);
    // Connect to speakers
    this.synthMasterGain.connect(this.ctx.destination);

    this.activeSourceType = 'synth';
    this.isPlaying = true;

    this._startProceduralMusic();
    return true;
  }

  /**
   * Procedural Audio Generator: produces evolving cyberpunk/ambient pads, chords, and rhythmic bass.
   */
  _startProceduralMusic() {
    // Chord progression in D minor / F Major (Futuristic cinematic feel)
    const chords = [
      [146.83, 220.00, 261.63, 349.23], // Dm7 (D3, A3, C4, F4)
      [130.81, 196.00, 261.63, 329.63], // Cmaj7 (C3, G3, C4, E4)
      [116.54, 174.61, 220.00, 293.66], // Bbmaj7 (Bb2, F3, A3, D4)
      [174.61, 261.63, 329.63, 392.00]  // Fmaj9 (F3, C4, E4, G4)
    ];

    let chordIndex = 0;
    let step = 0;

    const playStep = () => {
      if (!this.isPlaying || this.activeSourceType !== 'synth' || !this.ctx) return;

      const now = this.ctx.currentTime;
      const currentChord = chords[chordIndex];

      // 1. Bass Pulse on every 4 steps
      if (step % 4 === 0) {
        const bassFreq = currentChord[0] / 2; // Sub-octave
        const bassOsc = this.ctx.createOscillator();
        const bassFilter = this.ctx.createBiquadFilter();
        const bassGain = this.ctx.createGain();

        bassOsc.type = 'sawtooth';
        bassOsc.frequency.setValueAtTime(bassFreq, now);

        bassFilter.type = 'lowpass';
        bassFilter.frequency.setValueAtTime(300, now);
        bassFilter.frequency.exponentialRampToValueAtTime(80, now + 0.6);

        bassGain.gain.setValueAtTime(0.5, now);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

        bassOsc.connect(bassFilter);
        bassFilter.connect(bassGain);
        bassGain.connect(this.synthMasterGain);

        bassOsc.start(now);
        bassOsc.stop(now + 0.7);
      }

      // 2. Lush Ambient Pad Chords (every 8 steps)
      if (step % 8 === 0) {
        currentChord.forEach((freq, idx) => {
          const padOsc = this.ctx.createOscillator();
          const padGain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();

          padOsc.type = idx % 2 === 0 ? 'sine' : 'triangle';
          padOsc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 1.5, now);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(600 + Math.sin(now) * 200, now);
          filter.Q.value = 2;

          padGain.gain.setValueAtTime(0.01, now);
          padGain.gain.linearRampToValueAtTime(0.12, now + 0.8);
          padGain.gain.exponentialRampToValueAtTime(0.001, now + 2.8);

          padOsc.connect(filter);
          filter.connect(padGain);
          padGain.connect(this.synthMasterGain);

          padOsc.start(now);
          padOsc.stop(now + 2.9);
        });
      }

      // 3. Sparkling Ethereal Arpeggio (every 2 steps)
      if (step % 2 === 0) {
        const arpNote = currentChord[(step / 2) % currentChord.length] * 2; // High octave
        const arpOsc = this.ctx.createOscillator();
        const arpGain = this.ctx.createGain();

        arpOsc.type = 'sine';
        arpOsc.frequency.setValueAtTime(arpNote, now);

        arpGain.gain.setValueAtTime(0.08, now);
        arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        arpOsc.connect(arpGain);
        arpGain.connect(this.synthMasterGain);

        arpOsc.start(now);
        arpOsc.stop(now + 0.36);
      }

      // Progress sequencer
      step++;
      if (step % 16 === 0) {
        chordIndex = (chordIndex + 1) % chords.length;
      }
    };

    // 130 BPM subdivision (~115ms per 16th note)
    this.synthInterval = setInterval(playStep, 180);
    playStep();
  }

  /**
   * Loads and plays a local user audio file.
   */
  async loadAudioFile(file) {
    await this.init();
    this.cleanupCurrentSource();

    const fileUrl = URL.createObjectURL(file);
    this.audioElement = new Audio(fileUrl);
    this.audioElement.loop = true;

    this.source = this.ctx.createMediaElementSource(this.audioElement);
    this.source.connect(this.gainNode);
    this.source.connect(this.ctx.destination); // Play to speakers

    await this.audioElement.play();
    this.activeSourceType = 'file';
    this.isPlaying = true;
    return true;
  }

  /**
   * Updates and returns real-time frequency, waveform, and isolated band telemetry.
   * Uses damping / smoothing filters for ultra-fluid animations.
   */
  updateTelemetry() {
    if (!this.analyser) {
      return this.telemetry;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);

    const binCount = this.analyser.frequencyBinCount;
    const sampleRate = this.ctx ? this.ctx.sampleRate : 44100;
    const hzPerBin = (sampleRate / 2) / binCount;

    // Isolate frequency bands
    let bassSum = 0, bassCount = 0;
    let midSum = 0, midCount = 0;
    let trebleSum = 0, trebleCount = 0;
    let totalEnergy = 0;

    for (let i = 0; i < binCount; i++) {
      const freq = i * hzPerBin;
      const val = this.frequencyData[i] / 255;
      totalEnergy += val;

      if (freq >= 20 && freq <= 250) {
        bassSum += val;
        bassCount++;
      } else if (freq > 250 && freq <= 2000) {
        midSum += val;
        midCount++;
      } else if (freq > 2000 && freq <= 10000) {
        trebleSum += val;
        trebleCount++;
      }
    }

    const rawBass = (bassCount > 0 ? (bassSum / bassCount) : 0) * this.sensitivity;
    const rawMid = (midCount > 0 ? (midSum / midCount) : 0) * this.sensitivity;
    const rawTreble = (trebleCount > 0 ? (trebleSum / trebleCount) : 0) * this.sensitivity;
    const rawEnergy = (binCount > 0 ? (totalEnergy / binCount) : 0) * this.sensitivity;

    // Apply clamped normalized values
    this.telemetry.bass = Math.min(1.0, rawBass);
    this.telemetry.mid = Math.min(1.0, rawMid);
    this.telemetry.treble = Math.min(1.0, rawTreble);
    this.telemetry.energy = Math.min(1.0, rawEnergy);

    // Smooth lerp (Exponential damping)
    const lerpRate = 0.15;
    this.telemetry.smoothedBass += (this.telemetry.bass - this.telemetry.smoothedBass) * lerpRate;
    this.telemetry.smoothedMid += (this.telemetry.mid - this.telemetry.smoothedMid) * lerpRate;
    this.telemetry.smoothedTreble += (this.telemetry.treble - this.telemetry.smoothedTreble) * lerpRate;
    this.telemetry.smoothedEnergy += (this.telemetry.energy - this.telemetry.smoothedEnergy) * lerpRate;

    return this.telemetry;
  }
}
