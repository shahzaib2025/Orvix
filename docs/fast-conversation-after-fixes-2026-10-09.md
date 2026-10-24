# Fast conversation check after research fixes — 2026-10-09

Five real-provider research turns, using English requests and Bangla retained-information follow-ups. No source code changed during this check. Retrieval used DuckDuckGo because this harness had no Serper keys configured.

| Turn | Request | Observed outcome |
|---|---|---|
| 1 | Florian BD competitor comparison | One search. Correctly limited missing evidence to the retrieved sources; comparison remained unknown. |
| 2 | Bangla competitor follow-up | No new tool. Preserved the retrieval limitation. |
| 3 | Read Google/OpenAI catalogs; compare a selection consideration | Both pages read. Incorrect local rejection of a documented Gemini claim; corrected answer became text-only after voice rendering timed out. |
| 4 | Bangla practical consideration from that comparison | No new tool. Added “বেশি কার্যকর” (more effective) without comparative evidence. |
| 5 | Name a model from each page and discuss which is best | Both pages read. Model-specific descriptions and no unsupported overall winner. |

## Confirmed regressions

1. **Model-name parsing false positive.** The capability guard's model suffix expression has no terminal word boundary. It parses `Gemini 3.1 Flash-Lite provides` as `Gemini 3.1 Flash-Lite pro`, consuming `pro` from `provides`. The nonexistent parsed model has no matching source passage, so the controller removes a source-supported sentence. This was reproduced directly with the same expression. The Google excerpt did contain the model description and cost claim.
2. **Corrected report audio unavailable.** After the incorrect rejection in turn 3, the replacement narration timed out after about four seconds. The installed-voice fallback did not provide audio in this harness, and delivery was accurately logged `visible_only`. This is not a completed spoken response.
3. **Bangla comparison wording still exceeds evidence.** Turn 4 said Gemini was “বেশি কার্যকর” for cost-sensitive work. The excerpts describe capabilities/cost but do not establish that relative effectiveness. The current local guard does not recognize that Bangla comparative phrase. It should be scoped as a source-based consideration rather than asserted superiority.

## What passed

- All five tools were acknowledged before dispatch and executed sequentially.
- Page reads used reading acknowledgments; the search used searching wording.
- Both retained-information follow-ups performed no retrieval.
- No new public-absence assertion was observed.
- Four responses had complete audio delivery in the harness; one was text-only. All five had written reports.

This is a real Gemini/public-retrieval test with typed input and mocked playback callbacks. It does not verify physical microphone input, speaker audibility, echo, or the packaged app. It is not a production-readiness pass. The remaining issues were identified and recorded; no fixes were made in this turn.

Evidence: `scratch/simple-fast-live.conversation-after-fixes-20261009.report.json`, `scratch/fast-conversation-after-fixes-audit.json`, `scratch/fast-conversation-after-fixes.log`. The full record retains exact generated and delivered answers, source excerpts, acknowledgment events and timings.
