# Fast research incident: acknowledgment and report recovery

The incident attachment showed three acknowledgment failures before any search,
third-party sources used for a current Google model lookup, unavailable answer
review, repeated review after interruption, and concatenated drafts/reports.

## Changes

- Acknowledgment delivery and tool execution have separate failure paths. Voice
  rendering makes one bounded attempt (12 seconds), then uses an exact native
  language voice if available (8-second bound), otherwise retains visible
  acknowledgment. Renderer failure puts auxiliary voice attempts on a 60-second
  cooldown. Cancellation/corrections still prevent the old dispatch. Matched
  spoken acknowledgments finish playback before execution.
- Final review ends work for the current user request. Interrupted delivery can
  replay its report but cannot authorize another review or action. The controller
  also retains unavailable-review results until a new human task update. Provider
  key attempts remain bounded within the original reviewer invocation.
- Reports reuse their transcript ID, even when the obstacle wording changes.
  Fast displays the latest answer for a user turn rather than concatenating all
  drafts. Research drafts stay behind the evidence gate during streaming.
- Reviewer outages produce a short localized explanation and the actual read
  URLs. They do not expose internal requirement sentences, HTTP codes, rejected
  model announcements, or claim overall success. Full diagnostics remain in logs.
- Current Google/OpenAI model questions, including Romanized Bangla, use official
  model catalogs first. A failed catalog can use one publisher-scoped lookup;
  secondary pages cannot verify current model claims. These rules do not add new
  PC permissions or change model/worker defaults.
- The automatic one-source answer check maps the controller's observed source
  passage to the draft before requesting semantic review. Model-authored repairs
  receive exact corrected provenance fields. Independent support checks remain.

## Validation

- `npm run check:fast-reliability`: 241 passing regressions, followed by passing
  browser integration, AudioWorklet interruption and Web Audio playback ordering
  checks. Those browser/audio checks use synthetic input, not a physical mic.
- `npm run build`: TypeScript and Vite build passed. Existing large-bundle
  warnings remain.
- `node scripts/check_fast_acknowledgments_research_live.cjs --incident --single`:
  actual Fast Live connection, original Romanized Bangla question, public Google
  catalog retrieval, PCM counted in Node. One page retrieval, no repeated search,
  no unacknowledged external operation, one delivered final report. The external
  reviewer returned HTTP 429/403/403; status correctly remained blocked. This run
  used the initial 6-second acknowledgment bound before it was raised to 12
  seconds to allow ordinary voice render latency. It finished in about 75 seconds.
- `node scripts/check_fast_acknowledgments_live.cjs --bangla --production-budget`:
  final 12-second policy, real provider, three acknowledgments. One passed exact
  audio/transcription validation; two returned missing/mismatched transcription
  and were rejected. Unit tests verify native/visible fallback continues once,
  cooldown avoids repeated renderer attempts, and corrections prevent dispatch.

Reports: `scripts/fast-research-incident-fix-live.report.json` and
`scripts/fast-acknowledgments-budget-live.report.json`.

## Remaining limits

Provider permissions/quota errors remain external obstacles: this change cannot
restore rejected credentials or claim the unsupported answer is complete. Exact
spoken acknowledgment delivery remains dependent on provider transcription or an
installed native language voice. Neither physical microphone/speaker behavior
nor a newly packaged Windows executable was validated. The development project
needs to be restarted to load changed Electron controller modules. Production
readiness and zero bugs are not established by this validation.
