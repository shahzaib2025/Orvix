import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import AgentCopyButton from "./AgentCopyButton";
import { visualDocument } from "./agentVisualDocument";

let renderQueue: Promise<unknown> = Promise.resolve();
let nextDiagram = 0;
const MAX_SOURCE = 40000;

export default function AgentVisual({ language, code, closed }: { language: string; code: string; closed: boolean }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [result, setResult] = useState<{ source: string; svg: string; error: string } | null>(null);
  const [runningSource, setRunningSource] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const container = useRef<HTMLDivElement>(null);
  const interactive = language === "orvix-visual";
  const tooLarge = code.length > MAX_SOURCE;
  const current = result?.source === code ? result : null;
  useEffect(() => {
    if (interactive || !closed || tooLarge) return;
    let cancelled = false;
    setZoom(1);
    const render = async () => {
      if (cancelled) return;
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-100000px;visibility:hidden";
      document.body.appendChild(host);
      try {
        const { default: mermaid } = await import("mermaid");
        if (cancelled) return;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark", suppressErrorRendering: true, htmlLabels: false,
          maxTextSize: MAX_SOURCE, maxEdges: 200, flowchart: { htmlLabels: false },
          secure: ["securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels"] });
        // Model configuration directives are unnecessary for a chat diagram.
        if (/%%\s*\{|^\s*---/m.test(code)) throw new Error("Diagram configuration is not supported. Use plain Mermaid source.");
        const rendered = await mermaid.render(`orvix-diagram-${++nextDiagram}`, code, host);
        const svg = DOMPurify.sanitize(rendered.svg, { USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "a", "image"], FORBID_ATTR: ["href", "xlink:href"] });
        if (!cancelled) setResult({ source: code, svg, error: "" });
      } catch {
        if (!cancelled) setResult({ source: code, svg: "", error: "Could not render this diagram. Open Code to inspect or copy the source." });
      } finally { host.remove(); }
    };
    renderQueue = renderQueue.then(render, render);
    return () => { cancelled = true; };
  }, [code, closed, interactive, tooLarge]);

  return <section className="agent-visual" aria-label={interactive ? "Interactive visualization" : "Mermaid diagram"}>
    <div className="agent-visual-toolbar">
      <span>{interactive ? "Interactive visual" : "Diagram"}</span>
      <div className="agent-visual-actions">
        <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</button>
        <button type="button" aria-pressed={view === "code"} onClick={() => setView("code")}>Code</button>
        <AgentCopyButton text={code} label="Copy source" />
      </div>
    </div>
    {view === "code" ? <pre><code>{code}</code></pre> : <>
      {!closed ? <p role="status">Waiting for the visual to finish…</p> : tooLarge ? <p role="status">This visual is too large to preview. Its source is available in Code.</p> : interactive ? <>
        <div className="agent-visual-controls"><button type="button" onClick={() => setRunningSource(runningSource === code ? null : code)}>{runningSource === code ? "Stop visual" : "Run visual"}</button><span>Runs locally in an isolated preview.</span></div>
        {runningSource === code && <iframe title="Interactive visualization preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={visualDocument(code)} />}
      </> : current?.error ? <p role="status">{current.error}</p> : current?.svg ? <>
        <div className="agent-visual-controls">
          <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</button>
          <button type="button" aria-label="Reset diagram zoom" onClick={() => { setZoom(1); container.current?.scrollTo(0, 0); }}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.25))}>+</button>
        </div>
        <div className="agent-diagram-scroll" ref={container} tabIndex={0} role="region" aria-label="Diagram preview; scroll to explore">
          <div className="agent-diagram-svg" style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: current.svg }} />
        </div>
      </> : <p role="status">Rendering diagram…</p>}
    </>}
  </section>;
}
