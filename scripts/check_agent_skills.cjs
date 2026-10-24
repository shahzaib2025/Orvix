const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const skills = require('../electron/agent/skill-library.cjs');
const { instructionsFor, requestBody, appendResult } = require('../electron/agent/model-client.cjs');
const { createContextManager, foldObservationText } = require('../electron/agent/context-manager.cjs');
const { createTools } = require('../electron/agent/tools.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { toolResultContext } = require('../electron/agent/tool-result-context.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const skill of skills.listSkills()) {
    fs.mkdirSync(path.dirname(path.join(root, skill.file)), { recursive: true });
    fs.writeFileSync(path.join(root, skill.file), skills.readSkill(skill.id).instructions);
  }
  return { root, library: skills.createSkillLibrary(root) };
}

test('registry has separate profile files and catalogs contain metadata only', () => {
  assert.deepEqual(skills.listSkills().map(s => s.id).sort(), ['browser_verification','bug_repair','change_review','diagrams','gltf_assets','gsap','gsap_svg','gsap_text','lenis','project_testing','refactor','research','scrolltrigger','task_planning','threejs','visual_composition','website_design','website_design_max','website_design_medium','website_layout_options','website_motion_max']);
  for (const entry of skills.listSkills()) {
    assert.equal(entry.file, entry.id + '/SKILL.md');
    assert.equal(entry.instructions, undefined);
    assert.equal(entry.contentHash, undefined);
    assert.ok(skills.readSkill(entry.id).instructions.length > 200);
  }
  assert.throws(() => skills.readSkill('../research'), /Unknown agent skill/);
  assert.throws(() => skills.readSkill('__proto__'), /Unknown agent skill/);
});

test('browser, visual and planning guides are available across profiles without activating creative skills', () => {
  for (const profile of ['none', 'normal', 'medium', 'max']) {
    const entries = skills.selectedSkills({ designProfile: profile });
    const catalog = skills.skillCatalogPrompt({ designProfile: profile });
    for (const id of ['browser_verification', 'visual_composition', 'task_planning']) {
      assert.ok(entries.some(entry => entry.id === id));
      const instructions = skills.selectedSkill(id, profile).instructions;
      assert.equal(instructions, skills.readSkill(id).instructions);
      assert.ok(catalog.includes(id));
      assert.ok(!catalog.includes(instructions));
    }
    if (profile === 'none') assert.ok(!entries.some(entry => entry.designProfile));
  }
});

test('shared prompt prefers one focused project check over a fixed verification stack', () => {
  const prompt = instructionsFor('normal', 'Controlled', null, 'normal');
  assert.match(prompt, /project-specific-testing to select one focused check/i);
  assert.match(prompt, /Do not run the same check set by habit/i);
  assert.doesNotMatch(prompt, /then relevant typecheck, build, regression, and user_flow checks/i);
});

test('loader reuses unchanged content, refreshes changed files, and never hides missing/empty files', t => {
  const { root, library } = fixture(t);
  const file = path.join(root, 'research/SKILL.md');
  const originalRead = fs.readFileSync; let reads = 0;
  fs.readFileSync = function(target, ...args) { if (path.resolve(target) === file) reads++; return originalRead.call(this, target, ...args); };
  try {
    const first = library.readSkill('research');
    assert.deepEqual(library.readSkill('research'), first);
    assert.equal(reads, 1);
    fs.appendFileSync(file, '\nChanged source guidance.\n');
    const second = library.readSkill('research');
    assert.notEqual(second.contentHash, first.contentHash); assert.match(second.instructions, /Changed source guidance/);
    assert.equal(reads, 2);
    fs.unlinkSync(file);
    assert.throws(() => library.readSkill('research'), /research is missing or unreadable/);
    fs.writeFileSync(file, '');
    assert.throws(() => library.readSkill('research'), /empty/);
    fs.writeFileSync(file, first.instructions);
    assert.equal(library.readSkill('research').contentHash, first.contentHash);
  } finally { fs.readFileSync = originalRead; }
});

test('all execution routes have catalog-only startup for each task topic and follow-up', () => {
  for (const prompt of ['Create a website', 'Fix a bug', 'Refactor imports', 'Research official docs', 'Research and fix website styles', 'Check the battery', 'Now improve it']) {
    for (const route of ['chat','responses','messages']) {
      const body = requestBody({ id: 'opencode/fixture', name: 'Fixture', route }, [{role:'user',content:prompt}], [], null, () => '', false, false, '3d-website', 'Controlled', null, 'max');
      const initial = route === 'chat' ? body.messages[0].content : route === 'messages' ? body.system : body.instructions;
      assert.match(initial, /Bundled topic skills/); assert.match(initial, /reconsider relevance/i);
      assert.match(initial, /"designProfile":"max"/); assert.match(initial, /"specialty":"3d-website"/);
      assert.doesNotMatch(initial, /DESIGN MAX|WebGL is unavailable|SOURCE GATHERING|Do not let this skill create its own recognizable template/);
      const history = [];
      const loaded = skills.selectedSkill('website_design', 'max');
      const call = { id:'skill-read',name:'read_agent_skill',args:{id:'website_design'} };
      const raw = route === 'messages' ? [{type:'tool_use',id:call.id,name:call.name,input:call.args}] : route === 'responses' ? [{type:'function_call',call_id:call.id,name:call.name,arguments:JSON.stringify(call.args)}] : {content:null,tool_calls:[{id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]};
      appendResult(route, history, { calls:[call], raw }, [{id:call.id,text:JSON.stringify(loaded)}], false);
      assert.match(JSON.stringify(history), /DESIGN MAX/); assert.match(JSON.stringify(history), /website_motion_max/);
      assert.doesNotMatch(JSON.stringify(history), /WebGL is unavailable/);
    }
  }
  for (const purpose of ['conversation','design_review','request_understanding','acceptance_planning','check_review','completion_review','reproduction_review']) {
    const text = instructionsFor('3d-website','Plan',purpose,'max');
    assert.doesNotMatch(text, /Bundled topic skills|SKILL.md|DESIGN MAX|"specialty"/);
  }
});

test('read tool returns full website and settings sections with no workspace or permission work', async () => {
  const blocked = new Proxy({}, { get() { throw Error('Skill read must not access workspace/index/changes'); } });
  const tools = createTools(blocked, blocked, blocked, 'task', new AbortController().signal, () => { throw Error('No approval'); }, null, null, null, null, null, null, null, 'Plan');
  assert.deepEqual(JSON.parse(await tools.call('list_agent_skills', {})).map(entry => entry.id).sort(),
    ['browser_verification', 'bug_repair', 'change_review', 'diagrams', 'project_testing', 'refactor', 'research', 'task_planning', 'visual_composition', 'website_design', 'website_layout_options']);
  await assert.rejects(tools.call('read_agent_skill', { id: 'missing' }), /read_agent_skill.id must be one of/);
  for (const entry of skills.selectedSkills()) {
    const result = JSON.parse(await tools.call('read_agent_skill', {id:entry.id}));
    assert.deepEqual(result, skills.readSkill(entry.id));
    if (entry.id === 'website_design') assert.ok(result.instructions.includes('DESIGN DEFAULT'));
    const serialized = JSON.stringify(result);
    assert.equal(toolResultContext('read_agent_skill', serialized, false), serialized);
    assert.equal(foldObservationText(serialized + '\nSaved evidence: proof.'), serialized + '\nSaved evidence: proof.');
  }
});

test('selected skills keep their full bodies and actual evidence through duplicate reads, compaction and resume', () => {
  const messages = [{role:'user',content:'Fix and redesign the website'}];
  const history = [...messages];
  const context = createContextManager(history, messages);
  const web = skills.readSkill('website_design'), repair = skills.readSkill('bug_repair');
  context.recordSkill(web, 'proof-first'); context.recordSkill(web, 'proof-duplicate'); context.recordSkill(repair, 'proof-repair');
  assert.equal(context.loadedSkills().length, 2); assert.equal(context.loadedSkills()[0].evidenceId, 'proof-first');
  assert.throws(() => context.recordSkill(web, ''), /evidence/);
  history.push({role:'user',content:'x'.repeat(900000)}); context.recordSegment(1);
  assert.ok(context.compactIfNeeded([],[],null));
  assert.ok(history[0].content.includes(web.instructions)); assert.ok(history[0].content.includes(repair.instructions));
  const resumed = createContextManager(history, messages, JSON.parse(JSON.stringify(context.snapshot())));
  assert.deepEqual(resumed.loadedSkills(), context.loadedSkills());
  const changed = {...web,contentHash:'b'.repeat(64),instructions:web.instructions+'\nNew revision'};
  resumed.recordSkill(changed, 'proof-new'); assert.equal(resumed.loadedSkills()[0].evidenceId, 'proof-new');
});

test('task memory persists only successful skill ID/hash/evidence metadata', t => {
  const {root} = fixture(t); const store = createTaskMemoryStore({getPath:()=>root});
  store.write('task',{loadedSkills:[{...skills.readSkill('research'),evidenceId:'proof-1'}, {id:'refactor',contentHash:'x',evidenceId:''}]});
  assert.deepEqual(store.read('task').loadedSkills,[{id:'research',contentHash:skills.readSkill('research').contentHash,evidenceId:'proof-1'}]);
  assert.equal(store.read('task').loadedSkills[0].instructions, undefined);
});

test('fresh task memory excludes other tasks and rejects mismatched stored identity', t => {
  const { root } = fixture(t); const store = createTaskMemoryStore({ getPath: () => root });
  store.write('first', { goal: 'Private earlier website direction', lastReply: 'Earlier design', loadedSkills: [{ ...skills.readSkill('website_design_max'), evidenceId: 'proof' }] });
  assert.equal(store.read('second'), null);
  assert.equal(store.context(store.read('second')), '');
  store.write('second', { goal: 'New task' });
  assert.doesNotMatch(store.context(store.read('second')), /Private earlier|Earlier design|website_design_max/);
  fs.copyFileSync(path.join(root, 'agent-memory', 'first.json'), path.join(root, 'agent-memory', 'second.json'));
  assert.equal(store.read('second'), null);
});

test('richer skills record concrete composition without a remembered website recipe', () => {
  for (const id of ['website_design_medium', 'website_design_max']) {
    const text = skills.readSkill(id).instructions;
    assert.match(text, /first.viewport.*(?:media|composition)/);
    assert.doesNotMatch(text, /left serif headline|dark pill controls|invent three short|develop two credible alternatives/);
  }
  assert.match(skills.readSkill('website_design_max').instructions, /two substantial pinned storytelling scenes/i);
  assert.match(skills.readSkill('website_design_max').instructions, /original layered (?:visual )?scene/);
  assert.match(skills.readSkill('website_design_max').instructions, /(?:repeating|seamless) accent on (?:at least one|a) meaningful word/);
  const max = skills.readSkill('website_design_max').instructions;
  assert.match(max, /at least nine meaningful content sections/);
  assert.match(max, /Do not[^\n]*long empty runways to supply page length/);
  assert.match(max, /capture the changed version/);
  assert.doesNotMatch(skills.readSkill('website_design_medium').instructions, /MAX chapter|[Ll]ong runways? must not supply most/);
});

test('all selected website profiles survive saved task memory across reload', t => {
  const {root} = fixture(t); const store = createTaskMemoryStore({getPath:()=>root});
  for (const [profile,id] of Object.entries({normal:'website_design',medium:'website_design_medium',max:'website_design_max'})) {
    const skill=skills.readSkill(id), evidenceId='proof-'+profile;
    store.write(profile,{loadedSkills:[null,{id:'unknown',contentHash:'a'.repeat(64),evidenceId:'invalid'}, {...skill,evidenceId}]});
    const saved=store.read(profile).loadedSkills;
    assert.deepEqual(saved,[{id,contentHash:skill.contentHash,evidenceId}]);
    const reopened=createTaskMemoryStore({getPath:()=>root});
    assert.deepEqual(reopened.read(profile).loadedSkills,saved);
  }
});

test('native reads count only when full content was returned, including numbered OpenCode output', () => {
  const web = skills.readSkill('website_design');
  const numbered = '<path>file</path>\n<type>file</type>\n<content>\n' + web.instructions.trimEnd().split('\n').map((line,i)=>`${i+1}: ${line}`).join('\n') + '\n</content>';
  assert.equal(skills.completeNativeRead(web, numbered), true);
  assert.equal(skills.completeNativeRead(web, web.instructions.slice(0, Math.floor(web.instructions.length / 2))), false);
  assert.equal(skills.completeNativeRead(web, 'Read succeeded'), false);
});

test('packaged native paths resolve into the unpacked archive and contain actual readable files', async t => {
  const {root} = fixture(t);
  const stage = path.join(root,'stage','electron','agent','skills'); fs.mkdirSync(stage,{recursive:true});
  for (const entry of skills.listSkills()) { fs.mkdirSync(path.dirname(path.join(stage,entry.file)),{recursive:true}); fs.copyFileSync(path.join(skills.root,entry.file),path.join(stage,entry.file)); }
  const asar = require('@electron/asar'); const archive = path.join(root,'app.asar');
  await asar.createPackageWithOptions(path.join(root,'stage'), archive, {unpackDir:'electron/agent/skills/**'});
  const resolved = skills.unpackedRoot(path.join(archive,'electron','agent'));
  const packed = skills.createSkillLibrary(resolved);
  for (const entry of packed.listSkills(true)) { assert.ok(entry.path.includes('app.asar.unpacked')); assert.equal(packed.readSkill(entry.id).contentHash,skills.readSkill(entry.id).contentHash); }
  const config=fs.readFileSync(path.resolve('electron-builder.yml'),'utf8'); assert.match(config,/asarUnpack:\s*\n\s*- electron\/agent\/skills\/\*\*/);
  assert.match(fs.readFileSync(path.resolve('electron-builder.presence.yml'),'utf8'),/extends: electron-builder.yml/);
});

test('prompt bytes and local read latency are measured independently from model response time', t => {
  const {library} = fixture(t); const before=performance.now(); const loaded=library.readSkill('website_design'); const cold=performance.now()-before;
  const start=performance.now(); for(let i=0;i<100;i++)library.readSkill('website_design'); const cached=(performance.now()-start)/100;
  t.diagnostic(JSON.stringify({catalogBytes:Buffer.byteLength(skills.skillCatalogPrompt()), nativeCatalogBytes:Buffer.byteLength(skills.skillCatalogPrompt({native:true})), websiteSkillBytes:Buffer.byteLength(loaded.instructions), coldReadMs:+cold.toFixed(3), cachedReadMs:+cached.toFixed(3), providerResponseTime:'not measured'}));
  assert.ok(Buffer.byteLength(skills.skillCatalogPrompt()) < Buffer.byteLength(loaded.instructions));
});

test('regular engine logs successful reads, rejects unknown skills, and reuses selected instructions on the next step', async t => {
  const {root} = fixture(t);
  const {createAgentEngine} = require('../electron/agent/engine.cjs');
  const events=[]; let step=0; let selectedResult;
  const sequence=[['read_agent_skill',{id:'website_design'}],['read_agent_skill',{id:'research'}],['read_agent_skill',{id:'website_design'}]];
  const engine=createAgentEngine({getPath:()=>root},{getKey:()=> 'fixture-key'}, e=>events.push(e),()=>{}, {
    reviewModel:async ({purpose})=>({text:JSON.stringify(purpose==='request_understanding'?{goal:'Read selected instructions',feature:'skills',trigger:'request',expectedBehavior:'Read the requested skills',assumptions:[],examples:[],questions:[],exclusions:[]}:{status:'approved',criteria:[],missingRequirements:[],reason:'Read-only instruction request'}),calls:[]}),
    requestModel:async ({history})=>{
      const latest=history.filter(h=>h.role==='tool').at(-1);
      if(latest) { const parsed=JSON.parse(latest.content.split('\nSaved evidence:')[0]); assert.ok(parsed.instructions); if(parsed.id==='website_design')selectedResult=parsed; }
      const item=sequence[step++];
      if(!item)return {text:'Read the website and research instructions. No project changes were made.',calls:[],route:'chat',raw:{content:'Read the website and research instructions. No project changes were made.'},usage:null};
      const [name,args]=item, id='skill-call-'+step;
      return {text:'',calls:[{id,name,args}],route:'chat',raw:{content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},usage:null};
    },
  });
  t.after(()=>engine.shutdown());
  const result=await engine.run({taskId:'skill-task',requestId:'skill-turn',modelId:'opencode/big-pickle',accessMode:'Plan',accessModeVersion:2,messages:[{role:'user',content:'Read the website design and research instructions only.'}]});
  assert.match(result.text,/Read the website/); assert.deepEqual(selectedResult,skills.readSkill('website_design'));
  const loaded=engine.taskMemory.read('skill-task').loadedSkills;
  assert.equal(loaded.length,2);
  const readEvents=events.filter(e=>e.type==='tool'&&e.phase==='completed'&&e.name==='read_agent_skill');
  assert.equal(readEvents.length,3); assert.ok(readEvents.every(e=>!e.failed&&e.evidenceId));
  assert.equal(loaded.find(s=>s.id==='website_design').evidenceId,readEvents[0].evidenceId);
  assert.deepEqual(engine.workspaces.list('skill-task'),[]);
});

test('recovery marks changed or missing observed content stale without claiming a new read', () => {
  const observed={...skills.readSkill('research'),contentHash:'a'.repeat(64),evidenceId:'original-proof'};
  const notices=skills.refreshLoadedSkills([observed]);
  assert.equal(observed.stale,true); assert.equal(observed.evidenceId,'original-proof'); assert.match(notices[0],/changed since/);
  assert.equal(skills.refreshLoadedSkills([observed]).length,0);
  const prompt=skills.loadedSkillContext([observed]); assert.doesNotMatch(prompt,/Source gathering and reporting/); assert.match(prompt,/Read the current registered skill/);
  const unknown={...observed,id:'not_registered',stale:false};
  assert.match(skills.refreshLoadedSkills([unknown])[0],/Unknown agent skill/);
});
