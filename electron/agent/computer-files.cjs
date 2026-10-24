const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { canonicalTarget, protectedPath } = require('./workspace-manager.cjs');
const { isSensitiveFile, credentialDirectories } = require('./file-policy.cjs');
const metadataProtectedPath = value => value.split(path.sep).some(part => credentialDirectories.has(part.toLowerCase()));
function storagePath(value) {
  const resolved = canonicalTarget(value);
  if (metadataProtectedPath(value) || metadataProtectedPath(resolved) || isSensitiveFile(resolved)) throw new Error('Credential locations are unavailable to the agent.');
  return resolved;
}

function computerPath(value) {
  const resolved = canonicalTarget(value);
  return resolved;
}
async function testDirectory(taskId) {
  const directory = path.join(os.tmpdir(), 'orvix-agent-tests', crypto.createHash('sha256').update(taskId).digest('hex').slice(0, 24));
  // Reject junctions/symlinks that could redirect the generated scratch location.
  const resolved = canonicalTarget(directory);
  if (path.resolve(resolved).toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('Temporary test directory is redirected. Choose a safe temporary location.');
  await fs.promises.mkdir(directory, { recursive: true });
  return directory;
}
function inspectStorage(directory, signal, onProgress) {
  if (signal.aborted) return Promise.reject(new Error('Task cancelled.'));
  return new Promise((resolve, reject) => {
    // Size measurements read metadata only. AppData and cache sizes matter for drive usage.
    const worker = new Worker(__filename, { workerData: { directory: storagePath(directory) } });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true;
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error('Task cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    worker.on('message', message => {
      if (message.progress) onProgress?.(message.progress);
      else finish(message.error ? new Error(message.error) : null, message.result);
    });
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!settled) finish(new Error(`Folder scan ended before returning its result (${code}).`)); });
  });
}

async function scan(directory) {
  const rootStat = await fs.promises.stat(directory);
  if (!rootStat.isDirectory()) throw new Error('Choose an existing directory to measure.');
  const rows = []; let files = 0; let lastProgress = 0; let rootFileBytes = 0;
  const rootExcluded = []; const rootErrors = [];
  async function size(target, result) {
    const queue = [target];
    while (queue.length) {
      const current = queue.pop();
      let entries;
      try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
      catch (error) { result.unreadable++; if (result.errors.length < 8) result.errors.push({ path: current, code: error.code }); continue; }
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isSymbolicLink() || metadataProtectedPath(file) || isSensitiveFile(file)) { result.excluded++; continue; }
        if (entry.isDirectory()) queue.push(file);
        else if (entry.isFile()) {
          try { result.bytes += (await fs.promises.stat(file)).size; result.files++; files++; }
          catch (error) { result.unreadable++; if (result.errors.length < 8) result.errors.push({ path: file, code: error.code }); }
        }
        if (Date.now() - lastProgress > 1000) { lastProgress = Date.now(); parentPort.postMessage({ progress: `Measured ${files.toLocaleString()} files in ${directory}` }); }
      }
    }
    result.complete = result.unreadable === 0 && result.excluded === 0;
  }
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || metadataProtectedPath(target) || isSensitiveFile(target)) { rootExcluded.push(target); continue; }
    if (entry.isDirectory()) {
      const row = { directory: target, bytes: 0, files: 0, unreadable: 0, excluded: 0, errors: [] };
      await size(target, row); rows.push(row);
    } else if (entry.isFile()) {
      try { rootFileBytes += (await fs.promises.stat(target)).size; }
      catch (error) { rootErrors.push({ path: target, code: error.code }); }
    }
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  return { directory, measurement: 'Logical file bytes; excludes protected paths and symbolic links. Changing files can affect results.', complete: !rootExcluded.length && !rootErrors.length && rows.every(row => row.complete), folders: rows.slice(0, 100), totalFolders: rows.length, omittedFolders: Math.max(0, rows.length - 100), rootFileBytes, excluded: rootExcluded, errors: rootErrors, measuredAt: new Date().toISOString() };
}
if (!isMainThread) scan(workerData.directory).then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }));
module.exports = { computerPath, testDirectory, inspectStorage };
