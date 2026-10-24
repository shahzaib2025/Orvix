import React from "react";

type Props = {
  children: React.ReactNode;
  scope: string;
  compact?: boolean;
};

type State = { error: Error | null; retryKey: number; diagnosticId: string | null };

function newDiagnosticId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default class RenderErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, retryKey: 0, diagnosticId: null };

  static getDerivedStateFromError(error: Error) {
    return { error, diagnosticId: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const diagnosticId = newDiagnosticId();
    this.setState({ diagnosticId });
    console.error(`[Orvix] ${this.props.scope} render failed (${diagnosticId})`, error, info.componentStack);
    window.orvixDesktop?.logLive?.("error", `[Renderer Error Boundary] ${this.props.scope} view failed (${diagnosticId}): ${error.message}`, {
      source: "REACT_ERROR_BOUNDARY",
      scope: this.props.scope,
      diagnosticId,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private retry = () => this.setState(state => ({ error: null, retryKey: state.retryKey + 1, diagnosticId: null }));

  render() {
    if (this.state.error) {
      const title = this.props.scope === "Agent" ? "The Agent view hit a problem" : "Orvix hit an unexpected error";
      return <section className={`renderer-error-state${this.props.compact ? " is-compact" : ""}`} role="alert">
        <div className="renderer-error-mark" aria-hidden="true">!</div>
        <h1>{title}</h1>
        <p>This view stopped rendering. Your saved data remains on this device. Try loading it again.</p>
        {this.state.diagnosticId && <small>Diagnostic ID: {this.state.diagnosticId}</small>}
        <button type="button" onClick={this.retry}>Try again</button>
      </section>;
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
