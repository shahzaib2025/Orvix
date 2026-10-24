const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

async function main() {
  const root = path.resolve(__dirname, '..');
  const scratch = path.join(root, 'scratch'); fs.mkdirSync(scratch, { recursive: true });
  const folder = fs.mkdtempSync(path.join(scratch, 'desktop-bar-package-'));
  const source = path.join(folder, 'source');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(source, 'electron'), { recursive: true });
  fs.copyFileSync(path.join(root, 'electron', 'desktop-bar.cjs'), path.join(source, 'electron', 'desktop-bar.cjs'));
  fs.cpSync(path.join(root, 'electron', 'desktop-bar'), path.join(source, 'electron', 'desktop-bar'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', 'check_desktop_bar_native.cjs'), path.join(source, 'scripts', 'check_desktop_bar_native.cjs'));
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'orvix-desktop-bar-validation', version: '0.0.0', main: 'scripts/check_desktop_bar_native.cjs' }));
  const asar = await import('@electron/asar');
  const archive = path.join(folder, 'app.asar');
  await asar.createPackageWithOptions(source, archive, { unpack: '**/*.ps1' });
  for (const script of ['controls.ps1', 'shortcuts.ps1']) {
    assert.equal(asar.statFile(archive, path.join('electron', 'desktop-bar', script)).unpacked, true);
    assert.ok(fs.existsSync(path.join(archive + '.unpacked', 'electron', 'desktop-bar', script)));
  }
  const report = path.join(scratch, 'desktop-bar-packaged-native.json');
  fs.rmSync(report, { force: true });
  const executable = process.env.ORVIX_DESKTOP_BAR_ELECTRON || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const hash = await new Promise((resolve, reject) => {
    const digest = require('node:crypto').createHash('sha256');
    fs.createReadStream(executable).on('data', chunk => digest.update(chunk)).on('error', reject).on('end', () => resolve(digest.digest('hex')));
  });
  assert.equal(hash, 'f9d584073947ec9b1027278dad35be0e6fe0443f954a8448e9b0b3d34eceec1b', 'Native package validation requires the original development runtime');
  await new Promise((resolve, reject) => {
    const env = { ...process.env, ORVIX_DESKTOP_BAR_REPORT: report };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [archive], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stdout.on('data', () => {}); child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-6000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve();
      let failure = '';
      try { failure = JSON.parse(fs.readFileSync(report, 'utf8')).failure || ''; } catch {}
      reject(new Error(`Packaged native check failed (${code}): ${failure || errors}`));
    });
  });
  const native = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(native.passed, true, native.failure);
  console.log(JSON.stringify({ passed: true, archive, nativeChecks: native.checks.length, report }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
