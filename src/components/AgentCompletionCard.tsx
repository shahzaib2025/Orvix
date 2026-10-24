import { AlertTriangle, CheckCircle2, ChevronDown, CircleCheck, FileCode2 } from "lucide-react";
import type { TaskPresentation } from "./agentTaskPresentation";
import { completionEvidence, elapsedTime } from "./agentTaskPresentation";
import AgentTurnFacts from "./AgentTurnFacts";
import AgentVerificationResult from "./AgentVerificationResult";

export default function AgentCompletionCard({ turn, onOpenFile }: {
  turn: TaskPresentation; onOpenFile: (file?: string) => void;
}) {
  if (!turn.status || turn.status === "pending") return null;
  const result = completionEvidence(turn);
  const Icon = result.tone === "error" || result.tone === "attention" ? AlertTriangle : result.tone === "success" ? CheckCircle2 : CircleCheck;
  const started = turn.runStartedAt ?? turn.runState?.startedAt ?? turn.createdAt;
  const completed = turn.completedAt ?? turn.runState?.completedAt;
  const hasEvidence = Boolean(result.report?.changes.length || result.verification);
  return <section className={`agent-completion-card is-${result.tone}`} aria-label="Task completion summary">
    <div className="agent-completion-heading"><Icon size={17} aria-hidden="true" /><strong>{result.title}</strong>{completed !== undefined && <time>{elapsedTime(completed - started)}</time>}</div>
    <div className="agent-completion-stats">
      <span><FileCode2 size={13} />{result.changesRecorded ? `${result.files.length} file${result.files.length === 1 ? "" : "s"} changed` : "File changes not recorded"}</span>
      {result.files.length > 0 && <span className="agent-completion-lines" title={result.limited ? "Known line counts; some comparisons are unavailable" : "Line changes in this turn"}><b>+{result.added}</b><i>−{result.deleted}</i>{result.limited && <small>known</small>}</span>}
      <span>{result.passed} check{result.passed === 1 ? "" : "s"} passed</span>{result.failed > 0 && <span className="agent-completion-failed">{result.failed} failed</span>}
    </div>
    {result.issues.length > 0 && <ul className="agent-completion-attention" aria-label="Needs attention">{result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    {hasEvidence && <details className="agent-completion-evidence"><summary>Files and check details<ChevronDown size={13} /></summary>
      <AgentVerificationResult result={result.verification} />
      <AgentTurnFacts report={result.report} onOpen={onOpenFile} embedded />
    </details>}
  </section>;
}
