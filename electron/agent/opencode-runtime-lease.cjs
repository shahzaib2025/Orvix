const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

// Only the local server's authentication is persisted, encrypted with the OS.
// Provider keys are never stored here. This prevents spawning a second worker
// against the same database when an app crash leaves its owned server alive.
function createRuntimeLease(root, { safeStorage } = {}) {
  const file = path.join(root, 'runtime-owner.json');
  let storage = safeStorage;
  if (!storage) try { storage = require('electron').safeStorage; } catch { /* Node-only tooling has no OS credential bridge. */ }
  function read() {
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isInteger(record.pid) || record.pid <= 0 || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535
        || typeof record.owner !== 'string') throw new Error('Invalid native runtime ownership record.');
      return record;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
  }
  function clear(owner) {
    if (read()?.owner !== owner) return;
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  function save(pid, port, authorization, executable) {
    const owner = crypto.randomUUID();
    const auth = storage?.isEncryptionAvailable() ? storage.encryptString(authorization).toString('base64') : null;
    const record = { pid, parentPid: process.pid, port, owner, auth, executable, createdAt: Date.now() };
    fs.mkdirSync(root, { recursive: true });
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temporary, file);
    return record;
  }
  async function reconnect(fetchRequest, signal) {
    const record = read();
    if (!record) return null;
    if (!alive(record.pid)) { clear(record.owner); return null; }
    if (!record.auth || !storage?.isEncryptionAvailable()) { clear(record.owner); return null; }
    let authorization;
    try {
      authorization = storage.decryptString(Buffer.from(record.auth, 'base64'));
    } catch {
      clear(record.owner);
      return null;
    }
    const url = `http://127.0.0.1:${record.port}`;
    let reply;
    try {
      reply = await fetchRequest(url + '/global/health', { headers: { Authorization: authorization }, signal, redirect: 'error' });
    } catch {
      clear(record.owner);
      return null;
    }
    let healthy = false;
    try {
      if (reply && reply.ok) {
        const body = await reply.json().catch(() => null);
        healthy = body?.healthy === true;
      }
    } catch {}
    if (!healthy) {
      clear(record.owner);
      return null;
    }
    if (record.parentPid && record.parentPid !== process.pid && alive(record.parentPid)) {
      throw new Error('The retained native worker still has a live owner process. No duplicate worker was started; close the other Orvix instance before reconnecting this task.');
    }
    return { ...record, authorization, url };
  }
  return { read, save, clear, reconnect };
}
module.exports = { createRuntimeLease };
