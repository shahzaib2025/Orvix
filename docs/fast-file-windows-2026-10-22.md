# Fast file opening and window control

Fast can launch supported local documents and media through their Windows default app, then identify the file window and verify its requested native state. A plain open defaults to maximized; this uses the monitor work area rather than immersive full-screen mode. Explicit minimize, normal/restore, focus, or snap instructions take precedence.

## Behavior

- File paths come from the request or existing directory/file observations. Missing paths and ambiguous matches require clarification.
- A matching file title and associated application identify a candidate window. Existing matching windows are reused. When multiple windows match, Fast returns choices; an observed handle can resolve the choice.
- Follow-ups retain the file path, HWND, application and process identity. A changed process, closed window, or different document tab is rejected before acting.
- Snap placements cover left/right halves and the four quarters of the current monitor's work area. An unspecified small portion prompts a side/corner question without executing a tool.
- Restore uses the saved normal rectangle, including after Fast has snapped the window. Native state and geometry are checked before success is reported.
- The controller retains explicit file/window intent after its opening operation has been consumed. It prevents a later model proposal from changing restore into maximize, changing an explicit open-minimized request into maximize, or substituting an unrelated mutation.
- Opening in an app, reading text, and selecting an item in Explorer are distinct operations. Existing Explorer behavior remains available.
- Scripts, executables, installers and shortcuts are outside automatic file launching. Unsupported formats can still be selected in Explorer. The bridge has no delete operation.
- Closing retains the existing exact-action approval flow, then checks whether the window disappeared. Unsaved-changes prompts are left for the user; no save/discard button is automatically selected.
- Operation IDs prevent duplicate dispatch. Uncertain launches are not repeated under a different operation ID; cancellation before a queued launch prevents it from starting. Cancellation after dispatch preserves observed effects rather than reversing them.

## Interfaces and implementation

Fast-only model tools are declared in `shared/fast-file-tools.json`:

- `open_local_file(path, windowState?, handle?)`: open/reuse a document window. `handle` is only for choosing an observed ambiguous candidate. Default state is `maximized`.
- `position_window(handle, layout)`: position an observed window in a half or quarter of the screen.

`manage_window` continues to handle minimize, maximize, restore, focus and close. For retained Fast file windows, private identity/path fields let the existing Fast executor validate the exact document before applying the action. Other window callers retain their existing behavior.

The private `fastFileWindow` preload bridge calls `electron/fast-files.cjs`. That service reuses Explorer's local path resolver and runs a fixed PowerShell/Win32 helper with structured input in an environment variable. File paths are not interpolated into shell commands. Native operations share the existing interaction queue. The helper is explicitly unpacked for Electron packaging.

Fast's request routing, tool results, per-task completion handling, plan matching and progress vocabulary recognize these new operations. Thinking source and its shared window/work declarations match the pre-change backups.

## Validation

- **95 targeted tests passed**, covering file types, missing/ambiguous paths, existing windows, observed choices, changed identities/tabs, launch uncertainty, duplicate protection, cancellation, approvals, unsaved close outcomes, geometry, multilingual routing, controller intent enforcement and existing Fast regressions.
- **Production build passed**, including TypeScript. Vite retains the existing large-chunk warning.
- **Twelve native Windows cases passed** through real Electron preload/IPC: opening maximized, minimizing, maximizing from minimized, normal restoration, focus, six snap positions, and restoring the earlier rectangle after snapping. Existing-window reuse and approved closing also passed. Persistent focus is not asserted after another app or the user changes foreground focus; focus is observed during the action.
- **Seven typed Gemini Fast turns passed** against an actual Bengali-named document in its default Windows app: open maximized, Bangla minimize, Banglish maximize, left half, unspecified small portion (clarification with no operation), bottom-right quarter, and restore. All seven reports completed, and window state/geometry was independently observed after each report.
- Early runs exposed normal-restore/maximize sequencing, missing verification in the installed older monitor, an incorrect model maximize proposal, and missing positioning verbs in acknowledgment validation. These issues were corrected and the relevant checks rerun.

Evidence:

- `scratch/fast-file-windows-tests.log`
- `scratch/fast-file-windows-build.log`
- `scratch/fast-file-native-1792673930003/report.json` — twelve native cases and closing
- `scratch/fast-file-native-1792674092148/report.json` — final seven-turn conversation and closing

Repeat checks with `npm run check:fast-files`, `npm run check:fast-files:native`, or `npm run check:fast-files:live`.

## Limits

The live harness used real provider generation and real Windows actions with simulated audio scheduling. Physical microphone/speaker and the packaged installed app were not tested. Native app coverage used the configured text editor; other document/media associations may hide file titles, reject sizing, or expose minimum sizes. Those outcomes remain unverified instead of being reported as success. No universal latency or application-compatibility guarantee is established.

Restart Orvix to load the new main-process, preload and renderer changes. Fast desktop control must be enabled.
