# Fast live tool-call monitoring

Real Gemini Live, production FastVoiceSession, real public web search and page retrieval; text input, audio chunks counted. No microphone, audible speaker playback, or browser fixtures.

Tracked source hashes stayed unchanged during this conversation. No production code was edited.

10 turns; 54 model function calls; 6 controller passes, 5 passes after answer-coverage review; 3 plan mismatch failures; 1 accurate scope block; 1 completion coverage error.

## Tools

- `plan_task`: 17 calls
- `read_web_page`: 12 calls
- `web_search`: 11 calls
- `review_task`: 9 calls
- `desktop_observe`: 5 calls

## Turn results

| Turn | Tool calls | Seconds | Controller state | Audit |
|---|---:|---:|---|---|
| 1 | 7 | 20.0 | paused | Tool/step mismatch, repair exhausted |
| 2 | 9 | 15.3 | paused | Tool/step mismatch, repair exhausted |
| 3 | 11 | 16.8 | paused | Tool/step mismatch, repair exhausted |
| 4 | 5 | 51.8 | completed | Passed controller and answer-coverage review |
| 5 | 3 | 14.4 | completed | Passed controller and answer-coverage review |
| 6 | 4 | 17.2 | completed | Passed controller and answer-coverage review |
| 7 | 3 | 30.1 | completed | Passed controller and answer-coverage review |
| 8 | 4 | 40.9 | blocked | Accurate regional scope block; task classified blocked |
| 9 | 3 | 25.9 | completed | Incorrect completion: requested generation-completion distinction omitted |
| 10 | 5 | 40.0 | completed | Passed controller and answer-coverage review |

## Problems and next fixes

1. When a new research operation requires another tool, revise/register the plan instead of reusing a step assigned to a different tool. Keep the controller rejection.
2. Review original requested distinctions independently of model-authored claims. Turn 9 demonstrates that valid source excerpts and quoted answer text do not prove complete coverage.
3. Improve plan schema guidance and repair feedback; repeated invalid plan/step calls consumed the repair budget.
4. Represent verified negative findings separately from an unavailable positive outcome, so correct country-scope rejection can complete the requested scope-check task.

No desktop mutations, physical microphone, audible playback, or disconnect recovery were tested. Actual public retrieval and real native observations were used. Audio PCM admission was recorded, not listened to.

Raw report: `scripts/check_fast_long_conversation.toolcall-monitor-final.report.json`. Full conversation: `scripts/fast-long-conversation.toolcall-monitor-final.md`. Audit: `scripts/fast-toolcall-monitor-final.audit.json`.
