const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createPreviewServer } = require('../electron/agent/preview-server.cjs');
const root = path.resolve(__dirname, '..', 'scratch', 'preview-server-readiness'); fs.mkdirSync(root, { recursive: true });
const project = fs.mkdtempSync(path.join(root, 'fixture-'));
fs.writeFileSync(path.join(project, 'server.cjs'), 'const s=require("http").createServer((q,r)=>r.end("Ready"));s.listen(0,"127.0.0.1",()=>console.log("PREVIEW_URL=http://127.0.0.1:"+s.address().port));');
const controller = new AbortController(), server = createPreviewServer(controller.signal);
const command = process.platform === 'win32' ? `& '${process.execPath.replace(/'/g, "''")}' server.cjs` : `'${process.execPath.replace(/'/g, "'\\''")}' server.cjs`;
(async () => {
  const started = Date.now(), first = await server.start(command, project), startupMs = Date.now() - started;
  assert.equal(first.status, 'ready'); assert.ok(first.url); assert.equal(await (await fetch(first.url)).text(), 'Ready');
  const reuseStarted = Date.now(), second = await server.start(command, project), reuseMs = Date.now() - reuseStarted;
  assert.equal(second.reused, true); assert.equal(second.pid, first.pid); assert.equal(second.url, first.url);
  controller.abort(); server.stopAll();
  let reachable = true;
  for (let attempt = 0; attempt < 20 && reachable; attempt++) {
    try { await fetch(first.url, { signal: AbortSignal.timeout(500) }); await new Promise(resolve => setTimeout(resolve, 250)); } catch { reachable = false; }
  }
  assert.equal(reachable, false); assert.deepEqual(server.inspect(), []);
  const result = { status: 'passed', at: new Date().toISOString(), startupMs, reuseMs, observedUrl: first.url, sameOwnedPid: true, cleanup: 'passed' };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { controller.abort(); server.stopAll(); });
