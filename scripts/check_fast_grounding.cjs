const test=require('node:test'),assert=require('node:assert/strict');
const {createFastWork}=require('../electron/fast-work.cjs');
const {createGroundingReviewer}=require('../electron/fast-grounding.cjs');
const esbuild=require('esbuild'),Module=require('node:module'),path=require('node:path');
function fixture(reviewer) {
  const work=createFastWork({browser:{},desktop:{},groundingReviewer:reviewer});
  const task=work.update({text:'Research what the application returns after executing a function call.'});
  const plan={revision:task.revision,requirements:[{id:'return-result',text:'Explain what the application returns',kind:'research'}],steps:[{id:'read',title:'Read guide',tool:'read_web_page',requirementIds:['return-result'],dependsOn:[],expected:'Execution response documentation'}]};
  assert.equal(work.registerPlan(task.id,plan).status,'ok');
  const content='The model returns structured arguments to trigger actions. The application returns execution results to the model.';
  const token=work.beginEvidence(task.id,'read_web_page',{stepId:'read',url:'https://example.com/docs'});
  const evidence=work.recordEvidence(task.id,token,'read_web_page',{url:'https://example.com/docs'},{status:'ok',content});
  const answer='The application sends the results of execution back to the model. Source: https://example.com/docs';
  const review={revision:task.revision,answer,coverage:[{requirementId:'return-result',answerQuote:answer.split(' Source:')[0],evidenceIds:[evidence.evidenceId]}],claims:[{requirementId:'return-result',answerQuote:answer.split(' Source:')[0],sourceQuote:'The model returns structured arguments to trigger actions.',evidenceId:evidence.evidenceId}]};
  return {work,task,review};
}
test('observed unrelated quote is rejected even when both quotes exist and a verdict is forged',async()=>{
  const f=fixture(async()=>({outcomes:[{requirementId:'return-result',supported:false,reason:'Model arguments do not prove application results.'}]}));
  assert.equal(f.work.reviewCompletion(f.task.id,{...f.review,grounding:{outcomes:[{requirementId:'return-result',supported:true}]}}).completed,false);
  const result=await f.work.reviewCompletionGrounded(f.task.id,f.review);
  assert.equal(result.completed,false);assert.match(result.review.issues.join(' '),/Model arguments/);
});

test('labelling source-backed factual findings as ordinary outcomes cannot bypass quotation or semantic verification',async()=>{
  let reviews=0;const work=createFastWork({browser:{},groundingReviewer:async()=>{reviews++;return {outcomes:[{requirementId:'identity',supported:false,reason:'Unsupported business claim.'}]};}});
  const task=work.update({text:'Read the business website and explain its identity.'});
  assert.equal(work.registerPlan(task.id,{revision:1,requirements:[{id:'identity',text:'Establish what the business sells.',kind:'outcome'}],steps:[{id:'read',tool:'read_web_page',title:'Read business page',requirementIds:['identity'],dependsOn:[],expected:'Business content'}]}).status,'ok');
  const token=work.beginEvidence(task.id,'read_web_page',{stepId:'read',url:'https://example.com/'});
  const e=work.recordEvidence(task.id,token,'read_web_page',{url:'https://example.com/'},{status:'ok',content:'Example sells plants. It offers gardening tools.'});
  const answer='Example sells plants and gardening tools.';
  const request={revision:1,answer,coverage:[{requirementId:'identity',answerQuote:answer,evidenceIds:[e.evidenceId]}],claims:[{requirementId:'identity',answerQuote:answer,sourceQuote:'Example sells plants... It offers gardening tools.',evidenceId:e.evidenceId}]};
  assert.equal((await work.reviewCompletionGrounded(task.id,request)).completed,false);assert.equal(reviews,0);
  assert.equal(work.reviewCompletion(task.id,{...request,claims:[]}).completed,false);
  request.claims[0].sourceQuote='Example sells plants. It offers gardening tools.';
  assert.equal(work.reviewCompletion(task.id,request).completed,false,'A model label cannot authorize a paraphrase without independent review');
  assert.equal((await work.reviewCompletionGrounded(task.id,request)).completed,false);assert.equal(reviews,1);
});
test('a successful search aggregate cannot verify an ordinary factual final-answer outcome',async()=>{
 const work=createFastWork({browser:{},groundingReviewer:async()=>{throw Error('Invalid provenance must be rejected locally');}});
 const task=work.update({text:'Research the solar capacity and report the figure.'});
 assert.equal(work.registerPlan(task.id,{revision:1,requirements:[{id:'finding',text:'Report installed solar capacity',kind:'outcome'}],steps:[{id:'search',tool:'web_search',title:'Search capacity',requirementIds:['finding'],dependsOn:[],expected:'Find direct source evidence'}]}).status,'ok');
 const token=work.beginEvidence(task.id,'web_search',{stepId:'search',query:'solar capacity'});
 const e=work.recordEvidence(task.id,token,'web_search',{}, {status:'ok',querySources:[{status:'verified',url:'https://example.com/',content:'Solar installed capacity was 123 MW in 2025.'}]});
 const answer='Solar installed capacity was 999 MW in 2026.';
 const request={revision:1,answer,coverage:[{requirementId:'finding',answerQuote:answer,evidenceIds:[e.evidenceId]}]};
 const result=await work.reviewCompletionGrounded(task.id,request);
 assert.equal(result.completed,false);assert.notEqual(work.taskContext(task.id).requirements.find(r=>r.id==='finding').status,'verified');
 assert.match(result.review.issues.join(' '),/claim\/source mapping/);
});
test('faithful paraphrase passes only after independent support and compact citations do not repeat prose',async()=>{
  const f=fixture(async input=>{assert.equal(input.claims[0].sourceQuote,'The application returns execution results to the model.');return {outcomes:[{requirementId:'return-result',supported:true,reason:'Supported execution response.'}]};});
  f.review.claims[0].sourceQuote='The application returns execution results to the model.';
  f.review.answer=f.review.answer.split(' Source:')[0];
  const result=await f.work.reviewCompletionGrounded(f.task.id,f.review);
  assert.equal(result.completed,true);assert.match(result.answer,/\nSources: https:\/\/example.com\/docs$/);assert.doesNotMatch(result.answer,/Source for/);
});
test('an unanswered older requirement cannot prevent review of a supported follow-up',async()=>{
 let reviewed=[];const f=fixture(async input=>{reviewed=input.requirements.map(r=>r.id);return {outcomes:input.requirements.map(r=>({requirementId:r.id,supported:true,reason:'Supported by the observed application result quote.'}))};});
 const c=f.work.taskContext(f.task.id);
 assert.equal(f.work.registerPlan(f.task.id,{revision:c.revision,requirements:[...c.requirements,{id:'older-missing',text:'Explain an earlier unavailable statistic',kind:'research'}],steps:[...c.steps,{id:'older-read',title:'Find earlier statistic',tool:'read_web_page',requirementIds:['older-missing'],dependsOn:[],expected:'Earlier statistic'}]}).status,'ok');
 f.review.claims[0].sourceQuote='The application returns execution results to the model.';
 const result=await f.work.reviewCompletionGrounded(f.task.id,f.review);
 assert.deepEqual(reviewed,['return-result']);assert.equal(result.completed,false);
 const outcomes=f.work.taskContext(f.task.id).requirements;
 assert.equal(outcomes.find(r=>r.id==='return-result').status,'verified');assert.equal(outcomes.find(r=>r.id==='older-missing').status,'pending');
});
test('missing or failing independent reviewer never upgrades a paraphrase to completion',async()=>{
  for(const reviewer of [undefined,async()=>{throw Error('Provider unavailable');}]) {
    const f=fixture(reviewer);const result=await f.work.reviewCompletionGrounded(f.task.id,f.review);
    assert.equal(result.completed,false);assert.match(result.review.issues.join(' '),/unavailable/);
  }
});
test('grounding cannot overrule missing quotation provenance',async()=>{
  const f=fixture(async()=>({outcomes:[{requirementId:'return-result',supported:true,reason:'Accepted'}]}));
  f.review.claims[0].sourceQuote='Invented unsupported content';
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,f.review)).completed,false);
});
test('correction during an evidence review invalidates the pending verdict',async()=>{
  let release,started;const ready=new Promise(r=>started=r);
  const f=fixture(async()=>{started();return new Promise(r=>release=r);});
  const pending=f.work.reviewCompletionGrounded(f.task.id,f.review);await ready;
  f.work.update({taskId:f.task.id,text:'Also explain failures',intent:'add'});
  release({outcomes:[{requirementId:'return-result',supported:true,reason:'Supported'}]});
  assert.equal((await pending).status,'stale_revision');assert.notEqual(f.work.task(f.task.id).status,'completed');
});
test('two failed review repairs stop an unchanged evidence loop',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {outcomes:[{requirementId:'return-result',supported:false,reason:'Wrong actor'}]};});
  for(let n=0;n<3;n++)await f.work.reviewCompletionGrounded(f.task.id,f.review);
  assert.equal(f.work.task(f.task.id).status,'blocked');assert.equal(calls,1,'Same evidence and answer reuse the independent verdict');
});
test('a transient verifier failure is not cached as permanent unsupported evidence',async()=>{
  let calls=0;const f=fixture(async()=>{if(calls++===0)throw Error('Temporary provider outage');return {outcomes:[{requirementId:'return-result',supported:true,reason:'Supported execution results'}]};});
  f.review.claims[0].sourceQuote='The application returns execution results to the model.';
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,f.review)).completed,false);
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,f.review)).reviewUnavailable,true);assert.equal(calls,1);
  f.work.update({taskId:f.task.id,intent:'continue',text:'Continue'});
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,f.review)).completed,true);assert.equal(calls,2);
});
test('controller-owned passage references preserve exact provenance and still require semantic review',async()=>{
  let calls=0;const f=fixture(async input=>{calls++;assert.match(input.claims[0].sourceQuote,/application returns execution results/);return {outcomes:[{requirementId:'return-result',supported:true,reason:'Supported'}]};});
  const evidence=f.work.taskContext(f.task.id).evidence[0];assert.equal(evidence.sourcePassageId,evidence.id+':excerpt');
  const claim={...f.review.claims[0],sourceQuote:undefined,sourcePassageId:evidence.sourcePassageId};
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,{...f.review,claims:[{...claim,sourcePassageId:'invented:excerpt'}]})).completed,false);assert.equal(calls,0);
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,{...f.review,claims:[claim]})).completed,true);assert.equal(calls,1);
});
test('passage references preserve narrow observed quotations, including later page sections',async()=>{
 const work=createFastWork({browser:{},groundingReviewer:async input=>{assert.equal(input.claims[0].sourceQuote,'The application returns execution results.');return {outcomes:[{requirementId:'result',supported:true,reason:'Observed statement'}]};}});
 const task=work.update({text:'Research application results'});
 work.registerPlan(task.id,{revision:1,requirements:[{id:'result',text:'Explain application results',kind:'research'}],steps:[{id:'read',title:'Read source',tool:'read_web_page',requirementIds:['result'],dependsOn:[],expected:'Actual result statement'}]});
 const token=work.beginEvidence(task.id,'read_web_page',{stepId:'read',url:'https://example.com/docs'});
 const e=work.recordEvidence(task.id,token,'read_web_page',{}, {status:'ok',url:'https://example.com/docs',content:'Navigation '.repeat(400)+'The application returns execution results.'});
 const request={revision:1,answer:'The application returns execution results.',claims:[{requirementId:'result',answerQuote:'The application returns execution results.',sourceQuote:'The application returns execution results.',evidenceId:e.evidenceId,sourcePassageId:e.evidenceId+':excerpt'}]};
 assert.equal((await work.reviewCompletionGrounded(task.id,request)).completed,true);
 assert.equal((await work.reviewCompletionGrounded(task.id,{...request,claims:[{...request.claims[0],sourceQuote:'It claims the work succeeded.'}]})).completed,false);
});
test('controller limits provider outage retries across varied reviews and permits later user continuation',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;throw Error('Temporary outage');});
  f.review.claims[0].sourceQuote='The application returns execution results to the model.';
  for(let i=0;i<3;i++)assert.equal((await f.work.reviewCompletionGrounded(f.task.id,f.review)).completed,false);
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,{...f.review,answer:f.review.answer+'  '})).reviewUnavailable,true);assert.equal(calls,1);
  f.work.update({taskId:f.task.id,intent:'continue',text:'Continue'});
  await f.work.reviewCompletionGrounded(f.task.id,f.review);assert.equal(calls,2);
});
test('changing quotation formatting cannot repeat an unsupported draft beyond two semantic repairs',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {outcomes:[{requirementId:'return-result',supported:false,reason:'Unsupported'}]};});
  for(const sourceQuote of ['The model returns structured arguments to trigger actions.','The application returns execution results to the model.','The model returns structured arguments to trigger actions. The application returns execution results to the model.'])await f.work.reviewCompletionGrounded(f.task.id,{...f.review,claims:[{...f.review.claims[0],sourceQuote}]});
  assert.equal((await f.work.reviewCompletionGrounded(f.task.id,f.review)).repairExhausted,true);assert.equal(calls,3);
});
test('a provider 503 gets at most one bounded read-only retry',async()=>{
  let calls=0;const reviewer=createGroundingReviewer({client:{models:{generateContent:async()=>{if(calls++===0)throw Object.assign(Error('Temporary outage'),{status:503});return {text:JSON.stringify({outcomes:[{requirementId:'x',supported:false,reason:'Unrelated quote'}]})};}}}});
  assert.equal((await reviewer({requirements:[{id:'x'}]})).outcomes[0].supported,false);assert.equal(calls,2);
});
test('repeated provider errors stop after two recovery attempts with no tools supplied',async()=>{
  let calls=0;const reviewer=createGroundingReviewer({client:{models:{generateContent:async input=>{calls++;assert.equal(input.config.tools,undefined);throw Object.assign(Error('Temporary outage'),{status:503});}}}});
  await assert.rejects(reviewer({requirements:[{id:'x'}]}),/Temporary outage/);assert.equal(calls,3);
});
test('additive partial plans merge old verified work and provide an evidence-dependent added answer',()=>{
  const f=fixture();const before=f.work.taskContext(f.task.id).steps.find(s=>s.id==='read');assert.equal(before.state,'verified');
  const task=f.work.update({taskId:f.task.id,intent:'add',text:'Also include the published contact channels.'});
  const result=f.work.registerPlan(task.id,{revision:task.revision,requirements:[{id:'contact',kind:'research',text:'Published contact channels'}],steps:[{id:'contact-read',title:'Read contact',tool:'read_web_page',requirementIds:['contact'],dependsOn:[],expected:'Readable contact information'}]});
  assert.equal(result.status,'ok');const context=f.work.taskContext(task.id);assert.equal(context.steps.find(s=>s.id==='read').state,'verified');assert.deepEqual(context.steps.find(s=>s.id==='read').evidenceIds,before.evidenceIds);
  assert.deepEqual(context.steps.find(s=>s.id==='answer-addition-2').dependsOn,['contact-read']);assert.ok(context.requirements.some(r=>r.id==='return-result'));
});
test('native inventory completion keeps its fast path without calling the research reviewer',async()=>{
  let calls=0;const work=createFastWork({browser:{},desktop:{observe:async()=>({status:'ok',observation:{windows:[{title:'ChatGPT'}]}})},groundingReviewer:async()=>{calls++;throw Error('Not needed');}});
  work.configure({desktopEnabled:true});const task=work.update({text:'Observe windows'});
  await work.execute(task.id,'desktop_observe',{scope:'windows'});
  assert.equal((await work.reviewCompletionGrounded(task.id,{revision:task.revision,answer:'ChatGPT is an observed window.'})).completed,true);assert.equal(calls,0);
});
test('structured reviewer rejects missing, duplicate and string-valued judgments',async()=>{
  for(const value of [{outcomes:[]},{outcomes:[{requirementId:'x',supported:'true',reason:'yes'}]},{outcomes:[{requirementId:'x',supported:true,reason:'yes'},{requirementId:'x',supported:true,reason:'yes'}]}]) {
    const reviewer=createGroundingReviewer({client:{models:{generateContent:async()=>({text:JSON.stringify(value)})}}});
    await assert.rejects(reviewer({requirements:[{id:'x'}]}),/Invalid evidence review/);
  }
});

test('provider cooldown preserves the actual denial code without inventing quota errors or retrying',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');let calls=0;const isolated={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/fast-grounding.cjs'),'utf8'),{module:isolated,require:name=>{
    if(name==='@google/genai')return {GoogleGenAI:class{constructor(){this.models={generateContent:async()=>{calls++;throw Object.assign(new Error('Permission denied'),{status:403});}};}}};
    if(name==='./live-auth.cjs')return {getCandidateApiKeys:()=>['synthetic-cooldown-test-key']};
    return require(name);
  }});
  const review=isolated.exports.createGroundingReviewer();
  for(let index=0;index<2;index++)await assert.rejects(review({requirements:[{id:'x'}]}),error=>{assert.deepEqual(Array.from(error.reviewCodes),[403]);return true;});
  assert.equal(calls,1);
});
function loadResearch() {
  const output=esbuild.buildSync({entryPoints:[path.join(__dirname,'../src/fastResearch.ts')],bundle:true,platform:'node',format:'cjs',write:false});
  const filename=path.join(__dirname,'.grounding-research.cjs');const module=new Module(filename);module.filename=filename;module._compile(output.outputFiles[0].text,filename);return module.exports;
}
test('contact recovery uses published same-origin links with at most two reads',async()=>{
  const {recoverContactPage}=loadResearch();const reads=[];
  const bridge={readSearchPage:async({url})=>{reads.push(url);return url==='https://example.com/'?{status:'ok',links:[{url:'https://evil.example/contact',title:'Contact'},{url:'https://example.com/contact/',title:'Contact'}]}:{status:'ok',source:'direct_page',url,content:'Email: hello@example.com'};}};
  const result=await recoverContactPage(bridge,'https://example.com/contact-us/',{status:'not_found'},'Find published contact channels');
  assert.deepEqual(reads,['https://example.com/','https://example.com/contact/']);assert.equal(result.url,'https://example.com/contact/');assert.equal(result.recoveryReads,2);
  reads.length=0;await recoverContactPage(bridge,'https://example.com/contact-us/',{status:'not_found'},'Read only this exact URL and its contact information');assert.equal(reads.length,0);
});
test('research caches unreadable page families across different queries and rejects irrelevant plant results',async()=>{
  const {fastResearchTaskFor,gatherFastResearch}=loadResearch();const task=fastResearchTaskFor('Research online plant nursery competitors in Bangladesh');const reads=[];
  const bridge={searchWeb:async()=>({status:'ok',results:[{url:'https://example.com/plants?pagenumber=4',title:'Bangladesh plant nursery',snippet:'Garden plants Bangladesh'},{url:'https://example.com/plants?pagenumber=3',title:'Bangladesh plant nursery',snippet:'Garden plants Bangladesh'},{url:'https://example.org/power-plant',title:'Bangladesh coal power plant',snippet:'Plant online'},{url:'https://example.in/plants/bengaluru',title:'Online plants Bengaluru India',snippet:'Indian plant nursery'}]}),readSearchPage:async({url})=>{reads.push(url);return {status:'partial',source:'search_provider_text',url,content:'Unreadable nursery excerpt'};}};
  await gatherFastResearch(task,bridge,()=>{},'online plant nursery marketplace Bangladesh competitors');
  await gatherFastResearch(task,bridge,()=>{},'Bangladesh nursery suppliers competitors');
  assert.equal(reads.length,1);assert.match(reads[0],/pagenumber=4/);
});
test('HTTP-success soft 404 is not verified content and exposes only public navigation leads',async()=>{
  const {readSearchResultPage}=require('../electron/search.cjs');const old=global.fetch;
  global.fetch=async()=>new Response('<title>Page Not Found</title><a href="/contact/">Contact</a><a href="http://localhost/contact">Contact</a>',{headers:{'content-type':'text/html'}});
  try {const page=await readSearchResultPage({url:'https://example.com/contact-us/'});assert.equal(page.status,'not_found');assert.equal(page.verified,false);assert.equal(page.content,undefined);assert.deepEqual(page.links,[{url:'https://example.com/contact/',title:'Contact'}]);}finally{global.fetch=old;}
});
