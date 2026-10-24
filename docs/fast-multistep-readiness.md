# Fast multi-step implementation and release evidence

Implementation is available in the workspace. Production readiness is not certified; the live acceptance and normal Windows packaging gates remain open.

## Behavior

- `electron/fast-work.cjs` owns tasks and delegates requirement, dependency and evidence checks to `electron/fast-ledger.cjs`. Typed plan/review bridge methods expose proposals and completion audits, not a model-controlled success flag.
- English and Bangla continuation, addition, correction, replacement and cancellation preserve task identity appropriately. Revised plans preserve unchanged verified steps. Changing the answer step does not discard verified prerequisites. Ambiguous steering waits for clarification.
- Browser and native effects share their existing mutation queue and approval rules. Uncertain effects require fresh reconciliation and cannot be blindly replayed. Independent observations and research reads share a three-read limit.
- Research records retrieved text, URLs and timestamps, and completion reviews validate quoted answer coverage, source excerpts and citations. These checks prove provenance; they do not independently prove semantic entailment of every claim.
- Execution and reply delivery are separate. Missing or interrupted speech does not rerun completed effects. Bounded repair attempts stop repeated invalid plan calls.
- Checkpoints continue at 20 action steps or three minutes. Cumulative limits are 60 action steps or ten minutes, including controller recovery attempts; explicit resume retains completed work.
- The task ledger survives Live connection recovery within the running app session. It is not restart-persistent task storage.

## Verification

- `npm run check:fast-reliability`: 133 automated regressions passed, plus browser integration, actual AudioWorklet with synthetic input, and actual Web Audio drain checks. These are not physical microphone or audible-speaker acceptance.
- Native Windows fixture verification passed Unicode input, invocation, screenshots, stale references, invalid click offsets, cancellation and fresh observations.
- Existing Tiny Workflows suite: 28 tests passed, including approvals, recovery and shared resource serialization.
- Real disposable Chromium acceptance passed tab-target rejection, failed-action audio suppression, fresh input/Enter verification and delayed YouTube search-result regressions using controlled pages. This does not certify the real public YouTube site or a user browser profile.
- `npm run build` passed. Vite retains its existing large-chunk warning.
- The final normal Windows directory build failed during executable resource editing: `After Resource section, sections except for relocation are not supported`. A diagnostic build disables executable resource editing with `--config.win.signAndEditExecutable=false`; this is not a release packaging pass.
- Final diagnostic packaging passed with resource editing disabled. `scripts/check_fast_packaged_smoke.cjs` passed byte matching and loaded the actual packaged main, preload and renderer using the matching Electron runtime and isolated userData. Real IPC plan registration, dependency rejection and false-completion rejection passed. This does not test installation, autostart, the complete packaged executable lifecycle, microphone input or audible delivery.
- `npm run check:fast-multistep:live` runs five separate ten-turn Gemini Live sessions (up to three independent sessions in parallel), English/Bangla research and real native read-only PC observations. Actual PCM is counted, not listened to. Source excerpts and independent desktop observations are retained per request.

## Latest five-session run

Status: release_not_certified. Requests attempted: 50. Fully satisfied: 16/50. Required: 48/50.

| Session | Request | Result | Execution | Remaining obstacle |
|---|---|---|---|---|
| 1 | 1 | completed | blocked | Required outcomes remain unverified |
| 1 | 2 | completed | blocked | Required outcomes remain unverified |
| 1 | 3 | completed | partial | Required outcomes remain unverified |
| 1 | 4 | completed | completed |  |
| 1 | 5 | completed | completed |  |
| 1 | 6 | completed | completed |  |
| 1 | 7 | completed | completed |  |
| 1 | 8 | completed | blocked | Required outcomes remain unverified |
| 1 | 9 | completed | completed |  |
| 1 | 10 | completed | completed |  |
| 2 | 1 | completed | partial | Required outcomes remain unverified |
| 2 | 2 | completed | partial | Required outcomes remain unverified |
| 2 | 3 | completed | partial | Required outcomes remain unverified |
| 2 | 4 | completed | partial | Required outcomes remain unverified |
| 2 | 5 | completed | partial | Required outcomes remain unverified |
| 2 | 6 | completed | partial | Required outcomes remain unverified |
| 2 | 7 | completed | blocked | Required outcomes remain unverified |
| 2 | 8 | completed | blocked | Required outcomes remain unverified |
| 2 | 9 | completed | partial | Required outcomes remain unverified |
| 2 | 10 | completed | partial | Required outcomes remain unverified |
| 3 | 1 | completed | partial | Required outcomes remain unverified |
| 3 | 2 | failed | unconfirmed | Two plan repair attempts exhausted: Supply the exact planned stepId, or extend the plan for this operation. |
| 3 | 3 | completed | partial | Required outcomes remain unverified |
| 3 | 4 | completed | completed |  |
| 3 | 5 | completed | partial | Required outcomes remain unverified |
| 3 | 6 | completed | partial | Required outcomes remain unverified |
| 3 | 7 | completed | completed |  |
| 3 | 8 | completed | blocked | Required outcomes remain unverified |
| 3 | 9 | completed | partial | Required outcomes remain unverified |
| 3 | 10 | completed | partial | Required outcomes remain unverified |
| 4 | 1 | completed | partial | Required outcomes remain unverified |
| 4 | 2 | completed | blocked | Required outcomes remain unverified |
| 4 | 3 | completed | completed |  |
| 4 | 4 | completed | completed |  |
| 4 | 5 | completed | partial | Required outcomes remain unverified |
| 4 | 6 | completed | partial | Required outcomes remain unverified |
| 4 | 7 | completed | partial | Required outcomes remain unverified |
| 4 | 8 | completed | blocked | Required outcomes remain unverified |
| 4 | 9 | completed | partial | Required outcomes remain unverified |
| 4 | 10 | completed | completed |  |
| 5 | 1 | completed | partial | Required outcomes remain unverified |
| 5 | 2 | failed | paused | Two plan repair attempts exhausted: Unknown step ID. |
| 5 | 3 | completed | completed |  |
| 5 | 4 | completed | completed |  |
| 5 | 5 | completed | completed |  |
| 5 | 6 | completed | completed |  |
| 5 | 7 | completed | completed |  |
| 5 | 8 | failed | working | No completed answer within 240 seconds |
| 5 | 9 | completed | partial | Required outcomes remain unverified |
| 5 | 10 | completed | partial | Required outcomes remain unverified |

Raw aggregate: `scripts/check_fast_multistep_live.report.json`. Per-session reports and transcripts contain tool calls, evidence, completion reviews, independent desktop observations and every unsuccessful request.
Structural review of all 50 requests and the 34 unsuccessful requests: `scripts/check_fast_multistep_audit.report.json`. It identifies missing evidence, unmet prerequisites, invalid step IDs, source failures and incomplete delivery. Semantic claim accuracy remains a separate release gate.

A subsequent ten-turn development smoke satisfied 4 of 10 requests (`scripts/check_fast_long_conversation.multistep-current-smoke.report.json`). It started before the final dependency-evidence and invalidated-source fixes. Neither live run certifies the final code; the automated regressions cover those later fixes.

## Release gates still required

- At least 48 of 50 requests fully satisfied on identical code, with every unsuccessful request reviewed.
- Independent semantic audit of research claims and independent verification of live mutation recovery. Read-only conversations cannot establish zero duplicated live mutations.
- Physical microphone, real user interruption and audible English/Bangla responses.
- Matched pre-change simple-task latency baseline and p95 regression at or below 10%; current durations alone are not a comparison.
- Full packaged Windows executable and installer acceptance.

Known live obstacles include unreadable competitor sources, incomplete source-to-answer mappings, and provider/delivery failures. They remain explicit partial/blocked/unconfirmed results, not release passes.
Tracked code differed across sessions or the run is still pending. Treat this as development evidence until an identical-code run finishes.

Google references: [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities).
