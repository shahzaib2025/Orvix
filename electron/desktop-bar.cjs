const fs = require('node:fs');
const path = require('node:path');

function createDesktopBar({ app, BrowserWindow, ipcMain, screen, shell, file = path.join(app.getPath('userData'), 'desktop-bar-settings.json'), platform = process.platform, onChange = () => {}, createView }) {
  const supported = platform === 'win32';
  let enabled = false;
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); enabled = saved.version === 1 && saved.enabled === true; } catch {}
  if (!supported) enabled = false;
  let status = 'off', error = '', view = null, generation = 0, disposed = false;
  let queue = Promise.resolve();
  const getState = () => ({ supported, enabled, status, error });
  const publish = (next, message = '') => { status = next; error = message; onChange(getState()); };
  function save(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify({ version: 1, enabled: next }), { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  async function stopView() {
    const old = view;
    if (!old) return;
    old.deactivate();
    await old.dispose();
    if (view === old) view = null;
  }
  function setEnabled(next, persist = true) {
    if (typeof next !== 'boolean') return Promise.reject(new Error('Choose whether the desktop top bar is enabled.'));
    if (disposed && next) return Promise.reject(new Error('Orvix is closing.'));
    if (!supported && next) return Promise.reject(new Error('The desktop top bar is available on Windows.'));
    if (next === enabled && (next ? status === 'on' : status === 'off')) return Promise.resolve(getState());
    if (next === enabled && status === 'starting') return queue.then(getState);
    let persistenceFailure;
    if (persist) {
      try { save(next); }
      catch (failure) { if (next) return Promise.reject(failure); persistenceFailure = failure; }
    }
    enabled = next;
    const token = ++generation;
    if (!next) view?.deactivate();
    publish(next ? 'starting' : 'stopping');
    const operation = queue.then(async () => {
      if (token !== generation) return getState();
      if (next && view && status === 'on') return getState();
      await stopView();
      if (token !== generation) return getState();
      if (!next) {
        publish(persistenceFailure ? 'error' : 'off', persistenceFailure ? 'The top bar stopped, but its disabled preference could not be saved. ' + persistenceFailure.message : '');
        return getState();
      }
      const candidate = (createView || require('./desktop-bar/window.cjs').createDesktopBarView)({
        app, BrowserWindow, ipcMain, screen, shell,
        onClose: () => { void setEnabled(false).catch(() => {}); },
        onFailure: failure => {
          if (view !== candidate || token !== generation || disposed) return;
          const message = failure instanceof Error ? failure.message : String(failure);
          void setEnabled(false).then(() => { if (!enabled && !disposed) publish('error', message); }).catch(cleanup => publish('error', cleanup.message));
        },
      });
      view = candidate;
      await candidate.start();
      if (token !== generation || disposed) { await stopView(); return getState(); }
      publish('on');
      return getState();
    }).catch(async failure => {
      if (token !== generation) return getState();
      enabled = false;
      try { save(false); } catch {}
      let message = failure.message || String(failure);
      try { await stopView(); } catch (cleanup) { message += ` Cleanup needs attention: ${cleanup.message}`; }
      publish('error', message);
      return getState();
    });
    queue = operation.catch(() => {});
    return operation;
  }
  function shutdown() {
    disposed = true;
    ++generation;
    enabled = false; // Preserve the saved choice for the next Orvix launch.
    view?.deactivate();
    publish('stopping');
    const operation = queue.then(stopView).then(() => { publish('off'); });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    getState, setEnabled, shutdown,
    initialize: () => enabled ? setEnabled(true, false) : Promise.resolve(getState()),
    diagnostics: () => view?.diagnostics() || { windows: 0, timers: 0, handlers: 0, helpers: 0, pending: 0, helperTimers: 0 },
  };
}
module.exports = { createDesktopBar };
