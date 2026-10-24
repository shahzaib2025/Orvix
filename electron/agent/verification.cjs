const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isHiddenPath } = require('./file-policy.cjs');

const MAX_PROJECTS = 4;
const MAX_CHECKS = 10;
const codeExtensions = new Set([
  '.c', '.cc', '.cpp', '.cs', '.cjs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.json', '.kt',
  '.gradle', '.kts', '.mjs', '.php', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.swift', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml',
]);
const projectFiles = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'tsconfig.json',
  'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'pyproject.toml', 'pytest.ini', 'setup.cfg', 'requirements.txt', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
]);

function hasAny(directory, names) { return names.some(name => fs.existsSync(path.join(directory, name))); }
function hasDotnetProject(directory) {
  try { return fs.readdirSync(directory).some(name => /\.(?:sln|slnx|csproj)$/i.test(name)); }
  catch { return false; }
}

function nearestProject(file, roots = []) {
  let directory = path.dirname(path.resolve(file));
  const boundary = roots.map(root => path.resolve(root)).filter(root => {
    const relative = path.relative(root, path.resolve(file));
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  }).sort((a,b) => b.length-a.length)[0];
  let standalone = null;
  for (let depth = 0; depth < 16; depth++) {
    const basename = path.basename(file).toLowerCase();
    const hasPackage = fs.existsSync(path.join(directory, 'package.json'));
    const hasGo = fs.existsSync(path.join(directory, 'go.mod'));
    const hasRust = fs.existsSync(path.join(directory, 'Cargo.toml'));
    const hasPython = hasAny(directory, ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'requirements.txt']);
    const hasJava = hasAny(directory, ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat']);
    const hasDotnet = hasDotnetProject(directory);
    if (hasPackage || hasGo || hasRust || hasPython || hasJava || (hasDotnet && /\.(?:cs|csproj|sln|slnx)$/i.test(file))) return directory;
    if (projectFiles.has(basename) && directory === path.dirname(path.resolve(file))) return directory;
    if (!standalone && fs.existsSync(path.join(directory, 'index.html'))) standalone = directory;
    if ((standalone && !boundary) || (boundary && path.relative(boundary, directory) === '')) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return standalone ?? (/\.(?:js|cjs|mjs)$/i.test(file) ? path.dirname(path.resolve(file)) : null);
}

function packageChecks(directory) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')); }
  catch { return []; }
  const scripts = manifest?.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  let runner = typeof manifest.packageManager === 'string' ? manifest.packageManager.split('@')[0] : 'npm';
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(runner)) runner = 'npm';
  if (runner === 'npm') {
    if (fs.existsSync(path.join(directory, 'pnpm-lock.yaml'))) runner = 'pnpm';
    else if (fs.existsSync(path.join(directory, 'yarn.lock'))) runner = 'yarn';
    else if (fs.existsSync(path.join(directory, 'bun.lock')) || fs.existsSync(path.join(directory, 'bun.lockb'))) runner = 'bun';
  }
  const result = [];
  for (const script of ['typecheck', 'check', 'lint', 'test:unit', 'test', 'build']) {
    if (typeof scripts[script] !== 'string' || !scripts[script].trim()) continue;
    if (script === 'test:unit' && typeof scripts.test === 'string') continue;
    const command = script === 'test' ? (runner === 'bun' ? 'bun run test' : `${runner} test`) : `${runner} run ${script}`;
    result.push({ label: script === 'typecheck' ? 'Type check' : script[0].toUpperCase() + script.slice(1), command, directory });
  }
  return result;
}

function referencedScripts(directory, paths) {
  // HTML/CSS repairs can break a page without changing its JavaScript. Check
  // the scripts that page actually loads, without fetching URLs or executing it.
  const htmlFiles = paths.filter(file => /\.html?$/i.test(file));
  if (paths.some(file => /\.css$/i.test(file))) htmlFiles.push(path.join(directory, 'index.html'));
  const result = new Set();
  const within = (root, file) => { const relative = path.relative(root, file); return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };
  for (const html of new Set(htmlFiles)) {
    try {
      if (fs.statSync(html).size > 2 * 1024 * 1024 || isHiddenPath(html)) continue;
      const realRoot = fs.realpathSync(directory);
      if (!within(realRoot, fs.realpathSync(html))) continue;
      const source = fs.readFileSync(html, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      // A base URL changes relative resolution; leave that case to the browser.
      if (/<base\b/i.test(source)) continue;
      for (const tag of source.matchAll(/<script\b([^>]*?)>/gi)) {
        try {
          const src = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[1]);
          if (!src) continue;
          const url = (src[1] ?? src[2] ?? src[3]).trim();
          if (!url || /^(?:[a-z][\w+.-]*:|[\\/]{2})/i.test(url)) continue;
          const pathname = decodeURIComponent(url.split(/[?#]/)[0]);
          const target = path.resolve(pathname.startsWith('/') ? directory : path.dirname(html), pathname.replace(/^\//, ''));
          if (!/\.(?:js|mjs|cjs)$/i.test(target) || !within(directory, target) || isHiddenPath(target)) continue;
          if (!within(realRoot, fs.realpathSync(target)) || !fs.statSync(target).isFile()) continue;
          result.add(target);
          if (result.size >= MAX_CHECKS) return [...result];
        } catch { /* One missing reference must not hide the remaining checks. */ }
      }
    } catch { /* Missing or unsupported HTML/script references need browser checks. */ }
  }
  return [...result];
}

function commandsFor(directory, paths) {
  const extensions = new Set(paths.map(file => path.extname(file).toLowerCase()));
  const basenames = new Set(paths.map(file => path.basename(file).toLowerCase()));
  const checks = packageChecks(directory);
  if (checks.length) return checks;
  const syntaxFiles = [...new Set([...paths.filter(file => ['.js', '.cjs', '.mjs'].includes(path.extname(file).toLowerCase()) && fs.existsSync(file)), ...referencedScripts(directory, paths)])].slice(0, MAX_CHECKS);
  if (syntaxFiles.length) return syntaxFiles.map(file => ({ label: `Syntax check: ${path.basename(file)}`,
    command: `node --check '${path.relative(directory, file).replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`, directory }));
  if ((extensions.has('.go') || basenames.has('go.mod') || basenames.has('go.sum')) && fs.existsSync(path.join(directory, 'go.mod'))) return [{ label: 'Go tests', command: 'go test ./...', directory }];
  if ((extensions.has('.rs') || basenames.has('cargo.toml') || basenames.has('cargo.lock')) && fs.existsSync(path.join(directory, 'Cargo.toml'))) return [{ label: 'Rust tests', command: 'cargo test', directory }];
  if ((extensions.has('.py') || ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'requirements.txt'].some(name => basenames.has(name))) && hasAny(directory, ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'requirements.txt'])) {
    const hasTests = hasAny(directory, ['tests', 'test']);
    if (hasTests) return [{ label: 'Python tests', command: 'python -m pytest -q', directory }];
    return [];
  }
  if ((extensions.has('.java') || basenames.has('pom.xml')) && fs.existsSync(path.join(directory, 'pom.xml'))) return [{ label: 'Java tests', command: 'mvn test -B', directory }];
  if ((extensions.has('.java') || [...basenames].some(name => name.startsWith('build.gradle') || name.startsWith('settings.gradle'))) && hasAny(directory, ['gradlew', 'gradlew.bat', 'build.gradle', 'build.gradle.kts'])) {
    const wrapper = process.platform === 'win32' && fs.existsSync(path.join(directory, 'gradlew.bat')) ? '.\\gradlew.bat test' : './gradlew test';
    return [{ label: 'Gradle tests', command: wrapper, directory }];
  }
  if (extensions.has('.cs') || [...basenames].some(name => /\.(?:sln|slnx|csproj)$/i.test(name))) {
    try {
      const solution = fs.readdirSync(directory).find(file => /\.(sln|slnx)$/i.test(file));
      const project = solution ?? fs.readdirSync(directory).find(file => /\.csproj$/i.test(file));
      if (project) return [{ label: '.NET tests', command: `dotnet test "${project.replaceAll('"', '\\"')}" --nologo`, directory }];
    } catch { /* inaccessible project directory */ }
  }
  return [];
}

function createVerificationPlan(changes, { roots = [] } = {}) {
  const relevant = changes.filter(change => !change.directory && (codeExtensions.has(path.extname(change.path).toLowerCase()) || projectFiles.has(path.basename(change.path).toLowerCase()) || /\.(?:csproj|sln|slnx)$/i.test(change.path)));
  if (!relevant.length) return { checks: [], reason: 'No code or project configuration files changed.' };
  const projects = new Map();
  for (const change of relevant) {
    const root = nearestProject(change.path, roots);
    if (!root) continue;
    if (!projects.has(root)) projects.set(root, []);
    projects.get(root).push(change.path);
  }
  if (projects.size > MAX_PROJECTS) return { checks: [], reason: `Changes span ${projects.size} projects; automatic checks are limited to ${MAX_PROJECTS} projects per task.` };
  const checks = [...projects].flatMap(([root, paths]) => commandsFor(root, paths));
  if (!checks.length) return { checks: [], reason: 'No recognized local verification command was found for the changed project.' };
  if (checks.length > MAX_CHECKS) return { checks: [], reason: `The project exposed more than ${MAX_CHECKS} checks; choose the checks manually with the agent.` };
  return { checks, reason: '' };
}

const fingerprintCache = new WeakMap();
function commandKey(command) {
  const normalized = String(command).trim().replace(/\s+/g, ' ');
  return /^npm(?:\.cmd)? (?:run )?test$/.test(normalized) ? 'npm run test' : normalized;
}
function fingerprint(changes, changeStore, taskId) {
  const revision = changeStore.fingerprintRevision?.(taskId);
  const signature = JSON.stringify(changes.map(change => [change.path, change.kind, change.directory === true]));
  let cache = fingerprintCache.get(changeStore);
  if (!cache) { cache = new Map(); fingerprintCache.set(changeStore, cache); }
  const previous = cache.get(taskId);
  if (revision !== undefined && previous?.revision === revision && previous.signature === signature) return previous.value;
  const captured = changeStore.capture?.(taskId);
  const hash = crypto.createHash('sha256');
  for (const change of changes) {
    hash.update(`${change.path}\0${change.kind}\0`);
    if (!change.directory) {
      const record = captured?.files?.[change.path];
      if (record && Object.hasOwn(record, 'beforeHash') && Object.hasOwn(record, 'afterHash')) {
        hash.update(record.beforeHash ?? '<created>'); hash.update('\0'); hash.update(record.afterHash ?? '<deleted>'); hash.update('\0');
        continue;
      }
      const diff = record ? { before: record.before === null ? null : Buffer.from(record.before, 'base64').toString('utf8'), after: record.after === null ? null : Buffer.from(record.after, 'base64').toString('utf8') } : changeStore.diff(taskId, change.path);
      hash.update(diff.before ?? '<created>');
      hash.update('\0');
      hash.update(diff.after ?? '<deleted>');
    }
    hash.update('\0');
  }
  const value = hash.digest('hex');
  if (revision !== undefined) cache.set(taskId, { revision, signature, value });
  return value;
}

function summaryText(result) {
  const current = result.checks.filter(check => check.phase !== 'reproduce' && !check.stale && !check.superseded);
  const failures = current.filter(check => check.status === 'failed').length;
  if (result.status === 'passed') return `Verification passed (${current.length} ${current.length === 1 ? 'check' : 'checks'}).`;
  if (result.status === 'failed') return `Verification failed (${failures} check${failures === 1 ? '' : 's'} failed).`;
  if (result.status === 'not_needed') return 'Verification was not needed because no code files changed.';
  return `Automatic project verification was not run: ${result.reason}`;
}

function summarizeVerification(checks, fallbackReason, changedFiles, currentFingerprint = null) {
  const evidence = checks.map(check => check.phase !== 'reproduce' && currentFingerprint && check.stateFingerprint
    && check.stateFingerprint !== currentFingerprint ? { ...check, stale: true } : check);
  const key = check => `${check.phase}:${check.directory}:${check.command}:${check.label}`;
  const latest = new Map();
  evidence.forEach((check, index) => { if (check.phase !== 'reproduce') latest.set(key(check), index); });
  const annotated = evidence.map((check, index) => check.phase !== 'reproduce' && latest.get(key(check)) !== index
    ? { ...check, superseded: true } : check);
  const post = annotated.filter(check => check.phase !== 'reproduce' && !check.superseded);
  if (post.some(check => check.status === 'failed' && !check.stale)) return { status: 'failed', reason: 'At least one post-change check failed.', checks: annotated };
  if (post.some(check => check.stale)) return { status: 'not_run', reason: 'One or more checks ran before the latest file changes and must be rerun.', checks: annotated };
  if (post.some(check => check.status === 'skipped')) return { status: 'not_run', reason: 'At least one post-change check was skipped.', checks: annotated };
  if (post.length && post.every(check => check.status === 'passed')) {
    return { status: 'passed', reason: fallbackReason && !annotated.some(check => check.source === 'automatic')
      ? `Agent-selected checks passed. ${fallbackReason}` : '', checks: annotated };
  }
  if (annotated.some(check => check.phase === 'reproduce')) {
    return { status: 'not_run', reason: 'A baseline was recorded, but no post-change check ran.', checks: annotated };
  }
  return changedFiles ? { status: 'not_run', reason: fallbackReason || 'No post-change check ran.', checks: annotated }
    : { status: 'not_needed', reason: 'No tracked file edits or checks were recorded.', checks: annotated };
}

module.exports = { createVerificationPlan, fingerprint, summaryText, summarizeVerification, commandKey };
