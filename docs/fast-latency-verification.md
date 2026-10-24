# Fast latency verification — 2026-10-07

## Implemented

Local routing for conversation, local clock facts, lookups, actions and clarification; ordinary replies stream without another classification call. Fast forwards microphone PCM during speech and uses provider-confirmed interruption (350 ms silence, 120 ms prefix padding). Typed interruption reuses the Live connection. Read-only search/page requests overlap validated progress speech; mutations retain approval and sequential dispatch. Interrupted reads are cancelable and settled evidence is retained; uncertain mutations are blocked from automatic replay.

Clock context is refreshed for each turn, defaults to Asia/Dhaka and recognizes explicit IANA zones and named cities. Unresolved locations ask for clarification. Status clears when playback starts and after delivery. Logs identify turn ownership and separate local classification, first provider output, buffering, tool settlement, playback and interruption.

## Results and limits

- TypeScript and production build passed. Vite reports the existing large-chunk warning.
- Focused latency, grounding and voice interruption checks: 103 passed. Separate search/key and acknowledgment checks: 36 passed. Backend JavaScript syntax checks passed.
- Twelve dedicated latency checks include ten synthetic typed turns, ten synthetic PCM activity cycles, dispatch before acknowledgment, settled-read cancellation, stale output, interrupted transcript ownership and unknown mutation outcomes. Synthetic playback starts within 100 ms and stopping within 200 ms were asserted; these are local mocked checks.
- Ten typed turns with the real Live provider completed. First-audio median **1,398 ms**, slowest **5,143 ms**, fastest **803 ms**. App audio handoff delay median **1 ms**, slowest **2 ms**. PCM was counted; no physical speaker playback was measured. See `scratch/fast-latency-live.report.json` for turn-level records.
- Local classification median **0.040 ms**, slowest **1.788 ms** across those ten typed turns. Routing was not responsible for the multi-second provider waits.
- The older `check_simple_fast.cjs` suite remains at **71 passed / 37 failed**. Several assertions enforce superseded behavior: disabled interruption, microphone suppression during speech, waiting for speech before reads, mandatory catalog reads, and stopping tools on acknowledgment failure. Its fixtures and remaining assertions require migration/audit; this work does not claim the full historical reliability suite passes. Detailed output: `scratch/fast-legacy-regressions.txt`.
- Physical microphone, speaker echo, real interruption timing, and speech-end-to-playback median/slowest are **pending user testing**. No guarantee of instant provider output: two live typed turns waited about five seconds before first audio.

## Ten real microphone turns

Restart the desktop app so the changed main-process cancellation IPC loads. Select Fast, enable the microphone and use the speakers you normally use. Speak each turn separately:

1. `hi`
2. `ki koro?`
3. `valo asi tmi kmn aso?`
4. `thanks`
5. `kota bje?`
6. `London e ekhon time koto?`
7. `amar sathe ektu kotha bolo`
8. Ask for a short story, then interrupt it by saying `থামো` while it speaks.
9. `latest Google models search koro`, then interrupt during the lookup with `থামো, এখন সময় বলো`.
10. `তুমি কি শুনতে পাচ্ছ? সংক্ষেপে বলো`

Paste the complete terminal log, including microphone speech start/end, transcription completed, request classified, first audio, conversation playback started, interruption and tool settlement lines. Note whether Orvix hears its own speaker output or fails to stop. These observations are needed to calculate real speech-end-to-playback timings and assess echo.

Commands: `npm run check:fast-latency`, `npm run check:fast-latency:live`, `npm run build`.

## Informational planning route follow-up — 2026-10-07

The live multistep tea-plan request was misrouted as `action`, creating a seven-part plan and leaving one part pending while Orvix spoke a partial answer. Fast now has a distinct `planning` route: informational recipes, schedules, and ordered plans receive direct-answer instructions; explicit reminders, calendar changes, and computer actions remain `action`.

After this routing change, 104 focused checks passed and `npm run build` passed. The same real-provider prompt and follow-up both routed as `planning`, made zero tool calls, logged no incomplete plan, and answered the requested quantities, order, sugar-free option, ginger adjustment, and timing follow-up. Provider response completion still took about 20.6 seconds and 21.0 seconds respectively, despite first audio arriving at 2.1 and 1.8 seconds; this route buffers the response until completion. The live harness counts PCM and does not establish speaker playback.
