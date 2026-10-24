import { useMemo } from "react";
import { diffLines } from "diff";

type Row = { text: string; lineNo: number; kind: "context" | "removed" | "added" };
const lines = (value: string) => value.match(/[^\n]*\n|[^\n]+$/g)?.map(line => line.replace(/\r?\n$/, "")) ?? [];

function rows(before: string, after: string): Row[] {
  const parts = diffLines(before, after);
  const result: Row[] = [];
  let beforeNo = 1, afterNo = 1;
  for (let index = 0; index < parts.length;) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      for (const text of lines(part.value)) result.push({ text, lineNo: afterNo++, kind: "context" });
      beforeNo += lines(part.value).length;
      index++;
      continue;
    }
    const removed: string[] = [], added: string[] = [];
    while (index < parts.length && (parts[index].removed || parts[index].added)) {
      (parts[index].removed ? removed : added).push(...lines(parts[index].value));
      index++;
    }
    for (const text of removed) result.push({ text, lineNo: beforeNo++, kind: "removed" });
    for (const text of added) result.push({ text, lineNo: afterNo++, kind: "added" });
  }
  return result;
}

export default function AgentDiff({ before, after }: { before: string | null; after: string | null }) {
  const allRows = useMemo(() => rows(before ?? "", after ?? ""), [before, after]);
  return <div className="agent-diff-view" role="table" aria-label="Unified before and after file diff">
    <div className="agent-diff-titles" role="row"><strong role="columnheader">Unified diff</strong></div>
    <div className="agent-diff-scroll">{allRows.length ? allRows.map((row, index) => <div className={`agent-diff-row is-${row.kind}`} role="row" key={index}>
      <div role="cell"><span aria-hidden="true">{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : " "}{row.lineNo}</span><code>{row.text || " "}</code></div>
    </div>) : <p className="agent-changes-note">No text differences.</p>}</div>
  </div>;
}
