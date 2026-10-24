import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { FileText, Maximize2, Minimize2, X } from "lucide-react";
import type { DesignOptionsPresentationResult } from "./designOptionsPresentation";
import "./agent-design-options-preview.css";

export default function AgentDesignOptionsPreview({
  choices,
  option,
  width,
  maximized,
  onSelect,
  onResize,
  onToggleMaximize,
  onClose,
}: {
  choices: DesignOptionsPresentationResult;
  option: "A" | "B";
  width: number;
  maximized: boolean;
  onSelect: (option: "A" | "B") => void;
  onResize: (width: number) => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const selected = choices.options.find(item => item.label === option) ?? choices.options[0];

  useEffect(() => {
    const previous = document.activeElement;
    const element = panel.current;
    element?.focus({ preventScroll: true });
    return () => {
      if ((document.activeElement === document.body || element?.contains(document.activeElement)) && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  return <aside
    className="agent-file-panel agent-design-options-preview"
    ref={panel}
    tabIndex={-1}
    aria-label="Design options preview"
    onKeyDown={event => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}
  >
    {!maximized && <div className="agent-file-panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize design preview sidebar" tabIndex={0}
      aria-valuemin={360} aria-valuemax={800} aria-valuenow={width}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) onResize(drag.current.width + drag.current.x - event.clientX); }}
      onPointerUp={stopResize} onPointerCancel={stopResize} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onResize((panel.current?.getBoundingClientRect().width ?? width) + (event.key === "ArrowLeft" ? 24 : -24));
        }
      }} />}
    <header className="agent-file-panel-header">
      <div className="agent-file-panel-title"><FileText size={17} aria-hidden="true" /><div><h2>Design options</h2><span>Read the complete directions</span></div></div>
      <div className="agent-file-panel-controls">
        <button type="button" onClick={onToggleMaximize} aria-label={maximized ? "Restore design preview sidebar" : "Expand design preview sidebar"} title={maximized ? "Restore sidebar" : "Expand sidebar"}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button type="button" onClick={onClose} aria-label="Close design preview sidebar" title="Close sidebar (Esc)"><X size={17} /></button>
      </div>
    </header>
    <div className="agent-file-panel-toolbar agent-design-options-preview-toolbar">
      <div className="agent-editor-tab-strip" role="tablist" aria-label="Design directions" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next]?.focus();
        tabs[next]?.click();
      }}>
        {choices.options.map(item => <div className={`agent-editor-tab${item.label === option ? " selected" : ""}`} key={item.label}>
          <button type="button" id={`agent-design-options-preview-tab-${item.label.toLowerCase()}`} role="tab" aria-selected={item.label === option} aria-controls="agent-design-options-preview-content" tabIndex={item.label === option ? 0 : -1}
            title={`Option ${item.label}${item.title ? `: ${item.title}` : ""}`} onClick={() => onSelect(item.label)}>
            <FileText size={14} aria-hidden="true" /><span>Option {item.label}{item.title ? ` · ${item.title}` : ""}</span>
          </button>
        </div>)}
      </div>
      <span className="agent-design-options-preview-count">{option} / 2</span>
    </div>
    <div id="agent-design-options-preview-content" className="agent-file-panel-body agent-design-options-preview-body" role="tabpanel"
      aria-labelledby={`agent-design-options-preview-tab-${option.toLowerCase()}`} tabIndex={0}>
      <article className="agent-design-options-preview-article">
        <div className="agent-design-options-preview-heading">
          <h3>Option {selected.label}{selected.title ? `: ${selected.title}` : ""}</h3>
          {selected.selected && <span className="agent-design-options-preview-selected">Selected for build</span>}
        </div>
        <div className="agent-design-options-preview-copy">{selected.body}</div>
        {choices.reason && <section className="agent-design-options-preview-reason"><strong>Selection rationale</strong><p>{choices.reason}</p></section>}
        {choices.status && <p className="agent-design-options-preview-status">{choices.status}</p>}
      </article>
    </div>
    <footer className="agent-file-panel-footer"><span>Read-only design preview</span><span>Option {selected.label}{selected.selected ? " · Selected" : ""}</span></footer>
  </aside>;
}
