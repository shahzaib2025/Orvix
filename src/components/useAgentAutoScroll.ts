import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

const BOTTOM_THRESHOLD = 42;
const USER_GESTURE_WINDOW_MS = 450;

export function useAgentAutoScroll(
  viewportRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  taskId: string | null,
  enabled = true,
) {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const followingRef = useRef(true);
  const scrollToLatestRef = useRef<(() => void) | null>(null);

  const jumpToLatest = useCallback(() => {
    followingRef.current = true;
    setShowJumpToLatest(false);
    scrollToLatestRef.current?.();
  }, []);

  const jumpToMessage = useCallback((messageId: string) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const message = Array.from(viewport.querySelectorAll<HTMLElement>("[data-agent-message-id]"))
      .find(element => element.dataset.agentMessageId === messageId);
    if (!message) return;
    followingRef.current = false;
    setShowJumpToLatest(viewport.scrollHeight > viewport.clientHeight);
    const top = message.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 12;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(viewport.closest(".reduce-motion"));
    viewport.scrollTo({ top: Math.max(0, top), behavior: reduced ? "instant" : "smooth" });
  }, [viewportRef]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!enabled || !viewport || !content) return;

    let userGestureAt = 0;
    let gestureDirection: "up" | "down" | null = null;
    let lastScrollTop = viewport.scrollTop;
    let touchY = 0;
    let scrollbarPointerY: number | null = null;
    let scrollbarPointerActive = false;
    const distanceFromBottom = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop);
    let followFrame = 0;
    const scheduleFollow = () => {
      if (!followingRef.current || followFrame) return;
      followFrame = requestAnimationFrame(() => {
        followFrame = 0;
        if (followingRef.current && viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      });
    };
    const setFollowing = (following: boolean) => {
      if (followingRef.current === following) return;
      followingRef.current = following;
      setShowJumpToLatest(!following);
      if (following) scheduleFollow();
    };
    const onScroll = () => {
      const currentTop = viewport.scrollTop;
      const recentUserGesture = performance.now() - userGestureAt < USER_GESTURE_WINDOW_MS;
      const movedUp = currentTop < lastScrollTop - 1;
      const movedDown = currentTop > lastScrollTop + 1;
      const distance = distanceFromBottom();
      if (scrollbarPointerActive && recentUserGesture) {
        if (movedUp) gestureDirection = "up";
        else if (movedDown) gestureDirection = "down";
      }
      // Release only when the chat viewport itself moves up. Wheel/touch events
      // bubble from nested scrollable cards and do not necessarily scroll chat.
      if (movedUp && recentUserGesture && gestureDirection === "up" && distance > BOTTOM_THRESHOLD) setFollowing(false);
      else if (distance <= BOTTOM_THRESHOLD && !followingRef.current &&
        gestureDirection === "down" && movedDown && recentUserGesture) setFollowing(true);
      lastScrollTop = currentTop;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      userGestureAt = performance.now();
      gestureDirection = event.deltaY > 0 ? "down" : "up";
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, a, input, textarea, select, [contenteditable='true'], [role='textbox'], [role='button']")) return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        userGestureAt = performance.now();
        gestureDirection = "up";
      } else if (["ArrowDown", "PageDown", "End"].includes(event.key)) {
        userGestureAt = performance.now();
        gestureDirection = "down";
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.clientX >= viewport.getBoundingClientRect().right - 22) {
        userGestureAt = performance.now();
        scrollbarPointerY = event.clientY;
        scrollbarPointerActive = true;
        gestureDirection = null;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!scrollbarPointerActive || scrollbarPointerY === null) return;
      const deltaY = event.clientY - scrollbarPointerY;
      if (Math.abs(deltaY) <= 2) return;
      userGestureAt = performance.now();
      gestureDirection = deltaY > 0 ? "down" : "up";
      scrollbarPointerY = event.clientY;
    };
    const onPointerEnd = () => {
      scrollbarPointerY = null;
      scrollbarPointerActive = false;
    };
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? touchY;
      if (Math.abs(nextY - touchY) > 2) {
        userGestureAt = performance.now();
        gestureDirection = nextY < touchY ? "down" : "up";
      }
      touchY = nextY;
    };

    followingRef.current = true;
    setShowJumpToLatest(false);
    viewport.scrollTop = viewport.scrollHeight;
    lastScrollTop = viewport.scrollTop;
    scrollToLatestRef.current = scheduleFollow;
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove, { passive: true });
    viewport.addEventListener("pointerup", onPointerEnd);
    viewport.addEventListener("pointercancel", onPointerEnd);
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    const observer = new ResizeObserver(scheduleFollow);
    observer.observe(content);
    observer.observe(viewport);
    const mutations = new MutationObserver(scheduleFollow);
    mutations.observe(content, { childList: true, subtree: true, characterData: true });
    scheduleFollow();

    return () => {
      if (followFrame) cancelAnimationFrame(followFrame);
      observer.disconnect();
      mutations.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerEnd);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      scrollToLatestRef.current = null;
    };
  }, [taskId, viewportRef, contentRef, enabled]);

  return { showJumpToLatest, jumpToLatest, jumpToMessage };
}
