const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { diffLines } = require('diff');

const limit = 24 * 1024 * 1024;
const idPattern = /^[\w-]{1,100}$/;
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

function mergeEntries(earlier, latest) {
  const combined = new Map(earlier.map(entry => [entry.path, entry]));
  for (const entry of latest) {
    const previous = combined.get(entry.path);
    if (!previous) { combined.set(entry.path, entry); continue; }
    if (entry.directory) {
      if (previous.kind !== entry.kind) combined.delete(entry.path);
      else combined.set(entry.path, entry);
      continue;
    }
    if (previous.diffAvailable === false || entry.diffAvailable === false) {
      if (Object.hasOwn(previous, 'beforeHash') && previous.beforeHash === entry.afterHash) { combined.delete(entry.path); continue; }
      combined.set(entry.path, { ...entry, before: undefined, after: undefined, diffAvailable: false,
        beforeHash: previous.beforeHash, beforeExists: previous.beforeExists,
        added: previous.added + entry.added, deleted: previous.deleted + entry.deleted,
        kind: entry.kind === 'deleted' ? 'deleted' : previous.kind === 'created' ? 'created' : 'modified' });
      continue;
    }
    const before = previous.before;
    const after = entry.after;
    if (before === after) { combined.delete(entry.path); continue; }
    const binary = previous.binary || entry.binary;
    let added = 0;
    let deleted = 0;
    if (!binary && previous.diffAvailable !== false) {
      for (const part of diffLines(before === null ? '' : Buffer.from(before, 'base64').toString('utf8'),
        after === null ? '' : Buffer.from(after, 'base64').toString('utf8'))) {
        if (part.added) added += part.count ?? 0;
        if (part.removed) deleted += part.count ?? 0;
      }
    } else { added = previous.added + entry.added; deleted = previous.deleted + entry.deleted; }
    combined.set(entry.path, { ...entry, before, after, binary, added, deleted,
      kind: before === null ? 'created' : after === null ? 'deleted' : 'modified',
      diffAvailable: previous.diffAvailable !== false && !binary });
  }
  return [...combined.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function createTurnReportStore(app) {
  const base = path.join(app.getPath('userData'), 'agent-turn-reports');
  fs.mkdirSync(base, { recursive: true });
  function file(taskId, requestId) {
    if (![taskId, requestId].every(value => typeof value === 'string' && idPattern.test(value))) throw new Error('Invalid turn report ID.');
    return path.join(base, `${taskId}--${requestId}.json.gz`);
  }
  function publicReport(data) {
    return { changes: data.entries.map(({ before, after, ...entry }) => entry), recordedAt: data.recordedAt,
      comparisonsLimited: data.comparisonsLimited === true, verification: data.verification ?? null };
  }
  async function write(taskId, requestId, entries, verification = null, merge = false) {
    const target = file(taskId, requestId);
    const earlier = merge ? await read(taskId, requestId) : null;
    const combined = earlier?.entries ? mergeEntries(earlier.entries, entries) : entries;
    const data = { recordedAt: Date.now(), comparisonsLimited: earlier?.comparisonsLimited === true || combined.some(entry => !entry.directory && !entry.binary && entry.diffAvailable === false),
      verification: verification ?? earlier?.verification ?? null, entries: combined.map(entry => ({
      ...entry, diffAvailable: entry.diffAvailable !== false && !entry.directory && !entry.binary,
    })) };
    let compressed = await gzip(Buffer.from(JSON.stringify(data)));
    if (compressed.length > limit) {
      data.comparisonsLimited = true;
      data.entries = data.entries.map(({ before, after, ...entry }) => ({ ...entry, diffAvailable: false }));
      compressed = await gzip(Buffer.from(JSON.stringify(data)));
    }
    if (compressed.length > limit) throw new Error('Turn report is too large to save.');
    const temporary = `${target}.tmp`;
    await fs.promises.writeFile(temporary, compressed);
    await fs.promises.rename(temporary, target);
    return publicReport(data);
  }
  async function read(taskId, requestId) {
    try { return JSON.parse((await gunzip(await fs.promises.readFile(file(taskId, requestId)), { maxOutputLength: 120_000_000 })).toString('utf8')); }
    catch { return null; }
  }
  async function report(taskId, requestId) {
    const data = await read(taskId, requestId);
    return data?.entries ? publicReport(data) : null;
  }
  async function diff(taskId, requestId, selected) {
    const data = await read(taskId, requestId);
    const entry = data?.entries?.find(item => item.path === selected);
    if (!entry) throw new Error('File is not in this turn report.');
    if (entry.directory) return { path: selected, before: null, after: null, binary: false, directory: true };
    if (!entry.diffAvailable) return { path: selected, before: null, after: null, binary: entry.binary, unavailable: !entry.binary };
    return { path: selected, before: entry.before === null ? null : Buffer.from(entry.before, 'base64').toString('utf8'),
      after: entry.after === null ? null : Buffer.from(entry.after, 'base64').toString('utf8'), binary: false };
  }
  function forget(taskId) {
    if (typeof taskId !== 'string' || !idPattern.test(taskId)) throw new Error('Invalid task ID.');
    for (const name of fs.readdirSync(base)) {
      if (!name.startsWith(`${taskId}--`) || !name.endsWith('.json.gz')) continue;
      try { fs.unlinkSync(path.join(base, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return { write, report, diff, forget };
}

function createTurnReportCheckpoint({ reports, changes, taskId, requestId, baseline, resume = false }) {
  let pending = Promise.resolve();
  let initialized = false;
  function enqueue(operation) {
    const current = pending.then(operation);
    pending = current.catch(() => {});
    return current;
  }
  function begin() {
    if (initialized) return pending;
    initialized = true;
    return enqueue(async () => {
      if (resume && await reports.report(taskId, requestId)) return;
      await reports.write(taskId, requestId, [], null, false);
    });
  }
  function checkpoint(verification = null) {
    const entries = changes.turnDelta(taskId, baseline);
    if (!initialized) initialized = true;
    return enqueue(async () => {
      if (resume && !(await reports.report(taskId, requestId))) await reports.write(taskId, requestId, [], null, false);
      return reports.write(taskId, requestId, entries, verification, true);
    });
  }
  return { begin, checkpoint, flush: () => pending };
}

module.exports = { createTurnReportStore, createTurnReportCheckpoint };
