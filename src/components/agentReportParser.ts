type SourceSpan = { start: number; end: number };
type Line = SourceSpan & { value: string; contentEnd: number };
export type TableAlignment = "left" | "center" | "right";
export type ReportBlock = SourceSpan & (
  | { kind: "heading"; level: number; title: string; sectionEnd: number }
  | { kind: "paragraph" | "quote"; body: string }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; firstNumber: number; items: { body: string; nested: boolean }[] }
  | { kind: "code"; language: string; codeStart: number; codeEnd: number; closed: boolean }
  | { kind: "table"; headers: string[]; rows: string[][]; alignments: TableAlignment[]; columns: number }
);

function sourceLines(source: string): Line[] {
  const lines: Line[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) && match[0].length) {
    lines.push({ value: match[1], start: match.index, contentEnd: match.index + match[1].length, end: pattern.lastIndex });
  }
  return lines;
}

// Only unescaped pipes outside matching inline-code runs separate cells.
export function splitTableRow(value: string): string[] {
  const line = value.trim();
  const cells: string[] = [];
  const separators: number[] = [];
  let codeRun = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "`") {
      let length = 1;
      while (line[i + length] === "`") length++;
      if (codeRun === length) codeRun = 0;
      else if (!codeRun && line.indexOf("`".repeat(length), i + length) !== -1) codeRun = length;
      i += length - 1;
    } else if (line[i] === "|" && !codeRun) separators.push(i);
  }
  let start = 0;
  for (const index of separators) { cells.push(line.slice(start, index).trim()); start = index + 1; }
  cells.push(line.slice(start).trim());
  if (separators[0] === 0) cells.shift();
  if (separators.at(-1) === line.length - 1) cells.pop();
  return cells;
}

const headingPattern = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const listPattern = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const rulePattern = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
function tableAt(lines: Line[], index: number) {
  if (!lines[index]?.value.includes("|") || !lines[index + 1]?.value.includes("|")) return null;
  const headers = splitTableRow(lines[index].value);
  const dividers = splitTableRow(lines[index + 1].value);
  if (!headers.length || headers.length !== dividers.length || !dividers.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return { headers, alignments: dividers.map((cell): TableAlignment => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left") };
}
function startsBlock(lines: Line[], index: number) {
  const value = lines[index].value;
  return headingPattern.test(value) || fencePattern.test(value) || listPattern.test(value)
    || rulePattern.test(value) || /^\s*>/.test(value) || !!tableAt(lines, index);
}

export function parseAgentReport(source: string): ReportBlock[] {
  const lines = sourceLines(source);
  const blocks: ReportBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.value.trim()) { index++; continue; }
    const start = line.start;
    const fence = fencePattern.exec(line.value);
    if (fence && (fence[1][0] !== "`" || !fence[2].includes("`"))) {
      const codeStart = line.end;
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      index++;
      while (index < lines.length && !closing.test(lines[index].value)) index++;
      const codeEnd = index < lines.length ? lines[index].start : source.length;
      const closed = index < lines.length;
      if (index < lines.length) index++;
      blocks.push({ kind: "code", start, end: lines[index - 1].end, codeStart, codeEnd, language: fence[2].trim(), closed });
      continue;
    }
    const heading = headingPattern.exec(line.value);
    if (heading) {
      blocks.push({ kind: "heading", start, end: line.end, title: heading[2], level: heading[1].length, sectionEnd: source.length });
      index++; continue;
    }
    if (rulePattern.test(line.value)) { blocks.push({ kind: "rule", start, end: line.end }); index++; continue; }
    const table = tableAt(lines, index);
    if (table) {
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].value.trim() && lines[index].value.includes("|")
        && !headingPattern.test(lines[index].value) && !fencePattern.test(lines[index].value)) rows.push(splitTableRow(lines[index++].value));
      blocks.push({ kind: "table", start, end: lines[index - 1].end, ...table, rows,
        columns: Math.max(table.headers.length, ...rows.map(row => row.length)) });
      continue;
    }
    if (/^\s*>/.test(line.value)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index].value)) body.push(lines[index++].value.replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", start, end: lines[index - 1].end, body: body.join("\n") }); continue;
    }
    const list = listPattern.exec(line.value);
    if (list) {
      const ordered = /^\d/.test(list[2]);
      const items: { body: string; nested: boolean }[] = [];
      while (index < lines.length) {
        const match = listPattern.exec(lines[index].value);
        if (!match || /^\d/.test(match[2]) !== ordered) break;
        items.push({ body: match[3], nested: match[1].length > list[1].length }); index++;
      }
      blocks.push({ kind: "list", start, end: lines[index - 1].end, ordered, firstNumber: ordered ? parseInt(list[2], 10) : 1, items }); continue;
    }
    const body = [line.value];
    index++;
    while (index < lines.length && lines[index].value.trim() && !startsBlock(lines, index)) body.push(lines[index++].value);
    blocks.push({ kind: "paragraph", start, end: lines[index - 1].end, body: body.join("\n") });
  }
  const headings = blocks.filter((block): block is Extract<ReportBlock, { kind: "heading" }> => block.kind === "heading");
  const open: typeof headings = [];
  for (const heading of headings) {
    while (open.length && open[open.length - 1].level >= heading.level) open.pop()!.sectionEnd = heading.start;
    open.push(heading);
  }
  return blocks;
}
