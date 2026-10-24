const fsDefault = require('node:fs');
const path = require('node:path');
const { execFileSync: execFileSyncDefault } = require('node:child_process');

function getNotificationAppUserModelId(appId, isPackaged) {
  // Electron's own Start Menu shortcut already claims `${appId}.development`
  // on some dev machines. Use a fresh Orvix identity so Windows cannot reuse
  // the stale Electron display-name/icon cached for the older development ID.
  return isPackaged ? appId : `${appId}.development.orvix.v3`;
}

function getTaskbarAppUserModelId(appId, isPackaged) {
  // Keep the development window grouped under a stable Orvix identity. Toasts
  // have their own AUMID so notification branding changes cannot rename or
  // detach the running app's taskbar button.
  return isPackaged ? appId : `${appId}.development`;
}

function samePath(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  return path.win32.resolve(first).toLowerCase() === path.win32.resolve(second).toLowerCase();
}

function startMenuRoots(env) {
  const user = env.APPDATA || (env.USERPROFILE && path.win32.join(env.USERPROFILE, 'AppData', 'Roaming'));
  const common = env.PROGRAMDATA || 'C:\\ProgramData';
  return [...new Set([
    user && path.win32.join(user, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    common && path.win32.join(common, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean))];
}

function ensureWindowsNotificationAppRegistration({ appUserModelId, displayName = 'Orvix', iconPath, platform = process.platform, fs = fsDefault, execFileSync = execFileSyncDefault }) {
  if (platform !== 'win32') return { registered: false, skipped: true, errors: [] };
  if (typeof appUserModelId !== 'string' || !appUserModelId.trim()
    || typeof displayName !== 'string' || !displayName.trim()
    || typeof iconPath !== 'string' || !path.win32.isAbsolute(iconPath)
    || !fs.existsSync(iconPath)) {
    return { registered: false, skipped: false, errors: ['The Orvix Windows notification name or icon is unavailable.'] };
  }

  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${appUserModelId}`;
  try {
    execFileSync('reg.exe', ['add', key, '/v', 'DisplayName', '/t', 'REG_EXPAND_SZ', '/d', displayName, '/f'], { windowsHide: true, stdio: 'ignore' });
    execFileSync('reg.exe', ['add', key, '/v', 'IconUri', '/t', 'REG_EXPAND_SZ', '/d', iconPath, '/f'], { windowsHide: true, stdio: 'ignore' });
    return { registered: true, skipped: false, errors: [] };
  } catch {
    return { registered: false, skipped: false, errors: ['Orvix notification branding could not be registered for this Windows account.'] };
  }
}

function findShortcuts(root, fs, depth = 0, result = []) {
  if (depth > 4) return result;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const fullPath = path.win32.join(root, entry.name);
    if (entry.isDirectory() && depth < 4) findShortcuts(fullPath, fs, depth + 1, result);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) result.push(fullPath);
  }
  return result;
}

function ensureWindowsNotificationShortcuts({ app, shell, appUserModelId, toastActivatorClsid, iconPath, platform = process.platform, env = process.env, fs = fsDefault, development = false, entryPath = process.argv[1] }) {
  if (platform !== 'win32' || (!app?.isPackaged && !development)) return { updated: 0, created: false, skipped: true, errors: [] };
  const target = app.getPath('exe');
  const roots = startMenuRoots(env);
  if (development) {
    const userRoot = roots[0];
    if (!userRoot || typeof entryPath !== 'string' || !path.win32.isAbsolute(entryPath)) {
      return { updated: 0, created: false, skipped: false, errors: ['The development Start Menu shortcut path is unavailable.'] };
    }
    if (typeof iconPath !== 'string' || !fs.existsSync(iconPath)) {
      return { updated: 0, created: false, skipped: false, errors: ['The Orvix icon is unavailable for the development notification shortcut.'] };
    }
    // Keep the development app identity distinct from Electron and the
    // installed app. Put the shortcut directly in Programs so Windows indexes
    // this AUMID against the Orvix name and icon instead of an Electron entry.
    const shortcut = path.win32.join(userRoot, 'Orvix.lnk');
    const args = `"${path.win32.resolve(entryPath)}"`;
    const errors = [];
    try {
      fs.mkdirSync(userRoot, { recursive: true });
      // Electron can stamp the running AUMID onto an existing generic
      // Electron.lnk. Move that link back to Electron's executable identity
      // before registering Orvix, otherwise Windows may pick its Electron
      // name/icon for notifications that share the AUMID.
      const electronShortcut = path.win32.join(userRoot, 'Electron.lnk');
      try {
        const currentElectronShortcut = shell.readShortcutLink(electronShortcut);
        if (samePath(currentElectronShortcut.target, target)
          && !String(currentElectronShortcut.args || '').trim()
          && currentElectronShortcut.appUserModelId !== target
          && !shell.writeShortcutLink(electronShortcut, 'update', {
            ...currentElectronShortcut, appUserModelId: target,
          })) {
          errors.push('The generic Electron shortcut could not be separated from Orvix notifications.');
        }
      } catch { /* No generic Electron shortcut needs repair. */ }
      let operation = 'create';
      try {
        const current = shell.readShortcutLink(shortcut);
        if (samePath(current.target, target) && current.args === args) operation = 'update';
      } catch { /* Create the dedicated development shortcut. */ }
      const details = {
        target, args, cwd: path.win32.dirname(path.win32.resolve(entryPath)),
        description: 'Orvix desktop application', icon: iconPath, iconIndex: 0,
        appUserModelId, toastActivatorClsid,
      };
      if (!shell.writeShortcutLink(shortcut, operation, details)) throw new Error('Shortcut creation failed.');
      return { updated: operation === 'update' ? 1 : 0, created: operation === 'create', shortcut, skipped: false, errors };
    } catch {
      return { updated: 0, created: false, skipped: false, errors: ['The development Start Menu notification shortcut could not be created.'] };
    }
  }
  const matches = [...new Set(roots.flatMap(root => findShortcuts(root, fs)))].filter(shortcut => {
    try { return samePath(shell.readShortcutLink(shortcut).target, target); } catch { return false; }
  });
  const errors = [];
  let updated = 0;
  for (const shortcut of matches) {
    try {
      const current = shell.readShortcutLink(shortcut);
      if (shell.writeShortcutLink(shortcut, 'update', { ...current, appUserModelId, toastActivatorClsid })) updated++;
    } catch { errors.push('A Start Menu shortcut could not be updated.'); }
  }
  if (updated && updated === matches.length) return { updated, created: false, skipped: false, errors };

  const userRoot = roots[0];
  if (!userRoot) return { updated: 0, created: false, skipped: false, errors: ['The user Start Menu path is unavailable.'] };
  const directory = path.win32.join(userRoot, 'Orvix');
  try {
    fs.mkdirSync(directory, { recursive: true });
    const candidates = ['Orvix.lnk', 'Orvix Agent Notifications.lnk', `Orvix Notifications ${process.pid}.lnk`];
    let shortcut = null;
    let operation = 'create';
    for (const candidate of candidates) {
      const candidatePath = path.win32.join(directory, candidate);
      if (!fs.existsSync(candidatePath)) { shortcut = candidatePath; break; }
      try {
        const existing = shell.readShortcutLink(candidatePath);
        if (samePath(existing.target, target)) { shortcut = candidatePath; operation = 'update'; break; }
      } catch { /* Try a new name instead of replacing an unreadable shortcut. */ }
    }
    if (!shortcut) throw new Error('No safe shortcut name is available.');
    const details = {
      target, cwd: path.win32.dirname(target), description: 'Orvix desktop application',
      icon: target, iconIndex: 0, appUserModelId, toastActivatorClsid,
    };
    if (!shell.writeShortcutLink(shortcut, operation, details)) throw new Error('Shortcut creation failed.');
    return { updated: 0, created: true, shortcut, skipped: false, errors };
  } catch {
    errors.push('The user Start Menu notification shortcut could not be created.');
    return { updated, created: false, skipped: false, errors };
  }
}

function ensureWindowsTaskbarShortcut({ app, shell, appUserModelId, iconPath, platform = process.platform, env = process.env, fs = fsDefault, development = false, entryPath = process.argv[1] }) {
  if (platform !== 'win32' || !app || app.isPackaged || !development) {
    return { updated: 0, created: false, skipped: true, errors: [] };
  }
  if (typeof appUserModelId !== 'string' || !appUserModelId.trim()
    || typeof entryPath !== 'string' || !path.win32.isAbsolute(entryPath)) {
    return { updated: 0, created: false, skipped: false, errors: ['The development taskbar identity or shortcut path is unavailable.'] };
  }
  if (typeof iconPath !== 'string' || !path.win32.isAbsolute(iconPath) || !fs.existsSync(iconPath)) {
    return { updated: 0, created: false, skipped: false, errors: ['The Orvix icon is unavailable for the development taskbar shortcut.'] };
  }

  const target = app.getPath('exe');
  const userRoot = startMenuRoots(env)[0];
  if (!userRoot) return { updated: 0, created: false, skipped: false, errors: ['The user Start Menu path is unavailable.'] };
  const directory = path.win32.join(userRoot, 'Orvix');
  const shortcut = path.win32.join(directory, 'Orvix Development.lnk');
  const args = `"${path.win32.resolve(entryPath)}"`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    let operation = 'create';
    try {
      const current = shell.readShortcutLink(shortcut);
      if (!samePath(current.target, target)) {
        return { updated: 0, created: false, shortcut, skipped: false, errors: ['The development taskbar shortcut belongs to a different application.'] };
      }
      operation = 'update';
    } catch { /* Create the dedicated development taskbar shortcut. */ }
    const details = {
      target, args, cwd: path.win32.dirname(path.win32.resolve(entryPath)),
      description: 'Orvix desktop application', icon: iconPath, iconIndex: 0,
      appUserModelId,
    };
    if (!shell.writeShortcutLink(shortcut, operation, details)) throw new Error('Shortcut creation failed.');
    return { updated: operation === 'update' ? 1 : 0, created: operation === 'create', shortcut, skipped: false, errors: [] };
  } catch {
    return { updated: 0, created: false, shortcut, skipped: false, errors: ['The development taskbar shortcut could not be created.'] };
  }
}

module.exports = { ensureWindowsNotificationShortcuts, ensureWindowsTaskbarShortcut, ensureWindowsNotificationAppRegistration, getNotificationAppUserModelId, getTaskbarAppUserModelId, startMenuRoots, findShortcuts, samePath };
