import { useEffect, useState } from "react";
import { FileCode2, GitCompareArrows } from "lucide-react";
import type { AgentRenameSummary } from "../desktop";
import "./agent-rename-review.css";

export default function AgentRenameReview({ approvalId, summary, onDecision }: {
  approvalId: string;
  summary?: AgentRenameSummary;
  onDecision: (approved: boolean) => void;
}) {
  const [selected, setSelected] = useState(summary?.files[0]?.file ?? "");
  const [patch, setPatch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true);
    setPatch("");
    setError("");
    const desktop = window.orvixDesktop;
    if (!desktop) { setError("Desktop connection is unavailable."); setLoading(false); return; }
    void desktop.getAgentApprovalDiff(approvalId, selected).then(result => {
      if (active) setPatch(result.patch);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load this comparison.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [approvalId, selected]);

  return <div className="agent-rename-backdrop"><section className="agent-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-rename-title">
    <header><div><GitCompareArrows size={18} /><div><h2 id="agent-rename-title">Review symbol rename</h2>
      <p>{summary ? <><strong>{summary.oldName}</strong> → <strong>{summary.newName}</strong> · {summary.occurrences} locations in {summary.files.length} files</> : "Rename preview is unavailable."}</p>
    </div></div></header>
    <div className="agent-rename-body">
      <nav className="agent-rename-files" aria-label="Files in proposed rename">
        {summary?.files.map(item => <button key={item.file} className={selected === item.file ? "selected" : ""}
          onClick={() => setSelected(item.file)} title={item.file} aria-current={selected === item.file ? "true" : undefined}>
          <FileCode2 size={15} /><span><strong>{item.file.split(/[\\/]/).at(-1)}</strong><small>{item.file}</small></span>
          <em>{item.occurrences}</em>
        </button>)}
      </nav>
      <div className="agent-rename-preview">
        <div className="agent-rename-preview-title"><span title={selected}>{selected || "Comparison"}</span>
          {summary && <small>+{summary.files.find(item => item.file === selected)?.added ?? 0} / −{summary.files.find(item => item.file === selected)?.deleted ?? 0}</small>}
        </div>
        {error ? <p role="alert" className="agent-rename-error">{error}</p> : loading ? <p className="agent-rename-loading">Loading comparison…</p>
          : <pre className="agent-rename-patch">{patch.split("\n").map((line, index) => <span key={index}
            className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""}>{line}</span>)}</pre>}
      </div>
    </div>
    <footer><p>Orvix will check that these files have not changed before applying the rename.</p>
      <div><button onClick={() => onDecision(false)}>Decline</button><button className="apply" disabled={!summary || !patch || loading || Boolean(error)} onClick={() => onDecision(true)}>Apply rename</button></div>
    </footer>
  </section></div>;
}
