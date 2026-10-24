function captureScope(maps, roots, baseline = {}) {
  for (const root of roots) {
    if (baseline[root]) continue;
    const snapshot = maps.snapshot(root);
    if (snapshot) baseline[root] = { recordedAt: Date.now(), files: Object.fromEntries(snapshot.files.map(item => [item.file, item.hash])), limitations: snapshot.limitations };
  }
  return baseline;
}
function observeScope(maps, roots, baseline) {
  return roots.map(root => {
    const before = baseline[root], snapshot = maps.snapshot(root);
    if (!before || !snapshot) return { root, status: 'unavailable', reason: 'No recorded pre-effect workspace baseline.' };
    const after = Object.fromEntries(snapshot.files.map(item => [item.file, item.hash]));
    return { root, recordedAt: before.recordedAt, baselineFiles: Object.keys(before.files).length, currentFiles: Object.keys(after).length,
      changedFiles: [...new Set([...Object.keys(before.files), ...Object.keys(after)])].filter(file => before.files[file] !== after[file]).map(file => ({ file, beforeHash: before.files[file] ?? null, afterHash: after[file] ?? null })),
      unchangedFiles: Object.keys(before.files).filter(file => before.files[file] === after[file]),
      limitations: 'Only indexed workspace files were compared; ignored, generated, binary, credential and unindexed paths are not observed. This does not prove absence of effects elsewhere.', indexLimitations: snapshot.limitations };
  });
}
function observeChanges(changes, taskId, baseline) {
  return changes.turnDelta(taskId, baseline).filter(item => !item.directory && !item.binary).map(item => item.diffAvailable === false
    ? { file: item.path, beforeHash: item.beforeHash, afterHash: item.afterHash, partial: true, unavailable: true }
    : ({ file: item.path,
    before: item.before === null ? null : Buffer.from(item.before, 'base64').toString('utf8').slice(0, 16000),
    after: item.after === null ? null : Buffer.from(item.after, 'base64').toString('utf8').slice(0, 16000),
    partial: (item.before && Buffer.from(item.before, 'base64').length > 16000) || (item.after && Buffer.from(item.after, 'base64').length > 16000) || false }));
}
module.exports = { captureScope, observeScope, observeChanges };
