# Tiny Agents page lag and access-check fixes

## Changes

- Closed report, evidence, saved-configuration and synthetic-preview sections defer their React content until opened. Closing them releases those subtrees. Native details/summary keyboard behavior is retained.
- The Workshop is memoized so unrelated monitor-page updates do not render it again.
- Routine worker progress carries a compact run update with status, reason, timestamps and outstanding questions. Completed report contents and plan definitions are not copied across worker/main/renderer IPC for every progress update. Full events still supply run-start, result, approval-state and terminal snapshots. An older active run outside the normal 200-run listing gets a full update. Host and renderer caches preserve completed outputs, bind updates to the run revision and refresh after missing state.
- Routine progress and timeline painting are coalesced to 100 ms. Stop acknowledgements, completion, failure and approval/clarification updates bypass progress batching. No approval, effect-intent checkpoint or durable event is skipped.
- The timeline initially renders the latest 100 loaded events, with controls to reveal earlier loaded activity and load older journal pages. Older history is retained.
- Large Workshop/monitor panels no longer animate their entire contents on entry. Small decorative motion and hover states remain. Editor overlays use an opaque tint instead of backdrop blur. Island styles are unchanged.

## Reproduction and measurements

`node scripts/check_tiny_page_performance.cjs` launches the production renderer in an isolated Electron fixture. It creates a synthetic reviewed run with 40 completed results, then delivers 40 progress updates at 50 ms intervals. Reports contain around 1.4 million characters. The fixture never performs OS actions, contacts a provider, or edits personal workflow state. It asserts that collapsed reports are absent, opening a result reveals its report, and closing it releases that content.

The initial baseline is saved in `scratch/tiny-page-performance-before.json`. The final run is in `scratch/tiny-page-performance-after.json`.

| Measured during the 40-update fixture | Baseline | Updated |
| --- | ---: | ---: |
| Renderer task CPU time | 831.6 ms | 295.6 ms |
| Renderer scripting time | 187.5 ms | 56.4 ms |
| Layout operations | 41 | 24 |
| Characters rendered inside closed report/configuration panels | 1,439,660 | 0 |
| Tiny Agents DOM elements | 1,053 | 571 |

These are isolated fixture measurements, not a guarantee of a particular frame rate on every PC. The raw frame and input timing samples remain in the JSON reports; single-run maximum frame delays and builder-opening timings were variable. The initial renderer-only change reduced script/layout work but still had a frame stall, which led to the compact progress IPC fix.

## Windows access check

`construction-access.ps1` now supplies `System.dll` and `System.Xml.dll` when compiling the native helper, matching the protection launcher. The old native fixture loaded the same type through Library mode first, accidentally hiding the missing assembly reference. Capture and Check now run in fresh Windows PowerShell processes in that fixture.

The reported journal `a832cff9-a215-41d8-be26-d0798790714a` was inspected read-only: its manifest says `unlocked`, and `original.json` exists, but `access-before.json` is missing. That historical access comparison cannot be reconstructed safely from current permissions. Check now returns a structured `attention / baseline_missing` result and a clear recovery explanation. It does not invent an original access record, claim successful access verification, change ACLs, or discard the recovery journal. A fresh read-only Check on that journal confirmed this result. Use **Check access again** to replace a previously cached compiler-error receipt with the current explanation.

## Validation

- Production build and a final TypeScript check passed. Existing large-chunk warning remains.
- Workflow suite: 32 passing tests.
- Runtime/precision/voice-client reliability suite: 20 passing tests, including compact progress preserving completed reports and immediate stop/approval updates.
- Lightweight runtime suite: 13 passing tests before compact IPC changes; relevant real-worker and cache paths were then covered by the runtime/voice-client suite.
- Monitor subscription checks: 2 passing tests.
- Production Electron UI acceptance passed: explicit Start, global Stop from another page, no effects while stopped, background consent, review, creation, scheduling, keyboard, reduced-motion and compact layouts.
- Native disposable-folder tests passed, including fresh-process compilation, missing-baseline handling, denied normal-user access, original permission restoration and successful subsequent writes. No administrator elevation or Security-log changes were used.

Source backups for this change are in `scratch/tiny-page-lag-baseline-20261021/`. Main-process progress transport changes require reopening Orvix; an already-loaded Electron main process keeps the previous code. No live provider or microphone acceptance is claimed.
