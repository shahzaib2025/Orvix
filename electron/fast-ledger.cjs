const { randomUUID, createHash } = require('node:crypto');
const { effectKey } = require('./fast-effect-key.cjs');
const { requireOutcomes, acknowledgmentOnly, reviewOutcomeIssues } = require('./fast-outcomes.cjs');

const MAX_STEPS = 60, MAX_TIME = 600000;
const supported = new Set(['browser_observe','browser_act','desktop_observe','desktop_act','window_act','web_search','read_web_page','get_weather','read_file','write_file','list_directory','search_files','search_content','manage_clipboard','answer']);
const reads = new Set(['browser_observe','desktop_observe','web_search','read_web_page','get_weather','read_file','list_directory','search_files','search_content']);
const idOK = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const clean = (value, size = 2000) => String(value || '').slice(0, size);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => clean(value, 32000).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const generationTerm=/generation(?:_|\s*)complet(?:e|ion)|জেনারেশন.*(?:শেষ|সমাপ্ত)/i;
const turnTerm=/turn(?:_|\s*)complet(?:e|ion)|টার্ন.*(?:শেষ|সমাপ্ত)/i;
function scopeCheckRequested(goal) {
  return /bangladesh|বাংলাদেশ/i.test(goal) && /(?:whether|determine|can.{0,60}verify|যাচাই.*(?:পারে|যায়)|প্রযোজ্য)/i.test(goal) && /(?:this|provided|exact|এই).{0,30}(?:page|url|source|পাতা|পেজ)|(?:page|url).{0,60}(?:verify|policy)|country.scope|দেশের/i.test(goal);
}
function foreignLocale(url) {try{const region=new URL(url).pathname.match(/^\/([a-z]{2})(?:\/|$)/i)?.[1]?.toUpperCase();return region && region!=='BD' && new Intl.DisplayNames(['en'],{type:'region'}).of(region)!==region ? region : null;}catch{return null;}}
function sourceScopeIssue(task,url) {
  const goal=task.goal+' '+(task.latestRequest||'');
  if(!task.scopeCheck && !(/bangladesh|বাংলাদেশ/i.test(goal) && /policy|policies|delivery|returns?|refund|warranty|payment|guidance|guidelines|net.metering|ডেলিভারি|রিটার্ন|নীতিমালা|নেট মিটারিং/i.test(goal)))return;
  try {
    const parsed=new URL(url), selected=parsed.searchParams.get('country')?.toUpperCase();
    const region=foreignLocale(url) || (/\.(pk|np|in|lk|ca|us|uk|au)$/i.exec(parsed.hostname)?.[1]?.toUpperCase()) || (selected && !['BD','BANGLADESH'].includes(selected) ? selected : null);
    const named=region && (/^[A-Z]{2}$/.test(region) ? new Intl.DisplayNames(['en'],{type:'region'}).of(region==='UK'?'GB':region) : region);
    const prose=goal.replace(/https?:\/\/\S+/g,'').toLowerCase();
    if(region && (task.scopeCheck || !named || !prose.includes(named.toLowerCase())))return 'different country; not evidence for Bangladesh policy';
  } catch { /* Retrieval validates malformed URLs separately. */ }
}

function createLedger({ now = Date.now, changed = () => {} } = {}) {
  function init(task) {
    task.requirements = [{ id:'request', text:task.goal, kind:'outcome', status:'pending', evidenceIds:[] }];
    task.scopeCheck=scopeCheckRequested(task.goal);
    task.pageAttemptOnly=/read_web_page|\b(?:read|inspect)\b/i.test(task.goal) && /actual failure|actual retrieval result|page availability/i.test(task.goal);
    if(task.pageAttemptOnly)for(const [id,text] of [['retrieval-attempt','Attempt the supplied page and observe the actual retrieval status; no substitution is allowed.'],['retrieval-report','Report the actual retrieval failure or availability, cite the checked URL and distinguish this from successfully reading page content.']])task.requirements.push({id,text,kind:'outcome',status:'pending',evidenceIds:[],controllerOwned:true});
    if(task.scopeCheck) for(const [id,text] of [['scope-verdict','Explain the actual URL country-scope rejection and whether it can verify Bangladesh policy.'],['scope-limits','State that the rejected page was not read and Bangladesh policy remains unverified; cite the checked URL.']])task.requirements.push({id,text,kind:'outcome',status:'pending',evidenceIds:[],controllerOwned:true});
    if(generationTerm.test(task.goal)&&turnTerm.test(task.goal))for(const [id,text] of [['generation-completion','Explain generation completion and its distinct meaning.'],['turn-completion','Explain turn completion and how it differs from generation completion.']])task.requirements.push({id,text,kind:'research',status:'pending',evidenceIds:[],controllerOwned:true});
    task.steps = []; task.ledgerEvidence = []; task.planRegistered = false;
    task.planRequired = /\b(research|compare|comparison|then|after that|multi.step|plan_task|review_task)\b|গবেষণা|তুলনা|তারপর|এরপর/i.test(task.goal) || /\b(open|search|find|type|write|launch)\b.*\band\b.*\b(open|search|find|type|write|launch|compare)\b/i.test(task.goal);
    requireOutcomes(task, task.goal);
    const urls=[...new Set((task.goal.match(/https?:\/\/[^\s<>"']+/g)||[]).map(url=>url.replace(/[.,);]+$/,'')))];
    if(task.scopeCheck && urls.length===1) {
      task.steps=[{id:'scope-read',title:'Check the supplied URL scope',tool:'read_web_page',action:'',requirementIds:['scope-verdict','scope-limits'],dependsOn:[],expected:'Observe the supplied URL country scope; if rejected, report that no page content was read',state:'pending',attempts:0,evidenceIds:[],implicit:true,scopeSeed:true}];
      task.planRegistered=true;task.planRequired=false;
    }
    if(task.pageAttemptOnly && !task.scopeCheck && urls.length===1) {
      task.steps=[{id:'retrieval-attempt',title:'Inspect the supplied page retrieval result',tool:'read_web_page',action:'',requirementIds:['retrieval-attempt','retrieval-report'],dependsOn:[],expected:'Observe actual retrieval status; report a failed read accurately without substitute content',state:'pending',attempts:0,evidenceIds:[],implicit:true}];
      task.planRegistered=true;task.planRequired=false;
    }
    task.budget = { actions:0, startedAt:task.startedAt, checkpointActions:0, checkpointAt:task.startedAt, checkpoints:0 };
    task.delivery = 'pending';
  }
  function event(task) { task.updatedAt = now(); changed(task); }
  function invalidate(task, ids) {
    const affected = new Set(task.steps.filter(s => s.requirementIds.some(id => ids.includes(id))).map(s => s.id));
    let size;
    do { size = affected.size; for (const s of task.steps) if (s.dependsOn.some(id => affected.has(id))) affected.add(s.id); } while (affected.size !== size);
    for (const s of task.steps) if (affected.has(s.id)) { s.state='pending'; s.attempts=0; s.evidenceIds=[]; s.uncertain=false; delete s.obstacle; }
    const requirements = new Set(ids);
    for (const s of task.steps) if (affected.has(s.id)) for (const id of s.requirementIds) requirements.add(id);
    for (const r of task.requirements) if (requirements.has(r.id) || r.id==='request') { r.status='pending'; r.evidenceIds=[]; }
    task.status='working'; task.delivery='pending'; event(task);
  }
  function dependencies(steps,ids) {
    const found=new Set(ids),queue=[...ids];
    while(queue.length){const id=queue.shift();for(const dep of steps.find(step=>step.id===id)?.dependsOn||[])if(!found.has(dep)){found.add(dep);queue.push(dep);}}
    return found;
  }
  function controlLimit(task) {
    task.controlCalls=(task.controlCalls||0)+1;
    if(task.controlCalls>60 || task.budget.startedAt!==null && now()-task.budget.startedAt>=MAX_TIME) {
      task.status='paused';task.pauseReason='The task control budget was reached. Report completed outcomes and the next unfinished step.';event(task);
      return {status:'limit_reached',completed:false,message:task.pauseReason,context:context(task)};
    }
  }
  function register(task,input={}) {
    if(input.revision!==task.revision || task.status==='cancelled')return {status:'stale_revision'};
    const limit=controlLimit(task);if(limit)return limit;
    const result=registerPlan(task,input);
    if(result.status==='invalid_request') {
      const key=hash([task.revision,result.message]);task.planFailures ||= {};
      task.planFailures[key]=(task.planFailures[key]||0)+1;
      if(task.planFailures[key]>=3) {
        task.status='blocked';event(task);
        return {...result,status:'blocked',repairExhausted:true,protocolBlocked:true,message:'Two plan repair attempts exhausted: '+result.message,context:context(task)};
      }
    }
    return result;
  }
  function registerPlan(task, input={}) {
    if (input.revision !== task.revision || task.status==='cancelled') return {status:'stale_revision'};
    if(task.needsClarification)return {status:'needs_clarification',message:task.clarificationQuestion};
    if(task.status==='paused')return {status:'limit_reached',message:'Explicitly resume the paused task before changing its plan.'};
    if (!Array.isArray(input.requirements) || !input.requirements.length || input.requirements.length>60 || !Array.isArray(input.steps) || input.steps.length>100) return {status:'invalid_request',message:'Provide bounded requirements and steps.'};
    if(input.requirements.some(r=>!r||typeof r!=='object')||input.steps.some(s=>!s||typeof s!=='object')) return {status:'invalid_request',message:'Requirements and steps must be objects.'};
    // An additive proposal cannot erase old work. Merge omitted records in the
    // controller rather than requiring the model to copy the entire ledger.
    const additive=task.planRequired && task.requirements.some(r=>r.id===`addition-${task.revision}`);
    if(additive && !input.steps.some(s=>!task.steps.some(old=>old.id===s.id) || s.requirementIds?.some(id=>id===`addition-${task.revision}` || !task.requirements.some(r=>r.id===id))))return {status:'invalid_request',message:'The additive plan needs a new step or an explicit mapping for the added outcome; old work is preserved.'};
    if(additive)input={...input,
      requirements:[...input.requirements.map(r=>task.requirements.find(old=>old.id===r.id && old.id!=='request') || r),...task.requirements.filter(r=>r.id!=='request'&&!input.requirements.some(n=>n.id===r.id))],
      steps:[...input.steps,...task.steps.filter(s=>!input.steps.some(n=>n.id===s.id))]};
    if(additive) {
      const additions=[];
      input.steps=input.steps.map(proposed=>{
        const old=task.steps.find(s=>s.id===proposed.id && s.state==='verified');
        if(!old || !Array.isArray(proposed.requirementIds))return proposed;
        const added=proposed.requirementIds.filter(id=>!old.requirementIds.includes(id));
        if(!added.length)return proposed;
        // Verified evidence proves the original read, not newly appended
        // questions. Keep that read intact and give additions a fresh read.
        if(!reads.has(old.tool))return proposed;
        const fresh={...proposed,id:clean(`${old.id.slice(0,55)}-addition-${task.revision}`,80),requirementIds:added};
        additions.push(fresh);
        return {...old};
      });
      input.steps.push(...additions);
    }
    if(additive && !input.steps.some(s=>s.requirementIds?.includes(`addition-${task.revision}`)))input.steps.push({
      id:`answer-addition-${task.revision}`,title:'Report the added outcome',tool:'answer',requirementIds:[`addition-${task.revision}`],
      dependsOn:input.steps.filter(s=>!task.steps.some(old=>old.id===s.id)).map(s=>s.id),expected:'Answer the added request from the new verified evidence, or state the missing evidence.'});
    if(input.requirements.length>60 || input.steps.length>100)return {status:'invalid_request',message:'The merged plan exceeds its bounded requirements or steps.'};
    const requirements = input.requirements.map(r => ({id:r.id,text:clean(r.text),kind:r.kind || 'outcome'}));
    if (requirements.some(r=>!idOK(r.id)||!r.text||!['outcome','research','weather'].includes(r.kind)) || new Set(requirements.map(r=>r.id)).size!==requirements.length) return {status:'invalid_request',message:'Requirements need unique IDs, text and a supported kind.'};
    // The original request is immutable and cannot disappear from a model plan.
    const root = task.requirements.find(r=>r.id==='request');
    if (!requirements.some(r=>r.id==='request')) requirements.unshift({id:'request',text:root.text,kind:root.kind});
    else { const proposed = requirements.find(r=>r.id==='request'); proposed.text=root.text; proposed.kind=root.kind; }
    for(const old of task.requirements.filter(r=>r.controllerOwned)) {const proposed=requirements.find(r=>r.id===old.id);if(proposed){proposed.text=old.text;proposed.kind=old.kind;}}
    if(task.planRequired && requirements.length<2) return {status:'invalid_request',message:'Decompose the original request into explicit requested outcomes.'};
    const missing=task.requirements.filter(r=>!requirements.some(n=>n.id===r.id));
    if (missing.length) return {status:'invalid_request',message:'A revised plan must account for every existing requirement. Missing IDs: '+missing.map(r=>r.id).join(', '),repairInstruction:'Copy these existing requirement IDs and texts from context; add their execution/answer mappings. Do not replace or drop them.',context:context(task)};
    const ids = new Set(requirements.map(r=>r.id));
    const steps = input.steps.map(s=>({id:s.id,title:clean(s.title,250),tool:s.tool==='review_task'?'answer':s.tool,action:reads.has(s.tool)||s.tool==='review_task'?'':clean(s.action,80),requirementIds:s.requirementIds,dependsOn:s.dependsOn || [],expected:clean(s.expected),state:'pending',attempts:0,evidenceIds:[]}));
    for(const old of task.steps) {
      if(old.freshRead) {const index=steps.findIndex(s=>s.id===old.id);if(index>=0)steps[index]={...old};else steps.push({...old});}
      else if(old.implicit && !steps.some(s=>s.id===old.id) && !(old.scopeSeed && old.state!=='verified' && steps.some(s=>s.tool==='read_web_page'))) steps.push({...old});
      // A revised plan may omit completed records. Retain them in the
      // controller; omission cannot delete evidence or authorize re-execution.
      else if(old.state==='verified' && !steps.some(s=>s.id===old.id)) steps.push({...old,requirementIds:[...old.requirementIds],dependsOn:[...old.dependsOn],evidenceIds:[...old.evidenceIds]});
    }
    for(const step of steps)if(step.tool==='answer' && step.requirementIds.some(id=>id===`addition-${task.revision}` || !task.requirements.some(r=>r.id===id)))for(const read of steps.filter(s=>s.freshRead && s.state!=='verified'))if(!step.dependsOn.includes(read.id))step.dependsOn.push(read.id);
    const stepIds = new Set(steps.map(s=>s.id));
    if (stepIds.size!==steps.length || steps.some(s=>!idOK(s.id)||!s.title||!s.expected||!supported.has(s.tool)||!Array.isArray(s.requirementIds)||!s.requirementIds.length||s.requirementIds.some(id=>!ids.has(id))||!Array.isArray(s.dependsOn)||s.dependsOn.some(id=>!stepIds.has(id)||id===s.id))) return {status:'invalid_request',message:'Steps require unique IDs, supported tools, expected results, and valid dependencies.'};
    const visited=new Set(), visiting=new Set();
    function visit(id) { if(visiting.has(id)) return false; if(visited.has(id)) return true; visiting.add(id); for(const dep of steps.find(s=>s.id===id).dependsOn) if(!visit(dep)) return false; visiting.delete(id); visited.add(id); return true; }
    if (steps.some(s=>!visit(s.id))) return {status:'invalid_request',message:'Step dependencies must be acyclic.'};
    const unmapped=requirements.filter(r=>r.id!=='request'&&!steps.some(s=>s.requirementIds.includes(r.id)));
    const sourceReads=steps.filter(s=>s.tool!=='answer');
    if(unmapped.length && sourceReads.length && sourceReads.every(s=>['web_search','read_web_page'].includes(s.tool)) && unmapped.every(r=>r.kind==='research' || /^(?:compare|explain|report|describe|give|cite|identify|establish|provide|তুলনা|ব্যাখ্যা)/i.test(r.text))) {
      for(const r of unmapped) {
        const id=clean(`answer-${r.id}`,80);
        if(stepIds.has(id))return {status:'invalid_request',message:'Use a unique answer step ID for '+r.id};
        steps.push({id,title:r.text.slice(0,250),tool:'answer',action:'',requirementIds:[r.id],dependsOn:sourceReads.map(s=>s.id),expected:'Review this requested outcome against all prerequisite source evidence; unknown evidence remains incomplete',state:'pending',attempts:0,evidenceIds:[]});stepIds.add(id);
      }
    }
    if (requirements.some(r=>r.id!=='request'&&!steps.some(s=>s.requirementIds.includes(r.id)))) return {status:'invalid_request',message:'Every requested outcome needs at least one step. Add tool: answer with dependencies on the supporting read steps for comparison or explanatory outcomes.'};
    // Native inventory is an observed outcome, not a web-source claim.
    for(const requirement of requirements) if(requirement.kind==='research') {
      const linked=dependencies(steps,steps.filter(step=>step.requirementIds.includes(requirement.id)).map(step=>step.id));
      const mapped=steps.filter(step=>step.tool!=='answer' && linked.has(step.id));
      if(mapped.length && mapped.every(step=>['desktop_observe','browser_observe'].includes(step.tool)))requirement.kind='outcome';
    }
    const changedIds = requirements.filter(r=>{const old=task.requirements.find(n=>n.id===r.id);return old && (old.text!==r.text||old.kind!==r.kind);}).map(r=>r.id);
    const changedSteps=new Set();
    for (const s of steps) { const old=task.steps.find(n=>n.id===s.id); if(old && hash([old.tool,old.action,old.expected,old.requirementIds,old.dependsOn])===hash([s.tool,s.action,s.expected,s.requirementIds,s.dependsOn])) Object.assign(s,{state:old.state,attempts:old.attempts,evidenceIds:[...old.evidenceIds],uncertain:old.uncertain,signature:old.signature,obstacle:old.obstacle}); else if(old) changedSteps.add(s.id); }
    if (task.steps.some(s=>s.state==='verified'&&!stepIds.has(s.id))) return {status:'invalid_request',message:'Keep verified steps in revised plans; refine their requirements explicitly.'};
    task.requirements=requirements.map(r=>({...r,status:'pending',evidenceIds:[],...task.requirements.find(old=>old.id===r.id),text:r.text,kind:r.kind})); task.steps=steps;
    if(changedIds.length) invalidate(task,[...new Set(changedIds)]);
    let count;do{count=changedSteps.size;for(const step of steps)if(step.dependsOn.some(id=>changedSteps.has(id)))changedSteps.add(step.id);}while(count!==changedSteps.size);
    for(const step of steps)if(changedSteps.has(step.id)) {
      step.state='pending';step.attempts=0;step.evidenceIds=[];
      for(const id of step.requirementIds){const requirement=task.requirements.find(r=>r.id===id);if(requirement){requirement.status='pending';requirement.evidenceIds=[];}}
    }
    task.planRegistered=steps.some(step=>step.tool!=='answer'); task.implicitSourcePlan=false; task.planRequired=!task.planRegistered; task.refinementPending=false; task.status='working'; event(task);
    return {status:task.planRegistered?'ok':'plan_required',message:task.planRegistered?undefined:'Requested outcomes are recorded. Register execution steps before starting this task.',revision:task.revision,context:context(task)};
  }
  function begin(task, tool, input={}) {
    if(!supported.has(tool)||tool==='answer') return {status:'invalid_request',message:'Unsupported execution tool.'};
    if(task.needsClarification)return {status:'needs_clarification',message:task.clarificationQuestion};
    if(task.status==='cancelled') return {status:'cancelled'};
    if(input.revision!==undefined&&input.revision!==task.revision) return {status:'stale_revision'};
    if(task.status==='paused') return {status:'limit_reached',message:'Task paused at its cumulative budget. Explicitly resume to continue.'};
    const reject=(status,message)=>{
      const key=JSON.stringify([task.revision,tool,status]);
      task.protocolFailures ||= {};task.protocolFailures[key]=(task.protocolFailures[key]||0)+1;
      if(task.protocolFailures[key]>=3){task.status='paused';task.pauseReason=message;event(task);return {status:'blocked',protocolBlocked:true,message:'Two plan repair attempts exhausted: '+message,context:context(task)};}
      return {status,message,context:context(task)};
    };
    if(task.refinementPending) return {status:'plan_required',message:'Register a revised plan for the correction before continuing.'};
    const controllerRead=tool==='read_web_page' && task.steps.find(s=>s.freshRead && s.id===input.stepId && s.expectedSourceUrl===input.url);
    if(task.planRequired && !controllerRead) return reject('plan_required','Register all requested outcomes and execution dependencies before starting this compound request.');
    if (task.allWindowsRequested && tool==='window_act') {
      if (!task.ledgerEvidence.some(e=>e.tool==='desktop_observe'&&e.windows&&currentEvidence(task,e))) return {status:'dependency_pending',message:'Observe the full target window inventory before acting.'};
      if (task.windowTargets && !task.windowTargets.some(w=>w.handle===input.handle && w.stepId===input.stepId && w.action===input.action)) return {status:'invalid_request',message:'Use the exact handle, action and stepId from the current windowTargets inventory.'};
    }
    const signature=effectKey(tool,input);
    if(task.steps.some(s=>s.uncertain&&s.signature===signature)) return {status:'completion_unknown',completionUnknown:true,message:'This exact effect has an uncertain outcome. Inspect it; do not replay it.'};
    if (!reads.has(tool) && task.steps.some(s => s.state === 'verified' && s.signature === signature)) return {status:'already_verified',message:'This exact verified effect has already occurred. Observe before requesting a new effect.'};
    let step = input.stepId ? task.steps.find(s=>s.id===input.stepId) : undefined;
    if(input.stepId&&!step) return reject('invalid_request','Unknown step ID.');
    if(task.planRegistered&&!task.implicitSourcePlan&&!step) {
      const candidates=task.steps.filter(s=>s.tool===tool&&(!s.action||s.action===input.action)&&s.state!=='verified'&&(!reads.has(tool)||s.dependsOn.every(id=>task.steps.find(dep=>dep.id===id)?.state==='verified')));
      if(candidates.length===1) step=candidates[0];
      else if(reads.has(tool) && candidates.filter(s=>s.requirementIds.includes(`addition-${task.revision}`)).length===1) step=candidates.find(s=>s.requirementIds.includes(`addition-${task.revision}`));
      else return reject('step_required','Supply the exact planned stepId, or extend the plan for this operation.');
    }
    if(step && step.tool!==tool && ['web_search','read_web_page'].includes(tool) && ['web_search','read_web_page'].includes(step.tool)) {
      // A proposed research fallback is an additional read, never a substitution for
      // the original expected result. Preserve its prerequisites and bounded retries.
      if(step.dependsOn.some(id=>task.steps.find(s=>s.id===id)?.state!=='verified'))return reject('dependency_pending','Verify prerequisites before adding a research fallback.');
      const anchor=step;
      step=task.steps.find(s=>s.recoveryFor===anchor.id && s.tool===tool);
      if(!step){step={id:`recovery-${randomUUID()}`,title:`Supplemental ${tool} for ${anchor.title}`,tool,action:'',requirementIds:[...anchor.requirementIds],dependsOn:[...anchor.dependsOn],expected:`Supplemental source discovery for ${anchor.id}; original outcome remains required`,state:'pending',attempts:0,evidenceIds:[],implicit:true,recoveryFor:anchor.id};task.steps.push(step);}
      if(step.attempts>=3)return {status:'blocked',message:'Supplemental research read limit reached. Revise the plan or report the source obstacle.',stepId:step.id,context:context(task)};
    }
    if(step?.freshRead && step.expectedSourceUrl && input.url!==step.expectedSourceUrl)return reject('invalid_request','Reread the exact requested source URL before reporting the added outcome.');
    if(step&&(step.tool!==tool || step.action&&step.action!==input.action)) return reject('invalid_request',`Tool/action does not match the planned step ${step.id} (${step.tool}/${step.action||'read'}). Call plan_task to add the requested tool; never reuse a different tool's step ID.`);
    if(step?.state==='verified'&&!reads.has(tool)) return {status:'already_verified',stepId:step.id,message:'Do not replay this verified effect.'};
    if(step?.state==='verified'&&reads.has(tool)&&!step.recoveryFor) step.attempts=0;
    if(step?.state==='running'||step?.state==='verifying') return {status:'busy',stepId:step.id};
    if(step?.uncertain) return {status:'completion_unknown',completionUnknown:true,message:'Inspect the effect and reconcile this step before retrying.'};
    if(step?.dependsOn.some(id=>task.steps.find(s=>s.id===id)?.state!=='verified')) return reject('dependency_pending','Verify prerequisites before this step.');
    if(step?.attempts>=3) return {status:'blocked',message:'Two recovery attempts exhausted.',stepId:step.id};
    const b=task.budget;
    if(b.actions>=MAX_STEPS || b.startedAt!==null&&now()-b.startedAt>=MAX_TIME) {task.status='paused';event(task);return {status:'limit_reached',context:context(task)};}
    if(b.checkpointActions>=20 || b.checkpointAt!==null&&now()-b.checkpointAt>=180000) { b.checkpoints++;b.checkpointActions=0;b.checkpointAt=now();event(task); }
    b.startedAt ??= now(); b.checkpointAt ??= now(); b.actions++; b.checkpointActions++;
    if(!step) {
      if (['web_search','read_web_page'].includes(tool) && task.requirements.length === 1) {
        task.requirements.push({id:'source-answer',text:'Answer the requested question using retrieved source evidence; distinguish unavailable information from proven absence.',kind:'research',status:'pending',evidenceIds:[],controllerOwned:true});
        task.planRegistered=true;
        task.implicitSourcePlan=true;
      }
      step={id:randomUUID(),title:clean(input.action||tool,250),tool,action:input.action||'',requirementIds:['web_search','read_web_page'].includes(tool)&&task.requirements.some(r=>r.id==='source-answer')?['source-answer']:['request'],dependsOn:[],expected:clean(input.expect ? JSON.stringify(input.expect):'Verified tool result'),state:'pending',attempts:0,evidenceIds:[],implicit:true}; task.steps.push(step);
    }
    task.protocolFailures={};
    step.state='running';step.attempts++;step.startedAt=now();step.signature=signature;step.requestId=input.requestId;
    step.expectedState=input.expect || (tool==='browser_act'&&input.action==='navigate'&&input.args?.url ? {kind:'url',value:input.args.url} : null);
    step.controlIdentity=input.controlIdentity;task.delivery='pending';event(task);
    return {status:'ok',stepId:step.id,revision:task.revision,...(tool==='read_web_page' && sourceScopeIssue(task,input.url) ? {scopeIssue:sourceScopeIssue(task,input.url)} : {})};
  }
  function finish(task, token, tool, input, result={}) {
    const s=task.steps.find(s=>s.id===token.stepId);
    if(!s || token.revision!==task.revision || task.status==='cancelled') return {status:'stale_revision'};
    s.state='verifying';event(task);
    const scopeIssue=tool==='read_web_page' && (sourceScopeIssue(task,input.url) || sourceScopeIssue(task,result.url));
    if(scopeIssue)result={status:'out_of_scope',url:result.url || input.url,message:scopeIssue};
    const read=reads.has(tool);
    const scopeOnly=tool==='read_web_page' && task.scopeCheck && result.status==='out_of_scope' && !!sourceScopeIssue(task,result.url||input.url) && /different country|not evidence for Bangladesh/i.test(result.message||'');
    const negativeRead=tool==='read_web_page' && task.pageAttemptOnly && ['unavailable','not_found','failed','partial'].includes(result.status) && !!result.message;
    const ok=(result.status==='ok' && (read || result.verification?.verified===true) || scopeOnly || negativeRead) && result.completionUnknown!==true;
    const content=clean(scopeOnly ? `URL country-scope check: ${foreignLocale(result.url||input.url) || 'non-Bangladesh'}. Page rejected before retrieval; page content was not read. ${result.message}. Bangladesh policy remains unverified.` : negativeRead ? `Observed retrieval status: ${result.status}. The page was not read successfully. Actual failure: ${result.message}.` : result.content || result.observation?.text || result.value || (result.observation ? JSON.stringify({windows:result.observation.windows,apps:result.observation.apps,controls:result.observation.controls?.map(c=>({name:c.name,role:c.role})),title:result.observation.title}) : result.apps ? JSON.stringify(result.apps.map(a=>({name:a.name,path:a.path}))) : ''),32000);
    const e={id:randomUUID(),stepId:s.id,revision:task.revision,tool,at:now(),status:result.status||'failed',verified:ok,sourceUrl:clean(result.url || input.url,2000),excerpt:content,observation:result.observation ? {url:result.observation.url,documentId:result.observation.documentId,title:result.observation.title} : undefined,verification:result.verification,temperature:result.temperature,location:result.resolvedLocation||result.location};
    task.ledgerEvidence.push(e); s.evidenceIds.push(e.id);
    Object.assign(e, {handle:result.handle,windows:result.observation?.windows,conditions:result.conditions,truncated:result.truncated,nextOffset:result.nextOffset,offset:result.offset,totalCharacters:result.totalCharacters,links:result.links,linksTruncated:result.linksTruncated});
    Object.assign(e,{applicationWindows:result.observation?.applicationWindows,visibleApplicationWindows:result.observation?.visibleApplicationWindows,windowComparison:result.observation?.comparison,feelsLike:result.feelsLike});
    if(scopeOnly)e.scopeOnly=true;
    if(negativeRead)e.negativeRead=true;
    for(const source of (result.querySources || [])) if(source.status==='verified' && source.content && source.url) {
      const page={id:randomUUID(),stepId:s.id,revision:task.revision,tool:'read_web_page',at:now(),status:'ok',verified:true,sourceUrl:clean(source.url,2000),excerpt:clean(source.content,32000)};
      task.ledgerEvidence.push(page);s.evidenceIds.push(page.id);
    }
    s.state=ok?'verified':['confirmation_required','needs_selection','disabled','out_of_scope','scope_required'].includes(result.status)?'blocked':s.attempts>=3?'failed':'pending';
    s.uncertain=result.completionUnknown===true;
    if(!ok) s.obstacle=clean(result.message||result.status,500); else delete s.obstacle;
    // An observation proves only the observation. Research assertions require a source-backed answer review.
    for(const id of s.requirementIds) { const r=task.requirements.find(r=>r.id===id); if(r && r.kind!=='research' && (r.id!=='request'||!task.planRegistered&&!task.planRequired)&&ok && (!tool.endsWith('observe')||r.id==='request')&&tool!=='web_search'&&tool!=='read_web_page') {r.status='verified';r.evidenceIds=[...new Set([...r.evidenceIds,e.id])];} }
      const inventory=task.requirements.find(r=>r.id==='window-inventory'&&r.controllerOwned);
      if (inventory && ok && tool==='desktop_observe' && Array.isArray(result.observation?.windows) && s.requirementIds.includes(inventory.id)) {inventory.status='verified';inventory.evidenceIds=[e.id];}
      if(s.freshRead && ok && tool==='read_web_page')for(const requirement of task.requirements.filter(r=>r.controllerOwned && s.requirementIds.includes(r.id))){requirement.status='verified';requirement.evidenceIds=[e.id];requirement.executionOnly=true;}
    if(tool.endsWith('observe') && ok) for(const uncertain of task.steps.filter(step=>step.uncertain)) reconcile(task,uncertain.id,result);
    event(task); return {status:'ok',evidenceId:e.id,stepId:s.id,context:context(task)};
  }
  function reconcile(task,stepId,result) {
    const step=task.steps.find(s=>s.id===stepId), expectation=step?.expectedState, observation=result?.observation;
    if(!step || !expectation || result?.status!=='ok' || !observation) return false;
    let matched=false;
    if(expectation.kind==='url') {
      try{matched=new URL(observation.url).href===new URL(expectation.value).href && !!observation.documentId && (observation.ready===true || observation.readyState==='complete');}catch{}
    } else if(['value','checked','text'].includes(expectation.kind) && step.controlIdentity) {
      const controls=(observation.elements || observation.controls || []).filter(c=>(c.name||c.label)===(step.controlIdentity.name||step.controlIdentity.label)&&c.role===step.controlIdentity.role);
      if(controls.length===1) {
        const observed=expectation.kind==='checked'?controls[0].checked:expectation.kind==='text'?controls[0].text||controls[0].name:controls[0].value;
        matched=String(observed)===String(expectation.value);
      }
    }
    if(!matched) return false;
    step.uncertain=false;
    finish(task,{stepId:step.id,revision:task.revision},step.tool,{}, {status:'ok',verification:{verified:true,evidence:'Fresh independent observation matches the exact expected outcome.'}});
    if(task.pending)task.pending=task.pending.filter(s=>s.requestId!==step.requestId);
    if(task.completed && !task.completed.some(s=>s.requestId===step.requestId))task.completed.push({requestId:step.requestId,tool:step.tool,action:step.action,status:'verified'});
    return true;
  }
  function currentEvidence(task,e){const step=task.steps.find(s=>s.id===e?.stepId);return !!(e?.verified&&step?.state==='verified'&&step.evidenceIds.includes(e.id));}
  function resolveReview(task,input) {
    return {...input,claims:Array.isArray(input.claims)?input.claims.map(claim=>{
      if(!claim.sourcePassageId)return {...claim};
      const source=task.ledgerEvidence.find(e=>e.id===claim.evidenceId && claim.sourcePassageId===e.id+':excerpt' && currentEvidence(task,e) && e.sourceUrl && !e.negativeRead && !e.scopeOnly);
      const excerpt=source?clean(source.excerpt,32000):'';
      const conflict=claim.sourceQuote && !normalize(excerpt).includes(normalize(claim.sourceQuote));
      // A valid narrow quote stays narrow; it may be beyond the first window.
      // The passage ID never authorizes fabricated quotation text.
      return {...claim,sourceQuote:conflict?'':claim.sourceQuote || excerpt.slice(0,3500)};
    }):input.claims};
  }
  function reviewAttemptKey(task,input) {return hash([task.revision,input,task.ledgerEvidence.map(e=>[e.id,e.verified,currentEvidence(task,e)])]);}
  function reviewGate(task,input) {
    if(input.revision!==task.revision || task.status==='cancelled')return {status:'stale_revision',completed:false};
    if((task.reviewAttempts?.[reviewAttemptKey(task,input)] || 0)>=3) {
      return {status:'blocked',completed:false,repairExhausted:true,review:task.lastReview,context:context(task),repairInstruction:'This completion review already failed after two repair attempts. Finish the partial report from verified findings and the recorded obstacle. A further review needs corrected evidence mappings or new verified evidence; never repeat mutations.'};
    }
  }
  function review(task, input={}, { grounding } = {}) {
    input=resolveReview(task,input);
    const gate=reviewGate(task,input);if(gate)return gate;
    const limit=controlLimit(task);if(limit)return limit;
    if(input.revision!==task.revision || task.status==='cancelled') return {status:'stale_revision'};
    if(typeof input.answer!=='string'||input.coverage!==undefined&&(!Array.isArray(input.coverage)||input.coverage.some(c=>!c||c.sourceQuote!==undefined&&typeof c.sourceQuote!=='string'||typeof c.answerQuote!=='string'||!Array.isArray(c.evidenceIds)))||input.claims!==undefined&&(!Array.isArray(input.claims)||input.claims.some(c=>!c||c.sourceQuote!==undefined&&typeof c.sourceQuote!=='string'||typeof c.answerQuote!=='string'))||input.domainIssues!==undefined&&!Array.isArray(input.domainIssues)) return {status:'invalid_request',message:'Completion review requires answer text and valid coverage/claim arrays.'};
    const attemptKey=reviewAttemptKey(task,input);task.reviewAttempts ||= {};
    task.reviewAttempts[attemptKey]=(task.reviewAttempts[attemptKey]||0)+1;
    let answer=clean(input.answer,32000);
    const coverage=Array.isArray(input.coverage)?input.coverage.map(item=>({...item})):[];
    const citations=new Set();
    for(const claim of (input.claims || [])) if(!coverage.some(c=>c.requirementId===claim.requirementId) && task.requirements.some(r=>r.id===claim.requirementId&&r.id!=='request')) coverage.push({requirementId:claim.requirementId,answerQuote:claim.answerQuote,evidenceIds:[claim.evidenceId]});
    for(const claim of (input.claims || [])) {
      const source=task.ledgerEvidence.find(e=>e.id===claim.evidenceId);
      if(currentEvidence(task,source) && source.sourceUrl && source.excerpt && claim.sourceQuote && normalize(source.excerpt).includes(normalize(claim.sourceQuote)) && claim.answerQuote && normalize(answer).includes(normalize(claim.answerQuote)) && !answer.includes(source.sourceUrl)) citations.add(source.sourceUrl);
    }
    if(citations.size)answer+='\nSources: '+[...citations].join(' | ');
    const reviewKey=hash([task.revision,normalize(answer)]);
    if(task.reviewKey!==reviewKey)for(const r of task.requirements)if((r.kind==='research'||r.reviewVerified) && !(r.status==='verified' && r.reviewRevision<task.revision)){r.status='pending';r.evidenceIds=[];r.reviewVerified=false;}
    task.reviewKey=reviewKey;
    const presentationIds=new Set();
    for(const r of task.requirements) if(r.id!=='request' && /^(?:cite\b|(?:provide|include|list) (?:the )?(?:source (?:urls?|links?)|citations?)\b|source (?:urls?|links?)\b|সূত্রের.*(?:url|লিংক))/i.test(r.text)) {
      const cited=task.ledgerEvidence.filter(e=>currentEvidence(task,e) && e.sourceUrl && answer.includes(e.sourceUrl) && task.steps.find(s=>s.id===e.stepId)?.state==='verified');
      if(cited.length){presentationIds.add(r.id);r.status='verified';r.evidenceIds=cited.map(e=>e.id);}
    }
    const issues=[];
    for(const item of coverage) {
      const r=task.requirements.find(r=>r.id===item.requirementId); if(!r || r.id==='request' || presentationIds.has(r.id) || r.executionOnly && r.status==='verified') continue;
      r.status='pending';r.reviewVerified=false;
      const answerQuote=clean(item.answerQuote,3000);
      const derived=dependencies(task.steps,task.steps.filter(step=>step.tool==='answer'&&step.requirementIds.includes(r.id)).map(step=>step.id));
      const evidence=(item.evidenceIds||[]).map(id=>task.ledgerEvidence.find(e=>e.id===id)).filter(e=>currentEvidence(task,e) && (task.steps.find(s=>s.id===e.stepId)?.requirementIds.includes(r.id)||derived.has(e.stepId)) && task.steps.find(s=>s.id===e.stepId)?.state==='verified');
      if(!answerQuote || !normalize(answer).includes(normalize(answerQuote))) {issues.push(`${r.id}: answer coverage missing`);continue;}
      if(item.unknown===true) { r.status='blocked';r.obstacle=answerQuote;continue; }
      if(!evidence.length) {issues.push(`${r.id}: verified requirement evidence missing`);continue;}
      const sourceTask = r.kind==='research' || evidence.some(e=>['web_search','read_web_page'].includes(e.tool) && !e.scopeOnly && !e.negativeRead);
      if(sourceTask) {
        const claims=(input.claims||[]).filter(c=>c.requirementId===r.id);
        if(!claims.length || claims.some(c=>{const source=evidence.find(e=>e.id===c.evidenceId);return !source?.sourceUrl||!source.excerpt||!c.sourceQuote||!normalize(source.excerpt).includes(normalize(c.sourceQuote))||!c.answerQuote||!normalize(answer).includes(normalize(c.answerQuote))||!answer.includes(source.sourceUrl);})) {issues.push(`${r.id}: claim/source mapping or citation missing`);continue;}
        const requested=r.id==='source-answer'?task.goal:r.text;
        if(/bangladesh|বাংলাদেশ/i.test(requested) && /solar|renewable|net.metering|সৌর|নবায়নযোগ্য|নেট মিটারিং/i.test(requested) && /official|primary|government|original source|সরকারি|প্রাথমিক উৎস/i.test(requested) && claims.some(c=>{
          try{return !/(^|\.)(?:gov\.bd|idcol\.org|worldbank\.org|adb\.org|irena\.org|iea\.org|ieefa\.org|eia\.gov)$/.test(new URL(evidence.find(e=>e.id===c.evidenceId).sourceUrl).hostname);}catch{return true;}
        })) {issues.push(`${r.id}: requested primary-source evidence missing; a secondary report cannot fulfill this outcome`);continue;}
        // Without a trusted independent review, only literal source statements
        // are admissible. A model-supplied verdict in input is never trusted.
        if(!grounding && claims.some(c=>normalize(c.answerQuote).replace(/https?:\/\/\S+/g,'').replace(/\bsource:?\s*$/i,'').trim()!==normalize(c.sourceQuote))) {issues.push(`${r.id}: semantic evidence support requires independent review`);continue;}
      }
      const verdict=grounding?.outcomes?.find(v=>v.requirementId===r.id);
      if(grounding && sourceTask && verdict?.supported!==true) {issues.push(`${r.id}: ${clean(verdict?.reason||'Independent evidence support missing',300)}`);continue;}
      r.status='verified';r.reviewVerified=true;r.reviewRevision=task.revision;r.reviewedPassage=answerQuote;r.evidenceIds=evidence.map(e=>e.id);
    }
    const domainIssues=[...(input.domainIssues||[]).map(v=>clean(v,250)), ...reviewOutcomeIssues(task, answer, task.ledgerEvidence.filter(e=>currentEvidence(task,e)))];
    if(generationTerm.test(task.goal)&&turnTerm.test(task.goal)) {
      if(!generationTerm.test(answer))domainIssues.push('Explain generation completion explicitly; turnComplete/session-idle alone does not cover it.');
      if(!turnTerm.test(answer))domainIssues.push('Explain turn completion explicitly and distinguish it from generation completion.');
      if(!grounding && /(?:not|doesn.t|does not).{0,50}(?:defin|explain)|undefined|সংজ্ঞা.{0,25}(?:নেই|হয়নি|হয়নি)/i.test(answer) && generationTerm.test(answer))domainIssues.push('A missing definition leaves the requested completion distinction unverified; obtain the API reference or report the outcome as unknown.');
      if(/turn_?complete.{0,70}interrupt|turn_?complete.{0,70}বাধা/i.test(answer) && !/server.{0,60}turn|output.{0,60}turn|সার্ভার.{0,60}টার্ন/i.test(answer))domainIssues.push('Client turnComplete input is not the server turn-completion definition. Explain the server output separately.');
    }
    const scopeEvidence=task.ledgerEvidence.filter(e=>e.scopeOnly && currentEvidence(task,e));
    const scopeReport=/(?:cannot|can't|does not|doesn't|not).{0,40}verif|unverified|যাচাই.{0,25}(?:নয়|হয়নি|পারে না)/i.test(answer) && /bangladesh|বাংলাদেশ/i.test(answer) && /not read|not retrieved|before retrieval|rejected|out_of_scope|পড়া হয়নি|পড়া হয়নি|প্রত্যাখ্যান/i.test(answer) && scopeEvidence.some(e=>answer.includes(e.sourceUrl));
    if(task.scopeCheck && scopeEvidence.length && !scopeReport)domainIssues.push('Report the negative URL scope finding, that the rejected page was not read, and the missing Bangladesh evidence. Do not claim policy verification or article content.');
    if(task.scopeCheck && scopeEvidence.length && scopeReport) {
      // Only the requested negative scope finding is proved, never article content.
      for(const r of task.requirements)if(['scope-verdict','scope-limits'].includes(r.id)){r.status='verified';r.reviewVerified=true;r.evidenceIds=scopeEvidence.map(e=>e.id);}
    }
    if(task.pageAttemptOnly) {
      const failure=task.ledgerEvidence.find(e=>e.negativeRead && currentEvidence(task,e));
      if(failure && (!answer.includes(failure.sourceUrl) || !/not read|failed|unavailable|could not|পড়া যায়নি|ব্যর্থ|পড়া হয়নি/i.test(answer)))domainIssues.push('Report the actual failed retrieval and checked URL; do not imply successfully read article content.');
      if(failure && /(?<!not )\bread (?:the page )?successfully\b|\b(?:page|website) (?:was|is) (?:read|retrieved|opened) successfully\b|\bcontains (?:product|article|price)|সফলভাবে.{0,15}(?:পড়েছি|পড়েছি|পড়া হয়েছে)/i.test(answer))domainIssues.push('The failed retrieval cannot support a successful page-read or article-content claim.');
    }
    const incomplete=task.requirements.filter(r=>r.id!=='request'&&r.status!=='verified');
    const pending=task.steps.filter(s=>s.state!=='verified' && s.tool!=='answer');
    const substantial=answer.trim().length>=40 && !acknowledgmentOnly(answer);
    const root=task.requirements.find(r=>r.id==='request');
    const rootObserved=task.ledgerEvidence.some(e=>currentEvidence(task,e)&&task.steps.find(s=>s.id===e.stepId)?.requirementIds.includes('request')&&!['web_search','read_web_page'].includes(e.tool));
    const completed=!task.needsClarification&&!task.planRequired&&!task.refinementPending&&!incomplete.length&&!pending.length&&!issues.length&&!domainIssues.length&&(task.planRegistered?substantial:rootObserved&&!acknowledgmentOnly(answer));
    if(completed) {root.status='verified';root.evidenceIds=[...new Set(task.requirements.flatMap(r=>r.evidenceIds))];task.status='completed';for(const s of task.steps) if(s.tool==='answer')s.state='verified';}
    else {root.status='pending';if(!['paused','awaiting_confirmation'].includes(task.status)) task.status=task.steps.some(s=>s.uncertain||s.state==='blocked'||s.state==='failed')||incomplete.some(r=>r.status==='blocked')?'blocked':'partial';}
    task.lastReview={at:now(),completed,issues:[...issues,...domainIssues],missingRequirements:incomplete.map(r=>r.id),pendingSteps:pending.map(s=>s.id)};
    const auditKey=hash([task.revision,[...new Set(task.ledgerEvidence.map(e=>hash([e.sourceUrl,e.excerpt,e.status,e.verified])))].sort(),incomplete.map(r=>r.id),[...new Set(pending.flatMap(s=>s.requirementIds))].sort()]);
    task.auditRecoveryExhausted=false;
    if(!completed) {
      task.auditFailures ||= {};
      task.auditFailures[auditKey]=(task.auditFailures[auditKey]||0)+1;
      if(task.auditFailures[auditKey]>=3 && !['paused','awaiting_confirmation','cancelled'].includes(task.status)) {
        task.status='blocked';task.auditRecoveryExhausted=true;
        task.lastReview.issues.push('Two completion repair attempts exhausted without new evidence or verified progress. Report the remaining obstacle; do not repeat this review.');
      }
    } else task.auditRecoveryExhausted=false;
    const repair=[];
    if(task.planRequired)repair.push('Register every requested outcome with plan_task before completion. Preserve existing observed steps.');
    if(domainIssues.length)repair.push('Correct the actual answer coverage: '+domainIssues.join('; '));
    if(incomplete.length)repair.push('Review EACH non-root outcome separately. The root request ID is not a coverage mapping. Required coverage/claim requirementIds: '+incomplete.map(r=>`${r.id} (${r.text})`).join('; ')+'. Use these exact IDs, evidenceIds from their linked verified steps, and a verbatim answerQuote from the corrected answer. Research outcomes also need a relevant verbatim sourceQuote and source URL.');
    if(issues.length)repair.push('Copy coverage.answerQuote and claims.answerQuote verbatim FROM answerPassages. Prefer the exact sourcePassageId from sourcePassages or evidence context: the controller supplies its observed excerpt and independently checks support. Alternatively copy a SHORT relevant sourceQuote verbatim; never join separate phrases with invented ellipses. Attribute promotional superlatives to the website, not to an independent ranking. Repair these fields and review again; do not change the answer while retaining quotes from an older draft.');
    if(task.auditRecoveryExhausted)repair.splice(0,repair.length,'Completion recovery exhausted without evidence progress. Report the missing outcomes and obstacle accurately. A further review requires new relevant evidence or independent verified progress; never repeat mutations.');
    if(grounding?.unavailable) {
      task.status='blocked';
      repair.splice(0,repair.length,'Independent evidence review is unavailable. Preserve the execution results and retrieved sources. State which outcomes remain unverified and finish the partial reply; do not repeat searches, actions or quotation repairs to cure a provider failure. A later review may retry the preserved evidence.');
    }
    event(task); return {status:completed?'completed':task.status,completed,answer,answerPassages:answer.split(/(?<=[.!?।])\s+/).slice(0,40),sourcePassages:task.ledgerEvidence.filter(e=>currentEvidence(task,e)&&e.sourceUrl&&e.excerpt&&!e.negativeRead&&!e.scopeOnly).slice(-10).map(e=>({evidenceId:e.id,sourcePassageId:e.id+':excerpt',url:e.sourceUrl,passages:e.excerpt.split(/(?<=[.!?।])\s+/).slice(0,8)})),repairInstruction:repair.length?repair.join(' '):undefined,review:task.lastReview,context:context(task)};
  }
  function context(task) {
    return {windowTargets:task.windowTargets,pauseReason:task.pauseReason,nextStep:task.steps.find(s=>s.state==='pending'&&s.dependsOn.every(id=>task.steps.find(dep=>dep.id===id)?.state==='verified'))?.id,completedOutcomes:task.requirements.filter(r=>r.id!=='request'&&r.status==='verified').map(r=>r.id),remainingOutcomes:task.requirements.filter(r=>r.id!=='request'&&r.status!=='verified').map(r=>r.id),id:task.id,revision:task.revision,goal:task.goal,latestRequest:task.latestRequest,status:task.status,delivery:task.delivery,planRequired:task.planRequired,needsClarification:task.needsClarification,clarificationQuestion:task.needsClarification?task.clarificationQuestion:undefined,refinementPending:task.refinementPending,requirements:task.requirements,steps:task.steps,budget:task.budget,evidence:task.ledgerEvidence.map(e=>({...e,verified:currentEvidence(task,e),sourcePassageId:currentEvidence(task,e)&&e.sourceUrl&&e.excerpt&&!e.negativeRead&&!e.scopeOnly?e.id+':excerpt':undefined,excerpt:clean(e.excerpt,3500)}))};
  }
  return {init,register,begin,finish,review,resolveReview,reviewGate,context,invalidate,event,reads,reconcile};
}
module.exports={createLedger};
