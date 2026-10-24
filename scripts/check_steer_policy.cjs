const test = require('node:test'), assert = require('node:assert/strict');
const { isReportOnlySteer } = require('../electron/agent/steer-policy.cjs');

test('work followed by a terminal report stays an actionable request', () => {
  for (const request of [
    'Create a premium website. Preview at desktop and mobile, report observed results, and stop.',
    'Build the website, then give a report only.',
    'Please fix the API, test it, summarize the results and stop.',
    'Research the official docs, report the findings and stop.',
    'Inspect the website and give me only a report.',
    'Make at most one targeted correction if needed, report observed results, and stop.',
    'Give a status update, then continue working.',
  ]) assert.equal(isReportOnlySteer(request), false, request);
});

test('immediate report-only steering remains a stop even with prior work mentioned', () => {
  for (const request of [
    'Stop now and give a report only.',
    'Give a report only. No more tools.',
    'Give a report only. Do not do any other work.',
    'I asked you to build a website. Give me a report and stop.',
    'Do not fix anything. Report what happened and stop.',
    'Build a website. Stop now and report the current results.',
    'Fix the website. Do not continue; give a report.',
    'Fix the website. No need to do anything else, just give a report.',
    'Fix the website. Do not do other work. Give a report only.',
  ]) assert.equal(isReportOnlySteer(request), true, request);
});
