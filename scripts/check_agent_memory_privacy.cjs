const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskStore } = require('../electron/agent/task-store.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { rejectCredentialAccess } = require('../electron/agent/tools.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-memory-privacy-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, app: { getPath: () => root } };
}

test('deleted history cannot return after restart or a stale renderer save; legacy copy is removed', t => {
  const {root,app} = fixture(t);
  const original = [{id:'first',turns:[{prompt:'private first chat'}]}, {id:'second',turns:[{prompt:'second chat'}]}];
  fs.writeFileSync(path.join(root,'agent-tasks.json'),JSON.stringify(original));
  const store = createTaskStore(app);
  assert.equal(store.read().length,2);
  assert.equal(fs.existsSync(path.join(root,'agent-tasks.json')),false);
  store.forget('first');
  const restored = createTaskStore(app);
  restored.write(original);
  assert.deepEqual(restored.read().map(task=>task.id),['second']);
  assert.equal(restored.isDeleted('first'),true);
  const records = fs.readdirSync(path.join(root,'agent-task-records')).filter(file=>/^[a-f0-9]{64}\.json$/.test(file));
  assert.ok(records.every(file=>!fs.readFileSync(path.join(root,'agent-task-records',file),'utf8').includes('private first chat')));
});

test('memory cleanup failure is surfaced instead of pretending records were removed', t => {
  const {root,app} = fixture(t);
  const memory = createTaskMemoryStore(app);
  const target = path.join(root,'agent-memory','task.json');
  fs.mkdirSync(target);
  assert.throws(()=>memory.forget('task'));
  assert.equal(fs.existsSync(target),true);
  memory.forget('missing');
});

test('private record commands are rejected while ordinary project commands remain available', () => {
  for (const command of [
    'Get-Content C:/Users/Example/AppData/Roaming/Orvix/agent-memory/other.json',
    'cat ../agent-evidence/other/blobs/file.txt',
    'Get-Content "$env:APPDATA/Orvix/agent-tasks.json"',
    'type %APPDATA%/Orvix/agent-task-records/index.json',
    'Get-Content ../a`gent-memory/other.json',
    'cat ../agent%2dmemory/other.json',
    'sqlite3 ../opencode-workers/worker/data/opencode.db',
    'powershell -EncodedCommand abc',
  ]) assert.throws(()=>rejectCredentialAccess(command),/private chat/);
  for (const command of ['npm run build','node scripts/check.js','Get-CimInstance Win32_OperatingSystem','Get-Content ./src/app.ts']) assert.doesNotThrow(()=>rejectCredentialAccess(command));
});

test('literal browser existence probes do not grant access to AppData or private records', () => {
  const probe = fs.readFileSync(path.join(__dirname, 'fixtures/browser-runtime-probe.ps1'), 'utf8');
  assert.doesNotThrow(() => rejectCredentialAccess(probe));
  for (const path of ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe']) {
    assert.doesNotThrow(() => rejectCredentialAccess('Test-Path -LiteralPath "$env:LOCALAPPDATA\\' + path + '"'));
  }
  for (const command of [
    'Get-Content "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"',
    'Test-Path -LiteralPath "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe\\..\\..\\Orvix"',
    'Test-Path -LiteralPath "$env:LOCALAPPDATA\\Orvix\\agent-tasks.json"',
    'Test-Path -LiteralPath "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\*"',
    probe + '\nGet-Content "$env:APPDATA\\Orvix\\agent-tasks.json"',
    probe + '\nGet-Content $chrome',
    probe + '\n$c = $c.Replace("Google", "Orvix")',
    probe + '\n| ForEach-Object { $_ -replace "Chrome", "Orvix" }',
    probe.replace('Test-Path -LiteralPath $c', 'Get-Content $c'),
    probe.replace('Application\\chrome.exe', 'Application\\chrome.exe\\..\\..'),
  ]) assert.throws(() => rejectCredentialAccess(command), /private chat/);
});

test('browser inventories accept equivalent public-path formats without permitting arbitrary script bodies', () => {
  const probe = fs.readFileSync(path.join(__dirname, 'fixtures/browser-existence-inventory.ps1'), 'utf8');
  for (const safe of [probe, probe.replaceAll('$paths', '$candidates').replaceAll('$p)', '$browser)').replaceAll('$p ', '$browser ').replaceAll('$p }', '$browser }'),
    probe.replace('"{0}  {1}" -f (Test-Path -LiteralPath $p), $p', 'if (Test-Path -Path $p) { Write-Output "Installed: $p" }'),
    probe.replaceAll('"C:', "'C:").replaceAll('.exe",', ".exe',"),
    probe.replaceAll('\n', '\r\n')]) assert.doesNotThrow(() => rejectCredentialAccess(safe));
  for (const unsafe of [
    probe + '\nGet-Content $paths',
    probe + '\n$p = $p.Replace("Google", "Orvix")',
    probe + '\n| ForEach-Object { Get-Content $_ }',
    probe.replace('Test-Path -LiteralPath $p', 'Get-Content $p'),
    probe.replace('Test-Path -LiteralPath $p', 'Test-Path -LiteralPath ($p + "\\..\\..\\Orvix")'),
    probe.replace('"{0}  {1}"', '"$(Get-Content $p) {1}"'),
    probe.replace('"{0}  {1}"', '"$env:APPDATA {1}"'),
    probe.replace('Application\\chrome.exe"', 'Application\\chrome.exe\\..\\.."'),
    probe.replace('Application\\chrome.exe"', 'Application\\*"'),
    probe.replace('$paths =', '$p =').replace('in $paths', 'in $p'),
    probe.replace('$env:LOCALAPPDATA', '${env:LOCALAPPDATA}'),
    probe.replace('$env:LOCALAPPDATA', '$env:LOCALAPPDATA`'),
  ]) assert.throws(() => rejectCredentialAccess(unsafe), /private chat/);
});

test('native deletion removes only its inactive task runtime and preserves another worker', async t => {
  const {root} = fixture(t);
  const states = [];
  const pool = createOpenCodeWorkers(root,{create(directory){
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'private.txt'),'fixture');
    const state={directory,queued:0,closed:false};states.push(state);
    return {status:()=>({queued:state.queued}),shutdown:()=>{state.closed=true;},exclusive:async(_,callback)=>callback({})};
  }});
  t.after(()=>pool.shutdown());
  pool.forTask('first');pool.forTask('second');
  states[1].queued=1;
  await assert.rejects(pool.forget('first'),/Stop the agent/);
  assert.equal(fs.existsSync(states[1].directory),true);
  states[1].queued=0;
  await pool.forget('first');
  assert.equal(states[1].closed,true);assert.equal(fs.existsSync(states[1].directory),false);
  assert.equal(fs.existsSync(states[2].directory),true);assert.equal(states[2].closed,false);
  assert.equal(fs.existsSync(path.join(root,'private.txt')),true);
  await assert.rejects(pool.forget('../second'),/Invalid/);
  assert.equal(Object.hasOwn(pool.status().workers,'first'),false);
});
