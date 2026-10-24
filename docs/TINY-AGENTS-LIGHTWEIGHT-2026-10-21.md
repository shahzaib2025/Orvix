# Tiny Agents lightweight runtime — 2026-10-21

This change reduces unnecessary monitoring, imports and repeated reads while retaining explicit Start, acknowledged Stop, durable approvals and permission recovery.

## Changes

- No monitor/workflow polling timer is armed solely because voice is connected. The durable worker's heartbeat sleeps when control is stopped, and remains active while stopping so an operation waiting for acknowledgement is not falsely labelled unresponsive.
- While stopped, incoming PC observations replace one pending snapshot in the host. They do not repeatedly cross into the worker or write its journal. Preview and explicit Start flush that snapshot with its original observation time. Reset discards it. Start followed immediately by Stop preserves command order.
- Sensors collect only signals required by enabled rules, recovery conditions and approved workflow work. Completed one-offs release sensors; unfinished runs retain the conditions from their own approved revision even when future triggers are disabled.
- CPU, memory and download sampling uses the existing three-second cadence when requested. Network/disk-only sampling uses thirty seconds. Disk readings use asynchronous native `statfs` for the selected drives instead of launching PowerShell. Unavailable readings remain unavailable.
- File monitors share directory watchers. Parent watches track target creation, removal and rename; folder watches observe arrivals. Busy copy events are coalesced, and unchanged size/mtime must be observed twice before an arrival is published. Existing files establish a baseline. A ten-second repair scan covers failed/missed watches; failed watchers back off instead of repeatedly retrying. Renamed/recreated targets establish a new baseline. This remains a monitor, not an access-control mechanism.
- Stop closes sensor watches and timers, aborts the network probe, clears event baselines, and rejects late sample publication. Requirement changes during a probe promptly schedule a fresh sample. Deleted targets cannot leave dirty entries causing repeated scans.
- Delay steps use one cancellable deadline timer. Production condition waits wake on incoming native/sensor readings, with a three-second fallback and the original reviewed deadline. Older pull-only adapters retain their compatible polling behavior. Idle acknowledgement uses promises rather than a ten-millisecond polling loop.
- Workflow history is read one page at a time from the append-only journal, without retaining the complete journal as an array. Forward/backward cursors, UTF-8 boundaries, run filters and committed sequence bounds are preserved. Individual oversized records produce an explicit error and preserve the journal.
- Gemini authentication/SDK and project model code load only when the adapter needs those capabilities. Basic deterministic monitoring does not call AI.
- Both status views share one renderer subscription and one five-second fallback, rather than independent two- and five-second polling loops. Events trigger coalesced refreshes; stale responses cannot overwrite newer control changes. Health checks use cached Construction Lock status, avoiding manifest reads on each status request.
- Construction Lock's host heartbeat runs while protection/verification needs it. Inactive and restored locks have no perpetual host heartbeat. The separate elevated recovery helper and its active audit/expiry safeguards are retained.
- Removed a duplicate acquisition of the shared interaction lock for ordinary agent actions. Checkpoint failure during run start now releases idle waiters without dispatching an effect.

## Measurements

Use `ORVIX_MEASURE_ELECTRON=1 node scripts/measure_tiny_lightweight.cjs` in a shell with that environment variable set. On PowerShell, set `$env:ORVIX_MEASURE_ELECTRON = '1'` first. The harness loads the saved source baseline with the original dependency paths and uses disposable folders. It never contacts providers or changes file permissions.

Measurements used the bundled Electron 42.5.0 / Node 24.17.0. Results are in `scratch/tiny-lightweight-measurements.json`.

| Isolated measurement | Before | After |
| --- | ---: | ---: |
| Adapter cold require, median of three processes | 279.5 ms | 37.9 ms |
| Retained heap added by that require, median | 3.957 MiB | 0.555 MiB |
| Modules loaded in that process | 133 | 20 |
| Quiet folder scans over 12.5 seconds, including baseline | 5 | 2 |
| Unrelated CPU probes in that folder fixture | 6 | 0 |
| Unrelated memory probes in that folder fixture | 5 | 0 |
| Empty monitor engine interval callbacks with voice enabled, 1.25 seconds | 4 | 0 |

The folder fixture still has a scheduled ten-second repair timeout. The benchmark's `timerCallbacks` counter counts interval callbacks, not every timeout or Windows callback. CPU-time samples are too short/coarse to establish a percentage improvement. Isolated import heap/RSS deltas are **not whole-app savings**: Electron main already shares some provider modules with voice/project features.

The durable worker remains resident. This implementation does not claim worker termination, a fixed RAM cap, zero total Electron CPU, or execution after Orvix exits. Required fsync barriers, backup checkpoints, mutation receipts, approved revisions and one-off execution guards are retained. Active Construction Lock's elevated audit loop still uses its existing polling lifecycle; replacing it with native Event Log subscriptions is separate work.

## Verification

- `npm run check:tiny-lightweight`: 13 passing tests covering selective/idle sensors, changing requirements during probes, dirty-target removal, real Windows watcher arrival/rename/recreation, failed-watch repair, late-result suppression, recovery-only signals, native disk readings, paged UTF-8 history, stopped worker traffic, rapid Start/Stop ordering, event waits, delay cancellation, shared status subscriptions, one-off sensor release and run-start storage failure.
- `npm run check:tiny-agents`: monitor, change detection, scheduling, outbox and Construction Lock regressions.
- `npm run check:tiny-workflows`: execution policies, crash/checkpoint safety, scope, approvals, voice clients and disposable report workflow.
- `npm run check:tiny-reliability`: stop acknowledgement, restart staying stopped, resource cancellation and effect-intent failure checks.
- `npm run check:tiny-agents:ui`: production Electron renderer with a temporary profile and stubbed OS effects; explicit Start, global Stop from another page, no effects while stopped, background consent default off, keyboard/reduced-motion and compact layouts.
- `npm run check:construction-lock:native`: actual permission denial and verified restoration on disposable folders, without elevation, Security-log changes or personal files.
- `npm run build`: TypeScript and production Vite build. Existing large-bundle warning remains.

Scripted and isolated Electron acceptance do not establish live microphone/provider acceptance, installed-app RAM/CPU savings, or an elevated production lock activation. No personal agent definitions or protection journals were changed by these fixtures.

## Design references

- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance): measure and defer unnecessary work.
- [Node filesystem watch caveats](https://nodejs.org/api/fs.html#caveats): keep a repair path for Windows watch limitations.
- [Windows directory change notifications](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw): recover from missed/overflowed notifications by enumeration.
- [Node filesystem statistics](https://nodejs.org/api/fs.html#fspromisesstatfspath-options): asynchronous native filesystem capacity reads.
