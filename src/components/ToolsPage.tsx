import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowRight, Bookmark, BookmarkCheck, Bot, BrainCircuit, Check, ChevronLeft,
  ChevronRight, FileText, Lightbulb, ListChecks, Plus, Search, Sparkles,
  Trash2, Wand2, Wrench, X, Zap,
} from "lucide-react";
import "./tools-page.css";

type ToolLane = "agent" | "fast" | "thinking";
type CustomTool = { id: string; name: string; description: string; prompt: string; lane: ToolLane };
type ToolDefinition = CustomTool & { icon: typeof Sparkles; custom?: boolean };

const lanes: { id: ToolLane; label: string; eyebrow: string; title: string; description: string; icon: typeof Sparkles }[] = [
  { id: "agent", label: "Agent", eyebrow: "01 / BUILD", title: "Put ideas into motion.", description: "Structured starters for planning work, mapping steps, and moving projects forward.", icon: Bot },
  { id: "fast", label: "Fast", eyebrow: "02 / FLOW", title: "Move at the speed of thought.", description: "Short, focused tools for everyday writing and quick ideas.", icon: Zap },
  { id: "thinking", label: "Thinking", eyebrow: "03 / DEPTH", title: "Give the hard questions room.", description: "Prompts for weighing options, examining assumptions, and building a deeper plan.", icon: BrainCircuit },
];

const builtInTools: ToolDefinition[] = [
  { id: "fast-browser", lane: "fast", name: "Chrome browser control", description: "Manage tabs and windows, inspect pages, and perform verified browser actions.", prompt: "Use Chrome browser control in Fast mode to: ", icon: Wrench },
  { id: "agent-task-breakdown", lane: "agent", name: "Task breakdown", description: "Turn a goal into milestones, smaller tasks, and a clear next action.", prompt: "Break this goal into milestones, tasks, dependencies, and the next action: ", icon: ListChecks },
  { id: "agent-workflow", lane: "agent", name: "Workflow builder", description: "Draft a repeatable process with steps, checkpoints, and handoffs.", prompt: "Create a practical step-by-step workflow with checkpoints for: ", icon: Wrench },
  { id: "agent-brief", lane: "agent", name: "Project brief", description: "Shape an idea into a concise brief with scope, audience, and risks.", prompt: "Draft a project brief with goal, audience, scope, risks, and next steps for: ", icon: FileText },
  { id: "fast-summarize", lane: "fast", name: "Quick summary", description: "Condense a long thought into the points that matter most.", prompt: "Summarize this clearly in five short bullet points: ", icon: FileText },
  { id: "fast-rewrite", lane: "fast", name: "Clear rewrite", description: "Make a message easier to read while keeping its meaning.", prompt: "Rewrite this clearly and concisely, keeping the original meaning: ", icon: Wand2 },
  { id: "fast-ideas", lane: "fast", name: "Idea spark", description: "Get a focused list of practical directions to explore.", prompt: "Give me ten practical, distinct ideas for: ", icon: Lightbulb },
  { id: "thinking-compare", lane: "thinking", name: "Decision lens", description: "Compare options by tradeoffs, risks, and what matters most.", prompt: "Compare these options using clear criteria, tradeoffs, risks, and a recommendation: ", icon: BrainCircuit },
  { id: "thinking-challenge", lane: "thinking", name: "Assumption check", description: "Surface weak spots and counterarguments before committing.", prompt: "Examine the assumptions, weak points, and strongest counterarguments for: ", icon: Search },
  { id: "thinking-deep-plan", lane: "thinking", name: "Deep plan", description: "Explore a complex problem and map a careful way forward.", prompt: "Analyze this problem carefully and propose a detailed, actionable plan: ", icon: Sparkles },
];

function readSavedTools(): string[] {
  try {
    const raw = localStorage.getItem("orvix.savedTools");
    if (!raw) return ["agent-task-breakdown", "fast-summarize", "thinking-compare"];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function readCustomTools(): CustomTool[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("orvix.customTools") ?? "[]");
    return Array.isArray(value) ? value.filter((tool): tool is CustomTool =>
      tool && typeof tool.id === "string" && typeof tool.name === "string" &&
      typeof tool.description === "string" && typeof tool.prompt === "string" &&
      ["agent", "fast", "thinking"].includes(tool.lane)) : [];
  } catch {
    return [];
  }
}

export default function ToolsPage({ onUseTool }: { onUseTool: (prompt: string) => void }) {
  const [activeLane, setActiveLane] = useState<ToolLane>("agent");
  const [savedIds, setSavedIds] = useState<string[]>(readSavedTools);
  const [customTools, setCustomTools] = useState<CustomTool[]>(readCustomTools);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [newLane, setNewLane] = useState<ToolLane>("agent");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [browserStatus, setBrowserStatus] = useState<Awaited<ReturnType<NonNullable<typeof window.orvixDesktop>["getBrowserStatus"]>> | null>(null);
  useEffect(() => {
    if (activeLane !== "fast") return;
    let stopped = false;
    const refresh = () => window.orvixDesktop?.getBrowserStatus?.().then(value => { if (!stopped) setBrowserStatus(value); }).catch(() => {});
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeLane]);

  useEffect(() => { localStorage.setItem("orvix.savedTools", JSON.stringify(savedIds)); }, [savedIds]);
  useEffect(() => { localStorage.setItem("orvix.customTools", JSON.stringify(customTools)); }, [customTools]);
  useEffect(() => {
    if (!dialogOpen) return;
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setDialogOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [dialogOpen]);

  const tools: ToolDefinition[] = [...builtInTools, ...customTools.map(tool => ({ ...tool, icon: Wrench, custom: true }))];
  const currentLane = lanes.find(lane => lane.id === activeLane)!;
  const laneIndex = lanes.findIndex(lane => lane.id === activeLane);
  const visibleTools = tools.filter(tool => tool.lane === activeLane && `${tool.name} ${tool.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const savedTools = tools.filter(tool => savedIds.includes(tool.id));
  const toggleSaved = (id: string) => setSavedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const changeSlide = (next: number) => { setActiveLane(lanes[(next + lanes.length) % lanes.length].id); setSearch(""); setDeleteId(null); };
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      changeSlide(laneIndex + (event.key === "ArrowRight" ? 1 : -1));
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.tools-tab[aria-selected="true"]')?.focus());
    }
  };
  const openDialog = () => { setNewLane(activeLane); setName(""); setDescription(""); setPrompt(""); setDialogOpen(true); };
  const addTool = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanPrompt = prompt.trim();
    if (!cleanName || !cleanPrompt) return;
    const tool: CustomTool = { id: crypto.randomUUID(), name: cleanName, description: description.trim() || "A custom prompt saved in your workspace.", prompt: cleanPrompt, lane: newLane };
    setCustomTools(current => [...current, tool]);
    setSavedIds(current => [...current, tool.id]);
    setActiveLane(newLane);
    setSearch("");
    setDialogOpen(false);
  };
  const removeCustomTool = (id: string) => {
    setCustomTools(current => current.filter(tool => tool.id !== id));
    setSavedIds(current => current.filter(saved => saved !== id));
    setDeleteId(null);
  };

  return <div className="tools-page">
    <div className="tools-heading"><div><span className="tools-eyebrow"><span /> YOUR TOOLSPACE</span><h1>Tools</h1><p>Keep your best ways of working close. Browse, save, and create prompt tools for your workspace.</p></div><button className="tools-create" onClick={openDialog}><Plus size={17} /> New tool</button></div>
    {activeLane === "fast" && <div className="tools-browser-status" role="status">
      <strong>Chrome browser control</strong>
      <span>{!window.orvixDesktop ? "Available in the desktop app" : browserStatus?.connected ? browserStatus.protocolVersion === 2 ? `Connected · companion ${browserStatus.extensionVersion}` : "Connected · companion update required" : "Disconnected · Chrome opens automatically for actions"}</span>
      {browserStatus?.capabilities.missingPermissions?.length ? <span>Missing permissions: {browserStatus.capabilities.missingPermissions.join(", ")}</span> : browserStatus?.protocolVersion === 2 && <span>Tabs, pages, media, bookmarks, history and downloads</span>}
      {browserStatus?.protocolVersion === 2 && browserStatus.capabilities.websiteAccess === false && <span>Website access missing: allow HTTP/HTTPS sites in the companion permissions.</span>}
      <small>{browserStatus?.message || "Reload the companion after updating; initial setup is remembered."}</small>
    </div>}

    <div className={`tools-hero tools-hero-${activeLane}`} key={activeLane}>
      <div className="tools-hero-copy"><span className="tools-hero-index">{currentLane.eyebrow}</span><h2>{currentLane.title}</h2><p>{currentLane.description}</p><div className="tools-hero-foot"><span>{String(laneIndex + 1).padStart(2, "0")} <i /> 03</span><span>{tools.filter(tool => tool.lane === activeLane).length} tools in this slide</span></div></div>
      <div className="tools-hero-art" aria-hidden="true"><div className="tools-art-ring outer" /><div className="tools-art-ring inner" /><span><currentLane.icon size={48} strokeWidth={1.25} /></span></div>
      <div className="tools-hero-arrows"><button onClick={() => changeSlide(laneIndex - 1)} aria-label="Previous tool slide"><ChevronLeft size={18} /></button><button onClick={() => changeSlide(laneIndex + 1)} aria-label="Next tool slide"><ChevronRight size={18} /></button></div>
    </div>

    <div className="tools-tabs" role="tablist" aria-label="Tool slides" onKeyDown={onTabsKeyDown}>
      {lanes.map((lane, index) => { const Icon = lane.icon; return <button key={lane.id} id={`tools-tab-${lane.id}`} role="tab" aria-selected={lane.id === activeLane} aria-controls="tools-slide-panel" tabIndex={lane.id === activeLane ? 0 : -1} className={`tools-tab${lane.id === activeLane ? " active" : ""}`} onClick={() => changeSlide(index)}><Icon size={18} /><span><strong>{lane.label}</strong><small>{lane.id === "agent" ? "Plan and build" : lane.id === "fast" ? "Quick moves" : "Go deeper"}</small></span><span className="tools-tab-number">0{index + 1}</span></button>; })}
    </div>

    <section id="tools-slide-panel" className="tools-slide-panel" role="tabpanel" aria-labelledby={`tools-tab-${activeLane}`} key={`panel-${activeLane}`}>
      <div className="tools-section-head"><div><span className="tools-mini-label">EXPLORE THE LIBRARY</span><h3>{currentLane.label} tools <span>{visibleTools.length}</span></h3></div><label className="tools-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${currentLane.label.toLowerCase()} tools`} aria-label={`Search ${currentLane.label} tools`} />{search && <button onClick={() => setSearch("")} aria-label="Clear tool search"><X size={14} /></button>}</label></div>
      {visibleTools.length ? <div className="tools-grid">{visibleTools.map(tool => { const Icon = tool.icon; const saved = savedIds.includes(tool.id); return <article className="tool-card" key={tool.id}><div className="tool-card-top"><span className={`tool-card-icon ${tool.lane}`}><Icon size={21} strokeWidth={1.7} /></span><span className="tool-card-kind">{tool.custom ? "CUSTOM" : "BUILT IN"}</span></div><h4>{tool.name}</h4><p>{tool.description}</p><div className="tool-card-actions"><button className={`tool-save${saved ? " saved" : ""}`} onClick={() => toggleSaved(tool.id)} aria-pressed={saved}>{saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}{saved ? "Saved" : "Save"}</button><button className="tool-use" onClick={() => onUseTool(tool.prompt)}>Use in chat <ArrowRight size={14} /></button></div>{tool.custom && <div className="tool-custom-action">{deleteId === tool.id ? <><span>Delete this tool?</span><button onClick={() => setDeleteId(null)}>Cancel</button><button className="confirm" onClick={() => removeCustomTool(tool.id)}>Delete</button></> : <button onClick={() => setDeleteId(tool.id)}><Trash2 size={13} /> Delete custom tool</button>}</div>}</article>; })}</div> : <div className="tools-no-results"><Search size={20} /><strong>No matching tools</strong><p>Try another search or create your own tool.</p></div>}
    </section>

    <section className="tools-saved-section"><div className="tools-section-head"><div><span className="tools-mini-label">YOUR COLLECTION</span><h3>Saved tools <span>{savedTools.length}</span></h3></div><p>One click opens a new chat with the tool prompt ready.</p></div>{savedTools.length ? <div className="tools-saved-list">{savedTools.map(tool => { const Icon = tool.icon; return <div className="tools-saved-item" key={tool.id}><span className={`tools-saved-icon ${tool.lane}`}><Icon size={17} /></span><div><strong>{tool.name}</strong><small>{lanes.find(lane => lane.id === tool.lane)?.label}{tool.custom ? " · Custom" : ""}</small></div><button className="tools-saved-use" onClick={() => onUseTool(tool.prompt)}>Use <ArrowRight size={14} /></button><button className="tools-saved-remove" onClick={() => toggleSaved(tool.id)} aria-label={`Remove ${tool.name} from saved tools`} title="Remove from saved"><X size={14} /></button></div>; })}</div> : <div className="tools-saved-empty"><Bookmark size={18} /><span>Save a tool from any slide to keep it here.</span></div>}</section>
    <p className="tools-local-note"><Check size={13} /> Tools are stored on this device as prompt starters. Generated replies need an AI service connected to Orvix.</p>

    {dialogOpen && <div className="tools-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialogOpen(false); }}><form className="tools-dialog" onSubmit={addTool} role="dialog" aria-modal="true" aria-labelledby="tools-dialog-title"><div className="tools-dialog-head"><span className="tool-card-icon agent"><Wrench size={21} /></span><button type="button" onClick={() => setDialogOpen(false)} aria-label="Close new tool dialog"><X size={17} /></button></div><span className="tools-mini-label">MAKE IT YOURS</span><h2 id="tools-dialog-title">Create a tool</h2><p>Save a reusable prompt and keep it in the slide that fits your workflow.</p><label htmlFor="tool-name">Tool name</label><input id="tool-name" autoFocus required maxLength={48} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Meeting notes" /><label htmlFor="tool-description">What it helps with</label><input id="tool-description" maxLength={140} value={description} onChange={event => setDescription(event.target.value)} placeholder="A short description" /><label htmlFor="tool-prompt">Prompt starter</label><textarea id="tool-prompt" required maxLength={1200} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Write the instruction you want ready in a new chat..." /><label htmlFor="tool-lane">Slide</label><select id="tool-lane" value={newLane} onChange={event => setNewLane(event.target.value as ToolLane)}><option value="agent">Agent</option><option value="fast">Fast</option><option value="thinking">Thinking</option></select><div className="tools-dialog-actions"><button type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button type="submit" disabled={!name.trim() || !prompt.trim()}><Plus size={15} /> Save tool</button></div></form></div>}
  </div>;
}
