const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Borrow only the selected provider's API credential. Never inherit a user's
// OpenCode profile or put API keys in tool-child environment variables.
function createProviderAuthLease(root, getKey) {
  if (typeof getKey !== 'function') return null;
  let active = '', fingerprint = null, revision = 0;
  const secrets = new Set(), locations = new Map();
  const authFile = path.join(root, 'data', 'opencode', 'auth.json');
  const redact = value => {
    let text = String(value);
    for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
    return text;
  };
  async function prepare(api, signal) {
    const value = getKey();
    if (typeof value !== 'string' || value.length > 1024 || /[\r\n\0]/.test(value)) throw Error('The configured native provider credential is invalid.');
    active = value.trim();
    if (active) secrets.add(active);
    const next = crypto.createHash('sha256').update(active).digest('hex');
    if (next !== fingerprint) { fingerprint = next; revision++; }
    await api('/auth/opencode', { method: active ? 'PUT' : 'DELETE', ...(active ? { body: { type: 'api', key: active } } : {}), signal });
    return { configured: !!active };
  }
  async function prepareLocation(api, directory, signal) {
    const location = path.resolve(directory);
    if (locations.get(location) === revision) return;
    // Provider SDKs are location-scoped. A changed key must not reuse a cached
    // SDK from a previous credential, but retained session history stays on disk.
    await api('/instance/dispose', { method: 'POST', directory: location, signal });
    locations.set(location, revision);
  }
  function clearPrivateFile() {
    let auth;
    try { auth = JSON.parse(fs.readFileSync(authFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!auth.opencode) return;
    if (auth.opencode.type !== 'api' || auth.opencode.key !== active) throw Error('Native provider credential ownership changed.');
    delete auth.opencode;
    if (!Object.keys(auth).length) { fs.unlinkSync(authFile); return; }
    const temporary = authFile + '.orvix-' + process.pid + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(auth), { mode: 0o600 }); fs.renameSync(temporary, authFile); }
    finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  async function clear(api) {
    try { await api('/auth/opencode', { method: 'DELETE', timeoutMs: 3000 }); }
    catch { try { clearPrivateFile(); } catch { throw Error('Native provider credential cleanup failed in its protected runtime store.'); } }
    finally { active = ''; }
  }
  return { prepare, prepareLocation, clear, redact };
}
module.exports = { createProviderAuthLease };
