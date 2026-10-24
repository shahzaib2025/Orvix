// Opt-in acceptance: one newly created Desktop folder; asks Windows for elevation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
if (process.versions.electron) {
  const { app, dialog } = require('electron');
  const { createConstructionLocks, restrictionDialogOptions } = require('../electron/construction-lock.cjs');
  const parent = path.join(os.homedir(), 'Desktop');
  const root = path.join(parent, 'Orvix-Construction-Test-' + randomUUID());
  const folder = path.join(root, 'protected-folder'), nested = path.join(folder, 'nested'), file = path.join(nested, 'draft.txt');
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(path.join(root, 'state'));
  fs.writeFileSync(path.join(root, 'disposable-test-marker'), 'Orvix live Construction Lock test');
  fs.writeFileSync(file, 'disposable construction test');
  app.setPath('userData', path.join(root, 'state'));
  const wait = async (check, timeout) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw new Error('Timed out waiting for the isolated test condition.');
  };
  app.whenReady().then(async () => {
    let engine, dialogVerified = false, attempts = [], noticeError = null, failure;
    console.log('Disposable test folder:', folder);
    try {
      if (process.argv.includes('--dialog-only')) {
        engine=createConstructionLocks(app,{showRestricted:attempt=>dialog.showMessageBox(restrictionDialogOptions(attempt))});
        const shown = engine.testMessage();
        const checked = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'check_construction_dialog.ps1'), '-ApplicationPid', String(process.pid)], { windowsHide: true, timeout: 20000 });
        console.log(checked.stdout.trim()); assert.equal((await shown).status, 'acknowledged');
        console.log('PASS: native restriction dialog smoke test; no permissions or audit policy changed.');
        return;
      }
      engine = createConstructionLocks(app, {
        showRestricted: async attempt => {
          attempts.push(attempt);
          try {
            const shown = dialog.showMessageBox(restrictionDialogOptions(attempt));
            const result = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'check_construction_dialog.ps1'), '-ApplicationPid', String(process.pid)], { windowsHide: true, timeout: 20000 });
            console.log(result.stdout.trim()); assert.equal((await shown).response, 0); dialogVerified = true;
          } catch (error) { noticeError = error; throw error; }
        },
      });
      console.log('Activating the production Windows helper. Approve its Windows prompt to continue.');
      const active = await engine.start({ targets: [folder], mode: 'read_write', durationMinutes: 1 });
      assert.equal(active.lock.status, 'active'); console.log('PASS: production helper confirmed active protection.');
      const rejected = (action, message) => { assert.throws(action, error => ['EACCES', 'EPERM', 'EBUSY'].includes(error.code)); console.log('PASS:', message); };
      rejected(() => fs.readFileSync(file), 'nested file read denied');
      rejected(() => fs.writeFileSync(file, 'must not change'), 'file modification denied');
      rejected(() => fs.readdirSync(folder), 'folder listing denied');
      rejected(() => fs.writeFileSync(path.join(folder, 'new.txt'), 'must not create'), 'file creation denied');
      rejected(() => fs.unlinkSync(file), 'file deletion denied');
      rejected(() => fs.renameSync(folder, folder + '-renamed'), 'folder rename denied');
      await wait(() => { if (noticeError) throw noticeError; return dialogVerified; }, 25000);
      assert.ok(attempts.some(attempt => attempt.path.toLowerCase().startsWith(folder.toLowerCase())));
      console.log('PASS: a real Windows 4656 denial reached Orvix and displayed its native dialog.');
      console.log('Waiting for the real one-minute automatic unlock...');
      await wait(() => engine.list().lock.status === 'unlocked', 90000);
      assert.equal(fs.readFileSync(file, 'utf8'), 'disposable construction test');
      fs.appendFileSync(file, ' — accessible after expiry');
      assert.ok(fs.readFileSync(file, 'utf8').endsWith('accessible after expiry'));
      console.log('PASS: timed expiry restored reading and writing without changing the original file contents.');
    } catch (error) { failure = error; }
    finally {
      try { if (engine?.list().lock && !['unlocked', 'failed'].includes(engine.list().lock.status)) await engine.unlock(); }
      catch (error) { failure = failure || error; console.error('Recovery needed:', error.message); }
      engine?.stop();
      const restored = !engine?.list().lock || ['unlocked', 'failed'].includes(engine.list().lock.status);
      if (restored) {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
        assert.equal(fs.readFileSync(path.join(root, 'disposable-test-marker'), 'utf8'), 'Orvix live Construction Lock test');
        fs.rmSync(root, { recursive: true, force: true }); console.log('Disposable test folder removed after access was restored.');
      } else console.error('Preserved recovery journal:', root);
      if (process.argv.includes('--dialog-only')) { app.exit(failure ? 1 : 0); }
    }
    if (failure) { console.error(failure); app.exit(1); } else { console.log('PASS: live Windows folder protection, audit notification, native dialog and automatic restoration.'); app.exit(0); }
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  if (process.platform !== 'win32') throw new Error('Windows is required.');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
