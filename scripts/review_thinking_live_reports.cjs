// Offline analysis of recorded traces; does not change the original observations.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const built = esbuild.buildSync({ entryPoints: [path.join(root, 'src/thinkingFlow.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const helper = new Module(path.join(__dirname, '.thinking-review.cjs'), module);
helper.filename = path.join(__dirname, '.thinking-review.cjs');
helper._compile(built.outputFiles[0].text, helper.filename);
const { isVoiceSystemError } = helper.exports;
const names = process.argv.slice(2);
if (!names.length) throw new Error('Supply recorded report paths.');
const review = { at: new Date().toISOString(), scope: 'Offline trace review using the current failure-text classifier and required fresh tool/source checks. This does not prove provider receipt or independently validate all factual claims.', reports: [] };
for (const name of names) {
  const report = JSON.parse(fs.readFileSync(path.resolve(root, name), 'utf8'));
  const runs = [];
  for (const suite of report.suites) for (const turn of suite.turns) {
    const trace = turn.trace || [];
    const calls = trace.filter(event => event.event === 'tool_received').map(event => event.data.name);
    const submissions = trace.filter(event => event.event === 'response_submitted');
    const submitErrors = trace.filter(event => event.event === 'response_submission_failed');
    const transportErrors = trace.filter(event => event.event === 'socket_error' || event.event === 'connection_close' && event.data.code !== 1000);
    const failureText = isVoiceSystemError(turn.final || '');
    const required = turn.name === 'desktop' ? ['list_directory'] : turn.name === 'website' || turn.name === 'latest-models' ? ['read_web_page'] : [];
    const sourceRead = turn.name === 'latest-models'
      ? turn.backends.some(item => item.name === 'read_web_page' && item.status === 'ok' && /^https:\/\/ai\.google\.dev\/gemini-api\/docs\/models(?:[/?#]|$)/.test(item.url || ''))
      : turn.name === 'website' ? turn.backends.some(item => item.name === 'read_web_page' && item.status === 'ok' && /^https:\/\/(?:www\.)?florianbd\.com(?:\/|$)/.test(item.url || '')) : true;
    const missingCalls = required.filter(requiredName => !calls.includes(requiredName));
    const backendFailures = turn.backends.filter(item => !['ok', 'no_results'].includes(item.status));
    const idle = trace.findLast(event => event.event === 'turn_idle');
    const lastSubmission = submissions.at(-1);
    let finding = 'completed_with_required_tool_evidence';
    if (transportErrors.length) finding = 'recorded_transport_error';
    else if (submitErrors.length) finding = 'local_response_submission_failed';
    else if (failureText) finding = calls.length === 0 ? 'model_failure_before_any_tool_call' : submissions.length ? 'model_failure_after_sdk_submission' : 'model_failure_before_result_submission';
    else if (backendFailures.length) finding = 'backend_not_successful';
    else if (missingCalls.length) finding = 'requested_fresh_tool_call_missing';
    else if (!sourceRead) finding = 'required_official_source_not_read';
    else if (turn.failure || !turn.final) finding = 'final_response_missing';
    else if (turn.name === 'diagnosis') finding = 'valid_diagnostic_uncertainty';
    runs.push({ suite: suite.suite, round: suite.round, name: turn.name,
      originalStatus: turn.status, originalFailureTextFlag: turn.summary?.modelReportedFailure,
      reviewedFailureTextFlag: failureText, finding, calls,
      submittedIds: submissions.flatMap(event => event.data.ids), submissionErrors: submitErrors.length,
      transportErrors: transportErrors.length, requiredSourceRead: sourceRead, missingCalls,
      backendFailures,
      ...(lastSubmission && idle ? { msFromLastSubmissionToIdle: idle.elapsedMs - lastSubmission.elapsedMs } : {}),
      final: turn.final });
  }
  review.reports.push({ path: name, at: report.at, apiVersion: report.apiVersion || 'v1alpha', sourceHash: report.sourceHash, runs });
}
const file = path.join(root, 'scratch', 'thinking-live-review-latest.json');
fs.writeFileSync(file, JSON.stringify(review, null, 2));
for (const report of review.reports) for (const run of report.runs) console.log(JSON.stringify({ report: path.basename(report.path), suite: run.suite, round: run.round, name: run.name, finding: run.finding, calls: run.calls }));
console.log(`Offline review: ${file}`);
