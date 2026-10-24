const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { safeValue } = require('./durable-store.cjs');
const windowsScript = `$ErrorActionPreference='Stop'; $items=@(Get-CimInstance Win32_Process | ForEach-Object { @{pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; name=$_.Name; executable=$_.ExecutablePath; commandLine=$_.CommandLine; startedAt=if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{0}} }); $ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { @{port=[int]$_.LocalPort; address=$_.LocalAddress; pid=[int]$_.OwningProcess} }); @{processes=$items; listeners=$ports} | ConvertTo-Json -Depth 5 -Compress`;
function executeReadOnly(file, args, signal) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(key)) delete env[key];
    execFile(file, args, { windowsHide: true, signal, timeout: 10000, maxBuffer: 4_000_000, env }, (error, stdout, stderr) => error ? reject(error) : resolve((stdout || stderr).trim()));
  });
}
const inside = (root, file) => { if (!file) return false; const rel = path.relative(root, file); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
function attachOwnership(processes, roots, managed) {
  const byId = new Map(processes.map(item => [item.pid, item]));
  return processes.map(item => {
    let current = item, owner = null; const visited = new Set();
    while (current && !visited.has(current.pid)) {
      visited.add(current.pid);
      const registered = managed.find(value => value.pid === current.pid && (!current.startedAt || Math.abs(current.startedAt - value.startedAt) < 30000));
      if (registered) { owner = registered; break; } current = byId.get(current.parentPid);
    }
    const command = String(item.commandLine ?? '').toLowerCase().replaceAll('/', '\\');
    const referencedRoot = roots.find(root => command.includes(root.toLowerCase().replaceAll('/', '\\')) || inside(root, item.cwd));
    return { ...item, cwd: owner?.directory ?? item.cwd ?? null, cwdSource: owner ? 'managed launch or descendant' : item.cwd ? 'observed process cwd' : 'unavailable on this platform',
      projectRoot: owner?.directory ?? referencedRoot ?? null, ownership: owner ? 'managed_preview' : referencedRoot ? 'project_reference_candidate' : 'unrelated_or_unknown' };
  });
}
function createRuntimeInspector({ nativeSnapshot, browserSnapshot, collectProcesses, collectEnvironment, managed = () => [], appVersion = null } = {}) {
  async function inspect(input, roots, signal) {
    const scope = input.scope ?? 'environment';
    if (scope === 'sensors') return nativeSnapshot ? safeValue(await nativeSnapshot(signal)) : { status: 'unavailable', reason: 'Desktop sensor bridge is unavailable.', observedAt: Date.now() };
    if (scope === 'browser') return browserSnapshot ? safeValue(await browserSnapshot(signal)) : { status: 'unavailable', reason: 'Browser companion is unavailable.', observedAt: Date.now() };
    if (scope === 'environment') {
      if (collectEnvironment) return safeValue(await collectEnvironment(input, roots, signal));
      const names = [...new Set(input.executables ?? ['node', 'python'])];
      const allowed = new Set(['node', 'python', 'go', 'cargo', 'java', 'mvn', 'dotnet', 'npm', 'pnpm', 'yarn', 'bun']);
      if (names.some(name => !allowed.has(name))) throw new Error('Unknown runtime executable.');
      const versions = await Promise.allSettled(names.map(name => {
        const args = name === 'go' ? ['version'] : name === 'java' ? ['-version'] : name === 'mvn' ? ['-v'] : ['--version'];
        return process.platform === 'win32' && ['mvn', 'npm', 'pnpm', 'yarn'].includes(name) ? executeReadOnly('cmd.exe', ['/d', '/s', '/c', `${name} ${args.join(' ')}`], signal) : executeReadOnly(name, args, signal);
      }));
      if (signal.aborted) throw new Error('Task cancelled.');
      return safeValue({ status: 'ok', observedAt: Date.now(), platform: process.platform, architecture: process.arch, osRelease: os.release(), appVersion, embeddedNode: process.version, electron: process.versions.electron ?? null,
        executables: versions.map((result, index) => ({ name: names[index], status: result.status === 'fulfilled' ? 'available' : 'unavailable', version: result.status === 'fulfilled' ? result.value : null })), workspaces: roots, managedPreviews: managed() });
    }
    if (!['ports', 'processes'].includes(scope)) throw new Error('Choose environment, ports, processes, sensors or browser.');
    const ports = input.ports ?? [], pids = input.process_ids ?? [];
    if (!Array.isArray(ports) || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535) || !Array.isArray(pids) || pids.some(pid => !Number.isInteger(pid) || pid < 1)) throw new Error('Invalid runtime selector.');
    let snapshot;
    try {
      if (collectProcesses) snapshot = await collectProcesses(signal);
      else if (process.platform === 'win32') snapshot = JSON.parse(await executeReadOnly('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsScript, 'utf16le').toString('base64')], signal));
      else return { status: 'unavailable', observedAt: Date.now(), reason: 'Live port/process inspection currently requires Windows.' };
    } catch (error) { if (signal.aborted) throw new Error('Task cancelled.'); return { status: 'unavailable', observedAt: Date.now(), reason: error.message }; }
    const processes = attachOwnership(snapshot.processes ?? [], roots, managed());
    const selectedPids = new Set([...pids, ...(snapshot.listeners ?? []).filter(item => ports.includes(item.port)).map(item => item.pid)]);
    const selected = processes.filter(item => selectedPids.has(item.pid) || !ports.length && !pids.length && item.projectRoot);
    const allowed = new Set(selected.map(item => item.pid));
    const listeners = (snapshot.listeners ?? []).filter(item => ports.length ? ports.includes(item.port) : allowed.has(item.pid)).map(item => ({ ...item, owner: processes.find(value => value.pid === item.pid) ?? null }));
    const rows = scope === 'ports' ? listeners : selected;
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
    return safeValue({ status: 'ok', observedAt: Date.now(), scope, rows: rows.slice(offset, offset + 60), total: rows.length, nextOffset: offset + 60 < rows.length ? offset + 60 : null,
      note: 'Command-line references are ownership candidates, not proof of cwd. A listening port does not prove application readiness. No process was modified.' });
  }
  return { inspect };
}
module.exports = { createRuntimeInspector, attachOwnership };
