# Fast browser and desktop upgrade

Fast uses task-level browser operations for searches, websites, form input, and media selection. Every action goes through one executor. Windows controls and the Gemini reasoning worker have separate opt-in Settings switches. The worker model defaults to `gemini-3.8-flash`; enabling it requires successful model-access validation using the existing Gemini credentials.

## Running the updated build

Run `npm run build:monitor` and `npm run build`, then restart Orvix. The development launcher prefers `PC-Monitor-Test/bin/PCMonitor.Fast.exe`. Windows packaging copies that updated executable into the normal installed PC Monitor location. If the older monitor is already running, stop that monitor and restart Orvix so its single-instance guard can start the new binary. An old bridge returns `update_required` rather than pretending desktop control worked. Reload the Chrome companion extension to pick up the YouTube changes. Pairing uses the existing PC Monitor token.

Enable **Windows app control** to expose native observation and action tools in a new Fast voice session. Enable **Adaptive reasoning worker** separately. Invalid or unavailable models leave the worker disabled. Recognition hints are experimental and off by default; compare recorded commands with and without them before retaining them.

## Verification and recovery

The in-memory task record retains the goal, corrections, target, verified steps, unresolved steps, and evidence. Fresh live connections restore the bounded transcript and current task. Server resumption handles and GoAway reconnects are supported. Records are retained during the running app session, not across app restarts. Interrupted or uncertain effects require state inspection; they are not automatically replayed.

Typing and selection can complete a verified step. A click or key acknowledgment alone cannot complete the goal. Consequential actions require an expiring, revision-bound approval for the exact proposed action. The controller rejects stale references, protected fields, elevated windows, and secure desktops. Accessibility patterns run first; screenshots and simulated input are fallback paths. Screenshot clicks must use the observed window geometry and generation.

Mutations use one shared interaction queue, including aliases such as `current`. This conservative lock prevents Chrome and native controls from racing focus on the same physical window; independent observations and research reads can run concurrently. Desktop observations invalidate the earlier native control generation, so native observation batches remain sequential.

The worker proposes one structured action at a time. It uses the same executor and stops at 20 steps, three minutes, missing choices, approval, unsupported targets, cancellation, or repeated failures. A model's declaration that it is done is returned for review; only executor evidence establishes completion. Complex summaries receive confirmed steps and explicit obstacles.

Default diagnostics contain operational timings, recovery counts, outcome status, and model usage. Fast transcripts, input values, and screenshots are not written to these diagnostics. Relevant task text and observations are sent to the configured Gemini service to perform the requested workflow; screenshots are requested only when needed.

## Checks and release gate

- `npm run check:browser`: browser bridge, Fast integration, YouTube transitions and playlist selection, reconnect/startup regressions.
- `npm run check:browser:live`: disposable Chromium profile and controlled web fixture; configured Live-model checks run only when requested by that script's option.
- `npm run check:fast-work`: 30 executor scenarios repeated five times plus concurrency, cancellation, bounded-worker, privacy and release-gate checks. These are deterministic adapter tests, not recorded voice benchmarks.
- `npm run check:desktop:native`: compiles PC Monitor and tests an isolated native fixture for Unicode input, accessibility invocation, screenshot capture, stale refs, protected fields, and coordinate bounds. It does not type into user documents.
- `npm run check:voice-interruptions`: local microphone activity detection, both speech-output paths, late response suppression, correction continuity, queued tool cancellation, and continued microphone capture.
- `npm run check:voice-interruptions:browser`: exercises the real Chromium AudioWorklet with synthetic microphone input and measures audible-output queue cancellation against a 500ms limit. This does not certify physical microphone/speaker echo handling.

Fast now performs a local cutoff after sustained activity in echo-cancelled microphone PCM, without waiting for a Gemini transcript. It clears both Web Audio and Windows speech queues, cancels unfinished task actions, and suppresses abandoned response audio until the server interruption or old-turn boundary. Gemini automatic detection remains enabled with high speech-start sensitivity; local activity detection supplements it. A 600ms silence window preserves ordinary pauses within the user's correction. The detector uses adaptive amplitude and waveform checks; it is not a transcription model, and microphone gain, background noise, and speaker echo still require recorded-device testing.

For the real application smoke checks, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check_desktop_native.ps1 -Applications`. This opens Notepad, Calculator, and File Explorer and independently inspects their native controls. It leaves those application windows open and does not write into their documents.

The live protocol is in `shared/fast-evaluation.json`: 30 realistic scenarios, five trials each, independently checked against the specified oracle. Use Notepad, Calculator, and File Explorer for native application trials and controlled local fixtures for consequential actions. Include Bangla/mixed-language recordings, corrections, slow transitions, disconnects, and interruptions.

Record baseline and upgraded runs as JSONL with these fields: `caseId`, `trial` (five distinct values), `success`, `verified`, `reportedComplete`, `unauthorizedAction`, `ackMs`, `completionMs`, and `interruptionClearMs` for interruption trials. Do not include recordings, entered text, or screenshots in the measurement file by default. Record acknowledgment separately; completion time ends when the independent oracle confirms the outcome, not when speech starts.

Run `node scripts/evaluate_fast_release.cjs baseline.jsonl current.jsonl`. It rejects missing scenarios/trials, under 95% supported simple success, false completion, unauthorized actions, interruption clearing above 500ms, or median/p95 completion regressions above 10% for any existing simple scenario. Synthetic gate tests establish evaluator behavior only. The thresholds are not certified until real baseline and upgraded recordings have been measured.

Release sequence: browser verification first; native launching and accessibility second; screenshot fallback and worker routing last. Keep the two new feature switches off for users whose live acceptance runs have not passed. Thinking and OpenCode retain their execution routes.
