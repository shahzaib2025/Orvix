const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { startDesktop } = require('./start-desktop.cjs');

function capture() {
  const stream = new PassThrough();
  let text = '';
  stream.on('data', chunk => { text += chunk; });
  return { stream, text: () => text };
}

test('desktop relay preserves live output, environment and child exit status', async () => {
  const out = capture(), err = capture(), signals = new EventEmitter();
  const code = await new Promise(resolve => startDesktop({
    runtime: process.execPath,
    args: ['-e', 'console.log(process.env.ELECTRON_NO_ATTACH_CONSOLE,process.env.ORVIX_LAUNCH_TEST); console.error("diagnostic"); process.exitCode=7;'],
    env: { ...process.env, ORVIX_LAUNCH_TEST: 'preserved' },
    stdout: out.stream, stderr: err.stream, signals, onExit: resolve,
  }));
  assert.equal(code, 7);
  assert.match(out.text(), /1 preserved/);
  assert.match(err.text(), /diagnostic/);
  assert.equal(out.stream.writableEnded, false);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('desktop relay forwards cancellation and removes signal handlers', async () => {
  const signals = new EventEmitter();
  let child;
  const code = await new Promise(resolve => {
    child = startDesktop({ runtime:process.execPath, args:['-e','setInterval(()=>{},1000)'],
      stdout:capture().stream, stderr:capture().stream, signals, onExit:resolve });
    child.once('spawn', () => signals.emit('SIGTERM'));
  });
  assert.equal(child.killed, true);
  assert.notEqual(code, 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('a missing Electron runtime is reported as a failed launch', async () => {
  const err = capture();
  const code = await new Promise(resolve => startDesktop({
    runtime: require('node:path').join(__dirname, 'missing-electron.exe'), args:[],
    stdout:capture().stream, stderr:err.stream, signals:new EventEmitter(), onExit:resolve,
  }));
  assert.equal(code, 1);
  assert.match(err.text(), /Desktop launch failed/);
});

test('an exclusively locked runtime produces an actionable error without an uncaught exception', () => {
  const err = capture(), signals = new EventEmitter();
  let exitCode;
  const child = startDesktop({ runtime:'locked.exe', stdout:capture().stream, stderr:err.stream, signals,
    spawnProcess:()=>{ throw Object.assign(new Error('spawn EBUSY'), {code:'EBUSY'}); },
    onExit:code=>{exitCode=code;},
  });
  assert.equal(child, null);
  assert.equal(exitCode, 1);
  assert.match(err.text(), /runtime is locked by another application/);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});
