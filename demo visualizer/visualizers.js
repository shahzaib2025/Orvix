/**
 * Orvix AI Circular Voice Visualizer Engines
 * 4 Completely Distinct Motion Designs inside the sleek circular orb:
 * 
 * 1. Fluid Cloud (ChatGPT Voice): Multi-harmonic liquid wave with billowing white cloud foam (matching user's reference image).
 * 2. Plasma Blob (Siri / Apple Intelligence): 3D morphing organic jelly sphere with polar noise and chromatic refraction.
 * 3. Orbital Ribbon (Gemini Live): 3D parametric rotating twin-helix ribbons with glowing Mobius loops.
 * 4. Quantum Core (Living Star Nebula): Gravitational particle swarm with acoustic radial burst and constellation filaments.
 */

class CircularVisualizer {
  constructor(canvas, orbFrame, ambientBloom, audioEngine) {
    this.canvas = canvas;
    this.orbFrame = orbFrame;
    this.ambientBloom = ambientBloom;
    this.ctx = canvas.getContext('2d');
    this.audio = audioEngine;

    this.variant = 'fluid-cloud';
    this.time = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Particles for Quantum Core mode
    this.particles = [];
    this.initQuantumParticles();

    // Orbital ribbon rotation state
    this.ribbonAngleX = 0;
    this.ribbonAngleY = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  initQuantumParticles() {
    this.particles = [];
    const count = 160;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 35;
      this.particles.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        baseDist: dist,
        angle: angle,
        orbitSpeed: (Math.random() - 0.5) * 0.03,
        size: 1.2 + Math.random() * 2.5,
        alpha: 0.3 + Math.random() * 0.7,
        hue: Math.random() > 0.4 ? 200 + Math.random() * 40 : 35 + Math.random() * 25
      });
    }
  }

  resize() {
    const rect = this.orbFrame.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  setVariant(variant) {
    this.variant = variant;
    this.updateAmbientGlow();
  }

  updateAmbientGlow() {
    const glows = {
      'fluid-cloud': 'rgba(0, 119, 255, 0.5)',
      'plasma-blob': 'rgba(168, 85, 247, 0.48)',
      'orbital-ribbon': 'rgba(217, 70, 239, 0.48)',
      'quantum-core': 'rgba(245, 158, 11, 0.5)'
    };
    const glow = glows[this.variant] || glows['fluid-cloud'];
    this.ambientBloom.style.setProperty('--glow-color', glow);
  }

  /**
   * Master 60/120 FPS render loop.
   */
  render() {
    this.time += 0.02;
    const telem = this.audio.updateTelemetry();
    const energy = telem.smoothedEnergy;
    const bass = telem.smoothedBass;

    const cx = this.width / 2;
    const cy = this.height / 2;
    const radius = Math.min(cx, cy) - 0.5;

    // Organic scale pulse on voice/beat peaks
    const scale = 1.0 + energy * 0.06 + bass * 0.04;
    this.orbFrame.style.transform = `scale(${scale.toFixed(3)})`;

    this.ctx.clearRect(0, 0, this.width, this.height);

    // Save state and clip to circular lens
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.clip();

    // Render the selected motion design
    switch (this.variant) {
      case 'plasma-blob':
        this.renderPlasmaBlob(cx, cy, radius, telem);
        break;
      case 'orbital-ribbon':
        this.renderOrbitalRibbon(cx, cy, radius, telem);
        break;
      case 'quantum-core':
        this.renderQuantumCore(cx, cy, radius, telem);
        break;
      case 'fluid-cloud':
      default:
        this.renderFluidCloud(cx, cy, radius, telem);
        break;
    }

    // 3D Spherical Volume light overlay
    this.renderSphericalVolume(cx, cy, radius);

    this.ctx.restore();
  }

  /* ==========================================================================
     DESIGN 1: FLUID CLOUD (ChatGPT Voice - Exact match to user's photo)
     Multi-harmonic fluid liquid wave sloshing with billowing white clouds at top.
     ========================================================================== */
  renderFluidCloud(cx, cy, radius, telem) {
    const energy = telem.smoothedEnergy;
    const bass = telem.smoothedBass;
    const mid = telem.smoothedMid;
    const treble = telem.smoothedTreble;

    // 1. Deep Royal Ocean Blue Base Fill
    const baseGrad = this.ctx.createLinearGradient(0, 0, 0, this.height);
    baseGrad.addColorStop(0, '#0052cc');
    baseGrad.addColorStop(0.5, '#0066ff');
    baseGrad.addColorStop(1, '#003db3');
    this.ctx.fillStyle = baseGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // 2. Churning Liquid Layer 1 (Electric Azure Mid-Tide)
    this.drawFluidWave({
      baselineY: cy + radius * (0.05 - energy * 0.15),
      amplitude: 14 + mid * 24 + bass * 18,
      speed: 1.4,
      freq: 0.022,
      fillGradient: (ctx, y1, y2) => {
        const g = ctx.createLinearGradient(0, y1 - 20, 0, y2 + 20);
        g.addColorStop(0, '#00b4d8');
        g.addColorStop(0.4, '#0077fe');
        g.addColorStop(1, '#0048d0');
        return g;
      },
      alpha: 0.95
    });

    // 3. Churning Liquid Layer 2 (Sky Blue Swirl with voice harmonics)
    this.drawFluidWave({
      baselineY: cy - radius * (0.1 + energy * 0.18),
      amplitude: 18 + mid * 28 + treble * 16,
      speed: -1.8,
      freq: 0.028,
      fillGradient: (ctx, y1, y2) => {
        const g = ctx.createLinearGradient(0, y1 - 25, 0, y2 + 25);
        g.addColorStop(0, '#90e0ef');
        g.addColorStop(0.4, '#0096c7');
        g.addColorStop(1, 'rgba(0, 119, 254, 0.7)');
        return g;
      },
      alpha: 0.9
    });

    // 4. Luminous White Cloud Crest (Top billowing cloud)
    this.drawFluidWave({
      baselineY: cy - radius * (0.35 + energy * 0.22),
      amplitude: 15 + energy * 26 + treble * 20,
      speed: 1.2,
      freq: 0.034,
      fillGradient: (ctx, y1, y2) => {
        const g = ctx.createLinearGradient(0, 0, 0, y2 + 30);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, '#e0f2fe');
        g.addColorStop(0.85, '#bae6fd');
        g.addColorStop(1, 'rgba(186, 230, 253, 0)');
        return g;
      },
      alpha: 0.98
    });

    // 5. Ambient Top-Down Volumetric Light (White summit)
    const topCloudGrad = this.ctx.createRadialGradient(
      cx, cy - radius * 0.75, radius * 0.1,
      cx, cy - radius * 0.4, radius * 0.9
    );
    topCloudGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    topCloudGrad.addColorStop(0.35, 'rgba(224, 242, 254, 0.85)');
    topCloudGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.4)');
    topCloudGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.fillStyle = topCloudGrad;
    this.ctx.fillRect(0, 0, this.width, this.height * 0.7);
  }

  /* ==========================================================================
     DESIGN 2: PLASMA BLOB (Siri / 3D Deforming Organic Jelly Sphere)
     A 3D morphing organic plasma blob in fluid suspension that undulates
     and stretches organically in polar coordinates with speech harmonics.
     ========================================================================== */
  renderPlasmaBlob(cx, cy, radius, telem) {
    const energy = telem.smoothedEnergy;
    const bass = telem.smoothedBass;
    const mid = telem.smoothedMid;
    const treble = telem.smoothedTreble;

    // Dark Cosmic Violet Background
    const bgGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bgGrad.addColorStop(0, '#1a0b2e');
    bgGrad.addColorStop(0.7, '#0d041a');
    bgGrad.addColorStop(1, '#05010a');
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Multi-layer deforming organic blob shells
    const layers = [
      { rRatio: 0.75, speed: 1.0, colorStart: '#a855f7', colorMid: '#06b6d4', colorEnd: 'rgba(6, 182, 212, 0)', alpha: 0.45 },
      { rRatio: 0.62, speed: -1.4, colorStart: '#ec4899', colorMid: '#8b5cf6', colorEnd: 'rgba(139, 92, 246, 0.1)', alpha: 0.65 },
      { rRatio: 0.48, speed: 1.8, colorStart: '#06b6d4', colorMid: '#3b82f6', colorEnd: '#d946ef', alpha: 0.85 },
      { rRatio: 0.32, speed: -2.2, colorStart: '#ffffff', colorMid: '#e0e7ff', colorEnd: 'rgba(255, 255, 255, 0.2)', alpha: 0.95 }
    ];

    layers.forEach((layer, lIdx) => {
      const baseR = radius * layer.rRatio * (1 + energy * 0.2);
      const points = 90;
      const angleStep = (Math.PI * 2) / points;
      const phase = this.time * layer.speed;

      this.ctx.beginPath();

      for (let i = 0; i <= points; i++) {
        const theta = i * angleStep;

        // Polar noise deformation (Amoeba harmonic deformation)
        const harm1 = Math.sin(theta * 3 + phase) * (8 + bass * 22);
        const harm2 = Math.cos(theta * 5 - phase * 0.7) * (6 + mid * 16);
        const harm3 = Math.sin(theta * 7 + phase * 1.4) * (4 + treble * 12);
        const curR = Math.max(10, baseR + harm1 + harm2 + harm3);

        const x = cx + Math.cos(theta) * curR;
        const y = cy + Math.sin(theta) * curR;

        if (i === 0) {
          this.ctx.moveTo(x, y);
        } else {
          this.ctx.lineTo(x, y);
        }
      }

      this.ctx.closePath();

      // Fluid radial gradient fill
      const grad = this.ctx.createRadialGradient(
        cx - baseR * 0.2, cy - baseR * 0.2, baseR * 0.1,
        cx, cy, baseR * 1.2
      );
      grad.addColorStop(0, layer.colorStart);
      grad.addColorStop(0.5, layer.colorMid);
      grad.addColorStop(1, layer.colorEnd);

      this.ctx.fillStyle = grad;
      this.ctx.globalAlpha = layer.alpha;
      this.ctx.fill();

      // Translucent glowing contour rim
      if (lIdx === 0 || lIdx === 2) {
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1.5;
        this.ctx.globalAlpha = 0.4 + energy * 0.4;
        this.ctx.stroke();
      }
    });

    // Intense Super-Bright Plasma Core
    const coreR = radius * (0.2 + bass * 0.15);
    const coreGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.4, '#c084fc');
    coreGrad.addColorStop(1, 'rgba(192, 132, 252, 0)');
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    this.ctx.fillStyle = coreGrad;
    this.ctx.globalAlpha = 0.9;
    this.ctx.fill();
  }

  /* ==========================================================================
     DESIGN 3: ORBITAL RIBBON (Gemini Live - 3D Mobius Double Helix Loops)
     3D parametric twisted ribbons that revolve in space inside the sphere,
     pulsating in radius, speed, and brightness on voice activity.
     ========================================================================== */
  renderOrbitalRibbon(cx, cy, radius, telem) {
    const energy = telem.smoothedEnergy;
    const bass = telem.smoothedBass;
    const mid = telem.smoothedMid;
    const treble = telem.smoothedTreble;

    // Deep Midnight Abyss Background
    const bgGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bgGrad.addColorStop(0, '#090d16');
    bgGrad.addColorStop(0.7, '#04070d');
    bgGrad.addColorStop(1, '#000205');
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ribbonAngleX += 0.015 + energy * 0.02;
    this.ribbonAngleY += 0.022 + bass * 0.025;

    // Draw 3 Interlocking 3D Parametric Mobius Ribbon Loops
    const loops = 3;
    const samples = 140;

    for (let l = 0; l < loops; l++) {
      const loopOffset = (l * Math.PI * 2) / loops;
      const baseLoopR = radius * (0.58 + l * 0.08) * (1 + energy * 0.18);
      const points = [];

      for (let i = 0; i <= samples; i++) {
        const u = (i / samples) * Math.PI * 2;

        // 3D Parametric Torus Knot / Mobius Ribbon Equation
        const p = 2; // Torus frequency
        const q = 3;
        const rTor = baseLoopR * (0.8 + 0.25 * Math.cos(q * u + this.time * 2 + loopOffset));
        let x3 = rTor * Math.cos(p * u);
        let y3 = rTor * Math.sin(p * u);
        let z3 = baseLoopR * 0.45 * Math.sin(q * u + this.time * 2 + loopOffset);

        // Perturb with speech treble/mid harmonics
        const ripple = Math.sin(u * 12 + this.time * 6) * (treble * 10);
        x3 += ripple;
        y3 += ripple;

        // 3D Rotation Matrix
        const cosX = Math.cos(this.ribbonAngleX + l);
        const sinX = Math.sin(this.ribbonAngleX + l);
        const cosY = Math.cos(this.ribbonAngleY + l);
        const sinY = Math.sin(this.ribbonAngleY + l);

        // Rotate Y
        const x3y = x3 * cosY + z3 * sinY;
        const z3y = -x3 * sinY + z3 * cosY;

        // Rotate X
        const y3x = y3 * cosX - z3y * sinX;
        const z3x = y3 * sinX + z3y * cosX;

        // Perspective Projection
        const fov = 320;
        const scale3d = fov / (fov + z3x);
        const x2d = cx + x3y * scale3d;
        const y2d = cy + y3x * scale3d;

        points.push({ x: x2d, y: y2d, z: z3x, scale: scale3d });
      }

      // Draw Ribbon Path with Gradient
      this.ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        if (i === 0) this.ctx.moveTo(points[i].x, points[i].y);
        else this.ctx.lineTo(points[i].x, points[i].y);
      }

      // Gemini Tri-chromatic Spectrum
      const ribbonGrad = this.ctx.createLinearGradient(
        cx - baseLoopR, cy - baseLoopR,
        cx + baseLoopR, cy + baseLoopR
      );
      if (l === 0) {
        ribbonGrad.addColorStop(0, '#38bdf8');
        ribbonGrad.addColorStop(0.4, '#818cf8');
        ribbonGrad.addColorStop(0.8, '#d946ef');
        ribbonGrad.addColorStop(1, '#f59e0b');
      } else if (l === 1) {
        ribbonGrad.addColorStop(0, '#d946ef');
        ribbonGrad.addColorStop(0.5, '#f59e0b');
        ribbonGrad.addColorStop(1, '#38bdf8');
      } else {
        ribbonGrad.addColorStop(0, '#818cf8');
        ribbonGrad.addColorStop(0.6, '#38bdf8');
        ribbonGrad.addColorStop(1, '#ffffff');
      }

      this.ctx.strokeStyle = ribbonGrad;
      this.ctx.lineWidth = (3.5 + mid * 4) * (l === 0 ? 1 : 0.7);
      this.ctx.lineCap = 'round';
      this.ctx.globalAlpha = 0.75 + energy * 0.25;
      this.ctx.stroke();

      // Node Sparks along the ribbon
      const sparkIdx = Math.floor(((this.time * 25 + l * 40) % samples));
      if (points[sparkIdx]) {
        const sp = points[sparkIdx];
        this.ctx.beginPath();
        this.ctx.arc(sp.x, sp.y, 4 + treble * 6, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.globalAlpha = 0.95;
        this.ctx.fill();
      }
    }

    // Central Floating Luminous Core
    const orbGlow = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.28);
    orbGlow.addColorStop(0, '#ffffff');
    orbGlow.addColorStop(0.3, '#38bdf8');
    orbGlow.addColorStop(0.7, 'rgba(129, 140, 248, 0.4)');
    orbGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius * (0.24 + bass * 0.12), 0, Math.PI * 2);
    this.ctx.fillStyle = orbGlow;
    this.ctx.globalAlpha = 0.85;
    this.ctx.fill();
  }

  /* ==========================================================================
     DESIGN 4: QUANTUM CORE (Living Star Nebula / Gravitational Swarm)
     Dense swarming stellar particles governed by gravity and acoustic shockwaves.
     Tight planetary nucleus on silence -> Explosive solar starburst on speech!
     ========================================================================== */
  renderQuantumCore(cx, cy, radius, telem) {
    const energy = telem.smoothedEnergy;
    const bass = telem.smoothedBass;
    const mid = telem.smoothedMid;
    const treble = telem.smoothedTreble;

    // Deep Obsidian Crimson / Space Background
    const bgGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bgGrad.addColorStop(0, '#1c0a00');
    bgGrad.addColorStop(0.65, '#0a0300');
    bgGrad.addColorStop(1, '#000000');
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Particle Swarm Physics
    const burstForce = (energy * 55 + bass * 60);

    this.particles.forEach((p, idx) => {
      // Orbiting around central gravitational singularity
      p.angle += p.orbitSpeed * (1 + energy * 2.5);

      // Acoustic repelling pressure expands particles outward
      const currentDist = p.baseDist + burstForce * (0.4 + (idx % 5) * 0.15) + Math.sin(this.time * 3 + idx) * (6 + mid * 14);

      // Bound within the circular boundary
      const clampedDist = Math.min(radius * 0.92, currentDist);
      const targetX = Math.cos(p.angle) * clampedDist;
      const targetY = Math.sin(p.angle) * clampedDist;

      p.x += (targetX - p.x) * 0.14;
      p.y += (targetY - p.y) * 0.14;

      const screenX = cx + p.x;
      const screenY = cy + p.y;
      const pScale = p.size * (1 + treble * 1.4);

      // Draw Particle
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, pScale, 0, Math.PI * 2);
      this.ctx.fillStyle = p.hue > 150 ? '#38bdf8' : '#fbbf24';
      this.ctx.globalAlpha = p.alpha * (0.6 + energy * 0.4);
      this.ctx.fill();
    });

    // Connecting Synaptic Energy Threads between nearby stellar particles
    const maxLinkDist = 32 + mid * 22;
    this.ctx.lineWidth = 0.8 + energy * 0.8;

    for (let i = 0; i < this.particles.length; i += 2) {
      const a = this.particles[i];
      for (let j = i + 1; j < Math.min(i + 8, this.particles.length); j++) {
        const b = this.particles[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxLinkDist) {
          this.ctx.beginPath();
          this.ctx.moveTo(cx + a.x, cy + a.y);
          this.ctx.lineTo(cx + b.x, cy + b.y);
          this.ctx.strokeStyle = i % 4 === 0 ? '#f59e0b' : '#38bdf8';
          this.ctx.globalAlpha = (1 - dist / maxLinkDist) * (0.2 + energy * 0.6);
          this.ctx.stroke();
        }
      }
    }

    // Stellar Nuclear Heart (Living Star)
    const starR = radius * (0.26 + bass * 0.18);
    const starGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, starR);
    starGrad.addColorStop(0, '#ffffff');
    starGrad.addColorStop(0.3, '#fef08a');
    starGrad.addColorStop(0.65, '#f59e0b');
    starGrad.addColorStop(0.9, 'rgba(234, 88, 12, 0.4)');
    starGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.beginPath();
    this.ctx.arc(cx, cy, starR, 0, Math.PI * 2);
    this.ctx.fillStyle = starGrad;
    this.ctx.globalAlpha = 0.95;
    this.ctx.fill();
  }

  /**
   * Helper: Multi-harmonic fluid wave drawer for Fluid Cloud mode.
   */
  drawFluidWave(cfg) {
    const { baselineY, amplitude, speed, freq, fillGradient, alpha } = cfg;
    const step = 3;
    const w = this.width;
    const h = this.height;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.moveTo(0, h);

    const phase = this.time * speed;

    for (let x = 0; x <= w; x += step) {
      const yOffset =
        Math.sin(x * freq + phase) * amplitude +
        Math.cos(x * freq * 1.8 - phase * 0.7) * (amplitude * 0.45) +
        Math.sin(x * freq * 3.2 + phase * 1.3) * (amplitude * 0.22);

      const y = baselineY + yOffset;
      this.ctx.lineTo(x, y);
    }

    this.ctx.lineTo(w, h);
    this.ctx.closePath();

    this.ctx.fillStyle = fillGradient(this.ctx, baselineY - amplitude, baselineY + amplitude);
    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * Spherical 3D Volume Light & Vignette (Gives the sphere realistic physical depth)
   */
  renderSphericalVolume(cx, cy, radius) {
    // 1. Soft spherical shadow around perimeter
    const rimShadow = this.ctx.createRadialGradient(cx, cy, radius * 0.75, cx, cy, radius);
    rimShadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rimShadow.addColorStop(0.85, 'rgba(0, 0, 0, 0.2)');
    rimShadow.addColorStop(1, 'rgba(0, 0, 0, 0.55)');

    this.ctx.fillStyle = rimShadow;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // 2. Subtle top-left specular highlight
    const specGrad = this.ctx.createRadialGradient(
      cx - radius * 0.35, cy - radius * 0.38, radius * 0.05,
      cx - radius * 0.2, cy - radius * 0.2, radius * 0.75
    );
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    specGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.08)');
    specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    this.ctx.fillStyle = specGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }
}
