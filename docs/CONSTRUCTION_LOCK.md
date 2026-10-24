# Construction Lock

In **Tiny Agents → Construction Lock → Protect files or folders**, select up to
12 distinct local work paths, choose read/write or write-only protection, and set
an automatic unlock time between 1 and 480 minutes. Press **Activate Windows
protection**, then approve the Windows administrator prompt. Activation is
confirmed only after the Windows helper applies the restrictions. One lock can
cover up to 2,000 files and folders; only one lock runs at a time.

Press **Finish construction & unlock** when the work finishes. This is a manual
construction-completion control; the feature does not infer completion from file
changes or automatically launch a separate construction worker.

## Enforcement and notification

- The helper saves the original DACL/SACL for every existing entry, enables
  File System failure auditing while preserving success auditing, and adds a
  deny ACE and failure-audit ACE for the initiating Windows user SID.
- Folder restrictions include descendants, including entries with protected
  inheritance. Inheritable rules cover ordinary newly created descendants.
- The helper refuses activation when a file is already open during its exclusive
  preflight probe. It holds handles without delete sharing to prevent deletion
  or renaming through parent delete-child permission. A preflight check cannot
  atomically revoke handles acquired by another process during activation.
- The helper polls Security event 4656 failures every second and filters by SID
  and selected paths. It retains the last 50 matching attempts. Orvix displays
  its own native Windows warning dialog, identifying the path and application.
  Other applications may also show their own access error.
- Dialogs never stack: global alerts are at least 10 seconds apart, with a
  30-second cooldown for each path. Attempts remain in the activity list even
  when their dialogs are suppressed. Background applications also attempt access;
  an event does not prove that a human deliberately clicked the file.
- Audit-log overflow, clearing and disabled failure auditing surface monitoring
  health information. Access enforcement continues when monitoring is degraded.

## Scope and recovery

This protects local NTFS work files. Drive roots, Windows/application/recovery
locations, profile ancestors, AppData, network paths, device paths, alternate data
streams, links, junctions, short-path aliases and hard-linked files are rejected.
It restricts the initiating account, including ordinary Orvix workers under that
account. Construction must use a separately permissioned identity or private
staging area. No service account or kernel driver is installed.

Owners/administrators can change permissions; this is a temporary workspace
restriction, not a security boundary against that account. Previously copied,
cached or displayed content and filenames shown in a parent folder may remain
visible. Processes with pre-existing handles retain their granted rights.

Normal expiry, explicit Unlock and application exit restore the saved permissions.
Loss of the application heartbeat for 60 seconds also causes the independent
helper to restore access. Permissions and audit settings can remain restricted
after a helper crash or power failure; the UI then offers **Recover original
permissions** with administrator approval. It does not claim successful recovery
when an entry fails to restore. Recovery proceeds even if writing a progress
checkpoint fails.

Journals live under Orvix userData `construction-locks/<id>/`. `original.json`
contains the immutable original permission checkpoint; `manifest.json` contains
current status and recent attempts. Recovery can load the original checkpoint if
the live journal is unreadable. Keep these files until recovery succeeds. The
helper restores the prior File System audit setting only if it still matches the
setting it applied, preserving subsequent administrator policy changes. Windows
may normalize redundant ACEs and automatic-inheritance metadata during restore;
original access rights and protected-inheritance settings are retained.

## Safe verification

- `npm run check:tiny-agents`: agent regressions plus Construction Lock validation,
  notification throttling, stale state and corrupt-checkpoint recovery tests.
- `npm run check:construction-lock:native`: real disposable NTFS files only. Tests
  denied reads, writes, listing, creation, deletion and renaming; separate-process
  denial; write-only mode; open-file and hard-link rejection; protected inheritance
  and restoration; and parsing Windows failure-event payloads. The default test
  does not elevate or alter Windows audit policy. It also verifies that production
  activation fails without changing permissions when audit privilege is absent.
- `npm run check:tiny-agents:ui`: real Electron renderer, with a simulated
  Construction Lock backend for activation/unlock and settings state. This does
  not prove live elevation, Security-log delivery or native dialog appearance.
- `npm run check:construction-lock:dialog`: safe native-dialog smoke check. It
  creates disposable paths, shows the production Windows dialog options, verifies
  the visible dialog belongs to the isolated test application, acknowledges it,
  and removes the test folder. No permissions or audit policy are changed. This
  check passed on October 2. The test launcher must allow its GUI window to show.

`npm run check:construction-lock:live` is an opt-in elevated acceptance test. It
creates a new disposable Desktop folder, exercises the production helper,
observes real Security-log delivery, checks and acknowledges only its own native
dialog, waits for a real one-minute expiry, verifies restored access and removes
the test folder only after recovery succeeds. Windows requests administrator
approval. This test has not yet completed; an attempted recovery elevation was
cancelled by Windows. Installer packaging has not been rebuilt; the helper paths
are declared in `asarUnpack`. Native folder-enforcement tests, repeated journal
replacement, recovery-startup tests, native dialog display, renderer checks and
the production build passed after the fix. The current user's selected Cline
folder and its three child directories were inspected read-only: each access
descriptor matches the saved original. Its stale recovery journal still requires
Windows-approved recovery before another production lock is started.

The activation checkpoint failure reported on October 2 was caused by PowerShell
converting the optional `File.Replace` backup argument from `$null` into an empty
path. The C# helper now performs that call with a genuine CLR null. Safe native
checks cover repeated atomic replacement. The controller also waits for a fresh
recovery checkpoint, captures helper startup diagnostics and explains cancelled
Windows approval without displaying the encoded launcher command.
