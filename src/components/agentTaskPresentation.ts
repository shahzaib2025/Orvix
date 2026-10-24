import type { AgentRunState, AgentTurnReport, AgentVerification } from "../desktop";
import type { AgentActivityItem, AgentToolActivity } from "./AgentActivityTimeline";

type AgentChange = AgentTurnReport["changes"][number];

export type TaskPresentation = {
  status?: "pending" | "done" | "error";
  runState?: AgentRunState;
  activity?: AgentActivityItem[];
  turnReport?: AgentTurnReport | null;
  liveFileChanges?: AgentChange[] | null;
  verification?: AgentVerification;
  runStartedAt?: number;
  createdAt: number;
  completedAt?: number;
};
export type WorkspaceLayout = "chat" | "code" | "split" | "preview";

export function elapsedTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function turnReportForPresentation(turn: TaskPresentation): AgentTurnReport | null {
  const report = turn.turnReport;
  const liveFiles = turn.liveFileChanges;
  if (report?.changes.length || liveFiles == null) return report ?? null;
  return {
    changes: liveFiles,
    recordedAt: report?.recordedAt ?? turn.completedAt ?? turn.runState?.completedAt ?? turn.createdAt,
    comparisonsLimited: report?.comparisonsLimited ?? liveFiles.some(file => !file.binary && file.diffAvailable === false),
    verification: report?.verification ?? turn.verification ?? null,
  };
}

export function completionEvidence(turn: TaskPresentation) {
  const report = turnReportForPresentation(turn);
  const verification = report?.verification ?? turn.verification;
  const checks = (verification?.checks ?? []).filter(check => check.phase !== "reproduce" && !check.superseded);
  const passed = checks.filter(check => check.status === "passed" && !check.stale).length;
  const failed = checks.filter(check => check.status === "failed" && !check.stale).length;
  const unconfirmed = checks.filter(check => check.stale || check.status === "skipped").length;
  const requirements = verification?.requirements ?? [];
  const unresolved = requirements.filter(requirement => requirement.status !== "verified");
  const files = report?.changes.filter(change => !change.directory) ?? [];
  const issues: string[] = [];
  if (failed) issues.push(`${failed} recorded check${failed === 1 ? "" : "s"} failed.`);
  else if (verification?.status === "failed") issues.push(verification.reason || "Verification reported an issue.");
  if (unconfirmed) issues.push(`${unconfirmed} check${unconfirmed === 1 ? " needs" : "s need"} a current result.`);
  if (verification?.executionPending) issues.push("The recorded task still has unfinished steps.");
  if (unresolved.length) issues.push(`${unresolved.length} requirement${unresolved.length === 1 ? " is" : "s are"} not yet verified.`);
  if (!checks.length && (files.length || verification?.status === "not_run" || verification?.status === "passed")) issues.push("No current verification checks were recorded.");
  if (verification?.status === "not_run" && verification.reason) issues.push(verification.reason);
  const clean = verification?.status === "passed" && passed > 0 && !failed && !unconfirmed && !verification.executionPending && !unresolved.length;
  const stopped = turn.status === "error" || ["failed", "cancelled", "interrupted"].includes(turn.runState?.status ?? "");
  const title = stopped ? turn.runState?.status === "cancelled" ? "Run stopped" : "Run needs attention"
    : issues.length ? "Finished · review needed" : clean ? "Recorded checks passed" : files.length ? "Changes ready to review" : "Reply ready";
  return { title, tone: stopped || failed || verification?.status === "failed" ? "error" : issues.length ? "attention" : clean ? "success" : "neutral",
    files, passed, failed, unconfirmed, issues, verification,
    report, changesRecorded: report !== null,
    added: files.reduce((sum, file) => sum + file.added, 0), deleted: files.reduce((sum, file) => sum + file.deleted, 0),
    limited: Boolean(report?.comparisonsLimited || files.some(file => !file.binary && file.diffAvailable === false)) };
}

function toolStage(tool: Pick<AgentToolActivity, "name" | "input" | "detail">) {
  const name = tool.name.split(/[./]/).at(-1) ?? tool.name;
  if (/^(?:verify_work|run_checks|run_tests|typecheck|build_project)$/.test(name)) return { stage: "checking", label: "Checking results" };
  if (/^(?:write|edit|apply_patch|apply_edit|apply_patch_batch|write_file|delete_file|semantic_rename)$/.test(name)) return { stage: "editing", label: "Editing files" };
  if (/^(?:bash|shell|execute_command|run_command|run_computer_command)$/.test(name)) {
    let command = tool.detail;
    try { const input = JSON.parse(tool.input ?? "{}"); command = typeof input.command === "string" ? input.command : command; } catch { /* Native tool input may be plain text. */ }
    const checking = /(?:^|[;&|\s])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|check[\w:-]*|typecheck|lint)\b|\b(?:pytest|tsc|cargo\s+test|go\s+test|dotnet\s+test)\b/i.test(command);
    return { stage: checking ? "checking" : "working", label: checking ? "Checking results" : "Running a command" };
  }
  if (/^(?:read|read_file|read_file_range|read_file_ranges|grep|glob|search_files|search_content|list|list_directory|find_symbol|semantic_code)$/.test(name)) return { stage: "working", label: "Inspecting files" };
  if (/^(?:web_search|websearch|webfetch|fetch_webpage)$/.test(name)) return { stage: "working", label: "Researching" };
  if (/preview|screenshot/.test(name)) return { stage: "working", label: "Inspecting a preview" };
  return { stage: "working", label: "Using a tool" };
}

export function taskProgress(turn?: TaskPresentation, waiting?: "permission" | "question" | null) {
  if (!turn) return { stage: "idle", label: "Ready for a task", detail: "" };
  if (turn.status !== "pending") {
    const result = completionEvidence(turn);
    return { stage: result.tone === "error" ? "stopped" : result.tone === "attention" ? "attention" : "finished", label: result.title, detail: "" };
  }
  if (waiting) return { stage: "waiting", label: waiting === "permission" ? "Waiting for permission" : "Waiting for your answer", detail: "Your response is needed to continue." };
  const activeTools = (turn.activity ?? []).filter((item): item is AgentToolActivity => typeof item !== "string" && item.kind === "tool" && item.status === "running");
  const tool = activeTools.at(-1);
  if (tool) return { ...toolStage(tool), detail: tool.detail };
  if (turn.runState?.activeTool) return { ...toolStage({ ...turn.runState.activeTool, input: "", detail: "" }), detail: "" };
  const phase = turn.runState?.phase ?? "";
  if (/^(?:write|edit|apply_patch|apply_edit|apply_patch_batch|write_file|delete_file|semantic_rename|read|read_file|read_file_range|read_file_ranges|grep|glob|search_files|search_content|list|list_directory|find_symbol|semantic_code|bash|shell|execute_command|run_command|run_computer_command|verify_work|run_checks|run_tests)$/.test(phase)) return { ...toolStage({ name: phase, input: "", detail: "" }), detail: phase };
  if (/verif|checking|testing|type.?check|building/i.test(phase)) return { stage: "checking", label: "Checking results", detail: phase };
  if (/waiting|connect|retry|recover/i.test(phase)) return { stage: "working", label: /connect/i.test(phase) ? "Connecting" : /recover|retry/i.test(phase) ? "Recovering the run" : "Waiting for the provider", detail: phase };
  return { stage: "thinking", label: "Thinking", detail: "" };
}

export function isPreviewFile(file: string) { return /\.(?:html?|md|markdown|pdf|png|jpe?g|webp|gif|svg)$/i.test(file); }
