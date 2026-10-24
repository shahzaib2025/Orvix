import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, Clock3, Compass, Folder, KeyRound, ListOrdered, Play,
  CornerDownRight, Ellipsis, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Pin, PinOff, Plus, RotateCcw, Sparkles, Square, Trash2, X, ChevronRight, FileCode2,
} from "lucide-react";
import { GO_MODELS, thinkingLabel, thinkingVariantsFor as defaultThinkingVariantsFor } from "./openCodeModels";
import { useOpenCodeModels } from './useOpenCodeModels';
import routewayCatalog from '../../shared/routeway-models.json';
import requestyCatalog from '../../shared/requesty-models.json';
import inceptionCatalog from '../../shared/inception-models.json';
import AgentChanges from "./AgentChanges";
import AgentRenameReview from "./AgentRenameReview";
import AgentApprovalDialog from "./AgentApprovalDialog";
import KiloModelMenu from './KiloModelMenu';
import { useKiloModels } from './useKiloModels';
import IoModelMenu from './IoModelMenu';
import { useIoModels } from './useIoModels';
import type { Change, DesignOptionsViewer } from "./AgentChanges";
import AgentClarification from "./AgentClarification";
import type { AgentApprovalRequest, AgentTaskMemory, AgentTurnReport, AgentVerification, AgentRunState, AgentRunResult, AgentServerIndicator, NotificationOpenTarget, AgentApiKeyMutation } from "../desktop";
import { AgentActivityTimeline, AgentTurnStatus } from "./AgentActivityTimeline";
import type { AgentActivityItem, AgentProgressActivity, AgentToolActivity, AgentSteerActivity } from "./AgentActivityTimeline";
import { isApiKeyCheck, redactApiKeys } from "./agentSecrets";
import { resolveAgentServerState } from '../agentServerStatus';
import AgentReport from "./AgentReport";
import { ReplyActions, UserMessageCopy } from "./AgentMessageCopy";
import type { DesignOptionsPresentationResult } from "./designOptionsPresentation";
import { designOptionsPresentation } from "./designOptionsPresentation";
import AgentCompletionCard from "./AgentCompletionCard";
import AgentMessageNavigator from "./AgentMessageNavigator";
import { useAgentAutoScroll } from "./useAgentAutoScroll";
import { turnReportForPresentation } from "./agentTaskPresentation";
import { useAgentSessionState } from './useAgentSessionState';
import { designProfileLabel, savedDesignProfile, type AgentDesignProfile } from "../agentDesignProfiles";
import "./agent-dashboard.css";
import "./agent-workspace.css";
import "./agent-task-workspace.css";

export type QueuedMessage = {
  id: string;
  taskId: string;
  prompt: string;
  attachments: File[];
  specialty?: AgentSpecialty;
  createdAt: number;
};

type ApiProvider = "Google" | "Nara" | "Groq" | "Cerebras" | "Routeway" | "Requesty" | "Inception AI";
type Provider = "Kilo" | "I/O" | "OpenCode" | ApiProvider;
type ApiModel = { name: string; id: string; apiModelId: string; credentialTier: 'google' | 'groq' | 'cerebras' | 'nara' | 'routeway' | 'requesty' | 'inception'; route: 'chat'; input: ('text' | 'image')[]; variants?: string[]; contextLength?: number; outputLimit?: number; subscriptionFlag?: boolean };
const GOOGLE_API_MODELS = [
  { name: "Gemini 3.8 Flash", id: "google/gemini-3.8-flash", contextLength: 1_048_576 },
  { name: "Gemini 3.6 Flash", id: "google/gemini-3.6-flash", contextLength: 1_048_576 },
  { name: "Gemini 3.5 Flash-Lite", id: "google/gemini-3.5-flash-lite", contextLength: 1_048_576 },
  { name: "Gemini 3.1 Flash-Lite", id: "google/gemini-3.1-flash-lite", contextLength: 1_048_576 },
  { name: "Gemini 2.5 Flash", id: "google/gemini-2.5-flash", contextLength: 1_048_576 },
  { name: "Gemini 2.5 Flash-Lite", id: "google/gemini-2.5-flash-lite", contextLength: 1_048_576 },
  { name: "Gemini 2.5 Pro", id: "google/gemini-2.5-pro", contextLength: 1_048_576 },
] as const;
const CEREBRAS_API_MODELS = [
  { name: "GPT OSS 120B", id: "cerebras/gpt-oss-120b" },
  { name: "Qwen 3.8 27B", id: "cerebras/qwen-3.8-27b" },
] as const;
const GROQ_API_MODELS = [
  { name: "GPT OSS 120B", id: "groq/openai/gpt-oss-120b", contextLength: 131_072 },
  { name: "GPT OSS 20B", id: "groq/openai/gpt-oss-20b", contextLength: 131_072 },
  { name: "Qwen 3.8 27B", id: "groq/qwen/qwen3.8-27b", contextLength: 131_072 },
] as const;
const NARA_ROUTER_MODELS = [
  { name: "Agnes 2.5 Flash", id: "nara/agnes-2.5-flash" },
  { name: "JEV", id: "nara/jev" },
  { name: "Laguna S 2.1", id: "nara/laguna-s-2.1" },
  { name: "Nemotron 3.5 Lightning Free", id: "nara/nemotron-3.5-lightning-free" },
] as const;
const ROUTEWAY_API_MODELS: ApiModel[] = routewayCatalog.models.map(model => ({
  ...model, id: `routeway/${model.id}`, apiModelId: model.id, credentialTier: 'routeway', route: 'chat', input: model.vision ? ['text', 'image'] : ['text'],
}));
const REQUESTY_API_MODELS: ApiModel[] = requestyCatalog.models.map(model => ({
  ...model, id: `requesty/${model.id}`, apiModelId: model.id, credentialTier: 'requesty', route: 'chat', input: model.vision ? ['text', 'image'] : ['text'],
}));
const INCEPTION_API_MODELS: ApiModel[] = inceptionCatalog.models.map(model => ({
  ...model, id: `inception/${model.id}`, apiModelId: model.apiModelId, credentialTier: 'inception', route: 'chat', input: ['text'],
}));
const API_MODELS: ApiModel[] = [
  ...INCEPTION_API_MODELS,
  ...REQUESTY_API_MODELS,
  ...ROUTEWAY_API_MODELS,
  ...GOOGLE_API_MODELS.map(model => ({ ...model, apiModelId: model.id.slice('google/'.length), credentialTier: 'google' as const, route: 'chat' as const, input: ['text' as const], variants: model.id === 'google/gemini-3.8-flash' ? ['low', 'medium', 'high'] : model.id.includes('2.5') ? model.id.endsWith('-pro') ? ['minimal', 'low', 'medium', 'high'] : ['none', 'minimal', 'low', 'medium', 'high'] : ['minimal', 'low', 'medium', 'high'] })),
  ...CEREBRAS_API_MODELS.map(model => ({ ...model, apiModelId: model.id.slice('cerebras/'.length), credentialTier: 'cerebras' as const, route: 'chat' as const, input: ['text' as const] })),
  ...GROQ_API_MODELS.map(model => ({ ...model, apiModelId: model.id.slice('groq/'.length), credentialTier: 'groq' as const, route: 'chat' as const, input: ['text' as const], variants: model.id.includes('gpt-oss-') ? ['low', 'medium', 'high'] : ['none', 'low', 'medium', 'high'] })),
  ...NARA_ROUTER_MODELS.map(model => ({ ...model, apiModelId: model.id.slice('nara/'.length), credentialTier: 'nara' as const, route: 'chat' as const, input: ['text' as const] })),
];
const apiProviderForModel = (id?: string): ApiProvider | null => id?.startsWith('google/') ? 'Google' : id?.startsWith('nara/') ? 'Nara' : id?.startsWith('groq/') ? 'Groq' : id?.startsWith('cerebras/') ? 'Cerebras' : id?.startsWith('routeway/') ? 'Routeway' : id?.startsWith('requesty/') ? 'Requesty' : id?.startsWith('inception/') ? 'Inception AI' : null;
const apiModelFor = (id: string | undefined): ApiModel | undefined => API_MODELS.find(model => model.id === id);
type AccessMode = "Plan" | "Full access" | "Controlled";
type AgentSpecialty = "3d-website";
const websiteCommand = "/3d-website";

function parseAgentCommand(prompt: string): { content: string; specialty?: AgentSpecialty } {
  const trimmed = prompt.trim();
  const match = /^\/3d-website(?=\s|$)/i.exec(trimmed);
  return match ? { content: trimmed.slice(match[0].length).trim(), specialty: "3d-website" } : { content: trimmed };
}

type AgentImage = { name: string; mime: "image/jpeg"; data: string };
async function prepareAgentImage(file: File): Promise<AgentImage> {
  if (file.size > 8_000_000) throw new Error(`${file.name} is too large. Use an image under 8 MB.`);
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not process the reference image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.56]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not encode the image.")), "image/jpeg", quality));
      if (blob.size > 800_000) continue;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.onerror = () => reject(new Error("Could not read the processed image."));
        reader.readAsDataURL(blob);
      });
      return { name: file.name, mime: "image/jpeg", data };
    }
    throw new Error(`${file.name} remains too large after resizing. Try a smaller image.`);
  } finally { bitmap.close(); }
}
type AgentTurn = {
  liveFileChanges?: Change[] | null;
  runState?: AgentRunState;
  id: string;
  prompt: string;
  attachments: string[];
  provider: Provider;
  modelId?: string;
  thinkingVariant?: string | null;
  accessMode?: AccessMode;
  specialty?: AgentSpecialty;
  sentContent?: string;
  designProfile?: AgentDesignProfile;
  designReviewMode?: "balanced" | "fast" | "quality" | "off";
  keyCheck?: boolean;
  reply?: string;
  error?: string;
  status?: "pending" | "done" | "error";
  activity?: AgentActivityItem[];
  verification?: AgentVerification;
  turnReport?: AgentTurnReport | null;
  runStartedAt?: number;
  completedAt?: number;
  createdAt: number;
};
type AgentTask = {
  id: string;
  title: string;
  projectId: string | null;
  accessMode?: AccessMode;
  accessModeVersion?: 2;
  modelId?: string;
  thinkingVariant?: string | null;
  designProfile?: AgentDesignProfile;
  designReviewMode?: 'balanced' | 'fast' | 'quality' | 'off';
  turns: AgentTurn[];
  createdAt?: number;
  updatedAt: number;
  unreadCompletion?: boolean;
};

type ContextUsage = {
  historyBytes: number;
  estimatedTokens: number;
  budgetTokens?: number;
  budgetSource?: 'model' | 'catalog' | 'fallback';
  lastInputTokens: number | null;
  contextSource?: 'provider' | 'estimate';
  estimateBasis?: 'engine-history' | 'saved-chat';
  compactions: number;
  modelId?: string;
  measuredAt?: number;
};

const CONTEXT_USAGE_STORAGE_KEY = 'orvix.agentContextUsage.v1';

function readAgentContextUsage(): Record<string, ContextUsage> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CONTEXT_USAGE_STORAGE_KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => {
      const item = value as Partial<ContextUsage> | null;
      return !!item && Number.isFinite(item.historyBytes) && Number.isFinite(item.estimatedTokens)
        && (item.budgetTokens === undefined || Number.isFinite(item.budgetTokens))
        && (item.lastInputTokens === null || item.lastInputTokens === undefined || Number.isFinite(item.lastInputTokens));
    }).map(([taskId, value]) => {
      const item = value as ContextUsage;
      const lastInputTokens = Number.isFinite(item.lastInputTokens) && item.lastInputTokens! > 0 ? item.lastInputTokens! : null;
      return [taskId, { ...item, lastInputTokens,
        contextSource: item.contextSource === 'provider' && lastInputTokens !== null ? 'provider' : 'estimate',
        budgetSource: item.budgetSource === 'model' || item.budgetSource === 'catalog' || item.budgetSource === 'fallback' ? item.budgetSource : 'fallback' }];
    }).slice(-100)) as Record<string, ContextUsage>;
  } catch { return {}; }
}

const MAX_SAVED_ACTIVITY_ITEMS = 320;
const MAX_SAVED_TOOL_OUTPUT = 8_000;

function compactActivityText(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === "string") text = redactApiKeys(value);
  else {
    try { text = redactApiKeys(JSON.stringify(value, null, 2) ?? String(value)); }
    catch { text = redactApiKeys(String(value)); }
  }
  if (text.length <= limit) return text;
  const marker = "\n… earlier details condensed …\n";
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available * 0.65);
  return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
}

function boundActivity(activity?: AgentActivityItem[], itemLimit = MAX_SAVED_ACTIVITY_ITEMS, outputLimit = MAX_SAVED_TOOL_OUTPUT): AgentActivityItem[] | undefined {
  if (!activity) return undefined;
  let retained = activity.length > itemLimit
    ? ["Earlier activity condensed to keep the task responsive.", ...activity.slice(-(itemLimit - 1))]
    : activity;
  // Keep the latest public design choice readable after long runs and reopening
  // older turns, even when verbose tool history is condensed.
  const designOptions = [...activity].reverse().find(item => typeof item !== "string" && item.kind === "progress" && item.id === "website-design-options");
  if (designOptions && !retained.includes(designOptions)) retained = [designOptions, ...retained.slice(-(itemLimit - 1))];
  return retained.map(item => {
    if (typeof item === "string") return compactActivityText(item, 1_200)!;
    if (item.kind === "progress") return { ...item, text: compactActivityText(item.text, item.id === "website-design-options" ? 66_000 : outputLimit)! };
    if (item.kind === "steer") return item;
    const output = compactActivityText(item.output, outputLimit);
    return {
      ...item,
      detail: compactActivityText(item.detail, 500) ?? "",
      input: compactActivityText(item.input, 1_500),
      output,
      truncated: item.truncated || output !== item.output,
    };
  });
}

function boundTaskHistory(tasks: AgentTask[], activeTaskId: string | null) {
  return tasks.map(task => ({
    ...task,
    turns: task.turns.map((turn, index) => {
      const isCurrentTurn = turn.status === "pending" || task.id === activeTaskId && index === task.turns.length - 1;
      return { ...turn, activity: boundActivity(turn.activity, isCurrentTurn ? MAX_SAVED_ACTIVITY_ITEMS : 24, isCurrentTurn ? MAX_SAVED_TOOL_OUTPUT : 600) };
    }),
  }));
}

function formatAgentTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function finishActivity(activity?: AgentActivityItem[]): AgentActivityItem[] | undefined {
  return activity?.flatMap(item => {
    if (typeof item === "string" || item.kind === "steer" || item.status !== "running") return [item];
    if (item.kind === "progress") return item.category === "waiting" ? [] : [{ ...item, status: "completed" as const }];
    return [{ ...item, status: "completed" as const, failed: true, output: item.output ?? "The task stopped before this tool returned output." }];
  });
}

function recoverInterruptedTurn(turn: AgentTurn): AgentTurn {
  if (turn.runState?.status === 'running') return turn;
  if (turn.status !== "pending") return turn;
  return {
    ...turn,
    status: "error",
    error: "This request ended without a saved final result. Review Task memory for the last action, then resume if available.",
    completedAt: Date.now(),
    activity: finishActivity(turn.activity),
  };
}

function contextMessages(turns: AgentTurn[]) {
  const activeTurns = turns.filter(turn => !turn.keyCheck);
  const total = activeTurns.length;
  return activeTurns.flatMap((turn, index) => {
    const isRecent = index >= total - 2;
    const request = { role: "user" as const, content: turn.sentContent ?? parseAgentCommand(turn.prompt).content };
    if (turn.status === "done" && turn.reply) {
      const replyContent = isRecent || turn.reply.length <= 2000
        ? turn.reply
        : `${turn.reply.slice(0, 1200)}\n\n[... Prior turn reply summarized for context efficiency (${turn.reply.length} chars total) ...]\n\n${turn.reply.slice(-600)}`;
      return [request, { role: "assistant" as const, content: replyContent }];
    }
    if (turn.status !== "error") return [];
    const progress = turn.activity?.filter((item): item is AgentProgressActivity => typeof item !== "string" && item.kind === "progress" && item.category === "agent_update").at(-1)?.text;
    const tool = turn.activity?.filter((item): item is AgentToolActivity => typeof item !== "string" && item.kind === "tool").at(-1);
    const observed = [turn.error ? `Stopped: ${turn.error}` : "Stopped before a final answer.",
      progress ? `Last progress: ${progress.slice(-1800)}` : "",
      tool ? `Last tool: ${tool.name} ${tool.detail}; ${tool.status}${tool.failed ? " (failed)" : ""}` : ""].filter(Boolean).join("\n");
    return [request, { role: "assistant" as const, content: `The previous attempt did not finish. Recorded state:\n${observed}` }];
  });
}

function shortModelName(modelId: string | undefined, openCodeModels: { id: string; name: string }[], kiloModels: { id: string; name: string }[], ioModels?: { id: string; name: string }[]) {
  if (!modelId) return "Model not set";
  const name = ioModels?.find(model => model.id === modelId)?.name ?? kiloModels.find(model => model.id === modelId)?.name ?? openCodeModels.find(model => model.id === modelId)?.name ?? API_MODELS.find(model => model.id === modelId)?.name
    ?? modelId.split("/").at(-1)?.replaceAll("-", " ") ?? modelId;
  return name.replace(/\s+(?:Free|Contributor)$/i, "").trim();
}

function sanitizeTask(task: AgentTask): AgentTask {
  const legacyMode = task.accessModeVersion !== 2;
  const accessMode: AccessMode = legacyMode && task.accessMode === "Full access" ? "Controlled" : task.accessMode ?? "Controlled";
  return {
    ...task, accessMode, accessModeVersion: 2, title: redactApiKeys(task.title), turns: task.turns.map(turn => recoverInterruptedTurn({
      ...turn, provider: turn.modelId?.startsWith('antigravity/') ? 'I/O' : turn.modelId?.startsWith('kilo/') ? 'Kilo' : apiProviderForModel(turn.modelId) ?? 'OpenCode', accessMode: legacyMode ? (turn.accessMode === "Plan" || task.accessMode === "Plan" ? "Plan" : "Controlled") : turn.accessMode ?? "Controlled",
      prompt: redactApiKeys(turn.prompt), sentContent: turn.sentContent ? redactApiKeys(turn.sentContent) : undefined,
      reply: turn.reply ? redactApiKeys(turn.reply) : undefined, error: turn.error ? redactApiKeys(turn.error) : undefined,
      activity: boundActivity(turn.activity?.map(item => typeof item === "string" ? redactApiKeys(item) : item.kind === "steer" ? item : item.kind === "progress"
        ? { ...item, text: redactApiKeys(item.text) }
        : { ...item, detail: redactApiKeys(item.detail), input: item.input ? redactApiKeys(item.input) : undefined,
          output: item.output ? redactApiKeys(item.output) : undefined })),
    }))
  };
}

function readAgentTasks(): AgentTask[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("orvix.agentTasks") ?? "[]");
    return Array.isArray(saved) ? saved.filter((task): task is AgentTask =>
      typeof task?.id === "string" && typeof task?.title === "string" &&
      typeof task?.updatedAt === "number" && Array.isArray(task?.turns))
      .map(sanitizeTask) : [];
  } catch {
    return [];
  }
}

function normalizeTasks(value: unknown): AgentTask[] {
  return Array.isArray(value) ? value.filter((task): task is AgentTask =>
    typeof task?.id === "string" && typeof task?.title === "string" && Array.isArray(task?.turns))
    .map(sanitizeTask) : [];
}

function readThinkingPreferences(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem("orvix.agentThinkingVariants") ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([modelId, variant]) =>
      typeof variant === "string" && (modelId.startsWith('kilo/') || modelId.startsWith('opencode/') || defaultThinkingVariantsFor(modelId).includes(variant)))) as Record<string, string>;
  } catch { return {}; }
}

export default function AgentDashboard({ notificationTarget, onNotificationHandled, onServerStatus, visible }: {
  notificationTarget: Extract<NotificationOpenTarget, { type: 'agent' }> | null;
  onNotificationHandled: (notificationId: string) => void;
  onServerStatus: (status: AgentServerIndicator | null) => void;
  visible: boolean;
}) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => localStorage.getItem('orvix.activeAgentTask') ?? crypto.randomUUID());
  const { catalog: openCodeCatalog, loading: openCodeLoading, refresh: refreshOpenCode } = useOpenCodeModels();
  const ZEN_FREE_MODELS = openCodeCatalog.models;
  const ALL_OPEN_CODE_MODELS = [...ZEN_FREE_MODELS, ...GO_MODELS];
  const thinkingVariantsFor = (id: string): string[] => id.startsWith('opencode/') ? ZEN_FREE_MODELS.find(model => model.id === id)?.variants ?? [] : defaultThinkingVariantsFor(id);
  const [provider, setProvider] = useAgentSessionState<Provider>(activeTaskId, () => {
    const saved = localStorage.getItem('orvix.agentProvider');
    return saved === 'Kilo' || saved === 'I/O' || saved === 'Google' || saved === 'Nara' || saved === 'Groq' || saved === 'Cerebras' || saved === 'Routeway' || saved === 'Requesty' || saved === 'Inception AI' ? saved : 'OpenCode';
  });
  const [selectedOpenCodeModelId, setSelectedOpenCodeModelId] = useAgentSessionState(activeTaskId, () => {
    const saved = localStorage.getItem("orvix.agentOpenCodeModel");
    return saved && saved !== "opencode/space-bunny-free" && ALL_OPEN_CODE_MODELS.some(model => model.id === saved) ? saved : "opencode-go/deepseek-v4.1-flash";
  });
  useEffect(() => {
    if (selectedOpenCodeModelId === "opencode/space-bunny-free" || (selectedOpenCodeModelId && ALL_OPEN_CODE_MODELS.length > 0 && !ALL_OPEN_CODE_MODELS.some(model => model.id === selectedOpenCodeModelId))) {
      setSelectedOpenCodeModelId("opencode-go/deepseek-v4.1-flash");
    }
  }, [ALL_OPEN_CODE_MODELS, selectedOpenCodeModelId, setSelectedOpenCodeModelId]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [openCodeKeepAlive, setOpenCodeKeepAlive] = useState(false);
  const [openCodeKeepAliveReady, setOpenCodeKeepAliveReady] = useState(false);
  const [openCodeKeepAliveSaving, setOpenCodeKeepAliveSaving] = useState(false);
  const [kiloMenuOpen, setKiloMenuOpen] = useState(false);
  const [apiMenuOpen, setApiMenuOpen] = useState(false);
  const [selectedApiProvider, setSelectedApiProvider] = useAgentSessionState<ApiProvider | null>(activeTaskId, () => null);
  const [selectedGoogleApiModelId, setSelectedGoogleApiModelId] = useAgentSessionState(activeTaskId, () => "google/gemini-3.8-flash");
  const [selectedCerebrasApiModelId, setSelectedCerebrasApiModelId] = useAgentSessionState(activeTaskId, () => "cerebras/gpt-oss-120b");
  const [selectedGroqApiModelId, setSelectedGroqApiModelId] = useAgentSessionState(activeTaskId, () => "groq/openai/gpt-oss-120b");
  const [selectedNaraApiModelId, setSelectedNaraApiModelId] = useAgentSessionState(activeTaskId, () => "nara/agnes-2.5-flash");
  const [selectedRoutewayApiModelId, setSelectedRoutewayApiModelId] = useAgentSessionState(activeTaskId, () => `routeway/${routewayCatalog.defaultModel}`);
  const [selectedRequestyApiModelId, setSelectedRequestyApiModelId] = useAgentSessionState(activeTaskId, () => `requesty/${requestyCatalog.defaultModel}`);
  const [selectedInceptionApiModelId, setSelectedInceptionApiModelId] = useAgentSessionState(activeTaskId, () => `inception/${inceptionCatalog.defaultModel}`);
  const [selectedKiloModelId, setSelectedKiloModelId] = useAgentSessionState(activeTaskId, () => localStorage.getItem('orvix.agentKiloModel') || 'kilo/kilo-auto/free');
  const { catalog: kiloCatalog, loading: kiloLoading, refresh: refreshKilo } = useKiloModels();
  const [ioMenuOpen, setIoMenuOpen] = useState(false);
  const ioButtonRef = useRef<HTMLButtonElement>(null);
  const { catalog: ioCatalog, loading: ioLoading, refresh: refreshIo } = useIoModels();
  const [selectedIoModelId, setSelectedIoModelId] = useAgentSessionState(activeTaskId, () => {
    const saved = localStorage.getItem('orvix.agentIoModel');
    if (saved && saved.startsWith('antigravity/gemini-3.8-flash')) return 'antigravity/gemini-3.8-flash';
    return saved || 'antigravity/gemini-3.8-flash';
  });
  const [ioThinkingPreferences, setIoThinkingPreferences] = useAgentSessionState<Record<string, string>>(activeTaskId, () => {
    try {
      const saved = JSON.parse(localStorage.getItem('orvix.agentIoThinking') ?? '{}');
      return typeof saved === 'object' && saved ? saved : {};
    } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem('orvix.agentIoModel', selectedIoModelId); }, [selectedIoModelId]);
  useEffect(() => { localStorage.setItem('orvix.agentIoThinking', JSON.stringify(ioThinkingPreferences)); }, [ioThinkingPreferences]);
  const [hoveredOpenCodeModelId, setHoveredOpenCodeModelId] = useState(selectedOpenCodeModelId);
  const [thinkingPreferences, setThinkingPreferences] = useAgentSessionState<Record<string, string>>(activeTaskId, readThinkingPreferences);
  const [accessMode, setAccessMode] = useAgentSessionState<AccessMode>(activeTaskId, 'Controlled');
  const [designReviewMode, setDesignReviewMode] = useAgentSessionState<"balanced" | "fast" | "quality" | "off">(activeTaskId, () => {
    const saved = localStorage.getItem('orvix.agentDesignReviewMode');
    return saved === 'balanced' || saved === 'fast' || saved === 'quality' || saved === 'off' ? saved : 'fast';
  });
  useEffect(() => { localStorage.setItem('orvix.agentDesignReviewMode', designReviewMode); }, [designReviewMode]);
  const [designProfile, setDesignProfile] = useAgentSessionState<AgentDesignProfile>(activeTaskId, () => savedDesignProfile(localStorage.getItem('orvix.agentDesignProfile.v1') ?? 'normal'));
  useEffect(() => { localStorage.setItem('orvix.agentDesignProfile.v1', designProfile); }, [designProfile]);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [designMenuOpen, setDesignMenuOpen] = useState(false);
  const [projectId, setProjectId] = useAgentSessionState<string | null>(activeTaskId, null);
  const [draft, setDraft] = useAgentSessionState(activeTaskId, '');
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [files, setFiles] = useAgentSessionState<File[]>(activeTaskId, []);
  const [tasks, setTasksState] = useState<AgentTask[]>(() => boundTaskHistory(readAgentTasks(), activeTaskId));
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const setTasks = (update: AgentTask[] | ((current: AgentTask[]) => AgentTask[])) => {
    setTasksState(current => boundTaskHistory(typeof update === "function" ? update(current) : update, activeTaskIdRef.current));
  };
  const [tasksHydrated, setTasksHydrated] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(() => {
    return localStorage.getItem("orvix.agentHistoryOpen.v2") === "true";
  });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyStatus, setKeyStatus] = useState<Awaited<ReturnType<NonNullable<Window["orvixDesktop"]>["getOpenCodeStatus"]>> | null>(null);
  const [goKeyDraft, setGoKeyDraft] = useState("");
  const [kiloKeyDraft, setKiloKeyDraft] = useState('');
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<ApiModel['credentialTier'], string>>({ google: '', groq: '', cerebras: '', nara: '', routeway: '', requesty: '', inception: '' });
  const [keySettingsProvider, setKeySettingsProvider] = useState<ApiModel['credentialTier']>('google');
  const [apiKeyLabel, setApiKeyLabel] = useState('');
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState('');
  const providerDialogRef = useRef<HTMLDivElement>(null);
  const [keyError, setKeyError] = useState("");
  const [notice, setNotice] = useAgentSessionState(activeTaskId, '');
  const [runningRequests, setRunningRequests] = useState<Record<string, string>>({});
  const runningRequestsRef = useRef<Record<string, string>>({});
  const observedRuns = useRef(new Map<string, { requestId: string; run: AgentRunState; result?: AgentRunResult; error?: string }>());
  const runningRequestId = activeTaskId ? runningRequests[activeTaskId] ?? null : null;
  const runningTaskId = runningRequestId ? activeTaskId : null;
  const [streamPreviews, setStreamPreviews] = useState<Record<string, { taskId: string; requestId: string; text: string }>>({});
  const streamPreview = activeTaskId ? streamPreviews[activeTaskId] ?? null : null;
  const beginRun = (taskId: string, requestId: string) => {
    runningRequestsRef.current = { ...runningRequestsRef.current, [taskId]: requestId };
    setRunningRequests(runningRequestsRef.current);
    setStreamPreviews(current => { const next = { ...current }; delete next[taskId]; return next; });
  };
  const endRun = (taskId: string, requestId: string) => {
    if (runningRequestsRef.current[taskId] !== requestId) return;
    const next = { ...runningRequestsRef.current }; delete next[taskId];
    runningRequestsRef.current = next; setRunningRequests(next);
    sendingRef.current.delete(taskId);
    setStreamPreviews(current => { if (current[taskId]?.requestId !== requestId) return current; const next = { ...current }; delete next[taskId]; return next; });
    setApprovals(current => current.filter(item => item.taskId !== taskId || item.requestId !== requestId));
    setQuestions(current => { const next = { ...current }; delete next[taskId]; return next; });
  };
  const [taskQueues, setTaskQueues] = useState<Record<string, QueuedMessage[]>>({});
  const taskQueuesRef = useRef<Record<string, QueuedMessage[]>>({});
  taskQueuesRef.current = taskQueues;
  const [queueMenuId, setQueueMenuId] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<{ taskId: string; file: string } | null>(null);
  const [designOptionsPreview, setDesignOptionsPreview] = useState<{ taskId: string; turnId?: string; choices: DesignOptionsPresentationResult; option: "A" | "B" } | null>(null);
  const [designOptionsPreviewRevision, setDesignOptionsPreviewRevision] = useState(0);
  useEffect(() => { setFilePreview(null); setDesignOptionsPreview(null); setChangesMinimized(false); setChangesMaximized(false); }, [activeTaskId]);
  const [changesDock, setChangesDock] = useState<"left" | "right">(() => localStorage.getItem("orvix.agentChangesDock") === "left" ? "left" : "right");
  const [changesWidth, setChangesWidth] = useState(() => {
    const saved = Number(localStorage.getItem("orvix.agentChangesWidth"));
    return Number.isFinite(saved) && saved >= 360 ? Math.min(saved, 800) : 560;
  });
  const [changesMinimized, setChangesMinimized] = useState(false);
  const [changesMaximized, setChangesMaximized] = useState(false);
  const [reviewTurnId, setReviewTurnId] = useState<string | null>(null);
  const [reviewFile, setReviewFile] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [workspaceTaskId, setWorkspaceTaskId] = useState<string | null>(null);
  const [settingsTaskId, setSettingsTaskId] = useState<string | null>(null);
  const [contexts, setContexts] = useState<Record<string, ContextUsage>>(readAgentContextUsage);
  const contextUsage = activeTaskId ? contexts[activeTaskId] ?? null : null;
  const contextTokens = contextUsage
    ? contextUsage.contextSource === 'provider' && contextUsage.lastInputTokens && contextUsage.lastInputTokens > 0
      ? contextUsage.lastInputTokens : contextUsage.estimatedTokens
    : null;
  const contextBudget = contextUsage?.budgetTokens && contextUsage.budgetTokens > 0 ? contextUsage.budgetTokens : 200000;
  const rawContextPercent = contextTokens && contextTokens > 0 ? contextTokens / contextBudget * 100 : null;
  const contextReported = contextUsage?.contextSource === 'provider'
    || contextUsage?.contextSource === undefined && !!contextUsage?.lastInputTokens && contextUsage.lastInputTokens > 0;
  const contextPercent = rawContextPercent === null ? '—'
    : `${!contextReported || contextUsage?.budgetSource === 'fallback' ? '~' : ''}${rawContextPercent > 0 && rawContextPercent < 1 ? '<1%' : `${Math.round(rawContextPercent)}%`}`;
  const contextTooltip = contextUsage && contextTokens !== null
    ? `${contextReported ? 'Provider-reported' : contextUsage.estimateBasis === 'saved-chat' ? 'Saved-chat estimate' : 'Engine-history estimate'} ${contextTokens.toLocaleString()} tokens of ${contextBudget.toLocaleString()} ${contextUsage.budgetSource === 'fallback' || !contextUsage.budgetSource ? 'assumed' : 'model'} context${contextUsage.estimateBasis === 'saved-chat' ? ' · excludes hidden system and tool context' : ''}${contextUsage.measuredAt ? ` · updated ${new Date(contextUsage.measuredAt).toLocaleString()}` : ''}`
    : 'Context usage will appear after the first context measurement for this session.';
  const setContextUsage = (taskId: string | null, value: ContextUsage | null) => {
    if (!value || !taskId) return;
    const lastInputTokens = Number.isFinite(value.lastInputTokens) && value.lastInputTokens! > 0 ? Math.floor(value.lastInputTokens!) : null;
    setContexts(current => ({ ...current, [taskId]: {
      ...value,
      estimatedTokens: Number.isFinite(value.estimatedTokens) && value.estimatedTokens > 0 ? Math.floor(value.estimatedTokens) : Math.ceil(Math.max(0, value.historyBytes) / 4),
      budgetTokens: Number.isFinite(value.budgetTokens) && value.budgetTokens! > 0 ? Math.floor(value.budgetTokens!) : 200000,
      lastInputTokens,
      contextSource: value.contextSource === 'provider' && lastInputTokens !== null ? 'provider' : 'estimate',
      measuredAt: Number.isFinite(value.measuredAt) ? value.measuredAt : Date.now(),
    } }));
  };
  useEffect(() => {
    try {
      const newest = Object.entries(contexts).sort((a, b) => (b[1].measuredAt ?? 0) - (a[1].measuredAt ?? 0)).slice(0, 100);
      localStorage.setItem(CONTEXT_USAGE_STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)));
    } catch { /* Keep context display available if browser storage is temporarily full. */ }
  }, [contexts]);
  const [checkpoint, setCheckpoint] = useState<Awaited<ReturnType<NonNullable<Window["orvixDesktop"]>["getAgentCheckpoint"]>>>(null);
  const [taskMemory, setTaskMemory] = useState<AgentTaskMemory | null>(null);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [scorecardTabOpen, setScorecardTabOpen] = useState(true);
  const [approvals, setApprovals] = useState<AgentApprovalRequest[]>([]);
  const removedApprovals = useRef(new Set<string>());
  const approval = approvals.find(item => item.taskId === activeTaskId) ?? null;
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const dismissApproval = (id: string) => { removedApprovals.current.add(id); setApprovals(current => current.filter(item => item.approvalId !== id)); };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const keepAliveButtonRef = useRef<HTMLButtonElement>(null);
  const kiloButtonRef = useRef<HTMLButtonElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const threadInnerRef = useRef<HTMLDivElement>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const accessMenuRef = useRef<HTMLDivElement>(null);
  const designMenuRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(new Set<string>());
  const activeTaskIdRef = useRef(activeTaskId);
  const serverModelIdRef = useRef(selectedOpenCodeModelId);
  serverModelIdRef.current = selectedOpenCodeModelId;

  useEffect(() => {
    if (!visible) { onServerStatus(null); return; }
    if (!window.orvixDesktop?.getAgentWorkers) {
      onServerStatus({ taskId: activeTaskId ?? '', state: 'offline', idleMs: 120000, idleExpiresAt: null });
      return;
    }
    let active = true, inFlight = false;
    const poll = async () => {
      const bridge = window.orvixDesktop;
      if (!bridge?.getAgentWorkers || inFlight) return;
      inFlight = true;
      try {
        const snapshot = await bridge.getAgentWorkers();
        if (!active) return;
        const worker = activeTaskId ? snapshot.workers?.[activeTaskId] : undefined;
        const activeRequestId = activeTaskId ? runningRequestsRef.current[activeTaskId] : undefined;
        const activeTurn = activeRequestId
          ? tasksRef.current.find(task => task.id === activeTaskId)?.turns.find(turn => turn.id === activeRequestId)
          : undefined;
        // The titlebar describes this task's OpenCode server, regardless of the composer provider.
        const activeOpenCodeRun = activeTurn?.provider === 'OpenCode';
        onServerStatus({ taskId: activeTaskId ?? '', state: resolveAgentServerState(worker, activeOpenCodeRun),
          prepared: worker?.prepared && worker.preparedModelId === serverModelIdRef.current,
          responseState: activeOpenCodeRun && worker?.running ? (activeTurn?.reply || activeTurn?.activity?.some(item => typeof item !== 'string' && (item.kind === 'tool' || item.kind === 'progress' && item.category !== 'waiting' && item.text)) ? 'working' : 'waiting') : undefined,
          idleMs: worker?.idleMs ?? 120000, idleExpiresAt: worker?.running ? worker.idleExpiresAt ?? null : null });
      } catch {
        if (active) onServerStatus({ taskId: activeTaskId ?? '', state: 'checking', idleMs: 120000, idleExpiresAt: null });
      } finally { inFlight = false; }
    };
    onServerStatus({ taskId: activeTaskId ?? '', state: 'checking', idleMs: 120000, idleExpiresAt: null });
    let timer: ReturnType<typeof setInterval> | undefined;
    const syncVisibility = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      void poll();
      timer = setInterval(() => { if (!document.hidden) void poll(); }, 1000);
    };
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', syncVisibility); onServerStatus(null); };
  }, [activeTaskId, visible, onServerStatus]);

  const preparationDirectory = workspaces.at(-1);
  useEffect(() => {
    if (!visible || !activeTaskId || workspaceTaskId !== activeTaskId || settingsTaskId !== activeTaskId || provider !== 'OpenCode' || !selectedOpenCodeModelId.startsWith('opencode/') || !openCodeKeepAlive) return;
    let active = true;
    void window.orvixDesktop?.prepareAgentWorker?.(activeTaskId, preparationDirectory, selectedOpenCodeModelId).catch(error => {
      if (active) setNotice(error instanceof Error ? error.message : 'Could not prepare the OpenCode task server.');
    });
    return () => { active = false; };
  }, [activeTaskId, visible, provider, openCodeKeepAlive, workspaceTaskId, settingsTaskId, preparationDirectory, selectedOpenCodeModelId]);

  useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    if (!draft) {
      textarea.style.height = '50px';
      textarea.style.overflowY = 'hidden';
      textarea.scrollTop = 0;
      return;
    }
    const maxHeight = 260;
    const previousScrollTop = textarea.scrollTop;
    textarea.style.height = "0px";
    const contentHeight = textarea.scrollHeight;
    const nextHeight = Math.min(maxHeight, Math.max(50, contentHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
    textarea.scrollTop = previousScrollTop;
  }, [draft, activeTaskId]);

  const activeTask = tasks.find(task => task.id === activeTaskId);
  useEffect(() => {
    if (!activeTaskId || !activeTask?.turns.length) return;
    const taskModelId = activeTask.modelId ?? activeTask.turns.at(-1)?.modelId;
    const modelContextLimit = taskModelId?.startsWith('kilo/')
      ? kiloCatalog.models.find(model => model.id === taskModelId)?.contextLength ?? undefined
      : apiModelFor(taskModelId)?.contextLength ?? openCodeCatalog.models.find(model => model.id === taskModelId)?.contextLength ?? GO_MODELS.find(model => model.id === taskModelId)?.contextLength ?? undefined;
    const savedMessages = contextMessages(activeTask.turns);
    const historyBytes = new TextEncoder().encode(JSON.stringify(savedMessages)).byteLength;
    const estimatedTokens = Math.ceil(historyBytes / 4);
    if (!estimatedTokens) return;
    setContexts(current => {
      const existing = current[activeTaskId];
      const sameModel = !taskModelId || !existing?.modelId || existing.modelId === taskModelId;
      if (existing && sameModel) {
        if (modelContextLimit && existing.budgetSource === 'fallback') return { ...current, [activeTaskId]: { ...existing, budgetTokens: modelContextLimit, budgetSource: 'model', modelId: taskModelId } };
        return current;
      }
      return { ...current, [activeTaskId]: {
      historyBytes, estimatedTokens, budgetTokens: modelContextLimit ?? 200000,
      budgetSource: modelContextLimit ? 'model' : 'fallback',
      lastInputTokens: null, contextSource: 'estimate', estimateBasis: 'saved-chat',
      compactions: 0, modelId: taskModelId, measuredAt: Date.now(),
      } };
    });
  }, [activeTaskId, activeTask, openCodeCatalog.models, kiloCatalog.models]);
  const selectedOpenCodeModel = ALL_OPEN_CODE_MODELS.find(model => model.id === selectedOpenCodeModelId) ?? { id: selectedOpenCodeModelId, name: 'Unavailable model · choose another', route: 'chat' as const };
  const hoveredOpenCodeModel = ALL_OPEN_CODE_MODELS.find(model => model.id === hoveredOpenCodeModelId) ?? selectedOpenCodeModel;
  const preferredThinkingVariant = activeTask?.modelId === selectedOpenCodeModelId && activeTask.thinkingVariant !== undefined
    ? activeTask.thinkingVariant : thinkingPreferences[selectedOpenCodeModelId];
  const selectedThinkingVariant = preferredThinkingVariant && thinkingVariantsFor(selectedOpenCodeModelId).includes(preferredThinkingVariant) ? preferredThinkingVariant : null;
  const selectedKiloModel = kiloCatalog.models.find(model => model.id === selectedKiloModelId);
  const preferredKiloVariant = activeTask?.modelId === selectedKiloModelId && activeTask.thinkingVariant !== undefined ? activeTask.thinkingVariant : thinkingPreferences[selectedKiloModelId];
  const selectedKiloVariant = preferredKiloVariant && selectedKiloModel?.variants[preferredKiloVariant] ? preferredKiloVariant : null;
  const selectedIoModel = ioCatalog.models.find(model => model.id === selectedIoModelId);
  const preferredIoVariant = activeTask && activeTask.modelId === selectedIoModelId && activeTask.thinkingVariant !== undefined ? activeTask.thinkingVariant : ioThinkingPreferences[selectedIoModelId];
  const selectedIoVariant = preferredIoVariant && selectedIoModel?.variants.includes(preferredIoVariant) ? preferredIoVariant : null;
  const activeModelId = provider === 'I/O' ? selectedIoModelId : provider === 'Kilo' ? selectedKiloModelId
    : provider === 'Google' ? selectedGoogleApiModelId
      : provider === 'Groq' ? selectedGroqApiModelId
        : provider === 'Cerebras' ? selectedCerebrasApiModelId
          : provider === 'Nara' ? selectedNaraApiModelId : provider === 'Routeway' ? selectedRoutewayApiModelId : provider === 'Requesty' ? selectedRequestyApiModelId : provider === 'Inception AI' ? selectedInceptionApiModelId : selectedOpenCodeModelId;
  const activeModel = provider === 'I/O' ? selectedIoModel : provider === 'Kilo' ? selectedKiloModel : apiProviderForModel(activeModelId) ? apiModelFor(activeModelId) : selectedOpenCodeModel;
  const selectedApiModel = apiModelFor(activeModelId);
  const selectedApiMenuModelId = selectedApiProvider === 'Google' ? selectedGoogleApiModelId
    : selectedApiProvider === 'Groq' ? selectedGroqApiModelId
      : selectedApiProvider === 'Cerebras' ? selectedCerebrasApiModelId
        : selectedApiProvider === 'Nara' ? selectedNaraApiModelId : selectedApiProvider === 'Routeway' ? selectedRoutewayApiModelId : selectedApiProvider === 'Requesty' ? selectedRequestyApiModelId : selectedApiProvider === 'Inception AI' ? selectedInceptionApiModelId : undefined;
  const apiMenuModel = apiModelFor(selectedApiMenuModelId);
  const preferredApiMenuVariant = activeTask && activeTask.modelId === selectedApiMenuModelId && activeTask.thinkingVariant !== undefined
    ? activeTask.thinkingVariant : (selectedApiMenuModelId ? thinkingPreferences[selectedApiMenuModelId] : undefined);
  const apiMenuThinkingVariant = preferredApiMenuVariant && apiMenuModel?.variants?.includes(preferredApiMenuVariant) ? preferredApiMenuVariant : null;
  const preferredApiVariant = activeTask?.modelId === activeModelId && activeTask.thinkingVariant !== undefined ? activeTask.thinkingVariant : thinkingPreferences[activeModelId];
  const activeThinkingVariant = provider === 'I/O' ? selectedIoVariant : provider === 'Kilo' ? selectedKiloVariant : selectedApiModel
    ? preferredApiVariant && selectedApiModel.variants?.includes(preferredApiVariant) ? preferredApiVariant : null : selectedThinkingVariant;
  const activeProviderLabel = provider === 'I/O' ? 'Antigravity I/O' : provider === 'Kilo' ? selectedKiloModel?.access === 'byok' ? 'Kilo · OpenAI' : 'Kilo Free'
    : provider === 'OpenCode' ? '' : `${provider} API`;
  const kiloThinkingPreferences = { ...thinkingPreferences };
  if (activeTask?.modelId?.startsWith('kilo/') && activeTask.thinkingVariant !== undefined) {
    if (activeTask.thinkingVariant) kiloThinkingPreferences[activeTask.modelId] = activeTask.thinkingVariant;
    else delete kiloThinkingPreferences[activeTask.modelId];
  }
  const hoveredThinkingVariant = activeTask?.modelId === hoveredOpenCodeModelId && activeTask.thinkingVariant !== undefined
    ? activeTask.thinkingVariant : thinkingPreferences[hoveredOpenCodeModelId];
  const turns = activeTask?.turns ?? [];
  const reviewedTurn = reviewTurnId ? activeTask?.turns.find(turn => turn.id === reviewTurnId) : undefined;
  const reviewedTurnFiles = reviewedTurn ? turnReportForPresentation(reviewedTurn)?.changes ?? [] : [];
  const { showJumpToLatest, jumpToLatest, jumpToMessage } = useAgentAutoScroll(threadScrollRef, threadInnerRef, activeTaskId, turns.length > 0);
  const threadTitle = activeTask?.title ?? "Agent workspace";
  const visibleTasks = tasks
    .sort((first, second) => second.updatedAt - first.updatedAt);
  const slashQuery = draft.trimStart();
  const slashMenuOpen = !slashMenuDismissed && slashQuery.startsWith("/") && !/\s/.test(slashQuery)
    && slashQuery.toLowerCase() !== websiteCommand && websiteCommand.startsWith(slashQuery.toLowerCase());

  useEffect(() => {
    let alive = true;
    void window.orvixDesktop?.readAgentTasks().then(saved => {
      if (!alive) return;
      const defaults = readThinkingPreferences();
      const disk = normalizeTasks(saved).map(task => {
        const last = task.turns.at(-1), modelId = task.modelId ?? last?.modelId ?? activeModelId;
        const observed = observedRuns.current.get(task.id);
        const turns = task.turns.map(turn => {
          if (!observed || observed.requestId !== turn.id || observed.run.startedAt < (turn.runState?.startedAt ?? 0)) return turn;
          return { ...turn, runState: observed.run, ...(observed.run.status === 'running' ? {} : observed.result
            ? { reply: observed.result.text, verification: observed.result.verification, turnReport: observed.result.turnReport, status: 'done' as const, error: undefined, completedAt: observed.run.completedAt, activity: finishActivity(turn.activity) }
            : { status: 'error' as const, error: observed.error || observed.run.error || 'The run was interrupted.', completedAt: observed.run.completedAt, activity: finishActivity(turn.activity) }) };
        });
        return { ...task, turns, modelId, thinkingVariant: task.thinkingVariant !== undefined ? task.thinkingVariant : last?.thinkingVariant !== undefined ? last.thinkingVariant : defaults[modelId] ?? null,
          designProfile: savedDesignProfile(task.designProfile ?? last?.designProfile, task.designReviewMode ?? last?.designReviewMode),
          designReviewMode: task.designReviewMode ?? last?.designReviewMode ?? designReviewMode };
      });
      setTasks(current => [...disk, ...current.filter(task => !disk.some(item => item.id === task.id))]);
      const running = disk.flatMap(task => task.turns.map(turn => ({ taskId: task.id, turn }))).filter(item => item.turn.runState?.status === 'running');
      for (const item of running) {
        sendingRef.current.add(item.taskId); beginRun(item.taskId, item.turn.id);
        void window.orvixDesktop?.getAgentApproval?.(item.taskId).then(value => { if (alive && value && runningRequestsRef.current[item.taskId] === item.turn.id && !removedApprovals.current.has(value.approvalId)) setApprovals(current => [...current.filter(pending => pending.approvalId !== value.approvalId), value]); }).catch(() => {});
        void window.orvixDesktop?.getAgentQuestion?.(item.taskId, item.turn.id).then(value => { if (alive && value && runningRequestsRef.current[item.taskId] === item.turn.id) setQuestions(current => ({ ...current, [item.taskId]: value.questionId })); }).catch(() => {});
      }
      setTasksHydrated(true);
    }).catch(() => { if (alive) setNotice("Saved agent history could not be read. Disk saves are paused to preserve it."); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!tasksHydrated) return;
    const timer = window.setTimeout(() => {
      void window.orvixDesktop?.writeAgentTasks(tasks).then(() => localStorage.removeItem("orvix.agentTasks"))
        .catch(() => setNotice("Could not save agent history on this device."));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [tasks, tasksHydrated]);
  useEffect(() => { localStorage.setItem("orvix.agentHistoryOpen.v2", String(historyVisible)); }, [historyVisible]);
  useEffect(() => { localStorage.setItem("orvix.agentChangesDock", changesDock); }, [changesDock]);
  useEffect(() => { localStorage.setItem("orvix.agentChangesWidth", String(changesWidth)); }, [changesWidth]);
  useEffect(() => { localStorage.setItem("orvix.agentOpenCodeModel", selectedOpenCodeModelId); }, [selectedOpenCodeModelId]);
  useEffect(() => { localStorage.setItem('orvix.agentKiloModel', selectedKiloModelId); }, [selectedKiloModelId]);
  useEffect(() => { localStorage.setItem('orvix.agentProvider', provider); }, [provider]);
  useEffect(() => { localStorage.setItem("orvix.agentThinkingVariants", JSON.stringify(thinkingPreferences)); }, [thinkingPreferences]);
  useEffect(() => {
    let active = true;
    if (!window.orvixDesktop?.getOpenCodeKeepAlive) { setOpenCodeKeepAliveReady(true); return () => { active = false; }; }
    void window.orvixDesktop.getOpenCodeKeepAlive().then(value => {
      if (active) setOpenCodeKeepAlive(value.keepAlive === true);
    }).catch(() => {}).finally(() => { if (active) setOpenCodeKeepAliveReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => { void window.orvixDesktop?.getOpenCodeStatus().then(setKeyStatus).catch(() => setKeyStatus(null)); }, []);
  useEffect(() => {
    if (!keyDialogOpen) return;
    let active = true;
    const refresh = () => { void window.orvixDesktop?.getOpenCodeStatus().then(status => { if (active) setKeyStatus(status); }).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [keyDialogOpen]);
  useEffect(() => {
    if (!keyDialogOpen) return;
    const dialog = providerDialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')).filter(item => item.offsetParent !== null && item.checkVisibility());
    focusable()[0]?.focus();
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setKeyDialogOpen(false); }
      if (event.key !== 'Tab') return;
      const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [keyDialogOpen]);
  useEffect(() => {
    if (!tasksHydrated) return;
    const saved = tasks.find(task => task.id === activeTaskId);
    setSettingsTaskId(activeTaskId);
    if (!saved) return;
    const modelId = saved.modelId ?? saved.turns.at(-1)?.modelId;
    const apiProvider = apiProviderForModel(modelId);
    const savedProvider: Provider = modelId?.startsWith('kilo/') ? 'Kilo' : apiProvider ?? 'OpenCode';
    setProvider(savedProvider);
    if (apiProvider) {
      setSelectedApiProvider(apiProvider);
      if (apiProvider === 'Google') setSelectedGoogleApiModelId(modelId!);
      else if (apiProvider === 'Groq') setSelectedGroqApiModelId(modelId!);
      else if (apiProvider === 'Cerebras') setSelectedCerebrasApiModelId(modelId!);
      else if (apiProvider === 'Routeway') setSelectedRoutewayApiModelId(modelId!);
      else if (apiProvider === 'Requesty') setSelectedRequestyApiModelId(modelId!);
      else if (apiProvider === 'Inception AI') setSelectedInceptionApiModelId(modelId!);
      else setSelectedNaraApiModelId(modelId!);
    }
    if (modelId?.startsWith('kilo/')) { setSelectedKiloModelId(modelId); setProvider('Kilo'); }
    if (modelId && ALL_OPEN_CODE_MODELS.some(model => model.id === modelId)) setSelectedOpenCodeModelId(modelId);
    setAccessMode(saved.accessMode ?? "Controlled");
    setProjectId(saved.projectId);
    const reviewMode = saved.designReviewMode ?? saved.turns.at(-1)?.designReviewMode;
    if (reviewMode) setDesignReviewMode(reviewMode);
    setDesignProfile(savedDesignProfile(saved.designProfile ?? saved.turns.at(-1)?.designProfile, reviewMode));
  }, [tasksHydrated, activeTaskId]);
  useEffect(() => {
    if (!activeTaskId) { setChanges([]); return; }
    let active = true;
    void window.orvixDesktop?.getAgentChanges(activeTaskId).then(value => { if (active) setChanges(value); }).catch(() => { if (active) setChanges([]); });
    return () => { active = false; };
  }, [activeTaskId]);
  useEffect(() => {
    if (!activeTaskId) { setWorkspaces([]); setWorkspaceTaskId(null); return; }
    let active = true;
    void window.orvixDesktop?.getAgentWorkspaces(activeTaskId).then(value => { if (active) { setWorkspaces(value); setWorkspaceTaskId(activeTaskId); } }).catch(() => { if (active) { setWorkspaces([]); setWorkspaceTaskId(null); } });
    return () => { active = false; };
  }, [activeTaskId]);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTaskMemory(null);
    if (!activeTaskId) return;
    let active = true;
    void window.orvixDesktop?.getAgentTaskMemory(activeTaskId).then(value => { if (active) setTaskMemory(value); }).catch(() => { if (active) setTaskMemory(null); });
    return () => { active = false; };
  }, [activeTaskId]);
  useEffect(() => {
    if (!activeTaskId) { setCheckpoint(null); return; }
    let active = true;
    void window.orvixDesktop?.getAgentCheckpoint(activeTaskId).then(value => {
      if (!active) return;
      setCheckpoint(value);
      if (value?.context) setContextUsage(activeTaskId, value.context);
    }).catch(() => { if (active) setCheckpoint(null); });
    return () => { active = false; };
  }, [activeTaskId]);
  useEffect(() => window.orvixDesktop?.onAgentEvent(event => {
    if (event.type === 'run_state' && event.run) {
      const record = event.run;
      observedRuns.current.set(event.taskId, { requestId: event.requestId, run: record, result: event.result, error: event.error });
      setTasks(current => current.map(task => task.id === event.taskId ? { ...task, unreadCompletion: record.status !== 'running' && event.taskId !== activeTaskIdRef.current ? true : task.unreadCompletion, turns: task.turns.map(turn => turn.id !== event.requestId ? turn : {
        ...turn, runState: record,
        ...(record.status === 'running' ? {} : event.result ? { reply: event.result.text, verification: event.result.verification, turnReport: event.result.turnReport, status: 'done' as const, error: undefined, completedAt: record.completedAt, activity: finishActivity(turn.activity) } : { status: 'error' as const, error: event.error || record.error || 'The run was interrupted.', completedAt: record.completedAt, activity: finishActivity(turn.activity) })
      }) } : task));
      if (record.status !== 'running') {
        endRun(event.taskId, event.requestId);
        if (event.taskId === activeTaskIdRef.current) void window.orvixDesktop?.getAgentCheckpoint(event.taskId).then(setCheckpoint).catch(() => {});
      }
    }
    if (event.type === "stream") setStreamPreviews(previews => {
      const current = previews[event.taskId];
      if (event.phase === "reset") return { ...previews, [event.taskId]: { taskId: event.taskId, requestId: event.requestId, text: "" } };
      if (event.phase === "delta" && event.delta) return {
        ...previews, [event.taskId]: { taskId: event.taskId, requestId: event.requestId,
        text: `${current?.taskId === event.taskId && current.requestId === event.requestId ? current.text : ""}${event.delta}`.slice(-60000)
      } };
      return previews;
    });
    if (event.type === "changes") {
      if (event.taskId === activeTaskIdRef.current) setChanges(event.files ?? []);
      setTasks(current => current.map(task => task.id === event.taskId
        ? { ...task, turns: task.turns.map(turn => turn.id === event.requestId ? {
          ...turn,
          liveFileChanges: event.turnFiles ?? event.files ?? [],
        } : turn) }
        : task));
    }
    if (event.type === "workspaces" && event.taskId === activeTaskIdRef.current) { setWorkspaces(event.roots ?? []); setWorkspaceTaskId(event.taskId ?? null); }
    if (event.type === "context" && Number.isFinite(event.historyBytes) && event.historyBytes! >= 0) {
      const historyBytes = Math.floor(event.historyBytes!);
      const estimatedTokens = Number.isFinite(event.estimatedTokens) && event.estimatedTokens! > 0
        ? Math.floor(event.estimatedTokens!) : Math.ceil(historyBytes / 4);
      const lastInputTokens = Number.isFinite(event.lastInputTokens) && event.lastInputTokens! > 0
        ? Math.floor(event.lastInputTokens!) : null;
      setContexts(current => ({ ...current, [event.taskId]: {
        historyBytes, estimatedTokens, budgetTokens: Number.isFinite(event.budgetTokens) && event.budgetTokens! > 0 ? Math.floor(event.budgetTokens!) : 200000,
        budgetSource: event.budgetSource === 'model' || event.budgetSource === 'catalog' || event.budgetSource === 'fallback' ? event.budgetSource : event.budgetTokens ? 'model' : 'fallback',
        lastInputTokens, contextSource: event.contextSource === 'provider' && lastInputTokens !== null ? 'provider' : 'estimate',
        estimateBasis: event.estimateBasis === 'saved-chat' ? 'saved-chat' : 'engine-history',
        compactions: Number.isFinite(event.compactions) && event.compactions! >= 0 ? Math.floor(event.compactions!) : 0,
        modelId: event.modelId, measuredAt: Number.isFinite(event.measuredAt) ? event.measuredAt : Date.now(),
      } }));
    }
    if (event.type === 'approval') {
      if (event.phase === 'remove') removedApprovals.current.add(event.approvalId!);
      setApprovals(current => event.phase === 'remove' ? current.filter(item => item.approvalId !== event.approvalId) : [...current.filter(item => item.approvalId !== event.approvalId), { taskId: event.taskId, requestId: event.requestId, approvalId: event.approvalId!, command: event.command, directory: event.directory, verification: event.verification, kind: event.kind, rename: event.rename, sandboxAvailable: event.sandboxAvailable, files: event.deletions, destructiveCommand: event.destructiveCommand }]);
    }
    if (event.type === 'clarification') setQuestions(current => { const next = { ...current }; if (event.phase === 'remove') delete next[event.taskId]; else next[event.taskId] = event.questionId!; return next; });
    if (event.type === "steer") {
      const steerActivity: AgentSteerActivity = {
        kind: "steer",
        id: event.steerId || crypto.randomUUID(),
        text: event.steerText || "",
        at: event.at || Date.now()
      };
      setTasks(current => current.map(task => task.id === event.taskId
        ? {
          ...task, turns: task.turns.map(turn => turn.id === event.requestId
            ? { ...turn, activity: boundActivity([...(turn.activity ?? []), steerActivity]) } : turn)
        } : task));
    }
    if (event.type === "activity") setTasks(current => current.map(task => task.id === event.taskId
      ? {
        ...task, turns: task.turns.map(turn => turn.id === event.requestId
        ? { ...turn, activity: boundActivity([...(turn.activity ?? []), event.message ?? "Working"]) } : turn)
      } : task));
    if (event.type === "model_progress" && event.progressId) setTasks(current => current.map(task => task.id === event.taskId
      ? { ...task, turns: task.turns.map(turn => {
        if (turn.id !== event.requestId) return turn;
        const previous = turn.activity ?? [];
        if (event.phase === "remove") return { ...turn, activity: previous.filter(item => typeof item === "string" || item.kind !== "progress" || item.id !== event.progressId) };
        if (!event.progressKind) return turn;
        const index = previous.findIndex(item => typeof item !== "string" && item.kind === "progress" && item.id === event.progressId);
        const existing = index >= 0 ? previous[index] as AgentProgressActivity : null;
        const startedAt = existing?.startedAt ?? Date.now();
        const completedAt = event.phase === "complete" ? Date.now() : undefined;
        const text = event.phase === "complete" || event.phase === "update" ? redactApiKeys(event.text ?? "")
          : `${existing?.text ?? ""}${redactApiKeys(event.text ?? "")}`.slice(0, event.progressId === 'website-design-options' ? 66000 : 16000);
        const progress: AgentProgressActivity = {
          kind: "progress", id: event.progressId!, category: event.progressKind!, text,
          providerId: event.providerId ?? existing?.providerId ?? "provider",
          providerLabel: event.providerLabel ?? existing?.providerLabel ?? "Provider",
          modelId: event.modelId ?? existing?.modelId ?? "",
          status: completedAt ? "completed" : "running", startedAt,
          durationMs: completedAt ? event.durationMs ?? Math.max(0, completedAt - startedAt) : existing?.durationMs,
        };
        return { ...turn, activity: boundActivity(index < 0 ? [...previous, progress] : previous.map((item, itemIndex) => itemIndex === index ? progress : item)) };
      }) } : task));
    if (event.type === "tool" && event.callId && event.name) setTasks(current => current.map(task => task.id === event.taskId
      ? {
        ...task, turns: task.turns.map(turn => {
          if (turn.id !== event.requestId) return turn;
          const previous = turn.activity ?? [];
          const existing = previous.findIndex(item => typeof item !== "string" && item.id === event.callId);
          const previousTool = existing >= 0 && typeof previous[existing] !== "string" ? previous[existing] as AgentToolActivity : undefined;
          const tool: AgentToolActivity = {
            kind: "tool", id: event.callId!, name: event.name!, detail: event.detail ?? "", input: compactActivityText(event.input, 1_500),
            startedAt: event.startedAt ?? Date.now(), durationMs: event.durationMs,
            taskId: event.taskId, requestId: event.requestId, evidenceId: event.evidenceId, output: event.output, failed: event.failed, truncated: event.truncated,
            reviewImages: event.reviewImages ?? previousTool?.reviewImages, status: event.phase === "completed" ? "completed" : "running",
          };
          const activity = existing < 0 ? [...previous, tool] : previous.map((item, index) => index === existing ? { ...(item as AgentToolActivity), ...tool } : item);
           return { ...turn, activity: boundActivity(activity) };
        })
      } : task));
  }) ?? (() => undefined), []);
  useEffect(() => {
    if (activeTaskId) localStorage.setItem("orvix.activeAgentTask", activeTaskId);
    else localStorage.removeItem("orvix.activeAgentTask");
  }, [activeTaskId]);

  useEffect(() => {
    if (!accessMenuOpen && !designMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (accessMenuOpen && !accessMenuRef.current?.contains(event.target as Node)) setAccessMenuOpen(false);
      if (designMenuOpen && !designMenuRef.current?.contains(event.target as Node)) setDesignMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setAccessMenuOpen(false); setDesignMenuOpen(false); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accessMenuOpen, designMenuOpen]);

  const refreshTaskMemory = async (taskId: string) => {
    try {
      const value = await window.orvixDesktop?.getAgentTaskMemory(taskId);
      if (activeTaskIdRef.current === taskId) setTaskMemory(value ?? null);
    } catch { if (activeTaskIdRef.current === taskId) setTaskMemory(null); }
  };

  const chooseModel = (modelId: string, variant?: string | null) => {
    const chosenVariant = variant !== undefined ? variant : activeTask?.modelId === modelId && activeTask.thinkingVariant !== undefined
      ? activeTask.thinkingVariant : thinkingPreferences[modelId] ?? null;
    setSelectedOpenCodeModelId(modelId);
    setProvider("OpenCode");
    setModelMenuOpen(false);
    setKiloMenuOpen(false);
    if (activeTaskId) setTasks(current => current.map(task => task.id === activeTaskId
      ? { ...task, modelId, thinkingVariant: chosenVariant } : task));
  };

  const toggleOpenCodeKeepAlive = async () => {
    if (!openCodeKeepAliveReady || openCodeKeepAliveSaving || !window.orvixDesktop?.setOpenCodeKeepAlive) return;
    const next = !openCodeKeepAlive;
    setOpenCodeKeepAliveSaving(true);
    try {
      const result = await window.orvixDesktop.setOpenCodeKeepAlive(next, provider === 'OpenCode' ? activeTaskId ?? undefined : undefined);
      setOpenCodeKeepAlive(result.keepAlive === true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update OpenCode keep-alive.');
    } finally { setOpenCodeKeepAliveSaving(false); }
  };

  const chooseKiloModel = (modelId: string, variant: string | null) => {
    setSelectedKiloModelId(modelId); setProvider('Kilo'); setKiloMenuOpen(false); setIoMenuOpen(false); setModelMenuOpen(false);
    setThinkingPreferences(current => { const next = { ...current }; if (variant) next[modelId] = variant; else delete next[modelId]; return next; });
    if (activeTaskId) setTasks(current => current.map(task => task.id === activeTaskId ? { ...task, modelId, thinkingVariant: variant } : task));
  };
  const chooseIoModel = (modelId: string, variant: string | null) => { setSelectedIoModelId(modelId); setProvider('I/O'); setIoMenuOpen(false); setKiloMenuOpen(false); setModelMenuOpen(false); setApiMenuOpen(false); setIoThinkingPreferences(current => { const next = { ...current }; if (variant) next[modelId] = variant; else delete next[modelId]; return next; }); if (activeTaskId) setTasks(current => current.map(task => task.id === activeTaskId ? { ...task, modelId, thinkingVariant: variant } : task)); };

  const chooseApiModel = (providerName: ApiProvider, modelId: string) => {
    if (providerName === 'Google') setSelectedGoogleApiModelId(modelId);
    else if (providerName === 'Groq') setSelectedGroqApiModelId(modelId);
    else if (providerName === 'Cerebras') setSelectedCerebrasApiModelId(modelId);
    else if (providerName === 'Routeway') setSelectedRoutewayApiModelId(modelId);
    else if (providerName === 'Requesty') setSelectedRequestyApiModelId(modelId);
    else if (providerName === 'Inception AI') setSelectedInceptionApiModelId(modelId);
    else setSelectedNaraApiModelId(modelId);
    setSelectedApiProvider(providerName);
    setProvider(providerName);
    setApiMenuOpen(false);
    setModelMenuOpen(false);
    setKiloMenuOpen(false); setIoMenuOpen(false);
    if (activeTaskId) setTasks(current => current.map(task => task.id === activeTaskId
      ? { ...task, modelId, thinkingVariant: thinkingPreferences[modelId] ?? null } : task));
  };

  const chooseApiThinking = (variant: string | null) => {
    if (!selectedApiMenuModelId || (variant && !apiMenuModel?.variants?.includes(variant))) return;
    setThinkingPreferences(current => { const next = { ...current }; if (variant) next[selectedApiMenuModelId] = variant; else delete next[selectedApiMenuModelId]; return next; });
    if (activeTaskId) setTasks(current => current.map(task => task.id === activeTaskId && task.modelId === selectedApiMenuModelId
      ? { ...task, thinkingVariant: variant } : task));
  };

  const startNewTask = () => {
    const id = crypto.randomUUID(); activeTaskIdRef.current = id;
    setActiveTaskId(id);
    setTaskMemory(null);
    setChanges([]);
    setWorkspaces([]);
    setWorkspaceTaskId(null);
    setCheckpoint(null);
    setScorecardOpen(false);
    setChangesOpen(false);
    setDesignOptionsPreview(null);
    setReviewTurnId(null);
    setReviewFile(null);
    setEditingTaskId(null);
    setSlashMenuDismissed(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const toggleScorecard = () => {
    if (scorecardOpen) {
      setScorecardOpen(false);
      return;
    }
    setScorecardTabOpen(true);
    setChangesOpen(true);
    setChangesMinimized(false);
    setChangesMaximized(false);
    setScorecardOpen(true);
  };
  const openTaskChanges = () => { setScorecardOpen(false); setFilePreview(null); setDesignOptionsPreview(null); setReviewTurnId(null); setReviewFile(null); setChangesMinimized(false); setChangesMaximized(false); setChangesOpen(true); };
  const openTurnChanges = (turnId: string, file?: string) => { setScorecardOpen(false); setFilePreview(null); setDesignOptionsPreview(null); setReviewTurnId(turnId); setReviewFile(file ?? null); setChangesMinimized(false); setChangesMaximized(false); setChangesOpen(true); };
  const openFilePreview = (file: string) => {
    if (!activeTaskId) return;
    setScorecardOpen(false);
    setChangesOpen(true); setChangesMinimized(false); setChangesMaximized(false);
    setDesignOptionsPreview(null);
    setReviewTurnId(null); setReviewFile(null);
    setFilePreview({ taskId: activeTaskId, file });
  };
  const openDesignOptionPreview = (choices: DesignOptionsPresentationResult, option: "A" | "B", turnId?: string) => {
    if (!activeTaskId) return;
    setDesignOptionsPreviewRevision(value => value + 1);
    setScorecardOpen(false);
    setChangesOpen(true); setChangesMinimized(false); setChangesMaximized(false);
    setFilePreview(null); setReviewTurnId(null); setReviewFile(null);
    setDesignOptionsPreview({ taskId: activeTaskId, turnId, choices, option });
  };
  const resizeChanges = (requestedWidth: number) => {
    const available = dashboardRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maximum = Math.max(360, Math.min(800, available - 320));
    setChangesWidth(Math.round(Math.max(360, Math.min(maximum, requestedWidth))));
  };
  const checkAndAdvanceQueue = (taskId: string) => {
    const queue = taskQueuesRef.current[taskId];
    if (!queue || queue.length === 0) return;
    const nextItem = queue[0];
    setTaskQueues(current => ({
      ...current,
      [taskId]: (current[taskId] ?? []).slice(1)
    }));
    setTimeout(() => {
      void sendPrompt(nextItem.prompt, nextItem.attachments, taskId);
    }, 60);
  };

  const queueMessage = () => {
    const prompt = draft.trim();
    if (!prompt && files.length === 0) return;
    const targetTaskId = activeTaskId ?? crypto.randomUUID();
    const command = parseAgentCommand(prompt);
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      taskId: targetTaskId,
      prompt,
      attachments: [...files],
      specialty: command.specialty,
      createdAt: Date.now()
    };
    if (!activeTaskId) {
      activeTaskIdRef.current = targetTaskId;
      setActiveTaskId(targetTaskId);
    }
    setTaskQueues(current => ({
      ...current,
      [targetTaskId]: [...(current[targetTaskId] ?? []), item]
    }));
    setDraft("");
    setFiles([]);
    setNotice("Message queued for next turn");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const steerActiveAgent = async (steerText?: string) => {
    const text = (steerText ?? draft).trim();
    if (!text) {
      setNotice("Type an instruction to steer the agent.");
      return;
    }
    const targetTaskId = runningTaskId ?? activeTaskId;
    if (!targetTaskId || !runningRequestId) {
      setNotice("No active run to steer.");
      return;
    }
    try {
      await window.orvixDesktop!.steerAgent(targetTaskId, text);
      if (!steerText) {
        setDraft("");
        setFiles([]);
      }
      setNotice("Steer directive sent — agent will pivot immediately");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send steer directive.");
    }
  };

  const removeQueuedMessage = (id: string) => {
    if (!activeTaskId) return;
    setTaskQueues(current => ({
      ...current,
      [activeTaskId]: (current[activeTaskId] ?? []).filter(item => item.id !== id)
    }));
  };

  const steerFromQueue = (item: QueuedMessage) => {
    removeQueuedMessage(item.id);
    void steerActiveAgent(item.prompt);
  };

  const editQueuedMessage = (item: QueuedMessage) => {
    setDraft(item.prompt);
    setFiles(item.attachments);
    removeQueuedMessage(item.id);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const runNextQueued = (taskId: string) => {
    const next = taskQueues[taskId]?.[0];
    if (!next) return;
    setTaskQueues(current => ({
      ...current,
      [taskId]: (current[taskId] ?? []).slice(1)
    }));
    void sendPrompt(next.prompt, next.attachments);
  };

  const clearTaskQueue = (taskId: string) => {
    setTaskQueues(current => ({
      ...current,
      [taskId]: []
    }));
  };

  const moveQueuedMessageToFront = (item: QueuedMessage) => {
    setTaskQueues(current => {
      const queue = current[item.taskId] ?? [];
      const index = queue.findIndex(entry => entry.id === item.id);
      if (index <= 0) return current;
      const reordered = [queue[index], ...queue.slice(0, index), ...queue.slice(index + 1)];
      return { ...current, [item.taskId]: reordered };
    });
    setQueueMenuId(null);
  };

  void steerFromQueue;
  void editQueuedMessage;
  void runNextQueued;
  void clearTaskQueue;

  const sendPrompt = async (queuedPrompt?: string, queuedFiles?: File[], queuedTaskId?: string) => {
    const targetTaskId = queuedTaskId ?? activeTaskIdRef.current ?? crypto.randomUUID();
    const targetTask = tasksRef.current.find(task => task.id === targetTaskId);
    const runModelId = queuedTaskId ? targetTask?.modelId ?? activeModelId : activeModelId;
    const runProvider: Provider = runModelId.startsWith('antigravity/') ? 'I/O' : runModelId.startsWith('kilo/') ? 'Kilo' : apiProviderForModel(runModelId) ?? 'OpenCode';
    const runModel = runProvider === 'I/O' ? ioCatalog.models.find(model => model.id === runModelId) : runProvider === 'Kilo' ? kiloCatalog.models.find(model => model.id === runModelId)
      : apiModelFor(runModelId) ?? ALL_OPEN_CODE_MODELS.find(model => model.id === runModelId);
    const requestedThinking = queuedTaskId ? targetTask?.thinkingVariant ?? null : activeThinkingVariant;
    const apiRunModel = apiModelFor(runModelId);
    const runThinking = apiRunModel ? requestedThinking && apiRunModel.variants?.includes(requestedThinking) ? requestedThinking : null : requestedThinking;
    const runAccess = queuedTaskId ? targetTask?.accessMode ?? accessMode : accessMode;
    const runProfile = queuedTaskId ? savedDesignProfile(targetTask?.designProfile, targetTask?.designReviewMode) : designProfile;
    const runDesign = targetTask ? (queuedTaskId ? targetTask.designReviewMode ?? 'fast' : designReviewMode) : 'fast';
    const prompt = queuedPrompt !== undefined ? queuedPrompt.trim() : draft.trim();
    const activeFiles = queuedFiles !== undefined ? queuedFiles : files;
    if ((!prompt && activeFiles.length === 0) || sendingRef.current.has(targetTaskId) || runningRequestsRef.current[targetTaskId]) return;
    if (!tasksHydrated) { setNotice("Wait for saved agent history to load before starting a task."); return; }
    const command = parseAgentCommand(prompt);
    if (command.specialty && !command.content) {
      setNotice("Add a website brief after /3d-website before sending.");
      composerRef.current?.focus();
      return;
    }
    sendingRef.current.add(targetTaskId);
    const keyCheck = isApiKeyCheck(prompt);
    if (!keyCheck && !runModel) { sendingRef.current.delete(targetTaskId); setNotice('Choose an available model. Refresh the catalog to check your connected and free models.'); return; }
    const apiTier = apiModelFor(runModelId)?.credentialTier;
    const isIo = runProvider === 'I/O';
    const tier: 'zen' | 'go' | 'kilo' | 'google' | 'groq' | 'cerebras' | 'nara' | 'routeway' | 'requesty' | 'inception' | 'none' = isIo ? 'none' : (apiTier ?? (runProvider === 'Kilo' ? 'kilo' : runModelId.startsWith('opencode-go/') ? 'go' : 'zen'));
    if (!keyCheck && !isIo && tier !== 'zen' && tier !== 'none' && !keyStatus?.[tier]?.configured) {
      sendingRef.current.delete(targetTaskId);
      if (apiTier) setKeySettingsProvider(apiTier);
      setKeyDialogOpen(true);
      setNotice(keyStatus?.[tier]?.keys?.length ? `Enable a ${runProvider} key to use this model.` : `Add your ${runProvider === 'OpenCode' ? 'OpenCode Go' : runProvider} key to use this model.`);
      return;
    }
    let sentContent = command.content;
    const images: AgentImage[] = [];
    try {
      for (const file of activeFiles) {
        if (/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
          if (!runModel?.input?.includes("image")) throw new Error(`${runModel?.name ?? 'This model'} has no confirmed image input. Choose an image-capable model.`);
          if (images.length >= 2) throw new Error("Attach at most two reference images per turn.");
          images.push(await prepareAgentImage(file));
          sentContent += `\n\nReference image: ${file.name}`;
          continue;
        }
        if (file.size > 80000) throw new Error(`${file.name} is too large. Attach a text file smaller than 80 KB.`);
        if (!/\.(txt|md|js|jsx|ts|tsx|json|jsonc|yaml|yml|py|go|rs|java|c|cc|cpp|h|hpp|css|scss|html|sql|sh|bat|ps1|toml|xml|vue|svelte|rb|php|swift|kt)$/i.test(file.name)) throw new Error(`${file.name} is not a supported text or code file.`);
        sentContent += `\n\nAttached file: ${file.name}\n\x60\x60\x60\n${await file.text()}\n\x60\x60\x60`;
      }
      if (sentContent.length > 95000) throw new Error("The prompt and attachments are too large. Use fewer or smaller files.");
    } catch (error) { sendingRef.current.delete(targetTaskId); setNotice(error instanceof Error ? error.message : "Could not read attachments."); return; }
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const taskId = targetTaskId;
    const turn: AgentTurn = {
      id,
      prompt: redactApiKeys(prompt),
      attachments: activeFiles.map(file => file.name),
      provider: runProvider,
      modelId: runModelId,
      thinkingVariant: keyCheck ? null : runThinking,
      accessMode: runAccess,
      specialty: command.specialty,
      sentContent: redactApiKeys(sentContent),
      designProfile: runProfile, designReviewMode: runDesign,
      keyCheck,
      status: "pending",
      createdAt,
      runStartedAt: createdAt,
    };
    if (targetTask) {
      setTasks(current => current.map(task => task.id === targetTask.id
        ? { ...task, unreadCompletion: false, accessMode: runAccess, designProfile: runProfile, designReviewMode: runDesign, modelId: runModelId, thinkingVariant: runThinking, turns: [...task.turns, turn], updatedAt: createdAt }
        : task));
    } else {
      setTasks(current => [{
        id: taskId,
        title: redactApiKeys(command.content).slice(0, 48) || activeFiles[0]?.name || "Untitled agent task",
        projectId, accessMode: runAccess, designProfile: runProfile, designReviewMode: runDesign, accessModeVersion: 2, modelId: runModelId, thinkingVariant: runThinking,
        turns: [turn],
        createdAt,
        updatedAt: createdAt,
      }, ...current]);
      if (!queuedTaskId) { activeTaskIdRef.current = taskId; setActiveTaskId(taskId); }
    }
    if (activeTaskIdRef.current === taskId) jumpToLatest();
    if (queuedPrompt === undefined) {
      setDraft("");
      setSlashMenuDismissed(false);
      setFiles([]);
    }
    setNotice("");
    beginRun(taskId, id);
    if (activeTaskIdRef.current === taskId) setCheckpoint(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const previousMessages = contextMessages(targetTask?.turns ?? []);
    let runSuccess = false;
    try {
      const response = await window.orvixDesktop!.runAgent({
        requestId: id, taskId, modelId: runModelId, thinkingVariant: runThinking, accessMode: runAccess, accessModeVersion: 2,
        contextLimitTokens: runModel?.contextLength ?? undefined,
        designProfile: runProfile, designReviewMode: runDesign,
        specialty: command.specialty,
        goal: parseAgentCommand(targetTask?.turns[0]?.prompt ?? prompt).content,
        images,
        messages: [...previousMessages, { role: "user" as const, content: sentContent }].slice(-19).map(message => ({ ...message, content: message.content.slice(-95000) })),
      });
      if (!response.ok) throw new Error(response.error);
      const result = response.result;
      if (activeTaskIdRef.current === taskId) { setChanges(result.changes); setCheckpoint(null); }
      setTasks(current => current.map(task => task.id === taskId ? { ...task, unreadCompletion: activeTaskIdRef.current !== taskId, updatedAt: Date.now(), turns: task.turns.map(item => item.id === id ? { ...item, reply: result.text, verification: result.turnReport?.verification ?? result.verification, turnReport: result.turnReport, status: "done", completedAt: Date.now() } : item) } : task));
      runSuccess = true;
    } catch (error) {
      void window.orvixDesktop?.getAgentCheckpoint(taskId).then(value => { if (activeTaskIdRef.current === taskId) setCheckpoint(value); }).catch(() => { if (activeTaskIdRef.current === taskId) setCheckpoint(null); });
      const report = await window.orvixDesktop?.getAgentTurnReport(taskId, id).catch(() => null);
      const message = error instanceof Error ? error.message : "The OpenCode request failed.";
      setTasks(current => current.map(task => task.id === taskId ? { ...task, unreadCompletion: activeTaskIdRef.current !== taskId, updatedAt: Date.now(), turns: task.turns.map(item => item.id === id ? { ...item, error: message, verification: report?.verification ?? undefined, turnReport: report, status: "error", activity: finishActivity(item.activity), completedAt: Date.now() } : item) } : task));
    } finally {
      endRun(taskId, id);
      void refreshTaskMemory(taskId);
      if (runSuccess) {
        checkAndAdvanceQueue(taskId);
      }
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && slashMenuOpen) {
      event.preventDefault();
      setSlashMenuDismissed(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (slashMenuOpen) { selectWebsiteCommand(); return; }
      if (runningRequestId) {
        queueMessage();
        return;
      }
      void sendPrompt();
    }
  };

  const selectWebsiteCommand = () => {
    setDraft(`${websiteCommand} `);
    setSlashMenuDismissed(true);
    setNotice("");
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const retryTurn = async (turn: AgentTurn, replacementModelId?: string) => {
    if (!activeTask || !turn.modelId || turn.keyCheck || sendingRef.current.has(activeTask.id) || runningRequestsRef.current[activeTask.id]) return;
    if (!tasksHydrated) { setNotice("Wait for saved agent history to load before retrying a task."); return; }
    const taskId = activeTask.id;
    sendingRef.current.add(taskId);
    const resume = !replacementModelId && checkpoint?.requestId === turn.id && checkpoint.safe;
    if (!resume && turn.attachments.some(name => /\.(?:png|jpe?g|webp)$/i.test(name))) {
      sendingRef.current.delete(taskId);
      setNotice("Reattach the reference image to retry this turn. Saved images are available only to a safe resume.");
      return;
    }
    const modelId = replacementModelId ?? (resume ? checkpoint.modelId : turn.modelId);
    const contextLimitTokens = modelId?.startsWith('antigravity/')
      ? ioCatalog.models.find(model => model.id === modelId)?.contextLength ?? undefined
      : modelId?.startsWith('kilo/')
      ? kiloCatalog.models.find(model => model.id === modelId)?.contextLength ?? undefined
      : apiModelFor(modelId)?.contextLength ?? ALL_OPEN_CODE_MODELS.find(model => model.id === modelId)?.contextLength ?? undefined;
    const requestedThinking = replacementModelId ? null : resume ? checkpoint.thinkingVariant : turn.thinkingVariant ?? null;
    const apiRetryModel = apiModelFor(modelId);
    const thinkingVariant = apiRetryModel ? requestedThinking && apiRetryModel.variants?.includes(requestedThinking) ? requestedThinking : null : requestedThinking;
    const runAccessMode = resume ? checkpoint.accessMode : turn.accessMode ?? "Controlled";
    const specialty = resume ? checkpoint.specialty ?? turn.specialty : turn.specialty ?? parseAgentCommand(turn.prompt).specialty;
    const apiProvider = apiProviderForModel(modelId);
    if (modelId?.startsWith('antigravity/')) { setSelectedIoModelId(modelId); setProvider('I/O'); }
    else if (modelId?.startsWith('kilo/')) { setSelectedKiloModelId(modelId); setProvider('Kilo'); }
    else if (apiProvider && modelId) {
      setProvider(apiProvider); setSelectedApiProvider(apiProvider);
      if (apiProvider === 'Google') setSelectedGoogleApiModelId(modelId);
      else if (apiProvider === 'Groq') setSelectedGroqApiModelId(modelId);
      else if (apiProvider === 'Cerebras') setSelectedCerebrasApiModelId(modelId);
      else if (apiProvider === 'Routeway') setSelectedRoutewayApiModelId(modelId);
      else if (apiProvider === 'Requesty') setSelectedRequestyApiModelId(modelId);
      else if (apiProvider === 'Inception AI') setSelectedInceptionApiModelId(modelId);
      else setSelectedNaraApiModelId(modelId);
    } else { if (modelId) setSelectedOpenCodeModelId(modelId); setProvider('OpenCode'); }
    const earlier = contextMessages(activeTask.turns.slice(0, activeTask.turns.findIndex(item => item.id === turn.id)));
    beginRun(taskId, turn.id);
    const nextProvider: Provider = modelId?.startsWith('antigravity/') ? 'I/O' : modelId?.startsWith('kilo/') ? 'Kilo' : apiProvider ?? 'OpenCode';
    setTasks(current => current.map(task => task.id === taskId ? { ...task, modelId, thinkingVariant, turns: task.turns.map(item => item.id === turn.id ? { ...item, provider: nextProvider, modelId, thinkingVariant, accessMode: runAccessMode, specialty, designProfile: savedDesignProfile(turn.designProfile, turn.designReviewMode), status: "pending", error: undefined, reply: undefined, verification: undefined, turnReport: undefined, liveFileChanges: null, completedAt: undefined, runStartedAt: Date.now(), activity: [] } : item) } : task));
    try {
      const response = await window.orvixDesktop!.runAgent({
        requestId: turn.id, taskId, modelId, thinkingVariant, accessMode: runAccessMode, accessModeVersion: 2, resume, specialty,
        contextLimitTokens,
        designProfile: savedDesignProfile(turn.designProfile, turn.designReviewMode),
        designReviewMode: turn.designReviewMode ?? 'balanced',
        goal: parseAgentCommand(activeTask.turns[0]?.prompt ?? turn.prompt).content,
        messages: [...earlier, { role: "user" as const, content: turn.sentContent ?? parseAgentCommand(turn.prompt).content }].slice(-19).map(message => ({ ...message, content: message.content.slice(-95000) })),
      });
      if (!response.ok) throw new Error(response.error);
      const result = response.result;
      if (activeTaskIdRef.current === taskId) { setChanges(result.changes); setCheckpoint(null); }
      setTasks(current => current.map(task => task.id === taskId ? { ...task, updatedAt: Date.now(), turns: task.turns.map(item => item.id === turn.id ? { ...item, status: "done", reply: result.text, verification: result.turnReport?.verification ?? result.verification, turnReport: result.turnReport, error: undefined, completedAt: Date.now() } : item) } : task));
    } catch (error) {
      void window.orvixDesktop?.getAgentCheckpoint(taskId).then(value => { if (activeTaskIdRef.current === taskId) setCheckpoint(value); }).catch(() => { if (activeTaskIdRef.current === taskId) setCheckpoint(null); });
      const report = await window.orvixDesktop?.getAgentTurnReport(taskId, turn.id).catch(() => null);
      const message = error instanceof Error ? error.message : "The OpenCode request failed.";
      setTasks(current => current.map(task => task.id === taskId ? { ...task, updatedAt: Date.now(), turns: task.turns.map(item => item.id === turn.id ? { ...item, status: "error", error: message, verification: report?.verification ?? undefined, turnReport: report, activity: finishActivity(item.activity), completedAt: Date.now() } : item) } : task));
    } finally { endRun(taskId, turn.id); void refreshTaskMemory(taskId); }
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    setFiles(current => [...current, ...Array.from(selected)].slice(0, 5));
  };

  const openTask = (task: AgentTask) => {
    activeTaskIdRef.current = task.id;
    setActiveTaskId(task.id);
    setTaskMemory(null);
    setChanges([]);
    if (task.id !== activeTaskId) { setWorkspaces([]); setWorkspaceTaskId(null); }
    setCheckpoint(null);
    setChangesOpen(false);
    setChangesMinimized(false);
    setChangesMaximized(false);
    setFilePreview(null);
    setDesignOptionsPreview(null);
    setReviewTurnId(null);
    setReviewFile(null);
    setEditingTaskId(null);
    const previousModelId = task.modelId ?? task.turns.at(-1)?.modelId;
    if (!task.modelId && previousModelId) setTasks(current => current.map(item => item.id === task.id
      ? { ...item, modelId: previousModelId, thinkingVariant: task.turns.at(-1)?.thinkingVariant ?? null } : item));
    setTasks(current => current.map(item => item.id === task.id ? { ...item, unreadCompletion: false } : item));
  };

  useEffect(() => {
    if (!notificationTarget || !tasksHydrated) return;
    let alive = true;
    const finish = () => { if (alive) onNotificationHandled(notificationTarget.notificationId); };
    const task = tasksRef.current.find(item => item.id === notificationTarget.taskId);
    if (!task) {
      setNotice('This Agent task is no longer available.');
      finish();
      return () => { alive = false; };
    }
    openTask(task);
    if (notificationTarget.eventKind === 'question' && notificationTarget.questionId) {
      void window.orvixDesktop?.getAgentQuestion(notificationTarget.taskId, notificationTarget.requestId).then(value => {
        if (!alive || !value || value.questionId !== notificationTarget.questionId) return;
        setQuestions(current => ({ ...current, [notificationTarget.taskId]: value.questionId }));
        if (runningRequestsRef.current[notificationTarget.taskId] !== notificationTarget.requestId) beginRun(notificationTarget.taskId, notificationTarget.requestId);
      }).catch(() => {}).finally(finish);
    } else if (notificationTarget.eventKind === 'permission' && notificationTarget.approvalId) {
      void window.orvixDesktop?.getAgentApproval(notificationTarget.taskId).then(value => {
        if (!alive || !value || value.approvalId !== notificationTarget.approvalId || value.requestId !== notificationTarget.requestId || removedApprovals.current.has(value.approvalId)) return;
        setApprovals(current => [...current.filter(item => item.approvalId !== value.approvalId), value]);
      }).catch(() => {}).finally(finish);
    } else finish();
    return () => { alive = false; };
  }, [notificationTarget, tasksHydrated]);

  const startRename = (task: AgentTask) => {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  };

  const saveRename = (event: FormEvent, id: string) => {
    event.preventDefault();
    const title = editingTitle.trim();
    if (!title) return;
    setTasks(current => current.map(task => task.id === id ? { ...task, title, updatedAt: Date.now() } : task));
    setEditingTaskId(null);
  };

  const deleteTask = async (id: string) => {
    if (tasks.find(task => task.id === id)?.turns.some(turn => turn.status === "pending")) { setNotice("Stop the running agent before deleting this task."); return; }
    try {
      if (!window.orvixDesktop) throw new Error('Desktop cleanup is unavailable.');
      await window.orvixDesktop.forgetAgentChanges(id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete the chat records. Please retry.');
      return;
    }
    setTasks(current => current.filter(task => task.id !== id));
    setTaskQueues(current => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (activeTaskIdRef.current === id) {
      activeTaskIdRef.current = null;
      setActiveTaskId(null);
      setTaskMemory(null);
      setChangesOpen(false);
      setChangesMinimized(false);
      setChangesMaximized(false);
      setFilePreview(null);
      setDesignOptionsPreview(null);
      setReviewTurnId(null);
      setReviewFile(null);
      setDraft("");
      setFiles([]);
    }
    if (editingTaskId === id) setEditingTaskId(null);
  };

  const saveGoKey = async () => {
    const key = goKeyDraft;
    if (!key.trim()) return;
    try {
      const status = await window.orvixDesktop!.setOpenCodeKey("go", key);
      setKeyStatus(status);
      setKeyError("");
      setGoKeyDraft("");
      setNotice("");
    } catch (error) { setKeyError(error instanceof Error ? error.message : "Could not save the key."); }
  };
  const saveKiloKey = async () => {
    if (!kiloKeyDraft.trim()) return;
    try { setKeyStatus(await window.orvixDesktop!.setOpenCodeKey('kilo', kiloKeyDraft)); setKiloKeyDraft(''); setKeyError(''); setNotice(''); }
    catch (error) { setKeyError(error instanceof Error ? error.message : 'Could not save the Kilo key.'); }
  };

  const changeApiKey = async (tier: ApiModel['credentialTier'], input: AgentApiKeyMutation) => {
    if (keyBusy) return false;
    setKeyBusy(true); setKeyError(''); setKeyFeedback('');
    try {
      setKeyStatus(await window.orvixDesktop!.changeAgentProviderKey(tier, input));
      if (input.operation === 'remove' && input.id === editingApiKeyId) { setEditingApiKeyId(null); setApiKeyLabel(''); setApiKeyDrafts(current => ({ ...current, [tier]: '' })); }
      setKeyFeedback(input.operation === 'add' ? 'Key added to .env.' : input.operation === 'update' ? 'Key replaced in .env.' : input.operation === 'remove' ? 'Key removed.' : 'Key status updated.');
      return true;
    } catch (error) { setKeyError(error instanceof Error ? error.message : 'Could not update this key.'); return false; }
    finally { setKeyBusy(false); }
  };
  const saveApiKey = async (tier: ApiModel['credentialTier']) => {
    if (!apiKeyDrafts[tier].trim()) return;
    if (await changeApiKey(tier, { operation: editingApiKeyId ? 'update' : 'add', id: editingApiKeyId ?? undefined, label: apiKeyLabel, key: apiKeyDrafts[tier] })) {
      setApiKeyDrafts(current => ({ ...current, [tier]: '' })); setApiKeyLabel(''); setEditingApiKeyId(null); setNotice('');
    }
  };

  const removeKey = async (tier: "zen" | "go" | "kilo" | "google" | "groq" | "cerebras" | "nara" | "routeway" | "requesty") => {
    try { setKeyStatus(await window.orvixDesktop!.setOpenCodeKey(tier, "")); setKeyError(""); }
    catch (error) { setKeyError(error instanceof Error ? error.message : "Could not remove the key."); }
  };

  const currentQueue = activeTaskId ? (taskQueues[activeTaskId] ?? []) : [];
  const taskLineCountsLimited = changes.some(change => !change.directory && !change.binary && change.diffAvailable === false);
  const queueBar = currentQueue.length > 0 ? (
    <div className="agent-queue-bar" role="region" aria-label={`Queued messages, ${currentQueue.length}`}>
      <div className="agent-queue-list">
        {currentQueue.map((item, idx) => (
          <div className="agent-queue-card" key={item.id}>
            <CornerDownRight size={14} className="agent-queue-leading-icon" aria-hidden="true" />
            <div className="agent-queue-card-content" title={item.prompt || "Attachments only"}>
              <p className="agent-queue-card-text">{item.prompt || "Attachments only"}</p>
              {item.attachments.length > 0 && <span className="agent-queue-attachment-count"><Paperclip size={11} />{item.attachments.length}</span>}
            </div>
            <div className="agent-queue-card-actions" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setQueueMenuId(null); }} onKeyDown={event => { if (event.key === "Escape") setQueueMenuId(null); }}>
              {runningRequestId && runningTaskId === activeTaskId ? <button type="button" className="agent-queue-steer" title="Steer the running agent with this instruction" aria-label="Steer agent with queued message" onClick={() => steerFromQueue(item)}><span>Steer</span><CornerDownRight size={13} /></button>
                : !runningRequestId ? <button type="button" className="agent-queue-steer" title="Run this queued message now" aria-label="Run queued message now" onClick={() => { removeQueuedMessage(item.id); void sendPrompt(item.prompt, item.attachments); }}><span>Run</span><Play size={12} /></button> : null}
              <button type="button" className="agent-queue-icon-action is-remove" title="Remove from queue" aria-label="Remove queued message" onClick={() => removeQueuedMessage(item.id)}><Trash2 size={14} /></button>
              <div className="agent-queue-more-wrap">
                <button type="button" className="agent-queue-icon-action" title="More queue options" aria-label={`More options for queued message ${idx + 1}`} aria-haspopup="menu" aria-expanded={queueMenuId === item.id} onClick={() => setQueueMenuId(id => id === item.id ? null : item.id)}><Ellipsis size={16} /></button>
                {queueMenuId === item.id && <div className="agent-queue-more-menu" role="menu" aria-label="Queued message options">
                  <button type="button" role="menuitem" onClick={() => { setQueueMenuId(null); editQueuedMessage(item); }}><Pencil size={13} />Edit in composer</button>
                  {idx > 0 && <button type="button" role="menuitem" onClick={() => moveQueuedMessageToFront(item)}><CornerDownRight size={13} />Move to next</button>}
                  {!runningRequestId && <button type="button" role="menuitem" onClick={() => { setQueueMenuId(null); removeQueuedMessage(item.id); void sendPrompt(item.prompt, item.attachments); }}><Play size={13} />Run now</button>}
                  <button type="button" role="menuitem" className="is-remove" onClick={() => { setQueueMenuId(null); removeQueuedMessage(item.id); }}><Trash2 size={13} />Remove from queue</button>
                </div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const composer = <div className="agent-composer-block">
    {slashMenuOpen && <div id="agent-slash-suggestions" className="agent-slash-menu" role="listbox" aria-label="Agent commands">
      <button type="button" role="option" aria-selected="true" className="agent-slash-option" onMouseDown={event => event.preventDefault()} onClick={selectWebsiteCommand}>
        <span className="agent-slash-name">/3d-website</span><span className="agent-slash-description">Scroll responsive 3D website</span><kbd>Enter</kbd>
      </button>
    </div>}
    <div className="agent-composer">
      <textarea
        ref={composerRef}
        value={draft}
        onChange={event => { setDraft(event.target.value); setSlashMenuDismissed(false); }}
        onKeyDown={onComposerKeyDown}
        placeholder={turns.length ? "Continue the task, or ask for a change…" : "Describe what you want to build, fix, or explore…"}
        aria-label="Agent prompt"
        aria-haspopup="listbox"
        aria-expanded={slashMenuOpen}
        aria-controls={slashMenuOpen ? "agent-slash-suggestions" : undefined}
        rows={2}
      />
      {files.length > 0 && <div className="agent-attachments">{files.map((file, index) => <span key={`${file.name}-${index}`}><Paperclip size={12} />{file.name}<button aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></span>)}</div>}
      <div className="agent-composer-toolbar">
        <div className="agent-composer-left">
          <input ref={fileInputRef} type="file" multiple hidden onChange={event => addFiles(event.target.files)} />
          <button className="agent-icon-button" aria-label="Add attachments" title="Add attachments" onClick={() => fileInputRef.current?.click()}><Plus size={20} /></button>
          <div className="agent-access-wrap" ref={accessMenuRef}>
            <button type="button" className={`agent-access${accessMode === "Plan" ? " is-plan" : accessMode === "Full access" ? " is-full" : ""}`} aria-label={`Access mode: ${accessMode}`} aria-haspopup="menu" aria-expanded={accessMenuOpen} onClick={() => setAccessMenuOpen(open => !open)}>
              <span className="agent-access-icon">!</span>{accessMode}
            </button>
            {accessMenuOpen && <div className="agent-access-menu" role="menu" aria-label="Choose access mode">
              {(["Plan", "Full access", "Controlled"] as const).map(option => <button key={option} type="button" role="menuitemradio" aria-checked={accessMode === option} className={accessMode === option ? "selected" : ""} onClick={() => { setAccessMode(option); if (activeTaskId) setTasks(current => current.map(task => task.id === activeTaskId ? { ...task, accessMode: option, accessModeVersion: 2 } : task)); setAccessMenuOpen(false); }}><span>{option}</span><small>{option === "Plan" ? "Research and plan" : option === "Full access" ? "Run actions without permission prompts" : "Ask before access, commands, and deletions"}</small></button>)}
            </div>}
          </div>
          <div className="agent-access-wrap agent-design-review-wrap" ref={designMenuRef}>
            <button type="button" className="agent-design-review" aria-label={`Website design profile: ${designProfileLabel(designProfile)}`} aria-haspopup="menu" aria-expanded={designMenuOpen} disabled={Boolean(runningRequestId)} onClick={() => setDesignMenuOpen(open => !open)}>
              {designProfileLabel(designProfile)}
            </button>
            {designMenuOpen && <div className="agent-access-menu agent-design-profile-menu" role="menu" aria-label="Choose website design profile">
              {([
                { value: "none", label: "None", description: "Use the model’s own judgment without automatic website skills or design reviews." },
                { value: "normal", label: "Default", description: "Use Orvix’s normal website design skill." },
                { value: "medium", label: "Design Medium", description: "Add light motion and a more distinctive composition." },
                { value: "max", label: "Design MAX", description: "Use expressive composition and a signature experience." },
              ] as const).map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={designProfile === option.value} className={designProfile === option.value ? "selected" : ""} onClick={() => { setDesignProfile(option.value); setTasks(current => current.map(task => task.id === activeTaskId ? { ...task, designProfile: option.value } : task)); setDesignMenuOpen(false); }}><span>{option.label}</span><small>{option.description}</small></button>)}
            </div>}
          </div>
        </div>
        <div className="agent-composer-right">
          <button type="button" className="agent-provider-label" aria-label="Choose model" aria-haspopup="menu" aria-expanded={provider === "I/O" ? ioMenuOpen : provider === "Kilo" ? kiloMenuOpen : apiProviderForModel(activeModelId) ? apiMenuOpen : modelMenuOpen} onClick={() => { if (provider === "I/O") { ioButtonRef.current?.focus(); setIoMenuOpen(true); setKiloMenuOpen(false); setModelMenuOpen(false); setApiMenuOpen(false); void refreshIo(); } else if (provider === "Kilo") { kiloButtonRef.current?.focus(); setKiloMenuOpen(true); setIoMenuOpen(false); setModelMenuOpen(false); setApiMenuOpen(false); void refreshKilo(); } else if (apiProviderForModel(activeModelId)) { setApiMenuOpen(true); setModelMenuOpen(false); setKiloMenuOpen(false); setIoMenuOpen(false); } else { modelButtonRef.current?.focus(); setModelMenuOpen(true); setKiloMenuOpen(false); setIoMenuOpen(false); setApiMenuOpen(false); } }}>
            <span>{activeModel?.name ?? "Choose a model"}</span><small>{activeProviderLabel}{activeProviderLabel && activeThinkingVariant ? " · " : ""}{activeThinkingVariant ? thinkingLabel(activeThinkingVariant) : ""}</small>
            <ChevronDown size={13} />
          </button>
          {runningRequestId && runningTaskId === activeTaskId ? (
            <div className="agent-running-actions">
              {(draft.trim() || files.length > 0) && (
                <>
                  <button
                    type="button"
                    className="agent-steer-btn"
                    title="Steer agent immediately with this instruction (interrupts active tool batch and pivots)"
                    aria-label="Steer agent immediately"
                    onClick={() => void steerActiveAgent()}
                  >
                    <Compass size={13} />
                    <span>Steer</span>
                  </button>
                  <button
                    type="button"
                    className="agent-queue-btn"
                    title="Queue this message to run automatically after current turn completes"
                    aria-label="Queue message for next turn"
                    onClick={queueMessage}
                  >
                    <ListOrdered size={13} />
                    <span>Queue</span>
                  </button>
                </>
              )}
              <button
                className="agent-send agent-stop"
                aria-label="Stop response"
                title="Stop response"
                onClick={() => { if (runningTaskId) window.orvixDesktop?.cancelAgent(runningTaskId); }}
              >
                <Square size={14} fill="currentColor" />
              </button>
            </div>
          ) : (
            <button
              className="agent-send"
              aria-label="Send prompt"
              title={runningRequestId ? "Another task is running" : "Send prompt"}
              disabled={Boolean(runningRequestId) || (!draft.trim() && files.length === 0)}
              onClick={() => void sendPrompt()}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
    {notice && <div className="agent-notice" role="status">{notice}</div>}
  </div>;

  const activeFilePreview = filePreview?.taskId === activeTaskId;
  const activeDesignOptionsPreview = designOptionsPreview?.taskId === activeTaskId;
  const designOptionsTurn = activeDesignOptionsPreview ? activeTask?.turns.find(turn => turn.id === designOptionsPreview?.turnId) : undefined;
  const liveOptionsActivity = designOptionsTurn?.activity?.find((item): item is AgentProgressActivity => typeof item !== 'string' && item.kind === 'progress' && item.id === designOptionsPreview?.choices.sourceId);
  const liveOptionsChoices = liveOptionsActivity ? designOptionsPresentation(liveOptionsActivity.text, liveOptionsActivity.status === 'running' && designOptionsTurn?.status === 'pending') : null;
  const liveOptionsPreview = activeDesignOptionsPreview ? { ...designOptionsPreview!, choices: liveOptionsChoices ?? designOptionsPreview!.choices } : null;
  const viewerOpen = changesOpen || activeFilePreview || activeDesignOptionsPreview || scorecardOpen;
  const focusedPanel = viewerOpen && changesMaximized;
  return <div className="agent-workspace-frame">
    <div ref={dashboardRef} style={{ "--agent-changes-width": `${changesWidth}px` } as CSSProperties} className={`agent-dashboard${historyVisible ? "" : " history-hidden"}${viewerOpen ? ` changes-open changes-${changesDock}` : ""}${changesMinimized ? " changes-minimized" : ""}${changesMaximized ? " changes-maximized" : ""}`}>
    <div className="agent-toolbar" inert={focusedPanel} aria-hidden={focusedPanel}>
      <div className="agent-toolbar-layout">
      <div className="agent-toolbar-title"><Folder size={17} /><strong title={threadTitle}>{threadTitle}</strong>{workspaces.length > 0 && <span className="agent-workspace-count" title={workspaces.join("\n")}>{workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}</span>}<span className="agent-context-count" title={contextTooltip} aria-label={contextPercent === '—' ? 'Context usage not measured yet' : `${contextPercent} context used`}>{contextPercent}</span></div>
      <div className="agent-provider-switch" role="group" aria-label="Agent provider">
        <div className="agent-opencode-wrap agent-opencode-keepalive-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setModelMenuOpen(false); }} onKeyDown={event => { if (event.key === "Escape") { setModelMenuOpen(false); (event.target === keepAliveButtonRef.current ? keepAliveButtonRef.current : modelButtonRef.current)?.focus(); } }}>
          <button ref={modelButtonRef} type="button" className={provider === "OpenCode" ? "selected" : ""} aria-pressed={provider === "OpenCode"} aria-haspopup="menu" aria-expanded={modelMenuOpen} onClick={() => { setProvider("OpenCode"); setKiloMenuOpen(false); setApiMenuOpen(false); setModelMenuOpen(open => !open); }}>OpenCode</button>
          <button ref={keepAliveButtonRef} type="button" className={`agent-keepalive-control${openCodeKeepAlive ? ' is-on' : ''}`} aria-label={`Keep OpenCode connected: ${openCodeKeepAlive ? 'On' : 'Default'}`} title={openCodeKeepAlive ? 'Keep OpenCode workers connected until Orvix closes' : 'Default: stop OpenCode workers after two idle minutes'} aria-pressed={openCodeKeepAlive} disabled={!openCodeKeepAliveReady || openCodeKeepAliveSaving} onClick={() => void toggleOpenCodeKeepAlive()}>{openCodeKeepAlive ? <Pin size={12} /> : <PinOff size={12} />}<span>{openCodeKeepAlive ? 'On' : 'Default'}</span></button>
          {modelMenuOpen && <div className="agent-opencode-menu" role="menu" aria-label="OpenCode models">
            <div className="agent-opencode-menu-head"><div className="agent-opencode-menu-title"><strong>OpenCode models</strong><small className="agent-opencode-menu-status" role="status" title={openCodeCatalog.error || undefined}>{openCodeCatalog.error || (openCodeCatalog.stale ? 'Saved list · refresh to check availability' : `${ZEN_FREE_MODELS.length} free models · updated ${new Date(openCodeCatalog.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)}</small></div><div><button type="button" onClick={() => void refreshOpenCode(true)} disabled={openCodeLoading || Boolean(runningRequestId)}><RotateCcw size={13} /> {openCodeLoading ? 'Refreshing…' : 'Refresh'}</button><button type="button" onClick={() => { setKeyDialogOpen(true); setModelMenuOpen(false); }}><KeyRound size={13} /> Keys</button></div></div>
            <div className="agent-opencode-menu-body">
              <div className="agent-opencode-menu-scroll">
                {([{ title: "Zen Free", badge: "Free", models: ZEN_FREE_MODELS }, { title: "Go", badge: "Go plan", models: GO_MODELS }] as const).map(group => <div className="agent-opencode-group" role="group" aria-label={`${group.title} ${group.badge} models`} key={group.title}>
                  <div className="agent-opencode-group-heading"><span>{group.title}</span><small>{group.badge}</small><em>{group.models.length}</em></div>
                  {group.models.map(model => <button key={model.id} type="button" role="menuitemradio" aria-checked={selectedOpenCodeModelId === model.id} title={model.name} className={`agent-opencode-model${selectedOpenCodeModelId === model.id ? " selected" : ""}`} onMouseEnter={() => setHoveredOpenCodeModelId(model.id)} onFocus={() => setHoveredOpenCodeModelId(model.id)} onClick={() => chooseModel(model.id)}>
                    <span><strong>{model.name}</strong></span><span className="agent-opencode-model-end">{selectedOpenCodeModelId === model.id && <Check size={14} />}{thinkingVariantsFor(model.id).length > 0 && <ChevronRight size={13} />}</span>
                  </button>)}
                </div>)}
                {openCodeCatalog.excluded.length > 0 && <details className="agent-opencode-catalog-note"><summary>{openCodeCatalog.excluded.length} models unavailable for this agent</summary>{openCodeCatalog.excluded.map(model => <p key={model.id}><strong>{model.name}</strong><br />{model.reason}</p>)}</details>}
              </div>
              <div className="agent-thinking-panel" aria-label={`Thinking settings for ${hoveredOpenCodeModel.name}`}>
                <div className="agent-thinking-panel-head"><span>Thinking</span><strong>{hoveredOpenCodeModel.name}</strong></div>
                {thinkingVariantsFor(hoveredOpenCodeModel.id).length > 0 ? <>
                  <p>Choose a level for this model.</p>
                  <div className="agent-thinking-options" role="group" aria-label={`Thinking levels for ${hoveredOpenCodeModel.name}`}>
                    <button type="button" className={!hoveredThinkingVariant ? "selected" : ""} onClick={() => { setThinkingPreferences(current => { const next = { ...current }; delete next[hoveredOpenCodeModel.id]; return next; }); chooseModel(hoveredOpenCodeModel.id, null); }}><span>Default</span>{!hoveredThinkingVariant && <Check size={14} />}</button>
                    {thinkingVariantsFor(hoveredOpenCodeModel.id).map(variant => <button key={variant} type="button" className={hoveredThinkingVariant === variant ? "selected" : ""} onClick={() => { setThinkingPreferences(current => ({ ...current, [hoveredOpenCodeModel.id]: variant })); chooseModel(hoveredOpenCodeModel.id, variant); }}><span>{thinkingLabel(variant)}</span>{hoveredThinkingVariant === variant && <Check size={14} />}</button>)}
                  </div>
                </> : <div className="agent-thinking-unavailable">No adjustable thinking level is configured for this model.</div>}
              </div>
            </div>
          </div>}
        </div>
                <div className="agent-opencode-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKiloMenuOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setKiloMenuOpen(false); kiloButtonRef.current?.focus(); } }}>
          <button ref={kiloButtonRef} type="button" className={provider === 'Kilo' ? 'selected' : ''} aria-pressed={provider === 'Kilo'} aria-haspopup="menu" aria-expanded={kiloMenuOpen} onClick={() => { setProvider('Kilo'); setModelMenuOpen(false); setIoMenuOpen(false); setApiMenuOpen(false); setKiloMenuOpen(open => !open); void refreshKilo(true); }}>Kilo</button>
          {kiloMenuOpen && <KiloModelMenu catalog={kiloCatalog} loading={kiloLoading} selectedId={selectedKiloModelId} variants={kiloThinkingPreferences} onChoose={chooseKiloModel} onRefresh={() => void refreshKilo(true)} onKeys={() => { setKeyDialogOpen(true); setKiloMenuOpen(false); }} />}
        </div>
        <div className="agent-opencode-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIoMenuOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setIoMenuOpen(false); ioButtonRef.current?.focus(); } }}>
          <button ref={ioButtonRef} type="button" className={provider === 'I/O' ? 'selected' : ''} aria-pressed={provider === 'I/O'} aria-haspopup="menu" aria-expanded={ioMenuOpen} onClick={() => { setProvider('I/O'); setModelMenuOpen(false); setKiloMenuOpen(false); setApiMenuOpen(false); setIoMenuOpen(open => !open); void refreshIo(); }}>I/O</button>
          {ioMenuOpen && <IoModelMenu catalog={ioCatalog} loading={ioLoading} selectedId={selectedIoModelId} variants={ioThinkingPreferences} onChoose={chooseIoModel} onRefresh={() => void refreshIo(true)} />}
        </div>
        <div className="agent-api-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setApiMenuOpen(false); }} onKeyDown={event => { if (event.key === "Escape") setApiMenuOpen(false); }}>
          <button type="button" className={`agent-api-trigger${apiMenuOpen || apiProviderForModel(activeModelId) ? " selected" : ""}`} aria-haspopup="menu" aria-expanded={apiMenuOpen} aria-label="Choose API provider" onClick={() => { setModelMenuOpen(false); setKiloMenuOpen(false); setApiMenuOpen(open => !open); }}>API</button>
          {apiMenuOpen && <div className="agent-api-menu" role="group" aria-label="API providers">
            <div className="agent-api-provider-row">
              {(["Google", "Nara", "Groq", "Cerebras", "Routeway", "Requesty", "Inception AI"] as const).map(name => <button key={name} type="button" aria-pressed={selectedApiProvider === name} aria-expanded={selectedApiProvider === name} className={selectedApiProvider === name ? "selected" : ""} onClick={() => {
                setSelectedApiProvider(name);
                setApiMenuOpen(true);
              }}>{name}</button>)}
            </div>
            {selectedApiProvider === "Google" && <div className="agent-google-model-menu" role="group" aria-label="Google Gemini models">
              {GOOGLE_API_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedGoogleApiModelId === model.id} className={selectedGoogleApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Google', model.id)}>
                <strong>{model.name}</strong><code>{model.id}</code>
              </button>)}
            </div>}
            {selectedApiProvider === "Cerebras" && <div className="agent-google-model-menu" role="group" aria-label="Cerebras models">
              {CEREBRAS_API_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedCerebrasApiModelId === model.id} className={selectedCerebrasApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Cerebras', model.id)}>
                <strong>{model.name}</strong><code>{model.id}</code>
              </button>)}
            </div>}
            {selectedApiProvider === "Groq" && <div className="agent-google-model-menu" role="group" aria-label="Groq models">
              {GROQ_API_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedGroqApiModelId === model.id} className={selectedGroqApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Groq', model.id)}>
                <strong>{model.name}</strong><code>{model.id}</code>
              </button>)}
            </div>}
            {selectedApiProvider === "Nara" && <div className="agent-google-model-menu" role="group" aria-label="Nara Router models">
              {NARA_ROUTER_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedNaraApiModelId === model.id} className={selectedNaraApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Nara', model.id)}>
                <strong>{model.name}</strong><code>{model.id}</code>
              </button>)}
            </div>}
            {selectedApiProvider === "Routeway" && <div className="agent-google-model-menu agent-routeway-model-menu" role="group" aria-label="Routeway free models">
              <p className="agent-routeway-note">Free models · 5 requests/min · 200/day · shared availability</p>
              {ROUTEWAY_API_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedRoutewayApiModelId === model.id} className={selectedRoutewayApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Routeway', model.id)}>
                <strong>{model.name}</strong><code>{model.apiModelId}</code><small>{Math.round((model.contextLength ?? 0) / 1000)}K context{model.input.includes('image') ? ' · Vision' : ''}{model.subscriptionFlag ? ' · Eligibility varies' : ''}</small>
              </button>)}
            </div>}
            {selectedApiProvider === "Requesty" && <div className="agent-google-model-menu agent-routeway-model-menu" role="group" aria-label="Requesty free models">
              <p className="agent-routeway-note">Free tier · up to {requestyCatalog.dailyRequestLimit} requests/day · availability varies by upstream</p>
              {REQUESTY_API_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedRequestyApiModelId === model.id} className={selectedRequestyApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Requesty', model.id)}>
                <strong>{model.name}</strong><code>{model.apiModelId}</code><small>{Math.round((model.contextLength ?? 0) / 1000)}K context{model.input.includes('image') ? ' · Vision' : ''}</small>
              </button>)}
            </div>}
            {selectedApiProvider === "Inception AI" && <div className="agent-google-model-menu agent-routeway-model-menu" role="group" aria-label="Inception AI models">
              <p className="agent-routeway-note">Mercury 3 · New API keys include a 100 million token grant. Availability and remaining quota depend on your Inception account.</p>
              {INCEPTION_API_MODELS.map(model => <button key={model.id} type="button" aria-pressed={selectedInceptionApiModelId === model.id} className={selectedInceptionApiModelId === model.id ? "selected" : ""} onClick={() => chooseApiModel('Inception AI', model.id)}>
                <strong>{model.name}</strong><code>{model.apiModelId}</code><small>{Math.round((model.contextLength ?? 0) / 1000)}K context · up to {Math.round((model.outputLimit ?? 0) / 1000)}K output · Tools · Structured output</small>
              </button>)}
            </div>}
            {apiMenuModel?.variants?.length ? <div className="agent-api-thinking-menu" role="group" aria-label={`${apiMenuModel.name} thinking level`}>
              <span>Thinking</span>
              <button type="button" aria-pressed={!apiMenuThinkingVariant} className={!apiMenuThinkingVariant ? 'selected' : ''} onClick={() => chooseApiThinking(null)}>Default</button>
              {apiMenuModel.variants.map(variant => <button key={variant} type="button" aria-pressed={apiMenuThinkingVariant === variant} className={apiMenuThinkingVariant === variant ? 'selected' : ''} onClick={() => chooseApiThinking(variant)}>{thinkingLabel(variant)}</button>)}
            </div> : null}
          </div>}
        </div>
      </div>
      <div className="agent-toolbar-actions">
        <button className="agent-key-button" onClick={toggleScorecard} title="Coding run scorecard" aria-label="Coding run scorecard" aria-expanded={scorecardOpen}><ListOrdered size={16} /></button>
        <button className="agent-key-button" onClick={openTaskChanges} title="Workspace files and changes" aria-label="Open workspace files and changes"><FileCode2 size={16} /></button>
        <button className="agent-key-button" onClick={() => setKeyDialogOpen(true)} title="Provider keys" aria-label="Configure provider keys"><KeyRound size={15} /></button>
        <button className="agent-new-task" onClick={startNewTask} title="Start a new agent task"><Plus size={15} /><span>New task</span></button>
        <details className="agent-toolbar-overflow">
          <summary aria-label="More agent actions" title="More actions"><Ellipsis size={18} /></summary>
          <div className="agent-toolbar-overflow-menu">
            <button type="button" onClick={event => { toggleScorecard(); event.currentTarget.closest("details")?.removeAttribute("open"); }}><ListOrdered size={15} /><span>Coding run scorecard</span></button>
            <button type="button" onClick={event => { openTaskChanges(); event.currentTarget.closest("details")?.removeAttribute("open"); }}><FileCode2 size={15} /><span>Workspace files and changes</span></button>
            <button type="button" onClick={event => { setKeyDialogOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><KeyRound size={15} /><span>Provider keys</span></button>
            {!historyVisible && <button type="button" onClick={event => { setHistoryVisible(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><PanelRightOpen size={15} /><span>Show task history</span></button>}
          </div>
        </details>
        {!historyVisible && <button className="agent-history-toggle" onClick={() => setHistoryVisible(true)} aria-label="Show agent history" title="Show agent history"><PanelRightOpen size={16} /></button>}
      </div>
      </div>
    </div>
    {turns.length === 0 ? <div className="agent-empty-state" inert={focusedPanel} aria-hidden={focusedPanel}>
      <div className="agent-empty-inner">
        <h1>Great work starts<br />with an idea.</h1>
        {queueBar}
        {composer}
      </div>
    </div> : <div className="agent-thread-shell" inert={focusedPanel} aria-hidden={focusedPanel}>
      <div className="agent-thread-viewport">
        <div className="agent-thread-scroll" ref={threadScrollRef}>
          <div className="agent-thread-inner" ref={threadInnerRef}>
          {taskMemory?.taskId === activeTaskId && <section className="agent-session-memory" aria-label="Saved context for this agent task">
            <div className="agent-session-memory-head"><Sparkles size={14} /><strong>Task memory</strong><span>{taskMemory.status}</span></div>
            <p><b>Goal</b>{taskMemory.goal}</p>
            {taskMemory.contract && <details className="agent-memory-criteria"><summary>Task criteria <span>{taskMemory.contract.acceptance.length} checks</span></summary>
              {taskMemory.contract.constraints.length > 0 && <p><b>Constraints</b>{taskMemory.contract.constraints.join(" · ")}</p>}
              {taskMemory.contract.acceptance.length > 0 && <ul>{taskMemory.contract.acceptance.map(item => <li key={item}>{item}</li>)}</ul>}
              {taskMemory.contract.openQuestions.length > 0 && <p><b>Open questions</b>{taskMemory.contract.openQuestions.join(" · ")}</p>}
            </details>}
            {taskMemory.plan && <p><b>Last recorded progress</b>{taskMemory.plan}</p>}
            {taskMemory.stopReason && <p className="agent-session-memory-stop"><b>Why it stopped</b>{taskMemory.stopReason}</p>}
            {taskMemory.recentActions.length > 0 && <p><b>Latest action</b>{taskMemory.recentActions.at(-1)}</p>}
          </section>}
          {turns.map(turn => <article className="agent-turn" key={turn.id} data-agent-message-id={turn.id}>
            <div className="agent-user-message">
              <div className="agent-user-bubble">
                {turn.prompt && <p>{turn.prompt}</p>}
                {turn.attachments.length > 0 && <div className="agent-message-files">{turn.attachments.map(name => <span key={name}><Paperclip size={12} />{name}</span>)}</div>}
              </div>
              {turn.prompt && <UserMessageCopy text={turn.prompt} createdAt={turn.createdAt} />}
            </div>
            <AgentTurnStatus visible={visible} startedAt={turn.runStartedAt ?? turn.createdAt} completedAt={turn.completedAt} status={turn.status}
              turnId={turn.id} hasDetails={Boolean(turn.activity?.length) || turn.status === "pending"}>
              <AgentActivityTimeline items={turn.activity ?? []} pending={turn.status === "pending"} fileChanges={turnReportForPresentation(turn)?.changes ?? []} onOpenDesignOptionPreview={(choices, option) => openDesignOptionPreview(choices, option, turn.id)} />
              {turn.status === "pending" && (streamPreview?.taskId === activeTaskId && streamPreview.requestId === turn.id && streamPreview.text
                ? <div className="agent-response"><div className="agent-response-body"><p className="agent-stream-text">{streamPreview.text}</p></div></div>
                : !(turn.activity?.length) && <p className="agent-working-copy">{turn.keyCheck ? "Checking API access…" : `Working with ${ALL_OPEN_CODE_MODELS.find(model => model.id === turn.modelId)?.name ?? "OpenCode"}…`}</p>)}
            </AgentTurnStatus>
            {turn.status === 'pending' && turn.runState && <p className="agent-run-observation" role="status">{turn.runState.phase}{Date.now() - turn.runState.phaseStartedAt >= 60000 ? ' · still waiting; no completed result received' : ''}</p>}
            {turn.status === 'error' && checkpoint?.requestId === turn.id && checkpoint.recoveryReason && <p className="agent-run-observation">{checkpoint.recoveryReason}</p>}
            {turn.status !== "pending" && <div className="agent-response"><div className="agent-response-body">
              {turn.reply ? <div className="agent-reply-content"><AgentReport text={turn.reply} keyCheck={turn.keyCheck} onLocalFile={openFilePreview} localFiles={turnReportForPresentation(turn)?.changes.filter(change => !change.directory && change.kind !== 'deleted').map(change => change.path)} /></div>
                : turn.error ? <div className="agent-response-failure"><p className="agent-response-error" role="alert">{turn.error}</p>{turn.keyCheck
                  ? <p>Paste the key again to retry this check.</p>
                  : turn.modelId && turn.error.includes("free tier can only")
                    ? <button type="button" onClick={() => void retryTurn(turn)} disabled={Boolean(runningRequestId)}><RotateCcw size={13} /> Retry through OpenCode</button>
                    : turn.modelId && <button type="button" onClick={() => void retryTurn(turn)} disabled={Boolean(runningRequestId)}><RotateCcw size={13} /> {checkpoint?.requestId === turn.id && checkpoint.safe ? "Resume" : "Retry"}</button>}</div>
                  : <p className="agent-response-note">This older task was saved before live replies were enabled.</p>}
              {turn.reply && <ReplyActions text={turn.reply} timestamp={turn.completedAt ?? turn.createdAt} />}
            </div></div>}
            {!turn.keyCheck && <AgentCompletionCard turn={turn} onOpenFile={file => {
              if (!file) { openTurnChanges(turn.id); return; }
              const change = turnReportForPresentation(turn)?.changes.find(item => item.path === file);
              if (change?.directory || change?.kind === "deleted") openTurnChanges(turn.id, file);
              else openFilePreview(file);
            }} />}
          </article>)}
          </div>
        </div>
        <AgentMessageNavigator key={activeTaskId} scrollRef={threadScrollRef} onNavigate={jumpToMessage}
          messages={turns.map(turn => ({ id: turn.id, prompt: turn.prompt || turn.attachments.join(", "), reply: turn.reply ?? turn.error ?? "", pending: turn.status === "pending" }))} />
        {showJumpToLatest && <button type="button" className="agent-jump-latest" onClick={jumpToLatest}><ArrowDown size={14} /> Jump to latest</button>}
      </div>
      <div className="agent-thread-composer">
        <div className="agent-composer-stack">
          {approval && approval.kind !== "rename" && <AgentApprovalDialog key={approval.approvalId} approval={approval}
            taskTitle={tasks.find(task => task.id === approval.taskId)?.title ?? approval.taskId}
            onDecision={decision => { void window.orvixDesktop?.approveAgentCommand(approval.approvalId, decision); dismissApproval(approval.approvalId); }} />}
          {activeTaskId && runningRequestId && <AgentClarification key={`${activeTaskId}-${runningRequestId}`} taskId={activeTaskId} requestId={runningRequestId} />}
          {changes.length > 0 && <button className={`agent-changes-pill${!historyVisible ? " is-sidebar-hidden" : ""}`} onClick={openTaskChanges} aria-label={`Review ${changes.length} task changes${taskLineCountsLimited ? "; some line counts are unavailable" : ""}`}><span className="agent-changes-full-label">{changes.filter(change => !change.directory).length} file{changes.filter(change => !change.directory).length === 1 ? "" : "s"} changed</span><span className="agent-changes-compact-label">{changes.filter(change => !change.directory).length} files</span>{taskLineCountsLimited ? <span className="agent-changes-pill-limited">Counts limited</span> : <><strong>+{changes.reduce((sum, file) => sum + file.added, 0)}</strong><em>−{changes.reduce((sum, file) => sum + file.deleted, 0)}</em></>}</button>}
          {queueBar}
          {composer}
        </div>
      </div>
    </div>}

    <aside className="agent-history-panel" aria-label="Agent history" aria-hidden={!historyVisible || viewerOpen} inert={!historyVisible || viewerOpen}>
      <div className="agent-history-header"><div><Clock3 size={17} /><strong>Your tasks</strong></div><button onClick={() => setHistoryVisible(false)} aria-label="Hide agent history" title="Hide agent history"><PanelRightClose size={16} /></button></div>
      <nav className="agent-history-list" aria-label="Saved agent tasks">
        {visibleTasks.length ? visibleTasks.map(task => {
          const createdAt = task.createdAt ?? task.turns[0]?.createdAt ?? task.updatedAt;
          const last = task.turns.at(-1);
          const taskModelId = last?.modelId ?? task.modelId;
          const taskModelName = shortModelName(taskModelId, ALL_OPEN_CODE_MODELS, kiloCatalog.models, ioCatalog.models);
          const needsApproval = approvals.some(item => item.taskId === task.id);
          const status = needsApproval ? 'Needs approval' : questions[task.id] ? 'Waiting' : runningRequests[task.id] || last?.status === 'pending' ? /waiting/i.test(last?.runState?.phase ?? '') ? 'Waiting' : 'Working' : last?.status === 'error' ? 'Failed' : last?.status === 'done' ? 'Completed' : 'Ready';
          return <div key={task.id} className={`agent-history-entry${editingTaskId === task.id ? " is-editing" : ""}`}>
            {editingTaskId === task.id ? <form className="agent-history-rename" onSubmit={event => saveRename(event, task.id)}><input autoFocus maxLength={80} aria-label="Agent task name" value={editingTitle} onChange={event => setEditingTitle(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setEditingTaskId(null); } }} /><button type="submit" disabled={!editingTitle.trim()} aria-label="Save agent task name" title="Save name"><Check size={15} /></button></form> : <>
              <button className={`agent-history-item${task.id === activeTaskId ? " active" : ""}`} onClick={() => openTask(task)} aria-current={task.id === activeTaskId ? "page" : undefined} title={`${task.title}\nModel: ${taskModelName}\nCreated ${formatAgentTime(createdAt)}\nUpdated ${formatAgentTime(task.updatedAt)}`}><span><strong>{task.title}{task.unreadCompletion && <i className="agent-session-unread" aria-label="Unread result" />}</strong><small><span className={`agent-session-status is-${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span><span className="agent-session-model" title={taskModelId ?? "No model selected"}>{taskModelName}</span></small></span></button>
              <div className="agent-history-actions"><button aria-label={`Rename ${task.title}`} title="Rename task" onClick={() => startRename(task)}><Pencil size={13} /></button><button aria-label={`Delete ${task.title}`} title="Delete task" onClick={() => deleteTask(task.id)}><Trash2 size={13} /></button></div>
            </>}
            <div className="agent-history-details"><strong>{task.title}</strong><span>Created {formatAgentTime(createdAt)}</span><span>Updated {formatAgentTime(task.updatedAt)}</span></div>
          </div>;
        }) : <div className="agent-history-empty"><Folder size={25} strokeWidth={1.4} /><strong>Room for your next idea</strong><span>Start a task and pick up where you left off, anytime.</span></div>}
      </nav>
      <div className="agent-history-footer"><button onClick={startNewTask}><Plus size={16} /> New task</button></div>
    </aside>
    {viewerOpen && <AgentChanges key={`${activeTaskId ?? "none"}:${reviewTurnId ?? "task"}:${filePreview?.file ?? reviewFile ?? ""}:${activeDesignOptionsPreview ? `options-${designOptionsPreviewRevision}` : "files"}`} taskId={activeTaskId} turnId={reviewTurnId} initialFile={activeFilePreview ? filePreview?.file ?? null : reviewFile}
      initialMode={activeFilePreview || activeDesignOptionsPreview ? "preview" : "code"}
      designOptions={liveOptionsPreview as DesignOptionsViewer | null} workspaces={workspaces}
      files={reviewTurnId ? reviewedTurnFiles : changes}
      scorecardActive={scorecardOpen} scorecardTabOpen={scorecardTabOpen}
      onScorecardActiveChange={setScorecardOpen} onScorecardTabClose={() => { setScorecardOpen(false); setScorecardTabOpen(false); }}
      dockSide={changesDock} width={changesWidth} minimized={changesMinimized} maximized={changesMaximized}
      onDockChange={setChangesDock} onResize={resizeChanges}
      onToggleMinimize={() => { setChangesMinimized(value => !value); setChangesMaximized(false); }}
      onToggleMaximize={() => { setChangesMaximized(value => !value); setChangesMinimized(false); }}
      onClose={() => { setChangesOpen(false); setScorecardOpen(false); setFilePreview(null); setDesignOptionsPreview(null); setChangesMinimized(false); setChangesMaximized(false); }}
      onUpdated={value => { if (activeTaskIdRef.current === activeTaskId) setChanges(value); }} />}
    {approval?.kind === "rename" && <AgentRenameReview key={approval.approvalId} approvalId={approval.approvalId} summary={approval.rename}
      onDecision={approved => { void window.orvixDesktop?.approveAgentCommand(approval.approvalId, approved); dismissApproval(approval.approvalId); }} />}
    {keyDialogOpen && <div className="agent-key-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setKeyDialogOpen(false); }}><div ref={providerDialogRef} className="agent-key-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-key-title">
      <div className="agent-key-dialog-head"><div><KeyRound size={18} /><div><h2 id="agent-key-title">Provider connections</h2><span>Manage the models available to your Agent</span></div></div><button onClick={() => setKeyDialogOpen(false)} aria-label="Close provider settings"><X size={17} /></button></div>
      <div className="agent-key-storage-note"><span className="agent-key-storage-dot" /><p>Keys save locally in <code>.env</code>. Keep this plaintext file private.</p></div>
      <div className="agent-key-provider-tabs" role="tablist" aria-label="API provider settings" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); if (!tabs.length) return;
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {(['google', 'nara', 'groq', 'cerebras', 'routeway', 'requesty', 'inception'] as const).map(tier => <button type="button" key={tier} role="tab" id={`agent-key-tab-${tier}`} aria-selected={keySettingsProvider === tier} aria-controls={`agent-key-panel-${tier}`} disabled={keyBusy} className={keySettingsProvider === tier ? 'selected' : ''} onClick={() => { setApiKeyDrafts(current => ({ ...current, [keySettingsProvider]: '' })); setKeySettingsProvider(tier); setApiKeyLabel(''); setEditingApiKeyId(null); setKeyFeedback(''); setKeyError(''); }}><span>{tier === 'google' ? 'Google' : tier === 'nara' ? 'Nara Router' : tier === 'groq' ? 'Groq' : tier === 'routeway' ? 'Routeway' : tier === 'requesty' ? 'Requesty' : tier === 'inception' ? 'Inception AI' : 'Cerebras'}</span><small>{keyStatus?.[tier]?.keys?.length ?? 0}</small></button>)}
      </div>
      <div className="agent-provider-cards is-single">
        {([keySettingsProvider]).map(tier => {
          const label = tier === 'google' ? 'Google Gemini' : tier === 'nara' ? 'Nara Router' : tier === 'groq' ? 'Groq' : tier === 'routeway' ? 'Routeway' : tier === 'requesty' ? 'Requesty' : tier === 'inception' ? 'Inception AI' : 'Cerebras';
          const count = API_MODELS.filter(model => model.credentialTier === tier).length;
          const status = keyStatus?.[tier];
          const keys = status?.keys ?? [];
          const ready = keys.filter(key => key.status === 'ready').length;
          const configuredLabel = keys.length ? `${ready} ready · ${keys.length} keys` : 'No keys yet';
          return <section className={`agent-provider-card${ready ? ' is-connected' : ''}`} key={tier} id={`agent-key-panel-${tier}`} role="tabpanel" aria-labelledby={`agent-key-tab-${tier}`}>
            <header className="agent-provider-card-head"><div className={`agent-provider-mark is-${tier}`} aria-hidden="true">{tier === 'google' ? 'G' : tier === 'nara' ? 'N' : tier === 'groq' ? 'Gr' : tier === 'routeway' ? 'R' : tier === 'requesty' ? 'Rq' : tier === 'inception' ? 'In' : 'C'}</div><div className="agent-provider-card-title"><strong>{label}</strong><span>{count} listed models{tier === 'nara' ? ' · Official endpoint configured' : tier === 'routeway' ? ' · Free models' : tier === 'requesty' ? ' · Free models' : tier === 'inception' ? ' · Mercury 3 chat' : ''}</span></div><span className={`agent-provider-status${ready ? ' is-connected' : ''}`}><i />{configuredLabel}</span></header>
            <div className="agent-key-rotation-note"><RotateCcw size={13} aria-hidden="true" /><p>{tier === 'routeway' ? 'Free access: 5 requests/minute, 200/day, one request at a time. Tasks share a queue and respect provider cooldowns. Additional keys do not increase a shared account quota.' : tier === 'requesty' ? `Free tier: up to ${requestyCatalog.dailyRequestLimit} requests per day. Orvix serializes calls and respects provider cooldowns; model availability can change. Free-plan prompts may be used for training by Requesty or the upstream provider, so avoid sensitive content.` : tier === 'inception' ? 'Mercury 3 is the currently listed general chat model. Inception says new API keys include a 100 million token grant; account eligibility and remaining usage are provider-managed.' : 'Keys rotate in order for new model requests. Limited keys cool down; invalid and paused keys are skipped. Keys on the same account may share quota.'}</p></div>
            <div className="agent-provider-key-list" aria-label={`${label} saved keys`}>
              {keys.length ? keys.map(key => <div className={`agent-provider-key-item is-${key.status}`} key={key.id}>
                <div className="agent-provider-key-info"><div><strong>{key.label}</strong><code>{key.maskedKey}</code><span className={`agent-key-state is-${key.status}`}>{key.status === 'cooldown' ? `Cooldown · ${Math.max(1, Math.ceil((key.cooldownUntil - Date.now()) / 1000))}s` : key.status === 'ready' ? 'Ready' : key.status === 'invalid' ? 'Invalid key' : 'Paused'}</span></div><small>{key.successes} completed · {key.failures} failed · this app session{key.source === 'environment' ? ' · Environment-managed' : ''}</small></div>
                {key.source !== 'environment' && <div className="agent-provider-key-actions"><button type="button" disabled={keyBusy} onClick={() => void changeApiKey(tier, { operation: 'toggle', id: key.id })} aria-label={`${key.enabled ? 'Pause' : 'Resume'} ${key.label}`}>{key.enabled ? 'Pause' : 'Resume'}</button><button type="button" disabled={keyBusy} title={`Replace ${key.label}`} aria-label={`Replace ${key.label}`} onClick={() => { setEditingApiKeyId(key.id); setApiKeyLabel(key.label); setApiKeyDrafts(current => ({ ...current, [tier]: '' })); setKeyFeedback(''); }}><Pencil size={13} /></button><button type="button" className="is-remove" disabled={keyBusy} title={`Remove ${key.label}`} aria-label={`Remove ${key.label}`} onClick={() => void changeApiKey(tier, { operation: 'remove', id: key.id })}><Trash2 size={13} /></button></div>}
              </div>) : <div className="agent-provider-key-empty"><KeyRound size={20} /><strong>Add your first {label} key</strong><span>You can add more keys at any time. No application key-count limit.</span></div>}
            </div>
            <form className="agent-provider-add-key" onSubmit={event => { event.preventDefault(); void saveApiKey(tier); }}>
              <div className="agent-provider-add-key-heading"><strong>{editingApiKeyId ? 'Replace a key' : 'Add another key'}</strong>{editingApiKeyId && <button type="button" disabled={keyBusy} onClick={() => { setEditingApiKeyId(null); setApiKeyLabel(''); setApiKeyDrafts(current => ({ ...current, [tier]: '' })); }}>Cancel</button>}</div>
              <div className="agent-provider-key-field"><label htmlFor={`agent-${tier}-label`}>Name <span>(optional)</span></label><input id={`agent-${tier}-label`} type="text" maxLength={80} autoComplete="off" placeholder="e.g. Personal project" value={apiKeyLabel} disabled={keyBusy} onChange={event => setApiKeyLabel(event.target.value)} /></div>
              <div className="agent-provider-key-field"><label htmlFor={`agent-${tier}-key`}>API key</label><div className="agent-key-input-line"><input id={`agent-${tier}-key`} type="password" autoComplete="new-password" spellCheck={false} aria-label={`${label} API key`} placeholder={editingApiKeyId ? 'Paste the replacement key' : 'Paste a new API key'} value={apiKeyDrafts[tier]} disabled={keyBusy} onChange={event => setApiKeyDrafts(current => ({ ...current, [tier]: event.target.value }))} /><button type="submit" disabled={keyBusy || !apiKeyDrafts[tier].trim()}>{keyBusy ? 'Saving…' : editingApiKeyId ? 'Replace key' : 'Add key'}</button></div></div>
            </form>
          </section>;
        })}
      </div>
      <details className="agent-key-other-providers"><summary>Other provider credentials</summary>
        <div className="agent-key-row"><div><strong>OpenCode Zen Free</strong><span className="is-configured">Official agent connection · no API key needed</span></div></div>
        <div className="agent-key-row"><div><strong>OpenCode Go</strong><span className={keyStatus?.go.configured ? 'is-configured' : ''}>{keyStatus?.go.configured ? keyStatus.go.fromEnvironment ? 'Configured from environment' : 'Configured securely on this device' : 'No key added'}</span></div>
          {!keyStatus?.go.fromEnvironment && <div className="agent-key-input-line"><input type="password" autoComplete="new-password" spellCheck={false} aria-label="OpenCode Go API key" placeholder={keyStatus?.go.configured ? 'Replace key' : 'Paste API key'} value={goKeyDraft} onChange={event => setGoKeyDraft(event.target.value)} /><button onClick={() => void saveGoKey()} disabled={!goKeyDraft.trim()}>Save</button></div>}
          {keyStatus?.go.configured && !keyStatus.go.fromEnvironment && <button className="agent-remove-key" onClick={() => void removeKey('go')}>Remove saved key</button>}
        </div>
        <div className="agent-key-row"><div><strong>Kilo</strong><span className={keyStatus?.kilo?.configured ? 'is-configured' : ''}>{keyStatus?.kilo?.configured ? keyStatus.kilo.fromEnvironment ? 'Configured from environment' : 'Configured securely on this device' : 'No key added'}</span></div>
          {!keyStatus?.kilo?.fromEnvironment && <div className="agent-key-input-line"><input type="password" autoComplete="new-password" spellCheck={false} aria-label="Kilo API key" placeholder={keyStatus?.kilo?.configured ? 'Replace key' : 'Paste API key'} value={kiloKeyDraft} onChange={event => setKiloKeyDraft(event.target.value)} /><button onClick={() => void saveKiloKey()} disabled={!kiloKeyDraft.trim()}>Save</button></div>}
          {keyStatus?.kilo?.configured && !keyStatus.kilo.fromEnvironment && <button className="agent-remove-key" onClick={() => void removeKey('kilo')}>Remove saved key</button>}
        </div>
      </details>
      {keyFeedback && <p className="agent-key-feedback" role="status"><Check size={13} />{keyFeedback}</p>}
      <p className="agent-key-security-note">Keys are sent only to the selected provider. They are never shown after saving.</p>
      {keyError && <p className="agent-response-error" role="alert">{keyError}</p>}
    </div></div>}
    </div>
  </div>;
}
