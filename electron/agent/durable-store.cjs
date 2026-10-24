const fs = require('node:fs');
const path = require('node:path');
const { redactApiKeys } = require('./api-key-check.cjs');

function validId(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new Error('Invalid record ID.');
  return value;
}
function safeValue(value) {
  if (typeof value === 'string') return redactApiKeys(value);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeValue(item)]));
  return value;
}
function atomicWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, typeof value === 'string' ? value : JSON.stringify(safeValue(value)), { mode: 0o600 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, target); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 5) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
      }
    }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function readJson(target, fallback = null) {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw new Error(`Saved record cannot be read: ${path.basename(target)}`); }
}
function removeOwned(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Invalid archive path.');
  fs.rmSync(target, { recursive: true, force: true });
}
module.exports = { validId, safeValue, atomicWrite, readJson, removeOwned };
