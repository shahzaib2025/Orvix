const path = require('node:path');
const { observationAt } = require('./tiny-signal-freshness.cjs');
const numeric = new Set(['brightness_percent', 'volume_percent', 'battery_percent', 'cpu_percent', 'memory_percent', 'disk_free_percent']);
const labels = { brightness_percent: 'Brightness', volume_percent: 'Volume', battery_percent: 'Battery', cpu_percent: 'CPU usage', memory_percent: 'Memory usage', disk_free_percent: 'Free disk space', muted: 'Muted', charging: 'Charging', on_ac: 'Power connected', network_online: 'Network reachable', fullscreen: 'Fullscreen', active_app: 'Active app', file_exists: 'File exists' };
const key = w => `${w.signal}:${w.target || ''}`;
function validateChange(raw) {
  if (raw == null) return undefined;
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  check(raw.type === 'change', 'Unsupported trigger type.');
  check(Array.isArray(raw.watches) && raw.watches.length > 0 && raw.watches.length <= 12, 'Select 1 to 12 change signals.');
  const settleSeconds = raw.settleSeconds ?? 1;
  check(Number.isFinite(settleSeconds) && settleSeconds >= 0 && settleSeconds <= 60, 'Settling time must be 0 to 60 seconds.');
  const watches = raw.watches.map(w => {
    check(w && Object.hasOwn(labels, w.signal), 'Unsupported change signal.');
    const target = typeof w.target === 'string' ? w.target.trim() : '';
    if (w.signal === 'disk_free_percent') check(/^[A-Za-z]:$/.test(target), 'Choose a drive such as C:.');
    if (w.signal === 'file_exists') check(target.length <= 1024 && path.isAbsolute(target) && !target.startsWith('\\\\'), 'Choose an absolute local file path.');
    const direction = w.direction ?? 'any', minDelta = w.minDelta ?? 1;
    check(['any', 'increase', 'decrease'].includes(direction), 'Choose a supported change direction.');
    check(numeric.has(w.signal) || direction === 'any', 'Direction only applies to numeric changes.');
    check(Number.isFinite(minDelta) && minDelta > 0 && minDelta <= 100, 'Minimum change must be greater than 0 and at most 100 percentage points.');
    const advanced = {};
    if (w.evaluation !== undefined) {
      check(['settled', 'window'].includes(w.evaluation), 'Choose settled or rolling-window evaluation.');
      check(w.evaluation !== 'window' || ['cpu_percent', 'memory_percent'].includes(w.signal), 'Rolling windows apply to CPU and memory.');
      advanced.evaluation = w.evaluation;
      if (w.evaluation === 'window') {
        advanced.windowSeconds = w.windowSeconds ?? 10;
        check(Number.isFinite(advanced.windowSeconds) && advanced.windowSeconds >= 3 && advanced.windowSeconds <= 600, 'A rolling window must be 3 to 600 seconds.');
      }
    }
    return { signal: w.signal, target: w.signal === 'disk_free_percent' ? target.toUpperCase() : w.signal === 'file_exists' ? target : '', direction, minDelta, ...advanced };
  });
  check(new Set(watches.map(key)).size === watches.length, 'Each change signal and target must be unique.');
  return { type: 'change', watches, settleSeconds };
}
function reading(w, fresh) {
  const scalar = { brightness_percent: fresh.Brightness, volume_percent: fresh.VolumePrecise ?? fresh.Volume, muted: fresh.Muted, battery_percent: fresh.BatteryPercent, on_ac: fresh.OnAcPower, charging: fresh.Charging, fullscreen: fresh.Activity?.IsPresentationOrFullscreen, active_app: fresh.Windows?.find(x => x.Active)?.App };
  const sensor = ['cpu_percent', 'memory_percent', 'network_online', 'disk_free_percent', 'file_exists'].includes(w.signal);
  const actual = w.signal === 'disk_free_percent' ? fresh.System?.disks?.[w.target] : w.signal === 'file_exists' ? fresh.Files?.[w.target]?.error ? null : fresh.Files?.[w.target]?.exists : sensor ? fresh.System?.[w.signal] : scalar[w.signal];
  const valid = numeric.has(w.signal) ? typeof actual === 'number' && Number.isFinite(actual) : w.signal === 'active_app' ? typeof actual === 'string' && actual.length > 0 : typeof actual === 'boolean';
  return { actual: valid ? actual : null, at: sensor ? observationAt(fresh, w.signal, w.target) : fresh.PcObservedAt, source: fresh.SignalSources?.[w.signal] || '', maxGap: sensor ? ['network_online','disk_free_percent'].includes(w.signal) ? 45000 : 15000 : 10000 };
}
function observe(trigger, states, fresh, now, options = {}) {
  const changes = [], previews = [];
  for (const w of trigger.watches) {
    const k = key(w), r = reading(w, fresh); let s = states.get(k);
    if (r.actual === null || Number.isFinite(r.at) && (r.at <= 0 || now - r.at > r.maxGap)) { states.delete(k); previews.push({ ...w, actual: null, baseline: null, pending: false, settleRemaining: 0 }); continue; }
    if (!s || s.source !== r.source || r.at - s.seenAt > r.maxGap) {
      s = { baseline: r.actual, latest: r.actual, min: r.actual, max: r.actual, source: r.source, seenAt: r.at, changedAt: null, samples: [{ at: r.at, value: r.actual }] }; states.set(k, s);
    } else {
      if (w.evaluation === 'window') {
        if (r.at !== s.seenAt) s.samples.push({ at: r.at, value: r.actual });
        s.samples = s.samples.filter(sample => now - sample.at <= w.windowSeconds * 1000).slice(-601);
        if(!s.samples.length){previews.push({...w,actual:null,baseline:s.baseline,pending:true,settleRemaining:0});continue;}
        const mean = s.samples.reduce((sum, sample) => sum + sample.value, 0) / s.samples.length;
        s.min = Math.min(s.min, r.actual); s.max = Math.max(s.max, r.actual);
        if (r.actual !== s.baseline && s.changedAt === null) s.changedAt = now;
        s.latest = mean; s.seenAt = r.at;
        if (s.changedAt !== null && now - s.changedAt >= w.windowSeconds * 1000) {
          const delta = mean - s.baseline;
          if (Math.abs(delta) >= w.minDelta && (w.direction === 'any' || (w.direction === 'increase' ? delta > 0 : delta < 0))) {
            changes.push({ ...w, before: s.baseline, after: mean, min: s.min, max: s.max, at: now, settledAt: now, receiptAt: now, origin: 'rolling_window', count: 1 });
            s.baseline = mean;
          }
          s.changedAt = null; s.min = r.actual; s.max = r.actual;
        }
        previews.push({ ...w, actual: r.actual, baseline: s.baseline, average: mean, pending: s.changedAt !== null, settleRemaining: s.changedAt === null ? 0 : Math.max(0, w.windowSeconds - (now - s.changedAt) / 1000) });
        continue;
      }
      s.seenAt = r.at;
      if (numeric.has(w.signal)) { s.min = Math.min(s.min, r.actual); s.max = Math.max(s.max, r.actual); }
      if (s.latest !== r.actual) { s.latest = r.actual; s.changedAt = now; s.receiptAt = options.receiptAt ?? now; s.origin = options.origin || "poll"; s.context = options.context; s.sequence = options.sequence; }
      if (options.settle !== false && s.changedAt !== null && now - s.changedAt >= trigger.settleSeconds * 1000) {
        const delta = numeric.has(w.signal) ? s.latest - s.baseline : null;
        const qualifies = delta === null ? s.latest !== s.baseline : Math.abs(delta) >= w.minDelta && (w.direction === 'any' || (w.direction === 'increase' ? delta > 0 : delta < 0));
        if (qualifies) { changes.push({ ...w, before: s.baseline, after: s.latest, ...(delta !== null ? { min: s.min, max: s.max } : {}), at: now, settledAt: now, receiptAt: s.receiptAt, origin: s.origin, device: s.source, context: s.context, sequence: s.sequence, count: 1 }); s.baseline = s.latest; s.min = s.latest; s.max = s.latest; }
        // Keep sub-threshold changes accumulated; rebase movements in the opposite direction.
        else if (delta !== null && ((w.direction === 'increase' && delta < 0) || (w.direction === 'decrease' && delta > 0))) s.baseline = s.latest;
        s.changedAt = null;
      }
    }
    previews.push({ ...w, actual: r.actual, baseline: s.baseline, pending: s.changedAt !== null, settleRemaining: s.changedAt === null ? 0 : Math.max(0, trigger.settleSeconds - (now - s.changedAt) / 1000) });
  }
  return { changes, previews };
}
function mergeChanges(old = [], incoming = []) {
  const merged = new Map(old.map(c => [key(c), { ...c }]));
  for (const c of incoming) { const prior = merged.get(key(c)); merged.set(key(c), prior ? { ...c, before: prior.before, count: prior.count + c.count, ...(numeric.has(c.signal) ? { min: Math.min(prior.min ?? prior.before, c.min ?? c.before, prior.after, c.after), max: Math.max(prior.max ?? prior.before, c.max ?? c.before, prior.after, c.after) } : {}) } : { ...c }); }
  return [...merged.values()];
}
function formatChanges(changes) {
  const value = (w, x) => numeric.has(w.signal) ? `${Math.round(x * 100) / 100}%` : typeof x === 'boolean' ? x ? 'yes' : 'no' : x;
  return changes.map(c => `${labels[c.signal]}${c.target ? ` (${c.target})` : ''}: ${value(c, c.before)} → ${value(c, c.after)}${c.min !== undefined && c.max !== undefined && (c.count > 1 || c.origin === 'rolling_window') ? ` (range ${value(c,c.min)}–${value(c,c.max)}; ${c.count} change${c.count === 1 ? '' : 's'})` : ''}`).join('; ');
}
module.exports = { validateChange, observe, reading, mergeChanges, formatChanges };
