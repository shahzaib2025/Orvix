const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { ignoredDirectories, isSensitiveFile } = require('./file-policy.cjs');

const maxFiles = 16;
const maxLocations = 800;
const maxFileBytes = 1024 * 1024;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function identifier(ts, name) {
  if (typeof name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,119}$/.test(name)) return false;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, name);
  return scanner.scan() === ts.SyntaxKind.Identifier && scanner.getTokenText() === name
    && scanner.scan() === ts.SyntaxKind.EndOfFileToken;
}

function renameLocations({ ts, service, program, file, offset, newName, root, permitted, inside }) {
  if (!identifier(ts, newName)) throw new Error('Choose a valid JavaScript or TypeScript identifier for the new name.');
  const info = service.getRenameInfo(file, offset, { allowRenameOfImportPath: false });
  if (!info.canRename) throw new Error(info.localizedErrorMessage || 'The selected symbol cannot be renamed.');
  if (info.fileToRename) throw new Error('This selection renames a file path; symbol rename does not move files.');
  if (info.displayName === newName) throw new Error('The symbol already has that name.');
  const locations = service.findRenameLocations(file, offset, false, false,
    { allowRenameOfImportPath: false, providePrefixAndSuffixTextForRename: true }) ?? [];
  if (!locations.length) throw new Error('The language service found no rename locations.');
  if (locations.length > maxLocations) throw new Error(`Rename affects more than ${maxLocations} locations. Narrow the refactor.`);
  const grouped = new Map();
  for (const location of locations) {
    const target = location.fileName;
    const restricted = path.relative(root, target).split(path.sep).some(part =>
      ignoredDirectories.has(part.toLowerCase()) || isSensitiveFile(part));
    if (!inside(root, target) || !permitted(target, root) || restricted) {
      throw new Error('Rename reaches outside this open project or into a protected path. Open a narrower project or use a manual edit.');
    }
    let group = grouped.get(target);
    if (!group) {
      if (grouped.size >= maxFiles) throw new Error(`Rename affects more than ${maxFiles} files. No files were changed.`);
      const source = program.getSourceFile(target);
      if (!source) throw new Error(`The language service could not load ${target}.`);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) {
        throw new Error(`Rename target is not a regular text file under 1 MB: ${target}`);
      }
      const bytes = fs.readFileSync(target);
      if (bytes.includes(0)) throw new Error(`Rename target is binary: ${target}`);
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const diskText = bytes.toString('utf8');
      const bomShift = diskText.startsWith('\ufeff') && source.text === diskText.slice(1) ? 1 : 0;
      if (source.text !== diskText && !bomShift) throw new Error(`File changed during semantic analysis: ${target}`);
      group = { file: target, sha256: sha256(bytes), bomShift, text: diskText, edits: [] };
      grouped.set(target, group);
    }
    const span = location.textSpan;
    if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.length) || span.length < 1) {
      throw new Error(`The language service returned an invalid rename location in ${target}.`);
    }
    const start = span.start + group.bomShift;
    const oldText = group.text.slice(start, start + span.length);
    if (oldText.length !== span.length) throw new Error(`Rename span exceeds ${target}.`);
    group.edits.push({ start, length: span.length, oldText,
      newText: `${location.prefixText ?? ''}${newName}${location.suffixText ?? ''}` });
  }
  const files = [];
  for (const group of grouped.values()) {
    group.edits.sort((a, b) => a.start - b.start);
    const unique = [];
    for (const edit of group.edits) {
      const previous = unique.at(-1);
      if (previous?.start === edit.start && previous.length === edit.length && previous.newText === edit.newText) continue;
      if (previous && edit.start < previous.start + previous.length) throw new Error(`Rename locations overlap in ${group.file}.`);
      unique.push(edit);
    }
    files.push({ file: group.file, sha256: group.sha256, edits: unique });
  }
  return { oldName: info.displayName, newName, files, occurrences: files.reduce((count, item) => count + item.edits.length, 0) };
}

module.exports = { renameLocations };
