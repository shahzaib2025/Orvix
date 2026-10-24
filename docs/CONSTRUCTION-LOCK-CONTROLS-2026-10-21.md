# Construction Lock controls

The Tiny Agents page now separates path selection, metadata checks, review and actual Windows activation. Editing paths, restriction mode or duration clears the review. The main-process activation endpoint requires a short-lived review token for that exact selection; the Windows helper still validates the paths and captures original permissions immediately before activation.

## Controls

- Add a file or folder, remove an individual selection, clear selections and remove duplicates. Pasted Windows Copy-as-path quotes are accepted.
- Exact duration input plus 5, 15, 30, 60 and 120 minute presets.
- Check selected paths without changing permissions or requesting elevation. Unavailable paths, links, overlapping selections and oversized trees cannot get an activation review.
- Refresh live status; a failed or malformed status response shows a warning and retains last-known information.
- Cancel pending activation. Cancellation writes durable markers, stays pending while Windows settles and does not claim restored access prematurely. A Windows administrator prompt must also be cancelled in Windows if still open.
- Unlock now / recover original permissions, with access checks kept separate from permission restoration.
- Recheck restored access, reuse completed paths in a new draft, reveal a known target or standalone recovery launcher, and copy public recovery details.
- Test the native restriction message without locking anything. Native delivery failures are retained in the journal and shown in the panel; a failed recorded message can be retried while protection remains active. Orvix also requests its existing fallback notification.

Only one Windows activation/restoration operation runs at a time. Active paths cannot be edited. Slow actions remain pending until a receipt or visible error arrives. Leaving the page does not unlock files; the existing explicit application-close and background-consent behavior remains in force. Long diagnostics and denied-attempt lists are lazy and bounded initially.

## Verification on 2026-10-21

- Production TypeScript/Vite build passed (existing bundle-size warnings remain).
- Construction Lock core and controls: 16 tests passed, including exact review scope, single-use review, cancellation before dispatch, cancellation while awaiting approval and while activation is being polled, persisted message failure and retry.
- Construction Lock renderer acceptance passed using real Electron/preload and simulated Windows effects: path controls, review invalidation, delayed unlock/cancellation acknowledgement, stale cancellation receipts during status disconnection, malformed status and nested diagnostics, access-attention recovery, compact layout and WCAG A/AA automated checks.
- Existing Tiny Agents Electron UI acceptance passed, including explicit Start/Stop, background default off, keyboard and reduced-motion behavior.
- Combined Tiny Agents suite: 79 tests passed, including the 7 new controls tests.
- Tiny reliability suite: 20 tests passed, including the close gate waiting for workers and file recovery.
- Native Windows disposable-file tests passed: deny reads/writes/deletion/rename, write-only mode, independent-process access denial, original permissions/inheritance restoration and fresh-process access compilation. No elevation, audit-policy changes or personal files were used.
- Actual Windows synthetic restriction dialog was observed and acknowledged in an isolated test app. No permissions or audit policy changed during that dialog test.

The renderer's Windows lifecycle fixtures are not an elevated end-to-end activation test. Automatic restriction messages require Windows to capture a denied access event; the synthetic dialog test verifies the display path, not Security-log event delivery. Missing original access baselines remain attention and are never replaced with invented data. No existing personal lock journal was modified. Reopen Orvix to load updated main-process and preload controls.
