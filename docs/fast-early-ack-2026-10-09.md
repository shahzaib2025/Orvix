# Fast early research acknowledgment — 2026-10-09

The first acknowledgment no longer waits for Gemini to propose a tool on clear, completed research requests with no known first operation. Typed action selection runs alongside fresh acknowledgment generation. Microphone requests use the main session already generating; they are not submitted again.

Changed: `src/simpleFastVoice.ts` (`beginTask`), `src/simpleFastResearch.ts` (`earlyResearchAcknowledgment`), and focused regressions in `scripts/check_fast_required_search_ack.cjs`. Known-operation fast paths, single-tool execution, approvals, cancellation and result checks are preserved. Chat, retained-information follow-ups, incomplete and conditional/negated research requests skip this early acknowledgment.

An opening acknowledgment expresses research intent. It cannot cover unknown tool arguments. The selected operation therefore still receives its own explanation; dispatch waits for that explanation's playback onset. This deliberately avoids treating a generic acknowledgment as permission or exact action coverage.

## Measured competitor request

Same prompt: Search for Florian BD competitors and compare one documented aspect. Do not invent competitors or facts; label missing evidence. Reply briefly in English.

| Measurement | Earlier conversation | Candidate retest |
|---|---:|---:|
| First acknowledgment generation requested | 2,792 ms | 7.2 ms |
| First acknowledgment audio at harness renderer | 3,494 ms | 944 ms |
| First tool proposal queued | — | 1,596 ms |
| First tool dispatch | — | 4,318 ms |

This fixes the initial silent selection wait, not overall completion speed. An extra prospective acknowledgment can delay tool dispatch because the exact operation explanation follows it. The competitor answer remained incomplete because the retrieved results did not establish the requested competitor comparison. Research evidence quality remains a separate issue.

## Validation and scope

- 49 focused tests passed, including delayed proposal, microphone no-resend, fresh exact operation explanation, Stop, English/Bangla eligibility and retained-information exclusions.
- Actual Chromium Web Audio fixture passed; dispatch occurred 0.7 ms after onset while synthetic audio remained active.
- Production build passed, with existing chunk-size warnings.
- Four live Gemini/retrieval turns completed; all five tools were sequential and explained before dispatch. Bangla retained-information follow-up did not retrieve again.
- Live provider test uses typed input and mocked playback timing callbacks. PCM was received, but physical microphone/speaker and packaged Windows app latency were not validated. One retest is not a latency percentile benchmark.

Evidence: `scratch/simple-fast-live.early-ack-20261009.report.json`, `scratch/fast-early-ack-live.log`, `scratch/fast-early-ack-tests.log`, `scratch/fast-early-ack-build.log`. Baseline: `scratch/simple-fast-live.conversation-check-20261009.report.json`.
