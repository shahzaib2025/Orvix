import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVisibleInterval } from '../useVisibleInterval';
import type { ReactNode } from "react";
import { designOptionsPresentation } from "./designOptionsPresentation";
import type { DesignOptionsPresentationResult } from "./designOptionsPresentation";
import { AgentEvidenceViewer } from "./AgentExecutionPanel";
import { FileTypeIcon } from "./AgentChanges";
import { Check, ChevronDown, Compass, Copy, FilePenLine, FileSearch2, FileText, FolderSearch, Globe2, Image, LoaderCircle, Search, TerminalSquare, X } from "lucide-react";

export type AgentToolActivity = {
  kind: "tool"; id: string; name: string; detail: string; input?: string; startedAt: number;
  taskId?: string; requestId?: string; evidenceId?: string; durationMs?: number; output?: string; truncated?: boolean; failed?: boolean;
  reviewImages?: Array<{ id: string; name: string; mime: "image/png" | "image/jpeg" | "image/webp" }>; status: "running" | "completed";
};
type AgentFileLineChange = { path: string; added: number; deleted: number; binary?: boolean; directory?: boolean; diffAvailable?: boolean };
export type AgentProgressActivity = {
  kind: "progress"; id: string; category: "waiting" | "reasoning_summary" | "provider_reasoning" | "agent_update";
  providerId: string; providerLabel: string; modelId: string; text: string; status: "running" | "completed"; startedAt: number; durationMs?: number;
};
export type AgentSteerActivity = {
  kind: "steer"; id: string; text: string; at: number;
};
export type AgentActivityItem = string | AgentToolActivity | AgentProgressActivity | AgentSteerActivity;
type ToolGroup = { kind: "group"; key: string; family: string; tools: AgentToolActivity[] };
type Note = { kind: "note"; key: string; text: string };
type Progress = { kind: "progress"; key: string; progress: AgentProgressActivity };
type SteerBlock = { kind: "steer"; key: string; steer: AgentSteerActivity };
type Block = ToolGroup | Note | Progress | SteerBlock;
type ActivityRun = { kind: "activity_run"; key: string; blocks: Block[]; live: boolean };
type ActivitySection = Block | ActivityRun;

// Assistant updates delimit work intervals, but remain ordinary chat text.
function activitySections(blocks: Block[], pending: boolean): ActivitySection[] {
  const sections: ActivitySection[] = [];
  let work: Block[] = [];
  const flush = (live: boolean) => {
    if (!work.length) return;
    if (work.some(block => block.kind === "group")) {
      sections.push({ kind: "activity_run", key: `work-${work[0].key}`, blocks: work, live });
    } else sections.push(...work);
    work = [];
  };
  for (const block of blocks) {
    if (block.kind === "steer" || block.kind === "progress" && block.progress.category === "agent_update") {
      flush(false);
      sections.push(block);
    } else work.push(block);
  }
  flush(pending);
  return sections;
}

function workSummary(blocks: Block[], live: boolean) {
  const tools = blocks.flatMap(block => block.kind === "group" ? block.tools : []);
  const byFamily = new Map<string, AgentToolActivity[]>();
  for (const tool of tools) {
    const family = ["bash", "shell", "execute_command"].includes(tool.name) ? "commands"
      : ["write", "edit", "apply_patch"].includes(tool.name) ? "edits"
        : tool.name === "read_agent_skill" ? "reads"
          : ["websearch", "webfetch"].includes(tool.name) ? "web"
            : ["glob", "grep", "list"].includes(tool.name) ? "searches"
              : familyFor(tool.name);
    const entries = byFamily.get(family) ?? [];
    entries.push(tool);
    byFamily.set(family, entries);
  }
  const labels: Record<string, [string, string, string]> = {
    commands: ["ran commands", "running commands", "commands"],
    reads: ["read files", "reading files", "file reads"],
    edits: ["edited files", "editing files", "file edits"],
    searches: ["searched files", "searching files", "file searches"],
    web: ["researched the web", "researching the web", "web requests"],
    previews: ["viewed images", "capturing previews", "previews"],
    tools: ["used tools", "using tools", "tool operations"],
  };
  const parts = [...byFamily].map(([family, entries]) => {
    const [done, running, noun] = labels[family] ?? labels.tools;
    if (live && entries.some(tool => tool.status === "running")) return running;
    if (entries.some(tool => tool.status === "completed" && !tool.failed)) return done;
    return `${noun} ${entries.some(tool => tool.failed) ? "failed" : "stopped"}`;
  });
  const text = parts.join(", ");
  const failed = tools.filter(tool => tool.failed).length;
  const stopped = tools.filter(tool => !live && tool.status === "running").length;
  return {
    label: text.charAt(0).toUpperCase() + text.slice(1),
    family: byFamily.has("edits") ? "edits" : byFamily.keys().next().value ?? "tools",
    issues: [failed ? `${failed} failed` : "", stopped ? `${stopped} stopped` : ""].filter(Boolean).join(" · "),
  };
}

function familyFor(name: string) {
  if (["bash", "shell", "execute_command", "run_computer_command", "run_command", "git_status", "verify_work"].includes(name)) return "commands";
  if (name === "design_review") return "visual-reviews";
  if (["preview_website", "orvix_visual_preview_website"].includes(name)) return "previews";
  if (["read", "read_file", "read_file_range", "read_file_ranges", "read_agent_skill"].includes(name)) return "reads";
  if (["edit", "write", "apply_patch", "apply_edit", "apply_patch_batch", "semantic_rename", "write_file", "delete_file"].includes(name)) return "edits";
  if (name === "web_search" || name === "fetch_webpage") return "web";
  if (["search_files", "search_content", "find_symbol", "semantic_code", "list_directory", "list_roots", "open_workspace"].includes(name)) return "searches";
  return "tools";
}

const manuallyExpandedToolNames = new Set([
  "browser_observe",
  "preview_website",
  "orvix_visual_preview_website",
  "start_preview_server",
  "orvix_visual_start_preview_server",
]);

function requiresManualExpansion(tool: AgentToolActivity) {
  return manuallyExpandedToolNames.has(tool.name) || ["commands", "reads"].includes(familyFor(tool.name));
}

function groupLabel(family: string, count: number, running: boolean) {
  const noun: Record<string, string> = { commands: "command", reads: "file", edits: "file", searches: "search", web: "web result", previews: "website preview", tools: "tool", "visual-reviews": "visual review" };
  const verb: Record<string, string> = running
    ? { commands: "Running", reads: "Reading", edits: "Editing", searches: "Searching", web: "Researching", previews: "Capturing", tools: "Using", "visual-reviews": "Reviewing" }
    : { commands: "Ran", reads: "Read", edits: "Edited", searches: "Searched", web: "Reviewed", previews: "Captured", tools: "Used", "visual-reviews": "Completed" };
  return `${verb[family] ?? "Used"} ${count} ${noun[family] ?? "tool"}${count === 1 ? "" : "s"}`;
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;
}

function formatThinkingDuration(ms?: number) {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return "";
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(ms);
}

function readTargets(tools: AgentToolActivity[]) {
  const targets = new Map<string, string>();
  for (const tool of tools.filter(item => familyFor(item.name) === "reads")) {
    try {
      const input = JSON.parse(tool.input ?? "{}");
      const add = (file: unknown, start?: unknown, end?: unknown, max?: unknown) => {
        if (typeof file !== "string" || !file) return;
        const first = Number.isInteger(start) && (start as number) > 0 ? start as number : null;
        const last = Number.isInteger(end) && (end as number) >= (first ?? 1) ? end as number
          : first && Number.isInteger(max) && (max as number) > 0 ? first + (max as number) - 1 : null;
        const range = first ? last && last !== first ? `:${first}–${last}` : `:${first}${last === null ? "–…" : ""}` : "";
        targets.set(`${file}${range}`, file);
      };
      if (Array.isArray(input.ranges)) for (const range of input.ranges) add(range?.file, range?.start_line, range?.end_line, range?.max_lines);
      else add(input.file ?? input.filePath ?? input.filepath ?? input.path, input.start_line, input.end_line, input.max_lines);
      if (Array.isArray(input.files)) for (const file of input.files) add(typeof file === "string" ? file : file?.file);
    } catch { /* Older saved activity may not include structured tool input. */ }
  }
  const entries = [...targets];
  const compact = (file: string) => file.replace(/\\/g, "/").split("/").slice(-2).join("/");
  const visible = entries.slice(0, 2).map(([target, file]) => target.replace(file, compact(file)));
  const label = entries.length > 2 ? `${visible.join(", ")} +${entries.length - visible.length} more` : visible.join(", ");
  return { label, full: entries.map(([target]) => target).join("\n") };
}

function blocksFor(items: AgentActivityItem[]): Block[] {
  const blocks: Block[] = [];
  const hasTools = items.some(item => typeof item !== "string" && item.kind === "tool");
  items.forEach((item, index) => {
    if (typeof item === "string") {
      if (/^(Working with |Response complete$)/.test(item) || /^Connecting to the lightweight OpenCode agent\.?$/i.test(item.trim()) || (hasTools && item.startsWith("Running: "))) return;
      blocks.push({ kind: "note", key: `note-${index}`, text: item });
      return;
    }
    if (item.kind === "steer") {
      blocks.push({ kind: "steer", key: item.id || `steer-${index}`, steer: item });
      return;
    }
    if (item.kind === "progress") {
      blocks.push({ kind: "progress", key: item.id, progress: item });
      return;
    }
    const family = familyFor(item.name);
    const last = blocks.at(-1);
    if (last?.kind === "group" && last.family === family) last.tools.push(item);
    else blocks.push({ kind: "group", key: item.id, family, tools: [item] });
  });
  return blocks;
}

function GroupIcon({ family, running }: { family: string; running: boolean }) {
  if (running) return <LoaderCircle className="agent-tool-spinner" size={15} />;
  if (family === "previews" || family === "visual-reviews") return <Image size={15} />;
  if (family === "commands") return <TerminalSquare size={15} />;
  if (family === "reads") return <FileText size={15} />;
  if (family === "edits") return <FilePenLine size={15} />;
  if (family === "web") return <Globe2 size={15} />;
  return <FolderSearch size={15} />;
}

function RowIcon({ tool }: { tool: AgentToolActivity }) {
  if (tool.status === "running") return <LoaderCircle className="agent-tool-spinner" size={14} />;
  if (tool.failed) return <X size={14} />;
  const family = familyFor(tool.name);
  if (family === "commands") return <TerminalSquare size={14} />;
  if (family === "reads") return <FileText size={14} />;
  if (family === "edits") return <FilePenLine size={14} />;
  if (family === "web") return <Globe2 size={14} />;
  if (family === "visual-reviews") return <Image size={14} />;
  if (family === "searches") return <Search size={14} />;
  return <FileSearch2 size={14} />;
}

function toolTitle(tool: AgentToolActivity) {
  if (tool.failed) return `${/cancelled|canceled|stopped/i.test(tool.output ?? '') ? 'Stopped' : 'Failed'}: ${tool.name}${tool.detail ? ` ${tool.detail}` : ''}`;
  const prefix: Record<string, string> = {
    design_review: "Reviewed design", run_computer_command: "Ran computer command", inspect_storage: "Measured folders in", create_folder: "Created folder", run_command: "Ran", verify_work: "Checked", git_status: "Checked Git status in", read: "Read", read_file: "Read", read_file_range: "Read", read_file_ranges: "Read",
    search_files: "Searched files in", search_content: "Searched code in", find_symbol: "Found symbol in",
    semantic_code: "Inspected code in", list_directory: "Listed", list_roots: "Listed local folders",
    open_workspace: "Opened workspace", apply_edit: "Edited", apply_patch_batch: "Applied patch to",
    semantic_rename: "Renamed symbol in", write_file: "Wrote", delete_file: "Deleted",
    web_search: "Searched web for", fetch_webpage: "Fetched page", device_status: "Checked device status",
  };
  if (tool.name === "list_roots") return prefix.list_roots;
  return `${prefix[tool.name] ?? tool.name}${tool.detail ? ` ${tool.detail}` : ""}`;
}

function resultText(output: string) {
  if (output.length > 26000 || !/^[\s]*[\[{]/.test(output)) return output;
  try { return JSON.stringify(JSON.parse(output), null, 2); } catch { return output; }
}

type PreviewView = { label: string; width?: number; height?: number; image: { file: string }; metrics?: { horizontalOverflow?: boolean; brokenImages?: number;
  loadMilliseconds?: number; largestContentfulPaintMilliseconds?: number; cumulativeLayoutShift?: number }; errors?: string[];
  accessibility?: { violations?: unknown[] }; referenceDifference?: number | null };
function previewFileUrl(file: string) {
  if (!/^[A-Za-z]:[\\/]/.test(file)) return "";
  return encodeURI(`file:///${file.replace(/\\/g, "/")}`);
}
function PreviewResult({ output, directImage = false }: { output: string; directImage?: boolean }) {
  let preview: { views?: PreviewView[]; referenceImage?: { file: string }; note?: string };
  try { preview = JSON.parse(output); } catch { return <ToolSection label="Result" value={output} status="Failed" />; }
  if (!Array.isArray(preview.views) || !preview.views.length) return <ToolSection label="Result" value={resultText(output)} status="Completed" />;
  if (directImage) return <div className="agent-preview-direct-images" aria-label="Website preview images">
    {preview.views.map(view => <img key={view.label} src={previewFileUrl(view.image.file)} alt={`${view.label} website preview`} loading="lazy" />)}
  </div>;
  const referenceUrl = preview.referenceImage?.file ? previewFileUrl(preview.referenceImage.file) : "";
  return <div className="agent-preview-result">
    <div className="agent-tool-detail-head"><span>Captured preview<em>{preview.views.map(view => view.width && view.height ? `${view.width} × ${view.height}` : view.label).join(" · ")}</em></span></div>
    <div className="agent-preview-gallery">
      {referenceUrl && <figure><img src={referenceUrl} alt="User reference" loading="lazy" /><figcaption>Reference</figcaption></figure>}
      {preview.views.map(view => <figure key={view.label}><img src={previewFileUrl(view.image.file)} alt={`${view.label} website preview`} loading="lazy" />
        <figcaption>{view.label}{typeof view.referenceDifference === "number" ? ` · ${view.referenceDifference}% pixel difference` : ""}</figcaption></figure>)}
    </div>
    <div className="agent-preview-signals">{preview.views.map(view => <span key={view.label}>{view.label}: {[
      view.metrics?.horizontalOverflow ? "horizontal overflow" : "no overflow",
      view.metrics?.brokenImages ? `${view.metrics.brokenImages} broken images` : "images loaded",
      view.errors?.length ? `${view.errors.length} browser errors` : "no browser errors",
      Array.isArray(view.accessibility?.violations) ? `${view.accessibility.violations.length} accessibility findings` : "accessibility not checked",
      typeof view.metrics?.loadMilliseconds === "number" ? `load ${view.metrics.loadMilliseconds}ms` : "load unavailable",
      view.metrics?.largestContentfulPaintMilliseconds ? `LCP ${view.metrics.largestContentfulPaintMilliseconds}ms` : "LCP unavailable",
      typeof view.metrics?.cumulativeLayoutShift === "number" ? `CLS ${view.metrics.cumulativeLayoutShift}` : "CLS unavailable",
    ].join(" · ")}</span>)}</div>
    <details><summary>Full preview diagnostics</summary><ToolSection label="Result" value={resultText(output)} status="Completed" /></details>
    {preview.note && <p>{preview.note}</p>}
  </div>;
}

function ReadFileResult({ tool }: { tool: AgentToolActivity }) {
  const output = tool.output ?? "";
  if (!output || tool.status === "running" || tool.failed) return <ToolSection label="Result" value={output} status={tool.status === "running" ? "Waiting for result" : "Failed"} />;
  let rows: { line: number; text: string }[];
  let note = "";
  let hash = "";
  if (tool.name === "read_file_range") {
    try {
      const data = JSON.parse(output);
      if (!Array.isArray(data.lines)) throw new Error("No lines");
      rows = data.lines.filter((item: unknown): item is { line: number; text: string } =>
        Boolean(item) && typeof item === "object" && typeof (item as { line?: unknown }).line === "number" && typeof (item as { text?: unknown }).text === "string");
      note = [data.hasMore ? "More lines remain" : "", data.clippedLine ? "A long line was shortened" : ""].filter(Boolean).join(" · ");
      hash = typeof data.sha256 === "string" ? data.sha256 : "";
    } catch { return <ToolSection label="Result" value={output} status="Completed" />; }
  } else rows = output.split(/\r?\n/).map((text, index) => ({ line: index + 1, text }));
  return <div className="agent-tool-detail-section agent-tool-read-result">
    <div className="agent-tool-detail-head"><span>File contents<em>{rows.length} {rows.length === 1 ? "line" : "lines"}</em></span><button type="button" onClick={() => void navigator.clipboard.writeText(output)}><Copy size={12} /> Copy</button></div>
    <div className="agent-tool-code-lines">{rows.map((row, index) => <div className="agent-tool-code-line" key={`${row.line}-${index}`}><span>{row.line}</span><code>{row.text || " "}</code></div>)}</div>
    {hash && <div className="agent-tool-read-foot">SHA-256 <code>{hash}</code></div>}
    {note && <div className="agent-tool-truncated">{note}. Use another ranged read to continue.</div>}
  </div>;
}

function ToolSection({ label, value, status }: { label: string; value: string; status?: string }) {
  const [full, setFull] = useState(false);
  const long = value.length > 8000;
  return <div className="agent-tool-detail-section">
    <div className="agent-tool-detail-head"><span>{label}{status && <em>{status}</em>}</span>{value && <button type="button" onClick={() => void navigator.clipboard.writeText(value)} title={`Copy ${label.toLowerCase()}`}><Copy size={12} /> Copy</button>}</div>
    {value ? <><pre>{full || !long ? value : `${value.slice(0, 8000)}\n…`}</pre>{long && <button className="agent-tool-show-more" type="button" onClick={() => setFull(current => !current)}>{full ? "Show less" : "Show full captured text"}</button>}</> : <div className="agent-tool-no-output">{status === "Waiting for result" ? "Waiting for tool output…" : "No text was returned."}</div>}
  </div>;
}

const fileEditToolNames = new Set(["edit", "write", "apply_patch", "apply_edit", "write_file", "delete_file", "apply_patch_batch", "semantic_rename"]);

function toolFileTargets(tool: AgentToolActivity) {
  if (!fileEditToolNames.has(tool.name)) return [];
  const paths: string[] = [];
  try {
    const input = JSON.parse(tool.input ?? "{}");
    const add = (value: unknown) => { if (typeof value === "string" && value.trim()) paths.push(value.trim()); };
    if (Array.isArray(input.operations)) input.operations.forEach((operation: { file?: unknown }) => add(operation?.file));
    else add(input.file ?? input.filePath ?? input.filepath ?? input.file_path ?? input.path);
  } catch { /* Use the readable tool detail for older saved activities. */ }
  const detailPath = tool.detail.trim().replace(/^(?:edit|write|apply_patch|apply_edit|write_file|delete_file|apply_patch_batch|semantic_rename)\s+/i, "");
  if (!paths.length && (/[\\/].+\.[^\\/]+$/.test(detailPath) || /^[^\s\\/]+\.[a-zA-Z0-9]+$/.test(detailPath))) paths.push(detailPath);
  return [...new Set(paths)];
}

function normalizedFilePath(value: string) {
  return value
    .trim()
    .replace(/^file:\/{2,3}/i, "")
    .replace(/^\/?([a-zA-Z]:)/, "$1")
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\//, "")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "")
    .toLocaleLowerCase();
}

function lineChangesForPath(file: string, changes: AgentFileLineChange[]) {
  const target = normalizedFilePath(file);
  if (!target) return undefined;
  const targetIsAbsolute = /^[a-z]:\//.test(target) || target.startsWith("/");
  return changes.find(change => {
    if (change.directory || change.binary || change.diffAvailable === false) return false;
    const candidate = normalizedFilePath(change.path);
    if (!candidate) return false;
    if (target === candidate) return true;
    const candidateIsAbsolute = /^[a-z]:\//.test(candidate) || candidate.startsWith("/");
    if (targetIsAbsolute && candidateIsAbsolute) return false;
    return target.endsWith(`/${candidate}`) || candidate.endsWith(`/${target}`);
  });
}

function computeTextDiff(oldVal: unknown, newVal: unknown): { added: number; deleted: number } {
  const strOld = typeof oldVal === "string" ? oldVal : "";
  const strNew = typeof newVal === "string" ? newVal : "";
  if (strOld === strNew) return { added: 0, deleted: 0 };
  if (!strOld) return { added: strNew.split(/\r?\n/).length, deleted: 0 };
  if (!strNew) return { added: 0, deleted: strOld.split(/\r?\n/).length };
  const oldLines = strOld.split(/\r?\n/);
  const newLines = strNew.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let oldSuffix = oldLines.length - 1, newSuffix = newLines.length - 1;
  while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
    oldSuffix--;
    newSuffix--;
  }
  return {
    added: Math.max(0, newSuffix - prefix + 1),
    deleted: Math.max(0, oldSuffix - prefix + 1),
  };
}

function toolSelfLineCounts(tool: AgentToolActivity): { added: number; deleted: number } | null {
  if (!tool.input) return null;
  try {
    const input = JSON.parse(tool.input);
    if (input.diff && typeof input.diff.added === "number" && typeof input.diff.deleted === "number") {
      if (input.diff.added > 0 || input.diff.deleted > 0) return { added: input.diff.added, deleted: input.diff.deleted };
    }
    const oldText = input.old_text ?? input.oldString ?? input.old_string;
    const newText = input.new_text ?? input.newString ?? input.new_string;
    if (oldText !== undefined || newText !== undefined) {
      const diff = computeTextDiff(oldText, newText);
      if (diff.added > 0 || diff.deleted > 0) return diff;
    }
    if (Array.isArray(input.edits)) {
      let totalAdded = 0, totalDeleted = 0;
      for (const edit of input.edits) {
        const d = computeTextDiff(edit?.old_text ?? edit?.oldString ?? edit?.old_string, edit?.new_text ?? edit?.newString ?? edit?.new_string);
        totalAdded += d.added;
        totalDeleted += d.deleted;
      }
      if (totalAdded > 0 || totalDeleted > 0) return { added: totalAdded, deleted: totalDeleted };
    }
    if (typeof input.patch === "string") {
      let added = 0, deleted = 0;
      for (const line of input.patch.split(/\r?\n/)) {
        if (line.startsWith("+") && !line.startsWith("+++")) added++;
        else if (line.startsWith("-") && !line.startsWith("---")) deleted++;
      }
      if (added > 0 || deleted > 0) return { added, deleted };
    }
  } catch { /* ignore JSON parse error */ }
  return null;
}

function fileEditPresentation(tool: AgentToolActivity, changes: AgentFileLineChange[], lineCountOwners: Map<string, string>) {
  const paths = toolFileTargets(tool);
  if (!paths.length) return null;
  const baseName = (file: string) => file.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? file;
  const label = paths.length === 1 ? baseName(paths[0]) : `${baseName(paths[0])} +${paths.length - 1} files`;
  const fileChanges = paths.map(file => lineChangesForPath(file, changes));
  const selfCounts = toolSelfLineCounts(tool);
  let lineCounts: { added: number; deleted: number } | null = null;
  if (selfCounts) {
    lineCounts = selfCounts;
  } else {
    const ownedChanges = [...new Map(fileChanges
      .filter((change): change is AgentFileLineChange => change !== undefined && lineCountOwners.get(normalizedFilePath(change.path)) === tool.id)
      .map(change => [normalizedFilePath(change.path), change])).values()];
    lineCounts = ownedChanges.length
      ? ownedChanges.reduce((total, change) => ({ added: total.added + change.added, deleted: total.deleted + change.deleted }), { added: 0, deleted: 0 })
      : null;
  }
  const fullPaths = paths.map((file, index) => fileChanges[index]?.path ?? file);
  return { label, title: fullPaths.join("\n"), iconPath: paths[0], lineCounts };
}

function ReviewImageGallery({ taskId, requestId, images }: {
  taskId: string; requestId: string; images: NonNullable<AgentToolActivity["reviewImages"]>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(Math.min(8, images.length));
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const loadedRef = useRef<Record<string, string>>({});
  const pendingRef = useRef(new Set<string>());
  const failedRef = useRef(new Set<string>());
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const imageSignature = images.map(image => image.id).join("\n");

  useEffect(() => {
    if (!expanded) return;
    const count = Math.min(visibleCount, imagesRef.current.length);
    for (let index = 0; index < count; index++) {
      const image = imagesRef.current[index];
      if (!image) continue;
      const key = `${image.id}#${index}`;
      if (loadedRef.current[key] || pendingRef.current.has(key) || failedRef.current.has(key)) continue;
      const readImage = window.orvixDesktop?.getAgentReviewImage;
      if (!readImage) {
        failedRef.current.add(key);
        setFailed(current => ({ ...current, [key]: true }));
        continue;
      }
      pendingRef.current.add(key);
      void readImage(taskId, requestId, image.id).then(result => {
        const url = `data:${result.mime};base64,${result.data}`;
        loadedRef.current[key] = url;
        setLoaded(current => ({ ...current, [key]: url }));
      }).catch(() => {
        failedRef.current.add(key);
        setFailed(current => ({ ...current, [key]: true }));
      }).finally(() => pendingRef.current.delete(key));
    }
  }, [expanded, imageSignature, requestId, taskId, visibleCount]);

  const nextCount = Math.min(8, images.length - visibleCount);
  return <section className="agent-review-images">
    <button type="button" className="agent-review-images-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <Image size={14} aria-hidden="true" /><span>Images included in review</span><small>{images.length}</small>
      <ChevronDown size={13} className="agent-review-images-chevron" />
    </button>
    {expanded && <>
      <div className="agent-review-gallery">
        {images.slice(0, visibleCount).map((image, index) => {
          const key = `${image.id}#${index}`;
          return <figure key={key} title={image.name}>
            {loaded[key] ? <img src={loaded[key]} alt={image.name} loading="lazy" />
              : failed[key] ? <div className="agent-review-image-placeholder"><Image size={18} /><span>Preview unavailable</span></div>
                : <div className="agent-review-image-placeholder"><LoaderCircle size={16} className="agent-tool-spinner" /><span>Loading image</span></div>}
            <figcaption>{image.name}</figcaption>
          </figure>;
        })}
      </div>
      <div className="agent-review-images-footer">
        <span>{visibleCount < images.length ? `Showing ${visibleCount} of ${images.length} images sent for review` : `${images.length} ${images.length === 1 ? "image" : "images"} sent for review`}</span>
        {nextCount > 0 && <button type="button" onClick={() => setVisibleCount(count => Math.min(images.length, count + 8))}>Show {nextCount} more</button>}
      </div>
    </>}
  </section>;
}

function ToolRow({ tool, fileChanges, lineCountOwners }: { tool: AgentToolActivity; fileChanges: AgentFileLineChange[]; lineCountOwners: Map<string, string> }) {
  const isPreview = ["preview_website", "orvix_visual_preview_website"].includes(tool.name);
  const isVisualReview = tool.name === "design_review";
  const manualExpand = requiresManualExpansion(tool);
  const directVisualPreview = tool.name === "orvix_visual_preview_website" && tool.status === "completed" && !tool.failed;
  const [open, setOpen] = useState(!manualExpand && (tool.status === "running" || isPreview || isVisualReview));
  useEffect(() => {
    if (!manualExpand) setOpen(tool.status === "running" || isPreview || isVisualReview);
  }, [tool.status, isPreview, isVisualReview, manualExpand]);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(tool.startedAt));
  const fileEdit = fileEditPresentation(tool, fileChanges, lineCountOwners);
  return <div className={`agent-tool-row${tool.failed ? " is-error" : ""}${open ? " is-open" : ""}`}>
    <button type="button" className="agent-tool-row-summary" aria-expanded={open} onClick={() => setOpen(value => !value)} title={fileEdit?.title ?? toolTitle(tool)}>
      <RowIcon tool={tool} />{fileEdit ? <><FileTypeIcon path={fileEdit.iconPath} /><span className="agent-tool-row-file-name"><span className="agent-tool-row-file-basename">{fileEdit.label}</span><span className="agent-tool-row-file-path" aria-hidden="true">{fileEdit.title}</span></span>{fileEdit.lineCounts && <span className="agent-tool-row-lines" title="Final net change for this file during this turn" aria-label={`+${fileEdit.lineCounts.added} lines added, −${fileEdit.lineCounts.deleted} lines deleted`}><strong className="agent-tool-lines-added">+{fileEdit.lineCounts.added}</strong><strong className="agent-tool-lines-deleted">−{fileEdit.lineCounts.deleted}</strong></span>}</> : <span>{toolTitle(tool)}</span>}<small>{tool.status === "running" ? "Running" : tool.failed ? "Failed" : formatDuration(tool.durationMs)}</small><ChevronDown size={13} className="agent-tool-row-chevron" />
    </button>
    {open && <div className={`agent-tool-detail${directVisualPreview ? " agent-tool-detail-direct-preview" : ""}`}>
      {!directVisualPreview && <div className="agent-tool-detail-meta"><code>{tool.name}</code><span>{time}</span>{tool.durationMs !== undefined && <span>{formatDuration(tool.durationMs)}</span>}</div>}
      {isVisualReview && tool.reviewImages?.length && tool.taskId && tool.requestId && <ReviewImageGallery taskId={tool.taskId} requestId={tool.requestId} images={tool.reviewImages} />}
      {!directVisualPreview && tool.input && <ToolSection label="Input" value={tool.input} />}
      {["preview_website", "orvix_visual_preview_website"].includes(tool.name) && tool.status === "completed" && !tool.failed
        ? <PreviewResult output={tool.output ?? ""} directImage={directVisualPreview} />
        : tool.name === "read_file" || tool.name === "read_file_range"
        ? <ReadFileResult tool={tool} />
        : <ToolSection label="Result" value={resultText(tool.output ?? "")} status={tool.status === "running" ? "Waiting for result" : tool.failed ? "Failed" : "Completed"} />}
      {tool.evidenceId && tool.taskId && tool.requestId && <AgentEvidenceViewer taskId={tool.taskId} requestId={tool.requestId} id={tool.evidenceId} />}
      {tool.truncated && <div className="agent-tool-truncated">This preview is shortened. Saved evidence contains the captured result.</div>}
    </div>}
  </div>;
}

function ToolGroup({ group, taskPending, fileChanges, lineCountOwners }: { group: ToolGroup; taskPending: boolean; fileChanges: AgentFileLineChange[]; lineCountOwners: Map<string, string> }) {
  const running = taskPending && group.tools.some(tool => tool.status === "running");
  const isPreviewGroup = group.family === "previews";
  const isVisualReviewGroup = group.family === "visual-reviews";
  const manualExpand = group.tools.some(requiresManualExpansion) || ["commands", "reads"].includes(group.family);
  const [expanded, setExpanded] = useState(!manualExpand && (running || isPreviewGroup || isVisualReviewGroup));
  useEffect(() => {
    if (!manualExpand) setExpanded(running || isPreviewGroup || isVisualReviewGroup);
  }, [running, isPreviewGroup, isVisualReviewGroup, manualExpand]);
  const failures = group.tools.filter(tool => tool.failed);
  const interrupted = group.tools.filter(tool => !taskPending && tool.status === 'running' || tool.failed && /cancelled|canceled|stopped/i.test(tool.output ?? ''));
  const successful = group.tools.filter(tool => tool.status === 'completed' && !tool.failed);
  const operation = group.family === 'edits' ? 'edit' : group.family === 'commands' ? 'command' : 'operation';
  const groupedTools = new Map<string, number>();
  for (const tool of group.tools) groupedTools.set(tool.name, (groupedTools.get(tool.name) ?? 0) + 1);
  const reviewImageCount = group.tools.reduce((total, tool) => total + (tool.reviewImages?.length ?? 0), 0);
  const label = isVisualReviewGroup
    ? `${running ? `Reviewing design${reviewImageCount ? ` · ${reviewImageCount} ${reviewImageCount === 1 ? "image" : "images"}` : ""}` : reviewImageCount ? `Included ${reviewImageCount} ${reviewImageCount === 1 ? "image" : "images"} in visual review` : "Visual review completed"}${failures.length ? ` · ${failures.length} failed` : interrupted.length ? ` · ${interrupted.length} stopped` : ""}`
    : running ? groupLabel(group.family, group.tools.length, true)
    : !successful.length && interrupted.length ? `${interrupted.length} ${operation}${interrupted.length === 1 ? '' : 's'} stopped`
      : !successful.length && failures.length ? `${failures.length} ${operation}${failures.length === 1 ? '' : 's'} failed`
        : `${groupLabel(group.family, successful.length, false)}${failures.length ? ` · ${failures.length} failed` : interrupted.length ? ` · ${interrupted.length} stopped` : ''}`;
  const breakdown = [...groupedTools].map(([name, count]) => `${count} ${name}`).join(' · ');
  const summary = group.family === 'tools' && successful.length ? breakdown : label;
  const targets = readTargets(group.tools);
  const withTarget = targets.label ? `${summary} · ${targets.label}` : summary;
  const editLineCounts = group.family === "edits" ? group.tools.reduce((total, tool) => {
    if (tool.status !== "completed" || tool.failed || !fileEditToolNames.has(tool.name)) return total;
    const lineCounts = fileEditPresentation(tool, fileChanges, lineCountOwners)?.lineCounts;
    return lineCounts ? { added: total.added + lineCounts.added, deleted: total.deleted + lineCounts.deleted } : total;
  }, { added: 0, deleted: 0 }) : null;
  const hasEditLineCounts = Boolean(editLineCounts && (editLineCounts.added > 0 || editLineCounts.deleted > 0));
  const duration = group.tools.reduce((total, tool) => total + (tool.durationMs ?? 0), 0);
  return <section className="agent-tool-group">
    <button type="button" className="agent-tool-group-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <GroupIcon family={group.family} running={running} /><span title={targets.full || undefined}>{withTarget}</span>
      {hasEditLineCounts && editLineCounts && <span className="agent-tool-group-lines" aria-label={`+${editLineCounts.added} lines added, −${editLineCounts.deleted} lines deleted`}><strong className="agent-tool-lines-added">+{editLineCounts.added}</strong><strong className="agent-tool-lines-deleted">−{editLineCounts.deleted}</strong></span>}
      {!running && duration > 0 && <small>{formatDuration(duration)}</small>}<ChevronDown size={13} className="agent-tool-group-chevron" />
    </button>
    {expanded && <div className="agent-tool-group-rows">{group.tools.map(tool => <ToolRow key={tool.id} fileChanges={fileChanges} lineCountOwners={lineCountOwners} tool={!taskPending && tool.status === "running" ? { ...tool, status: "completed", failed: true, output: tool.output || "Stopped before completion was confirmed." } : tool} />)}</div>}
  </section>;
}

function ThinkingBody({
  open,
  modelId,
  providerLabel,
  text,
  status,
}: {
  open: boolean;
  modelId?: string;
  providerLabel: string;
  text: string;
  status: "running" | "completed";
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isFollowingRef = useRef(status === "running");
  const touchStartYRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, []);

  useEffect(() => {
    if (open && status === "running") {
      isFollowingRef.current = true;
      scrollToBottom();
    }
  }, [open, status, scrollToBottom]);

  useLayoutEffect(() => {
    if (!open) return;
    if (isFollowingRef.current) {
      scrollToBottom();
    }
  }, [text, open, scrollToBottom]);

  useEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content || !open) return;

    const distanceFromBottom = () =>
      Math.max(0, body.scrollHeight - body.clientHeight - body.scrollTop);

    const onScroll = () => {
      const dist = distanceFromBottom();
      if (dist <= 18) {
        isFollowingRef.current = true;
      } else {
        isFollowingRef.current = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && body.scrollHeight > body.clientHeight) {
        isFollowingRef.current = false;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? touchStartYRef.current;
      if (currentY > touchStartYRef.current + 4 && body.scrollHeight > body.clientHeight) {
        isFollowingRef.current = false;
      }
      touchStartYRef.current = currentY;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(e.key) && body.scrollHeight > body.clientHeight) {
        isFollowingRef.current = false;
      } else if (e.key === "End") {
        isFollowingRef.current = true;
        scrollToBottom();
      }
    };

    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === "max-height" || e.propertyName === "grid-template-rows") {
        if (isFollowingRef.current) {
          scrollToBottom();
        }
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (isFollowingRef.current) {
        scrollToBottom();
      }
    });

    body.addEventListener("scroll", onScroll, { passive: true });
    body.addEventListener("wheel", onWheel, { passive: true });
    body.addEventListener("touchstart", onTouchStart, { passive: true });
    body.addEventListener("touchmove", onTouchMove, { passive: true });
    body.addEventListener("keydown", onKeyDown);
    body.addEventListener("transitionend", onTransitionEnd);
    resizeObserver.observe(body);
    resizeObserver.observe(content);

    if (isFollowingRef.current) {
      scrollToBottom();
    }

    return () => {
      body.removeEventListener("scroll", onScroll);
      body.removeEventListener("wheel", onWheel);
      body.removeEventListener("touchstart", onTouchStart);
      body.removeEventListener("touchmove", onTouchMove);
      body.removeEventListener("keydown", onKeyDown);
      body.removeEventListener("transitionend", onTransitionEnd);
      resizeObserver.disconnect();
    };
  }, [open, scrollToBottom]);

  return (
    <div
      ref={bodyRef}
      className="agent-thinking-body"
      aria-hidden={!open}
      inert={!open}
    >
      <div ref={contentRef} className="agent-thinking-content">
        <small title={modelId}>{providerLabel}</small>
        <div className="agent-progress-text">{text || (status === "running" ? "Waiting for provider output…" : "No thinking text was provided.")}</div>
      </div>
    </div>
  );
}

function ProgressRow({ progress, taskPending, onOpenDesignOptionPreview }: { progress: AgentProgressActivity; taskPending?: boolean; onOpenDesignOptionPreview?: (choices: DesignOptionsPresentationResult, option: 'A' | 'B') => void }) {
  const reasoning = progress.category === "reasoning_summary" || progress.category === "provider_reasoning";
  const isRunning = reasoning && progress.status === "running" && taskPending !== false;
  const [view, setView] = useState({ running: isRunning, open: isRunning });
  const open = view.running === isRunning ? view.open : isRunning;
  useEffect(() => { setView({ running: isRunning, open: isRunning }); }, [isRunning]);

  if (progress.category === "waiting") return taskPending !== false && progress.status === "running" ? <div className="agent-progress-waiting"><LoaderCircle className="agent-tool-spinner" size={13} /><span>Processing with {progress.providerLabel}…</span></div> : null;
  if (reasoning) return <section className={`agent-progress-row agent-thinking-row${open ? " is-open" : ""}`} aria-label={`Thinking from ${progress.providerLabel}`}>
    <button type="button" className="agent-thinking-toggle" aria-expanded={open} onClick={() => setView({ running: isRunning, open: !open })}>
      <strong>{isRunning ? "Thinking..." : <>Thought{formatThinkingDuration(progress.durationMs) && <small className="agent-thinking-duration"> - {formatThinkingDuration(progress.durationMs)}</small>}</>}</strong>
      {isRunning && <LoaderCircle className="agent-tool-spinner" size={12} />}
      <ChevronDown className="agent-thinking-chevron" size={14} />
    </button>
    <ThinkingBody
      open={open}
      modelId={progress.modelId}
      providerLabel={progress.providerLabel}
      text={progress.text}
      status={isRunning ? "running" : "completed"}
    />
  </section>;
  if (progress.id === "website-design-options" || progress.category === "agent_update") {
    const choices = designOptionsPresentation(progress.text, progress.status === 'running' && taskPending !== false);
    if (choices) return <section className="agent-design-options" aria-label="Design options and selection" aria-busy={choices.streaming || undefined}>
      <div className="agent-design-options-header">
        <p className="agent-design-options-title">Design directions</p>
        {choices.streaming ? <span className="agent-design-options-streaming" role="status"><LoaderCircle className="agent-tool-spinner" size={12} /> Writing design options…</span> : choices.incomplete ? <span className="agent-design-options-streaming">Incomplete draft</span> : choices.selected && <span className="agent-design-options-badge">Option {choices.selected} Selected</span>}
      </div>
      <div className="agent-design-options-grid">{choices.options.map(option => {
        const isSelected = option.label === choices.selected;
        return <button type="button" className={`agent-design-option${isSelected ? ' is-selected' : ''}`} key={option.label} aria-label={`Preview Option ${option.label}${option.title ? `: ${option.title}` : ''}`} onClick={() => onOpenDesignOptionPreview?.({ ...choices, sourceId: progress.id }, option.label)}>
          <span className="agent-design-option-top">
            <span className="agent-design-option-heading" role="heading" aria-level={3}>Option {option.label}{option.title ? `: ${option.title}` : ''}</span>
            {isSelected && <span className="agent-design-selected-tag">{choices.streaming || choices.incomplete ? 'Proposed' : 'Selected'}</span>}
          </span>
          <span className="agent-design-option-copy">{option.body || (choices.streaming ? 'Waiting for this option…' : 'This option was not completed.')}</span>
        </button>;
      })}</div>
      {choices.reason && <div className="agent-design-selection">
        <strong>Selection reason</strong>
        <p>{choices.reason}</p>
      </div>}
      {choices.status && <p className="agent-design-options-status">{choices.status}</p>}
      <details className="agent-design-options-source"><summary>Expanded option record</summary><div>{progress.text}</div></details>
    </section>;
  }
  return <div className="agent-progress-row agent-live-output" aria-label="Assistant update">
    <div className="agent-progress-text">{progress.text || ""}</div>
  </div>;
}

export const AgentActivityTimeline = memo(function AgentActivityTimeline({ items, pending, fileChanges = [], onOpenDesignOptionPreview }: { items: AgentActivityItem[]; pending: boolean; fileChanges?: AgentFileLineChange[]; onOpenDesignOptionPreview?: (choices: DesignOptionsPresentationResult, option: 'A' | 'B') => void }) {
  const blocks = blocksFor(items);
  const firstToolGroup = blocks.findIndex(block => block.kind === "group");
  const preToolBlocks = firstToolGroup >= 0 ? blocks.slice(0, firstToolGroup) : blocks;
  const preToolUpdates = preToolBlocks.filter((block): block is Progress => block.kind === "progress"
    && (block.progress.category === "agent_update" || block.progress.category === "reasoning_summary" || block.progress.category === "provider_reasoning")
    && Boolean(block.progress.text.trim()));
  const visibleBlocks = firstToolGroup >= 0 ? [...preToolUpdates, ...blocks.slice(firstToolGroup)]
    : blocks;
  // Older native events can leave finished reasoning marked running. Only the
  // latest reasoning phase can be active once a tool or assistant update follows.
  const activeBlock = [...visibleBlocks].reverse().find(block => block.kind === "group" || block.kind === "progress" && block.progress.category !== "waiting");
  if (!visibleBlocks.length) return null;
  // A turn's final diff belongs to files, not individual tool calls. Attach each
  // file's net count to only its last successful edit call so repeated edits do
  // not multiply the displayed totals. Tools with self-contained line diffs
  // display their own counts and yield ownership to file creation/write calls.
  const lineCountOwners = new Map<string, string>();
  const toolsWithoutSelfCounts = new Set<string>();
  for (const block of visibleBlocks) {
    if (block.kind !== 'group') continue;
    for (const tool of block.tools) {
      if (!fileEditToolNames.has(tool.name) || tool.status !== 'completed' || tool.failed) continue;
      if (!toolSelfLineCounts(tool)) toolsWithoutSelfCounts.add(tool.id);
    }
  }
  for (const block of visibleBlocks) {
    if (block.kind !== 'group') continue;
    for (const tool of block.tools) {
      if (!fileEditToolNames.has(tool.name) || tool.status !== 'completed' || tool.failed) continue;
      for (const file of toolFileTargets(tool)) {
        const change = lineChangesForPath(file, fileChanges);
        if (!change) continue;
        const norm = normalizedFilePath(change.path);
        const currentOwner = lineCountOwners.get(norm);
        if (!currentOwner || !toolsWithoutSelfCounts.has(currentOwner) || toolsWithoutSelfCounts.has(tool.id)) {
          lineCountOwners.set(norm, tool.id);
        }
      }
    }
  }
  const sections = activitySections(visibleBlocks, pending);
  return <section className="agent-activity-timeline" aria-label="Agent activity">
    <div className="agent-activity-blocks">{sections.map(section => section.kind === "activity_run"
      ? <ActivityWorkGroup key={section.key} run={section} taskPending={pending} activeBlock={activeBlock} visibleBlocks={visibleBlocks} fileChanges={fileChanges} lineCountOwners={lineCountOwners} onOpenDesignOptionPreview={onOpenDesignOptionPreview} />
      : renderActivityBlock(section, pending, activeBlock, visibleBlocks, fileChanges, lineCountOwners, onOpenDesignOptionPreview))}</div>
  </section>;
});

function renderActivityBlock(block: Block, taskPending: boolean, activeBlock: Block | undefined, visibleBlocks: Block[], fileChanges: AgentFileLineChange[], lineCountOwners: Map<string, string>, onOpenDesignOptionPreview?: (choices: DesignOptionsPresentationResult, option: 'A' | 'B') => void) {
  if (block.kind === "group") return <ToolGroup key={block.key} group={block} taskPending={taskPending} fileChanges={fileChanges} lineCountOwners={lineCountOwners} />;
  if (block.kind === "progress") return <ProgressRow key={block.key} progress={block.progress} taskPending={taskPending && (block.progress.category === "waiting" ? !activeBlock || visibleBlocks.indexOf(block) > visibleBlocks.indexOf(activeBlock) : block === activeBlock)} onOpenDesignOptionPreview={onOpenDesignOptionPreview} />;
  if (block.kind === "steer") return <div className="agent-steer-block" key={block.key}><div className="agent-steer-badge"><Compass size={13} className="agent-steer-icon" /><span>User Steer Directive</span></div><p className="agent-steer-text">{block.steer.text}</p></div>;
  return <div className="agent-tool-note" key={block.key}><Check size={14} /><span>{block.text}</span></div>;
}

function ActivityWorkGroup({ run, taskPending, activeBlock, visibleBlocks, fileChanges, lineCountOwners, onOpenDesignOptionPreview }: {
  run: ActivityRun; taskPending: boolean; activeBlock?: Block; visibleBlocks: Block[]; fileChanges: AgentFileLineChange[];
  lineCountOwners: Map<string, string>; onOpenDesignOptionPreview?: (choices: DesignOptionsPresentationResult, option: 'A' | 'B') => void;
}) {
  const [view, setView] = useState({ live: run.live, open: run.live });
  const open = view.live === run.live ? view.open : run.live;
  useEffect(() => { setView({ live: run.live, open: run.live }); }, [run.live]);
  const summary = workSummary(run.blocks, taskPending);
  return <section className={`agent-work-group${open ? " is-open" : ""}`} aria-label="Grouped agent activity">
    <button type="button" className="agent-work-group-heading" aria-expanded={open}
      onClick={() => setView({ live: run.live, open: !open })}>
      <GroupIcon family={summary.family} running={false} />
      <span title={summary.label}>{summary.label}</span>
      {summary.issues && <small className="agent-work-group-issues">{summary.issues}</small>}
      <ChevronDown size={13} className="agent-work-group-chevron" aria-hidden="true" />
    </button>
    <div className="agent-work-group-body" aria-hidden={!open} inert={!open}>
      <div className="agent-work-group-content"><div className="agent-work-group-items">
        {run.blocks.map(block => renderActivityBlock(block, taskPending, activeBlock, visibleBlocks, fileChanges, lineCountOwners, onOpenDesignOptionPreview))}
      </div></div>
    </div>
  </section>;
}

export function AgentTurnStatus({ startedAt, completedAt, status, turnId, hasDetails, children, visible = true }: {
  startedAt: number; completedAt?: number; status?: "pending" | "done" | "error";
  turnId: string; hasDetails: boolean; children?: ReactNode; visible?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState({ status, startedAt, expanded: status === "pending" });
  const expanded = view.status === status && view.startedAt === startedAt ? view.expanded : status === "pending";
  useVisibleInterval(() => setNow(Date.now()), status === 'pending' && visible ? 1000 : null);
  const elapsed = formatDuration(Math.max(0, (status === "pending" ? now : completedAt ?? startedAt) - startedAt));
  const label = status === "pending" ? `Working for ${elapsed}` : status === "error" ? `Stopped after ${elapsed}` : completedAt ? `Worked for ${elapsed}` : "Completed";
  const detailsId = `agent-turn-work-${turnId}`;
  return <>
    <div className="agent-turn-status">
      {hasDetails ? <button type="button" className="agent-activity-toggle" aria-expanded={expanded} aria-controls={detailsId}
        aria-label={`${expanded ? "Minimize" : "Maximize"} working details: ${label}`} onClick={() => setView({ status, startedAt, expanded: !expanded })}>
        <span>{label}</span><ChevronDown size={13} aria-hidden="true" />
      </button> : <span>{label}</span>}
      <i />
    </div>
    {hasDetails && <div id={detailsId} className={`agent-turn-work-details${expanded ? " is-expanded" : ""}`} aria-hidden={!expanded} inert={!expanded}>
      <div className="agent-turn-work-details-inner">{children}</div>
    </div>}
  </>;
}

