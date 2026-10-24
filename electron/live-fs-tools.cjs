const fs = require('node:fs');
const path = require('node:path');
const { ignoredDirectories, isSensitiveFile, isHiddenPath } = require('./agent/file-policy.cjs');

const os = require('node:os');
const DEFAULT_WORKSPACE = path.resolve(__dirname, '..');

function matchExistingSpelling(target) {
  if (fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  let current = parsed.root;
  const parts = path.relative(parsed.root, target).split(path.sep).filter(Boolean);
  for (const part of parts) {
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) { current = exact; continue; }
    if (!fs.existsSync(current)) return target;
    const normalized = part.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) return target;
    let matches;
    try {
      matches = fs.readdirSync(current).filter(name => name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
    } catch { return target; }
    if (matches.length !== 1) return target;
    current = path.join(current, matches[0]);
  }
  return current;
}

function resolveTargetDir(rawDir) {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  if (typeof rawDir === 'string' && rawDir.trim()) {
    let dir = rawDir.trim().replace(/^["']|["']$/g, '');
    const lower = dir.toLowerCase();

    const homeFolder = dir.match(/^(?:the\s+)?(desktop|documents|downloads)(?:\s+(?:folder|directory))?(?:[\\/](.*))?$/i);
    if (homeFolder) return matchExistingSpelling(path.join(home, homeFolder[1], homeFolder[2] || ''));

    if (lower === 'my documents') return path.join(home, 'Documents');
    if (lower === 'home' || lower === 'user' || lower === 'user folder' || lower === 'computer' || lower === 'my computer') {
      return home;
    }
    const driveMatch = dir.match(/^(?:(?:in\s+|the\s+)?drive\s+|(?:in\s+|the\s+)?)([a-zA-Z]):?(?:\s*drive)?(?:[\\/](.*))?$/i);
    if (driveMatch) {
      const driveLetter = driveMatch[1].toUpperCase();
      const rest = (driveMatch[2] || '').replace(/^[\\/]+/, '');
      const full = path.join(`${driveLetter}:\\`, rest);
      return matchExistingSpelling(full);
    }
    if (!path.isAbsolute(dir)) {
      const desktopChild = path.join(desktop, dir);
      if (fs.existsSync(desktopChild)) return desktopChild;
      const homeChild = path.join(home, dir);
      if (fs.existsSync(homeChild)) return homeChild;
      dir = path.resolve(DEFAULT_WORKSPACE, dir);
    }
    return matchExistingSpelling(dir);
  }
  return desktop;
}

const SENSITIVE_PATTERN = /(?:api[\s_-]*(?:keys?|providers?|tokens?)|passwords?|credentials?|secrets?|accounts?|\.env|id_rsa|id_ed25519|number\s*of|whatsapp)/i;
const BINARY_OR_SYSTEM_EXTENSIONS = /\.(?:exe|lnk|bat|cmd|dll|sys|ps1|vbs|rar|zip|7z|tar|gz|bak|tmp|swp)$/i;

function isLiveFSSensitive(name) {
  if (!name) return false;
  const clean = name.replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim();
  if (!clean) return true;
  if (clean.startsWith('~$') || clean.startsWith('.') || clean.toLowerCase() === 'desktop.ini' || clean.toLowerCase() === 'thumbs.db') return true;
  if (BINARY_OR_SYSTEM_EXTENSIONS.test(clean)) return true;
  if (isSensitiveFile(clean)) return true;
  if (SENSITIVE_PATTERN.test(clean)) return true;
  return false;
}

async function listDirectory(input = {}) {
  const targetDir = resolveTargetDir(input.directory);
  console.log(`[Orvix Live Tool: list_directory] Target: ${targetDir}`);
  try {
    if (!fs.existsSync(targetDir)) {
      console.error(`[Orvix Live Tool: list_directory] Directory not found: ${targetDir}`);
      return { status: 'not_found', directory: targetDir, message: `Directory not found: '${targetDir}'. Use an exact path from a previous directory listing or ask the user to clarify.` };
    }
    const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    const valid = entries
      .filter(entry => !isLiveFSSensitive(entry.name))
      .map(entry => ({
        name: entry.name.replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim(),
        type: entry.isDirectory() ? 'folder' : 'file',
      }));

    const folders = valid.filter(i => i.type === 'folder').map(i => i.name);
    const files = valid.filter(i => i.type === 'file').map(i => i.name);

    console.log(`[Orvix Live Tool: list_directory] Found ${valid.length} items (${folders.length} folders, ${files.length} files) in ${targetDir}`);
    return {
      status: "ok",
      directory: targetDir,
      totalCount: valid.length,
      folderCount: folders.length,
      fileCount: files.length,
      folders: folders.slice(0, 12),
      files: files.slice(0, 12),
      shownFolderCount: Math.min(folders.length, 12),
      shownFileCount: Math.min(files.length, 12),
      truncated: folders.length > 12 || files.length > 12,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Live Tool: list_directory] ERROR: ${message}`);
    return { status: "unavailable", directory: targetDir, message: `Could not list directory '${targetDir}': ${message}` };
  }
}

async function searchFiles(input = {}) {
  const targetDir = resolveTargetDir(input.directory);
  const query = String(input.query || '').trim().toLowerCase();
  console.log(`[Orvix Live Tool: search_files] Query: "${query}" in Target: ${targetDir}`);
  try {
    if (!fs.existsSync(targetDir)) {
      console.error(`[Orvix Live Tool: search_files] Directory not found: ${targetDir}`);
      return { status: "not_found", directory: targetDir, message: `Directory not found: '${targetDir}'. Use an exact path or check the folder name.` };
    }
    const found = [];
    const queue = [targetDir];
    let visited = 0;
    while (queue.length && found.length < 100 && visited++ < 1500) {
      const current = queue.shift();
      let entries;
      try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (ignoredDirectories.has(entry.name.toLowerCase())) continue;
        if (isLiveFSSensitive(entry.name)) continue;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (entry.isFile()) {
          if (entry.name.toLowerCase().includes(query)) {
            found.push({ file: path.relative(targetDir, fullPath) || entry.name, fullPath });
          }
        }
        if (found.length >= 100) break;
      }
    }
    console.log(`[Orvix Live Tool: search_files] Found ${found.length} matches for "${query}"`);
    return {
      status: found.length ? "ok" : "no_matches",
      directory: targetDir,
      query,
      count: found.length,
      results: found.map(f => f.file),
      ...(found.length ? {} : { message: `No files found matching '${query}' in '${targetDir}'.` }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Live Tool: search_files] ERROR: ${message}`);
    return { status: "unavailable", directory: targetDir, message: `Could not search files in '${targetDir}': ${message}` };
  }
}

async function searchContent(input = {}) {
  const targetDir = resolveTargetDir(input.directory);
  const query = String(input.query || '').trim();
  const isRegex = input.regex === true;
  console.log(`[Orvix Live Tool: search_content] Query: "${query}" (regex=${isRegex}) in Target: ${targetDir}`);

  if (!query) {
    console.error(`[Orvix Live Tool: search_content] Empty query provided`);
    return { status: "invalid_query", message: "Please provide a query to search content for." };
  }

  try {
    if (!fs.existsSync(targetDir)) {
      console.error(`[Orvix Live Tool: search_content] Directory not found: ${targetDir}`);
      return { status: "not_found", directory: targetDir, message: `Directory not found: '${targetDir}'.` };
    }

    const { rgPath } = await import('@vscode/ripgrep');
    const { spawn } = require('node:child_process');

    const unpacked = rgPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    const rgExe = unpacked !== rgPath && fs.existsSync(unpacked) ? unpacked : rgPath;

    const args = [
      '--json',
      '--no-messages',
      '--hidden',
      '--max-filesize', '10M',
      '--threads', '2',
      '--glob', '!**/.git/**',
      '--glob', '!**/node_modules/**',
      '--glob', '!**/dist/**',
      '--glob', '!**/build/**',
      '--glob', '!**/.env*',
      '--glob', '!**/*secret*',
      '--glob', '!**/*password*',
      '--glob', '!**/*credential*',
      '--glob', '!**/*api_key*',
      '--glob', '!**/*account*',
      ...(isRegex ? [] : ['--fixed-strings']),
      '--', query, '.'
    ];

    const results = await new Promise((resolve, reject) => {
      const child = spawn(rgExe, args, { cwd: targetDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const matches = [];
      let pending = '';
      let stderr = '';
      const timer = setTimeout(() => { child.kill(); resolve(matches); }, 15000);

      child.stdout.on('data', chunk => {
        pending += chunk.toString('utf8');
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1 && matches.length < 50) {
          const raw = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let event;
          try { event = JSON.parse(raw); } catch { continue; }
          if (event.type === 'match') {
            const relPath = event.data?.path?.text;
            const line = event.data?.line_number;
            const text = String(event.data?.lines?.text ?? '').trim();
            if (relPath && line) {
              matches.push({ file: relPath, line, snippet: text.slice(0, 160) });
            }
          }
        }
        if (matches.length >= 50) child.kill();
      });

      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(matches);
      });
      child.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });

    console.log(`[Orvix Live Tool: search_content] Found ${results.length} matches for "${query}"`);
    return {
      status: results.length ? "ok" : "no_matches",
      directory: targetDir,
      query,
      count: results.length,
      matches: results.slice(0, 15),
      ...(results.length ? {} : { message: `No code text matches found for '${query}'.` }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Live Tool: search_content] ERROR: ${message}`);
    return { status: "search_failed", message: `Search could not be completed: ${message}` };
  }
}

function findWithCommonExtensions(baseCandidate) {
  if (fs.existsSync(baseCandidate)) return baseCandidate;
  const ext = path.extname(baseCandidate);
  if (!ext) {
    const common = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.cjs', '.mjs', '.yaml', '.yml'];
    for (const e of common) {
      const candidate = `${baseCandidate}${e}`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveTargetFile(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  let target = rawPath.trim().replace(/^["']|["']$/g, '');
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');

  // Handle tilde home prefix (~/Desktop or ~\Desktop)
  if (target.startsWith('~') && (target[1] === '/' || target[1] === '\\' || target.length === 1)) {
    target = path.join(home, target.slice(1).replace(/^[\\/]/, ''));
  } else if (/^[\\/][a-zA-Z0-9_.-]/.test(target) && !/^[a-zA-Z]:/.test(target)) {
    // Leading slash without Windows drive letter: treat as relative to workspace
    target = target.replace(/^[\\/]+/, '');
  }

  // Handle natural home folders: Desktop/..., Documents/..., Downloads/...
  const homeFolderMatch = target.match(/^(?:the\s+)?(desktop|documents|downloads)(?:\s+(?:folder|directory))?[\\/](.+)$/i);
  if (homeFolderMatch) {
    const candidate = path.join(home, homeFolderMatch[1], homeFolderMatch[2]);
    const extMatch = findWithCommonExtensions(candidate);
    if (extMatch) return matchExistingSpelling(extMatch);
    return matchExistingSpelling(candidate);
  }

  if (path.isAbsolute(target)) {
    const extMatch = findWithCommonExtensions(target);
    if (extMatch) return matchExistingSpelling(extMatch);
    return matchExistingSpelling(target);
  }

  // Check workspace first
  const workspaceChild = path.resolve(DEFAULT_WORKSPACE, target);
  const wsExt = findWithCommonExtensions(workspaceChild);
  if (wsExt) return wsExt;

  // Check Desktop
  const desktopChild = path.join(desktop, target);
  const dtExt = findWithCommonExtensions(desktopChild);
  if (dtExt) return dtExt;

  // Check Documents
  const docsChild = path.join(home, 'Documents', target);
  const docsExt = findWithCommonExtensions(docsChild);
  if (docsExt) return docsExt;

  // Check Downloads
  const downloadsChild = path.join(home, 'Downloads', target);
  const dlExt = findWithCommonExtensions(downloadsChild);
  if (dlExt) return dlExt;

  // Default fallback: resolved workspace path
  return matchExistingSpelling(workspaceChild);
}

function redactLiveSecrets(text) {
  let output = String(text);
  for (const name of ['ORVIX_OPENCODE_ZEN_KEY', 'ORVIX_OPENCODE_GO_KEY', 'ORVIX_INCEPTION_API_KEY', 'GEMINI_API_KEY', 'LANGSEARCH_API_KEY']) {
    const secret = process.env[name];
    if (secret && secret.length >= 8) output = output.replaceAll(secret, '[REDACTED]');
  }
  return output
    .replace(/\bAIzaSy[A-Za-z0-9_-]{33}\b/g, '[REDACTED_API_KEY]')
    .replace(/\boc_sk_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]');
}

async function readFile(input = {}) {
  let rawPath = '';
  if (typeof input === 'string') {
    rawPath = input;
  } else if (input && typeof input === 'object') {
    rawPath = String(input.path || input.file || input.filename || input.filepath || input.target || input.uri || '');
  }
  const resolved = resolveTargetFile(rawPath);
  console.log(`[Orvix Live Tool: read_file] Requested: "${rawPath}" -> Resolved: "${resolved}"`);

  if (!resolved) {
    return { status: "missing_path", message: "Please specify a file path or file name to read." };
  }

  try {
    if (!fs.existsSync(resolved)) {
      console.warn(`[Orvix Live Tool: read_file] File not found: ${resolved}`);
      return {
        status: "not_found",
        path: resolved,
        message: `File not found at '${resolved}'. You can use search_files or list_directory to find where it is located.`
      };
    }

    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) {
      return {
        status: "is_directory",
        path: resolved,
        message: `'${resolved}' is a folder, not a file. Use list_directory to view its contents.`
      };
    }

    if (stat.size > 5 * 1024 * 1024) {
      return {
        status: "file_too_large",
        path: resolved,
        sizeBytes: stat.size,
        message: `File is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Only files under 5 MB can be read in live voice.`
      };
    }

    const baseName = path.basename(resolved);
    if (isLiveFSSensitive(baseName) || isHiddenPath(resolved)) {
      console.warn(`[Orvix Live Tool: read_file] Blocked reading sensitive file: ${resolved}`);
      return {
        status: "permission_denied",
        error: `Access Denied: '${baseName}' is classified as a sensitive credential or security file. Explain to the user that this file is protected and cannot be read.`,
        path: resolved,
        message: `Reading '${baseName}' is blocked because it is classified as a sensitive system or credential file.`
      };
    }

    const rawBuffer = await fs.promises.readFile(resolved);
    let rawText = '';
    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xFF && rawBuffer[1] === 0xFE) {
      rawText = rawBuffer.toString('utf16le');
    } else if (rawBuffer.includes(0)) {
      let isUtf16 = true;
      for (let i = 1; i < Math.min(rawBuffer.length, 100); i += 2) {
        if (rawBuffer[i] !== 0) { isUtf16 = false; break; }
      }
      if (isUtf16) {
        rawText = rawBuffer.toString('utf16le');
      } else {
        return {
          status: "binary_file",
          path: resolved,
          message: `'${baseName}' appears to be a binary file and cannot be read as text.`
        };
      }
    } else {
      rawText = rawBuffer.toString('utf8');
    }

    let processedText = rawText;
    const isHtml = resolved.toLowerCase().endsWith('.html') || resolved.toLowerCase().endsWith('.htm');
    if (isHtml) {
      processedText = processedText
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
    }

    const allLines = processedText.split(/\r?\n/);
    const totalLines = allLines.length;
    const startLine = Math.max(1, parseInt(input.startLine, 10) || 1);
    const maxLines = Math.min(100, Math.max(1, parseInt(input.maxLines, 10) || 60));
    const slice = allLines.slice(startLine - 1, startLine - 1 + maxLines);

    const formattedContent = redactLiveSecrets(
      slice.map((line, idx) => `L${startLine + idx}: ${line}`).join('\n')
    ).slice(0, 2500);

    const hasMore = (startLine - 1 + slice.length) < totalLines;
    console.log(`[Orvix Live Tool: read_file] Read lines ${startLine}..${startLine - 1 + slice.length} (${formattedContent.length} chars) from ${resolved}`);

    return {
      status: "ok",
      path: resolved,
      totalLines,
      startLine,
      returnedLines: slice.length,
      hasMore,
      content: formattedContent || "(Empty file)",
      ...(hasMore ? { hint: `File has ${totalLines} total lines. To read further, specify startLine: ${startLine + slice.length}.` } : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Live Tool: read_file] ERROR: ${message}`);
    return { status: "read_failed", path: resolved, message: `Could not read file: ${message}` };
  }
}

function resolveTargetFileForWrite(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  let target = rawPath.trim().replace(/^["']|["']$/g, '');
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');

  // Handle tilde home prefix (~/Desktop or ~\Desktop)
  if (target.startsWith('~') && (target[1] === '/' || target[1] === '\\' || target.length === 1)) {
    return path.join(home, target.slice(1).replace(/^[\\/]/, ''));
  }

  // Handle leading slash without Windows drive letter
  if (/^[\\/][a-zA-Z0-9_.-]/.test(target) && !/^[a-zA-Z]:/.test(target)) {
    target = target.replace(/^[\\/]+/, '');
  }

  // Handle home folders: Desktop/..., Documents/..., Downloads/...
  const homeFolderMatch = target.match(/^(?:the\s+)?(desktop|documents|downloads)(?:\s+(?:folder|directory))?[\\/](.+)$/i);
  if (homeFolderMatch) {
    return path.join(home, homeFolderMatch[1], homeFolderMatch[2]);
  }

  // Windows absolute path: C:\... or H:\...
  if (path.isAbsolute(target)) {
    return target;
  }

  // Drive letter matches like "H:/..." or "H:\..."
  const driveMatch = target.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (driveMatch) {
    return path.join(`${driveMatch[1].toUpperCase()}:\\`, driveMatch[2] || '');
  }

  // If path starts with desktop or Desktop
  if (/^desktop[\\/]/i.test(target)) {
    return path.join(desktop, target.replace(/^desktop[\\/]/i, ''));
  }

  // If target already exists in Desktop, resolve there
  if (fs.existsSync(path.join(desktop, target))) {
    return path.join(desktop, target);
  }

  // If target already exists in workspace, resolve there
  const wsTarget = path.resolve(DEFAULT_WORKSPACE, target);
  if (fs.existsSync(wsTarget)) {
    return wsTarget;
  }

  // Default to Desktop if relative filename (e.g. "todo.txt", "hello.py")
  return path.join(desktop, target);
}

async function writeFile(input = {}) {
  let rawPath = '';
  let content = '';
  if (typeof input === 'string') {
    rawPath = input;
  } else if (input && typeof input === 'object') {
    rawPath = String(input.path || input.file || input.filename || input.filepath || input.target || '');
    content = String(input.content ?? input.code ?? input.text ?? '');
  }
  console.log(`[Orvix Live Tool: write_file] Requested path: "${rawPath}" (${content.length} chars)`);

  if (!rawPath.trim()) {
    return { status: "missing_path", message: "Please specify a file path or file name to write to." };
  }

  let target = rawPath.trim().replace(/^["']|["']$/g, '');
  if (input.directory && !path.isAbsolute(target) && !/^(?:desktop|documents|downloads)[\\/]/i.test(target)) {
    const dir = resolveTargetDir(input.directory);
    target = path.join(dir, target);
  }

  const resolved = resolveTargetFileForWrite(target);
  console.log(`[Orvix Live Tool: write_file] Target: "${target}" -> Resolved: "${resolved}"`);

  if (!resolved) {
    return { status: "invalid_path", message: "Invalid or unsupported file path for writing." };
  }

  const baseName = path.basename(resolved);
  if (isLiveFSSensitive(baseName) || isHiddenPath(resolved)) {
    console.warn(`[Orvix Live Tool: write_file] Blocked writing to sensitive file: ${resolved}`);
    return {
      status: "permission_denied",
      error: `Access Denied: '${baseName}' is classified as a sensitive credential or security file. Writing to it is blocked.`,
      path: resolved,
      message: `Writing to '${baseName}' is blocked because it is classified as a sensitive system or credential file.`
    };
  }

  if (content.length > 5 * 1024 * 1024) {
    return {
      status: "content_too_large",
      path: resolved,
      message: "Content exceeds 5 MB limit for live voice file writing."
    };
  }

  try {
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) {
      await fs.promises.mkdir(parentDir, { recursive: true });
    }

    const existed = fs.existsSync(resolved);
    await fs.promises.writeFile(resolved, content, 'utf8');
    const bytesWritten = Buffer.byteLength(content, 'utf8');
    const lineCount = content.split(/\r?\n/).length;

    console.log(`[Orvix Live Tool: write_file] Successfully wrote ${bytesWritten} bytes (${lineCount} lines) to ${resolved}`);

    return {
      status: "ok",
      action: existed ? "updated" : "created",
      path: resolved,
      filename: baseName,
      lines: lineCount,
      bytes: bytesWritten,
      message: `File '${baseName}' successfully ${existed ? "updated" : "created"} at '${resolved}'.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Live Tool: write_file] ERROR: ${message}`);
    return { status: "write_failed", path: resolved, message: `Could not write file: ${message}` };
  }
}

module.exports = {
  listDirectory,
  searchFiles,
  searchContent,
  readFile,
  writeFile
};
