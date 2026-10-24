const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {selectTaskSkills,prepareTaskSkills}=require('../electron/agent/task-skill-router.cjs');
const {createSkillPolicy}=require('../electron/agent/skill-policy.cjs');
const {createEvidenceStore}=require('../electron/agent/evidence-store.cjs');
const skills=require('../electron/agent/skill-library.cjs');
const ids=(request,options={})=>selectTaskSkills(request,{designProfile:'none',...options}).map(s=>s.id).sort();

test('terminal report-and-stop delivery does not suppress build skills in any profile',()=>{
 const brief='Create a premium website hero. Then test the browser button at desktop and mobile widths, report observed results, and stop.';
 for(const profile of ['none','normal','medium','max']) {
  const selected=ids(brief,{designProfile:profile});
  assert.ok(selected.includes('browser_verification'),profile);
  assert.ok(selected.includes('visual_composition'),profile);
  assert.ok(selected.includes('project_testing'),profile);
  const creative=selected.filter(id=>/^website_design/.test(id));
  assert.deepEqual(creative,profile==='none'?[]:[profile==='normal'?'website_design':'website_design_'+profile]);
 }
});
test('diagram guidance routes inline visuals across every profile',()=>{
 for(const profile of ['none','normal','medium','max']) {
  assert.ok(ids('Draw a flowchart for the login process.',{designProfile:profile}).includes('diagrams'));
  assert.ok(ids('Explain wave interference with an interactive simulation.',{designProfile:profile}).includes('diagrams'));
 }
 assert.ok(!ids('Explain login without diagrams.').includes('diagrams'));
 assert.deepEqual(ids('Explain this quoted example: "Draw a diagram"'),[]);
});
test('current task routes coding, browser, visual, research and planning work without skill names',()=>{
 const cases=[
  ['Fix the API error in the backend code.',['bug_repair','change_review','project_testing']],
  ['Repair the webpage button and mobile overflow.',['browser_verification','bug_repair','change_review','project_testing']],
 ['Refine this dull website into a premium composition.',['browser_verification','visual_composition']],
 ['Refine this dull website and report any remaining limits.',['browser_verification','visual_composition']],
 ['Research the latest official documentation for the API.',['research']],
  ['Refactor the module while preserving behavior.',['change_review','project_testing','refactor']],
  ['Fix the code, then extend tests and write the delivery report.',['bug_repair','change_review','project_testing','task_planning']],
  ['Repair add(a,b), then extend tests and write a report. Preserve the exported interface.',['bug_repair','change_review','project_testing','task_planning']],
  ['Add a search feature to the app.',['change_review','project_testing']],
  ['Run the smallest relevant test for this app.',['project_testing']],
  ['Review the actual code changes for regressions.',['change_review']],
 ['Implement this unclear billing workflow.',['task_planning']],
 ];
 for(const [request,expected]of cases)assert.deepEqual(ids(request),expected,request);
});
test('simple tasks, greetings, instruction catalogs and quoted examples do not preload topic instructions',()=>{
 for(const request of ['hi','check pc status','What time is it?','Compare two numbers.','Create a folder on my Desktop.','Read the research skill instructions','Explain this quoted example: "Fix the broken website then write tests"','Give a report only. Do not do any other work.','Stop now.'])assert.deepEqual(ids(request),[],request);
});
test('profile None and unrelated work never acquire a creative profile',()=>{
  assert.deepEqual(ids('Create a premium website.'),['browser_verification','change_review','project_testing','visual_composition']);
  assert.deepEqual(ids('Fix backend code.',{designProfile:'max'}),['bug_repair','change_review','project_testing']);
 assert.ok(ids('Create a premium website.',{designProfile:'medium'}).includes('website_design_medium'));
});
test('continuation uses only the same task previous request; unrelated work replaces relevance',()=>{
 const previousRequest='Fix code, then extend tests and write the delivery report.';
  assert.deepEqual(ids('Continue.',{previousRequest}),['bug_repair','change_review','project_testing','task_planning']);
 assert.deepEqual(ids('Research the latest API docs.',{previousRequest}),['research']);
 assert.deepEqual(ids('Do not use any skills. Fix code.'),[]);
  assert.deepEqual(ids('Fix code. Do not read bug_repair.'),['change_review','project_testing']);
});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-auto-skills-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return createEvidenceStore({getPath:()=>root});}
test('local loads record successful evidence and reuse unchanged content without duplicate read events',t=>{
 const evidence=fixture(t),events=[];
 const args={request:'Fix code, then extend tests.',designProfile:'none',evidence,taskId:'task',requestId:'first',emit:e=>events.push(e)};
  const first=prepareTaskSkills(args);assert.equal(first.loaded.length,4);assert.ok(first.text.includes('# Task planning and clarification'));
 assert.ok(first.selection.every(s=>s.reason&&s.status==='loaded'&&s.evidenceId));
 const before=events.length;
 const next=prepareTaskSkills({...args,requestId:'next',existing:first.loaded});
 assert.equal(events.length,before);assert.ok(next.selection.every(s=>s.status==='reused'));
 assert.deepEqual(next.loaded.map(s=>s.evidenceId),first.loaded.map(s=>s.evidenceId));
});
test('changed instructions get fresh evidence and unreadable instructions are never marked loaded',t=>{
 const evidence=fixture(t),args={request:'Fix code.',designProfile:'none',evidence,taskId:'task',requestId:'first'};
 const first=prepareTaskSkills(args),original=skills.readSkill;
 t.after(()=>{skills.readSkill=original;});
 skills.readSkill=id=>({...original(id),contentHash:'a'.repeat(64),instructions:'# Changed repair guidance'});
 const changed=prepareTaskSkills({...args,requestId:'changed',existing:first.loaded});
 assert.equal(changed.selection[0].status,'loaded');assert.notEqual(changed.loaded[0].evidenceId,first.loaded[0].evidenceId);
 skills.readSkill=()=>{throw Error('Agent skill bug_repair is missing or unreadable');};
 const failed=prepareTaskSkills({...args,requestId:'missing',existing:first.loaded});
 assert.equal(failed.loaded.length,0);assert.equal(failed.failures[0].status,'failed');assert.ok(failed.failures[0].failedEvidenceId);assert.match(failed.text,/missing or unreadable/);
});
test('report-only preparation reads nothing even if previous work used skills',t=>{
 const original=skills.readSkill;skills.readSkill=()=>{throw Error('Unexpected read');};t.after(()=>{skills.readSkill=original;});
 const result=prepareTaskSkills({request:'Stop now and give a report only.',previousRequest:'Fix code then extend tests.',designProfile:'none',evidence:fixture(t),taskId:'task',requestId:'report'});
 assert.deepEqual(result.selection,[]);assert.deepEqual(result.loaded,[]);assert.equal(result.text,'');
});
test('regular executor receives relevant full guidance before its first model call without an extra executor request',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-auto-skills-engine-'));
 const {createAgentEngine}=require('../electron/agent/engine.cjs');let calls=0;
 const engine=createAgentEngine({getPath:()=>root},{getKey:()=> 'fixture-key'},()=>{},()=>{}, {
  reviewModel:async({purpose})=>({text:JSON.stringify(purpose==='request_understanding'
    ? {goal:'Plan the code repair',feature:'backend code',trigger:'request',expectedBehavior:'Describe dependent work',assumptions:[],examples:[],questions:[],exclusions:[]}
    : {status:'approved',criteria:[],missingRequirements:[],reason:'Read-only planning'}),calls:[]}),
  requestModel:async({history})=>{
    calls++;const text=history.filter(m=>typeof m.content==='string').map(m=>m.content).join('\n');
    assert.match(text,/# Bug repair/);assert.match(text,/# Change review/);assert.match(text,/# Project-specific testing/);assert.match(text,/# Task planning and clarification/);
    assert.doesNotMatch(text,/# Browser interaction verification/);
    return{text:'Plan: inspect the failure, repair the cause, then extend tests and verify. No code was changed.',calls:[],route:'chat',raw:{content:'Plan supplied'},usage:null};
  }
 });
 t.after(()=>{engine.shutdown();fs.rmSync(root,{recursive:true,force:true});});
 await engine.run({taskId:'router-task',requestId:'router-turn',modelId:'opencode/big-pickle',designProfile:'none',accessMode:'Plan',accessModeVersion:2,messages:[{role:'user',content:'Plan a repair of backend code, then extend tests.'}]});
  assert.equal(calls,1);assert.deepEqual(engine.taskMemory.read('router-task').loadedSkills.map(s=>s.id).sort(),['bug_repair','change_review','project_testing','task_planning']);
 assert.deepEqual(engine.workspaces.list('router-task'),[]);
});
