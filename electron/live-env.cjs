const fs = require('node:fs');
const path = require('node:path');

function loadLiveEnv(projectRoot) {
  let contents;
  try { contents = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(GEMINI_API_KEY_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const name = match[1];
    if (process.env[name]?.trim()) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.trim()) process.env[name] = value.trim();
  }
}

module.exports = { loadLiveEnv };
