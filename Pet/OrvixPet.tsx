import { useEffect, useRef, useState, useCallback, useMemo } from "react";

export type PetPose =
  | "idle"
  | "sit"
  | "lay"
  | "walkA"
  | "walkB"
  | "hang"
  | "sleep"
  | "spin"
  | "bounce"
  | "curious"
  | "dizzy";

export type PetMood =
  | "idle"
  | "listening"
  | "speaking"
  | "working"
  | "question"
  | "done"
  | "error"
  | "offline"
  | "angry";

export type PetAccessory = "none" | "hat" | "gun" | "hat_and_gun";

interface OrvixPetProps {
  mood: PetMood;
  pose: PetPose;
  label: string;
  flipX?: boolean;
  accessory?: PetAccessory;
  isSpeaking?: boolean;
  hideLabel?: boolean;
  mousePos?: { x: number; y: number };
  petX?: number;
  petY?: number;
  onPetClick?: (clickCount: number) => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: "sparkle" | "heart" | "zzz" | "dust" | "star" | "smoke" | "flame" | "shield" | "spiral";
}

// Mood color presets
interface MoodTheme {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
  ring: string;
  dot: string;
  labelBg: string;
  shieldGlow: string;
}

const MOOD_THEMES: Record<PetMood, MoodTheme> = {
  idle: {
    primary: "#3b82f6",
    secondary: "#6366f1",
    accent: "#38bdf8",
    glow: "rgba(59, 130, 246, 0.42)",
    ring: "#60a5fa",
    dot: "#3b82f6",
    labelBg: "rgba(255, 255, 255, 0.88)",
    shieldGlow: "rgba(56, 189, 248, 0.4)",
  },
  listening: {
    primary: "#06b6d4",
    secondary: "#0284c7",
    accent: "#38bdf8",
    glow: "rgba(6, 182, 212, 0.52)",
    ring: "#22d3ee",
    dot: "#06b6d4",
    labelBg: "rgba(255, 255, 255, 0.92)",
    shieldGlow: "rgba(6, 182, 212, 0.5)",
  },
  speaking: {
    primary: "#8b5cf6",
    secondary: "#ec4899",
    accent: "#a855f7",
    glow: "rgba(139, 92, 246, 0.52)",
    ring: "#c084fc",
    dot: "#a855f7",
    labelBg: "rgba(255, 255, 255, 0.92)",
    shieldGlow: "rgba(168, 85, 247, 0.5)",
  },
  working: {
    primary: "#4f46e5",
    secondary: "#7c3aed",
    accent: "#818cf8",
    glow: "rgba(79, 70, 229, 0.48)",
    ring: "#818cf8",
    dot: "#6366f1",
    labelBg: "rgba(255, 255, 255, 0.9)",
    shieldGlow: "rgba(99, 102, 241, 0.5)",
  },
  question: {
    primary: "#f59e0b",
    secondary: "#d97706",
    accent: "#fbbf24",
    glow: "rgba(245, 158, 11, 0.48)",
    ring: "#fbbf24",
    dot: "#f59e0b",
    labelBg: "rgba(255, 255, 255, 0.92)",
    shieldGlow: "rgba(245, 158, 11, 0.5)",
  },
  done: {
    primary: "#10b981",
    secondary: "#059669",
    accent: "#34d399",
    glow: "rgba(16, 185, 129, 0.52)",
    ring: "#34d399",
    dot: "#10b981",
    labelBg: "rgba(255, 255, 255, 0.92)",
    shieldGlow: "rgba(52, 211, 153, 0.5)",
  },
  angry: {
    primary: "#ef4444",
    secondary: "#dc2626",
    accent: "#fb7185",
    glow: "rgba(239, 68, 68, 0.6)",
    ring: "#f43f5e",
    dot: "#ef4444",
    labelBg: "rgba(255, 255, 255, 0.95)",
    shieldGlow: "rgba(239, 68, 68, 0.6)",
  },
  error: {
    primary: "#ef4444",
    secondary: "#dc2626",
    accent: "#f87171",
    glow: "rgba(239, 68, 68, 0.48)",
    ring: "#f87171",
    dot: "#ef4444",
    labelBg: "rgba(255, 255, 255, 0.92)",
    shieldGlow: "rgba(239, 68, 68, 0.4)",
  },
  offline: {
    primary: "#64748b",
    secondary: "#475569",
    accent: "#94a3b8",
    glow: "rgba(100, 116, 139, 0.22)",
    ring: "#94a3b8",
    dot: "#94a3b8",
    labelBg: "rgba(255, 255, 255, 0.8)",
    shieldGlow: "rgba(148, 163, 184, 0.2)",
  },
};

const FUNNY_CLICK_REACTIONS = [
  "Hehe! Ticklish!",
  "👀 Target acquired!",
  "Beep boop! ✨",
  "Hey friend! 👋",
  "Petting received!",
  "Shield recalibrated!",
  "Analyzing your click ⚡",
];

export default function OrvixPet({
  mood,
  pose,
  label,
  flipX = false,
  accessory = "none",
  isSpeaking = false,
  hideLabel = false,
  mousePos,
  petX = 0,
  petY = 0,
  onPetClick,
}: OrvixPetProps) {
  const [blink, setBlink] = useState(false);
  const [eyeLook, setEyeLook] = useState({ x: 0, y: 0 });
  const [isCuriousTracking, setIsCuriousTracking] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [audioPhase, setAudioPhase] = useState(0);
  const [clickEffectLabel, setClickEffectLabel] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isBouncing, setIsBouncing] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particleIdRef = useRef(0);
  const petRootRef = useRef<HTMLDivElement>(null);

  const theme = MOOD_THEMES[mood] || MOOD_THEMES.idle;

  const hasHat = accessory === "hat" || accessory === "hat_and_gun";
  const hasGun = accessory === "gun" || accessory === "hat_and_gun";

  // Periodic curiosity cycle: only tracks the mouse sometimes (~35% of the time)
  useEffect(() => {
    if (pose === "sleep" || mood === "angry") {
      setIsCuriousTracking(false);
      return;
    }

    if (pose === "curious") {
      setIsCuriousTracking(true);
      return;
    }

    let curiosityTimer: ReturnType<typeof setTimeout>;
    const runCuriosityCycle = () => {
      const shouldTrack = Math.random() < 0.38;
      setIsCuriousTracking(shouldTrack);
      const nextDuration = shouldTrack
        ? 3500 + Math.random() * 4500 // tracks for 3.5 - 8s
        : 6000 + Math.random() * 9000; // ignores mouse and guards for 6 - 15s
      curiosityTimer = setTimeout(runCuriosityCycle, nextDuration);
    };

    runCuriosityCycle();
    return () => clearTimeout(curiosityTimer);
  }, [pose, mood]);

  // Particle spawner
  const spawnParticles = useCallback((type: Particle["type"], count: number, colors: string[]) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      newParticles.push({
        id: particleIdRef.current++,
        x: 87 + (Math.random() - 0.5) * 35,
        y: 95 + (Math.random() - 0.5) * 25,
        vx: (Math.random() - 0.5) * 2.5,
        vy: -0.7 - Math.random() * 2.2,
        life: 1,
        maxLife: 0.75 + Math.random() * 0.75,
        size: type === "star" ? 6.5 : type === "flame" ? 5.5 : 3.5 + Math.random() * 3.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        type,
      });
    }
    setParticles((prev) => [...prev, ...newParticles]);
  }, []);

  // Eye look direction (intermittent mouse curiosity tracking + autonomous guarding scans)
  useEffect(() => {
    if (pose === "sleep" || mood === "angry" || isSpinning) return;

    // When in curious tracking mode AND mouse is within range
    if (isCuriousTracking && mousePos && mousePos.x > 0 && mousePos.y > 0) {
      const petCenterX = petX + 87.5;
      const petCenterY = petY + 97.5;
      const dx = mousePos.x - petCenterX;
      const dy = mousePos.y - petCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 600) {
        const lookX = Math.max(-5, Math.min(5, (dx / dist) * 4.8));
        const lookY = Math.max(-3.5, Math.min(3.5, (dy / dist) * 3.4));
        setEyeLook({ x: lookX, y: lookY });
        return;
      }
    }

    // Natural guardian scanning when not actively tracking the cursor
    const interval = setInterval(() => {
      const roll = Math.random();
      if (roll < 0.35) {
        // Watchful scan left (guarding left border)
        setEyeLook({ x: -4, y: 0.5 });
      } else if (roll < 0.7) {
        // Watchful scan right (guarding right border)
        setEyeLook({ x: 4, y: 0.5 });
      } else if (roll < 0.85) {
        // Vigilant upward scan
        setEyeLook({ x: 0, y: -3 });
      } else {
        // Direct focused guardian gaze
        setEyeLook({ x: 0, y: 0 });
      }
    }, 2200);

    return () => clearInterval(interval);
  }, [mousePos, petX, petY, pose, mood, isSpinning, isCuriousTracking]);

  // Blink timer
  useEffect(() => {
    if (pose === "sleep" || pose === "hang" || mood === "angry" || isSpinning) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          schedule();
        }, 150);
      }, 2600 + Math.random() * 2800);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [pose, mood, isSpinning]);

  // Audio wave pulse animation loop for speaking/listening
  useEffect(() => {
    if (!isSpeaking && mood !== "speaking" && mood !== "listening" && mood !== "working") return;
    const id = setInterval(() => {
      setAudioPhase((p) => (p + 2) % 360);
    }, 60);
    return () => clearInterval(id);
  }, [mood, isSpeaking]);

  // Mood change reactions
  useEffect(() => {
    if (mood === "done") spawnParticles("star", 9, ["#34d399", "#a7f3d0", "#fde047", "#6ee7b7"]);
    if (mood === "error") spawnParticles("dust", 7, ["#ef4444", "#fca5a5", "#fb7185"]);
    if (mood === "angry") spawnParticles("flame", 7, ["#ef4444", "#f97316", "#fbbf24"]);
    if (mood === "speaking") spawnParticles("sparkle", 3, ["#c084fc", "#e879f9", "#93c5fd"]);
    if (mood === "listening") spawnParticles("sparkle", 3, ["#38bdf8", "#67e8f9", "#a5f3fc"]);
  }, [mood, spawnParticles]);

  // Particle update loop
  useEffect(() => {
    if (particles.length === 0) return;
    const id = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            life: p.life - 0.056,
          }))
          .filter((p) => p.life > 0)
      );
    }, 66);
    return () => clearInterval(id);
  }, [particles.length]);

  // Sleep Zzz particles
  useEffect(() => {
    if (pose !== "sleep") return;
    const id = setInterval(() => {
      spawnParticles("zzz", 1, ["#818cf8", "#a5b4fc", "#c7d2fe"]);
    }, 1900);
    return () => clearInterval(id);
  }, [pose, spawnParticles]);

  // Interactive funny clicks (Single click, Double click bounce, Multi-click dizzy spin!)
  const handleClick = useCallback(() => {
    if (mood === "angry") return;

    clickCountRef.current += 1;
    const count = clickCountRef.current;

    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
      setClickEffectLabel(null);
    }, 1800);

    onPetClick?.(count);

    if (count >= 3) {
      // Hilarious 360° Dizzy Spin!
      setIsSpinning(true);
      setClickEffectLabel("Whoaa! Dizzy! 🌀");
      spawnParticles("star", 10, ["#fbbf24", "#f43f5e", "#38bdf8", "#a855f7"]);
      setTimeout(() => setIsSpinning(false), 900);
    } else if (count === 2) {
      // Playful High Bounce!
      setIsBouncing(true);
      setClickEffectLabel("Wheee! ⭐");
      spawnParticles("star", 6, ["#38bdf8", "#60a5fa", "#fde047"]);
      setTimeout(() => setIsBouncing(false), 600);
    } else {
      // Cute Heart Pop & Playful Chirp
      const randChirp = FUNNY_CLICK_REACTIONS[Math.floor(Math.random() * FUNNY_CLICK_REACTIONS.length)];
      setClickEffectLabel(randChirp);
      spawnParticles("heart", 4, ["#f43f5e", "#fb7185", "#f472b6", "#fda4af"]);
    }
  }, [mood, onPetClick, spawnParticles]);

  // Compute pose transformation
  const poseTransform = useMemo(() => {
    let transform = "";
    if (flipX) transform += "scaleX(-1) ";
    if (isSpinning || pose === "spin") transform += "rotate(360deg) scale(1.1) ";
    else if (isBouncing || pose === "bounce") transform += "translateY(-14px) scale(1.08, 0.94) ";
    else if (pose === "walkA") transform += "translateY(-3px) rotate(2.5deg) scale(1.02, 0.98) ";
    else if (pose === "walkB") transform += "translateY(1px) rotate(-2.5deg) scale(0.98, 1.02) ";
    else if (pose === "lay") transform += "translateY(12px) scaleY(0.8) scaleX(1.12) ";
    else if (pose === "sit") transform += "translateY(8px) scaleY(0.9) scaleX(1.04) ";
    else if (pose === "hang") transform += "translateY(-12px) scaleY(1.06) ";
    else if (pose === "sleep") transform += "translateY(10px) scaleY(0.84) scaleX(1.08) ";
    else if (pose === "curious") transform += "rotate(-4deg) translateY(-4px) scale(1.04) ";
    return transform;
  }, [pose, flipX, isSpinning, isBouncing]);

  const activeDisplayLabel = clickEffectLabel || label;

  return (
    <div
      ref={petRootRef}
      className="orvix-gpt-pet"
      onClick={handleClick}
      style={{
        position: "relative",
        width: 175,
        height: 195,
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: "grab",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes gptPetBreathe {
          0%, 100% { transform: translateY(0px) scale(1); }
          50%      { transform: translateY(-3.5px) scale(1.02, 0.985); }
        }
        @keyframes gptPetPulseFast {
          0%, 100% { transform: translateY(0px) scale(1); }
          50%      { transform: translateY(-5px) scale(1.035, 0.97); }
        }
        @keyframes gptAngryJitter {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          20%      { transform: translate(-1.5px, 1px) rotate(-2deg); }
          40%      { transform: translate(1.5px, -1px) rotate(2deg); }
          60%      { transform: translate(-1.5px, -1px) rotate(-1.5deg); }
          80%      { transform: translate(1.5px, 1px) rotate(1.5deg); }
        }
        @keyframes gptPetFlip {
          0%   { transform: rotate(0deg) scale(1); }
          50%  { transform: rotate(180deg) scale(1.15); }
          100% { transform: rotate(360deg) scale(1); }
        }
        @keyframes gptOrbMorph {
          0%, 100% { border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%; }
          25%      { border-radius: 47% 53% 48% 52% / 52% 48% 53% 47%; }
          50%      { border-radius: 52% 48% 53% 47% / 48% 52% 47% 53%; }
          75%      { border-radius: 48% 52% 47% 53% / 53% 47% 52% 48%; }
        }
        @keyframes gptWaveExpand {
          0%   { transform: translate(-50%, -50%) scale(0.85); opacity: 0.85; }
          100% { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
        }
        @keyframes gptParticleUp {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(-28px) scale(0.4); }
        }
        @keyframes gptBadgeIn {
          0%   { opacity: 0; transform: translateY(6px) scale(0.88); }
          60%  { opacity: 1; transform: translateY(-2px) scale(1.03); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes gptBubbleFloat {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-3.5px); }
        }
        @keyframes gptHatDescend {
          0%   { transform: translateX(-50%) translateY(-38px) scale(1.22) rotate(-4deg); opacity: 0; }
          55%  { transform: translateX(-50%) translateY(3.5px) scale(1.05, 0.93) rotate(2deg); opacity: 1; }
          75%  { transform: translateX(-50%) translateY(-1.5px) scale(0.98, 1.02) rotate(-1deg); }
          100% { transform: translateX(-50%) translateY(0px) scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes gptHatSway {
          0%, 100% { transform: translateX(-50%) translateY(0px) rotate(-2.5deg); }
          50%      { transform: translateX(-50%) translateY(-2.5px) rotate(1.8deg); }
        }
        @keyframes gptHandWear {
          0%   { transform: translateY(-38px) scale(1.15); opacity: 0; }
          25%  { transform: translateY(-15px) scale(1.08); opacity: 1; }
          60%  { transform: translateY(3.5px) scale(1.04); opacity: 1; }
          78%  { transform: translateY(-1.5px) scale(0.98); opacity: 1; }
          88%  { transform: translateY(0px) scale(1); opacity: 0.9; }
          100% { transform: translateY(4px) scale(0.6); opacity: 0; }
        }
        @keyframes gptSniperAim {
          0%, 100% { transform: translateY(0px) rotate(-11deg); }
          50%      { transform: translateY(-2px) rotate(-9deg); }
        }
        @keyframes gptSniperLaser {
          0%, 100% { opacity: 0.35; width: 65px; }
          50%      { opacity: 0.95; width: 105px; }
        }
      `}</style>

      {/* Compact status bubble that stays visually connected to the pet. */}
      {!hideLabel && <div
        style={{
          position: "absolute",
          top: 16,
          display: "flex",
          alignItems: "center",
          maxWidth: 205,
          padding: "6px 12px",
          borderRadius: 20,
          background:
            mood === "angry"
              ? "linear-gradient(135deg, #382127 0%, #241b20 100%)"
              : clickEffectLabel
                ? "linear-gradient(135deg, #26354d 0%, #1c2638 100%)"
                : "linear-gradient(135deg, #282d3a 0%, #1a1e29 100%)",
          border: "1px solid #505a70",
          fontSize: 11,
          fontWeight: 650,
          color: mood === "angry" ? "#ffd1d7" : clickEffectLabel ? "#e0eaff" : "#eef2ff",
          letterSpacing: "-0.015em",
          pointerEvents: "none",
          zIndex: 35,
          whiteSpace: "nowrap",
          animation: "gptBadgeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1), gptBubbleFloat 3.5s ease-in-out 0.35s infinite",
        }}
      >
        {/* Message Label Content */}
        <span style={{ display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{activeDisplayLabel}</span>

        {/* Downward Speech Bubble Pointer Tail */}
        <div
          style={{
            position: "absolute",
            bottom: -5,
            left: "50%",
            transform: "translateX(-50%) rotate(45deg)",
            width: 9,
            height: 9,
            background:
              mood === "angry"
                ? "#241b20"
                : clickEffectLabel
                  ? "#1c2638"
                  : "#1a1e29",
            borderRight: "1px solid #505a70",
            borderBottom: "1px solid #505a70",
          }}
        />
      </div>}

      {/* Main Companion Entity Area */}
      <div
        style={{
          position: "relative",
          width: 110,
          height: 110,
          marginTop: hasHat ? 32 : 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: poseTransform,
          transition: isSpinning
            ? "transform 0.85s cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
          animation:
            mood === "angry"
              ? "gptAngryJitter 0.35s ease-in-out infinite"
              : isSpinning
                ? "gptPetFlip 0.85s ease-in-out"
                : pose === "sleep"
                  ? "gptPetBreathe 4s ease-in-out infinite"
                  : mood === "speaking" || mood === "listening"
                    ? "gptPetPulseFast 0.8s ease-in-out infinite"
                    : mood === "working"
                      ? "gptPetPulseFast 1.2s ease-in-out infinite"
                      : "gptPetBreathe 2.8s ease-in-out infinite",
        }}
      >
        {/* Audio / Mood Waves */}
        {(mood === "speaking" || mood === "listening") && (
          <>
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 108,
                height: 108,
                borderRadius: "50%",
                border: `1.4px solid ${theme.ring}`,
                pointerEvents: "none",
                animation: "gptWaveExpand 1.6s cubic-bezier(0.1, 0.7, 0.1, 1) infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 108,
                height: 108,
                borderRadius: "50%",
                border: `1.4px solid ${theme.ring}`,
                pointerEvents: "none",
                animation: "gptWaveExpand 1.6s cubic-bezier(0.1, 0.7, 0.1, 1) 0.8s infinite",
              }}
            />
          </>
        )}

        {/* Medium-Large ChatGPT Style Fluid Luminescent Orb Core */}
        <div
          style={{
            position: "relative",
            width: 80,
            height: 80,
            borderRadius: "50%",
            background:
              mood === "offline"
                ? "linear-gradient(135deg, #94a3b8 0%, #475569 50%, #334155 100%)"
                : mood === "angry"
                  ? "radial-gradient(circle at 35% 30%, #ffffff 0%, #fb7185 25%, #ef4444 60%, #b91c1c 100%)"
                  : `radial-gradient(circle at 35% 30%, #ffffff 0%, ${theme.accent} 25%, ${theme.primary} 60%, ${theme.secondary} 100%)`,
            boxShadow: `
              inset 0 -5px 12px rgba(10, 15, 45, 0.45),
              inset 0 5px 12px rgba(255, 255, 255, 0.75)
            `,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: mood === "angry" || isSpinning ? "none" : "gptOrbMorph 6s ease-in-out infinite",
            transition: "background 0.5s ease, box-shadow 0.5s ease",
          }}
        >
          {/* Inner Caustic Chromatic Highlight */}
          <div
            style={{
              position: "absolute",
              top: 5,
              left: 12,
              width: 36,
              height: 20,
              borderRadius: "50%",
              background: "linear-gradient(180deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 100%)",
              transform: "rotate(-20deg)",
              pointerEvents: "none",
            }}
          />

          {/* Dapper Cyber Fedora / Detective Hat (Enlarged & Animated Wearing Sequence) */}
          {hasHat && (
            <div
              style={{
                position: "absolute",
                top: -20,
                left: "50%",
                width: 74,
                height: 40,
                pointerEvents: "none",
                zIndex: 20,
                animation: "gptHatDescend 0.45s cubic-bezier(0.16, 1, 0.3, 1), gptHatSway 3.2s ease-in-out 0.45s infinite",
              }}
            >
              {/* Fedora Top Crown */}
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 46,
                  height: 25,
                  borderRadius: "12px 12px 3px 3px",
                  background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.45), inset 0 2px 4px rgba(255,255,255,0.25)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                {/* Center Indent Crease */}
                <div
                  style={{
                    position: "absolute",
                    top: 2.5,
                    left: 8,
                    right: 8,
                    height: 3.5,
                    borderRadius: 3,
                    background: "rgba(0,0,0,0.5)",
                  }}
                />
                {/* Glowing Neon Ribbon Band */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 6,
                    background: theme.accent,
                    boxShadow: `0 0 8px ${theme.accent}`,
                  }}
                />
                {/* Metallic Badge Pin */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 1,
                    right: 4,
                    width: 4.5,
                    height: 4.5,
                    borderRadius: "50%",
                    background: "#fbbf24",
                    boxShadow: "0 0 4px #fbbf24",
                  }}
                />
              </div>

              {/* Fedora Wide Curved Brim */}
              <div
                style={{
                  position: "absolute",
                  bottom: 7,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 72,
                  height: 8.5,
                  borderRadius: "50%",
                  background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                  boxShadow: "0 3px 8px rgba(0,0,0,0.5)",
                  border: "1px solid rgba(255,255,255,0.18)",
                }}
              />

              {/* Animated Hands Holding and Donning the Hat (Disappears once weared) */}
              {/* Left Hand Holding Left Brim */}
              <div
                style={{
                  position: "absolute",
                  left: -1,
                  bottom: 5,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, #ffffff 45%, rgba(255,255,255,0.75) 100%)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3), 0 0 6px rgba(56,189,248,0.5)",
                  animation: "gptHandWear 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                  zIndex: 25,
                }}
              />
              {/* Right Hand Holding Right Brim */}
              <div
                style={{
                  position: "absolute",
                  right: -1,
                  bottom: 5,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, #ffffff 45%, rgba(255,255,255,0.75) 100%)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3), 0 0 6px rgba(56,189,248,0.5)",
                  animation: "gptHandWear 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                  zIndex: 25,
                }}
              />
            </div>
          )}

          {/* Big Military AK / Sniper Rifle Held by Two Tactical Hands */}
          {hasGun && (
            <div
              style={{
                position: "absolute",
                right: -28,
                bottom: -2,
                width: 82,
                height: 38,
                pointerEvents: "none",
                zIndex: 25,
                animation: "gptSniperAim 3s ease-in-out infinite",
                transformOrigin: "left center",
              }}
            >
              {/* Tactical Rifle Stock (Shoulder Rest) */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 14,
                  width: 16,
                  height: 11,
                  borderRadius: "2px 2px 4px 6px",
                  background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />

              {/* Main Gun Receiver Chassis (Heavy Military Metal) */}
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  top: 13,
                  width: 32,
                  height: 13,
                  borderRadius: "2px 4px 4px 2px",
                  background: "linear-gradient(180deg, #334155 0%, #0f172a 100%)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  boxShadow: "0 3px 8px rgba(0,0,0,0.5)",
                }}
              >
                {/* Cyber Power Circuit Accent */}
                <div
                  style={{
                    position: "absolute",
                    left: 4,
                    top: 4,
                    width: 14,
                    height: 3,
                    borderRadius: 1.5,
                    background: theme.accent,
                    boxShadow: `0 0 6px ${theme.accent}`,
                  }}
                />
              </div>

              {/* Tactical AK Curved Banana Magazine */}
              <div
                style={{
                  position: "absolute",
                  left: 22,
                  top: 24,
                  width: 9,
                  height: 17,
                  borderRadius: "0 3px 6px 2px",
                  background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  transform: "rotate(16deg)",
                  boxShadow: "0 2px 5px rgba(0,0,0,0.4)",
                }}
              />

              {/* Elevated Military Sniper Scope (Optical Targeting) */}
              <div
                style={{
                  position: "absolute",
                  left: 17,
                  top: 5,
                  width: 26,
                  height: 8,
                  borderRadius: 2,
                  background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 2px",
                }}
              >
                {/* Scope Mount Stand */}
                <div
                  style={{
                    position: "absolute",
                    bottom: -3,
                    left: 5,
                    width: 3,
                    height: 3,
                    background: "#0f172a",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: -3,
                    right: 5,
                    width: 3,
                    height: 3,
                    background: "#0f172a",
                  }}
                />
                {/* Front Scope Optical Lens Glint */}
                <div
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "#38bdf8",
                    boxShadow: "0 0 5px #38bdf8",
                  }}
                />
                <div
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: "50%",
                    background: "#22c55e",
                    boxShadow: "0 0 4px #22c55e",
                  }}
                />
              </div>

              {/* Long Precision Sniper Barrel & Handguard */}
              <div
                style={{
                  position: "absolute",
                  left: 44,
                  top: 16,
                  width: 30,
                  height: 6,
                  borderRadius: "0 2px 2px 0",
                  background: "linear-gradient(180deg, #334155 0%, #0f172a 100%)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                {/* Tactical Barrel Cooling Ridge */}
                <div
                  style={{
                    position: "absolute",
                    left: 4,
                    top: 1,
                    width: 14,
                    height: 2,
                    background: "rgba(0,0,0,0.5)",
                    borderRadius: 1,
                  }}
                />
              </div>

              {/* Sniper Muzzle Brake / Flash Hider */}
              <div
                style={{
                  position: "absolute",
                  left: 74,
                  top: 14.5,
                  width: 8,
                  height: 9,
                  borderRadius: "2px 4px 4px 2px",
                  background: "#0f172a",
                  border: "1px solid #64748b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
                }}
              >
                <div
                  style={{
                    width: 3.5,
                    height: 3.5,
                    borderRadius: "50%",
                    background: "#38bdf8",
                    boxShadow: "0 0 5px #38bdf8",
                  }}
                />
              </div>

              {/* High-Tech Sniper Targeting Laser Beam */}
              <div
                style={{
                  position: "absolute",
                  left: 81,
                  top: 18,
                  height: 1.5,
                  background: "linear-gradient(90deg, #38bdf8 0%, rgba(56,189,248,0.7) 40%, transparent 100%)",
                  animation: "gptSniperLaser 1.8s ease-in-out infinite",
                }}
              />

              {/* Tactical Hand 1 (Rear Trigger Grip Hand) */}
              <div
                style={{
                  position: "absolute",
                  left: 13,
                  top: 20,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, #ffffff 40%, rgba(255,255,255,0.8) 100%)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.35), 0 0 6px rgba(56,189,248,0.6)",
                  zIndex: 10,
                }}
              />

              {/* Tactical Hand 2 (Forward Under-Barrel Support Hand) */}
              <div
                style={{
                  position: "absolute",
                  left: 42,
                  top: 18,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, #ffffff 40%, rgba(255,255,255,0.8) 100%)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.35), 0 0 6px rgba(56,189,248,0.6)",
                  zIndex: 10,
                }}
              />
            </div>
          )}

          {/* Holographic Intelligent Cyber-Guardian Eyes */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 13,
              transform: mood === "angry" || isSpinning ? "none" : `translate(${eyeLook.x}px, ${eyeLook.y}px)`,
              transition: "transform 0.16s cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {pose === "sleep" ? (
              // Sleeping curved closed eyes
              <>
                <svg width="15" height="8" viewBox="0 0 15 8">
                  <path d="M 1 2.5 Q 7.5 8 14 2.5" fill="none" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                <svg width="15" height="8" viewBox="0 0 15 8">
                  <path d="M 1 2.5 Q 7.5 8 14 2.5" fill="none" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </>
            ) : mood === "angry" ? (
              // Angry slanted expressive brows and eyes
              <>
                <div style={{ position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: -5,
                      left: -2,
                      width: 15,
                      height: 3,
                      borderRadius: 2,
                      background: "#0f172a",
                      transform: "rotate(24deg)",
                    }}
                  />
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: "#0f172a",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2.5,
                        width: 3.5,
                        height: 3.5,
                        borderRadius: "50%",
                        background: "#ffffff",
                      }}
                    />
                  </div>
                </div>

                <div style={{ position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -2,
                      width: 15,
                      height: 3,
                      borderRadius: 2,
                      background: "#0f172a",
                      transform: "rotate(-24deg)",
                    }}
                  />
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: "#0f172a",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 2,
                        left: 2.5,
                        width: 3.5,
                        height: 3.5,
                        borderRadius: "50%",
                        background: "#ffffff",
                      }}
                    />
                  </div>
                </div>
              </>
            ) : mood === "done" || isBouncing ? (
              // Joyful smiling eyes
              <>
                <svg width="15" height="10" viewBox="0 0 15 10">
                  <path d="M 1 8.5 Q 7.5 0 14 8.5" fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <svg width="15" height="10" viewBox="0 0 15 10">
                  <path d="M 1 8.5 Q 7.5 0 14 8.5" fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </>
            ) : blink ? (
              // Blink flat lines
              <>
                <div style={{ width: 12, height: 2.5, borderRadius: 1.5, background: "#0f172a" }} />
                <div style={{ width: 12, height: 2.5, borderRadius: 1.5, background: "#0f172a" }} />
              </>
            ) : (
              // Vigilant PC Cyber-Guardian Eyes (Attentive, Sharp, Protective Iris)
              <>
                <div
                  style={{
                    width: 13,
                    height: mood === "listening" ? 15 : 13.5,
                    borderRadius: "50%",
                    background: "#0f172a",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 6px rgba(15, 23, 42, 0.4)",
                    transition: "height 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 1.5,
                      right: 2.5,
                      width: 4.2,
                      height: 4.2,
                      borderRadius: "50%",
                      background: "#ffffff",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 1.5,
                      left: 2.5,
                      width: 2.2,
                      height: 2.2,
                      borderRadius: "50%",
                      background: "rgba(255, 255, 255, 0.7)",
                    }}
                  />
                </div>

                <div
                  style={{
                    width: 13,
                    height: mood === "question" ? 15 : mood === "listening" ? 15 : 13.5,
                    borderRadius: "50%",
                    background: "#0f172a",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 6px rgba(15, 23, 42, 0.4)",
                    transition: "height 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 1.5,
                      right: 2.5,
                      width: 4.2,
                      height: 4.2,
                      borderRadius: "50%",
                      background: "#ffffff",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 1.5,
                      left: 2.5,
                      width: 2.2,
                      height: 2.2,
                      borderRadius: "50%",
                      background: "rgba(255, 255, 255, 0.7)",
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Speaking or Angry Mouth */}
          {isSpeaking || mood === "speaking" ? (
            <div
              style={{
                position: "absolute",
                bottom: 18,
                width: 10 + (Math.sin(audioPhase * 0.1) + 1) * 3.5,
                height: 3.5 + (Math.cos(audioPhase * 0.1) + 1) * 2.5,
                borderRadius: 7,
                background: "#0f172a",
                transition: "all 0.08s ease",
              }}
            />
          ) : mood === "angry" ? (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                width: 11,
                height: 3.5,
                borderRadius: "3.5px 3.5px 0 0",
                borderTop: "2.2px solid #0f172a",
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Floating Dynamic Stardust & Particle Effects */}
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            pointerEvents: "none",
            opacity: p.life,
            transform: `scale(${p.life})`,
            color: p.color,
            fontSize: p.type === "zzz" ? 12 : p.type === "heart" ? 11 : p.type === "flame" ? 12 : undefined,
            fontWeight: 800,
            animation: "gptParticleUp 1.2s ease-out forwards",
            zIndex: 15,
          }}
        >
          {p.type === "heart" ? (
            "♥"
          ) : p.type === "zzz" ? (
            "z"
          ) : p.type === "flame" ? (
            "💢"
          ) : p.type === "star" ? (
            <svg width={p.size} height={p.size} viewBox="0 0 24 24" fill={p.color}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          ) : (
            <div
              style={{
                width: p.size,
                height: p.size,
                borderRadius: "50%",
                backgroundColor: p.color,
                boxShadow: `0 0 7px ${p.color}`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
