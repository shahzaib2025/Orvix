# Fast: read-only live conversation benchmark, 3 October 2026

Fast produced an answer and triggered model function calls on all ten turns. Its controller marked eight requests complete. A separate evidence audit passed five requests: two were partial, two had unsupported claim-to-quote mappings, and one was incorrectly marked complete despite missing the requested explanation. One valid PC response was incorrectly rejected by the existing benchmark's length rule. No fixes were made.

**Run and scope**

Command: `node scripts/check_fast_long_conversation.cjs --multistep --tag=readonly-benchmark-20261003`.

The run used real Gemini Live, the production FastVoiceSession and Fast task controller, real public search/page retrieval, and the existing production PC monitor. Inputs were text, with English and Bangla requests. Desktop actions were observations only. The ten turns shared one conversation; turns one and two also shared a task ID, with the additive request advancing its revision from 1 to 2. This is an exploratory custom benchmark, not an official BFCL run.

Time: 21:46:14–21:54:40 Asia/Dhaka; 8 minutes 25.9 seconds including setup. Existing harness exited with code 1 and `issues_found`, which is the benchmark result rather than a process crash.

| Measure | Result |
|---|---:|
| Requests producing a final answer | 10/10 |
| Requests triggering model function calls | 10/10 |
| Controller task status completed | 8/10 |
| Existing automatic harness pass | 7/10 |
| Manual coverage and evidence audit pass | 5/10 |
| Clear false whole-task completion | 1: turn 9 |
| Additional weak claim-to-source mappings | 2: turns 3 and 4 |
| Honest partial requests | 2: turns 1 and 2 |
| Harness false rejection | 1: turn 5 |
| Model function calls | 66 |
| Underlying public searches | 14 |
| Underlying page fetch attempts | 40 |
| Model desktop observations | 5 |
| Independent post-answer window observations | 3 |
| Median request duration | 36.6175 seconds |
| Exploratory p95, nearest rank | 106.930 seconds |

The p95 is the maximum of only ten samples. There was no matched baseline; these numbers cannot establish a latency regression. Nested research retrieval explains why backend search/page counts exceed the corresponding model tool counts.

The manual audit requires requested outcome coverage, a delivered answer, correct uncertainty, and relevant evidence supporting each research claim. A plausible or factually correct statement with an unrelated mapped quote fails evidence support. This distinction explains why turns three and four fail this audit without being counted as demonstrably false factual answers. The automatic harness relies partly on the controller's own verdict and a minimum answer length, so it is not independent ground truth.

**Turn-by-turn results**

| Turn | Request | Seconds | Model calls | Controller | Manual audit |
|---|---|---:|---:|---|---|
| 1 | Florian BD identity, competitor, categories, delivery | 102.756 | 16 | Partial | Fail: comparison and outcome evidence incomplete |
| 2 | Add Florian BD published contacts to the existing plan | 106.930 | 15 | Partial | Fail: contacts unresolved, earlier outcomes still incomplete |
| 3 | English: who executes a function and returns its results | 29.440 | 4 | Completed | Fail: mapped quote does not support the application-result claim |
| 4 | Bangla: equivalent function-execution explanation | 34.269 | 3 | Completed | Fail: same evidence-mapping weakness |
| 5 | Observe and report two window titles | 12.482 | 4 | Completed | Pass: independent observation matches; harness falsely rejects length |
| 6 | Discover Notepad, then check whether a window is running | 15.068 | 4 | Completed | Pass: application discovery distinguished from window presence |
| 7 | Florian BD identity and one published category | 28.267 | 3 | Completed | Pass: identity/category supported, unpublished prices left uncertain |
| 8 | Check a Ghana Uber URL's suitability for Bangladesh evidence | 40.865 | 4 | Completed | Pass: scope rejection reported accurately; no forbidden search |
| 9 | Explain generation completion versus turn completion and interruption | 84.867 | 9 | Completed | Fail: false completion; requested distinction not explained |
| 10 | Bangla: observe windows, then discover Notepad | 38.966 | 4 | Completed | Pass: windows independently confirmed and app discovery distinguished |

**Findings and likely causes**

1. **Highest priority: turn nine passed without answering a required outcome.** Its answer said generation completion was not explicitly defined and described setting `turnComplete: true` as interrupting generation. It did not explain the requested difference between generation completion and server turn completion. Its generation-completion claim was mapped to a source sentence about interrupting generation, which cannot establish an absence of a definition. All relevant outcomes nevertheless became verified, and the final controller state was completed.

   The model legitimately paged through five different excerpts at offsets 0, 4500, 9000, 13500 and 18000. This was not a duplicate-read loop. The failure concerns interpretation and completion review. The client's input `turnComplete` and the server's output `turnComplete` have different meanings. Google's [Live API reference](https://ai.google.dev/api/live#bidigeneratecontentservercontent) defines server generation completion as the model finishing generation, and server turn completion as completion of its turn; interrupted generation may skip generation completion and proceed through interruption to turn completion. This reference was checked separately during the audit; Fast did not retrieve it in this turn.

   Code inspection identifies the acceptance mechanism: [fast-ledger.cjs](~/Desktop/Orvix-Project-v2/electron/fast-ledger.cjs:213) checks that the answer quote exists in the answer, and line 218 checks that the source quote exists in the retrieved excerpt. It does not verify semantic support between the two. Lines 223–225 check that generation/turn terminology occurs, rather than that the answer explains the distinction. This is a confirmed acceptance gap, not evidence of a provider outage.

2. **Turns three and four expose the same source-verification weakness without a clearly false factual answer.** Both correctly describe application execution and returning results. Their mapped evidence for returning application results describes the model supplying structured arguments instead. The whole answer paragraph is reused as the answer quote for separate outcomes. A reader can verify the general facts in Google's [function-calling guide](https://ai.google.dev/gemini-api/docs/function-calling), but the model's selected quotes do not prove those facts. These are evidence-audit failures, distinct from turn nine's omitted explanation.

3. **Long research turns repeatedly review unfinished work.** Turn one made 10 explicit model `review_task` calls; turn two made 6. Both retained partial status, which is truthful. The backend fetched many unreadable Othoba pages and some irrelevant pages, including Bengaluru plants, a power plant and website outages. Together these turns used 14 searches and 32 page attempts. This is wasted retrieval and review work. Logged authoritative review events additionally include automatic controller reviews; they should not be confused with explicit model calls.

   The ledger action count was 4 after turn one and cumulatively 10 after turn two. Backend retrieval operations are a different unit. This run establishes work amplification, but does not by itself prove violation of the controller's action-step budget or recovery-attempt policy.

4. **Contact discovery stops at an unsuccessful guessed URL.** Turn two requested `/contact-us/`, which produced a Page Not Found page even though retrieval returned `ok`. Fast correctly reported that contact channels remained unverified, but did not establish the requested published channels. This is failed discovery and a distinction between transport success and useful document content; it is not proof that the business has no contact channels.

5. **Citation presentation can bundle unrelated claims and truncate prose.** Turn two appended a long `Source for ...` passage ending mid-phrase, with the Florian homepage as the single link for a paragraph also discussing Green Savers and the failed contact lookup. The auto-append path at [fast-ledger.cjs](~/Desktop/Orvix-Project-v2/electron/fast-ledger.cjs:196) takes up to 500 characters of the mapped answer quote. This makes provenance hard to assess and does not cure an irrelevant claim mapping.

6. **The benchmark itself contains a false-negative rule.** Turn five delivered a correct 75-character answer containing the two observed window titles. The independent post-answer observation matched them. [The existing harness](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.cjs:135) rejects multistep answers below 80 characters. That rejection measures length rather than fulfillment. The audit counts this turn as passed; the rule remains unchanged as requested.

Five model calls returned `invalid_request`, all recovered sufficiently to continue the conversation. Across all 66 completions: 31 `ok`, 19 `partial`, 5 `invalid_request`, 8 `completed`, 1 `no_relevant_sources`, 1 `plan_required`, and 1 `out_of_scope`. These are tool-specific statuses, not whole-request success counts. The deliberate scope rejection on turn eight was expected, and no backend page content was fetched for it.

**Research method and limits**

The audit follows the distinction between actual state and required execution paths in [BFCL's multi-turn evaluation guidance](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html): independent desktop observations validate reported state, while tool traces establish that required reads occurred. Extra calls alone are not scored as wrong; unsupported answers, omitted outcomes and excessive unsuccessful work are recorded separately. No official benchmark dataset or standardized score is claimed.

Google's [Live tool-use guidance](https://ai.google.dev/gemini-api/docs/live-api/tools) documents application execution and matching function responses. Successful dispatch is therefore only part of the evidence; this audit also checks the result and final answer. Google's [session management guide](https://ai.google.dev/gemini-api/docs/live-api/session-management) describes resumption, but this run did not intentionally interrupt the connection and cannot certify recovery.

Every turn received audio chunks and admitted response PCM through the harness. That does not demonstrate physical microphone input, audible playback or speech quality. Turns one and two received substantially more chunks than were admitted; the counters alone cannot diagnose a missing spoken response, particularly while partial-completion narration is gated.

This run did not test browser mutations, stale-target recovery, delayed YouTube updates, approvals, uncertain mutation effects, duplicated writes, forced reconnects, budget exhaustion, physical interruption, or the packaged installer. The native observations used the existing monitor's window inventory, not a visual screenshot audit. One ten-turn run cannot satisfy the previously proposed five-conversation/50-request release gate or prove production readiness. A false completion was observed, so the zero-false-completion gate already fails for this run.

All 12 production files fingerprinted by the existing harness were compared with their current bytes after execution and remained unchanged. No production code, existing test harness or settings were edited. New artifacts contain findings only.

**Preserved evidence**

- [Raw benchmark JSON](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.readonly-benchmark-20261003.report.json): prompts, tool arguments/statuses, retrievals, ledger snapshots and audio counters.
- [Conversation transcript](~/Desktop/Orvix-Project-v2/scripts/fast-long-conversation.readonly-benchmark-20261003.md).
- [Machine-readable independent audit](~/Desktop/Orvix-Project-v2/scripts/fast-readonly-benchmark-20261003.audit.json): scoring decisions, metrics and file-hash verification.

The next benchmark should test semantic source support, an intentionally unanswerable required outcome, useful contact discovery after a not-found response, short valid PC answers, and bounded recovery after repeated unreadable sources. Browser/desktop mutation recovery and microphone acceptance require separate live tests. These are proposed validation areas; no fixes were implemented.
