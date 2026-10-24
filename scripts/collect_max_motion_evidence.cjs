// Preserve production preview evidence without running another inspection stage.
const fs = require('node:fs'), path = require('node:path');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const requestedPhase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
const outputDirectory = process.argv.find(arg => arg.startsWith('--evidence-dir='))?.slice(15) ?? 'orvix-evidence';
if (requestedPhase && !/^[a-z0-9-]+$/i.test(requestedPhase) || !/^[a-z0-9-]+$/i.test(outputDirectory)) throw Error('Invalid evidence phase/directory.');
const phases = requestedPhase ? [requestedPhase] : ['build','targeted-repair','resume-hero','hero-clarity-repair'];
for (const run of report.runs) {
  const base = path.join(run.engineRoot ?? path.join(run.root, 'engine'), 'agent-evidence', run.taskId);
  if (!fs.existsSync(base)) continue;
  const records = phases.flatMap(folder => {
    const dir=path.join(base,folder);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f=>f.endsWith('.json'))
      .map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))) : [];
  })
    .sort((a,b) => a.recordedAt - b.recordedAt);
  if (!records.length) continue;
  const previews = [], failures = [], seen = new Set();
  for (const record of records) {
    if (record.kind !== 'tool' || !['orvix_visual_preview_website','preview_website'].includes(record.name)) continue;
    const raw = fs.readFileSync(path.join(base, 'blobs', record.outputHash + '.txt'), 'utf8');
    let result; try { result = JSON.parse(raw); } catch { failures.push({ at: record.recordedAt, message: raw }); continue; }
    if (!result.views) { failures.push({ at: record.recordedAt, result }); continue; }
    const key = record.requestId + '|' + (result.views[0]?.image?.file ?? record.outputHash);
    if (seen.has(key)) continue;
    seen.add(key);
    previews.push({ at: record.recordedAt, requestId:record.requestId, input: record.input, result });
  }
  const output = path.join(run.project, outputDirectory); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'previews.json'), JSON.stringify({ previews, failures }, null, 2));
  const views = previews.flatMap(p => p.result.views.map(v => ({ ...v, at: p.at })));
  const latest = new Map();
  for (const v of views) latest.set([v.width,v.height,v.capture?.selector,v.capture?.reducedMotion].join('|'), v);
  const summary = [];
  for (const [index,v] of [...latest.values()].entries()) {
    const key = `${index + 1}-${v.label}-${v.capture?.selector?.replace(/[^\w-]/g,'') || (v.capture?.fullPage ? 'full' : 'hero')}`;
    if (v.image?.file) fs.copyFileSync(v.image.file, path.join(output, key + '.jpg'));
    for (const [i,frame] of (v.motion?.frames ?? []).entries()) {
      if (frame.image?.file) fs.copyFileSync(frame.image.file, path.join(output, key + '-motion-' + (i+1) + '.jpg'));
    }
    summary.push({ at: v.at, label: v.label, capture: v.capture, image: key + '.jpg', metrics: v.metrics,
      errors: v.errors, violations: v.accessibility?.violations, workflow: v.workflow, motion: v.motion });
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ label: run.label, status: run.status, previews: previews.length, failures: failures.length,
    views: summary.map(v => ({ at:v.at, label:v.label, capture:v.capture, image:v.image, overflow:v.metrics?.horizontalOverflow,
      broken:v.metrics?.brokenImages, errors:v.errors, violations:v.violations?.map(x=>x.id), workflow:v.workflow?.status,
      motion:v.motion?.frames?.length })) }));
}
