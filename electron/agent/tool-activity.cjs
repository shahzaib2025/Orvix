const { redactApiKeys } = require('./api-key-check.cjs');

const MAX_FIELD = 3000;

function visibleText(value, limit = MAX_FIELD) {
  const clean = redactApiKeys(String(value ?? ''));
  return clean.length > limit ? `${clean.slice(0, limit)}\n… (${clean.length - limit} more characters in the tool call)` : clean;
}

let diffLines = null;
try {
  diffLines = require('diff').diffLines;
} catch {
  // Diff package fallback
}

function countLines(text) {
  if (!text) return 0;
  return String(text).split(/\r?\n/).length;
}

function computeDiff(oldText, newText) {
  if (oldText === newText) return { added: 0, deleted: 0 };
  const strOld = typeof oldText === 'string' ? oldText : '';
  const strNew = typeof newText === 'string' ? newText : '';
  if (!strOld) return { added: countLines(strNew), deleted: 0 };
  if (!strNew) return { added: 0, deleted: countLines(strOld) };
  if (diffLines) {
    try {
      let added = 0, deleted = 0;
      for (const part of diffLines(strOld, strNew)) {
        if (part.added) added += part.count ?? 0;
        if (part.removed) deleted += part.count ?? 0;
      }
      return { added, deleted };
    } catch { /* fallback below */ }
  }
  const oldLines = strOld.split(/\r?\n/);
  const newLines = strNew.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let oldSuffix = oldLines.length - 1, newSuffix = newLines.length - 1;
  while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
    oldSuffix--;
    newSuffix--;
  }
  return {
    added: Math.max(0, newSuffix - prefix + 1),
    deleted: Math.max(0, oldSuffix - prefix + 1),
  };
}

function toolInput(name, args) {
  if (!args || typeof args !== 'object') return '';
  const selected = {};
  const add = (key, limit) => {
    if (args[key] !== undefined) selected[key] = typeof args[key] === 'string' ? visibleText(args[key], limit) : args[key];
  };
  for (const key of ['directory', 'purpose', 'file', 'filePath', 'filepath', 'path', 'query', 'url', 'symbol', 'action', 'item', 'line', 'column', 'start_line', 'end_line', 'regex', 'new_name', 'phase', 'expected_exit', 'expected_output', 'label']) add(key, 2000);
  if (name === 'read_file_ranges' && Array.isArray(args.ranges)) {
    selected.ranges = args.ranges.map(range => ({ file: visibleText(range.file, 2000), ...(Number.isInteger(range.start_line) ? { start_line: range.start_line } : {}), ...(Number.isInteger(range.max_lines) ? { max_lines: range.max_lines } : {}) }));
  }
  if (['run_computer_command', 'run_command', 'verify_work', 'bash', 'shell'].includes(name)) {
    add('command', 6000);
    add('description', 2000);
    add('workdir', 2000);
  }
  if (['apply_edit', 'edit'].includes(name)) {
    const oldVal = args.old_text ?? args.oldString ?? args.old_string;
    const newVal = args.new_text ?? args.newString ?? args.new_string;
    if (oldVal !== undefined) {
      selected.old_text = visibleText(oldVal, MAX_FIELD);
      if (args.oldString !== undefined) selected.oldString = selected.old_text;
    }
    if (newVal !== undefined) {
      selected.new_text = visibleText(newVal, MAX_FIELD);
      if (args.newString !== undefined) selected.newString = selected.new_text;
    }
    if (Array.isArray(args.edits)) {
      selected.edits = args.edits.map(edit => {
        const o = edit?.old_text ?? edit?.oldString ?? edit?.old_string;
        const n = edit?.new_text ?? edit?.newString ?? edit?.new_string;
        return {
          ...(o !== undefined ? { old_text: visibleText(o, 1200) } : {}),
          ...(n !== undefined ? { new_text: visibleText(n, 1200) } : {}),
        };
      });
      let totalAdded = 0, totalDeleted = 0;
      for (const edit of args.edits) {
        const d = computeDiff(edit?.old_text ?? edit?.oldString ?? edit?.old_string, edit?.new_text ?? edit?.newString ?? edit?.new_string);
        totalAdded += d.added;
        totalDeleted += d.deleted;
      }
      if (totalAdded > 0 || totalDeleted > 0) selected.diff = { added: totalAdded, deleted: totalDeleted };
    } else if (oldVal !== undefined || newVal !== undefined) {
      const d = computeDiff(oldVal, newVal);
      if (d.added > 0 || d.deleted > 0) selected.diff = d;
    }
  }
  if (['write_file', 'write'].includes(name)) {
    selected.content = visibleText(args.content, MAX_FIELD);
    selected.contentNote = 'Preview only. Review the recorded file diff for the full change.';
  }
  if (['apply_patch'].includes(name)) {
    const patchText = args.patch ?? args.diff;
    if (patchText !== undefined) {
      selected.patch = visibleText(patchText, MAX_FIELD);
      let added = 0, deleted = 0;
      for (const line of String(patchText).split(/\r?\n/)) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++;
        else if (line.startsWith('-') && !line.startsWith('---')) deleted++;
      }
      if (added > 0 || deleted > 0) selected.diff = { added, deleted };
    }
  }
  if (name === 'apply_patch_batch' && Array.isArray(args.operations)) {
    let totalAdded = 0, totalDeleted = 0;
    selected.operations = args.operations.map(operation => {
      let opEdits = undefined;
      if (Array.isArray(operation.edits)) {
        opEdits = operation.edits.map(edit => {
          const o = edit?.old_text ?? edit?.oldString;
          const n = edit?.new_text ?? edit?.newString;
          const d = computeDiff(o, n);
          totalAdded += d.added;
          totalDeleted += d.deleted;
          return { old_text: visibleText(o, 1200), new_text: visibleText(n, 1200) };
        });
      }
      return {
        type: operation.type,
        file: visibleText(operation.file, 2000),
        ...(opEdits ? { edits: opEdits } : {}),
        ...(typeof operation.content === 'string' ? { content: visibleText(operation.content, MAX_FIELD) } : {}),
      };
    });
    if (totalAdded > 0 || totalDeleted > 0) selected.diff = { added: totalAdded, deleted: totalDeleted };
  }
  if (name === 'delete_file') selected.note = 'The previous contents are available in the recorded file diff.';
  return visibleText(JSON.stringify(selected, null, 2), 28000);
}

function toolDetail(name, args) {
  if (name === 'list_roots') return '';
  if (name === 'apply_patch_batch' && Array.isArray(args?.operations)) {
    return visibleText(args.operations.map(item => `${item.type ?? 'edit'} ${item.file ?? ''}`).join(', '), 2000);
  }
  if (name === 'read_file_ranges' && Array.isArray(args?.ranges)) {
    return visibleText(args.ranges.map(range => `${range.file ?? ''}${Number.isInteger(range.start_line) ? `:${range.start_line}` : ''}`).join(', '), 3000);
  }
  const target = name === 'verify_work' ? `${args?.label ?? 'Check'} (${args?.phase ?? 'verification'})`
    : name === 'run_command' ? args?.command
    : ['search_files', 'search_content'].includes(name) ? `${args?.query ?? ''} in ${args?.directory ?? ''}`
      : name === 'find_symbol' ? `${args?.symbol ?? ''} in ${args?.directory ?? ''}`
        : args?.file ?? args?.filePath ?? args?.filepath ?? args?.path ?? args?.directory ?? args?.query ?? args?.url ?? args?.command ?? args?.item ?? args?.symbol ?? '';
  const location = name === 'read_file_range' && Number.isInteger(args?.start_line)
    ? `:${args.start_line}${Number.isInteger(args?.end_line) ? `-${args.end_line}` : ''}` : '';
  return visibleText(`${target}${location}`, 2000);
}

module.exports = { toolInput, toolDetail, visibleText };
