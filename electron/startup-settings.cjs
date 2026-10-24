const fs = require('node:fs');
const path = require('node:path');

const APP_ID = 'com.orvix.desktop';
const LOGIN_ARGS = ['--hidden'];

function createStartupSettings({ app, file, platform = process.platform, packaged = app?.isPackaged === true, appId = APP_ID }) {
  const supported = platform === 'win32' && packaged === true;
  let preference = readPreference();

  function readPreference() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      return saved?.version === 1 && typeof saved.startAtLogin === 'boolean' ? saved.startAtLogin : null;
    } catch { return null; }
  }

  function loginOptions(enabled) {
    return {
      openAtLogin: enabled,
      enabled,
      name: appId,
      path: app.getPath('exe'),
      args: LOGIN_ARGS,
    };
  }

  function save(enabled) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, startAtLogin: enabled }), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  function get() {
    if (!supported) return { supported: false, enabled: false, appId };
    const settings = app.getLoginItemSettings({ path: app.getPath('exe'), args: LOGIN_ARGS });
    const matchingItems = (settings.launchItems ?? []).filter(item => item?.name === appId);
    const startupApproved = matchingItems.length === 0 || matchingItems.some(item => item.enabled !== false);
    return { supported: true, enabled: settings.openAtLogin === true && startupApproved, appId };
  }

  function initialize() {
    if (!supported) return get();
    // The previous packaged builds enabled login startup unconditionally.
    // Migrate fresh installs and explicit off settings to off; an explicit on
    // setting is already registered by the user's toggle, so leave Windows'
    // own Startup Apps switch authoritative on later launches.
    if (preference !== true) {
      app.setLoginItemSettings(loginOptions(false));
      if (preference === null) {
        save(false);
        preference = false;
      }
    }
    return get();
  }

  function setStartAtLogin(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Start at sign-in must be a boolean.');
    if (!supported) throw new Error('Start at sign-in is available in the installed Windows app.');
    const previous = get().enabled;
    app.setLoginItemSettings(loginOptions(enabled));
    try {
      save(enabled);
      preference = enabled;
    } catch (error) {
      try { app.setLoginItemSettings(loginOptions(previous)); } catch { /* Keep the original storage error. */ }
      throw error;
    }
    const result = get();
    if (result.enabled !== enabled) throw new Error(`Windows did not ${enabled ? 'enable' : 'disable'} Orvix at sign-in.`);
    return result;
  }

  return { get, initialize, setStartAtLogin, file };
}

module.exports = { APP_ID, LOGIN_ARGS, createStartupSettings };
