const fs = require('node:fs');
const path = require('node:path');
const { signatureSimilarity } = require('./website_design_benchmark_helpers.cjs');
const base = path.resolve(__dirname, '..', 'scratch', 'website-design-benchmark');
const root = process.argv[2] ? path.resolve(process.argv[2]) : fs.readFileSync(path.join(base, 'latest.txt'), 'utf8').trim();
const report = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
const artifacts = fs.existsSync(path.join(root, 'artifact-validation.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'artifact-validation.json'), 'utf8')) : {};
const visual = fs.existsSync(path.join(root, 'visual-assessment.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'visual-assessment.json'), 'utf8')) : null;
const supplemental = name => fs.existsSync(path.join(root, name)) ? JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) : {};
const pricing = supplemental('pricing-validation.json'), portfolio = supplemental('portfolio-validation.json');
const structuralAudit = new Map((supplemental('structure-audit.json').runs ?? []).map(run=>[run.id,run]));
const seconds = value => Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : 'Unavailable';
function toolTime(events) {
  const starts = new Map(), intervals = [];
  for (const event of events) {
    if (event.type !== 'tool' || ['design_review', 'invalid'].includes(event.name)) continue;
    if (event.phase === 'started') starts.set(event.callId, event.atMs);
    if (event.phase === 'completed') intervals.push([starts.get(event.callId) ?? Math.max(0, event.atMs - (event.durationMs ?? 0)), event.atMs]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0, end = 0;
  for (const [start, stop] of intervals) { total += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
  return total;
}
const lines = ['# Orvix website design benchmark', '', `Model: ${report.model ?? 'Pending'}. Thinking setting: ${report.variant ?? 'default'}. Started: ${report.startedAt}. Profiles: ${(report.designProfiles ?? [report.designProfile ?? 'normal']).join(', ')}. Repeats per profile: ${report.repeats ?? 1}.`, '',
  'Runs use the same brief text across selected profiles and fresh project folders. Fast/Balanced are design-review budgets, not generation modes. The comparison records observed traces, screenshots, workflow checks and profile-specific source indicators; sample sizes remain exploratory unless you choose repeats.', '',
  '| Brief | Profile | Repeat | Review budget | Result | Agent time | First preview | Tokens | MAX source checks | Independent interaction/layout check |',
  '| --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- |'];
for (const run of report.runs) {
  const stages = run.verification?.usageStages ?? [], stageDuration = stage => stages.filter(item => item.stage === stage).reduce((sum, item) => sum + item.durationMs, 0);
  const checks = (run.hostValidation ?? artifacts[run.id]?.checks)?.map(view => `${view.label}: ${view.flow}; ${view.overflow ? 'overflow' : 'no overflow'}; ${view.brokenImages} broken images`).join('; ') ?? run.error ?? 'Pending';
  const profileChecks = run.profileChecks?.length ? run.profileChecks.map(check => `${check.id}: ${check.passed ? 'pass' : `fail (${check.observed})`}`).join(', ') : 'n/a';
  lines.push(`| ${run.case} | ${run.profile ?? report.designProfile ?? 'normal'} | ${run.repeat ?? 1} | ${run.mode} | ${run.status} | ${seconds(run.agentDurationMs)} | ${seconds(run.firstPreviewMs ?? run.firstObservedPreviewMs)} | ${run.usage?.total_tokens?.toLocaleString() ?? 'Unavailable'} | ${profileChecks.replace(/\|/g, '/')} | ${checks.replace(/\|/g, '/')} |`);
}
lines.push('', '## Recorded activity', '', 'Tool-active time is the union of observed execution-tool intervals, excluding the independent critic and native invalid-tool placeholders. Remaining elapsed time includes model processing/queuing, communication and harness overhead; it is not a pure model-generation measurement.', '', '| Run | Completed execution-tool calls | Failed / invalid tool calls | Tool-active time | Time outside recorded tools |', '| --- | --- | --- | --- | --- |');
for (const run of report.runs) {
  const active = toolTime(run.events);
  const completed = run.events.filter(event => event.type === 'tool' && event.phase === 'completed');
  lines.push(`| ${run.id} | ${completed.filter(event => !['design_review', 'invalid'].includes(event.name)).length} | ${completed.filter(event => event.failed).length} / ${completed.filter(event => event.name === 'invalid').length} | ${seconds(active)} | ${seconds(Number.isFinite(run.agentDurationMs) ? Math.max(0, run.agentDurationMs - active) : null)} |`);
}
const compositionRuns = report.runs.map(run => ({ run, signature: structuralAudit.get(run.id)?.signature ?? run.compositionSignatures?.desktop })).filter(item => item.signature?.features?.length || item.signature?.version === 2 && item.signature.sections?.length);
const similarPairs = [];
for (let leftIndex = 0; leftIndex < compositionRuns.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < compositionRuns.length; rightIndex++) {
  const left = compositionRuns[leftIndex], right = compositionRuns[rightIndex];
  if (left.run.id === right.run.id) continue;
  const score = signatureSimilarity(left.signature, right.signature);
  if (score !== null && score >= 0.7) similarPairs.push({ left: left.run, right: right.run, score });
}
similarPairs.sort((a, b) => b.score - a.score);
lines.push('', '## Composition similarity review cues', '', 'New captures compare hero text/media relationships and ordered section roles, layouts and repeated groups, independently of font and palette. Legacy captures compare geometry only. A high overlap is a prompt to inspect saved screenshots; it does not establish duplication. Coarse DOM roles do not prove useful content, visual quality or animation.', '', `History policy: ${report.history ?? 'isolated (legacy report)'}. Shared history exercises bounded recent-design comparison; isolated history is a baseline without prior design notes. OpenCode execution uses production task workers in new runs.`, '');
if (similarPairs.length) {
  lines.push('| Brief A / profile / run | Brief B / profile / run | Layout-feature overlap |', '| --- | --- | ---: |');
  for (const pair of similarPairs.slice(0, 20)) lines.push(`| ${pair.left.case} / ${pair.left.profile ?? report.designProfile ?? 'normal'} / ${pair.left.id} | ${pair.right.case} / ${pair.right.profile ?? report.designProfile ?? 'normal'} / ${pair.right.id} | ${(pair.score * 100).toFixed(0)}% |`);
} else lines.push('No pair reached the 70% feature-overlap review threshold, or there were not enough captured desktop pages to compare.');
const promptGroups = new Map();
for (const run of report.runs) { const group = promptGroups.get(run.case) ?? new Set(); if (run.promptHash) group.add(run.promptHash); promptGroups.set(run.case, group); }
lines.push('', 'Matched-prompt integrity: ' + ([...promptGroups].every(([, hashes]) => hashes.size <= 1) ? 'each brief kept the same prompt hash across profile runs.' : 'some runs for a brief used different prompt hashes; inspect results.json before comparing.'), '');
lines.push('', '## Desktop and mobile evidence', '', 'These are fresh captures made by the supervising harness after the agent finished, served independently from the final source. Visual judgment is an assistant assessment, not a blinded human-panel result.', '');
for (const run of report.runs) {
  lines.push(`### ${run.case} — ${run.mode}`, '');
  if (run.error) lines.push(`Run error: ${run.error}`, '');
  if (artifacts[run.id]?.note) lines.push(artifacts[run.id].note, '');
  for (const view of (run.finalHero ?? artifacts[run.id]?.finalHero)?.views ?? []) lines.push(`![${run.id} ${view.label} hero](${view.image.file.replace(/\\/g, '/')})`, '');
  for (const view of (run.finalFullPage ?? artifacts[run.id]?.finalFullPage)?.views ?? []) lines.push(`[${view.label} full-page capture](<${view.image.file.replace(/\\/g, '/')}>)`, '');
}
if (Object.keys(pricing).length || Object.keys(portfolio).length) {
  lines.push('## Supplemental workflow checks', '', 'These checks were added after inspecting generated markup; they do not change the matched original prompts or agent timing.', '');
  for (const [id, check] of Object.entries(pricing)) lines.push(`- ${id}: actual Monthly → Annual → Monthly prices ${check.prices.map(price => '$' + price.monthly + ' → $' + price.annual + ' → $' + price.monthly).join(', ')}; ${check.views.map(view => view.label + ': ' + view.workflow.status).join('; ')}.`);
  for (const [id, check] of Object.entries(portfolio)) {
    lines.push(`- ${id}: All restores both identity and editorial projects; ${check.capture.views.map(view => view.label + ': ' + view.workflow.status).join('; ')}.`);
    for (const view of check.capture.views) lines.push(`  [${view.label} complete portfolio capture](<${view.image.file.replace(/\\/g, '/')}>)`);
  }
  lines.push('');
}
if (visual) {
  lines.push('## Observed visual strengths and weaknesses', '', visual.method, '');
  for (const [id, assessment] of Object.entries(visual.runs)) {
    lines.push(`### ${id}`, '', assessment.judgment, '', `Strengths: ${assessment.strengths.join('; ')}.`, '', `Weaknesses: ${assessment.weaknesses.join('; ')}.`, '');
  }
}
lines.push('## Evaluation limits', '', ...report.limitations.map(text => `- ${text}`), '', 'A passed workflow proves only its supplied assertions. Accessibility scan results are separate from the functional/layout verdict. No design-review approval proves originality against every existing website, and no final Balanced revision is implicitly independently regraded.', '');
fs.writeFileSync(path.join(root, 'report.md'), lines.join('\n'));
console.log(path.join(root, 'report.md'));
