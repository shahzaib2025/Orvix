import { useEffect, useState } from "react";
import { Eye, FolderOpen, Maximize2, Minimize2, RefreshCw, Search, X } from "lucide-react";
import { isPreviewFile } from "./agentTaskPresentation";

export default function AgentPreviewPicker({ taskId, workspaces, maximized, onToggleMaximize, onClose, onSelect }: {
  taskId: string; workspaces: string[]; maximized: boolean; onToggleMaximize: () => void; onClose: () => void; onSelect: (file: string) => void;
}) {
  const [files, setFiles] = useState<{ path: string; relativePath: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [limited, setLimited] = useState(false);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFiles([]); setError(""); setLimited(false);
    if (!workspaces.length) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      const bridge = window.orvixDesktop;
      if (!bridge?.listAgentWorkspaceFiles) { if (active) { setError("Workspace browsing is unavailable in this app session."); setLoading(false); } return; }
      const results = await Promise.allSettled(workspaces.map(root => bridge.listAgentWorkspaceFiles(taskId, root)));
      if (!active) return;
      const next = results.flatMap(result => result.status === "fulfilled" ? result.value.files.filter(file => isPreviewFile(file.path)) : []);
      setFiles([...new Map(next.map(file => [file.path, file])).values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
      setLimited(results.some(result => result.status === "fulfilled" && result.value.truncated));
      if (results.some(result => result.status === "rejected")) setError("Some workspace files could not be listed. Refresh to try again.");
      setLoading(false);
    })();
    return () => { active = false; };
  }, [taskId, workspaces, revision]);
  const matches = files.filter(file => file.relativePath.toLowerCase().includes(query.toLowerCase().trim()));
  return <aside className="agent-file-panel agent-preview-picker" aria-label="Choose a file to preview" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="agent-file-panel-header"><div className="agent-file-panel-title"><Eye size={17} /><div><h2>Preview</h2><span>Choose a file from this task’s workspace</span></div></div><div className="agent-file-panel-controls">
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading || !workspaces.length} aria-label="Refresh preview files" title="Refresh files"><RefreshCw size={15} /></button>
      <button type="button" onClick={onToggleMaximize} aria-label={maximized ? "Restore file sidebar" : "Expand file sidebar"}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      <button type="button" onClick={onClose} aria-label="Close file sidebar" title="Close preview"><X size={17} /></button>
    </div></header>
    <label className="agent-preview-search"><Search size={14} /><input autoFocus aria-label="Search preview files" placeholder="Find HTML, images, Markdown or PDF" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="agent-file-panel-body">
      {error && <p className="agent-file-panel-message is-error" role="status">{error}</p>}
      {loading ? <p className="agent-file-panel-message" role="status">Finding preview files…</p> : matches.length ? <div className="agent-preview-file-list">{matches.map(file => <button type="button" key={file.path} onClick={() => onSelect(file.path)} title={file.path}><FolderOpen size={15} /><span>{file.relativePath}</span><Eye size={13} /></button>)}</div>
        : <p className="agent-file-panel-message">{!workspaces.length ? "Open a project workspace in this task to preview its files." : query ? "No preview files match your search." : "No previewable files yet. HTML, images, Markdown and PDF files will appear here."}</p>}
      {limited && <p className="agent-file-panel-note">The workspace listing was limited. Open another workspace to browse files outside this listing.</p>}
    </div>
    <footer className="agent-file-panel-footer">Read-only file preview · websites may need their project server for scripts and linked assets.</footer>
  </aside>;
}
