const path = require('node:path');
// Lexical navigation for languages without a configured compiler service.
// Candidates deliberately do not authorize a semantic rename.
function codeMask(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, value => value.replace(/[^\n]/g, ' '));
}
function parseCandidates(file, source) {
  const ext = path.extname(file).toLowerCase();
  const supported = new Set(['.go', '.rs', '.java', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp', '.kt', '.swift', '.php']);
  if (!supported.has(ext)) return { symbols: [], imports: [], calls: [], resolution: 'metadata-only', diagnostics: [] };
  const lines = codeMask(source).split(/\r?\n/), originals = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, value => value.startsWith('//') || value.startsWith('/*') ? value.replace(/[^\n]/g, ' ') : value).split(/\r?\n/), symbols = [], imports = [], calls = [];
  let goImports = false;
  const controls = new Set(['if', 'for', 'while', 'switch', 'catch', 'sizeof', 'return', 'new', 'match', 'assert']);
  lines.forEach((line, index) => {
    let match = /\b(?:class|interface|struct|enum|trait|record|typealias|object)\s+([A-Za-z_]\w*)/.exec(line);
    if (!match) match = ext === '.go' ? /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(line)
      : ext === '.rs' ? /\bfn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/.exec(line)
        : ['.kt', '.swift'].includes(ext) ? /\b(?:fun|func)\s+([A-Za-z_]\w*)\s*\(/.exec(line)
          : ext === '.php' ? /\bfunction\s+([A-Za-z_]\w*)\s*\(/.exec(line)
            : /^\s*(?:(?:public|private|protected|static|final|virtual|override|async|inline|extern|internal|const)\s+)*(?:[\w<>?*\[\],:]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:\{|;|=>|$)/.exec(line);
    if (match && !controls.has(match[1])) symbols.push({ name: match[1], kind: 'DeclarationCandidate', line: index + 1, column: line.indexOf(match[1], match.index) + 1 });
    for (const call of line.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) if (!controls.has(call[1]) && call[1] !== match?.[1]) calls.push({ name: call[1], line: index + 1, column: call.index + 1 });
    const original = originals[index];
    const imported = /^\s*#\s*include\s*"([^"]+)"/.exec(original) ?? /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/.exec(original)
      ?? /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/.exec(original);
    if (imported) imports.push({ specifier: imported[1], file: null, resolution: 'unresolved-candidate' });
    if (ext === '.go') {
      if (/^\s*import\s*\(/.test(original)) goImports = true;
      const go = (goImports ? /^\s*(?:\w+\s+)?"([^"\n]+)"/ : /^\s*import\s+(?:\w+\s+)?"([^"\n]+)"/).exec(original);
      if (go) imports.push({ specifier: go[1], file: null, resolution: 'unresolved-candidate' });
      if (/^\s*\)/.test(original)) goImports = false;
    }
  });
  return { symbols, imports, calls, resolution: 'lexical-candidates', diagnostics: ['Declarations and caller matches are lexical candidates; overloads, dynamic dispatch and cross-language resolution require inspection.'] };
}
function resolveCandidate(file, specifier, root, paths, goModule) {
  const ext = path.extname(file).toLowerCase(); let candidates = [];
  if (['.c', '.cc', '.cpp', '.h', '.hpp'].includes(ext)) candidates = [path.resolve(path.dirname(file), specifier), path.resolve(root, specifier)];
  else if (ext === '.rs') candidates = [path.resolve(path.dirname(file), specifier + '.rs'), path.resolve(path.dirname(file), specifier, 'mod.rs')];
  else if (ext === '.java') candidates = ['src/main/java', 'src/test/java', ''].map(base => path.resolve(root, base, specifier.replaceAll('.', path.sep) + '.java'));
  else if (ext === '.go' && goModule && specifier.startsWith(goModule + '/')) {
    const directory = path.resolve(root, specifier.slice(goModule.length + 1)); candidates = paths.filter(candidate => path.dirname(candidate) === directory && candidate.endsWith('.go'));
  }
  const matches = candidates.filter(candidate => paths.includes(candidate) && !path.relative(root, candidate).startsWith('..'));
  return { specifier, file: matches.length === 1 ? matches[0] : null, files: matches, resolution: matches.length ? 'static-import-candidates' : 'unresolved-candidate' };
}
module.exports = { parseCandidates, resolveCandidate };
