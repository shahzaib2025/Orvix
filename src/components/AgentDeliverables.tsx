import { useEffect, useState } from "react";
import { ExternalLink, Eye, File, FolderOpen } from "lucide-react";
import type { AgentDeliverable, AgentTurnReport } from "../desktop";
import { referencedLocalFiles } from "./agentFileLinks";
import "./agent-deliverables.css";

const outputExtensions = /\.(?:pdf|docx?|xlsx?|pptx?|od[tsp]|rtf|txt|md|markdown|csv|tsv|html?|png|jpe?g|webp|gif|svg|mp3|wav|mp4|webm)$/i;
const key = (path: string) => path.replace(/\\/g, "/").toLowerCase();
export function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

export default function AgentDeliverables({ taskId, requestId, report, reply, onPreview }: {
  taskId: string; requestId: string; report?: AgentTurnReport | null; reply: string; onPreview: (file: string) => void;
}) {
  const [files, setFiles] = useState<AgentDeliverable[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const changeKey = report?.changes.map(change => `${change.path}:${change.kind}:${Boolean(change.directory)}`).join("\n") ?? "";
  useEffect(() => {
    let cancelled = false;
    setFiles([]); setExpanded(false); setError("");
    if (!report?.changes.some(change => !change.directory && change.kind !== "deleted")) return;
    const references = new Set(referencedLocalFiles(reply).map(key));
    const bridge = window.orvixDesktop;
    if (!bridge?.getAgentDeliverables) return;
    bridge.getAgentDeliverables(taskId, requestId).then(items => {
      if (!cancelled) setFiles(items.filter(file => file.kind === "created" || outputExtensions.test(file.name) || references.has(key(file.path))));
    }).catch(() => { if (!cancelled) setError("Could not check this turn’s files. Try reopening the chat."); });
    return () => { cancelled = true; };
  }, [taskId, requestId, report?.recordedAt, changeKey, reply]);
  const act = async (file: AgentDeliverable, action: "open" | "reveal") => {
    setBusy(file.path); setError("");
    try {
      if (!window.orvixDesktop?.actOnAgentFile) throw new Error("Restart Orvix to use file actions.");
      await window.orvixDesktop.actOnAgentFile(taskId, file.path, action);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open this file. It may have moved or been removed."); }
    finally { setBusy(null); }
  };
  if (!files.length && !error) return null;
  return <section className="agent-deliverables" aria-label="Files from this turn">
    {!!files.length && <div className="agent-deliverables-heading"><strong>Files</strong><span>{files.length} {files.length === 1 ? "file" : "files"}</span></div>}
    {(expanded ? files : files.slice(0, 3)).map(file => <article className="agent-deliverable" key={file.path}>
      <File size={21} aria-hidden="true" />
      <div className="agent-deliverable-info"><strong title={file.name}>{file.name}</strong><span>{file.kind === "created" ? "Created" : "Updated"} · {fileSize(file.size)}</span><small title={file.path}>{file.path}</small></div>
      <div className="agent-deliverable-actions">
        <button type="button" onClick={() => file.canOpen ? void act(file, "open") : onPreview(file.path)} disabled={busy === file.path} aria-label={`Open ${file.name}`} title={file.canOpen ? "Open in its app" : "Open source preview"}><ExternalLink size={14} />Open</button>
        <button type="button" onClick={() => onPreview(file.path)} aria-label={`Preview ${file.name}`}><Eye size={14} />Preview</button>
        <button type="button" onClick={() => void act(file, "reveal")} disabled={busy === file.path} aria-label={`Show ${file.name} in folder`}><FolderOpen size={14} />Show folder</button>
      </div>
    </article>)}
    {files.length > 3 && <button className="agent-deliverables-more" type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? "Show fewer files" : `Show all ${files.length} files`}</button>}
    {!!error && <p className="agent-deliverables-error" role="status">{error}</p>}
  </section>;
}
