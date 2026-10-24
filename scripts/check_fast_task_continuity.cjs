const {test}=require('node:test'), assert=require('node:assert/strict'), Module=require('node:module'), path=require('node:path');
const esbuild=require('esbuild');
const {createFastWork}=require('../electron/fast-work.cjs');
function load(file) {const filename=path.join(__dirname,'../src',file),m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(esbuild.buildSync({entryPoints:[filename],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text,filename);return m.exports;}
const {fastRequestIntent}=load('fastRequest.ts');
const {fastModelContext}=load('fastContext.ts');
test('research follow-ups preserve continuity and model transport preserves IDs without mutating proof',()=>{
 for(const prompt of ['Simple follow-up on the same Bangladesh solar research: explain net metering.','Continue the same research. Find independent capacity figures.','Using the figures already verified, calculate the gap.','Audit the claims in our earlier solar research.','Finish in Bangla with five findings.'])assert.equal(fastRequestIntent(prompt),'add');
 const context={latestRequest:'solar capacity',requirements:[{id:'capacity',status:'pending'}],steps:[{id:'read',dependsOn:[]}],evidence:Array.from({length:20},(_,i)=>({id:`e${i}`,sourcePassageId:`e${i}:excerpt`,verified:true,tool:'read_web_page',sourceUrl:`https://example.com/${i}`,excerpt:'solar capacity '+ 'x'.repeat(9000)}))};
 const before=JSON.stringify(context),projected=fastModelContext(context);
 assert.equal(JSON.stringify(context),before);assert.equal(projected.evidence.length,20);
 assert.deepEqual(projected.requirements,context.requirements);assert.deepEqual(projected.steps,context.steps);
 assert.equal(projected.evidence.filter(e=>e.excerpt).length,8);assert.ok(JSON.stringify(projected).length<25000);
 assert.deepEqual(projected.evidence.map(e=>e.sourcePassageId),context.evidence.map(e=>e.sourcePassageId));
});
const {fastWeatherTaskFor}=load('fastTask.ts');
const {matchesReviewedSpeech}=load('fastSpeech.ts');
test('spoken report keeps reviewed factual words and numbers while full citations remain written',()=>{
 const {spokenReviewedReport}=load('fastSpeech.ts');
 const report='Reported capacity was 123 MW in 2025. https://example.com/2026/guide\nSources: https://example.com/2026/guide';
 const spoken=spokenReviewedReport(report);
 assert.equal(spoken,'Reported capacity was 123 MW in 2025.');
 assert.equal(matchesReviewedSpeech('Reported capacity was 124 MW in 2025.',spoken),false);
 assert.equal(matchesReviewedSpeech('Reported capacity was 123 MW in 2026.',spoken),false);
 assert.equal(matchesReviewedSpeech('Reported capacity was 123 MW in 2025. https://evil.example/guide',spoken),false);
 assert.ok(spokenReviewedReport('Source: https://example.com/ Read 123 MW.').includes('123 MW'));
});
test('number words in Live transcripts retain numeric meaning without accepting changed values',()=>{
 assert.equal(matchesReviewedSpeech('Read two sources and one page.','Read 2 sources and 1 page.'),true);
 assert.equal(matchesReviewedSpeech('The target is two thousand and thirty MW.','The target is 2030 MW.'),true);
 assert.equal(matchesReviewedSpeech('Capacity was one point four GW.','Capacity was 1.4 GW.'),true);
 assert.equal(matchesReviewedSpeech('দুটি সূত্র পড়েছি।','২টি সূত্র পড়েছি।'),true);
 assert.equal(matchesReviewedSpeech('তিনটি সূত্র পড়েছি।','২টি সূত্র পড়েছি।'),false);
 assert.equal(matchesReviewedSpeech('Read three sources and one page.','Read 2 sources and 1 page.'),false);
 assert.equal(matchesReviewedSpeech('Capacity was one point five GW.','Capacity was 1.4 GW.'),false);
 assert.equal(matchesReviewedSpeech('The target is two thousand forty MW.','The target is 2030 MW.'),false);
 assert.equal(matchesReviewedSpeech('Read two unverified sources.','Read 2 verified sources.'),false);
 assert.equal(matchesReviewedSpeech('Read one source and explain one constraint.','Read 1 source and explain one constraint.'),true);
 assert.equal(matchesReviewedSpeech('Read one source. https://example.com/1','Read 1 source. https://example.com/one'),false);
 assert.equal(matchesReviewedSpeech('নয়টি সূত্র যাচাই হয়েছে; কাজ সম্পন্ন নয়।','৯টি সূত্র যাচাই হয়েছে; কাজ সম্পন্ন নয়।'),true);
 assert.equal(matchesReviewedSpeech('নয়টি সূত্র যাচাই হয়েছে; কাজ সম্পন্ন nine।','৯টি সূত্র যাচাই হয়েছে; কাজ সম্পন্ন নয়।'),false);
});
const {describeFastToolResult}=load('fastFlow.ts');
const {reviewOutcomeIssues}=require('../electron/fast-outcomes.cjs');
function fixture() {
  const events=[],effects=[];
  const adapter={cancel(){},observe:async()=>({status:'ok',observation:{windows:[{ref:'native:window:1:101',app:'Notepad',title:'First'},{ref:'native:window:1:202',app:'Notepad',title:'Second'}]}}),act:async input=>{effects.push(input);return {status:'ok',handle:input.handle,verification:{verified:true}};}};
  const work=createFastWork({browser:adapter,desktop:adapter,windows:adapter,emit:e=>events.push(e)});
  return {work,events,effects};
}
test('completed follow-ups preserve task identity, evidence and the exact pending approval',async()=>{
  const f=fixture(),t=f.work.update({text:'Close the selected Explorer folder'});
  const approval=await f.work.execute(t.id,'window_act',{action:'close',appName:'Explorer',title:'Downloads'});
  for(const text of ['বলো শেষ করো।','বলো শেষ করো। আগের সিলেটের ফলাফল দিয়ে উত্তর শেষ করো।','তারপর','তারপর। আগের API ব্যাখ্যার বাকি উত্তর শেষ করো।','অনুমতি দেওয়া হলো।','confirm','হ্যাঁ করো বন্ধু।']) {
    assert.equal(fastRequestIntent(text),'continue');
    const next=f.work.update({taskId:t.id,text,intent:fastRequestIntent(text)});
    assert.equal(next.id,t.id);assert.equal(next.revision,t.revision);assert.equal(next.approvalId,approval.approvalId);
  }
  assert.equal(f.effects.length,0);assert.equal(f.events.filter(e=>e.type==='approval_closed').length,0);f.work.cancel(t.id);
});
test('details and catalog follow-ups extend existing work and preserve verified source evidence',()=>{
  const f=fixture(),t=f.work.update({text:'Read florianbd.com'});
  const token=f.work.beginEvidence(t.id,'read_web_page',{url:'https://florianbd.com/'});
  f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://florianbd.com/'},{status:'ok',content:'Florian BD sells plants.'});
  const added=f.work.update({taskId:t.id,text:'Achha details do.',intent:fastRequestIntent('Achha details do.')});
  assert.equal(added.id,t.id);assert.equal(added.steps[0].state,'verified');assert.equal(added.ledgerEvidence.length,1);
  const catalog=f.work.update({taskId:t.id,text:'সবগুলা প্রোডাক্টের ডিটেইলস দাও।',intent:fastRequestIntent('সবগুলা প্রোডাক্টের ডিটেইলস দাও।')});
  assert.equal(catalog.id,t.id);assert.equal(catalog.planRequired,true);assert.ok(catalog.requirements.some(r=>r.id==='catalog-scope'));assert.ok(catalog.requirements.some(r=>r.id==='catalog-details'));
});
test('long Bangla completion requests keep the task while English rereads add fresh work',()=>{
 for(const text of ['বাংলায় উত্তর দাও। আগের function-calling ব্যাখ্যা শেষ করো। আগের প্রমাণ যাচাই করে দুইটি বিষয় বলো। নতুন গবেষণা শুরু করবে না।','বাংলায় উত্তর দাও। আগের ফ্লোরিয়ান বিডি অডিটের বাকি উত্তর শেষ করো।'])assert.equal(fastRequestIntent(text),'continue');
 assert.equal(fastRequestIntent('Continue that task. Read again and explain dependent calls.'),'add');
 assert.equal(fastRequestIntent('Continue that function-calling task. Read the same official page again using read_web_page.'),'add');
 assert.equal(fastRequestIntent('বাংলায় উত্তর দাও। আগের ফ্লোরিয়ান বিডি ও প্রতিযোগীর তুলনায় দামের প্রমাণ যোগ করো।'),'add');
 assert.equal(fastRequestIntent('আগের অডিটের ভুল তথ্য সংশোধন করো।'),'refine');
 assert.equal(fastRequestIntent('Research a new company'),'replace');
});
test('mapping a new question to a verified read creates fresh work and preserves original evidence',()=>{
 const f=fixture(),t=f.work.update({text:'Research the function calling workflow'});
 const base={requirements:[{id:'execution',text:'Who executes calls',kind:'research'}],steps:[{id:'read-guide',title:'Read guide',tool:'read_web_page',requirementIds:['execution'],expected:'Verify execution',dependsOn:[]}]};
 assert.equal(f.work.registerPlan(t.id,{...base,revision:t.revision}).status,'ok');
 const token=f.work.beginEvidence(t.id,'read_web_page',{url:'https://ai.google.dev/guide',stepId:'read-guide'});
 const proof=f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://ai.google.dev/guide'},{status:'ok',content:'The application executes the function.'});
 const next=f.work.update({taskId:t.id,text:'Also reread the guide for dependent calls.',intent:'add'});
 const result=f.work.registerPlan(t.id,{revision:next.revision,requirements:[...base.requirements,{id:'dependencies',text:'Explain dependent calls',kind:'research'}],steps:[{...base.steps[0],requirementIds:['execution','dependencies'],expected:'Verify execution and dependencies'}]});
 assert.equal(result.status,'ok');const c=f.work.taskContext(t.id);
 assert.equal(c.steps.find(s=>s.id==='read-guide').state,'verified');assert.equal(c.evidence.find(e=>e.id===proof.evidenceId).verified,true);
 assert.equal(c.steps.find(s=>s.id===`read-guide-addition-${next.revision}`).state,'pending');
 assert.equal(f.work.reviewCompletion(t.id,{revision:next.revision,answer:'The application executes calls.'}).completed,false);
});
test('the actual Bangla plural requests require plans and national weather gets its checklist',()=>{
  const f=fixture();
  for(const text of ['সবগুলো উইন্ডোকে এক এক করে মিনিমাইজ করো।','সবগুলা প্রোডাক্টের ডিটেইলস দাও।','এই দুইটা কম্পেয়ার করে বলো কোনটা ভালো?'])assert.equal(f.work.update({text}).planRequired,true,text);
  assert.ok(fastWeatherTaskFor('আচ্ছা বাংলাদেশে এখন কোথায় ওয়েদার গুলা কেমন আছে একটু দেখো তো।'));
  assert.deepEqual(fastWeatherTaskFor('ঢাকার ওয়েদার বলো').cities,['Dhaka']);
  assert.deepEqual(fastWeatherTaskFor('Reply in English. Call get_weather for Dhaka, Bangladesh. Give the observed temperature and conditions, then finish the answer.').cities,['Dhaka']);
  assert.deepEqual(fastWeatherTaskFor('get_weather দিয়ে সিলেটের বর্তমান তাপমাত্রা আর আবহাওয়া বলো।').cities,['Sylhet']);
  assert.equal(fastRequestIntent('বাংলায় উত্তর দাও। ফ্লোরিয়ান বিডির সবগুলা প্রোডাক্টের ডিটেইলস আর দাম দাও।'),'add');
});
test('one weather result cannot complete an acknowledgement or a fabricated temperature',()=>{
  const f=fixture(),t=f.work.update({text:'Give Dhaka weather'}),token=f.work.beginEvidence(t.id,'get_weather',{location:'Dhaka'});
  f.work.recordEvidence(t.id,token,'get_weather',{location:'Dhaka'},{status:'ok',location:'Dhaka, Bangladesh',temperature:'30 °C',conditions:'Clear'});
  for(const answer of ['অবশ্যই মাহদিস, প্রথমে ঢাকা দিয়ে শুরু করছি।','ঢাকা: ২৫ ডিগ্রি।','Dhaka: 25 °C. Chattogram: 30 °C.'])assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer}).completed,false,answer);
  assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'ঢাকা: ৩০ ডিগ্রি সেলসিয়াস, পরিষ্কার আকাশ।'}).completed,true);
});
test('weather comparisons use every city mention and reject swapped readings and differences',()=>{
 const task={goal:'Compare Dhaka and Sylhet weather',latestRequest:'',requirements:[{id:'dhaka',kind:'weather'},{id:'sylhet',kind:'weather'}],steps:[{id:'d',requirementIds:['dhaka']},{id:'s',requirementIds:['sylhet']}]};
 const evidence=[{tool:'get_weather',stepId:'d',location:'Dhaka, Bangladesh',temperature:'31.5 C'},{tool:'get_weather',stepId:'s',location:'Sylhet, Bangladesh',temperature:'27.1 C'}];
 const correct='Currently, Dhaka, located in Dhaka Division, Bangladesh, is warmer than Sylhet, located in Sylhet Division, Bangladesh. The temperature in Dhaka is 31.5 degrees C, while the temperature in Sylhet is 27.1 degrees C. Therefore Dhaka is warmer by 4.4 degrees C.';
 assert.deepEqual(reviewOutcomeIssues(task,correct,evidence),[]);
 for(const wrong of ['Dhaka is 27.1 C. Sylhet is 31.5 C.','Dhaka is warmer by 31.5 C. Sylhet is 27.1 C.','Dhaka feels like 31.5 C. Sylhet is 27.1 C.','Dhaka is 131.5 C. Sylhet is 27.1 C.'])assert.ok(reviewOutcomeIssues(task,wrong,evidence).length,wrong);
});
test('an additive answer keeps already delivered outcomes while reviewing its new outcome',async()=>{
 const f=fixture();f.work.configure({desktopEnabled:true});const t=f.work.update({text:'Plan and observe the current window title then review it.'});
 f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'title',text:'Report the observed window title',kind:'outcome'}],steps:[{id:'observe',title:'Observe titles',tool:'desktop_observe',requirementIds:['title'],expected:'Current application title'}]});
 await f.work.execute(t.id,'desktop_observe',{scope:'windows',stepId:'observe'});const proof=f.work.taskContext(t.id).evidence[0];
 const oldAnswer='The currently observed application window title is First.';
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:oldAnswer,coverage:[{requirementId:'title',answerQuote:oldAnswer,evidenceIds:[proof.id]}]}).completed,true);
 const next=f.work.update({taskId:t.id,text:'Also observe the current window again.',intent:'add'}),addition=`addition-${next.revision}`;
 f.work.registerPlan(t.id,{revision:next.revision,requirements:[{id:addition,text:next.latestRequest,kind:'outcome'}],steps:[{id:'fresh',title:'Fresh native inventory',tool:'desktop_observe',requirementIds:[addition],expected:'Fresh inventory'}]});
 await f.work.execute(t.id,'desktop_observe',{scope:'windows',stepId:'fresh'});const fresh=f.work.taskContext(t.id).evidence.at(-1);
 const newAnswer='A fresh inventory still includes the application window First.';
 assert.equal(f.work.reviewCompletion(t.id,{revision:next.revision,answer:newAnswer,coverage:[{requirementId:addition,answerQuote:newAnswer,evidenceIds:[fresh.id]}]}).completed,true);
 assert.equal(f.work.taskContext(t.id).requirements.find(r=>r.id==='title').reviewedPassage,oldAnswer);
});
test('a requested feels-like reading cannot be omitted or replaced by an invented value',()=>{
 const task={goal:'Dhaka weather and feels-like temperature',requirements:[],steps:[]},proof=[{tool:'get_weather',location:'Dhaka, Bangladesh',temperature:'31 C',feelsLike:'35.1 C'}];
 assert.ok(reviewOutcomeIssues(task,'Dhaka is 31 C.',proof).some(i=>/feels-like/.test(i)));
 assert.ok(reviewOutcomeIssues(task,'Dhaka is 31 C and feels like 40 C.',proof).length);
 assert.deepEqual(reviewOutcomeIssues(task,'Dhaka is 31 C and feels like 35.1 C.',proof),[]);
});
test('research comparison synthesis inherits both source reads without proving the answer',()=>{
 const f=fixture(),t=f.work.update({text:'Research two businesses and compare categories'});
 const result=f.work.registerPlan(t.id,{revision:t.revision,requirements:[{id:'a',text:'Identity A',kind:'research'},{id:'b',text:'Identity B',kind:'research'},{id:'compare',text:'Compare product categories',kind:'research'}],steps:[{id:'read-a',title:'Read A',tool:'read_web_page',requirementIds:['a'],expected:'A official identity'},{id:'read-b',title:'Read B',tool:'read_web_page',requirementIds:['b'],expected:'B official identity'}]});
 assert.equal(result.status,'ok');const synth=f.work.taskContext(t.id).steps.find(s=>s.id==='answer-compare');assert.deepEqual(synth.dependsOn,['read-a','read-b']);assert.equal(synth.state,'pending');
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'The businesses have identical products.'}).completed,false);
});
test('an explicitly requested failure report verifies only the failed retrieval, never page content',()=>{
 const f=fixture(),t=f.work.update({text:'Use read_web_page to inspect https://example.invalid/. Report the actual failure and do not substitute another website.'}),args={url:'https://example.invalid/',stepId:'retrieval-attempt'};
 const token=f.work.beginEvidence(t.id,'read_web_page',args);assert.equal(token.status,'ok');
 const proof=f.work.recordEvidence(t.id,token,'read_web_page',args,{status:'unavailable',message:'fetch failed'});
 const e=f.work.taskContext(t.id).evidence.find(e=>e.id===proof.evidenceId);assert.equal(e.negativeRead,true);assert.equal(e.verified,true);assert.match(e.excerpt,/fetch failed/);
 const bad='The website was read successfully and contains product prices. https://example.invalid/';
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:bad,coverage:[]}).completed,false);
 const answer='The page was not read successfully: fetch failed. Checked URL: https://example.invalid/';
 const c=['retrieval-attempt','retrieval-report'].map(requirementId=>({requirementId,answerQuote:answer,evidenceIds:[e.id]}));
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:bad+' The first fetch failed.',coverage:c.map(item=>({...item,answerQuote:bad}))}).completed,false,'Mapped failure evidence must not authorize successful article reading');
 assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer,coverage:c}).completed,true);
});
test('same reordered effect has one approval and cannot be executed again after verification',async()=>{
  const f=fixture(),t=f.work.update({text:'Close the selected Explorer folder'});
  const a=await f.work.execute(t.id,'window_act',{appName:'Explorer',title:'Downloads',action:'close'});
  const b=await f.work.execute(t.id,'window_act',{title:'Downloads',action:'close',appName:'Explorer'});
  assert.equal(a.approvalId,b.approvalId);assert.equal(f.events.filter(e=>e.type==='approval').length,1);assert.equal(a.target,'Explorer — Downloads');
  f.work.decide(a.approvalId,true);await f.work.resumeApproval(a.approvalId);assert.equal(f.effects.length,1);
  const repeated=await f.work.execute(t.id,'window_act',{title:'Downloads',action:'close',appName:'Explorer'});
  if(repeated.approvalId){f.work.decide(repeated.approvalId,true);assert.equal((await f.work.resumeApproval(repeated.approvalId)).status,'already_verified');}
  else assert.equal(repeated.status,'already_verified');
  assert.equal(f.effects.length,1);f.work.cancel(t.id);
});
test('all-window plan uses a fresh inventory, exact handles and verifies every target',async()=>{
  const f=fixture(),t=f.work.update({text:'সবগুলো উইন্ডোকে এক এক করে মিনিমাইজ করো।'});
  await f.work.prepareWindowPlan(t.id);const c=f.work.taskContext(t.id);
  assert.equal(c.planRequired,false);assert.equal(c.windowTargets.length,2);assert.equal(f.effects.length,0);
  assert.equal((await f.work.execute(t.id,'window_act',{stepId:'window-101',action:'minimize',handle:999})).status,'invalid_request');
  await f.work.execute(t.id,'window_act',{stepId:'window-101',action:'minimize',handle:101,appName:'Notepad'});
  const answer='All requested target windows were individually minimized and verified.';
  assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer}).completed,false);
  await f.work.execute(t.id,'window_act',{stepId:'window-202',action:'minimize',handle:202,appName:'Notepad'});
  assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer}).completed,true);assert.equal(f.effects.length,2);assert.equal(f.work.settings().desktopEnabled,false);
});
test('homepage sample, unread products and skipped text offsets cannot establish a complete catalog',()=>{
  const task={goal:'All products and prices',latestRequest:'',catalogRequested:true,requirements:[],steps:[]};
  const page={tool:'read_web_page',sourceUrl:'https://example.com/shop',excerpt:'A'.repeat(4500),offset:0,totalCharacters:12000,truncated:true,nextOffset:4500,links:[{url:'https://example.com/product/a'}]};
  assert.ok(reviewOutcomeIssues(task,'Sample products',[{...page,sourceUrl:'https://example.com/'}]).some(v=>/homepage/.test(v)));
  const tail={...page,offset:9000,excerpt:'B'.repeat(3000),truncated:false,nextOffset:null};
  assert.ok(reviewOutcomeIssues(task,'Full catalog',[page,tail]).some(v=>/unread content/.test(v)));
  const middle={...page,offset:4500,excerpt:'C'.repeat(4500)};
  assert.ok(reviewOutcomeIssues(task,'Full catalog',[page,middle,tail]).some(v=>/unchecked/.test(v)));
  const product={tool:'read_web_page',sourceUrl:'https://example.com/product/a',excerpt:'Product A costs 100 taka.',offset:0,totalCharacters:25,truncated:false};product.totalCharacters=product.excerpt.length;
  assert.deepEqual(reviewOutcomeIssues(task,'Full catalog',[page,middle,tail,product]),[]);
});
test('an unplanned search still requires source-backed answer coverage',()=>{
  const f=fixture(),t=f.work.update({text:'What is Florian BD?'}),token=f.work.beginEvidence(t.id,'web_search',{query:'Florian BD'});
  f.work.recordEvidence(t.id,token,'web_search',{}, {status:'ok',querySources:[{status:'verified',url:'https://florianbd.com/',content:'Florian BD sells plants.'}]});
  assert.equal(f.work.reviewCompletion(t.id,{revision:t.revision,answer:'Florian BD does not exist and has no public footprint.'}).completed,false);
  assert.ok(f.work.taskContext(t.id).requirements.some(r=>r.id==='source-answer'));
});
test('spoken formatting changes pass while changed facts, decimal values and completion claims fail',()=>{
  assert.equal(matchesReviewedSpeech('Read web page. Read Florian BD FlorianBD — Online Tree Nursery & Plant Marketp.', 'read_web_page. Read Florian BD (FlorianBD) — Online Tree Nursery & Plant Marketp.'),true);
  assert.equal(matchesReviewedSpeech('ঢাকা: ৩০ ডিগ্রি।','ঢাকা: 30 ডিগ্রি।'),true);
  assert.equal(matchesReviewedSpeech('Dhaka is 105 degrees.','Dhaka is 10.5 degrees.'),false);
  assert.equal(matchesReviewedSpeech('The task is completed.','The task is not completed.'),false);
  assert.equal(matchesReviewedSpeech('Florian BD does not exist.','Florian BD could not be verified.'),false);
  assert.equal(matchesReviewedSpeech('Tree Nursery and Plant Market. Read https colon slash slash florian-b-d dot com.', 'Tree Nursery & Plant Market. Read https://florianbd.com/.'),true);
  assert.equal(matchesReviewedSpeech('Read https colon slash slash other dot com.', 'Read https://florianbd.com/.'),false);
  assert.equal(matchesReviewedSpeech('Read https colon slash slash example dot com slash price question mark id equal 2.', 'Read https://example.com/price?id=1.'),false);
  assert.equal(matchesReviewedSpeech('The dot product is defined.','The product is defined.'),false);
  assert.equal(matchesReviewedSpeech('ঢাকা: ৩০ ডিগ্রি।','ঢাকো: ৩০ ডিগ্রি।'),false);
  assert.match(describeFastToolResult('review_task',{completed:true,status:'completed'},'en'),/passed completion review/);
  assert.doesNotMatch(describeFastToolResult('review_task',{completed:false,status:'partial'},'en'),/source page could not be opened/);
});
test('invented source ellipses are repairable without invoking the independent provider',async()=>{
  let reviews=0;const f=fixture(),work=createFastWork({browser:{},groundingReviewer:async()=>{reviews++;throw Error('Provider should not be called for malformed quotes');}});
  const t=work.update({text:'Read this business page'}),token=work.beginEvidence(t.id,'read_web_page',{url:'https://example.com/'});
  const e=work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/'},{status:'ok',content:'Example Plants sells indoor plants. Fruit trees are also offered.'});
  const answer='Example Plants sells indoor plants and fruit trees.';
  const r=await work.reviewCompletionGrounded(t.id,{revision:t.revision,answer,claims:[{requirementId:'source-answer',answerQuote:answer,sourceQuote:'Example Plants sells indoor plants... Fruit trees are also offered.',evidenceId:e.evidenceId}]});
  assert.equal(reviews,0);assert.equal(r.completed,false);assert.equal(r.status,'partial');assert.match(r.repairInstruction,/invented ellipses/);assert.ok(r.sourcePassages.length);f.work.cancel(t.id);
});
test('repeated invalid plans and identical completion reviews stop without losing evidence',()=>{
 const f=fixture(),t=f.work.update({text:'Research an example business'});
 const invalid={revision:t.revision,requirements:[{id:'request',text:'Research'}],steps:[]};
 for(let i=0;i<2;i++)assert.equal(f.work.registerPlan(t.id,invalid).status,'invalid_request');
 assert.equal(f.work.registerPlan(t.id,invalid).repairExhausted,true);
 assert.equal(f.work.registerPlan(t.id,invalid).status,'blocked');assert.equal(f.work.taskContext(t.id).budget.actions,0);
 const corrected={revision:t.revision,requirements:[{id:'identity',text:'Business identity',kind:'research'}],steps:[{id:'read',title:'Read identity',tool:'read_web_page',requirementIds:['identity'],expected:'Identity from the supplied source'}]};
 assert.equal(f.work.registerPlan(t.id,corrected).status,'ok');
 const review={revision:t.revision,answer:'The identity remains unverified.',coverage:[]};
 for(let i=0;i<3;i++)assert.equal(f.work.reviewCompletion(t.id,review).completed,false);
 const calls=f.work.task(t.id).controlCalls;
 assert.equal(f.work.reviewCompletion(t.id,review).repairExhausted,true);assert.equal(f.work.task(t.id).controlCalls,calls);
});
test('the controller rejects foreign policy scope even without frontend research state',()=>{
 const f=fixture(),t=f.work.update({text:'Check whether this URL can verify Bangladesh policy: https://www.uber.com/gh/en/'});
 const args={url:'https://www.uber.com/gh/en/',stepId:'scope-read'},token=f.work.beginEvidence(t.id,'read_web_page',args);
 assert.equal(token.status,'ok');assert.match(token.scopeIssue,/different country/);
 f.work.recordEvidence(t.id,token,'read_web_page',args,{status:'ok',content:'Unrelated foreign policy content',url:args.url});
 const proof=f.work.taskContext(t.id).evidence[0];assert.equal(proof.scopeOnly,true);assert.equal(proof.verified,true);assert.doesNotMatch(proof.excerpt,/Unrelated foreign policy content/);
});
test('an additive reread stays mandatory through an answer-only plan and rejects the wrong URL',()=>{
 const f=fixture(),t=f.work.update({text:'Read https://example.com/docs'});
 const token=f.work.beginEvidence(t.id,'read_web_page',{url:'https://example.com/docs'});
 f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/docs'},{status:'ok',content:'Existing documentation.'});
 const next=f.work.update({taskId:t.id,intent:'add',text:'Read the same page again and explain dependent calls.'});
 const r=f.work.registerPlan(t.id,{revision:next.revision,requirements:[{id:'dependent',text:'Explain dependent calls',kind:'research'}],steps:[{id:'answer-new',tool:'answer',title:'Explain dependent calls',requirementIds:['dependent'],expected:'Explanation from fresh evidence'}]});
 assert.equal(r.status,'ok');const context=f.work.taskContext(t.id),read=context.steps.find(s=>s.freshRead);
 assert.equal(read.state,'pending');assert.ok(context.steps.find(s=>s.id==='answer-new').dependsOn.includes(read.id));
 assert.equal(f.work.beginEvidence(t.id,'read_web_page',{stepId:read.id,url:'https://other.example/'}).status,'invalid_request');
 assert.equal(f.work.beginEvidence(t.id,'read_web_page',{stepId:read.id,url:'https://example.com/docs'}).status,'ok');
});
test('country query names cannot bypass the Bangladesh policy scope guard',()=>{
 const f=fixture(),t=f.work.update({text:'Read the Bangladesh delivery policy'});
 const token=f.work.beginEvidence(t.id,'read_web_page',{url:'https://example.com/policy?country=canada'});assert.match(token.scopeIssue,/different country/);
});
test('a controller-planned exact reread can execute while the added answer still needs its plan',()=>{
 const f=fixture(),t=f.work.update({text:'Read https://example.com/docs'});
 const token=f.work.beginEvidence(t.id,'read_web_page',{url:'https://example.com/docs'});
 f.work.recordEvidence(t.id,token,'read_web_page',{url:'https://example.com/docs'},{status:'ok',content:'Original passage.'});
 const next=f.work.update({taskId:t.id,intent:'add',text:'Read the same page again and explain dependent calls.'}),args={stepId:'fresh-read-2',url:'https://example.com/docs'};
 assert.equal(f.work.beginEvidence(t.id,'read_web_page',{...args,url:'https://other.example/'}).status,'plan_required');
 const fresh=f.work.beginEvidence(t.id,'read_web_page',args);assert.equal(fresh.status,'ok');
 f.work.recordEvidence(t.id,fresh,'read_web_page',args,{status:'ok',content:'A freshly retrieved passage about dependent calls.'});
 const c=f.work.taskContext(t.id);assert.equal(c.requirements.find(r=>r.id==='fresh-read-2').status,'verified');assert.equal(c.planRequired,true);
 assert.equal(f.work.reviewCompletion(t.id,{revision:next.revision,answer:'The documentation was reread. The new explanation is not verified yet.'}).completed,false);
});
test('window reports separate internal/minimized windows and preserve an earlier native comparison',async()=>{
 const {annotateWindows}=require('../electron/fast-windows.cjs');
 const native={status:'ok',observation:{timestamp:'now',windows:[{ref:'n:1',title:'Editor',app:'Code',state:'normal'},{ref:'n:2',title:'Hidden file',app:'Notepad',state:'minimized'},{ref:'n:3',title:'DWMNotificationWindow',app:'dwm',state:'normal'}]}};
 const result=annotateWindows(native);assert.equal(result.observation.windows.length,3);assert.equal(result.observation.applicationWindows.length,2);assert.deepEqual(result.observation.visibleApplicationWindows.map(w=>w.title),['Editor']);
 const comparison=annotateWindows(native,{timestamp:'before',windows:native.observation.windows});assert.equal(comparison.observation.comparison.added.length,0);assert.equal(comparison.observation.comparison.unchanged.length,2);
 const task={goal:'List visible application window titles',requirements:[],steps:[]};
 const proof={tool:'desktop_observe',windows:native.observation.windows,visibleApplicationWindows:result.observation.visibleApplicationWindows};
 assert.ok(reviewOutcomeIssues(task,'DWMNotificationWindow is visible.',[proof]).length);assert.deepEqual(reviewOutcomeIssues(task,'The application title is Editor.',[proof]),[]);
 const spaced={...proof,windows:[...native.observation.windows,{ref:'n:4',app:'dwm',state:'minimized',title:'DWM Notification Window'}]};
 assert.ok(reviewOutcomeIssues(task,'The visible application titles are Editor, DWM Notification Window and Hidden file.',[spaced]).length);
 assert.deepEqual(reviewOutcomeIssues(task,'The visible application title is Editor. Hidden file is minimized. DWM Notification Window is a notification window, excluded from the application list.',[spaced]),[]);
 const f=fixture();f.work.configure({desktopEnabled:true});const first=f.work.update({text:'Observe windows'});await f.work.execute(first.id,'desktop_observe',{scope:'windows'});
 const second=f.work.update({text:'Observe windows again'});const observed=await f.work.execute(second.id,'desktop_observe',{scope:'windows'});
 assert.deepEqual(observed.observation.comparison.unchanged,['First','Second']);assert.equal(f.work.taskContext(second.id).evidence[0].windowComparison.unchanged.length,2);
});
