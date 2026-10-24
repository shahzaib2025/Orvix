const fs = require('node:fs');
const path = require('node:path');

function createOpenCodePreferences(directory) {
  const file = path.join(directory, 'opencode-preferences.json');
  function getKeepAlive() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      return saved?.keepAlive === true;
    } catch { return false; }
  }
  function setKeepAlive(value) {
    if (typeof value !== 'boolean') throw new Error('OpenCode keep-alive must be a boolean.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ keepAlive: value }), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      try { fs.unlinkSync(temporary); } catch {}
    }
    return { keepAlive: value };
  }
  return { getKeepAlive, setKeepAlive, file };
}

module.exports = { createOpenCodePreferences };
