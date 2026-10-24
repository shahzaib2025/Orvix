# Tiny Agents: next improvements researched on 2026-10-02

Research and proposed design only. No application code was changed for this request. Priorities below are recommendations for Orvix, informed by the current implementation and the linked primary sources; example intervals are proposed defaults, not measured optimum values.

The delivery outbox, retries, visible-card confirmation and ordered brightness/audio capture already exist. The next work should make alerts relevant to the user's current work, distinguish ongoing problems from ordinary changes, and explain which information is current.

## Current findings

1. `electron/tiny-agent-changes.cjs` restarts the settling clock on every different reading. A read-only simulation fed CPU values every three seconds while evaluating every second with five-second settling. It produced zero notifications over 30 seconds, although CPU rose from 20% to 50%. This concerns a CPU **change** monitor configured with that settling interval; the existing high-CPU threshold template uses a sustained condition and is a different path.
2. A read-only call to `mergeChanges` combined settled brightness movements 50→60 and 60→50 into `Brightness: 50% → 50%`, count 2. The values are arithmetically correct, but the summary hides the excursion. This is different from returning to the baseline within a single unsettled slider burst, which should continue to produce no alert.
3. `electron/tiny-agent-outbox.cjs` retains pending delivery and checks rule eligibility, but currently has no expiry or current-relevance policy. A saved historical brightness alert can consequently display after restart even if its final value is no longer current. Durable retention and current relevance need separate decisions.
4. Ordinary threshold rules rearm when their condition becomes false. Cooldown exists, but separate enter/recovery thresholds and stable recovery periods do not.
5. Auxiliary sensors share one snapshot timestamp. CPU and memory are measured in the sampling loop, while disk/network results can be older. Each signal should carry its actual sample time and source status.
6. Folder arrivals currently scan direct files, capped at 10,000 entries, with size/mtime stability checks. They do not cover recursive modification, rename and deletion workflows.
7. The local Tiny Worker interface already exposes completed/error/needs-key states and report IDs. These are useful event sources for Tiny Agents rather than another independent worker implementation.

## Ten proposed improvements

| Order | Improvement | Proposed behavior | Value / effort |
|---|---|---|---|
| 1 | Metric-specific evaluation | Keep the existing one-second brightness/audio settling. Offer rolling-average change detection or a sustained condition for CPU/memory. Validate configurations that require quiet longer than their sampling interval. | Very high / medium |
| 2 | Incident and recovery alerts | One alert when a problem starts; an optional recovery message after stable recovery. Example: enter low-battery incident at ≤20%, recover at ≥23%. Missing data becomes unknown, not recovered. | Very high / medium |
| 3 | Expiry and relevance policies | Per rule: preserve historical event, recheck current condition, or expire after an interval. Keep expired records in history with a reason. Label delayed messages with occurrence time and current values where available. | Very high / medium |
| 4 | Project and work profiles | Associate rules with explicitly selected folders, apps and browser domains. Examples: Coding, Research, Meeting. Show why a profile is active; allow a manual override and stabilize app-switch detection. | High / medium |
| 5 | Work completion/failure notifications | Subscribe to actual Orvix worker/task completion events and approved build/test execution results. Show result, elapsed time, report/artifact and an Open result button. Process disappearance alone is not proof of success. | High / medium |
| 6 | Priority and related-alert digests | Informational, warning and critical levels; optional grouping by rule, issue or project. Group routine changes after a short configurable window; prioritize critical queued notices. Preserve unconfirmed cards and the minimum visible interval. | High / medium |
| 7 | Useful project-file events | Watch relevant file modifications, renames/deletions and output creation, with recursion and ignore filters such as node_modules/.git. Debounce duplicate filesystem events, reconcile overflow and preserve initial-baseline behavior. | High / medium to large |
| 8 | Per-signal health and freshness | Show event source, last successful sample, age, unsupported/disconnected/failed state, drops and reconnects. One degraded/recovered notification per outage. Capture timestamps belong to each signal, not just the merged snapshot. | High / medium |
| 9 | An understandable event timeline | Link receipt → rule decision → deferral → delivery attempt → shown confirmation. Include old/final/min/max values and event count. Explain why a rule did not notify; distinguish observed context from confirmed cause. | High / medium |
| 10 | Dry-run preview over time | Let a rule collect would-notify events without cards or actions. Replay synthetic/local retained samples and show expected alert count before activation. Suggestions stay reviewable rather than silently changing sensitivity. | High / medium |

## Research supporting the design

Prometheus supports a sustained pending period through `for` and a recovery hold through `keep_firing_for`, specifically to reduce flapping and premature resolution. Orvix can adopt that lifecycle idea in its own evaluator without adopting Prometheus or changing the user's brightness semantics. Separate numeric entry/recovery thresholds are an additional Orvix proposal. [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/).

Grafana separates grouping wait, group-update interval and repeat interval. For Orvix, this supports grouping related informational events while retaining individual evidence. Grouping should be opt-in, preserve device/project boundaries and never imply unrelated changes caused one another. [Grafana grouping](https://grafana.com/docs/grafana/latest/alerting/fundamentals/notifications/group-alert-notifications/).

Windows app notifications have expiry and reboot-expiry policies. Orvix uses its own Electron cards, so those Windows properties are a design reference, not APIs automatically available to its existing outbox. Equivalent expiry and supersession semantics must be implemented in Orvix's own state. [Microsoft notification management](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/manage-app-notifications).

Windows exposes user notification acceptance state through SHQueryUserNotificationState. The existing companion already supplies presentation/notification state; the proposed extension is consistent per-profile delivery policy and a visible explanation of deferral. This API is not a blanket detector for every meeting app or the complete modern Do Not Disturb configuration. [Microsoft notification state](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate).

Microsoft documents that FileSystemWatcher can emit multiple events for one filesystem operation and can lose tracking after buffer overflow. Project-file monitoring therefore needs filtering, duplicate coalescing, explicit gap reporting and a recovery rescan. A stable size/mtime does not prove a writer has finished; prefer a producer's completion event or a known output contract when available. [FileSystemWatcher errors](https://learn.microsoft.com/en-us/dotnet/api/system.io.filesystemwatcher.error?view=net-9.0).

A process exit can represent successful completion or an aborted process. Use the tracked execution ID, exit code and task-specific result contract; for Orvix workers use their explicit completed/error event and report ID. Merely finding an output file or seeing an app close should not produce a success claim. [Microsoft Process.Exited](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.exited?view=net-9.0).

OpenTelemetry distinguishes event time, observation time, resource context and execution correlation. Orvix can use these distinctions in a local structured timeline without needing an external telemetry service. Context correlation supports explanation; timing proximity alone does not establish causation. [OpenTelemetry logs](https://opentelemetry.io/docs/concepts/signals/logs/).

Core Audio's context GUID can identify a change as Orvix-originated only when Orvix supplied a recognized GUID. An arbitrary GUID is not an application name, and callers can use GUID_NULL. Show unknown origin rather than claiming which unrelated application changed the volume. [Microsoft audio notification payload](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/ns-endpointvolume-audio_volume_notification_data).

Prometheus documents tests using time-series inputs and expected alerts. Equivalent Orvix simulations should include noisy CPU samples, near-threshold oscillation, missing data, quiet-hour excursions, stale saved alerts, folder floods and task failures. No new test framework is required; the existing Node/native/Electron harnesses can be extended. [Prometheus rule testing](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/).

## Suggested implementation order and acceptance

First implement metric evaluation, stable incident recovery and stale-alert policies. Verify that continuously moving CPU can produce a meaningful configured alert, threshold oscillation cannot repeatedly open the same incident, and an expired brightness notice stays in history without appearing as a current change. Preserve the existing one-percentage-point brightness and one-second settling defaults.

Next implement project/work profiles and completion/failure event subscriptions. Verify profile switching, explicit manual selection, process-ID reuse, worker retries, partial results and direct links to the matching report. Known task completion should never be inferred from unrelated window or process events.

Then add priority grouping, filtered project-file events, source-health UI and the event timeline. Verify that grouped notices retain their underlying event IDs, missing data is not reported as recovery, scans reconcile overflow, and existing delivery guarantees remain intact.

Finally add dry-run history and reviewable sensitivity suggestions. Keep predictable manual controls as the default. Optional AI explanations can use selected event summaries after the deterministic evaluator makes its decision; an LLM call is unnecessary for every sensor event.

The highest-value initial package is **1 + 2 + 3**, followed by **4 + 5** for more relevant work assistance.
