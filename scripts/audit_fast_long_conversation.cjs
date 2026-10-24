// Additional answer checks; these do not establish factual correctness by themselves.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const esbuild = require('esbuild');
const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/fastResearch.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const loaded = new Module(__filename, module); loaded.filename = __filename; loaded.paths = module.paths;
loaded._compile(out.outputFiles[0].text, __filename);
const { fastResearchTaskFor, missingFastResearchTopics, fastResearchScopeIssue } = loaded.exports;
const filename = process.argv[2] || path.join(__dirname, 'check_fast_long_conversation.report.json');
const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
let previous = '';
const turns = report.turns.map(turn => {
  const task = fastResearchTaskFor(turn.prompt, previous); previous = turn.prompt;
  const answer = turn.answer || '';
  if (task) {
    task.answerText = answer;
    task.queries = turn.searches.map(search => search.query);
    task.sources = turn.pages.filter(page => page.status === 'ok' && page.source === 'direct_page').map(page => ({ status: 'verified', url: page.url, title: page.title || '', publisher: '', content: page.content }));
    task.failedPages = turn.pages.filter(page => page.status !== 'ok').map(page => `${page.url} [${page.message || page.status}]`);
  }
  const citations = [...answer.matchAll(/https?:\/\/[^\s)>,]+/g)].map(match => match[0]);
  const knownPages = new Set(turn.pages.filter(page => page.status === 'ok' && page.source === 'direct_page').map(page => page.url));
  const findings = [...(turn.findings || [])];
  if (turn.status !== 'completed') findings.push(turn.error || 'No completed answer');
  if (!turn.progress.length) findings.push('No visible progress acknowledgement');
  if (/বাংলায় উত্তর/.test(turn.prompt) && !/[\u0980-\u09ff]/.test(answer)) findings.push('Requested Bangla answer was delivered in another language');
  if (task) for (const url of citations) {
    if (fastResearchScopeIssue(task, url) && !/different countr|Pakistan|Nepal|পাকিস্তান|নেপাল/.test(answer)) findings.push(`Foreign-country policy presented without qualification: ${url}`);
  }
  const unresolvedTopics = task ? missingFastResearchTopics(task) : [];
  const promises = unresolvedTopics.filter(topic => topic.includes('do not end with a promise'));
  findings.push(...promises);
  return {
    number: turn.number, status: turn.status, elapsedMs: turn.elapsedMs,
    acknowledgementMs: turn.progress[0]?.atMs, firstAudioMs: turn.firstAudioMs,
    modelToolCalls: turn.toolCalls.length, publicSearches: turn.searches.length,
    directPages: turn.pages.filter(page => page.status === 'ok' && page.source === 'direct_page').length,
    failedPages: turn.pages.filter(page => page.status !== 'ok').length,
    answerChars: answer.length, citations,
    citationUrlsNotInRecordedDirectReads: citations.filter(url => !knownPages.has(url)),
    unresolvedTopics, findings,
  };
});
const audit = { scope: report.scope, note: 'Delivery, tool execution, language, promise, country-scope and requested-topic checks. Topic matching is heuristic. Manual source review is still needed; successful PCM delivery does not prove audible playback.', turns };
const target = filename.replace(/\.report\.json$/, '.audit.json');
fs.writeFileSync(target, JSON.stringify(audit, null, 2));
console.log(JSON.stringify(turns.map(({number,status,modelToolCalls,firstAudioMs,unresolvedTopics,findings}) => ({number,status,modelToolCalls,firstAudioMs,unresolvedTopics,findings})), null, 2));
