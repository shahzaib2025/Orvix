const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createLedger } = require('./fast-ledger.cjs');
const { effectKey } = require('./fast-effect-key.cjs');
const { requireOutcomes } = require('./fast-outcomes.cjs');
const {applicationWindow,annotateWindows}=require('./fast-windows.cjs');

const DEFAULTS = { desktopEnabled: false, workerEnabled: false, workerModel: 'gemini-3.8-flash', transcriptionHints: false, conversationRefinementEnabled: false };
const pageActions = new Set(['click', 'type', 'key', 'select', 'check', 'drag', 'upload', 'media_play', 'media_pause', 'media_seek', 'media_mute', 'media_volume']);
const riskyActions = new Set(['upload', 'bookmark_delete', 'history_delete', 'download_cancel', 'close', 'delete']);
const consequential = /\b(send|submit|publish|post|buy|purchase|pay|checkout|delete|remove|erase|format|install|uninstall)\b|পাঠান|পাঠাও|মুছে|কিনুন|কেনো|পেমেন্ট/i;
const correction = /^(?:no\b|actually\b|instead\b|i meant\b|enter\b|press enter\b|continue\b|next\b|না|আমি বল|বলছিলাম|বলতেছিলাম|এন্টার|পরের)|search bar|সার্চ বার/i;
const followUp = /^(?:yes|yeah|ok|okay|thanks|thank you|go on|keep going|continue|resume|are you done|is it done|what(?:'s| is) (?:the status|happening)|are you (?:still )?working|হ্যাঁ|হ্যা|ঠিক আছে|আচ্ছা|ধন্যবাদ|চালিয়ে যাও|চালিয়ে যাও|হয়েছে|হয়েছে|শেষ হয়েছে|শেষ হয়েছে|কাজ কি শেষ|কতদূর|কি হলো|কী হলো)[.!?।]*$/i;
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function createFastWork({ browser, desktop, windows = desktop, settingsFile, emit = () => {}, metrics = () => {}, now = Date.now, workflowAuthorize, groundingReviewer }) {
  let settings = { ...DEFAULTS };
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}
  const tasks = new Map(), queues = new Map(), approvals = new Map(), refs = new Map();
  const readLeases = new Map();
  const groundingCache = new Map();
  const loggedSteps=new WeakMap();
  const ledger = createLedger({ now, changed: task => {
    emit({ type: 'task_progress', taskId: task.id, revision: task.revision, task: ledger.context(task) });
    const previous=loggedSteps.get(task)||new Map();
    for(const step of task.steps) {
      const signature=JSON.stringify([task.revision,step.state,step.attempts]);
      if(previous.get(step.id)!==signature)metrics({event:'step_transition',taskId:task.id,revision:task.revision,stepId:step.id,tool:step.tool,state:step.state,attempts:step.attempts,recoveryAttempts:Math.max(0,step.attempts-1),verificationFailed:!!step.obstacle,durationMs:step.startedAt===undefined?0:Math.max(0,now()-step.startedAt)});
      previous.set(step.id,signature);
    }
    loggedSteps.set(task,previous);
    metrics({ taskId: task.id, revision: task.revision, status: task.status, verifiedSteps: task.steps.filter(s => s.state === 'verified').length, actions: task.budget.actions });
  } });
  const get = id => { const task = tasks.get(id); if (!task) throw new Error('Fast task is unavailable.'); return task; };
  let previousWindowObservation;
  function snapshot(task) { return structuredClone({ ...task, controller: undefined }); }
  function update(input) {
    if (typeof input?.text !== 'string' || !input.text.trim()) throw new Error('A user request is required.');
    let task = tasks.get(input.taskId);
    if (task) task.unavailableGroundingReview = undefined;
    const continuing = input.continuation === true || input.intent === 'continue' || followUp.test(input.text.trim());
    const adding = input.intent === 'add' || /^(?:also\b|and also\b|add\b|include\b|আরও|এছাড়াও|এছাড়াও|যোগ করো|যোগ করুন)/i.test(input.text.trim());
    const refining = ['refine','correct'].includes(input.intent) || correction.test(input.text);
    const ambiguous = input.intent==='clarify';
    const selection = task?.awaitingChoice && /^(?:\s*(?:[0-9০-৯]+|first|second|third|one|two|three|প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|এক|দুই|তিন)(?:\b|\s|$)|(?:choose|select|play|বেছে|নম্বর))/i.test(input.text);
    if (!task || input.replace || (!input.incremental && !continuing && !adding && !refining && !ambiguous && !selection)) {
      if (task) cancel(task.id);
      task = { id: randomUUID(), goal: input.text.slice(0, 4000), latestRequest: input.text.slice(0, 4000), corrections: [], target: null,
        completed: [], pending: [], evidence: [], failures: 0, status: 'working', revision: 0, startedAt: now(), controller: new AbortController() };
      tasks.set(task.id, task);
      ledger.init(task);
      if(input.executionMode==='simple') {task.simpleProfile=true;task.planRequired=false;}
      while (tasks.size > 50) { const oldest = tasks.keys().next().value; if (oldest === task.id) break; cancel(oldest); tasks.delete(oldest); }
    } else {
      // Status questions and acknowledgements do not revise the reviewed action
      // or invalidate an in-flight operation. They never approve it either.
      if (continuing && !input.replace) {
        if(task.groundingFailures>0){task.reviewAttempts={};task.auditFailures={};}
        task.groundingFailures=0;
        if (task.status === 'paused' && /resume|continue|চালিয়ে|চালিয়ে/i.test(input.text)) {
          task.status='working'; task.budget={actions:0,startedAt:null,checkpointActions:0,checkpointAt:null,checkpoints:task.budget.checkpoints}; ledger.event(task);
          task.controlCalls=0;task.planFailures={};task.reviewAttempts={};
        }
        return snapshot(task);
      }
      task.controller.abort(); task.controller = new AbortController();
      for(const step of task.steps) if(['running','verifying'].includes(step.state)) { step.state='pending';step.uncertain=!ledger.reads.has(step.tool); }
      if (task.controller.signal.aborted) task.controller = new AbortController();
      task.status = 'working';
      task.latestRequest = input.text.slice(0, 4000);
      if (input.incremental) { task.goal = input.text.slice(0, 4000); task.requirements[0].text=task.goal; }
      else { task.corrections.push(input.text.slice(0, 1000)); task.corrections = task.corrections.slice(-8); }
      task.requirements.find(r=>r.id==='request').status='pending';
      task.needsClarification=ambiguous;
      if(ambiguous){task.status='needs_clarification';task.clarificationQuestion='Which target or part of the current task should change? Specify it, or request a new task.';}
      if (adding) {
        task.requirements.push({id:`addition-${task.revision+1}`,text:input.text.slice(0,2000),kind:'outcome',status:'pending',evidenceIds:[]});
        if(/\breread\b|\bre-read\b|\bread\b.{0,100}\bagain\b|আবার.{0,40}(?:পড়|পড়)/i.test(input.text)) {
          const urls=(input.text+' '+task.goal).match(/https?:\/\/[^\s<>"']+/g)||[];
          const source=urls[0]?.replace(/[.,);]+$/,'') || task.ledgerEvidence.find(e=>e.sourceUrl&&e.tool==='read_web_page')?.sourceUrl;
          const id=`fresh-read-${task.revision+1}`;
          task.requirements.push({id,text:'Reread the requested source for the added question before reporting its findings.',kind:'outcome',status:'pending',evidenceIds:[],controllerOwned:true});
          task.steps.push({id,title:'Reread the requested source',tool:'read_web_page',action:'',requirementIds:[id],dependsOn:[],expected:'Fresh retrieval of the requested source',expectedSourceUrl:source,state:'pending',attempts:0,evidenceIds:[],implicit:true,freshRead:true});
        }
        task.planRequired=true;
      } else if (!input.incremental) task.refinementPending=task.planRegistered;
      requireOutcomes(task, input.text);
    }
    task.revision++;
    task.groundingFailures=0;
    ledger.event(task);
    for (const [key, approval] of approvals) if (approval.taskId === task.id && approval.revision !== task.revision) {
      clearTimeout(approval.timer); approvals.delete(key); emit({ type: 'approval_closed', approvalId: key, taskId: task.id });
      if (task.approvalId === key) delete task.approvalId;
    }
    return snapshot(task);
  }
  function cancel(id) {
    const task = tasks.get(id); if (!task) return;
    task.controller.abort(); task.status = 'cancelled'; task.revision++;
    for (const step of task.steps) if (step.state !== 'verified') step.state='cancelled';
    ledger.event(task);
    delete task.approvalId;
    for (const [key, approval] of approvals) if (approval.taskId === id) { clearTimeout(approval.timer); approvals.delete(key); emit({ type: 'approval_closed', approvalId: key }); }
    browser.cancel?.(task.pending.map(item => item.requestId));
    desktop.cancel?.(task.pending.map(item => item.requestId));
  }
  async function prepareWindowPlan(id) {
    const task=get(id), revision=task.revision;
    if (!task.allWindowsRequested || task.steps.length || !windows.observe) return snapshot(task);
    const observed=await readLimited(()=>windows.observe({scope:'windows',requestId:randomUUID()}, task.controller.signal));
    if (task.revision!==revision || task.status==='cancelled') return snapshot(task);
    if (observed?.status!=='ok' || !Array.isArray(observed.observation?.windows)) {
      task.status='blocked';task.pauseReason='The current window inventory is unavailable. No window effects were dispatched.';ledger.event(task);return snapshot(task);
    }
    const targets=observed.observation.windows.filter(applicationWindow).map(w=>({...w,handle:Number(w.handle || String(w.ref || '').split(':').at(-1))})).filter(w=>w.handle>0);
    const action=/minimi[sz]e|মিনিমাইজ/i.test(task.goal)?'minimize':/maximi[sz]e|ম্যাক্সিমাইজ/i.test(task.goal)?'maximize':/restore|রিস্টোর/i.test(task.goal)?'restore':'close';
    task.windowTargets=targets.map(w=>({handle:w.handle,appName:w.app,title:w.title,action,stepId:`window-${w.handle}`}));
    if (!targets.length || targets.length>58) {task.status='blocked';task.pauseReason='A bounded target window inventory could not be established.';ledger.event(task);return snapshot(task);}
    const registered=ledger.register(task,{revision,requirements:task.requirements.filter(r=>r.id!=='request'),steps:[
      {id:'window-inventory',title:'Observe current window inventory',tool:'desktop_observe',requirementIds:['window-inventory'],dependsOn:[],expected:'All currently visible target windows are enumerated'},
      ...task.windowTargets.map(w=>({id:w.stepId,title:`${action}: ${w.title || w.appName || w.handle}`,tool:'window_act',action,requirementIds:['window-results'],dependsOn:['window-inventory'],expected:`Window ${w.handle} has independently observed state ${action}`})),
    ]});
    if (registered.status==='ok') {
      const token=ledger.begin(task,'desktop_observe',{stepId:'window-inventory'});
      ledger.finish(task,token,'desktop_observe',{}, {...observed,observation:{...observed.observation,windows:targets}});
    }
    return snapshot(task);
  }
  function observeRefs(result) {
    for (const element of result?.observation?.elements || result?.observation?.controls || []) if (element.ref) {
      refs.set(element.ref, { ...element, app:element.app||result.observation.appName||result.observation.app||result.observation.window?.app, windowRef: result.observation.windowRef, pageUrl: result.observation.url }); while (refs.size > 1500) refs.delete(refs.keys().next().value);
    }
  }
  function risk(kind, input, task) {
    if (kind.endsWith('observe')) return false;
    const args = record(input.args), element = refs.get(args.ref || input.target);
    if (riskyActions.has(input.action)) return true;
    if (['click', 'invoke', 'key'].includes(input.action)) {
      if (kind === 'browser_act' && input.action === 'key' && args.key === 'Enter' && input.expect?.kind === 'search_query' && element?.editable && /search|সার্চ/i.test(element.name || element.label || '')) {
        try { const url = new URL(element.pageUrl); if (url.protocol === 'https:' && /(^|\.)google\.[a-z.]+$/.test(url.hostname) && ['/', '/search'].includes(url.pathname)) return false; } catch {}
      }
      const label = element?.name || element?.label || element?.text || '';
      if (consequential.test(label)) return true;
      if (task && consequential.test(`${task.goal} ${task.latestRequest}`) && /^(?:ok|yes|confirm|continue|proceed|হ্যাঁ|ঠিক আছে)$/i.test(label.trim())) return true;
      // Unknown click targets and submission keys must be reviewed; observation text never authorizes them.
      if ((!element || !label.trim()) && ['click', 'invoke'].includes(input.action)) return true;
      if (input.action === 'key' && args.key === 'Enter') return true;
    }
    return false;
  }
  function requestApproval(task, kind, input) {
    const signature = effectKey(kind, input);
    const existing = [...approvals.values()].find(item => item.taskId === task.id && item.signature === signature && item.revision === task.revision);
    if (existing?.accepted) { approvals.delete(existing.id); clearTimeout(existing.timer); task.status = 'working'; delete task.approvalId; return null; }
    const element = refs.get(input.args?.ref || input.target);
    const target = element?.name || element?.label || input.target || [input.appName || input.app, input.title].filter(Boolean).join(' — ') || (input.handle ? `Window ${input.handle}` : 'selected control');
    if (existing) return { status: 'confirmation_required', approvalId: existing.id, action: input.action, target, message: 'Review this exact action in Orvix before continuing.' };
    const id = randomUUID();
    const approval = { id, taskId: task.id, kind, input, revision: task.revision, signature, accepted: false, timer: setTimeout(() => {
      approvals.delete(id); if (task.approvalId === id) { task.status = 'working'; delete task.approvalId; }
      emit({ type: 'approval_closed', approvalId: id, taskId: task.id });
    emit({ type: 'result', approvalId: id, taskId: task.id, action: input.action, result: { status: 'confirmation_expired', message: 'The action review expired. No effect was applied.' } });
    }, 120000) };
    approvals.set(id, approval);
    approval.timer.unref?.();
    task.status = 'awaiting_confirmation'; task.approvalId = id;
    emit({ type: 'approval', approvalId: id, taskId: task.id, action: input.action, target });
    return { status: 'confirmation_required', approvalId: id, action: input.action, target, message: 'Review this exact action in Orvix before continuing. No effect has been applied.' };
  }
  function decide(id, accepted) {
    const item = approvals.get(id); if (!item) return false;
    if (accepted) item.accepted = true;
    else {
      clearTimeout(item.timer); approvals.delete(id);
      const task = get(item.taskId); task.status = 'working'; delete task.approvalId;
    emit({ type: 'result', approvalId: id, taskId: item.taskId, action: item.input.action, result: { status: 'confirmation_declined', message: 'You declined this action. No effect was applied.' } });
    }
    emit({ type: 'approval_closed', approvalId: id, accepted: !!accepted, taskId: item.taskId }); return true;
  }
  async function lock(key, operation) {
    return require('./workflow-resources.cjs').withResources([key], operation);
  }
  function verified(result, observe) {
    return result?.status === 'ok' && (observe || result.verification?.verified === true);
  }
  function adapterInput(input) {
    // Ledger metadata is not part of browser/native transport schemas. Keep
    // other fields intact so strict adapter validation still catches mistakes.
    const {stepId,revision,controlIdentity,...request}=input;
    return request;
  }
  async function execute(taskId, kind, original, externalSignal) {
    const task = get(taskId), revision = task.revision;
    const signal = externalSignal ? AbortSignal.any([task.controller.signal, externalSignal]) : task.controller.signal;
    if (kind.startsWith('desktop') && !settings.desktopEnabled) return { status: 'disabled', message: 'Enable desktop control in Settings first.' };
    const isObserve = kind.endsWith('observe');
    if (!['browser_observe','browser_act','desktop_observe','desktop_act','window_act'].includes(kind)) throw new Error('Unknown work tool.');
    const input = structuredClone(record(original));
    input.requestId = input.requestId || randomUUID();
    const adapter = kind.startsWith('browser') ? browser : kind === 'window_act' ? windows : desktop;
    // A single surface lock also covers aliases such as current and exact tab refs.
    const surface = kind.startsWith('browser') ? 'browser' : 'desktop';
    const key = 'interaction'; // Chrome and native controls can address the same physical window.
    const run = async () => {
      if (signal.aborted || task.revision !== revision) return { status: 'cancelled', completedEffects: [] };
      if(task.planRequired || task.refinementPending)return ledger.begin(task,kind,input);
      if (!isObserve && task.steps.some(s=>s.signature===effectKey(kind,input) && (s.state==='verified'||s.uncertain))) return ledger.begin(task,kind,input);
      const grant = workflowAuthorize?.({taskId,kind,input,element:refs.get(input.args?.ref || input.target)});
      if (grant?.denied) return {status:'scope_required',message:grant.message};
       const approval = !grant?.approved && (grant?.reviewRequired || risk(kind, input, task)) ? requestApproval(task, kind, input) : null;
      if (approval) return approval;
      const token = ledger.begin(task, kind, {...input,controlIdentity:refs.get(input.args?.ref || input.target)});
      if (token.status !== 'ok') return { ...token, task: snapshot(task) };
      const started = now(), step = { requestId: input.requestId, tool: kind, action: input.action || input.scope, status: 'executing' };
      task.pending.push(step);
      let result;
      try {
        result = await adapter[isObserve ? 'observe' : 'act'](adapterInput(input), signal);
        if(kind==='desktop_observe' && result?.status==='ok' && Array.isArray(result.observation?.windows)) {
          result=annotateWindows(result,previousWindowObservation);
          previousWindowObservation=structuredClone(result.observation);
        }
        if (!isObserve) {
          task.awaitingChoice = result?.status === 'needs_selection';
          task.choices = task.awaitingChoice ? (result.options || result.apps || result.observation?.windows || []).slice(0, 20) : [];
        }
        if (result?.resolvedTarget || result?.observation?.windowRef || input.target) task.target = { surface, ref: result?.resolvedTarget || result?.observation?.windowRef || input.target };
        observeRefs(result);
        if (!signal.aborted && task.revision === revision && ['invalid_target_type', 'stale_target'].includes(result?.status) && !risk(kind, input, task)) {
          const old = refs.get(input.args?.ref || input.target);
          const elementTarget = input.target?.includes(':element:') || input.target?.includes(':control:');
          const derivedTab = (input.args?.ref || input.target)?.match(/^([^:]+):element:(\d+):/);
          const target = old?.windowRef || (derivedTab ? `${derivedTab[1]}:tab:${derivedTab[2]}` : elementTarget ? 'current' : input.target);
          const observation = await adapter.observe({ scope: 'page', target, requestId: randomUUID() }, signal);
          observeRefs(observation);
          const candidates = (observation?.observation?.elements || observation?.observation?.controls || []).filter(element => {
            if (old) return (element.name || element.label) === (old.name || old.label) && element.role === old.role;
            return ['type','key'].includes(input.action) && (element.editable || /textbox|edit|combobox/i.test(element.role || ''));
          });
          if (observation?.status === 'ok' && candidates.length === 1 && !signal.aborted && task.revision === revision && task.budget.actions<60 && now()-task.budget.startedAt<600000) {
            const repaired = { ...input, target: undefined, args: { ...input.args, ref: candidates[0].ref }, requestId: randomUUID() };
            if (input.expect?.ref && input.expect.ref === (input.args?.ref || input.target)) repaired.expect = { ...input.expect, ref: candidates[0].ref };
            // Never reuse visual offsets across a new observation.
            if (repaired.args.x !== undefined || repaired.args.y !== undefined) result = { ...result, observation: observation.observation, message: 'Reobserve screenshot geometry before clicking.' };
            else {
              task.budget.actions++; task.budget.checkpointActions++;
              const plannedStep=task.steps.find(item=>item.id===token.stepId); plannedStep.attempts++;
              const repairedGrant=workflowAuthorize?.({taskId,kind,input:repaired,element:refs.get(repaired.args?.ref || repaired.target)});
              if(repairedGrant?.denied) result={status:'scope_required',message:repairedGrant.message};
              else {const review=repairedGrant?.reviewRequired&&!repairedGrant?.approved?requestApproval(task,kind,repaired):null;result=review||await adapter.act(adapterInput(repaired), signal);}
            }
          } else result = { ...result, observation: observation.observation, message: 'Fresh observation available. Choose the intended control; no action was replayed.' };
        }
        if (signal.aborted || task.revision !== revision) {
          if (verified(result, isObserve)) task.evidence.push({ action: step.action, verified: true, completedBeforeCancellation: true });
          return { status: 'cancelled', completionUnknown: !isObserve, completedEffects: result?.completedEffects || [], task: snapshot(task) };
        }
        if (!isObserve && result?.completionUnknown === true) {
          // Reconcile an uncertain dispatch with a read, never replay a mutation.
          const elementRef = (input.args?.ref || input.target)?.match(/^([^:]+):element:(\d+):/);
          const target = elementRef ? `${elementRef[1]}:tab:${elementRef[2]}` : input.target || 'current';
          try {
            const observation = await adapter.observe({ scope: 'page', target, requestId: randomUUID() }, signal);
            observeRefs(observation);
            result = { ...result, reconciliation: observation,
              message: 'The action outcome is uncertain. Inspect the fresh reconciliation observation before continuing; do not repeat an effect already present.' };
          } catch { result = { ...result, message: 'The action outcome is uncertain and could not be inspected. Reobserve before retrying.' }; }
          if (signal.aborted || task.revision !== revision) return { ...result, status: 'cancelled', completionUnknown: true, task: snapshot(task) };
        }
        if (!isObserve) {
          const success = verified(result, false);
          if (success) { task.failures = 0; step.status = 'verified'; task.pending = task.pending.filter(item => item === step || item.tool !== kind || item.action !== step.action); task.completed.push(step); task.completed = task.completed.slice(-100); task.evidence.push({ action: step.action, verified: true, evidence: result.verification.evidence }); task.evidence = task.evidence.slice(-100); }
          else if (!['needs_selection','confirmation_required'].includes(result?.status)) task.failures++;
          if (result?.status === 'ok' && !success) result = { ...result, status: 'dispatched', message: 'Action sent; task outcome remains unverified.' };
        }
        ledger.finish(task, token, kind, input, result);
        if(result?.completionUnknown && ledger.reconcile(task,token.stepId,result.reconciliation)) result={...result,status:'ok',completionUnknown:false,verification:{verified:true,evidence:'Exact expected outcome independently reconciled.'}};
        metrics({ tool: kind, action: step.action, status: result?.status, verified: verified(result, isObserve), durationMs: now() - started, recoveryCount: task.failures });
        if (!verified(result, isObserve)) { step.status = 'unresolved'; step.obstacle = String(result?.message || result?.status || 'Unverified outcome').slice(0, 500); }
        return { ...result, task: snapshot(task), completion: verified(result, isObserve) ? 'verified_step' : 'unresolved', reportInstruction: 'Only verified steps are complete. Describe unresolved steps accurately; never claim the overall goal from a typing/click acknowledgement.' };
      } catch (error) {
        task.failures++;
        step.status = 'unresolved'; step.obstacle = String(error.message).slice(0, 500);
        const result={ status: signal.aborted ? 'cancelled' : 'failed', completionUnknown: !isObserve, message: error.message };
        ledger.finish(task, token, kind, input, result);
        return { ...result, task: snapshot(task) };
      } finally { task.pending = task.pending.filter(item => item !== step || item.status === 'unresolved').slice(-100); }
    };
    return isObserve ? readLimited(run) : lock(key, run);
  }
  let activeReads=0;
  const readWaiters=[];
  async function readLimited(run) {
    if(activeReads>=3) await new Promise(resolve=>readWaiters.push(resolve));
    else activeReads++;
    try {return await run();} finally {const next=readWaiters.shift();if(next) next();else activeReads--;}
  }
  function releaseReadLease(id) {
    const lease=readLeases.get(id);if(!lease)return;
    clearTimeout(lease.timer);readLeases.delete(id);
    const next=readWaiters.shift();if(next)next();else activeReads--;
  }
  function beginEvidence(id,tool,input) {
    if(ledger.reads.has(tool) && activeReads>=3)return {status:'busy',message:'Three reads are active. Wait for their results before another read.'};
    const token=ledger.begin(get(id),tool,input);
    if(token.status==='ok' && ledger.reads.has(tool)) {
      activeReads++;token.readLease=randomUUID();
      const timer=setTimeout(()=>releaseReadLease(token.readLease),600000);timer.unref?.();
      readLeases.set(token.readLease,{taskId:id,timer});
    }
    return token;
  }
  function recordEvidence(id,token,tool,input,result) {
    try{return ledger.finish(get(id),token,tool,input,result);}finally{if(token.readLease)releaseReadLease(token.readLease);}
  }
  async function workflow(taskId, input) {
    const operations = { search: 'search', open: 'navigate', switch: 'tab_activate', find_media: 'youtube_search', select_media: 'youtube_select' };
    if (operations[input.operation]) return execute(taskId, 'browser_act', { action: operations[input.operation], target: input.target,
      stepId: input.stepId, revision: input.revision,
      args: { ...(input.query ? { query: input.query } : {}), ...(input.url ? { url: input.url } : {}), ...(input.candidateId ? { candidateId: input.candidateId } : {}) } });
    if (input.operation !== 'fill_submit' || !input.ref || !input.expect) return { status: 'invalid_request', message: 'fill_submit requires an observed input ref and a submission expectation.' };
    const typed = await execute(taskId, 'browser_act', { action: 'type', args: { ref: input.ref, text: input.text, replace: true }, expect: { kind: 'value', ref: input.ref, value: input.text } });
    if (typed.completion !== 'verified_step') return typed;
    return execute(taskId, 'browser_act', { action: 'key', args: { ref: input.ref, key: 'Enter' }, expect: input.expect });
  }
  function configure(input) {
    for (const key of ['desktopEnabled','workerEnabled','transcriptionHints','conversationRefinementEnabled']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Invalid setting.');
    if (input.workerModel !== undefined && !/^gemini-[\w.-]{1,80}$/.test(input.workerModel)) throw new Error('Invalid Gemini model.');
    settings = { ...settings, ...Object.fromEntries(Object.entries(input).filter(([key]) => key in DEFAULTS)) };
    if (settingsFile) { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings)); }
    return { ...settings };
  }
  async function resumeApproval(id) {
    const approval = approvals.get(id);
    if (!approval?.accepted) return { status: 'cancelled' };
    if (get(approval.taskId).revision !== approval.revision) { clearTimeout(approval.timer); approvals.delete(id); return { status: 'cancelled' }; }
    const result = await execute(approval.taskId, approval.kind, approval.input);
    emit({ type: 'result', approvalId: id, taskId: approval.taskId, result, action: approval.input.action });
    return result;
  }
  async function reviewCompletionGrounded(id, input) {
    const task=get(id);
    if(input?.revision===task.revision && task.unavailableGroundingReview?.revision===task.revision) return {...task.unavailableGroundingReview.result, context:ledger.context(task)};
    input=ledger.resolveReview(task,input);
    const gate=ledger.reviewGate(task,input);if(gate)return gate;
    if(task.groundingFailures>=3)return {status:'blocked',completed:false,repairExhausted:true,review:task.lastReview,context:ledger.context(task),repairInstruction:'Independent review remains unavailable after two recovery attempts. Deliver the partial report with preserved evidence. A later user continuation can retry review without repeating completed actions.'};
    if(input.revision!==task.revision || task.status==='cancelled')return {status:'stale_revision'};
    const currentIds=new Set(ledger.context(task).evidence.filter(e=>e.verified).map(e=>e.id));
    const evidence=task.ledgerEvidence.filter(e=>currentIds.has(e.id) && e.sourceUrl && e.excerpt && !e.scopeOnly && !e.negativeRead);
    const claims=Array.isArray(input.claims)?input.claims:[];
    const coverage=Array.isArray(input.coverage)?input.coverage:[];
    const requirements=task.requirements.filter(r=>r.id!=='request' && !(r.executionOnly && r.status==='verified') && !(r.status==='verified' && r.reviewRevision<task.revision && !coverage.some(c=>c.requirementId===r.id) && !claims.some(c=>c.requirementId===r.id)) &&
      (claims.some(c=>c.requirementId===r.id)||coverage.some(c=>c.requirementId===r.id&&c.evidenceIds?.some(eid=>task.ledgerEvidence.some(e=>e.id===eid && currentIds.has(eid) && ['web_search','read_web_page'].includes(e.tool) && !e.scopeOnly && !e.negativeRead)))));
    if(!requirements.length || !evidence.length)return ledger.review(task,input);
    // Bad quotation provenance is repairable without spending a provider
    // review or turning an otherwise readable source into an external blocker.
    const quote=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
    const invalidQuotes=claims.some(claim=>{
      const source=evidence.find(e=>e.id===claim.evidenceId);
      return !source || !claim.sourceQuote || !quote(source.excerpt).includes(quote(claim.sourceQuote)) || !claim.answerQuote || !quote(input.answer).includes(quote(claim.answerQuote));
    }) || requirements.some(r=>r.kind==='research' && !claims.some(c=>c.requirementId===r.id));
    const draftKey=createHash('sha256').update(JSON.stringify([task.revision,input.answer,claims.map(c=>[c.requirementId,c.evidenceId,c.answerQuote]),evidence.map(e=>e.id)])).digest('hex');
    task.groundingDrafts ||= {};
    if(invalidQuotes || task.groundingDrafts[draftKey]>=3) {
      if(task.groundingDrafts[draftKey]>=3)return {status:'blocked',completed:false,repairExhausted:true,review:task.lastReview,context:ledger.context(task),repairInstruction:'This answer draft has exhausted independent review recovery. Correct the unsupported answer or obtain new evidence, then review. Otherwise finish its partial report; never repeat mutations.'};
      const result=ledger.review(task,input);
      return {...result,suggestedReview:{...input,claims:claims.map(c=>{
        const source=evidence.find(e=>e.id===c.evidenceId);
        return source?{requirementId:c.requirementId,evidenceId:c.evidenceId,answerQuote:c.answerQuote,sourcePassageId:source.id+':excerpt'}:{...c};
      })}};
    }
    const payload={goal:task.goal,latestRequest:task.latestRequest,answer:input.answer,
      requirements:requirements.map(r=>({id:r.id,text:r.id==='source-answer' ? task.goal+' '+r.text : r.text})),
      claims:claims.map(c=>({...c})),coverage,
      evidence:evidence.map(e=>({id:e.id,url:e.sourceUrl,excerpt:e.excerpt}))};
    const version=JSON.stringify([task.revision,task.steps,task.ledgerEvidence]);
    const key=createHash('sha256').update(JSON.stringify([id,version,payload])).digest('hex');
    let pending=groundingCache.get(key);
    if(!pending) {
      pending=(async()=>{
        if(!groundingReviewer)return {outcomes:requirements.map(r=>({requirementId:r.id,supported:false,reason:'Independent evidence reviewer unavailable.'}))};
        try{return await groundingReviewer(payload,{model:settings.workerModel,signal:task.controller.signal});}
        catch(error){const codes=(error?.reviewCodes||[]).filter(code=>[401,403,429,500,502,503,504].includes(code));return {unavailable:true,codes,outcomes:requirements.map(r=>({requirementId:r.id,supported:false,reason:'Independent evidence review unavailable'+(codes.length?' (HTTP '+codes.join(', ')+')':' or invalid')+'; completion remains unverified.'}))};}
      })();
      groundingCache.set(key,pending);
      while(groundingCache.size>64)groundingCache.delete(groundingCache.keys().next().value);
    }
    const grounding=await pending;
    if(grounding.unavailable)groundingCache.delete(key);
    if(task.status==='cancelled'||version!==JSON.stringify([task.revision,task.steps,task.ledgerEvidence]))return {status:'stale_revision',completed:false};
    task.groundingFailures=grounding.unavailable?(task.groundingFailures||0)+1:0;
    if(!grounding.unavailable && grounding.outcomes?.some(outcome=>!outcome.supported))task.groundingDrafts[draftKey]=(task.groundingDrafts[draftKey]||0)+1;
    metrics({event:'grounding_review',taskId:id,revision:task.revision,outcomes:requirements.length,rejected:grounding.outcomes?.filter(v=>!v.supported).length});
    const result=ledger.review(task,input,{grounding});
    if(grounding.unavailable) {
      result.reviewUnavailable=true;
      task.unavailableGroundingReview={revision:task.revision,result:{...result}};
    }
    if(!result.completed && !grounding.unavailable)result.suggestedReview={...input,claims:claims.map(c=>{
      const source=evidence.find(e=>e.id===c.evidenceId);
      return source?{requirementId:c.requirementId,evidenceId:c.evidenceId,answerQuote:c.answerQuote,sourcePassageId:source.id+':excerpt'}:{...c};
    })};
    return result;
  }
  return { update, prepareWindowPlan, cancel, execute, workflow, decide, resumeApproval, task: id => snapshot(get(id)), settings: () => ({ ...settings }), configure,
    registerPlan: (id,input)=>ledger.register(get(id),input),
    reviewCompletion: (id,input)=>ledger.review(get(id),input),
    reviewCompletionGrounded,
    taskContext: id=>ledger.context(get(id)),
    beginEvidence,
    recordEvidence,
    delivery: (id,state)=>{const task=get(id);if(['pending','complete','interrupted'].includes(state)){task.delivery=state;ledger.event(task);}return snapshot(task);},
    pause: (id,reason)=>{const task=get(id);if(!['completed','cancelled'].includes(task.status)){task.status='paused';task.pauseReason=String(reason||'Task budget reached').slice(0,250);ledger.event(task);}return snapshot(task);},
  };
}
module.exports = { createFastWork, DEFAULTS, pageActions };
