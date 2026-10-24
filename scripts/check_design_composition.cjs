const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { captureComposition, observedComposition, structuralSignature, structureSimilarity, comparisonHints } = require('../electron/agent/design-composition.cjs');
const { createPreviewSession } = require('../electron/agent/preview-website.cjs');
const { createTaskMemoryStore } = require('../electron/agent/task-memory-store.cjs');
const { createDesignDiversity } = require('../electron/agent/design-diversity.cjs');
const { createDesignReview } = require('../electron/agent/design-review.cjs');

test('rendered layout matches after retheming but distinguishes a different hero and section rhythm', async t => {
  const session=createPreviewSession(new AbortController().signal); t.after(()=>session.stop());
  const browser=await session.get(), page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent(`<style>body{margin:0;font-family:Arial}section{padding:40px}.hero{display:flex;gap:40px}h1{width:500px}aside{width:500px;height:320px;background:#ccc}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.cards article{min-height:150px}</style><main><section class="hero"><div><h1>Private Brand incident help</h1><p>Private copy</p></div><aside>Interface</aside></section><section><h2>Product features</h2><div class="cards"><article>A</article><article>B</article><article>C</article></div></section><section><h2>Workflow</h2><p>Steps</p></section><section><h2>Pricing</h2><p>Plans</p></section></main>`);
  const original=await page.evaluate(captureComposition);
  assert.equal(original.hero.relationship,'text-left-media-right');
  assert.equal(original.sections[1].columns,3);
  assert.doesNotMatch(JSON.stringify(original),/Private|Arial|#ccc|selector|Interface/);
  await page.addStyleTag({content:'body{background:black;color:white;font-family:Georgia}aside{background:green}article{border:2px solid orange}'});
  const themed=await page.evaluate(captureComposition);
  assert.ok(structureSimilarity(original,themed)>=.9);
  await page.addStyleTag({content:'.hero{flex-direction:row-reverse}.cards{display:block}'});
  await page.evaluate(()=>document.querySelector('main').prepend(document.querySelectorAll('section')[3]));
  const changed=await page.evaluate(captureComposition);
  assert.equal(changed.hero.relationship,'media-left-text-right');
  assert.ok(structureSimilarity(original,changed)<.7);
  await page.locator('aside').evaluate(el=>{el.innerHTML='<svg width="400" height="280" viewBox="0 0 400 280"><circle cx="200" cy="140" r="100" /></svg>';});
  assert.equal((await page.evaluate(captureComposition)).hero.media,'vector');
});

test('rendered comparison cues match viewport sizes, rank actual geometry and omit unobserved/private material', () => {
  const composition={version:1,hero:{relationship:'text-left-media-right',media:'vector',text:{x:.1,width:.4,height:.25}},sections:[{purpose:'hero',layout:'columns',columns:2,groupCount:2,media:['vector']},{purpose:'process',layout:'grid',columns:3,groupCount:3,media:[]}]};
  const mobile={...composition,hero:{...composition.hero,relationship:'text-above-media'}};
  const current=[{metrics:{viewportWidth:390,composition:mobile}},{metrics:{viewportWidth:1440,composition}}];
  const cues=comparisonHints(current,[{taskId:'observed',brief:{direction:'private plan'},observedComposition:{views:[{width:390,composition:mobile},{width:1440,composition:{...composition,privateCopy:'secret'}}]}},{taskId:'plan-only',brief:{direction:'unobserved'}}]);
  assert.equal(cues.length,1);assert.equal(cues[0].taskId,'observed');assert.equal(cues[0].similarity,1);
  assert.equal(cues[0].previousViewportWidth,1440);assert.equal(cues[0].currentHero,'text-left-media-right');
  assert.doesNotMatch(JSON.stringify(cues),/private|secret|direction/);
  assert.deepEqual(comparisonHints([],[]),[]);
});

test('long hero copy and wrapped controls do not become the HTML product visual', async t => {
  const session=createPreviewSession(new AbortController().signal);t.after(()=>session.stop());
  const browser=await session.get(),page=await browser.newPage({viewport:{width:1366,height:768}});
  await page.setContent(`<style>body{margin:0}.hero>div{display:grid;grid-template-columns:1fr 1fr;gap:40px;padding:60px}h1{font-size:64px}p{height:180px}.actions{height:160px}figure{margin:0;height:500px;background:#ddd}@media(max-width:600px){.hero>div{grid-template-columns:1fr;padding:20px}}</style><main><section class="hero"><div><div><h1>Private headline</h1><p>Long introduction</p><div class="actions"><a>Primary action</a><a>Secondary action</a></div></div><figure><div><div>Structured interface</div></div></figure></div></section></main>`);
  assert.equal((await page.evaluate(captureComposition)).hero.relationship,'text-left-media-right');
  await page.setViewportSize({width:390,height:844});
  assert.equal((await page.evaluate(captureComposition)).hero.relationship,'text-above-media');
  await page.locator('figure').evaluate(el=>el.remove());
  assert.equal((await page.evaluate(captureComposition)).hero.relationship,'text-led');
});

test('recent task comparison exports only sanitized, current observed structure', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-observed-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createTaskMemoryStore({getPath:()=>root});
  const composition={version:1,hero:{relationship:'overlapping',media:'vector',text:{x:.1,width:.6,height:.2},privateCopy:'secret'},sections:[{purpose:'hero',layout:'flow',columns:1,groupCount:0,media:['vector'],asset:'private.jpg'}]};
  const observed={version:1,fingerprint:'final',views:[{width:1440,composition,source:'private.html'}]};
  const brief={direction:'A subject-specific scene'};
  store.write('fresh',{status:'completed',changedFiles:['private.html'],designReview:{brief,sourceFingerprint:'final',observedComposition:observed}});
  store.write('stale',{status:'completed',changedFiles:['private.html'],designReview:{brief,sourceFingerprint:'edited',observedComposition:observed}});
  const rows=store.recentDesigns('new');
  assert.ok(rows.find(row=>row.taskId==='fresh').observedComposition);
  assert.equal(rows.find(row=>row.taskId==='stale').observedComposition,undefined);
  assert.doesNotMatch(JSON.stringify(rows),/secret|private\.html|private\.jpg|privateCopy/);
});

test('interrupted rendered sites retain sanitized comparison evidence without admitting unfinished or stale plans', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-stopped-layout-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createTaskMemoryStore({getPath:()=>root});
  const composition={version:1,hero:{relationship:'overlapping',media:'vector',text:{}},sections:[{purpose:'hero',layout:'flow',media:['vector']}]};
  const designReview={brief:{direction:'A subject-specific relationship',storyboard:'Private project path is not available'},sourceFingerprint:'current',observedComposition:{version:1,fingerprint:'current',views:[{width:1440,composition}]}};
  for(const status of ['stopped','failed'])store.write(status,{status,changedFiles:['private-project/index.html'],lastReply:'secret conversation',designReview});
  store.write('active',{status:'running',changedFiles:['private.html'],designReview});
  store.write('no-files',{status:'stopped',changedFiles:[],designReview});
  store.write('plan-only',{status:'failed',changedFiles:['private.html'],designReview:{brief:designReview.brief}});
  store.write('stale-stopped',{status:'stopped',changedFiles:['private.html'],designReview:{...designReview,sourceFingerprint:'edited'}});
  const rows=store.recentDesigns('new',8);
  assert.deepEqual(rows.map(row=>row.taskId).sort(),['failed','stopped']);
  assert.ok(rows.every(row=>row.observedComposition.views.length===1));
  assert.doesNotMatch(JSON.stringify(rows),/secret conversation|private-project\/index\.html/);
});

test('observed structure reaches the existing comparison instead of treating an old proposal as built evidence', async () => {
  const brief={direction:'Split hero',storyboard:'Product then pricing'};
  const observed={version:1,views:[{width:1440,composition:{version:1,hero:{relationship:'overlapping',media:'vector',text:{}},sections:[{purpose:'hero',layout:'flow',media:[]}]}}]};
  let calls=0;
  const guard=createDesignDiversity({prior:[{taskId:'old',brief,observedComposition:observed}],signal:new AbortController().signal,compare:async prompt=>{
    calls++;assert.match(prompt,/observedComposition/);assert.match(prompt,/overlapping/);
    return {text:JSON.stringify({status:'distinct',summary:'Actual old layout differs from proposed split.'})};
  }});
  assert.equal((await guard.check(brief)).status,'distinct'); assert.equal(calls,1);
});

test('existing review receives observed structure and stales it after edits; None captures no design history', async () => {
  const composition={version:1,hero:{relationship:'text-led',media:'content',text:{}},sections:[{purpose:'hero',layout:'flow',media:[]}]};
  const views=['desktop','mobile'].map((label,i)=>({label,width:i?390:1440,image:{file:label+'.jpg'},metrics:{composition}}));
  let prompt;
  const options={enabled:true,brief:'Create a website',mode:'balanced',profile:'normal',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'e'})},emit:()=>{},review:async text=>{prompt=text;return{text:JSON.stringify({status:'approved',summary:'Observed fit',preserve:[],issues:[]})}}};
  const design=createDesignReview(options);
  design.capture({url:'http://localhost',views},{},'source'); await design.evaluate('source');
  assert.match(prompt,/Current observed structure/); assert.match(prompt,/text-led/);
  assert.match(prompt,/Rendered-structure comparison cues/);assert.match(prompt,/never as an automatic duplication verdict/);
  assert.equal(design.snapshot().observedComposition.fingerprint,'source');
  await design.evaluate('changed'); assert.equal(design.snapshot().sourceFingerprint,'changed');
  const none=createDesignReview({...options,profile:'none'}); none.capture({views},{},'source'); await none.evaluate('source');
  assert.equal(none.snapshot().observedComposition,undefined);
  const signature=structuralSignature({metrics:{composition}}); assert.equal(signature.version,2);
  assert.equal(observedComposition([{metrics:{}}],'source'),null);
});
