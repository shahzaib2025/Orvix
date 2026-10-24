# Fast staged acknowledgments — 6 October 2026

Fast now queues a complete spoken acknowledgment before each requested tool call. Additional research searches, source reads, contact-page recovery, browser inspection recovery, automatic weather lookups, and final completion review also receive acknowledgments. Independent reads retain their concurrency allowance; progress audio is serialized.

The controller chooses the wording from the actual operation and observed results. It distinguishes Google research, OpenAI research, comparison/review, failed attempts, uncertain effects, pending approvals, and missing choices. It says it has read a publisher's page only after a substantive direct-page read, and does not say that this establishes the latest-model ranking or completes the comparison. A missing comparison source changes the acknowledgment to checking evidence gaps. Raw paths, entered text, and model-authored step titles are kept out of spoken progress templates; acknowledgment telemetry records tool and task metadata.

A separate tool-free voice renderer uses the same configured Fast model and default voice configuration. It supplies explicit transcription language hints, buffers audio, checks the complete transcription against the intended sentence, and retries voice rendering once if necessary. Verified audio is cached in this session, bounded to 24 entries and four million base64 characters. Execution waits for actual playback to drain. Cancelled or mismatched acknowledgments do not authorize execution. This adds generation and playback time to fresh acknowledgments; repeat wording reuses the cached audio.

Reviewed final reports survive acoustic/server interruptions and retained-result recovery. Repeated delivery updates the original report's transcript ID rather than inserting another identical report. An unreviewed draft is not restored as the approved report.

## Validation

- `npm run check:fast-reliability`: 232 regression tests passed on the final implementation. Includes ordering, corrections, concurrent reads, failed plans, pending approvals, missing audio, retry limits, caching, interrupted blocked reports, duplicate-report prevention, and keeping raw input/model-authored claims out of spoken templates.
- Real browser Web Audio check: each of two tools waited for its complete two-buffer acknowledgment to finish. Synthetic PCM and microphone activity; physical microphone and audible speaker delivery were not tested.
- Live voice renderer: all 12 final English/Bangla cases passed complete audio/transcription checks, including planning, Google lookup, OpenAI lookup, reading a source or file, browser actions, and comparison evidence review. Earlier longer Bangla wording produced missing/truncated transcriptions and was shortened. A subsequent broader run passed 10/12 cases; two Bangla cases had no output transcription and were rejected. Explicit language hints were then added, and the final run passed 12/12. This sample does not establish that intermittent provider failures are eliminated. Rendering recovery is bounded; unavailable audio still holds the action.
- Production Fast profile research trials: English Google/OpenAI catalog comparison read both primary pages after five delivered acknowledgments. Bangla Google catalog lookup read its primary page after five delivered acknowledgments. No page retrieval preceded its acknowledgment. An earlier test harness lacked a cancellation adapter between turns; the harness was corrected and the Bangla trial was rerun separately.
- Both research trials delivered `blocked` reports. Independent evidence review returned HTTP 503/429/403 in the comparison and HTTP 429/403/403 in the Bangla trial. These trials establish progress/delivery behavior, not successful final research verification.
- `npm run build`: TypeScript and production bundling passed on the final implementation. Vite reports its existing large-chunk advisory.

## Evidence

- `fast-acknowledgments-reliability.log` and `fast-acknowledgments-build.log` — final local checks.
- `fast-acknowledgments-live.report.json` — real voice audio/transcription measurements.
- `fast-acknowledgments-research-initial.report.json` — English comparison and initial harness interruption.
- `fast-acknowledgments-research-live.report.json` — separate Bangla research trial.

No packaged Windows acceptance, physical microphone/speaker acceptance, simple-task p95 comparison, or 50-request production release benchmark was performed for this change. Provider-dependent verification remains a release limitation. This work does not claim production perfection.

Protocol references: [Google Live tool handling](https://ai.google.dev/gemini-api/docs/live-api/tools) and [server generation, transcription, interruption, and turn boundaries](https://ai.google.dev/api/live).
