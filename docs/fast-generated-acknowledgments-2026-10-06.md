# Generated Fast acknowledgments and speech latency

Current final-answer behavior: [direct delivery without an answer-verification gate](fast-direct-answer-delivery-2026-10-06.md).

The measurement snapshot below predates early preparation during input. See
[the first-acknowledgment update](fast-first-ack-startup-2026-10-06.md) for the
current behavior, measurements and remaining microphone-timing limitation.

The active Fast runtime now generates its own short acknowledgment from the current request, next operation and previous result. It does not select a preset sentence or send one through the exact-text speech renderer.

## Runtime behavior

1. A tool-free connection to the existing Fast model warms while the main session connects.
2. For a work request, it composes a brief prospective explanation in the current language. Greetings and ordinary conversation skip this extra acknowledgment.
3. PCM plays as it arrives; the transcript displays the model's own words. There is no full-sentence buffering or exact-text comparison on progress speech.
4. The controller waits for the generation to complete and every playback buffer to drain before dispatching the operation. It still serializes actual tools and preserves approvals and uncertain-effect protections.
5. When the opening sentence specifically explains the first known catalog read, that same completed explanation covers the first tool. The next source gets its own new explanation.

The generation deadline applies to speech startup. Once audio begins streaming, it does not cut the sentence midway. Stop remains explicit cancellation. Missing or invalid progress prevents execution. An incomplete phrase gets one repair after existing playback drains; it is not counted as a finished explanation. A failed explanation does not trap the next user request or accidentally execute an approved PC action.

The auxiliary connection cannot execute tools or decide task completion. Its prompt receives operation metadata rather than entered values, clipboard contents, passwords, control references or URL query tokens. Google/OpenAI sources use the publisher name so the acknowledgment does not waste time spelling a domain aloud. Actual page and action receipts remain authoritative.

The separate exact-text renderer remains available for a final answer that must be rewritten by a source or execution guard. Its unplayed generation has a single four-second attempt; progress no longer shares its retries or cooldown.

## Verification

- `npm run check:fast-reliability`: **309 tests passed**, plus browser integration and real Web Audio/AudioWorklet checks using synthetic PCM/input.
- `npm run build`: TypeScript and Vite passed. The existing bundle-size warning remains.
- Six real-provider progress requests produced **six distinct complete explanations with PCM**. Median audio arrival was **1.82 seconds**, with the slowest of these six at **1.92 seconds**. These are startup measurements, not the time needed to finish speaking.
- A real-provider three-turn conversation performed three actual source reads. All final reports completed with PCM, each actual read followed its finished explanation, and operation concurrency stayed at one. The first comparison used two acknowledgments for its two reads, including the opening explanation; the OpenAI-only request used one. Audio was queued **1.54–2.34 seconds** after acknowledgment generation began. This harness counts PCM and does not play through physical speakers.

Examples actually generated during the final conversation:

- “আমি এখন গুগলের পেজটি পড়ে জিটিপি এবং জেমিনির লেটেস্ট মডেলের তুলনা করে দেব।”
- “আমি এখন ওপেনএআই-এর পেজটি পড়ে লেটেস্ট তথ্যগুলো জেনে নেব।”
- “আমি পড়া তথ্য থেকে দুটি মডেলের সংক্ষিপ্ত তুলনা তৈরি করছি।”

These are recorded outputs, not stored templates. Wording and latency can vary by request and provider conditions. An earlier progress probe produced an incomplete phrase; that led to the explicit incomplete-phrase guard and bounded repair test. Physical microphone input, speaker output and packaged Windows execution were not validated in this pass. Total research and final-answer latency remains separate from acknowledgment startup; a longer final answer still takes time to generate and speak.

Google documents native audio and output transcription in its [Live API capabilities guide](https://ai.google.dev/gemini-api/docs/live-api/capabilities), and the output/turn completion ordering in the [Live API reference](https://ai.google.dev/api/live). The app's playback drain is an additional local gate before execution.

## Reproduction and evidence

- `npm run check:fast-progress:live`: generated progress-only benchmark; real provider, no research or PC execution.
- `node scripts/check_simple_fast_live.cjs --latency`: three-turn research conversation.
- `scratch/fast-generated-progress-live.report.json`: progress measurements and exact generated text.
- `scratch/simple-fast-generated-ack-live.report.json`: conversation, operation receipts and startup measurements.
- `scratch/fast-ack-reliability.log` and `scratch/fast-ack-build.log`: final checks.

Restart Orvix and start a fresh Fast voice session to load this runtime.
