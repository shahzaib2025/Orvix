const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceBrowser } = require('../electron/agent/workspace-browser.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-workspace-browser-'));
  const allowed = path.resolve(root).toLowerCase();
  const workspaces = {
    assert(taskId, value) {
      assert.equal(taskId, 'task');
      const requested = path.resolve(value);
      const normalized = requested.toLowerCase();
      if (normalized !== allowed && !normalized.startsWith(`${allowed}${path.sep}`.toLowerCase())) throw new Error('Path is outside the open workspace.');
      return requested;
    },
  };
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith('orvix-workspace-browser-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, browser: createWorkspaceBrowser(workspaces) };
}

test('workspace browser lists ordinary project files while honoring ignored and credential paths', async t => {
  const { root, browser } = fixture(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules', 'private-package'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"sample"}\n');
  fs.writeFileSync(path.join(root, 'src', 'index.html'), '<main>Readable source</main>\n');
  fs.writeFileSync(path.join(root, 'ignored.txt'), 'ignored');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=value');
  fs.writeFileSync(path.join(root, 'node_modules', 'private-package', 'index.js'), 'secret');

  const result = await browser.list('task', root);
  const relative = result.files.map(file => file.relativePath.replaceAll('\\', '/'));
  assert.ok(relative.includes('package.json'));
  assert.ok(relative.includes('src/index.html'));
  assert.ok(!relative.includes('ignored.txt'));
  assert.ok(!relative.includes('.env'));
  assert.ok(!relative.some(file => file.includes('node_modules')));
  assert.equal(result.truncated, false);
});

test('workspace browser reads UTF-8 text, identifies binary files and rejects paths outside the workspace', async t => {
  const { root, browser } = fixture(t);
  const source = path.join(root, 'README.md');
  const binary = path.join(root, 'image.bin');
  fs.writeFileSync(source, '# Workspace\nReadable.');
  fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));

  const text = await browser.read('task', source);
  assert.equal(text.content, '# Workspace\nReadable.');
  assert.equal(text.binary, false);
  const image = await browser.read('task', binary);
  assert.equal(image.content, null);
  assert.equal(image.binary, true);
  await assert.rejects(() => browser.read('task', path.join(root, '..', 'outside.txt')), /outside the open workspace/);
  await assert.rejects(() => browser.list('task', path.join(root, '..')), /outside the open workspace/);
});
