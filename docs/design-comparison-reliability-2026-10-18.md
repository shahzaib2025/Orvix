# Bounded composition comparison and preview drift

## Implemented

- `design-comparison.cjs` compacts the proposal and up to three sanitized recent records. It retains dominant hero geometry and section grouping, not prior source, image assets or conversation text. Comparison counts reflect the bounded evidence set.
- Proposal comparisons have one transient/invalid-response retry per task, persisted across resume. Each request has a 60-second deadline, with abort passed through to the actual direct/native provider call. This keeps the retried comparison within the former 120-second ceiling. Authentication/quota rejections are not immediately retried. Existing candidate limits, cancellation, caching and confirmed-repetition holds remain.
- Unavailable results remain unverified and are surfaced in the final summary even with visual review off. They never create an accepted candidate. As before, an unavailable comparison without a confirmed rejection permits progress; this remains a deliberate availability tradeoff, not a guarantee against repeats.
- Current desktop preview geometry is compared with the chosen proposal and recent layouts through the same isolated analysis lane. At most two source/proposal identities are checked; the existing targeted correction allowance handles a concrete mismatch. Matching geometry does not establish visual quality. Final edits or a changed proposal invalidate that observation, and the summary reports a missing current check.
- Identical asset lookups reuse their current-run result; known missing-key/auth/quota provider failures are retained for that run. Unrelated future runs start fresh. Guidance limits routine image hunting and explains exact motion-selector/checkpoint/settling constraints before preview. Explicit user-requested research remains in scope.
- Default/Medium/MAX retain their visual ambitions. None, repairs, faithful recreation and explicit comparison opt-outs do not acquire this construction workflow. No visual template, layout blacklist, new setting or originality database was added.

## Read-only native analysis

The live test exposed a separate failure: read-only acceptance planning used OpenCode's build-agent identity and attempted an execution tool. Orvix correctly rejected it, but construction never began.

An internal `orvix_review` primary agent now uses a short evidence-only coding-analysis prompt, with no build-temperature override. The native tool catalog and permission events remain genuine. Orvix's existing read-only handler rejects every tool/permission request, and any attempted tool still invalidates that analysis. Builder routing and its requested 0.7 temperature are unchanged.

A tested alternative hiding all tools passed local SDK/runtime checks but was rejected live with HTTP 403. It was removed, not shipped. No headers, client identity, endpoints or quota controls were spoofed. OpenCode documents custom agent prompts and permissions at https://opencode.ai/docs/agents/ ; a matching tool-restricted free-tier failure is reported at https://github.com/anomalyco/opencode/issues/50627 . The report is upstream issue evidence, not a guarantee about every provider rejection.

## Validation recorded so far

- 92 focused design/comparison/profile/review tests passed, including real browser preview flows, unverified reporting, cancellation, retry limits and profile exclusions.
- 63 native runtime tests passed. The final read-only request/denial contract was rerun after the compatibility adjustment.
- A real bundled-runtime loopback provider test confirmed the analysis agent's prompt, provider-default sampling and genuine permission-gated tools. A separate malicious permission-event fixture still rejects execution even if the caller offers approval.
- `npm run build` passed; the existing large-chunk warning remains.
- Fresh live MiMo controls, visual review off: the renamed repeated arrangement was held in 13.611 seconds; a structurally different typographic proposal was allowed in 23.836 seconds. Zero visual critic reviews ran. These are comparison controls, not new websites or a performance benchmark.
- A first full-site smoke run was stopped before construction to finish accounting/test controls. A subsequent live run demonstrated the acceptance-planner tool-attempt failure; its other arm was cancelled before construction. Those runs are not completed websites or proof of diversity.

## Fresh generation test

Final test root: `scratch/full-site-repeat-1792343115760`.
Desktop output: `~/Desktop/Orvix-Full-Site-Repeat-1792343115760`.

Two fresh Default tasks use the same brief, MiMo model, default reasoning and requested temperature 0.7, with visual review off and a shared isolated task-memory store. Each has its own task/session/worker/output directory. Native traces audit actual prompt delivery; source hashes detect changes during the test. The test watchdog is 25 minutes per arm, not Orvix's production timeout. Generation and browser results will be recorded separately after the run.

## Limits

Remote inference, network availability and model interpretation still affect outcomes. A bounded geometry comparison does not verify all typography, images, animations, accessibility or mobile states. Missing history cannot establish distinction. No finite sample proves uniqueness for every future run. Restart Orvix to load main-process changes; fresh isolated test workers load current source directly.
