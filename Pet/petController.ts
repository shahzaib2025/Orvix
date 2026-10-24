import type { PetMood, PetPose, PetAccessory } from "./OrvixPet";

// ---- Types -----------------------------------------------------------------
export interface PetState {
  x: number;
  y: number;
  pose: PetPose;
  mood: PetMood;
  label: string;
  flipX: boolean;
  resting: boolean;
  accessory: PetAccessory;
}

export type PetBehavior =
  | "idle"
  | "sitting"
  | "laying"
  | "walking"
  | "hanging"
  | "sleeping"
  | "following"
  | "guarding"
  | "spinning"
  | "bouncing"
  | "curious"
  | "sneaking"
  | "equipping_hat"
  | "drawing_blaster";

interface ScreenBounds {
  width: number;
  height: number;
  taskbarHeight: number;
  displays?: WindowBounds[];
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ANGRY_PHRASES = [
  "Hey! Don't push me off!",
  "I almost fell off!",
  "Grrr! Keep me on screen!",
  "Hey! Put me inside!",
  "Ouch! Too close to the edge!",
];

const GUARDIAN_LABELS = [
  "Guarding PC",
  "Shield Active",
  "System Guarded",
  "On Watch",
  "All Clear",
  "Corner Patrol",
  "Scanning...",
  "Ready",
];

const FUNNY_IDLE_LABELS = [
  "Inspecting pixels...",
  "Watching you type 👀",
  "Scanning for cookies 🍪",
  "Checking CPU & RAM ⚡",
  "Zero bugs found ✨",
  "Tracking cursor 🎯",
  "Curious about that click...",
  "AI Companion on duty!",
];

const HAT_LABELS = [
  "Dapper Mode 🎩",
  "Detective Orvix 🕵️",
  "Looking Sharp!",
  "Hat On!",
  "Fancy AI vibes 🎩",
];

const GUN_PATROL_LABELS = [
  "PC Patrol: Armed 🔫",
  "Stealth Patrol Active 🛡️",
  "Sweeping Perimeter ⚡",
  "Overwatch Moving 🎯",
  "Patrolling PC Border 🔫",
  "Area Defense Patrol 🛡️",
  "Laser sight scanning 🎯",
  "Guarding Screen ⚡",
];

const USER_INACTIVITY_DELAY_MS = 5000;

// ---- Controller ------------------------------------------------------------
export class PetController {
  private state: PetState;
  private behavior: PetBehavior = "idle";
  private targetX = 0;
  private targetY = 0;
  private isAtCornerPost = false;
  private screen: ScreenBounds = {
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
    taskbarHeight: 48,
  };
  private windows: WindowBounds[] = [];
  private behaviorTimer: ReturnType<typeof setTimeout> | null = null;
  private walkFrameTimer: ReturnType<typeof setInterval> | null = null;
  private angryTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange: ((state: PetState) => void) | null = null;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private speed = 1.6;
  private currentSpeed = 0;
  private walkPhase = 0;
  private lastTick = 0;
  private previousMood: PetMood = "idle";
  private previousLabel: string = "Ready";
  private isRecoveringFromBounds = false;
  private isDragging = false;
  private isLocked = false;
  private isPaused = false;
  private lastActivityTime = Date.now();
  private isUserInactive = false;

  constructor(initialX: number, initialY: number) {
    this.state = {
      x: initialX,
      y: initialY,
      pose: "idle",
      mood: "idle",
      label: "Guarding PC",
      flipX: false,
      resting: false,
      accessory: "none",
    };
    this.targetX = initialX;
    this.targetY = initialY;
  }

  // ---- Public API ----------------------------------------------------------

  start(callback: (state: PetState) => void) {
    this.onStateChange = callback;
    this.lastTick = Date.now();
    this.lastActivityTime = Date.now();
    this.scheduleBehavior();
    this.emit();
  }

  stop() {
    this.onStateChange = null;
    this.stopTickLoop();
    if (this.behaviorTimer) clearTimeout(this.behaviorTimer);
    if (this.walkFrameTimer) clearInterval(this.walkFrameTimer);
    if (this.angryTimer) clearTimeout(this.angryTimer);
    this.behaviorTimer = null;
    this.walkFrameTimer = null;
    this.angryTimer = null;
  }

  // Notify user activity (typing, mouse moving, clicks)
  notifyUserActivity() {
    const wasInactive = this.isUserInactive;
    this.lastActivityTime = Date.now();
    this.isUserInactive = false;

    if (wasInactive) {
      // User returned! Lower gun and stand at ease
      if (this.state.accessory === "gun") {
        this.state.accessory = "none";
        this.state.label = "User detected! 👋";
        this.setBehavior("idle");
        this.scheduleBehavior(2500);
        this.emit();
      }
    }
  }

  setMood(mood: PetMood, label: string) {
    if (this.isRecoveringFromBounds) {
      this.previousMood = mood;
      this.previousLabel = label;
      return;
    }

    this.state.mood = mood;
    this.state.label = label;

    // Auto-react to mood changes
    if (mood === "working") {
      this.setBehavior("idle");
    } else if (mood === "done") {
      this.jump();
      this.scheduleBehavior(3000);
    } else if (mood === "error") {
      this.jump();
    } else if (mood === "listening" || mood === "speaking") {
      // Stay in current behavior but update label
    } else if (mood === "idle") {
      this.scheduleBehavior(2000);
    }

    this.emit();
  }

  setAccessory(acc: PetAccessory) {
    this.state.accessory = acc;
    this.emit();
  }

  setLocked(locked: boolean) {
    if (this.isLocked === locked) return;
    this.isLocked = locked;
    if (locked) {
      if (this.behaviorTimer) clearTimeout(this.behaviorTimer);
      this.behaviorTimer = null;
      if (!this.isPaused) this.setBehavior("idle");
      if (!this.isPaused) this.stopTickLoop();
      return;
    }
    if (!this.isPaused) {
      this.scheduleBehavior(1200);
    }
  }

  setPaused(paused: boolean) {
    if (this.isPaused === paused) return;
    this.isPaused = paused;
    if (paused) {
      if (this.behaviorTimer) clearTimeout(this.behaviorTimer);
      this.behaviorTimer = null;
      this.state.mood = "idle";
      this.state.label = "Taking a rest";
      this.setBehavior("sleeping");
      this.stopTickLoop();
      return;
    }
    this.state.mood = "idle";
    this.state.label = "Ready";
    this.setBehavior("idle");
    if (!this.isLocked) {
      this.scheduleBehavior(1000);
    }
    this.emit();
  }

  returnHome() {
    this.notifyUserActivity();
    const maxX = Math.max(10, this.screen.width - 185);
    const maxY = Math.max(10, this.screen.height - 205);
    const x = Math.max(10, Math.min(maxX, this.screen.width - 190));
    const y = Math.max(10, Math.min(maxY, this.screen.height - 210));
    this.isAtCornerPost = false;
    this.state.flipX = x < this.state.x;
    if (this.isLocked || this.isPaused) {
      this.setRawPosition(x, y);
      return;
    }
    this.targetX = x;
    this.targetY = y;
    this.currentSpeed = 0.2;
    this.setBehavior("walking");
    this.scheduleBehavior(5000);
  }

  setScreen(bounds: ScreenBounds) {
    this.screen = bounds;
  }
  // Native placement can project movement onto an actual monitor instead of
  // a gap in the virtual desktop. This is not user activity or a new drag.
  syncDesktopPosition(x:number,y:number) {
    this.state.x=x;this.state.y=y;
    if(this.isDragging){this.targetX=x;this.targetY=y;}
  }

  setWindows(windows: WindowBounds[]) {
    this.windows = windows;
  }

  // Set position directly while dragging (allows dragging off-screen)
  setRawPosition(x: number, y: number) {
    this.notifyUserActivity();
    this.state.x = x;
    this.state.y = y;
    this.targetX = x;
    this.targetY = y;
    this.isAtCornerPost = false;
    this.currentSpeed = 0;
    this.emit();
  }

  beginDrag() {
    this.notifyUserActivity();
    this.isDragging = true;
    if (this.behaviorTimer) clearTimeout(this.behaviorTimer);
    if (this.angryTimer) clearTimeout(this.angryTimer);
    this.behaviorTimer = null;
    this.angryTimer = null;
    this.isRecoveringFromBounds = false;
    this.speed = 1.6;
    if (this.state.mood === "angry") {
      this.state.mood = "idle";
      this.state.label = "Ready";
    }
    if (!this.isPaused) this.setBehavior("idle");
  }

  endDrag() {
    this.isDragging = false;
    if (this.enforceScreenBounds()) return;
    if (this.isLocked || this.isPaused) {
      this.stopTickLoop();
      return;
    }
    this.scheduleBehavior(2500);
  }

  private safePosition(x:number,y:number) {
    const areas=this.screen.displays?.length?this.screen.displays:[{x:0,y:0,width:this.screen.width,height:this.screen.height}];
    let uncovered:WindowBounds[]=[{x,y,width:175,height:205}];
    for(const a of areas){
      uncovered=uncovered.flatMap(r=>{
        const left=Math.max(r.x,a.x),top=Math.max(r.y,a.y),right=Math.min(r.x+r.width,a.x+a.width),bottom=Math.min(r.y+r.height,a.y+a.height);
        if(right<=left||bottom<=top)return [r];
        return [{x:r.x,y:r.y,width:r.width,height:top-r.y},{x:r.x,y:bottom,width:r.width,height:r.y+r.height-bottom},
          {x:r.x,y:top,width:left-r.x,height:bottom-top},{x:right,y:top,width:r.x+r.width-right,height:bottom-top}].filter(p=>p.width>0&&p.height>0);
      });
    }
    if(!uncovered.length)return {x,y};
    return areas.map(a=>({x:Math.max(a.x,Math.min(a.x+Math.max(0,a.width-175),x)),y:Math.max(a.y,Math.min(a.y+Math.max(0,a.height-205),y))}))
      .reduce((best,p)=>Math.hypot(p.x-x,p.y-y)<Math.hypot(best.x-x,best.y-y)?p:best);
  }

  // Move to absolute position with safe bounds
  moveTo(x: number, y: number) {
    const safe=this.safePosition(x,y);
    this.targetX = safe.x;
    this.targetY = safe.y;
  }

  // Jump animation
  jump() {
    this.state.y = Math.max(10, this.state.y - 14);
    this.emit();
  }

  // Check if dragged outside/half-outside and angrily return to nearest safe edge
  enforceScreenBounds(): boolean {
    this.notifyUserActivity();
    const safe=this.safePosition(this.state.x,this.state.y);
    const isOutside = safe.x!==this.state.x || safe.y!==this.state.y;

    if (isOutside) {
      // Calculate nearest safe position at that edge (NOT center)
      const safeX = safe.x;
      const safeY = safe.y;

      if (this.state.mood !== "angry") {
        this.previousMood = this.state.mood;
        this.previousLabel = this.state.label;
      }

      const phrase = ANGRY_PHRASES[Math.floor(Math.random() * ANGRY_PHRASES.length)];

      this.isRecoveringFromBounds = true;
      this.state.mood = "angry";
      this.state.label = phrase;
      this.state.pose = "idle";
      this.state.flipX = safeX > this.state.x;
      this.targetX = safeX;
      this.targetY = safeY;
      this.behavior = "walking";
      this.speed = 12; // Fast indignant spring-back
      this.currentSpeed = 12;
      this.startTickLoop();

      if (this.angryTimer) clearTimeout(this.angryTimer);
      this.angryTimer = setTimeout(() => {
        // Finish recovery even if a drag was released far beyond a monitor.
        this.state.x=this.targetX;this.state.y=this.targetY;
        this.behavior="idle";
        this.state.pose=this.isPaused?"sleep":"idle";
        this.speed = 1.6;
        this.currentSpeed = 0;
        this.isRecoveringFromBounds = false;
        this.setMood(this.previousMood, this.previousLabel);
        if(this.isLocked||this.isPaused)this.stopTickLoop();
        this.emit();
        this.scheduleBehavior(2000);
      }, 2600);

      this.emit();
      return true;
    }

    return false;
  }

  // ---- Behavior system -----------------------------------------------------

  private setBehavior(b: PetBehavior) {
    if (this.behavior === b) return;
    this.behavior = b;

    if (b === "walking" || b === "following") this.startTickLoop();
    else if (!this.isRecoveringFromBounds) this.stopTickLoop();

    if (this.walkFrameTimer) {
      clearInterval(this.walkFrameTimer);
      this.walkFrameTimer = null;
    }

    switch (b) {
      case "idle":
        this.state.pose = "idle";
        this.state.resting = false;
        this.currentSpeed = 0;
        break;
      case "sitting":
      case "guarding":
        this.state.pose = "sit";
        this.state.resting = true;
        this.currentSpeed = 0;
        break;
      case "laying":
        this.state.pose = "lay";
        this.state.resting = true;
        this.currentSpeed = 0;
        break;
      case "sneaking":
      case "curious":
        this.state.pose = "curious";
        this.state.resting = false;
        this.currentSpeed = 0;
        break;
      case "walking":
        this.state.pose = "walkA";
        this.state.resting = false;
        this.walkFrameTimer = setInterval(() => {
          this.state.pose = this.state.pose === "walkA" ? "walkB" : "walkA";
          this.emit();
        }, 220);
        break;
      case "hanging":
        this.state.pose = "hang";
        this.state.resting = true;
        this.currentSpeed = 0;
        break;
      case "sleeping":
        this.state.pose = "sleep";
        this.state.resting = true;
        this.currentSpeed = 0;
        break;
      case "spinning":
        this.state.pose = "spin";
        this.state.resting = false;
        this.currentSpeed = 0;
        break;
      case "bouncing":
        this.state.pose = "bounce";
        this.state.resting = false;
        this.currentSpeed = 0;
        break;
      case "following":
        this.state.pose = "idle";
        this.state.resting = false;
        break;
    }
    this.emit();
  }

  private scheduleBehavior(delay?: number) {
    if (this.behaviorTimer) clearTimeout(this.behaviorTimer);
    if (this.isRecoveringFromBounds || this.isLocked || this.isPaused || this.isDragging) return;
    const requestedDelay = delay ?? (3500 + Math.random() * 7000);
    const scheduledAt = Date.now();
    const runWhenDue = () => {
      const now = Date.now();
      const behaviorRemaining = requestedDelay - (now - scheduledAt);
      const inactivityRemaining = USER_INACTIVITY_DELAY_MS - (now - this.lastActivityTime);
      if (!this.isUserInactive && behaviorRemaining > 0 && inactivityRemaining > 0) {
        this.behaviorTimer = setTimeout(runWhenDue, Math.min(behaviorRemaining, inactivityRemaining));
        return;
      }
      this.behaviorTimer = null;
      this.chooseBehavior();
    };
    const untilInactive = Math.max(0, USER_INACTIVITY_DELAY_MS - (Date.now() - this.lastActivityTime));
    this.behaviorTimer = setTimeout(runWhenDue, this.isUserInactive ? requestedDelay : Math.min(requestedDelay, untilInactive));
  }

  private chooseBehavior() {
    if (this.isLocked || this.isPaused || this.isDragging) return;
    // Don't override active moods
    if (
      this.state.mood === "working" ||
      this.state.mood === "listening" ||
      this.state.mood === "speaking" ||
      this.state.mood === "angry" ||
      this.isRecoveringFromBounds
    ) {
      this.scheduleBehavior(5000);
      return;
    }

    // 1. Check if user is inactive (AFK for > 8.5 seconds): Armed Sentinel Sentry Mode!
    const isAfk = Date.now() - this.lastActivityTime >= USER_INACTIVITY_DELAY_MS;
    if (isAfk) {
      this.isUserInactive = true;
      this.state.accessory = "gun";

      // Keep the armed guard behavior grounded: patrol by walking to a new spot.
      this.state.label = GUN_PATROL_LABELS[Math.floor(Math.random() * GUN_PATROL_LABELS.length)];
      this.walkToRandom();
      return;
    }

    const roll = Math.random();

    // 14% chance: Equip/Remove Hat Routine
    if (roll < 0.14) {
      if (this.state.accessory === "none") {
        this.state.accessory = "hat";
        this.state.label = HAT_LABELS[Math.floor(Math.random() * HAT_LABELS.length)];
        this.setBehavior("sitting");
        this.scheduleBehavior(7000 + Math.random() * 9000);
      } else if (this.state.accessory === "hat") {
        this.state.accessory = "none";
        this.state.label = "Hat off! ✨";
        this.setBehavior("idle");
        this.scheduleBehavior(3000);
      } else {
        this.walkToRandom();
      }
      this.emit();
      return;
    }

    if (roll < 0.48) {
      // Patrol around screen or visit favorite sentinel posts
      this.walkToRandom();
    } else if (roll < 0.62) {
      // Attentive sentinel guard post
      this.setBehavior("guarding");
      if (this.isAtCornerPost && this.state.mood === "idle") {
        this.state.label = GUARDIAN_LABELS[Math.floor(Math.random() * GUARDIAN_LABELS.length)];
      }
      this.scheduleBehavior(6000 + Math.random() * 8000);
    } else if (roll < 0.72) {
      // Curious peek
      this.setBehavior("curious");
      if (this.state.mood === "idle") {
        this.state.label = FUNNY_IDLE_LABELS[Math.floor(Math.random() * FUNNY_IDLE_LABELS.length)];
      }
      this.scheduleBehavior(4000 + Math.random() * 4000);
    } else if (roll < 0.78) {
      // 360° flip / spin
      this.setBehavior("spinning");
      if (this.state.mood === "idle") {
        this.state.label = "Wheee! 🌀";
      }
      setTimeout(() => {
        if (this.behavior === "spinning") {
          this.setBehavior("idle");
          this.scheduleBehavior(3000);
        }
      }, 1000);
    } else if (roll < 0.84) {
      // Joyful high bounce
      this.setBehavior("bouncing");
      if (this.state.mood === "idle") {
        this.state.label = "Boing! ⭐";
      }
      setTimeout(() => {
        if (this.behavior === "bouncing") {
          this.setBehavior("idle");
          this.scheduleBehavior(3000);
        }
      }, 800);
    } else {
      // Hanging vantage point
      this.setBehavior("hanging");
      this.moveTo(this.state.x, 15);
      this.scheduleBehavior(6000 + Math.random() * 8000);
    }
  }

  private walkToRandom() {
    const margin = 20;
    const maxX = Math.max(margin, this.screen.width - 185);
    const maxY = Math.max(margin, this.screen.height - 205);

    let tx: number;
    let ty: number;
    const spotRoll = Math.random();

    // 45% chance to visit favorite sentinel corner guard posts
    if (spotRoll < 0.45) {
      const isLeftCorner = Math.random() < 0.5;
      if (isLeftCorner) {
        // Favorite Bottom-Left Corner Post
        tx = 24;
        ty = maxY;
        this.isAtCornerPost = true;
      } else {
        // Favorite Bottom-Right Corner Post
        tx = maxX;
        ty = maxY;
        this.isAtCornerPost = true;
      }
    } else if (spotRoll < 0.55 && this.windows.length > 0) {
      // Visit an open app window header/edge
      const win = this.windows[Math.floor(Math.random() * this.windows.length)];
      const side = Math.random() < 0.5 ? "top" : "side";
      if (side === "top") {
        tx = win.x + Math.random() * win.width;
        ty = win.y - 10;
      } else {
        tx = win.x + win.width + 5;
        ty = win.y + Math.random() * Math.min(win.height, 200);
      }
      this.isAtCornerPost = false;
    } else {
      // Free patrol roam all around the screen
      tx = margin + Math.random() * Math.max(0, maxX - margin);
      ty = margin + Math.random() * Math.max(0, maxY - margin);
      this.isAtCornerPost = false;
    }

    const safe=this.safePosition(Math.max(margin,Math.min(maxX,tx)),Math.max(margin,Math.min(maxY,ty)));
    this.targetX = safe.x;
    this.targetY = safe.y;
    this.state.flipX = this.targetX < this.state.x;
    this.currentSpeed = 0.2; // Start with gentle organic ease-in
    this.setBehavior("walking");
    this.scheduleBehavior();
  }

  // ---- Tick (organic movement + physics kinematics) ------------------------

  private tick() {
    const now = Date.now();
    const dt = Math.min(now - this.lastTick, 100) / 16.67; // normalize movement across the low-frequency update loop
    this.lastTick = now;
    if (this.isDragging || ((this.isLocked || this.isPaused) && !this.isRecoveringFromBounds)) return;

    // Check AFK condition periodically during ticks
    if (
      !this.isUserInactive &&
      !this.isRecoveringFromBounds &&
      Date.now() - this.lastActivityTime >= USER_INACTIVITY_DELAY_MS
    ) {
      this.isUserInactive = true;
      this.state.accessory = "gun";
      this.state.label = GUN_PATROL_LABELS[Math.floor(Math.random() * GUN_PATROL_LABELS.length)];
      this.walkToRandom();
      this.emit();
    }

    if (this.behavior === "walking" || this.behavior === "following") {
      const dx = this.targetX - this.state.x;
      const dy = this.targetY - this.state.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 3) {
        // Natural kinematic acceleration and deceleration curve
        let targetSpeed = this.speed;
        if (!this.isRecoveringFromBounds) {
          if (dist < 75) {
            targetSpeed = Math.max(0.35, (dist / 75) * this.speed);
          }
          this.currentSpeed += (targetSpeed - this.currentSpeed) * Math.min(1, dt * 0.14);
        } else {
          this.currentSpeed = this.speed;
        }

        const moveStep = this.currentSpeed * dt;
        this.walkPhase += dt * 0.16;

        this.state.x += (dx / dist) * Math.min(moveStep, dist);
        this.state.y += (dy / dist) * Math.min(moveStep, dist);
        this.emit();
      } else {
        this.state.x = this.targetX;
        this.state.y = this.targetY;
        this.currentSpeed = 0;

        if (this.isRecoveringFromBounds) {
          this.behavior = "idle";
          this.state.pose = "idle";
          this.emit();
          this.stopTickLoop();
        } else if (this.behavior === "walking") {
          this.setBehavior(this.isAtCornerPost ? "guarding" : "idle");
          if (this.isAtCornerPost && this.state.mood === "idle") {
            this.state.label = GUARDIAN_LABELS[Math.floor(Math.random() * GUARDIAN_LABELS.length)];
          }
          this.scheduleBehavior(3500 + Math.random() * 5000);
          this.stopTickLoop();
        }
      }
    }
  }

  private emit() {
    this.onStateChange?.({ ...this.state });
  }

  private startTickLoop() {
    if (this.tickId) return;
    this.lastTick = Date.now();
    this.tickId = setInterval(() => this.tick(), 40);
  }

  private stopTickLoop() {
    if (this.tickId) clearInterval(this.tickId);
    this.tickId = null;
  }
}

// ---- Helpers ---------------------------------------------------------------

export function getScreenCenter(): { x: number; y: number } {
  return { x: window.innerWidth / 2 - 87, y: window.innerHeight / 2 - 97 };
}
