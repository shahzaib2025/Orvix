const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEvidenceStore } = require('../electron/agent/evidence-store.cjs');
const { createExecutionMapStore } = require('../electron/agent/execution-map.cjs');
const { createDecisionPlanner } = require('../electron/agent/decision-planning.cjs');
const { validateTool } = require('../electron/agent/tool-validation.cjs');
const { auditReply } = require('../electron/agent/claim-audit.cjs');
const { createProgressRecovery } = require('../electron/agent/progress-recovery.cjs');
function fixture(local = false) {
  const parent = local ? __dirname : path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'orvix-verification-'));
  const app = { getPath: () => root }, evidence = createEvidenceStore(app), execution = createExecutionMapStore(app, evidence);
  execution.ensure('task', 'turn', 'Repair addition, preserve files and report actual tests', 'Full access');
  execution.update('task', 'turn', { replace_initial_goal: true, requirements: [{ id: 'behavior', text: 'Correct addition and preserve files', verification_types: ['focused'] }] });
  return { root, app, evidence, execution, cleanup() { assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('orvix-verification-')); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('verification summary counts only current post-change checks',()=>{
  const {summaryText,summarizeVerification}=require('../electron/agent/verification.cjs');
  const old={label:'Layout',phase:'layout',command:'capture',directory:'site',status:'failed',stateFingerprint:'old'};
  const current={...old,stateFingerprint:'new'};
  const result=summarizeVerification([old,{...old,label:'Accessibility',phase:'accessibility'},current,{...current,label:'Accessibility',phase:'accessibility',status:'passed'}],'',true,'new');
  assert.equal(summaryText(result),'Verification failed (1 check failed).');
  const passed=summarizeVerification([old,{...current,status:'passed'}],'',true,'new');
  assert.equal(summaryText(passed),'Verification passed (1 check).');
});
const criteria = ['positive', 'negative', 'preserve'].map(id => ({ id, requirementId: 'behavior', description: id, observable: id, negativeCase: 'Wrong ' + id, method: id === 'preserve' ? 'observation' : 'command' }));
test('CommonJS source and regression-test changes schedule the actual project test command', t => {
  const {createVerificationPlan,summaryText}=require('../electron/agent/verification.cjs');
  const f=fixture(true);t.after(()=>f.cleanup());
  fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({scripts:{test:'node --test math.test.cjs'}}));
  for(const name of ['math.cjs','math.test.cjs']){
    const plan=createVerificationPlan([{path:path.join(f.root,name),kind:'modified'}]);
    assert.equal(plan.reason,'');assert.ok(plan.checks.some(check=>check.command==='npm test'&&check.directory===f.root));
  }
  assert.match(summaryText({status:'not_run',reason:'No recognized additional check.',checks:[]}),/^Automatic project verification was not run:/);
});

test('standalone website JavaScript has a meaningful syntax fallback without a manifest', t => {
  const {createVerificationPlan}=require('../electron/agent/verification.cjs');
  const f=fixture();t.after(()=>f.cleanup());
  fs.mkdirSync(path.join(f.root,'js'));
  fs.writeFileSync(path.join(f.root,'index.html'),'<script src="js/app.js"></script>');
  const file=path.join(f.root,'js/app.js');fs.writeFileSync(file,'const ready = true;');
  const plan=createVerificationPlan([{path:path.join(f.root,'index.html'),kind:'modified'},{path:file,kind:'modified'}]);
  assert.equal(plan.reason,'');assert.deepEqual(plan.checks,[{label:'Syntax check: app.js',command:"node --check '"+path.join('js','app.js')+"'",directory:f.root}]);
  const {spawnSync}=require('node:child_process');
  assert.equal(spawnSync(process.execPath,['--check',file],{encoding:'utf8'}).status,0);
  fs.writeFileSync(file,'const broken = ;');
  assert.notEqual(spawnSync(process.execPath,['--check',file],{encoding:'utf8'}).status,0);
  fs.unlinkSync(file);
  assert.equal(createVerificationPlan([{path:file,kind:'deleted'}]).checks.length,0);
});

test('HTML and CSS-only repairs check referenced local scripts without following remote or escaping paths', t => {
  const {createVerificationPlan}=require('../electron/agent/verification.cjs');
  const f=fixture();t.after(()=>f.cleanup());
  fs.mkdirSync(path.join(f.root,'site'));const site=path.join(f.root,'site');
  fs.writeFileSync(path.join(f.root,'outside.js'),'const outside = true;');
  fs.writeFileSync(path.join(site,'main.js'),'const valid = true;');
  fs.writeFileSync(path.join(site,'styles.css'),'body { color: black; }');
  const html=path.join(site,'index.html');
  fs.writeFileSync(html,'<!-- <script src="ignored.js"></script> --><script src="missing.js"></script><script src="https://example.com/lib.js"></script><script src="../outside.js"></script><script src="main.js?v=1"></script><script src="/main.js"></script>');
  for(const changed of [html,path.join(site,'styles.css')]){
    const plan=createVerificationPlan([{path:changed,kind:'modified'}],{roots:[site]});
    assert.deepEqual(plan.checks,[{label:'Syntax check: main.js',command:"node --check 'main.js'",directory:site}]);
  }
  fs.writeFileSync(html,'<base href="https://example.com/"><script src="main.js"></script>');
  assert.deepEqual(createVerificationPlan([{path:html,kind:'modified'}],{roots:[site]}).checks,[]);
});

test('configured ancestor checks take precedence over standalone HTML discovery', t => {
  const {createVerificationPlan}=require('../electron/agent/verification.cjs');
  const f=fixture();t.after(()=>f.cleanup());
  fs.mkdirSync(path.join(f.root,'web'));
  fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
  fs.writeFileSync(path.join(f.root,'web/index.html'),'<main>App</main>');
  const file=path.join(f.root,'web/app.js');fs.writeFileSync(file,'const ready = true;');
  const plan=createVerificationPlan([{path:file,kind:'modified'}],{roots:[f.root]});
  assert.ok(plan.checks.some(c=>c.command==='npm test'&&c.directory===f.root));
  const scoped=createVerificationPlan([{path:file,kind:'modified'}],{roots:[path.dirname(file)]});
  assert.equal(scoped.checks[0].directory,path.dirname(file));
  assert.equal(scoped.checks[0].command,"node --check 'app.js'");
});

test('syntax fallback keeps shell-sensitive filename characters literal', t => {
  const {createVerificationPlan}=require('../electron/agent/verification.cjs');
  const f=fixture();t.after(()=>f.cleanup());
  const file=path.join(f.root,"odd$note's.js");fs.writeFileSync(file,'const valid = true;');
  const plan=createVerificationPlan([{path:file,kind:'modified'}],{roots:[f.root]});
  const {spawnSync}=require('node:child_process');
  const result=process.platform==='win32'
    ? spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',plan.checks[0].command],{cwd:f.root,encoding:'utf8',windowsHide:true,timeout:15000})
    : spawnSync('/bin/sh',['-c',plan.checks[0].command],{cwd:f.root,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
});
function planner(f, review) { return createDecisionPlanner({ ...f, taskId: 'task', requestId: 'turn', signal: new AbortController().signal, publish() {}, review }); }
test('a placeholder goal is refined into separate target-folder and deliverable requirements before editing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-placeholder-plan-'));
  const evidence = createEvidenceStore({ getPath: () => root });
  const execution = createExecutionMapStore({ getPath: () => root }, evidence);
  const objective = 'Create C:\\Users\\HP\\Desktop\\FlorianBD-Website-HTML and build a website about florianbd.com in that folder.';
  execution.ensure('task', 'turn', objective, 'Full access');
  const purposes = [];
  const p = createDecisionPlanner({ execution, evidence, taskId: 'task', requestId: 'turn', signal: new AbortController().signal, publish() {}, review: async (purpose, prompt) => {
    purposes.push(purpose);
    if (purpose === 'execution_requirements') return JSON.stringify({ requirements: [
      { text: 'The exact Desktop folder C:\\Users\\HP\\Desktop\\FlorianBD-Website-HTML exists.', verification_types: ['focused'] },
      { text: 'The folder contains an index.html website about florianbd.com and its supporting assets.', verification_types: ['focused', 'user_flow'] },
    ] });
    const requirements = JSON.parse(/Requirements:\n([\s\S]*?)\nObserved project sources/.exec(prompt)[1]);
    return JSON.stringify({ status: 'approved', missingRequirements: [], criteria: requirements.map((item, index) => ({ id: `criterion-${index + 1}`, requirementId: item.id, description: item.text, observable: 'Inspect the actual target path and files after creation.', negativeCase: 'The target folder or requested website files are missing.', method: 'observation' })), reason: 'The plan observes the exact folder and website deliverables.' });
  } });
  try {
    const result = await p.preflight({});
    assert.equal(result.status, 'approved');
    const map = execution.read('task', 'turn');
    assert.equal(map.requirements.some(item => item.placeholder), false);
    assert.equal(map.requirements.length, 2);
    assert.match(map.requirements[0].text, /FlorianBD-Website-HTML/);
    assert.match(map.requirements[1].text, /index\.html.*florianbd\.com/);
    assert.deepEqual(purposes, ['execution_requirements', 'acceptance_planning']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('HTML and hero deliverables can refer to the named project folder without repeating its basename', async t => {
 const target='C:\\Users\\HP\\Desktop\\Hero-Test';
 for(const wording of ['index.html exists in that authorized project folder as the HTML entry file.', 'A standalone hero exists inside that project folder.', 'A website exists in the authorized directory.']){
  const f=fixture();t.after(()=>f.cleanup());
  f.execution.ensure('target','request','Create a standalone website hero in folder '+target,'Full access');let calls=0;
  const p=createDecisionPlanner({execution:f.execution,evidence:f.evidence,taskId:'target',requestId:'request',signal:new AbortController().signal,publish(){},review:async(purpose,prompt)=>{
   calls++;
   if(purpose==='execution_requirements')return JSON.stringify({requirements:[{text:'The project folder '+target+' exists.',verification_types:['focused']},{text:wording,verification_types:['layout']}]});
   const reqs=JSON.parse(/Requirements:\n([^\n]+)\nObserved project sources/.exec(prompt)[1]);
   return JSON.stringify({status:'approved',missingRequirements:[],criteria:reqs.map((r,i)=>({id:'check-'+i,requirementId:r.id,description:r.text,observable:'Actual target and deliverable exist',negativeCase:'Missing or wrong target fails',method:'observation'}))});
  }});
  assert.equal((await p.preflight({})).status,'approved',wording);assert.equal(calls,2,'No wording-only repair call');
 }
});

test('folder references cannot conceal an explicitly different absolute website destination',async t=>{
 const f=fixture();t.after(()=>f.cleanup());const target='C:\\Users\\HP\\Desktop\\Hero-Test';
 f.execution.ensure('target','request','Create a website in folder '+target,'Full access');let calls=0;
 const p=createDecisionPlanner({execution:f.execution,evidence:f.evidence,taskId:'target',requestId:'request',signal:new AbortController().signal,publish(){},review:async()=>{calls++;return JSON.stringify({requirements:[{text:'The project folder '+target+' exists.',verification_types:['focused']},{text:'The website in that folder is at C:\\Other\\Hero-Test\\index.html.',verification_types:['layout']}]});}});
 const result=await p.preflight({});assert.equal(result.status,'unavailable');assert.match(result.reason,/different absolute destination/);assert.equal(calls,2);
});

test('acceptance rejection is repaired once, then mutations wait for a changed map revision', async () => {
  const f = fixture(); let calls = 0;
  try {
    const p = planner(f, async (purpose, prompt) => {
      calls++;
      const requirementText = /Requirements:\n([\s\S]*?)\nObserved project sources/.exec(prompt)?.[1] ?? '';
      const updated = /exact target folder exists/i.test(requirementText);
      const currentCriteria = updated ? [{ id: 'folder', requirementId: 'behavior', description: 'The exact target folder exists', observable: 'Observe the requested folder path', negativeCase: 'The folder is absent', method: 'observation' }] : criteria;
      const approved = updated;
      return JSON.stringify({ status: approved ? 'approved' : 'needs_revision', criteria: currentCriteria, missingRequirements: approved ? [] : ['behavior'], reason: approved ? 'Coverage is complete.' : 'No observable criterion confirms the exact target folder exists.' });
    });
    assert.equal((await p.preflight({})).status, 'needs_revision');
    assert.equal((await p.preflight({})).status, 'needs_revision');
    assert.equal(calls, 2, 'the rejected map revision is not sent to the reviewer repeatedly');
    f.execution.update('task', 'turn', { requirements: [{ id: 'behavior', text: 'The exact target folder exists and contains the requested website files.', verification_types: ['focused'] }] });
    assert.equal((await p.preflight({})).status, 'approved');
    assert.equal(calls, 3, 'a changed requirement revision receives a fresh review');
  } finally { f.cleanup(); }
});
function proof(f, plan, ids, phase = 'focused') {
  const entry = f.evidence.record('task', 'turn', { kind: 'verification', name: 'actual', phase, status: 'passed', requirementIds: ['behavior'], acceptanceIds: ids, acceptanceStamp: plan.stamp, reviewStatus: 'approved', stateFingerprint: 'fresh', command: ids.join(',') }, 'Actual observed result');
  f.execution.observe('task', 'turn', entry); return entry;
}
test('partial reviews retain only covered criteria and never complete uncovered outcomes', async () => {
  const f = fixture();
  try {
    const p = planner(f, async purpose => JSON.stringify(purpose === 'acceptance_planning' ? { status: 'approved', criteria } : { status: 'approved', coveredIds: ['positive'], reason: 'Only positive values asserted' }));
    const plan = await p.acceptance({}); const result = await p.check({ command: 'node test.js', requirement_ids: ['behavior'] }, {});
    assert.deepEqual(result.acceptanceIds, ['positive']); proof(f, plan, result.acceptanceIds); assert.equal(f.execution.view('task', 'turn', 'fresh').complete, false);
    proof(f, plan, ['negative']); proof(f, plan, ['preserve'], 'observation'); assert.equal(f.execution.view('task', 'turn', 'fresh').complete, true);
    assert.equal(f.execution.view('task', 'turn', 'different').complete, false);
  } finally { f.cleanup(); }
});
test('unchanged rejected proposals reuse review but source changes require a new review', async () => {
  const f = fixture(); let reviews = 0;
  try {
    const p = planner(f, async purpose => { if (purpose === 'acceptance_planning') return JSON.stringify({ status: 'approved', criteria }); reviews++; return JSON.stringify({ status: 'rejected', coveredIds: [], reason: 'Missing actual assertions' }); });
    const input = { command: 'node test.js', requirement_ids: ['behavior'] };
    const context = { files: [{ file: 'math.js', hash: 'old' }], savedEvidence: [] };
    await p.check(input, context); context.savedEvidence.push({ id: 'unrelated-new-evidence' }); assert.equal((await p.check(input, context)).cached, true); assert.equal(reviews, 1);
    context.files[0].hash = 'changed'; await p.check(input, context); assert.equal(reviews, 2);
  } finally { f.cleanup(); }
});
test('observation criteria are deferred without asking a command to prove the final report', async () => {
  const f = fixture(); let reviews = 0;
  try {
    const p = planner(f, async purpose => { if (purpose !== 'acceptance_planning') reviews++; return JSON.stringify({ status: 'approved', criteria }); });
    const result = await p.check({ command: 'npm run test', requirement_ids: ['behavior'], acceptance_ids: ['preserve'] }, {});
    assert.equal(result.status, 'deferred'); assert.deepEqual(result.acceptanceIds, []); assert.equal(reviews, 0);
  } finally { f.cleanup(); }
});
test('completion review receives actual reply and rejects invented command coverage without passing evidence', async () => {
  const f = fixture();
  try {
    const p = planner(f, async (purpose, prompt) => {
      if (purpose === 'acceptance_planning') return JSON.stringify({ status: 'approved', criteria });
      assert.equal(purpose, 'completion_review'); assert.match(prompt, /rejected BEFORE execution/); assert.match(prompt, /I ran rejected checks/);
      return JSON.stringify({ status: 'reviewed', coveredIds: ['positive', 'preserve'], unsupportedClaims: ['I ran rejected checks'], reason: 'Review actual observations' });
    });
    await p.acceptance({}); const result = await p.finish({ fingerprint: 'fresh', reply: 'I ran rejected checks', checks: [], changes: [], scope: [] });
    assert.deepEqual(result.coveredIds, ['preserve']); assert.deepEqual(result.unsupportedClaims, ['I ran rejected checks']);
  } finally { f.cleanup(); }
});
test('malformed and unknown tool arguments are rejected locally', () => {
  const definition = { name: 'verify_work', parameters: { type: 'object', required: ['command', 'phase'], additionalProperties: false, properties: { command: { type: 'string' }, phase: { type: 'string', enum: ['focused'] } } } };
  assert.throws(() => validateTool(definition, { phase: 'focused' }), /command is required/);
  assert.throws(() => validateTool(definition, { command: 'test', phase: 'made-up' }), /must be one of/);
  assert.throws(() => validateTool(definition, { command: 12, phase: 'focused' }), /must be string/);
  assert.throws(() => validateTool(definition, { command: 'test', phase: 'focused', invented: true }), /not a supported argument/);
});
test('automatic project checks reuse equivalent npm test results without equating different commands', () => {
  const { commandKey } = require('../electron/agent/verification.cjs');
  assert.equal(commandKey('npm test'), commandKey('npm run test'));
  assert.notEqual(commandKey('npm test -- --watch'), commandKey('npm test'));
  assert.notEqual(commandKey('npm run test:unit'), commandKey('npm test'));
});
test('execution reporting distinguishes rejected proposals from actual command evidence', () => {
  const verification = { checks: [{ command: 'npm run test', phase: 'regression', status: 'passed', output: 'pass 3' }], toolOutcomes: [{ name: 'verify_work', command: 'node scope.js', executed: false }, { name: 'run_command', command: 'npm run test', executed: true, exitCode: 0 }] };
  assert.ok(auditReply('I ran the rejected checks with exit 0.', verification, false).length);
  assert.ok(auditReply('I ran `node scope.js` with exit 0.', verification, false).length);
  assert.equal(auditReply('I ran `npm run test`; 3 tests passed.', verification, false).length, 0);
  assert.equal(auditReply('The proposed `node scope.js` did not execute.', verification, false).length, 0);
  assert.equal(auditReply('I ran `node -e "a \\|\\| b"` and got exit 0.', { checks: [], toolOutcomes: [{ name: 'run_command', executed: true, command: 'node -e "a || b"', exitCode: 0 }] }, false).length, 0);
});
test('similar compound-review failures prompt a strategy change without a task cap', () => {
  const recovery = createProgressRecovery();
  recovery.observe('verify_work', { command: 'first' }, 'Error: Independent check review: missing reply', 'one', 'same', false, true);
  const result = recovery.observe('verify_work', { command: 'second' }, 'Error: Independent check review: missing reply again', 'two', 'same', false, true);
  assert.match(result.instruction, /Do not revise the same compound command/); assert.match(result.instruction, /no step, tool-call, or time budget/);
});
test('repeated acceptance rejection directs the agent away from another blocked edit', () => {
  const recovery = createProgressRecovery();
  const first = 'Error: Acceptance coverage needs revision: no criterion verifies the target folder. Update the execution map before editing.';
  const second = 'Error: Acceptance coverage needs revision: no criterion verifies website files in the target folder. Update the execution map before editing.';
  recovery.observe('write_file', { file: 'index.html', content: 'first draft' }, first, 'one', 'same', false, true);
  const result = recovery.observe('write_file', { file: 'styles.css', content: 'different draft' }, second, 'two', 'same', false, true);
  assert.match(result.instruction, /Do not retry the same edit or submit an empty execution-map update/);
});
test('live reply execution counts use command-log identities rather than shared source fingerprints', () => {
  const { removeUnsupportedClaims } = require('../electron/agent/claim-audit.cjs');
  const live = require('./fixtures/agent-execution-identity.json');
  assert.ok(auditReply(live.reply, live.verification, false).some(item => /execution count/.test(item)));
  const corrected = removeUnsupportedClaims(live.reply, live.verification, false);
  assert.ok(!corrected.includes('one distinct post-edit execution'));
  assert.ok(corrected.includes('3/3 tests passing'));
  assert.equal(auditReply(corrected, live.verification, false).length, 0);
  const shared = { checks: [{ phase: 'focused', status: 'passed', commandEvidenceId: 'one', stateFingerprint: 'same' }, { phase: 'regression', status: 'passed', commandEvidenceId: 'one', stateFingerprint: 'same' }] };
  shared.checks.push({ phase: 'build', source: 'automatic', status: 'skipped', evidenceId: 'declined', output: 'Approval was declined.' });
  assert.equal(auditReply('I observed one distinct post-edit execution.', shared, false).length, 0);
  shared.checks[1].commandEvidenceId = 'two';
  assert.ok(auditReply('I observed one distinct post-edit execution.', shared, false).length);
});
test('a reporter mismatch needs independent actual-bug evidence and cannot turn unrelated failure into reproduction', async () => {
  const f = fixture(); let reviews = 0;
  try {
    const p = planner(f, async (purpose, prompt) => { assert.equal(purpose, 'reproduction_review'); assert.match(prompt, /unrelated to the request/); reviews++; return JSON.stringify({ status: prompt.includes('ERR_ASSERTION') ? 'reproduced' : 'unresolved', reason: 'Review the recorded error against source' }); });
    assert.equal((await p.reproduce({ observedExitCode: 0, commandEvidenceId: 'actual' }, {})).status, 'unresolved'); assert.equal(reviews, 0);
    assert.equal((await p.reproduce({ observedExitCode: 1, commandEvidenceId: 'actual', observedOutput: 'Missing dependency' }, {})).status, 'unresolved');
    assert.equal((await p.reproduce({ observedExitCode: 1, commandEvidenceId: 'actual', observedOutput: 'ERR_ASSERTION -1 !== 5' }, {})).status, 'reproduced');
  } finally { f.cleanup(); }
});
test('linked action completion requires observed evidence and satisfied dependencies', () => {
  const f = fixture();
  try {
    f.execution.update('task', 'turn', { actions: [{ id: 'inspect', title: 'Read source', kind: 'inspect', requirement_ids: ['behavior'] }, { id: 'edit', title: 'Repair source', kind: 'edit', requirement_ids: ['behavior'], depends_on: ['inspect'] }] });
    const edit = f.evidence.record('task', 'turn', { kind: 'tool', name: 'apply_edit', actionId: 'edit' }, 'Edited source');
    f.execution.completeAction('task', 'turn', edit); assert.equal(f.execution.read('task', 'turn').actions[1].state, 'pending');
    const read = f.evidence.record('task', 'turn', { kind: 'tool', name: 'read_file_range', actionId: 'inspect' }, 'Source');
    f.execution.completeAction('task', 'turn', read); f.execution.completeAction('task', 'turn', edit); assert.ok(f.execution.read('task', 'turn').actions.every(item => item.state === 'done'));
  } finally { f.cleanup(); }
});
test('executor reviews executed tests, observes preservation and final delivery, and completes linked baseline actions', async () => {
  const f = fixture(true), { createAgentEngine } = require('../electron/agent/engine.cjs');
  const project = path.join(f.root, 'project'); fs.mkdirSync(project);
  const file = path.join(project, 'math.cjs'); fs.writeFileSync(file, '// preserve\nexports.add = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node --test math.test.cjs' } }));
  fs.writeFileSync(path.join(project, 'math.test.cjs'), "const test=require('node:test'), assert=require('node:assert/strict'), {add}=require('./math.cjs');\ntest('positive',()=>assert.equal(add(2,3),5)); test('negative',()=>assert.equal(add(-2,3),1)); test('zero',()=>assert.equal(add(0,0),0));");
  let engine, step = 0, commandReviewed = false, deliveryReviewed = false; const events = [];
  const inheritedTestContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT; // Commands under test must run their own tests, outside this runner's child context.
  const reqs = [{ id: 'sum', text: 'Addition works', verification_types: ['focused', 'regression'] }, { id: 'preserve', text: 'Preserve comment, test and manifest', verification_types: ['focused'] }, { id: 'report', text: 'Report actual test outcome', verification_types: ['regression'] }];
  const call = (id, name, args) => ({ id, name, args });
  const reply = (calls, text = '') => ({ text, calls, route: 'chat', raw: { content: text, tool_calls: calls.map(item => ({ id: item.id, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.args) } })) } });
  const cs = reqs.map(item => ({ id: item.id, requirementId: item.id, description: item.text, observable: item.text, negativeCase: 'Violation', method: item.id === 'sum' ? 'command' : 'observation' }));
  cs.push({ ...cs.find(item => item.id === 'preserve'), id: 'preserve-files', description: 'Both protected files stay byte-identical' });
  try {
    engine = createAgentEngine({ getPath: () => path.join(f.root, 'data') }, { getKey: () => 'fixture' }, event => events.push(event), () => {}, {
      collectEnvironment: async () => ({ status: 'ok', observedAt: Date.now(), executables: [{ name: 'node', status: 'available', version: process.version }, { name: 'npm', status: 'available', version: 'fixture' }] }),
      reviewModel: async ({ purpose, history }) => {
        const prompt = history.at(-1).content; let value;
        if (purpose === 'request_understanding') value = { taskKind: 'coding', goal: 'Repair addition and preserve sources', expectedBehavior: 'Addition works and actual results reported', questions: [] };
        else if (purpose === 'acceptance_planning') value = { status: 'needs_revision', criteria: cs, missingRequirements: reqs.map(item => item.id), reason: 'No successful file edit or content verification is present. The outcomes remain unverified.' };
        else if (purpose === 'check_review') { assert.match(prompt, /EXECUTED/); assert.match(prompt, /observedExitCode/); assert.match(prompt, /positive/); commandReviewed = true; value = { status: 'approved', coveredIds: ['sum'], reason: 'Actual test output and assertions observed' }; }
        else { assert.equal(purpose, 'completion_review'); assert.match(prompt, /3 tests passed/); assert.match(prompt, /unchangedFiles/); assert.match(prompt, /a - b/); assert.match(prompt, /a \+ b/); deliveryReviewed = true; value = { status: 'reviewed', coveredIds: ['preserve', 'preserve-files', 'report'], replyEvidence: [{ criterionId: 'report', excerpt: '3 tests passed' }], unsupportedClaims: ['No files anywhere else were touched.'], reason: 'Actual hashes, source and written reply match' }; }
        return { text: JSON.stringify(value), calls: [] };
      },
      requestModel: async ({ onDelta, history, tools }) => {
        if (!tools.length) return reply([], 'Addition is fixed; the actual suite passed.');
        assert.match(history.at(-1).content, /execution map/);
        onDelta?.('999 checks passed');
        if (step++ === 0) {
          assert.ok(tools.some(tool => tool.name === 'open_workspace'));
          assert.ok(tools.some(tool => tool.name === 'apply_edit'));
          assert.equal(tools.some(tool => tool.name === 'device_status'), false);
          return reply([call('open', 'open_workspace', { directory: project }), call('map', 'update_execution_map', { replace_initial_goal: true, requirements: reqs, actions: [
          { id: 'inspect', title: 'Inspect sources', kind: 'inspect', requirement_ids: ['sum'] },
          { id: 'baseline', title: 'Reproduce subtraction', kind: 'check', requirement_ids: ['sum'], depends_on: ['inspect'] },
          { id: 'edit', title: 'Repair addition', kind: 'edit', requirement_ids: ['sum'], depends_on: ['baseline'] },
          { id: 'check', title: 'Check addition and protected files', kind: 'check', requirement_ids: ['sum', 'preserve'], depends_on: ['edit'] },
        ] })]);
        }
        assert.ok(tools.some(tool => tool.name === 'device_status'));
        if (step === 2) return reply([call('read', 'read_file_ranges', { ranges: [{ file }, { file: path.join(project, 'math.test.cjs') }], action_id: 'inspect' }), call('repro', 'verify_work', { directory: project, command: 'npm run test', phase: 'reproduce', expected_exit: 'nonzero', expected_output: 'ERR_ASSERTION', label: 'Reproduce arithmetic failure', requirement_ids: ['sum'], action_id: 'baseline' })]);
        if (step === 3) return reply([call('edit', 'apply_edit', { file, old_text: 'a - b', new_text: 'a + b', requirement_ids: ['sum'], action_id: 'edit' })]);
        if (step === 4) return reply([call('test', 'verify_work', { directory: project, command: 'npm run test', phase: 'focused', expected_exit: 'zero', label: 'Addition cases', requirement_ids: ['sum'], action_id: 'check' })]);
        return reply([], 'Fixed addition; 3 tests passed. The comment, test file and manifest were preserved.\nNo files anywhere else were touched.\n99 tests passed.');
      },
    });
    const result = await engine.run({ taskId: 'task', requestId: 'turn', modelId: 'opencode/big-pickle', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Fix addition in ' + project + ' and preserve other files' }] });
    assert.equal(commandReviewed, true); assert.equal(deliveryReviewed, true);
    assert.ok(result.verification.requirements.every(item => item.status === 'verified'), JSON.stringify({ reply: result.text, verification: result.verification, map: engine.execution.read('task', 'turn') })); assert.equal(result.verification.executionPending, false); assert.equal(engine.runState.scorecard().verified, 1);
    assert.ok(!events.some(item => item.type === 'stream' && item.delta?.includes('999')));
    assert.equal(result.verification.checks.filter(item => item.command === 'npm run test' && item.phase !== 'reproduce').length, 1);
  } finally { if (inheritedTestContext !== undefined) process.env.NODE_TEST_CONTEXT = inheritedTestContext; engine?.shutdown(); f.cleanup(); }
});
