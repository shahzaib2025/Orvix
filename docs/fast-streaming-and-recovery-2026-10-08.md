# Fast acknowledgment, response streaming and recovery

Implemented in sequence, with focused tests after each change.

## Changes

1. Fresh acknowledgments stream generated PCM as it arrives. Complete generation and actual playback still finish before a tool executes. Returned PCM is not played a second time. If an attempt fails after scheduling audio, recovery waits for that audio to drain. Continuing audio refreshes an inactivity deadline instead of imposing a speech-duration cutoff.
2. Replies backed by retrieved pages or successful searches can stream the original main-session voice. Previously buffered opening chunks are retained when transcript-based eligibility becomes available. Search limitations remain visible in the report and are requested in the model's spoken answer. If the model omits the spoken disclaimer, the controller records its visible-only qualification instead of discarding existing audio and regenerating the entire answer. This does not establish independent factual verification of a search snippet.
3. A later microphone transcript and its tool proposals receive their own request identity and route, including when the provider does not send an interruption event. The new request waits for scheduled speech and active controller work. Local screen/memory command handlers still apply. Stop or an explicit typed replacement discards deferred microphone work.
4. Response monitoring distinguishes provider progress from incoming microphone fragments. A 20-second inactivity threshold or 120-second response threshold initiates one reconnect, after playback drains. Retained results are supplied without replaying completed executors. A repeated stall produces an unfinished-answer report and stops the failed session. Provider interruption events do not clear scheduled playback; microphone activity uses `NO_INTERRUPTION`. Explicit Stop remains available.

Small supporting corrections preserve explicit English instructions such as “compare ... in two English sentences” without treating “English literature” as a language switch. Research instructions now emphasize reading missing sections of truncated pages and avoid the older instruction permitting search execution during progress speech.

No model change, new screen-sharing tool, or separate answer-verification service was added. Existing approvals and quick focus/minimize/maximize behavior remain.

## Measured latency

The latest complete 20-turn Live run had ten work requests, ten research follow-ups and thirteen actual search/page operations. Playback was counted/scheduled by the test harness; these are not physical microphone or speaker measurements.

| Measurement | Median | Nearest-rank p95 | Samples |
|---|---:|---:|---:|
| User request to first acknowledgment playback | 867 ms | 1868 ms | 10 work requests |
| Acknowledgment generation start to playback | 804 ms | 929 ms | 13 operations |

Six of ten work requests began their acknowledgment within one second of receipt. Requests requiring main-model action selection took longer. A previous ten-request streaming pilot had a 1155 ms playback median among eight delivered acknowledgments, two persistent provider timeouts, and one recovery that delayed playback to 10196 ms. These runs show improvement, not a universal one-second guarantee.

The earlier buffered baseline had a 4060 ms median and 5056 ms p95 across ten successful acknowledgments. Baseline and candidate were separate live runs with changing provider conditions, not a controlled latency release gate.

## Validation and remaining limits

- Forty-one focused tests passed: streaming before generation completion, no duplicate PCM, dispatch after playback, failed generation, cancellation, native fallback ordering, exact voice recovery, source limitations, buffered opening audio, language handling, microphone turn ownership and response recovery without executor replay.
- Real Chromium/Web Audio fixtures passed. Search dispatch occurred after scheduled synthetic speech drained (1300.1 ms wait in the recorded run). Reply audio scheduled with 34 ms buffering and zero automatic playback cutoffs. Retrieval and PCM were fixtures.
- TypeScript/Vite production build passed; the existing bundle-size warning remains.
- The first full 20-turn run delivered 17 spoken reports and three written-only reports. A second complete run delivered 19 spoken reports and one written-only report. Tool calls were sequential and explained before execution in both runs.
- After correcting the original-audio retention path, all four focused Live retest turns spoke successfully. Both Florian BD questions streamed their missing-evidence reports; the custom-function execution question and its Bangla follow-up also spoke. These retests used real Live generation and public retrieval with counted PCM.
- The broader legacy regression selection completed with 207 passes and 37 failures out of 244 tests. It is not a green release gate. Many failures concern earlier controller/acknowledgment behavior; their complete output is retained rather than hidden.

Spoken delivery counts are not counts of fully satisfied or factually audited tasks. The full conversation audit found an unsupported absolute claim that Florian BD has no recognized competitors, and an answer that explained function calling without directly resolving who executes the code. The focused retest used missing-evidence wording and correctly identified the application as the executor. Google's [function-calling guidance](https://ai.google.dev/gemini-api/docs/function-calling) explicitly separates model proposals from application execution. Reliable claim coverage and identification of an ambiguous business remain broader research-quality work, not proven solved by these streaming changes.

The normal packaged Windows app, physical microphone capture, speaker echo behavior and audible playback have not been validated here. Do not claim production readiness or universal instant response from these tests.

## Evidence and repeat commands

- `scratch/simple-fast-live.streaming-final.report.json`: first 20-turn run.
- `scratch/simple-fast-live.streaming-release-check.report.json`: second 20-turn run, 19 spoken deliveries.
- `scratch/simple-fast-live.streaming-original-audio.report.json`: final four-turn focused retest, four spoken deliveries.
- `scratch/fast-search-ack-streaming-latency.report.json`: earlier ten-request streaming pilot, including unsuccessful requests.
- `scratch/fast-streaming-focused-regression.log`, `scratch/fast-streaming-broad-latest.log`, `scratch/fast-streaming-ack-web-audio.log`, `scratch/fast-streaming-reply-web-audio.log`, `scratch/fast-streaming-recovery-build.log`.

Repeat focused checks with `node --test scripts/check_fast_instant.cjs scripts/check_fast_required_search_ack.cjs scripts/check_fast_progress_completion_deadline.cjs`. Run the full online conversation with `node scripts/check_simple_fast_live.cjs --streaming-regression --tag=your-run-name`; run targeted cases with `--streaming-retest`. The conversation harness waits for controller cleanup before sending another request.
