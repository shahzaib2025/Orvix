# Fast research fixes and verification — 5 October 2026

The code fixes are implemented and the production build succeeds. The live research release gate is not established: source retrieval and provider review/access failures still prevent fully verified answers. This document separates delivered reports from completed research and staged runs from the final code version.

## Implemented fixes

| Problem | Change | Verification |
| --- | --- | --- |
| Source-quality wording added an unwanted question | Strip reliable/accurate-source qualifiers from topic extraction; explicit requests about accuracy and reliability remain required. | English/Bangla regressions; fixed after the last live run. |
| Follow-ups erased research or reused the first question | Recognize substantive additions, corrections, audits, and language requests. Keep verified evidence; use the current question for discovery and select relevant excerpts without deleting the ledger. | Continuity and immutable-context regressions. |
| Search used accidental domains, old date filters, or irrelevant results | Fix the `Bangladesh net` domain misparse; avoid a one-month cutoff for `current/latest`; use institution-scoped recovery queries, Unicode topic matching, and government/source priority. | Search-domain, freshness, Bangla, relevance, and scoped-recovery regressions. |
| Secondary reports fulfilled requests for primary sources | Reject secondary Bangladesh solar/policy sources when government or primary evidence was requested. Pass the original question to the independent reviewer for generic source-answer requirements. | A copied news quote cannot complete a primary-source request. |
| Claims used the search-operation ID as page proof | Return actual observed page evidence IDs and passage IDs. Preserve narrow valid source quotes, including later page sections. Check provenance for ordinary outcomes as well as research outcomes. | Aggregate-proof bypass, quoted-passage, and voice-to-controller integration regressions. |
| A missing older answer blocked verification of a supported follow-up | Review the outcomes submitted in this answer; retain every unanswered requirement for the final completion audit. | New regression verifies the current finding while the overall task remains partial. |
| Revised plans dropped completed steps or selected the wrong pending read | Require step identity in the research tool schema (an empty string is allowed only for an unplanned action); preserve omitted verified records. Resolve a missing ID only for a uniquely identified added read; keep mutations and ambiguous cases strict. | Verified effects are not repeated; unique added-read regression. |
| Invalid plans created repeated tool loops | End execution/review after bounded protocol recovery and request the controller's explicit unfinished-task report. A new user request resets this turn-local condition. | No further reviewer or execution calls after terminal plan recovery. |
| Disconnect/quota/access failure silently cancelled work | Preserve task and evidence on terminal transport failure, show an interrupted-delivery report, and exclude only already-limited configured credentials during bounded recovery. | Retained-task, stale-socket, configured-credential, and cancellation regressions. |
| Audio checks rejected equivalent spoken numbers or expected literal URLs | Keep URLs in the written report; compare safe spoken text without literal citation paths. Accept equivalent English/Bangla numerals while rejecting changed values, facts, negation, and URLs. | Actual failed turn 2 replay now matches; contradictory audio remains blocked. |
| Reviewer outages produced immediate retries and sensitive tool arguments entered logs | Back off transient server errors within the deadline; keep that retry on the same credential, rotate only for authentication/quota errors, and log argument field names instead of entered values. | Bounded reviewer retry and browser private-logging checks. |

Existing models, voice settings, approvals, and opt-in PC/worker settings were preserved. Search/page operations remain read-only in these conversation runs.

## Local validation

`npm run check:fast-reliability`: **216 tests passed, zero failed**. Browser integration passed. Real AudioWorklet execution with synthetic input passed (1 ms detection-to-clear; 98 ms synthetic onset-to-clear). Web Audio delivery waited for scheduled buffers to drain.

`npm run build`: **passed** (TypeScript and Vite).

These are not physical microphone, audible speaker, packaged-Windows-app, or human conversation evaluations. The live harness uses real Gemini Live, real public search/page retrieval, and the production FastVoiceSession with typed input. PCM output is counted; speaker playback is replaced by a test counter.

[Full reliability log](~/Desktop/Orvix-Project-v2/scripts/fast-reliability-postfix-20261005.log) · [Build log](~/Desktop/Orvix-Project-v2/scripts/fast-build-postfix-20261005.log)

## Benchmark versions

The same 20 Bangladesh solar prompts mix simple explanations, English/Bangla responses, current statistics, primary sources, comparisons, dependent arithmetic, corrections, source reopening, and a five-finding final audit.

- **Original baseline:** all 20 attempted; 8 delivered reports, 12 failed deliveries/timeouts, zero fully verified research requests; 37 model tool calls, 21 public queries, 34 direct page reads. Duration about 41 minutes. There were 28 recorded Live 1011 internal-error events.
- **Staged verified-fix run:** 11 attempted; 6 delivered reports and 5 failed; 9 not attempted after project access denial. 97 model tool calls, 22 searches, 46 page reads. The controller marked turn 4 completed, but manual audit rejected its secondary source because the user requested primary evidence. This exposed the source-policy fix above; do not count it as a successful request.
- **Superseded postfix run:** deliberately stopped to apply the subsequently discovered cross-turn review fix. Its JSON records interrupted and unattempted turns separately. It is not a final-version acceptance run.
- **Pre-schema release check:** 7 attempted; 6 delivered reports, 1 failed; 13 not attempted after provider denial. None fully verified. The subsequent schema correction made step IDs required.
- **Final schema run:** 5 attempted; 3 delivered reports, 2 failed; 15 not attempted after provider denial. None fully verified. All 20 research-tool calls included the required step field; 11 used explicit planned IDs. The later reliable-source topic fix is covered by local regressions and was not live-validated. Code hashes document the version boundary.

[Original transcript](~/Desktop/Orvix-Project-v2/scripts/fast-long-conversation.fast-research20-20261005.md) · [Staged transcript](~/Desktop/Orvix-Project-v2/scripts/fast-long-conversation.fast-research20-verified-fix-20261005.md)

## Concrete failure evidence

- Staged turn 4 used a New Age news article for an explicitly government/primary-source request. The new controller rejects that source classification even when the article contains the quoted number.
- Staged turn 6 made 17 model tool calls and performed zero searches or reads while struggling with revised-plan records. Staged turn 7 made 24 calls and performed zero searches/reads after missing step IDs. The new retention, unique-read resolution, and terminal protocol guard address these loops without repeating effects.
- Staged turn 2's reviewed report wrote source counts as numerals; Live transcribed them as words. The final speech comparator accepts this recorded equivalent text. Staged Bangla turns also changed or truncated factual wording; those remain legitimately rejected rather than loosening the gate.
- Provider review errors included HTTP 503, 429, and 403. Live also reported project access denial. A generated transcript or readable webpage cannot substitute for a required independent review. The application keeps those findings unverified and retains work for continuation.

## Remaining release requirements

Do not claim perfection or production readiness from these results. The final live run, actual microphone/interruption/speaker behavior, a packaged Windows build, and a comparable simple-task p95 latency baseline must pass before release. The previous requested 48/50 fully satisfied threshold and five separate ten-turn live conversations have not been achieved in this evaluation.

Configured provider quota/model access needs to work reliably. The search index also misses some current official pages and returns dated guides; retrieved dates and source coverage must still be inspected. Missing information remains unknown. None of the manual external research below is injected into the app's benchmark as if Fast retrieved it.

## Research references

Google documents manual function responses for Live: [Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools?hl=en). Recovery design was checked against [Live session management](https://ai.google.dev/gemini-api/docs/live-api/session-management) and [function calling](https://ai.google.dev/gemini-api/docs/function-calling/).

Official Bangladesh research was independently checked on SREDA and IDCOL pages. Their dated figures must be distinguished from solar-only capacity and generation shares; an old guideline or a total-renewables figure cannot prove today's solar capacity. This is an external audit finding, not a successful Fast research result.

## Final live results

The final schema run used the same 20 solar prompts. It ended after five attempted turns because of provider errors, not because the remaining requests passed. Totals: **38 model tool calls, 27 public searches, 27 direct page reads**, about 10.1 minutes. All calls were plan/review/search/page tools; no PC or browser mutations were requested.

| Turn | Request | Delivery | Execution/coverage | Time |
| --- | --- | --- | --- | --- |
| 1 | Current target and installed capacity, publication dates | Failed spoken delivery; visible report retained | Blocked: primary evidence/review missing | 210.3 s |
| 2 | Explain net metering and official agency guidance | Report delivered | Blocked; required outcomes unverified | 110.4 s |
| 3 | Installed capacity versus actual generation | Report delivered | Blocked; quotation/coverage repair exhausted | 166.4 s |
| 4 | Bangla government solar target | Report delivered | Blocked; independent review denied (HTTP 403) | 80.6 s |
| 5 | Add rooftop versus utility-scale comparison | Interrupted; written fallback preserved | Partial; claim/source mappings missing, then provider unavailable → quota exceeded → project access denied | 38.7 s |
| 6–20 | Remaining solar requests | Not attempted | Provider blocked | — |

Turn 1's draft again treated an August 2025 rooftop target as current research. Its audio was rejected rather than treated as a verified final answer. The partial report said: “Task status: blocked; the whole request is not confirmed complete.” This is a safety improvement, not a completed research result.

Turn 3 also supplied a stitched quotation containing `. . .`; exact observed provenance and coverage were still not satisfied. Turn 5 supplied inconsistent evidence/passage IDs. These are remaining model-compliance problems; the controller did not upgrade them to successful outcomes.

The provider reported these exact conditions in turn 5: service unavailable (1011), quota exceeded (1011), then project access denied (1008). The task/evidence was preserved and delivery marked interrupted. No further requests were dispatched.

**Acceptance verdict: not production-ready.** Zero final requests were fully verified. Do not aggregate different code versions or count unattempted prompts as passes. No simple-task p95 improvement is claimed; these failed or partial runs are not a valid performance acceptance baseline.

[Final conversation transcript](~/Desktop/Orvix-Project-v2/scripts/fast-long-conversation.fast-research20-final-schema-20261005.md) · [Raw benchmark JSON](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.fast-research20-final-schema-20261005.report.json) · [Independent result audit](~/Desktop/Orvix-Project-v2/scripts/fast-research20-final-schema-20261005.audit.json)

Restart Orvix to load the changed Electron bridge/controller. A packaged Windows application and actual microphone/speaker conversation were not validated here.

