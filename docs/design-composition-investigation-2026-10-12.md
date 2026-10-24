# Design composition investigation — 12 October 2026

## Implemented changes

- MAX's creative entrypoint is reduced from 2,906 to 1,026 words. The GSAP/Lenis implementation mechanics live in a separate, registered MAX-only reference, loaded after choosing a direction. No new design setting, tool, storyboard schema or cross-chat history database was introduced.
- The creative instruction distinguishes structural originality from different fonts, colors, names and animation. A human-supplied rejected composition belongs in the existing brief and must be compared during the existing visual check. It does not impose a replacement layout or global font blacklist.
- The technical reference covers one shared ticker, callback identity on cleanup, responsive pinning, readable/reduced-motion content, and fresh captures after changes. These instructions are not proof that every model follows them.
- When a full MAX candidate has fresh changing-motion evidence and a storyboard, the existing first visual pass can combine its composition findings with observed browser failures in one revision. Failed browser checks cannot become approval, and an originality rejection remains material. Missing story/motion evidence retains the existing gate.
- Explicit bounded composition studies no longer acquire the full-website construction reminder. Default and Medium instructions remain separate; other profiles cannot load MAX's implementation reference.

## Code validation

The focused profile, native/direct skill-loading, review and OpenCode regression suite passed **95 tests, zero failures**. Log: `scratch/design-composition-regressions-final.log`.

This verifies routing, state isolation, evidence handling and revision bounds. It does not grade the generated websites.

## Frozen comparison: minimal versus former MAX instructions

Desktop output: `~/Desktop/Orvix-Design-Composition-AB-1791782766212`.

Both studies used Space Bunny Free with medium reasoning, the same three-section MERIDIAN brief, three direct Pexels assets, tools and runtime settings. Each had a new task, workspace and runtime. Both frozen Electron snapshots were created before production instruction changes. Only the MAX entrypoint body differed. Sampling randomness was not controlled.

| Condition | Time | Outcome |
| --- | --- | --- |
| Minimal creative entrypoint | 6m 48s | Returned; latest recorded desktop/mobile captures had no broken images, overflow or accessibility violations, and its navigation/accordion workflow passed. Independent design review remained unavailable. |
| Former detailed MAX entrypoint | 10m 01s | Cancelled at the experiment's ten-minute bound; a candidate exists, but current visual acceptance was not completed. |

I inspected both desktop openings, full-page captures and mobile compositions. Both chose large serif branding on the left with the same architectural photograph on the right, followed by white editorial sections. Interior details and interactions differ; these are similar compositions, not identical source files. The minimal study's accordion changed its counter and content when exercised; the original-guidance study's mobile project link reached its project section.

The result does **not** support blaming the long skill file as the sole cause. A plausible explanation is convergence between the model's preferred patterns and the repeated subject/theme/assets, but this pair cannot isolate every factor or reveal provider-internal behavior. It also does not establish a cross-session memory leak.

Limitations: both frozen conditions retained the shared compact reminder. The old scope detector classified the bounded three-section brief as a full MAX site; this was identical across conditions, but could pressure both runs. The test is not vanilla OpenCode versus Orvix, and it is only one pair. Runtime native builders have a 24-step limit per pass; repeated previews/asset calls can consume that allowance before final inspection. This explains incomplete inspection, not repeated composition by itself.

## Revised guidance and model comparison

Fresh generations are being made through the production Orvix engine in `~/Desktop/Orvix-MAX-Motion-Tests-1791783737051`. Both use the same full-site brief and explicit rejection of the earlier split-hero/editorial/card-grid structure. One retains Space Bunny Free/medium; the other explicitly benchmarks Step 5 Preview Free/medium. The model override is benchmark-only and does not change saved user settings.

Results pending. Do not interpret this report's implementation or passing checks as completed visual acceptance.
