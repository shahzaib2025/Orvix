const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { atomicWrite, readJson } = require('./durable-store.cjs');
const { isHiddenPath } = require('./file-policy.cjs');
const { parseCandidates, resolveCandidate } = require('./candidate-structure.cjs');
const scriptExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const sourceExtensions = new Set([...scriptExtensions, '.py', '.go', '.rs', '.java', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.vue', '.svelte', '.css', '.scss', '.html', '.json', '.yaml', '.yml', '.toml', '.md', '.xml', '.txt', '.sql', '.sh', '.ps1', '.bat', '.cmd', '.ini', '.cfg', '.lock', '.csproj', '.sln', '.kts']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function contains(root, file) { const rel = path.relative(root, file); return rel === '' || rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
async function filesIn(root, signal) {
  const { rgPath } = await import('@vscode/ripgrep');
  const unpacked = rgPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  const executable = fs.existsSync(unpacked) ? unpacked : rgPath;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--files', '--hidden', '--no-require-git', '--glob', '!**/.git/**', '--glob', '!**/node_modules/**', '--glob', '!**/dist/**', '--glob', '!**/build/**', '--glob', '!**/release/**', '--glob', '!**/coverage/**', '--glob', '!**/target/**', '.'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let data = '', errors = '';
    const abort = () => child.kill();
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { data += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new Error('Task cancelled.'));
      else if (code !== 0 && code !== 1) reject(new Error(`Project indexing failed: ${errors.slice(0, 500)}`));
      else resolve(data.split(/\r?\n/).filter(Boolean).map(file => path.resolve(root, file)).filter(file => !isHiddenPath(file)));
    });
    if (signal.aborted) abort();
  });
}
function parseScript(file, source, compilerOptions) {
  const ts = require('typescript');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const symbols = [], imports = [];
  function walk(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      symbols.push({ name: node.name.text, kind: ts.SyntaxKind[node.kind], line: tree.getLineAndCharacterOfPosition(node.name.getStart()).line + 1, column: tree.getLineAndCharacterOfPosition(node.name.getStart()).character + 1 });
    }
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0].text;
    if (specifier) {
      const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule;
      imports.push({ specifier, file: resolved?.resolvedFileName ?? null, resolution: resolved ? 'compiler-resolved-module' : 'unresolved' });
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return { symbols, imports, resolution: 'typescript-ast', diagnostics: tree.parseDiagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')) };
}
function parsePython(file, signal) {
  return new Promise(resolve => {
    const env = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
    for (const key of Object.keys(env)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(key)) delete env[key];
    const helper = path.join(__dirname, 'project-map-python.py').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    execFile('python', ['-I', '-B', helper, file], { env, windowsHide: true, timeout: 30000, maxBuffer: 4_000_000, signal }, (error, stdout) => {
      if (error) return resolve({ symbols: [], imports: [], resolution: 'unavailable', diagnostics: [`Python AST indexing unavailable: ${error.message}`] });
      try { const value = JSON.parse(stdout); resolve({ ...value, diagnostics: value.diagnostic ? [value.diagnostic] : [] }); }
      catch { resolve({ symbols: [], imports: [], resolution: 'unavailable', diagnostics: ['Python AST index returned invalid data.'] }); }
    });
  });
}
function createProjectMap(app, { background = false } = {}) {
  const base = path.join(app.getPath('userData'), 'agent-project-maps');
  const cache = new Map();
  const inFlight = new Map();
  const indexer = background ? require('./project-map-background.cjs').createBackgroundIndexer(app) : null;
  function target(root) { return path.join(base, `${digest(path.resolve(root))}.json`); }
  async function refreshLocal(root, taskId, workspaces, signal) {
    const ts = require('typescript');
    root = workspaces.assert(taskId, root);
    if (signal.aborted) throw new Error('Task cancelled.');
    const old = cache.get(root) ?? readJson(target(root), { files: [] });
    const previous = new Map(old.files.map(item => [item.file, item]));
    const files = [];
    let compilerOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.NodeJs, jsx: ts.JsxEmit.ReactJSX };
    const configFile = path.join(root, 'tsconfig.json');
    if (fs.existsSync(configFile)) {
      const config = ts.readConfigFile(configFile, ts.sys.readFile);
      if (!config.error) compilerOptions = { ...compilerOptions, ...ts.parseJsonConfigFileContent(config.config, ts.sys, root).options };
    }
    const paths = await filesIn(root, signal);
    let goModule = null;
    try { const file = workspaces.assert(taskId, path.join(root, 'go.mod')); goModule = /^module\s+(\S+)/m.exec(await fs.promises.readFile(file, 'utf8'))?.[1] ?? null; } catch { /* No approved Go module. */ }
    for (const file of paths.sort()) {
      if (signal.aborted) throw new Error('Task cancelled.');
      try { workspaces.assert(taskId, file); } catch { continue; }
      if (!sourceExtensions.has(path.extname(file).toLowerCase()) && !/^(?:go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?)$/.test(path.basename(file))) continue;
      let stat, data;
      try { stat = await fs.promises.stat(file); if (!stat.isFile()) continue; data = await fs.promises.readFile(file); }
      catch { files.push({ file, resolution: 'unavailable', hash: 'unreadable', symbols: [], imports: [], diagnostics: ['File could not be read.'] }); continue; }
      if (data.includes(0)) continue;
      const hash = digest(data);
      let structure = previous.get(file);
      const configHash = digest(JSON.stringify(compilerOptions));
      if (!structure || structure.structureVersion !== 3 || structure.hash !== hash || structure.configHash !== configHash) {
        const ext = path.extname(file).toLowerCase();
        structure = data.length > 2_000_000 ? { symbols: [], imports: [], resolution: 'metadata-only', diagnostics: ['Structure extraction omitted for this large file.'] }
          : scriptExtensions.has(ext) ? parseScript(file, data.toString('utf8'), compilerOptions)
            : ext === '.py' ? await parsePython(file, signal)
              : parseCandidates(file, data.toString('utf8'));
      }
      const imports = (structure.imports ?? []).map(item => {
        if (structure.resolution === 'lexical-candidates') return resolveCandidate(file, item.specifier, root, paths, goModule);
        if (path.extname(file) !== '.py') { const resolved = ts.resolveModuleName(item.specifier, file, compilerOptions, ts.sys).resolvedModule; return { ...item, file: resolved?.resolvedFileName ?? null, resolution: resolved ? 'compiler-resolved-module' : 'unresolved' }; }
        let dir = item.level ? path.dirname(file) : root;
        for (let level = 1; level < (item.level ?? 0); level++) dir = path.dirname(dir);
        const candidate = path.join(dir, item.specifier.replaceAll('.', path.sep));
        const resolved = [`${candidate}.py`, path.join(candidate, '__init__.py')].find(value => contains(root, value) && fs.existsSync(value) && !isHiddenPath(value));
        return { ...item, file: resolved ?? null, resolution: resolved ? 'python-static-candidate' : 'unresolved' };
      });
      const manifest = path.basename(file) === 'package.json' ? (() => { try { const value = JSON.parse(data); return { scripts: value.scripts ?? {}, packageManager: value.packageManager ?? null, entryPoints: [value.main, value.module, value.browser].filter(item => typeof item === 'string'), dependencies: Object.keys(value.dependencies ?? {}) }; } catch { return null; } })() : null;
      files.push({ file, hash, size: stat.size, modifiedAt: stat.mtimeMs, configHash, ...structure, structureVersion: 3, imports, manifest,
        test: /_test\.go$|(?:^|[\\/])(?:tests?|__tests__)(?:[\\/])|\.(?:test|spec)\.|(?:^|[\\/])test_.*\.py$/.test(file),
        entryPoint: /(?:^|[\\/])(?:main|index|app|server)\.[^.]+$/i.test(file),
        guidance: /(?:^|[\\/])(?:AGENTS|README)\.md$/i.test(file) });
    }
    const snapshot = { version: 1, root, files, fingerprint: digest(JSON.stringify(files.map(item => [item.file, item.hash]))), updatedAt: Date.now(),
      limitations: 'JS/TS imports use compiler resolution; Python AST imports and Go/Rust/JVM/C-family declarations, imports and caller matches are candidates. Use semantic_code for supported symbol references. Generated, ignored, binary and credential paths are excluded.' };
    atomicWrite(target(root), snapshot); cache.set(root, snapshot); return snapshot;
  }
  function refresh(root, taskId, workspaces, signal) {
    root = workspaces.assert(taskId, root);
    if (signal.aborted) return Promise.reject(new Error('Task cancelled.'));
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    const previous = inFlight.get(key);
    if (previous) return require('./project-map-background.cjs').waitForIndex(previous, signal);
    const operation = (indexer ? indexer.refresh(root, taskId, signal) : refreshLocal(root, taskId, workspaces, signal))
      .then(snapshot => { cache.set(root, snapshot); return snapshot; }).finally(() => { if (inFlight.get(key) === operation) inFlight.delete(key); });
    inFlight.set(key, operation); return operation;
  }
  function fingerprint(roots) { return digest(JSON.stringify(roots.slice().sort().map(root => [root, cache.get(root)?.fingerprint ?? 'not-indexed']))); }
  function overview(roots) {
    return roots.map(root => { const map = cache.get(root); return { root, updatedAt: map?.updatedAt ?? null, files: map?.files.length ?? 0,
      tests: map?.files.filter(item => item.test).length ?? 0, symbols: map?.files.reduce((sum, item) => sum + item.symbols.length, 0) ?? 0,
      limitations: map?.limitations, diagnostics: map?.files.filter(item => item.diagnostics?.length).map(item => ({ file: item.file, diagnostics: item.diagnostics })).slice(0, 10) ?? [] }; });
  }
  function query(root, input) {
    const map = cache.get(root);
    if (!map) throw new Error('Refresh this project map first.');
    const query = String(input.query ?? '').toLowerCase();
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
    let items;
    if (input.action === 'symbol') items = map.files.flatMap(item => item.symbols.filter(symbol => symbol.name.toLowerCase().includes(query)).map(symbol => ({ ...symbol, file: item.file, resolution: item.resolution })));
    else if (input.action === 'callers') items = map.files.flatMap(item => (item.calls ?? []).filter(call => call.name === input.query).map(call => ({ ...call, file: item.file, resolution: 'lexical-caller-candidate' })));
    else if (input.action === 'dependents') {
      const requested = path.resolve(root, String(input.query ?? ''));
      const matches = edge => [edge.file, ...(edge.files ?? [])].filter(Boolean).some(file => path.resolve(file) === requested);
      items = map.files.filter(item => item.imports.some(matches)).map(item => ({ file: item.file, edges: item.imports.filter(matches) }));
    } else if (input.action === 'overview' || input.action === 'refresh') return { ...overview([root])[0], entryPoints: map.files.filter(item => item.entryPoint || item.manifest).map(item => ({ file: item.file, manifest: item.manifest })).slice(0, 30), guidance: map.files.filter(item => item.guidance).map(item => item.file) };
    else items = map.files.filter(item => item.file.toLowerCase().includes(query)).map(item => ({ ...item, symbols: item.symbols.slice(0, 20), imports: item.imports.slice(0, 20) }));
    const results = items.slice(offset, offset + 40);
    return { root, results, total: items.length, nextOffset: offset + results.length < items.length ? offset + results.length : null, limitations: map.limitations };
  }
  return { refresh, fingerprint, overview, query, snapshot: root => cache.get(root), shutdown: () => indexer?.shutdown() };
}
module.exports = { createProjectMap, listWorkspaceFiles: filesIn };
