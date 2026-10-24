// Combine a continued logical chat without hiding the process/session boundary.
const fs = require('node:fs'), path = require('node:path');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const first = read('check_fast_long_conversation.first-six.report.json');
const last = read('check_fast_long_conversation.finish.report.json');
const turns = [...first.turns.filter(turn => turn.status === 'completed' && turn.number <= 6), ...last.turns];
if (turns.length !== 10 || new Set(turns.map(turn => turn.number)).size !== 10) throw new Error('Expected all ten distinct turns');
const report = {
  startedAt: first.startedAt, finishedAt: last.finishedAt, scope: first.scope,
  continuity: 'Turns 1-6 completed in one Live session. The runner stopped during a controlled disconnect test. Turns 7-10 completed after restoring those six user/assistant turns into a fresh Live session. This is one logical ten-turn chat across sessions.',
  status: turns.every(turn => turn.status === 'completed' && !turn.findings.length) ? 'passed' : 'issues_found',
  validationLimit: 'Completion means final reply delivery in this text/audio-chunk harness. It does not establish complete factual accuracy, audible playback, or physical microphone behavior. The fresh-session controlled reconnect retest was blocked by Gemini quota; the recovery state transitions passed regression tests.',
  sessions: ['check_fast_long_conversation.first-six.report.json', 'check_fast_long_conversation.finish.report.json'], turns,
};
const target = path.join(__dirname, 'check_fast_long_conversation.completed.report.json');
fs.writeFileSync(target, JSON.stringify(report, null, 2));
const summary = {
  completedTurns: turns.filter(turn => turn.status === 'completed').length,
  modelToolCalls: turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0),
  publicSearches: turns.reduce((sum, turn) => sum + turn.searches.length, 0),
  pageReads: turns.reduce((sum, turn) => sum + turn.pages.length, 0),
  nonOkPageReads: turns.reduce((sum, turn) => sum + turn.pages.filter(page => page.status !== 'ok').length, 0),
  elapsedMs: turns.reduce((sum, turn) => sum + turn.elapsedMs, 0),
  acknowledgementMs: turns.map(turn => turn.progress[0]?.atMs), firstAudioMs: turns.map(turn => turn.firstAudioMs),
};
console.log(JSON.stringify(summary, null, 2));
const text = ['# Fast: completed ten-turn conversation', '', report.scope, '', report.continuity, '', report.validationLimit, '', `Result: ${report.status}. ${summary.completedTurns}/10 final replies; ${summary.modelToolCalls} model tool calls; ${summary.publicSearches} public searches; ${summary.pageReads} page reads, including ${summary.nonOkPageReads} non-ok responses.`, '', ...turns.flatMap(turn => [`## Turn ${turn.number}`, '', turn.prompt, '', `Model tool calls: ${turn.toolCalls.length}. Visible acknowledgement: ${turn.progress[0]?.atMs} ms. First response audio chunk: ${turn.firstAudioMs} ms. Final reply: ${turn.elapsedMs} ms.`, '', turn.answer, ''])].join('\n');
fs.writeFileSync(path.join(__dirname, 'fast-long-conversation-completed.md'), text);
