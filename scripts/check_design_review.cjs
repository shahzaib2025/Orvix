const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { listenBrowserLoopback } = require('../electron/agent/browser-loopback.cjs');
const { createDesignReview, createUsageLedger, designTask, designExecutionInstructions, parseReview } = require('../electron/agent/design-review.cjs');
const { createAgentEngine } = require('../electron/agent/engine.cjs');
const { configureOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, runOpenCodeSession } = require('../electron/agent/opencode-model.cjs');
const approved = { status: 'approved', summary: 'No material issues observed.', preserve: ['Identity'], issues: [] };
const revise = { status: 'needs_revision', summary: 'Mobile composition needs work.', preserve: ['Typography'], issues: [{ id: 'hero', severity: 'major', dimension: 'composition', view: 'mobile', observation: 'Heading dominates the mobile viewport.', suggestion: 'Reduce heading size and hero spacing.' }] };
const capture = { url: 'http://localhost:1', views: ['desktop', 'mobile'].map(label => ({ label, image: { type: 'orvix_image_ref', file: `${label}.jpg`, mime: 'image/jpeg' } })) };
const nativeAcceptanceReview = ({ purpose, prompt }) => {
  if (purpose === 'execution_requirements') return JSON.stringify({ requirements: [{ text: 'The requested website change is present in the selected project.', verification_types: ['focused', 'user_flow'] }] });
  if (purpose.startsWith('acceptance_planning')) {
    const requirements = JSON.parse(/Requirements:\n([\s\S]*?)\nObserved project sources/.exec(prompt)[1]);
    return JSON.stringify({ status: 'approved', missingRequirements: [], criteria: requirements.map((item, index) => ({ id: `native-criterion-${index + 1}`, requirementId: item.id, description: item.text, observable: 'Inspect the actual website state after construction.', negativeCase: 'The requested website outcome is absent or differs from the request.', method: 'observation' })), reason: 'Each website outcome has an observable check.' });
  }
  throw new Error(`Unexpected native acceptance review: ${purpose}`);
};
function fixture(options = {}) {
  const events = [], records = [], ledger = createUsageLedger(); const controller = new AbortController(); let calls = 0;
  const design = createDesignReview({ enabled: true, brief: 'Build a distinct website', acceptsImages: true, taskId: 't', requestId: 'r', signal: controller.signal,
    evidence: { record(...args) { records.push(args); return { id: `e${records.length}` }; } }, emit: event => events.push(event), ledger,
    review: async (prompt, images) => { calls++; assert.ok(prompt.includes('Brief') || prompt.includes('Original request')); assert.equal(images.length, 2); return { text: JSON.stringify(revise), usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 } }; }, ...options });
  return { design, events, records, ledger, controller, calls: () => calls };
}
test('public options appear as an ordinary persisted chat update with review off', async () => {
  const storyboard = 'SELECTED — Option A: centered artwork above the headline and action.\nOption B — NOT for construction: narrow text rail beside a full-height photograph.\nSelection reason: A gives the product a stronger reading hierarchy.';
  for (const profile of ['normal', 'medium', 'max']) {
    const f = fixture({profile, mode:'off'});
    const result = await f.design.setBrief({audience:'Visitors',primary_action:'Explore',direction:'Centered artwork',signature:'Product first',responsive:'Stacked',storyboard});
    const updates = f.events.filter(event => event.progressId === 'website-design-options' && event.phase === 'complete');
    assert.ok(f.events.some(event => event.progressId === 'website-design-options' && event.phase === 'update'), 'the draft is visible before its final comparison status');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].progressKind, 'agent_update');
    assert.equal(updates[0].phase, 'complete');
    assert.equal(result.brief.storyboard, storyboard, 'the recorded plan preserves the full bounded source');
    for (const summary of ['centered artwork above the headline and action.', 'narrow text rail beside a full-height photograph.', 'A gives the product a stronger reading hierarchy.'])
      assert.ok(updates[0].text.includes(summary), 'the public update preserves each option and the selection reason');
    assert.match(updates[0].text, /uniqueness is not verified/);
    assert.equal(result.construction_allowed, true);
    assert.equal(f.calls(), 0);
    await f.design.setBrief({...result.brief, storyboard:storyboard.replace('centered artwork', 'full-bleed artwork')});
    assert.equal(f.events.filter(event => event.progressId === updates[0].progressId && event.phase === 'complete').length, 2, 'revised brief replaces the same chat update');
  }
  for (const options of [{profile:'none'}, {enabled:false}, {brief:'Fix the existing website navigation'}]) {
    const f = fixture(options);
    await f.design.setBrief({audience:'Visitors',primary_action:'Explore',direction:'Preserved layout',signature:'Existing',responsive:'Stacked',storyboard});
    assert.equal(f.events.some(event => event.progressId === 'website-design-options'), false);
  }
});

test('blocked design choices are shown honestly before construction', async () => {
  const f = fixture({mode:'off', priorDesigns:[{taskId:'old',brief:{direction:'Existing split',storyboard:'Headline left, card right'}}],
    review:async()=>({text:JSON.stringify({status:'repeated',matchedTaskId:'old',similarities:[{dimension:'hero_structure',observation:'Same headline-left and card-right composition'}],summary:'Repeated expressive composition'})})});
  const result = await f.design.setBrief({audience:'Visitors',primary_action:'Explore',direction:'Split composition',signature:'Card',responsive:'Stacked',storyboard:'Selected A: headline left, card right. B: centered card, not for construction. Reason: clear reading order.'});
  assert.equal(result.construction_allowed, false);
  assert.match(f.events.find(event=>event.progressId==='website-design-options').text, /Revision needed before building/);
});

test('design scope excludes Plan, research-only and backend tasks', () => {
  assert.equal(designExecutionInstructions('Fix database authentication'), '');
  assert.equal(designExecutionInstructions('Build a website', 'Plan'), '');
  assert.match(designExecutionInstructions('Make a new website'), /No layout, palette/);
  assert.match(designExecutionInstructions('Improve this existing website'), /preserve the established identity/);
  assert.doesNotMatch(designExecutionInstructions('Make a new website', 'Full access', 'normal'), /discarded baseline/);
  const defaultInstructions = designExecutionInstructions('Make a new website', 'Full access', 'normal');
  const mediumInstructions = designExecutionInstructions('Make a new website', 'Full access', 'medium');
  const maxInstructions = designExecutionInstructions('Make a new website', 'Full access', 'max');
  assert.match(defaultInstructions, /Design Default:.*ordinary efficient execution/);
  assert.doesNotMatch(defaultInstructions, /Design Medium:|Design MAX:/);
  assert.match(mediumInstructions, /Design Medium:.*stronger styling, richer visual detail/);
  assert.doesNotMatch(mediumInstructions, /Design Default:|Design MAX:/);
  assert.match(maxInstructions, /Design MAX:.*selected skill owns/);
  assert.match(maxInstructions, /Choose (?:hero )?geometry[^.]*progression before (?:the )?effects/);
  assert.match(maxInstructions, /GSAP \+ ScrollTrigger \+ Lenis/);
  assert.doesNotMatch(maxInstructions, /Design Default:|Design Medium:/);
  for (const profile of ['medium', 'max']) {
    assert.match(designExecutionInstructions('Make a new website', 'Full access', profile), /selected design skill/);
    assert.ok(designExecutionInstructions('Make a new website', 'Full access', profile).length < (profile === 'max' ? 1900 : 1400));
    assert.doesNotMatch(designExecutionInstructions('Make a new website', 'Full access', profile), /serif|pill|occasion|discarded baseline|two credible alternatives/);
    assert.equal(designExecutionInstructions('Fix database authentication', 'Full access', profile), '');
  }
  assert.equal(designTask('Build a premium website'), true);
  assert.equal(designTask('Redesign this dashboard'), true);
  assert.equal(designTask('Build a website', 'Plan'), false);
  assert.equal(designTask('Research only, do not implement a website'), false);
  assert.equal(designTask('Fix database authentication'), false);
  assert.equal(designTask('Make only this website button blue'), false);
  assert.equal(designTask('Build a premium website with a discover button. Report only observed results.'), true);
});
test('balanced review returns one batch, requires fresh evidence and never claims final independent approval', async () => {
  const f = fixture(); f.design.capture(capture, {}, 'first');
  assert.match((await f.design.evaluate('first')).feedback, /targeted batch/);
  assert.equal(f.calls(), 1);
  assert.match((await f.design.evaluate('changed')).feedback, /current source/);
  f.design.capture(capture, {}, 'changed'); assert.deepEqual(await f.design.evaluate('changed'), {});
  assert.equal(f.calls(), 1); assert.equal(f.design.snapshot().status, 'reinspected');
  assert.match(f.design.summary(), /not independently regraded/); assert.equal(f.ledger.total().total_tokens, 60);
});
test('fast, off and text-only modes do not call the independent reviewer', async () => {
  for (const mode of ['fast', 'off']) { const f = fixture({ mode }); f.design.capture(capture, {}, 'same'); await f.design.evaluate('same'); assert.equal(f.calls(), 0); }
  const f = fixture({ acceptsImages: false }); assert.deepEqual(await f.design.evaluate('same'), {}); assert.equal(f.calls(), 0); assert.equal(f.design.snapshot().status, 'unavailable');
});

test('fresh Default layout review refreshes stale mobile and lower-page-only evidence without replaying actions', async () => {
  let refreshes=0; let f;
  const measured=(width,fullPage)=>({...capture.views[0],width,height:900,capture:{fullPage},metrics:{viewportWidth:width}});
  f=fixture({profile:'normal',mode:'fast',refreshCapture:async input=>{
    refreshes++;
    assert.equal(input.full_page,true); assert.equal(input.viewports,undefined);
    assert.equal(input.workflow,undefined); assert.equal(input.interactions,undefined);
    f.design.capture({...capture,views:[measured(1440,true),measured(390,true)]},input,'current');
    return {};
  }});
  await f.design.setBrief({audience:'Engineers',primary_action:'Request demo',direction:'Chosen layout',signature:'Incident strip',responsive:'Readable mobile order',storyboard:'Copy above incident strip, vertical workflow, comparison pricing and local form; same mobile reading sequence.'});
  assert.equal(f.design.captureOptions({}).full_page,true);
  assert.equal(f.design.captureOptions({full_page:false}).full_page,false);
  f.design.capture({...capture,views:[measured(390,true)]},{},'old');
  f.design.capture({...capture,views:[measured(1440,false)]},{workflow:[{action:'click',selector:'#submit'}]},'current');
  await f.design.evaluate('current');
  assert.equal(refreshes,1);
  assert.equal(f.design.snapshot().captureRequests,1);
  assert.equal(f.calls(),0);
  await f.design.evaluate('current');assert.equal(refreshes,1);
});

test('a later workflow viewport cannot replace current full-page layout evidence in review', async () => {
  const view=(width,fullPage,file)=>({...capture.views[0],width,height:900,capture:{fullPage},image:{...capture.views[0].image,file},metrics:{viewportWidth:width}});
  const f=fixture({mode:'balanced',review:async (_prompt,images)=>{
    assert.equal(images.length,3);
    assert.deepEqual(new Set(images.map(image=>image.file)),new Set(['desktop-full.jpg','mobile-full.jpg','desktop-flow.jpg']));
    return {text:JSON.stringify(approved)};
  }});
  f.design.capture({...capture,views:[view(1440,true,'desktop-full.jpg'),view(390,true,'mobile-full.jpg')]},{},'same');
  f.design.capture({...capture,views:[view(1440,false,'desktop-flow.jpg')]},{},'same');
  await f.design.evaluate('same');
  assert.equal(f.design.snapshot().status,'approved');
});
test('unknown images, contradictory grades and invalid reviewer output cannot become approval', async () => {
  assert.throws(() => parseReview({ toString: () => JSON.stringify({ ...revise, status: 'approved' }) }, ['desktop', 'mobile']));
  assert.throws(() => parseReview(JSON.stringify(revise), ['desktop']));
  const f = fixture({ review: async () => ({ text: 'not json', usage: null }) }); f.design.capture(capture, {}, 'same'); await f.design.evaluate('same');
  assert.equal(f.design.snapshot().status, 'unavailable');
});

test('fast premium review rejects bland composition once, retains feedback, and never claims an unchanged candidate was revised', async () => {
  for (const profile of ['medium', 'max']) {
    const f = fixture({ profile, mode: 'fast', brief: 'Redesign this entire website' });
    const views = capture.views.map(view => ({ ...view, motion: { frames: [
      { observations: { targets: [{ elements: [{ text: 'Start' }] }] } },
      { observations: { targets: [{ elements: [{ text: 'End' }] }] } },
    ] } }));
    f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Subject-specific concept', signature: 'Narrative', responsive: 'Adapted', storyboard: 'Purposeful sections and story.' });
    f.design.capture({ ...capture, views }, {}, 'initial');
    assert.match((await f.design.evaluate('initial')).feedback, /Mobile composition/);
    assert.equal(f.calls(), 1);
    await f.design.evaluate('initial');
    assert.equal(f.design.snapshot().status, 'needs_revision');
    f.design.capture({ ...capture, views }, {}, 'revised');
    await f.design.evaluate('revised');
    assert.equal(f.calls(), profile === 'max' ? 2 : 1);
    assert.equal(f.design.snapshot().status, profile === 'max' ? 'needs_revision' : 'reinspected');
  }
});

test('real browser performed action plus changed-state assertion passes the Medium gate', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-medium-workflow-'));
  const { previewWebsite } = require('../electron/agent/preview-website.cjs');
  const { createImageStore } = require('../electron/agent/image-store.cjs');
  const server = http.createServer((_, response) => response.end('<!doctype html><html lang="en"><title>Workflow fixture</title><main><h1>Greetings</h1><button id="choose" onclick="document.querySelector(\'#result\').textContent=\'Birthday selected\'">Choose birthday</button><p id="result">Choose an occasion</p></main></html>'));
  await listenBrowserLoopback(server);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}`, taskId: 'test', requestId: 'capture', signal: AbortSignal.timeout(30000), imageStore: createImageStore({ getPath: () => root }), workflow: [
    { action: 'click', selector: '#choose' },
    { action: 'assert', assertion: { kind: 'text', selector: '#result', expected: 'Birthday selected' } },
  ] });
  assert.ok(result.views.every(view => view.workflow.status === 'passed' && view.workflow.steps[0].status === 'performed'));
  const f = fixture({ mode: 'fast', profile: 'medium', brief: 'Make a new professional website', review: async () => ({ text: JSON.stringify(approved) }) });
  await f.design.setBrief({ audience: 'Visitors', primary_action: 'Choose occasion', direction: 'Subject-specific concept', signature: 'Selection', responsive: 'Adapted', storyboard: 'Occasion selector above the card preview; writing area below, followed by the action. Mobile retains selector, preview, writing and action order.' });
  f.design.capture(result, {}, 'source');
  assert.deepEqual(await f.design.evaluate('source'), {});
  assert.equal(f.design.snapshot().status, 'approved');
  assert.equal(f.design.snapshot().inspectionCorrectionRequests, undefined);
  const external = await previewWebsite({ url: `http://127.0.0.1:${server.address().port}`, taskId: 'test', requestId: 'external', signal: AbortSignal.timeout(30000), imageStore: createImageStore({ getPath: () => root }), workflow: [{ action: 'click', selector: '#choose' }], assertions: [{ selector: '#result', text: 'Birthday selected' }] });
  assert.ok(external.views.every(view => view.workflow.status === 'passed' && view.assertions[0].status === 'passed'));
  const g = fixture({ mode: 'fast', profile: 'medium', brief: 'Make a new professional website', review: async () => ({ text: JSON.stringify(approved) }) });
  await g.design.setBrief({ audience: 'Visitors', primary_action: 'Choose occasion', direction: 'Subject-specific concept', signature: 'Selection', responsive: 'Adapted', storyboard: 'Occasion selector above the card preview; writing area below, followed by the action. Mobile retains selector, preview, writing and action order.' });
  g.design.capture(external, {}, 'source');
  // An additional screenshot of the same source must not erase valid action evidence.
  g.design.capture(capture, {}, 'source');
  await g.design.evaluate('source');
  assert.equal(g.design.snapshot().status, 'approved');
  assert.equal(g.design.snapshot().inspectionCorrectionRequests, undefined);
});
test('originality rejection releases the weak concept and rechecks once without accepting another cosmetic revision', async () => {
  for (const finalStatus of ['approved', 'needs_revision']) {
    let calls = 0;
    const generic = { status: 'needs_revision', summary: 'Interchangeable composition.', preserve: ['Hero'], issues: [{ id: 'generic', severity: 'major', dimension: 'originality', view: 'desktop', observation: 'Same generic scaffold.', suggestion: 'Invent subject-specific composition.' }] };
    const f = fixture({ profile: 'medium', mode: 'fast', brief: 'Redesign this entire website', review: async () => ({ text: JSON.stringify(++calls === 1 || finalStatus === 'needs_revision' ? generic : approved) }) });
    f.design.capture(capture, {}, 'initial');
    const feedback = (await f.design.evaluate('initial')).feedback;
    assert.match(feedback, /Replace the rejected composition/);
    assert.doesNotMatch(feedback, /Preserve the chosen direction/);
    await f.design.evaluate('initial'); assert.equal(calls, 1);
    assert.equal(f.design.snapshot().status, 'needs_revision');
    f.design.capture(capture, {}, 'replacement');
    assert.deepEqual(await f.design.evaluate('replacement'), {});
    assert.equal(calls, 2); assert.equal(f.design.snapshot().status, finalStatus);
    assert.equal(f.design.snapshot().revisions, 1);
    if (finalStatus === 'needs_revision') {
      f.design.capture(capture, {}, 'another-cosmetic-edit');
      await f.design.evaluate('another-cosmetic-edit');
      assert.equal(calls, 2); assert.equal(f.design.snapshot().status, 'needs_revision');
    }
  }
});

test('MAX composition and depth failures receive one bounded independent recheck after an actual source change', async () => {
  for (const dimension of ['composition', 'content_depth']) for (const finalStatus of ['approved', 'needs_revision', 'unavailable']) {
    let calls = 0;
    const failure = { status: 'needs_revision', summary: 'Supporting sections are not developed.', preserve: ['Working form', 'Hero'], issues: [
      { id: 'depth', severity: 'major', dimension, view: 'desktop', observation: 'Most supporting sections repeat shallow text panels without the promised demonstrations.', suggestion: 'Develop the affected content and its visual relationships.' },
    ] };
    const final = finalStatus === 'needs_revision' ? failure : { status: finalStatus, summary: 'Final captured result.', preserve: [], issues: [] };
    const f = fixture({ profile: 'max', mode: 'fast', brief: 'Create a complete professional website', review: async () => ({ text: JSON.stringify(++calls === 1 ? failure : final) }) });
    await f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen subject', signature: 'Story', responsive: 'Readable', storyboard: 'Developed content purposes and motion.' });
    const views = capture.views.map(view => ({ ...view, motion: { frames: [
      { observations: { targets: [{ elements: [{ text: 'First state' }] }] } },
      { observations: { targets: [{ elements: [{ text: 'Changed state' }] }] } },
    ] } }));
    const snapshot = { ...capture, views };
    f.design.capture(snapshot, {}, 'initial');
    const response = await f.design.evaluate('initial');
    assert.match(response.feedback, /Develop the affected content, media and spatial relationships/);
    assert.match(response.feedback, /must not freeze the rejected arrangement/);
    assert.doesNotMatch(response.feedback, /Preserve the chosen direction/);
    await f.design.evaluate('initial'); assert.equal(calls, 1);
    f.design.capture(snapshot, {}, 'changed');
    assert.deepEqual(await f.design.evaluate('changed'), {});
    assert.equal(calls, 2); assert.equal(f.design.snapshot().status, finalStatus);
    assert.equal(f.design.snapshot().revisions, 1);
    assert.equal(f.design.snapshot().reviews.at(-1).compositionRecheck, true);
    f.design.capture(snapshot, {}, 'another-edit');
    await f.design.evaluate('another-edit');
    assert.equal(calls, 2);
    if (finalStatus !== 'approved') assert.equal(f.design.snapshot().status, finalStatus);
  }
});

test('MAX composition recheck does not expand other profiles, bounded/static work or minor preferences', async () => {
  for (const scenario of [
    { profile: 'normal', brief: 'Create a complete professional website', severity: 'major' },
    { profile: 'medium', brief: 'Create a complete professional website', severity: 'major' },
    { profile: 'max', brief: 'Create only one website section', severity: 'major' },
    { profile: 'max', brief: 'Create a static professional website', severity: 'major' },
    { profile: 'max', brief: 'Create a complete professional website', severity: 'minor' },
  ]) {
    let calls = 0;
    const result = { status: scenario.severity === 'major' ? 'needs_revision' : 'approved', summary: 'Observed finding.', preserve: [], issues: [
      { id: 'arrangement', severity: scenario.severity, dimension: 'composition', view: 'desktop', observation: 'The selected area needs attention.', suggestion: 'Adjust the affected area.' },
    ] };
    const f = fixture({ ...scenario, mode: scenario.severity === 'minor' ? 'fast' : 'balanced', review: async () => { calls++; return { text: JSON.stringify(result) }; } });
    await f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen subject', signature: 'Story', responsive: 'Readable', storyboard: 'Developed content purposes and motion.' });
    const views = capture.views.map(view => ({ ...view, workflow: { status: 'passed', steps: [{ action: 'click', status: 'performed' }, { action: 'assert', status: 'passed' }] }, motion: { frames: [
      { observations: { targets: [{ elements: [{ text: 'Start' }] }] } },
      { observations: { targets: [{ elements: [{ text: 'End' }] }] } },
    ] } }));
    f.design.capture({ ...capture, views }, {}, 'initial');
    const initial = await f.design.evaluate('initial');
    if (scenario.profile !== 'max' || /static|only one/.test(scenario.brief)) assert.doesNotMatch(initial.feedback ?? '', /changed full website receives/);
    f.design.capture({ ...capture, views }, {}, 'changed'); await f.design.evaluate('changed');
    assert.equal(calls, 1, JSON.stringify(scenario));
    assert.equal(f.design.snapshot().reviews[0].compositionRecheck, false);
  }
});

test('new premium pages default to a whole-page capture without overriding explicit section or viewport requests', () => {
  const f = fixture({ profile: 'medium', mode: 'fast' });
  assert.equal(f.design.captureOptions({ url: 'http://localhost:1' }).full_page, true);
  assert.deepEqual(f.design.captureOptions({ selector: '#form' }), { selector: '#form' });
  assert.deepEqual(f.design.captureOptions({ full_page: false }), { full_page: false });
  assert.deepEqual(fixture({ profile: 'normal', mode: 'fast' }).design.captureOptions({}), {full_page:true});
  assert.deepEqual(fixture({ profile: 'medium', mode: 'fast', brief: 'Repair this website button' }).design.captureOptions({}), {});
});

test('MAX reviewer retains current whole-page desktop/mobile overviews after several later section captures', async () => {
  let delivered;
  const f = fixture({ profile: 'max', mode: 'fast', brief: 'Create a complete professional website', review: async (prompt, images) => { delivered = { prompt, images }; return { text: JSON.stringify(approved) }; } });
  await f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen subject', signature: 'Story', responsive: 'Readable', storyboard: 'Developed content and motion.' });
  const views = capture.views.map((view, i) => ({ ...view, width: i ? 390 : 1440, height: i ? 844 : 900, metrics: { headings: [{ level: 'H2', text: 'Actual supporting purpose' }] }, capture: { fullPage: true }, image: { ...view.image, file: 'whole-' + view.label + '.jpg' } }));
  f.design.capture({ ...capture, views }, {}, 'current');
  for (const selector of ['#early', '#middle', '#contact']) f.design.capture({ ...capture, views: views.map(view => ({ ...view, capture: { fullPage: false, selector }, image: { ...view.image, file: selector + '-' + view.label + '.jpg' }, motion: { frames: [
    { observations: { targets: [{ elements: [{ text: 'Start' }] }] } },
    { observations: { targets: [{ elements: [{ text: 'End' }] }] } },
  ] } })) }, { selector }, 'current');
  await f.design.evaluate('current');
  assert.deepEqual(delivered.images.map(image => image.file), ['whole-desktop.jpg', 'whole-mobile.jpg', '#contact-desktop.jpg', '#contact-mobile.jpg']);
  assert.match(delivered.prompt, /Current DOM heading inventory/);
  assert.match(delivered.prompt, /Actual supporting purpose/);
  assert.equal(f.design.snapshot().status, 'approved');
});
test('broken images, document overflow and visible hidden controls require correction before visual approval', async () => {
  const f = fixture({ mode: 'balanced', review: async () => { throw Error('Must not review broken candidate'); } });
  const broken = { ...capture, views: capture.views.map(view => ({ ...view, metrics: { brokenImages: 2, horizontalOverflow: true, hiddenAttributeOverrides: [{tag:'NAV',id:'closed-menu',display:'flex'}] } })) };
  f.design.capture(broken, {}, 'first');
  const correction = await f.design.evaluate('first');
  assert.match(correction.feedback, /broken_images/); assert.match(correction.feedback, /horizontal_overflow/);
  assert.match(correction.feedback, /hidden_attribute_override/);
  await f.design.evaluate('first');
  assert.equal(f.design.snapshot().status, 'unavailable');
  assert.match(f.design.snapshot().reason, /image, layout/);
  assert.equal(f.design.snapshot().reviews.length, 0);
});

test('MAX combines fresh visual rejection and browser failures in the existing revision', async () => {
  for (const visualResult of [approved, { ...revise, issues: [
    ...Array.from({ length: 3 }, (_, i) => ({ ...revise.issues[0], id: 'detail-' + i })),
    { ...revise.issues[0], id: 'repeated', dimension: 'originality', observation: 'Repeated composition.' },
  ] }]) {
    let calls = 0;
    const f = fixture({ profile: 'max', mode: 'fast', brief: 'Build a complete professional website', review: async () => {
      calls++; return { text: JSON.stringify(visualResult) };
    } });
    f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen composition', signature: 'Story', responsive: 'Adapted', storyboard: 'Developed sections with changing story.' });
    const views = capture.views.map(view => ({ ...view, metrics: { horizontalOverflow: true }, motion: { frames: [
      { observations: { targets: [{ elements: [{ text: 'Start' }] }] } },
      { observations: { targets: [{ elements: [{ text: 'End' }] }] } },
    ] } }));
    f.design.capture({ ...capture, views }, {}, 'initial');
    const result = await f.design.evaluate('initial');
    assert.equal(calls, 1);
    assert.match(result.feedback, /horizontal_overflow/);
    assert.equal(f.design.snapshot().status, 'revising');
    assert.equal(f.design.snapshot().revisions, 1);
    if (visualResult !== approved) assert.match(result.feedback, /Replace the rejected composition/);
    await f.design.evaluate('initial'); assert.equal(calls, 1);
    // A fresh screenshot with the same unresolved failure cannot turn into acceptance.
    f.design.capture({ ...capture, views }, {}, 'changed');
    await f.design.evaluate('changed');
    assert.equal(f.design.snapshot().status, 'unavailable');
    assert.equal(calls, 1);
  }
});

test('MAX missing story evidence retains the technical gate before review', async () => {
  const f = fixture({ profile: 'max', mode: 'fast', brief: 'Build a complete professional website', review: async () => { throw Error('Missing motion must not reach review'); } });
  f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen composition', signature: 'Story', responsive: 'Adapted', storyboard: 'Developed sections.' });
  f.design.capture({ ...capture, views: capture.views.map(view => ({ ...view, metrics: { horizontalOverflow: true } })) }, {}, 'initial');
  assert.match((await f.design.evaluate('initial')).feedback, /actual progression/);
  assert.equal(f.design.snapshot().reviews.length, 0);
});

test('MAX combined review retains blockers and material depth ahead of optional decoration', async () => {
  const issues = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: 'minor-' + i, severity: 'minor', dimension: 'typography', view: 'desktop', observation: 'Optional spacing preference.', suggestion: 'Consider adjusting spacing.' })),
    { id: 'blocked', severity: 'blocker', dimension: 'usability', view: 'desktop', observation: 'Required control is covered.', suggestion: 'Uncover the control.' },
    { id: 'thin', severity: 'major', dimension: 'content_depth', view: 'desktop', observation: 'Supporting sections are undeveloped.', suggestion: 'Develop supporting content.' },
  ];
  const f = fixture({ profile: 'max', mode: 'fast', brief: 'Create a complete professional website', review: async () => ({ text: JSON.stringify({ status: 'needs_revision', summary: 'Material failures.', preserve: [], issues }) }) });
  await f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen subject', signature: 'Story', responsive: 'Readable', storyboard: 'Developed content and motion.' });
  f.design.capture({ ...capture, views: capture.views.map(view => ({ ...view, metrics: { horizontalOverflow: true }, motion: { frames: [
    { observations: { targets: [{ elements: [{ text: 'Start' }] }] } },
    { observations: { targets: [{ elements: [{ text: 'End' }] }] } },
  ] } })) }, {}, 'current');
  await f.design.evaluate('current');
  const retained = f.design.snapshot().reviews[0].result.issues;
  assert.equal(retained[0].id, 'blocked');
  assert.equal(retained[1].id, 'thin');
  assert.equal(retained.length, 5);
});

test('MAX final capture refresh consumes existing freshness slots and never replays actions', async () => {
  let refreshes = 0, version = 'changed';
  const f = fixture({ profile: 'max', mode: 'fast', brief: 'Build a complete professional website',
    review: async () => ({ text: JSON.stringify(approved) }), refreshCapture: async args => {
      refreshes++;
      assert.equal(args.workflow, undefined); assert.equal(args.assertions, undefined); assert.equal(args.interactions, undefined);
      assert.equal(args.viewports.length, 2);
      f.design.capture({ ...capture, views }, args, version);
      return capture;
    } });
  const views = capture.views.map(view => ({ ...view, motion: { frames: [
    { observations: { targets: [{ elements: [{ text: 'Start' }] }] } },
    { observations: { targets: [{ elements: [{ text: 'End' }] }] } },
  ] } }));
  f.design.setBrief({ audience: 'Visitors', primary_action: 'Explore', direction: 'Chosen composition', signature: 'Story', responsive: 'Adapted', storyboard: 'Developed sections.' });
  f.design.capture({ ...capture, views }, { directory: '/fixture', url: capture.url, viewports: [{width:1440,height:900},{width:390,height:844}], workflow: [{ action:'click',selector:'#submit' }], assertions:[{ selector:'#saved' }], interactions:[{action:'click',selector:'#submit'}] }, 'initial');
  assert.deepEqual(await f.design.evaluate(version), {}); assert.equal(f.design.snapshot().status, 'approved');
  version = 'changed-again'; await f.design.evaluate(version); assert.equal(refreshes, 2);
  assert.equal(f.design.snapshot().captureRequests, 2);
  await f.design.evaluate('third-edit'); assert.equal(refreshes, 2); assert.equal(f.design.snapshot().status, 'unavailable');
  for (const profile of ['normal','medium']) {
    let g;
    g = fixture({ profile, refreshCapture: async args => { assert.equal(args.workflow,undefined); g.design.capture(capture,args,'changed'); return capture; } });
    g.design.capture(capture, {}, 'initial'); await g.design.evaluate('changed');
    assert.equal(g.design.snapshot().captureRequests, 1);
  }
});

test('declining a final MAX refresh cannot trigger another preview request or visual approval', async () => {
  let refreshes = 0;
  const f = fixture({ profile:'max', brief:'Build a complete professional website', refreshCapture:async()=>{refreshes++;return {declined:true};} });
  f.design.capture(capture, {directory:'/fixture',url:capture.url}, 'initial');
  assert.deepEqual(await f.design.evaluate('changed'), {});
  assert.equal(f.design.snapshot().status,'unavailable'); assert.match(f.design.snapshot().reason,/declined/);
  await f.design.evaluate('changed'); assert.equal(refreshes,1); assert.equal(f.calls(),0);
});

test('final refresh preserves a changing sequence over a later single-frame end-state check', async () => {
  const motion={section:'#story',observe_selectors:['#state'],checkpoints:[{progress:0},{progress:.8}]};
  const views=capture.views.map((view,i)=>({...view,width:i?390:1440,height:900,capture:{fullPage:true},motion:{frames:[
    {observations:{targets:[{elements:[{text:'Start'}]}]}},
    {observations:{targets:[{elements:[{text:'End'}]}]}},
  ]}}));
  let refreshes=0;
  const f=fixture({profile:'max',mode:'fast',brief:'Build a complete professional website',review:async()=>({text:JSON.stringify(approved)}),refreshCapture:async args=>{
    refreshes++;assert.deepEqual(args.motion,motion);assert.equal(args.workflow,undefined);
    f.design.capture({...capture,views},args,'changed');return capture;
  }});
  await f.design.setBrief({audience:'Visitors',primary_action:'Explore',direction:'Chosen composition',signature:'Story',responsive:'Adapted',storyboard:'Developed sections and changing story.'});
  f.design.capture({...capture,views},{motion,full_page:true},'old');
  f.design.capture({...capture,views:views.map(view=>({...view,motion:{frames:view.motion.frames.slice(-1)}}))},
    {motion:{...motion,checkpoints:[{progress:1}]},workflow:[{action:'click',selector:'#submit'}]},'old');
  assert.deepEqual(await f.design.evaluate('changed'),{});
  assert.equal(refreshes,1);assert.equal(f.design.snapshot().captureRequests,1);
  assert.equal(f.design.snapshot().status,'approved');
  assert.equal(f.design.snapshot().inspectionCorrectionRequests,undefined);
});

test('hero refresh does not expand static, fidelity or existing repair scope', async () => {
  for (const brief of ['Build a static website hero','Create a pixel-perfect website hero','Improve the existing website hero']) {
    let refreshes=0;
    const f=fixture({profile:'max',brief,refreshCapture:async()=>{refreshes++;return {declined:true};}});
    f.design.capture(capture,{url:capture.url},'initial');
    assert.match((await f.design.evaluate('changed')).feedback,/current source/);
    assert.equal(refreshes,0);
  }
});
test('reviews cache unchanged candidates and checkpoint restoration preserves mode and revision bound', async () => {
  const f = fixture({ review: async () => ({ text: JSON.stringify(approved), usage: null }) }); f.design.capture(capture, {}, 'same'); await f.design.evaluate('same');
  await f.design.evaluate('same'); assert.equal(f.design.snapshot().reviews.length, 1);
  const restored = fixture({ saved: f.design.snapshot(), review: async () => { throw new Error('Should reuse'); } }); await restored.design.evaluate('same'); assert.equal(restored.design.snapshot().status, 'approved');
  const q = fixture({ mode: 'quality' }); for (let index = 0; index < 4; index++) { q.design.capture(capture, {}, String(index)); await q.design.evaluate(String(index)); }
  assert.equal(q.calls(), 3); assert.equal(q.design.snapshot().revisions, 3);
});

test('separate current-source viewport captures reach the reviewer together with unique labels; old-source captures do not', async () => {
  let delivered;
  const f = fixture({ review: async (prompt, images) => { delivered = { prompt, images }; return { text: JSON.stringify(approved) }; } });
  f.design.capture({ views: [{ label: 'viewport-1', width: 1440, height: 900, image: capture.views[0].image }] }, {}, 'source');
  f.design.capture({ views: [{ label: 'viewport-1', width: 390, height: 844, image: capture.views[1].image }] }, {}, 'source');
  await f.design.evaluate('source');
  assert.equal(delivered.images.length, 2);
  assert.match(delivered.prompt, /viewport-1-390x844-2/);
  f.design.capture({ views: [{ label: 'new-desktop', width: 1440, height: 900, image: capture.views[0].image }] }, {}, 'changed-source');
  await f.design.evaluate('changed-source');
  assert.equal(delivered.images.length, 1);
  assert.doesNotMatch(delivered.prompt, /viewport-1-390x844-2/);
});
test('cancellation cannot be downgraded to an unavailable review; usage aggregates stages once', async () => {
  const f = fixture({ review: async () => { f.controller.abort(); throw new Error('Stopped'); } }); f.design.capture(capture, {}, 'same'); await assert.rejects(f.design.evaluate('same'), /cancelled/);
  const ledger = createUsageLedger(); ledger.add('builder', { input_tokens: 7, output_tokens: 2, total_tokens: 9 }); ledger.add('review', null);
  const restored = createUsageLedger(ledger.snapshot()); assert.equal(restored.total().total_tokens, 9); assert.equal(restored.snapshot()[1].usage, null);
});
test('native builder-review-revision handoff delivers actual images and retains browser evidence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-design-data-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'design-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"design-fixture"}');
  const source = path.join(project, 'page.html'); fs.writeFileSync(source, '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><h1>Website</h1><p>Initial design</p></main></body></html>');
  const server = http.createServer((_, response) => response.end(fs.readFileSync(source))); await listenBrowserLoopback(server);
  let builders = 0, critics = 0, builderActive = false;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, () => {}, null, { reviewNativeSession: nativeAcceptanceReview, runNativeSession: async options => {
    if (options.readOnly) {
      assert.match(options.systemPrompt, /independent website design reviewer/);
      assert.doesNotMatch(options.systemPrompt, /frontend execution contract/);
      assert.equal(builderActive, false); critics++; assert.equal(options.visualTools, undefined); assert.equal(await options.onPermission({ permission: 'edit' }), false);
      assert.equal(options.parts.filter(part => part.type === 'file').length, 2); assert.ok(options.parts.some(part => part.url?.startsWith('data:image/jpeg;base64,')));
      return { text: JSON.stringify(revise), usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } };
    }
    builderActive = true; builders++;
    assert.match(options.systemPrompt, /frontend execution contract/);
    assert.match(options.parts[0].text, /Task settings: \{"designProfile":"medium"/);
    assert.match(options.parts[0].text, /Before substantial work, choose and read matching skills/);
    if (builders === 2) { assert.match(options.parts[0].text, /Mobile composition/); fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('Initial design', 'Revised design')); }
    const bridge = await options.visualTools({ acceptsImages: true, signal: options.signal });
    try {
      const result = await (await fetch(bridge.config.url, { method: 'POST', headers: { ...bridge.config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'preview_website', arguments: { directory: project, url: `http://127.0.0.1:${server.address().port}` } } }) })).json();
      assert.equal(result.result.isError, undefined); assert.equal(result.result.content.filter(part => part.type === 'image').length, 2);
    } finally { await bridge.close(); builderActive = false; }
    return { text: 'The website candidate is ready.', usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } };
  } });
  t.after(async () => { engine.shutdown(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(project), __dirname); fs.rmSync(project, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  await engine.workspaces.open('design', project, async () => true);
  // The fake native builder bypasses real edit permission events, which normally
  // register source tracking. Establish that baseline explicitly in this fixture.
  await engine.changes.register('design', project);
  const result = await engine.run({ taskId: 'design', requestId: 'turn', modelId: 'opencode/mimo-v2.6-flash-free', designProfile: 'medium', designReviewMode: 'balanced', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Redesign this website with a distinct identity' }] });
  assert.equal(builders, 2); assert.equal(critics, 1); assert.equal(result.usage.total_tokens, 105);
  assert.equal(result.verification.designReview.status, 'reinspected'); assert.equal(result.verification.designReview.snapshots.length, 2);
  assert.equal(engine.taskMemory.read('design').designReview.status, 'reinspected');
  assert.match(fs.readFileSync(source, 'utf8'), /Revised design/);
});
test('native read-only review selects coding-analysis instructions and keeps mandatory denial gates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-review-permission-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/fixture', name: 'Fixture', route: 'chat', input: ['text'], variants: [] }] }));
  const runtime = { status: () => ({}), async exclusive(signal, callback) { return callback({ workdir: root, async api(endpoint, options) {
    if (endpoint === '/session') { assert.equal(options.body.permission[0].action, 'ask'); return { id: 'review-fixture' }; }
    if (endpoint.endsWith('/message')) { assert.equal(options.body.agent, 'orvix_review'); return { info: {}, parts: [{ type: 'text', text: JSON.stringify(approved) }] }; }
    return true;
  }, async events() { return { body: new ReadableStream({ start() {} }) }; } }); } };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  assert.match((await runOpenCodeSession({ modelId: 'opencode/fixture', parts: [], readOnly: true, analysis:true })).text, /approved/);
  await assert.rejects(runOpenCodeSession({ modelId: 'opencode/fixture', parts: [], readOnly: true, visualTools() {} }), /cannot attach/);
});

for (const standalone of [false,true]) test('native MAX refreshes edits after the last preview: ' + (standalone ? 'standalone hero without another builder or critic pass' : 'full website before bounded originality review'), { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-max-final-capture-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'design-max-final-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"max-final-fixture"}');
  const source = path.join(project, 'index.html');
  const html = title => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;color:#111;background:#fff}header,footer{min-height:100vh;padding:30px}#story{height:300vh}#state{position:sticky;top:0;background:#fff;padding:30px}</style></head><body><header><h1>${title}</h1></header><section id="story"><h2 id="state">Start</h2></section><footer>After story</footer><script>addEventListener('scroll',()=>document.getElementById('state').textContent=scrollY>innerHeight*1.5?'End':'Start')</script></body></html>`;
  fs.writeFileSync(source, html('Old source'));
  const server = http.createServer((_, response) => response.end(fs.readFileSync(source)));
  await listenBrowserLoopback(server);
  let builders = 0, critics = 0;
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => '' }, () => {}, null, { reviewNativeSession: nativeAcceptanceReview, runNativeSession: async options => {
    if (options.readOnly) {
      critics++;
      const labels = JSON.parse(/captured labels: (\[[^\n]*?\])\./.exec(options.parts[0].text)[1]);
      const result = critics === 1 ? { ...revise, issues:[{ ...revise.issues[0], view:labels[0], dimension:'originality' }] } : approved;
      return { text:JSON.stringify(result) };
    }
    builders++;
    if (builders === 1) {
      const bridge = await options.visualTools({ acceptsImages:true, signal:options.signal });
      const call = async (name, args) => {
        const result = await (await fetch(bridge.config.url, { method:'POST', headers:{...bridge.config.headers,'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:name,method:'tools/call',params:{name,arguments:args}}) })).json();
        assert.equal(result.result.isError, undefined);
      };
      try {
        await call('set_design_brief',{audience:'Visitors',primary_action:'Explore',direction:'Subject composition',signature:'Story',responsive:'Adapted',storyboard:'Developed sections with changing states.'});
        await call('preview_website',{directory:project,url:`http://127.0.0.1:${server.address().port}`,viewports:[{width:1440,height:900},{width:390,height:844}],motion:{section:'#story',observe_selectors:['#state'],settle_ms:100,checkpoints:[{progress:0},{progress:0.8}]}});
      } finally { await bridge.close(); }
      // Reproduce the live failure: a builder ends immediately after source edits.
      fs.writeFileSync(source, html('Updated current source'));
    } else {
      assert.match(options.parts[0].text,/Replace the rejected composition/);
      fs.writeFileSync(source, html('Replacement current source'));
    }
    return { text:'Edited candidate; no final model-driven capture.' };
  } });
  t.after(async () => { engine.shutdown(); await new Promise(resolve => server.close(resolve)); fs.rmSync(project,{recursive:true,force:true}); fs.rmSync(root,{recursive:true,force:true}); });
  await engine.workspaces.open('max-final',project,async()=>true); await engine.changes.register('max-final',project);
  const result = await engine.run({taskId:'max-final',requestId:'turn',modelId:'opencode/mimo-v2.6-flash-free',designProfile:'max',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:standalone ? 'Build only one premium website hero section, not a full website' : 'Build a complete professional website with a changing story'}]});
  if (standalone) {
    assert.equal(builders,1); assert.equal(critics,0);
    assert.equal(result.verification.designReview.status,'self_inspected');
    assert.equal(result.verification.designReview.captureRequests,1);
    assert.equal(result.verification.designReview.revisions,0);
    assert.equal(result.verification.designReview.snapshots.length,2);
    assert.equal(result.verification.designReview.snapshots[1].views[0].metrics.title,'Updated current source');
    return;
  }
  assert.equal(builders,2, JSON.stringify({ critics, status:result.verification.designReview.status, reason:result.verification.designReview.reason, reviews:result.verification.designReview.reviews.map(item=>item.result.summary) })); assert.equal(critics,2);
  assert.equal(result.verification.designReview.status,'approved');
  assert.equal(result.verification.designReview.captureRequests,2);
  assert.equal(result.verification.designReview.revisions,1);
  assert.equal(result.verification.designReview.snapshots.length,3);
  assert.equal(result.verification.designReview.snapshots[1].views[0].metrics.title,'Updated current source');
  assert.equal(result.verification.designReview.snapshots.at(-1).views[0].metrics.title,'Replacement current source');
  assert.deepEqual(result.verification.designReview.reviews.map(item=>item.fingerprint),result.verification.designReview.snapshots.slice(1).map(item=>item.fingerprint));
});

test('native reviewer rejects a real permission event even when the caller would allow it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-review-denial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'opencode-free-catalog.json'), JSON.stringify({ updatedAt: Date.now(), models: [{ id: 'opencode/fixture', name: 'Fixture', route: 'chat', input: ['text'], variants: [] }] }));
  let rejected = false, callerAsked = false, release;
  const permissionReply = new Promise(resolve => { release = resolve; });
  const runtime = { status: () => ({}), async exclusive(signal, callback) { return callback({ workdir: root,
    async api(endpoint, options) {
      if (endpoint === '/session') return { id: 'review-denial' };
      if (endpoint === '/permission/blocked-tool/reply') { assert.equal(options.body.reply, 'reject'); rejected = true; release(); return true; }
      if (endpoint.endsWith('/message')) { await permissionReply; return { info: {}, parts: [{ type: 'text', text: JSON.stringify(approved) }] }; }
      return true;
    }, async events() { return { body: new ReadableStream({ start(stream) {
      stream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'permission.asked', properties: { id: 'blocked-tool', sessionID: 'review-denial', permission: 'bash' } }) + '\n\n'));
    } }) }; }
  }); } };
  configureOpenCodeCatalog(root, runtime); configureOpenCodeModel(runtime);
  await assert.rejects(runOpenCodeSession({ modelId: 'opencode/fixture', parts: [], readOnly: true, onPermission: async () => { callerAsked = true; return true; } }), /action was blocked/);
  assert.equal(rejected, true); assert.equal(callerAsked, false);
});

test('direct route returns independent feedback into its existing loop and records fresh image evidence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-direct-design-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'design-direct-fixture-'));
  const file = path.join(project, 'index.html');
  const initial = '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><h1>Website</h1><p>Initial design</p></main></body></html>';
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"design-direct-fixture"}'); fs.writeFileSync(file, initial);
  const server = http.createServer((_, response) => response.end(fs.readFileSync(file))); await listenBrowserLoopback(server);
  let step = 0, critics = 0;
  const preview = ['preview_website', { directory: project, url: `http://127.0.0.1:${server.address().port}` }];
  const sequence = [['open_workspace', { directory: project }], preview, null, ['write_file', { file, content: initial.replace('Initial design', 'Revised design'), expected_original: initial }], preview, null];
  const engine = createAgentEngine({ getPath: () => root }, { getKey: () => 'fixture-key' }, () => {}, null, {
    reviewModel: async ({ purpose, history }) => {
      const prompt = history.at(-1).content;
      let value = { status: 'approved', reason: 'Fixture planning review.' };
      if (purpose === 'request_understanding') value = { goal: 'Website redesign', expectedBehavior: 'Distinct responsive website', feature: 'website', trigger: '', assumptions: [], examples: [], questions: [], exclusions: [] };
      if (purpose === 'execution_requirements') value = { requirements: [{ text: 'Apply the requested website redesign to the selected project.', verification_types: ['focused', 'user_flow'] }] };
      if (purpose === 'acceptance_planning') { const requirements = JSON.parse(/Requirements:\n([^\n]+)\nObserved project sources/.exec(prompt)[1]); value = { status: 'approved', criteria: requirements.map(item => ({ id: 'accept-' + item.id, requirementId: item.id, description: item.text, observable: 'Actual requested state observed', negativeCase: 'Invalid state rejected', method: 'command' })), missingRequirements: [], reason: 'Fixture criteria.' }; }
      return { text: JSON.stringify(value), calls: [], usage: { total_tokens: 3 } };
    },
    designReviewModel: async ({ history, tools, readImage }) => {
      critics++; assert.deepEqual(tools, []);
      const images = history.at(-1).content.filter(part => part.type === 'orvix_image_ref');
      assert.equal(images.length, 2); assert.ok(readImage(images[0]).length > 100);
      return { text: JSON.stringify(revise), calls: [], usage: { total_tokens: 25 } };
    },
    requestModel: async ({ history, designProfile }) => {
      assert.equal(designProfile, "medium");
      const item = sequence[step++];
      if (step === 4) assert.ok(JSON.stringify(history).includes('Mobile composition needs work'));
      if (!item) return { text: 'Website candidate prepared.', calls: [], route: 'chat', raw: { content: 'Website candidate prepared.' }, usage: { total_tokens: 10 } };
      const [name, args] = item, id = 'design-call-' + step;
      return { text: '', calls: [{ id, name, args }], route: 'chat', raw: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, usage: { total_tokens: 10 } };
    }
  });
  t.after(async () => { engine.shutdown(); await new Promise(resolve => server.close(resolve)); fs.rmSync(project, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await engine.run({ taskId: 'direct-design', requestId: 'turn', modelId: 'opencode-go/deepseek-v4-flash-vision-exp', designProfile: 'medium', designReviewMode: 'balanced', accessMode: 'Full access', accessModeVersion: 2, messages: [{ role: 'user', content: 'Redesign this website with a distinct identity' }] });
  assert.equal(critics, 1); assert.equal(result.verification.designReview.status, 'reinspected');
  assert.equal(result.verification.designReview.snapshots.length, 2); assert.match(fs.readFileSync(file, 'utf8'), /Revised design/);
  assert.ok(result.verification.usageStages.some(stage => stage.stage === 'completion_review'));
  assert.equal(engine.taskMemory.read('direct-design').designReview.status, 'reinspected');
  assert.deepEqual(engine.taskMemory.read('direct-design').usageStages, result.verification.usageStages);
  assert.equal(result.usage.total_tokens, result.verification.usageStages.reduce((sum, stage) => sum + (stage.usage?.total_tokens ?? 0), 0));
});
