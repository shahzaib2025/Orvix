import { useEffect, useRef } from "react";
import type { VoiceSession } from "../liveVoice";

export default function HaloVisualizer({ session, reducedMotion }: { session: VoiceSession | null; reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const size = 128;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let frame = 0;
    let smoothed = 0;

    const draw = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      const t = reducedMotion ? 0 : now / 1000;
      smoothed += ((session?.getAudioLevel() ?? 0) - smoothed) * 0.16;
      const energy = reducedMotion ? 0 : Math.max(0.1, smoothed);
      const center = size / 2;
      context.clearRect(0, 0, size, size);
      const glow = context.createRadialGradient(center, center, 0, center, center, size * 0.44);
      glow.addColorStop(0, "#8cddbd2b");
      glow.addColorStop(1, "#8cddbd00");
      context.fillStyle = glow;
      context.fillRect(0, 0, size, size);

      for (let layer = 0; layer < 3; layer++) {
        context.beginPath();
        for (let i = 0; i <= 128; i++) {
          const angle = i * Math.PI * 2 / 128;
          const ripple = Math.sin(angle * 5 - t * (1.3 + layer * 0.2) + layer) * energy * 5
            + Math.sin(angle * 3 + t * 0.65 + layer) * 1.5;
          const radius = size * (0.22 + layer * 0.07) + ripple;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.strokeStyle = ["#8dd5bb55", "#a1e2ccbb", "#d1fae6a3"][layer];
        context.lineWidth = layer === 1 ? 1.5 : 1;
        context.shadowBlur = layer === 1 ? 12 : 0;
        context.shadowColor = "#90dbbe";
        context.stroke();
      }
      context.shadowBlur = 0;
      context.fillStyle = "#c9f3e3";
      context.beginPath();
      context.arc(center, center, 2.4 + energy * 2.5, 0, Math.PI * 2);
      context.fill();
      if (!reducedMotion) frame = requestAnimationFrame(draw);
    };
    const syncVisibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [session, reducedMotion]);

  return <div className="home-halo" role="img" aria-label="Live audio visualizer"><canvas ref={canvasRef} aria-hidden="true" /></div>;
}
