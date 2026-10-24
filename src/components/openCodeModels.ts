import models from "../../electron/opencode-models.json";
import thinkingVariants from "../../electron/opencode-thinking.json";

export type OpenCodeModel = {
  name: string;
  id: string;
  route: "chat" | "responses" | "messages";
  input?: ("text" | "image")[];
  variants?: string[];
  contextLength?: number | null;
  outputLimit?: number | null;
};

// The shared catalog is also used by Electron to validate model IDs and routes.
export const ALL_OPEN_CODE_MODELS = models as OpenCodeModel[];
export const ZEN_FREE_MODELS = ALL_OPEN_CODE_MODELS.filter(model => model.id.startsWith("opencode/"));
export const GO_MODELS = ALL_OPEN_CODE_MODELS.filter(model => model.id.startsWith("opencode-go/"));
export const OPEN_CODE_THINKING_VARIANTS = thinkingVariants as Record<string, string[]>;
export const thinkingVariantsFor = (modelId: string): string[] =>
  ALL_OPEN_CODE_MODELS.find(model => model.id === modelId)?.route === "messages" ? [] : OPEN_CODE_THINKING_VARIANTS[modelId] ?? [];
export const thinkingLabel = (variant: string): string => ({ xhigh: "Extra high", max: "Max", thinking: "Thinking" } as Record<string, string>)[variant] ?? `${variant.charAt(0).toUpperCase()}${variant.slice(1)}`;
