# Fast benchmark fixes — 4 October 2026

The observed application defects were fixed sequentially, with new regressions and live follow-ups. The latest code passes 201 automated tests, browser integration, synthetic AudioWorklet interruption, Web Audio delivery checks, TypeScript and the production build. Live research acceptance remains incomplete because the independent Gemini verifier returned HTTP 429 and 403. This is not a production-readiness sign-off.

## Changes and their purpose

1. **Restart and continuity:** an errored, disconnected Fast session can reconnect without losing its task identity or executor evidence. Connecting/active sessions cannot open duplicate connections. Terminal reply timeouts preserve unfinished delivery before closing the socket.
2. **Weather execution:** supplied step IDs reach the executor; custom plans do not trigger unrelated sibling autofill. Protocol rejection is neither cached nor relabeled as unavailable weather. New planned reads execute their own steps. Answer checks distinguish actual temperature, feels-like readings, comparisons and Celsius/Fahrenheit wording.
3. **English/Bangla follow-ups:** continue/add/refine remain distinct. Additions preserve earlier verified outcomes and source mappings; corrections invalidate affected work. These phrases never approve an action.
4. **Required rereads:** an explicit reread creates a controller-owned fresh-read step. Revised plans cannot remove or substitute it, and added conclusions depend on it. The exact controller-planned read can execute while the added answer still needs a revised plan. Only the completed retrieval is verified; article claims still need independent support.
5. **Planning repairs:** additive plans retain existing requirement meanings and verified reads. New questions receive fresh reads. Missing comparison/explanation answer steps inherit source dependencies. Generic answer-only research seeding no longer conflicts with concrete plans.
6. **Exact source provenance:** review claims can reference a controller-provided `sourcePassageId` instead of copying and stitching source quotations. Unknown/stale references and conflicting fabricated quotations fail. The controller resolves the observed passage; independent review still decides whether it supports each claim. Repair suggestions preserve the proposed answer and use current evidence references.
7. **Bounded review recovery:** repeated invalid plans and equivalent reviews stop after the initial attempt and two repairs. Changed quotation formatting cannot keep an unsupported answer draft in an endless semantic-review loop. Provider outages have a separate bounded recovery limit. A later human continuation can retry preserved evidence without repeating completed effects. Task action/time limits and the separate 60-call control limit remain enforced.
8. **Country scope:** the authoritative controller rejects foreign policy pages before retrieval when Bangladesh evidence is requested. Country names in URL query parameters cannot bypass the check. A requested negative scope check proves rejection only, never article content.
9. **Research leads:** retrieved URLs are retained as bounded session-only leads and reread for new evidence. Known/requested domains are tried directly, including focused `site:` searches. Business queries use relevant website/product fallbacks. Official Gemini documentation requests reject unrelated API websites.
10. **Domain routing:** weather-only comparisons avoid generic web-research requirements. Returning a function result no longer creates a return/refund-policy requirement. Explicit commercial return/refund questions still retain that check.
11. **Truthful reports:** rejected draft facts and model-owned unknown obstacles cannot enter the spoken partial report. Verified earlier passages remain available. Missing outcomes are described as unverified in this attempt, rather than nonexistent or undocumented. Recovery commands are converted into short explanations. Page-read confirmations describe the retrieved excerpt without truncated promotional titles.
12. **PC observations:** raw handles remain available for operations; application and non-minimized application lists are separate. Earlier native snapshots supply observed added/removed/unchanged titles. Requested comparisons must be covered. A notification window's own title cannot excuse reporting it as a visible application. Native evidence mappings do not require irrelevant web quotations.
13. **Speech safeguards:** diagnostic metadata records matching and recovery counts without logging PCM or transcript payloads. Unreviewed speech remains held. Missing audio does not repeat completed work.

## Validation and live results

| Run | Requests | Model tool calls | Final text/PCM reports delivered | Controller marked complete | Result |
|---|---:|---:|---:|---:|---|
| Full 20-turn rerun, v2 | 20 | 72 | 18 | 8 | Exposed additional quotation, reread, provider and delivery failures; later patches followed. |
| Focused follow-up, v3 | 9 | 31 | 9 | 3 | Found a false visible-window classification, a native claim-schema rejection, and the planned-reread conflict. These were subsequently fixed. Research encountered verifier HTTP 429/403. |
| Fresh PC/scope/failure retest | 4 | 13 | 4 | 4 | All four requested checks passed; no completion mismatch found in the independent domain audit. |
| Fresh documentation/reread retest | 2 | 8 | 2 | 0 | The official page was actually reread and its fresh-read step verified. Research completion remained blocked; no success was claimed. |

“Delivered” measures a final report in the text-driven harness with admitted PCM, not physical speaker playback or full task satisfaction. Raw harness `answer` concatenates interrupted and final segments; this is not proof that duplicate speech played. Per-segment delivery records preserve the distinction.

The 20-turn run used real Gemini Live, production public search/page/weather services and native PC reads. It did not use the previous explicit manual stop/start workaround. Turn 13 exercised the restart after a stalled response while preserving the ledger. Browser control was unavailable in this harness, and mutations were blocked by its adapter. No user settings or existing PC worker rules were changed.

The full v2 run's unsuccessful requests were reviewed: turn 2 encountered weather HTTP 503; turns 6–7 failed source mapping; 8–9 lacked useful retrieved comparison evidence; 10 encountered verifier failure and missing spoken delivery; 11 failed evidence verification; 12 skipped rereading and stalled after repeated reviews; 13 retained an unfinished task; 18 lacked proof for the requested completion distinction; 19–20 retained unfinished audit outcomes. These are preserved rather than counted as successful requests.

The focused v3 run's window false positive is retained in the audit, not removed from the statistics. The corrected fresh PC run lists ChatGPT as the visible application, separates installed Notepad from open windows, rejects the Ghana policy URL as Bangladesh evidence before retrieval, and reports the invalid-domain fetch failure accurately.

The documentation retest proved retrieval continuity, not successful research acceptance. Its subsequent “returns and refunds” heuristic false positive was reproduced and corrected with regressions. The final human-continuation/provider-retry adjustment was verified automatically; the live records retain their original code hashes and do not pretend to test later patches.

Final checks:

- `npm run check:fast-reliability`: 201 tests passed; production browser integration passed; actual AudioWorklet with synthetic input and drained Web Audio delivery checks passed.
- `npm run check:voice-navigation`: passed during this fix cycle.
- `npm run build`: TypeScript and Vite passed; existing warnings for bundles larger than 500 kB remain.

## Remaining acceptance limits

The independent research verifier returned HTTP 429 and 403. Account/key/model access and quota need to be checked before research acceptance can complete; these codes do not establish one specific account-side cause. The app preserves evidence and reports the blocker. It must not bypass verification to make those requests appear successful.

Five separate ten-turn conversations with at least 48/50 fully satisfied requests have not passed. A zero-false-completion release gate has not been established across that suite. Live mutation recovery was not exercised; automated uncertain-effect and approval regressions passed. Physical microphone input, human interruption, audible Windows responses and the packaged Windows app remain untested here. The small, changing-provider sample does not establish a reliable simple-task p95 latency comparison. Production readiness remains unconfirmed.

## Evidence

- [Consolidated per-request audit](~/Desktop/Orvix-Project-v2/scripts/fast-fixes-20261004.audit.json)
- [Full 20-turn record](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.fixes20-v2-20261004.report.json)
- [Focused nine-request record](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.fixes-focused-v3-20261004.report.json)
- [Fresh PC/scope/failure record](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.fixes-native-final-20261004.report.json)
- [Fresh documentation/reread record](~/Desktop/Orvix-Project-v2/scripts/check_fast_long_conversation.fixes-reread-final-20261004.report.json)
- [Final reliability log](~/Desktop/Orvix-Project-v2/scripts/fast-fixes-20261004.reliability-final.log)
- [Final build log](~/Desktop/Orvix-Project-v2/scripts/fast-fixes-20261004.build-final.log)

## Research basis

The application executes functions and returns results, with independent parallel calls distinguished from dependent chains. This supports keeping execution, dependencies and completion checks in Orvix's controller. [Google function-calling guidance](https://ai.google.dev/gemini-api/docs/function-calling).

Live event handling must distinguish tool scheduling, interruption and completion; client `turnComplete: true` can interrupt generation. Connection resumption and bounded context support longer task continuity. [Google Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

Google recommends bounded backoff for transient errors and advises against retrying client errors such as 403 as though they were transient. Provider availability must remain separate from a claim-support verdict. [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting).

Windows visibility styles do not establish whether a window is unobstructed. The reported application inventory therefore distinguishes minimized and internal windows while retaining this visibility limit. [Microsoft IsWindowVisible](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowvisible).