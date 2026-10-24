const { spawn } = require('node:child_process');
const path = require('node:path');

function createPreviewServer(signal, dependencies = {}) {
  const children = new Set();
  const launch = dependencies.spawn ?? spawn;
  const startupMs = dependencies.startupMs ?? 12000;
  function stop(child) {
    if (!children.delete(child) || !child.pid || child.exitCode !== null) return;
    if (dependencies.stop) { dependencies.stop(child); return; }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => child.kill());
      killer.once('close', code => { if (code !== 0) child.kill(); });
    } else child.kill('SIGTERM');
  }
  function localPreviewUrl(output) {
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    for (const match of plain.matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
      try { const url = new URL(match[0]); if (!url.username && !url.password && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href; }
      catch { /* Ignore incomplete startup output until the URL is available. */ }
    }
    return null;
  }
  async function ready(child, reused, operationSignal = signal) {
    const deadline = Date.now() + startupMs;
    while (!child.orvixError && child.exitCode === null && !localPreviewUrl(child.orvixOutput) && Date.now() < deadline) {
      if (operationSignal.aborted) { stop(child); throw new Error('Task cancelled.'); }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (operationSignal.aborted) { stop(child); throw new Error('Task cancelled.'); }
    if (child.orvixError) throw child.orvixError;
    const url = localPreviewUrl(child.orvixOutput);
    return { running: child.exitCode === null, pid: child.pid, reused, status: child.exitCode !== null ? 'stopped' : url ? 'ready' : 'starting', url,
      output: child.orvixOutput.slice(-2500), note: url ? 'Use this observed URL. Server stops at turn end or cancellation.' : 'No local URL observed yet. Repeat this tool with the same command and directory to inspect the existing server; do not guess a port. Server stops at turn end or cancellation.' };
  }
  async function start(command, directory, callSignal = signal) {
    const trimmed = String(command ?? '').trim();
    if (!trimmed || trimmed === 'undefined') throw new Error('A preview command is required (e.g. "npx -y serve .", "python -m http.server 3000", or "npm run dev").');
    const operationSignal = AbortSignal.any([signal, callSignal]);
    if (operationSignal.aborted) throw new Error('Task cancelled.');
    const existing = [...children].find(child => child.exitCode === null && child.orvixLaunch.command === trimmed && child.orvixLaunch.directory === directory);
    if (existing) return ready(existing, true, operationSignal);
    const childEnv = { ...process.env };
    for (const name of Object.keys(childEnv)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(name)) delete childEnv[name];
    const staticPreview = trimmed === 'static';
    if (staticPreview) childEnv.ELECTRON_RUN_AS_NODE = '1';
    const child = launch(staticPreview ? process.execPath : process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      staticPreview ? [path.join(__dirname.replace(/([\\/])app\.asar(?=[\\/]|$)/i, '$1app.asar.unpacked'), 'static-preview.cjs'), directory] : process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', trimmed] : ['-lc', trimmed],
      { cwd: directory, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.orvixLaunch = { directory, command: trimmed, startedAt: Date.now() };
    children.add(child);
    const abort = () => stop(child);
    operationSignal.addEventListener('abort', abort, { once: true });
    child.orvixOutput = '';
    const capture = chunk => { child.orvixOutput = (child.orvixOutput + chunk.toString()).slice(-4000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('close', () => { children.delete(child); operationSignal.removeEventListener('abort', abort); });
    child.on('error', error => { child.orvixError = error; children.delete(child); operationSignal.removeEventListener('abort', abort); });
    return ready(child, false, operationSignal);
  }
  function stopAll() { for (const child of [...children]) stop(child); }
  return { start, stopAll, inspect: () => [...children].filter(child => child.exitCode === null).map(child => ({ pid: child.pid, ...child.orvixLaunch })) };
}

module.exports = { createPreviewServer };
