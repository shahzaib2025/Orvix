# Design MAX implementation and live validation — 12 October 2026

The MAX instruction integration is implemented. The routing checks pass. Two fresh websites were generated through Orvix's production agent, but neither original run earned complete visual acceptance. The latest user-reported KINETIC visibility defect is repaired and has separate browser evidence.

## Implementation

`electron/agent/skills/website_design_max/SKILL.md` now requires at least nine meaningful sections for qualifying full websites, actual GSAP/ScrollTrigger/Lenis use, an animated hero, developed supporting compositions, connected motion and a substantial pinned story. Three.js remains opt-in. Explicit static, short, repair, application and fidelity briefs override full-site defaults. Dependencies belong inside generated projects or use versioned CDN imports.

Technical guidance covers one shared GSAP/Lenis ticker, responsive conditions, layout refresh, anchors/header offsets, scoped teardown, reduced-motion content, purposeful optional 3D, visibility-aware rendering and a working HTTP handoff for modules. The latest addition requires visible final entrance states and one coordinated animation owner per property. Generic reveals must exclude elements with section-specific entrances. Ordinary content must survive refresh and reverse scrolling; a deliberate story replacement must provide a readable replacement.

The compact execution reminder and MAX review depth criteria were updated in `electron/agent/design-review.cjs`. A routing defect that treated “20-section website” as a bounded single-section request was corrected. The existing managed skill loader/catalog and profile persistence remain in use. Default and Medium did not receive the new MAX construction policy. No new mode, setting, schema, discovery dependency, approval stage or polishing loop was introduced. Orvix was restarted after integration; current main process was verified alive.

## Automated checks

The focused suite passed **92 tests, 0 failures** after the visibility guidance change. It covers profile selection, direct/native instruction delivery, managed loading, review scope and OpenCode integration. Log: `scratch/max-motion-content-visibility-checks.log`.

Command: `node --test --test-concurrency=1 scripts/check_design_skill_selection.cjs scripts/check_agent_skills.cjs scripts/check_design_review.cjs scripts/check_design_profiles.cjs scripts/check_opencode_headless.cjs`.

These checks establish instruction delivery and routing behavior, not premium visual quality.

## Production generation evidence

Both samples used the saved selection **opencode/space-bunny-free, medium reasoning**. Each started in an empty Desktop project with a fresh production engine/native OpenCode session. Codex did not supply the initial website source, layout or starter scaffold. Direct external image URLs were used.

| Sample | Initial generation | Additional Orvix repair | Observed result |
| --- | --- | --- | --- |
| FIELDWORK — open landscape-studio brief without 3D | 804,117 ms — 13m 24s | 307,856 ms — 5m 08s | Eleven authored sections; actual GSAP/ScrollTrigger/Lenis use; desktop story progresses/reverses; local inquiry assertions pass after repair. Mobile pinned copy falls below the viewport. Full visual acceptance remains incomplete. |
| KINETIC — different subject, twenty sections and 3D | 990,055 ms — 16m 30s | Existing bounded revision during its run | Twenty authored sections; actual motion stack and a subject-related particle/grid Three.js scene; desktop/mobile pin progression, release and reverse observed. Several supporting sections are card-heavy, and credits/conclusion are light. Authored count alone does not prove twenty developed premium compositions. |

Both initial runs reached their maximum step allowance. The FIELDWORK repair also reached the allowance. Independent visual review was unavailable/incomplete; passing subsequent technical checks does not turn that into independent approval. Several production preview calls failed because of invalid capture arguments/selectors and consumed the existing budget. No further autonomous model polishing loop was started.

Initial reports: `scratch/max-motion-live-1791742129647/report.json` and `scratch/max-motion-live-1791742129647/01-Open-Website/repair.json`. Production preview outputs/images were preserved in each sample's `orvix-evidence` directory. Additional inspection results are in each `final-inspection` directory.

## KINETIC repairs made directly by Codex

The browser blocked `js/main.js` when `index.html` was opened through `file://`, as expected for this module delivery. A localhost preview and Desktop launchers were added; browser security was not disabled. At HTTP initial-load inspection, GSAP ran, ScrollTriggers existed, Lenis was active and the canvas sized to the viewport, with no script/console/request errors. This initial-load evidence alone did not establish every interaction.

The visit form saved its result, then tried to find `#planSaved` inside the form even though the panel is outside it. The selector was corrected and guarded. The separate desktop/mobile action recheck passed its visible-result assertions with no recorded errors.

For the reported disappearing cards/timeline, both the broad `[data-reveal]` loop and section-specific `gsap.from()` entrances targeted the same nodes. The overlapping hidden starts could be captured as destinations, leaving completed elements at opacity zero. Browser evidence reproduced missing cards, photographs and other section content, including a mobile timeline entry disappearing after refresh.

The correction excludes dedicated entrances from generic selectors and uses explicit visible `fromTo()` destinations for section entrances. It preserves the existing compositions and motion variety. It does not apply a global force-visible override that breaks story transitions.

The final visibility inspection sampled eight content groups and traversed the entire page forwards and backwards on desktop/mobile. On each viewport, **130 ordinary content elements** had no hidden final states after completion, explicit layout refresh, reverse traversal or a runtime reduced-motion switch. All four reduced-motion story stages were also visible. No page errors were recorded. Fresh production preview motion frames confirmed all four pin stages, release and reverse still worked, with no observed horizontal overflow or accessibility violations in those captures. Sampled frames do not measure continuous smoothness. Some photographs remained pending in bounded previews; complete remote-image reliability is not claimed.

Visibility evidence: `02-Twenty-Sections-3D/final-inspection/visibility-before.json`, `visibility-traversal.json`, matching before/after card/timeline screenshots, and the refreshed `inspection.json` hero/pin entry. The primary-action recheck preceded the entrance-only change; form logic was unchanged afterward.

Technical reference: [GSAP ScrollTrigger tips and mistakes](https://gsap.com/resources/st-mistakes/) documents cached start values and conflicting animation control. The local before/after browser evidence establishes this sample's observed defect and recovery.

## Open the samples

Desktop root: `~/Desktop/Orvix-MAX-Motion-Tests-1791742129647`.

- KINETIC: `OPEN-KINETIC.cmd`, or http://127.0.0.1:2187/02-Twenty-Sections-3D/
- FIELDWORK: `OPEN-FIELDWORK.cmd`, or http://127.0.0.1:2187/01-Open-Website/

The launchers start a hidden local preview when needed. Use them rather than double-clicking KINETIC's module-based HTML. The integration establishes stronger generation instructions; these two samples cannot guarantee every future model run's quality or uniqueness. FIELDWORK's mobile pin issue and complete visual-quality acceptance remain unresolved and are explicitly not reported as passes.

## Later preference update: connected GSAP choreography

After inspecting the samples, the user specified scroll-linked FLIP, SVG stroke drawing, SVG morphing that develops across four or five sections, richer text motion, roughly two pinned scenes for ten sections, developed detail sections and a footer navigation inspired by GSAP. This replaces the earlier one-pin default for a qualifying website of roughly ten sections.

The MAX skill and compact execution/review guidance now carry those preferences. The subject determines the object's identity, start section, visual sequence, typography, palette and footer structure. The continuous story does not require pinning all participating sections. Both pins need distinct purposes and useful unpinned content between them. Explicit scope and accessibility constraints still take precedence. Default and Medium remain unchanged.

Technical guidance is grounded in [GSAP's FLIP documentation](https://gsap.com/docs/v3/Plugins/Flip/), [DrawSVG](https://gsap.com/docs/v3/Plugins/DrawSVGPlugin/), [MorphSVG](https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/) and [SplitText](https://gsap.com/docs/v3/Plugins/SplitText/). It covers captured geometry and one scroll owner for a paused FLIP timeline, deliberate path coordinates/strokes, responsive text re-splitting and cleanup, accessible reading and readable final states. Plugins must produce observed behavior, not only appear in imports. No full demo scaffold or GSAP visual identity was added to future projects.

The GSAP [scroll page](https://gsap.com/scroll/) and homepage/footer were inspected in the browser; their pages and plugin documentation were also read. The footer's grouped navigation and closing-action hierarchy are inspiration, not a prescribed category list, column count or fake newsletter service. SVG/text motion does not authorize replacing subject photography with arbitrary blobs.

Validation: the focused profile/skill/review suite exercised 48 checks. Forty-six passed initially; two tests still asserted the superseded one-pin policy. Those expectations were updated to the user's two-pin preference and both targeted rechecks passed. Logs: `scratch/max-gsap-preferences-checks-20261012.log` and `scratch/max-gsap-preferences-policy-recheck.log`. Orvix was restarted with no active agent turns; the new process was verified alive, with no startup error beyond the existing experimental SQLite warning.

This preference update changed guidance and routing reminders, not the existing sample designs. No new full website was generated for this later update. KINETIC's previous 130-element visibility inspection remains the evidence for its repair; the new connected FLIP/SVG/text choreography has not yet been demonstrated by a fresh Orvix generation. FIELDWORK's mobile pin issue remains unresolved.
