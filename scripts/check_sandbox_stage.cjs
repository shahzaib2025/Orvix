const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { copyProject, applyResult } = require('../electron/agent/sandbox-stage.cjs');

const base = path.resolve(__dirname, '..', 'benchmarks', '.runs');
fs.mkdirSync(base, { recursive: true });
const run = fs.mkdtempSync(path.join(base, 'orvix-stage-check-'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

try {
  const project = path.join(run, 'project');
  const input = path.join(run, 'input');
  const output = path.join(run, 'output');
  write(path.join(project, 'package.json'), '{"name":"stage-check"}');
  write(path.join(project, 'src', 'main.js'), 'export const value = 1;\n');
  write(path.join(project, '.env'), 'SHOULD_NOT_BE_STAGED=1');
  const baseline = copyProject(project, input);
  assert.equal(fs.existsSync(path.join(input, '.env')), false);
  assert.equal(baseline['src/main.js'], digest('export const value = 1;\n'));

  const replacement = Buffer.from('export const value = 2;\n');
  write(path.join(output, 'files', 'src', 'main.js'), replacement);
  const marked = [];
  const workspaces = { assert(_taskId, file) {
    const relative = path.relative(project, file);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  } };
  const changes = { markDirectory() {}, markFile(_taskId, file, before, after) { marked.push({ file, before, after }); }, list() { return marked; } };
  const applied = applyResult(project, baseline, output,
    [{ relative: 'src/main.js', kind: 'written', afterHash: digest(replacement) }], workspaces, 'stage-check', changes, () => {});
  assert.equal(applied, 1);
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), replacement.toString());
  assert.equal(marked.length, 1);

  assert.throws(() => applyResult(project, baseline, output,
    [{ relative: '../outside.js', kind: 'written', afterHash: digest(replacement) }], workspaces, 'stage-check', changes, () => {}));
  assert.throws(() => applyResult(project, baseline, output,
    [{ relative: 'src/main.js', kind: 'written', afterHash: digest(replacement) }], workspaces, 'stage-check', changes, () => {}), /changed on the host/);
  console.log('[Orvix] Sandbox staging and host merge checks passed.');
} finally {
  const resolved = fs.realpathSync(run);
  if (path.dirname(resolved) !== fs.realpathSync(base) || !path.basename(resolved).startsWith('orvix-stage-check-')) throw new Error('Refusing to remove a folder outside the check area.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
