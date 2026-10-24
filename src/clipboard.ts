/** All agent copy actions share the existing desktop IPC and browser fallbacks. */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    const result = await window.orvixDesktop?.manageClipboard({ action: "write", text });
    if (result && typeof result === "object" && "status" in result && result.status === "ok") return;
  } catch { /* Try the browser when the desktop clipboard is unavailable. */ }
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Permission failures can still allow the selection fallback. */ }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  const inputSelection = input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
  const scroll = { x: window.scrollX, y: window.scrollY };
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  const preserveSource = (event: ClipboardEvent) => {
    if (event.clipboardData) { event.clipboardData.setData("text/plain", text); event.preventDefault(); }
  };
  try {
    document.body.appendChild(textarea);
    textarea.addEventListener("copy", preserveSource);
    textarea.select();
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) throw new Error("Clipboard copy was not accepted.");
  } finally {
    textarea.removeEventListener("copy", preserveSource);
    textarea.remove();
    if (active?.isConnected) active.focus({ preventScroll: true });
    // Chromium represents an input selection as a collapsed DOM range. Restoring
    // that range would erase the restored input selection; a real DOM selection
    // takes precedence when the user selected document text instead.
    const restoreInput = inputSelection && input?.isConnected && inputSelection.start !== null && inputSelection.end !== null
      && !ranges.some(range => !range.collapsed);
    if (restoreInput) {
      input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
    } else if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
    window.scrollTo(scroll.x, scroll.y);
  }
}
