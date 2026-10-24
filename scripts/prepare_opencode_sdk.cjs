const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

// OpenCode installs this SDK in every writable configuration directory, even
// under --pure. Ship its genuine dependency tree so native startup stays offline.
function prepareOpenCodeSdk(project = path.resolve(__dirname, '..')) {
  const modules = path.join(project, 'node_modules');
  const target = path.join(project, 'build', 'opencode-runtime-sdk');
  const version = require(path.join(modules, 'opencode-ai', 'package.json')).version;
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(project, 'package-lock.json'))).digest('hex');
  const marker = path.join(target, '.orvix-sdk-source.json');
  try {
    const previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (previous.version === version && previous.sourceHash === sourceHash
      && fs.existsSync(path.join(target, 'node_modules', '@opencode-ai', 'plugin', 'package.json'))) return target;
  } catch { /* Build or repair the managed template. */ }
  fs.mkdirSync(target, { recursive: true });
  const pkg = { name: 'orvix-native-sdk', version: '1.0.0', private: true, dependencies: { '@opencode-ai/plugin': version } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': pkg } };
  const copied = new Map();
  function locate(name, from) {
    for (const directory of createRequire(path.join(from, 'package.json')).resolve.paths(name) ?? []) {
      const manifest = path.join(directory, name, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const source = fs.realpathSync(path.dirname(manifest));
      const relative = path.relative(modules, source);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('OpenCode SDK dependencies must be installed inside this project.');
      return { source, info: JSON.parse(fs.readFileSync(manifest, 'utf8')) };
    }
    throw new Error(`Missing bundled OpenCode SDK dependency: ${name}. Run npm install.`);
  }
  function copy(name, from, parent = target, optional = false) {
    let dependency;
    try { dependency = locate(name, from); } catch (error) { if (optional) return; throw error; }
    const { source, info } = dependency;
    let destination = path.join(target, 'node_modules', name);
    if (copied.has(destination) && copied.get(destination) !== info.version) destination = path.join(parent, 'node_modules', name);
    if (copied.get(destination) === info.version) return;
    copied.set(destination, info.version);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, filter: entry => entry === source || !['node_modules', '.git'].includes(path.basename(entry)) });
    const relative = path.relative(target, destination).split(path.sep).join('/');
    lock.packages[relative] = { version: info.version, ...(info.license ? { license: info.license } : {}),
      ...(info.dependencies ? { dependencies: info.dependencies } : {}), ...(info.optionalDependencies ? { optionalDependencies: info.optionalDependencies } : {}) };
    const optionalNames = new Set(Object.keys(info.optionalDependencies ?? {}));
    for (const dependencyName of new Set([...Object.keys(info.dependencies ?? {}), ...optionalNames])) copy(dependencyName, source, destination, optionalNames.has(dependencyName));
  }
  const installed = locate('@opencode-ai/plugin', project);
  if (installed.info.version !== version) throw new Error('The bundled OpenCode SDK must match the native runtime version.');
  copy('@opencode-ai/plugin', project);
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify(lock, null, 2));
  fs.writeFileSync(marker, JSON.stringify({ version, sourceHash }));
  return target;
}
if (require.main === module) console.log('Prepared bundled OpenCode SDK:', prepareOpenCodeSdk());
module.exports = { prepareOpenCodeSdk };
