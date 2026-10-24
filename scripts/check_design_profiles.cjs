const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { resolveDesignProfile } = require('../electron/agent/design-profile.cjs');
const { instructionsFor, requestBody } = require('../electron/agent/model-client.cjs');
const { previewWebsite } = require('../electron/agent/preview-website.cjs');
const { validateMotion } = require('../electron/agent/motion-preview.cjs');
const { createImageStore } = require('../electron/agent/image-store.cjs');
const { createDesignReview } = require('../electron/agent/design-review.cjs');
const { validateTool } = require('../electron/agent/tool-validation.cjs');
const { visualToolDefinitions } = require('../electron/agent/tools.cjs');
const { listenBrowserLoopback } = require('../electron/agent/browser-loopback.cjs');

test('MAX skill asks for layered subject-led choreography without prescribing a motif', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../electron/agent/skills/website_design_max/SKILL.md'), 'utf8');
  assert.match(skill, /spatial layers or focal journey when relevant/);
  assert.match(skill, /Coordinate related text, media and near\/middle\/far layers/);
  assert.match(skill, /path travel, SVG drawing\/morphing, FLIP and image\/vector handoffs/);
  assert.match(skill, /not a fixed sequence, hero geometry, card system or recurring object/);
  assert.match(skill, /complete hero heading is visible inside any clipped word\/line wrappers/);
  assert.match(skill, /On initial reduced motion, choose the static composition before starting Lenis/);
  assert.match(skill, /correct material layout shifts or slow largest-content rendering/);
});

test('profiles validate independently from review policy and preserve legacy mapping', () => {
  assert.equal(resolveDesignProfile(), 'normal');
  assert.equal(resolveDesignProfile('normal', 'quality'), 'normal');
  assert.equal(resolveDesignProfile(undefined, 'fast'), 'medium');
  assert.equal(resolveDesignProfile(undefined, 'balanced'), 'max');
  assert.equal(resolveDesignProfile(undefined, 'quality'), 'max');
  assert.equal(resolveDesignProfile(undefined, 'off'), 'normal');
  assert.throws(() => resolveDesignProfile('invalid'), /Unknown design profile/);
});
test('all direct request routes receive the chosen profile without contaminating review/conversation', () => {
  for (const route of ['chat', 'responses', 'messages']) {
    const model = { id: 'opencode/fixture', name: 'Fixture', route };
    for (const profile of ['normal', 'medium', 'max']) {
      const body = requestBody(model, [{ role: 'user', content: 'Build a website' }], [], null, () => '', false, false, null, 'Controlled', null, profile);
      const text = route === 'chat' ? body.messages[0].content : route === 'messages' ? body.system : body.instructions;
      assert.equal(text.includes('DESIGN MAX'), false);
      assert.equal(text.includes('DESIGN MEDIUM'), false);
      assert.match(text, new RegExp('\"designProfile\":\"' + profile + '\"'));
      assert.doesNotMatch(text, /Do not let this skill create its own recognizable template/);
    }
  }
  for (const purpose of ['conversation', 'design_review', 'request_understanding', 'completion_review']) assert.ok(!instructionsFor(null, 'Controlled', purpose, 'max').includes('DESIGN MAX'));
});
test('motion arguments enforce frame, viewport, duration and selector bounds', () => {
  const motion = { section: '#story', checkpoints: [{ progress: 0 }, { progress: 1.1 }, { progress: 0 }], observe_selectors: ['#stage'], input: 'wheel' };
  validateMotion(motion, 2);
  assert.throws(() => validateMotion(motion, 3), /two viewports/);
  assert.throws(() => validateMotion({ ...motion, checkpoints: Array(7).fill({ progress: 0 }) }, 1), /six/);
  assert.throws(() => validateMotion({ ...motion, settle_ms: 10000 }, 1), /500/);
  assert.throws(() => validateMotion({ ...motion, code: 'arbitrary()' }, 1), /bounded/);
  const definition = visualToolDefinitions.find(tool => tool.name === 'preview_website');
  validateTool(definition, { directory: 'project', url: 'http://localhost:1', motion });
});
const changingFrames = [{ observations:{ targets:[{selector:'#chapter',elements:[{text:'First chapter',opacity:'1',transform:'none'}]}] } }, { observations:{ targets:[{selector:'#chapter',elements:[{text:'Next chapter',opacity:'1',transform:'none'}]}] } }];

test('complete MAX review receives content-depth criteria without adding them to Default or Medium', async () => {
  for (const profile of ['normal','medium','max']) {
    let observed = false;
    const design = createDesignReview({enabled:true,brief:'Create a complete website',profile,mode:'balanced',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async prompt=>{
      observed = true;
      assert.equal(prompt.includes('MAX depth acceptance:'),profile === 'max');
      assert.equal(prompt.includes('MAX hero acceptance:'),profile === 'max');
      assert.equal(prompt.includes('MAX text/SVG acceptance:'),profile === 'max');
      assert.equal(prompt.includes('MAX composition calibration:'),profile === 'max');
      assert.equal(prompt.includes('MAX motion hierarchy:'),profile === 'max');
      assert.equal(prompt.includes('MAX layered spatial choreography:'),profile === 'max');
      assert.equal(prompt.includes('looping accent on a meaningful word'),profile === 'max');
      assert.equal(prompt.includes('photo zoom/drift alone'),profile === 'max');
      if (profile === 'max') { assert.match(prompt,/long pinned runway or empty spacing does not count/); assert.match(prompt,/content_depth/); assert.match(prompt,/at least nine meaningful content sections/); assert.match(prompt,/GSAP \+ ScrollTrigger \+ Lenis/); assert.match(prompt,/do not infer a whole-page count or library execution/); assert.match(prompt,/two distinct pinned scenes/); assert.match(prompt,/four or five adjacent sections/); assert.match(prompt,/hidden final states or clipping/); assert.match(prompt,/a clear leading action/); assert.match(prompt,/Do not reward raw loop counts/); assert.match(prompt,/several subject-relevant visual layers/); assert.match(prompt,/text collisions, hidden content and clipped stage bounds/); assert.match(prompt,/complete hero heading is visibly inside its masks after the entrance settles/); assert.match(prompt,/without starting the normal motion sequence/); }
      else assert.doesNotMatch(prompt,/two distinct pinned scenes|four or five adjacent sections|hidden final states or clipping|MAX motion hierarchy|MAX layered spatial choreography|complete hero heading is visibly inside its masks|without starting the normal motion sequence/);
      return {text:JSON.stringify({status:'approved',summary:'Fixture review',preserve:[],issues:[]})};
    }});
    design.setBrief({audience:'Visitors',primary_action:'Explore',direction:'Original composition',signature:'Scene',responsive:'Adapted',storyboard:'Developed sections and motion'});
    design.capture({views:[{label:'desktop',image:{file:'fixture'},motion:{frames:changingFrames},workflow:{status:'passed',steps:[{action:'click',status:'performed'},{action:'assert',status:'passed'}]}}]}, {}, 'source');
    await design.evaluate('source'); assert.equal(observed,true);
  }
});

test('brief retains a bounded storyboard and fast MAX uses one independent review', async () => {
  let reviews = 0;
  const review = createDesignReview({ enabled: true, brief: 'Build a website', profile: 'max', mode: 'fast', acceptsImages: true, signal: new AbortController().signal,
    evidence: { record: () => ({ id: 'evidence' }) }, emit: () => {}, review: async () => { reviews++; return {text:JSON.stringify({status:'approved',summary:'Observed concept fits.',preserve:[],issues:[]})}; } });
  review.setBrief({ audience: 'Visitors', primary_action: 'Visit', direction: 'Optical', signature: 'Sky story', responsive: 'Stacked', storyboard: 'Dusk → stars → dawn; mobile stacked; reduced motion static.' });
  review.capture({ views: [{ label: 'desktop', image: { file: 'fixture' }, motion:{frames:changingFrames} }] }, {}, 'source');
  await review.evaluate('source');
  assert.equal(review.snapshot().status,'approved');
  assert.equal(review.snapshot().profile, 'max'); assert.match(review.snapshot().brief.storyboard, /Dusk/); assert.equal(reviews, 1);
});
test('explicit MAX scroll request needs fresh sampled states with only one extra capture request', async () => {
  const review = createDesignReview({ enabled: true, brief: 'Build a website with a pinned chapter scene', profile: 'max', mode: 'fast', acceptsImages: true, signal: new AbortController().signal,
    evidence: { record: () => ({ id: 'evidence' }) }, emit: () => {}, review:async()=>({text:JSON.stringify({status:'approved',summary:'Observed concept fits.',preserve:[],issues:[]})}) });
  const image = { file: 'fixture' };
  review.capture({ views: [{ image }] }, {}, 'source');
  assert.match((await review.evaluate('source')).feedback, /actual progression/);
  assert.deepEqual(await review.evaluate('source'), {});
  assert.equal(review.snapshot().status, 'unavailable');
  review.setBrief({audience:'Visitors',primary_action:'Visit',direction:'Original',signature:'Pinned chapter scene',responsive:'Stacked',storyboard:'Entry → chapter changes → release; distinct surrounding sections.'});
  review.capture({ views: [{ image, motion: { frames: changingFrames } }] }, {}, 'source');
  await review.evaluate('source'); assert.equal(review.snapshot().status, 'approved');
  review.capture({ views: [{ image }] }, {}, 'edited');
  await review.evaluate('edited'); assert.equal(review.snapshot().status, 'unavailable');
});

test('plain MAX business website cannot bypass profile requirements with static captures', async () => {
  const review=createDesignReview({enabled:true,brief:'make a new website for florian bd shop for their greatings and make it in a new folder got it in desktop make a new folder then do got it make it in white theme and super professional',profile:'max',mode:'fast',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async()=>({text:JSON.stringify({status:'approved',summary:'Observed concept fits.',preserve:[],issues:[]})})});
  const image={file:'fixture'};
  review.capture({views:[{image}]},{},'source');
  assert.match((await review.evaluate('source')).feedback,/selected Design MAX profile/);
  assert.equal(review.snapshot().motionCaptureRequests,1);
  assert.deepEqual(await review.evaluate('source'),{});
  assert.equal(review.snapshot().status,'unavailable');
  review.setBrief({audience:'Visitors',primary_action:'Visit',direction:'Original',signature:'Story',responsive:'Stacked',storyboard:'Purpose/composition/motion for each section.'});
  const staticFrames=[0,100].map(top=>({observations:{targets:[{selector:'#stage',elements:[{text:'Unchanged',opacity:'1',transform:'none',rect:{top},visible:top===0}]}]}}));
  review.capture({views:[{image,motion:{frames:staticFrames}}]},{},'source');
  await review.evaluate('source'); assert.equal(review.snapshot().status,'unavailable');
  review.capture({views:[{image,motion:{frames:changingFrames}}]},{},'source');
  await review.evaluate('source'); assert.equal(review.snapshot().status,'approved');
  review.capture({views:[{image,motion:{frames:staticFrames}}]},{},'edited');
  await review.evaluate('edited'); assert.equal(review.snapshot().status,'unavailable');
});

test('MAX profile gate preserves ordinary repairs, section experiments, app interfaces and explicit static briefs', async()=>{
  for(const brief of ['Fix the checkout button on my website','Make the navigation readable on this website','Create a login form for my website','Make only one section for a website','Build a static website without animation','Build a website dashboard application']){
    const review=createDesignReview({enabled:true,brief,profile:'max',mode:'fast',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'proof'})},emit:()=>{}});
    review.capture({views:[{image:{file:'fixture'}}]},{},'source');
    assert.deepEqual(await review.evaluate('source'),{}); assert.equal(review.snapshot().status,'self_inspected',brief);
  }
});

test('fresh accessibility and interaction failures cannot be labelled self inspected acceptance',async()=>{
  const review=createDesignReview({enabled:true,brief:'Repair this website layout',profile:'medium',mode:'fast',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'proof'})},emit:()=>{}});
  const failed={views:[{label:'mobile',image:{file:'fixture'},accessibility:{violations:[{id:'scrollable-region-focusable',impact:'serious',targets:['.strip-inner']}]},workflow:{steps:[{status:'failed',reason:'Interaction needs exactly one matching element.'}]}}]};
  review.capture(failed,{},'source');
  const feedback=(await review.evaluate('source')).feedback;
  assert.match(feedback,/scrollable-region-focusable/); assert.match(feedback,/exactly one/);
  await review.evaluate('source'); assert.equal(review.snapshot().status,'unavailable');
  review.capture({views:[{label:'mobile',image:{file:'fixture'},accessibility:{violations:[]},workflow:{steps:[{status:'passed'}]}}]},{},'fixed');
  await review.evaluate('fixed'); assert.equal(review.snapshot().status,'self_inspected');
  assert.equal(review.snapshot().inspectionCorrectionRequests,1);
});

test('new Medium site needs concept and real workflow statuses before visual review',async()=>{
  const review=createDesignReview({enabled:true,brief:'Make a new white professional website for Florian BD Shop',profile:'medium',mode:'fast',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'proof'})},emit:()=>{},review:async()=>({text:JSON.stringify({status:'approved',summary:'Observed concept fits.',preserve:[],issues:[]})})});
  const image={file:'fixture'};
  review.capture({views:[{image}]},{},'source');
  assert.match((await review.evaluate('source')).feedback,/chosen concept/);
  await review.evaluate('source');assert.equal(review.snapshot().status,'unavailable');
  await review.setBrief({audience:'Visitors',primary_action:'Personalize',direction:'Subject-specific idea',signature:'Relevant media',responsive:'Stacked',storyboard:'Card preview above personalization controls; collection follows with its own composition. Mobile retains preview, input, action and collection order.'});
  review.capture({views:[{image,workflow:{status:'passed',steps:[{action:'assert',status:'passed'}]}}]},{},'source');
  await review.evaluate('source');assert.equal(review.snapshot().status,'unavailable');
  review.capture({views:[{image,workflow:{status:'passed',steps:[{action:'click',status:'performed'},{action:'assert',status:'passed'}]}}]},{},'source');
  await review.evaluate('source');assert.equal(review.snapshot().status,'approved');
  review.capture({views:[{image}]},{},'edited');
  await review.evaluate('edited');assert.equal(review.snapshot().status,'unavailable');
});
test('real scroll frames observe progression, sticky hold, release and reverse with native wheel input', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-profile-motion-'));
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion fixture</title><style>*{box-sizing:border-box}body{margin:0}header,footer{height:100vh;padding:40px}#story{height:400vh}#stage{position:sticky;top:0;height:100vh;background:#102030;color:white;padding:50px}.chapter{position:absolute;top:180px;font:48px Georgia}.media{width:200px;height:200px;background:#ff7030}#after{background:#eef}@media(prefers-reduced-motion:reduce),(max-width:600px){#story{height:auto}#stage{position:static;height:auto}.chapter{position:static!important;opacity:1!important}}</style></head><body><header><h1>Before story</h1></header><section id="story"><div id="stage"><h2>Sky chapters</h2><div class="chapter" data-chapter="1">Dusk<div class="media">◯</div></div><div class="chapter" data-chapter="2">Stars<div class="media">✦</div></div><div class="chapter" data-chapter="3">Dawn<div class="media">△</div></div></div></section><footer id="after">After story</footer><script>function update(){const fallback=matchMedia('(prefers-reduced-motion:reduce),(max-width:600px)').matches;const story=document.querySelector('#story'),p=Math.max(0,Math.min(1,(scrollY-story.offsetTop)/(story.offsetHeight-innerHeight)));const active=Math.min(2,Math.floor(p*3));document.querySelectorAll('.chapter').forEach((e,i)=>{e.style.opacity=fallback||i===active?'1':'0';e.querySelector('.media').style.background=['#ff7030','#467aff','#f5c96a'][i]})}addEventListener('scroll',update);addEventListener('resize',update);update()</script></body></html>`;
  const server = http.createServer((_request, response) => response.end(html));
  await listenBrowserLoopback(server);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { url: `http://127.0.0.1:${server.address().port}`, taskId: 'motion', requestId: 'capture', signal: AbortSignal.timeout(55000), imageStore: createImageStore({ getPath: () => root }), viewports: [{ width: 1440, height: 900 }],
    motion: { section: '#story', input: 'wheel', settle_ms: 150, observe_selectors: ['#stage', '.chapter', '#after'], checkpoints: [{ progress: 0, label: 'entry' }, { progress: 0.45, label: 'middle' }, { progress: 0.9, label: 'last' }, { progress: 1.1, label: 'release' }, { progress: 0, label: 'reverse' }] } };
  const result = await previewWebsite(options), frames = result.views[0].motion.frames;
  const chapter = frame => frame.observations.targets[1].elements.filter(element => element.visible).map(element => element.text).join(' ');
  assert.match(chapter(frames[0]), /Dusk/); assert.match(chapter(frames[1]), /Stars/); assert.match(chapter(frames[2]), /Dawn/); assert.match(chapter(frames[4]), /Dusk/);
  assert.ok(Math.abs(frames[1].observations.targets[0].elements[0].rect.top) < 2);
  assert.ok(frames[3].observations.targets[0].elements[0].rect.top < -100);
  assert.equal(frames[3].observations.targets[2].elements[0].visible, true);
  const hashes = frames.slice(0, 3).map(frame => crypto.createHash('sha256').update(fs.readFileSync(frame.image.file)).digest('hex'));
  assert.equal(new Set(hashes).size, 3); assert.equal(result.images.length, 5);
  const fallback = await previewWebsite({ ...options, requestId: 'fallback', reduced_motion: true, viewports: [{ width: 390, height: 844 }], motion: { section: '#story', observe_selectors: ['#story'], checkpoints: [{ progress: 0 }] } });
  assert.equal(fallback.views[0].metrics.prefersReducedMotion, true);
  assert.equal(fallback.views[0].metrics.horizontalOverflow, false);
  assert.match(fallback.views[0].motion.frames[0].observations.targets[0].elements[0].text, /Dusk[\s\S]*Stars[\s\S]*Dawn/);
});

test('stationary checkpoints distinguish sustained hero motion from a completed entrance and reduced motion', { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-idle-hero-'));
  const html = '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Idle motion fixture</title><style>body{margin:0;background:#111;color:#fff}#hero{height:100vh;padding:24px;box-sizing:border-box}#once{animation:enter 60ms ease-out forwards}#loop{width:180px;height:180px;background:#39bcb6;animation:ambient 3s ease-in-out infinite alternate}@keyframes enter{from{transform:translateY(30px)}to{transform:translateY(0)}}@keyframes ambient{from{transform:translateX(0) rotate(-4deg)}to{transform:translateX(80px) rotate(4deg)}}@media(prefers-reduced-motion:reduce){#once,#loop{animation:none;transform:none}}</style><body><main><section id="hero"><h1 id="once">Readable title</h1><div id="loop" aria-label="Animated study"></div><button>Explore</button></section></main></body></html>';
  const server = http.createServer((_, response) => response.end(html));
  await listenBrowserLoopback(server);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root,{recursive:true,force:true}); });
  const options = { url:`http://127.0.0.1:${server.address().port}`,taskId:'hero',requestId:'idle',signal:AbortSignal.timeout(40000),imageStore:createImageStore({getPath:()=>root}),viewports:[{width:1280,height:800}],full_page:false,
    motion:{section:'#hero',observe_selectors:['#loop','#once'],settle_ms:450,checkpoints:Array.from({length:6},()=>({progress:0}))} };
  const result = await previewWebsite(options), frames=result.views[0].motion.frames;
  assert.ok(frames.every(frame=>frame.observations.scrollY===frames[0].observations.scrollY));
  const transforms = index => new Set(frames.map(frame=>frame.observations.targets[index].elements[0].transform));
  assert.ok(transforms(0).size>1,'The main visual changes after entrance without moving the viewport.');
  assert.equal(transforms(1).size,1,'The completed title entrance must not be mistaken for sustained motion: ' + JSON.stringify([...transforms(1)]));
  const reduced = await previewWebsite({...options,requestId:'reduced',reduced_motion:true,motion:{...options.motion,checkpoints:[{progress:0},{progress:0},{progress:0}]}});
  const still = reduced.views[0].motion.frames;
  assert.equal(new Set(still.map(frame=>frame.observations.targets[0].elements[0].transform)).size,1);
  assert.equal(reduced.views[0].metrics.prefersReducedMotion,true);
  assert.equal(reduced.views[0].metrics.horizontalOverflow,false);
});
