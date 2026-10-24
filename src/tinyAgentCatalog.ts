import type { TinyAction, TinyCondition, TinyPolicy, TinyPredicate, TinySchedule, TinyChangeTrigger } from './desktop';
export const signalNames: Record<string, string> = {
  always: 'No extra condition', battery_percent: 'Battery level', on_ac: 'Connected to power', charging: 'Charging', window_state: 'Window state', active_app: 'Active app', idle_seconds: 'Idle time', browser_tab: 'Browser tab', browser_video: 'Browser video', media_session: 'Media session', volume_percent: 'Volume', muted: 'Muted', brightness_percent: 'Brightness', active_seconds: 'Active PC time today', app_active_seconds: 'App time today', fullscreen: 'Fullscreen / presenting', browser_download: 'Download finished', file_exists: 'File exists', folder_new_file: 'New file in folder', network_online: 'Network reachable', cpu_percent: 'CPU usage', memory_percent: 'Memory usage', disk_free_percent: 'Free disk space',
};
export const numeric = new Set(['battery_percent','idle_seconds','volume_percent','brightness_percent','active_seconds','app_active_seconds','cpu_percent','memory_percent','disk_free_percent']);
export const boolean = new Set(['always','on_ac','charging','muted','fullscreen','network_online','file_exists']);
export const comparisons: Record<string, string> = { eq: 'is', neq: 'is not', lt: 'below', lte: 'at or below', gt: 'above', gte: 'at or above', contains: 'contains' };
export const actionNames: Record<TinyAction['type'], string> = { notify: 'Notify me', shutdown: 'Shut down PC', open_url: 'Open website', open_path: 'Open file or app', focus_app: 'Focus app window', minimize_app: 'Minimize app window' };
export function defaultSchedule(): TinySchedule { return { mode: 'always', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, start: '09:00', end: '17:00', days: [1,2,3,4,5], missed: 'skip' }; }
export function defaultPolicy(): TinyPolicy { return { maxPerDay: 0, cooldownSeconds: 0, deferFullscreen: false, quietHours: { enabled: false, start: '22:00', end: '08:00' } }; }
export function newRow(signal = 'battery_percent'): TinyPredicate {
  const value = numeric.has(signal) ? signal === 'battery_percent' ? 80 : signal.includes('active_seconds') ? 2700 : signal === 'disk_free_percent' ? 10 : 0 : boolean.has(signal) ? true : signal === 'window_state' ? 'minimized' : signal === 'browser_download' ? 'complete' : signal === 'folder_new_file' ? '*' : '';
  return { op: 'predicate', signal, comparator: signal === 'folder_new_file' ? 'contains' : numeric.has(signal) ? signal.includes('active_seconds') ? 'gte' : 'lte' : 'eq', value, target: signal === 'disk_free_percent' ? 'C:' : '', field: ['browser_tab','browser_video','media_session'].includes(signal) ? 'title' : '', scope: 'any' };
}
export function flatten(c: TinyCondition): TinyPredicate[] { return c.op === 'predicate' ? [c] : c.children.flatMap(flatten); }
export function describe(p: TinyPredicate): string {
  if (p.signal === 'always') return 'Whenever the schedule is due';
  const suffix = numeric.has(p.signal) ? ['idle_seconds','active_seconds','app_active_seconds'].includes(p.signal) ? ' seconds' : '%' : '';
  return `${p.target ? `${p.target} · ` : ''}${signalNames[p.signal] || p.signal}${p.field ? ` ${p.field}` : ''} ${comparisons[p.comparator] || p.comparator} ${typeof p.value === 'boolean' ? p.value ? 'yes' : 'no' : p.value}${suffix}${p.signal === 'window_state' ? ` · ${p.scope || 'any'} windows` : ''}`;
}
export function describeCondition(c: TinyCondition): string { return c.op === 'predicate' ? describe(c) : `(${c.children.map(describeCondition).join(c.op === 'any' ? ' OR ' : ' AND ')})`; }
export type TinyTemplate = { name: string; description: string; rows: TinyPredicate[]; trigger?: TinyChangeTrigger; schedule?: TinySchedule; policy?: TinyPolicy; holdSeconds?: number; fireOnApproval?: boolean; message: string };
export const templates: TinyTemplate[] = [
  { name: 'Brightness changed', description: 'Even a one-point change; combine slider steps', rows: [newRow('always')], trigger: { type: 'change', watches: [{ signal: 'brightness_percent', minDelta: 1, direction: 'any' }], settleSeconds: 1 }, message: '' },
  { name: 'Volume changed', description: 'Volume or mute changes after one second', rows: [newRow('always')], trigger: { type: 'change', watches: [{ signal: 'volume_percent', minDelta: 1, direction: 'any' }, { signal: 'muted' }], settleSeconds: 1 }, message: '' },
  { name: 'Weekday reminder', description: '9 AM, Monday–Friday', rows: [newRow('always')], schedule: { ...defaultSchedule(), mode: 'daily' }, message: 'Time to start your daily plan.' },
  { name: 'Take a break', description: 'After 45 active minutes today', rows: [newRow('active_seconds')], policy: { ...defaultPolicy(), maxPerDay: 1, deferFullscreen: true }, message: 'You have worked for 45 active minutes. Take a break.' },
  { name: 'Battery care', description: 'Battery at or below 20%', rows: [{ ...newRow(), value: 20 }], message: 'Battery is low. Connect your charger.' },
  { name: 'Download complete', description: 'A Chrome download completes', rows: [newRow('browser_download')], message: 'Your download has finished.' },
  { name: 'New PDF', description: 'A PDF arrives in your chosen folder', rows: [{ ...newRow('folder_new_file'), value: '.pdf' }], message: 'A new PDF arrived in your watched folder.' },
  { name: 'Internet returned', description: 'Reachability returns after an outage', rows: [newRow('network_online')], fireOnApproval: false, message: 'The network is reachable again.' },
  { name: 'High CPU', description: 'CPU above 90% for two minutes', rows: [{ ...newRow('cpu_percent'), comparator: 'gt', value: 90 }], holdSeconds: 120, message: 'CPU stayed above 90% for two minutes.' },
  { name: 'Disk space low', description: 'Less than 10% free disk space', rows: [newRow('disk_free_percent')], message: 'Disk space is running low.' },
  { name: 'App time budget', description: 'One active hour in an app today', rows: [{ ...newRow('app_active_seconds'), value: 3600 }], policy: { ...defaultPolicy(), maxPerDay: 1 }, message: 'You reached your daily app time budget.' },
  { name: 'Memory pressure', description: 'Memory above 90% for one minute', rows: [{ ...newRow('memory_percent'), comparator: 'gt', value: 90 }], holdSeconds: 60, message: 'Memory stayed above 90% for one minute.' },
];
