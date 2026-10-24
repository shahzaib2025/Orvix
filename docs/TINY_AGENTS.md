# Tiny Agents

Tiny Agents run locally while Orvix is running, including when its window is hidden in the tray. Create a rule in Home, use one of the twelve templates, or select **New tiny agent**. Every new, edited, or duplicated rule is saved as a disabled draft and must be reviewed before activation.

## Ten additions

1. **Schedules:** one-time reminders, selected weekdays at a time, and time windows (including overnight). Use an IANA timezone such as `Asia/Dhaka`. Missed daily occurrences can be skipped or caught up on the same calendar day; one-time reminders can catch up after restart. The preview shows the next eligible time. Scheduled occurrences are persisted to prevent duplicate runs after restart. Hold timers restart after sleep/restart.
2. **Focus reminders:** total active PC time and active app time today, measured in seconds. Counts exclude idle and locked periods and gaps when the monitor is not running. Totals are saved locally, checkpointed every 30 seconds, and reset at midnight in the device timezone. Abrupt termination can lose the last checkpoint interval. The break template alerts once after 45 active minutes today.
3. **Quiet hours and presentation awareness:** notification-only rules retain one pending alert while snoozed, in quiet hours, or fullscreen. The pending alert and its observed conditions survive restart. Other action sequences wait until their conditions and schedule allow execution. Quiet hours use the rule's timezone. Unknown fullscreen status defers rules that require it.
4. **Condition previews and explanations:** selected rules show observed values, true/false/unavailable conditions, hold progress, next eligible time, and daily run count. **Test conditions** validates a draft without executing actions or saving it. File/download data for an unapproved draft may be unavailable until its collector is enabled. Activity stores the conditions observed when a run triggered, including deferred alerts.
5. **Download alerts:** completion and interruption transitions from the connected Chrome companion, optionally filtered by filename. Existing completed downloads and completions during a disconnect are ignored when establishing a new baseline. A newly started, quickly completed download is detected with the updated companion's start-time field. Reload the unpacked extension after updating its code. The last 1,000 browser downloads are observed in pages.
6. **Snooze and run limits:** snooze for 30 minutes, one hour, or until tomorrow at 9 AM in device local time. Snooze survives restart. Cooldown and daily run limits survive restart. A daily limit of zero means unlimited; the limit counts rule occurrences, including pending notification occurrences. Pause cancels pending notifications and prevents later steps of an in-flight sequence.
7. **Ordered action sequences:** up to six actions: notify, open an HTTP/HTTPS website, open a local file/app, focus or minimize an app window, and shutdown. Steps execute in order and stop on failure. Shutdown must be last, rechecks its condition after preceding asynchronous steps, and gives a full 30 seconds to cancel. Opening an app or website records a successful launch request; it does not prove page loading or app readiness.
8. **Templates and duplication:** ten built-in templates cover weekday reminders, breaks, battery care, downloads, new PDFs, network recovery, CPU, disk, app budgets, and memory. Duplicate preserves the configuration and creates an independent disabled draft.
9. **File/folder watchers:** watch an exact local file's existence or new filenames in one folder, with a filename substring filter (`*` matches all). Choose paths with the native picker. Folder watches are not recursive. Existing files are ignored, and a new file must have unchanged size and modification time across two checks before alerting. This is a stability check, not proof the writer has closed the file. File arrivals and downloads require zero hold and repeat; cooldown and daily limits can still restrict them.
10. **Network and system health:** CPU and memory percentages, free disk percentage on a selected Windows drive, and a fixed Microsoft connectivity probe. Basic collectors sample about every three seconds; disk and network checks run about every 30 seconds while needed. Network reachability means the Microsoft connectivity endpoint returned the expected text; it does not guarantee every website is reachable. The network recovery template requires an observed outage before recovery.

## Storage and execution

Rules, focus totals, pending notifications, and the last 200 activity entries are in `tiny-agents.json` under Electron's user-data directory. Existing version-one rules load with default schedules and policies. No model calls are made for background evaluation; Home's AI tools translate requests into reviewable drafts.

PC signals expire after ten seconds, auxiliary snapshots after fifteen seconds, and browser activity follows its existing freshness checks. Unavailable signals cannot satisfy conditions. Shutdown countdowns are cancelled when conditions clear or data becomes unavailable, on pause/delete/edit, or on suspend/resume.

## Checks

- `npm run check:tiny-agents` — engine, schedule, persistence, actions, sensors, templates, and model argument conversion.
- `npm run check:notifications` — notification and subscription regressions.
- `npm run check:tiny-agents:ui` — isolated real Electron UI with simulated actions, no operating-system shutdown, and a separate temporary user-data directory. Screenshots are written under `scratch`.
- `npm run build` — TypeScript and frontend production build.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check_tiny_agent_native.ps1` — compile and inspect native event subscriptions on real devices, without changing settings.
- `npm run check:notifications:live` — actual Electron notification cards, including a settled one-point brightness change and opening its agent.

## Change notifications

Choose **When something changes** in the rule builder, or use the **Brightness changed** / **Volume changed** templates. Select one or more signals; any watched change can notify. Brightness and other numeric readings default to a minimum change of one percentage point in either direction. Direction and minimum change are configurable. A one-second settling interval combines slider steps into one starting-to-final message. A value that returns to its starting value before settling produces no alert. Sub-threshold numeric changes accumulate relative to the last confirmed baseline.

Change monitors support brightness, volume, mute, battery, charging, power connection, network reachability, fullscreen, active app, CPU usage, memory usage, drive free space, and local file existence. Optional ordinary conditions filter the settled event. A rejected event is consumed rather than delivered later when a filter becomes true. Change monitors use notification actions, zero hold/repeat, and continuous or time-window schedules. Changes outside the monitoring window are consumed without replay.

The initial reading, startup, resume, missing/stale readings, and brightness/audio device changes establish new baselines without notifying. Quiet hours, snooze, presentation deferral, cooldown, and the daily notification limit preserve one combined pending summary per rule. That summary survives restart, retains before/after values and detection times, and is delivered once the controls permit it. Pausing or editing cancels pending delivery. Preview reports baseline/current values, settling progress, and availability without executing actions or changing state.

Windows brightness WMI events and Core Audio volume/mute callbacks copy their reported values immediately into a bounded queue. A separate worker journals ordered events before publishing them to Electron; polling remains a reconciliation fallback. Brightness needs a display exposing WMI brightness. Other collectors retain their sampling intervals (system/file checks about 3 seconds; network and disk about 30 seconds). Polling can miss brief changes between samples. Orvix must remain running, including in the tray; changes while it is closed are not replayed.

The optional rule field is `trigger: { type: 'change', watches: [{ signal: 'brightness_percent', minDelta: 1, direction: 'any' }], settleSeconds: 1 }`. Watches may include a required `target` for a drive or file. Existing threshold-rule data needs no migration. Both assistant modes use the shared draft tool schema to create reviewed change-monitor drafts.

## Durable delivery and precise capture (2026-10-02)

Ordinary notification intents and consumed rule state are saved together in the atomic, flushed Tiny Agents checkpoint. The previous complete checkpoint is retained as a recovery backup. Each delivery has one stable ID and each attempt has a fresh nonce. Queued, preparing, and displaying states do not mean delivery is confirmed. A sandboxed renderer acknowledges its matching notice after the main process makes the window visible and the renderer receives two animation-frame callbacks. The main process checks the window, main frame, visibility, delivery ID and nonce. This verifies the display path, not that a person read the card.

The initial attempt and up to five retries use delays of 1, 2, 4, 8 and 16 seconds. An exhausted or interrupted final attempt remains in the inbox as **Needs retry**, with a manual **Retry notification** button. Pending ordinary notices recover after restart; confirmed IDs are retained for deduplication (the last 200 completed records). Pausing, deleting or editing a rule cancels outstanding delivery. Snooze, quiet hours and presentation controls continue to hold eligible delivery. Shutdown countdown cards are live-only and are never added to the replay outbox.

Bursts queue every notice. A card awaiting confirmation cannot be replaced. An automatically replaced, confirmed card remains visible for at least 1.5 seconds; hovering retains it. Card failures, unexpected closure and frame timeouts trigger retry. Unavailable storage stops new delivery attempts and exposes a storage error in the inbox. A process crash between actual display and saving confirmation can repeat that card on recovery; absolute exactly-once visual delivery cannot be guaranteed.

The Windows companion copies brightness value and monitor identity from WMI, and fractional audio scalar, mute and context GUID from Core Audio, before callback memory expires. Endpoint callbacks are bound to their device ID. Callbacks do no file IO, device reads, waits or unregister calls. A worker assigns ordered sequences, stores UTC receipt and monotonic times, flushes journal batches, and publishes a bounded replay ring. Callback backlog and replay are bounded at 4096 entries; audio callback batches contain two signal entries. The local journal uses 8 MiB segments and retains the current and previous segment under PCMonitorTest/signals.

Electron consumes missing sequences, ignores duplicate batches and old-device callbacks, and resets settling on every captured value change, including an intermediate movement whose final value matches the last polled snapshot. Reconciliation reads retain raw audio precision and a monotonic sample-start time; a poll that predates a callback cannot overwrite it. Native receipt, settlement and display-confirmation times are stored separately. UTC receipt describes callback receipt, not exact physical interaction time. A buffer overrun, malformed/incomplete sequence or journal IO error is surfaced in the inbox and establishes a new baseline rather than inventing missing changes. Startup and companion-session changes also establish a baseline, while previously saved notification intents still recover. Changes while Orvix is closed are not replayed as newly observed events.

Validation includes the regression suite, checkpoint/retry/recovery/gap tests, real Electron notification and Retry-button flows, and a native harness that copies injected COM payloads before pointer reuse, checks actual audio/WMI registration, exercises worker IO failure/recovery and buffer overflow, and checks bounded journal rotation. The native harness does not change physical brightness or volume settings.
## Construction Lock

Tiny Agents includes temporary Windows file/folder protection with native access
restriction messages, automatic unlock and saved-permission recovery. See
[Construction Lock](CONSTRUCTION_LOCK.md) for usage, enforcement limits and safe
test coverage.
