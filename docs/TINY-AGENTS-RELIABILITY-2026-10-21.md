# Tiny Agents reliability implementation

The final priority is explicit start/stop behavior. This supersedes the earlier default of silently continuing when the main window closes.

## Start, stop and close

- The application opens with Tiny Agents stopped. Existing definitions, approvals, evidence and resumable work are retained.
- **Start reviewed agents** restores previously enabled monitors and safely paused work. Drafts remain unapproved. Uncertain effects require inspection before continuing.
- **Stop all agents & unlock** disables monitors and workflow triggers, cancels queued notices, requests cancellation, waits for execution acknowledgement, and requests Construction Lock restoration. It retains completed work.
- A task remains **Stopping** until its current operation returns. Stopping does not undo an already completed external effect.
- The title bar shows agent status and provides Stop all from other pages. The tray also reports the actual control state.
- Closing the main window stops voice and, by default, stops agents, restores protected access and quits. A failed recovery keeps Orvix open with an explanation.
- Continuing in the tray requires the explicit background checkbox. The tray remains visible and closing an enabled background session produces a local notification.
- Reopening does not silently restart stopped work, including when background consent was previously selected.
- Leaving the Tiny Agents page or stopping voice alone retains approved work while Orvix remains open. The title bar makes this work discoverable.

## Durable execution and performance

The monitor and workflow engines run in one Node worker. Their existing synchronous fsync checkpoints are retained outside Electron's main thread. Native/browser/project effects remain in the main process and use its shared interaction/file resource locks.

After a shared resource becomes available, the host asks the worker to commit its effect intent. The host dispatches only after that acknowledgement. Cancelling while waiting for a resource therefore does not manufacture an uncertain write. An interrupted dispatched effect still requires inspection instead of replay.

Committed events carry incremental state patches. Normal updates no longer reload the complete workflow listing or history. History is loaded once and paged; timeline gaps fetch missing records. Completed runs archive separately, retaining mutation receipts, approved revisions, one-off execution guards and inspection by run ID.

Countdown and live-preview timers are isolated from the whole page. Sensor observations have individual timestamps. CPU/memory change monitors support rolling windows; brightness retains its one-point/one-second defaults. Incident recovery requires observed sustained evidence; unavailable data does not mean recovery. Optional expiry/relevance policies suppress stale undelivered alerts. Coalesced numeric alerts retain minimum and maximum excursions.

The disposable 30-draft fsync benchmark in `scratch/tiny-runtime-performance.json` measured host maximum timer delay of 2185.36 ms in the same-thread coordinator versus 62.91 ms in the worker. Receipt p95 was 106.07 ms versus 110.93 ms. This measures storage-related thread blocking, not renderer FPS, microphone quality or provider reliability.

## Construction Lock

Before changing permissions, activation captures normal-account access and file identities, flushes and reads back the recovery baseline, and saves self-contained recovery dependencies beside the journal. The elevated helper flushes and validates the original permission checkpoint before restricting anything.

Recovery restores original permissions and checks the original account's access without writing file contents. Status distinguishes restoration, access checking, verified restoration, permission denial, busy files, missing files and changed identities. It does not grant Full Control. Changed file identities are not overwritten during recovery.

`recover.cmd` beside the journal launches recovery without the Orvix application or Node. It still uses Windows administrator approval when restoration requires it. Earlier unfinished journals remain discoverable. Legacy journals without an access baseline cannot provide the new original-access proof.

Staging copies are a separate explicit option. They verify file hashes, exclude credential locations and links, retain a receipt, and never automatically publish changes over the originals.

## Validation and remaining acceptance

Passing scripted checks cover Tiny Agents, notifications, workflows, explicit global stop/start, close policy, restart persistence, dispatch barriers, storage faults, shared resources, stale approvals, archive inspection, signal precision, Fast work and Thinking protocol/flow. The production TypeScript/Vite build succeeds. Native protection checks use disposable folders without elevation or audit-policy changes, including actual denied reads/writes and successful restoration.

The Electron renderer fixture passed using the production runtime worker and narrow preload bridge. It exercised explicit Start, global Stop from another page, no further effects while stopped, restart of the approved monitor, background consent off by default, keyboard access, reduced motion and compact layout. This is separate from native protection testing.

Recorded suite results: Tiny Agents 72/72; notifications 40/40; workflow contracts/coordinator/clients 30/30; reliability/precision/clients 17/17; Fast work 42/42; Thinking protocol 20/20 plus its flow check. Counts overlap and are not an independent-test total. Later targeted runtime and legacy-feature checks also passed after the final stop/start changes.

The text-driven live provider fixture passed Fast draft/inspection/explicit approval/file verification. Thinking drafted but timed out during inspection; its complete live acceptance remains unresolved. The broader voice-interruption harness stalled after passing checks and was stopped; it is not counted as a complete pass. Microphone/speech acceptance, an installed-app restart, elevated recovery and real Security-log notification delivery remain live acceptance items. The tests do not establish an unconditional reliability guarantee.
