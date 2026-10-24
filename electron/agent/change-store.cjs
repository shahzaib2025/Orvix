const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { diffLines } = require('diff');
const { pipeline } = require('node:stream/promises');
const { isHiddenPath } = require('./file-policy.cjs');
const { canonicalTarget } = require('./workspace-manager.cjs');

const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'release', 'coverage', 'target', '.next', '.cache']);
const maxFile = 1024 * 1024;
const maxFiles = 6000;
const maxDirectories = 3000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const textFile = value => !value.includes(0);
const existsBefore = record => record.beforeExists ?? record.before !== null;
const existsAfter = record => record.afterExists ?? record.after !== null;
const contentOf = record => Buffer.isBuffer(record) ? record : record?.content ?? null;
const hashOf = record => Buffer.isBuffer(record) ? hash(record) : record?.hash ?? null;
const stamp = stat => `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.birthtimeNs}`;
function fileHash(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const digest = crypto.createHash('sha256'), chunk = Buffer.allocUnsafe(64 * 1024);
    let size;
    while ((size = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) digest.update(chunk.subarray(0, size));
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}

async function readSnapshot(file, stat, contentDirectory) {
  if (stat.size <= BigInt(maxFile)) {
    const content = await fs.promises.readFile(file);
    return { content, hash: hash(content), binary: !textFile(content), signature: stamp(stat) };
  }
  // Keep large assets recoverable on disk rather than retaining their bytes in RAM/manifests.
  await fs.promises.mkdir(contentDirectory, { recursive: true });
  const temporary = path.join(contentDirectory, `${crypto.randomUUID()}.tmp`);
  const digest = crypto.createHash('sha256');
  let binary = false;
  try {
    await pipeline(fs.createReadStream(file), async function* (source) {
      for await (const chunk of source) { digest.update(chunk); binary ||= !textFile(chunk); yield chunk; }
    }, fs.createWriteStream(temporary));
    const checksum = digest.digest('hex');
    const target = path.join(contentDirectory, `${checksum}.bin`);
    if (fs.existsSync(target)) await fs.promises.unlink(temporary);
    else await fs.promises.rename(temporary, target);
    return { content: null, snapshot: checksum, hash: checksum, binary, signature: stamp(stat) };
  } finally { await fs.promises.unlink(temporary).catch(() => {}); }
}

function lineCounts(before, after) {
  if (before === after) return { added: 0, deleted: 0 };
  const result = { added: 0, deleted: 0 };
  for (const part of diffLines(before, after)) {
    if (part.added) result.added += part.count ?? 0;
    if (part.removed) result.deleted += part.count ?? 0;
  }
  return result;
}

async function snapshot(root, previous, contentDirectory) {
  const files = new Map();
  const directories = new Set();
  const queue = [root];
  let visited = 0;
  let incomplete = false, contentReads = 0, reusedFiles = 0;
  const preserve = directory => {
    const within = file => file === directory || file.startsWith(directory + path.sep);
    for (const [file, record] of previous?.files ?? []) if (within(file) && !files.has(file)) files.set(file, record);
    for (const file of previous?.directories ?? []) if (within(file)) directories.add(file);
  };
  while (queue.length && files.size < maxFiles && visited++ < maxDirectories) {
    const directory = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') { incomplete = true; preserve(directory); } continue; }
    const pending = [];
    for (const entry of entries) {
      if (files.size >= maxFiles) break;
      if (ignored.has(entry.name) || isHiddenPath(path.join(directory, entry.name))) continue;
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) { directories.add(name); queue.push(name); }
      else if (entry.isFile()) {
        pending.push(name);
      }
    }
    // Bound concurrent I/O on small PCs. Reuse bytes and hashes when file metadata is unchanged.
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (index < pending.length && files.size < maxFiles) {
        const name = pending[index++], old = previous?.files.get(name);
        try {
          const stat = await fs.promises.stat(name, { bigint: true });
          if (old?.signature === stamp(stat)) { files.set(name, old); reusedFiles++; continue; }
          const record = await readSnapshot(name, stat, contentDirectory); contentReads++;
          const after = await fs.promises.stat(name, { bigint: true });
          if (stamp(after) !== stamp(stat)) {
            incomplete = true; if (old) files.set(name, old); continue;
          }
          files.set(name, record);
        } catch (error) {
          if (error.code !== 'ENOENT') { incomplete = true; if (old) files.set(name, old); }
        }
      }
    }));
  }
  const truncated = queue.length > 0 || files.size >= maxFiles;
  // A bounded/failed scan is never evidence that an unvisited file was deleted.
  if (truncated) preserve(root);
  return { files, directories, truncated, skippedLarge: false, incomplete, contentReads, reusedFiles };
}

function createChangeStore(app) {
  const base = path.join(app.getPath('userData'), 'agent-changes');
  fs.mkdirSync(base, { recursive: true });
  const live = new Map();
  const listingCache = new Map();
  const scans = new Map();
  const registrations = new Map();
  function manifestPath(taskId) {
    if (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('Invalid task ID.');
    return path.join(base, `${taskId}.json`);
  }
  function load(taskId) {
    try { return JSON.parse(fs.readFileSync(manifestPath(taskId), 'utf8')); }
    catch { return { taskId, files: {}, directories: {} }; }
  }
  function contentDirectory(taskId) { return manifestPath(taskId).replace(/\.json$/, '.content'); }
  function snapshotFile(taskId, checksum) {
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Invalid change snapshot.');
    return path.join(contentDirectory(taskId), `${checksum}.bin`);
  }
  function save(taskId, data) {
    const target = manifestPath(taskId);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data));
    fs.renameSync(temporary, target);
  }
  const encodeBaseline = record => record ? { ...record, content: record.content?.toString('base64') ?? null } : null;
  const decodeBaseline = record => record ? { ...record, content: record.content == null ? null : Buffer.from(record.content, 'base64') } : null;
  function stateFor(taskId) {
    let state = live.get(taskId);
    if (!state) {
      state = { roots: new Map(), scoped: new Map(Object.entries(load(taskId).scopedBaselines ?? {}).map(([file, record]) => [file, decodeBaseline(record)])) };
      live.set(taskId, state);
    }
    return state;
  }
  async function scopedSnapshot(file, previous, taskId) {
    try {
      const stat = await fs.promises.stat(file, { bigint: true });
      if (!stat.isFile()) throw new Error('File-scoped tracking requires a regular file.');
      if (previous?.signature === stamp(stat)) return previous;
      const record = await readSnapshot(file, stat, contentDirectory(taskId));
      if (stamp(await fs.promises.stat(file, { bigint: true })) !== stamp(stat)) throw new Error('The file changed during its baseline capture. Retry this file after it settles.');
      return record;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function registerFilesNow(taskId, targets) {
    const state = stateFor(taskId), additions = {};
    for (const target of targets) {
      const file = canonicalTarget(path.resolve(target));
      if (isHiddenPath(file)) throw new Error('Protected or excluded files cannot be tracked as write targets.');
      if (state.scoped.has(file)) continue;
      if ([...state.roots].some(([root]) => file === root || file.startsWith(root + path.sep))) continue;
      const record = await scopedSnapshot(file, null, taskId);
      state.scoped.set(file, record); additions[file] = encodeBaseline(record);
    }
    const data = load(taskId); data.scopedBaselines ??= {};
    Object.assign(data.scopedBaselines, additions);
    if (!Object.keys(additions).length) return;
    save(taskId, data);
  }
  async function registerFiles(taskId, targets) {
    const key = `${taskId}\0files`;
    const job = (registrations.get(key) ?? Promise.resolve()).catch(() => {}).then(() => registerFilesNow(taskId, targets));
    registrations.set(key, job);
    try { await job; } finally { if (registrations.get(key) === job) registrations.delete(key); }
  }
  async function register(taskId, directory) {
    const root = await fs.promises.realpath(directory);
    if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('Not a directory.');
    const state = stateFor(taskId);
    if (!state.roots.has(root)) {
      const key = `${taskId}\0${root}`;
      if (!registrations.has(key)) registrations.set(key, (async () => {
        const baseline = await snapshot(root, null, contentDirectory(taskId));
        if (baseline.truncated || baseline.incomplete) throw new Error('This directory cannot be tracked completely. Use a narrower readable folder.');
        state.roots.set(root, baseline);
      })());
      try { await registrations.get(key); } finally { registrations.delete(key); }
    }
    return { root, skippedLarge: false };
  }
  function applyRecord(data, file, before, after) {
    if (hashOf(before) === hashOf(after)) return;
    const previous = data.files[file];
    const firstHash = previous ? previous.beforeHash : hashOf(before);
    const first = previous ? previous.before == null ? null : Buffer.from(previous.before, 'base64') : contentOf(before);
    const firstExists = previous ? existsBefore(previous) : Boolean(before);
    const current = contentOf(after);
    if (firstHash === hashOf(after)) delete data.files[file];
    else {
      const binary = Boolean(previous?.binary || before?.binary || after?.binary || (first && !textFile(first)) || (current && !textFile(current)));
      const diffAvailable = !binary && (!firstExists || first !== null) && (!after || current !== null);
      const counts = diffAvailable ? lineCounts(first?.toString('utf8') ?? '', current?.toString('utf8') ?? '') : { added: 0, deleted: 0 };
      data.files[file] = { before: first ? first.toString('base64') : firstExists ? undefined : null,
        after: current ? current.toString('base64') : after ? undefined : null,
        beforeExists: firstExists, afterExists: Boolean(after),
        beforeSnapshot: previous ? previous.beforeSnapshot : before?.snapshot, afterSnapshot: after?.snapshot,
        beforeHash: firstHash, afterHash: hashOf(after), diffAvailable,
        binary, ...counts, updatedAt: Date.now() };
    }
  }
  async function scanNow(taskId, retry = true) {
    const state = live.get(taskId) ?? (Object.keys(load(taskId).scopedBaselines ?? {}).length ? stateFor(taskId) : null);
    if (!state) return;
    const startingRevision = fingerprintRevision(taskId);
    const snapshots = [];
    let changed = false;
    let truncated = false;
    let incomplete = false, contentReads = 0, reusedFiles = 0;
    for (const [root, baseline] of state.roots) {
      const previous = { ...baseline, files: new Map(baseline.files), directories: new Set(baseline.directories) };
      const current = await snapshot(root, previous, contentDirectory(taskId));
      if (current.truncated) truncated = true;
      incomplete ||= current.incomplete;
      contentReads += current.contentReads; reusedFiles += current.reusedFiles;
      snapshots.push({ root, previous, current });
    }
    for (const [file, before] of state.scoped ?? []) {
      try {
        const after = await scopedSnapshot(file, before, taskId);
        snapshots.push({ file, before, after });
      } catch { incomplete = true; }
    }
    // A synchronous edit/restore can update the manifest while scanning awaits disk I/O.
    // Never overwrite that newer record with an older observation.
    if (live.get(taskId) !== state) return { truncated, skippedLarge: false, incomplete: true, contentReads, reusedFiles };
    if (startingRevision !== fingerprintRevision(taskId)) {
      return retry ? scanNow(taskId, false) : { truncated, skippedLarge: false, incomplete: true, contentReads, reusedFiles };
    }
    const data = load(taskId); data.directories ??= {};
    data.scopedBaselines ??= {}; let baselineChanged = false;
    for (const observation of snapshots) {
      if (observation.file) {
        const { file, before, after } = observation;
        if (hashOf(before) !== hashOf(after)) { applyRecord(data, file, before, after); changed = true; }
        const persisted = data.scopedBaselines[file];
        baselineChanged ||= (persisted?.hash ?? null) !== (after?.hash ?? null) || (persisted?.signature ?? null) !== (after?.signature ?? null);
        state.scoped.set(file, after); data.scopedBaselines[file] = encodeBaseline(after);
        continue;
      }
      const { root, previous, current } = observation;
      for (const file of new Set([...previous.files.keys(), ...current.files.keys()])) {
        const before = previous.files.get(file) ?? null;
        const after = current.files.get(file) ?? null;
        if (hashOf(before) === hashOf(after)) continue;
        applyRecord(data, file, before, after);
        changed = true;
      }
      for (const directory of new Set([...previous.directories, ...current.directories])) {
        const before = previous.directories.has(directory);
        const after = current.directories.has(directory);
        if (before === after) continue;
        const first = data.directories[directory]?.before ?? before;
        if (first === after) delete data.directories[directory];
        else data.directories[directory] = { before: first, after };
        changed = true;
      }
      state.roots.set(root, current);
    }
    if (changed || baselineChanged) save(taskId, data);
    return { truncated, skippedLarge: false, incomplete, contentReads, reusedFiles };
  }
  function scan(taskId) {
    if (scans.has(taskId)) return scans.get(taskId);
    const running = scanNow(taskId).finally(() => { if (scans.get(taskId) === running) scans.delete(taskId); });
    scans.set(taskId, running); return running;
  }
  function updateBaseline(taskId, file, content) {
    const state = live.get(taskId);
    if (state?.scoped?.has(file)) state.scoped.set(file, content ? Buffer.isBuffer(content)
      ? { content, hash: hash(content), binary: !textFile(content), signature: null } : content : null);
    for (const [root, baseline] of live.get(taskId)?.roots ?? []) {
      const relative = path.relative(root, file);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) continue;
      if (content) baseline.files.set(file, Buffer.isBuffer(content)
        ? { content, hash: hash(content), binary: !textFile(content), signature: null } : content);
      else baseline.files.delete(file);
    }
  }
  function markFile(taskId, file, before, after) {
    const data = load(taskId);
    applyRecord(data, file, before, after);
    save(taskId, data);
    updateBaseline(taskId, file, after);
  }
  function markBatch(taskId, files, directories) {
    const data = load(taskId);
    data.directories ??= {};
    for (const item of files) applyRecord(data, item.file, item.before, item.after);
    for (const directory of directories) {
      const first = data.directories[directory]?.before ?? false;
      if (first) delete data.directories[directory];
      else data.directories[directory] = { before: false, after: true };
    }
    save(taskId, data);
    for (const item of files) updateBaseline(taskId, item.file, item.after);
    for (const baseline of live.get(taskId)?.roots.values() ?? []) {
      for (const directory of directories) baseline.directories.add(directory);
    }
  }
  function markDirectory(taskId, directory, before, after) {
    const data = load(taskId);
    data.directories ??= {};
    const first = data.directories[directory]?.before ?? before;
    if (first === after) delete data.directories[directory];
    else data.directories[directory] = { before: first, after };
    save(taskId, data);
  }
  function list(taskId) {
    const revision = fingerprintRevision(taskId);
    const cached = listingCache.get(taskId);
    if (cached?.revision === revision) return cached.rows.map(row => ({ ...row }));
    const data = load(taskId);
    const files = Object.entries(data.files).map(([file, value]) => {
      return { path: file, folder: path.dirname(file), kind: !existsBefore(value) ? 'created' : !existsAfter(value) ? 'deleted' : 'modified',
        binary: value.binary, diffAvailable: value.diffAvailable !== false && !value.binary, added: value.added ?? 0, deleted: value.deleted ?? 0 };
    });
    const directories = Object.entries(data.directories ?? {}).map(([directory, value]) => ({
      path: directory, folder: path.dirname(directory), kind: value.before ? 'deleted' : 'created', directory: true,
      binary: false, added: 0, deleted: 0,
    }));
    const rows = [...directories, ...files].sort((a, b) => a.path.localeCompare(b.path));
    listingCache.set(taskId, { revision, rows });
    return rows.map(row => ({ ...row }));
  }
  function capture(taskId) { return load(taskId); }
  function fingerprintRevision(taskId) {
    try { const stat = fs.statSync(manifestPath(taskId), { bigint: true }); return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.birthtimeNs}`; }
    catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
  }
  function turnDelta(taskId, baseline) {
    const current = load(taskId);
    const entries = [];
    for (const file of new Set([...Object.keys(baseline.files ?? {}), ...Object.keys(current.files ?? {})])) {
      const prior = baseline.files?.[file];
      const latest = current.files?.[file];
      const before = prior ? prior.after : latest?.before ?? null;
      const after = latest ? latest.after : prior?.before ?? null;
      const beforeExists = prior ? existsAfter(prior) : latest ? existsBefore(latest) : false;
      const afterExists = latest ? existsAfter(latest) : prior ? existsBefore(prior) : false;
      const beforeHash = prior ? prior.afterHash : latest?.beforeHash ?? null;
      const afterHash = latest ? latest.afterHash : prior?.beforeHash ?? null;
      if (beforeHash === afterHash) continue;
      const beforeBuffer = before == null ? null : Buffer.from(before, 'base64');
      const afterBuffer = after == null ? null : Buffer.from(after, 'base64');
      const binary = Boolean(prior?.binary || latest?.binary || (beforeBuffer && !textFile(beforeBuffer)) || (afterBuffer && !textFile(afterBuffer)));
      const diffAvailable = !binary && (!beforeExists || beforeBuffer !== null) && (!afterExists || afterBuffer !== null);
      const counts = diffAvailable ? lineCounts(beforeBuffer?.toString('utf8') ?? '', afterBuffer?.toString('utf8') ?? '') : { added: 0, deleted: 0 };
      entries.push({ path: file, folder: path.dirname(file), kind: !beforeExists ? 'created' : !afterExists ? 'deleted' : 'modified',
        binary, diffAvailable, ...counts, before, after, beforeExists, afterExists, beforeHash, afterHash });
    }
    for (const directory of new Set([...Object.keys(baseline.directories ?? {}), ...Object.keys(current.directories ?? {})])) {
      const prior = baseline.directories?.[directory];
      const latest = current.directories?.[directory];
      const before = prior ? prior.after : latest?.before ?? false;
      const after = latest ? latest.after : prior?.before ?? false;
      if (before === after) continue;
      entries.push({ path: directory, folder: path.dirname(directory), kind: after ? 'created' : 'deleted',
        directory: true, binary: false, added: 0, deleted: 0, before: null, after: null });
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }
  function diff(taskId, file) {
    const data = load(taskId);
    if (data.directories?.[file]) return { path: file, before: null, after: null, binary: false, directory: true };
    const value = data.files[file];
    if (!value) throw new Error('This file is not in the task changes.');
    if (value.diffAvailable === false) return { path: file, before: null, after: null, binary: value.binary, unavailable: !value.binary };
    return { path: file, before: value.before === null ? null : Buffer.from(value.before, 'base64').toString('utf8'),
      after: value.after === null ? null : Buffer.from(value.after, 'base64').toString('utf8'), binary: value.binary };
  }
  function restore(taskId, file) {
    const data = load(taskId);
    if (data.directories?.[file]) {
      const value = data.directories[file];
      if (value.before) fs.mkdirSync(file, { recursive: true });
      else fs.rmdirSync(file);
      delete data.directories[file];
      save(taskId, data);
      return list(taskId);
    }
    const value = data.files[file];
    if (!value) throw new Error('This file is not in the task changes.');
    if (fileHash(file) !== value.afterHash) throw new Error('This file changed after the agent edit. Review it before restoring.');
    if (!existsBefore(value)) fs.unlinkSync(file);
    else {
      const source = value.beforeSnapshot ? snapshotFile(taskId, value.beforeSnapshot) : null;
      if (source && fileHash(source) !== value.beforeHash) throw new Error('The saved file snapshot is unavailable or damaged.');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (source) fs.copyFileSync(source, file);
      else fs.writeFileSync(file, Buffer.from(value.before, 'base64'));
    }
    updateBaseline(taskId, file, !existsBefore(value) ? null : value.beforeSnapshot
      ? { content: null, snapshot: value.beforeSnapshot, hash: value.beforeHash, binary: value.binary, signature: null }
      : Buffer.from(value.before, 'base64'));
    delete data.files[file];
    save(taskId, data);
    return list(taskId);
  }
  function restoreAll(taskId) {
    const data = load(taskId);
    const files = Object.keys(data.files);
    for (const file of files) {
      const value = data.files[file];
      if (fileHash(file) !== value.afterHash) throw new Error(`${file} changed after the agent edit. No files were restored.`);
      if (value.beforeSnapshot && fileHash(snapshotFile(taskId, value.beforeSnapshot)) !== value.beforeHash) throw new Error('The saved file snapshot is unavailable or damaged. No files were restored.');
    }
    for (const file of files.reverse()) restore(taskId, file);
    for (const directory of Object.keys(data.directories ?? {}).sort((a, b) => b.length - a.length)) restore(taskId, directory);
    return list(taskId);
  }
  function forget(taskId) { live.delete(taskId); listingCache.delete(taskId); try { fs.unlinkSync(manifestPath(taskId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.rmSync(contentDirectory(taskId), { recursive: true, force: true }); }
  function stop(taskId) {
    live.delete(taskId);
    // Retain only recovery snapshots referenced by saved changes after the task ends.
    if (scans.has(taskId) || [...registrations.keys()].some(key => key.startsWith(taskId + '\0'))) return;
    const saved = load(taskId);
    const keep = new Set([...Object.values(saved.files).flatMap(record => [record.beforeSnapshot, record.afterSnapshot]),
      ...Object.values(saved.scopedBaselines ?? {}).map(record => record?.snapshot)].filter(Boolean));
    try {
      const directory = contentDirectory(taskId);
      for (const name of fs.readdirSync(directory)) {
        if (/^[a-f0-9]{64}\.bin$/.test(name) && !keep.has(name.slice(0, -4))) fs.unlinkSync(path.join(directory, name));
      }
    } catch { /* Cleanup must not hide the task result; recovery snapshots remain intact. */ }
  }
  return { register, registerFiles, scan, markFile, markBatch, markDirectory, list, capture, fingerprintRevision, turnDelta, diff, restore, restoreAll, forget, stop };
}

module.exports = { createChangeStore };
