const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { prepareRuntimeSdk } = require('../electron/agent/opencode-sdk-seed.cjs');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-sdk-seed-'));
  t.after(async () => { assert.equal(path.dirname(base), os.tmpdir()); await fs.promises.rm(base, { recursive: true, force: true }); });
  const template = path.join(base, 'template'), root = path.join(base, 'worker');
  const module = path.join(template, 'node_modules', '@opencode-ai', 'plugin');
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(module, 'package.json'), JSON.stringify({ name: '@opencode-ai/plugin', version: '1.19.0' }));
  fs.writeFileSync(path.join(module, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(template, 'package.json'), JSON.stringify({ dependencies: { '@opencode-ai/plugin': '1.19.0' } }));
  fs.writeFileSync(path.join(template, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { '@opencode-ai/plugin': '1.19.0' } } } }));
  return { base, template, root, config: path.join(root, 'config', 'opencode') };
}

test('SDK setup is local and idempotent, and preserves task records and provider configuration', async t => {
  const { template, root, config } = fixture(t);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  const journal = path.join(root, 'data', 'retained-history.json');
  const preferences = path.join(config, 'opencode.json');
  fs.writeFileSync(journal, '{"completed":true}');
  fs.writeFileSync(preferences, '{"share":"disabled"}');
  await prepareRuntimeSdk(root, template);
  const marker = path.join(config, '.orvix-sdk-ready.json');
  const before = fs.statSync(marker).mtimeMs;
  await prepareRuntimeSdk(root, template);
  assert.equal(fs.statSync(marker).mtimeMs, before, 'warm launches must not recopy the SDK');
  assert.equal(fs.readFileSync(journal, 'utf8'), '{"completed":true}');
  assert.equal(fs.readFileSync(preferences, 'utf8'), '{"share":"disabled"}');
  assert.equal(fs.readFileSync(path.join(config, 'node_modules', '@opencode-ai', 'plugin', 'index.js'), 'utf8'), 'module.exports = {};');
  assert.equal(fs.lstatSync(path.join(config, 'node_modules')).isSymbolicLink(), false);
});

test('SDK setup repairs incomplete installs and lockfiles that would trigger a native reinstall', async t => {
  const { template, root, config } = fixture(t);
  await prepareRuntimeSdk(root, template);
  fs.writeFileSync(path.join(config, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(config, 'node_modules', '@opencode-ai', 'plugin', 'package.json'), '{"version":"old"}');
  await prepareRuntimeSdk(root, template);
  assert.equal(JSON.parse(fs.readFileSync(path.join(config, 'package-lock.json'), 'utf8')).packages[''].dependencies['@opencode-ai/plugin'], '1.19.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(config, 'node_modules', '@opencode-ai', 'plugin', 'package.json'), 'utf8')).version, '1.19.0');
});

test('a failed SDK copy cannot leave a ready marker', async t => {
  const { template, root, config } = fixture(t);
  fs.renameSync(path.join(template, 'node_modules'), path.join(template, 'not-available'));
  await assert.rejects(prepareRuntimeSdk(root, template), /ENOENT/);
  assert.equal(fs.existsSync(path.join(config, '.orvix-sdk-ready.json')), false);
});

test('packaged setup uses the shipped SDK resource without requiring development scripts', async t => {
  const { base, template, root } = fixture(t);
  const previous = process.resourcesPath;
  const resources = path.join(base, 'installed resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.renameSync(template, path.join(resources, 'opencode-runtime-sdk'));
  process.resourcesPath = resources;
  try { await prepareRuntimeSdk(root); }
  finally { if (previous === undefined) delete process.resourcesPath; else process.resourcesPath = previous; }
  assert.ok(fs.existsSync(path.join(root, 'config', 'opencode', '.orvix-sdk-ready.json')));
});
