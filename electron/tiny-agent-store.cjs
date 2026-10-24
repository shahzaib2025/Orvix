const fs = require('node:fs');
function readState(target) {
  for (const file of [target, target + '.bak']) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value?.version === 1 && Array.isArray(value.rules) && Array.isArray(value.history)) return value;
    } catch {}
  }
  return null;
}
function writeState(target, state) {
  const temp = target + '.tmp';
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // Never replace a usable recovery checkpoint with a damaged primary file.
  let previous;
  try {
    const bytes = fs.readFileSync(target, 'utf8'), parsed = JSON.parse(bytes);
    if (parsed?.version === 1 && Array.isArray(parsed.rules) && Array.isArray(parsed.history)) previous = bytes;
  } catch {}
  if (previous) {
    const backupTemp = target + '.bak.tmp', backupFd = fs.openSync(backupTemp, 'w');
    try { fs.writeFileSync(backupFd, previous); fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
    fs.renameSync(backupTemp, target + '.bak');
  }
  fs.renameSync(temp, target);
}
module.exports = { readState, writeState };
