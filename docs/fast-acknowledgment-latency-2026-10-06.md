# Fast acknowledgment startup — implementation and validation

Date: 6 October 2026. Implementation complete; user-facing latency release gates remain unmet/unverified.

## Implemented behavior

- Generate a fresh, complete acknowledgment, normally 4–6 words, describing the intended operation and subject. No preset sentences or sentence cache. Explicit English/Bangla language instructions remain effective, including intervening style instructions.
- Use compact action context instead of asking the progress model to summarize the entire request. Accept complete English progressive phrases such as “I am listing…” without unnecessary incomplete-sentence repair. Record overlong responses; never truncate audio to meet a length target.
- Select a conservative known first page read before acknowledgment generation for explicit read URLs and clear current-model catalog requests. Reject ambiguous, negated, hypothetical and unfinished requests.
- For other typed work, overlap main-model action selection with acknowledgment generation. Buffer proposals and answers until generation and actual playback drain finish. Execute one tool at a time.
- For microphone requests, reuse the existing main session's transcript/proposals rather than resending the utterance. Prepared speech is released only after the completed request matches topic, language and exact operation; corrected or stale preparation is discarded.
- Track exact operation name and arguments for explanation coverage. Changed parameters require a fresh explanation. Explicitly requested fresh pages are read before the work finishes, even when previous turns supplied similar evidence.
- Retained-information follow-ups skip a redundant opening work acknowledgment. Any subsequent proposed tool still receives its own explanation.
- Keep the progress connection warm and retry warmup once after idle connection loss. Report preparing acknowledgment, speaking, selecting an action and executing through existing progress callbacks.
- Preserve approvals, Stop, fresh observed targets, duplicate protection, one result check and the 600ms voice endpoint. Preserve direct final-answer delivery and streaming; final-answer verification remains removed.
- Retain the six-second speech-start deadline and bounded incomplete-sentence repair. Once audio starts, allow it to finish. Failed speech leaves the action undispatched and reports the obstacle.

Primary files: `src/fastProgressVoice.ts`, `src/fastProgressPreview.ts`, `src/fastConversation.ts`, `src/simpleFastResearch.ts`, `src/simpleFastVoice.ts`.

## Final paired warm benchmark

Each version ran 30 typed requests and 30 scripted transcript endpoints. The acknowledgment connection was ready before each measured request. English/Bangla prompts mixed public model-page reads and safe workspace observations. Percentiles use nearest rank.

**Scope:** real acknowledgment Live provider, timed PCM playback simulation, fixture main-model proposals and page contents, safe local file observations. Scripted transcript endpoints are not physical microphone requests. These measurements establish acknowledgment/dispatch behavior, not full research accuracy or human-perceived audible latency.

| Input / metric | Baseline | Candidate | Target |
| --- | ---: | ---: | ---: |
| Typed first PCM median | 1,157ms | 1,246ms | ≤1,000ms |
| Typed first PCM p95 | 5,369ms | 2,272ms | ≤2,000ms |
| Typed opening acknowledgment complete p95 | 10,993ms | 4,579ms | ≤4,000ms |
| Typed ready dispatch after drain p95 | 3ms | 16ms | ≤100ms |
| Scripted transcript first PCM median | 188ms | 408ms | ≤1,000ms |
| Scripted transcript first PCM p95 | 1,748ms | 5,710ms | ≤2,000ms |
| Scripted transcript opening acknowledgment complete p95 | 6,430ms | 8,074ms | ≤4,000ms |
| Scripted transcript ready dispatch after drain p95 | 3ms | 5ms | ≤100ms |

Candidate visible callback maximum was 1ms in this harness; that does not measure browser paint. Across all candidate acknowledgments, completion p95 was 4,607ms. All 60 candidate acknowledgment/dispatch probes completed, with zero premature dispatches. The baseline completed 49/60. The candidate improved typed tail latency and completion reliability, but did not improve every latency statistic. The first-audio and completion targets are not all met.

Candidate slow cases included one failed silent preparation followed by fresh generation (maximum first PCM 7,816ms), and a warm-ready request whose first PCM took 5,710ms. Logs show elapsed time after requesting generation, but do not isolate provider versus network cause.

Final artifacts:

- [Baseline warm results](../scratch/fast-ack-baseline-warm.report.json)
- [Candidate warm results](../scratch/fast-ack-candidate-warm.report.json)
- Matching `.log` and compiled `.cjs` snapshots are retained in `scratch`.

### Every unsuccessful baseline probe

| Mode | Request IDs | Observed obstacle |
| --- | --- | --- |
| Typed | 3, 9, 15, 21, 27 | Complete “I am listing the files in your workspace.” was classified as incomplete; repair failed and dispatch was withheld. |
| Typed | 11 | Acknowledgment generation unavailable; no progress sentence recorded and no dispatch. Logs do not establish a more specific cause. |
| Scripted transcript | 3 | Last progress sentence was “I will list the files in your workspace.”; generation unavailable and no dispatch. No incomplete-sentence warning was recorded. |
| Scripted transcript | 9, 15, 21, 27 | “I am listing the files in your workspace directory.” triggered incomplete-sentence repair, then unavailable generation and no dispatch. Request 9 logged two repair warnings. |

Candidate unsuccessful probes: none. A failed silent preparation that recovered is still included in latency measurements.

Earlier datasets are preserved but not used for the final comparison. An initial short harness timeout allowed contamination from a pending prior request. Intermediate scripted tests incorrectly submitted the full cumulative transcript twice; corrected tests submit only the final transcript delta. Intermediate favorable typed timings are not substituted for the final warm measurements.

## Other validation

- `npm run check:fast-reliability`: **350/350** tests passed, plus browser/Web Audio fixtures. Coverage includes exact operation coverage, changed arguments, preparation overlap without concurrent execution, playback ordering, Stop, approvals, language directives, retained follow-ups, corrected partial transcripts, connection loss and failed speech. Log: `scratch/fast-ack-reliability.log`.
- `npm run build`: TypeScript and production Vite build passed. Existing large-chunk warnings remain. Log: `scratch/fast-ack-build.log`.
- Four-turn real Live/public-page regression: all seven audits passed. Operation counts were **0 / 2 / 2 / 0**; all final deliveries completed and operations were sequential with one result check. Final turn durations were approximately 3.9s / 35.6s / 61.4s / 19.6s. This was typed input with counted PCM, not speaker playback. Report: [live regression](../scratch/simple-fast-work-loop-live.ack-final.report.json).
- Initial live regression exposed a missing second explicitly requested fresh read. That was corrected and covered by regression tests; the failed historical report remains `scratch/simple-fast-work-loop-live.ack-startup.report.json`.
- Local unpacked Windows package built successfully with `electron-builder --win --dir`; it is under `scratch/fast-ack-package/win-unpacked`. The final package contains the current controller and acknowledgment prompt, and its actual bundled renderer loaded without page errors in temporary Chromium. Report: [package smoke](../scratch/fast-ack-package.report.json). This does not validate normal executable startup or IPC.
- Actual default internal microphone capture through `AudioEngine` in temporary Chromium passed: 39 PCM frames, running AudioContext, nonzero levels. No fake input device was used; no audio recording was retained or sent to the provider. Report: [microphone access](../scratch/fast-mic-access.report.json).

## Remaining release gates

The requested 30 physical spoken microphone requests, audible acknowledgment/full-playback checks, and normal packaged Windows app execution have not been validated. Device access and synthetic transcript measurements do not substitute for these checks. Warm first-audio and complete-acknowledgment targets need further improvement and real-device measurement before claiming production latency readiness. No model or voice change was made to hide the remaining delay.

Reproduction helpers: `scripts/benchmark_fast_ack.cjs`, `scripts/check_simple_fast_live.cjs --work-loop`, `scripts/check_fast_ack_package.cjs`, `scripts/check_fast_mic_access.cjs`.
