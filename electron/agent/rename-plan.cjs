const fs = require('node:fs');
const crypto = require('node:crypto');
const { createTwoFilesPatch, diffLines } = require('diff');
const { isHiddenPath } = require('./file-policy.cjs');

const maxFileBytes = 1024 * 1024;
const maxPatchBytes = 180000;
const maxTotalPatchBytes = 600000;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function counts(before, after) {
  let added = 0;
  let deleted = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) added += part.count ?? 0;
    if (part.removed) deleted += part.count ?? 0;
  }
  return { added, deleted };
}

function applySpans(before, edits, file) {
  if (!Array.isArray(edits) || !edits.length) throw new Error(`No rename edits were found in ${file}.`);
  let position = 0;
  let after = '';
  for (const edit of edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.length) || edit.length < 1
      || edit.start < position || edit.start + edit.length > before.length
      || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string'
      || before.slice(edit.start, edit.start + edit.length) !== edit.oldText) {
      throw new Error(`Rename positions are stale or overlap in ${file}.`);
    }
    after += before.slice(position, edit.start) + edit.newText;
    position = edit.start + edit.length;
  }
  return after + before.slice(position);
}

function createRenamePlan(result, workspaces, taskId) {
  if (!result || !Array.isArray(result.files) || !result.files.length || result.files.length > 16) {
    throw new Error('Rename must affect between 1 and 16 files.');
  }
  const seen = new Set();
  const files = [];
  let patchBytes = 0;
  for (const item of result.files) {
    const file = workspaces.assert(taskId, item.file);
    const key = process.platform === 'win32' ? file.toLowerCase() : file;
    if (seen.has(key) || isHiddenPath(file)) throw new Error(`Rename includes a duplicate or protected path: ${file}`);
    seen.add(key);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) {
      throw new Error(`Rename target is not a regular text file under 1 MB: ${file}`);
    }
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== item.sha256) throw new Error(`File changed while preparing rename: ${file}`);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const before = bytes.toString('utf8');
    const after = applySpans(before, item.edits, file);
    if (after === before || Buffer.byteLength(after) > maxFileBytes) throw new Error(`Rename creates no valid change or exceeds 1 MB: ${file}`);
    const patch = createTwoFilesPatch(file, file, before, after, 'Before', 'Proposed', { context: 3 });
    const size = Buffer.byteLength(patch);
    patchBytes += size;
    if (size > maxPatchBytes || patchBytes > maxTotalPatchBytes) {
      throw new Error('Rename diff is too large to review safely. Narrow the refactor.');
    }
    files.push({ file, before, after, sha256: item.sha256, occurrences: item.edits.length,
      patch, ...counts(before, after) });
  }
  return { oldName: result.oldName, newName: result.newName, files,
    occurrences: files.reduce((count, file) => count + file.occurrences, 0) };
}

function publicSummary(plan) {
  return { oldName: plan.oldName, newName: plan.newName, occurrences: plan.occurrences,
    files: plan.files.map(item => ({ file: item.file, occurrences: item.occurrences,
      added: item.added, deleted: item.deleted })) };
}

function operations(plan) {
  return plan.files.map(item => ({ type: 'replace', file: item.file,
    expected_sha256: item.sha256, content: item.after }));
}

module.exports = { createRenamePlan, publicSummary, operations };
