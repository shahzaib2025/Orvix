import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type { AgentNotificationItem, AgentServerIndicator, AntigravityServerIndicator, NotificationOpenTarget } from './desktop';
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown,
  Camera, Clock3, Download, ExternalLink, Eye, Folder, FolderPlus,
  House, LayoutDashboard, LoaderCircle, Menu, MessageCircle, Mic, MicOff, Minus, Paperclip, Pencil,
  PanelLeftOpen, PanelRightClose, PanelRightOpen, PieChart, Play, Plus,
  Search, Settings2, Sparkles, Square, Star, Trash2, Upload, UsersRound, Wrench, X,
} from "lucide-react";
import orbitFaceLogo from "./assets/orvix-logo-orbit-face.png";
import orbMascot from "./assets/orvix-orb-mascot.png";
const PersistentAgentPage = lazy(() => import("./components/PersistentAgentPage"));
import RenderErrorBoundary from "./components/RenderErrorBoundary";
const ToolsPage = lazy(() => import("./components/ToolsPage"));
import SearchKeysPanel from './components/SearchKeysPanel';
import ScreenSourcePicker from './components/ScreenSourcePicker';
import type {ScreenSource} from './components/ScreenSourcePicker';
import {LiveScreenCapture,type ScreenFrame} from './screenSharing';
import {screenSharingCommand} from './screenSharingCommands';
import ScreenSharePreview from './components/ScreenSharePreview';
import TinyExecutionIndicator from './components/TinyExecutionIndicator';
import './screenSharing.css';
import './agent-server-indicator.css';
const TinyAgentsPage = lazy(() => import("./components/TinyAgentsPage"));
const IslandVillageDemo = lazy(() => import('./components/IslandVillageDemo'));
import NotificationInbox from './components/NotificationInbox';
import { FastActionReview } from './components/FastWorkSettings';
import SettingsPage from './components/SettingsPage';
import { subscribeTinyAgentListing } from './tinyAgentSubscription';
import HaloVisualizer from "./components/HaloVisualizer";
import { useVisibleInterval } from './useVisibleInterval';
import { attachOrbMotion } from "./orbMotion";
import { VoiceSession } from "./liveVoice";
import type { ThinkingDepth, VoiceProgress, VoiceStatus, VoiceTranscript } from "./liveVoice";
import { failedTurnHistoryReply, isVoiceSystemError } from "./thinkingFlow";
import { memoryCommand, isMemoryControl, memoryKind, matchMemoryToForget, canRestoreMemoryHistory } from './companionMemory';

type Mode = "Fast" | "Thinking";
type Page = "home" | "dashboard" | "tiny-agents" | "tools" | "folders" | "recent" | "favorites" | "shared" | "reporting" | "settings" | "support" | "profile";
type Message = { createdAt?: number; delivery?: "complete" | "interrupted"; id: string; role: "user" | "assistant"; text: string; mode: Mode; attachments?: string[]; thoughtForSeconds?: number; phase?: "progress" | "status" | "final"; progressPhase?: VoiceProgress["phase"] };
type DisplayMessage = Message & { updates?: Message[] };
type Conversation = { id: string; profile: Mode; title: string; messages: Message[]; createdAt?: number; updatedAt: number };
type Project = { id: string; name: string; createdAt: number };
type UserProfile = {
  name: string; displayName: string; email: string; phone: string;
  occupation: string; company: string; website: string; location: string;
  timezone: string; language: string; interests: string; bio: string; avatar: string;
};
const defaultProfile: UserProfile = {
  name: "mahdis", displayName: "Mahdis", email: "developer@orvix.local", phone: "+1 (555) 019-2834",
  occupation: "Designer, student,", company: "Orvix Systems", website: "https://orvix.dev",
  location: "Global", timezone: "UTC", language: "English",
  interests: "research, coding, music, chess", bio: "", avatar: "",
};
const emptyProfile: UserProfile = {
  name: "", displayName: "", email: "", phone: "", occupation: "", company: "",
  website: "", location: "", timezone: "", language: "", interests: "", bio: "", avatar: "",
};
function normalizeProfile(value: unknown, fallback: UserProfile = defaultProfile): UserProfile {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = { ...fallback };
  for (const key of Object.keys(emptyProfile) as (keyof UserProfile)[]) {
    const raw = source[key];
    if (typeof raw !== "string") continue;
    if (key === "avatar") {
      result.avatar = /^data:image\/(png|jpeg|webp);base64,/i.test(raw) && raw.length < 800_000 ? raw : "";
    } else {
      result[key] = raw.trim().slice(0, key === "bio" ? 500 : key === "interests" ? 250 : 160);
    }
  }
  return result;
}

const mainItems = [
  { id: "home", label: "Home", icon: House },
  { id: "dashboard", label: "Agent", icon: LayoutDashboard },
  { id: "tiny-agents", label: "Tiny Agents", icon: Activity },
  { id: "tools", label: "Tools", icon: Wrench },
] as const;
const folderItems = [
  { id: "folders", label: "View all", icon: Folder },
  { id: "recent", label: "Recent", icon: Clock3 },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "shared", label: "Shared", icon: UsersRound },
] as const;
type OrganizationPage = (typeof folderItems)[number]["id"];
function organizationCount(page: OrganizationPage, projects: Project[], conversations: Conversation[]) {
  if (page === "folders") return projects.length;
  if (page === "recent") return conversations.length;
  return 0;
}
const utilityItems = [
  { id: "reporting", label: "Reporting", icon: PieChart },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "support", label: "Support", icon: MessageCircle },
] as const;
const pageTitles: Record<Page, string> = {
  home: "Home", dashboard: "Agent", "tiny-agents": "Tiny Agents", tools: "Tools", folders: "Folders",
  recent: "Recent", favorites: "Favorites", shared: "Shared", reporting: "Reporting",
  settings: "Settings", support: "Support", profile: "Profile",
};
function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMode(value: unknown): Mode {
  return value === "Thinking" || value === "Work" ? "Thinking" : "Fast";
}

function AgentServerStatusPill({ status }: { status: AgentServerIndicator | null }) {
  const [now, setNow] = useState(() => Date.now());
  useVisibleInterval(() => setNow(Date.now()), status?.state === 'connected' && status.idleExpiresAt ? 1000 : null);
  const seconds = status?.state === 'connected' && status.idleExpiresAt
    ? Math.max(0, Math.ceil((status.idleExpiresAt - now) / 1000)) : null;
  const clock = seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const stateLabel = !status || status.state === 'checking' ? 'Checking…' : status.state === 'starting' ? 'Preparing…'
    : status.state === 'offline' ? 'Offline' : status.responseState === 'waiting' ? 'Waiting for model…' : status.responseState === 'working' ? 'Working' : seconds === null ? status.prepared === false ? 'Connected' : 'Ready' : `Stops in ${clock}`;
  const state = status?.state ?? 'checking';
  const description = !status || state === 'checking' ? 'Checking the OpenCode server for this Agent task.'
    : state === 'starting' ? 'Preparing this task’s OpenCode server, workspace and provider configuration.'
    : state === 'offline' ? 'The OpenCode server for this Agent task is offline. It starts when needed.'
    : status?.responseState === 'waiting' ? 'The task server is connected. Waiting for the selected model to return content.'
    : status?.responseState === 'working' ? 'The task server is connected and the Agent is working.'
    : status?.prepared && seconds === null ? 'The task workspace and provider configuration are prepared. The selected model may still take time to return its first content.'
    : seconds === null ? 'The OpenCode server is connected and in use. It stays active while an Agent job is running.'
    : `The OpenCode server is connected. It will shut down after ${clock} of idle time unless used again.`;
  return <div className={`agent-server-indicator is-${state}${seconds !== null ? ' has-countdown' : ''}`} role="status" aria-live="off" aria-label={`OpenCode server: ${stateLabel}`} title={description}>
    <i aria-hidden="true" />
    <span className="agent-server-indicator-name">OpenCode</span>
    <span className="agent-server-indicator-state">{stateLabel}</span>
  </div>;
}

function AntigravityServerStatusPill({
  status,
  onStatusChange
}: {
  status: AntigravityServerIndicator | null;
  onStatusChange?: (newStatus: AntigravityServerIndicator) => void;
}) {
  const [busy, setBusy] = useState(false);
  const isOnline = status?.state === 'connected';
  const state = busy ? (isOnline ? 'stopping' : 'starting') : (status?.state ?? 'offline');
  const stateLabel = busy
    ? (isOnline ? 'Stopping…' : 'Starting…')
    : isOnline
    ? 'Ready'
    : 'Offline';

  const description = isOnline
    ? `Antigravity daemon connected on port ${status?.port} (${status?.activeModelCount ?? 0} models ready). Click button to stop.`
    : status?.error
    ? `Antigravity server: ${status.error}`
    : 'Antigravity daemon is offline. Click button to start.';

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || !window.orvixDesktop) return;
    setBusy(true);
    try {
      if (isOnline) {
        const res = await window.orvixDesktop.stopAntigravityServer();
        onStatusChange?.(res);
      } else {
        const res = await window.orvixDesktop.startAntigravityServer();
        onStatusChange?.(res);
      }
    } catch (err) {
      console.error('Failed to toggle Antigravity daemon:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`agent-server-indicator agent-io-pill is-${state}${busy ? ' is-busy' : ''}`}
      role="status"
      aria-live="off"
      aria-label={`Antigravity server: ${stateLabel}`}
      title={description}
    >
      <i aria-hidden="true" />
      <span className="agent-server-indicator-name">Antigravity</span>
      <span className="agent-server-indicator-state">{stateLabel}</span>
      <button
        type="button"
        className={`agent-server-action-btn ${isOnline ? 'action-stop' : 'action-start'}`}
        disabled={busy}
        onClick={handleToggle}
        aria-label={isOnline ? 'Stop Antigravity server' : 'Start Antigravity server'}
        title={isOnline ? 'Stop Antigravity server daemon' : 'Start Antigravity server daemon'}
      >
        {busy ? <LoaderCircle size={10} className="is-spinning" /> : isOnline ? <Square size={8} fill="currentColor" /> : <Play size={8} fill="currentColor" />}
        <span>{busy ? (isOnline ? 'Stop' : 'Start') : isOnline ? 'Stop' : 'Start'}</span>
      </button>
    </div>
  );
}

function loadConversations(): Conversation[] {
  const current = readStored<Conversation[] | null>("orvix.homeConversations.v2", null);
  if (Array.isArray(current)) return current;
  const saved = readStored<Conversation[]>("orvix.conversations", []);
  const previous = readStored<Message[]>("orvix.messages", []);
  const legacy = saved.length ? saved : previous.length ? [{ id: crypto.randomUUID(), title: "Earlier chat", messages: previous, createdAt: Date.now(), updatedAt: Date.now() }] : [];
  return legacy.flatMap(conversation => (["Fast", "Thinking"] as Mode[]).flatMap((profile): Conversation[] => {
    const messages = (conversation.messages ?? []).filter(message => normalizeMode(message.mode) === profile).map(message => ({ ...message, mode: profile }));
    if (!messages.length) return [];
    const title = messages.find(message => message.role === "user")?.text.trim().slice(0, 48) || conversation.title || "Earlier chat";
    return [{ id: `${conversation.id}-${profile.toLowerCase()}`, profile, title, messages, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt }];
  }));
}

function formatChatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function profileInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map(word => word[0].toUpperCase()).join("") : "O";
}

function BrandMark({ small = false, active = false }: { small?: boolean; active?: boolean }) {
  return <span className={`brand-mark${small ? " brand-mark-small" : ""}${active ? " is-working" : ""}`} aria-hidden="true"><img src={orbitFaceLogo} alt="" /></span>;
}

function OrbAvatar() {
  const avatarRef = useRef<HTMLDivElement>(null);
  useEffect(() => attachOrbMotion(avatarRef.current), []);

  return <div className="message-avatar orb-avatar" ref={avatarRef}><div className="orb-face"><img src={orbMascot} alt="" /><span className="orb-eye orb-eye-left" aria-hidden="true"><img src={orbMascot} alt="" /></span><span className="orb-eye orb-eye-right" aria-hidden="true"><img src={orbMascot} alt="" /></span></div></div>;
}

function renderMessageText(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const links = /\[([^\]]{1,200})\]\((https:\/\/[^\s)]+)\)/g;
  let from = 0;
  for (const match of value.matchAll(links)) {
    const index = match.index ?? 0;
    if (index > from) parts.push(value.slice(from, index));
    parts.push(<a key={index} href={match[2]} target="_blank" rel="noreferrer">{match[1]}</a>);
    from = index + match[0].length;
  }
  if (from < value.length) parts.push(value.slice(from));
  return parts;
}

const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  const updates = (message as DisplayMessage).updates;
  return <div className={`message ${message.role}`}>
    {message.role === "assistant" ? <OrbAvatar /> : <div className="message-avatar">Y</div>}
    <div className="message-content"><div className="message-meta">{message.role === "assistant" ? "Orvix" : "You"}<span>·</span>{message.mode}{message.role === "assistant" && message.mode === "Thinking" && message.thoughtForSeconds !== undefined && <><span>·</span><span className="message-thought-time">Thought for {message.thoughtForSeconds}s</span></>}</div>{updates?.length ? <><div className="thinking-response-updates" aria-live="polite">{updates.map(update => <div className={`thinking-response-update is-${update.progressPhase}`} key={update.id}><span className="thinking-response-update-dot" aria-hidden="true" /><span className="thinking-response-update-text">{update.text.startsWith("Thinking") ? <span className="thinking-status-wrapper">Thinking<span className="thinking-dots-anim" /></span> : update.text}</span></div>)}</div>{message.text && <p className="thinking-response-answer">{renderMessageText(message.text)}</p>}</> : message.text && <p>{renderMessageText(message.text)}</p>}{message.attachments?.length ? <div className="message-files">{message.attachments.map(name => <span key={name}><Paperclip size={12} />{name}</span>)}</div> : null}</div>
  </div>;
});

function messagesForDisplay(messages: Message[]): DisplayMessage[] {
  const displayed: DisplayMessage[] = [];
  for (let index = 0; index < messages.length;) {
    const current = messages[index];
    if (current.role !== "user") {
      displayed.push(current);
      index++;
      continue;
    }
    displayed.push(current);
    let end = index + 1;
    while (end < messages.length && messages[end].role !== "user") end++;
    const turn = messages.slice(index + 1, end);
    const assistant = turn.filter(item => item.role === "assistant");
    if (assistant.length) {
      const updates = assistant.filter(item => item.text.trim() && (item.phase === "progress" || item.phase === "status"));
      const answers = assistant.filter(item => item.phase !== "progress" && item.phase !== "status");
      const latest = answers.at(-1) ?? assistant.at(-1)!;
      displayed.push({ ...latest, id: `turn-${current.id}`, text: current.mode === "Fast" ? answers.at(-1)?.text || "" : answers.map(item => item.text).filter(Boolean).join("\n\n"), updates });
      displayed.push(...turn.filter(item => item.role !== "assistant"));
    } else {
      displayed.push(...turn);
    }
    index = end;
  }
  return displayed;
}

function App() {
  const [page, setPage] = useState<Page>(() => { try { const p = new URLSearchParams(window.location.search).get("page") as Page; return p || "home"; } catch { return "home"; } });
  const [agentPageVisited, setAgentPageVisited] = useState(false);
  const [agentNotificationTarget, setAgentNotificationTarget] = useState<Extract<NotificationOpenTarget, { type: 'agent' }> | null>(null);
  const [agentServerStatus, setAgentServerStatus] = useState<AgentServerIndicator | null>(null);
  const [antigravityServerStatus, setAntigravityServerStatus] = useState<AntigravityServerIndicator | null>({ state: 'offline', port: null });
  useEffect(() => {
    if (page !== 'dashboard') return;
    const bridge = window.orvixDesktop;
    if (!bridge?.getAntigravityStatus) return;
    let active = true;
    const update = async () => {
      try {
        const s = await bridge.getAntigravityStatus();
        if (active) setAntigravityServerStatus(s);
      } catch {
        if (active) setAntigravityServerStatus({ state: 'offline', port: null });
      }
    };
    void update();
    const timer = window.setInterval(update, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [page]);
  const publishAgentServerStatus = useCallback((status: AgentServerIndicator | null) => {
    setAgentServerStatus(current => current?.taskId === status?.taskId && current?.state === status?.state
      && current?.prepared === status?.prepared && current?.responseState === status?.responseState && current?.idleMs === status?.idleMs && current?.idleExpiresAt === status?.idleExpiresAt ? current : status);
  }, []);
  const [mode, setMode] = useState<Mode>(() => normalizeMode(localStorage.getItem("orvix.homeMode")));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [historyOpen, setHistoryOpen] = useState<boolean>(() => readStored("orvix.historyOpen", true));
  const [historySearch, setHistorySearch] = useState("");
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(() => normalizeProfile(readStored<Partial<UserProfile>>("orvix.profile", defaultProfile)));
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeIds, setActiveIds] = useState<Record<Mode, string | null>>(() => {
    const saved = readStored<Record<Mode, string | null> | null>("orvix.activeHomeConversations.v2", null);
    if (saved) return saved;
    const legacyActive = readStored<string | null>("orvix.activeConversationId", null);
    const activeFor = (profile: Mode) => conversations.find(item => item.id === `${legacyActive}-${profile.toLowerCase()}`)?.id ?? conversations.find(item => item.profile === profile)?.id ?? null;
    return { Fast: activeFor("Fast"), Thinking: activeFor("Thinking") };
  });
  const activeConversationId = activeIds[mode];
  const setActiveConversationId = (id: string | null) => setActiveIds(current => ({ ...current, [mode]: id }));
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId && conversation.profile === mode);
  const messages = activeConversation?.messages ?? [];
  const [projects, setProjects] = useState<Project[]>(() => readStored("orvix.projects", []));
  const [reduceMotion, setReduceMotion] = useState<boolean>(() => readStored("orvix.reduceMotion", false));
  const [input, setInput] = useState("");
  const [projectDialog, setProjectDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("off");
  const [voiceError, setVoiceError] = useState("");
  const [memoryNotice, setMemoryNotice] = useState('');
  const [memoryProjectId, setMemoryProjectId] = useState('');
  const memoryCommandBusyRef = useRef(false);
  const voiceCreateEpochRef = useRef(0);
  const [screenPickerOpen,setScreenPickerOpen]=useState(false);
  const [screenSharingName,setScreenSharingName]=useState('');
  const screenPickerOpenRef=useRef(false);
  const screenSharingNameRef=useRef('');
  const [screenError,setScreenError]=useState('');
  const [screenFrame,setScreenFrame]=useState<ScreenFrame|null>(null);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [microphoneHealth,setMicrophoneHealth]=useState<"off"|"starting"|"active"|"muted"|"error">("off");
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>(() => {
    const saved = readStored<string>("orvix.thinkingDepth", "LOW");
    return saved === "MEDIUM" || saved === "HIGH" ? saved : "LOW";
  });
  const [mobileThinkingDepthOpen, setMobileThinkingDepthOpen] = useState(false);
  const [thinkingStarted, setThinkingStarted] = useState<number | null>(null);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [voiceProgressText, setVoiceProgressText] = useState("");
  const [tinyDraftCount, setTinyDraftCount] = useState(0);
  const [tinySelectedId, setTinySelectedId] = useState<string | null>(null);
  const [tinySelectionRequest, setTinySelectionRequest] = useState(0);
  const [tinyShutdownEndsAt, setTinyShutdownEndsAt] = useState<number | null>(null);
  const [showHomeJumpToLatest, setShowHomeJumpToLatest] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const homeInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const homeFollowingRef = useRef(true);
  const voiceRef = useRef<VoiceSession | null>(null);
  const microphoneObservationRef=useRef<{state:string;session:VoiceSession|null}>({state:'off',session:null});
  const screenCaptureRef=useRef<LiveScreenCapture|null>(null);
  const pendingScreenStreamRef=useRef<MediaStream|null>(null);
  const screenOwnerRef=useRef<VoiceSession|null>(null);
  const screenEpochRef=useRef(0);
  const screenProtectionRef=useRef<string|null>(null);
  const voiceStartRef = useRef<Promise<void> | null>(null);
  const voiceConversationRef = useRef<string | null>(null);
  const isDesktop = typeof window !== "undefined" && !!window.orvixDesktop;
  const listening = microphoneActive;
  const voiceConnected = voiceStatus === "listening" || voiceStatus === "thinking" || voiceStatus === "responding";
  const voicePending=voiceStatus==='connecting'||voiceStatus==='reconnecting'||microphoneHealth==='starting';
  const microphoneIssue=microphoneHealth==='error'||microphoneHealth==='muted';
  const voiceIndicator=voiceStatus==='connecting'?'Connecting…':voiceStatus==='reconnecting'?'Reconnecting…':microphoneHealth==='starting'?'Starting microphone…':microphoneHealth==='error'?'Microphone unavailable · click to retry':microphoneHealth==='muted'?'Microphone muted by device':voiceStatus==='thinking'?(voiceProgressText||`Thinking… ${thinkingElapsed}s`):voiceStatus==='responding'?(voiceProgressText||(listening?'Speaking · mic active':'Speaking · mic off')):listening?'Listening':'Connected · mic off';
  useEffect(()=>{
    const sync=()=>{const current=voiceRef.current,state=current?.microphoneState??'off',observation=microphoneObservationRef.current;setMicrophoneHealth(state);setMicrophoneActive(state==='active'||state==='muted');if(state!==observation.state||current!==observation.session){window.orvixDesktop?.logLive?.(state==='error'?'warn':'turn','Microphone capture state changed',{previous:observation.state,state,profile:current?.profile,sessionChanged:current!==observation.session});microphoneObservationRef.current={state,session:current};}};
    sync();
    if(voiceStatus==='off'||voiceStatus==='error')return;
    const timer=window.setInterval(sync,200);return()=>window.clearInterval(timer);
  },[voiceStatus]);
  const profileLabel = profile.displayName.trim() || profile.name.trim();
  const greetingName = profileLabel.split(/\s+/)[0] || "Mahdis";

  useEffect(() => {
    localStorage.setItem("orvix.homeConversations.v2", JSON.stringify(conversations));
  }, [conversations]);
  useEffect(() => { localStorage.setItem("orvix.activeHomeConversations.v2", JSON.stringify(activeIds)); }, [activeIds]);
  useEffect(() => { localStorage.setItem("orvix.thinkingDepth", JSON.stringify(thinkingDepth)); }, [thinkingDepth]);
  useEffect(() => { localStorage.setItem("orvix.homeMode", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("orvix.historyOpen", JSON.stringify(historyOpen)); }, [historyOpen]);
  useEffect(() => { localStorage.setItem("orvix.projects", JSON.stringify(projects)); }, [projects]);
  useEffect(() => {
    const bridge = window.orvixDesktop;
    if (!bridge) return;
    return subscribeTinyAgentListing(bridge, value => {
      setTinyDraftCount(value.rules.filter(rule => rule.draft).length);
      setTinyShutdownEndsAt(value.shutdownPending?.endsAt ?? null);
    });
  }, []);
  const handleNotificationOpen = useCallback((notice: NotificationOpenTarget) => {
    setMobileOpen(false);
    if (notice.type === 'agent') {
      setAgentNotificationTarget(notice);
      setAgentPageVisited(true);
      setPage('dashboard');
      return;
    }
    setPage('tiny-agents');
    setTinySelectedId(notice.ruleId);
    setTinySelectionRequest(request => request + 1);
  }, []);
  useEffect(() => window.orvixDesktop?.onNotificationOpen(handleNotificationOpen), [handleNotificationOpen]);
  const openAgentNotification = useCallback((item: AgentNotificationItem) => {
    handleNotificationOpen({
      type: 'agent', notificationId: item.id, eventKind: item.kind,
      taskId: item.taskId, requestId: item.requestId,
      ...(item.questionId ? { questionId: item.questionId } : {}),
      ...(item.approvalId ? { approvalId: item.approvalId } : {}),
    });
  }, [handleNotificationOpen]);
  useEffect(() => {
    localStorage.setItem("orvix.profile", JSON.stringify(profile));
    voiceRef.current?.updateIdentity(profile);
  }, [profile]);
  useEffect(() => {
    // The first committed workspace frame and synchronous local data load are ready.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => window.dispatchEvent(new Event("orvix:ready")));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);
  useEffect(() => {
    localStorage.setItem("orvix.reduceMotion", JSON.stringify(reduceMotion));
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);
  useLayoutEffect(() => {
    if (page !== "home") return;
    homeFollowingRef.current = true;
    setShowHomeJumpToLatest(false);
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [activeConversationId, mode, page]);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (page !== "home" || !viewport || !homeFollowingRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, page]);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (page !== "home" || !viewport || !messages.length) return;
    let previousTop = viewport.scrollTop;
    const updateFollowState = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distanceFromBottom <= 48) {
        homeFollowingRef.current = true;
        setShowHomeJumpToLatest(false);
      } else if (viewport.scrollTop < previousTop - 1) {
        homeFollowingRef.current = false;
        setShowHomeJumpToLatest(true);
      }
      previousTop = viewport.scrollTop;
    };
    viewport.addEventListener("scroll", updateFollowState, { passive: true });
    return () => viewport.removeEventListener("scroll", updateFollowState);
  }, [activeConversationId, mode, page, messages.length]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setProjectDialog(false); setMobileOpen(false); setEditingConversationId(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => () => { voiceCreateEpochRef.current++;screenEpochRef.current++;pendingScreenStreamRef.current?.getTracks().forEach(track=>track.stop());screenCaptureRef.current?.stop();const lease=screenProtectionRef.current;screenProtectionRef.current=null;if(lease)void window.orvixDesktop?.setPetCaptureExcluded(false,lease).catch(()=>{});if(voiceRef.current)window.orvixDesktop?.setVoiceRefresh(voiceRef.current.profile,false);voiceRef.current?.stop(); voiceRef.current = null; }, []);
  useEffect(() => {
    if (thinkingStarted === null) setThinkingElapsed(0);
  }, [thinkingStarted]);
  useVisibleInterval(() => {
    if (thinkingStarted !== null) setThinkingElapsed(Math.floor((Date.now() - thinkingStarted) / 1000));
  }, thinkingStarted === null ? null : 1000);

  const stopScreenSharing=()=>{
    const lease=screenProtectionRef.current;screenProtectionRef.current=null;
    if(lease)void window.orvixDesktop?.setPetCaptureExcluded(false,lease).catch(()=>{});
    setScreenFrame(null);
    pendingScreenStreamRef.current?.getTracks().forEach(track=>track.stop());pendingScreenStreamRef.current=null;
    screenEpochRef.current++;screenCaptureRef.current?.stop();screenCaptureRef.current=null;
    try{screenOwnerRef.current?.setScreenSharing(false);}catch{/* Connection already closed. */}screenOwnerRef.current=null;
    screenSharingNameRef.current='';screenPickerOpenRef.current=false;setScreenSharingName('');setScreenPickerOpen(false);void window.orvixDesktop?.selectScreenSource?.(null).catch(()=>{});
  };
  useEffect(()=>window.orvixDesktop?.onScreenCaptureStopped?.(()=>{stopScreenSharing();setScreenError('Screen sharing disconnected. Choose your screen again to restart.');}),[]);
  useEffect(()=>window.orvixDesktop?.onSessionState?.(({state})=>{if(['locked','suspended'].includes(state)){stopVoice();setScreenError(state==='locked'?'Windows locked. Sharing and voice stopped.':'PC suspended. Sharing and voice stopped.');}}),[]);
  const stopVoice = () => { voiceCreateEpochRef.current++;stopScreenSharing();setScreenError('');if(voiceRef.current)window.orvixDesktop?.setVoiceRefresh(voiceRef.current.profile,false);voiceRef.current?.stop(); voiceRef.current = null; voiceStartRef.current = null; voiceConversationRef.current = null; setThinkingStarted(null); setVoiceProgressText(""); setMicrophoneActive(false); setVoiceError(""); };
  useEffect(() => window.orvixDesktop?.onCompanionMemoryChanged(() => {
    stopVoice(); setMemoryNotice('Memory updated. Voice and screen sharing stopped so the next session uses fresh context.');
  }), []);
  useEffect(() => { if (memoryProjectId && !projects.some(project => project.id === memoryProjectId)) { stopVoice(); setMemoryProjectId(''); } }, [projects, memoryProjectId]);
  const navigate = (target: Page) => { if(target!=='home')stopScreenSharing();setPage(target); setMobileOpen(false); };
  const clearAgentNotificationTarget = useCallback((notificationId: string) => {
    setAgentNotificationTarget(current => current?.notificationId === notificationId ? null : current);
  }, []);
  useEffect(() => { if (page === "dashboard") setAgentPageVisited(true); }, [page]);
  const openWorkers = (id?: string | null) => { setTinySelectedId(id || null); setTinySelectionRequest(request => request + 1); navigate('tiny-agents'); };
  const newChat = () => { stopVoice(); setActiveConversationId(null); setInput(""); navigate("home"); requestAnimationFrame(() => homeInputRef.current?.focus()); };
  const useTool = (prompt: string) => { stopVoice(); if (prompt.startsWith("Use Chrome browser control")) setMode("Fast"); setActiveConversationId(null); setInput(prompt); navigate("home"); requestAnimationFrame(() => homeInputRef.current?.focus()); };
  const openConversation = (id: string) => {
    const conversation = conversations.find(item => item.id === id);
    if (!conversation) return;
    if (id !== voiceConversationRef.current) stopVoice();
    setActiveIds(current => ({ ...current, [conversation.profile]: id }));
    setMode(conversation.profile);
    setInput("");
    navigate("home");
  };
  const switchProfile = (profile: Mode) => { setMobileThinkingDepthOpen(false); if (profile === mode) return; stopVoice(); setMode(profile); setInput(""); setVoiceError(""); };
  const chooseThinkingDepth = (depth: ThinkingDepth) => {
    if (window.matchMedia("(max-width: 560px)").matches && depth === thinkingDepth) {
      setMobileThinkingDepthOpen(open => !open);
      return;
    }
    setThinkingDepth(depth);
    setMobileThinkingDepthOpen(false);
  };
  const startRename = (conversation: Conversation) => { setEditingConversationId(conversation.id); setEditingTitle(conversation.title); };
  const saveRename = (event: FormEvent, id: string) => {
    event.preventDefault();
    const title = editingTitle.trim();
    if (!title) return;
    setConversations(current => current.map(conversation => conversation.id === id ? { ...conversation, title, updatedAt: Date.now() } : conversation));
    setEditingConversationId(null);
  };
  const deleteConversation = (id: string) => {
    setConversations(current => current.filter(conversation => conversation.id !== id));
    if (activeConversationId === id) { stopVoice(); setActiveConversationId(null); setInput(""); }
    if (editingConversationId === id) setEditingConversationId(null);
  };
  const visibleConversations = conversations.filter(conversation => conversation.profile === mode && conversation.title.toLowerCase().includes(historySearch.trim().toLowerCase()));
  const upsertHomeMessage = (conversationId: string, profile: Mode, message: Message) => {
    if (message.role === "user") {
      homeFollowingRef.current = true;
      setShowHomeJumpToLatest(false);
    }
    setConversations(current => {
      const existing = current.find(conversation => conversation.id === conversationId);
      const existingMessages = existing?.messages ?? [];
      message = { ...message, createdAt: existingMessages.find(item => item.id === message.id)?.createdAt ?? Date.now() };
      let lastUserIndex = -1;
      for (let index = existingMessages.length - 1; index >= 0; index--) {
        if (existingMessages[index].role === "user") { lastUserIndex = index; break; }
      }
      const prior = profile === "Fast" && message.role === "assistant" && message.phase === "final"
        ? existingMessages.filter((item, index) => index <= lastUserIndex || item.phase !== "status")
        : existingMessages;
      const messages = prior.some(item => item.id === message.id) ? prior.map(item => item.id === message.id ? message : item) : [...prior, message];
      const updated: Conversation = {
        id: conversationId, profile,
        title: !existing || (existing.title === "Voice conversation" && message.role === "user") ? (message.role === "user" ? message.text.slice(0, 48) : "Voice conversation") : existing.title,
        messages,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      return [updated, ...current.filter(conversation => conversation.id !== conversationId)];
    });
  };
  const startVoice = async (microphone: boolean) => {
    if (voiceRef.current) {
      const existing = voiceRef.current;
      if (voiceStartRef.current) await voiceStartRef.current;
      if (voiceRef.current !== existing) throw new Error("Voice session was stopped.");
      setVoiceError("");
      if (microphone && !existing.hasMicrophone) await existing.enableMicrophone();
      if (voiceRef.current !== existing) throw new Error("Voice session was stopped.");
      return existing;
    }
    const createEpoch = ++voiceCreateEpochRef.current;
    const savedMemory = await window.orvixDesktop?.listCompanionMemories();
    if (createEpoch !== voiceCreateEpochRef.current) throw new Error('Voice session was stopped.');
    if (savedMemory?.error) throw new Error(savedMemory.error);
    const sessionMode = mode;
    const conversationId = activeConversationId ?? crypto.randomUUID();
    voiceConversationRef.current = conversationId;
    const history = conversations.find(conversation => conversation.id === conversationId)?.messages
      .filter(message =>
        canRestoreMemoryHistory(message.createdAt, savedMemory?.contextFloor ?? 0) &&
        message.phase !== "progress" && message.phase !== "status" &&
        !message.text.startsWith("I’ve saved your message in this local workspace preview.") &&
        !message.text.startsWith("Your request is captured in this workspace preview.")
      )
      .map(message => ({ role: message.role, delivery: message.delivery, text: message.role === "assistant" && isVoiceSystemError(message.text) ? failedTurnHistoryReply : message.text })) ?? [];
    let thoughtStartedAt: number | null = null;
    let lastThoughtSeconds: number | null = null;
    const finishThinking = () => {
      if (thoughtStartedAt !== null) {
        lastThoughtSeconds = Math.max(1, Math.ceil((Date.now() - thoughtStartedAt) / 1000));
        thoughtStartedAt = null;
      }
      setThinkingStarted(null);
    };
    const session = new VoiceSession(sessionMode, thinkingDepth, history, {
      onStatus: (status: VoiceStatus, detail?: string) => {
        if (voiceRef.current !== session) return;
        window.orvixDesktop?.setVoiceRefresh(sessionMode,!['off','error'].includes(status));
        if(['off','error','reconnecting','connecting'].includes(status))window.orvixDesktop?.updatePetOutput?.({text:'',speaking:false});
        setVoiceStatus(status);
        if (detail) setVoiceError(detail);
        if (status === "listening" || status === "off" || status === "error") setVoiceProgressText("");
        if(status==="reconnecting"&&screenProtectionRef.current){stopScreenSharing();setScreenError("Screen sharing disconnected. Choose your screen again after Orvix reconnects.");}
        if (status === "error") { stopScreenSharing();voiceRef.current = null; setMicrophoneActive(false); }
        if (status === "thinking" && thoughtStartedAt === null) { thoughtStartedAt = Date.now(); lastThoughtSeconds = null; setThinkingStarted(thoughtStartedAt); }
        else if (status === "listening") finishThinking();
        else if (status === "off" || status === "error" || status === "reconnecting") { thoughtStartedAt = null; setThinkingStarted(null); }
      },
      onTranscript: (entry: VoiceTranscript) => {
        if (voiceRef.current !== session) return;
        if(entry.role==='user')window.orvixDesktop?.updatePetOutput?.({text:'',speaking:false});
        if (entry.role === 'user' && isMemoryControl(entry.text)) return;
        if(entry.role==='user'&&entry.finalized){
          const command=screenSharingCommand(entry.text);
          if(command==='stop'||command==='start'&&!screenSharingNameRef.current){setConversations(current=>current.map(conversation=>({...conversation,messages:conversation.messages.filter(message=>message.id!==entry.id)})));return;}
        }
        if (entry.role === "user") lastThoughtSeconds = null;
        if (entry.role === "assistant" && entry.phase === "final") finishThinking();
        upsertHomeMessage(conversationId, sessionMode, { ...entry, mode: sessionMode, ...(entry.role === "assistant" && entry.phase === "final" && lastThoughtSeconds !== null ? { thoughtForSeconds: lastThoughtSeconds } : {}) });
        setActiveIds(current => ({ ...current, [sessionMode]: conversationId }));
      },
      onSpeechCaption: value=>{if(voiceRef.current===session)window.orvixDesktop?.updatePetOutput?.(value);},
      onProgress: (entry: VoiceProgress) => {
        if (voiceRef.current !== session) return;
        setVoiceProgressText(entry.text);
        upsertHomeMessage(conversationId, sessionMode, { id: entry.id, role: "assistant", text: entry.text, mode: sessionMode, phase: "status", progressPhase: entry.phase });
        setActiveIds(current => ({ ...current, [sessionMode]: conversationId }));
      },
      onScreenSharingCommand: (text:string) => handleScreenSharingCommand(text),
      onMemoryCommand: (text:string) => handleMemoryCommand(text),
    }, profile, memoryProjectId || undefined);
    voiceRef.current = session;
    window.orvixDesktop?.setVoiceRefresh(sessionMode,true);
    setVoiceError("");
    const starting = session.start(microphone);
    voiceStartRef.current = starting;
    try { await starting; if (voiceRef.current !== session) throw new Error("Voice session was stopped."); return session; }
    catch (error) { window.orvixDesktop?.setVoiceRefresh(sessionMode,false);if (voiceRef.current === session) voiceRef.current = null; throw error; }
    finally { if (voiceStartRef.current === starting) voiceStartRef.current = null; }
  };
  const toggleVoice = async () => {
    if (voiceRef.current && (voiceRef.current.hasMicrophone || voiceStatus === "connecting" || voiceStatus === "reconnecting")) { stopVoice(); return; }
    try { const session=await startVoice(true); if(voiceRef.current===session){setMicrophoneHealth(session.microphoneState);setMicrophoneActive(session.hasMicrophone);} }
    catch (error) { if (error instanceof Error && error.message === "Voice session was stopped.") return; setVoiceError(error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access and try again." : error instanceof Error ? error.message : "Voice could not start."); }
  };
  const startScreenSharing=async(source:ScreenSource)=>{
    const epoch=++screenEpochRef.current;let stream:MediaStream|undefined;setScreenError('');
    try{
      await window.orvixDesktop!.selectScreenSource(source.id);
      if(epoch!==screenEpochRef.current)return;
      const lease=await window.orvixDesktop!.setPetCaptureExcluded(true);
      if(!lease)throw new Error('The pet could not be excluded. Screen sharing has stopped.');
      if(epoch!==screenEpochRef.current){await window.orvixDesktop!.setPetCaptureExcluded(false,lease);return;}
      screenProtectionRef.current=lease;
      stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:5,max:5},width:{ideal:2560},height:{ideal:1440}},audio:false});
      if(epoch!==screenEpochRef.current){stream.getTracks().forEach(track=>track.stop());return;}
      pendingScreenStreamRef.current=stream;
      const owner=await startVoice(false);
      if(epoch!==screenEpochRef.current){stream.getTracks().forEach(track=>track.stop());return;}
      owner.setScreenSharing(true);screenOwnerRef.current=owner;
      const capture=new LiveScreenCapture(frame=>epoch===screenEpochRef.current&&voiceRef.current===owner&&owner.sendScreenFrame(frame),()=>stopScreenSharing(),message=>{stopScreenSharing();setScreenError(message);},frame=>{if(epoch===screenEpochRef.current)setScreenFrame(frame);},()=>window.orvixDesktop!.getScreenCaptureGuard(lease));
      screenCaptureRef.current=capture;await capture.start(stream);
      if(epoch!==screenEpochRef.current){capture.stop();return;}
      pendingScreenStreamRef.current=null;screenSharingNameRef.current=source.name;screenPickerOpenRef.current=false;setScreenSharingName(source.name);setScreenPickerOpen(false);
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(epoch!==screenEpochRef.current)return;stopScreenSharing();
      const message=error instanceof DOMException&&['NotAllowedError','AbortError'].includes(error.name)?'Screen sharing was cancelled or denied. Choose a screen to try again.':error instanceof Error?error.message:'Screen sharing could not start.';
      setScreenError(message);throw new Error(message);
    }
  };
  const handleScreenSharingCommand=(text:string)=>{
    const command=screenSharingCommand(text);if(!command)return false;
    if(command==='stop'){stopScreenSharing();return true;}
    if(screenSharingNameRef.current)return true;
    if(!isDesktop){setScreenError('Screen sharing requires the Orvix desktop app.');return true;}
    if(!screenPickerOpenRef.current){setScreenError('');screenPickerOpenRef.current=true;setScreenPickerOpen(true);}
    return true;
  };
  const toggleScreenSharing=()=>{if(screenSharingName||screenPickerOpen){stopScreenSharing();return;}setScreenError('');screenPickerOpenRef.current=true;setScreenPickerOpen(true);};
  const renderScreenShareButton = (placement: "compact" | "wide") => <button className={`simple-screen-button screen-share-${placement}${screenSharingName?' is-sharing':''}`} disabled={!isDesktop} aria-label={screenSharingName?'Stop screen sharing':screenPickerOpen?'Close screen chooser':'Share your screen with Orvix'} aria-pressed={!!screenSharingName} aria-expanded={screenPickerOpen} title={screenSharingName?`Sharing ${screenSharingName} · Click to stop`:screenPickerOpen?'Close the screen chooser':isDesktop?'Let Orvix see your screen':'Screen sharing requires the desktop app'} onClick={toggleScreenSharing}><Eye size={23} strokeWidth={1.6}/>{screenSharingName&&<span className="screen-live-dot"/>}</button>;
  const handleMemoryCommand = (text: string) => {
    const command = memoryCommand(text);
    if (!command) { if (isMemoryControl(text)) { stopVoice(); setMemoryNotice('Use “remember this: …” with the exact note, or choose a memory in Settings.'); return true; } return false; }
    if (!window.orvixDesktop) { setMemoryNotice('Persistent memory requires the desktop app.'); return true; }
    if (memoryCommandBusyRef.current) { setMemoryNotice('Wait for the current memory change to finish.'); return true; }
    const sourceConversation = voiceConversationRef.current || activeConversationId;
    stopVoice();
    if (command.action === 'show') { navigate('settings'); setMemoryNotice('Your saved memories are in Settings.'); return true; }
    if (!command.text) { setMemoryNotice(command.action === 'remember' ? 'Please specify what to remember, for example “remember this: I prefer short replies”.' : 'Please specify the note to forget, or select it in Settings.'); return true; }
    memoryCommandBusyRef.current = true;
    setMemoryNotice('Updating memory…');
    void (async () => {
      try {
        const bridge = window.orvixDesktop!;
        if (command.action === 'remember') {
          await bridge.saveCompanionMemory({ text: command.text, kind: memoryKind(command.text),
            scope: memoryProjectId ? 'project' : 'personal', projectId: memoryProjectId || null,
            source: { type: 'user_message', conversationId: sourceConversation, messageId: crypto.randomUUID(), profile: mode } });
          setMemoryNotice('Memory saved on this device. Start voice again when ready.');
        } else {
          const snapshot = await bridge.listCompanionMemories(); if (snapshot.error) throw Error(snapshot.error);
          const matches = matchMemoryToForget(snapshot.records, command.text);
          if (matches.length !== 1) { navigate('settings'); setMemoryNotice(matches.length ? 'Several notes match. Choose the note to forget in Settings.' : 'No matching memory found. Review your saved notes in Settings.'); return; }
          await bridge.forgetCompanionMemory(matches[0].id);
          setMemoryNotice('Memory forgotten. Earlier chats remain visible but will not be automatically restored.');
        }
      } catch (failure) { setMemoryNotice(failure instanceof Error ? failure.message : 'Memory could not be changed.'); }
      finally { memoryCommandBusyRef.current = false; }
    })();
    return true;
  };
  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if(handleMemoryCommand(text)){setInput('');return;}
    if(handleScreenSharingCommand(text)){setInput('');return;}
    try {
      const session = await startVoice(false);
      session.sendText(text);
      const conversationId = voiceConversationRef.current!;
      if (mode !== "Fast") upsertHomeMessage(conversationId, mode, { id: crypto.randomUUID(), role: "user", text, mode });
      setActiveConversationId(conversationId);
      setInput("");
    } catch (error) { if (error instanceof Error && error.message === "Voice session was stopped.") return; setVoiceError(error instanceof Error ? error.message : "Message could not be sent."); }
  };
  const createProject = (event: FormEvent) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setProjects(current => [{ id: crypto.randomUUID(), name, createdAt: Date.now() }, ...current]);
    setProjectName(""); setProjectDialog(false); navigate("dashboard");
  };
  const titleAction = async (action: "minimize" | "maximize" | "close") => {
    if (action === "minimize") await window.orvixDesktop?.minimize();
    if (action === "maximize") setMaximized(await window.orvixDesktop!.toggleMaximize());
    if (action === "close") await window.orvixDesktop?.close();
  };

  const navButton = (id: Page, label: string, icon: typeof House, extra?: ReactNode, child = false) => {
    const Icon = icon;
    return <button key={id} className={`nav-item${page === id ? " active" : ""}${child ? " nav-child" : ""}`} onClick={() => navigate(id)} aria-current={page === id ? "page" : undefined} title={sidebarCollapsed ? label : undefined}>
      <Icon size={18} strokeWidth={1.85} aria-hidden="true" />
      <span className="nav-label">{label}</span>{extra}
    </button>;
  };

  const renderSimplePrompt = () => <div className="simple-composer-wrap">
    {memoryNotice && <p role="status" className="memory-chat-notice">{memoryNotice}</p>}
    {screenSharingName&&<div className="screen-sharing-status" role="status"><span className="screen-live-indicator"/><span>Sharing <strong>{screenSharingName}</strong></span><button onClick={stopScreenSharing}>Stop sharing</button></div>}
    <div className="simple-composer-main">
      <div className="simple-composer">
        <input className="home-prompt-input" ref={homeInputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} placeholder={mode === "Fast" ? "Ask Orvix Fast" : "Ask Orvix Thinking"} aria-label="Ask Orvix" />
        {input.trim() && <button className="simple-send" aria-label="Send message" title="Send message" onClick={() => void send()}><ArrowUp size={19} /></button>}
        <button className={`simple-mic${listening ? " listening" : ""}${voicePending?' is-connecting':''}${microphoneIssue?' is-unavailable':''}`} disabled={!isDesktop||microphoneHealth==='starting'} aria-label={voicePending?'Cancel voice connection':microphoneHealth==='error'?'Retry microphone':listening ? "Stop voice conversation" : "Enable microphone"} aria-pressed={listening} title={isDesktop ? voicePending?'Connecting · click to cancel':microphoneHealth==='error'?'Microphone unavailable · click to retry':listening ? "Microphone active · click to stop" : "Enable microphone" : "Voice requires the desktop app"} onClick={() => void toggleVoice()}>{voicePending?<LoaderCircle size={19}/>:microphoneIssue?<MicOff size={19}/>:listening ? <Square size={15} fill="currentColor" /> : <Mic size={19} />}</button>
      </div>
      {renderScreenShareButton("wide")}
    </div>
    {screenError&&<div className="simple-voice-status is-error" role="alert">{screenError}</div>}
    {(voiceError || voiceStatus !== "off") && <div className={`simple-voice-status${voiceError||microphoneIssue ? " is-error" : ""}`} role="status"><span className={`voice-state-dot${listening&&voiceConnected?' is-live':''}`} aria-hidden="true"/>{voiceError || voiceIndicator}</div>}
  </div>;

  return <div className="app-shell">
    {screenPickerOpen&&<ScreenSourcePicker onSelect={startScreenSharing} onClose={stopScreenSharing}/>}
    <header className="titlebar">
      <div className="titlebar-left">
        <button className="icon-button title-menu" aria-label={sidebarCollapsed ? "Expand navigation" : "Toggle navigation"} onClick={() => window.innerWidth <= 750 ? setMobileOpen(true) : setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <Menu size={17} />}</button>
        <BrandMark small active={page === "home" && (voiceStatus === "responding" || voiceStatus === "thinking")} /><span className="title-name">ORVIX</span><span className="title-divider" /><span className="title-section">{pageTitles[page]}</span>
        {page === 'dashboard' && <AgentServerStatusPill status={agentServerStatus} />}
        {page === 'dashboard' && <AntigravityServerStatusPill status={antigravityServerStatus} onStatusChange={setAntigravityServerStatus} />}
      </div>
      <div className="titlebar-center"><span>YOUR SPACE TO THINK BIGGER</span></div>
      <div className="titlebar-right">
        {isDesktop && <TinyExecutionIndicator onOpen={()=>navigate('tiny-agents')}/>}
        {isDesktop && <NotificationInbox onOpenRule={openWorkers} onOpenAgentTask={openAgentNotification} />}
        {isDesktop && <FastActionReview />}
        {!historyOpen && page === "home" && <button className="icon-button history-reopen" aria-label="Show chat history" title="Show chat history" onClick={() => setHistoryOpen(true)}><PanelRightOpen size={17} /></button>}
        {isDesktop && <div className="window-controls">
          <button aria-label="Minimize window" onClick={() => void titleAction("minimize")}><Minus size={14} /></button>
          <button aria-label={maximized ? "Restore window" : "Maximize window"} onClick={() => void titleAction("maximize")}><Square size={11} /></button>
          <button className="close-control" aria-label="Close window" onClick={() => void titleAction("close")}><X size={15} /></button>
        </div>}
      </div>
    </header>

    <div className="workspace">
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
        <nav className="sidebar-scroll" aria-label="Main navigation">
          <div className="nav-group">{mainItems.map(item => navButton(item.id, item.label, item.icon))}</div>
          <div className="nav-divider" />
          <div className="nav-group">
            <button className={`nav-item folder-parent${["folders", "recent", "favorites", "shared"].includes(page) ? " parent-active" : ""}`} onClick={() => setFoldersOpen(!foldersOpen)} aria-expanded={foldersOpen} title={sidebarCollapsed ? "Folders" : undefined}><Folder size={18} strokeWidth={1.85} /><span className="nav-label">Folders</span><ChevronDown className={`folder-chevron${foldersOpen ? " open" : ""}`} size={15} /></button>
            {foldersOpen && <div className="folder-children">{folderItems.map(item => navButton(item.id, item.label, item.icon, <span className="count-badge">{organizationCount(item.id, projects, conversations)}</span>, true))}</div>}
          </div>
          <div className="nav-divider" />
          <div className="nav-group">{utilityItems.map(item => navButton(item.id, item.label, item.icon, item.id === "support" ? <span className="online-badge"><i />Online</span> : undefined))}</div>
          <a className="nav-item external-nav" href="https://www.untitledui.com/" target="_blank" rel="noopener noreferrer" title={sidebarCollapsed ? "Open in browser" : undefined}><ExternalLink size={18} strokeWidth={1.85} /><span className="nav-label">Open in browser</span><ExternalLink className="external-trailing" size={14} /></a>
        </nav>
        <div className="sidebar-footer">
          <div className="profile-wrap">
            {screenSharingName&&<div className="sidebar-screen-preview"><ScreenSharePreview frame={screenFrame} sourceName={screenSharingName}/></div>}
            <button className={`profile-button${page === "profile" ? " active" : ""}`} onClick={() => navigate("profile")} aria-current={page === "profile" ? "page" : undefined} aria-label="Open profile"><span className="avatar">{profile.avatar ? <img src={profile.avatar} alt="" /> : profileInitials(profileLabel)}</span><span className="profile-copy"><strong>{profileLabel || "Your workspace"}</strong>{profile.email && <span>{profile.email}</span>}</span><ArrowRight size={15} /></button>
          </div>
        </div>
      </aside>

      <main className={`main-canvas${page === "home" ? " home-main-canvas" : page === "dashboard" ? " agent-main-canvas" : ""}`}>
        {agentPageVisited && <RenderErrorBoundary scope="Agent" compact><Suspense fallback={<div role="status" style={{ display: "grid", placeItems: "center", minHeight: "100%", color: "#aaa" }}>Loading Agent…</div>}><PersistentAgentPage visible={page === "dashboard"} onWorkflow={openWorkers} notificationTarget={agentNotificationTarget} onNotificationHandled={clearAgentNotificationTarget} onServerStatus={publishAgentServerStatus} /></Suspense></RenderErrorBoundary>}
        {page !== 'home' && memoryNotice && <p className="memory-chat-notice" role="status">{memoryNotice}</p>}
        {page !== "home" && voiceStatus !== "off" && voiceStatus !== "error" && <div className="persistent-voice-bar" role="status">
          {listening?<Mic size={16} aria-hidden="true"/>:<MicOff size={16} aria-hidden="true"/>}
          <span>{mode} voice · {voiceIndicator}</span>
          <button type="button" onClick={() => navigate("home")}>Return to chat</button>
          <button type="button" onClick={stopVoice} aria-label="Stop voice conversation"><Square size={13} aria-hidden="true" /> Stop</button>
        </div>}
        {page === "home" ? <div className={`home-view search-keys-home${mode === "Thinking" ? " thinking-mode" : ""}${messages.length ? " has-conversation" : ""}`} onClick={event => { if (!(event.target as Element).closest(".thinking-depth")) setMobileThinkingDepthOpen(false); }}>
          <div className="home-top">
            {voiceConnected && <HaloVisualizer session={voiceRef.current} reducedMotion={reduceMotion} />}
            <div className="mode-switch" role="group" aria-label="Home profile">
              <button className={mode === "Fast" ? "selected" : ""} onClick={() => switchProfile("Fast")} aria-pressed={mode === "Fast"}>Fast</button>
              <button className={mode === "Thinking" ? "selected" : ""} onClick={() => switchProfile("Thinking")} aria-pressed={mode === "Thinking"}>Thinking</button>
            </div>
            <SearchKeysPanel />
            {renderScreenShareButton("compact")}
            {mode === "Thinking" && <div className="thinking-depth" role="group" aria-label="Thinking depth">
              <span className="thinking-depth-label">Depth</span>
              <div className={`thinking-depth-options${mobileThinkingDepthOpen ? " mobile-open" : ""}`}>
                {(["LOW", "MEDIUM", "HIGH"] as const).map(depth => <button key={depth} type="button" className={thinkingDepth === depth ? "selected" : ""} aria-pressed={thinkingDepth === depth} aria-expanded={thinkingDepth === depth ? mobileThinkingDepthOpen : undefined} aria-label={`${depth.toLowerCase()} thinking depth`} disabled={voiceStatus !== "off" && voiceStatus !== "error"} onClick={() => chooseThinkingDepth(depth)}>
                  {depth === "MEDIUM" ? "Medium" : depth === "LOW" ? "Low" : "High"}
                  {thinkingDepth === depth && <ChevronDown className="mobile-depth-chevron" size={11} aria-hidden="true" />}
                </button>)}
              </div>
            </div>}
          </div>
          {(tinyDraftCount > 0 || tinyShutdownEndsAt) && <div className="tiny-home-banner"><Sparkles size={15} /><span>{tinyShutdownEndsAt ? 'A tiny agent started a shutdown countdown.' : `${tinyDraftCount} tiny agent${tinyDraftCount === 1 ? '' : 's'} ready for review.`}</span><button onClick={() => navigate("tiny-agents")}>{tinyShutdownEndsAt ? 'Cancel or view' : 'Review'} <ArrowRight size={14} /></button></div>}
          {messages.length === 0 ? <div className="hero-center">
            <h1>What's the vibe, {greetingName}?</h1>
            {renderSimplePrompt()}
          </div> : <div className="conversation-layout"><div className="conversation-scroll" ref={scrollRef}><div className="conversation-inner"><div className="home-thread-heading"><span className={`home-thread-mode ${mode.toLowerCase()}`}>{mode} chat</span><strong>{activeConversation?.title}</strong></div>{messagesForDisplay(messages).map(message => <MessageItem message={message} key={message.id} />)}</div></div>{showHomeJumpToLatest && <button type="button" className="home-jump-latest" onClick={() => { homeFollowingRef.current = true; setShowHomeJumpToLatest(false); const viewport = scrollRef.current; if (viewport) viewport.scrollTop = viewport.scrollHeight; }}><ArrowDown size={15} /> Jump to latest</button>}<div className="conversation-composer">{renderSimplePrompt()}</div></div>}
        </div> : page === "dashboard" ? null : page === "tiny-agents" ? <section className="page-view tiny-page-view"><Suspense fallback={<div role="status">Loading Tiny Agents…</div>}><TinyAgentsPage initialRuleId={tinySelectedId} selectionRequest={tinySelectionRequest} onWorld={() => navigate("support")} /></Suspense></section> : page === "tools" ? <section className="page-view"><div className="page-content tools-page-content"><Suspense fallback={<div role="status">Loading Tools…</div>}><ToolsPage onUseTool={useTool} /></Suspense></div></section> : page === "profile" ? <section className="page-view"><div className="page-content"><ProfilePage profile={profile} conversations={conversations} projectCount={projects.length} onSave={setProfile} /></div></section> : <section className="page-view"><div className="page-content">{renderPage(page, projects, conversations, reduceMotion, setReduceMotion, () => setProjectDialog(true), navigate, openWorkers, openConversation)}</div></section>}
      </main>
      <aside className={`history-panel history-${mode.toLowerCase()}${historyOpen && page === "home" ? "" : " history-is-closed"}`} aria-label={`${mode} chat history`} aria-hidden={!historyOpen || page !== "home"} inert={!historyOpen || page !== "home"}>
        <div className="history-header"><div className="history-heading"><MessageCircle size={17} strokeWidth={1.85} /><strong>Chat history</strong><span className="history-mode-badge">{mode}</span></div><button className="icon-button history-toggle" aria-label="Hide chat history" title="Hide chat history" onClick={() => setHistoryOpen(false)}><PanelRightClose size={17} /></button></div>
        <label className="sidebar-search history-search"><Search size={15} strokeWidth={1.85} /><input value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Search chats" aria-label="Search chats" /></label>
        <nav className="history-list" aria-label={`${mode} saved conversations`}>
          <div className="history-label">{mode} chats <span>{visibleConversations.length}</span></div>
          {visibleConversations.length ? visibleConversations.map(conversation => <div className={`history-entry${editingConversationId === conversation.id ? " is-editing" : ""}`} key={conversation.id}>
            {editingConversationId === conversation.id ? <form className="history-rename" onSubmit={event => saveRename(event, conversation.id)}><input autoFocus maxLength={80} aria-label="Chat name" value={editingTitle} onChange={event => setEditingTitle(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setEditingConversationId(null); } }} /><button type="submit" disabled={!editingTitle.trim()} aria-label="Save chat name" title="Save name"><Check size={15} /></button></form> : <>
              <button className={`nav-item history-item${conversation.id === activeConversationId && page === "home" ? " active" : ""}`} onClick={() => openConversation(conversation.id)} aria-current={conversation.id === activeConversationId && page === "home" ? "page" : undefined} aria-label={`${conversation.title}, ${mode} chat${conversation.id === activeConversationId && page === "home" ? ", currently open" : ""}`} title={`${conversation.title}\n${mode} chat\nCreated ${formatChatTime(conversation.createdAt ?? conversation.updatedAt)}\nUpdated ${formatChatTime(conversation.updatedAt)}`}><MessageCircle size={16} strokeWidth={1.85} /><span className="history-item-copy"><span className="nav-label">{conversation.title}</span>{conversation.id === activeConversationId && page === "home" && <span className="history-open-label">Currently open</span>}</span></button>
              <div className="history-actions"><button aria-label={`Rename ${conversation.title}`} title="Rename chat" onClick={() => startRename(conversation)}><Pencil size={13} /></button><button aria-label={`Delete ${conversation.title}`} title="Delete chat" onClick={() => deleteConversation(conversation.id)}><Trash2 size={13} /></button></div>
            </>}
            <div className="history-details"><strong>{conversation.title}</strong><span>Created {formatChatTime(conversation.createdAt ?? conversation.updatedAt)}</span><span>Updated {formatChatTime(conversation.updatedAt)}</span></div>
          </div>) : <div className="history-empty">{historySearch ? "No matching chats" : "Your chats will appear here"}</div>}
        </nav>
        <div className="history-footer"><button className="nav-item history-new" onClick={newChat}><Plus size={16} strokeWidth={1.85} /><span className="nav-label">New chat</span></button></div>
      </aside>
    </div>

    {projectDialog && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectDialog(false); }}><form className="project-dialog" onSubmit={createProject}><div className="dialog-icon"><FolderPlus size={22} /></div><button className="dialog-close icon-button" type="button" aria-label="Close dialog" onClick={() => setProjectDialog(false)}><X size={18} /></button><h2>Create a project</h2><p>Give your ideas a place to grow. Projects are stored on this device.</p><label htmlFor="project-name">Project name</label><input id="project-name" autoFocus maxLength={60} placeholder="e.g. Product launch" value={projectName} onChange={event => setProjectName(event.target.value)} /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setProjectDialog(false)}>Cancel</button><button type="submit" className="primary-button" disabled={!projectName.trim()}>Create project <ArrowRight size={15} /></button></div></form></div>}
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="page-eyebrow"><span />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function ProfilePage({ profile, conversations, projectCount, onSave }: { profile: UserProfile; conversations: Conversation[]; projectCount: number; onSave: (value: UserProfile) => void }) {
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(profile); }, [profile]);
  const update = (field: keyof UserProfile, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setNotice(null);
    setConfirmReset(false);
  };
  const fields = Object.keys(emptyProfile) as (keyof UserProfile)[];
  const dirty = fields.some(field => draft[field] !== profile[field]);
  const filled = fields.filter(field => draft[field].trim()).length;
  const promptCount = conversations.reduce((total, conversation) => total + conversation.messages.filter(message => message.role === "user").length, 0);
  const latestActivity = conversations.length ? Math.max(...conversations.map(conversation => conversation.updatedAt)) : null;
  const displayLabel = draft.displayName.trim() || draft.name.trim();

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const clean = normalizeProfile(draft);
    onSave(clean);
    setDraft(clean);
    setNotice({ text: "Profile saved on this device." });
  };
  const uploadPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/image\/(png|jpeg|webp)/.test(file.type) || file.size > 5_000_000) {
      setNotice({ text: "Choose a PNG, JPG, or WebP image under 5 MB.", error: true });
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image processing unavailable");
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
        update("avatar", canvas.toDataURL("image/webp", .84));
        setNotice({ text: "Photo ready. Save changes to keep it." });
      } catch {
        setNotice({ text: "The photo could not be added.", error: true });
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(url); setNotice({ text: "The photo could not be opened.", error: true }); };
    image.src = url;
  };
  const exportProfile = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "orvix-profile.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ text: "Saved profile exported." });
  };
  const importProfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) { setNotice({ text: "Profile files must be under 1 MB.", error: true }); return; }
    try {
      const imported = normalizeProfile(JSON.parse(await file.text()));
      if (!imported.name) throw new Error("Missing name");
      setDraft(imported);
      setConfirmReset(false);
      setNotice({ text: "Profile loaded. Review it and save changes." });
    } catch {
      setNotice({ text: "This is not a valid Orvix profile file.", error: true });
    }
  };
  const resetProfile = () => {
    onSave({ ...emptyProfile });
    setDraft({ ...emptyProfile });
    setConfirmReset(false);
    setNotice({ text: "Profile details cleared from this device." });
  };

  return <>
    <PageHeader eyebrow="IDENTITY" title="Your profile" description="Keep your personal details and workspace identity in one place. Everything here stays on this device." />
    <div className="profile-page-card">
      <div className="profile-page-intro">
        <span className="profile-page-avatar" aria-hidden="true">{draft.avatar ? <img src={draft.avatar} alt="" /> : profileInitials(displayLabel)}</span>
        <div className="profile-intro-copy"><span className="profile-local-badge">LOCAL PROFILE</span><h2>{displayLabel || "Your identity"}</h2><p>{[draft.occupation, draft.company].filter(Boolean).join(" · ") || draft.email || "Add your details to personalize this workspace"}</p></div>
        <div className="profile-photo-actions"><input ref={photoRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadPhoto} /><button type="button" className="profile-quiet-button" onClick={() => photoRef.current?.click()}><Camera size={15} /> {draft.avatar ? "Change photo" : "Add photo"}</button>{draft.avatar && <button type="button" className="profile-quiet-button" onClick={() => update("avatar", "")}>Remove</button>}</div>
      </div>
      <div className="profile-overview">
        <div className="profile-progress"><div><strong>Profile details</strong><span>{filled} of {fields.length} added</span></div><div className="profile-progress-track"><span style={{ width: `${filled / fields.length * 100}%` }} /></div><p>These details help make your local workspace feel like yours.</p></div>
        <div className="profile-activity"><div><strong>{conversations.length}</strong><span>Chats</span></div><div><strong>{projectCount}</strong><span>Projects</span></div><div><strong>{promptCount}</strong><span>Prompts</span></div></div>
      </div>
      <form className="profile-form" onSubmit={save}>
        <div className="profile-section-heading"><h3>Identity</h3><p>How your name appears around Orvix.</p></div>
        <div className="profile-field"><label htmlFor="profile-name">Full name <span>*</span></label><input id="profile-name" autoComplete="name" required maxLength={80} value={draft.name} onChange={event => update("name", event.target.value)} placeholder="Your full name" /></div>
        <div className="profile-field"><label htmlFor="profile-display-name">Display name</label><input id="profile-display-name" maxLength={80} value={draft.displayName} onChange={event => update("displayName", event.target.value)} placeholder="Name shown in the sidebar and greeting" /></div>
        <div className="profile-section-heading"><h3>Contact</h3><p>Private reference details for your profile.</p></div>
        <div className="profile-field"><label htmlFor="profile-email">Email address</label><input id="profile-email" type="email" autoComplete="email" maxLength={160} value={draft.email} onChange={event => update("email", event.target.value)} placeholder="you@example.com" /></div>
        <div className="profile-field"><label htmlFor="profile-phone">Phone number</label><input id="profile-phone" type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={event => update("phone", event.target.value)} placeholder="Optional" /></div>
        <div className="profile-field"><label htmlFor="profile-location">Location</label><input id="profile-location" autoComplete="address-level2" maxLength={100} value={draft.location} onChange={event => update("location", event.target.value)} placeholder="City, country" /></div>
        <div className="profile-field"><label htmlFor="profile-website">Website</label><input id="profile-website" type="url" autoComplete="url" maxLength={160} value={draft.website} onChange={event => update("website", event.target.value)} placeholder="https://your-site.com" /></div>
        <div className="profile-section-heading"><h3>Work and interests</h3><p>A little context about what you do and care about.</p></div>
        <div className="profile-field"><label htmlFor="profile-occupation">Role or occupation</label><input id="profile-occupation" autoComplete="organization-title" maxLength={100} value={draft.occupation} onChange={event => update("occupation", event.target.value)} placeholder="Designer, developer, founder..." /></div>
        <div className="profile-field"><label htmlFor="profile-company">Organization</label><input id="profile-company" autoComplete="organization" maxLength={100} value={draft.company} onChange={event => update("company", event.target.value)} placeholder="Company or team" /></div>
        <div className="profile-field full"><label htmlFor="profile-interests">Skills and interests</label><input id="profile-interests" maxLength={250} value={draft.interests} onChange={event => update("interests", event.target.value)} placeholder="e.g. Product design, research, writing" /><small>Separate items with commas.</small></div>
        <div className="profile-field full"><label htmlFor="profile-bio">About you</label><textarea id="profile-bio" maxLength={500} value={draft.bio} onChange={event => update("bio", event.target.value)} placeholder="What are you working on? What should your workspace reflect?" /><small>{draft.bio.length}/500</small></div>
        <div className="profile-section-heading"><h3>Preferences</h3><p>Useful context for dates and future personalization.</p></div>
        <div className="profile-field"><label htmlFor="profile-timezone">Time zone</label><input id="profile-timezone" maxLength={100} value={draft.timezone} onChange={event => update("timezone", event.target.value)} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || "e.g. Asia/Dhaka"} /><small>Device time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown"}</small></div>
        <div className="profile-field"><label htmlFor="profile-language">Preferred language</label><input id="profile-language" maxLength={80} value={draft.language} onChange={event => update("language", event.target.value)} placeholder="e.g. English" /></div>
        <div className="profile-form-actions"><span className={`profile-save-status${notice?.error ? " is-error" : ""}`} aria-live="polite">{notice?.text || ""}</span><button type="button" className="secondary-button" disabled={!dirty} onClick={() => { setDraft(profile); setNotice(null); }}>Discard</button><button type="submit" className="primary-button" disabled={!dirty || !draft.name.trim()}><Check size={15} /> Save changes</button></div>
      </form>
      <div className="profile-data-panel"><div><h3>Your profile data</h3><p>Stored locally in Orvix. Export a copy or load one you saved earlier.</p>{latestActivity && <span>Last chat activity: {formatChatTime(latestActivity)}</span>}</div><div className="profile-data-actions"><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importProfile} /><button type="button" className="profile-quiet-button" onClick={exportProfile}><Download size={15} /> Export</button><button type="button" className="profile-quiet-button" onClick={() => importRef.current?.click()}><Upload size={15} /> Import</button></div></div>
      <div className="profile-reset-row">{confirmReset ? <><span>Clear all saved profile details and your photo?</span><button type="button" className="profile-quiet-button" onClick={() => setConfirmReset(false)}>Cancel</button><button type="button" className="profile-danger-button" onClick={resetProfile}>Clear profile</button></> : <button type="button" className="profile-danger-link" onClick={() => setConfirmReset(true)}>Clear profile details</button>}</div>
    </div>
  </>;
}

function EmptyPanel({ icon, title, description, action }: { icon: typeof House; title: string; description: string; action?: ReactNode }) {
  const Icon = icon;
  return <div className="empty-panel"><div className="empty-icon"><Icon size={22} /></div><h2>{title}</h2><p>{description}</p>{action}</div>;
}

function renderPage(page: Page, projects: Project[], conversations: Conversation[], reduceMotion: boolean, setReduceMotion: (value: boolean) => void, openProjectDialog: () => void, navigate: (page: Page) => void, openWorkers: (id?: string) => void, openConversation: (id: string) => void): ReactNode {
  const promptCount = conversations.reduce((total, conversation) => total + conversation.messages.filter(message => message.role === "user").length, 0);
  if (["folders", "recent", "favorites", "shared"].includes(page)) {
    const selectedPage = page as OrganizationPage;
    const titles: Record<OrganizationPage, [string, string]> = { folders: ["All folders", "A place for everything you're working on."], recent: ["Recent", "Find your latest ideas and work."], favorites: ["Favorites", "The things you return to most."], shared: ["Shared", "Keep collaborative work within reach."] };
    const [title, description] = titles[selectedPage];
    const recentConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    let contents: ReactNode;
    if (selectedPage === "folders" && projects.length) {
      contents = <div className="organized-list" aria-label="Projects">{projects.map(project => <article className="organized-item" key={project.id}><span className="organized-item-icon"><Folder size={17}/></span><span className="organized-item-copy"><strong>{project.name}</strong><small>Created {new Date(project.createdAt).toLocaleDateString()}</small></span></article>)}</div>;
    } else if (selectedPage === "recent" && recentConversations.length) {
      contents = <div className="organized-list" aria-label="Recent conversations">{recentConversations.map(conversation => {
        const lastMessage = conversation.messages.at(-1);
        return <button type="button" className="organized-item organized-chat" key={conversation.id} onClick={() => openConversation(conversation.id)}><span className="organized-item-icon"><MessageCircle size={17}/></span><span className="organized-item-copy"><strong>{conversation.title}</strong><small>{lastMessage?.text.trim() || "No message text"}</small></span><span className={`organized-mode ${conversation.profile.toLowerCase()}`}>{conversation.profile}</span><time>{formatChatTime(conversation.updatedAt)}</time></button>;
      })}</div>;
    } else {
      const emptyTitle = selectedPage === "folders" ? "Make room for your ideas" : selectedPage === "recent" ? "No recent chats yet" : `Nothing in ${title.toLowerCase()} yet`;
      const emptyDescription = selectedPage === "folders" ? "Create a project to start organizing your workspace." : selectedPage === "recent" ? "Your conversations will appear here after you start chatting." : selectedPage === "favorites" ? "Favorites aren’t tracked in this workspace yet." : "Shared items aren’t tracked in this workspace yet.";
      contents = <EmptyPanel icon={selectedPage === "favorites" ? Star : selectedPage === "shared" ? UsersRound : selectedPage === "recent" ? Clock3 : Folder} title={emptyTitle} description={emptyDescription} action={selectedPage === "folders" ? <button className="primary-button" onClick={openProjectDialog}><Plus size={16} /> Create a project</button> : undefined} />;
    }
    return <><PageHeader eyebrow="ORGANIZE" title={title} description={description} /><div className="folder-view-tabs">{folderItems.map(item => <button key={item.id} className={selectedPage === item.id ? "selected" : ""} onClick={() => navigate(item.id)}>{item.label}<span>{organizationCount(item.id, projects, conversations)}</span></button>)}</div>{contents}</>;
  }
  if (page === "reporting") return <><PageHeader eyebrow="INSIGHTS" title="Reporting" description="A simple snapshot of activity in this local workspace." /><div className="report-panel"><div className="report-head"><div><span className="report-icon"><PieChart size={20} /></span><h2>Workspace activity</h2><p>Your activity is stored locally on this device.</p></div><span className="report-period">All time</span></div><div className="report-numbers"><div><span>Prompts sent</span><strong>{promptCount}</strong></div><div><span>Projects created</span><strong>{projects.length}</strong></div><div><span>Conversations</span><strong>{conversations.length}</strong></div></div><div className="report-bar"><span style={{ width: `${Math.min(100, Math.max(5, promptCount * 12))}%` }} /></div><p className="report-footnote">Keep building. Your workspace story is just getting started.</p></div></>;
  if (page === "settings") return <SettingsPage projects={projects} reduceMotion={reduceMotion} setReduceMotion={setReduceMotion} />;
  if (page === "support") return <Suspense fallback={<div role="status" style={{ padding: '40px', color: '#afc4aa' }}>Opening Haven Island…</div>}><IslandVillageDemo reducedMotion={reduceMotion} onManageWorkers={openWorkers} /></Suspense>;
  return null;
}

export default App;

