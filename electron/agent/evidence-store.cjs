const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { validId, safeValue, atomicWrite, readJson, removeOwned } = require('./durable-store.cjs');
const { redactApiKeys } = require('./api-key-check.cjs');

function createEvidenceStore(app) {
  const base = path.join(app.getPath('userData'), 'agent-evidence');
  function directory(taskId, requestId) { return path.join(base, validId(taskId), validId(requestId)); }
  function record(taskId, requestId, metadata, output) {
    const dir = directory(taskId, requestId);
    const text = redactApiKeys(String(output ?? ''));
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const blobDir = path.join(base, validId(taskId), 'blobs');
    const blob = path.join(blobDir, `${hash}.txt`);
    if (!fs.existsSync(blob)) atomicWrite(blob, text);
    const entry = safeValue({ ...metadata, id: crypto.randomUUID(), taskId, requestId, outputHash: hash,
      outputBytes: Buffer.byteLength(text), outputChars: text.length, recordedAt: Date.now() });
    atomicWrite(path.join(dir, `${entry.id}.json`), entry);
    // The journal is append-only. A damaged trailing line does not invalidate earlier records.
    fs.appendFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  }
  function metadata(taskId, requestId, id) {
    const entry = readJson(path.join(directory(taskId, requestId), `${validId(id)}.json`));
    if (!entry || entry.taskId !== taskId || entry.requestId !== requestId || !/^[a-f0-9]{64}$/.test(entry.outputHash)) throw new Error('Evidence is unavailable for this turn.');
    return entry;
  }
  function read(taskId, requestId, id, offset = 0, length = 16000) {
    const entry = metadata(taskId, requestId, id);
    const start = Number(offset);
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Use a nonnegative evidence offset.');
    const count = Math.max(1, Math.min(24000, Number(length) || 16000));
    const text = fs.readFileSync(path.join(base, taskId, 'blobs', `${entry.outputHash}.txt`), 'utf8');
    if (crypto.createHash('sha256').update(text).digest('hex') !== entry.outputHash) throw new Error('Evidence checksum mismatch.');
    return { ...entry, output: text.slice(start, start + count), offset: start,
      nextOffset: start + count < text.length ? start + count : null };
  }
  function matches(taskId, requestId, id, fragment) {
    const entry = metadata(taskId, requestId, id);
    const text = fs.readFileSync(path.join(base, taskId, 'blobs', `${entry.outputHash}.txt`), 'utf8');
    if (crypto.createHash('sha256').update(text).digest('hex') !== entry.outputHash) throw new Error('Evidence checksum mismatch.');
    return typeof fragment === 'string' && fragment.trim().length > 0 && text.includes(fragment);
  }
  async function list(taskId, requestId, offset = 0, limit = 40) {
    const target = path.join(directory(taskId, requestId), 'events.jsonl');
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const count = Math.max(1, Math.min(100, Number(limit) || 40));
    if (!fs.existsSync(target)) return { records: [], nextOffset: null, total: 0 };
    const stream = fs.createReadStream(target, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const records = []; let total = 0;
    try {
      for await (const line of lines) {
        let entry; try { entry = JSON.parse(line); } catch { continue; }
        if (entry.taskId !== taskId || entry.requestId !== requestId) continue;
        if (total >= start && records.length < count) records.push(entry);
        total++;
      }
    } finally { lines.close(); stream.destroy(); }
    return { records, total, nextOffset: start + records.length < total ? start + records.length : null };
  }
  function commandCapture(taskId, requestId, args) {
    const dir = directory(taskId, requestId);
    fs.mkdirSync(dir, { recursive: true });
    const temporary = path.join(dir, `stream-${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, 'w', 0o600);
    let pending = '', finished = false;
    function append(value) {
      if (finished) return;
      pending += String(value);
      // Retain the unfinished line: credential tokens split across chunks must be redacted together.
      const end = pending.lastIndexOf('\n');
      if (end >= 0) { fs.writeSync(fd, redactApiKeys(pending.slice(0, end + 1))); pending = pending.slice(end + 1); }
    }
    function finish(result) {
      if (finished) return null;
      finished = true;
      fs.writeSync(fd, redactApiKeys(pending)); fs.closeSync(fd);
      try {
        return record(taskId, requestId, { kind: 'command', name: 'run_command', args, ...result }, fs.readFileSync(temporary, 'utf8'));
      } finally { fs.unlinkSync(temporary); }
    }
    return { append, finish };
  }
  function forget(taskId) { removeOwned(base, path.join(base, validId(taskId))); }
  return { record, metadata, read, matches, list, commandCapture, forget };
}
module.exports = { createEvidenceStore };
