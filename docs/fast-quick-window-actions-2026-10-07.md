# Fast window actions — 7 October 2026

Only `manage_window` focus, minimize and maximize use this path:

`Request → tool → native window-state check → brief report`

There is no opening acknowledgment. The window tool is declared `NON_BLOCKING`, while the controller still serializes actions and buffers premature provider reports until the result arrives. Closing, restoring, launching and other work retain their explanation ordering. Existing settings and approvals remain effective.

On a definite failed result, the controller generates a fresh explanation saying the action did not work and it will retry, waits for the complete audio to drain, retries once, then returns the observed result for reporting. The retry stays on the native resolved window handle when available. A second failed attempt is retained and cannot be automatically repeated in the same turn. Missing recovery speech prevents the retry. Stop prevents pending retry dispatch.

Timeouts and uncertain effects do not trigger automatic replay. The quick HTTP path no longer falls through to another CLI mutation after an uncertain sent request; connection refusal may still use the existing CLI fallback. Approval, disabled settings and missing information are reported as their actual obstacles, rather than described as execution failures.

## Verification and evidence

The existing native `WindowController` checks foreground focus, `IsIconic` or `IsZoomed` for up to roughly 300ms. No extra model review or full desktop screenshot is added. An explicit checked mismatch becomes a definite failed result; a transport uncertainty remains unconfirmed. This bounds the native verification loop, not network transport, model tool selection or spoken report time.

An isolated real Windows fixture was created and closed by the test. Independent Win32 checks confirmed:

| Action | Action plus native check | Independent state |
| --- | ---: | --- |
| Minimize | 25ms | Minimized |
| Maximize | 23ms | Maximized |
| Focus | 1ms | Foreground window |

All three completed within one second in this test. These measurements do not guarantee the same latency for every app or prove physical microphone/speaker behavior.

Eleven focused tests passed: successful immediate actions; generated recovery and playback drain; exhausted retry protection; uncertainty and approval; normal close/restore ordering; Stop; premature provider report buffering; native result interpretation; non-blocking declaration; HTTP uncertainty without duplicate CLI mutation; unavailable recovery speech.

Production TypeScript/Vite build passed, with existing large-chunk warnings. Native module syntax checks passed.

The broad reliability run is **not clean: 321 passed, 40 failed**. Its log includes tests expecting earlier streaming acknowledgment callbacks, speech failure behavior, source routing and interruption configuration. This change does not establish that those contracts are correct; it preserves unrelated current behavior. Representative old regression failures were also checked with quick-window routing disabled in a temporary control bundle. The control is diagnostic, not a release baseline. No production-readiness claim is made.

Artifacts:

- [Focused tests](../scratch/fast-window-focused.log)
- [Real Windows test](../scratch/fast-window-native.log)
- [Build](../scratch/fast-window-build.log)
- [Broad reliability failures](../scratch/fast-window-reliability.log)
- [Representative regression control](../scratch/fast-window-existing-regressions-control.log)

Implementation: `src/fastWindowAction.ts`, `src/simpleFastVoice.ts`, `src/simpleFastFlow.ts`, `src/fastProgressVoice.ts`, `electron/fast-windows.cjs`, `electron/window-control.cjs`, and the existing window adapter in `electron/main.cjs`.

The non-blocking declaration follows [Google's Live tool-use documentation](https://ai.google.dev/gemini-api/docs/live-api/tools). The local controller owns ordering and truthful result reporting; it does not rely on provider speech to confirm a window effect.
