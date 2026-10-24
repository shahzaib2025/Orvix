const fs = require('node:fs');
function readNativeSnapshot(file, { ensureRunning = () => {}, readState, now = Date.now } = {}) {
  ensureRunning();
  try {
    const at = fs.statSync(file).mtimeMs;
    const state = readState ? readState() : JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!state || at !== fs.statSync(file).mtimeMs || now() - at > 10000 || at > now() + 2000) return { status: 'unavailable', observedAt: now(), reason: 'No consistent fresh sensor snapshot.' };
    return { status: 'ok', observedAt: at, sensors: {
      brightness: { value: state.Brightness ?? null, source: state.SignalSources?.brightness || 'PC Monitor' },
      volume: { value: state.Volume ?? null, source: state.SignalSources?.volume || 'PC Monitor' },
      battery: { value: state.BatteryPercent ?? null, source: state.SignalSources?.battery || 'PC Monitor' },
    } };
  } catch { return { status: 'unavailable', observedAt: now(), reason: 'Sensor snapshot is unavailable.' }; }
}
module.exports = { readNativeSnapshot };
