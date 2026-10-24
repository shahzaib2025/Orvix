const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite, readJson, safeValue } = require('./durable-store.cjs');
const { isHiddenPath } = require('./file-policy.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const manifests = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'pyproject.toml', 'pytest.ini', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'requirements.txt', 'global.json']);
const inside = (root, file) => { const rel = path.relative(root, file); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
function discover(directory, files) {
  const exists = name => files.has(name);
  const commands = [], diagnostics = [];
  let language = 'unknown', runner = null, requiredRuntime = null;
  const add = (kind, command, source) => commands.push({ kind, command, directory, source });
  if (exists('package.json')) {
    language = 'JavaScript/TypeScript'; requiredRuntime = 'node';
    try {
      const pkg = JSON.parse(files.get('package.json'));
      runner = String(pkg.packageManager ?? '').split('@')[0];
      if (!['npm', 'pnpm', 'yarn', 'bun'].includes(runner)) runner = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : exists('bun.lock') ? 'bun' : 'npm';
      for (const [name, definition] of Object.entries(pkg.scripts ?? {})) {
        if (!/^[a-zA-Z0-9:_-]+$/.test(name) || typeof definition !== 'string' || !definition.trim()) continue;
        const kind = /^(dev|start|serve)(:|$)/.test(name) ? 'run' : /^(test|check)(:|$)/.test(name) ? 'test' : /^build(:|$)/.test(name) ? 'build' : /^(typecheck|lint)(:|$)/.test(name) ? 'check' : null;
        if (kind) add(kind, `${runner} run ${name}`, { file: path.join(directory, 'package.json'), script: name, definition });
      }
      if (pkg.engines?.node) diagnostics.push(`Declared Node requirement: ${pkg.engines.node}; compatibility is not implied by detecting an executable.`);
    } catch { diagnostics.push('package.json could not be parsed; no package scripts were inferred.'); }
  }
  if (exists('go.mod')) { language = 'Go'; requiredRuntime = 'go'; add('test', 'go test ./...', { file: path.join(directory, 'go.mod') }); add('build', 'go build ./...', { file: path.join(directory, 'go.mod') }); }
  if (exists('Cargo.toml')) { language = 'Rust'; requiredRuntime = 'cargo'; add('test', 'cargo test', { file: path.join(directory, 'Cargo.toml') }); add('build', 'cargo build', { file: path.join(directory, 'Cargo.toml') }); }
  if (exists('pyproject.toml') || exists('pytest.ini') || exists('requirements.txt')) {
    if (language === 'unknown') language = 'Python'; requiredRuntime ??= 'python';
    if (exists('pytest.ini') || /\bpytest\b/.test(files.get('pyproject.toml') ?? '') || fs.existsSync(path.join(directory, 'tests'))) add('test', 'python -m pytest', { file: path.join(directory, exists('pytest.ini') ? 'pytest.ini' : 'pyproject.toml'), inferred: true });
  }
  if (exists('pom.xml')) { language = 'Java'; requiredRuntime = 'mvn'; add('test', 'mvn test -B', { file: path.join(directory, 'pom.xml'), inferred: true }); }
  if (exists('build.gradle') || exists('build.gradle.kts')) {
    language = 'JVM'; requiredRuntime = 'java';
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
    if (fs.existsSync(path.join(directory, wrapper))) add('test', process.platform === 'win32' ? '.\\gradlew.bat test' : './gradlew test', { file: path.join(directory, wrapper), inferred: true });
    else diagnostics.push('Gradle wrapper is unavailable; inspect the project setup before choosing a command.');
  }
  if ([...files.keys()].some(name => /\.(csproj|sln)$/.test(name))) { language = '.NET'; requiredRuntime = 'dotnet'; if ([...files.keys()].filter(name => /\.(csproj|sln)$/.test(name)).length === 1) { add('test', 'dotnet test', { file: directory, inferred: true }); add('build', 'dotnet build', { file: directory, inferred: true }); } else diagnostics.push('Multiple .NET project/solution files: select the intended target before running a command.'); }
  return { language, runner, requiredRuntime, commands, diagnostics };
}
function createProjectProfiles(app) {
  const base = path.join(app.getPath('userData'), 'agent-project-profiles');
  const target = root => path.join(base, hash(path.resolve(root)) + '.json');
  async function inspect({ taskId, root, maps, workspaces, environment }) {
    root = workspaces.assert(taskId, root);
    const snapshot = maps.snapshot(root);
    const directories = new Set([root, ...(snapshot?.files ?? []).filter(item => manifests.has(path.basename(item.file)) || /\.(csproj|sln)$/.test(item.file)).map(item => path.dirname(item.file))]);
    const old = readJson(target(root), { projects: [] });
    const projects = [];
    for (const directory of directories) {
      workspaces.assert(taskId, directory);
      const files = new Map();
      const projectManifests = new Set([...manifests, ...(snapshot?.files ?? []).filter(item => path.dirname(item.file) === directory && /\.(csproj|sln)$/.test(item.file)).map(item => path.basename(item.file))]);
      for (const name of projectManifests) {
        const file = path.join(directory, name);
        try { workspaces.assert(taskId, file); const stat = await fs.promises.stat(file); if (stat.size <= 2_000_000 && !isHiddenPath(file)) files.set(name, await fs.promises.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') { /* Scope and unreadable files never authorize a command. */ } }
      }
      if (!files.size) continue;
      const manifestHash = hash(JSON.stringify([...files].sort()));
      const profile = discover(directory, files);
      const runtime = environment?.executables?.find(item => item.name === profile.requiredRuntime) ?? { name: profile.requiredRuntime, status: 'unavailable', version: null };
      const runtimeStamp = hash(JSON.stringify([process.platform, runtime.name, runtime.status, runtime.version, environment?.executables?.find(item => item.name === profile.runner), environment?.embeddedNode]));
      const previous = old.projects.find(item => item.directory === directory && item.manifestHash === manifestHash && item.runtimeStamp === runtimeStamp);
      const commands = profile.commands.map(command => ({ ...command, status: 'declared', verification: previous?.commands.find(item => item.command === command.command)?.verification ?? null })).map(command => ({ ...command, status: command.verification && command.verification.sourceFingerprint !== snapshot?.fingerprint ? 'stale' : command.verification?.status === 'passed' ? 'verified' : command.verification ? 'failed' : 'declared' }));
      projects.push({ directory, manifestHash, runtimeStamp, sourceFingerprint: snapshot?.fingerprint ?? null, ...profile, commands, runtime, workingDirectory: { status: 'exists', approvedRoot: root }, observedAt: Date.now() });
    }
    const result = safeValue({ root, observedAt: Date.now(), projects, note: 'Declared/inferred commands are candidates. Verified means an observed successful execution for this manifest and runtime, not proof of the whole task. No project command was run by inspection.' });
    atomicWrite(target(root), result); return result;
  }
  function observe(roots, { directory, command, status, evidenceId, recordedAt }) {
    for (const root of roots.filter(root => inside(root, directory))) {
      const saved = readJson(target(root)); if (!saved) continue;
      let changed = false;
      for (const project of saved.projects) if (path.resolve(project.directory) === path.resolve(directory)) {
        for (const item of project.commands) if (item.command === command) { item.verification = { status, evidenceId, recordedAt, sourceFingerprint: project.sourceFingerprint }; item.status = status === 'passed' ? 'verified' : 'failed'; changed = true; }
      }
      if (changed) atomicWrite(target(root), saved);
    }
  }
  return { inspect, observe };
}
module.exports = { createProjectProfiles, discover };
