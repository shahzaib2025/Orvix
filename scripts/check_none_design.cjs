const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const skills = require('../electron/agent/skill-library.cjs');
const { createSkillPolicy, humanSkillRequests } = require('../electron/agent/skill-policy.cjs');
const { resolveDesignProfile, profileGuidance } = require('../electron/agent/design-profile.cjs');
const { requestBody, instructionsFor } = require('../electron/agent/model-client.cjs');
const { createTools } = require('../electron/agent/tools.cjs');
const { createContextManager } = require('../electron/agent/context-manager.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { createRunJournal } = require('../electron/agent/run-journal.cjs');
const { createDesignReview, designExecutionInstructions } = require('../electron/agent/design-review.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const maxIds = ['website_design_max', ...skills.listSkills().filter(entry => entry.forDesignProfile === 'max').map(entry => entry.id)];

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-none-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function toolsFor(policy) {
  const unused = new Proxy({}, { get() { throw Error('Skill operations need no workspace'); } });
  return createTools(unused, unused, unused, 'none', new AbortController().signal, () => false, null, null, null, null, null, null, null, 'Full access', { designProfile: 'none', skillPolicy: policy });
}
test('None is explicit, preserves old mappings and survives renderer/task/checkpoint restore', t => {
  assert.equal(resolveDesignProfile('none', 'quality'), 'none'); assert.equal(resolveDesignProfile(), 'normal');
  assert.equal(resolveDesignProfile(undefined, 'fast'), 'medium'); assert.equal(profileGuidance('none'), '');
  const module = { exports: {} };
  const compiled = require('typescript').transpileModule(fs.readFileSync('src/agentDesignProfiles.ts', 'utf8'), { compilerOptions: { module: 1 } }).outputText;
  vm.runInNewContext(compiled, { exports: module.exports, module });
  for (const profile of ['none', 'normal', 'medium', 'max']) assert.equal(module.exports.savedDesignProfile(profile, 'quality'), profile);
  assert.equal(module.exports.designProfileLabel('none'), 'None');
  const root = temporary(t), app = { getPath: () => root };
  const store = createTaskMemoryStore(app); store.write('none', { designProfile: 'none', skillPermissions: { explicitIds: ['website_design_max', 'invalid'] } });
  const reopened = createTaskMemoryStore(app); assert.equal(reopened.read('none').designProfile, 'none');
  assert.deepEqual(reopened.read('none').skillPermissions.explicitIds, ['website_design_max']);
  const journal = createRunJournal(app); journal.write({ taskId: 'none', requestId: 'run', designProfile: 'none', history: [], safe: true });
  assert.equal(journal.metadata('none').designProfile, 'none');
});
test('None catalogs and direct/native reads retain unrelated skills and reject automatic website reads', async () => {
  const policy = createSkillPolicy('none', 'Create a premium animated website');
  const tools = toolsFor(policy);
  const unrelated=skills.listSkills().filter(entry=>!entry.designProfile && !entry.forDesignProfile).map(entry=>entry.id).sort();
  for (const native of [false, true]) assert.deepEqual(skills.selectedSkills({ native, designProfile: 'none', policy }).map(entry => entry.id).sort(), unrelated);
  assert.equal(JSON.parse(await tools.call('read_agent_skill', { id: 'research' })).id, 'research');
  for (const entry of skills.listSkills(true).filter(entry => entry.designProfile || entry.forDesignProfile)) {
    await assert.rejects(tools.call('read_agent_skill', { id: entry.id }), /not available/);
    assert.equal(skills.nativeSkill(entry.path, 'none', policy), null);
  }
  const names = tools.definitions('Full access').map(tool => tool.name);
  for (const name of ['write_file', 'find_visual_assets', 'preview_website', 'start_preview_server', 'verify_work']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('set_design_brief'));
});
test('explicit human named skills are narrow; quotations, negations and generic quality never grant access', () => {
  for (const text of ['Create a premium MAX quality website', 'Use GSAP and Three.js to animate the website', 'Example: "use the MAX website skill"', '> use website_design_max', '```\nuse website_design_max\n```', 'Do not use website_design_max', "Don't use the MAX website skill for the user's website", 'Explain how to use the MAX website skill']) assert.deepEqual(humanSkillRequests(text).ids, [], text);
  for (const text of ['Use the MAX website skill', 'Please use website_design_max', 'Please use `website_design_max`', 'Make a website and follow the Design MAX skill']) assert.deepEqual(humanSkillRequests(text).ids, maxIds, text);
  assert.deepEqual(humanSkillRequests('Use the MAX website skill. Do not use the MAX website skill after all.').ids, []);
  assert.deepEqual(humanSkillRequests('Use the Medium website skill').ids, ['website_design_medium']);
  assert.deepEqual(humanSkillRequests('Use the Default website skill').ids, ['website_design']);
  assert.equal(humanSkillRequests('Use the MAX website skill and Medium website skill').conflict, true);
});
test('manual MAX remains None; steering revokes permission and unrelated new work does not inherit it', async () => {
  const policy = createSkillPolicy('none', 'Use the MAX website skill to create this site'), tools = toolsFor(policy);
  assert.equal(JSON.parse(await tools.call('read_agent_skill', { id: 'website_design_max' })).id, 'website_design_max');
  assert.equal(JSON.parse(await tools.call('read_agent_skill', { id: 'website_motion_max' })).id, 'website_motion_max');
  const maxPath = skills.listSkills(true).find(entry => entry.id === 'website_design_max').path;
  assert.equal(skills.nativeSkill(maxPath, 'none', policy).id, 'website_design_max');
  assert.ok(!tools.definitions('Full access').some(tool => tool.name === 'set_design_brief'));
  assert.deepEqual(createSkillPolicy('none', 'Continue', policy.snapshot()).snapshot().explicitIds, policy.snapshot().explicitIds);
  assert.deepEqual(createSkillPolicy('none', 'Fix the form on this website', policy.snapshot()).snapshot().explicitIds, policy.snapshot().explicitIds);
  assert.deepEqual(createSkillPolicy('none', 'Create a new website for another shop', policy.snapshot()).snapshot().explicitIds, []);
  policy.update('Do not use website skills anymore');
  await assert.rejects(tools.call('read_agent_skill', { id: 'website_design_max' }), /not available/);
  assert.equal(skills.nativeSkill(maxPath, 'none', policy), null);
});
test('all direct transports omit automatic construction policy and advertise only explicit None skills', () => {
  for (const route of ['chat', 'responses', 'messages']) {
    const model = { id: 'opencode/fixture', route };
    for (const explicit of [false, true]) {
      const policy = createSkillPolicy('none', explicit ? 'Use the MAX website skill' : 'Create a premium website');
      const body = requestBody(model, [], [], null, () => '', false, false, null, 'Full access', null, 'none', policy.snapshot());
      const text = route === 'chat' ? body.messages[0].content : route === 'responses' ? body.instructions : body.system;
      assert.doesNotMatch(text, /Current design policy:|confirmed repetition pauses source construction|record the concrete composition with set_design_brief/);
      assert.equal(text.includes('"id":"website_design_max"'), explicit);
      assert.match(text, /None is selected/); assert.match(text, /preview_website workflow/);
    }
  }
  assert.equal(designExecutionInstructions('Create a complete website', 'Full access', 'none'), '');
  for (const purpose of ['design_review', 'conversation', 'request_understanding']) assert.doesNotMatch(instructionsFor(null, 'Controlled', purpose, 'none'), /None is selected|Bundled topic skills/);
});
test('restored skill bodies and compacted instructions cannot leak from MAX into None', () => {
  const max = { ...skills.readSkill('website_design_max'), evidenceId: 'max-proof' };
  const research = { ...skills.readSkill('research'), evidenceId: 'research-proof' };
  const history = [{ role: 'user', content: 'Create the website in white' }, { role: 'tool', content: JSON.stringify(max) }, { type: 'function_call_output', output: JSON.stringify(max) }, { role: 'user', content: [{ type: 'tool_result', content: JSON.stringify(max) }] }, { role: 'user', content: 'Saved factual file paths\nSuccessfully read bundled instructions (reconsider relevance for the current request):\n' + max.instructions }];
  const restored = { version: 2, segments: history.map((_, index) => ({ start: index, end: index + 1, kind: index === 4 ? 'memory' : 'batch' })), activeSkills: [max, research] };
  const policy = createSkillPolicy('none', 'Continue');
  const context = createContextManager(history, [history[0]], restored, () => '', { designProfile: 'none', skillPolicy: policy });
  assert.deepEqual(context.loadedSkills().map(skill => skill.id), ['research']);
  assert.ok(!JSON.stringify(history).includes(max.instructions.slice(0, 200)));
  assert.equal(history[0].content, 'Create the website in white'); assert.match(history[4].content, /Saved factual file paths/);
  assert.throws(() => context.recordSkill(max, 'new-proof'), /selected design profile/);
  const next = createContextManager([], [], restored, () => '', { designProfile: 'max' });
  assert.ok(next.loadedSkills().some(skill => skill.id === 'website_design_max'));
});
test('None disregards saved design holds and does not call comparison, reviewer or capture refresh', async () => {
  const unexpected = () => { throw Error('Automatic design workflow must be disabled'); };
  const design = createDesignReview({ enabled: true, profile: 'none', brief: 'Create a full website', mode: 'quality', saved: { mode: 'quality', profile: 'max', status: 'revising', diversity: { version: 2, active: true, status: 'repeated' } }, priorDesigns: [{ taskId: 'prior' }], review: unexpected, refreshCapture: unexpected, emit: unexpected, evidence: { record: unexpected } });
  assert.equal(design.snapshot().profile, 'none'); assert.equal(design.snapshot().mode, 'quality');
  assert.equal(design.snapshot().status, 'not_needed'); assert.equal(design.constructionAllowed(), true);
  assert.doesNotThrow(() => design.assertConstruction('write_file', { path: 'index.html' }));
  design.capture({ views: [] }, {}, 'current'); assert.deepEqual(await design.evaluate('current'), {});
});
test('real native adapter respects None permission gates and keeps ordinary preview tools', async t => {
  const root = temporary(t), project = fs.mkdtempSync(path.join(__dirname, 'none-native-fixture-'));
  fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><title>None routing fixture</title><h1>Existing factual content</h1>');
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"none-routing-fixture"}');
  t.after(() => { assert.equal(path.dirname(project), __dirname); fs.rmSync(project, { recursive: true, force: true }); });
  let builders = 0;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, () => {}, null, { runNativeSession: async options => {
    builders++; assert.ok(!options.readOnly); assert.doesNotMatch(options.systemPrompt || '', /DESIGN MAX|MAX experience|record.*set_design_brief|Recent generated designs/);
    assert.doesNotMatch(options.parts[0].text, /For a fresh whole website|new standalone hero needs|website_design_max|Current design policy:/);
    assert.match(options.parts[0].text, /None is selected/);
    const maxPath = skills.listSkills(true).find(entry => entry.id === 'website_design_max').path;
    assert.equal(await options.onPermission({ permission: 'read', patterns: [maxPath] }), false);
    const researchPath = skills.listSkills(true).find(entry => entry.id === 'research').path;
    assert.equal(await options.onPermission({ permission: 'read', patterns: [researchPath] }), true);
    assert.equal(await options.onPermission({ permission: 'edit', patterns: [path.join(project, 'index.html')] }), true);
    const bridge = await options.visualTools({ acceptsImages: true, signal: options.signal });
    try {
      const response = await (await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })).json();
      const names = response.result.tools.map(tool => tool.name);
      assert.ok(names.includes('preview_website')); assert.ok(names.includes('find_visual_assets')); assert.ok(!names.includes('set_design_brief'));
    } finally { await bridge.close(); }
    return { text: 'No file changes were made in this routing fixture.', usage: null };
  } });
  t.after(() => engine.shutdown());
  engine.taskMemory.write('none-native', { designProfile: 'max', goal: 'Create a website', plan: 'Follow the MAX template', designReview: { profile: 'max', diversity: { version: 2, status: 'repeated' } } });
  engine.taskMemory.recentDesigns = () => { throw Error('None must not read earlier design records'); };
  await engine.workspaces.open('none-native', project, async () => true);
  const result = await engine.run({ taskId: 'none-native', requestId: 'run', modelId: 'opencode/mimo-v2.6-flash-free', designProfile: 'none', designReviewMode: 'quality', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Create a professional website' }] });
  assert.equal(builders, 1); assert.equal(result.verification.designReview.status, 'not_needed');
  assert.equal(engine.taskMemory.read('none-native').designProfile, 'none');
});

test('direct engine delivers None policy, denies design tools and saves a clean None task', async t => {
  const root = temporary(t);
  let builders = 0;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => 'fixture' }, () => {}, () => {}, {
    nativeSnapshot: async () => ({ status: 'unavailable', reason: 'Fixture' }),
    reviewModel: async ({ purpose }) => ({ text: JSON.stringify(purpose === 'request_understanding'
      ? { goal: 'Create a website', feature: 'Website', expectedBehavior: 'A website', exclusions: [], assumptions: [], examples: [], questions: [] }
      : { status: 'approved', criteria: [], missingRequirements: [], reason: 'Fixture' }), calls: [] }),
    requestModel: async options => {
      builders++; assert.equal(options.designProfile, 'none'); assert.deepEqual(options.skillPermissions.explicitIds, []);
      const names = options.tools.map(tool => tool.name); assert.ok(!names.includes('set_design_brief'));
      const read = options.tools.find(tool => tool.name === 'read_agent_skill');
      assert.ok(read); assert.deepEqual(read.parameters.properties.id.enum.sort(), skills.listSkills().filter(entry=>!entry.designProfile && !entry.forDesignProfile).map(entry=>entry.id).sort());
      assert.doesNotMatch(JSON.stringify(options.history), /Follow the MAX template/);
      return { text: 'No file changes were made in this direct routing fixture.', calls: [], route: 'chat', raw: { content: 'No file changes were made.' }, usage: null };
    },
    designReviewModel: async () => { throw Error('None must not run a design critic'); },
  });
  t.after(() => engine.shutdown());
  engine.taskMemory.write('none-direct', { designProfile: 'max', goal: 'Create a website', plan: 'Follow the MAX template' });
  engine.taskMemory.recentDesigns = () => { throw Error('None must not compare recent designs'); };
  const result = await engine.run({ taskId: 'none-direct', requestId: 'run', modelId: 'opencode/mimo-v2.6-flash-free', designProfile: 'none', designReviewMode: 'quality', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Create a professional website' }] });
  assert.ok(builders > 0); assert.equal(result.verification.designReview.status, 'not_needed');
  assert.equal(engine.taskMemory.read('none-direct').designProfile, 'none');
});
