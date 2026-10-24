# Fast routing, window continuity, and research fixes

Date: 2026-10-09. Implemented the six reported issues.

- Banglish `khujo`, `khoj niye`, and `data niye` requests use research routing and generated acknowledgment preparation.
- `hoy nai` and `tmr workspace` retain the prior window action. A fresh native inventory is required before a retry; a window already in the desired state is not mutated again. The workspace correction identifies Orvix specifically.
- All-window tasks use the existing controller inventory and exact handle/step IDs. Pending targets run serially. The final report uses a fresh whole-set observation; missing or unminimized targets prevent aggregate success. Disappeared windows remain unverified. Scope is the initially inventoried target set, not subsequently opened windows.
- Failed page reads cannot promote a candidate into an unsupported recognized/principal competitor. Source limitations remain explicit. Local phrase guards do not constitute a general semantic fact checker.
- Explicit data follow-ups retain the research subject and evidence. If the model answers without retrieval, the controller makes one bounded relevant search attempt before requesting its answer again.
- Unsolicited output after a finished turn cannot produce a second report or play late PCM. An active punctuation-only reply becomes an unfinished-answer report and does not reuse its audio.
- Fixed a model-name parser boundary that mistook `provides` for the `Pro` suffix, and added the reported unsupported Bangla superiority formulation.

Files: `src/fastTaskContinuity.ts`, `src/fastLatency.ts`, `src/fastRequest.ts`, `src/simpleFastResearch.ts`, `src/simpleFastVoice.ts`, `src/fastResearchClaims.ts`, `electron/fast-outcomes.cjs`; focused new tests in `scripts/check_simple_fast_task_repairs.cjs`, a new live harness option, and the acknowledgment regression script entry. Existing continuity tests were preserved after correcting a new-test filename collision.

## Validation

- Twelve new regression cases cover the reported failures and exact controller plan integration. Mocked windows were used; no real windows were minimized during testing.
- Existing controller continuity/multistep tests: 64/64 passed.
- Acknowledgment regression and real Chromium Web Audio fixture passed. The fixture uses synthetic PCM and mocked retrieval; it does not validate physical speakers/microphone.
- Production frontend build passed, with the existing large-bundle warning.
- Broader legacy run: 152/191 passed, 39 failed. Several expectations still require the earlier full-speech dispatch barrier, missing-audio blocking, and older catalog-read behavior. This run does not establish that all those failures are pre-existing; no clean baseline comparison was captured. Do not claim the entire reliability suite is green.

## Live provider conversation

First attempt: search dispatched correctly, then provider response stalled twice through bounded reconnection; report was unfinished and text-only. Retained results were not replayed.

Retry: all three requests executed a search, sequentially, with acknowledgment onset before dispatch. Two answers completed audio delivery; the third was text-only after voice rendering timed out. Retrieved DuckDuckGo results did not establish the intended competitors. Serper keys were unavailable in this CLI harness. No physical microphone/speaker or packaged Windows acceptance was performed.

| Turn | Request | Tool operations | Delivery | Ordering passed |
|---|---|---:|---|---|
| 1 | florian bd er protiddhondi khujo to. Reply briefly in English; label candidates and missing evidence. | 1 | complete | True |
| 2 | na nao bolo oder khoj niye. Reply briefly in English with documented facts and source URLs. | 1 | complete | True |
| 3 | tahole data niye amk janao. Gather new documented data before answering; do not infer that missing data proves no competitors exist. Reply in two English sentences. | 1 | visible_only | True |

Evidence: `scratch/simple-fast-live.continuity-20261009.report.json`, `scratch/simple-fast-live.continuity-retry-20261009.report.json`, `scratch/fast-controller-continuity-checks.log`, `scratch/fast-task-repairs-release-checks.log`, `scratch/fast-task-repairs-build-final.log`, `scratch/fast-continuity-legacy-checks.log`.
