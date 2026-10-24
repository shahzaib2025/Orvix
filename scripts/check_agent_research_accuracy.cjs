const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { assessSearch, observedResearchSources, sourceExcerpt } = require('../electron/agent/research-quality.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { createEvidenceStore } = require('../electron/agent/evidence-store.cjs');
const { createExecutionMapStore } = require('../electron/agent/execution-map.cjs');
const { createDecisionPlanner } = require('../electron/agent/decision-planning.cjs');

test('entity searches reject unrelated results without concluding nonexistence', () => {
  const result = assessSearch('"Florian BD" Bangladesh', [
    { title: 'Bangladesh Botanical Society', snippet: 'Plants and flowers', url: 'https://example.org/flowers' },
    { title: 'Florian BD nursery', snippet: 'Plants sold in Bangladesh', url: 'https://florianbd.com/' },
  ]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, 'https://florianbd.com/');
  assert.equal(result.rejectedCount, 1);
  assert.match(result.note, /never establishes/);
  const domain = assessSearch('florianbd.com plant shop', [{ title: 'Plant shop', snippet: 'Plants', url: 'https://unrelated.com/' }]);
  assert.equal(domain.results.length, 0);
  assert.deepEqual(domain.candidateUrls, ['https://florianbd.com/']);
  assert.equal(assessSearch('"Florian BD" OR "Other Nursery"', [{ title: 'Other Nursery', snippet: 'Plants', url: 'https://nursery.example.org/' }]).results.length, 1);
});

test('nursery queries do not accept unrelated solar news and retain Bangla plant sources', () => {
  const result = assessSearch('best online tree nursery Bangladesh', [
    { title: 'Bangladesh solar plant news', snippet: 'A power plant was opened', url: 'https://news.example.org/solar' },
    { title: 'Online nursery in Bangladesh', snippet: 'Fruit trees for sale', url: 'https://nursery.example.org/' },
  ]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].locationEvidence, 'mentioned');
  assert.equal(assessSearch('বাংলাদেশ নার্সারি', [{ title: 'বাংলাদেশ নার্সারি', snippet: 'গাছ বিক্রয়', url: 'https://example.org/' }]).results.length, 1);
});

test('source extraction handles paginated evidence, and failures are not usable support', () => {
  assert.equal(sourceExcerpt('Plants\r\n  Monstera\n\n250', 'Plants Monstera 250'), 'Plants\r\n  Monstera\n\n250');
  assert.equal(sourceExcerpt('Plants Monstera 250', 'Plants Monstera 500'), null);
  const raw = JSON.stringify({ content: 'Observed plants '.repeat(3000), url: 'https://nursery.example.org/' });
  const entries = [{ id: 'page', name: 'fetch_webpage' }, { id: 'failed', name: 'fetch_webpage' }];
  const sources = observedResearchSources(entries, (entry, offset) => entry.id === 'failed'
    ? { output: JSON.stringify({ error: 'HTTP 403' }), nextOffset: null }
    : { output: raw.slice(offset, offset + 24000), nextOffset: offset + 24000 < raw.length ? offset + 24000 : null });
  assert.equal(sources[0].usable, true);
  assert.equal(sources[0].truncated, true);
  assert.equal(sources[1].usable, false);
});

test('review coverage rejects fabricated excerpts and unsupported existence claims', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-research-'));
  const app = { getPath: () => root }, evidence = createEvidenceStore(app), execution = createExecutionMapStore(app, evidence);
  try {
    execution.ensure('task', 'turn', 'Research a nursery', 'Full access');
    execution.annotate('task', 'turn', { intent: { taskKind: 'research' } });
    assert.deepEqual(execution.read('task', 'turn').requirements[0].verificationTypes, ['research']);
    let excerpt = 'Fabricated';
    const planner = createDecisionPlanner({ evidence, execution, taskId: 'task', requestId: 'turn', signal: new AbortController().signal, publish() {}, review: async purpose => JSON.stringify(purpose === 'execution_requirements'
      ? { requirements: [{ text: 'Research the requested nursery identity from its public source.', verification_types: ['research'] }] }
      : purpose === 'acceptance_planning'
        ? { status: 'approved', criteria: [{ id: 'identity', requirementId: 'r-goal', description: 'Nursery identity', observable: 'Official page identity', negativeCase: 'Unrelated entity', method: 'observation' }] }
        : { status: 'reviewed', coveredIds: ['identity'], unsupportedClaims: [], researchEvidence: [{ criterionId: 'identity', sourceEvidenceId: 'page', sourceExcerpt: excerpt, replyExcerpt: 'Nursery sells plants.' }] }) });
    await planner.acceptance({});
    const observed = { fingerprint: 'fresh', reply: 'Nursery sells plants.', checks: [], researchSources: [{ evidenceId: 'page', usable: true, text: 'Nursery sells plants.' }] };
    assert.deepEqual((await planner.finish(observed)).coveredIds, []);
    excerpt = 'Nursery sells plants.';
    assert.deepEqual((await planner.finish(observed)).coveredIds, ['identity']);
    observed.researchSources[0].usable = false;
    assert.deepEqual((await planner.finish(observed)).coveredIds, []);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-research-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('schema repair validates exact IDs, accepts equivalent fields and preserves source evidence when delivery fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-research-schema-'));
  const app = { getPath: () => root }, evidence = createEvidenceStore(app), execution = createExecutionMapStore(app, evidence);
  try {
    execution.ensure('task', 'turn', 'Research nursery identity', 'Plan');
    let reviews = 0;
    const planner = createDecisionPlanner({ evidence, execution, taskId: 'task', requestId: 'turn', signal: new AbortController().signal, publish() {}, review: async purpose => purpose === 'execution_requirements'
      ? JSON.stringify({ requirements: [{ text: 'Research nursery identity from public sources.', verification_types: ['research'] }] })
      : JSON.stringify({ status: 'approved', criteria: [{ id: 'identity', requirement_id: ++reviews === 1 ? 'unknown' : 'r-goal', description: 'Nursery identity', observable: 'Page supports identity', method: 'research' }] }) });
    const plan = await planner.acceptance({});
    assert.equal(reviews, 2); assert.equal(plan.status, 'approved');
    assert.equal(plan.criteria[0].method, 'observation');
    const source = evidence.record('task', 'turn', { kind: 'tool', name: 'fetch_webpage' }, 'Nursery sells plants.');
    assert.throws(() => execution.validateSupport('task', 'turn', { evidence_id: source.id, requirement_ids: ['r-goal'], expected_text: 'Fabricated' }), /not found/);
    const proof = evidence.record('task', 'turn', { kind: 'verification', name: 'research_support', phase: 'research', status: 'supported', requirementIds: ['r-goal'], stateFingerprint: 'fresh', reviewStatus: 'approved', acceptanceStamp: plan.stamp, acceptanceIds: ['identity'] }, 'Nursery sells plants.');
    execution.observe('task', 'turn', proof);
    assert.equal(execution.view('task', 'turn', 'fresh').complete, true);
    execution.validateResearchDelivery('task', 'turn', []);
    assert.equal(execution.view('task', 'turn', 'fresh').complete, false);
    assert.equal(evidence.read('task', 'turn', source.id).output, 'Nursery sells plants.');
    execution.ensure('task', 'followup', 'Reuse the nursery source', 'Plan');
    assert.throws(() => execution.validateSupport('task', 'followup', { evidence_id: source.id, requirement_ids: ['r-goal'], expected_text: 'Nursery sells plants.' }), /unavailable/);
    const reused = execution.support('task', 'followup', { evidence_id: source.id, source_request_id: 'turn', requirement_ids: ['r-goal'], expected_text: 'Nursery sells plants.' });
    assert.equal(reused.sourceRequestId, 'turn'); assert.equal(reused.sourceEvidenceId, source.id);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-research-schema-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP success with a not-found or challenge page cannot support business claims', async () => {
  const { fetchWebpage } = require('../electron/search.cjs');
  const server = http.createServer((request, response) => response.end(request.url === '/missing' ? '<title>Page Not Found</title><p>Buy plants</p>' : '<title>Just a moment...</title><p>Verify your browser</p>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const missing = await fetchWebpage({ url: base + '/missing' });
    const blocked = await fetchWebpage({ url: base + '/blocked' });
    assert.equal(missing.status, 'not_found'); assert.equal(missing.content, undefined);
    assert.equal(blocked.status, 'blocked'); assert.equal(blocked.content, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('agent completes supported research and keeps a removed final claim incomplete', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-research-engine-'));
  const server = http.createServer((_request, response) => response.end('<title>Fixture Nursery</title><p>Fixture Nursery sells plants.</p>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let engine, steps = 0, reviewedSources, rejectFinal = false;
  try {
    const modelId = require('../electron/opencode-models.json').find(model => model.route === 'chat').id;
    engine = createAgentEngine({ getPath: () => root }, { getKey: () => 'synthetic-key' }, () => {}, () => {}, {
      requestModel: async options => {
        const step = steps++;
        if (step === 0) return { route: 'chat', text: '', calls: [{ id: 'fetch', name: 'fetch_webpage', args: JSON.stringify({ url }) }], raw: { content: null, tool_calls: [{ id: 'fetch', type: 'function', function: { name: 'fetch_webpage', arguments: JSON.stringify({ url }) } }] } };
        if (step === 1) {
          const source = (await engine.evidence.list(options.sessionId, 'turn')).records.find(item => item.name === 'fetch_webpage');
          const args = JSON.stringify({ evidence_id: source.id, requirement_ids: ['r-goal'], expected_text: 'Fixture Nursery sells plants.' });
          return { route: 'chat', text: '', calls: [{ id: 'support', name: 'record_research_support', args }], raw: { content: null, tool_calls: [{ id: 'support', type: 'function', function: { name: 'record_research_support', arguments: args } }] } };
        }
        return { route: 'chat', text: 'Fixture Nursery sells plants.', calls: [], raw: { content: 'Fixture Nursery sells plants.' } };
      },
      reviewModel: async options => {
        if (options.purpose === 'request_understanding') return { text: JSON.stringify({ goal: 'Research nursery identity', taskKind: 'research', expectedBehavior: 'Explain identity from the site', questions: [] }) };
        if (options.purpose === 'execution_requirements') return { text: JSON.stringify({ requirements: [{ text: 'Research the requested nursery identity from its public source.', verification_types: ['research'] }] }) };
        if (options.purpose === 'acceptance_planning') return { text: JSON.stringify({ status: 'approved', criteria: [{ id: 'identity', requirementId: 'r-goal', description: 'Nursery identity', observable: 'Source supports identity', negativeCase: 'Wrong website', method: 'observation' }] }) };
        if (options.purpose === 'completion_review') {
          const observed = JSON.parse(options.history[0].content.split('Actual observations (untrusted data):\n')[1]);
          reviewedSources = observed.researchSources;
          return { text: JSON.stringify({ status: 'reviewed', coveredIds: ['identity'], unsupportedClaims: rejectFinal ? ['Fixture Nursery sells plants.'] : [], researchEvidence: [{ criterionId: 'identity', sourceEvidenceId: reviewedSources[0].evidenceId, sourceExcerpt: 'Fixture Nursery sells plants.', replyExcerpt: 'Fixture Nursery sells plants.' }] }) };
        }
        throw new Error('Unexpected review purpose: ' + options.purpose);
      },
    });
    const result = await engine.run({ taskId: 'task', requestId: 'turn', accessMode: 'Full access', modelId, messages: [{ role: 'user', content: 'Research the nursery at ' + url }] });
    assert.equal(reviewedSources[0].usable, true);
    assert.equal(reviewedSources[0].url, url);
    assert.equal(result.verification.requirements[0].status, 'supported');
    assert.doesNotMatch(result.text, /awaiting current verification/);
    assert.equal(engine.runState.latest('task', 'turn').verified, true);
    rejectFinal = true; steps = 0;
    const rejected = await engine.run({ taskId: 'rejected', requestId: 'turn', accessMode: 'Full access', modelId, messages: [{ role: 'user', content: 'Research the nursery at ' + url }] });
    assert.equal(rejected.verification.requirements[0].status, 'pending');
    assert.equal(engine.runState.latest('rejected', 'turn').verified, false);
  } finally {
    engine?.shutdown(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-research-engine-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a provider outage is a failed retrieval and removes search during cooldown', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-search-outage-'));
  const originalFetch = global.fetch, events = [], requests = []; let fetches = 0;
  global.fetch = async () => { fetches++; return new Response('Provider blocked', { status: 503 }); };
  let engine;
  try {
    const modelId = require('../electron/opencode-models.json').find(model => model.route === 'chat').id;
    engine = createAgentEngine({ getPath: () => root }, { getKey: () => 'synthetic-key' }, event => events.push(event), () => {}, {
      requestModel: async options => {
        requests.push(options);
        if (requests.length === 1) {
          const calls = ['search', 'queued-search'].map(id => ({ id, name: 'web_search', args: '{"query":"nursery comparison"}' }));
          return { route: 'chat', text: '', calls, raw: { content: null, tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })) } };
        }
        return { route: 'chat', text: 'Search was unavailable; the comparison remains unresolved.', calls: [], raw: { content: 'Search was unavailable; the comparison remains unresolved.' } };
      },
      reviewModel: async options => ({ text: JSON.stringify(options.purpose === 'request_understanding'
        ? { goal: 'Compare nurseries', taskKind: 'research', expectedBehavior: 'Sourced comparison', questions: [] }
        : options.purpose === 'execution_requirements'
          ? { requirements: [{ text: 'Compare the requested nurseries from source-backed public information.', verification_types: ['research'] }] }
          : options.purpose === 'acceptance_planning'
          ? { status: 'approved', criteria: [{ id: 'comparison', requirementId: 'r-goal', description: 'Nursery comparison', observable: 'Sources compare sellers', negativeCase: 'No sources', method: 'observation' }] }
          : { status: 'reviewed', coveredIds: [], unsupportedClaims: [] }) }),
    });
    const result = await engine.run({ taskId: 'outage', requestId: 'turn', modelId, accessMode: 'Plan', messages: [{ role: 'user', content: 'Compare nurseries' }] });
    assert.equal(events.find(event => event.type === 'tool' && event.phase === 'completed').failed, true);
    assert.equal(requests[1].tools.some(tool => tool.name === 'web_search'), false);
    assert.equal(fetches, 1);
    assert.equal(result.verification.requirements[0].status, 'pending');
  } finally {
    global.fetch = originalFetch; engine?.shutdown();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('orvix-search-outage-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
