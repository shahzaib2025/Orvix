const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseBenchmarkOptions, runId, benchmarkPrompt, sourceEvidence, profileChecks, reviewOutcomeAccepted, compositionSignature, signatureSimilarity } = require('./website_design_benchmark_helpers.cjs');

test('benchmark preserves the existing single-profile defaults and run IDs', () => {
  const options = parseBenchmarkOptions([]);
  assert.deepEqual(options.profiles, ['normal']);
  assert.equal(options.repeats, 1);
  assert.equal(options.history,'shared');
  assert.equal(runId('luxury', 'normal', 'fast', 1, options), 'luxury-fast');
});

test('benchmark profile matrix validates unique profiles and repeat bounds', () => {
  const options = parseBenchmarkOptions(['--profiles=none,normal,medium,max', '--repeats=2', '--case=saas', '--mode=fast']);
  assert.deepEqual(options.profiles, ['none', 'normal', 'medium', 'max']);
  assert.equal(options.repeats, 2);
  assert.equal(options.caseId, 'saas');
  assert.equal(options.mode, 'fast');
  const ids = options.profiles.flatMap(profile => [1, 2].map(repeat => runId('saas', profile, 'fast', repeat, options)));
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => parseBenchmarkOptions(['--profile=max', '--profiles=normal,max']), /not both/);
  assert.throws(() => parseBenchmarkOptions(['--profiles=max,max']), /unique/);
  assert.throws(() => parseBenchmarkOptions(['--profiles=normal,,max']), /unique/);
  assert.throws(() => parseBenchmarkOptions(['--repeats=6']), /from 1 to 5/);
  assert.throws(() => parseBenchmarkOptions(['--mode=quality']), /fast or balanced/);
  assert.equal(parseBenchmarkOptions(['--history=isolated']).history,'isolated');
  assert.throws(()=>parseBenchmarkOptions(['--history=invalid']),/shared or isolated/);
  assert.throws(()=>parseBenchmarkOptions(['--history=isolated','--prior-root=old']),/shared history/);
});

test('matched profile runs use one user prompt and do not force the design workflow', () => {
  const item = { brief: 'Build a premium event site.', contract: 'The RSVP form must confirm success.', workflow: [{ action: 'assert', assertion: { kind: 'visible', selector: '#rsvp' } }] };
  const prompt = benchmarkPrompt(item);
  for (const profile of ['none', 'normal', 'medium', 'max']) assert.equal(benchmarkPrompt(item, profile), prompt);
  assert.doesNotMatch(prompt, /set_design_brief|storyboard|MAX|Medium|None/);
  assert.match(prompt, /Required interaction contract/);
});

test('MAX source checks inspect nested generated files and do not impose on other profiles', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-web-benchmark-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.mkdirSync(path.join(project, 'js'));
  fs.writeFileSync(path.join(project, 'index.html'), `<main>${'<section><h2>Purposeful section</h2></section>'.repeat(9)}</main>`);
  fs.writeFileSync(path.join(project, 'js', 'main.js'), 'gsap.registerPlugin(ScrollTrigger); gsap.timeline({ scrollTrigger: { trigger: ".story" } }); const lenis = new Lenis();');
  const evidence = sourceEvidence(project);
  assert.equal(evidence.sourceFileCount, 2);
  assert.equal(Object.keys(evidence.sourceHashes).length, 2);
  assert.equal(evidence.declaredSections, 9);
  assert.equal(profileChecks('max', evidence).every(item => item.passed), true);
  assert.deepEqual(profileChecks('normal', evidence), []);
  assert.equal(profileChecks('max', { ...evidence, declaredSections: 3 }).find(item => item.id === 'nine-sections').passed, false);
});

test('None treats disabled visual review as expected and still rejects accidental review claims', () => {
  assert.equal(reviewOutcomeAccepted('none', 'not_needed'), true);
  assert.equal(reviewOutcomeAccepted('none', 'approved'), false);
  assert.equal(reviewOutcomeAccepted('max', 'approved'), true);
  assert.equal(reviewOutcomeAccepted('normal', 'not_needed'), false);
});

test('composition similarity is scale-normalized and explicitly unavailable without layout signals', () => {
  const make = (viewportWidth, documentHeight) => {
    const xScale = viewportWidth / 1200, yScale = documentHeight / 3000;
    return compositionSignature({ metrics: { viewportWidth, documentHeight, designSignals: [
    { tag: 'H1', x: 100 * xScale, y: 200 * yScale, width: 600 * xScale, height: 80 * yScale, fontFamily: 'Editorial', backgroundColor: 'rgb(255, 255, 255)' },
    { tag: 'SECTION', x: 0, y: 1000 * yScale, width: viewportWidth, height: 500 * yScale, fontFamily: 'Body', backgroundColor: 'rgb(250, 250, 250)' },
  ] } });
  };
  const first = make(1200, 3000), scaled = make(2400, 6000);
  assert.equal(first.hash, scaled.hash);
  assert.equal(signatureSimilarity(first, scaled), 1);
  assert.equal(compositionSignature({ metrics: { designSignals: [] } }), null);
  assert.equal(signatureSimilarity(first, null), null);
  const legacyA={features:[{tag:'H1',x:0,y:0,width:.5,height:.1,font:'Serif',background:'white'}]};
  const legacyB={features:[{...legacyA.features[0],font:'Mono',background:'black'}]};
  assert.equal(signatureSimilarity(legacyA,legacyB),1);
});

test('report renders matched profiles, repeats and similarity as a review cue', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-web-benchmark-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const structure={version:2,hero:{relationship:'text-left-media-right',media:'vector',text:{x:.1,width:.5,height:.1}},sections:[{purpose:'hero',layout:'columns',groupCount:2,columns:2,media:['vector']}]};
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({
    version: 2, startedAt: '2026-10-13T00:00:00.000Z', model: 'fixture/model', variant: 'high', designProfiles: ['normal', 'max'], repeats: 1, limitations: [], runs: [
      { id: 'luxury-normal-fast-r1', case: 'luxury', profile: 'normal', repeat: 1, mode: 'fast', status: 'completed', promptHash: 'same', events: [], compositionSignatures: { desktop: structure } },
      { id: 'luxury-max-fast-r1', case: 'luxury', profile: 'max', repeat: 1, mode: 'fast', status: 'issues_found', promptHash: 'same', events: [], profileChecks: [{ id: 'nine-sections', passed: false, observed: 3 }], compositionSignatures: { desktop: structure } },
    ],
  }));
  execFileSync(process.execPath, [path.join(__dirname, 'report_website_design.cjs'), root], { stdio: 'pipe' });
  const output = fs.readFileSync(path.join(root, 'report.md'), 'utf8');
  assert.match(output, /normal/); assert.match(output, /max/); assert.match(output, /nine-sections: fail/);
  assert.match(output, /100%/); assert.match(output, /review cue/); assert.match(output, /same prompt hash/);
});
