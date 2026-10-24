import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Code2, ExternalLink, Eye, FileCode2, FolderOpen, Info, Maximize2, Minimize2, RotateCw, X } from "lucide-react";
import type { AgentFilePreview as Preview } from "../desktop";
import { SourceView } from "./AgentChanges";
import AgentCopyButton from "./AgentCopyButton";
import AgentFilePreviewContent from "./AgentFilePreviewContent";
import "./agent-file-panel.css";

function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

export default function AgentFilePreview({ taskId, file, width, maximized, onResize, onToggleMaximize, onClose, onChooseFile }: {
  taskId: string; file: string; width: number; maximized: boolean; onResize: (width: number) => void;
  onToggleMaximize: () => void; onClose: () => void;
  onChooseFile?: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const previous = document.activeElement;
    const element = panel.current;
    element?.focus({ preventScroll: true });
    return () => {
      if ((document.activeElement === document.body || element?.contains(document.activeElement)) && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setError("");
    const bridge = window.orvixDesktop;
    if (!bridge?.previewAgentFile) { setError("Restart Orvix to use file previews."); return; }
    bridge.previewAgentFile(taskId, file).then(value => { if (!cancelled) setPreview(value); }).catch(error => {
      if (!cancelled) setError(error instanceof Error ? error.message : "This file is unavailable. It may have moved or been removed.");
    });
    return () => { cancelled = true; };
  }, [taskId, file, revision]);
  const act = async (action: "open" | "reveal") => {
    setBusy(true); setError("");
    try {
      if (!window.orvixDesktop?.actOnAgentFile) throw new Error("File actions require the desktop app.");
      await window.orvixDesktop.actOnAgentFile(taskId, file, action);
    }
    catch (error) { setError(error instanceof Error ? error.message : "Could not open this file."); }
    finally { setBusy(false); }
  };
  const name = preview?.name ?? file.split(/[\\/]/).at(-1) ?? file;
  const markdown = preview?.kind === "text" && /\.(?:md|markdown)$/i.test(name);
  const canPreview = preview?.kind === "html" || preview?.kind === "image" || preview?.kind === "pdf" || markdown;
  const canCode = preview?.kind === "text" || preview?.kind === "html";
  const showCode = canCode && (source || !canPreview);
  const code = useMemo(() => (preview?.content ?? "").slice(0, 512_000), [preview?.content]);
  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  return <aside className="agent-file-panel" ref={panel} tabIndex={-1} aria-label={`File viewer: ${name}`} onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    {!maximized && <div className="agent-file-panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize file sidebar" tabIndex={0}
      aria-valuemin={360} aria-valuemax={800} aria-valuenow={width}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) onResize(drag.current.width + drag.current.x - event.clientX); }}
      onPointerUp={stopResize} onPointerCancel={stopResize} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onResize((panel.current?.getBoundingClientRect().width ?? width) + (event.key === "ArrowLeft" ? 24 : -24)); } }} />}
    <header className="agent-file-panel-header">
      <div className="agent-file-panel-title"><FileCode2 size={17} aria-hidden="true" /><div><h2 title={name}>{name}</h2><span title={file}>{file}</span></div></div>
      <div className="agent-file-panel-controls">
        {onChooseFile && <button type="button" onClick={onChooseFile} aria-label="Choose another preview file" title="Choose another file"><FolderOpen size={15} /></button>}
        <button type="button" disabled={!preview && !error} onClick={() => setRevision(value => value + 1)} aria-label="Refresh file" title="Refresh file"><RotateCw size={15} /></button>
        <button type="button" onClick={onToggleMaximize} aria-label={maximized ? "Restore file sidebar" : "Expand file sidebar"} title={maximized ? "Restore sidebar" : "Expand sidebar"}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button type="button" onClick={onClose} aria-label="Close file sidebar" title="Close sidebar (Esc)"><X size={17} /></button>
      </div>
    </header>
    <div className="agent-file-panel-toolbar">
      <div className="agent-file-panel-tabs" role="tablist" aria-label="File view" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {canPreview && <button id="agent-file-preview-tab" role="tab" type="button" aria-selected={!showCode} aria-controls="agent-file-panel-content" tabIndex={showCode ? -1 : 0} onClick={() => setSource(false)}><Eye size={14} />Preview</button>}
        {canCode && <button id="agent-file-code-tab" role="tab" type="button" aria-selected={!!showCode} aria-controls="agent-file-panel-content" tabIndex={showCode ? 0 : -1} onClick={() => setSource(true)}><Code2 size={14} />Code</button>}
      </div>
      <div className="agent-file-panel-tools">
        {canCode && <AgentCopyButton text={preview?.content ?? ""} label="Copy" accessibleLabel="Copy file contents" />}
        {preview?.canOpen && <button type="button" disabled={busy} onClick={() => void act("open")} aria-label="Open file in app" title="Open in app"><ExternalLink size={14} /></button>}
        {preview && <button type="button" disabled={busy} onClick={() => void act("reveal")} aria-label="Show file in folder" title="Show in folder"><FolderOpen size={14} /></button>}
      </div>
    </div>
    <div id="agent-file-panel-content" className={`agent-file-panel-body${showCode ? " is-code" : ""}`} role={canPreview || canCode ? "tabpanel" : undefined} aria-labelledby={canPreview || canCode ? showCode ? "agent-file-code-tab" : "agent-file-preview-tab" : undefined} tabIndex={0}>
      {error && <p className="agent-file-panel-message is-error" role="status">{error}</p>}
      {!preview && !error && <p className="agent-file-panel-message" role="status">Opening file…</p>}
      {showCode && preview ? <>
        {code.length < (preview.content?.length ?? 0) && <p className="agent-file-panel-note">Large file · showing the first 512,000 characters. Copy includes the full contents.</p>}
        <SourceView key={`${file}:${revision}`} file={{ path: file, content: code, size: preview.size, binary: false, tooLarge: false }} value={code} maxLines={4000} />
      </> : preview ? <AgentFilePreviewContent preview={preview} /> : null}
    </div>
    <footer className="agent-file-panel-footer"><span>{showCode ? "Read-only source" : preview?.kind === "html" ? "Static HTML preview" : "File preview"}</span>
      <span>{preview?.kind === "html" && !showCode && <Info size={12} aria-label="Linked assets and scripts require opening or running the project." />} {preview ? fileSize(preview.size) : ""}</span>
    </footer>
  </aside>;
}
