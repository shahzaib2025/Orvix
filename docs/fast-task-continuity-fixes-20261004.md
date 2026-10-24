# Fast task continuity and report fixes

Validation date: October 4, 2026 (Asia/Dhaka).

## What changed

- The reply watchdog now measures a gap in incoming output. Active audio/text packets refresh it, including audio held for evidence review. The old timer could interrupt a valid long answer after 45 seconds, then prevent its completion audit. Initial text requests also arm recovery, and metadata-only function boundaries cannot clear it or finish an empty report. A completely silent connection receives one fresh connection only when no action has executed; the pending controller work can then continue. Final-report recovery still blocks new effects but permits reviewing retained evidence. A transport that ignores bounded recovery is closed rather than reused for subsequent requests.
- Completed English/Bangla continuation and detail requests preserve task identity, verified evidence, and pending approvals. A spoken acknowledgement never grants approval. Greetings skip task creation and completion review.
- Text requests wait for their updated ledger before reaching Live. Known Bangladesh weather requests, including `get_weather`, receive a controller checklist for the requested cities. Redundant model plans retain that checklist. Weather acknowledgements and incorrect temperatures cannot pass review.
- Streamed output transcription preserves repeated words and numbers. Speech comparison preserves Bangla combining marks, negation, decimal values and every word. It accepts ampersand speech and pronounced punctuation only inside the exact reviewed URL; changed domains, query values and facts remain rejected. Missing audio recovery chooses the report after coverage review instead of caching an introduction.
- Approval signatures use canonical argument ordering and label actual window targets. Verified and uncertain mutations are checked before another approval; recovery cannot duplicate them. All-window requests seed a fresh native inventory and separate verified actions for exact observed handles, while keeping desktop opt-in settings.
- Full catalog requests require actual listings, product navigation, contiguous text offsets and pagination coverage. Homepage samples, skipped offsets, truncated navigation and unread published product links remain incomplete. Additive instructions retain previous sources.
- Source-backed outcomes require quote provenance and semantic support even when the model labels them ordinary outcomes. This closes the live-discovered label bypass. Invalid quotation repairs do not call the provider. Failed searches do not establish business nonexistence.
- Progress messages distinguish plans, reviewed completion and unfinished outcomes. Reviewer cooldowns preserve actual provider error codes instead of inventing a quota diagnosis.

## Verification

- Final reliability suite: **182 Node tests passed**, followed by Fast browser integration and real Web Audio/AudioWorklet checks.
- The synthetic AudioWorklet check measured 1 ms detection-to-clear, with capture continuing. Synthetic input is not physical microphone or speaker-echo acceptance.
- Production frontend build passed; the existing large-bundle warning remains. Changed backend modules passed syntax checks and targeted regression tests.
- A read-only native audit established three observed window targets and their controller plan, with no desktop mutations and desktop automation still disabled.
- Regressions cover continuity, omitted requirements, source-label bypasses, malformed quotation repairs, temperature errors, catalogue offsets, exact approvals, duplicate/uncertain effects, reconnects, missing audio and active-output timeout behavior.

## Live checks

The real-provider tests use production `FastVoiceSession`, public page/search/weather services, text input and recorded received/admitted PCM packets. They do not use a physical microphone, audible speaker playback or packaged-app interaction.

Earlier runs exposed the timeout, speech-formatting and source-kind defects above. Their reports are diagnostic evidence, not release acceptance. In the timeout-repaired run, Dhaka and Sylhet weather completed with verified facts and admitted PCM in 10.5 and 11.2 seconds; the retained Sylhet follow-up completed in 14.4 seconds without rerunning weather. The model omitted an explicitly requested function call on that follow-up, although the controller performed a completion audit; the harness flagged that omission.

The ten-request diagnostic run is recorded in `scripts/check_fast_long_conversation.task-continuity-grounded-final-20261004.report.json`. Turn 1 completed with verified weather and admitted PCM. Turns 2 and 3 exposed the initial-response and metadata-boundary timeout gaps and were repaired afterward. Turns 4 and 5 delivered explicit blocked reports in 65.0 and 72.5 seconds, preserving the same business task; malformed or insufficient claim mappings did not become completed findings. Turn 6 received an actual Gemini Live quota error. Subsequent connection attempts failed; remaining requests were stopped without accepting them as completed. The harness now stops after a quota error instead of creating repeated requests. This run is **provider_blocked**, not a successful ten-request acceptance run.

The final-code retest is `scripts/check_fast_long_conversation.task-continuity-initial-recovery-final-20261004.report.json`: both formerly stalled Bangla weather/continuation turns passed, with one model tool call each and admitted PCM. They completed in 16.041 and 13.905 seconds. Their task IDs matched; the first executed one weather read and the continuation executed none. The temperatures, feels-like value and conditions in the answers matched the stored weather results. The source-kind bypass and initial-silence reconnect behavior also passed targeted regressions; the full final suite passed after these changes.

Research execution and answer delivery are assessed separately; a delivered partial report does not count as a fully satisfied research request. The long diagnostic run began before the final timeout changes; the focused retest records those final source hashes. Neither run establishes all release gates.

## Remaining acceptance scope

Research acceptance remains incomplete: the model still failed to repair some quotation/coverage mappings within two attempts, independent evidence review returned actual HTTP 403 permission errors in earlier live runs, and the later long run hit an actual Live quota limit. These are retained as separate failures, never promoted to successful research. Working provider access/quota and a clean full acceptance run are required. This patch does not change models, opt-in worker settings or approval requirements.

Five separate ten-turn acceptance conversations, a comparable simple-task p95 baseline, physical microphone/interruption/audible-response checks and packaged Windows acceptance are not established by these checks. Production readiness is not claimed. Restart Orvix to load the changed backend and built frontend.

## Research basis

Google documents that client content interrupts current Live generation, that input transcription arrives independently, and that generation completion differs from turn completion. These support waiting for settled user input and avoiding unnecessary recovery messages during output: [Live API reference](https://ai.google.dev/api/live). Provider permission and quota errors are distinct: [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting).
