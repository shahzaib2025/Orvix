type Bridge = NonNullable<Window['orvixDesktop']>;
let voiceSessionId: string | undefined;
let pendingHumanInput:Promise<unknown>=Promise.resolve();
export function connectTinyWorkflowVoice(id?:string, expectedSessionId?:string) {if(expectedSessionId&&voiceSessionId!==expectedSessionId)return;voiceSessionId=id;pendingHumanInput=Promise.resolve();}
export function recordTinyWorkflowHumanInput(profile:'Fast'|'Thinking',inputId:string,text:string,expectedSessionId?:string) {const id=voiceSessionId;if(expectedSessionId&&id!==expectedSessionId)return;if(id&&window.orvixDesktop?.recordTinyWorkflowVoiceInput) pendingHumanInput=pendingHumanInput.catch(()=>{}).then(()=>window.orvixDesktop!.recordTinyWorkflowVoiceInput({sessionId:id,profile,inputId,text}));}
export const isTinyAgentTool=(name:string)=>['draft_tiny_agent','manage_tiny_agent','tiny_workflow_capabilities','draft_tiny_workflow','inspect_tiny_workflow','manage_tiny_workflow'].includes(name);

export function tinyAgentDraftFromModel(raw: Record<string, unknown>) {
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const children = conditions.map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const signal = String(row.signal || '');
    const value = ['battery_percent', 'idle_seconds', 'volume_percent', 'brightness_percent', 'active_seconds', 'app_active_seconds', 'cpu_percent', 'memory_percent', 'disk_free_percent'].includes(signal)
      ? row.value_number : ['on_ac', 'charging', 'muted', 'always', 'fullscreen', 'network_online', 'file_exists'].includes(signal) ? row.value_boolean : signal === 'active_app' && !row.value_text ? row.target : row.value_text;
    return { op: 'predicate', signal, comparator: row.comparator, value,
      target: row.target, scope: row.scope, field: row.field };
  });
  return { id: raw.id, name: raw.name, district:raw.district, trigger: raw.trigger, condition: typeof raw.condition_json==='string'?JSON.parse(raw.condition_json):raw.condition??(children.length ? { op: raw.match === 'any' ? 'any' : 'all', children } : raw.trigger ? { op: 'predicate', signal: 'always', comparator: 'eq', value: true } : { op: 'all', children }),
    holdSeconds: raw.hold_seconds ?? 0, repeatSeconds: raw.repeat_seconds ?? 0,
    action: { type: raw.action_type ?? (raw.trigger ? 'notify' : undefined), message: raw.notification_text ?? '', target: raw.action_target },
    ...(Array.isArray(raw.actions) ? { actions: raw.actions } : {}),
    schedule: raw.schedule, policy: raw.policy, incident: typeof raw.incident_json === 'string' ? JSON.parse(raw.incident_json) : raw.incident, fireOnApproval: raw.fire_on_approval };
}

export async function invokeTinyAgentTool(name: string, args: Record<string, unknown>, bridge: Bridge) {
  const sessionId = voiceSessionId;
  await pendingHumanInput;
  if(name.includes('tiny_workflow')&&sessionId!==voiceSessionId)return {status:'stale_session',message:'The voice profile changed before this request was dispatched. Inspect the workflow from the current session.'};
  if(name==='tiny_workflow_capabilities') return bridge.tinyWorkflowCapabilities();
  if(name==='draft_tiny_workflow') return bridge.draftTinyWorkflow({id:args.id,revision:args.revision,requestId:args.request_id,definition:JSON.parse(String(args.definition_json))});
  if(name==='inspect_tiny_workflow') return args.id||args.run_id?bridge.inspectTinyWorkflow({id:args.id,runId:args.run_id,after:args.after,voiceSessionId}):bridge.listTinyWorkflows();
  if(name==='manage_tiny_workflow') {if(['approve','answer','update_run'].includes(String(args.action))&&!voiceSessionId) return {status:'needs_review',message:'Open this plan in the Workshop for approval.'};return bridge.manageTinyWorkflow({action:args.action,id:args.id,runId:args.run_id,revision:args.revision,newRevision:args.new_revision,requestId:args.request_id,questionId:args.question_id,stepId:args.step_id,accepted:args.accepted,answer:args.answer,voiceSessionId});}
  if (name === 'draft_tiny_agent') return bridge.draftTinyAgent(tinyAgentDraftFromModel(args));
  if (name !== 'manage_tiny_agent') throw new Error(`Unknown tiny agent tool: ${name}`);
  const action = String(args.action || '');
  if (action === 'stop_all') return bridge.controlTinyRuntime({action:'stop'});
  if (action === 'cancel_shutdown') return { cancelled: await bridge.cancelTinyAgentShutdown() };
  const listing = await bridge.listTinyAgents();
  if (action === 'list') return listing;
  let id = String(args.id || '');
  if (!id && action === 'approve') {
    const drafts = listing.rules.filter(rule => rule.draft);
    if (drafts.length === 1) id = drafts[0].id;
  }
  if (!id || !listing.rules.some(rule => rule.id === id)) return { status: 'needs_target', message: 'List tiny agents and choose the exact rule ID before changing it.' };
  if(action==='inspect'||action==='review') return {rule:listing.rules.find(rule=>rule.id===id),readings:await bridge.previewTinyAgent(id),activity:listing.history.filter(item=>item.ruleId===id),deliveries:listing.deliveries?.filter(item=>item.ruleId===id),workflows:await bridge.listTinyWorkflows?.()};
  if (action === 'approve') { await bridge.approveTinyAgent(id); return { status: 'approved', id }; }
  if (action === 'pause' || action === 'resume') { await bridge.setTinyAgentEnabled(id, action === 'resume'); return { status: action === 'pause' ? 'paused' : 'resumed', id }; }
  if (action === 'delete') { await bridge.deleteTinyAgent(id); return { status: 'deleted', id }; }
  if (action === 'snooze') { await bridge.snoozeTinyAgent(id, Number(args.seconds ?? 1800)); return { status: 'snoozed', id }; }
  if (action === 'clear_snooze') { await bridge.snoozeTinyAgent(id, 0); return { status: 'snooze_cleared', id }; }
  if (action === 'duplicate') return bridge.duplicateTinyAgent(id);
  if (action === 'preview') return bridge.previewTinyAgent(id);
  return { status: 'unsupported_action' };
}
