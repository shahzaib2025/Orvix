# Design comparison and readable-content checks — 2026-10-18

## Implemented

- Fresh Default, Medium and MAX websites and standalone heroes now use the existing bounded recent-design comparison even when visual review is Off. Confirmed repeated proposals hold construction; a materially different accepted proposal releases it. No fixed layout menu or mandatory three-direction exercise was added.
- Ordinary previews retain sanitized observed geometry under review Off, without screenshot-review captures or critic calls. This supplies actual observed relationships to future comparisons instead of only concept names. Persistence checks the current source fingerprint so an edit after preview does not turn an old observation into current evidence, including interrupted runs.
- None, Plan, repairs, faithful recreations and explicit comparison opt-outs preserve their existing exclusions. No history or unavailable comparison is reported honestly; an unavailable result does not clear an existing confirmed rejection. The existing three-comparison bound is unchanged.
- Existing preview and motion captures now report `readableContent` diagnostics. They detect opaque layers covering readable text, including pointer-inert decorative layers, and glyph ink clipped vertically by masks. Failures propagate to layout checks on native and direct routes, including ordinary functional verification under None.
- Inspection is bounded, runs only during existing captures and restores temporary hit-testing declarations before screenshots/actions. It handles scaled clipping geometry, excludes hidden/transparent entrances and usable scrollers, and reports skipped active finite animations, rotated/perspective text or ambiguous word geometry. It is not a complete visual-quality or accessibility certification.
- Browser-verification guidance now asks the builder to inspect actual settled and reduced-motion screenshots for covered copy and clipped descenders within the existing correction allowance. No additional critic, database, settings, animation package or polishing loop was introduced.

## Verification

Final focused runs passed:

- 48 comparison/profile/None/skill-selection tests (`check_design_diversity.cjs`, `check_none_design.cjs`, `check_design_skill_selection.cjs`). Includes native/direct construction gates with review Off and shared observed-history freshness.
- Four readable-content tests, including native and direct real-preview integration, an opaque `pointer-events:none` decoration, tight line masks, scaled readable text, active entrances and scrollers.
- Two real motion tests for scroll progression/release/reverse and stationary/reduced-motion sampling. Both initially timed out during a concurrent build run; both passed when rerun separately after the build, without increasing timeout limits.
- `npm run build` passed. Vite retained its large-chunk warning.

The existing viewport-fit suite and design-review regression suite also passed in the earlier combined runs. Counts above identify the final focused runs and do not sum overlapping reruns into an invented total.

## Live model comparison, not a new website generation

MiMo-V2.6-Flash Free, using the real native OpenCode route with review Off:

| Control | Observed result | Construction | Duration |
| --- | --- | --- | --- |
| Renamed same expressive layout | Repeated | Held | 31.6s |
| Different full-width typographic arrangement | Distinct against the supplied reference | Allowed | 21.2s |

The comparator received sanitized observed desktop/mobile relationships from an existing test page. It made zero visual-critic reviews. This validates those two decisions, not every future design or provider response. Comparison calls add provider work when usable recent records exist.

## Existing-page inspection

The final checker inspected three unchanged generated test pages at desktop, mobile and desktop reduced motion:

| Sample | All three observed states |
| --- | --- |
| Envelope stage | Detected supporting copy covered by `.envelope__flap` |
| Typewriter control | No readable-content failures recorded |
| Staged-card hero | Detected masked headline ink (`big` clipped below by 4px desktop/reduced, 2px mobile) |

These are bounded current-view observations. Screenshot inspection remains necessary for other states, subtle/translucent overlaps, rotated text and subjective finish. Existing sample sources were not repaired or regenerated in this validation.

Desktop evidence folder: `~/Desktop/Orvix-Design-Guard-Validation-1792337386222` (`report.json` and `readability-validation.json`).

Fresh test processes loaded the implementation. Restart an already-running Orvix main process to load the changed agent modules.
