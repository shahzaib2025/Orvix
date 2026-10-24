const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function prepareRuntimeSdk(root, template) {
  if (!template) {
    template = process.resourcesPath && path.join(process.resourcesPath, 'opencode-runtime-sdk');
    if (!template || !fs.existsSync(path.join(template, 'package-lock.json'))) {
      if (__dirname.includes(`${path.sep}app.asar${path.sep}`)) throw new Error('The bundled OpenCode SDK is missing. Reinstall Orvix.');
      template = require('../../scripts/prepare_opencode_sdk.cjs').prepareOpenCodeSdk();
    }
  }
  const config = path.join(root, 'config', 'opencode');
  const sourceManifest = fs.readFileSync(path.join(template, 'package.json'), 'utf8');
  const sourceLock = fs.readFileSync(path.join(template, 'package-lock.json'), 'utf8');
  const version = JSON.parse(sourceManifest).dependencies['@opencode-ai/plugin'];
  const fingerprint = crypto.createHash('sha256').update(sourceManifest).update(sourceLock).digest('hex');
  const marker = path.join(config, '.orvix-sdk-ready.json');
  const installed = path.join(config, 'node_modules', '@opencode-ai', 'plugin', 'package.json');
  try {
    const previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(installed, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(config, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(config, 'package-lock.json'), 'utf8'));
    if (previous.fingerprint === fingerprint && pkg.version === version
      && manifest.dependencies?.['@opencode-ai/plugin'] === version
      && lock.packages?.['']?.dependencies?.['@opencode-ai/plugin'] === version) return;
  } catch { /* Repair a partial copy before starting the native process. */ }
  fs.mkdirSync(config, { recursive: true });
  // Copy code only. The task database, credentials and other runtime records
  // stay in this worker's private directories. No SDK symlinks or npm commands.
  await fs.promises.cp(path.join(template, 'node_modules'), path.join(config, 'node_modules'), { recursive: true });
  await fs.promises.writeFile(path.join(config, 'package.json'), sourceManifest, { mode: 0o600 });
  await fs.promises.writeFile(path.join(config, 'package-lock.json'), sourceLock, { mode: 0o600 });
  const temporary = marker + '.tmp';
  await fs.promises.writeFile(temporary, JSON.stringify({ version, fingerprint }), { mode: 0o600 });
  await fs.promises.rename(temporary, marker);
}
module.exports = { prepareRuntimeSdk };
