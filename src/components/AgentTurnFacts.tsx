import { useState } from "react";
import { ArrowUpRight, FileCode2, Folder, ShieldCheck, ShieldX, CircleSlash2, Maximize2, Minimize2 } from "lucide-react";
import type { AgentTurnReport } from "../desktop";
import "./agent-turn-facts.css";

function fileName(path: string) { return path.split(/[\\/]/).at(-1) || path; }

export default function AgentTurnFacts({ report, onOpen, embedded = false }: { report?: AgentTurnReport | null; onOpen: (file?: string) => void; embedded?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  if (!report) return null;
  const files = report.changes.filter(item => !item.directory);
  const folders = report.changes.length - files.length;
  const verification = report.verification;
  const hasChecks = verification && verification.status !== "not_needed";
  if (report.changes.length === 0 && !hasChecks) return null;
  if (embedded && report.changes.length === 0) return null;
  const added = files.reduce((sum, item) => sum + item.added, 0);
  const deleted = files.reduce((sum, item) => sum + item.deleted, 0);
  const lineCountsLimited = files.some(item => !item.binary && item.diffAvailable === false);
  const checkLabel = verification?.status === "passed" ? "Checks passed" : verification?.status === "failed" ? "Checks failed"
    : verification?.status === "not_run" || files.length > 0 ? "Checks not run" : null;
  const CheckIcon = verification?.status === "passed" ? ShieldCheck : verification?.status === "failed" ? ShieldX : CircleSlash2;
  const visible = report.changes.slice(0, 8);
  return <section className={`agent-turn-facts${embedded ? " is-embedded" : collapsed ? " is-collapsed" : ""}`} aria-label="Recorded results for this turn">
    {!embedded && <>
    <div className="agent-turn-facts-head"><div className="agent-turn-facts-title"><span className="agent-turn-facts-icon"><FileCode2 size={15} /></span><strong>Recorded this turn</strong></div><div className="agent-turn-facts-head-actions"><span className={`agent-turn-facts-count${collapsed ? " is-lines" : ""}`}>{collapsed ? <><b>+{added}</b><i>−{deleted}</i></> : <>{files.length} {files.length === 1 ? "file" : "files"}{folders > 0 ? ` · ${folders} ${folders === 1 ? "folder" : "folders"}` : ""}</>}</span><button type="button" className="agent-turn-facts-toggle" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand recorded results" : "Minimize recorded results"} title={collapsed ? "Expand recorded results" : "Minimize recorded results"}>{collapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}</button></div></div>
    </>}
    {(embedded || !collapsed) && <>
    <div className="agent-turn-facts-stats"><span><b>+{added}</b> {lineCountsLimited ? "known added" : "added"}</span><span><b>−{deleted}</b> {lineCountsLimited ? "known deleted" : "deleted"}</span>{checkLabel && <span className={`agent-turn-check is-${verification?.status}`}><CheckIcon size={13} />{checkLabel}</span>}</div>
    {report.changes.length > 0 && <div className="agent-turn-facts-files">{visible.map(item => <button type="button" key={item.path} onClick={() => onOpen(item.path)} title={item.path}>
      <span className={`agent-turn-kind is-${item.kind}`}>{item.directory ? <Folder size={12} /> : item.kind === "created" ? "+" : item.kind === "deleted" ? "−" : "M"}</span>
      <span className="agent-turn-file-name">{fileName(item.path)}<small>{item.folder}</small></span>
      <span className="agent-turn-file-count">{item.directory ? "Folder" : item.binary ? "Binary" : item.diffAvailable === false ? "Tracked" : <><b>+{item.added}</b><i>−{item.deleted}</i></>}</span>
      <ArrowUpRight size={13} className="agent-turn-file-arrow" />
    </button>)}{report.changes.length > visible.length && <p className="agent-turn-facts-more">And {report.changes.length - visible.length} more files</p>}</div>}
    {report.comparisonsLimited && <p className="agent-turn-facts-note">Some file comparisons are unavailable because of size limits. File counts remain available.</p>}
    </>}
  </section>;
}
