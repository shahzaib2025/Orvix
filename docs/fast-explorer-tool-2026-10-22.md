# Fast File Explorer tool

Fast now has `open_in_explorer`, enabled by the existing desktop-control setting. Thinking and the shared filesystem tool declarations are unchanged.

## Behavior

- Open an existing folder visibly in Windows File Explorer.
- Select an existing file in its parent folder. This does not launch the file in its associated application.
- Reveal a folder in its parent when explicitly requested.
- Reuse the path observed by directory listing, file reading, or an unambiguous file search for follow-ups such as “open that folder.”
- Resolve common folder aliases; ask for a location when paths are ambiguous. Missing paths produce an error rather than a success report.
- Check the visible Explorer folder and selected item before reporting success. If observation is uncertain, perform one passive reconciliation without opening the item again.

Fast receives guidance distinguishing visible Explorer navigation from background listing/reading. Acknowledgment starts before dispatch; operations retain the existing interaction queue, cancellation, settings, and duplicate protection. A speech-only report repair can reuse the verified receipt without repeating the operation.

## Implementation

- `shared/fast-explorer-tool.json`: Fast-only declaration.
- `electron/fast-explorer.cjs`: local path resolution, native execution, observation, deduplication, and IPC.
- `electron/main.cjs`, `electron/preload.cjs`, `src/desktop.d.ts`: private bridge registration and types.
- `src/fastExplorer.ts`, `src/simpleFastVoice.ts`, `src/fastPlan.ts`: intent, observed-path continuity, dispatch, and reporting.
- `scripts/check_fast_explorer.cjs`, `scripts/check_fast_explorer_native.cjs`: focused and native/live checks.

## Validation on 2026-10-22

- 103 targeted tests passed: 22 Explorer checks and 81 related research/browser/search checks.
- Production build passed. Vite still reports large chunks.
- Real Electron preload/IPC and Windows Explorer passed folder-open and Bengali-file-selection checks (approximately 1.10 s and 1.18 s in the recorded native run).
- Four typed Fast turns using the real Gemini connection passed: list a folder, open that folder via a Hindi follow-up, select a Bengali-named file, and attempt a missing file. Every operation followed acknowledgment onset, and all four reports completed. The missing file was correctly reported as missing.
- Thinking source and the shared filesystem declaration match the pre-change backups byte for byte.

Evidence: `scratch/fast-explorer-native-1792667966919/report.json` and `scratch/fast-explorer-backup-20261022/final-tests.log`.

The live harness uses simulated audio scheduling. Physical microphone input, speaker playback, and the packaged Windows application were not validated in this change. Restart Orvix to load the main-process and preload changes.
