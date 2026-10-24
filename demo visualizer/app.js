/**
 * Orvix AI Circular Voice Visualizer • Main Controller
 * Coordinates audio sources, circular visualizer variants, orb sizing, and event handling.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const orbCanvas = document.getElementById('orb-canvas');
  const orbFrame = document.getElementById('orb-frame');
  const ambientBloom = document.getElementById('ambient-bloom');
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  const modeBadge = document.getElementById('mode-badge');

  // Controls
  const btnDemoSound = document.getElementById('btn-demo-sound');
  const btnMic = document.getElementById('btn-mic');
  const fileInput = document.getElementById('file-input');
  const demoBtnText = document.getElementById('demo-btn-text');
  const micBtnText = document.getElementById('mic-btn-text');
  const sensitivitySlider = document.getElementById('sensitivity-slider');

  // Tab & Size buttons
  const tabButtons = document.querySelectorAll('.tab-btn');
  const sizeButtons = document.querySelectorAll('.size-btn');

  // Instantiate Engine & Visualizer
  const audio = new AudioEngine();
  const visualizer = new CircularVisualizer(orbCanvas, orbFrame, ambientBloom, audio);

  // Variant names for badge
  const variantTitles = {
    'fluid-cloud': 'ChatGPT Fluid Cloud',
    'plasma-blob': 'Siri Organic Plasma',
    'orbital-ribbon': 'Gemini Orbital Helix',
    'quantum-core': 'Quantum Living Star'
  };

  /**
   * Updates UI state when audio starts/stops.
   */
  function updateAudioState() {
    const isPlaying = audio.isPlaying;
    const iconPlay = btnDemoSound.querySelector('.icon-play');
    const iconPause = btnDemoSound.querySelector('.icon-pause');

    if (isPlaying) {
      statusDot.classList.add('active');
      statusLabel.textContent = 'Listening / Active';
    } else {
      statusDot.classList.remove('active');
      statusLabel.textContent = 'Idle';
    }

    // Demo sound button
    if (audio.activeSourceType === 'synth') {
      btnDemoSound.classList.add('is-active');
      iconPlay.style.display = 'none';
      iconPause.style.display = 'inline';
      demoBtnText.textContent = 'Pause Sound';
    } else {
      btnDemoSound.classList.remove('is-active');
      iconPlay.style.display = 'inline';
      iconPause.style.display = 'none';
      demoBtnText.textContent = 'Demo Sound';
    }

    // Mic button
    if (audio.activeSourceType === 'mic') {
      btnMic.classList.add('is-active');
      micBtnText.textContent = 'Mic Active';
    } else {
      btnMic.classList.remove('is-active');
      micBtnText.textContent = 'Live Mic';
    }
  }

  // --- Audio Source Events ---

  // 1. Demo Sound / Voice Cadence
  btnDemoSound.addEventListener('click', async () => {
    await audio.toggleSynth();
    updateAudioState();
  });

  // 2. Microphone
  btnMic.addEventListener('click', async () => {
    await audio.toggleMic();
    updateAudioState();
  });

  // 3. Audio File Upload
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await audio.loadAudioFile(file);
      updateAudioState();
    }
  });

  // Click on Orb to toggle Demo Sound
  orbFrame.addEventListener('click', () => {
    btnDemoSound.click();
  });

  // Drag & drop audio file anywhere on window
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/')) {
        await audio.loadAudioFile(file);
        updateAudioState();
      }
    }
  });

  // --- Variant Switching (4 Distinct Modes) ---
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const variant = btn.dataset.variant;
      visualizer.setVariant(variant);
      modeBadge.textContent = variantTitles[variant] || variant;
    });
  });

  // --- Size Switching (Mini / Medium / Large) ---
  sizeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      sizeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const size = btn.dataset.size;
      orbFrame.classList.remove('size-mini', 'size-medium', 'size-large');
      orbFrame.classList.add(`size-${size}`);

      // Re-measure after CSS dimension update
      setTimeout(() => {
        visualizer.resize();
      }, 50);
    });
  });

  // --- Sensitivity Slider ---
  sensitivitySlider.addEventListener('input', (e) => {
    audio.sensitivity = parseFloat(e.target.value);
  });

  // --- Keyboard Shortcuts ---
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      btnDemoSound.click();
    }
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
      const idx = parseInt(e.key, 10) - 1;
      if (tabButtons[idx]) {
        tabButtons[idx].click();
      }
    }
  });

  // --- Master 60/120 FPS Animation Loop ---
  function loop() {
    visualizer.render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
