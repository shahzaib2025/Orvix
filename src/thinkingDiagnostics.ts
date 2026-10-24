// Bounded local snapshots omit audio and redact recognizable credential fields/strings.
export function thinkingTraceSnapshot(value: unknown): { data: unknown; truncated: boolean; redacted: boolean } {
  let remaining = 20_000, truncated = false, redacted = false;
  const seen = new WeakSet<object>();
  const secretKey = /^(?:api[_-]?key|authorization|password|secret|token|access[_-]?token|refresh[_-]?token|newHandle|resumeHandle|handle|audio|inlineData|base64)$/i;
  function cleanText(text: string): string {
    const clean = text.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@|AIza[\w-]{20,}|\b(?:Bearer|Token)\s+[\w.\/-]{12,}|((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)\s*[=:]\s*["']?)[^\s"'&,]+/gi, (_match, label?: string) => {
      redacted = true; return label ? `${label}[redacted]` : "[redacted]";
    });
    const limit = Math.min(4_000, Math.max(0, remaining));
    const output = clean.slice(0, limit);
    remaining -= output.length;
    if (output.length < clean.length) { truncated = true; return `${output}[trace shortened]`; }
    return output;
  }
  function visit(item: unknown, depth: number): unknown {
    if (remaining <= 0) { truncated = true; return "[trace shortened]"; }
    remaining -= 12;
    if (typeof item === "string") return cleanText(item);
    if (item === null || typeof item !== "object") return item;
    if (depth > 8 || remaining <= 0 || seen.has(item)) { truncated = true; return "[trace shortened]"; }
    seen.add(item);
    if (!Array.isArray(item) && (item as { privateMemory?: boolean }).privateMemory === true) {
      redacted = true;
      const memory = item as { status?: string; records?: unknown[]; revision?: number };
      return { privateMemory: true, status: memory.status, count: memory.records?.length ?? 0, revision: memory.revision, records: '[private memory omitted]' };
    }
    if (Array.isArray(item)) {
      if (item.length > 30) truncated = true;
      return item.slice(0, 30).map(child => visit(child, depth + 1));
    }
    const output: Record<string, unknown> = {};
    const entries = Object.entries(item);
    if (entries.length > 60) truncated = true;
    for (const [key, child] of entries.slice(0, 60)) {
      const safeKey = key.slice(0, 100);
      if (key.length > safeKey.length) truncated = true;
      remaining -= safeKey.length;
      if (secretKey.test(key)) { output[safeKey] = "[redacted]"; redacted = true; }
      else output[safeKey] = visit(child, depth + 1);
    }
    return output;
  }
  return { data: visit(value, 0), truncated, redacted };
}
