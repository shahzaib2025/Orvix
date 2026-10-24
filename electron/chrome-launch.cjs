const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

function profileSettingsPath() {
  return path.join(process.env.LOCALAPPDATA || '', 'PCMonitorTest', 'browser-profile.json');
}
function findPairedProfile(extensionId, token, userData = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')) {
  if (!/^[a-p]{32}$/.test(extensionId || '') || !/^[a-f0-9]{64}$/i.test(token || '')) return null;
  let profiles;
  try { profiles = fs.readdirSync(userData).filter(name => name === 'Default' || /^Profile \d+$/.test(name)); } catch { return null; }
  const matches = [];
  for (const profile of profiles) {
    const storage = path.join(userData, profile, 'Local Extension Settings', extensionId);
    try {
      // Inspect only this companion's own storage, never other extensions/data.
      const files = fs.readdirSync(storage).filter(name => /\.(log|ldb)$/.test(name)).map(name => ({ name, size: fs.statSync(path.join(storage, name)).size })).filter(file => file.size <= 8 * 1024 * 1024);
      if (files.some(file => fs.readFileSync(path.join(storage, file.name)).includes(Buffer.from(token)))) matches.push(profile);
    } catch { /* A profile may be locked, removed or not paired. */ }
  }
  return matches.length === 1 ? { userData, profile: matches[0], extensionId } : null;
}
function rememberPairedProfile(extensionId, token) {
  try {
    const paired = findPairedProfile(extensionId, token);
    // Extension identity also helps find the paired profile after first setup.
    let saved = {}; try { saved = JSON.parse(fs.readFileSync(profileSettingsPath(), 'utf8')); } catch {}
    fs.mkdirSync(path.dirname(profileSettingsPath()), { recursive: true });
    fs.writeFileSync(profileSettingsPath(), JSON.stringify(paired || { ...(saved.extensionId === extensionId ? saved : {}), extensionId }));
  } catch { /* Pairing and control do not depend on optional startup metadata. */ }
}
async function launchChrome({ token } = {}) {
  if (process.platform !== 'win32') throw new Error('Automatic Chrome startup is currently supported on Windows.');
  const candidates = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  let executable = candidates.find(file => fs.existsSync(file));
  if (!executable) {
    for (const root of ['HKCU', 'HKLM']) {
      const output = await new Promise(resolve => execFile('reg.exe',
        ['query', `${root}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe`, '/ve'],
        { windowsHide: true, timeout: 3000 }, (error, stdout) => resolve(error ? '' : stdout)));
      const registered = /REG_SZ\s+(.+)/i.exec(output)?.[1]?.trim().replace(/^"|"$/g, '');
      if (registered && fs.existsSync(registered)) { executable = registered; break; }
    }
  }
  if (!executable) throw new Error('Google Chrome could not be found. Install Chrome with the Orvix companion extension.');
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(profileSettingsPath(), 'utf8')); } catch {}
  const paired = findPairedProfile(saved.extensionId, token) || saved;
  const args = paired.userData && /^(Default|Profile \d+)$/.test(paired.profile) && fs.existsSync(path.join(paired.userData, paired.profile))
    ? [`--user-data-dir=${paired.userData}`, `--profile-directory=${paired.profile}`, 'about:blank'] : ['about:blank'];
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { launchChrome, findPairedProfile, rememberPairedProfile };
