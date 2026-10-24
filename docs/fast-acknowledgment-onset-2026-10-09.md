# Fast acknowledgment-onset execution — 2026-10-09

## Implemented sequence

Prepare the existing executor and freshly generated narration. Schedule streamed PCM. Release ordinary tool dispatch only when the running renderer's audio clock reaches the first non-silent sample. Continue narration and ONE executor concurrently. Check and retain the executor outcome immediately. Await narration completion before returning the result to Gemini. Deliver the existing streamed final response. Cancellation, approvals, lifecycle checks and uncertain-mutation receipts remain active.

The existing quick minimize/maximize/focus exception is preserved. Granted-approval resumptions use the onset gate. Installed-voice fallback uses its actual speech-start callback. When narration fails before onset, one bounded generation attempt ends with an explicit visible action notice; this notice does not grant permission or claim success. Failure after onset does not repeat narration or the executor.

## Confirmed bottlenecks and changes

- `src/simpleFastVoice.ts`: `runTool` previously awaited complete `acknowledge()` generation and playback before dispatch. It now releases on renderer onset and joins narration before submitting the result. `runApprovedAction` uses the same ordering. `acknowledge` tracks generated, scheduled and started audio separately, avoids speech retries after dispatch, and logs overlong wording. Every logged event now also carries a renderer-local monotonic elapsed time; legacy wall-clock fields remain for compatibility. Derive stage durations from the monotonic fields rather than mixing clock origins.
- `src/audioEngine.ts`: `playAudio` accepts an optional onset callback, rejects unavailable/suspended output, skips leading silent samples, and checks the running audio clock. Cleared sources cannot release a late gate. Audio is streamed and never replayed merely to announce onset.
- `src/fastAcknowledgmentStyle.ts`, `src/fastProgressVoice.ts`: first-topic research narration normally requests 2–4 freshly generated words; related short responses remain 1–2 words. Recovery and existing-tab explanations may be longer. No prerecorded voice, sentence cache, new model or dependency was added. Spoken output is not truncated to enforce word counts.
- `src/simpleFastFlow.ts`: model instructions now describe onset-first execution rather than waiting for narration drain before dispatch.
- `electron/youtube-control.cjs`: browser inventory requests have a 3-second transport deadline; page observation requests have 8 seconds; mutations/navigation retain 30 seconds. Timed-out and settled request IDs are retired in a bounded set; late messages cannot resolve a newer job. Observed action inventories refresh the cache immediately, and older inventory revisions are rejected.
- `PC-Monitor-Test/extension/browser-background.js`: observations have bounded waits and explicit cancellation; hung reads release the extension queue. Error reconciliation reads are bounded to 1.5–2 seconds. Background inventory publication no longer delays a command response. Unknown mutation effects are not automatically replayed.

The inventory-cache update fixes a race exposed during testing: an immediate read after closing a tab could otherwise return the pre-close tab count while the separate publication was pending.

## Validation and measurements

Repeat focused checks with `npm run check:fast-onset`.

- 44 focused tests passed: onset gating, early result retention, sequential calls, Stop before onset and during execution, post-onset generation failure, visible failure fallback, granted approvals, executor preparation failure, tool failures, language behavior and existing barge-in/streaming behavior.
- Actual Chromium Web Audio with synthetic tone PCM, including leading silence, passed. Tool dispatch occurred approximately 0.8 ms after renderer onset while audio continued. This tests the scheduler, not a physical speaker. The previous fixture deliberately waited for roughly a second of acknowledgment playback before dispatch; the new fixture asserts dispatch within 100 ms of onset.
- 23 isolated Chromium/production-extension scenarios passed. Websites and YouTube content were controlled fixtures. A deliberately hung page observation ended in 8,018 ms; a subsequent fresh page observation succeeded in 15 ms. Navigation, explicit tab reuse/new tabs, stale targets and reconnects also passed. Socket tests separately covered immediate action failure, read timeout, late responses, retired IDs, longer navigation deadlines and unknown mutation outcomes without replay.
- Ten warm typed acknowledgment-provider requests: all ten generated/delivered acknowledgment text and audio, one executor dispatch each. First audio scheduling proxy: median 1,064 ms, nearest-rank p95 1,356 ms. Generation completion: median 3,623 ms, p95 4,301 ms. Median generation remaining after first audio was 2,555 ms; the executor no longer waits for this. Retrieval and playback in this provider benchmark were fixtures; these are not microphone-to-speaker measurements.
- Four real Live/public-retrieval turns delivered all four responses with the expected onset ordering and a maximum of one active executor. Topics included Florian BD, competitors, application execution of function calls, and a Bangla retained-information follow-up. Playback was a fixture.
- Production build passed with existing bundle-size warnings.

Historical buffered acknowledgment baseline: median 4,060 ms and p95 5,056 ms over ten successful samples, recorded in `docs/fast-streaming-and-recovery-2026-10-08.md`. This is not a controlled before/after provider comparison: run conditions and playback fixtures differ. The directly demonstrated improvement is removal of the complete-generation/playback dispatch barrier.

Evidence: `scratch/ack-onset-focused.log`, `scratch/fast-search-ack-latency-live.report.json`, `scratch/simple-fast-live.ack-onset-retest.report.json`, `scratch/browser-tab-reuse-live.report.json`, `scratch/ack-onset-browser-integration.log`, `scratch/ack-onset-browser-bridge.log`, `scratch/ack-onset-build.log`.

## Remaining limits

The broader reliability command completed 369 tests with 326 passes and 43 failures; it did not pass its release gate. Failures include older completion-before-dispatch, speech-failure blocking and prior voice/preparation expectations. Full output is retained in `scratch/ack-onset-reliability.log`; the targeted success is not a substitute for resolving that suite.

Research accuracy is a separate unresolved gate. The Florian BD run retrieved similarly named social profiles, and the competitor reply used overly broad absence wording. Four delivered responses do not mean four fully correct research answers. No research-policy rewrite was included in this latency change.

Real microphone endpoint timing, hardware audible onset, physical echo/barge-in and the packaged Windows app have not been validated in this run. The 30-typed/30-microphone release benchmark and physical playback gates remain open. Provider/network latency remains variable; sub-one-second acknowledgment onset is not guaranteed. No production-readiness claim is made.
