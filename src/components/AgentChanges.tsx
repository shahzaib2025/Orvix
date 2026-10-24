import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Activity, ChevronDown, ChevronRight, Code2, Ellipsis, Eye, ExternalLink, FileCode2, FilePlus2, FileText, Folder, FolderOpen, Maximize2, Minimize2, PanelLeftOpen, PanelRightOpen, Plus, RotateCcw, Search, X, RefreshCw } from "lucide-react";
import type { AgentFilePreview as FilePreview } from "../desktop";
import AgentFilePreviewContent from "./AgentFilePreviewContent";
import AgentReport from "./AgentReport";
import AgentScorecardPanel from "./AgentScorecardPanel";
import type { DesignOptionsPresentationResult } from "./designOptionsPresentation";
import AgentDiff from "./AgentDiff";
import "./agent-changes.css";
import "./agent-file-panel.css";
import "./agent-design-options-preview.css";

export type Change = { path: string; folder: string; kind: "created" | "modified" | "deleted"; directory?: boolean; binary: boolean; added: number; deleted: number; diffAvailable?: boolean };
export type ChangesDockSide = "left" | "right";
type WorkspaceFile = { path: string; root: string; relativePath: string };
type WorkspaceFileListing = { root: string; files: { path: string; relativePath: string }[]; total: number; truncated: boolean };
type WorkspaceSource = { path: string; content: string | null; binary: boolean; tooLarge: boolean; size: number; deleted?: boolean };
type SourceToken = { text: string; kind?: string };
type ViewerMode = "code" | "changes" | "preview";
export type DesignOptionsViewer = { choices: DesignOptionsPresentationResult; option: "A" | "B" };

function supportsInlinePreview(path: string) {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return ["html", "htm", "md", "markdown", "png", "jpg", "jpeg", "webp", "gif", "svg", "pdf"].includes(extension);
}

function preferredFileView(path: string): ViewerMode {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "webp", "gif", "pdf"].includes(extension) ? "preview" : "code";
}

function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

function changeCount(file: Change) {
  if (file.directory) return "Folder";
  if (file.binary) return "Binary";
  if (file.diffAvailable === false) return "Tracked";
  if (file.added || file.deleted) return <>{file.added > 0 && <b>+{file.added}</b>}{file.deleted > 0 && <i>−{file.deleted}</i>}</>;
  return file.kind === "created" ? "New" : file.kind === "deleted" ? "Removed" : "Edited";
}

export function FileTypeIcon({ path, directory = false }: { path: string; directory?: boolean }) {
  if (directory) return <Folder className="agent-change-file-icon is-folder" size={17} aria-hidden="true" />;
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  if (["html", "htm"].includes(extension)) return <svg className="agent-change-file-icon is-html" viewBox="0 0 24 24" aria-label="HTML file" role="img"><path d="M3 2h18l-1.65 18.2L12 22l-7.35-1.8L3 2Z" fill="currentColor"/><text x="12" y="17" textAnchor="middle" fill="#17191c" fontSize="13" fontWeight="800">5</text></svg>;
  if (extension === "css") return <svg className="agent-change-file-icon is-css" viewBox="0 0 24 24" aria-label="CSS file" role="img"><path d="M3 2h18l-1.65 18.2L12 22l-7.35-1.8L3 2Z" fill="currentColor"/><text x="12" y="17" textAnchor="middle" fill="#17191c" fontSize="13" fontWeight="800">3</text></svg>;
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return <svg className="agent-change-file-icon is-js" viewBox="0 0 24 24" aria-label="JavaScript file" role="img"><path d="M3 3h18v18H3z" fill="currentColor"/><path d="M13.2 16.6c.35.58.8 1 1.7 1 .72 0 1.18-.36 1.18-.86 0-.6-.47-.82-1.27-1.17l-.44-.19c-1.27-.54-2.1-1.21-2.1-2.63 0-1.3 1-2.29 2.57-2.29 1.12 0 1.93.39 2.51 1.41l-1.37.88c-.3-.54-.62-.75-1.14-.75-.53 0-.87.34-.87.75 0 .53.34.75 1.12 1.09l.44.19c1.5.64 2.33 1.29 2.33 2.75 0 1.57-1.23 2.43-2.88 2.43-1.62 0-2.67-.77-3.18-1.78l1.4-.83Zm-5.8.15c.27.48.52.89 1.12.89.57 0 .92-.22.92-1.08v-4.1h1.73v4.13c0 1.79-1.05 2.6-2.59 2.6-1.39 0-2.2-.72-2.62-1.58l1.44-.86Z" fill="#17191c"/></svg>;
  if (["ts", "tsx", "mts", "cts"].includes(extension)) return <span className="agent-change-file-icon is-ts" role="img" aria-label="TypeScript file">TS</span>;
  if (["json", "jsonc"].includes(extension)) return <span className="agent-change-file-icon is-json" role="img" aria-label="JSON file">{"{}"}</span>;
  return <FileCode2 className="agent-change-file-icon is-generic" size={16} aria-hidden="true" />;
}

const htmlExtensions = new Set(["html", "htm", "xml", "svg", "vue", "svelte"]);
const commentHashExtensions = new Set(["py", "rb", "sh", "bash", "yml", "yaml", "toml", "ps1", "r", "pl"]);
const sourceKeywords = new Set("as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch throw try type typeof var void while with yield enum declare namespace abstract satisfies keyof infer readonly unknown never any string number boolean object symbol bigint true false null undefined this self super def lambda pass raise except and or not is match case fn pub use mod crate impl trait struct enum where move ref mut dyn unsafe async await go defer chan select range func map interface package var const fallthrough goto nil iota bool byte rune error make new append cap close copy delete len complex real imag panic print println recover".split(/\s+/));

function syntaxTokens(line: string, extension: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  const add = (text: string, kind?: string) => { if (text) tokens.push({ text, kind }); };
  if (htmlExtensions.has(extension)) {
    const pattern = /<!--.*?-->|<\/?[A-Za-z][\w:.-]*|\/?>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|&(?:[A-Za-z]+|#\d+);|[A-Za-z_:][\w:.-]*|=/g;
    let cursor = 0, insideTag = false;
    for (const match of line.matchAll(pattern)) {
      const token = match[0], index = match.index ?? 0;
      add(line.slice(cursor, index));
      let kind = "";
      if (token.startsWith("<!--")) kind = "comment";
      else if (/^<\/?[A-Za-z]/.test(token)) { kind = "tag"; insideTag = true; }
      else if (token === ">" || token === "/>" || token === "=" || token === "</") { kind = "punctuation"; if (token === ">" || token === "/>") insideTag = false; }
      else if (/^["']/.test(token)) kind = "string";
      else if (token.startsWith("&")) kind = "entity";
      else if (insideTag) kind = "attribute";
      add(token, kind);
      cursor = index + token.length;
    }
    add(line.slice(cursor));
    return tokens;
  }

  const isMarkdown = ["md", "markdown"].includes(extension);
  const pattern = commentHashExtensions.has(extension)
    ? /#.*$|\/\*.*?\*\/|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[@]?[A-Za-z_$][\w$-]*/gi
    : /\/\*.*?\*\/|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[@]?[A-Za-z_$][\w$-]*/gi;
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const token = match[0], index = match.index ?? 0;
    if (isMarkdown && token.startsWith("//")) continue;
    add(line.slice(cursor, index));
    const after = line.slice(index + token.length);
    let kind = "";
    if (token.startsWith("//") || token.startsWith("/*") || token.startsWith("#")) kind = "comment";
    else if (/^["'`]/.test(token)) kind = extension === "json" && /^\s*:/.test(after) ? "key" : "string";
    else if (/^(?:\d|0x)/i.test(token)) kind = "number";
    else if (token.startsWith("@") && ["css", "scss"].includes(extension)) kind = "keyword";
    else if (["css", "scss"].includes(extension) && /^\s*:/.test(after)) kind = "property";
    else if (["true", "false", "null", "undefined", "nil"].includes(token)) kind = "literal";
    else if (sourceKeywords.has(token)) kind = "keyword";
    else if (/^\s*\(/.test(after)) kind = "function";
    add(token, kind);
    cursor = index + token.length;
  }
  add(line.slice(cursor));
  return tokens;
}

export function SourceView({ file, value, maxLines = 12000 }: { file: WorkspaceSource; value: string; maxLines?: number }) {
  const extension = file.path.split(".").pop()?.toLowerCase() ?? "";
  const lines = useMemo(() => value.split(/\r\n|\n|\r/), [value]);
  const visibleLines = lines.slice(0, maxLines);
  return <div className="agent-source-view" aria-label="Read-only workspace file source">
    {file.deleted && <div className="agent-source-notice is-deleted">This file was deleted in the task. Showing its saved prior content.</div>}
    <div className="agent-source-scroll" role="table" aria-label={`${folderName(file.path)} source code`}>
      {visibleLines.map((line, index) => <div className="agent-source-line" role="row" key={index}>
        <span className="agent-source-line-number" role="cell" aria-hidden="true">{index + 1}</span>
        <code role="cell">{syntaxTokens(line, extension).map((token, tokenIndex) => token.kind
          ? <span className={`agent-code-token-${token.kind}`} key={tokenIndex}>{token.text}</span>
          : token.text)}{line.length === 0 ? " " : null}</code>
      </div>)}
    </div>
    {lines.length > visibleLines.length && <div className="agent-source-notice">Showing the first {visibleLines.length.toLocaleString()} of {lines.length.toLocaleString()} lines.</div>}
  </div>;
}

export default function AgentChanges({ taskId, turnId = null, initialFile = null, initialMode = "code", designOptions = null, workspaces, files, scorecardActive = false, scorecardTabOpen = true, onScorecardActiveChange, onScorecardTabClose, dockSide, width, minimized, maximized, onDockChange, onResize, onToggleMinimize, onToggleMaximize, onClose, onUpdated }: {
  taskId: string | null; turnId?: string | null; initialFile?: string | null; initialMode?: ViewerMode; designOptions?: DesignOptionsViewer | null; workspaces: string[]; files: Change[];
  scorecardActive?: boolean; scorecardTabOpen?: boolean; onScorecardActiveChange?: (active: boolean) => void; onScorecardTabClose?: () => void;
  dockSide: ChangesDockSide; width: number; minimized: boolean; maximized: boolean;
  onDockChange: (side: ChangesDockSide) => void; onResize: (width: number) => void;
  onToggleMinimize: () => void; onToggleMaximize: () => void; onClose: () => void; onUpdated: (files: Change[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [activeDesignOption, setActiveDesignOption] = useState<"A" | "B" | null>(null);
  const [closedDesignOptions, setClosedDesignOptions] = useState<Set<string>>(() => new Set());
  const [diff, setDiff] = useState<{ before: string | null; after: string | null; binary: boolean; directory?: boolean; unavailable?: boolean } | null>(null);
  const [source, setSource] = useState<WorkspaceSource | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [viewMode, setViewMode] = useState<ViewerMode>(initialMode);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [workspaceFilesTruncated, setWorkspaceFilesTruncated] = useState(false);
  const [workspaceFilesLoaded, setWorkspaceFilesLoaded] = useState(false);
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(false);
  const [workspaceFilesError, setWorkspaceFilesError] = useState("");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [sourceRevision, setSourceRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const resizeStart = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const autoOpenedFile = useRef(Boolean(initialFile));
  const browseRequest = useRef(0);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const fileSearchRef = useRef<HTMLInputElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const overflowRef = useRef<HTMLDetailsElement | null>(null);
  const fileActionsRef = useRef<HTMLDetailsElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const changedByPath = useMemo(() => new Map(files.map(file => [file.path, file])), [files]);
  const changedFiles = files.filter(file => !file.directory);
  const selectedChange = selected ? changedByPath.get(selected) : undefined;
  const selectedOption = activeDesignOption ? designOptions?.choices.options.find(option => option.label === activeDesignOption) ?? null : null;
  const designOptionActive = Boolean(selectedOption);
  const lineCountsLimited = changedFiles.some(file => !file.binary && file.diffAvailable === false);
  const refreshWorkspaceFiles = useCallback(async () => {
    if (!taskId || !workspaces.length) {
      setWorkspaceFiles([]);
      setWorkspaceFilesError(taskId ? "No open workspace is available for this task." : "Select a task with an open workspace.");
      return;
    }
    const desktop = window.orvixDesktop;
    if (!desktop?.listAgentWorkspaceFiles) {
      setWorkspaceFilesError("Workspace file browsing is unavailable in this app session.");
      setWorkspaceFilesLoaded(true);
      return;
    }
    const requestId = ++browseRequest.current;
    setWorkspaceFilesLoading(true);
    setWorkspaceFilesError("");
    const results = await Promise.allSettled(workspaces.map(root => desktop.listAgentWorkspaceFiles(taskId, root)));
    if (requestId !== browseRequest.current) return;
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<WorkspaceFileListing> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    setWorkspaceFiles(fulfilled.flatMap(result => result.value.files.map(file => ({ ...file, root: result.value.root }))).sort((left, right) => left.root.localeCompare(right.root) || left.relativePath.localeCompare(right.relativePath)));
    setWorkspaceFilesTruncated(fulfilled.some(result => result.value.truncated));
    setWorkspaceFilesError(rejected.length ? String(rejected[0].reason instanceof Error ? rejected[0].reason.message : rejected[0].reason) : "");
    setWorkspaceFilesLoaded(true);
    setWorkspaceFilesLoading(false);
  }, [taskId, workspaces]);

  useEffect(() => {
    autoOpenedFile.current = Boolean(initialFile || designOptions);
    setSelected(initialFile);
    setOpenTabs(initialFile ? [initialFile] : []);
    setActiveDesignOption(designOptions?.option ?? null);
    setClosedDesignOptions(new Set());
    setDiff(null); setSource(null); setFilePreview(null); setPreviewError(""); setSourceError(""); setNotice("");
    setViewMode(initialMode === "preview" && initialFile && !supportsInlinePreview(initialFile) ? "code" : initialMode);
    setWorkspaceFiles([]); setWorkspaceFilesTruncated(false); setWorkspaceFilesLoaded(false); setWorkspaceFilesLoading(false); setWorkspaceFilesError("");
    setFileMenuOpen(false); setFileSearch("");
    browseRequest.current++;
  }, [taskId, turnId, initialFile, initialMode, designOptions?.option]);
  useEffect(() => {
    if (selected || activeDesignOption || autoOpenedFile.current) return;
    const firstFile = files.find(file => !file.directory);
    if (!firstFile) return;
    autoOpenedFile.current = true;
    setSelected(firstFile.path);
    setOpenTabs([firstFile.path]);
  }, [files, selected, activeDesignOption]);
  useEffect(() => { if (fileMenuOpen && !workspaceFilesLoaded && !workspaceFilesLoading) void refreshWorkspaceFiles(); }, [fileMenuOpen, workspaceFilesLoaded, workspaceFilesLoading, refreshWorkspaceFiles]);
  useEffect(() => {
    if (!fileMenuOpen) return;
    fileSearchRef.current?.focus();
    const closeOutside = (event: MouseEvent) => { if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFileMenuOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [fileMenuOpen]);
  useEffect(() => {
    const menus = [overflowRef.current, fileActionsRef.current].filter((menu): menu is HTMLDetailsElement => Boolean(menu));
    const header = headerRef.current;
    if (!header) return;
    const closeOutside = (event: PointerEvent) => { for (const menu of menus) if (!menu.contains(event.target as Node)) menu.open = false; };
    const closeEscape = (event: KeyboardEvent) => {
      for (const menu of menus) if (event.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    const observer = new ResizeObserver(() => { for (const menu of menus) if (getComputedStyle(menu).display === "none") menu.open = false; });
    observer.observe(header);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { observer.disconnect(); document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [minimized]);
  useEffect(() => { if (fileActionsRef.current) fileActionsRef.current.open = false; }, [selected, viewMode]);
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return;
    const keepSelectedVisible = () => {
      const tab = strip.querySelector<HTMLElement>(".agent-editor-tab.selected");
      if (!tab) return;
      const bounds = strip.getBoundingClientRect(), selectedBounds = tab.getBoundingClientRect();
      if (selectedBounds.left < bounds.left) strip.scrollLeft += selectedBounds.left - bounds.left;
      else if (selectedBounds.right > bounds.right) strip.scrollLeft += selectedBounds.right - bounds.right;
    };
    keepSelectedVisible();
    const observer = new ResizeObserver(keepSelectedVisible);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [selected, activeDesignOption, scorecardActive, minimized, openTabs]);
  useEffect(() => {
    if (!taskId || !selected || designOptionActive || viewMode !== "changes" || !selectedChange) { setDiff(null); return; }
    let active = true;
    setDiff(null);
    const request = turnId ? window.orvixDesktop?.getAgentTurnDiff(taskId, turnId, selected) : window.orvixDesktop?.getAgentDiff(taskId, selected);
    void request?.then(value => { if (active) setDiff(value); }).catch(error => { if (active) setNotice(String(error)); });
    return () => { active = false; };
  }, [taskId, turnId, selected, selectedChange, viewMode, sourceRevision, designOptionActive]);
  useEffect(() => {
    if (!taskId || !selected || designOptionActive || viewMode !== "code") { setSource(null); setSourceLoading(false); return; }
    let active = true;
    setSource(null); setSourceError(""); setSourceLoading(true);
    const load = async () => {
      try {
        if (selectedChange?.kind === "deleted") {
          const saved = turnId ? await window.orvixDesktop!.getAgentTurnDiff(taskId, turnId, selected) : await window.orvixDesktop!.getAgentDiff(taskId, selected);
          if (active) {
            setSource(saved.before === null ? null : { path: selected, content: saved.before, binary: saved.binary, tooLarge: saved.unavailable === true, size: saved.before.length, deleted: true });
            if (saved.before === null) setSourceError("The saved prior content for this deleted file is unavailable.");
          }
        } else {
          const result = await window.orvixDesktop!.readAgentWorkspaceFile(taskId, selected);
          if (active) setSource(result);
        }
      } catch (error) { if (active) setSourceError(error instanceof Error ? error.message : String(error)); }
      finally { if (active) setSourceLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [taskId, turnId, selected, selectedChange, viewMode, sourceRevision, designOptionActive]);
  useEffect(() => {
    if (!taskId || !selected || designOptionActive || viewMode !== "preview") {
      setFilePreview(null); setPreviewLoading(false); setPreviewError("");
      return;
    }
    let active = true;
    setFilePreview(null); setPreviewError(""); setPreviewLoading(true);
    const load = window.orvixDesktop?.previewAgentFile;
    if (!load) {
      setPreviewError("Restart Orvix to use file previews.");
      setPreviewLoading(false);
      return;
    }
    void load(taskId, selected).then(value => { if (active) setFilePreview(value); }).catch(error => {
      if (active) setPreviewError(error instanceof Error ? error.message : "This file is unavailable. It may have moved or been removed.");
    }).finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [taskId, selected, designOptionActive, viewMode, sourceRevision]);

  const selectFile = (file: WorkspaceFile) => {
    onScorecardActiveChange?.(false);
    autoOpenedFile.current = true;
    setActiveDesignOption(null);
    setSelected(file.path);
    setOpenTabs(current => current.includes(file.path) ? current : [...current, file.path]);
    setViewMode(preferredFileView(file.path)); setFileMenuOpen(false); setFileSearch("");
  };
  const closeTab = (file: string) => {
    const index = openTabs.indexOf(file);
    const next = openTabs.filter(item => item !== file);
    setOpenTabs(next);
    if (selected === file) {
      const nextFile = next[Math.min(index, next.length - 1)] ?? null;
      setSelected(nextFile);
      if (!nextFile && designOptions) {
        setActiveDesignOption(designOptions.option);
        setViewMode("preview");
      } else setViewMode(nextFile ? preferredFileView(nextFile) : "code");
    }
  };
  const closeDesignOptionTab = (label: "A" | "B", event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextClosed = new Set(closedDesignOptions);
    nextClosed.add(label);
    setClosedDesignOptions(nextClosed);
    if (activeDesignOption !== label) return;

    const nextOption = designOptions?.choices.options.find(option => !nextClosed.has(option.label));
    if (nextOption) {
      setSelected(null);
      setActiveDesignOption(nextOption.label);
      setViewMode("preview");
      requestAnimationFrame(() => tabStripRef.current?.querySelector<HTMLButtonElement>(`.agent-design-option-tab.selected [role='tab']`)?.focus());
      return;
    }

    const nextFile = openTabs[0] ?? null;
    setActiveDesignOption(null);
    setSelected(nextFile);
    setViewMode(nextFile ? preferredFileView(nextFile) : "code");
    requestAnimationFrame(() => tabStripRef.current?.querySelector<HTMLButtonElement>(".agent-editor-tab.selected [role='tab']")?.focus());
  };
  const closeInsightsTab = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onScorecardTabClose?.();
    requestAnimationFrame(() => {
      const selectedTab = tabStripRef.current?.querySelector<HTMLButtonElement>(".agent-editor-tab.selected [role='tab']");
      (selectedTab ?? headerRef.current?.querySelector<HTMLButtonElement>(".agent-open-file-button"))?.focus();
    });
  };
  const restore = async (file?: string) => {
    if (!taskId || !window.confirm(file ? `Restore ${file} to its state before this task?` : "Restore every file changed by this task?")) return;
    try {
      const next = await window.orvixDesktop!.restoreAgentChange(taskId, file);
      onUpdated(next); setDiff(null); setSourceRevision(value => value + 1); setNotice(file ? "File restored." : "Task changes restored.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not restore changes."); }
  };
  const visibleWorkspaceFiles = workspaceFiles.filter(file => `${file.relativePath} ${file.root}`.toLowerCase().includes(fileSearch.trim().toLowerCase()));
  const selectedBrowserFile = selected ? workspaceFiles.find(file => file.path === selected) : undefined;
  const selectedRoot = selectedBrowserFile?.root ?? workspaces.filter(root => selected && (selected.toLowerCase().startsWith(root.replace(/[\\/]+$/, "").toLowerCase() + "\\") || selected.toLowerCase().startsWith(root.replace(/[\\/]+$/, "").toLowerCase() + "/"))).sort((left, right) => right.length - left.length)[0] ?? selectedChange?.folder;
  const breadcrumbSegments = selected && selectedRoot
    ? [folderName(selectedRoot), ...selected.slice(selectedRoot.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "").split(/[\\/]+/).filter(Boolean)]
    : [];
  const shownSource = source?.content ?? null;
  const isSelectedChangedFile = Boolean(selectedChange && !selectedChange.directory);
  const canPreviewSelected = designOptionActive || Boolean(selected && supportsInlinePreview(selected));
  const selectedOptionTitle = selectedOption?.title ? `Option ${selectedOption.label}: ${selectedOption.title}` : selectedOption ? `Option ${selectedOption.label}` : "";
  const selectedOptionSource = selectedOption
    ? [`# ${selectedOptionTitle}`, selectedOption.body, designOptions?.choices.reason ? `Selection rationale: ${designOptions.choices.reason}` : "", selectedOption.selected && designOptions?.choices.blueprint ? `## Selected layout blueprint\n\n${designOptions.choices.blueprint}` : '', designOptions?.choices.status ?? ""].filter(Boolean).join("\n\n")
    : "";
  const runFileOperation = async (action: "open" | "reveal") => {
    if (!taskId || !selected) return;
    setNotice("");
    try {
      const bridge = window.orvixDesktop?.actOnAgentFile;
      if (!bridge) throw new Error("File actions require the desktop app.");
      await bridge(taskId, selected, action);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not open this file."); }
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStart.current = { pointerId: event.pointerId, x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const delta = event.clientX - start.x;
    onResize(start.width + (dockSide === "left" ? delta : -delta));
  };
  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeStart.current?.pointerId !== event.pointerId) return;
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(width + (event.key === "ArrowRight" ? 24 : -24));
  };
  const runOverflowAction = (action: () => void) => {
    if (overflowRef.current) { overflowRef.current.open = false; overflowRef.current.querySelector("summary")?.focus(); }
    action();
  };
  const runFileAction = (action: () => void) => {
    if (fileActionsRef.current) { fileActionsRef.current.open = false; fileActionsRef.current.querySelector("summary")?.focus(); }
    action();
  };
  return <section className={`agent-changes-panel${minimized ? " is-minimized" : ""}`} aria-label={turnId ? "Workspace files and turn changes" : "Workspace files and changes"} onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented || fileMenuOpen || overflowRef.current?.open || fileActionsRef.current?.open) return;
    event.preventDefault(); event.stopPropagation(); onClose();
  }}>
    {!minimized && !maximized && <div className="agent-changes-resize" role="separator" aria-orientation="vertical" aria-label="Resize changes pane" aria-valuenow={width} aria-valuetext={`${width} pixel pane width`} tabIndex={0} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={resizeByKeyboard} />}
    <header className="agent-changes-head" ref={headerRef}>
      {!minimized && <div className="agent-editor-tabs">
        <div className="agent-file-menu-anchor" ref={fileMenuRef}>
          <button type="button" className="agent-open-file-button" aria-label="Open workspace file" aria-expanded={fileMenuOpen} aria-haspopup="dialog" onClick={() => { if (overflowRef.current) overflowRef.current.open = false; setFileMenuOpen(value => !value); }} disabled={!workspaces.length} title={workspaces.length ? "Browse files in this task's open workspaces" : "This task has no open workspace"}><FilePlus2 size={14} /><span>Open file</span><ChevronDown size={12} /></button>
          {fileMenuOpen && <div className="agent-workspace-file-menu" role="dialog" aria-label="Open workspace file">
            <label className="agent-workspace-file-search"><Search size={14} /><input ref={fileSearchRef} aria-label="Search workspace files" placeholder="Search files by name or path" value={fileSearch} onChange={event => setFileSearch(event.target.value)} /><button type="button" aria-label="Refresh workspace files" title="Refresh workspace files" onClick={() => void refreshWorkspaceFiles()} disabled={workspaceFilesLoading}><RefreshCw size={13} /></button></label>
            <div className="agent-workspace-file-results" role="listbox" aria-label="Workspace files">
              {workspaceFilesLoading ? <p className="agent-workspace-file-message">Loading workspace files…</p>
                : visibleWorkspaceFiles.length ? visibleWorkspaceFiles.map(file => {
                  const change = changedByPath.get(file.path);
                  return <button type="button" role="option" aria-selected={selected === file.path} key={file.path} onClick={() => selectFile(file)} title={file.path}>
                    <FileTypeIcon path={file.path} /><span><strong>{folderName(file.path)}</strong><small>{file.relativePath}</small></span>{change ? <em className={`is-${change.kind}`}>{changeCount(change)}</em> : null}
                  </button>;
                }) : <p className="agent-workspace-file-message">{workspaceFilesError || (workspaceFilesLoaded ? "No matching files in the open workspaces." : "Open a project workspace to browse its files.")}</p>}
            </div>
            {workspaceFiles.length > 0 && <small className="agent-workspace-file-footnote">{workspaceFilesTruncated ? "Showing the first 30,000 eligible files. Refine the search to find a file." : "Showing files from this task’s open workspaces."} Ignored, generated, and credential paths are hidden.</small>}
          </div>}
        </div>
        <div className="agent-editor-tab-strip" ref={tabStripRef} role="tablist" aria-label="Open workspace files and design options" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          if (!tabs.length) return;
          const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
        }}>
          {designOptions?.choices.options.filter(option => !closedDesignOptions.has(option.label)).map(option => <div className={`agent-editor-tab agent-design-option-tab${!scorecardActive && activeDesignOption === option.label ? " selected" : ""}`} key={`option-${option.label}`}>
            <button type="button" role="tab" aria-selected={!scorecardActive && activeDesignOption === option.label} title={`Option ${option.label}${option.title ? `: ${option.title}` : ""}`} onClick={() => { onScorecardActiveChange?.(false); setSelected(null); setActiveDesignOption(option.label); setViewMode("preview"); }}>
              <FileText size={14} aria-hidden="true" /><span>Option {option.label}{option.title ? ` · ${option.title}` : ""}</span>
            </button>
            <button type="button" className="agent-editor-tab-close" aria-label={`Close Option ${option.label} tab`} title={`Close Option ${option.label}`} onClick={event => closeDesignOptionTab(option.label, event)}><X size={12} /></button>
          </div>)}
          {openTabs.map(file => <div className={`agent-editor-tab${!scorecardActive && selected === file ? " selected" : ""}`} key={file}>
            <button type="button" role="tab" aria-selected={!scorecardActive && selected === file && !designOptionActive} title={file} onClick={() => { onScorecardActiveChange?.(false); setActiveDesignOption(null); setSelected(file); setViewMode(preferredFileView(file)); }}><FileTypeIcon path={file} /><span>{folderName(file)}</span></button>
            <button type="button" className="agent-editor-tab-close" aria-label={`Close ${folderName(file)}`} title={`Close ${folderName(file)}`} onClick={() => closeTab(file)}><X size={12} /></button>
          </div>)}
          {scorecardTabOpen && <div className={`agent-editor-tab agent-insights-tab${scorecardActive ? " selected" : ""}`}>
            <button type="button" role="tab" aria-selected={scorecardActive} aria-controls="agent-scorecard-tabpanel" title="Coding run insights" onClick={() => onScorecardActiveChange?.(true)}>
              <Activity size={14} aria-hidden="true" /><span>Run insights</span>
            </button>
            <button type="button" className="agent-editor-tab-close" aria-label="Close Run Insights tab" title="Close Run Insights tab" onClick={closeInsightsTab}><X size={12} /></button>
          </div>}
        </div>
        <button type="button" className="agent-editor-add-tab" aria-label="Open another workspace file" title="Open another workspace file" disabled={!workspaces.length} onClick={() => setFileMenuOpen(true)}><Plus size={16} /></button>
      </div>}
      <div className="agent-changes-actions">
        {minimized ? <button type="button" className="agent-changes-restore-pane" aria-label="Restore changes pane" title="Restore changes pane" onClick={onToggleMinimize}>{dockSide === "left" ? <PanelLeftOpen size={16}/> : <PanelRightOpen size={16}/>}</button> : <>
          <button type="button" className={`agent-changes-dock-button${dockSide === "left" ? " selected" : ""}`} aria-label="Dock changes on left" aria-pressed={dockSide === "left"} title="Dock on left" onClick={() => onDockChange("left")}><PanelLeftOpen size={15}/></button>
          <button type="button" className={`agent-changes-dock-button${dockSide === "right" ? " selected" : ""}`} aria-label="Dock changes on right" aria-pressed={dockSide === "right"} title="Dock on right" onClick={() => onDockChange("right")}><PanelRightOpen size={15}/></button>
          <button type="button" aria-label="Minimize changes pane" title="Minimize pane" onClick={onToggleMinimize}><Minimize2 size={15}/></button>
          <button type="button" aria-label={maximized ? "Restore split view" : "Maximize changes pane"} title={maximized ? "Restore split view" : "Maximize pane"} onClick={onToggleMaximize}>{maximized ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button>
          {!turnId && changedFiles.length > 0 && <button type="button" className="agent-restore-all" onClick={() => void restore()} aria-label="Restore all changes" title="Restore all changes"><RotateCcw size={14} /><span>Restore all</span></button>}
          <details className="agent-changes-overflow" ref={overflowRef} onToggle={event => { if (event.currentTarget.open) setFileMenuOpen(false); }}>
            <summary aria-label="More changes actions" title="More changes actions"><Ellipsis size={17} /></summary>
            <div className="agent-changes-overflow-menu">
              <button type="button" disabled={!workspaces.length} onClick={() => runOverflowAction(() => setFileMenuOpen(true))}><FilePlus2 size={15} /><span>Open file…</span></button>
              <div className="agent-changes-menu-separator" />
              <button type="button" aria-pressed={dockSide === "left"} onClick={() => runOverflowAction(() => onDockChange("left"))}><PanelLeftOpen size={15} /><span>Dock on left</span></button>
              <button type="button" aria-pressed={dockSide === "right"} onClick={() => runOverflowAction(() => onDockChange("right"))}><PanelRightOpen size={15} /><span>Dock on right</span></button>
              <button type="button" onClick={() => runOverflowAction(onToggleMinimize)}><Minimize2 size={15} /><span>Minimize pane</span></button>
              <button type="button" onClick={() => runOverflowAction(onToggleMaximize)}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{maximized ? "Restore split view" : "Maximize pane"}</span></button>
              {!turnId && changedFiles.length > 0 && <><div className="agent-changes-menu-separator" /><button type="button" className="agent-changes-menu-restore" onClick={() => runOverflowAction(() => void restore())}><RotateCcw size={15} /><span>Restore all changes</span></button></>}
            </div>
          </details>
        </>}
        <button type="button" className="agent-changes-close" aria-label="Close changes" title="Close changes" onClick={onClose}><X size={17} /></button>
      </div>
    </header>
    <div className="agent-changes-content">
      <div id="agent-scorecard-tabpanel" className="agent-changes-scorecard-body" role="tabpanel" aria-label="Run insights" hidden={!scorecardActive}>
        <AgentScorecardPanel active={scorecardActive} />
      </div>
      {!scorecardActive && <>
      <div className="agent-changes-filebar">
        <nav className="agent-workspace-breadcrumbs" aria-label="Current file path">
          <FolderOpen size={15} aria-hidden="true" />
          {designOptionActive ? <strong title={selectedOptionTitle}>{selectedOptionTitle}</strong> : breadcrumbSegments.length ? breadcrumbSegments.map((segment, index) => <span className="agent-workspace-crumb" key={`${segment}-${index}`}>
            {index > 0 && <ChevronRight size={12} aria-hidden="true" />}<strong aria-current={index === breadcrumbSegments.length - 1 ? "page" : undefined} title={selected ?? undefined}>{segment}</strong>
          </span>) : <strong>{selected ? folderName(selected) : workspaceFiles.length ? "Workspace files" : workspaces.length ? "Open a file to view its source" : designOptions ? "Design options" : "No task workspace"}</strong>}
        </nav>
        <div className="agent-workspace-file-tools">
          <span className="agent-workspace-change-summary" title="Tracked changes in this task"><strong>{changedFiles.length}</strong><span>changed</span><b>+{changedFiles.reduce((total, file) => total + file.added, 0)}</b><i>−{changedFiles.reduce((total, file) => total + file.deleted, 0)}</i></span>
          <div className="agent-file-view-switch" role="group" aria-label="File view">
            {(!selected || designOptionActive || !["png", "jpg", "jpeg", "webp", "gif", "pdf"].includes(selected.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "")) && <button type="button" className={viewMode === "code" ? "selected" : ""} aria-pressed={viewMode === "code"} onClick={() => setViewMode("code")}><Code2 size={13} />Code</button>}
            {isSelectedChangedFile && <button type="button" className={viewMode === "changes" ? "selected" : ""} aria-pressed={viewMode === "changes"} onClick={() => setViewMode("changes")}>Changes</button>}
            {canPreviewSelected && <button type="button" className={viewMode === "preview" ? "selected" : ""} aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}><Eye size={13} />Preview</button>}
          </div>
          <div className="agent-file-actions">
            <button type="button" className="agent-file-tool-button" aria-label="Refresh current file" title="Refresh current file" disabled={!selected || sourceLoading || previewLoading} onClick={() => setSourceRevision(value => value + 1)}><RefreshCw size={14} /></button>
            {selected && <button type="button" className="agent-file-tool-button" aria-label="Open file in app" title="Open in app" onClick={() => void runFileOperation("open")}><ExternalLink size={14} /></button>}
            {selected && <button type="button" className="agent-file-tool-button" aria-label="Show file in folder" title="Show in folder" onClick={() => void runFileOperation("reveal")}><FolderOpen size={14} /></button>}
            {selectedChange && !selectedChange.directory && !turnId && <button type="button" className="agent-file-restore-button" aria-label="Restore this file" onClick={() => void restore(selectedChange.path)} title="Restore this file"><RotateCcw size={13} /><span>Restore</span></button>}
            <details className="agent-file-actions-overflow" ref={fileActionsRef}>
              <summary aria-label="More file actions" title="More file actions"><Ellipsis size={17} /></summary>
              <div className="agent-changes-overflow-menu">
                <button type="button" disabled={!selected || sourceLoading} onClick={() => runFileAction(() => setSourceRevision(value => value + 1))}><RefreshCw size={14} /><span>Refresh current file</span></button>
                {selected && <button type="button" onClick={() => runFileAction(() => void runFileOperation("open"))}><ExternalLink size={14} /><span>Open file in app</span></button>}
                {selected && <button type="button" onClick={() => runFileAction(() => void runFileOperation("reveal"))}><FolderOpen size={14} /><span>Show file in folder</span></button>}
                {selectedChange && !selectedChange.directory && !turnId && <button type="button" className="agent-changes-menu-restore" onClick={() => runFileAction(() => void restore(selectedChange.path))}><RotateCcw size={14} /><span>Restore this file</span></button>}
              </div>
            </details>
          </div>
        </div>
      </div>
      {lineCountsLimited && <div className="agent-workspace-limitation" role="status">Some tracked files are too large for an inline changes comparison; their current source can still be opened.</div>}
      <div className={`agent-changes-preview${viewMode === "preview" ? " agent-file-panel-body" : ""}`}>
        {viewMode === "changes" && selectedChange ? diff?.directory ? <p className="agent-changes-note">This folder was {selectedChange.kind} during this {turnId ? "turn" : "task"}.</p>
          : diff?.binary ? <p className="agent-changes-note">Binary file changed. A text comparison is unavailable.</p>
            : diff?.unavailable ? <p className="agent-changes-note">This file is too large for an inline comparison. Its current source remains available in Code view.</p>
              : diff ? <AgentDiff before={diff.before} after={diff.after} /> : <p className="agent-changes-note">Loading file comparison…</p>
          : designOptionActive && selectedOption ? viewMode === "preview" ? <article className="agent-design-options-preview-article">
            <div className="agent-design-options-preview-heading">
              <h3>{selectedOptionTitle}</h3>
              {selectedOption.selected && <span className="agent-design-options-preview-selected">{designOptions?.choices.streaming || designOptions?.choices.incomplete ? 'Proposed selection' : 'Selected for build'}</span>}
            </div>
            {designOptions?.choices.streaming && <p className="agent-design-options-streaming" role="status">Writing design options…</p>}
            <div className="agent-design-options-preview-copy"><AgentReport text={selectedOption.body || (designOptions?.choices.streaming ? 'Waiting for this option…' : 'This option was not completed.')} /></div>
            {selectedOption.selected && designOptions?.choices.blueprint && <section className="agent-design-options-preview-blueprint"><h4>Selected layout blueprint</h4><AgentReport text={designOptions.choices.blueprint} /></section>}
            {designOptions?.choices.reason && <section className="agent-design-options-preview-reason"><strong>Selection rationale</strong><p>{designOptions.choices.reason}</p></section>}
            {designOptions?.choices.status && <p className="agent-design-options-preview-status">{designOptions.choices.status}</p>}
          </article> : <SourceView file={{ path: `Option-${selectedOption.label}.md`, content: selectedOptionSource, size: selectedOptionSource.length, binary: false, tooLarge: false }} value={selectedOptionSource} />
          : selected && viewMode === "preview" ? previewLoading ? <p className="agent-file-panel-message" role="status">Preparing preview…</p>
            : previewError ? <p className="agent-file-panel-message is-error" role="alert">{previewError}</p>
              : filePreview ? <AgentFilePreviewContent preview={filePreview} />
                : <p className="agent-file-panel-message" role="status">Preview could not be loaded.</p>
          : selected ? sourceLoading ? <p className="agent-changes-note">Opening file…</p>
            : sourceError ? <p className="agent-changes-note is-error" role="alert">{sourceError}</p>
              : source?.binary ? <p className="agent-changes-note">This is a binary file. Text source preview is unavailable.</p>
                : source?.tooLarge ? <p className="agent-changes-note">This file is larger than 2 MB and is not loaded into the source preview.</p>
                  : shownSource !== null && source ? <SourceView file={source} value={shownSource} />
                    : <p className="agent-changes-note">The file source could not be loaded.</p>
            : <div className="agent-workspace-empty"><FileCode2 size={26} /><strong>{designOptions && closedDesignOptions.size < designOptions.choices.options.length ? "Choose a design direction" : designOptions ? "Design option tabs closed" : workspaces.length ? "Open a workspace file" : "No task workspace"}</strong><p>{designOptions && closedDesignOptions.size < designOptions.choices.options.length ? "Choose an option from the tabs above." : designOptions ? "Reopen a design direction from its option card in the task." : workspaces.length ? "Use Open file to browse the project. You can inspect source files whether or not the agent changed them." : "Open a project workspace in this task to browse its files here."}</p></div>}
      </div>
      </>}
    </div>
    {notice && <p className="agent-changes-alert" role="status">{notice}</p>}
  </section>;
}
