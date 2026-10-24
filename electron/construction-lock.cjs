const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
const terminal = new Set(['unlocked', 'failed']);

function contains(candidate, root) {
  const a = path.win32.resolve(candidate).toLowerCase(), b = path.win32.resolve(root).toLowerCase();
  return a === b || a.startsWith(b.replace(/\\$/, '') + '\\');
}
function validateInput(raw, forbidden = []) {
  if (!raw || !Array.isArray(raw.targets) || !raw.targets.length || raw.targets.length > 12) throw new Error('Choose 1 to 12 files or folders.');
  if (!['write', 'read_write'].includes(raw.mode)) throw new Error('Choose a protection mode.');
  if (!Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 1 || raw.durationMinutes > 480) throw new Error('Choose a duration between 1 and 480 minutes.');
  const targets = raw.targets.map(value => {
    if (typeof value !== 'string' || !/^[a-z]:\\/i.test(value) || /[\x00-\x1f"<>|?*]/.test(value) || value.slice(2).includes(':') || value.length > 240) throw new Error('Choose a normal absolute local path.');
    const target = path.win32.resolve(value);
    if (target === path.win32.parse(target).root || forbidden.some(root => root && (contains(target, root) || contains(root, target)))) throw new Error('Choose a work file or folder outside Windows, application, profile and recovery locations.');
    return target;
  });
  for (let a = 0; a < targets.length; a++) for (let b = a + 1; b < targets.length; b++) {
    if (contains(targets[a], targets[b]) || contains(targets[b], targets[a])) throw new Error('Choose distinct, non-overlapping targets.');
  }
  return { targets, mode: raw.mode, durationMinutes: raw.durationMinutes };
}
function createAttemptNotifier(show, clock = Date.now, status = () => {}) {
  const seen = new Set(), recent = new Map(); let busy = false, lastShown = -Infinity;
  const report=value=>{try{status(value);}catch(error){console.error('[Construction Lock] Message status:',error.message);}};
  return attempt => {
    if (seen.has(attempt.id)) return;
    seen.add(attempt.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
    const key = String(attempt.path).toLowerCase(), now = clock();
    if (busy || now - lastShown < 10000 || now - (recent.get(key) ?? -Infinity) < 30000) return;
    recent.set(key, now); lastShown = now; busy = true;
    if (recent.size > 1000) recent.delete(recent.keys().next().value);
    report({status:'requested',lockId:attempt.lockId,attemptId:attempt.id,at:now});
    Promise.resolve().then(() => show(attempt)).then(()=>report({status:'acknowledged',lockId:attempt.lockId,attemptId:attempt.id,at:clock()})).catch(error => {report({status:'failed',lockId:attempt.lockId,attemptId:attempt.id,at:clock(),error:error.message});console.error('[Construction Lock] Dialog:', error.message);}).finally(() => { busy = false; });
  };
}
function atomic(file, value) {
  const tmp = file + '.tmp', fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function workerAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
function restrictionDialogOptions(attempt) {
  if(attempt.synthetic)return {type:'info',title:'Orvix — Restricted access',message:'Test restriction message',detail:'This is a synthetic preview. No files were locked and no access attempt was blocked. Real messages depend on Windows capturing a denied access event.',buttons:['OK'],noLink:true};
  return { type: 'warning', title: 'Orvix — Restricted access', message: 'This file or folder is under construction.', detail: `${attempt.path}\n\nOpening or modification was blocked by Windows. Access will be restored when Construction Lock ends.\n\nApplication: ${attempt.process || 'Unknown'}`, buttons: ['OK'], noLink: true };
}
function elevationError(error, mode) {
  const detail = String(error?.stderr || error?.message || error);
  if (/operation was cancel(?:l)?ed by the user/i.test(detail)) {
    return new Error(mode === 'Recover' ? 'Windows administrator approval was cancelled. Permission recovery was not started.' : 'Windows administrator approval was cancelled. File protection was not started.');
  }
  if (/timed?\s*out|ETIMEDOUT/i.test(detail) || error?.killed) return new Error('Windows administrator approval timed out. Inspect recovery status before retrying.');
  const xmlError = detail.match(/<S S="Error">([^<]+)/)?.[1];
  const message = (xmlError || detail).replace(/_x000D__x000A_/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  return new Error('Windows helper could not be launched: ' + message.slice(0, 1000));
}
function createConstructionLocks(app, effects = {}) {
  const root = path.join(app.getPath('userData'), 'construction-locks');
  fs.mkdirSync(root, { recursive: true });
  const pointer = path.join(root, 'current.json');
  const appRoot = app.getAppPath();
  const forbidden = [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, path.join(process.env.USERPROFILE || '', 'AppData'), root, appRoot, app.isPackaged ? path.dirname(appRoot) : appRoot];
  const helper = path.join(__dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), 'construction-lock.ps1');
  const run = effects.runPowerShell || execute;
  const alive = effects.workerAlive || workerAlive;
  let current = null, pending = false, stopped = false, journalUpdatedAt = 0, journalStatus = null, checking = false, checkingPromise=null, timer = null, currentStatus, operation=null, messageStatus=null, noticeLoadedId=null;
  const reviews=new Map();
  const signature=input=>JSON.stringify(input);
  async function preview(raw){
    if(process.platform!=='win32')throw Error('Construction Lock is available on Windows.');
    const input=validateInput(raw,forbidden),result=await require('./construction-preview.cjs').inspectSelection(input);
    if(result.ready){
      for(const [id,review]of reviews)if(review.expiresAt<Date.now())reviews.delete(id);
      if(reviews.size>=20)reviews.delete(reviews.keys().next().value);
      result.reviewId=randomUUID();reviews.set(result.reviewId,{signature:signature(input),expiresAt:Date.now()+600000});
    }
    return result;
  }
  async function accessProbe(mode,subject=current) {
    if (effects.accessProbe) return effects.accessProbe(mode, subject);
    const script = path.join(path.dirname(helper), 'construction-access.ps1');
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-StateDirectory', subject.directory, '-Mode', mode], { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  }
  function verifyAccess() {
    if (!current) return Promise.resolve();
    if (checkingPromise) return checkingPromise;
    const subject=current;
    checking = true;
    return checkingPromise=(async()=>{try {
      const result = await accessProbe('Check',subject);
      if (result.id !== subject.id || !['verified', 'attention'].includes(result.status)) throw new Error('The access receipt does not match this lock.');
      atomic(path.join(subject.directory, 'access-after.json'), result);
    } catch (error) { atomic(path.join(subject.directory, 'access-after.json'), { id: subject.id, status: 'attention', at: Date.now(), issues: [{ reason: 'check_unavailable', message: error.message }] }); }
    finally { checking = false;checkingPromise=null; }})();
  }
  try {
    const saved = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (/^[0-9a-f-]{36}$/.test(saved.id)) current = { ...saved, directory: path.join(root, saved.id) };
  } catch {}
  if (!current) {
    // An interrupted pointer write must not hide a journal that still needs restoration.
    for (const id of fs.readdirSync(root).filter(value => /^[0-9a-f-]{36}$/.test(value))) {
      const directory = path.join(root, id); let saved;
      for (const name of ['manifest.json', 'original.json']) {
        try { saved = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); break; } catch {}
      }
      if (saved && !terminal.has(saved.status)) { current = { id, directory, targets: saved.targets || [], mode: saved.mode }; break; }
    }
  }
  let recoveryScanAt = 0, recoveries = [];
  function pendingRecoveries(force = false) {
    if (!force && Date.now() - recoveryScanAt < 5000) return recoveries;
    recoveryScanAt = Date.now(); recoveries = [];
    for (const id of fs.readdirSync(root).filter(value => /^[0-9a-f-]{36}$/.test(value))) {
      let saved;
      for (const name of ['manifest.json', 'original.json']) { try { saved = JSON.parse(fs.readFileSync(path.join(root, id, name), 'utf8')); break; } catch {} }
      if (saved && !terminal.has(saved.status)) recoveries.push({ id, status: saved.status, targets: saved.targets || [], recoveryDirectory: path.join(root, id) });
    }
    return recoveries;
  }
  function saveMessage(value){
    const id=value.lockId??current?.id;
    if(!current||id!==current.id)return;
    messageStatus={...value,lockId:id};noticeLoadedId=id;
    try{atomic(path.join(current.directory,'notification.json'),messageStatus);}catch(error){messageStatus.error=[messageStatus.error,'Delivery status could not be saved: '+error.message].filter(Boolean).join(' ');}
    effects.onMessageStatus?.(messageStatus);
  }
  const notifyAttempt = createAttemptNotifier(effects.showRestricted || (() => {throw Error('Native restriction messages are unavailable.');}),Date.now,saveMessage);
  function list() {
    if (!current) return { supported: process.platform === 'win32', lock: null, operation:operation?{...operation}:null, recoveries: pendingRecoveries() };
    if(noticeLoadedId!==current.id){noticeLoadedId=current.id;try{const saved=JSON.parse(fs.readFileSync(path.join(current.directory,'notification.json'),'utf8'));messageStatus=saved.lockId===current.id?saved:null;}catch{messageStatus=null;}}
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(current.directory, 'manifest.json'), 'utf8')); }
    catch { try { manifest = { ...JSON.parse(fs.readFileSync(path.join(current.directory, 'original.json'), 'utf8')), status: 'recovery_required' }; } catch {} }
    let status = manifest?.status || (pending ? 'awaiting_windows_approval' : 'recovery_required');
    journalUpdatedAt = Number(manifest?.updatedAt) || 0; journalStatus = manifest?.status;
    if (manifest && !terminal.has(status) && Date.now() - manifest.updatedAt > 15000) status = 'recovery_required';
    let verification;
    if (status === 'unlocked') {
      try { verification = JSON.parse(fs.readFileSync(path.join(current.directory, 'access-after.json'), 'utf8')); } catch {}
      if (!verification && fs.existsSync(path.join(current.directory, 'access-before.json'))) { status = 'checking_access'; if (!checking) void verifyAccess(); }
      else if (verification?.id === current.id) {
        // Older locks predate the access baseline. Missing evidence cannot
        // establish an access failure, and must not trap Stop all/quit forever.
        // Keep the original receipt and warning; real probe failures still block.
        const baselineMissing = verification.status === 'attention' && verification.checked === 0
          && Array.isArray(verification.issues) && verification.issues.length > 0 && verification.issues.every(item => item?.reason === 'baseline_missing');
        status = verification.status === 'verified' ? 'unlocked' : baselineMissing ? 'access_unverified' : 'access_attention';
      }
      else status = 'access_unverified';
    }
    const launcher = path.join(current.directory, 'recover.cmd');
    currentStatus = status;
    syncTimer(status);
    return { supported: process.platform === 'win32', operation:operation?{...operation}:checking?{kind:'check_access',phase:'checking',id:current.id,cancelRequested:false}:null, messageStatus, recoveries: pendingRecoveries().filter(item => item.id !== current.id), lock: { id: current.id, targets: manifest?.targets?.length ? manifest.targets : current.targets, mode: manifest?.mode || current.mode, status, verification, expiresAt: manifest?.expiresAt || 0, error: manifest?.error || null, auditHealth: manifest?.auditHealth || 'starting', attempts: manifest?.attempts || [], recoveryDirectory: current.directory, recoveryLauncher: fs.existsSync(launcher) ? launcher : undefined } };
  }
  function monitor() {
    if (!current || stopped) return;
    const value = list();
    if (['active', 'preparing', 'awaiting_windows_approval'].includes(value.lock.status)) {
      try { fs.writeFileSync(path.join(current.directory, 'heartbeat'), 'alive'); } catch {}
    }
    if (value.lock.status === 'active') for (const attempt of value.lock.attempts) notifyAttempt({...attempt,lockId:value.lock.id});
  }
  function syncTimer(status) {
    const needsMonitor = !stopped && (pending || ['active','preparing','awaiting_windows_approval','restoring','checking_access'].includes(status));
    if (needsMonitor && !timer) { timer = setInterval(monitor, 1000); timer.unref(); }
    else if (!needsMonitor && timer) { clearInterval(timer); timer = null; }
  }
  // Read recovery once at startup. Inactive and restored locks have no heartbeat timer.
  list();
  async function launch(mode) {
    const log = path.join(current.directory, 'helper.log');
    const savedHelper = path.join(current.directory, 'construction-lock.ps1');
    const bootstrap = `& ${psQuote(fs.existsSync(savedHelper) ? savedHelper : helper)} -StateDirectory ${psQuote(current.directory)} -Mode ${psQuote(mode)} *> ${psQuote(log)}; if (!$?) { exit 1 }`;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')];
    const script = "$ErrorActionPreference='Stop'; $worker=Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(" + args.map(psQuote).join(',') + '); $worker.Id';
    const startedAt = Date.now();
    let stdout;
    try { ({ stdout } = await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 180000 })); }
    catch (error) { throw elevationError(error, mode); }
    const pid = Number(stdout.trim());
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Windows did not return a helper process ID. Inspect recovery status.');
    return { pid, startedAt };
  }
  async function waitFor(statuses, worker) {
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      const value = list();
      const fresh = journalUpdatedAt >= worker.startedAt;
      if (fresh && statuses.includes(value.lock.status)) return value;
      const exited = !alive(worker.pid);
      if ((fresh && ['failed', 'recovery_required', 'unlocked'].includes(journalStatus)) || exited) {
        // The helper may finish between the first journal read and the process check.
        const latest = list();
        if (journalUpdatedAt >= worker.startedAt && statuses.includes(latest.lock.status)) return latest;
        let detail = '';
        try { const bytes = fs.readFileSync(path.join(current.directory, 'helper.log')); detail = bytes.toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim().slice(-2500); } catch {}
        throw new Error(latest.lock.error || detail || 'The Windows helper exited without confirming activation. Inspect recovery status.');
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    fs.writeFileSync(path.join(current.directory, 'unlock'), 'cancelled after timeout');
    throw new Error('Windows helper did not confirm completion. Recovery status is available; the lock has been asked to unlock.');
  }
  function completedListing(){const value=list();value.operation=null;return value;}
  return {
    list,
    preview,
    cancelActivation(){
      if(operation?.kind!=='activation')throw Error('Activation has already finished. Use Unlock now if protection is active.');
      operation.cancelRequested=true;operation.phase='cancelling';
      if(operation.id&&current?.id===operation.id)atomic(path.join(current.directory,'cancel-request.json'),{id:current.id,at:Date.now()});
      if(operation.id&&current?.id===operation.id)atomic(path.join(current.directory,'unlock'),{reason:'activation cancelled by you'});
      return list();
    },
    async checkAccess(id){if(pending)throw Error('Wait for the current Windows operation.');if(id&&id!==current?.id)throw Error('Choose the current lock to check access.');if(!current)throw Error('There is no lock to check.');if(!['unlocked','checking_access','access_unverified','access_attention'].includes(list().lock.status))throw Error('Unlock the current protection before checking restored access.');await verifyAccess();return list();},
    async testMessage(){if(!effects.showRestricted)throw Error('Native restriction messages are unavailable.');await effects.showRestricted({synthetic:true});return {status:'acknowledged'};},
    async retryMessage(){const value=list(),attempt=value.lock?.attempts.find(item=>item.id===messageStatus?.attemptId);if(value.lock?.status!=='active')throw Error('Protection has ended. Use Test restriction message to preview the message.');if(messageStatus?.status==='requested')throw Error('The current message is still awaiting acknowledgement.');if(!attempt)throw Error('There is no recorded restriction message to retry.');if(!effects.showRestricted)throw Error('Native restriction messages are unavailable.');const lockId=value.lock.id;saveMessage({status:'requested',lockId,attemptId:attempt.id,at:Date.now()});try{await effects.showRestricted(attempt);saveMessage({status:'acknowledged',lockId,attemptId:attempt.id,at:Date.now()});}catch(error){saveMessage({status:'failed',lockId,attemptId:attempt.id,at:Date.now(),error:error.message});throw error;}return list();},
    details(id){const value=list();if(!id||id===value.lock?.id)return value.lock;const previous=pendingRecoveries(true).find(item=>item.id===id);if(!previous)throw Error('Choose a known recovery journal.');return {...previous,recoveryLauncher:fs.existsSync(path.join(previous.recoveryDirectory,'recover.cmd'))?path.join(previous.recoveryDirectory,'recover.cmd'):undefined};},
    status: () => currentStatus,
    async start(raw) {
      if (process.platform !== 'win32') throw new Error('Construction Lock is available on Windows.');
      if (pending || checking || current && !terminal.has(list().lock.status)) throw new Error('Unlock and check access for the current Construction Lock first.');
      if (pendingRecoveries(true).some(item => item.id !== current?.id)) throw new Error('An earlier Construction Lock still needs recovery. Recover it before starting another lock.');
      const input = validateInput(raw, forbidden);
      if(raw.reviewId){const review=reviews.get(raw.reviewId);if(!review||review.expiresAt<Date.now()||review.signature!==signature(input))throw Error('The path review is stale or does not match this selection. Check the selected paths again.');reviews.delete(raw.reviewId);}
      // Resolve links and check existence before presenting Windows elevation.
      for (const target of input.targets) {
        if (fs.realpathSync.native(target).toLowerCase() !== target.toLowerCase()) throw new Error('Choose a direct path outside links and junctions.');
      }
      pending = true;
      const activation=operation={kind:'activation',phase:'preparing',id:null,cancelRequested:false};
      try {
        const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { windowsHide: true });
        const sid = stdout.trim();
        if(activation.cancelRequested)throw Error('Activation cancelled before permissions changed.');
        if (!/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(sid)) throw new Error('A normal Windows user account is required.');
        const id = randomUUID(), directory = path.join(root, id);
        fs.mkdirSync(directory); current = { id, directory, ...input }; currentStatus = 'awaiting_windows_approval';
        activation.id=id;messageStatus=null;
        atomic(pointer, { id, ...input });
        atomic(path.join(directory, 'request.json'), { version: 1, id, ...input, sid, forbidden });
        // Recovery dependencies stay beside the journal and survive app updates.
        for (const name of ['construction-lock.ps1', 'construction-lock-native.cs', 'construction-access.ps1', 'construction-recovery.ps1']) {
          const source = path.join(path.dirname(helper), name), copy = path.join(directory, name);
          fs.copyFileSync(source, copy); const fd = fs.openSync(copy, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          if (!fs.readFileSync(copy).equals(fs.readFileSync(source))) throw new Error('The standalone recovery files could not be verified.');
        }
        const launcherFd = fs.openSync(path.join(directory, 'recover.cmd'), 'w');
        try { fs.writeFileSync(launcherFd, '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0construction-recovery.ps1"\r\n'); fs.fsyncSync(launcherFd); } finally { fs.closeSync(launcherFd); }
        const baseline = await accessProbe('Capture');
        if(activation.cancelRequested)throw Error('Activation cancelled before permissions changed.');
        if (baseline.id !== id || baseline.sid !== sid || !Array.isArray(baseline.entries) || !baseline.entries.length) throw new Error('Original access could not be verified. No permissions have been changed.');
        atomic(path.join(directory, 'access-before.json'), baseline);
        if (JSON.parse(fs.readFileSync(path.join(directory, 'access-before.json'), 'utf8')).id !== id) throw new Error('The recovery baseline could not be read back.');
        fs.writeFileSync(path.join(directory, 'heartbeat'), 'alive');
        try { activation.phase='awaiting_windows_approval';const worker = await launch('Work');
          if(activation.cancelRequested){const result=await waitFor(['unlocked','checking_access','access_unverified','access_attention','failed'],worker);if(result.lock?.status!=='failed')await verifyAccess();return completedListing();}
          const active=await waitFor(['active'], worker);
          if(activation.cancelRequested){await waitFor(['unlocked','checking_access','access_unverified','access_attention','failed'],worker);if(list().lock?.status!=='failed')await verifyAccess();return completedListing();}
          return {...active,operation:null}; }
        catch (error) {
          fs.writeFileSync(path.join(directory, 'unlock'), 'activation failed or cancelled');
          // A late helper observes the cancellation marker before changing permissions.
          if (!fs.existsSync(path.join(directory, 'manifest.json'))) {
            atomic(path.join(directory, 'manifest.json'), { status: 'failed', updatedAt: Date.now(), error: error.message, attempts: [] });
          }
          if(activation.cancelRequested){const value=list();if(['unlocked','checking_access','access_unverified','access_attention'].includes(value.lock.status)){await verifyAccess();return completedListing();}if(value.lock.status==='failed')return {...value,operation:null};}
          throw error;
        }
      } catch (error) {
        if (current && !fs.existsSync(path.join(current.directory, 'original.json')) && !fs.existsSync(path.join(current.directory, 'manifest.json'))) atomic(path.join(current.directory, 'manifest.json'), { status: 'failed', updatedAt: Date.now(), error: error.message, attempts: [] });
        throw error;
      } finally { pending = false;operation=null; try { list(); } catch {} }
    },
    async unlock(id) {
      if (id && id !== current?.id) {
        if (pending || checking || current && !['unlocked', 'failed', 'access_attention', 'access_unverified'].includes(list().lock.status)) throw new Error('Recover the current lock before choosing an earlier journal.');
        const record = pendingRecoveries(true).find(item => item.id === id); if (!record) throw new Error('Choose a known pending recovery ID.');
        current = { ...record, directory: record.recoveryDirectory }; atomic(pointer, { id, targets: record.targets });
      }
      if (!current) return list();
      if (['unlocked', 'access_unverified', 'access_attention', 'checking_access'].includes(list().lock.status)) { await verifyAccess(); return completedListing(); }
      if (terminal.has(list().lock.status)) return list();
      if (pending) throw new Error('Wait for Windows approval or cancel its prompt before unlocking.');
      pending = true;
      operation={kind:'unlock',phase:'restoring',id:current.id,cancelRequested:false};
      try {
        const status = list().lock.status;
        fs.writeFileSync(path.join(current.directory, 'unlock'), 'user requested');
        if (status === 'recovery_required') { await waitFor(['unlocked', 'checking_access', 'access_unverified', 'access_attention'], await launch('Recover')); await verifyAccess(); return completedListing(); }
        // The original helper's heartbeat will keep this checkpoint fresh while it restores.
        const until = Date.now() + 180000;
        while (Date.now() < until) {
          const value = list();
          if (['unlocked', 'checking_access', 'access_unverified', 'access_attention'].includes(value.lock.status)) { await verifyAccess(); return completedListing(); }
          if (value.lock.status === 'recovery_required') { await waitFor(['unlocked', 'checking_access', 'access_unverified', 'access_attention'], await launch('Recover')); await verifyAccess(); return completedListing(); }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('Windows did not confirm restoration. Recovery status is available.');
      } finally { pending = false;operation=null; try { list(); } catch {} }
    },
    stop() {
      stopped = true; clearInterval(timer);
      if (current) try { fs.writeFileSync(path.join(current.directory, 'unlock'), 'Orvix exited'); } catch {}
    },
  };
}
module.exports = { createConstructionLocks, validateInput, contains, createAttemptNotifier, restrictionDialogOptions, elevationError };
