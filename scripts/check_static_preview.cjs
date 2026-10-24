const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createPreviewServer } = require('../electron/agent/preview-server.cjs');
const { createStaticPreview } = require('../electron/agent/static-preview.cjs');
test('managed static preview starts without installed server tools, reuses its port and stops at turn end', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Fresh static preview</h1>');
  fs.writeFileSync(path.join(root, '.env'), 'must-not-serve');
  fs.writeFileSync(path.join(root, 'credentials.json'), 'must-not-serve');
  const controller = new AbortController(), preview = createPreviewServer(controller.signal);
  t.after(async () => { controller.abort(); await new Promise(resolve => setTimeout(resolve, 350)); await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  const first = await preview.start('static', root);
  assert.equal(first.status, 'ready'); assert.ok(first.url.startsWith('http://127.0.0.1:'));
  assert.match(await (await fetch(first.url)).text(), /Fresh static preview/);
  assert.equal((await fetch(first.url + '.env')).status, 403);
  assert.equal((await fetch(first.url + 'credentials.json')).status, 403);
  assert.equal((await preview.start('static', root)).reused, true);
  preview.stopAll(); assert.equal(preview.inspect().length, 0);
});
test('static server does not follow links outside its project', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-static-scope-'));
  const project = path.join(root, 'project'), outside = path.join(root, 'outside'); fs.mkdirSync(project); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'index.html'), 'private sibling');
  fs.symlinkSync(outside, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = createStaticPreview(project); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.unlinkSync(path.join(project, 'linked')); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/linked/`)).status, 403);
});
