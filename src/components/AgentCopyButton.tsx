import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../clipboard";

export default function AgentCopyButton({ text, label, accessibleLabel = label, className = "", buttonClassName }: {
  text: string; label: string; accessibleLabel?: string; className?: string; buttonClassName?: string;
}) {
  const [state, setState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const version = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    version.current++; pending.current = false; setState("idle");
    return () => { version.current++; if (timer.current) clearTimeout(timer.current); };
  }, [text]);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    const current = version.current;
    if (timer.current) clearTimeout(timer.current);
    setState("pending");
    let next: "copied" | "failed";
    try { await copyTextToClipboard(text); next = "copied"; } catch { next = "failed"; }
    if (current !== version.current) return;
    pending.current = false; setState(next);
    timer.current = setTimeout(() => setState("idle"), 2200);
  }
  return <span className={`agent-copy-control ${className}`} data-feedback={state}>
    <button type="button" className={buttonClassName} aria-label={accessibleLabel} title={accessibleLabel} aria-busy={state === "pending"} onClick={() => void copy()}>
      {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span>{state === "copied" ? "Copied" : label}</span>
    </button>
    <span className={state === "failed" ? "agent-copy-error" : "agent-copy-announcement"} role="status" aria-live="polite">
      {state === "failed" ? "Could not copy. Select the text to copy it." : state === "copied" ? `${accessibleLabel}: copied.` : ""}
    </span>
  </span>;
}
