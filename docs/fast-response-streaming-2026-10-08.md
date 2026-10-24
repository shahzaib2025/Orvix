# Fast response latency update

## Changes

Verified, simple PC-result replies can now play their first generated audio chunk before the provider completes the whole response. This uses the existing streaming player and does not request a second narration. Failed, uncertain, approval-required, research, or unfinished dependent-task results do not qualify for this new path. Existing research evidence checks remain.

Capability questions such as “Can you control my browser?” use ordinary streamed conversation. Window minimize/maximize/restore/resize requests are classified as actions, and explicit comparison requests use the lookup path rather than ordinary chat.

A tool proposal arriving after streamed speech waits for scheduled playback to drain; it no longer clears playback automatically. Explicit Stop and provider interruption handling remain.

Microphone input timing is separate from the timestamps captured for the current response. Later microphone activity cannot rewrite response latency into a negative value. Microphone activity during an active response no longer injects additional profile/clock context messages, while PCM input remains available.

The exact screen-sharing phrase in the pasted log was already recognized by the current local command parser. A new regression verifies that the callback receives it without playing a generated refusal. Starting capture still requires the existing source picker; opening that picker is not proof that sharing has started.

## Observed validation

- Nine new focused tests passed: playback before provider completion; uncertain/approval gates; dependent/research gates; speech ordering; no tool-induced cutoff; frozen microphone timing; local screen command; route classification; and redundant context suppression.
- Real Chromium Web Audio scheduling passed using synthetic PCM. Final run: 34 ms buffering, playback started before turn completion, playback drain awaited, zero automatic cutoffs. This does not establish physical speaker or microphone behavior.
- Ten typed turns against the real Live provider all delivered. First audio median 1607.5 ms, slowest 2132 ms; application buffering median 1 ms, slowest 1 ms. These turns are ordinary conversation, not a live PC-action or microphone benchmark, and do not prove a before/after improvement for greetings that already streamed.
- Final production TypeScript/Vite build passed; the existing large-bundle warning remains.
- Broader selected regression run: 127 passed and 45 failed. It includes the existing 40 Simple Fast failures plus five failures in the older latency suite. The older `check_simple_fast_browser.cjs` fixture also timed out. These failures remain unresolved; the new focused checks do not establish whole-profile production readiness.

## Limits and use

This removes an avoidable whole-response wait for eligible verified PC replies. It does not eliminate the provider's first-audio delay or promise a subsecond response on every request. General research/action replies still use their existing guarded delivery paths. A physical microphone conversation, audible speaker output, and the normal packaged Windows app have not been validated in this change.

Restart Orvix to load the changed renderer. Repeat the focused checks with `npm run check:fast-instant`.

Evidence: `scratch/fast-instant-final.log`, `scratch/fast-instant-provider.log`, `scratch/fast-latency-live.report.json`, `scratch/fast-instant-regression.log`, `scratch/fast-instant-web-audio.log`, and `scratch/fast-instant-build.log`.
