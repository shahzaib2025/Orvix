import { AlertTriangle, ArrowRight, FileText, FolderOpen, LockKeyhole, ShieldCheck, TerminalSquare, Trash2, X } from "lucide-react";
import type { AgentApprovalRequest } from "../desktop";
import "./agent-approval-dialog.css";

type Decision = boolean | "sandbox" | "host";

function formatBytes(bytes?: number) {
  if (!Number.isFinite(bytes) || bytes === undefined) return "Size unavailable";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AgentApprovalDialog({ approval, taskTitle, onDecision }: {
  approval: AgentApprovalRequest;
  taskTitle: string;
  onDecision: (decision: Decision) => void;
}) {
  const deletion = approval.kind === "delete";
  const workspace = approval.kind === "workspace";
  const localAction = approval.kind === "host_command";
  const files = approval.files ?? approval.deletions ?? [];
  const fileCount = files.length;
  const title = deletion
    ? approval.destructiveCommand ? "Review a file-removal command" : fileCount ? `Delete ${fileCount} file${fileCount === 1 ? "" : "s"}?` : "Approve file deletion?"
    : workspace ? "Allow access to this folder?"
      : localAction ? "Run this local action?"
        : approval.verification ? "Approve this project check?" : "Choose where to run this command";
  const Icon = deletion ? Trash2 : workspace ? FolderOpen : localAction ? TerminalSquare : ShieldCheck;

  let choiceIndex = 0;
  const choice = (label: string, detail: string, decision: Decision, tone = "") => <button type="button" className={`agent-approval-choice${tone ? ` ${tone}` : ""}`} onClick={() => onDecision(decision)}>
    <span className="agent-approval-choice-number" aria-hidden="true">{label === "Not now" ? "×" : ++choiceIndex}</span>
    <span className="agent-approval-choice-copy"><strong>{label}</strong><small>{detail}</small></span>
    <ArrowRight size={15} aria-hidden="true" />
  </button>;

  return <section className={`agent-approval-card${deletion ? " is-destructive" : ""}`} role="region" aria-live="polite" aria-labelledby="agent-approval-title" aria-describedby="agent-approval-description">
      <header className="agent-approval-header">
        <div className="agent-approval-icon"><Icon size={19} /></div>
        <div className="agent-approval-heading"><span>PERMISSION REQUEST · {taskTitle}</span><h2 id="agent-approval-title">{title}</h2></div>
        <button type="button" className="agent-approval-close" aria-label="Decline permission request" title="Decline" onClick={() => onDecision(false)}><X size={17} /></button>
      </header>

      <div className="agent-approval-status"><span className={`agent-approval-badge${deletion ? " danger" : ""}`}><LockKeyhole size={11} /> {deletion ? "Deletion requires approval" : workspace ? "Access for this task" : "One-time approval"}</span><span>Waiting for your decision</span></div>
      <div className="agent-approval-body">
      <p id="agent-approval-description" className="agent-approval-intro">{deletion
        ? approval.destructiveCommand
          ? "This command appears to remove files. Review the exact command and its working folder before allowing it to run."
          : "Orvix is asking to remove these specific files. Nothing will be deleted unless you approve this request."
        : workspace
          ? "Opening this folder lets Orvix search, read, and edit files there for this task. Other tasks will request access separately."
          : localAction
            ? "This action runs on your computer. Review the action and folder so you know what Orvix will access."
            : approval.verification
              ? "Orvix wants to run this project check. Review the exact command and choose where it should run."
              : "Review the exact command, then choose whether it runs in isolation or on your computer."}</p>

      <div className="agent-approval-facts">
        <div><span>Task</span><strong title={taskTitle}>{taskTitle}</strong></div>
        <div><span>{deletion ? "Deletion scope" : workspace ? "Folder access" : "Working folder"}</span><code title={approval.directory}>{approval.directory || "Not provided"}</code></div>
        <div><span>Approval applies to</span><strong>{deletion ? "This request only" : workspace ? "This task only" : "This action only"}</strong></div>
      </div>

      {files.length > 0 && <div className="agent-approval-files" aria-label="Files proposed for deletion">
        <div className="agent-approval-section-title"><span><FileText size={14} /> Files to remove</span><small>{fileCount} listed</small></div>
        <ul>{files.map(item => <li key={item.file}>
          <Trash2 size={14} /><span><strong>{item.file.split(/[\\/]/).at(-1) || item.file}</strong><code title={item.file}>{item.file}</code></span><small>{formatBytes(item.bytes)}</small>
        </li>)}</ul>
      </div>}

      {approval.command && <div className="agent-approval-command-wrap">
        <div className="agent-approval-section-title"><span><TerminalSquare size={14} /> {deletion ? "Command being reviewed" : "Command"}</span></div>
        <pre>{approval.command}</pre>
      </div>}

      {deletion && <div className="agent-approval-warning" role="note"><AlertTriangle size={16} />
        <span>{approval.destructiveCommand
          ? "The command may affect files beyond the visible project list. The approval covers only this command and working folder."
          : "Only the listed files are included. Approve only if you intend to remove them."}</span>
      </div>}
      {(approval.kind === "command" || approval.destructiveCommand) && <div className="agent-approval-environments">
        {approval.sandboxAvailable
          ? <><div><strong>Isolated</strong><span>Runs in Windows Sandbox with networking disabled. Validated project changes are copied back.</span></div><div><strong>This computer</strong><span>Runs on the host and may access files outside the project folder.</span></div></>
          : <div className="unavailable"><strong>Windows Sandbox unavailable</strong><span>This PC cannot run the isolated option. A host run may access files outside the project folder; OpenCode key variables are removed.</span></div>}
      </div>}
      </div>

      <footer className="agent-approval-footer">
        <p><LockKeyhole size={12} /> {workspace ? "Folder access is scoped to this task." : "Your choice applies to this request only."}</p>
        <div className="agent-approval-options">
          {deletion
            ? approval.destructiveCommand
              ? <>{approval.sandboxAvailable && choice("Approve & run isolated", "Run this exact command in the isolated environment.", "sandbox")} {choice("Approve & run here", "Run this exact command on this computer.", "host", "is-danger")}</>
              : choice(fileCount ? `Delete ${fileCount} file${fileCount === 1 ? "" : "s"}` : "Approve deletion", "Remove only the files listed above.", true, "is-danger")
            : workspace
              ? choice("Allow folder", "Let this task access the selected folder.", true)
              : approval.kind === "command"
                ? <>{approval.sandboxAvailable && choice("Run isolated", "Run this command in Windows Sandbox.", "sandbox")} {choice("Run on this computer", "Run this command on the host computer.", "host")}</>
                : choice("Allow this action", "Run this one action for this request.", "host")}
        </div>
        <div className="agent-approval-footer-actions">{choice("Not now", "Decline this request; the action will not run.", false)}</div>
      </footer>
    </section>;
}
