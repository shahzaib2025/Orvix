import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./theme.css";

type StartupControl = { startedAt: number; stop: () => void; fail: (message: string) => void };
const startup = (window as unknown as { __orvixStartup?: StartupControl }).__orvixStartup;

function revealWorkspace() {
  const splash = document.getElementById("startup-splash");
  if (!splash) return;
  const elapsed = performance.now() - (startup?.startedAt ?? 0);
    // Keep the startup splash visible long enough to feel intentional, even on fast launches.
  window.setTimeout(() => {
    startup?.stop();
    splash.classList.add("is-hidden");
    window.setTimeout(() => splash.remove(), splash.classList.contains("startup-reduced") || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : 500);
  }, Math.max(0, 2500 - elapsed));
}

window.addEventListener("orvix:ready", revealWorkspace, { once: true });

// Forward all uncaught renderer exceptions to terminal
window.addEventListener("error", (event) => {
  const bridge = (window as unknown as { orvixDesktop?: { logLive?: (type: string, message: string, details?: unknown) => void } }).orvixDesktop;
  bridge?.logLive?.("error", `[Renderer Uncaught Exception] ${event.message}`, {
    source: "BROWSER_RENDERER_EXCEPTION",
    file: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack || String(event.error || ""),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const bridge = (window as unknown as { orvixDesktop?: { logLive?: (type: string, message: string, details?: unknown) => void } }).orvixDesktop;
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  const stack = event.reason instanceof Error ? event.reason.stack : undefined;
  bridge?.logLive?.("error", `[Renderer Unhandled Promise Rejection] ${reason}`, {
    source: "UNHANDLED_PROMISE_REJECTION",
    reason,
    stack,
  });
});

class StartupBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean; error: Error | null; diagnosticId: string | null }> {
  state = { failed: false, error: null as Error | null, diagnosticId: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { failed: true, error, diagnosticId: null };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const diagnosticId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `render-${Date.now()}`;
    this.setState({ diagnosticId });
    console.error(`[Orvix] Application render failed (${diagnosticId})`, error, info.componentStack);
    window.orvixDesktop?.logLive?.("error", `[Renderer Error Boundary] Application render failed (${diagnosticId}): ${error.message}`, {
      source: "REACT_ERROR_BOUNDARY",
      scope: "Application",
      diagnosticId,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    window.dispatchEvent(new Event("orvix:ready"));
  }
  render() {
    if (this.state.failed) return <section className="renderer-error-state" role="alert"><div className="renderer-error-mark" aria-hidden="true">!</div><h1>Orvix hit an unexpected error</h1><p>The app stopped rendering this view. Your saved data remains on this device. Restart Orvix to try again.</p>{this.state.diagnosticId && <small>Diagnostic ID: {this.state.diagnosticId}</small>}<button type="button" onClick={() => location.reload()}>Restart Orvix</button></section>;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(<StartupBoundary><App /></StartupBoundary>);
