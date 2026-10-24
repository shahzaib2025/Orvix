# Native acceptance-planner timeout

The two-brief skill live test stopped before construction because native planning calls had a fixed 120-second total deadline. The exact failed acceptance prompt was replayed read-only with response timing/count telemetry, without saving or inspecting reasoning content. It returned an approved 21-criterion plan after 131.732 seconds. Content deltas continued past 120 seconds. Earlier runtime logs show cancellation at exactly 120 seconds, not a permission rejection or HTTP 403.

Native requirement refinement and acceptance planning now have a 120-second inactivity deadline and a 600-second total cap. Only new content from a known assistant message renews inactivity; heartbeats, busy status, replayed same-length parts and user content do not. External cancellation and read-only tool denial remain enforced. Other request deadlines are unchanged. Timers are disposed on success/failure, including failures before worker acquisition.

A persisted unavailable acceptance plan may now be retried by a subsequent planner instance. Within one run it remains bounded and cached; approved plans are reused. This does not clear an actual rejected plan or authorize mutations without approved coverage.

Validation: 26 deadline/verification-flow checks and 110 OpenCode/design-review/comparison checks passed. The production build passed with the existing large-chunk warning. Real diagnostic evidence is in `scratch/planner-diagnostic-1792356524115/report.json`.

The full engine rerun uses the same model, human brief, task and project as the blocked test. It reached the builder and delivered the updated composition skill. Full generation and rendered design observations are recorded separately in `scratch/two-brief-skill-1792355669496/`; instruction delivery and the timeout fix do not establish visual originality or speed.

The main desktop application was not restarted during this experiment. It loads the runtime changes after restart; isolated validation processes load current source.

The full engine rerun subsequently finished in 16m 54s. Fresh desktop/mobile dialog open/Escape/close checks passed, with no page JavaScript errors or horizontal overflow. The familiar split hero remained and the brief lacked the selection reason. Planning reliability improved; design variety and speed did not pass this sample. The builder's stale automatic verification summary remains distinct from the independent browser evidence.
