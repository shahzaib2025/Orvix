const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isHiddenPath } = require('./file-policy.cjs');

const searchLimit = 80;
const outputLimit = 26000;
const codeExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.cs', '.c', '.cc', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.kts', '.vue', '.svelte']);
const codeGlob = `*.{${[...codeExtensions].map(value => value.slice(1)).join(',')}}`;
const exclusions = [
  '!**/.git/**', '!**/node_modules/**', '!**/dist/**', '!**/build/**', '!**/release/**',
  '!**/coverage/**', '!**/target/**', '!**/.next/**', '!**/.cache/**',
  '!**/.ssh/**', '!**/.aws/**', '!**/.gnupg/**', '!**/.config/**',
  '!**/.env', '!**/.env.*', '!**/*.{pem,pfx,p12,keystore}',
  '!**/{id_rsa,id_ed25519,id_ecdsa,known_hosts,secrets.json,secrets.yaml,secrets.yml}',
];

function executable(rgPath) {
  const unpacked = rgPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  return unpacked !== rgPath && fs.existsSync(unpacked) ? unpacked : rgPath;
}

function commonArgs() {
  return ['--json', '--no-messages', '--hidden', '--max-filesize', '10M', '--threads', '2',
    ...exclusions.flatMap(glob => ['--glob', glob])];
}

async function runSearch(directory, query, options, workspaces, taskId, signal) {
  const { rgPath } = await import('@vscode/ripgrep');
  const args = [...commonArgs(), ...(options.codeOnly ? ['--glob', codeGlob] : []),
    ...(options.context ? ['--context', '1'] : []),
    ...(options.regex ? [] : ['--fixed-strings']),
    ...(options.wholeWord ? ['--word-regexp'] : []), '--', query, '.'];
  return new Promise((resolve, reject) => {
    const child = spawn(executable(rgPath), args, { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const matches = [];
    const contexts = new Map();
    const maxMatches = options.maxMatches ?? searchLimit;
    let pending = '';
    let stderr = '';
    let stoppedForLimit = false;
    let timedOut = false;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => { child.kill(); finish(new Error('Task cancelled.')); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20000);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      pending += chunk.toString('utf8');
      if (pending.length > 2_000_000) { stoppedForLimit = true; child.kill(); return; }
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1 && matches.length < maxMatches) {
        const raw = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let event;
        try { event = JSON.parse(raw); } catch { continue; }
        if (event.type !== 'match' && event.type !== 'context') continue;
        const relative = event.data?.path?.text;
        if (typeof relative !== 'string' || isHiddenPath(relative)) continue;
        const file = path.resolve(directory, relative);
        try { workspaces.assert(taskId, file); } catch { continue; }
        const line = Number(event.data.line_number);
        if (!Number.isSafeInteger(line) || line < 1) continue;
        const text = String(event.data.lines?.text ?? '').replace(/\r?\n$/, '');
        if (event.type === 'context') {
          if (contexts.size < maxMatches * 3) contexts.set(`${file}:${line}`, clipped(text, 120));
          continue;
        }
        const offset = Number(event.data.submatches?.[0]?.start ?? 0);
        const column = Buffer.from(text).subarray(0, Math.max(0, offset)).toString('utf8').length + 1;
        matches.push({ file, line, column, text });
      }
      if (matches.length >= maxMatches) { stoppedForLimit = true; child.kill(); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (timedOut) return finish(new Error('Code search timed out after 20 seconds.'));
      if (!stoppedForLimit && code !== 0 && code !== 1) return finish(new Error(`Code search failed: ${stderr || `exit ${code}`}`));
      finish(null, { matches, contexts, truncated: stoppedForLimit });
    });
    if (signal.aborted) abort();
  });
}

function clipped(value, max, center = 0) {
  const text = String(value).replace(/\r?\n$/, '');
  if (text.length <= max) return text;
  const start = Math.max(0, Math.min(text.length - max, center - Math.floor(max / 3)));
  return `${start ? '…' : ''}${text.slice(start, start + max)}${start + max < text.length ? '…' : ''}`;
}

function bounded(results, extra = {}) {
  const kept = [...results];
  let output;
  do {
    output = JSON.stringify({ ...extra, results: kept, truncated: Boolean(extra.truncated || kept.length < results.length) });
    if (Buffer.byteLength(output) <= outputLimit || !kept.length) return output;
    kept.pop();
  } while (true);
}

async function searchContent(directory, query, regex, workspaces, taskId, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 240) throw new Error('Use a nonempty search query under 240 characters.');
  const { matches, contexts, truncated } = await runSearch(directory, query,
    { regex: regex === true, context: true }, workspaces, taskId, signal);
  const matchedLines = new Map(matches.map(match => [`${match.file}:${match.line}`, clipped(match.text, 120)]));
  const results = [];
  for (const match of matches) {
    results.push({ file: match.file, line: match.line, column: match.column,
      before: contexts.get(`${match.file}:${match.line - 1}`) ?? matchedLines.get(`${match.file}:${match.line - 1}`) ?? '',
      text: clipped(match.text, 260, match.column - 1),
      after: contexts.get(`${match.file}:${match.line + 1}`) ?? matchedLines.get(`${match.file}:${match.line + 1}`) ?? '' });
  }
  return bounded(results, { query, truncated });
}

async function readFileRange(file, startLine, endLine) {
  if (!Number.isInteger(startLine) || startLine < 1) throw new Error('start_line must be a positive integer.');
  if (endLine === undefined) endLine = startLine + 119;
  if (!Number.isInteger(endLine) || endLine < startLine || endLine - startLine > 299) throw new Error('Choose up to 300 consecutive lines.');
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > 20_000_000) throw new Error('Ranged reads support text files up to 20 MB.');
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const lines = [];
  let current = 0;
  let hasMore = false;
  let clippedLine = false;
  let outputBytes = 0;
  try {
    for await (const text of reader) {
      if (text.includes('\0')) throw new Error('This is a binary file.');
      current++;
      if (current < startLine) continue;
      if (current > endLine) { hasMore = true; break; }
      const shown = clipped(text, 4000);
      clippedLine ||= shown.length !== text.length;
      const item = { line: current, text: shown };
      const bytes = Buffer.byteLength(JSON.stringify(item));
      if (outputBytes + bytes > outputLimit - 1200) { hasMore = true; break; }
      outputBytes += bytes;
      lines.push(item);
    }
  } finally { reader.close(); stream.destroy(); }
  if (current < startLine && !(stat.size === 0 && startLine === 1)) throw new Error(`File ends at line ${current}.`);
  const fileHash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) fileHash.update(chunk);
  return JSON.stringify({ file, startLine, endLine: lines.at(-1)?.line ?? startLine - 1,
    hasMore, clippedLine, sha256: fileHash.digest('hex'), lines });
}

function definitionKind(line, symbol, file) {
  const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const extension = path.extname(file).toLowerCase();
  if (extension === '.py' && new RegExp(`^\\s*(?:async\\s+)?def\\s+${name}\\s*\\(`).test(line)) return 'function';
  if (extension === '.go' && new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${name}\\s*\\(`).test(line)) return 'function';
  if (extension === '.rs' && new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\b`).test(line)) return 'function';
  if (new RegExp(`^\\s*(?:(?:export|default|declare|public|private|protected|static|abstract|async|final|open|internal)\\s+)*(class|interface|type|enum|struct|trait|record|function|func|fun|fn|def|const|let|var|object)\\s+${name}(?![\\w$])`).test(line)) return 'declaration';
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.php'].includes(extension)
    && new RegExp(`^\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::[^={]+)?\\s*(?:\\{|=>|:)`).test(line)) return 'method';
  if (['.java', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp', '.kt', '.kts', '.swift'].includes(extension)
    && !/^\s*(?:return|throw|new|if|while|for|switch)\b/.test(line)
    && new RegExp(`^\\s*(?:(?:public|private|protected|static|final|virtual|override|async|inline|extern|internal|open|suspend)\\s+)*(?:[\\w<>?*\\[\\],]+\\s+)+${name}\\s*\\(`).test(line)) return 'method candidate';
  return null;
}

async function findSymbol(directory, symbol, workspaces, taskId, signal) {
  if (typeof symbol !== 'string' || !/^[A-Za-z_$][\w$]{0,119}$/.test(symbol)) throw new Error('Use one identifier name, such as a function or class name.');
  const { matches, truncated } = await runSearch(directory, symbol,
    { wholeWord: !symbol.includes('$'), codeOnly: true, maxMatches: 500 }, workspaces, taskId, signal);
  const definitions = [];
  const references = [];
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identifier = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
  for (const match of matches) {
    if (!codeExtensions.has(path.extname(match.file).toLowerCase())) continue;
    if (!identifier.test(match.text)) continue;
    const kind = definitionKind(match.text, symbol, match.file);
    const item = { file: match.file, line: match.line, column: match.column, text: clipped(match.text, 250, match.column - 1) };
    if (kind) definitions.push({ ...item, role: 'definition', kind });
    else references.push({ ...item, role: 'reference' });
  }
  return bounded([...definitions, ...references], { symbol, definitions: definitions.length, references: references.length,
    method: 'textual candidates', truncated });
}

module.exports = { searchContent, readFileRange, findSymbol };
