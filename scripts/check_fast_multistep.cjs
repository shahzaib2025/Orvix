const test=require('node:test'),assert=require('node:assert/strict');
const {createFastWork}=require('../electron/fast-work.cjs');
const {createFastWorker}=require('../electron/fast-worker.cjs');
function fixture(overrides={}) {
  let clock=0;const effects=[],events=[];
  const browser={observe:async()=>({status:'ok',observation:{url:'https://example.com',documentId:'doc',elements:[]}}),act:async input=>{effects.push(input);return {status:'ok',verification:{verified:true,evidence:'Independent actual state checked'}};},...overrides};
  const work=createFastWork({browser,desktop:browser,now:()=>clock,emit:e=>events.push(e)});
  const task=work.update({text:'Open the first page then open the second page'});
  const plan={revision:task.revision,requirements:[{id:'first',text:'First page open',kind:'outcome'},{id:'second',text:'Second page open',kind:'outcome'}],steps:[{id:'one',title:'Open first',tool:'browser_act',action:'navigate',requirementIds:['first'],dependsOn:[],expected:'First URL visible'},{id:'two',title:'Open second',tool:'browser_act',action:'navigate',requirementIds:['second'],dependsOn:['one'],expected:'Second URL visible'}]};
  assert.equal(work.registerPlan(task.id,plan).status,'ok');
  return {work,task,plan,effects,events,advance:ms=>clock+=ms,act:id=>work.execute(task.id,'browser_act',{stepId:id,action:'navigate',args:{url:`https://example.com/${id}`}})};
}
test('dependencies and final audit reject a partially finished goal',async()=>{
  const f=fixture();assert.equal((await f.act('two')).status,'dependency_pending');assert.equal(f.effects.length,0);
  await f.act('one');assert.equal(f.work.reviewCompletion(f.task.id,{revision:f.task.revision,answer:'Both requested pages have been opened and verified.'}).completed,false);
  await f.act('two');assert.equal(f.work.reviewCompletion(f.task.id,{revision:f.task.revision,answer:'Both requested pages have been opened and independently verified.'}).completed,true);
});
test('verified effects cannot be dispatched twice',async()=>{const f=fixture();await f.act('one');assert.equal((await f.act('one')).status,'already_verified');assert.equal(f.effects.length,1);});
test('a revised plan cannot erase an omitted verified effect',async()=>{
 const f=fixture();await f.act('one');const revised=structuredClone(f.plan);revised.steps.shift();
 assert.equal(f.work.registerPlan(f.task.id,revised).status,'ok');
 assert.equal(f.work.taskContext(f.task.id).steps.find(s=>s.id==='one').state,'verified');
 assert.equal((await f.act('one')).status,'already_verified');assert.equal(f.effects.length,1);
});
test('a unique new read uses the added outcome without guessing among old pending reads',()=>{
 const f=fixture(),t=f.work.update({text:'Research solar target and capacity',replace:true});
 const requirements=[{id:'target',text:'Solar target',kind:'research'},{id:'capacity',text:'Installed capacity',kind:'research'}];
 const steps=requirements.map(r=>({id:r.id,title:r.text,tool:'web_search',requirementIds:[r.id],dependsOn:[],expected:r.text}));
 f.work.registerPlan(t.id,{revision:t.revision,requirements,steps});
 const added=f.work.update({taskId:t.id,text:'Add independent international capacity evidence',intent:'add'});
 const r={id:`addition-${added.revision}`,text:added.latestRequest,kind:'research'};
 assert.equal(f.work.registerPlan(t.id,{revision:added.revision,requirements:[r],steps:[{id:'international',title:r.text,tool:'web_search',requirementIds:[r.id],dependsOn:[],expected:'Independent capacity evidence'}]}).status,'ok');
 const token=f.work.beginEvidence(t.id,'web_search',{query:'Bangladesh capacity IRENA'});assert.equal(token.status,'ok');assert.equal(token.stepId,'international');
 assert.equal(f.work.taskContext(t.id).steps.find(s=>s.id==='target').state,'pending');
});
test('secondary solar news cannot fulfill an explicit primary-source request even with literal proof',()=>{
 const f=fixture(),t=f.work.update({text:'Research Bangladesh solar target using government or primary sources',replace:true});
 const req={id:'target',text:t.goal,kind:'research'},url='https://www.newagebd.net/post/country/solar-target',quote='The target is 10000 megawatts by 2030.';
 f.work.registerPlan(t.id,{revision:t.revision,requirements:[req],steps:[{id:'read',title:'Read target',tool:'read_web_page',requirementIds:['target'],dependsOn:[],expected:'Primary target evidence'}]});
 const token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url});const e=f.work.recordEvidence(t.id,token,'read_web_page',{url},{status:'ok',url,content:quote});
 // The public ungrounded path must also reject literal source copying.
 const result=f.work.reviewCompletion(t.id,{revision:t.revision,answer:quote+' Source: '+url,claims:[{requirementId:'target',evidenceId:e.evidenceId,answerQuote:quote,sourceQuote:quote}]});
 assert.equal(result.completed,false);assert.ok(result.review.issues.some(s=>s.includes('primary-source')));
});
test('plans reject cycles, missing requirements and stale revisions',()=>{
  const f=fixture();const cycle=structuredClone(f.plan);cycle.steps[0].dependsOn=['two'];assert.equal(f.work.registerPlan(f.task.id,cycle).status,'invalid_request');
  const missing=structuredClone(f.plan);missing.requirements.pop();missing.steps.pop();assert.equal(f.work.registerPlan(f.task.id,missing).status,'invalid_request');
  assert.equal(f.work.registerPlan(f.task.id,{...f.plan,revision:0}).status,'stale_revision');
});
test('ambiguous steering preserves the job and cannot be resolved by a model plan or spoken yes',async()=>{
  const f=fixture();const task=f.work.update({taskId:f.task.id,text:'Use the other one',intent:'clarify'});assert.equal(task.id,f.task.id);
  assert.equal((await f.act('one')).status,'needs_clarification');assert.equal(f.work.registerPlan(task.id,{...f.plan,revision:task.revision}).status,'needs_clarification');
  assert.equal(f.work.update({taskId:task.id,text:'yes'}).needsClarification,true);
  const clarified=f.work.update({taskId:task.id,text:'Actually use the second source',intent:'refine'});assert.equal(clarified.needsClarification,false);
});
test('additive requests preserve verified work and invalidate old calls',async()=>{
  const f=fixture();await f.act('one');const old=f.task.revision;
  const task=f.work.update({taskId:f.task.id,text:'Also include a third page',intent:'add'});
  assert.equal(task.id,f.task.id);assert.equal(task.steps[0].state,'verified');assert.equal(task.planRequired,true);
  assert.equal((await f.work.execute(task.id,'browser_act',{revision:old,stepId:'two',action:'navigate'})).status,'stale_revision');
  assert.equal(f.work.registerPlan(task.id,{...f.plan,revision:task.revision}).status,'invalid_request');
});
test('refinement invalidates affected steps and descendants, preserving independent outcomes',async()=>{
  const f=fixture();const p=structuredClone(f.plan);p.requirements.push({id:'other',text:'Independent page',kind:'outcome'});p.steps.push({id:'other',title:'Other',tool:'browser_act',action:'navigate',requirementIds:['other'],dependsOn:[],expected:'Other page'});f.work.registerPlan(f.task.id,p);
  await f.act('one');await f.act('two');await f.act('other');
  const t=f.work.update({taskId:f.task.id,text:'Actually change the first page',intent:'refine'});p.revision=t.revision;p.requirements[0].text='Different first page';p.steps[0].expected='Different first URL';
  assert.equal(f.work.registerPlan(t.id,p).status,'ok');const state=f.work.task(t.id);assert.equal(state.steps[0].state,'pending');assert.equal(state.steps[1].state,'pending');assert.equal(state.steps[2].state,'verified');
});
test('two recovery attempts are bounded and independent work can continue',async()=>{
  const f=fixture({act:async()=>({status:'stale_target',message:'Choose the intended control'})});
  for(let i=0;i<3;i++)await f.act('one');assert.equal((await f.act('one')).status,'blocked');assert.equal(f.work.task(f.task.id).steps[0].attempts,3);
});
test('uncertain effects stay blocked after observation and are never replayed',async()=>{
  let dispatched=0;const f=fixture({act:async()=>{dispatched++;return {status:'timeout',completionUnknown:true};}});
  await f.act('one');assert.equal((await f.act('one')).status,'completion_unknown');assert.equal(dispatched,1);
  assert.equal(f.work.task(f.task.id).steps[0].uncertain,true);
});
test('implicit uncertain effects also cannot be replayed',async()=>{
  const f=fixture({act:async()=>({status:'timeout',completionUnknown:true})});const task=f.work.update({text:'Open a page',replace:true});
  const args={action:'navigate',args:{url:'https://example.com'}};
  await f.work.execute(task.id,'browser_act',args);assert.equal((await f.work.execute(task.id,'browser_act',args)).status,'completion_unknown');
});
test('an uncertain navigation can be reconciled by its exact independently observed URL',async()=>{
  let dispatched=0;const f=fixture({act:async()=>{dispatched++;return {status:'timeout',completionUnknown:true};},observe:async()=>({status:'ok',observation:{url:'https://example.com/one',documentId:'fresh-doc',ready:true}})});
  const result=await f.act('one');assert.equal(result.completionUnknown,false);assert.equal(result.verification.verified,true);assert.equal(f.work.task(f.task.id).steps[0].state,'verified');await f.act('two');assert.equal(dispatched,2);
});
test('research completion requires actual source quotation, answer coverage and citation',()=>{
  const f=fixture();const task=f.work.update({text:'Research delivery policy',replace:true});
  const p={revision:task.revision,requirements:[{id:'delivery',text:'Delivery policy',kind:'research'}],steps:[{id:'read',title:'Read policy',tool:'read_web_page',requirementIds:['delivery'],dependsOn:[],expected:'Original policy text'}]};assert.equal(f.work.registerPlan(task.id,p).status,'ok');
  const token=f.work.beginEvidence(task.id,'read_web_page',{stepId:'read',url:'https://example.com/policy'});
  const e=f.work.recordEvidence(task.id,token,'read_web_page',{url:'https://example.com/policy'},{status:'ok',content:'Delivery is available in Dhaka. Other areas are unconfirmed.'});
  const answer='Delivery is available in Dhaka. Source: https://example.com/policy';
  const review={revision:task.revision,answer,coverage:[{requirementId:'delivery',answerQuote:'Delivery is available in Dhaka.',evidenceIds:[e.evidenceId]}],claims:[{requirementId:'delivery',answerQuote:'Delivery is available in Dhaka.',sourceQuote:'Delivery is available everywhere.',evidenceId:e.evidenceId}]};
  assert.equal(f.work.reviewCompletion(task.id,review).completed,false);review.claims[0].sourceQuote='Delivery is available in Dhaka.';assert.equal(f.work.reviewCompletion(task.id,review).completed,true);
  review.answer='Delivery is available in Dhaka. This finding comes from a retrieved policy.';const cited=f.work.reviewCompletion(task.id,review);assert.equal(cited.completed,true);assert.ok(cited.answer.includes('https://example.com/policy'));
});
test('unknown requirements and domain coverage gaps cannot become completed',async()=>{const f=fixture();await f.act('one');await f.act('two');assert.equal(f.work.reviewCompletion(f.task.id,{revision:f.task.revision,answer:'Both page operations finished but the requested content is missing.',domainIssues:['Missing requested comparison']}).completed,false);});
test('all evidence survives context restoration and snapshots cannot mutate controller state',async()=>{
  const f=fixture();const t=f.work.update({text:'Observe pages',replace:true});for(let i=0;i<9;i++)await f.work.execute(t.id,'browser_observe',{scope:'page'});
  assert.equal(f.work.taskContext(t.id).evidence.length,9);const snapshot=f.work.task(t.id);snapshot.requirements[0].status='pending';assert.equal(f.work.task(t.id).requirements[0].status,'verified');
});
test('global action and time budgets pause with explicit resume, acknowledgements do not reset',async()=>{
  const f=fixture();const t=f.work.update({text:'Observe pages',replace:true});for(let i=0;i<60;i++)await f.work.execute(t.id,'browser_observe',{scope:'page'});
  assert.equal(f.work.task(t.id).budget.checkpoints,2);assert.equal((await f.work.execute(t.id,'browser_observe',{scope:'page'})).status,'limit_reached');
  assert.equal(f.work.update({taskId:t.id,text:'yes'}).status,'paused');assert.equal(f.work.update({taskId:t.id,text:'resume'}).status,'working');
  await f.work.execute(t.id,'browser_observe',{scope:'page'});f.advance(600001);assert.equal((await f.work.execute(t.id,'browser_observe',{scope:'page'})).status,'limit_reached');
});
test('at most three independent observations execute concurrently',async()=>{
  let active=0,max=0;const f=fixture({observe:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,8));active--;return {status:'ok',observation:{}};}});
  const t=f.work.update({text:'Observe pages',replace:true});await Promise.all(Array.from({length:8},()=>f.work.execute(t.id,'browser_observe',{scope:'page'})));assert.equal(max,3);
});
test('research and native observations share one global three-read limit',async()=>{
  const f=fixture();const t=f.work.update({text:'Observe pages',replace:true});
  const tokens=Array.from({length:3},()=>f.work.beginEvidence(t.id,'read_web_page',{url:'https://example.com'}));
  assert.equal(f.work.beginEvidence(t.id,'read_web_page',{url:'https://example.com'}).status,'busy');
  let finished=false;const pending=f.work.execute(t.id,'browser_observe',{scope:'page'}).then(()=>finished=true);await new Promise(r=>setImmediate(r));assert.equal(finished,false);
  f.work.recordEvidence(t.id,tokens[0],'read_web_page',{url:'https://example.com'},{status:'ok',content:'A real recorded source result'});await pending;
  for(const token of tokens.slice(1))f.work.recordEvidence(t.id,token,'read_web_page',{}, {status:'ok',content:'Source'});
});
test('reply delivery failure does not undo verified execution or reapply effects',async()=>{const f=fixture();await f.act('one');await f.act('two');f.work.reviewCompletion(f.task.id,{revision:f.task.revision,answer:'Both requested pages were opened and independently verified.'});f.work.delivery(f.task.id,'interrupted');assert.equal(f.work.task(f.task.id).status,'completed');assert.equal(f.work.task(f.task.id).delivery,'interrupted');assert.equal(f.effects.length,2);});
test('default worker continues beyond a checkpoint and remains globally bounded',async()=>{
  const f=fixture();const t=f.work.update({text:'Observe pages',replace:true});f.work.configure({workerEnabled:true});
  const worker=createFastWorker(f.work,{client:{models:{generateContent:async()=>({text:JSON.stringify({tool:'browser_observe',input:{scope:'page'}})})}}});
  const result=await worker.run(t.id);assert.equal(result.steps,60);assert.notEqual(result.status,'completed');assert.equal(f.work.task(t.id).budget.actions,60);
});
test('invalid planned calls stop after two repair attempts without any effect',async()=>{
  const f=fixture();for(let i=0;i<2;i++)assert.equal((await f.work.execute(f.task.id,'browser_act',{stepId:'missing',action:'navigate'})).status,'invalid_request');
  const result=await f.work.execute(f.task.id,'browser_act',{stepId:'missing',action:'navigate'});assert.equal(result.protocolBlocked,true);assert.equal(f.work.task(f.task.id).status,'paused');assert.equal(f.effects.length,0);
});
test('citation presentation is checked against retrieved URLs before coverage audit',()=>{
  const f=fixture();const t=f.work.update({text:'Research a policy and cite the source URL',replace:true});
  f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'cite',text:'Cite the source URL',kind:'outcome'}],steps:[{id:'read',title:'Read source',tool:'read_web_page',requirementIds:['cite'],dependsOn:[],expected:'Readable source'}]});
  const token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url:'https://example.com/policy'});
  f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/policy'},{status:'ok',content:'The policy applies to Dhaka.'});
  const review={revision:t.revision,answer:'The requested source was retrieved and is cited here: https://example.com/policy',coverage:[{requirementId:'cite',answerQuote:'Different model wording',evidenceIds:[]}]};
  assert.equal(f.work.reviewCompletion(t.id,review).completed,true);
});
test('extending the final-answer step preserves verified execution prerequisites',async()=>{
  const f=fixture();await f.act('one');await f.act('two');const p=structuredClone(f.plan);p.steps.push({id:'answer',title:'Answer',tool:'answer',requirementIds:['first','second'],dependsOn:['two'],expected:'Summary'});f.work.registerPlan(f.task.id,p);
  p.requirements.push({id:'extra',text:'Additional observation',kind:'outcome'});p.steps.push({id:'observe',title:'Inspect',tool:'browser_observe',requirementIds:['extra'],dependsOn:['one'],expected:'Observation'});p.steps.find(s=>s.id==='answer').expected='Summary including the observation';
  assert.equal(f.work.registerPlan(f.task.id,p).status,'ok');assert.equal(f.work.task(f.task.id).steps.find(s=>s.id==='one').state,'verified');assert.equal(f.work.task(f.task.id).steps.find(s=>s.id==='two').state,'verified');assert.equal(f.effects.length,2);
});
test('native observations use outcome evidence even when a model labels them research',async()=>{
  const f=fixture();const t=f.work.update({text:'Inspect open windows',replace:true});
  f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'windows',text:'Observed titles',kind:'research'}],steps:[{id:'observe',title:'Inspect windows',tool:'desktop_observe',action:'Read the windows',requirementIds:['windows'],dependsOn:[],expected:'Window titles'}]});f.work.configure({desktopEnabled:true});
  const observed=await f.work.execute(t.id,'desktop_observe',{stepId:'observe',scope:'windows'});
  const context=f.work.taskContext(t.id);const id=context.steps[0].evidenceIds[0];
  assert.equal(context.requirements.find(r=>r.id==='windows').kind,'outcome');
  assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'The requested window observation was returned by the native monitor.',coverage:[{requirementId:'windows',answerQuote:'The requested window observation was returned by the native monitor.',evidenceIds:[id]}]}).completed,true);
});
test('incremental reviews preserve only coverage verified against the identical answer',()=>{
  const f=fixture();const t=f.work.update({text:'Research two source facts',replace:true});
  f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'a',text:'First fact',kind:'research'},{id:'b',text:'Second fact',kind:'research'}],steps:[{id:'read',title:'Source',tool:'read_web_page',requirementIds:['a','b'],dependsOn:[],expected:'Two facts'}]});
  const token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url:'https://example.com/facts'});const e=f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/facts'},{status:'ok',content:'First fact. Second fact.'});
  const answer='First fact. Second fact. Verified source: https://example.com/facts';
  const review=id=>({revision:t.revision,answer,coverage:[{requirementId:id,answerQuote:id==='a'?'First fact.':'Second fact.',evidenceIds:[e.evidenceId]}],claims:[{requirementId:id,answerQuote:id==='a'?'First fact.':'Second fact.',sourceQuote:id==='a'?'First fact.':'Second fact.',evidenceId:e.evidenceId}]});
  assert.equal(f.work.reviewCompletion(t.id,review('a')).completed,false);assert.equal(f.work.reviewCompletion(t.id,review('b')).completed,true);
  assert.equal(f.work.reviewCompletion(t.id,{...review('b'),answer:'First fact. Second fact. Additional unchecked assertion. https://example.com/facts'}).completed,false);
});
test('research claims provide coverage only after source and answer quote verification',()=>{
 const f=fixture();const t=f.work.update({text:'Research the delivery fact',replace:true});
 f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'fact',text:'Delivery fact',kind:'research'}],steps:[{id:'read',title:'Read policy',tool:'read_web_page',requirementIds:['fact'],dependsOn:[],expected:'Policy excerpt'}]});
 const token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url:'https://example.com/policy'});const e=f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/policy'},{status:'ok',content:'Delivery is available in Dhaka.'});
 const r={revision:t.revision,answer:'Delivery is available in Dhaka. Source: https://example.com/policy',coverage:[],claims:[{requirementId:'fact',answerQuote:'Delivery is available in Dhaka.',sourceQuote:'Delivery is available in Dhaka.',evidenceId:e.evidenceId}]};
 assert.equal(f.work.reviewCompletion(t.id,r).completed,true);r.claims[0].sourceQuote='Delivery everywhere';assert.equal(f.work.reviewCompletion(t.id,r).completed,false);
});
test('compound reads wait for an executable plan and an answer-only outline is not sufficient',async()=>{
 let reads=0;const f=fixture({observe:async()=>{reads++;return {status:'ok',observation:{}};}});f.work.configure({desktopEnabled:true});const t=f.work.update({text:'Inspect windows then inspect applications',replace:true});
 assert.equal((await f.work.execute(t.id,'desktop_observe',{scope:'windows'})).status,'plan_required');assert.equal(reads,0);
 const p={revision:t.revision,requirements:[{id:'windows',text:'Window inventory',kind:'outcome'}],steps:[{id:'answer',title:'Summarize',tool:'answer',requirementIds:['windows'],dependsOn:[],expected:'Summary'}]};
 assert.equal(f.work.registerPlan(t.id,p).status,'plan_required');assert.equal((await f.work.execute(t.id,'desktop_observe',{scope:'windows'})).status,'plan_required');assert.equal(reads,0);
 p.steps.unshift({id:'read',title:'Inspect',tool:'desktop_observe',requirementIds:['windows'],dependsOn:[],expected:'Observed windows'});assert.equal(f.work.registerPlan(t.id,p).status,'ok');assert.equal((await f.work.execute(t.id,'desktop_observe',{stepId:'read',scope:'windows'})).status,'ok');assert.equal(reads,1);
});
test('a straightforward native observation stays on the fast path with delivery separate',async()=>{
 const f=fixture();f.work.configure({desktopEnabled:true});const t=f.work.update({text:'Observe windows',replace:true});
 const result=await f.work.execute(t.id,'desktop_observe',{scope:'windows'});assert.equal(result.status,'ok');assert.equal(f.work.taskContext(t.id).planRequired,false);
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'The requested current windows were independently observed.'}).completed,true);assert.equal(f.work.taskContext(t.id).delivery,'pending');
});
test('answer-only conclusions inherit evidence through declared verified prerequisites',async()=>{
 const f=fixture();const t=f.work.update({text:'Inspect windows then write a final report',replace:true});f.work.configure({desktopEnabled:true});
 f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'windows',text:'Inventory windows',kind:'outcome'},{id:'report',text:'Compile a final report',kind:'research'}],steps:[{id:'observe',title:'Inspect',tool:'desktop_observe',requirementIds:['windows'],dependsOn:[],expected:'Window inventory'},{id:'answer',title:'Report',tool:'answer',requirementIds:['report'],dependsOn:['observe'],expected:'Written inventory report'}]});
 await f.work.execute(t.id,'desktop_observe',{stepId:'observe',scope:'windows'});const c=f.work.taskContext(t.id),e=c.steps.find(s=>s.id==='observe').evidenceIds[0];
 assert.equal(c.requirements.find(r=>r.id==='report').kind,'outcome');
 const answer='The window inventory was observed and included in this final report.';
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer,coverage:['windows','report'].map(requirementId=>({requirementId,answerQuote:answer,evidenceIds:[e]}))}).completed,true);
 const unrelated=f.work.update({taskId:t.id,text:'Actually replace the report details',intent:'refine'});const p={revision:unrelated.revision,requirements:[{id:'windows',text:'Inventory windows',kind:'outcome'},{id:'report',text:'New unrelated report',kind:'outcome'}],steps:[{id:'observe',title:'Inspect',tool:'desktop_observe',requirementIds:['windows'],dependsOn:[],expected:'Window inventory'},{id:'answer',title:'Report',tool:'answer',requirementIds:['report'],dependsOn:[],expected:'Independent report'}]};f.work.registerPlan(t.id,p);
 assert.equal(f.work.reviewCompletion(t.id,{revision:unrelated.revision,answer,coverage:[{requirementId:'report',answerQuote:answer,evidenceIds:[e]}]}).completed,false,'Unrelated evidence cannot support a conclusion with no declared dependency');
});
test('invalidated source evidence cannot be resurrected after a revised step is verified',()=>{
 const f=fixture();const t=f.work.update({text:'Research the delivery policy',replace:true});const plan={revision:t.revision,requirements:[{id:'delivery',text:'Delivery policy',kind:'research'}],steps:[{id:'read',title:'Read',tool:'read_web_page',requirementIds:['delivery'],dependsOn:[],expected:'Original policy'}]};f.work.registerPlan(t.id,plan);
 const read=content=>{const token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url:'https://example.com/policy'});return f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/policy'},{status:'ok',content}).evidenceId;};
 const old=read('Delivery is available in Dhaka.');const revision=f.work.update({taskId:t.id,text:'Actually check the amended delivery policy',intent:'refine'}).revision;plan.revision=revision;plan.steps[0].expected='Amended policy';f.work.registerPlan(t.id,plan);const fresh=read('Delivery is unavailable in Dhaka.');
 const review=(id,text)=>({revision,answer:text+' Source: https://example.com/policy',claims:[{requirementId:'delivery',answerQuote:text,sourceQuote:text,evidenceId:id}],coverage:[]});
 assert.equal(f.work.reviewCompletion(t.id,review(old,'Delivery is available in Dhaka.')).completed,false);assert.equal(f.work.taskContext(t.id).evidence.find(e=>e.id===old).verified,false);assert.equal(f.work.reviewCompletion(t.id,review(fresh,'Delivery is unavailable in Dhaka.')).completed,true);
});

test('research tool fallback creates a bounded supplemental read without completing the original step',()=>{
 const f=fixture();const t=f.work.update({text:'Research a competitor then read its delivery policy',replace:true});
 f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'policy',text:'Read competitor policy',kind:'research'}],steps:[{id:'page',title:'Read policy',tool:'read_web_page',requirementIds:['policy'],dependsOn:[],expected:'Direct competitor policy'}]});
 for(let i=0;i<3;i++){
  const token=f.work.beginEvidence(t.id,'web_search',{stepId:'page',query:'competitor policy'});assert.equal(token.status,'ok');assert.notEqual(token.stepId,'page');
  f.work.recordEvidence(t.id,token,'web_search',{query:'competitor policy'},{status:'ok',querySources:[]});
 }
 assert.equal(f.work.beginEvidence(t.id,'web_search',{stepId:'page',query:'competitor policy'}).status,'blocked');
 const c=f.work.taskContext(t.id);assert.equal(c.steps.find(s=>s.id==='page').state,'pending');assert.equal(c.steps.filter(s=>s.recoveryFor==='page').length,1);assert.equal(c.requirements.find(r=>r.id==='policy').status,'pending');
});
test('supplemental research reads cannot bypass prerequisites or repair a mutation mismatch',()=>{
 const f=fixture();const t=f.work.update({text:'Research first then read a policy',replace:true});
 f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'policy',text:'Policy',kind:'research'}],steps:[{id:'lookup',title:'Find',tool:'web_search',requirementIds:['policy'],dependsOn:[],expected:'Find source'},{id:'page',title:'Read',tool:'read_web_page',requirementIds:['policy'],dependsOn:['lookup'],expected:'Read source'}]});
 assert.equal(f.work.beginEvidence(t.id,'web_search',{stepId:'page'}).status,'dependency_pending');assert.equal(f.work.taskContext(t.id).steps.length,2);
 assert.equal(f.work.beginEvidence(t.id,'write_file',{stepId:'page'}).status,'invalid_request');assert.equal(f.work.taskContext(t.id).steps.length,2);
});
test('review_task in a proposed plan is synthesis, never an executable completion decision',()=>{
 const f=fixture();const p=structuredClone(f.plan);p.steps.push({id:'review',title:'Final answer',tool:'review_task',action:'review_task',requirementIds:['first','second'],dependsOn:['two'],expected:'Reviewed answer'});
 assert.equal(f.work.registerPlan(f.task.id,p).status,'ok');assert.equal(f.work.taskContext(f.task.id).steps.find(s=>s.id==='review').tool,'answer');assert.equal(f.work.taskContext(f.task.id).steps.find(s=>s.id==='review').state,'pending');
});
test('requested completion distinctions survive a model plan and reject the observed incomplete answer',()=>{
 const f=fixture();const t=f.work.update({text:'Read official docs. Explain generation completion versus turn completion and one interruption behavior.',replace:true});
 const req=f.work.taskContext(t.id).requirements.filter(r=>r.id!=='request');assert.deepEqual(req.map(r=>r.id),['generation-completion','turn-completion']);
 const plan={revision:t.revision,requirements:req,steps:[{id:'read',title:'Read docs',tool:'read_web_page',requirementIds:req.map(r=>r.id),dependsOn:[],expected:'Documented completion behavior'}]};
 assert.equal(f.work.registerPlan(t.id,{...plan,requirements:[req[1]]}).status,'invalid_request');assert.equal(f.work.registerPlan(t.id,plan).status,'ok');
 const content='generationComplete means the model has finished generating. turnComplete means the model turn has finished.';
 const token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url:'https://example.com/docs'});const e=f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/docs'},{status:'ok',content});
 const bad='turnComplete does not indicate an idle session. Setting turn_complete=true interrupts generation. Source: https://example.com/docs';
 const review=answer=>({revision:t.revision,answer,claims:req.map(r=>({requirementId:r.id,answerQuote:answer,sourceQuote:content,evidenceId:e.evidenceId}))});
 assert.equal(f.work.reviewCompletion(t.id,review(bad)).completed,false);
 assert.equal(f.work.reviewCompletion(t.id,review(content+' Source: https://example.com/docs')).completed,true);
});
test('verified foreign URL rejection completes only a requested negative scope check, never page content',()=>{
 const f=fixture();const goal='Determine whether this page can verify a Bangladesh policy: https://www.uber.com/gh/en/ride/safety/audio-recording/. Explain the actual country-scope result and missing Bangladesh evidence. Do not search.';
 const t=f.work.update({text:goal,replace:true}),requirements=f.work.taskContext(t.id).requirements.filter(r=>r.id!=='request');
 assert.deepEqual(requirements.map(r=>r.id),['scope-verdict','scope-limits']);
 f.work.registerPlan(t.id,{revision:t.revision,requirements,steps:[{id:'read',title:'Check supplied page',tool:'read_web_page',requirementIds:requirements.map(r=>r.id),dependsOn:[],expected:'Scope verdict'}]});
 const url='https://www.uber.com/gh/en/ride/safety/audio-recording/',token=f.work.beginEvidence(t.id,'read_web_page',{stepId:'read',url});
 f.work.recordEvidence(t.id,token,'read_web_page',{url},{status:'out_of_scope',url,message:'different country; not evidence for Bangladesh policy'});
 const c=f.work.taskContext(t.id);assert.equal(c.evidence[0].scopeOnly,true);assert.equal(c.evidence[0].verified,true);assert.match(c.evidence[0].excerpt,/not read/);
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'The page verifies Bangladesh policy and its content was read. '+url}).completed,false);
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'The URL scope is Ghana. The page was rejected before retrieval and was not read. It cannot verify Bangladesh policy; official Bangladesh evidence remains missing. Checked URL: '+url}).completed,true);
 const positive=f.work.update({text:'Research the current Uber audio recording safety policy in Bangladesh',replace:true});
 f.work.registerPlan(positive.id,{revision:positive.revision,requirements:[{id:'policy',text:'Current Bangladesh policy',kind:'research'}],steps:[{id:'read',title:'Read policy',tool:'read_web_page',requirementIds:['policy'],dependsOn:[],expected:'Policy text'}]});
 const pt=f.work.beginEvidence(positive.id,'read_web_page',{stepId:'read',url});f.work.recordEvidence(positive.id,pt,'read_web_page',{url},{status:'out_of_scope',url,message:'different country; not evidence for Bangladesh policy'});
 assert.equal(f.work.taskContext(positive.id).evidence[0].verified,false);assert.equal(f.work.taskContext(positive.id).steps[0].state,'blocked');
});

test('a page-only scope task starts with an executable check that answer-only plans cannot remove',()=>{
 const f=fixture();const t=f.work.update({text:'Determine whether this page can verify Bangladesh policy: https://www.uber.com/gh/en/ride/safety/audio-recording/. Do not search.',replace:true});
 const c=f.work.taskContext(t.id);assert.equal(c.planRequired,false);assert.equal(c.steps[0].tool,'read_web_page');
 const requirements=c.requirements.filter(r=>r.id!=='request');const plan={revision:t.revision,requirements,steps:[{id:'answer',title:'Explain finding',tool:'answer',requirementIds:requirements.map(r=>r.id),dependsOn:[],expected:'Scope verdict'}]};
 assert.equal(f.work.registerPlan(t.id,plan).status,'ok');assert.equal(f.work.taskContext(t.id).steps.some(s=>s.id==='scope-read'),true);
 const token=f.work.beginEvidence(t.id,'read_web_page',{url:'https://www.uber.com/gh/en/ride/safety/audio-recording/'});assert.equal(token.status,'ok');assert.equal(token.stepId,'scope-read');
});

test('controller metadata never reaches the strict browser protocol on normal or recovered requests',async()=>{
 const protocol=require('../electron/browser-protocol.cjs');let calls=0;const transported=[];
 const browser={observe:async input=>{protocol.validate('observe',input);transported.push(input);return {status:'ok',observation:{url:'https://example.com',documentId:'fresh',elements:[{ref:'session:element:1:2:input',role:'textbox',name:'Search',editable:true}]}};},act:async input=>{protocol.validate('act',input);transported.push(input);calls++;return calls===1?{status:'stale_target',completionUnknown:false}:{status:'ok',verification:{verified:true,evidence:'Independently checked value'}};}};
 const work=createFastWork({browser});const t=work.update({text:'Type the requested text',replace:true});
 const result=await work.execute(t.id,'browser_act',{revision:t.revision,action:'type',args:{ref:'session:element:1:1:old',text:'Hello'},controlIdentity:{name:'Search',role:'textbox'}});
 assert.equal(result.status,'ok');assert.equal(calls,2);for(const input of transported){assert.equal('revision' in input,false);assert.equal('stepId' in input,false);assert.equal('controlIdentity' in input,false);}
 const planned=work.update({text:'Open the first page then open the second page',replace:true});
 const requirements=[{id:'pages',text:'Requested pages open',kind:'outcome'}];work.registerPlan(planned.id,{revision:planned.revision,requirements,steps:[{id:'navigate',title:'Open',tool:'browser_act',action:'navigate',requirementIds:['pages'],dependsOn:[],expected:'Expected URL'}]});
 assert.equal((await work.execute(planned.id,'browser_act',{revision:planned.revision,stepId:'navigate',action:'navigate',args:{url:'https://example.com'}})).status,'ok');
 assert.equal(transported.at(-1).args.url,'https://example.com');assert.equal('stepId' in transported.at(-1),false);
 assert.throws(()=>protocol.validate('act',{action:'navigate',args:{url:'https://example.com'},unexpected:true}),/Unknown browser request field/);
});
