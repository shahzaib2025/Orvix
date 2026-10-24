// Read-only comparison of experiment outputs; never edits generated websites.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(process.argv[2]);
const report = JSON.parse(fs.readFileSync(path.join(root, 'report.json')));
const inspection = JSON.parse(fs.readFileSync(path.join(root, 'inspection.json')));
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const relative = file => path.relative(report.output, file).split(path.sep).join('/');
const summary = report.runs.map(run => {
  const observed = inspection.runs.find(item => item.label === run.label);
  const views = observed?.views.filter(view => view.metrics) ?? [];
  const reads = run.events.filter(event => event.name === 'read' && event.phase === 'completed' && !event.failed && /skills.*SKILL\.md/i.test(event.detail)).map(event => event.detail);
  return { label: run.label, status: run.harnessTimeout ? 'harness cutoff' : run.status, seconds: Math.round(run.durationMs / 1000), profile: run.designProfile,
    harnessTimeout: run.harnessTimeout === true,
    managedVerification: run.verification?.status ?? 'no completed handoff',
    currentManagedChecks: run.verification?.checks?.filter(check => !check.stale).map(check => ({label:check.label, phase:check.phase, status:check.status})) ?? [],
    embeddedSkills: [...new Set(run.promptAudits.flatMap(audit => audit.fullSkillInstructionsDelivered))],
    automaticSkillLoads: [...new Set(run.events.filter(event => event.name === 'read_agent_skill' && event.phase === 'completed' && !event.failed).map(event => event.detail))],
    requestedTemperature: run.traces[0]?.sampling?.requestedTemperature, skillReads: [...new Set(reads)],
    views: views.map(view => ({ label: view.label, overflow: view.metrics.documentWidth > view.metrics.width,
      jsErrors: view.errors, brokenImages: view.metrics.brokenImages, accessibility: view.accessibility, flow: view.flow })),
    concepts: fs.existsSync(path.join(run.project, 'concepts.md')) ? fs.readFileSync(path.join(run.project, 'concepts.md'), 'utf8') : null };
});
fs.writeFileSync(path.join(report.output, 'generation-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(report.output, 'inspection-report.json'), JSON.stringify(inspection, null, 2));
fs.writeFileSync(path.join(report.output, 'summary.json'), JSON.stringify(summary, null, 2));
const notesFile = path.join(root, 'findings.md');
const findings = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : 'Visual interpretation pending screenshot inspection.';
const limits = report.limits || 'One sample per arm, fixed run order, one model and one subject. This is an exploratory comparison, not proof of universal originality or a measured sampling distribution. None still lists shared visual guidance as available; successful skill reads are recorded separately. Request traces show requested temperature, not remote-provider sampling internals. Production design guidance was not changed.';
const rows = summary.map(item => `| ${item.label} | ${item.status} | ${item.seconds}s | ${item.requestedTemperature} | ${item.views.filter(view => view.flow?.passed).length}/2 | ${item.views.reduce((sum, view) => sum + (view.accessibility?.violations.length ?? 0), 0)} |`).join('\n');
fs.writeFileSync(path.join(report.output, 'README.md'), `# Hero exploration experiment\n\nModel: ${report.modelId}; default reasoning; requested temperature 0.7; design review off.\n\n${findings}\n\n| Arm | Generation | Time | Requested temperature | CTA desktop/mobile | Automated violation types across views |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\n${limits}\n\nSource hashes unchanged: ${report.sourceUnchanged}. Browser evidence: desktop 1440×900, mobile 390×844 and desktop reduced motion. An automated accessibility scan is limited coverage; motion smoothness was not measured.\n\nOpen comparison.html for screenshots and links to each page. Details are in generation-report.json, inspection-report.json and summary.json.\n`);
const cards = report.runs.map(run => {
  const row = summary.find(item => item.label === run.label);
  const observed = inspection.runs.find(item => item.label === run.label);
  return `<article><h2>${escape(run.label)}</h2><p>${escape(row.status)} · ${row.seconds}s · profile ${escape(row.profile)}</p><p><a href="${escape(run.label)}/index.html">Open actual hero</a>${row.concepts ? ` · <a href="${escape(run.label)}/concepts.md">Concept sketches</a>` : ''}</p>${['desktop','mobile'].map(label => {
    const view = observed?.views.find(item => item.label === label && item.screenshot);
    return view ? `<figure class="${label}"><img src="${escape(relative(view.screenshot))}" alt="${escape(run.label+' '+label)}"><figcaption>${label}</figcaption></figure>` : '';
  }).join('')}<details><summary>Observed checks and skill reads</summary><pre>${escape(JSON.stringify(row, null, 2))}</pre></details></article>`;
}).join('');
let referenceCard = '';
if (report.historicalReference) {
  const previous = report.historicalReference;
  const oldImage = path.join(previous.output, '_inspection', previous.label + '-desktop.png');
  const copiedImage = path.join(report.output, '_inspection', 'historical-default-desktop.png');
  if (fs.existsSync(oldImage)) fs.copyFileSync(oldImage, copiedImage);
  const pageLink = relative(path.join(previous.output, previous.label, 'index.html'));
  referenceCard = `<article><h2>Historical Default reference</h2><p>Earlier generation, without the complete-direction treatment. Source guidance hashes match: ${escape(previous.sourceHashesMatch)}. This is not a fresh randomized control.</p><a href="${escape(pageLink)}">Open earlier Default page</a>${fs.existsSync(copiedImage) ? `<figure><img src="${escape(relative(copiedImage))}" alt="Earlier Default hero"></figure>` : ''}</article>`;
}
fs.writeFileSync(path.join(report.output, 'comparison.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orvix hero exploration comparison</title><style>body{margin:0;padding:30px;background:#edf0f3;color:#19242d;font:16px/1.5 Arial,sans-serif}h1{margin:0 0 10px}header{max-width:1150px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}article{background:white;padding:18px;border-radius:12px;min-width:0}h2{font-size:20px}figure{margin:14px 0}img{display:block;width:100%;border:1px solid #ccd2d8}.mobile{width:45%;margin-inline:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}a{color:#1750a0}.findings{white-space:pre-wrap}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style><header><h1>Same brief, three experiments</h1><p>${escape(report.modelId)} · default reasoning · requested temperature 0.7 · review off</p><p class="findings">${escape(findings)}</p><p>${escape(limits)}</p></header><main class="grid">${cards}</main></html>`);
(async () => {
  const executablePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(file => fs.existsSync(file));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const reportFile = path.join(report.output, 'comparison.html');
    const paragraphs = findings.split(/\r?\n\r?\n/);
    const preview = [paragraphs[0], paragraphs.find(paragraph => paragraph.startsWith('Conclusion:'))].filter(Boolean).join('\n\n');
    let html = fs.readFileSync(reportFile, 'utf8').replace(`<p class="findings">${escape(findings)}</p>`, `<p class="findings">${escape(preview)}</p><p><a href="README.md">Detailed findings and checks</a></p>`);
    if (referenceCard) html = html.replace('</main>', referenceCard + '</main>');
    fs.writeFileSync(reportFile, html);
    await page.goto('file:///' + reportFile.replace(/\\/g, '/'));
    await page.screenshot({ path: path.join(report.output, '_inspection', 'comparison.png'), fullPage: true });
  } finally { await browser.close(); }
  console.log(JSON.stringify({ output: report.output, summary }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
