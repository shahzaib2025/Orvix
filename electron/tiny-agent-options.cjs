const path = require('node:path');
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function text(value, max = 240) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function clock(value) { requireValue(typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'Use a time in HH:MM format.'); return value; }
function timezone(value) {
  const zone = text(value, 80) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { throw new Error('Choose a valid time zone.'); }
  return zone;
}
function validateSchedule(raw) {
  if (!raw || raw.mode === 'always') return { mode: 'always', timezone: timezone(raw?.timezone) };
  requireValue(['daily', 'window', 'once'].includes(raw.mode), 'Choose a supported schedule.');
  const zone = timezone(raw.timezone);
  if (raw.mode === 'once') {
    const at = Number(raw.at);
    requireValue(Number.isFinite(at) && at > 0, 'Choose a reminder date and time.');
    return { mode: 'once', at, timezone: zone, missed: raw.missed === 'catch_up' ? 'catch_up' : 'skip' };
  }
  const days = raw.days ?? [0, 1, 2, 3, 4, 5, 6];
  requireValue(Array.isArray(days) && days.length > 0 && days.length <= 7 && days.every(d => Number.isInteger(d) && d >= 0 && d <= 6), 'Choose at least one day of the week.');
  const result = { mode: raw.mode, timezone: zone, days: [...new Set(days)], start: clock(raw.start), missed: raw.missed === 'catch_up' ? 'catch_up' : 'skip' };
  if (raw.mode === 'window') result.end = clock(raw.end);
  return result;
}
function validatePolicy(raw = {}) {
  const maxPerDay = Number(raw.maxPerDay ?? 0), cooldownSeconds = Number(raw.cooldownSeconds ?? 0);
  requireValue(Number.isInteger(maxPerDay) && maxPerDay >= 0 && maxPerDay <= 1000, 'Daily alert limit must be 0 to 1000.');
  requireValue(Number.isInteger(cooldownSeconds) && cooldownSeconds >= 0 && cooldownSeconds <= 86400, 'Cooldown must be 0 to 86400 seconds.');
  const advanced = {};
  if (raw.expiresAfterSeconds !== undefined) {
    requireValue(Number.isInteger(raw.expiresAfterSeconds) && raw.expiresAfterSeconds >= 0 && raw.expiresAfterSeconds <= 604800, 'Alert expiry must be 0 to 604800 seconds.');
    advanced.expiresAfterSeconds = raw.expiresAfterSeconds;
  }
  if (raw.discardRecovered !== undefined) { requireValue(typeof raw.discardRecovered === 'boolean', 'Choose whether to discard recovered alerts.'); advanced.discardRecovered = raw.discardRecovered; }
  return { maxPerDay, cooldownSeconds, deferFullscreen: !!raw.deferFullscreen, ...advanced,
    quietHours: raw.quietHours?.enabled ? { enabled: true, start: clock(raw.quietHours.start), end: clock(raw.quietHours.end) } : { enabled: false } };
}
function validateAction(raw) {
  requireValue(raw && ['notify', 'shutdown', 'open_url', 'open_path', 'focus_app', 'minimize_app'].includes(raw.type), 'Choose a supported action.');
  const action = { type: raw.type, message: text(raw.message) };
  if (raw.type === 'open_url') {
    let url;
    try { url = new URL(raw.target); } catch { throw new Error('Enter a complete http or https URL.'); }
    requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Use an http or https URL without credentials.');
    action.target = url.href;
  }
  if (raw.type === 'open_path') {
    const target = text(raw.target, 1024);
    requireValue(path.isAbsolute(target) && !target.startsWith('\\\\'), 'Choose an absolute local file or app path.');
    action.target = path.normalize(target);
  }
  if (['focus_app', 'minimize_app'].includes(raw.type)) {
    action.target = text(raw.target, 120);
    requireValue(action.target, 'Choose an application for this action.');
  }
  return action;
}
const formatters = new Map(), nextCache = new Map();
function localParts(now, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function minute(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
function inWindow(current, start, end) { const a = minute(start), b = minute(end); return a === b || (a < b ? current >= a && current < b : current >= a || current < b); }
function scheduleState(schedule, now, lastKey) {
  const s = schedule || { mode: 'always' };
  if (s.mode === 'always') return { allowed: true, key: null };
  if (s.mode === 'once') {
    const key = `once:${s.at}`;
    return { allowed: now >= s.at && (s.missed === 'catch_up' || now - s.at < 60000) && lastKey !== key, key };
  }
  const p = localParts(now, s.timezone);
  if (s.mode === 'window') {
    const overnightPreviousDay = minute(s.start) > minute(s.end) && p.minute < minute(s.end);
    return { allowed: s.days.includes(overnightPreviousDay ? (p.day + 6) % 7 : p.day) && inWindow(p.minute, s.start, s.end), key: null };
  }
  const key = `${p.date}:${s.start}`;
  return { allowed: s.days.includes(p.day) && (s.missed === 'catch_up' ? p.minute >= minute(s.start) : p.minute === minute(s.start)) && lastKey !== key, key };
}
function nextRun(schedule, now, lastKey) {
  if (!schedule || schedule.mode === 'always') return null;
  if (schedule.mode === 'once') return lastKey === `once:${schedule.at}` ? null : schedule.at >= now ? schedule.at : schedule.missed === 'catch_up' ? now : null;
  const cacheKey = `${JSON.stringify(schedule)}:${lastKey}:${Math.floor(now / 60000)}`;
  if (nextCache.has(cacheKey)) { const cached = nextCache.get(cacheKey); return cached === null ? null : Math.max(now, cached); }
  // Calendar conversion through Intl handles timezone offsets and DST transitions.
  for (let at = Math.floor(now / 60000) * 60000; at <= now + 8 * 86400000; at += 60000) {
    if (scheduleState(schedule, at, lastKey).allowed) { if (nextCache.size > 128) nextCache.clear(); nextCache.set(cacheKey, at); return Math.max(now, at); }
  }
  nextCache.set(cacheKey, null); return null;
}
module.exports = { validateSchedule, validatePolicy, validateAction, localParts, inWindow, scheduleState, nextRun };
