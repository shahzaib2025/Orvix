// Only these reversible window-state operations bypass the opening explanation.
export function quickWindowAction(name: string, args: Record<string, unknown>): boolean {
  return name === "manage_window" && ["focus", "minimize", "maximize"].includes(String(args.action || "focus").trim().toLowerCase());
}

export function retryableWindowFailure(result: Record<string, unknown>): boolean {
  return result.status === "failed" && result.completionUnknown !== true;
}
