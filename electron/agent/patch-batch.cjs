const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isHiddenPath } = require('./file-policy.cjs');

const maxFileBytes = 1024 * 1024;
const maxOperations = 16;
const maxEdits = 32;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const keyFor = file => process.platform === 'win32' ? file.toLowerCase() : file;

function textBuffer(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length > maxFileBytes) throw new Error(`${label} exceeds the 1 MB tracked-file limit.`);
  if (buffer.includes(0)) throw new Error(`${label} cannot contain binary data.`);
  return buffer;
}

function uniqueEdits(original, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > maxEdits) throw new Error(`Provide 1–${maxEdits} edits for each update.`);
  const crlf = original.includes('\r\n') && !original.replaceAll('\r\n', '').includes('\n');
  const matchEndings = value => crlf ? value.replace(/\r?\n/g, '\r\n') : value;
  const spans = edits.map((edit, index) => {
    if (!edit || typeof edit.old_text !== 'string' || !edit.old_text || typeof edit.new_text !== 'string') {
      throw new Error(`Edit ${index + 1} needs nonempty old_text and text new_text.`);
    }
    const oldText = matchEndings(edit.old_text);
    const start = original.indexOf(oldText);
    if (start < 0) throw new Error(`Edit ${index + 1}: exact old_text was not found.`);
    if (original.indexOf(oldText, start + 1) >= 0) throw new Error(`Edit ${index + 1}: old_text is ambiguous. Include more context.`);
    return { start, end: start + oldText.length, replacement: matchEndings(edit.new_text) };
  }).sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) throw new Error('Edits overlap in the original file. Combine them into one edit.');
  }
  let cursor = 0;
  let result = '';
  for (const span of spans) {
    result += original.slice(cursor, span.start) + span.replacement;
    cursor = span.end;
  }
  return result + original.slice(cursor);
}

function inspectTarget(workspaces, taskId, operation) {
  if (!operation || !['update', 'replace', 'create', 'delete'].includes(operation.type)) throw new Error('Each operation needs type update, replace, create, or delete.');
  const file = workspaces.assert(taskId, operation.file);
  if (isHiddenPath(file)) throw new Error('Ignored, generated, credential, and environment paths cannot be edited with batch patches.');
  let before = null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The target must be a regular file, not a link or directory.');
    if (stat.size > maxFileBytes) throw new Error('The target exceeds the 1 MB tracked-file limit.');
    before = fs.readFileSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (before?.includes(0)) throw new Error('Binary files cannot be edited.');
  if (before) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(before); }
    catch { throw new Error('Only valid UTF-8 files can be edited with batch patches.'); }
  }
  if (operation.type === 'create') {
    if (before) throw new Error(`Create target already exists: ${file}`);
    return { type: 'create', file, before: null, after: textBuffer(operation.content, 'content') };
  }
  if (!before) throw new Error(`File no longer exists: ${file}`);
  if (typeof operation.expected_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(operation.expected_sha256)) {
    throw new Error('Updates and deletes require expected_sha256 from a recent read_file_range result.');
  }
  if (sha256(before) !== operation.expected_sha256) throw new Error(`File changed since it was read: ${file}`);
  if (operation.type === 'delete') return { type: 'delete', file, before, after: null };
  const content = operation.type === 'replace' ? operation.content : uniqueEdits(before.toString('utf8'), operation.edits);
  const after = textBuffer(content, 'Updated file');
  if (after.equals(before)) throw new Error(`Update makes no change: ${file}`);
  return { type: 'update', file, before, after };
}

function reviewDeletions(operations, workspaces, taskId) {
  return operations.filter(operation => operation?.type === 'delete').map(operation => {
    const item = inspectTarget(workspaces, taskId, operation);
    return { file: item.file, bytes: item.before.length };
  });
}

function missingDirectories(file) {
  const result = [];
  for (let directory = path.dirname(file); !fs.existsSync(directory); directory = path.dirname(directory)) {
    if (path.dirname(directory) === directory) throw new Error('The target drive does not exist.');
    result.push(directory);
  }
  return result.reverse();
}

function verifyCurrent(item, workspaces, taskId) {
  workspaces.assert(taskId, item.file);
  let current = null;
  try {
    const stat = fs.lstatSync(item.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) throw new Error('Target type or size changed while preparing the batch.');
    current = fs.readFileSync(item.file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((current ? sha256(current) : null) !== (item.before ? sha256(item.before) : null)) {
    throw new Error(`File changed while preparing the batch: ${item.file}`);
  }
}

function cleanupFile(file) {
  if (file) try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function applyPatchBatch(operations, { workspaces, changes, taskId, signal, emit }) {
  if (!Array.isArray(operations) || !operations.length || operations.length > maxOperations) {
    throw new Error(`Provide 1–${maxOperations} file operations in one batch.`);
  }
  if (signal.aborted) throw new Error('Task cancelled.');
  const seen = new Set();
  const items = operations.map(operation => {
    const item = inspectTarget(workspaces, taskId, operation);
    const key = keyFor(item.file);
    if (seen.has(key)) throw new Error(`A file may appear only once per batch: ${item.file}`);
    seen.add(key);
    return item;
  });
  const createdDirectories = [];
  const nonce = crypto.randomUUID();
  const committed = [];
  let recorded = false;
  let retainBackups = false;
  try {
    for (const item of items) {
      for (const directory of missingDirectories(item.file)) {
        workspaces.assert(taskId, directory);
        fs.mkdirSync(directory);
        createdDirectories.push(directory);
      }
      if (item.after) {
        item.stage = `${item.file}.orvix-stage-${nonce}`;
        fs.writeFileSync(item.stage, item.after, { flag: 'wx' });
      }
      if (item.before) {
        item.backup = `${item.file}.orvix-backup-${nonce}`;
        fs.copyFileSync(item.file, item.backup, fs.constants.COPYFILE_EXCL);
      }
    }
    if (signal.aborted) throw new Error('Task cancelled.');
    for (const item of items) verifyCurrent(item, workspaces, taskId);
    for (const item of items) {
      if (signal.aborted) throw new Error('Task cancelled.');
      verifyCurrent(item, workspaces, taskId);
      if (item.type === 'delete') fs.unlinkSync(item.file);
      else fs.renameSync(item.stage, item.file);
      committed.push(item);
    }
    changes.markBatch(taskId, items, createdDirectories);
    recorded = true;
  } catch (error) {
    if (!recorded) {
      const failures = [];
      for (const item of committed.reverse()) {
        try {
          const current = fs.existsSync(item.file) ? fs.readFileSync(item.file) : null;
          if ((current ? sha256(current) : null) !== (item.after ? sha256(item.after) : null)) {
            failures.push(`${item.file}: changed during rollback`);
            continue;
          }
          if (item.before) {
            const restore = `${item.file}.orvix-restore-${nonce}`;
            fs.copyFileSync(item.backup, restore, fs.constants.COPYFILE_EXCL);
            try { fs.renameSync(restore, item.file); }
            finally { cleanupFile(restore); }
          } else cleanupFile(item.file);
        } catch (rollbackError) { failures.push(`${item.file}: ${rollbackError.message}`); }
      }
      if (failures.length) {
        retainBackups = true;
        throw new Error(`${error.message} Rollback needs attention: ${failures.join('; ')}. Original copies remain in .orvix-backup files beside the affected files.`);
      }
    }
    throw error;
  } finally {
    for (const item of items) {
      try { cleanupFile(item.stage); } catch { /* Do not hide the transaction result. */ }
      if (!retainBackups) try { cleanupFile(item.backup); } catch { /* Original data stays available. */ }
    }
    if (!recorded) for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch { /* Keep a directory if another writer now uses it. */ }
    }
  }
  await emit({ type: 'changes', files: changes.list(taskId) });
  return JSON.stringify({ applied: items.map(item => ({ type: item.type, file: item.file })), files: items.length });
}

module.exports = { applyPatchBatch, reviewDeletions };
