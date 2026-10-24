const fs = require('node:fs');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');
const ts = require('typescript');
const { isSensitiveFile } = require('./file-policy.cjs');
const { renameLocations } = require('./typescript-rename.cjs');

const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const blocked = new Set(['.git', '.ssh', '.aws', '.gnupg', '.config']);
const scanExcluded = [...blocked, 'node_modules', 'dist', 'build', 'release', 'coverage', 'target', '.next', '.cache'];
const libRoot = path.dirname(require.resolve('typescript'));
const registry = ts.createDocumentRegistry();
const projects = new Map();
const maxProjectFiles = 2500;

function inside(root, target) {
  const relative = path.relative(process.platform === 'win32' ? root.toLowerCase() : root,
    process.platform === 'win32' ? target.toLowerCase() : target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function permitted(file, root) {
  const target = path.resolve(file);
  const library = inside(libRoot, target);
  if (!library && !inside(root, target)) return false;
  if (!library) {
    const relative = path.relative(root, target);
    if (relative.split(path.sep).some(part => blocked.has(part.toLowerCase()) || isSensitiveFile(part))) return false;
  }
  try {
    const ancestor = fs.existsSync(target) ? target : path.dirname(target);
    const real = fs.realpathSync.native(ancestor);
    return library ? inside(libRoot, real) : inside(root, real);
  } catch { return false; }
}

function safeSystem(root) {
  const check = file => permitted(file, root);
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: file => check(file) && ts.sys.fileExists(file),
    readFile: file => {
      if (!check(file)) return undefined;
      try {
        if (fs.statSync(file).size > 3_000_000) return undefined;
        return ts.sys.readFile(file);
      } catch { return undefined; }
    },
    directoryExists: directory => check(directory) && ts.sys.directoryExists(directory),
    getDirectories: directory => check(directory) ? ts.sys.getDirectories(directory).filter(check) : [],
    readDirectory: (directory, allowedExtensions, excludes, includes, depth) => {
      if (!check(directory)) return [];
      return ts.sys.readDirectory(directory, allowedExtensions, excludes, includes, depth).filter(check);
    },
    realpath: file => check(file) ? ts.sys.realpath(file) : file,
    getCurrentDirectory: () => root,
    getNewLine: () => ts.sys.newLine,
  };
}

function configCandidates(file, root) {
  const candidates = [];
  for (let directory = path.dirname(file); inside(root, directory); directory = path.dirname(directory)) {
    try {
      for (const name of fs.readdirSync(directory)) {
        if (/^(?:tsconfig(?:\.[\w.-]+)?|jsconfig)\.json$/i.test(name)) candidates.push(path.join(directory, name));
      }
    } catch { /* An unavailable folder will not provide a config. */ }
    if (directory === root) break;
  }
  return candidates.slice(0, 24);
}

function projectDescription(file, root, system) {
  const requested = process.platform === 'win32' ? file.toLowerCase() : file;
  for (const configPath of configCandidates(file, root)) {
    const config = ts.readConfigFile(configPath, system.readFile);
    if (config.error || !config.config) continue;
    const parsed = ts.parseJsonConfigFileContent(config.config, system, path.dirname(configPath),
      { allowJs: true, noEmit: true }, configPath);
    const names = parsed.fileNames.filter(name => permitted(name, root));
    if (names.some(name => (process.platform === 'win32' ? name.toLowerCase() : name) === requested)) {
      if (names.length > maxProjectFiles) throw new Error('This TypeScript project is too large for semantic navigation. Choose a narrower project folder.');
      return { key: configPath, configPath, files: names, options: { ...parsed.options, allowJs: true, noEmit: true },
        warnings: parsed.errors.slice(0, 3).map(item => ts.flattenDiagnosticMessageText(item.messageText, ' ').slice(0, 240)) };
    }
  }
  const files = system.readDirectory(root, extensions, scanExcluded.map(name => `**/${name}/**`), ['**/*']);
  if (files.length > maxProjectFiles) throw new Error('This folder has too many source files for semantic navigation. Choose a narrower project folder.');
  if (!files.includes(file)) files.push(file);
  return { key: `${root}:inferred`, configPath: null, files, warnings: ['No matching TypeScript project config; using inferred settings.'],
    options: { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
      skipLibCheck: true, resolveJsonModule: true } };
}

function languageService(description, root, system) {
  const signature = JSON.stringify(description.options);
  let state = projects.get(description.key);
  if (state && (state.root !== root || state.signature !== signature)) {
    state.service.dispose();
    projects.delete(description.key);
    state = null;
  }
  if (!state) {
    state = { root, signature, files: description.files, options: description.options, service: null };
    const host = {
      getCompilationSettings: () => state.options,
      getScriptFileNames: () => state.files,
      getScriptVersion: file => {
        if (!permitted(file, root)) return '0';
        try { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`; }
        catch { return '0'; }
      },
      getScriptSnapshot: file => {
        const contents = system.readFile(file);
        return contents === undefined ? undefined : ts.ScriptSnapshot.fromString(contents);
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine,
      fileExists: system.fileExists,
      readFile: system.readFile,
      readDirectory: system.readDirectory,
      directoryExists: system.directoryExists,
      getDirectories: system.getDirectories,
      realpath: system.realpath,
    };
    state.service = ts.createLanguageService(host, registry);
    projects.set(description.key, state);
    if (projects.size > 3) {
      const oldest = projects.keys().next().value;
      projects.get(oldest).service.dispose();
      projects.delete(oldest);
    }
  } else {
    state.files = description.files;
    projects.delete(description.key);
    projects.set(description.key, state);
  }
  return state.service;
}

function location(source, start, root) {
  if (!source || !permitted(source.fileName, root) || !inside(root, source.fileName)) return null;
  const point = source.getLineAndCharacterOfPosition(start);
  const lineStart = source.getPositionOfLineAndCharacter(point.line, 0);
  const next = point.line + 1 < source.getLineStarts().length ? source.getLineStarts()[point.line + 1] : source.text.length;
  return { file: source.fileName, line: point.line + 1, column: point.character + 1,
    text: source.text.slice(lineStart, next).replace(/[\r\n]+$/, '').slice(0, 260) };
}

function surroundingSymbol(source, start) {
  let found = source;
  const descend = node => {
    if (start < node.getFullStart() || start >= node.getEnd()) return;
    found = node;
    ts.forEachChild(node, descend);
  };
  descend(source);
  let caller = null;
  let call = false;
  let imported = false;
  for (let node = found; node; node = node.parent) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) call = true;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) imported = true;
    if (!caller && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
      || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
      caller = node.name?.getText(source) ?? (node.parent && ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : '<anonymous>');
    }
  }
  return { caller, call, imported };
}

function run({ action, file, line, column, newName, root }) {
  if (!['definition', 'references', 'diagnostics', 'impact', 'rename'].includes(action)) throw new Error('Unknown semantic action.');
  if (!extensions.includes(path.extname(file).toLowerCase())) throw new Error('Semantic navigation currently supports JavaScript and TypeScript files.');
  if (!permitted(file, root) || !inside(root, file)) throw new Error('Source file is outside the open project.');
  const system = safeSystem(root);
  const description = projectDescription(file, root, system);
  const service = languageService(description, root, system);
  const program = service.getProgram();
  const source = program?.getSourceFile(file);
  if (!source) throw new Error('TypeScript could not load this file in its project.');
  const context = { engine: 'typescript_language_service', project: description.configPath ?? root, action, file,
    warnings: description.warnings };
  if (action === 'diagnostics') {
    const diagnostics = [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)];
    const results = diagnostics.slice(0, 60).map(item => {
      const point = item.file?.getLineAndCharacterOfPosition(item.start ?? 0) ?? { line: 0, character: 0 };
      return { file, line: point.line + 1, column: point.character + 1, code: item.code,
        severity: ts.DiagnosticCategory[item.category]?.toLowerCase() ?? 'error',
        message: ts.flattenDiagnosticMessageText(item.messageText, ' ').slice(0, 500) };
    });
    return { ...context, results, truncated: diagnostics.length > results.length };
  }
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
    throw new Error('Definition and references need positive 1-based line and column.');
  }
  const starts = source.getLineStarts();
  if (line > starts.length) throw new Error('Line is outside the file.');
  const lineEnd = line < starts.length ? starts[line] : source.text.length;
  const offset = starts[line - 1] + column - 1;
  if (offset >= lineEnd) throw new Error('Column is outside the line.');
  if (action === 'rename') {
    return renameLocations({ ts, service, program, file, offset, newName, root, permitted, inside });
  }
  if (action === 'impact') {
    const definitions = (service.getDefinitionAtPosition(file, offset) ?? []).map(entry =>
      location(program.getSourceFile(entry.fileName), entry.textSpan.start, root)).filter(Boolean).slice(0, 20);
    const entries = service.getReferencesAtPosition(file, offset) ?? [];
    const references = [];
    const callers = [];
    const imports = [];
    const counts = new Map();
    for (const entry of entries) {
      const target = program.getSourceFile(entry.fileName);
      const place = location(target, entry.textSpan.start, root);
      if (!place) continue;
      const context = surroundingSymbol(target, entry.textSpan.start);
      counts.set(place.file, (counts.get(place.file) ?? 0) + 1);
      if (references.length < 80) references.push({ ...place, definition: Boolean(entry.isDefinition), usage: context.imported ? 'import' : context.call ? 'call' : 'reference' });
      if (context.imported && imports.length < 40) imports.push(place);
      if (context.call && callers.length < 40) callers.push({ ...place, enclosingSymbol: context.caller });
    }
    return { ...context, query: { line, column }, confidence: 'compiler_resolved', definitions, references, callers, imports,
      affectedFiles: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([file, references]) => ({ file, references })),
      omittedResults: Math.max(0, entries.length - references.length), truncated: entries.length > references.length };
  }
  const entries = action === 'definition'
    ? (service.getDefinitionAtPosition(file, offset) ?? [])
    : (service.getReferencesAtPosition(file, offset) ?? []);
  const results = [];
  for (const entry of entries) {
    const target = program.getSourceFile(entry.fileName);
    const found = location(target, entry.textSpan.start, root);
    if (found) results.push({ ...found, ...(entry.isDefinition ? { definition: true } : {}) });
    if (results.length >= 80) break;
  }
  return { ...context, query: { line, column }, results,
    omittedResults: entries.length - results.length, truncated: entries.length > results.length };
}

parentPort.on('message', ({ id, input }) => {
  try { parentPort.postMessage({ id, result: run(input) }); }
  catch (error) { parentPort.postMessage({ id, error: error instanceof Error ? error.message : 'Semantic analysis failed.' }); }
});
