const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const excluded = new Set(['.git', 'dist', 'build', 'release', 'coverage', 'target', '.next', '.cache']);
const credentialNames = new Set(['id_rsa', 'id_ed25519', 'id_ecdsa', 'secrets.json', 'secrets.yaml', 'secrets.yml']);
const credentialFolders = new Set(['.ssh', '.aws', '.gnupg', '.config']);
const maxFiles = 20000;
const maxBytes = 1_500_000_000;
const maxChangedFile = 1024 * 1024;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const hidden = name => /^\.env(?:\.|$)/i.test(name) || credentialNames.has(name.toLowerCase()) || credentialFolders.has(name.toLowerCase()) || /\.(?:pem|pfx|p12|keystore)$/i.test(name);
const key = relative => relative.split(path.sep).join('/');

function inside(root, target) {
  const relative = path.relative(root.toLowerCase(), target.toLowerCase());
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function copyProject(root, destination) {
  const baseline = Object.create(null);
  const queue = [''];
  let files = 0;
  let bytes = 0;
  while (queue.length) {
    const relativeDirectory = queue.shift();
    const sourceDirectory = path.join(root, relativeDirectory);
    const outputDirectory = path.join(destination, relativeDirectory);
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (hidden(entry.name) || excluded.has(entry.name.toLowerCase())) continue;
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { queue.push(relative); continue; }
      if (!entry.isFile()) continue;
      const source = path.join(root, relative);
      const stat = fs.statSync(source);
      files++;
      bytes += stat.size;
      if (files > maxFiles || bytes > maxBytes) throw new Error('Project is too large for an isolated run. Use a narrower workspace or an approved host command.');
      fs.copyFileSync(source, path.join(destination, relative));
      if (stat.size <= maxChangedFile) baseline[key(relative)] = hash(fs.readFileSync(source));
    }
  }
  return baseline;
}

function copyNodeRuntime(destination) {
  const lookup = spawnSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  const node = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).find(line => line.trim() && fs.existsSync(line.trim()))?.trim() : null;
  if (!node) return false;
  const home = path.dirname(node);
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(node, path.join(destination, 'node.exe'));
  for (const name of ['npm.cmd', 'npx.cmd']) {
    const source = path.join(home, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(destination, name));
  }
  const npm = path.join(home, 'node_modules', 'npm');
  if (fs.existsSync(npm)) {
    fs.mkdirSync(path.join(destination, 'node_modules'), { recursive: true });
    fs.cpSync(npm, path.join(destination, 'node_modules', 'npm'), { recursive: true, dereference: false });
  }
  return true;
}

function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 1000 || relative.includes(':') || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('Sandbox returned an invalid file path.');
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || hidden(part) || excluded.has(part.toLowerCase()))) throw new Error('Sandbox returned a protected file path.');
  return path.join(...parts);
}

async function applyResult(root, baseline, output, records, workspaces, taskId, changes, emit) {
  if (!Array.isArray(records) || records.length > 500) throw new Error('Sandbox produced too many changes to apply safely.');
  const prepared = [];
  const seen = new Set();
  for (const record of records) {
    if (!record || !['written', 'deleted'].includes(record.kind)) throw new Error('Sandbox returned an invalid change record.');
    const relative = safeRelative(record.relative);
    const normalized = key(relative).toLowerCase();
    if (seen.has(normalized)) throw new Error('Sandbox returned a duplicate file path.');
    seen.add(normalized);
    const target = path.resolve(root, relative);
    if (!inside(root, target)) throw new Error('Sandbox change escaped the project folder.');
    workspaces.assert(taskId, target);
    const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const expected = baseline[key(relative)] ?? null;
    if ((current ? hash(current) : null) !== expected) throw new Error(`File changed on the host during the isolated run: ${relative}`);
    let after = null;
    if (record.kind !== 'deleted') {
      const source = path.resolve(output, 'files', relative);
      if (!inside(path.join(output, 'files'), source)) throw new Error('Sandbox output escaped its result folder.');
      if (!inside(fs.realpathSync.native(output), fs.realpathSync.native(source))) throw new Error('Sandbox output followed a link outside its result folder.');
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.size > maxChangedFile) throw new Error(`Sandbox returned an unsupported file: ${relative}`);
      after = fs.readFileSync(source);
      if (hash(after) !== record.afterHash) throw new Error(`Sandbox output checksum mismatch: ${relative}`);
    }
    prepared.push({ target, current, after });
  }
  for (const item of prepared) {
    if (item.after) {
      const missing = [];
      for (let directory = path.dirname(item.target); !fs.existsSync(directory); directory = path.dirname(directory)) missing.push(directory);
      fs.mkdirSync(path.dirname(item.target), { recursive: true });
      for (const directory of missing.reverse()) changes.markDirectory(taskId, directory, false, true);
      const temporary = `${item.target}.orvix-${process.pid}.tmp`;
      try { fs.writeFileSync(temporary, item.after); fs.renameSync(temporary, item.target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    } else if (item.current) fs.unlinkSync(item.target);
    changes.markFile(taskId, item.target, item.current, item.after);
  }
  if (prepared.length) await emit({ type: 'changes', files: changes.list(taskId) });
  return prepared.length;
}

module.exports = { copyProject, copyNodeRuntime, applyResult };
