const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APP_ID, LOGIN_ARGS, createStartupSettings } = require('../electron/startup-settings.cjs');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

function fixture(file, { platform = 'win32', packaged = true, initial = false, startupAppEnabled = initial } = {}) {
  const writes = [];
  let enabled = initial;
  let approved = startupAppEnabled;
  const app = {
    isPackaged: packaged,
    getPath(name) { assert.equal(name, 'exe'); return 'C:/Program Files/Orvix/Orvix.exe'; },
    getLoginItemSettings(options) {
      assert.deepEqual(options, { path: 'C:/Program Files/Orvix/Orvix.exe', args: LOGIN_ARGS });
      return { openAtLogin: enabled, launchItems: [{ name: APP_ID, enabled: approved }] };
    },
    setLoginItemSettings(options) { writes.push(options); enabled = options.openAtLogin; approved = options.enabled; },
  };
  return { app, writes, get enabled() { return enabled; }, settings: createStartupSettings({ app, file, platform, packaged }) };
}

test('a new installed Windows app explicitly clears the old auto-start entry and saves off by default', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'startup-settings.json');
  const item = fixture(file, { initial: true });
  assert.deepEqual(item.settings.initialize(), { supported: true, enabled: false, appId: APP_ID });
  assert.equal(item.enabled, false);
  assert.equal(item.writes.length, 1);
  assert.deepEqual(item.writes[0], {
    openAtLogin: false, enabled: false, name: APP_ID,
    path: 'C:/Program Files/Orvix/Orvix.exe', args: LOGIN_ARGS,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, startAtLogin: false });
});

test('the user toggle registers the branded hidden startup item and can remove it', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const item = fixture(path.join(directory, 'startup-settings.json'));
  item.settings.initialize();
  assert.deepEqual(item.settings.setStartAtLogin(true), { supported: true, enabled: true, appId: APP_ID });
  assert.equal(item.writes.at(-1).name, APP_ID);
  assert.equal(item.writes.at(-1).enabled, true);
  assert.deepEqual(item.writes.at(-1).args, ['--hidden']);
  assert.deepEqual(JSON.parse(fs.readFileSync(item.settings.file, 'utf8')), { version: 1, startAtLogin: true });
  const restarted = fixture(item.settings.file, { initial: true });
  assert.deepEqual(restarted.settings.initialize(), { supported: true, enabled: true, appId: APP_ID });
  assert.equal(restarted.writes.length, 0, 'startup respects the saved opt-in without creating a new login item');
  assert.deepEqual(item.settings.setStartAtLogin(false), { supported: true, enabled: false, appId: APP_ID });
});

test('a saved opt-in does not override Windows Startup Apps if the user disabled it there', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'startup-settings.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, startAtLogin: true }));
  const item = fixture(file, { initial: true, startupAppEnabled: false });
  assert.deepEqual(item.settings.initialize(), { supported: true, enabled: false, appId: APP_ID });
  assert.equal(item.writes.length, 0);
});

test('development and non-Windows builds cannot create a login item', () => {
  for (const options of [{ platform: 'win32', packaged: false }, { platform: 'linux', packaged: true }]) {
    const item = fixture(path.join(os.tmpdir(), 'orvix-startup-disabled.json'), options);
    assert.deepEqual(item.settings.initialize(), { supported: false, enabled: false, appId: APP_ID });
    assert.throws(() => item.settings.setStartAtLogin(true), /installed Windows app/);
    assert.equal(item.writes.length, 0);
  }
});

test('main process no longer unconditionally enables the Windows login item', () => {
  assert.doesNotMatch(mainSource, /setLoginItemSettings\(\s*\{\s*openAtLogin\s*:\s*true/);
  assert.match(mainSource, /startupSettings\.initialize\(\)/);
});
