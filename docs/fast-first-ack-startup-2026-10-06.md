# Earlier generation of the first Fast acknowledgment

Later update: [final-answer verification has been removed](fast-direct-answer-delivery-2026-10-06.md).
The measurements below describe the earlier acknowledgment change.

The previous path started a remote model generation only after the completed
request arrived. A warm socket removed connection setup, but did not remove the
model's first-audio delay. The new path overlaps generation with the remaining
spoken request when an early transcript clearly identifies a research/read task.

## Behavior

- A tool-free model generates fresh wording from the provisional request. It uses
  the existing Fast model and voice. There is no preset response or sentence pool.
- Audio and text remain private buffers while the user speaks. The microphone
  continues forwarding input; no task or executor action starts from a partial
  transcript.
- Once the request ends, the controller checks the prefix, language, first
  operation, correction/negation markers and a twelve-second freshness window.
  A matching buffer starts immediately; subsequent chunks continue streaming.
- Changed topics, changed first sources, corrections and cancellations discard
  unplayed preparation. A failed preparation gets a fresh generation for the
  completed request. Stop cancels preparation and prevents late playback.
- Clear research/read requests are eligible. Greetings, short fragments, private
  input and PC mutations use the completed-request path. Model topics wait until
  their topic is identified to avoid reconnecting after every new word.
- Every actual tool still waits for complete speech and drained playback. The
  first explanation can cover its exact first source read. Approvals, sequential
  execution and uncertain-effect protections remain.
- The progress prompt requests shorter complete sentences with explicit action
  verbs. Warmup begins before approval-queue setup finishes.

## Measurements and limits

Three real-provider progress samples with **scripted partial transcription** and
2.5 seconds of simulated remaining speech released the first PCM **1–84 ms after
the simulated request ended**. All generated complete explanations, and none
released PCM before that endpoint. This demonstrates the buffer mechanism, not
physical microphone timing.

A separate six-sample real-provider probe generated six distinct complete
explanations. First PCM arrival ranged **0.72–4.05 seconds**. These requests ran
alongside another live conversation, and do not establish a controlled latency
improvement over the previous baseline. An initial shorter-prompt trial produced
one incomplete phrase; the final prompt restores an explicit action-verb
requirement, with the existing incomplete-phrase guard and bounded repair retained.

The three-turn typed research conversation completed all three reports with PCM;
its three actual page reads followed finished explanations and operation
concurrency remained one. Typed requests do not have remaining speech to overlap.
Their first acknowledgments began **1.03–2.16 seconds** after generation began.

A synthesized-PCM input probe received no input transcription or report within
its 150-second deadline. It did not establish a cause. **Real input-transcription
timing and physical microphone/speaker behavior remain unverified.** The early
path depends on input transcripts arriving while the user is still speaking.
Network and provider delays can still prevent an immediate acknowledgment.

The [Google Live API capabilities guide](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
documents PCM input/output and input transcription. This implementation retains
the configured model and omits unsupported `thinkingLevel` for ordinary Fast.

## Verification

- `npm run check:fast-reliability`: **318 tests passed**, plus real Web Audio and
  AudioWorklet fixtures with synthetic input/PCM. New cases cover silent
  preparation, final-buffer drain, corrections, first-source changes, failed
  preparation, microphone forwarding, stale drafts and Stop/restart.
- `npm run build`: TypeScript and Vite passed; existing bundle-size warning remains.
- `node scripts/check_fast_progress_preview_live.cjs`: real generated voice with
  scripted input timing; report `scratch/fast-prepared-progress-live.report.json`.
- `node scripts/check_fast_progress_live.cjs`: six generated voice samples;
  report `scratch/fast-generated-progress-live.report.json`.
- `node scripts/check_simple_fast_live.cjs --latency`: typed research conversation;
  report `scratch/simple-fast-generated-ack-live.report.json`.
- `node scripts/check_fast_audio_ack_live.cjs`: synthesized user audio diagnostic;
  report `scratch/fast-audio-ack-live.report.json` (unsuccessful input probe).

Restart Orvix and start a fresh Fast session to load the change. No packaged
Windows executable or physical audio hardware was verified in this pass.
