// Explicit report-only requests terminate work; progress reports that ask to
// continue remain ordinary steering instructions.
function isReportOnlySteer(value) {
  const text = String(value ?? '').toLowerCase().replace(/[’‘]/g, "'");
  if (/\b(?:then|and|after(?:wards)?)\s+(?:continue|resume|keep working|finish|implement|fix)\b/.test(text)) return false;
  const report = /\b(?:report|summary|summarize|summarise|status update)\b/.test(text);
  const stop = /\b(?:stop|halt|don't continue|do not continue|no more work|no further work|no need to (?:do|work|continue)|(?:don't|do not) do (?:anything|other)|nothing else|no (?:need for )?(?:other|further) (?:things|actions|changes)|(?:just|only) (?:give|send|show|provide|write)?\s*(?:me )?(?:a |the )?(?:report|summary)|(?:report|summary) only)\b/.test(text);
  if (!report || !stop) return false;
  // A delivery instruction at the end of an implementation request is not an
  // immediate stop. Explicit cancellation still wins over an earlier work clause.
  const immediateStop = /\b(?:stop|halt|pause|cancel)\s+(?:now|immediately|the task|the work)\b|\b(?:don't continue|do not continue|no more work|no further work|no need to (?:do|work|continue)|(?:don't|do not) do (?:anything|other)|nothing else|no (?:need for )?(?:other|further) (?:things|actions|changes))\b/.test(text);
  if (immediateStop) return true;
  const reportIndex = text.search(/\b(?:report|summary|summarize|summarise|status update)\b/);
  const precedingWork = text.slice(0, reportIndex);
  const workFirst = /(?:^|[.!?;\n]\s*|,\s*|\bthen\s+)(?:please\s+)?(?:create|build|make|implement|fix|repair|edit|modify|update|refactor|test|verify|run|inspect|research|investigate|compare)\b/.test(precedingWork.trim());
  return !workFirst;
}
module.exports = { isReportOnlySteer };
