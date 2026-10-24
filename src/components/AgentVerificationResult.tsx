import { designProfileLabel } from '../agentDesignProfiles';
import { AlertTriangle, CheckCircle2, CircleSlash2, ChevronDown, Clock3, ShieldCheck } from "lucide-react";
import type { AgentVerification } from "../desktop";
import "./agent-verification.css";

const statusCopy = {
  passed: { title: "Checks passed", Icon: CheckCircle2 },
  failed: { title: "Checks found issues", Icon: AlertTriangle },
  not_run: { title: "Checks not run", Icon: CircleSlash2 },
  not_needed: { title: "No checks recorded", Icon: ShieldCheck },
} as const;

const phaseCopy = { reproduce: "Reproduction", focused: "Focused", typecheck: "Type check", regression: "Regression", build: "Build", user_flow: "User flow", layout: "Layout", accessibility: "Accessibility", performance: "Performance" } as const;

function duration(value: number) {
  if (value < 1000) return `${Math.max(0.1, value / 1000).toFixed(1)}s`;
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round(value % 60_000 / 1000)}s`;
}

export default function AgentVerificationResult({ result }: { result?: AgentVerification }) {
  if (!result || !statusCopy[result.status] || !Array.isArray(result.checks)) return null;
  if (result.status === "not_needed" && !result.checks.length && !result.designReview && !result.usageStages?.length) return null;
  const { title, Icon } = statusCopy[result.status];
  const postChecks = result.checks.filter(check => check.phase !== "reproduce" && !check.superseded);
  const flowChecked = postChecks.some(check => check.phase === "user_flow" && check.status === "passed" && !check.stale);
  const flowFailed = postChecks.some(check => check.phase === "user_flow" && check.status === "failed" && !check.stale);
  const passedCount = postChecks.filter(check => check.status === "passed" && !check.stale).length;
  const failedCheck = postChecks.find(check => check.status === "failed" && !check.stale);
  const fullyPassed = result.status === "passed" && postChecks.length > 0 && postChecks.every(check => check.status === "passed" && !check.stale);
  const firstFailureLine = failedCheck?.output.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  const summaryMessage = failedCheck
    ? `Issue: ${failedCheck.label} failed${firstFailureLine ? ` · ${firstFailureLine.slice(0, 110)}` : ""}`
    : result.status === "failed" ? `Needs attention · ${result.reason || "Verification found an issue"}`
      : fullyPassed ? `${passedCount} current check${passedCount === 1 ? "" : "s"} passed`
        : result.status === "not_run" ? `Checks not run · ${result.reason || "No verification evidence recorded"}`
          : result.status === "not_needed" ? "No checks required"
            : `${passedCount} checks passed · ${flowChecked ? "User flow checked" : "No current user-flow check"}`;
  return <section className={`agent-verification is-${result.status}`} aria-label="Observed verification evidence">
    <details className="agent-verification-card">
      <summary className="agent-verification-summary">
        <Icon size={15} />
        <strong>{title}</strong>
        <span className="agent-verification-summary-message" title={summaryMessage}>{summaryMessage}</span>
        <small>{passedCount} passed · {postChecks.filter(check => check.status === "failed" && !check.stale).length} failed</small>
        <ChevronDown size={14} className="agent-verification-chevron" />
      </summary>
      <div className="agent-verification-content">
    {result.reason && <p>{result.reason}</p>}
    {result.designReview && result.designReview.status !== 'not_needed' && <details className="agent-verification-check"><summary><span>Design review · {result.designReview.status.replace(/_/g, ' ')}</span><small>{result.designReview.profile ? designProfileLabel(result.designReview.profile) : (result.designReview.mode === 'quality' ? 'Thorough' : result.designReview.mode)} · {result.designReview.revisions} {result.designReview.revisions === 1 ? 'revision' : 'revisions'}</small></summary>
      <div className="agent-verification-detail">{result.designReview.reason && <p>{result.designReview.reason}</p>}{result.designReview.reviews.map((review, index) => <div key={index}><p>{review.result.summary}</p>{review.result.issues.map(issue => <p key={issue.id}><strong>{issue.view} · {issue.severity}</strong>: {issue.observation} {issue.suggestion}</p>)}</div>)}</div>
    </details>}
    {!!result.usageStages?.length && <details className="agent-verification-check"><summary><span>Usage by stage</span><small>{result.usageStages.some(stage => !stage.usage) ? 'Some usage unavailable' : `${result.usageStages.reduce((sum, stage) => sum + (stage.usage?.total_tokens ?? 0), 0).toLocaleString()} reported total tokens`}</small></summary>
      <div className="agent-verification-detail"><table><thead><tr><th>Stage</th><th>Input</th><th>Output</th><th>Total</th></tr></thead><tbody>{result.usageStages.map((stage, index) => <tr key={index}><td>{stage.stage.replace(/_/g, ' ')}</td><td>{stage.usage?.input_tokens?.toLocaleString() ?? 'Unavailable'}</td><td>{stage.usage?.output_tokens?.toLocaleString() ?? 'Unavailable'}</td><td>{stage.usage?.total_tokens?.toLocaleString() ?? 'Unavailable'}</td></tr>)}</tbody></table></div>
    </details>}
    {result.checks.map((check, index) => <details className={`agent-verification-check is-${check.status}`} key={`${check.command}-${index}`}>
      <summary>
        {check.stale || check.superseded || check.status === "skipped" ? <CircleSlash2 size={13} /> : check.status === "passed" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
        <span>{check.phase === "reproduce" && check.status === "passed" ? "Bug reproduced" : check.label}</span>
        <small>{check.superseded ? "Earlier result" : check.stale ? "Outdated" : check.status === "skipped" ? "Not checked" : check.status === "passed" ? "Passed" : "Failed"}</small>
        <small>{check.phase ? phaseCopy[check.phase] : "Project check"}</small>
        <small><Clock3 size={11} /> {duration(check.durationMs)}</small>
        <ChevronDown size={13} className="agent-verification-chevron" />
      </summary>
      <div className="agent-verification-detail">
        <code>{check.command}</code>
        <span>{check.directory}</span>
        <span>{check.source === "automatic" ? "Project script" : "Agent selected"}{check.recordedAt ? ` · ${new Date(check.recordedAt).toLocaleString()}` : ""}{check.exitCode !== undefined ? ` · exit ${check.exitCode ?? "unknown"}` : ""}</span>
        {check.expectedOutput && <span>Expected output: {check.expectedOutput}</span>}
        <pre>{check.output || "Command completed without captured output."}</pre>
      </div>
    </details>)}
    {result.designReview?.status === 'self_inspected' && <p className="agent-verification-limitation">The builder inspected screenshots. This does not mean functional or accessibility checks passed.</p>}
    {flowFailed ? <p className="agent-verification-limitation">User-visible checks ran and found issues. See the failed user-flow check.</p> : !flowChecked && result.status !== "not_needed" && <p className="agent-verification-limitation">No successful current user-flow check was recorded.</p>}
      </div>
    </details>
  </section>;
}
