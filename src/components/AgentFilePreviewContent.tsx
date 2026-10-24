import { useEffect, useRef, useState } from "react";
import type { AgentFilePreview as Preview } from "../desktop";
import AgentReport from "./AgentReport";

export function AgentPdfPreview({ data }: { data: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setError("");
    void (async () => {
      try {
        const pdf = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdf.GlobalWorkerOptions.workerSrc = worker.default;
        if (cancelled) return;
        const loading = pdf.getDocument({ data: Uint8Array.from(atob(data), char => char.charCodeAt(0)) });
        cleanup = () => { void loading.destroy(); };
        const document = await loading.promise;
        if (cancelled) return;
        setTotal(document.numPages);
        const page = await document.getPage(pageNumber);
        if (cancelled || !canvas.current) return;
        const viewport = page.getViewport({ scale: 1.4 });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        await page.render({ canvas: canvas.current, viewport }).promise;
      } catch {
        if (!cancelled) setError("Could not preview this PDF. Open it in its app.");
      }
    })();
    return () => { cancelled = true; cleanup?.(); };
  }, [data, pageNumber]);

  return <div className="agent-file-pdf">
    <div className="agent-file-pagination">
      <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber(value => value - 1)}>Previous page</button>
      <span aria-live="polite">Page {pageNumber}{total ? ` of ${total}` : ""}</span>
      <button type="button" disabled={!total || pageNumber >= total} onClick={() => setPageNumber(value => value + 1)}>Next page</button>
    </div>
    {error ? <p role="status">{error}</p> : <canvas ref={canvas} role="img" aria-label={`PDF page ${pageNumber}`} />}
  </div>;
}

export default function AgentFilePreviewContent({ preview, onLocalFile }: { preview: Preview; onLocalFile?: (file: string) => void }) {
  const name = preview.name ?? preview.path.split(/[\\/]/).at(-1) ?? preview.path;
  const markdown = preview.kind === "text" && /\.(?:md|markdown)$/i.test(name);
  const html = preview.kind === "html"
    ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1">${preview.content ?? ""}`
    : "";

  if (preview.kind === "image" && preview.data) return <div className="agent-file-panel-image"><img src={`data:${preview.mime};base64,${preview.data}`} alt={name} /></div>;
  if (preview.kind === "pdf" && preview.data) return <AgentPdfPreview key={preview.path} data={preview.data} />;
  if (preview.kind === "html") return <iframe title={`Preview of ${name}`} sandbox="" srcDoc={html} />;
  if (markdown) return <div className="agent-file-panel-markdown"><AgentReport text={preview.content ?? ""} onLocalFile={onLocalFile} /></div>;
  if (preview.kind === "unavailable") return <p className="agent-file-panel-message" role="status">{preview.reason}</p>;
  return <p className="agent-file-panel-message" role="status">This file has no inline preview.</p>;
}
