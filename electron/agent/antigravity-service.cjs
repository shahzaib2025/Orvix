const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const TTL = 3 * 60 * 1000; // 3 minutes
let cachedCatalog = null;
let cachedQuota = null;
let lastRefreshed = 0;
let pendingRefresh = null;
let activeDaemonChild = null;

// Built-in verified model mappings from Antigravity Language Server
const STATIC_MODELS = [
  {
    id: 'antigravity/gemini-3.8-flash',
    apiModelId: 'gemini-3.8-flash',
    modelEnum: 'MODEL_PLACEHOLDER_M320',
    name: 'Gemini 3.8 Flash',
    group: 'Google Gemini',
    route: 'chat',
    input: ['text', 'image'],
    contextLength: 1048576,
    maxOutputTokens: 65536,
    variants: ['low', 'medium', 'high'],
    description: 'Ultra-fast flagship model with 1M context and adjustable reasoning'
  },
  {
    id: 'antigravity/claude-sonnet-4-6',
    apiModelId: 'claude-sonnet-4-6',
    modelEnum: 'MODEL_PLACEHOLDER_M35',
    name: 'Claude Sonnet 4.6 (Thinking)',
    group: 'Anthropic Claude',
    route: 'chat',
    input: ['text', 'image'],
    contextLength: 250000,
    maxOutputTokens: 64000,
    variants: ['extended'],
    description: 'Anthropic Claude Sonnet with reasoning under Antigravity quota'
  },
  {
    id: 'antigravity/claude-opus-4-6-thinking',
    apiModelId: 'claude-opus-4-6-thinking',
    modelEnum: 'MODEL_PLACEHOLDER_M26',
    name: 'Claude Opus 4.6 (Thinking)',
    group: 'Anthropic Claude',
    route: 'chat',
    input: ['text', 'image'],
    contextLength: 250000,
    maxOutputTokens: 64000,
    variants: ['extended'],
    description: 'Deep architectural and complex coding intelligence'
  },
  {
    id: 'antigravity/gpt-oss-120b-medium',
    apiModelId: 'gpt-oss-120b-medium',
    modelEnum: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    name: 'GPT-OSS 120B (Medium)',
    group: 'Open Source',
    route: 'chat',
    input: ['text'],
    contextLength: 131072,
    maxOutputTokens: 32768,
    variants: [],
    description: 'Open-weight 120B model via Vertex AI integration'
  }
];

function findDiscoveryFiles() {
  const home = os.homedir();
  const searchDirs = [
    path.join(home, '.gemini', 'antigravity-ide', 'daemon'),
    path.join(home, '.gemini', 'antigravity', 'daemon'),
  ];
  const files = [];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const list = fs.readdirSync(dir);
      for (const item of list) {
        if (item.startsWith('ls_') && item.endsWith('.json')) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          files.push({ path: fullPath, mtime: stat.mtimeMs });
        }
      }
    } catch { /* Ignore directory read errors */ }
  }
  // Sort newest first
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readActiveDaemonConfig() {
  const files = findDiscoveryFiles();
  for (const entry of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
      if (parsed.httpPort && parsed.csrfToken) {
        // Skip stale configs whose PID is no longer running
        if (parsed.pid && !isProcessAlive(parsed.pid)) continue;
        return parsed;
      }
    } catch { /* Try next file */ }
  }
  return null;
}

let activeDaemonConfig = null;
let isServerActive = false;

function findRunningIdeServers() {
  if (process.platform !== 'win32') return [];
  try {
    const ps = `
      $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'language_server' -and $_.CommandLine -match '--extension_server_port' -and $_.CommandLine -notmatch 'daily-cloudcode-pa' } | Select-Object ProcessId, CommandLine;
      if ($procs) {
        $conns = Get-NetTCPConnection -OwningProcess ($procs | ForEach-Object { $_.ProcessId }) -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalPort;
        [PSCustomObject]@{ procs = $procs; conns = $conns } | ConvertTo-Json -Depth 3;
      }
    `.replace(/\r?\n\s*/g, ' ');

    const { execSync } = require('node:child_process');
    const output = execSync(`powershell.exe -NoProfile -Command "${ps}"`, { encoding: 'utf8', timeout: 4000 });
    if (!output.trim()) return [];
    const data = JSON.parse(output);
    const procs = Array.isArray(data.procs) ? data.procs : data.procs ? [data.procs] : [];
    const conns = Array.isArray(data.conns) ? data.conns : data.conns ? [data.conns] : [];
    // Prioritize official production endpoint
    procs.sort((a, b) => {
      const aProd = (a.CommandLine || '').includes('https://cloudcode-pa.googleapis.com');
      const bProd = (b.CommandLine || '').includes('https://cloudcode-pa.googleapis.com');
      return (bProd ? 1 : 0) - (aProd ? 1 : 0);
    });
    const candidates = [];
    for (const proc of procs) {
      const tokenMatch = /--csrf_token\s+([a-f0-9-]+)/i.exec(proc.CommandLine);
      if (!tokenMatch) continue;
      const csrfToken = tokenMatch[1];
      const ports = conns.filter(c => c.OwningProcess === proc.ProcessId).map(c => c.LocalPort);
      for (const port of ports) {
        candidates.push({ httpPort: port, csrfToken, pid: proc.ProcessId });
      }
    }
    return candidates;
  } catch {
    return [];
  }
}

function rpcCall(daemon, method, body = {}, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (!daemon?.httpPort || !daemon?.csrfToken) {
      return reject(new Error('Antigravity Language Server is not running or port unavailable.'));
    }
    const isModelResponse = method === 'GetModelResponse';
    const effectiveTimeout = timeoutMs ?? (isModelResponse ? 180000 : 15000);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: daemon.httpPort,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Codeium-Csrf-Token': daemon.csrfToken,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: effectiveTimeout
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          try {
            const err = JSON.parse(data);
            reject(new Error(err.message || `RPC ${method} failed with status ${res.statusCode}`));
          } catch {
            reject(new Error(`RPC ${method} failed with status ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        }
      });
    });

    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(new Error('Task was cancelled.'));
      };
      if (signal.aborted) {
        req.destroy();
        return reject(new Error('Task was cancelled.'));
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`RPC ${method} timed out after ${Math.round(effectiveTimeout / 1000)}s.`));
    });

    req.write(payload);
    req.end();
  });
}

async function getRunningDaemon() {
  // If we already have a working daemon config, ping it quickly to ensure it's still alive
  if (activeDaemonConfig?.httpPort && activeDaemonConfig?.csrfToken) {
    try {
      await rpcCall(activeDaemonConfig, 'RetrieveUserQuotaSummary', {}, 2000);
      return activeDaemonConfig;
    } catch {
      activeDaemonConfig = null;
    }
  }

  // 1. Check for active authenticated language servers from Antigravity IDE
  //    (findRunningIdeServers already filters out daily-cloudcode-pa processes)
  const ideServers = findRunningIdeServers();
  const ideServerPids = new Set(ideServers.map(s => s.pid).filter(Boolean));
  for (const candidate of ideServers) {
    try {
      await rpcCall(candidate, 'RetrieveUserQuotaSummary', {}, 2000);
      activeDaemonConfig = candidate;
      return candidate;
    } catch { /* Try next candidate */ }
  }

  // 2. Check discovery files on disk (from running daemon)
  //    Cross-validate: only accept configs whose PID is also present in the
  //    filtered IDE server list (non-daily), or spawned by Orvix itself.
  const existing = readActiveDaemonConfig();
  if (existing) {
    // Reject if PID belongs to a daily-cloudcode-pa process we intentionally filtered out
    const pidOk = !existing.pid || ideServerPids.has(existing.pid) || (activeDaemonChild && activeDaemonChild.pid === existing.pid);
    if (pidOk) {
      try {
        await rpcCall(existing, 'RetrieveUserQuotaSummary', {}, 2000);
        activeDaemonConfig = existing;
        return existing;
      } catch { /* Stale discovery file */ }
    }
  }

  return null;
}

async function ensureHeadlessDaemon() {
  const running = await getRunningDaemon();
  if (running) return running;

  // Fallback: try launching headless language server
  const candidatePaths = [
    'D:\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'antigravity', 'bin', 'language_server_windows_x64.exe'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'language_server.exe')
  ];

  let binaryPath = candidatePaths.find(p => fs.existsSync(p));
  if (!binaryPath) {
    throw new Error('Antigravity language_server binary not found. Please install Antigravity IDE or CLI.');
  }

  if (activeDaemonChild && activeDaemonChild.exitCode === null) {
    await new Promise(r => setTimeout(r, 1000));
    const config = readActiveDaemonConfig();
    if (config) {
      activeDaemonConfig = config;
      return config;
    }
  }

  const csrfToken = crypto.randomUUID();
  const child = spawn(binaryPath, [
    '--headless',
    '--standalone',
    '--persistent_mode',
    '--http_server_port', '0',
    '--csrf_token', csrfToken,
    '--app_data_dir', 'antigravity-ide',
    '--cloud_code_endpoint', 'https://cloudcode-pa.googleapis.com'
  ], {
    windowsHide: true,
    stdio: 'ignore'
  });

  activeDaemonChild = child;
  child.unref();

  // Poll for discovery file up to 5 seconds
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const config = readActiveDaemonConfig();
    if (config) {
      try {
        await rpcCall(config, 'RetrieveUserQuotaSummary', {}, 2000);
        activeDaemonConfig = config;
        return config;
      } catch { /* Keep waiting */ }
    }
  }

  throw new Error('Timed out waiting for Antigravity language server to start.');
}

async function stopAntigravityServer() {
  isServerActive = false;
  if (activeDaemonChild && !activeDaemonChild.killed) {
    try {
      if (process.platform === 'win32' && activeDaemonChild.pid) {
        const { execSync } = require('node:child_process');
        execSync(`taskkill /pid ${activeDaemonChild.pid} /T /F`, { stdio: 'ignore' });
      } else {
        activeDaemonChild.kill('SIGTERM');
      }
    } catch {
      try { activeDaemonChild.kill('SIGKILL'); } catch {}
    }
  }
  activeDaemonChild = null;
  activeDaemonConfig = null;

  return {
    state: 'offline',
    port: null,
    quota: cachedQuota,
    activeModelCount: (cachedCatalog || STATIC_MODELS).length,
    error: ''
  };
}

async function startAntigravityServer() {
  isServerActive = true;
  await ensureHeadlessDaemon();
  return getAntigravityStatus();
}

async function refreshAntigravityCatalog(force = false) {
  if (pendingRefresh) return pendingRefresh;
  const now = Date.now();
  if (!force && cachedCatalog && (now - lastRefreshed < TTL)) {
    return {
      models: cachedCatalog,
      quota: cachedQuota,
      updatedAt: lastRefreshed,
      stale: false,
      error: ''
    };
  }

  // When server is stopped, never auto-spawn or query
  if (!isServerActive) {
    return {
      models: cachedCatalog || STATIC_MODELS,
      quota: cachedQuota,
      updatedAt: lastRefreshed || Date.now(),
      stale: false,
      error: ''
    };
  }

  pendingRefresh = (async () => {
    let daemon = null;
    try {
      daemon = await getRunningDaemon();
      if (!daemon && force) {
        daemon = await ensureHeadlessDaemon();
      }
    } catch (err) {
      return {
        models: cachedCatalog || STATIC_MODELS,
        quota: cachedQuota,
        updatedAt: lastRefreshed,
        stale: true,
        error: String(err?.message || 'Could not connect to Antigravity Language Server.')
      };
    }

    if (!daemon) {
      return {
        models: cachedCatalog || STATIC_MODELS,
        quota: cachedQuota,
        updatedAt: lastRefreshed || Date.now(),
        stale: false,
        error: ''
      };
    }

    try {
      const [modelsData, quotaData] = await Promise.all([
        rpcCall(daemon, 'GetAvailableModels', {}, 5000).catch(() => null),
        rpcCall(daemon, 'RetrieveUserQuotaSummary', {}, 5000).catch(() => null)
      ]);

      // Parse Quota
      let quota = null;
      if (quotaData?.response?.groups) {
        const geminiGroup = quotaData.response.groups.find(g => /gemini/i.test(g.displayName));
        const claudeGroup = quotaData.response.groups.find(g => /claude|gpt/i.test(g.displayName));
        
        const geminiWeekly = geminiGroup?.buckets?.find(b => b.window === 'weekly')?.remainingFraction ?? null;
        const gemini5h = geminiGroup?.buckets?.find(b => b.window === '5h')?.remainingFraction ?? null;
        const claudeWeekly = claudeGroup?.buckets?.find(b => b.window === 'weekly')?.remainingFraction ?? null;
        const claude5h = claudeGroup?.buckets?.find(b => b.window === '5h')?.remainingFraction ?? null;
        const resetTime = geminiGroup?.buckets?.find(b => b.window === 'weekly')?.resetTime ?? null;

        quota = {
          geminiWeeklyRemaining: geminiWeekly,
          gemini5hRemaining: gemini5h,
          claudeWeeklyRemaining: claudeWeekly,
          claude5hRemaining: claude5h,
          resetTime
        };
        cachedQuota = quota;
      }

      // Merge dynamic model descriptions if available
      const modelsMap = modelsData?.response?.models || {};
      const mergedModels = STATIC_MODELS.map(staticModel => {
        const live = modelsMap[staticModel.apiModelId];
        if (!live) return staticModel;
        return {
          ...staticModel,
          name: live.displayName || staticModel.name,
          contextLength: Number(live.maxTokens) || staticModel.contextLength,
          maxOutputTokens: Number(live.maxOutputTokens) || staticModel.maxOutputTokens
        };
      });

      cachedCatalog = mergedModels;
      lastRefreshed = Date.now();

      return {
        models: mergedModels,
        quota: cachedQuota,
        updatedAt: lastRefreshed,
        stale: false,
        error: ''
      };
    } catch (err) {
      return {
        models: cachedCatalog || STATIC_MODELS,
        quota: cachedQuota,
        updatedAt: lastRefreshed,
        stale: true,
        error: String(err?.message || 'Failed to update Antigravity catalog.')
      };
    }
  })().finally(() => {
    pendingRefresh = null;
  });

  return pendingRefresh;
}

async function getAntigravityStatus() {
  if (!isServerActive) {
    return {
      state: 'offline',
      port: null,
      quota: cachedQuota,
      activeModelCount: (cachedCatalog || STATIC_MODELS).length,
      error: ''
    };
  }

  const daemon = await getRunningDaemon();
  if (!daemon) {
    isServerActive = false;
    return {
      state: 'offline',
      port: null,
      quota: cachedQuota,
      activeModelCount: (cachedCatalog || STATIC_MODELS).length,
      error: ''
    };
  }

  try {
    const quotaData = await rpcCall(daemon, 'RetrieveUserQuotaSummary', {}, 3000);
    if (quotaData?.response?.groups) {
      const geminiGroup = quotaData.response.groups.find(g => /gemini/i.test(g.displayName));
      const claudeGroup = quotaData.response.groups.find(g => /claude|gpt/i.test(g.displayName));

      cachedQuota = {
        geminiWeeklyRemaining: geminiGroup?.buckets?.find(b => b.window === 'weekly')?.remainingFraction ?? null,
        gemini5hRemaining: geminiGroup?.buckets?.find(b => b.window === '5h')?.remainingFraction ?? null,
        claudeWeeklyRemaining: claudeGroup?.buckets?.find(b => b.window === 'weekly')?.remainingFraction ?? null,
        claude5hRemaining: claudeGroup?.buckets?.find(b => b.window === '5h')?.remainingFraction ?? null,
        resetTime: geminiGroup?.buckets?.find(b => b.window === 'weekly')?.resetTime ?? null
      };
    }

    return {
      state: 'connected',
      port: daemon.httpPort,
      quota: cachedQuota,
      activeModelCount: (cachedCatalog || STATIC_MODELS).length,
      error: ''
    };
  } catch (err) {
    return {
      state: 'offline',
      port: daemon.httpPort,
      quota: cachedQuota,
      activeModelCount: (cachedCatalog || STATIC_MODELS).length,
      error: String(err?.message || 'Connecting to daemon...')
    };
  }
}

function antigravityModel(modelId) {
  const models = cachedCatalog || STATIC_MODELS;
  const exact = models.find(m => m.id === modelId);
  if (exact) return exact;
  if (modelId && modelId.startsWith('antigravity/gemini-3.8-flash')) {
    return models.find(m => m.id === 'antigravity/gemini-3.8-flash') || STATIC_MODELS[0];
  }
  return null;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      if (part?.type === 'text') return part.text;
      return JSON.stringify(part);
    }).join('\n');
  }
  return content ? JSON.stringify(content) : '';
}

function formatToolsForPrompt(tools) {
  if (!tools || !tools.length) return '';
  const lines = [
    '# Available Tools (Call directly using ```tool_call on line 1):',
    ''
  ];
  for (const tool of tools) {
    const params = [];
    if (tool.parameters?.properties) {
      const required = new Set(tool.parameters.required || []);
      for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        const typeStr = prop.type || (Array.isArray(prop.type) ? prop.type.join('|') : 'any');
        const reqStr = required.has(key) ? '*' : '';
        const descStr = prop.description ? `: ${prop.description.slice(0, 85)}` : '';
        params.push(`${key}${reqStr} (${typeStr}${descStr})`);
      }
    }
    const paramStr = params.length ? `\n  Arguments: ${params.join('; ')}` : '';
    lines.push(`- **${tool.name}**: ${tool.description || ''}${paramStr}`);
  }
  lines.push('');
  lines.push('## Tool Calling Instructions');
  lines.push('To take action, emit a tool_call markdown codeblock in the following exact format:');
  lines.push('```tool_call');
  lines.push('{');
  lines.push('  "name": "tool_name",');
  lines.push('  "arguments": {');
  lines.push('    "param_name": "value"');
  lines.push('  }');
  lines.push('}');
  lines.push('```');
  lines.push('CRITICAL RULES:');
  lines.push('- ZERO PREAMBLE / IMMEDIATE EMISSION: When taking any action, inspecting code, reading/writing files, creating folders, or executing checks, emit the ```tool_call``` block starting immediately on line 1. Do NOT explain what you are going to do beforehand. Do NOT output commentary like "I will now...", "Let\'s check...", or "First I will...". Emit the tool call immediately.');
  lines.push('- NEVER stop after just describing what you plan to do. Output the ```tool_call``` block immediately to execute it.');
  lines.push('- NEVER simulate, predict, or hallucinate tool outputs (such as writing "[Tool Result for ...]" or "Exit 0"). Emit only the ```tool_call``` block and wait for the system to execute it.');
  lines.push('- ONLY write conversational or explanatory text when you have completely finished all work, created all requested files, and have NO MORE tools to run.');
  lines.push('EFFICIENCY GUIDELINES:');
  lines.push('- For simple greetings or basic conversation, directly respond in 1-2 friendly sentences without calling any tools.');
  lines.push('- For coding and website creation tasks, read any relevant skills (e.g. Three.js or website design skills), create the workspace or project directory, and write complete, functional code files using `write_file`.');
  lines.push('- Never output raw headers like "[Tool Result for ...]" or "[Assistant]" in your text response.');
  lines.push('');
  return lines.join('\n');
}

function extractToolCalls(rawText, availableTools = []) {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanedText: '', calls: [] };
  }

  const calls = [];
  let cleanedText = rawText;
  const knownNames = new Set((availableTools || []).map(t => t.name));

  // Regex 1: ```tool_call ... ```
  const toolCallRegex = /```(?:tool_call|tool-call|tool_calls)\s*([\s\S]*?)\s*```/gi;
  let match;
  while ((match = toolCallRegex.exec(rawText)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && (item.name || item.tool)) {
            const name = item.name || item.tool;
            const args = item.arguments || item.parameters || item.args || {};
            calls.push({
              id: 'call_' + crypto.randomUUID().slice(0, 8),
              name,
              args: typeof args === 'string' ? args : JSON.stringify(args)
            });
          }
        }
      } else if (parsed && (parsed.name || parsed.tool)) {
        const name = parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.parameters || parsed.args || {};
        calls.push({
          id: 'call_' + crypto.randomUUID().slice(0, 8),
          name,
          args: typeof args === 'string' ? args : JSON.stringify(args)
        });
      }
    } catch {
      const jsonMatch = /\{[\s\S]*\}/.exec(blockContent);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed && (parsed.name || parsed.tool)) {
            const name = parsed.name || parsed.tool;
            const args = parsed.arguments || parsed.parameters || parsed.args || {};
            calls.push({
              id: 'call_' + crypto.randomUUID().slice(0, 8),
              name,
              args: typeof args === 'string' ? args : JSON.stringify(args)
            });
          }
        } catch {}
      }
    }
  }

  // Regex 2: <tool_call> ... </tool_call>
  const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((match = xmlRegex.exec(rawText)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (parsed && (parsed.name || parsed.tool)) {
        const name = parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.parameters || parsed.args || {};
        calls.push({
          id: 'call_' + crypto.randomUUID().slice(0, 8),
          name,
          args: typeof args === 'string' ? args : JSON.stringify(args)
        });
      }
    } catch {}
  }

  // Regex 3: ```json { "name": ..., "arguments": ... } ``` if matches known tool
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
  while ((match = jsonBlockRegex.exec(rawText)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (parsed && (parsed.name || parsed.tool) && (knownNames.has(parsed.name) || knownNames.has(parsed.tool))) {
        const name = parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.parameters || parsed.args || {};
        const exists = calls.some(c => c.name === name && c.args === (typeof args === 'string' ? args : JSON.stringify(args)));
        if (!exists) {
          calls.push({
            id: 'call_' + crypto.randomUUID().slice(0, 8),
            name,
            args: typeof args === 'string' ? args : JSON.stringify(args)
          });
        }
      }
    } catch {}
  }

  // Only strip tool_call blocks that were successfully parsed into calls.
  // If a block had malformed JSON and wasn't parsed, preserve it as text
  // so the model's response isn't silently lost.
  const parsedBlockTexts = new Set();
  // Re-scan to collect the full match text of successfully parsed blocks
  const reScan1 = /```(?:tool_call|tool-call|tool_calls)\s*([\s\S]*?)\s*```/gi;
  let ms;
  while ((ms = reScan1.exec(rawText)) !== null) {
    const blockContent = ms[1].trim();
    let parsed = false;
    try { const p = JSON.parse(blockContent); if (p && (p.name || p.tool || Array.isArray(p))) parsed = true; } catch {
      try { const jm = /\{[\s\S]*\}/.exec(blockContent); if (jm) { const p = JSON.parse(jm[0]); if (p && (p.name || p.tool)) parsed = true; } } catch {}
    }
    if (parsed) parsedBlockTexts.add(ms[0]);
  }
  const reScan2 = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((ms = reScan2.exec(rawText)) !== null) {
    const blockContent = ms[1].trim();
    try { const p = JSON.parse(blockContent); if (p && (p.name || p.tool)) parsedBlockTexts.add(ms[0]); } catch {}
  }

  // Strip only blocks whose JSON was successfully parsed
  for (const blockText of parsedBlockTexts) {
    cleanedText = cleanedText.replace(blockText, '');
  }

  if (calls.length) {
    cleanedText = cleanedText.replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi, (fullMatch, jsonStr) => {
      try {
        const p = JSON.parse(jsonStr);
        if (p && (knownNames.has(p.name) || knownNames.has(p.tool))) return '';
      } catch {}
      return fullMatch;
    });
  }

  // Clean up any echoed prompt headers or hallucinated tool results
  cleanedText = cleanedText
    .replace(/^\[Tool Result for [^\]]+\][\s\S]*?(?=\n\n(?:[A-Z#*-]|\`\`\`)|$)/gim, '')
    .replace(/\n\[Tool Result for [^\]]+\][\s\S]*?(?=\n\n|\n\[|\n#|\n\`\`\`|$)/gim, '\n')
    .replace(/^\[Assistant(?: Tool Call)?\]\s*/gim, '')
    .replace(/\n\[Assistant(?: Tool Call)?\]\s*/gim, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    cleanedText,
    calls
  };
}

async function executeAntigravityModel({
  modelId,
  variant,
  prompt,
  history = [],
  tools = [],
  instructions = '',
  purpose = null,
  onDelta = () => {},
  onToolInput = () => {},
  signal
}) {
  const model = antigravityModel(modelId) || STATIC_MODELS.find(m => m.id === modelId) || STATIC_MODELS[0];
  if (!model) {
    throw new Error(`Model ${modelId} is not a valid Antigravity model.`);
  }

  isServerActive = true;
  let daemon = await ensureHeadlessDaemon();

  // Resolve target modelEnum based on model, purpose, and requested thinking level
  let targetModelEnum = model.modelEnum;
  const effectiveVariant = String(variant || '').toLowerCase();
  const isReviewer = Boolean(purpose && [
    'request_understanding',
    'execution_requirements',
    'acceptance_planning',
    'acceptance_planning_repair',
    'check_review',
    'completion_review',
    'reproduction_review',
    'command_review'
  ].includes(purpose));

  if (model.id.includes('gemini-3.8-flash') || (modelId && modelId.includes('gemini-3.8-flash'))) {
    if (isReviewer) {
      // Reviewers only evaluate JSON schemas and should be instantaneous (~1.5s)
      targetModelEnum = 'MODEL_GOOGLE_GEMINI_2_5_FLASH';
    } else if (effectiveVariant === 'high' || (modelId && modelId.endsWith('-high'))) {
      targetModelEnum = 'MODEL_PLACEHOLDER_M318';
    } else if (effectiveVariant === 'medium' || (modelId && modelId.endsWith('-medium'))) {
      targetModelEnum = 'MODEL_PLACEHOLDER_M319';
    } else {
      // Default to Low thinking for lightning-fast 2s turns
      targetModelEnum = 'MODEL_PLACEHOLDER_M320';
    }
  }

  const parts = [];
  const home = os.homedir();
  const workspaceContext = [
    '# Active Workspace Context',
    `- Current Working Directory: ${process.cwd()}`,
    `- Desktop Directory: ${path.join(home, 'Desktop')}`,
    `- Documents Directory: ${path.join(home, 'Documents')}`,
    ''
  ].join('\n');
  parts.push(workspaceContext);

  const builderRole = [
    '# Autonomous Engineering Protocol',
    'You are the Orvix Autonomous Builder. You build complete, production-ready software directly on the user\'s local system.',
    '- ZERO PREAMBLE: When taking any action, emitting a tool call, or writing files, start your response directly with ```tool_call on line 1. Do NOT explain what you are going to do beforehand.',
    '- Never stop after describing intentions. If files need to be created or commands run, emit the ```tool_call``` immediately.',
    '- For projects, websites, or apps, write full functional code files with complete styling and logic; never use placeholders or partial implementations.',
    '- Work cleanly within the designated workspace.',
    ''
  ].join('\n');
  parts.push(builderRole);

  if (instructions) {
    parts.push(`[System Instructions]\n${instructions}\n`);
  }
  if (tools && tools.length) {
    parts.push(formatToolsForPrompt(tools));
  }

  for (const msg of history) {
    if (msg.role === 'tool' || msg.type === 'function_call_output') {
      const toolId = msg.tool_call_id || msg.call_id || 'tool';
      const content = extractText(msg.content ?? msg.output);
      parts.push(`Tool Result (${toolId}):\n${content}\n`);
    } else if (msg.role === 'assistant') {
      const text = extractText(msg.content);
      if (msg.tool_calls && msg.tool_calls.length) {
        if (text) parts.push(`[Assistant]\n${text}\n`);
        for (const tc of msg.tool_calls) {
          const fnName = tc.function?.name || tc.name;
          const fnArgs = tc.function?.arguments || tc.args || {};
          const argsStr = typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs);
          parts.push(`\`\`\`tool_call\n{"name": "${fnName}", "arguments": ${argsStr}}\n\`\`\`\n`);
        }
      } else if (text) {
        parts.push(`[Assistant]\n${text}\n`);
      }
    } else if (msg.role === 'user') {
      const text = extractText(msg.content);
      if (text) parts.push(`[User]\n${text}\n`);
    } else if (msg.role === 'system') {
      const text = extractText(msg.content);
      if (text) parts.push(`[System]\n${text}\n`);
    }
  }

  // Append prompt if provided and not identical to the last message content in history
  if (prompt) {
    const promptText = extractText(prompt);
    const lastHistoryContent = history.length ? extractText(history[history.length - 1].content) : '';
    if (promptText && promptText !== lastHistoryContent) {
      parts.push(`[User Prompt]\n${promptText}\n`);
    }
  }

  // If the last history turn was a tool result, add an explicit directive so the model proceeds immediately
  const lastMsg = history.length ? history[history.length - 1] : null;
  if (lastMsg && (lastMsg.role === 'tool' || lastMsg.type === 'function_call_output')) {
    parts.push('Instruction:\nTool execution completed above. Continue fulfilling the user request. If more tools or edits are required, emit the next ```tool_call``` immediately on line 1 with zero preamble. Only write your final response when all work is verified and completely finished.\n');
  }

  const fullPrompt = parts.join('\n');

  if (signal?.aborted) throw new Error('Task was cancelled.');

  let result = null;
  try {
    result = await rpcCall(daemon, 'GetModelResponse', {
      prompt: fullPrompt,
      model: targetModelEnum
    }, 180000, signal);
  } catch (err) {
    // If connection dropped, EOF, forcibly closed, 500/502/503, or overloaded error, retry once
    const msg = String(err?.message || '');
    const isConnErr = /EOF|closed network connection|socket hang up|forcibly closed|wsasend|ECONNRESET|ECONNREFUSED|500|502|503/i.test(msg);
    const isOverloaded = /overload|busy|capacity|unavailable|intermittent/i.test(msg);

    if ((isConnErr || isOverloaded) && !signal?.aborted) {
      if (isConnErr) {
        activeDaemonConfig = null;
        daemon = await ensureHeadlessDaemon();
      } else if (isOverloaded) {
        await new Promise(r => setTimeout(r, 2000));
      }
      result = await rpcCall(daemon, 'GetModelResponse', {
        prompt: fullPrompt,
        model: targetModelEnum
      }, 180000, signal);
    } else {
      throw err;
    }
  }

  // Robust response extraction: check multiple possible response fields
  let responseText = '';
  if (result) {
    if (typeof result.response === 'string') {
      responseText = result.response;
    } else if (typeof result.text === 'string') {
      responseText = result.text;
    } else if (typeof result.content === 'string') {
      responseText = result.content;
    } else if (typeof result === 'string') {
      responseText = result;
    } else if (result.response) {
      responseText = String(result.response);
    }
  }

  // Extract any tool calls from the model response
  let { cleanedText, calls } = extractToolCalls(responseText, tools);

  // Stream text progress for UI:
  // When tools are called, this is an intermediate step to collect data.
  // Do not stream or return speculative preliminary text as final text.
  let streamText = calls.length ? '' : (cleanedText || responseText);

  // If both text and calls are empty, try an immediate in-flight retry with Medium thinking (M319)
  // before giving up. Medium thinking produces reasoning tokens and ensures non-empty output.
  if (!streamText.trim() && !calls.length && !signal?.aborted) {
    const fallbackModel = (targetModelEnum === 'MODEL_PLACEHOLDER_M320') ? 'MODEL_PLACEHOLDER_M319' : targetModelEnum;
    try {
      const retryResult = await rpcCall(daemon, 'GetModelResponse', {
        prompt: fullPrompt,
        model: fallbackModel
      }, 180000, signal);

      let retryResponseText = '';
      if (retryResult) {
        if (typeof retryResult.response === 'string') retryResponseText = retryResult.response;
        else if (typeof retryResult.text === 'string') retryResponseText = retryResult.text;
        else if (typeof retryResult.content === 'string') retryResponseText = retryResult.content;
        else if (typeof retryResult === 'string') retryResponseText = retryResult;
        else if (retryResult.response) retryResponseText = String(retryResult.response);
      }

      const retryExtracted = extractToolCalls(retryResponseText, tools);
      const retryStreamText = retryExtracted.calls.length ? '' : (retryExtracted.cleanedText || retryResponseText);
      if (retryStreamText.trim() || retryExtracted.calls.length) {
        cleanedText = retryExtracted.cleanedText;
        calls = retryExtracted.calls;
        responseText = retryResponseText;
        streamText = retryStreamText;
      }
    } catch {}
  }

  // Guard: if both text and calls are empty, throw to trigger requestWithRetry.
  // This mirrors the check in requestDirect for other model providers.
  if (!streamText.trim() && !calls.length) {
    const debugInfo = responseText ? `(raw was ${responseText.length} chars)` : '(raw was empty)';
    throw new Error(`${model.name || modelId} returned neither text nor tool calls ${debugInfo}. Retrying...`);
  }

  // Notify tool input events
  if (calls.length && typeof onToolInput === 'function') {
    for (const call of calls) {
      try {
        const parsedArgs = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
        onToolInput({ name: call.name, arguments: parsedArgs });
      } catch {
        onToolInput({ name: call.name, arguments: call.args });
      }
    }
  }

  // Stream text progress for UI
  if (streamText.length && typeof onDelta === 'function') {
    const chunkSize = Math.max(8, Math.floor(streamText.length / 25));
    for (let i = 0; i < streamText.length; i += chunkSize) {
      if (signal?.aborted) break;
      const slice = streamText.slice(i, i + chunkSize);
      onDelta(slice);
      await new Promise(r => setTimeout(r, 15));
    }
  }

  const promptTokensEst = Math.ceil(fullPrompt.length / 4);
  const completionTokensEst = Math.ceil(responseText.length / 4);

  return {
    text: streamText,
    usage: {
      prompt_tokens: promptTokensEst,
      completion_tokens: completionTokensEst,
      total_tokens: promptTokensEst + completionTokensEst
    },
    calls,
    raw: {
      content: streamText || null,
      tool_calls: calls.map(c => ({
        id: c.id,
        type: 'function',
        function: {
          name: c.name,
          arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args)
        }
      }))
    },
    route: 'chat'
  };
}

module.exports = {
  STATIC_MODELS,
  refreshAntigravityCatalog,
  getAntigravityStatus,
  startAntigravityServer,
  stopAntigravityServer,
  antigravityModel,
  executeAntigravityModel,
  formatToolsForPrompt,
  extractToolCalls
};
