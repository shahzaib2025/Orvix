# Fast tool-call fixes and validation

## Changes

- Supplemental web-search/page-read recovery has its own bounded ledger step, preserves prerequisites, and does not mark the original expected result complete. Mutations cannot use this recovery path.
- The controller preserves requested generation-completion and turn-completion outcomes. Completion review rejects missing concepts even when the model supplies fluent, source-quoted text.
- Scope-only negative findings are distinguished from retrieved article content. A supplied foreign-market URL check has an executable plan; completion requires an explicit rejection, no claim of page retrieval, and an unverified Bangladesh-policy statement.
- Plan schemas constrain execution tool names; review_task outlines normalize to answer synthesis and cannot mark effects successful. Repair feedback names missing outcome IDs and explains why root-only coverage is insufficient.
- Citation presentation does not automatically verify combined explanation-and-citation requirements.
- The browser/native adapter boundary removes only internal stepId, revision and controlIdentity metadata. The strict browser protocol still rejects other unexpected fields. This fixes the navigate/tab_open invalid_request sequence in the supplied log.

## Checks

- 133 Fast regressions passed, plus browser integration, synthetic AudioWorklet input and Web Audio delivery drain checks.
- 28 Tiny Workflow regressions passed before the final transport-only boundary fix.
- Renderer TypeScript/Vite build passed; existing large-chunk warning remains.
- Final diagnostic Windows package and packaged-code renderer/preload/IPC smoke passed. Executable resource editing was disabled; this is not normal release or installer acceptance.
- Real disposable Chromium with controlled pages passed shared-controller navigate/tab_open, independently verified resulting URLs, stale-reference input/Enter, failed-action speech suppression and delayed YouTube results. These checks do not certify a user browser profile or the public YouTube site.

## Live evidence

| Check | Tool calls | Result |
|---|---:|---|
| Function-calling execution/response explanation | 4 | Completed in 30.6s |
| Negative country-scope check | 3 | Completed in 31.3s; rejected page content was not read |
| Generation-versus-turn completion | 10 | Remained partial: generation-completion source mapping missing; no false completion accepted |

These targeted checks used successive development snapshots. The final browser boundary fix was verified separately with real Chromium and the final automated suite.

The URL https://www.uber.com/gh/en/ride/safety/audio-recording/ is specific to Uber in Ghana, indicated by the "gh" in the URL path. Consequently, this page cannot be used to verify the policy for Uber in Bangladesh. The page content was not read, and the existence or details of an audio recording policy for Bangladesh remain unverified. Explicit evidence from a Bangladesh-specific Uber source is missing.

The attempted post-fix ten-turn run was not an acceptance pass: its first request stalled, its competitor comparison lacked usable sources, and the Live connection disconnected on turn three. The harness could not execute subsequent requests in that disconnected session. Production readiness remains uncertified.

## Remaining limits

- A readable source excerpt and lexical quote matching are provenance checks, not a universal semantic correctness guarantee.
- Provider stalls/disconnections and unreadable competitor sources still prevent some live requests from finishing.
- Physical microphone, audible output, matched simple-task p95 baseline, full packaged lifecycle and installer acceptance remain unverified. Normal Windows resource editing still fails; diagnostic packaging disables executable editing/signing.

Raw targeted reports: `scripts/check_fast_long_conversation.toolcall-final-turn-3.report.json`, `scripts/check_fast_long_conversation.toolcall-final-turn-9.report.json`, and `scripts/check_fast_long_conversation.toolcall-final-scope-check.report.json`.
Browser report: `scripts/check_fast_browser_acceptance.report.json`.
