const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChangeStore } = require('../electron/agent/change-store.cjs');
const { createTurnReportStore, createTurnReportCheckpoint } = require('../electron/agent/turn-report-store.cjs');
const { fingerprint } = require('../electron/agent/verification.cjs');
const { observeChanges } = require('../electron/agent/outcome-observations.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-change-tracking-'));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const app = { getPath: () => path.join(root, 'state') }, store = createChangeStore(app);
  t.after(() => { store.stop('task'); assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('orvix-change-tracking-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, project, app, store };
}

test('unchanged scans read no content and overlapping scans share one result', async t => {
  const { project, store } = fixture(t);
  for (let i = 0; i < 36; i++) fs.writeFileSync(path.join(project, `${i}.txt`), 'before');
  await Promise.all([store.register('task', project), store.register('task', project)]);
  const results = await Promise.all(Array.from({ length: 8 }, () => store.scan('task')));
  assert.ok(results.every(result => result === results[0]));
  assert.equal(results[0].contentReads, 0); assert.equal(results[0].reusedFiles, 36);
  const file = path.join(project, '0.txt');
  const mtime = fs.statSync(file).mtime; fs.writeFileSync(file, 'AFTER!'); fs.utimesSync(file, mtime, mtime);
  const changed = await store.scan('task'); assert.equal(changed.contentReads, 1);
  assert.equal(store.list('task').length, 1); assert.equal(store.diff('task', file).after, 'AFTER!');
  store.restore('task', file); await store.scan('task'); assert.equal(store.list('task').length, 0);
});

test('large text and binary edits are detected, persisted, fingerprinted, reported and restorable', async t => {
  const { project, app, store } = fixture(t), reports = createTurnReportStore(app);
  for (const binary of [false, true]) {
    const file = path.join(project, binary ? 'asset.bin' : 'large.txt');
    const before = Buffer.alloc(1024 * 1024 + 33, binary ? 0 : 65); fs.writeFileSync(file, before);
  }
  await store.register('task', project); const baseline = store.capture('task');
  for (const name of ['large.txt', 'asset.bin']) fs.appendFileSync(path.join(project, name), 'changed');
  const scan = await store.scan('task'); assert.equal(scan.skippedLarge, false); assert.equal(scan.contentReads, 2);
  assert.equal(store.list('task').length, 2); assert.ok(store.list('task').every(entry => entry.kind === 'modified'));
  const first = fingerprint(store.list('task'), store, 'task');
  fs.appendFileSync(path.join(project, 'large.txt'), 'again'); await store.scan('task');
  assert.notEqual(fingerprint(store.list('task'), store, 'task'), first);
  const entries = store.turnDelta('task', baseline); assert.ok(entries.every(entry => entry.diffAvailable === false));
  const report = await reports.write('task', 'turn', entries); assert.equal(report.comparisonsLimited, true);
  assert.equal((await reports.diff('task', 'turn', path.join(project, 'large.txt'))).unavailable, true);
  assert.equal(observeChanges(store, 'task', baseline)[0].unavailable, true);
  store.stop('task'); const restored = createChangeStore(app); restored.restoreAll('task');
  assert.equal(fs.statSync(path.join(project, 'large.txt')).size, 1024 * 1024 + 33);
  assert.equal(fs.readFileSync(path.join(project, 'asset.bin'))[0], 0);
  await restored.register('task', project); await restored.scan('task'); assert.equal(restored.list('task').length, 0);
});

test('growing beyond and shrinking below the inline limit preserves the original recovery snapshot', async t => {
  const { project, store } = fixture(t), file = path.join(project, 'data.txt');
  fs.writeFileSync(file, 'small'); await store.register('task', project);
  fs.writeFileSync(file, 'x'.repeat(1024 * 1024 + 1)); await store.scan('task');
  assert.equal(store.list('task')[0].kind, 'modified'); store.restore('task', file);
  assert.equal(fs.readFileSync(file, 'utf8'), 'small'); await store.scan('task');
  fs.writeFileSync(file, 'y'.repeat(1024 * 1024 + 1)); await store.scan('task');
  store.stop('task'); store.forget('task'); await store.register('task', project);
  fs.writeFileSync(file, 'tiny'); await store.scan('task'); assert.equal(store.list('task')[0].kind, 'modified');
  store.restore('task', file); assert.equal(fs.statSync(file).size, 1024 * 1024 + 1);
});

test('unreadable directories retain earlier snapshots rather than inventing deletions', async t => {
  const { project, store } = fixture(t), folder = path.join(project, 'nested'); fs.mkdirSync(folder);
  const file = path.join(folder, 'keep.txt'); fs.writeFileSync(file, 'keep'); await store.register('task', project);
  const original = fs.promises.readdir;
  fs.promises.readdir = async (target, options) => {
    if (target === folder) throw Object.assign(new Error('Unavailable'), { code: 'EACCES' });
    return original(target, options);
  };
  try { const scan = await store.scan('task'); assert.equal(scan.incomplete, true); assert.equal(store.list('task').length, 0); }
  finally { fs.promises.readdir = original; }
  fs.unlinkSync(file); await store.scan('task'); assert.equal(store.list('task')[0].kind, 'deleted');
  store.restore('task', file); assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
});

test('large-file recovery refuses later external edits and damaged saved content', async t => {
  const { project, store, app } = fixture(t), file = path.join(project, 'asset.dat');
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 4, 1)); await store.register('task', project);
  fs.appendFileSync(file, 'edit'); await store.scan('task');
  fs.appendFileSync(file, 'external'); assert.throws(() => store.restore('task', file), /changed after/);
  await store.scan('task'); const record = store.capture('task').files[file];
  fs.writeFileSync(path.join(app.getPath(), 'agent-changes', 'task.content', `${record.beforeSnapshot}.bin`), 'damaged');
  assert.throws(() => store.restoreAll('task'), /snapshot is unavailable or damaged/);
});

test('large creations, deletions and merged reports retain the original file identity', async t => {
  const { project, store, app } = fixture(t), reports = createTurnReportStore(app);
  const removed = path.join(project, 'removed.txt'), created = path.join(project, 'created.txt');
  fs.writeFileSync(removed, 'r'.repeat(1024 * 1024 + 5)); await store.register('task', project);
  const initial = store.capture('task'); fs.unlinkSync(removed); fs.writeFileSync(created, 'c'.repeat(1024 * 1024 + 5));
  await store.scan('task'); const first = store.turnDelta('task', initial);
  assert.equal(first.find(entry => entry.path === removed).kind, 'deleted');
  assert.equal(first.find(entry => entry.path === created).kind, 'created');
  await reports.write('task', 'turn', first);
  const beforeDelete = store.capture('task'); fs.unlinkSync(created); await store.scan('task');
  const merged = await reports.write('task', 'turn', store.turnDelta('task', beforeDelete), null, true);
  assert.equal(merged.changes.length, 1); assert.equal(merged.changes[0].path, removed);
  store.restoreAll('task'); assert.equal(fs.statSync(removed).size, 1024 * 1024 + 5);
  assert.equal(fs.existsSync(created), false); await store.scan('task'); assert.equal(store.list('task').length, 0);
});

test('incremental turn reports survive interruption with only this turn\'s edits and creations', async t => {
  const { project, store, app } = fixture(t), reports = createTurnReportStore(app);
  const earlier = path.join(project, 'earlier.txt'), edited = path.join(project, 'index.html'), created = path.join(project, 'script.js');
  fs.writeFileSync(earlier, 'older turn\n'); fs.writeFileSync(edited, 'before\n'); await store.register('task', project);
  store.markFile('task', earlier, Buffer.from('original\n'), Buffer.from('older turn\n'));
  const baseline = store.capture('task');
  const checkpoint = createTurnReportCheckpoint({ reports, changes: store, taskId: 'task', requestId: 'interrupted', baseline });
  await checkpoint.begin();
  fs.writeFileSync(edited, 'before\nfirst\n'); store.markFile('task', edited, Buffer.from('before\n'), Buffer.from('before\nfirst\n'));
  await checkpoint.checkpoint();
  fs.writeFileSync(edited, 'before\nfirst\nsecond\n'); store.markFile('task', edited, Buffer.from('before\nfirst\n'), Buffer.from('before\nfirst\nsecond\n'));
  await checkpoint.checkpoint();
  fs.writeFileSync(created, 'new\nfile\n'); store.markFile('task', created, null, Buffer.from('new\nfile\n'));
  await checkpoint.checkpoint();

  const recovered = await createTurnReportStore(app).report('task', 'interrupted');
  assert.deepEqual(recovered.changes.map(item => [path.basename(item.path), item.kind, item.added, item.deleted]), [
    ['index.html', 'modified', 2, 0], ['script.js', 'created', 2, 0],
  ]);
});

test('ending a task removes unused large snapshots but preserves snapshots needed for recovery', async t => {
  const { project, store, app } = fixture(t), file = path.join(project, 'large.txt');
  fs.writeFileSync(file, 'a'.repeat(1024 * 1024 + 1)); await store.register('task', project);
  for (const letter of ['b', 'c', 'd']) { fs.writeFileSync(file, letter.repeat(1024 * 1024 + 1)); await store.scan('task'); }
  const directory = path.join(app.getPath(), 'agent-changes', 'task.content');
  assert.equal(fs.readdirSync(directory).length, 4); store.stop('task');
  assert.equal(fs.readdirSync(directory).length, 2); store.restoreAll('task');
  assert.equal(fs.readFileSync(file)[0], 97); store.stop('task'); assert.equal(fs.readdirSync(directory).length, 0);
});

test('an edit recorded during an asynchronous scan cannot be overwritten by stale scan data', async t => {
  const { project, store } = fixture(t), file = path.join(project, 'concurrent.txt');
  fs.writeFileSync(file, 'before'); await store.register('task', project); fs.writeFileSync(file, 'external');
  const original = fs.promises.readFile;
  let ready, release; const entered = new Promise(resolve => { ready = resolve; });
  const blocked = new Promise(resolve => { release = resolve; }); let once = true;
  fs.promises.readFile = async (target, options) => {
    if (target === file && once) { once = false; ready(); await blocked; }
    return original(target, options);
  };
  try {
    const scan = store.scan('task'); await entered;
    fs.writeFileSync(file, 'agent'); store.markFile('task', file, Buffer.from('before'), Buffer.from('agent')); release(); await scan;
    assert.equal(store.diff('task', file).before, 'before'); assert.equal(store.diff('task', file).after, 'agent');
  } finally { release(); fs.promises.readFile = original; }
});
