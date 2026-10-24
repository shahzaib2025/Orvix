// Conversation orbs share one pointer listener and only update while visible.
const registered = new Set<HTMLDivElement>();
const visible = new Set<HTMLDivElement>();
let observer: IntersectionObserver | null = null;
let reducedMotion: MediaQueryList | null = null;
let frame = 0;
let pointerX = 0;
let pointerY = 0;
let hasPointer = false;

function resetPose(avatar: HTMLDivElement) {
  for (const property of ["--orb-turn-x", "--orb-turn-y", "--orb-shift-x", "--orb-shift-y", "--orb-eye-x", "--orb-eye-y"]) {
    avatar.style.removeProperty(property);
  }
}

function updateVisibleOrbs() {
  frame = 0;
  if (!hasPointer || document.hidden || reducedMotion?.matches || document.documentElement.classList.contains("reduce-motion")) return;
  for (const avatar of visible) {
    const bounds = avatar.getBoundingClientRect();
    const x = pointerX - (bounds.left + bounds.width / 2);
    const y = pointerY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(x, y);
    const proximity = Math.max(0, 1 - distance / 280);
    const horizontal = Math.max(-1, Math.min(1, x / 170)) * proximity;
    const vertical = Math.max(-1, Math.min(1, y / 170)) * proximity;
    const eyeX = distance > 0 && distance < 600 ? (x / distance) * 1.05 : 0;
    const eyeY = distance > 0 && distance < 600 ? (y / distance) * .75 : 0;
    avatar.style.setProperty("--orb-turn-y", `${horizontal * 7}deg`);
    avatar.style.setProperty("--orb-turn-x", `${vertical * -6}deg`);
    avatar.style.setProperty("--orb-shift-x", `${horizontal * 1.4}px`);
    avatar.style.setProperty("--orb-shift-y", `${vertical * 1.2}px`);
    avatar.style.setProperty("--orb-eye-x", `${eyeX}px`);
    avatar.style.setProperty("--orb-eye-y", `${eyeY}px`);
  }
}

function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(updateVisibleOrbs);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
  pointerX = event.clientX;
  pointerY = event.clientY;
  hasPointer = true;
  scheduleUpdate();
}

function onBlur() {
  hasPointer = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  for (const avatar of registered) resetPose(avatar);
}

function onVisibilityChange() {
  if (document.hidden) onBlur();
}

function onReducedMotionChange() {
  if (reducedMotion?.matches) onBlur();
  else scheduleUpdate();
}

export function attachOrbMotion(avatar: HTMLDivElement | null): () => void {
  if (!avatar) return () => {};
  if (registered.size === 0) {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const orb = entry.target as HTMLDivElement;
        if (entry.isIntersecting) {
          visible.add(orb);
          orb.classList.add("orb-visible");
          if (hasPointer) scheduleUpdate();
        } else {
          visible.delete(orb);
          orb.classList.remove("orb-visible");
          resetPose(orb);
        }
      }
    }, { rootMargin: "40px" });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onReducedMotionChange);
  }
  registered.add(avatar);
  observer?.observe(avatar);
  return () => {
    observer?.unobserve(avatar);
    registered.delete(avatar);
    visible.delete(avatar);
    avatar.classList.remove("orb-visible");
    resetPose(avatar);
    if (registered.size === 0) {
      observer?.disconnect();
      observer = null;
      reducedMotion?.removeEventListener("change", onReducedMotionChange);
      reducedMotion = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      hasPointer = false;
    }
  };
}
