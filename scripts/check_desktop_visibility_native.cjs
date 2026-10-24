const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { startDesktop } = require('./start-desktop.cjs');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-window-visibility-'));
  const fixture = path.join(directory, 'fixture.cjs');
  fs.writeFileSync(fixture, `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    app.setPath('userData', process.env.ORVIX_VISIBILITY_PROFILE);
    app.setAppUserModelId('com.orvix.desktop.visibility-check');
    app.whenReady().then(() => {
      const window = new BrowserWindow({
        show: false, skipTaskbar: false, width: 360, height: 180,
        title: 'Orvix startup visibility check',
      });
      window.once('ready-to-show', () => {
        if (!process.argv.includes('--hidden')) window.show();
        setTimeout(() => {
          fs.writeFileSync(process.env.ORVIX_VISIBILITY_RESULT, JSON.stringify({
            visible: window.isVisible(), minimized: window.isMinimized(),
          }));
          console.log('Visibility fixture completed');
          window.destroy(); app.quit();
        }, 150);
      });
      window.loadURL('data:text/html,<body>Orvix startup visibility check</body>');
    }).catch(error => { console.error(error); app.exit(1); });
  `);
  try {
    for (const hidden of [false, true]) {
      const resultFile = path.join(directory, `result-${hidden}.json`);
      const env = { ...process.env,
        ORVIX_VISIBILITY_RESULT: resultFile,
        ORVIX_VISIBILITY_PROFILE: path.join(directory, `profile-${hidden}`),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      const stdout = new PassThrough(), stderr = new PassThrough();
      let output = '', errors = '';
      stdout.on('data', chunk => { output += chunk; });
      stderr.on('data', chunk => { errors += chunk; });
      const code = await new Promise(resolve => startDesktop({
        args: hidden ? [fixture, '--hidden'] : [fixture], env,
        stdout, stderr, signals: new EventEmitter(), onExit: resolve,
      }));
      assert.equal(code, 0, errors);
      const state = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      assert.equal(state.visible, !hidden, hidden ? 'Explicit hidden startup must stay hidden' : 'Manual startup must show the main window');
      assert.equal(state.minimized, false);
      assert.match(output, /Visibility fixture completed/, 'Terminal logs must remain available');
      console.log(`PASS: ${hidden ? 'hidden startup stays hidden' : 'manual startup shows the window'}; logs relayed`);
    }
  } finally {
    // Remove only the uniquely allocated fixture under the temporary directory.
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('orvix-window-visibility-')) {
      try { fs.rmSync(directory, { recursive: true, force: true }); }
      catch (error) { console.warn(`Fixture cleanup: ${error.message}`); }
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
