import type { TinyAgentListing, TinyAgentRule, TinyWorkflowListing } from '../desktop';
import { describeCondition } from '../tinyAgentCatalog';
import { describeChange } from './TinyChangeControls';
import type { DistrictId, IslandResident } from './islandWorld';
export function watcherDistrict(rule: TinyAgentRule): DistrictId {
  if (rule.district) return rule.district;
  const actions = rule.actions || [rule.action];
  if (actions.some(action => action.type === 'open_url')) return 'harbor';
  if (actions.some(action => ['shutdown', 'open_path', 'focus_app', 'minimize_app'].includes(action.type))) return 'workshop';
  if (/battery|charging|on_ac|idle|cpu|memory|brightness/i.test(JSON.stringify(rule.condition))) return 'garden';
  return 'library';
}
export function workflowResidents(listing:TinyWorkflowListing):IslandResident[] {return listing.definitions.map(def=>{const run=listing.runs.find(item=>item.definitionId===def.id);const status=!def.approved?'draft':run?.status==='verified'?'ready':run?.status==='needs_attention'?'error':['running','waiting'].includes(run?.status??'')?'executing':run?.status==='queued'?'waiting':!def.enabled?'paused':run?.status==='paused'?'paused':'watching';return {id:'workflow:'+def.id,name:def.name,district:def.district??'workshop',status,statusLabel:run?.reason??(def.approved?'Waiting for approved trigger':'Review this plan'),kind:'workflow',task:def.goal};});}
export function islandResidents(listing: TinyAgentListing, now = Date.now()): IslandResident[] {
  return listing.rules.map(rule => {
    const delivery = listing.deliveries?.find(item => item.ruleId === rule.id && ['saved','queued','preparing','displaying','needs_retry'].includes(item.status));
    const latest = listing.history.find(event => event.ruleId === rule.id);
    const status = rule.draft ? 'draft' : !rule.enabled ? 'paused' : rule.snoozedUntil && rule.snoozedUntil > now ? 'snoozed' : rule.executing ? 'executing' : listing.shutdownPending?.ruleId === rule.id ? 'shutdown_pending' : delivery?.status === 'needs_retry' || latest?.kind === 'action_failed' ? 'error' : delivery ? 'delivering' : rule.availability === 'unavailable' ? 'unavailable' : rule.availability === 'waiting' ? 'waiting' : 'watching';
    const labels = { draft: 'Awaiting approval', paused: 'Paused', snoozed: 'Snoozed', executing: 'Performing PC action', shutdown_pending: 'Shutdown countdown', error: 'Needs attention', delivering: 'Notification pending', unavailable: 'Sensor unavailable', waiting: 'Waiting for PC signals', watching: 'Monitoring PC' };
    return { id: `watcher:${rule.id}`, name: rule.name, district: watcherDistrict(rule), status, statusLabel: labels[status], kind: 'watcher' as const, task: rule.trigger ? describeChange(rule.trigger) : describeCondition(rule.condition) };
  });
}
