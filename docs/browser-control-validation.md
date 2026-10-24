# Orvix Fast browser control — validation

Validated on Windows, 30 September 2026, using a disposable Playwright Chromium 153 profile and companion 0.3.0. The user's Chrome profile and windows were not operated by these tests.

## Implemented behavior

Fast exposes exactly `browser_observe` and `browser_act`. Thinking's runtime and prompts are unchanged. The existing paired localhost command channel handles Chrome management, website interaction and specialized YouTube actions. Older companions retain YouTube compatibility through the same channel; general browser control requires the updated companion.

The controller resolves actual browser targets, returns choices for duplicate titles, rejects stale session/document/element references, serializes commands, checks outcomes and distinguishes input dispatch from verified completion. A page element can be supplied in `target` or `args.ref`. Typing validates editable controls; keyboard input focuses its target without an extra click. Visual clicks stay inside an identified control. Native drag data comes from Chrome, never model-supplied debugger commands.

Page inspection includes open shadow roots and cross-origin frames. Files are checked on the desktop before setting an observed upload field. Screenshots are bounded JPEG image inputs with text metadata; image bytes, passwords, file contents and entered form text are excluded from action logs. Browser observations are bounded and paginated. Inventory observations do not launch Chrome.

## Checks

| Check | Result |
| --- | --- |
| `npm run check:browser` | Passed: validation, fresh cache, cancellation, compatibility, paired-profile selection, Fast integration and YouTube regressions |
| Real Chromium extension fixtures | Passed: tabs, windows, groups across windows, navigation, zoom, restoration, forms, disabled/replaced controls, shadow DOM, cross-origin input, keyboard activation, canvas clicks, pointer/native drag, uploads, media, bookmarks, history and downloads |
| Recovery fixtures | Passed: full browser close/startup with saved pairing, session changes, reconnect, debugger detachment, queued cancellation, shared startup and absent companion |
| Actual YouTube | Passed: correct Shape of You video, full browser restart without re-pairing, trusted autoplay recovery, pause and resume |
| Configured Fast live model | Passed: new tab, YouTube navigation, Spotify activation, unmute, form workflow, and screenshot input in live sessions |
| `node scripts/check_voice_navigation.cjs` | Passed |
| `node scripts/check_fast_research_recovery.cjs` | Passed |
| `npm run build` | Passed TypeScript and production build; Vite reports its existing large-chunk advisory |
| `node scripts/check_thinking_flow.cjs` | Existing failure: obsolete `/EVERY user turn/` prompt assertion. Left unchanged; the new Fast integration test separately verifies Thinking has neither browser tool |

Simple browser mutations generally took tens of milliseconds in local fixtures. Startup took about 2–4 seconds; actual YouTube startup/search/playback took approximately 13–14 seconds. These are observed samples, separate from model response time, rather than latency guarantees.

Run `npm run check:browser:live` for fixtures. Add `-- --youtube` for actual YouTube or `-- --voice` for live model acceptance. Install the Playwright Chromium dependency first if absent. Live model checks use the app's configured credentials and may vary with provider availability and model tool choices.

## Enable the update

Restart Orvix and reload the existing unpacked Chrome companion from `chrome://extensions`. Acknowledge the expanded permissions if Chrome requests it. Keep the saved pairing token; repeated pairing is unnecessary. The companion popup and Fast Tools page show separate monitor/control status and companion version.

Control is Chrome-only and supports one paired controlling profile. Startup remembers the paired profile when it can identify it; otherwise Chrome's normal startup selection is used, with a specific profile/extension error if authentication does not arrive. Incognito, Chrome-internal administration, CAPTCHA bypass, password entry and operating-system dialogs are excluded. Closed shadow controls without an inspectable target and drag endpoints that cannot fit together in the viewport may require user interaction. Sending, purchasing, uploading and deleting require the user's explicit request.
