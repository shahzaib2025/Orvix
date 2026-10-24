# Website design review in Orvix

Implemented 2026-10-10. This is a bounded quality-control loop, not a guarantee of premium design on every brief.

## Controls

The agent composer has a website design review selector. The selected preference is saved locally and recorded on each turn, including retry/recovery metadata. It applies to website builds and substantial design changes; Plan, research-only, backend work and narrowly scoped edits do not trigger it.

| Mode | Independent critique | Revision limit | Final evidence |
| --- | --- | --- | --- |
| Balanced (default) | One image-based critique | One batch | Fresh browser capture after edits; no second independent grade |
| Fast | None | No critic-driven revision | Builder inspects fresh browser evidence |
| Thorough | Up to three critiques | Up to three batches | Fresh capture after the last revision; no implied fourth grade |
| Off | None | None | Existing agent tools remain available |

Use an image-capable model for visual review. A model that does not advertise image input produces an explicit unavailable review, rather than a text-only visual approval. Provider failure, invalid reviewer JSON, unknown screenshot labels or declined/unavailable preview also remain explicit limitations.

## Flow

1. The builder uses shared design guidance to choose a direction, define an audience and primary action, and record a task-specific brief with `set_design_brief`. References and constraints support a distinct design rather than a prescribed component template.
2. The builder uses the existing local preview tools to capture relevant desktop/mobile layouts and check the primary interaction. Captures include image references, viewport labels, source fingerprints, browser metrics and assertions.
3. A separate reviewer call receives the original request, chosen brief, captured images, compact browser observations and up to two attached references. Its rubric covers fit, originality, composition, typography, imagery, useful layering, mobile craft and usability. It returns at most five actionable issues and preservation notes; no numerical premium score.
4. Material issues return one targeted batch of feedback to the builder. Fresh evidence is required after source changes. Unchanged candidates reuse their review. Balanced stops after one revision; Thorough is bounded at three.
5. The result distinguishes independent approval of a captured candidate from a builder's inspection of a revised candidate. Browser failure and unavailable review keep completion marked partial. Functional/build evidence remains separate from aesthetic judgment.

The direct provider route continues its existing execution loop. Native OpenCode finishes and releases its exclusive builder session before the separate reviewer starts, then creates a new builder session for revision. Its managed preview server stays alive across these stages and stops when the task ends.

The native reviewer uses the official built-in agent. All execution tools require permission and its permission handler always rejects them, regardless of the caller's permission callback. It attaches no visual MCP bridge, and any attempted tool invalidates the review. This preserves native runtime compatibility without granting reviewer execution rights. Locally, removing the native tool definitions using deny-all permissions caused a free-model HTTP 403; mandatory permission gates allowed the reviewer request to proceed. Related upstream reports discuss the tool/permission cluster: [OpenCode issue 53347](https://github.com/anomalyco/opencode/issues/53347).

## Evidence and accounting

`design-review.cjs` saves chosen briefs, captures, raw reviewer responses, parsed reviews and checkpoint state in the existing evidence/task stores. Both routes expose design-review status and per-stage measured token usage in the verification panel. The total sums reported stages; missing provider measurements are shown as unavailable and prices are not invented. Native usage retains the existing per-message aggregation.

The speed tradeoff is deliberate: compact critique context, one default reviewer call, one batch of edits, unchanged-review caching, bounded iteration and a surviving native preview server. This does not establish a latency improvement against a baseline. Browser reuse across captures and parallel capture scheduling are not part of this change.

## Validation

Run `npm run check:design-review` for scope, strict schema validation, stale captures, revision bounds, checkpoint restoration, cancellation, missing usage, permission rejection, and both builder routes with real browser captures. Provider decisions in these automated tests are fixtures.

Run `npm run check:design-review:live` for a disposable local fixture with an intentionally overflowing mobile layout. It uses a verified native image-capable free model, real screenshots, an independent critique, actual file revision and fresh interaction assertions. It writes evidence to `scratch/design-review-live/result.json` and stops the managed preview/runtime. A failed or unavailable critic makes this check fail explicitly. This single fixture is not a broad design-quality benchmark.

Also run `npm run check:agent`, `npm run check:visual-tools` and `npm run build` after integration changes. These do not validate the packaged app's selector visually or replace human design evaluation.

Observed validation: 10 design-loop tests, 24 visual/runtime tests and 96 agent regressions passed, plus the TypeScript/Vite build. One overloaded Windows temporary-directory cleanup failed in an earlier concurrent run; the isolated test and full rerun passed. The real LongCat 2.5 Preview Free fixture passed in 244 seconds: roughly 60 seconds initial builder, 30 seconds critic and 154 seconds revision. The final two viewports had no horizontal overflow and passed the preserved button interaction. Both owned preview URLs were unreachable after completion. These measurements describe one staged fixture, not typical speed or a broad quality result. Evidence: `scratch/design-review-live/result.json`.

## Quality and speed evaluation before stronger claims

Use `scripts/design-review-benchmark-briefs.json` as ten varied briefs. For each brief, start a fresh identical project state with the same provider/model/variant and compare Off, Fast and Balanced. Keep references and functional acceptance checks identical. Record total duration, time to first preview, measured stage usage, browser failures, critique/revision count and screenshot/source evidence. Repeat runs to distinguish model variation from the effect of the loop; report median and slow-tail latency rather than selecting the best sample.

Have human reviewers compare the final screenshots without seeing the mode. Judge brief fit, originality, hierarchy/type, mobile craft and functional preservation. Calibrate the rubric on examples before reporting results. Add Thorough only where the extra round has a measured benefit. No automated reviewer verdict establishes that every future website will be original or premium.

This approach follows the latency emphasis on fewer requests and shorter outputs in [OpenAI's latency guide](https://platform.openai.com/docs/guides/latency-optimization), and the separate-builder/evaluator lesson in [Anthropic's application harness research](https://www.anthropic.com/engineering/harness-design-long-running-apps). The bounded default is an Orvix implementation choice, not a measured optimum.
