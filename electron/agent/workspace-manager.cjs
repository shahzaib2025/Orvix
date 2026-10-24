const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const markers = ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', '*.sln'];
const forbiddenParts = new Set(['appdata', '.ssh', '.aws', '.gnupg', '.config', 'windows', 'program files', 'program files (x86)', 'programdata']);
function protectedComponent(target) {
  const normalized = process.platform === 'win32'
    ? path.win32.normalize(String(target).replace(/\//g, '\\')).replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
    : path.posix.normalize(String(target));
  return normalized.split(/[\\/]+/).find(part => forbiddenParts.has(part.toLowerCase())) ?? null;
}
function protectedWorkspaceError(message, target) {
  const error = new Error(message);
  error.code = 'ERR_PROTECTED_WORKSPACE';
  error.protectedComponent = protectedComponent(target);
  return error;
}

function absolute(value) {
  const api = process.platform === 'win32' ? path.win32 : path;
  if (typeof value !== 'string' || !api.isAbsolute(value)) throw new Error('Use an absolute local path.');
  return api.resolve(value);
}

function normalizeForComparison(value) {
  if (process.platform !== 'win32') return path.resolve(value);
  let normalized = path.win32.normalize(String(value).replace(/\//g, '\\'));
  normalized = normalized.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  return normalized.toLowerCase();
}
function comparison(value) { return normalizeForComparison(value); }
function contains(root, target) {
  const api = process.platform === 'win32' ? path.win32 : path;
  const relative = api.relative(comparison(root), comparison(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative));
}
function protectedPath(target) {
  return protectedComponent(target) !== null;
}
function canonicalTarget(value) {
  const requested = absolute(value);
  let ancestor = requested;
  while (!fs.existsSync(ancestor)) {
    const parent = (process.platform === 'win32' ? path.win32 : path).dirname(ancestor);
    if (parent === ancestor) throw new Error('The target drive does not exist.');
    ancestor = parent;
  }
  const real = fs.realpathSync.native(ancestor);
  const api = process.platform === 'win32' ? path.win32 : path;
  return api.resolve(real, api.relative(ancestor, requested));
}
function markerPresent(directory) {
  return markers.some(marker => marker === '*.sln'
    ? fs.readdirSync(directory).some(name => name.toLowerCase().endsWith('.sln'))
    : fs.existsSync(path.join(directory, marker)));
}
function projectRoot(directory) {
  const requested = absolute(directory);
  const start = fs.realpathSync.native(requested);
  if (!fs.statSync(start).isDirectory()) throw new Error('Choose a project folder.');
  if (protectedPath(requested)) throw protectedWorkspaceError('System and credential folders cannot be opened as agent workspaces.', requested);
  if (protectedPath(start)) throw protectedWorkspaceError('System and credential folders cannot be opened as agent workspaces.', start);
  let current = start;
  const broad = [path.parse(start).root, os.homedir(), ...['Desktop', 'Documents', 'Downloads'].map(name => path.join(os.homedir(), name))];
  while (true) {
    if (markerPresent(current) && !broad.some(item => comparison(path.resolve(item)) === comparison(current))) return current;
    const parent = path.dirname(current);
    if (parent === current || comparison(current) === comparison(os.homedir())) break;
    current = parent;
  }
  if (broad.some(item => comparison(path.resolve(item)) === comparison(start))) throw new Error('Choose a project folder inside this location.');
  return start;
}

function createWorkspaceManager(app) {
  const base = path.join(app.getPath('userData'), 'agent-workspaces');
  fs.mkdirSync(base, { recursive: true });
  function manifestPath(taskId) {
    if (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('Invalid task ID.');
    return path.join(base, `${taskId}.json`);
  }
  function list(taskId) {
    try {
      const value = JSON.parse(fs.readFileSync(manifestPath(taskId), 'utf8'));
      const existing = Array.isArray(value) ? value.filter(item => typeof item === 'string' && fs.existsSync(item)) : [];
      if (existing.length) return existing;
    } catch { }
    return [];
  }
  function save(taskId, roots) {
    const target = manifestPath(taskId);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(roots));
    fs.renameSync(temporary, target);
  }
  async function open(taskId, directory, approve) {
    const requested = absolute(directory);
    const real = canonicalTarget(requested);
    if (protectedPath(requested)) throw protectedWorkspaceError('System and credential folders cannot be opened as agent workspaces.', requested);
    if (protectedPath(real)) throw protectedWorkspaceError('System and credential folders cannot be opened as agent workspaces.', real);
    // A project may already be approved through a different spelling or a
    // directory junction. Reuse it by its real target instead of reopening it
    // and rerunning project discovery on every native file permission event.
    for (const existing of list(taskId)) {
      let existingReal;
      try { existingReal = canonicalTarget(existing); } catch { continue; }
      if (protectedPath(existing) || protectedPath(existingReal)) continue;
      if (contains(existingReal, real)) return { root: existing, alreadyOpen: true };
    }
    const root = projectRoot(directory);
    if (!await approve(root)) return { root, declined: true };
    save(taskId, [...list(taskId), root]);
    return { root, alreadyOpen: false };
  }
  function assert(taskId, value) {
    const requested = absolute(value);
    const real = canonicalTarget(requested);
    if (protectedPath(requested)) throw protectedWorkspaceError('System and credential folders are unavailable to the agent.', requested);
    if (protectedPath(real)) throw protectedWorkspaceError('System and credential folders are unavailable to the agent.', real);
    // The selected workspace root is stored canonically. Check the target's
    // canonical location against that root; requiring the original spelling
    // to also be beneath it incorrectly rejects safe aliases/junction paths.
    // A symlink that escapes the selected project still fails this real-path
    // containment check.
    if (!list(taskId).some(root => {
      try {
        const realRoot = canonicalTarget(root);
        return !protectedPath(root) && !protectedPath(realRoot) && contains(realRoot, real);
      } catch { return false; }
    })) {
      // Auto-open if inside safe developer locations: cwd or Desktop/Documents/Downloads
      const home = os.homedir();
      const safeContainers = [
        process.cwd(),
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'Downloads')
      ];
      const isInsideSafe = safeContainers.some(container => {
        try {
          const realContainer = canonicalTarget(container);
          return contains(realContainer, real);
        } catch { return false; }
      });
      if (isInsideSafe && !protectedPath(real)) {
        let candidateDir = real;
        while (candidateDir && !fs.existsSync(candidateDir)) {
          const parent = path.dirname(candidateDir);
          if (parent === candidateDir) break;
          candidateDir = parent;
        }
        let autoRoot = null;
        try { autoRoot = projectRoot(candidateDir); } catch {
          try { autoRoot = fs.statSync(candidateDir).isDirectory() ? candidateDir : path.dirname(candidateDir); } catch {}
        }
        if (autoRoot && !protectedPath(autoRoot)) {
          save(taskId, [...list(taskId), autoRoot]);
          return requested;
        }
      }
      throw new Error('Path is outside this task’s open workspaces. Call open_workspace for its project folder first.');
    }
    return requested;
  }
  function discovery(value) {
    const requested = absolute(value);
    const real = canonicalTarget(requested);
    if (protectedPath(requested)) throw protectedWorkspaceError('System and credential folders are unavailable to the agent.', requested);
    if (protectedPath(real)) throw protectedWorkspaceError('System and credential folders are unavailable to the agent.', real);
    return requested;
  }
  function forget(taskId) { try { fs.unlinkSync(manifestPath(taskId)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return { list, open, assert, discovery, forget };
}

module.exports = { createWorkspaceManager, canonicalTarget, protectedPath, protectedComponent };
