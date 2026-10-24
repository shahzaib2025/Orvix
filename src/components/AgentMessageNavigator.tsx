import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { Bookmark } from "lucide-react";
import "./agent-message-navigator.css";

type Message = { id: string; prompt: string; reply: string; pending?: boolean };

export default function AgentMessageNavigator({ scrollRef, messages, onNavigate }: {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: Message[];
  onNavigate: (id: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const previewId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; top: number; width: number } | null>(null);
  const messageIds = JSON.stringify(messages.map(message => message.id));

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    const visibleElements = new Map<HTMLElement, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            visibleElements.set(el, entry.boundingClientRect.top);
          } else {
            visibleElements.delete(el);
          }
        }
        if (visibleElements.size > 0) {
          let topEl: HTMLElement | null = null;
          let minTop = Infinity;
          for (const [el, top] of visibleElements.entries()) {
            if (top < minTop) {
              minTop = top;
              topEl = el;
            }
          }
          const targetId = topEl?.dataset.agentMessageId;
          if (targetId) {
            setActiveId(curr => (curr === targetId ? curr : targetId));
          }
        }
      },
      {
        root: viewport,
        rootMargin: "-24px 0px -40% 0px",
        threshold: 0,
      }
    );

    const observeNodes = () => {
      const nodes = viewport.querySelectorAll<HTMLElement>("[data-agent-message-id]");
      nodes.forEach(node => observer.observe(node));
    };
    observeNodes();

    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 6) {
          const lastId = messages.at(-1)?.id;
          if (lastId) setActiveId(curr => (curr === lastId ? curr : lastId));
        }
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });

    const inner = viewport.firstElementChild;
    const mutations = new MutationObserver(() => {
      observeNodes();
    });
    if (inner) {
      mutations.observe(inner, { childList: true });
    }

    return () => {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      viewport.removeEventListener("scroll", onScroll);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [scrollRef, messageIds, messages]);

  const openPreview = (id: string, button: HTMLElement) => {
    const nav = navRef.current;
    if (!nav) return;
    const offset = button.getBoundingClientRect().top - nav.getBoundingClientRect().top;
    setPreview({ id, top: Math.max(0, Math.min(offset - 20, nav.clientHeight - 132)), width: Math.min(320, (scrollRef.current?.clientWidth ?? 385) - 65) });
  };
  const selected = messages.find(message => message.id === preview?.id);
  if (!messages.length) return null;

  return <nav className="agent-message-nav" ref={navRef} aria-label="Messages in this conversation"
    onPointerLeave={() => { if (!navRef.current?.contains(document.activeElement)) setPreview(null); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}
    onKeyDown={event => {
      if (event.key === "Escape") { setPreview(null); return; }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".agent-message-nav-marker"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + (event.key === "ArrowUp" ? -1 : 1);
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
    }}>
    <div className="agent-message-nav-markers" style={{ height: `min(100%, ${messages.length * 10}px)` }}>
      {messages.map((message, index) => <button key={message.id} type="button"
        className={`agent-message-nav-marker${activeId === message.id ? " is-active" : ""}`}
        aria-label={`Go to message ${index + 1}: ${message.prompt.slice(0, 160) || "Attachments"}`}
        aria-current={activeId === message.id ? "location" : undefined}
        tabIndex={activeId === message.id || (!activeId && index === 0) ? 0 : -1}
        aria-describedby={preview?.id === message.id ? previewId : undefined}
        onPointerEnter={event => openPreview(message.id, event.currentTarget)}
        onFocus={event => openPreview(message.id, event.currentTarget)}
        onClick={() => onNavigate(message.id)}><span aria-hidden="true" /></button>)}
    </div>
    {selected && <div id={previewId} role="tooltip" className="agent-message-nav-preview" style={{ top: preview?.top, width: preview?.width }}>
      <div className="agent-message-nav-preview-heading"><strong>{selected.prompt || "Attachments"}</strong><Bookmark size={14} aria-hidden="true" /></div>
      {(selected.reply || selected.pending) && <p>{selected.reply || "Working on this message…"}</p>}
    </div>}
  </nav>;
}
