const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceManager, protectedComponent, protectedPath } = require('../electron/agent/workspace-manager.cjs');

function fixture(t) {
  const scratch = path.resolve('scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'orvix-workspace-permissions-'));
  t.after(() => {
    assert.equal(path.dirname(root), scratch);
    assert.match(path.basename(root), /^orvix-workspace-permissions-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const app = { getPath: () => path.join(root, 'orvix-user-data') };
  return { root, workspaces: createWorkspaceManager(app) };
}

test('a normal nested project file opens and is authorized through its discovered project root', async t => {
  const { root, workspaces } = fixture(t);
  const project = path.join(root, 'plinth-studio');
  const css = path.join(project, 'assets', 'css');
  const file = path.join(css, 'style.css');
  fs.mkdirSync(css, { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  fs.writeFileSync(file, 'body { color: red; }');

  assert.equal(protectedPath(file), false);
  const opened = await workspaces.open('normal-project', css, async () => true);
  assert.equal(path.resolve(opened.root), path.resolve(project));
  assert.equal(workspaces.assert('normal-project', file), file);
  assert.deepEqual(workspaces.list('normal-project'), [project]);
});

test('protected-path denials identify the matched folder component', async t => {
  const { root, workspaces } = fixture(t);
  const protectedProject = path.join(root, 'AppData', 'project');
  fs.mkdirSync(protectedProject, { recursive: true });
  fs.writeFileSync(path.join(protectedProject, 'package.json'), '{}');

  assert.equal(protectedComponent(protectedProject), 'AppData');
  await assert.rejects(workspaces.open('protected-project', protectedProject, async () => true), error => {
    assert.equal(error.code, 'ERR_PROTECTED_WORKSPACE');
    assert.equal(error.protectedComponent, 'AppData');
    return true;
  });
});
