# Browser tab reuse update

Implemented in extension 0.3.2 and the Fast browser routing layer.

## Behavior

- Opening a website, navigating, searching, and YouTube search reuse an existing matching website tab by default. The active matching tab in the focused window takes priority; otherwise an exact destination or recently used matching tab is selected.
- A new tab is created when explicitly requested or when no matching site exists. Legacy callers omitting the policy on `tab_open` retain their original creation behavior. Fast supplies the policy explicitly.
- Fast retains the resolved tab reference within the task. YouTube search, selection, pause, and resume honor the selected target instead of silently switching to another YouTube tab.
- Compact tab and window metadata is exposed through the existing PC context. Browser events debounce inventory updates by 100 ms; cached command inventory older than two seconds is refreshed. Relevant page reads include document identity and observed controls.
- Generated tool explanations can say how many matching tabs are open and that an existing tab will be used. There is no additional canned acknowledgment.
- Navigation invalidates stored element references. YouTube results require the expected query and a new document, complete page loading, no observed loading indicator, and a quiet period after result changes.
- Approvals, cancellation, the existing result check, exact-mutation duplicate protection, and the quick window-action exception remain in place.

## Validation

| Check | Observed result |
| --- | --- |
| Routing unit tests | 13 passed |
| Focused Fast integration | 3 passed: reuse explanation and continuity, uncertain mutation protection, Stop during inventory refresh |
| Actual isolated Chromium with production extension and WebSocket bridge | 20 of 20 controlled website scenarios passed |
| Delayed YouTube fixture | Waited for updated rows instead of using the old row; no extra tab |
| Public YouTube | Search, selection, verified playback state, pause, resume, and saved-pairing startup passed |
| Existing browser bridge checks | Passed |
| Existing YouTube control regression | Passed after loading the shared selector in its VM harness |
| TypeScript and Vite production build | Passed; existing large-bundle warning remains |
| Broader selected Fast tests | 91 passed, 40 failed before the three new focused integration cases were added |

Artifacts: `scratch/browser-tab-reuse-live.report.json`, `scratch/browser-tab-reuse-live.log`, `scratch/browser-routing-unit.log`, `scratch/browser-routing-integration.log`, `scratch/browser-routing-public-youtube.log`, `scratch/browser-routing-fast-tests.log`, `scratch/browser-tab-routing-build.log`.

The 20 browser scenarios cover first opening, exact and same-site reuse, explicit new tabs, focused-tab selection, task continuity, relevant page controls, unrelated sites, stale targets, event inventory, YouTube target selection and playback, delayed search updates, and reconnect inventory. They use a disposable Chromium profile with controlled pages. The separate public YouTube run uses the actual public service and observes browser playback state; it is not proof of physical audible output.

## Remaining release gaps

This update is not a claim that the whole Fast profile is production-ready. The broader selected Fast suite still has 40 failures involving acknowledgment streaming, preparation, research follow-ups, and voice-turn behavior. Earlier work also recorded 40 broader reliability failures; this update does not resolve those unrelated contracts.

Microphone conversation, physical speaker output, generated reuse wording from the live voice provider, and the normal packaged Windows app connection have not been validated by these checks. Tab reuse is a deterministic preference, not a measured 99% reliability guarantee. Delayed-result readiness relies on observable document, loading, query, and DOM state; it cannot establish that a website will never update again.

## Using the update

Reload the extension from `PC-Monitor-Test/extension` in Chrome's Extensions page and restart Orvix so both ends use the updated routing. Extension version: 0.3.2. Run `npm run check:browser:reuse` to repeat the routing and controlled-browser checks.
