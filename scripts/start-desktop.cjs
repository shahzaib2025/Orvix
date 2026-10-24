const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function brandConsole() {
  if (process.platform !== 'win32' || !process.stdout.isTTY) return null;
  try {
    const helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'configure-console.ps1'),
      '-ConsoleProcessId', String(process.pid), '-WaitForConsoleProcess'], {
      detached: true, windowsHide: true, stdio: 'ignore',
    });
    helper.on('error', () => {});
    helper.unref();
    return helper;
  } catch { return null; }
}

function startDesktop({ args = ['.'], runtime = require('electron'), env = process.env,
  stdout = process.stdout, stderr = process.stderr, signals = process,
  spawnProcess = spawn, onExit = code => { process.exitCode = code; } } = {}) {
  // Electron must not adopt the visible console. Relay its output so logs remain live.
  const reportError = error => {
    const detail = error.code === 'EBUSY'
      ? 'The Electron runtime is locked by another application. Close the application using it, then run start.bat again.'
      : error.message;
    stderr.write(`[Orvix] Desktop launch failed: ${detail}\n`);
  };
  let child;
  try {
    child = spawnProcess(runtime, args, {
      cwd: path.join(__dirname, '..'),
      env: { ...env, ELECTRON_NO_ATTACH_CONSOLE: '1' },
      stdio: ['inherit', 'pipe', 'pipe'],
      // Hiding this GUI process suppresses BrowserWindow's first show() on Windows.
      // Console detachment above already prevents Electron adopting the terminal.
      windowsHide: false,
    });
  } catch (error) {
    reportError(error);
    onExit(1);
    return null;
  }
  child.stdout.pipe(stdout, { end: false });
  child.stderr.pipe(stderr, { end: false });
  const interrupt = () => { if (child.exitCode === null) child.kill('SIGINT'); };
  const terminate = () => { if (child.exitCode === null) child.kill('SIGTERM'); };
  signals.on('SIGINT', interrupt);
  signals.on('SIGTERM', terminate);
  let failed = false;
  child.once('error', error => {
    failed = true;
    reportError(error);
  });
  child.once('close', (code, signal) => {
    signals.removeListener('SIGINT', interrupt);
    signals.removeListener('SIGTERM', terminate);
    onExit(failed ? 1 : (code ?? (signal === 'SIGINT' ? 130 : 1)));
  });
  return child;
}

if (require.main === module) {
  if (process.argv[2] === '--check-running') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      "$exe=[System.IO.Path]::GetFullPath('node_modules/electron/dist/electron.exe'); $running=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.ExecutablePath -and $_.ExecutablePath.Equals($exe,[StringComparison]::OrdinalIgnoreCase) }; if ($running) { exit 1 }"], {
      cwd: path.join(__dirname, '..'), detached: true, windowsHide: true, stdio: 'ignore',
    });
    process.exitCode = result.status === 0 ? 0 : 1;
  } else if (process.argv[2] === '--runtime-version') {
    const result = spawnSync(require('electron'), ['--version'], {
      env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    });
    if (result.status === 0) process.stdout.write(result.stdout.trim().replace(/^v/, ''));
    else process.exitCode = 1;
  } else {
    const helper = brandConsole();
    startDesktop({ args: process.argv.length > 2 ? process.argv.slice(2) : ['.'],
      onExit: code => { helper?.kill(); process.exitCode = code; } });
  }
}
module.exports = { startDesktop, brandConsole };
