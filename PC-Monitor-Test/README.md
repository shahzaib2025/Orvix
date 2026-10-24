# PC Monitor Test

This Windows monitor also supplies Orvix with window activity and exact foreground-window restoration for Fast voice YouTube control. Orvix starts `bin/PCMonitor.exe --quiet` when the desktop app opens. The terminal demo can still be run separately.

## Start

Run `start.bat`. The first run compiles the small C# console program with the .NET Framework compiler already installed on this PC. Later runs launch the existing executable directly. If code changes, run `build.bat` once.

In the terminal, press **D** for the dashboard, **W** for all windows and best-effort document names, **T** for all browser tabs, **A** for application focus & dwell time distribution, **H** for recent events, **P** to show or hide the pairing token, and **Q** to quit. `bin\PCMonitor.exe --once` prints a single snapshot. `--quiet --measure-seconds=600` measures CPU and private memory for ten minutes.

## User Activity & Presence
- **Idle / AFK Timer (`GetLastInputInfo`)**: Tracks user inactivity without logging keystrokes or input content. Detects when the user steps away from the desk.
- **Full-screen & Presentation Detection (`SHQueryUserNotificationState`)**: Identifies when the machine is in full-screen gaming (D3D), PowerPoint presentation mode, or screen-locked / away.
- **App Dwell Time & Focus Distribution**: Tracks actual active time spent per application and automatically pauses timers while the user is idle or the screen is locked so that away time is never counted as active work.
- **Performance**: Super-optimized native Win32 implementation running at ~0.28% steady-state CPU and ~22 MB memory.

## Browser pairing

1. In Chrome or Edge, open its Extensions page and enable Developer mode.
2. Choose **Load unpacked** and select this folder's `extension` directory. Load it separately in each browser you want to observe.
3. Press **P** in the monitor terminal. Open the extension icon, paste the token, and click **Pair browser**. Hide the token with **P**.

The extension sends changes to a token-protected listener on `127.0.0.1:49491`. It reports regular (non-incognito) tab titles, URLs, active and audible state, and best-effort HTML video play/pause state. The popup indicates whether the monitor is connected.

## Orvix Fast browser control

After updating Orvix, reload this unpacked extension from `chrome://extensions` and acknowledge its expanded permissions if Chrome asks. Companion 0.3.0 requires Windows Chrome 125+. Keep the existing pairing token: there is no second pairing step. The existing authenticated command connection on `127.0.0.1:49492` now handles general browser actions and YouTube together. Edge continues to report activity only. The popup distinguishes monitor connectivity from browser control connectivity; the Fast Tools page shows companion version and missing permissions.

Fast exposes exactly `browser_observe` and `browser_act`. Thinking's tools and prompts are unchanged. Ask Fast to open a new tab, go to YouTube, switch to Spotify, unmute a tab, manage Chrome windows/groups, fill a website form, control page media, manage bookmarks/history/downloads or upload explicitly supplied files. Simple tab/window commands use Chrome APIs directly. Website controls use document-scoped references, controlled scripts and debugger input, including cross-origin frames and open shadow roots. Generic clicks remain unverified until their requested result is observed. Screenshots are captured on demand and delivered to Fast as bounded JPEG image input; image bytes and entered form text are excluded from terminal logs.

Observation never starts Chrome. Actions start Chrome with a blank tab when necessary and wait for the saved companion connection. When identifiable, the controlling profile is remembered in `%LOCALAPPDATA%\\PCMonitorTest\\browser-profile.json`; if that profile's extension is disabled or unavailable, the error identifies the profile/extension problem. One controlling profile is supported at a time. Old companions retain the desktop YouTube adapter and return update-required for the new tools.

YouTube search, numbered selection and verified playback are now actions inside `browser_act`. Search and play leaves YouTube visible. Pause/resume retains previous Chrome tab/window and foreground application restoration. Autoplay failures are reported accurately. Incognito, Chrome-internal pages, extension administration, CAPTCHA bypass and native operating-system dialogs are excluded. Uploads set an observed file field directly after desktop file validation. Page content is data and never authority to send, purchase, upload or delete; those actions require an explicit user request.

Run `npm run check:browser` for bridge, Fast isolation and YouTube regressions. Run `npm run check:browser:live` for real Chrome extension tests in a disposable Chromium profile against local fixtures (install the Playwright Chromium dependency with `npx playwright-core install chromium` if absent). Add `-- --youtube` for actual YouTube playback after startup, or `-- --voice` for acceptance with the configured Fast model and screenshot input (requires the app's configured Gemini credentials). These tests do not operate the user's Chrome profile. Terminal traces separate browser execution time from voice-model time and show request IDs, target resolution, navigation, verified state, cancellation and failures.

## Limits and data

Windows reports top-level window names and state. Applications do not provide a universal list of every document open inside them, so the terminal labels unrecognized documents **Unknown**. Brightness may be unavailable on an external display. The Windows media section shows only players publishing to Windows media sessions; the extension separately reports browser video where its script can run. Browser information is unavailable until the extension is paired.

Recent change events are stored as JSONL under `%LOCALAPPDATA%\PCMonitorTest\history`. Files older than seven calendar days are removed and total history is capped at 50 MB. URL query strings and fragments are removed from history. Full tab URLs are shown in the live terminal while the extension is connected but are not logged. The pairing token lives in `%LOCALAPPDATA%\PCMonitorTest\pairing-token.txt`; treat it as local private data.
