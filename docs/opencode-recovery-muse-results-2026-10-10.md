# OpenCode recovery fixes and Muse acceptance — 2026-10-10

## Findings and changes

The original Muse website run failed after repeated provider socket closures. A model catalog GET succeeded but did not establish inference health. A separate minimal native diagnostic subsequently received CONNECTION_OK from Muse in 27.953 seconds and MiMo in 16.196 seconds before the fixes; this supports intermittency and does not establish a repaired upstream network.

Verified Orvix defects were corrected:
- Native retry statuses now produce visible activity, identifying the retry attempt without replaying the task or exposing provider diagnostic bodies.
- Terminal session.error events now fail the request and clean up the owned session even if no idle event follows. Session filtering still ignores unrelated tasks. No prompt is resubmitted.
- Cleanup-induced aborts after transport failure are recorded as failed rather than user-stopped. Completed edits and reports are retained.
- Catalog GETs retry once for network failures or server errors, preserve safe cause codes on failure, and do not retry authentication failures or cancellation. Fresh compatible-model verification remains mandatory.
- Full-page screenshots perform a bounded natural scroll traversal (40 positions / 5-second budget), restore original position, and report coverage. This activates scroll-reveal/lazy content rather than hiding most of the page in a misleading image. No source or visibility styles are changed. The capture is explicitly a traversed state, not an untouched initial state. Sticky runways may still appear empty in a full-page image.

Files: electron/agent/opencode-agent.cjs, opencode-model.cjs, opencode-catalog.cjs, preview-website.cjs. The existing design-review fixture's inline-MAX assertion was updated to match the current independently changed metadata-only skill-loading route; that route was preserved.

## Validation

40 native/recovery checks passed, including cancellation, permission boundaries, native edits, retained changes, retry visibility and terminal-error cleanup. Six recovery checks passed after the full-page change (five overlap with the 40); the sixth is a real-browser off-screen reveal/restored-position fixture. Ten design-review checks passed. The existing desktop/mobile preview workflow fixture passed. Application build passed with existing large-chunk warnings. No failing check was hidden; the old inline-guidance assertion was diagnosed and corrected before its suite passed.

## Actual Muse MAX website

Run: scratch/design-max-muse-N3lRfs/result.json. Model opencode/muse-spark-1.3-contributor-free; medium reasoning, MAX profile, fast review. Unchanged FIELDWORK acoustic-object studio brief. Native agent authored project/index.html; the harness supplied only an empty scaffold and server. Completion took 302.107 seconds; first successful preview at 106.284 seconds. A preceding preview call failed and is retained in the event log. No model/default fallback was used.

Independent final-site inspection: inspection.json and screenshots/ alongside the run. Desktop/mobile inquiry navigation, name/email submission and local confirmation passed; no horizontal overflow, broken images or browser errors were reported. Full-page traversal reached the bottom on both viewports and returned to scrollY=0. Sampled scene captions progressed I -> II -> III and returned through II -> I, with stage hold/release positions observed. This is sampled behavior, not an FPS measurement.

The generated site's visual acceptance is not perfect: the audit reported a contrast-rule violation, mobile hero spacing is tight, and the signature entrance uses pale text over a pale gradient. Supporting sections are visible in the corrected full-page capture. The native agent's project-verification status was not_run because its checks preceded later edits; fresh independent browser evidence is reported separately, not relabelled as a passing project verification. Inquiry is a local demo; no real booking backend was tested.

Restart Orvix to load the backend changes. Local integration issues are fixed and an actual Muse coding/preview run succeeded. The root cause of the intermittent upstream socket closures remains unproven; future provider availability is not guaranteed.

Primary research: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.35/packages/opencode/src/session/retry.ts (official runtime retries transient socket failures), https://opencode.ai/v2/docs/network/ (local health and real provider requests test different paths).
