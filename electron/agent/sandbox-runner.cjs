const fs = require('node:fs');
const path = require('node:path');
const { copyProject, copyNodeRuntime, applyResult } = require('./sandbox-stage.cjs');

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSandboxRunner(app, openPath) {
  const base = path.join(app.getPath('userData'), 'agent-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  let tail = Promise.resolve();
  let pending = 0;
  function status() {
    if (process.platform !== 'win32') return { available: false, reason: 'Windows Sandbox is only available on Windows.' };
    if (typeof openPath !== 'function') return { available: false, reason: 'Windows Sandbox launching is unavailable in this process.' };
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsSandbox.exe');
    if (!fs.existsSync(executable)) return { available: false, reason: 'Windows Sandbox is not enabled. Turn on the Windows Sandbox optional feature and restart Windows.' };
    return { available: true, reason: '' };
  }
  function removeRun(runRoot) {
    const resolved = fs.realpathSync(runRoot);
    if (path.dirname(resolved) !== fs.realpathSync(base) || !path.basename(resolved).startsWith('orvix-run-')) throw new Error('Refusing to remove a folder outside the sandbox staging area.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('orvix-run-')) continue;
    const oldRun = path.join(base, entry.name);
    try { if (Date.now() - fs.statSync(oldRun).mtimeMs > 60 * 60 * 1000) removeRun(oldRun); }
    catch { /* A mapped folder may still be in use. */ }
  }
  async function runIsolated({ command, root, directory, taskId, signal, workspaces, changes, emit }) {
    const availability = status();
    if (!availability.available) throw new Error(availability.reason);
    const runRoot = fs.mkdtempSync(path.join(base, 'orvix-run-'));
    const input = path.join(runRoot, 'input');
    const output = path.join(runRoot, 'output');
    fs.mkdirSync(input);
    fs.mkdirSync(output);
    let launched = false;
    const cancelFile = path.join(output, 'cancel.flag');
    const onAbort = () => { try { fs.writeFileSync(cancelFile, 'cancel'); } catch { /* Sandbox output may already be closed. */ } };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      emit({ type: 'activity', message: 'Preparing isolated project copy' });
      const source = path.join(input, 'source');
      const baseline = copyProject(root, source);
      if (/\b(?:node|npm|npx|pnpm|yarn|tsc|vite)\b/i.test(command)) copyNodeRuntime(path.join(input, 'tools'));
      fs.copyFileSync(path.join(__dirname, 'sandbox-bootstrap.ps1'), path.join(input, 'bootstrap.ps1'));
      const relativeCwd = path.relative(root, directory).split(path.sep).join('/');
      const mappedCommand = command.replaceAll(root, 'C:\\OrvixWork');
      fs.writeFileSync(path.join(input, 'request.json'), JSON.stringify({ command: mappedCommand, cwd: relativeCwd }));
      fs.writeFileSync(path.join(input, 'baseline.json'), JSON.stringify(baseline));
      const config = `<Configuration>\n<Networking>Disable</Networking>\n<vGPU>Disable</vGPU>\n<AudioInput>Disable</AudioInput>\n<VideoInput>Disable</VideoInput>\n<PrinterRedirection>Disable</PrinterRedirection>\n<ClipboardRedirection>Disable</ClipboardRedirection>\n<ProtectedClient>Enable</ProtectedClient>\n<MappedFolders>\n<MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>C:\\OrvixInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>\n<MappedFolder><HostFolder>${xml(output)}</HostFolder><SandboxFolder>C:\\OrvixOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>\n</MappedFolders>\n<LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\OrvixInput\\bootstrap.ps1</Command></LogonCommand>\n</Configuration>`;
      const configFile = path.join(runRoot, 'run.wsb');
      fs.writeFileSync(configFile, config);
      if (signal.aborted) throw new Error('Task cancelled before Windows Sandbox started.');
      emit({ type: 'activity', message: 'Launching Windows Sandbox with networking and clipboard disabled' });
      const launchError = await openPath(configFile);
      if (launchError) throw new Error(`Windows Sandbox could not start: ${launchError}`);
      launched = true;
      const resultFile = path.join(output, 'result.json');
      const deadline = Date.now() + 360000;
      while (!fs.existsSync(resultFile)) {
        if (signal.aborted) throw new Error('Task cancelled while Windows Sandbox was running. Its staged output will not be applied.');
        if (Date.now() > deadline) { onAbort(); throw new Error('Windows Sandbox did not return a result within six minutes. No sandbox changes were applied.'); }
        await pause(500);
      }
      const raw = fs.readFileSync(resultFile, 'utf8');
      if (raw.length > 2_000_000) throw new Error('Windows Sandbox returned an oversized result.');
      const result = JSON.parse(raw);
      if (!Number.isInteger(result.exitCode) || !Array.isArray(result.changes)) throw new Error('Windows Sandbox returned an invalid result.');
      let applied = 0;
      if (result.exitCode === 0) applied = await applyResult(root, baseline, output, result.changes, workspaces, taskId, changes, emit);
      let text = `Exit ${result.exitCode}\n${String(result.output ?? '')}`;
      if (applied) text += `\nApplied ${applied} tracked file change${applied === 1 ? '' : 's'} from Windows Sandbox.`;
      if (result.exitCode !== 0 && result.changes.length) text += '\nSandbox file changes were discarded because the command failed.';
      if (result.skippedLarge) text += '\nFiles over 1 MB were not copied back from the sandbox.';
      return text;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (launched && signal.aborted) {
        const deadline = Date.now() + 15000;
        while (!fs.existsSync(path.join(output, 'result.json')) && Date.now() < deadline) await pause(250);
      }
      const completed = fs.existsSync(path.join(output, 'result.json'));
      if (launched && completed) await pause(2500);
      try { removeRun(runRoot); }
      catch (error) { console.warn('[Orvix agent] Could not clean sandbox staging folder:', error.message); }
      if (launched) emit({ type: 'activity', message: completed
        ? 'Isolated command finished; Windows Sandbox is closing' : 'Isolated command stopped; Windows Sandbox may still be closing' });
    }
  }
  async function run(args) {
    const previous = tail;
    const waiting = pending > 0;
    pending++;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    try {
      if (waiting) args.emit({ type: 'activity', message: 'Waiting for the isolated command runner' });
      await previous;
      if (args.signal.aborted) throw new Error('Task cancelled before isolated execution.');
      return await runIsolated(args);
    } finally { pending--; release(); }
  }
  return { status, run };
}

module.exports = { createSandboxRunner };
