# Fast benchmark fixes and validation — 3 October 2026

The implementation addresses the six gaps found in the read-only benchmark, with additional fixes for additive-plan recovery and blocked-reply delivery exposed during retesting. Automated checks pass. Live research acceptance remains blocked by Gemini Flash quota/access failures; this is not a production-readiness sign-off.

**What changed**

- [fast-grounding.cjs](~/Desktop/Orvix-Project-v2/electron/fast-grounding.cjs) adds an independent, tool-free evidence reviewer using the existing configured worker model. It checks whether each answer actually covers its requested outcome and whether each selected quote supports its claim. Structured results are validated locally. Unknown, malformed, missing and unavailable judgments cannot authorize completion. The reviewer checks English and Bangla and distinguishes client input `turnComplete` from server completion signals. It uses a 22-second deadline and at most two recovery attempts. Quota/access errors use existing configured keys and honor provider cooldown hints; there is no model substitution or billing change.
- [fast-work.cjs](~/Desktop/Orvix-Project-v2/electron/fast-work.cjs) binds trusted verdicts to the current task revision, answer, execution state and evidence. It discards a verdict if work changes while the reviewer is running. It caches valid judgments, evicts temporary provider failures, and keeps native inventory checks on their existing path without a research model call. The reviewer receives full retrieved evidence once, rather than duplicating the same excerpt for every claim.
- [fast-ledger.cjs](~/Desktop/Orvix-Project-v2/electron/fast-ledger.cjs) retains structural provenance/dependency checks alongside the independent review. A verdict supplied by the proposing model is ignored. The synchronous structural API admits only literal research claims without an independent verdict. Missing generation definitions and client/server confusion cannot satisfy the requested distinction. Repeated unsuccessful reviews are bounded by actual evidence and outcome progress, not newly assigned evidence IDs. Provider unavailability is reported as a blocker rather than an invitation to repeat searches or repair quotes. Citations use compact URL lists instead of repeating and truncating whole paragraphs.
- Additive plans merge omitted existing requirements and steps in the controller. Verified effects remain verified. An added outcome must have a new step or explicit mapping; an old plan alone cannot silently satisfy it. An added answer can depend on the newly proposed evidence steps. Stale revisions, invalid dependencies and existing approval rules remain enforced.
- [search.cjs](~/Desktop/Orvix-Project-v2/electron/search.cjs) treats HTTP-success not-found pages as `not_found`, without verified article content. It exposes public same-origin contact/reference navigation links as leads. Paginated duplicate search results no longer occupy all result slots.
- [fastResearch.ts](~/Desktop/Orvix-Project-v2/src/fastResearch.ts) caches page retrievals within a research task, skips already failed page families across changed queries, bounds candidate reads, and rejects obvious irrelevant plant-search results such as power plants and foreign nursery hits. Contact recovery follows published same-origin links, at most two additional reads, and respects an exact/page-only restriction. Unreadable sources remain unreadable; this does not invent missing competitor facts.
- [fastVoice.ts](~/Desktop/Orvix-Project-v2/src/fastVoice.ts) directs function-execution questions to the official guide's workflow section instead of its argument-generation examples. Explicit offsets/queries remain intact. Exhausted plan repair blocks further actions while allowing an unfinished-task explanation to be delivered. The production IPC and worker use the grounded review path.
- [The conversation harness](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.cjs) checks nonempty delivery and outcome verification instead of rejecting short valid answers. It records actual page query/offset arguments and can reconnect before a later distinct request without converting the failed preceding request into a pass.

Existing profile models, voice and opt-in worker settings remain configured as before. The evidence reviewer is part of completion verification; it adds a separate Gemini request for research. Native inventory and straightforward non-research tasks do not invoke it.

**Automated validation**

`npm run check:fast-reliability`: **150/150 Node tests passed**, followed by passing browser integration and Web Audio checks. Synthetic AudioWorklet input measured 1 ms detection-to-clear and 139 ms synthetic onset-to-clear in the final run. This is not physical microphone evidence.

`npm run build`: passed. The existing large-chunk warning remains; the build completed successfully.

The new [grounding regressions](~/Desktop/Orvix-Project-v2/scripts/check_fast_grounding.cjs) cover unrelated source quotes, forged verdicts, supported paraphrases, missing/failed reviewers, provenance rejection despite a positive verdict, correction during review, repeated review limits, temporary outage recovery, bounded provider retries, partial additive plans, the native fast path, malformed structured judgments, safe contact discovery, failed-page deduplication, and soft 404s. Voice regressions additionally cover preserving a blocked-task explanation without allowing new effects and selecting the function-workflow section without overriding explicit pagination.

**Live retesting and limits**

Three ten-request runs were preserved during implementation. They used real Gemini Live, production FastVoiceSession/controller code, actual public retrieval and native PC observations. Inputs were text; admitted PCM was counted. The runs exercised intermediate revisions, so their results are not a single uniform final-code release score.

| Run | Delivered final replies | Controller completed | Model calls | Result |
|---|---:|---:|---:|---|
| Initial implementation | 2/10 | 0/10 | 20 | Provider failure/reconnect exhaustion, then seven harness cascade failures |
| Intermediate retry/recovery revision | 8/10 | 4/10 | 48 | Additive-plan repair failure and missing Bangla audio; research blocked |
| Later ten-turn revision | 9/10 | 4/10 | 57 | Native turns 5, 6, 10 and negative URL-scope turn 8 completed; research blocked, one missing-audio failure |

The later run successfully retrieved Florian BD's actual `/contact/` page. Function-calling reads targeted `How function calling works`, which explicitly documents application execution and returning the result. The previously false generation/turn-completion result remained blocked. Among the four tasks marked complete in the later ten-turn run, the independent native observations and negative-scope evidence match their reported results; no false whole-task completion was identified in that run. This does not establish a universal zero-failure rate or prove the unsupported portions of partial research answers.

After the final provider-blocker handling changes, four targeted live requests were run with the final production source bytes: turns 3, 4, 7 and 9. **4/4 delivered final replies and all required model tool calls**, each with one explicit `review_task` call. **0/4 research tasks were completed**, correctly reflecting unavailable evidence verification. English and Bangla replies admitted PCM. The original incorrect generation/turn distinction was blocked rather than accepted. All twelve existing production fingerprints in this focused report match the current files. A separate validation manifest also records the new grounding module's hash.

The provider returned HTTP 429 for the configured Gemini Flash project: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quota value **20**, model `gemini-3.8-flash`, with a retry hint of approximately seven hours at the time checked. Other configured keys returned HTTP 403. Earlier attempts also encountered HTTP 503 and timeouts. No API keys are included in this report. These errors are distinct from Live transport availability: the Live conversation could run while the separate research reviewer lacked capacity.

The final implementation reports this as a blocker and retains the execution/evidence for a later review. A successful research acceptance rerun requires usable capacity for the existing configured review model. No account plan, billing or model defaults were changed.

**Latency and release status**

The later ten-turn run had median 44.215 seconds versus 36.6175 seconds in the prior read-only benchmark, and exploratory nearest-rank p95 108.836 versus 106.930 seconds. These are ten-sample runs under different provider conditions, not a controlled latency acceptance test.

For the three native prompts, median duration was 16.770 versus 15.068 seconds; sample maximum was 43.192 versus 38.966 seconds, above the proposed 10% investigation threshold. Native tool timings were checked: desktop observations remained roughly 11–594 ms in the later run, versus 11–1119 ms before, and completion review remained local without a grounding-provider call. End-to-end latency includes model planning, narration and delivery, so a stable repeated baseline is still required to isolate the increase. This is an unresolved release measurement, not a claimed performance pass.

Physical microphone input, audible listening, forced mutation-recovery acceptance, approvals in the packaged Windows app and a rebuilt installer were not verified here. Intermittent missing response audio was observed in earlier live runs; the final focused run delivered PCM, which does not certify audible speech quality. The five-conversation/50-request release gate was not achieved. Production readiness is therefore **not claimed**.

**Preserved artifacts**

- [Original read-only benchmark](~/Desktop/Orvix-Project-v2/docs/fast-readonly-benchmark-20261003.md).
- [Initial live run](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.grounding-fix-20261003.report.json).
- [Intermediate live run](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.grounding-final-20261003.report.json).
- [Later ten-turn run](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.grounding-validated-20261003.report.json).
- [Final focused live run](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.grounding-provider-blocked-20261003.report.json).
- [Final focused transcript](~/Desktop/Orvix-Project-v2/scripts/fast-long-conversation.grounding-provider-blocked-20261003.md).
- [Validation manifest](~/Desktop/Orvix-Project-v2/scripts/fast-grounding-fixes-20261003.validation.json).

Implementation follows Google's [structured-output guidance](https://ai.google.dev/gemini-api/docs/structured-output). The server/client completion distinction was checked against the [Live API reference](https://ai.google.dev/api/live#bidigeneratecontentservercontent); these links explain the protocol, not the local acceptance scores.
