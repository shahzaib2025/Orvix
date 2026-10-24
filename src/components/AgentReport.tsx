import { useMemo } from "react";
import type { ReactNode } from "react";
import { Check, Info, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import "./agent-report.css";
import AgentCopyButton from "./AgentCopyButton";
import { parseAgentReport } from "./agentReportParser";
import AgentVisual from "./AgentVisual";
import { resolveAgentFileTarget } from "./agentFileLinks";
import { designOptionsPresentation } from "./designOptionsPresentation";

type AccessRow = { name: string; status: string; http: number | null };

function inline(text: string, onLocalFile?: (file: string) => void, localFiles: string[] = []): ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:<[^>\n]+>|[^)\n]+)\)|\*[^*\n]+\*|~~[^~\n]+~~)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{inline(part.slice(2, -2), onLocalFile, localFiles)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) {
      const value = part.slice(1, -1).replace(/\\\|/g, "|"), file = resolveAgentFileTarget(value, localFiles);
      return file && onLocalFile ? <button key={index} type="button" className="agent-local-file-link" title={file} onClick={() => onLocalFile(file)}><code>{value}</code></button> : <code key={index}>{value}</code>;
    }
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((<[^>]+>|[^)]+)\)$/.exec(part);
    if (link) {
      const target = link[2].replace(/^<(.+)>$/, "$1");
      if (/^https?:\/\/[^\s]+$/.test(target)) return <a key={index} href={target} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
      const file = resolveAgentFileTarget(target, localFiles);
      if (file && onLocalFile) return <button key={index} type="button" className="agent-local-file-link" title={file} onClick={() => onLocalFile(file)}>{link[1]}</button>;
    }
    return part.replace(/\\([\\|*`])/g, "$1");
  });
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return <div className="agent-code-block"><div className="agent-code-toolbar"><span>{language || "Code"}</span><AgentCopyButton text={code} label="Copy code" /></div><pre><code>{code}</code></pre></div>;
}

function MarkdownReport({ text, onLocalFile, localFiles = [] }: { text: string; onLocalFile?: (file: string) => void; localFiles?: string[] }) {
  const format = (value: string) => inline(value, onLocalFile, localFiles);
  const blocks = useMemo(() => parseAgentReport(text), [text]);
  return <div className="agent-report-prose">{blocks.map(block => {
    const key = `${block.kind}-${block.start}`;
    if (block.kind === "heading") {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <div key={key} className={`agent-report-heading level-${block.level}`}>
        <Tag>{format(block.title)}</Tag>
        <AgentCopyButton text={text.slice(block.start, block.sectionEnd)} label="Copy" accessibleLabel={`Copy section: ${block.title}`} />
      </div>;
    }
    if (block.kind === "code") {
      const language = block.language.toLowerCase();
      const code = text.slice(block.codeStart, block.codeEnd);
      if (language === "mermaid" || language === "orvix-visual") return <AgentVisual key={key} language={language} code={code} closed={block.closed} />;
      return <CodeBlock key={key} language={block.language} code={code} />;
    }
    if (block.kind === "rule") return <hr key={key} />;
    if (block.kind === "quote") return <blockquote key={key}>{format(block.body)}</blockquote>;
    if (block.kind === "list") {
      const items = block.items.map((item, index) => <li key={index} className={item.nested ? "is-nested" : undefined}>{format(item.body)}</li>);
      return block.ordered ? <ol key={key} start={block.firstNumber}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    if (block.kind === "table") {
      const columns = Array.from({ length: block.columns }, (_, index) => index);
      // Plain left alignment remains the default; only explicit markers need a style.
      const alignment = (index: number) => block.alignments[index] && block.alignments[index] !== "left" ? { textAlign: block.alignments[index] } : undefined;
      return <div key={key} className="agent-report-table-block">
        <div className="agent-report-table-toolbar"><AgentCopyButton text={text.slice(block.start, block.end)} label="Copy table" /></div>
        <div className="agent-report-table-wrap" tabIndex={0} role="region" aria-label={`Comparison table: ${block.headers.join(", ")}. Scroll horizontally for more columns.`}>
          <table><thead><tr>{columns.map(index => <th key={index} scope="col" style={alignment(index)}>{format(block.headers[index] ?? "")}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map(index => <td key={index} style={alignment(index)}>{format(row[index] ?? "")}</td>)}</tr>)}</tbody></table>
        </div>
      </div>;
    }
    return <p key={key}>{format(block.body)}</p>;
  })}</div>;
}

function parseZenReport(text: string): { rows: AccessRow[]; note: string } | null {
  if (!text.startsWith("Zen free-model access through Orvix's direct API:")) return null;
  const [body, ...noteParts] = text.split(/\n\s*\n/);
  const rows = body.split("\n").slice(1).map(line => {
    const match = /^- (.+?): (.+?)(?: \(HTTP (\d+)\))?$/.exec(line.trim());
    return match ? { name: match[1], status: match[2], http: match[3] ? Number(match[3]) : null } : null;
  }).filter((row): row is AccessRow => row !== null);
  return rows.length ? { rows, note: noteParts.join("\n\n") } : null;
}

function ZenAccessReport({ rows, note }: { rows: AccessRow[]; note: string }) {
  const available = rows.filter(row => row.status === "available").length;
  const blocked = rows.filter(row => row.status === "blocked for independent clients").length;
  return <section className="agent-access-report" aria-label="OpenCode Zen access report">
    <header className="agent-access-report-head"><span className="agent-access-report-icon"><KeyRound size={18} /></span><div><span className="agent-report-eyebrow">API ACCESS REPORT</span><h2>OpenCode Zen</h2><p>{rows.length} free models checked through Orvix</p></div></header>
    <div className="agent-access-summary"><div><strong>{available}</strong><span>Available</span></div><div><strong>{blocked}</strong><span>Client restricted</span></div><div><strong>{rows.length - available - blocked}</strong><span>Other result</span></div></div>
    <div className="agent-access-rows">{rows.map(row => {
      const kind = row.status === "available" ? "available" : row.status === "blocked for independent clients" ? "blocked" : "other";
      const Icon = kind === "available" ? ShieldCheck : kind === "blocked" ? ShieldAlert : Info;
      return <div className={`agent-access-row ${kind}`} key={row.name}><span className="agent-access-row-icon"><Icon size={16} /></span><strong>{row.name}</strong><span className="agent-access-state">{row.status}</span>{row.http && <small>HTTP {row.http}</small>}</div>;
    })}</div>
    {note && <p className="agent-access-note"><Info size={14} />{note}</p>}
  </section>;
}

function SingleAccessReport({ text }: { text: string }) {
  const firstLine = text.split("\n", 1)[0];
  const match = /^([^:\n]{2,40}): (key accepted|key rejected|access denied|rate limited|provider returned|authentication not accepted|request timed out|network request failed)(.*)$/i.exec(firstLine);
  const success = match?.[2].toLowerCase() === "key accepted";
  return <section className="agent-access-report agent-access-single" aria-label="API access report">
    <header className="agent-access-report-head"><span className="agent-access-report-icon">{success ? <ShieldCheck size={18} /> : <KeyRound size={18} />}</span><div><span className="agent-report-eyebrow">API ACCESS REPORT</span><h2>{match?.[1] ?? "Credential check"}</h2><p>{success ? "Authentication confirmed" : "Provider response"}</p></div>{success && <span className="agent-access-ok"><Check size={13} /> Accepted</span>}</header>
    <div className="agent-access-single-body"><MarkdownReport text={match ? `${match[2]}${match[3]}${text.slice(firstLine.length)}` : text} /></div>
  </section>;
}

export default function AgentReport({ text, keyCheck = false, onLocalFile, localFiles = [] }: { text: string; keyCheck?: boolean; onLocalFile?: (file: string) => void; localFiles?: string[] }) {
  const zen = useMemo(() => (keyCheck ? parseZenReport(text) : null), [text, keyCheck]);
  if (zen) return <ZenAccessReport rows={zen.rows} note={zen.note} />;
  if (keyCheck) return <SingleAccessReport text={text} />;
  const choices = useMemo(() => (!keyCheck ? designOptionsPresentation(text) : null), [text, keyCheck]);
  if (choices) {
    return <div className="agent-report-prose">
      <section className="agent-design-options" aria-label="Design options and selection">
        <div className="agent-design-options-header">
          <p className="agent-design-options-title">Design directions</p>
          {choices.selected && <span className="agent-design-options-badge">Option {choices.selected} Selected</span>}
        </div>
        <div className="agent-design-options-grid">{choices.options.map(option => {
          const isSelected = option.label === choices.selected;
          return <article className={`agent-design-option${isSelected ? ' is-selected' : ''}`} key={option.label} aria-label={`Option ${option.label}`}>
            <div className="agent-design-option-top">
              <h3>Option {option.label}{option.title ? `: ${option.title}` : ''}</h3>
              {isSelected && <span className="agent-design-selected-tag">Selected</span>}
            </div>
            <div className="agent-design-option-copy">{option.body}</div>
          </article>;
        })}</div>
        {choices.reason && <div className="agent-design-selection">
          <strong>Selection reason</strong>
          <p>{choices.reason}</p>
        </div>}
        {choices.status && <p className="agent-design-options-status">{choices.status}</p>}
      </section>
      <MarkdownReport text={text} onLocalFile={onLocalFile} localFiles={localFiles} />
    </div>;
  }
  return <MarkdownReport text={text} onLocalFile={onLocalFile} localFiles={localFiles} />;
}
