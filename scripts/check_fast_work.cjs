const assert = require('node:assert/strict');
const test = require('node:test');
const { createFastWork } = require('../electron/fast-work.cjs');
const { createFastWorker } = require('../electron/fast-worker.cjs');
function fixture(overrides = {}) {
  const effects = [], events = [], metrics = [];
  const state = { value: '', query: '', active: '', muted: false, playing: false };
  const browser = {
    observe: async () => ({ status: 'ok', observation: { elements: [{ ref: 's:element:1:0:input', role: 'textbox', name: 'Search', editable: true }, { ref: 's:element:1:0:send', role: 'button', name: 'Send' }] } }),
    act: async input => {
      effects.push(input.action);
      if (['type','key'].includes(input.action) && !input.args?.ref?.includes(':element:') && !input.target?.includes(':element:')) return { status: 'invalid_target_type' };
      if (input.action === 'type') state.value = input.args.text;
      if (input.action === 'search') state.query = input.args.query;
      if (input.action === 'navigate') state.active = input.args.url;
      if (input.action === 'tab_mute') state.muted = input.args.enabled;
      if (input.action === 'youtube_pause') state.playing = false;
      if (input.action === 'youtube_resume') state.playing = true;
      return { status: 'ok', verification: { verified: true, evidence: 'Fixture state checked.' } };
    }, cancel: () => {}, ...overrides.browser,
  };
  const desktop = { observe: async () => ({ status: 'ok', observation: { controls: [{ ref: 'd:control:1:0', role: 'Edit', name: 'Document', editable: true }] } }),
    act: async input => { effects.push(input.action); if (input.action === 'type') state.value = input.args.text; if (input.action === 'launch') state.active = input.appName; return { status: 'ok', verification: { verified: true, evidence: 'Fixture app state checked.' } }; }, ...overrides.desktop };
  const work = createFastWork({ browser, desktop, emit: event => events.push(event), metrics: value => metrics.push(value) });
  work.configure({ desktopEnabled: true });
  const task = work.update({ text: 'Search OpenCode on Google' });
  return { work, task, effects, events, state, metrics };
}

const cases = [
  ['Google search', async f => { await f.work.workflow(f.task.id,{operation:'search',query:'OpenCode'}); assert.equal(f.state.query,'OpenCode'); }],
  ['Bangla search', async f => { await f.work.workflow(f.task.id,{operation:'search',query:'বাংলা গান'}); assert.equal(f.state.query,'বাংলা গান'); }],
  ['Mixed language query', async f => { await f.work.workflow(f.task.id,{operation:'search',query:'OpenCode বাংলা tutorial'}); assert.equal(f.state.query,'OpenCode বাংলা tutorial'); }],
  ['Open Spotify', async f => { await f.work.workflow(f.task.id,{operation:'open',url:'https://open.spotify.com/'}); assert.equal(f.state.active,'https://open.spotify.com/'); }],
  ['Switch website', async f => { const r=await f.work.workflow(f.task.id,{operation:'switch',target:'Spotify'}); assert.equal(r.completion,'verified_step'); }],
  ['Find media', async f => { const r=await f.work.workflow(f.task.id,{operation:'find_media',query:'Chorabali'}); assert.equal(r.completion,'verified_step'); }],
  ['Select stable media choice', async f => { const r=await f.work.workflow(f.task.id,{operation:'select_media',candidateId:'choice:2'}); assert.equal(r.completion,'verified_step'); }],
  ['Mute', async f => { await f.work.execute(f.task.id,'browser_act',{action:'tab_mute',args:{enabled:true}}); assert.equal(f.state.muted,true); }],
  ['Unmute', async f => { f.state.muted=true; await f.work.execute(f.task.id,'browser_act',{action:'tab_mute',args:{enabled:false}}); assert.equal(f.state.muted,false); }],
  ['Pause', async f => { f.state.playing=true; await f.work.execute(f.task.id,'browser_act',{action:'youtube_pause'}); assert.equal(f.state.playing,false); }],
  ['Resume', async f => { await f.work.execute(f.task.id,'browser_act',{action:'youtube_resume'}); assert.equal(f.state.playing,true); }],
  ['Launch Notepad', async f => { await f.work.execute(f.task.id,'desktop_act',{action:'launch',appName:'Notepad'}); assert.equal(f.state.active,'Notepad'); }],
  ['Launch Calculator', async f => { await f.work.execute(f.task.id,'desktop_act',{action:'launch',appName:'Calculator'}); assert.equal(f.state.active,'Calculator'); }],
  ['Launch Explorer', async f => { await f.work.execute(f.task.id,'desktop_act',{action:'launch',appName:'File Explorer'}); assert.equal(f.state.active,'File Explorer'); }],
  ['Desktop text entry', async f => { await f.work.execute(f.task.id,'desktop_act',{action:'type',args:{ref:'d:control:1:0',text:'Hello বাংলা'}}); assert.equal(f.state.value,'Hello বাংলা'); }],
  ['Correction preserves goal', async f => { const t=f.work.update({taskId:f.task.id,text:'Actually use the browser search bar'}); assert.equal(t.id,f.task.id); assert.equal(t.goal,f.task.goal); assert.equal(t.corrections.length,1); }],
  ['Explicit new task replaces old', async f => { const t=f.work.update({taskId:f.task.id,text:'Open Calculator',replace:true}); assert.notEqual(t.id,f.task.id); assert.equal(f.work.task(f.task.id).status,'cancelled'); }],
  ['Incremental transcription', async f => { const t=f.work.update({taskId:f.task.id,text:'Search OpenCode AI on Google',incremental:true}); assert.equal(t.id,f.task.id); assert.equal(t.goal,'Search OpenCode AI on Google'); }],
  ['Observation is not action completion', async f => { await f.work.execute(f.task.id,'browser_observe',{scope:'page'}); assert.equal(f.work.task(f.task.id).completed.length,0); }],
  ['Missing target repair', async f => { const r=await f.work.execute(f.task.id,'browser_act',{action:'type',target:'s:tab:1',args:{text:'OpenCode'}}); assert.equal(r.completion,'verified_step'); assert.equal(f.state.value,'OpenCode'); }],
  ['Enter confirmation', async f => { await f.work.execute(f.task.id,'browser_observe',{scope:'page'}); const r=await f.work.execute(f.task.id,'browser_act',{action:'key',args:{ref:'s:element:1:0:input',key:'Enter'}}); assert.equal(r.status,'confirmation_required'); assert.equal(f.effects.length,0); }],
  ['External send confirmation', async f => { await f.work.execute(f.task.id,'browser_observe',{scope:'page'}); const r=await f.work.execute(f.task.id,'browser_act',{action:'click',args:{ref:'s:element:1:0:send'}}); assert.equal(r.status,'confirmation_required'); assert.equal(f.effects.length,0); }],
  ['Destructive action confirmation', async f => { const r=await f.work.execute(f.task.id,'browser_act',{action:'history_delete',target:'h'}); assert.equal(r.status,'confirmation_required'); assert.equal(f.effects.length,0); }],
  ['Approval applies exact action once', async f => { const r=await f.work.execute(f.task.id,'browser_act',{action:'history_delete',target:'h'}); assert.equal(f.work.decide(r.approvalId,true),true); await f.work.resumeApproval(r.approvalId); await f.work.resumeApproval(r.approvalId); assert.equal(f.effects.length,1); }],
  ['Declined approval applies no effect', async f => { const r=await f.work.execute(f.task.id,'browser_act',{action:'history_delete'}); f.work.decide(r.approvalId,false); assert.equal((await f.work.resumeApproval(r.approvalId)).status,'cancelled'); assert.equal(f.effects.length,0); }],
  ['Cancelled task cannot mutate', async f => { f.work.cancel(f.task.id); assert.equal((await f.work.execute(f.task.id,'browser_act',{action:'navigate',args:{url:'https://example.com'}})).status,'cancelled'); assert.equal(f.effects.length,0); }],
  ['Desktop feature gate', async f => { f.work.configure({desktopEnabled:false}); assert.equal((await f.work.execute(f.task.id,'desktop_act',{action:'launch',appName:'Notepad'})).status,'disabled'); assert.equal(f.effects.length,0); }],
  ['Worker feature gate', async f => { const w=createFastWorker(f.work,{client:{}}); assert.equal((await w.run(f.task.id)).status,'disabled'); }],
  ['Partial cannot complete task', async () => { const f=fixture({browser:{act:async()=>({status:'partial',verification:{verified:false}})}}); const r=await f.work.execute(f.task.id,'browser_act',{action:'navigate'}); assert.equal(r.completion,'unresolved'); assert.equal(f.work.task(f.task.id).completed.length,0); }],
  ['Unverified ok is downgraded', async () => { const f=fixture({browser:{act:async()=>({status:'ok'})}}); const r=await f.work.execute(f.task.id,'browser_act',{action:'navigate'}); assert.equal(r.status,'dispatched'); assert.equal(f.work.task(f.task.id).completed.length,0); }],
];
for (const [name, scenario] of cases) test(name+' (five independent trials)', async () => { for(let trial=0;trial<5;trial++) await scenario(fixture()); });

test('surface aliases serialize, independent reads run concurrently', async () => {
  let active=0, max=0;
  const f=fixture({browser:{act:async()=>{ active++; max=Math.max(max,active); await new Promise(r=>setTimeout(r,10)); active--; return {status:'ok',verification:{verified:true}}; }}});
  await Promise.all([f.work.execute(f.task.id,'browser_act',{action:'navigate',target:'current'}),f.work.execute(f.task.id,'browser_act',{action:'navigate',target:'s:tab:1'})]); assert.equal(max,1);
});
test('uncertain action is not replayed', async()=>{ let count=0; const f=fixture({browser:{act:async()=>{count++;return {status:'timeout',completionUnknown:true};}}}); await f.work.execute(f.task.id,'browser_act',{action:'navigate'}); assert.equal(count,1); });
test('worker is bounded, reviewed done is not fabricated completion',async()=>{
  const f=fixture(); f.work.configure({workerEnabled:true});
  const client={models:{generateContent:async()=>({text:JSON.stringify({tool:'browser_observe',input:{scope:'page'}})})}};
  const worker=createFastWorker(f.work,{client,maxSteps:2}); const result=await worker.run(f.task.id); assert.equal(result.status,'partial'); assert.equal(result.steps,2);
  const done=createFastWorker(f.work,{client:{models:{generateContent:async()=>({text:'{"done":true,"reason":"finished"}'})}}}); assert.equal((await done.run(f.task.id)).status,'review');
});
test('cancellation during worker generation prevents late effects', async()=>{
  const f=fixture(); f.work.configure({workerEnabled:true}); let finish;
  const worker=createFastWorker(f.work,{client:{models:{generateContent:()=>new Promise(r=>finish=r)}}}); const pending=worker.run(f.task.id); worker.cancel(f.task.id); finish({text:'{"tool":"browser_act","input":{"action":"navigate"}}'}); assert.equal((await pending).status,'cancelled'); assert.equal(f.effects.length,0);
});
test('metrics contain no entered values or screenshot data',async()=>{const f=fixture();await f.work.execute(f.task.id,'browser_act',{action:'type',args:{ref:'s:element:1:0:input',text:'PRIVATE'}});assert.doesNotMatch(JSON.stringify(f.metrics),/PRIVATE/);});
test('numbered choices preserve the original task and confirmed effects',async()=>{const f=fixture({browser:{act:async()=>({status:'needs_selection',options:[{candidateId:'one'}]})}});await f.work.workflow(f.task.id,{operation:'find_media',query:'Chorabali'});const updated=f.work.update({taskId:f.task.id,text:'2'});assert.equal(updated.id,f.task.id);assert.equal(updated.goal,f.task.goal);});

test('status questions and spoken yes preserve a pending approval without approving it',async()=>{
  const f=fixture();await f.work.execute(f.task.id,'browser_observe',{scope:'page'});
  const review=await f.work.execute(f.task.id,'browser_act',{action:'click',args:{ref:'s:element:1:0:send'}});
  const before=f.work.task(f.task.id);assert.equal(before.status,'awaiting_confirmation');assert.equal(review.target,'Send');
  for(const text of ['are you done?','yes','হ্যাঁ','কতদূর?']) {
    const task=f.work.update({taskId:f.task.id,text});assert.equal(task.id,f.task.id);assert.equal(task.revision,before.revision);assert.equal(task.status,'awaiting_confirmation');
  }
  assert.equal(f.effects.length,0);
  f.work.decide(review.approvalId,true);const result=await f.work.resumeApproval(review.approvalId);
  assert.equal(result.completion,'verified_step');assert.equal(f.effects.length,1);assert.equal(f.work.task(f.task.id).status,'working');
});

test('safe observed navigation is not gated by a later consequential step in the goal',async()=>{
  const f=fixture({browser:{observe:async()=>({status:'ok',observation:{elements:[{ref:'s:element:1:0:article',role:'link',name:'Read article'},{ref:'s:element:1:0:confirm',role:'button',name:'Confirm'}]}})}});
  const task=f.work.update({taskId:f.task.id,text:'Read the article then submit a comment',replace:true});
  assert.equal((await f.work.execute(task.id,'browser_observe',{scope:'page'})).status,'plan_required');
  assert.equal((await f.work.execute(task.id,'browser_act',{action:'click',args:{ref:'s:element:1:0:article'}})).status,'plan_required');
  f.work.registerPlan(task.id,{revision:task.revision,requirements:[{id:'read',text:'Read the article',kind:'outcome'},{id:'submit',text:'Submit a comment',kind:'outcome'}],steps:[{id:'observe',title:'Observe',tool:'browser_observe',requirementIds:['read'],dependsOn:[],expected:'Fresh controls'},{id:'read',title:'Read',tool:'browser_act',action:'click',requirementIds:['read'],dependsOn:['observe'],expected:'Article visible'},{id:'submit',title:'Submit',tool:'browser_act',action:'click',requirementIds:['submit'],dependsOn:['read'],expected:'Comment published'}]});
  assert.equal((await f.work.execute(task.id,'browser_observe',{stepId:'observe',scope:'page'})).status,'ok');
  assert.equal((await f.work.execute(task.id,'browser_act',{stepId:'read',action:'click',args:{ref:'s:element:1:0:article'}})).status,'ok');
  assert.equal((await f.work.execute(task.id,'browser_act',{action:'click',args:{ref:'s:element:1:0:confirm'}})).status,'confirmation_required');
  assert.equal((await f.work.execute(task.id,'browser_act',{action:'click',args:{ref:'unknown'}})).status,'confirmation_required');
  assert.equal(f.effects.length,1);f.work.cancel(task.id);
});

test('a changed instruction invalidates the reviewed action and prevents its late execution',async()=>{
  const f=fixture();const review=await f.work.execute(f.task.id,'browser_act',{action:'history_delete'});
  f.work.update({taskId:f.task.id,text:'Actually do not delete history'});
  assert.equal(f.work.decide(review.approvalId,true),false);assert.equal((await f.work.resumeApproval(review.approvalId)).status,'cancelled');assert.equal(f.effects.length,0);
});

test('uncertain navigation is inspected without repeating the effect or claiming completion',async()=>{
  let actions=0,observations=0;
  const f=fixture({browser:{act:async()=>{actions++;return {status:'cancelled',completionUnknown:true};},observe:async()=>{observations++;return {status:'ok',observation:{url:'https://example.com/already-opened'}};}}});
  const result=await f.work.execute(f.task.id,'browser_act',{action:'navigate',args:{url:'https://example.com/already-opened'}});
  assert.equal(actions,1);assert.equal(observations,1);assert.equal(result.reconciliation.observation.url,'https://example.com/already-opened');assert.equal(result.completion,'unresolved');assert.equal(f.work.task(f.task.id).completed.length,0);
});
