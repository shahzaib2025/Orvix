const { spawn } = require('node:child_process');

function batteryStatus(signal) {
  if (process.platform !== 'win32') throw new Error('Battery status is currently supported on Windows only.');
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(name)) delete env[name];
    const script = 'Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let failure = '';
    const collect = (current, chunk) => (current + chunk.toString()).slice(0, 4000);
    child.stdout.on('data', chunk => { output = collect(output, chunk); });
    child.stderr.on('data', chunk => { failure = collect(failure, chunk); });
    const stop = () => { if (child.exitCode === null && child.pid) child.kill(); };
    const timer = setTimeout(stop, 10000);
    signal.addEventListener('abort', stop, { once: true });
    child.on('error', error => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (signal.aborted) return reject(new Error('Task cancelled.'));
      if (code !== 0) return reject(new Error(`Windows battery query failed: ${failure.trim().slice(0, 300) || `exit ${code}`}`));
      if (!output.trim()) return resolve(JSON.stringify({ batteryPresent: false, message: 'Windows reports no battery on this device.' }));
      try {
        const values = JSON.parse(output);
        const batteries = (Array.isArray(values) ? values : [values]).map(value => ({
          percentage: Number(value.EstimatedChargeRemaining),
          batteryStatus: Number(value.BatteryStatus),
        }));
        if (batteries.some(value => !Number.isFinite(value.percentage))) throw new Error('Battery percentage was not reported.');
        resolve(JSON.stringify({ batteryPresent: true, batteries }));
      } catch (error) { reject(error); }
    });
    if (signal.aborted) stop();
  });
}

module.exports = { batteryStatus };
