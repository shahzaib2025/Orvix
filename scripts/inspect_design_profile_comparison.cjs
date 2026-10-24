// Read-only source/evidence inventory. Counts are not visual-quality grades.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const clean = text => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const result = [];
for (const run of report.runs) {
  const htmlFile = path.join(run.project, 'index.html');
  if (!fs.existsSync(htmlFile)) { result.push({ label: run.label, status: run.status, indexMissing: true }); continue; }
  const html = fs.readFileSync(htmlFile, 'utf8');
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'orvix-evidence', 'scratch', 'dist'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(html|css|js|mjs|json)$/.test(entry.name)) files.push({ file: path.relative(run.project, file), bytes: fs.statSync(file).size, hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    }
  }
  visit(run.project);
  const source = files.filter(f => /\.(html|css|js|mjs)$/.test(f.file)).map(f => fs.readFileSync(path.join(run.project, f.file), 'utf8')).join('\n');
  const evidenceRoot = path.join(run.engineRoot ?? path.join(run.root, 'engine'), 'agent-evidence', run.taskId);
  const reads = [], assets = [], briefs = [], failures = [];
  for (const phase of ['build', 'targeted-repair']) {
    const dir = path.join(evidenceRoot, phase);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (record.kind !== 'tool') continue;
      if (record.name === 'read' || record.name === 'read_agent_skill') reads.push({ name: record.name, input: record.input, outputHash: record.outputHash });
      if (record.name === 'orvix_visual_find_visual_assets') assets.push(record.input);
      if (record.name === 'orvix_visual_set_design_brief') briefs.push(record.input);
      if (record.failed) failures.push({ name: record.name, input: record.input });
    }
  }
  const item = { label: run.label, profile: run.profile, status: run.status, durationMs: run.durationMs,
    files, sectionIds: [...html.matchAll(/<section\b[^>]*\bid=["']([^"']+)/gi)].map(m => m[1]),
    headings: [...html.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ level: Number(m[1]), text: clean(m[2]) })),
    scripts: [...html.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map(m => m[1]),
    imageUrls: [...new Set([...html.matchAll(/<(?:img|source)\b[^>]*\bsrc=["']([^"']+)/gi)].map(m => m[1]))],
    sourceSignals: { gsap: /gsap\./.test(source), scrollTrigger: /ScrollTrigger/.test(source), lenis: /new (?:window\.)?Lenis/.test(source), three: /THREE\.|from ['"]three/.test(source), reducedMotion: /prefers-reduced-motion/.test(source), indefiniteMotion: /repeat\s*:\s*-1|\binfinite\b/.test(source) },
    reads, assets, briefs, failures };
  result.push(item);
  console.log(JSON.stringify({ label: item.label, status: item.status, durationMs: item.durationMs, sectionIds: item.sectionIds, headings: item.headings, scripts: item.scripts, sourceSignals: item.sourceSignals, reads: item.reads.map(r => r.input) }));
}
fs.writeFileSync(path.join(report.output, 'source-and-routing-observations.json'), JSON.stringify(result, null, 2));
