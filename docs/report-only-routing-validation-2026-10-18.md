# Report-only routing correction — 2026-10-18

## Implemented correction

`electron/agent/steer-policy.cjs` previously treated any request containing both a reporting word and a stop word as report-only, except for a small continuation expression. A fresh website request ending in “report observed results, and stop” consequently suppressed automatic skill selection. Adding “then implement” accidentally restored skill loading by matching the continuation exception.

The classifier now distinguishes an imperative work clause before a terminal report from immediate cancellation. Explicit “Stop now”, “Do not continue”, and report-only requests still terminate work. No design skill, layout instruction, provider temperature, review setting or production timeout was changed.

## Local verification

- 30 tests passed across `check_steer_policy.cjs`, `check_task_skill_router.cjs`, `check_agent_skills.cjs` and `check_agent_steer.cjs`.
- Five selected native OpenCode recovery/steering/report-stop tests passed.
- `npm run build` passed; Vite retained its large-chunk warning.
- The regression covers terminal delivery wording across None, Default, Medium and MAX, as well as actual local skill preparation and direct-executor guidance delivery. Existing native report-stop coverage verifies interruption remains effective.

## Fresh live comparison

The controlled experiment uses MiMo-V2.6-Flash Free, default reasoning, requested temperature 0.7, fresh local tasks/workers/workspaces, review off, and the same single-hero brief. Arms: None, Default, and Default plus three explicit spatial wireframes. Default arms must have identical automatically selected skills, and the native prompt wrapper asserts that their complete instruction bodies actually reach the provider submission.

None retains relevant shared skills including visual_composition; it is not an entirely unguided-model control. Provider sampling internals and any provider-side state are not observable. A single sample per arm cannot prove universal originality.

Live results and screenshots are recorded separately in the experiment's Desktop comparison folder. Do not infer visual quality from these local checks or call a cancelled generation a completed handoff.

Completed retest: `~/Desktop/Orvix-Hero-Exploration-1792330409012`.

- None: five shared skills embedded, no website-profile skill; page saved/previewed, final handoff cancelled at the experiment's 15-minute cutoff.
- Default: six skills embedded; handoff in 13m22s, familiar split hero; fixed its first-draft image-height and contrast defects. Current managed performance check failed with a 3800ms mobile LCP observation.
- Default plus three wireframes: the same six skills embedded; handoff in 10m10s; selected and implemented a central message-slip layout with surrounding cards. Current managed checks passed. The visual family remains similar and tiny decorative text clips on mobile.
- All three saved pages passed independent desktop/mobile dialog checks; all nine desktop/mobile/reduced-motion views had no overflow, JavaScript errors or unresolved images. Automated accessibility scans recorded zero violations with incomplete contrast evaluation.
- Routing/guidance source hashes stayed unchanged during generation. No provider quota/HTTP rejection was observed in this retest. Fresh test processes loaded the fixed source; a previously running Orvix main process needs restarting to load the correction.

This verifies the routing correction and demonstrates one changed composition; it does not prove universal design uniqueness.
