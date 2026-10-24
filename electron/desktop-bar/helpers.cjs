const { spawn: nativeSpawn, execFile: nativeExecFile } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

function scriptPath(name) {
  return path.join(__dirname, name).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

function createOwnedHelpers({ spawn = nativeSpawn, execFile = nativeExecFile, platform = process.platform, onFailure = () => {} } = {}) {
  const children = new Set(), pending = new Map(), timers = new Set();
  let active = true, worker = null, idleTimer, nextId = 1;
  const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); timer.unref?.(); return timer; };
  const cancel = timer => { clearTimeout(timer); timers.delete(timer); };
  const assertActive = () => { if (!active) throw new Error('Desktop top bar is off.'); };
  function own(child) {
    let resolveClosed;
    const record = { child, closed: false, exited: false, stopping: null, done: new Promise(resolve => { resolveClosed = resolve; }) };
    children.add(record);
    child.once('exit', () => { record.exited = true; });
    child.once('close', () => { record.closed = true; children.delete(record); resolveClosed(); });
    return record;
  }
  async function waitClosed(record, ms) {
    if (record.closed) return true;
    let timer;
    const result = await Promise.race([record.done.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]);
    clearTimeout(timer);
    return result;
  }
  function stop(record) {
    if (record.closed) return Promise.resolve();
    if (record.stopping) return record.stopping;
    record.stopping = (async () => {
      try { record.child.stdin?.end(); } catch {}
      if (await waitClosed(record, 500)) return;
      if (record.exited) {
        if (await waitClosed(record, 1500)) return;
        record.stopping = null;
        throw new Error('A stopped Windows helper has not released its output streams yet. Try stopping the controls again.');
      }
      if (platform === 'win32' && record.child.pid) {
        await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true, timeout: 2500 }, () => resolve()));
      } else { try { record.child.kill(); } catch {} }
      if (!(await waitClosed(record, 1500))) {
        record.stopping = null;
        throw new Error(`Windows helper ${record.child.pid || ''} has not stopped. Try turning the bar off again.`);
      }
    })();
    return record.stopping;
  }
  function rejectPending(record, error) {
    for (const [id, request] of pending) if (!record || request.record === record) {
      cancel(request.timer); pending.delete(id); request.reject(error);
    }
  }
  function releaseIdle() {
    cancel(idleTimer);
    if (!active || pending.size || !worker) return;
    const current = worker;
    idleTimer = later(() => { void stop(current).catch(onFailure); }, 20000);
  }
  function startWorker() {
    assertActive();
    const record = own(spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('controls.ps1'), 'Listen'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    worker = record;
    record.child.stdin.on('error', failure => rejectPending(record, failure));
    const lines = readline.createInterface({ input: record.child.stdout });
    lines.on('line', line => {
      let response;
      try { response = JSON.parse(line); } catch { return; }
      const request = pending.get(Number(response.id));
      if (!request || request.record !== record) return;
      cancel(request.timer); pending.delete(Number(response.id)); request.resolve(response); releaseIdle();
    });
    record.child.stderr.on('data', () => {});
    record.child.on('error', failure => rejectPending(record, failure));
    record.child.once('close', () => {
      lines.close();
      if (worker === record) { worker = null; cancel(idleTimer); }
      rejectPending(record, new Error('Windows controls stopped.'));
    });
    return record;
  }
  async function runControls(action, value) {
    assertActive(); cancel(idleTimer);
    if (worker?.stopping) await worker.stopping;
    assertActive();
    const record = worker && !worker.closed ? worker : startWorker();
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = later(() => {
        pending.delete(id); reject(new Error('Windows controls took too long to respond.'));
        void stop(record).catch(onFailure);
      }, 15000);
      pending.set(id, { record, resolve, reject, timer });
      try { record.child.stdin.write(JSON.stringify({ id, action, value }) + '\n'); }
      catch (failure) { cancel(timer); pending.delete(id); reject(failure); releaseIdle(); }
    });
  }
  function runShortcut(action) {
    assertActive();
    const record = own(spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('shortcuts.ps1'), action], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    return new Promise(resolve => {
      let failure = '', settled = false;
      const finish = result => { if (settled) return; settled = true; cancel(timer); resolve(result); };
      const timer = later(() => { finish({ ok: false, error: 'Windows shortcut timed out.' }); void stop(record).catch(onFailure); }, 10000);
      record.child.stdout.on('data', () => {});
      record.child.stderr.on('data', data => { failure = (failure + data.toString()).slice(-1000); });
      record.child.once('error', error => finish({ ok: false, error: error.message }));
      record.child.once('close', code => finish(code === 0 && active ? { ok: true } : { ok: false, error: active ? failure || 'Windows could not complete that shortcut.' : 'Desktop top bar is off.' }));
    });
  }
  function deactivate() {
    active = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    rejectPending(null, new Error('Desktop top bar is off.'));
  }
  async function dispose() {
    deactivate();
    const results = await Promise.allSettled([...children].map(stop));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return { runControls, runShortcut, deactivate, dispose, diagnostics: () => ({ helpers: children.size, pending: pending.size, helperTimers: timers.size }) };
}
module.exports = { createOwnedHelpers, scriptPath };
