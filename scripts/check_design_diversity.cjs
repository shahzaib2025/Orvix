const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createDesignDiversity, freshWebsite, recentDesignsFor, setupCommand, compositionEvidenceInstructions } = require('../electron/agent/design-diversity.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { createDesignReview } = require('../electron/agent/design-review.cjs');
const old = { direction: 'Split hero with serif text left and tilted card photos right', storyboard: 'Hero then occasions then dark card story then composer' };
const proposed = { audience: 'Card shoppers', primary_action: 'Write', direction: 'Editorial type beside overlapping paper photographs', signature: 'Pinned message scene', responsive: 'Stacked', storyboard: 'Opening then occasions then dark writing scene then editor' };
const prior = [{ taskId: 'earlier', brief: old }];
const repeated = { status: 'repeated', matchedTaskId: 'earlier', similarities: [{ dimension: 'hero_structure', observation: 'Same left text/right layered card media' }, { dimension: 'page_structure', observation: 'Same occasion/story/composer progression' }], summary: 'Repeated expressive composition' };
const signal = () => new AbortController().signal;
// Keep the independent execution-planning lane separate from layout verdict fixtures.
async function executionReviewFixture({purpose,prompt}) {
  if(purpose==='execution_requirements')return JSON.stringify({requirements:[{text:'Create the requested website',verification_types:['layout']}]});
  if(purpose.startsWith('acceptance_planning')){
    const requirements=JSON.parse(prompt.split('Requirements:\n')[1].split('\nObserved project sources')[0]);
    return JSON.stringify({status:'approved',missingRequirements:[],reason:'Fixture plan only; no completed outcome is implied',criteria:requirements.map((r,i)=>({id:'criterion-'+i,requirementId:r.id,description:r.text,observable:'Inspect the resulting website',negativeCase:'Missing website is unverified',method:'observation'}))});
  }
  return JSON.stringify({status:'reviewed',coveredIds:[],unsupportedClaims:[],reason:'No outcome evidence claimed',replyEvidence:[],researchEvidence:[]});
}

test('no history is reported as unexamined rather than distinct', async () => {
  const guard = createDesignDiversity({ signal: signal(), compare: async () => assert.fail('No comparison without history') });
  const result = await guard.check(proposed);
  assert.equal(result.status, 'unavailable'); assert.equal(result.compared, 0); assert.equal(guard.allowed(), true);
});

test('fresh Default and Medium require a layout before construction even without history or visual review', async () => {
  for (const profile of ['normal', 'medium']) for (const mode of ['fast', 'off']) {
    const design = createDesignReview({ enabled:true, brief:'Create a static new website', profile, mode,
      signal:signal(), evidence:{record:()=>({id:'layout'})}, emit:()=>{}, review:async()=>assert.fail('No extra model call without history') });
    assert.equal(design.constructionAllowed(),false);
    assert.throws(()=>design.assertConstruction('write_file',{file:'index.html'}),{code:'ERR_DESIGN_DIRECTION_REQUIRED'});
    assert.doesNotThrow(()=>design.assertConstruction('read_file',{file:'index.html'}));
    await assert.rejects(design.setBrief({...proposed,storyboard:undefined}),/storyboard/);
    assert.equal(design.snapshot().brief,undefined);
    const result=await design.setBrief(proposed);
    assert.equal(result.construction_allowed,true);
    assert.equal(design.constructionAllowed(),true);
    assert.doesNotThrow(()=>design.assertConstruction('write_file',{file:'index.html'}));
    const restored=createDesignReview({enabled:true,brief:'Create a static new website',profile,mode,saved:design.snapshot(),signal:signal(),evidence:{record:()=>({})},emit:()=>{}});
    assert.equal(restored.constructionAllowed(),true);
    const legacy=createDesignReview({enabled:true,brief:'Create a static new website',profile,mode,saved:{...design.snapshot(),brief:{...proposed,storyboard:undefined}},signal:signal(),evidence:{record:()=>({})},emit:()=>{}});
    assert.equal(legacy.constructionAllowed(),false);
  }
  for(const brief of ['Make a pixel-perfect website recreation','Create only one website section','Fix this website']){
    const design=createDesignReview({enabled:true,brief,profile:'medium',mode:'fast',priorDesigns:prior,signal:signal(),evidence:{record:()=>({})},emit:()=>{}});
    assert.equal(design.constructionAllowed(),true);
  }
});

test('composition comparison and screenshot review have separate system contracts on the direct route', () => {
  const { instructionsFor } = require('../electron/agent/model-client.cjs');
  assert.match(instructionsFor(null,'Plan','design_originality'),/status:"distinct"\|"repeated"\|"unavailable"/);
  assert.doesNotMatch(instructionsFor(null,'Plan','design_originality'),/status:"approved"/);
  assert.match(instructionsFor(null,'Plan','design_review'),/status:"approved"\|"needs_revision"\|"unavailable"/);
});

for (const scope of ['website', 'standalone hero']) test(`direct ${scope} tools cannot construct a pending or repeated composition`, async t => {
  const { createTools } = require('../electron/agent/tools.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-direction-direct-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let resolveComparison;
  const design = createDesignReview({ enabled:true, brief:'Create a complete new '+scope, profile:'max', mode:'off', priorDesigns:prior,
    signal:signal(), taskId:'direct', requestId:'r', evidence:{record:()=>({id:'proof'})}, emit:()=>{},
    review: async () => new Promise(resolve => { resolveComparison = resolve; }) });
  const changes = { markFile:()=>{}, markDirectory:()=>{}, list:()=>[] };
  const tools = createTools(changes, {assert:(_,file)=>file,list:()=>[root]}, {}, 'direct', signal(), async()=>assert.fail('Direction constraint must precede approval'), async()=>true, ()=>{}, null,null,null,null,null,'Full access',
    { assertDesignConstruction:(name,input)=>design.assertConstruction(name,input) });
  const file = path.join(root,'index.html');
  const denied = async () => {
    await assert.rejects(tools.call('write_file',{file,content:'<h1>Repeated</h1>'}), {code:'ERR_DESIGN_DIRECTION_REQUIRED'});
    await assert.rejects(tools.call('run_command',{directory:root,command:'node generate.js'}), {code:'ERR_DESIGN_DIRECTION_REQUIRED'});
    assert.equal(fs.existsSync(file),false);
  };
  await denied();
  const pending = design.setBrief(proposed);
  await new Promise(resolve=>setImmediate(resolve));
  await denied();
  resolveComparison({text:JSON.stringify(repeated)}); await pending; await denied();
  const changed = design.setBrief({...proposed,direction:'A different spatial narrative'});
  await new Promise(resolve=>setImmediate(resolve)); await denied();
  resolveComparison({text:JSON.stringify({status:'distinct',summary:'Different composition'})}); await changed;
  await tools.call('write_file',{file,content:'<h1>Distinct</h1>'});
  assert.equal(fs.readFileSync(file,'utf8'),'<h1>Distinct</h1>');
});

test('repair and faithful recreation instructions do not hold source writes even with prior notes', () => {
  for (const brief of ['Fix this website', 'Recreate the same design of this website', 'Make only one section of a website']) {
    const design = createDesignReview({enabled:true,brief,profile:'max',mode:'fast',priorDesigns:prior,signal:signal(),evidence:{record:()=>({})},emit:()=>{}});
    assert.equal(design.constructionAllowed(),true);
    assert.doesNotThrow(()=>design.assertConstruction('write_file',{}));
  }
});

test('identical and paraphrased repeated directions hold construction with cached comparisons', async () => {
  let calls = 0;
  const guard = createDesignDiversity({ prior, signal: signal(), compare: async () => { calls++; return { text: JSON.stringify(repeated) }; } });
  assert.equal(guard.allowed(), false);
  assert.equal((await guard.check(old)).status, 'repeated');
  assert.equal(calls, 0);
  assert.equal((await guard.check(proposed)).status, 'repeated');
  assert.equal((await guard.check(proposed)).status, 'repeated');
  assert.equal(calls, 1); assert.equal(guard.allowed(), false);
});

test('different composition can retain the same white theme but changing to repetition holds construction', async () => {
  let calls = 0;
  const guard = createDesignDiversity({ prior, signal: signal(), compare: async prompt => {
    calls++; assert.match(prompt, /Shared business subject, white theme/);
    return { text: JSON.stringify(calls === 1 ? { status: 'distinct', summary: 'Different visual communication', matchedTaskId: null, similarities: [] } : repeated) };
  } });
  await guard.check(proposed); assert.equal(guard.allowed(), true);
  await guard.check(proposed); assert.equal(calls, 1);
  assert.equal((await guard.check({ ...proposed, direction: 'Changed candidate' })).status, 'repeated');
  assert.equal(guard.allowed(), false);
});

test('missing comparison, weak evidence, invalid JSON and provider errors are reported without blocking construction', async () => {
  for (const reply of ['not-json', JSON.stringify({ ...repeated, similarities: [{ dimension: 'visual_treatment', observation: 'Both white' }] }), JSON.stringify({status:'unavailable',summary:'No evidence'})]) {
    const guard = createDesignDiversity({ prior, signal: signal(), compare: async () => ({ text: reply }) });
    assert.equal((await guard.check(proposed)).status, 'unavailable'); assert.equal(guard.allowed(), true);
  }
  const guard = createDesignDiversity({ prior, signal: signal(), compare: async () => { throw Error('Provider offline'); } });
  assert.match((await guard.check(proposed)).summary, /Provider offline/); assert.equal(guard.allowed(), true);
});

test('an evidenced repeated expressive hero holds construction even with different supporting sections', async () => {
  const guard = createDesignDiversity({ prior, signal:signal(), compare:async prompt => {
    assert.match(prompt,/expressive hero alone is sufficient/);
    assert.match(prompt,/both centered/);
    return {text:JSON.stringify({...repeated,similarities:repeated.similarities.slice(0,1)})};
  }});
  assert.equal((await guard.check(proposed)).status,'repeated');
  assert.equal(guard.allowed(),false);
});

test('failed and cached unavailable comparisons never clear a confirmed rejection, including after resume', async () => {
  let calls=0;
  const compare=async()=>{calls++; if(calls===3)return {text:JSON.stringify(repeated)}; throw Error('Provider offline');};
  const guard=createDesignDiversity({prior,signal:signal(),compare});
  const unknown={...proposed,direction:'Initial unverified layout'};
  await guard.check(unknown); assert.equal(guard.allowed(),true);
  await guard.check(proposed); assert.equal(guard.allowed(),false);
  await guard.check(unknown); assert.equal(calls,3); assert.equal(guard.allowed(),false);
  const changed={...proposed,direction:'Paraphrased candidate'};
  assert.equal((await guard.check(changed)).status,'unavailable');assert.equal(guard.allowed(),false);
  assert.match(guard.feedback(),/failed or unavailable comparison cannot clear/);
  for(const version of [2,3]){
    const saved={...guard.snapshot(),version};if(version===2)delete saved.rejection;
    const resumed=createDesignDiversity({prior,saved,signal:signal(),compare:async()=>assert.fail('No calls after exhausted budget')});
    assert.equal(resumed.allowed(),false);
    await resumed.check({...changed,direction:'Another wording'});assert.equal(resumed.allowed(),false);
    assert.match(resumed.feedback(),/stop construction/);
  }
});

test('only a confirmed distinct candidate clears a rejection; cached rejected proposals stay rejected', async () => {
  let calls=0;
  const guard=createDesignDiversity({prior,signal:signal(),compare:async()=>({text:JSON.stringify(++calls===1?repeated:{status:'distinct',summary:'Different spatial relationships'})})});
  await guard.check(proposed);assert.equal(guard.allowed(),false);
  const changed={...proposed,direction:'New spatial composition'};
  await guard.check(changed);assert.equal(guard.allowed(),true);
  const resumed=createDesignDiversity({prior,saved:guard.snapshot(),signal:signal(),compare:async()=>assert.fail('Use cached verdicts')});
  assert.equal(resumed.allowed(),true);
  await resumed.check(proposed);assert.equal(resumed.allowed(),false);
  await resumed.check(changed);assert.equal(resumed.allowed(),true);
});

test('a changing or empty recent-design list cannot erase an unresolved rejection or reset its budget', async () => {
  const guard=createDesignDiversity({prior:[{...prior[0],image:{file:'private-image'}}],signal:signal(),compare:async()=>({text:JSON.stringify(repeated)})});
  await guard.check(proposed);
  const saved=guard.snapshot();assert.doesNotMatch(JSON.stringify(saved),/private-image/);
  for(const history of [[],[...prior,{taskId:'another',brief:{direction:'Other',storyboard:'New content'}}]]){
    let calls=0;
    const restored=createDesignDiversity({prior:history,saved,signal:signal(),compare:async prompt=>{
      calls++;assert.match(prompt,/Unresolved rejection/);assert.match(prompt,/Same left text\/right layered card media/);
      if(calls<=2)throw Error('Provider offline');
      return {text:JSON.stringify({status:'distinct',summary:'Changed rejected spatial relationships'})};
    }});
    assert.equal(restored.allowed(),false);
    await restored.check({...proposed,direction:'Paraphrase'});assert.equal(restored.allowed(),false);
    assert.equal(restored.snapshot().attempts,2);
    await restored.check({...proposed,direction:'Independently chosen new composition'});assert.equal(restored.allowed(),true);
    assert.equal(restored.snapshot().attempts,3);
  }
});

test('approval belongs to its candidate; a later unavailable proposal cannot bypass known rejected patterns', async () => {
  let calls=0;
  const guard=createDesignDiversity({prior,signal:signal(),compare:async()=>{
    calls++;if(calls===1)return {text:JSON.stringify(repeated)};
    if(calls===2)return {text:JSON.stringify({status:'distinct',summary:'Different spatial relationships'})};
    throw Error('Provider offline');
  }});
  await guard.check(proposed);
  await guard.check({...proposed,direction:'Distinct geometry'});
  await guard.check({...proposed,direction:'Another candidate'});
  assert.equal(guard.allowed(),false);assert.equal(guard.snapshot().rejection,null);
  assert.match(guard.feedback(),/Approval of another candidate does not approve this one/);
  const restored=createDesignDiversity({prior,saved:guard.snapshot(),signal:signal(),compare:async()=>assert.fail('No extra comparison')});
  assert.equal(restored.allowed(),false);
  await restored.check({...proposed,direction:'Budget exhausted candidate'});assert.equal(restored.allowed(),false);
  await restored.check({...proposed,direction:'Distinct geometry'});assert.equal(restored.allowed(),true);
  await restored.check({...proposed,direction:'Another candidate'});assert.equal(restored.allowed(),false);
  await guard.check({...proposed,direction:'Distinct geometry'});assert.equal(guard.allowed(),true);
  await guard.check({...proposed,direction:'Another candidate'});assert.equal(guard.allowed(),false);
});

test('brief tool reports an unresolved hold honestly after comparison failure', async () => {
  let calls=0;
  const design=createDesignReview({enabled:true,brief:'Create a new website',profile:'normal',mode:'fast',priorDesigns:prior,
    signal:signal(),evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async()=>{
      if(++calls===1)return {text:JSON.stringify(repeated)};throw Error('Provider offline');
    }});
  await design.setBrief(proposed);
  const result=await design.setBrief({...proposed,direction:'Changed words'});
  assert.equal(result.originality.status,'unavailable');assert.equal(result.construction_allowed,false);
  assert.match(result.next_action,/confirmed repetition has not been resolved/);
  assert.doesNotMatch(result.next_action,/continue with an independently/);
  assert.throws(()=>design.assertConstruction('write_file',{}),{code:'ERR_DESIGN_DIRECTION_REQUIRED'});
});

test('persisted rejections do not block repairs, faithful copies, None or explicit comparison opt-outs', async () => {
  const options={enabled:true,brief:'Create a new website',profile:'max',mode:'fast',priorDesigns:prior,
    signal:signal(),evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async()=>({text:JSON.stringify(repeated)})};
  const design=createDesignReview(options);await design.setBrief(proposed);
  assert.equal(design.constructionAllowed(),false);
  for(const override of [{brief:'Fix this website'},{brief:'Recreate the same design of this website'},
    {brief:'Create a new website; do not compare with previous designs'},{brief:'Create a new website; do not use prior designs'},
    {profile:'none'}]){
    const restored=createDesignReview({...options,saved:design.snapshot(),...override,review:async()=>assert.fail('No comparison for excluded work')});
    assert.equal(restored.constructionAllowed(),true,JSON.stringify(override));
    assert.doesNotThrow(()=>restored.assertConstruction('write_file',{}));
  }
});

test('turning visual review off preserves a confirmed repetition hold',async()=>{
  for(const profile of ['normal','medium','max']) {
    let calls=0;
    const options={enabled:true,brief:'Create a new website hero',profile,mode:'off',priorDesigns:prior,
      signal:signal(),evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async()=>{calls++;return{text:JSON.stringify(repeated)};}};
    const design=createDesignReview(options);
    assert.equal(design.constructionAllowed(),false);
    await design.setBrief(proposed);
    assert.equal(calls,1);
    assert.equal(design.constructionAllowed(),false);
    assert.throws(()=>design.assertConstruction('write_file',{}),/repetition|rejected|paused/i);
    const restored=createDesignReview({...options,saved:design.snapshot(),review:async()=>assert.fail('Reuse recorded rejection')});
    assert.equal(restored.constructionAllowed(),false);
    assert.deepEqual(await restored.evaluate('source'),{});
    assert.equal(restored.snapshot().status,'not_needed');
    assert.equal(restored.snapshot().reviews.length,0);
  }
});

test('review-off previews retain fresh observed geometry for shared comparison without screenshot review',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-off-history-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createTaskMemoryStore({getPath:()=>root});
  const composition={version:1,hero:{relationship:'text-left-media-right',media:'image',text:{x:.1,y:.2,width:.4,height:.3},focal:{x:.6,y:.2,width:.3,height:.5}},sections:[]};
  const options={enabled:true,brief:'Create a new website hero',profile:'normal',mode:'off',signal:signal(),evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async()=>assert.fail('No visual critic or comparison without history')};
  const design=createDesignReview(options);await design.setBrief(proposed);
  design.capture({views:[{width:1440,metrics:{composition}}]},{},'current');
  design.capture({views:[{width:390,metrics:{composition}}]},{},'current');
  const state=design.snapshot();assert.equal(state.observedComposition.views.length,2);assert.equal(state.sourceFingerprint,'current');assert.equal(state.snapshots.length,0);assert.equal(state.reviews.length,0);assert.equal(state.status,'not_needed');
  store.write('earlier',{status:'completed',changedFiles:['index.html'],designReview:state});
  const recent=store.recentDesigns('next');assert.equal(recent[0].observedComposition.views.length,2);
  assert.doesNotMatch(JSON.stringify(recent),/screenshot|private-image|sourceFingerprint/);
  store.write('earlier',{status:'stopped',changedFiles:['index.html'],designReview:design.snapshot(()=> 'edited-after-preview')});
  assert.deepEqual(store.recentDesigns('next'),[],'Interrupted work with an edit after preview must not export stale observed geometry');
  design.capture({views:[{width:390,metrics:{composition}}]},{},'changed');assert.equal(design.snapshot().observedComposition.views.length,1);
  for(const override of [{profile:'none'},{brief:'Fix this existing website'},{brief:'Recreate the same design of this website'},{brief:'Create a new website; do not compare with previous designs'}]){
    const exempt=createDesignReview({...options,...override});exempt.capture({views:[{width:1440,metrics:{composition}}]},{},'source');assert.equal(exempt.snapshot().observedComposition,undefined);
  }
});

test('comparison attempts are bounded and cancellation propagates', async () => {
  let calls = 0;
  const guard = createDesignDiversity({ prior, signal: signal(), compare: async () => { calls++; return { text: JSON.stringify(repeated) }; } });
  for (let i = 0; i < 4; i++) assert.equal((await guard.check({ ...proposed, direction: 'Candidate ' + i })).status, i < 3 ? 'repeated' : 'unavailable');
  assert.equal(calls, 3);
  assert.equal(guard.allowed(),false);
  assert.equal((await guard.check({ ...proposed, direction: 'Candidate 0' })).status, 'repeated');
  assert.equal(guard.allowed(), false);
  const resumed = createDesignDiversity({ prior, saved: guard.snapshot(), signal: signal(), compare: async () => assert.fail('Cached rejection must not call the provider') });
  assert.equal(resumed.allowed(), false);
  assert.equal((await resumed.check({ ...proposed, direction: 'Candidate 0' })).status, 'repeated');
  assert.equal(resumed.allowed(), false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createDesignDiversity({ prior, signal: controller.signal, compare: async () => assert.fail('No cancelled call') }).check(proposed));
});

test('fresh website gate excludes repairs, fidelity, apps and section work across profiles', () => {
  assert.equal(freshWebsite('Create a new website. Do not copy a familiar layout.'), true);
  assert.equal(freshWebsite('Create a new website. Do not copy the previous website or same design.'), true);
  assert.equal(freshWebsite('Create a complete professional website. Inspect the finished result with the existing preview tools.'), true);
  for (const text of ['Fix this website', 'Build an existing website feature', 'Make a website replica', 'Create just one section of a website', 'Make a dashboard website', 'Continue the website', 'Redesign a website']) assert.equal(freshWebsite(text), false, text);
  assert.equal(setupCommand('Test-Path "C:/Desktop/site"; New-Item -ItemType Directory -Path "C:/Desktop/site" | Select-Object FullName'), true);
  for (const text of ['Set-Content index.html hello', 'node generate.js', 'Test-Path x | Set-Content page.html', 'mkdir x > page.html', 'Get-Item x | Select-Object @{Expression={Set-Content page.html hello}}']) assert.equal(setupCommand(text), false);
});

test('new standalone heroes use the composition guard without admitting repairs, assets or other bounded sections', () => {
  const {designTask,designExecutionInstructions}=require('../electron/agent/design-review.cjs');
  for (const request of [
    'Create a new standalone hero section for Signaldesk.',
    'Create only one finished premium hero section for Signaldesk.',
    'Make a single hero for a new brand.',
    'Design a website hero section.',
    'Build an animated SVG-based hero section.',
    'Create a new hero component.',
  ]) assert.equal(freshWebsite(request),true,request);
  for (const request of [
    'Fix this hero.', 'Redesign the existing hero.', 'Create an existing hero feature.',
    'Create a hero for the existing homepage.', 'Create a hero. Leave the rest unchanged.',
    'Create hero animations.', 'Create an image for the hero.', 'Create a logo inside the hero.',
    'Create a logo for a website.', 'Create an image for the website hero.',
    'Create hero animations for a website.', 'Create a hero for my fantasy novel.',
    'Create a Hero model for the database.', 'Build a Hero class in a frontend package.',
    'Create only one footer section of a website.', 'Create just one component of a website.',
    'Recreate this hero faithfully.', 'Make a pixel-perfect hero replica.',
    'Explain how this hero works.', 'Research premium hero examples.',
  ]) assert.equal(freshWebsite(request),false,request);
  for (const request of ['Create a new standalone hero.', 'Design a website hero section.', 'Build a standalone website hero.', 'Create a premium hero for a new website.', 'Create a new hero component.']) {
    assert.equal(designTask(request),true,request);
    const instructions=designExecutionInstructions(request,'Full access','max');
    assert.doesNotMatch(instructions,/at least nine/,request);
    assert.match(instructions,/new standalone hero needs its chosen layout/);
  }
});

test('standalone heroes compare sanitized shared history and preserve opt-outs, Plan and None', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-hero-history-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createTaskMemoryStore({getPath:()=>root});
  store.write('first-hero',{status:'completed',changedFiles:['index.html'],goal:'Private conversation',designReview:{brief:old}});
  const request='Create only one new standalone hero section.';
  const history=recentDesignsFor(store,'second-hero',request,'Full access');
  assert.equal(history.length,1);assert.equal(history[0].taskId,'first-hero');
  assert.doesNotMatch(JSON.stringify(history),/Private conversation/);
  assert.deepEqual(recentDesignsFor(store,'second-hero',request,'Plan'),[]);
  assert.deepEqual(recentDesignsFor(store,'second-hero',request+' Do not compare previous designs.','Full access'),[]);
  let comparisons=0;
  const design=createDesignReview({enabled:true,profile:'max',mode:'fast',brief:request,priorDesigns:history,signal:signal(),evidence:{record:()=>({id:'hero-history'})},emit:()=>{},review:async()=>{comparisons++;return {text:JSON.stringify({...repeated,matchedTaskId:'first-hero'})};}});
  assert.equal(design.constructionAllowed(),false);
  const result=await design.setBrief(proposed);
  assert.equal(result.originality.status,'repeated');assert.equal(design.constructionAllowed(),false);assert.equal(comparisons,1);
  const none=createDesignReview({enabled:false,profile:'none',mode:'fast',brief:request,priorDesigns:history,signal:signal(),evidence:{record:()=>({})},emit:()=>{},review:()=>assert.fail('None must not compare')});
  assert.equal(none.constructionAllowed(),true);
});

test('fresh websites receive only sanitized art direction from recent completed tasks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-design-history-')); t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const store = createTaskMemoryStore({getPath:()=>root});
  store.write('earlier', { goal: 'Private chat', status:'completed', changedFiles: ['page.html'], designReview: {brief:old, snapshots:[{views:[{width:1440,image:{file:'private-image'}}]}]} });
  store.write('current', {status:'completed',changedFiles:['page.html'],designReview:{brief:proposed}});
  const rows = recentDesignsFor(store, 'current', 'Create a website', 'Full access');
  assert.equal(rows.length,1); assert.equal(rows[0].taskId,'earlier'); assert.equal(rows[0].image,undefined);
  assert.doesNotMatch(JSON.stringify(rows),/Private chat/);
  assert.doesNotMatch(JSON.stringify(rows),/private-image/);
  assert.equal(recentDesignsFor(store, 'current', 'Create a new website', 'Full access').length,1);
  assert.equal(recentDesignsFor(store, 'brand-new', 'Create a new website', 'Full access').length,2);
  assert.deepEqual(recentDesignsFor(store, 'brand-new', 'Create a website; do not compare with previous designs', 'Full access'),[]);
  assert.deepEqual(recentDesignsFor(store,'current','Fix this website','Full access',{}),[]);
  assert.deepEqual(recentDesignsFor(store,'current','Create a website','Plan',{}),[]);
});

test('fresh website brief compares before construction and visual review rechecks the rendered work', async () => {
  let calls = 0, finalPrompt;
  const design = createDesignReview({ enabled:true, brief:'Create a static website', profile:'normal', mode:'fast', priorDesigns:[{...prior[0], image:{file:'earlier.jpg'}}], acceptsImages:true,
    signal:signal(), taskId:'new',requestId:'r',evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async (prompt,images,purpose) => {
      calls++;
       assert.ok(prompt.includes(compositionEvidenceInstructions),'Both proposal comparison and rendered review must receive the same evidence rule');
      if (purpose === 'originality') return { text: JSON.stringify(calls === 1 ? repeated : {status:'distinct',summary:'Different composition'}) };
      finalPrompt=prompt; assert.equal(images.at(-1).file,'earlier.jpg');
      return {text:JSON.stringify({status:'approved',summary:'Distinct compared with supplied site',preserve:[],issues:[]})};
    }});
  const first = await design.setBrief(proposed); assert.equal(design.snapshot().brief.direction,proposed.direction); assert.equal(calls,1); assert.equal(first.originality.status,'repeated'); assert.match(first.next_action,/resubmit/); assert.equal(first.construction_allowed,false); assert.equal(design.constructionAllowed(),false);
  const second = await design.setBrief({...proposed,direction:'Full-bleed photographic narrative'}); assert.equal(calls,2); assert.equal(second.originality.status,'distinct'); assert.equal(design.constructionAllowed(),true);
  design.capture({views:[{label:'desktop',image:{file:'current.jpg'}}]}, {}, 'source'); await design.evaluate('source');
  assert.match(finalPrompt,/Recent generated designs to DIFFER/); assert.match(finalPrompt,/earlier/);
  assert.match(finalPrompt,/Previously rejected relationships in this task/);
  assert.match(finalPrompt,/Same left text\/right layered card media/);
  assert.match(finalPrompt,/major originality issue.*even when other sections differ/);
  assert.match(finalPrompt,/accepted storyboard/);
  assert.equal(design.snapshot().status,'approved');
});

for (const scope of ['website', 'standalone hero']) test(`native ${scope} writes wait for a different composition while research stays available`, async t => {
  const { createAgentEngine } = require('../electron/agent/engine.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-diversity-native-'));
  const project = fs.mkdtempSync(path.join(__dirname, 'diversity-fixture-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"diversity-route-fixture"}');
  const app = { getPath: () => root };
  createTaskMemoryStore(app).write('earlier', {status:'completed',changedFiles:['page.html'],designReview:{brief:old}});
  let checked = false, comparisons = 0, builders = 0;
  const events = [];
  const engine = createAgentEngine(app, {getKey:()=>''}, event=>events.push(event), null, {reviewNativeSession:executionReviewFixture,runNativeSession:async options => {
    if (options.readOnly) {
      comparisons++;
      assert.match(options.systemPrompt,/Compare a proposed website composition/);
      return {text:comparisons === 1 ? JSON.stringify(repeated) : comparisons <= 3 ? 'invalid comparison' : JSON.stringify({status:'distinct',summary:'Different structure'})};
    }
    builders++;
    const permission = {permission:'write',metadata:{filepath:path.join(project,'index.html')},patterns:[path.join(project,'index.html')],tool:{callID:'blocked-write'}};
    if (!checked) {
      checked = true;
      assert.match(options.parts[0].text,/confirmed repeated proposals must change before source writes/i);
      if(scope==='standalone hero')assert.match(options.parts[0].text,/For a fresh whole website, or a new standalone hero, use/);
      const decision = await options.onPermission(permission,project);
      assert.equal(decision,false);
      assert.equal(await options.onPermission({permission:'bash',metadata:{command:'node generate.js'},patterns:['node generate.js']},project),false);
      assert.equal(await options.onPermission({permission:'bash',metadata:{command:'mkdir new-folder'},patterns:['mkdir new-folder']},project),true);
      assert.equal(await options.onPermission({permission:'read',patterns:[path.join(project,'package.json')]},project),true);
    }
    if (builders === 1) {
      const bridge = await options.visualTools({acceptsImages:true,signal:options.signal});
      try {
        const call = async args => (await (await fetch(bridge.config.url,{method:'POST',headers:{...bridge.config.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_design_brief',arguments:args}})})).json()).result;
        assert.notEqual((await call(proposed)).isError,true);
        assert.equal(await options.onPermission(permission,project),false);
        assert.equal(fs.existsSync(path.join(project,'index.html')),false);
        assert.notEqual((await call({...proposed,direction:'Immersive photographic opening with caption-led progression'})).isError,true);
        assert.equal(await options.onPermission(permission,project),false);
        assert.notEqual((await call({...proposed,direction:'Independently revised spatial relationships'})).isError,true);
        assert.equal(await options.onPermission(permission,project),true);
      } finally { await bridge.close(); }
    }
    return {text:'Blocked: this probe deliberately generated no website.'};
  }});
  t.after(()=>{engine.shutdown();fs.rmSync(project,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});});
  await engine.workspaces.open('new',project,async()=>true);
  const result=await engine.run({taskId:'new',requestId:'r',modelId:'opencode/mimo-v2.6-flash-free',designProfile:scope==='website'?'normal':'max',designReviewMode:'off',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:'Create a complete new '+scope}]});
  assert.equal(checked,true,JSON.stringify(result)); assert.equal(comparisons,4);
  assert.ok(builders >= 1);
  assert.equal(events.filter(event=>event.message?.startsWith('Continuing with the required design brief.')).length,0);
});

test('saved comparison exhaustion cannot lock a resumed design and long brief fields are recorded', async () => {
  let comparisons=0;
  const design = createDesignReview({enabled:true, brief:'Create a complete new website',mode:'fast',profile:'max',acceptsImages:true,
    signal:signal(),taskId:'new',requestId:'r',evidence:{record:()=>({id:'proof'})},emit:()=>{},
    saved:{mode:'fast',status:'needs_revision',reason:'Construction blocked: comparison budget reached',reviews:[],revisions:0,captureRequests:0,snapshots:[],diversity:{accepted:null,compared:1}},
    priorDesigns:prior,review:async()=>{comparisons++;return{text:JSON.stringify({status:'distinct',summary:'Composition differs',matchedTaskId:null,similarities:[]})};}});
  const result = await design.setBrief({...proposed,direction:'a'.repeat(1700),storyboard:'b'.repeat(3200)});
  assert.equal(result.status,'recorded');assert.equal(result.construction_allowed,true);
  assert.equal(result.brief.direction.length,1500);assert.equal(result.brief.storyboard.length,3000);
  assert.equal(design.constructionAllowed(),true);assert.equal(design.snapshot().diversity.version,3);
  assert.equal(design.snapshot().reason,undefined);
  assert.equal(comparisons,1);
});

test('native design-gate recovery continues after an unrelated policy denial', async t => {
  const { createAgentEngine } = require('../electron/agent/engine.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'orvix-direction-recovery-'));
  const project = fs.mkdtempSync(path.join(__dirname,'diversity-fixture-'));
  fs.writeFileSync(path.join(project,'package.json'),'{"name":"direction-recovery"}');
  const app={getPath:()=>root};
  createTaskMemoryStore(app).write('earlier',{status:'completed',changedFiles:['index.html'],designReview:{brief:old}});
  let builders=0; const events=[];
  const engine=createAgentEngine(app,{getKey:()=>''},event=>events.push(event),null,{reviewNativeSession:executionReviewFixture,runNativeSession:async options=>{
    if(options.readOnly) return {text:JSON.stringify({status:'distinct',summary:'Different composition'})};
    builders++;
    const request={permission:'edit',metadata:{filepath:path.join(project,'index.html')},patterns:[path.join(project,'index.html')],tool:{callID:'early-edit'}};
    if(builders===1){
      assert.equal(await options.onPermission({permission:'read',patterns:[],tool:{callID:'invalid-read'}},project),false);
      assert.equal(await options.onPermission(request,project),false);
      const recovery=options.permissionRecovery();
      assert.equal(recovery.recoverable,true);
      assert.equal(recovery.continue,true,'the native session must actively resume with the missing-brief instruction');
      assert.match(recovery.guidance,/set_design_brief.*now/i);
      return {text:'The blocked write did not execute.',stoppedReason:'permission_declined'};
    }
    assert.match(options.parts[0].text,/not a user permission rejection/i);
    const bridge=await options.visualTools({acceptsImages:true,signal:options.signal});
    try {
      const response=await fetch(bridge.config.url,{method:'POST',headers:{...bridge.config.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_design_brief',arguments:proposed}})});
      assert.notEqual((await response.json()).result.isError,true);
      assert.equal(await options.onPermission(request,project),true);
    } finally {await bridge.close();}
    return {text:'Blocked: deliberate fixture produces no website.',stoppedReason:'fixture_complete'};
  }});
  t.after(()=>{engine.shutdown();fs.rmSync(project,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});});
  await engine.workspaces.open('new',project,async()=>true);
  const result=await engine.run({taskId:'new',requestId:'r',modelId:'opencode/mimo-v2.6-flash-free',designProfile:'normal',designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:'Create a complete new website'}]});
  assert.equal(builders,2,JSON.stringify(result));
  assert.equal(events.filter(event=>event.type==='approval').length,0);
  assert.equal(events.filter(event=>event.message?.startsWith('Continuing with the required design brief.')).length,1);
  assert.doesNotMatch(result.text,/user declined/i);
});
