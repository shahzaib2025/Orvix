// A deliberately small PowerShell grammar for read-only browser inventories.
// It recognizes operations, not one particular output label or variable name.
const versionProbe = /\$([a-z_]\w*)\s*=\s*Get-Command\s+(node|python|npm)\s+-ErrorAction\s+SilentlyContinue\s*if\s*\(\s*\$\1\s*\)\s*\{\s*"\2:\s*\$\(\s*\2\s+(?:-v|--version)(?:\s+2>&1)?\s*\)"\s*\}\s*else\s*\{\s*"\2:\s*MISSING"\s*\}/gi;
const browserLiteral = /^(?:"|')(?:\$env:ProgramFiles|\$\{env:ProgramFiles\(x86\)\}|\$env:LOCALAPPDATA|[a-z]:[\\/]Program Files(?: \(x86\))?)[\\/](?:Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe|Microsoft[\\/]Edge[\\/]Application[\\/]msedge\.exe)(?:"|')$/i;

function isBrowserInventory(command) {
  const source = command.replace(versionProbe, '');
  const tokens = [];
  const token = /\s+|"[^"`\r\n]*"|'[^'\r\n]*'|\$[a-z_]\w*|-\w+|[a-z][\w-]*|[@(){};,=]/iy;
  let offset = 0;
  while (offset < source.length) {
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match) return false;
    if (match[0].trim()) tokens.push(match[0]);
    offset = token.lastIndex;
  }
  let i = 0;
  const take = value => tokens[i]?.toLowerCase() === value.toLowerCase() ? (++i, true) : false;
  const variable = () => /^\$[a-z_]\w*$/i.test(tokens[i] ?? '') ? tokens[i++] : null;
  const separators = () => { while (take(';')) {} };
  separators();
  const list = variable();
  if (!list || !take('=') || !take('@') || !take('(')) return false;
  let count = 0;
  do {
    const literal = tokens[i++];
    if (!browserLiteral.test(literal ?? '')) return false;
    // Single-quoted environment variables do not expand to executable paths.
    if (literal.startsWith("'") && literal.includes('$')) return false;
    count++;
    if (take(',')) { if (tokens[i] === ')') break; }
    else if (tokens[i] === ')') break;
  } while (i < tokens.length);
  if (!count || !take(')')) return false;
  separators();
  if (!take('foreach') || !take('(')) return false;
  const item = variable();
  if (!item || item.toLowerCase() === list.toLowerCase() || !take('in') || !take(list) || !take(')') || !take('{')) return false;
  const exists = () => take('Test-Path') && (take('-LiteralPath') || take('-Path')) && take(item);
  const text = () => {
    const value = tokens[i];
    if (!value || !['"', "'"].includes(value[0])) return false;
    // Only the current literal path may be interpolated; no subexpressions.
    if (value[0] === '"' && value.slice(1,-1).replace(new RegExp('\\' + item + '\\b', 'gi'), '').includes('$')) return false;
    i++; return true;
  };
  const output = () => {
    take('Write-Output');
    if (!text()) return false;
    if (!take('-f')) return true;
    return take('(') && exists() && take(')') && take(',') && take(item);
  };
  if (take('if')) {
    if (!take('(') || !exists() || !take(')') || !take('{') || !output()) return false;
    separators();
    if (!take('}')) return false;
  } else if (!output()) return false;
  separators();
  if (!take('}')) return false;
  separators();
  return i === tokens.length;
}

function maskBrowserExistenceProbes(command) {
  if (isBrowserInventory(command)) return 'Test-Path known-browser-executables';
  return command.replace(/(^|[\r\n;])\s*Test-Path\s+-(?:LiteralPath|Path)\s*("[^"`\r\n]*"|'[^'\r\n]*')\s*(?=$|[\r\n;])/gi,
    (probe, boundary, literal) => browserLiteral.test(literal) ? boundary + 'Test-Path known-browser-executable' : probe);
}

module.exports = { maskBrowserExistenceProbes };
