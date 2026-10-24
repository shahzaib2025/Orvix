const fs = require('node:fs');
const path = require('node:path');

const names = new Set(['ORVIX_OPENCODE_ZEN_KEY', 'ORVIX_OPENCODE_GO_KEY', 'ORVIX_KILO_KEY']);

function loadOpenCodeEnv(projectRoot) {
  const file = path.join(projectRoot, '.env');
  let contents;
  try { contents = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*((?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY))\s*=\s*(.*?)\s*$/);
    if (!match || !names.has(match[1]) || process.env[match[1]]?.trim()) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.trim()) process.env[match[1]] = value.trim();
  }
}

module.exports = { loadOpenCodeEnv };
