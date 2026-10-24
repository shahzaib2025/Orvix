# Thinking profile fixes — October 4, 2026

The client defects identified in the research review have been corrected. The final live production-session check passed all four requests. Intermittent missing native function calls remain observable in isolated provider diagnostics; full model reliability is not established.

## Changes

- Removed unsupported function-response scheduling from Thinking and its workflow live acceptance script.
- Task completion now requires `interactionStatus: IDLE`; filler speech and an utterance boundary keep the task active.
- Removed recovery instructions that asserted successful execution merely because a tool was attempted. Failures remain visible and changing actions are not automatically replayed.
- Replaced the long prompt's fabricated company facts, fixed model specifications, unconditional success claims, and blanket error suppression with instructions grounded in actual tool outcomes.
- Enabled initial session resumption and context compression. GoAway schedules reconnection before expiry; callbacks from old connections are ignored, and messages during setup are buffered.
- Finished async tool results are submitted individually. Outstanding responses can cross a resumed connection; a fresh session discards old call IDs and reports interrupted work for inspection.
- Added duplicate-call protection, malformed-call rejection, and cancellation checks. Cancellation does not promise that an already dispatched backend effect was undone.
- Increased ordinary timeouts to 15 seconds and slow research/file-search timeouts to 30 seconds. Textbook operations retain their 12-minute budget.
- Corrected socket error classification: 1011 is retried as a server error; 1008 reports access/policy rejection unless the reason specifically indicates quota/billing.
- Microphone PCM can continue during reasoning and playback so server interruption detection can operate. Added a 90-second no-progress timeout outside active tool execution.
- Empty results and window-action results retain truthful statuses; minimizing/closing is not described as bringing a window to the foreground.

## Validation

- `npm run check:thinking`: 14 protocol/recovery tests plus the conversation-flow check passed.
- `node --test scripts/check_tiny_workflow_clients.cjs scripts/check_voice_interruptions.cjs`: 66 related regression tests passed.
- `npm run build`: passed; existing bundle-size warning remains.
- `npm run check:thinking:live`: final run passed directory inspection, weather, workflow capabilities, and a combined directory-plus-weather request using the actual Extended Thinking model and production `ThinkingVoiceSession`.

Live validation used typed input, synthetic read-only tool data, and suppressed playback. It proves native calls, result handoff and final-answer use for those scenarios. It does not validate real microphone capture, audible speaker output, actual desktop/file effects, prolonged sessions, or all thinking levels.

The final live report is `scratch/thinking-production-live-latest.json`.

## Remaining uncertainty

An earlier full-profile run passed directory and weather requests but ended the workflow-capabilities request with a spoken system error and zero native calls. An isolated single-tool diagnostic subsequently passed both an empty parameter schema and an omitted parameter schema, but its optional-parameter variant failed with zero calls and system-error speech.

The isolated diagnostic uses fresh connections, one harmless tool, and no production orchestration or unsupported scheduling fields. These observations show that missing calls can still occur outside the client logic, but they do not identify a confirmed Google backend cause or establish a failure rate. The final successful run does not erase these failures.

Diagnostic report: `scratch/thinking-schema-diagnostic-latest.json`. No fallback model was substituted.

Restart or reload Orvix to load the rebuilt client. Further acceptance should include real microphone/speaker use and representative longer tasks.

## References

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking
- https://ai.google.dev/gemini-api/docs/live-api/thinking
- https://ai.google.dev/gemini-api/docs/live-api/session-management
