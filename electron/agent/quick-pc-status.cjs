const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function isSimplePcStatusRequest(value) {
  return typeof value === 'string'
    && /^\s*(?:(?:hey|please|can you)\s+)?(?:chk|check)\s+(?:my\s+)?(?:pc|computer|system)\s+(?:status|health)\s*[?.!]*\s*$/i.test(value);
}

function cpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total, count: cpus.length };
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Task cancelled.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Task cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function readBattery(now = Date.now()) {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const file = path.join(local, 'PCMonitorTest', 'current-state.json');
  try {
    const modifiedAt = fs.statSync(file).mtimeMs;
    if (now - modifiedAt > 10000 || modifiedAt > now + 2000) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!state || typeof state !== 'object') return null;
    return {
      batteryPercent: Number.isFinite(state.BatteryPercent) ? state.BatteryPercent : null,
      onAcPower: typeof state.OnAcPower === 'boolean' ? state.OnAcPower : null,
      charging: typeof state.Charging === 'boolean' ? state.Charging : null,
      observedAt: modifiedAt,
    };
  } catch { return null; }
}

function readSystemDrive() {
  const root = path.parse(process.env.SystemRoot || process.cwd()).root;
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const stat = fs.statfsSync(root);
    const totalBytes = stat.blocks * stat.bsize;
    const freeBytes = (stat.bavail ?? stat.bfree) * stat.bsize;
    if (!(totalBytes > 0) || !(freeBytes >= 0)) return null;
    return { root, totalBytes, freeBytes };
  } catch { return null; }
}

function gb(bytes) { return `${(bytes / (1024 ** 3)).toFixed(1)} GB`; }
function duration(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

async function collectQuickPcStatus({ signal, sampleMs = 400, now = Date.now } = {}) {
  const first = cpuTimes();
  await delay(sampleMs, signal);
  const second = cpuTimes();
  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  const cpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null;
  const cpus = os.cpus();
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const disk = readSystemDrive();
  const capturedAt = now();
  const battery = readBattery(capturedAt);
  const osName = typeof os.version === 'function' ? os.version() : `${os.type()} ${os.release()}`;
  const fields = {
    capturedAt,
    os: osName,
    osRelease: os.release(),
    uptimeSeconds: os.uptime(),
    cpu: { model: cpus[0]?.model?.trim() || null, logicalCores: cpus.length, sampleMs, percent: cpuPercent },
    memory: { totalBytes: memoryTotal, freeBytes: memoryFree, usedPercent: memoryTotal ? (1 - memoryFree / memoryTotal) * 100 : null },
    systemDrive: disk,
    battery,
  };
  const lines = [
    `**PC status — quick local snapshot (${new Date(capturedAt).toLocaleTimeString()})**`,
    `- OS: ${osName} (build ${os.release()}); uptime ${duration(os.uptime())}.`,
    `- CPU: ${fields.cpu.model ?? 'model unavailable'}; ${cpus.length} logical cores; ${cpuPercent === null ? 'usage unavailable' : `${cpuPercent.toFixed(0)}% over a ${sampleMs} ms sample`} (snapshot, not sustained load).`,
    `- RAM: ${gb(memoryFree)} free of ${gb(memoryTotal)} (${fields.memory.usedPercent === null ? 'usage unavailable' : `${fields.memory.usedPercent.toFixed(0)}% used`}).`,
    disk ? `- System drive ${disk.root}: ${gb(disk.freeBytes)} free of ${gb(disk.totalBytes)} (${(100 * disk.freeBytes / disk.totalBytes).toFixed(0)}% free).` : '- System-drive free space: unavailable.',
  ];
  if (battery) {
    const power = battery.onAcPower === true ? 'AC power connected' : battery.onAcPower === false ? 'running on battery' : 'power source unavailable';
    const charge = battery.charging === true ? 'charging' : battery.charging === false ? 'not actively charging' : 'charging state unavailable';
    const percent = battery.batteryPercent === null ? 'charge level unavailable' : `${battery.batteryPercent}% battery`;
    lines.push(`- Power: ${power}; ${percent}; ${charge}.`);
  } else lines.push('- Battery details: no fresh local battery snapshot was available.');
  lines.push('- This quick check skips per-process CPU ranking and sustained-load sampling.');
  return { text: lines.join('\n'), fields };
}

module.exports = { isSimplePcStatusRequest, collectQuickPcStatus };
