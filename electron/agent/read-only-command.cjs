// Conservative observation recognition. Unknown commands retain ordinary write
// tracking/approval; they are never labelled read-only based on a model claim.
function isDiagnosisOnly(value) {
  const text = String(value ?? '').replace(/```[\s\S]*?(?:```|$)/g, '');
  // A scoped preservation instruction ("do not change the API") does not ban
  // all editing. Detect whole-task diagnosis directives, not quoted source.
  return /\b(?:do\s+not|don['’]?t|dont|no)\s+(?:edit|modify|change|write|implement|code)(?:\s+(?:anything|any\s+files?|(?:the\s+)?(?:files?|code|source|project)|at\s+all))?(?=\s*(?:[.,;!?]|$|(?:and\s+)?(?:just|only|instead)\b))|\b(?:diagnosis|diagnose|inspection)\s+only\b|\bread[- ]only\s+(?:diagnosis|inspection|review|audit|task|request)\b|^\s*read[- ]only\b/i.test(text);
}
function isReadOnlyCommand(value) {
  const command = String(value ?? '').trim();
  if (!command || /[\r\n`$%!<>&{}()]/.test(command)) return false;
  // Split only outside literal quoted arguments. Reject unterminated quotes and
  // shell substitution, including Unix backslash escapes of separators.
  const segments = []; let quote = '', start = 0;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === ';' || char === '|') { if (command[i - 1] === '\\') return false; segments.push(command.slice(start, i).trim()); start = i + 1; }
  }
  if (quote) return false;
  segments.push(command.slice(start).trim());
  const allowed = /^(?:Get-Content|Get-ChildItem|Get-Item|Get-ItemProperty|Test-Path|Resolve-Path|Get-Location|Get-Process|Get-CimInstance|Get-Counter|Select-Object|Measure-Object|Sort-Object|Format-Table|Format-List|pwd|ls|dir|cat|type|head|tail|wc|where\.exe|rg)$/i;
  return segments.every(segment => {
    const match = /^([\w.-]+)(?:\s+(.*))?$/.exec(segment);
    if (!match || !allowed.test(match[1])) return false;
    // Select-Object calculated properties / rg preprocessors execute code.
    if (/--pre(?:\b|-)|--config\b|-(?:ExpandProperty|Property)\s+["']?\s*[@{]/i.test(match[2] ?? '')) return false;
    return true;
  });
}
module.exports = { isDiagnosisOnly, isReadOnlyCommand };
