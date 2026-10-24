# Fast weather report completion and acknowledgments

The reported eight-city request fetched every weather result successfully but
delivered an empty-response notice and then only the last city's response. The
controller now owns one final delivery, ignores empty response boundaries while
results are pending, and rejects late output during delivery.

Weather requests recognize Bengali `ওয়েদার` / `ওয়েদার`, Banglish, and English.
References such as `ওগুলো` resolve to supplied city context. An explicit list of
known Bangladesh divisional cities uses one spoken city-specific notice before
each actual request, at most two independent requests in flight, and one combined
report. Mixed requests involving other work retain the general tool flow.

Read-only search, page and weather responses can be submitted while their
announcement plays, using WHEN_IDLE scheduling. Later dispatch and final playback
retain their speech gates. Weather collection uses SILENT function responses and
a single final request. Mutation approvals, uncertainty and replay protection
remain in their existing executor.

Final weather replies must cover each city, its returned temperature and
conditions, or its unavailable status. Missing or unsupported measurements use
the retained structured results. Eight-city reports state the common temperature
unit once. After every requested city has a completed or blocked receipt, an
audio reply may settle after 1,200 ms without further provider output, avoiding
a missing turnComplete stall. Delivery checks reject incomplete city coverage
and unsupported measurements before that audio plays. The exact-text fallback renderer can
settle after 900 ms only when its complete transcription matches the reviewed
report; its old connection is retired to isolate delayed boundaries.

## Evidence

- The final focused regression run passed 125 checks. The weather-specific
  suite also passed after the country-scope refinement. TypeScript and the
  production Vite build passed; Vite still reports its large-bundle warning.
- Focused checks cover empty boundaries, one final delivery, stale PCM and tool
  proposals, interruption, two-read concurrency, spoken notice gates, invalid
  measurements, incomplete forecasts, aliases, and failed-city handling.
- Real Gemini with recorded Open-Meteo measurements: eight requested lookups,
  eight distinct notices, one complete report; first notice 39 ms, collection
  17.58 s, final playback 30.46 s. Input was typed; PCM playback was simulated.
  Measurements were captured earlier at 2026-10-14 16:45 Asia/Dhaka, not fetched
  again for this run. See `benchmarks/fast-weather-recorded-data-20261014.json`.
- Latest fresh-service run: all eight requests returned HTTP 503, with the
  provider reporting overload. Orvix gave eight notices and one unavailable
  report, without invented readings; first notice 28 ms, final playback 25.51 s.
  See `benchmarks/fast-weather-completion-20261014.json`.
- Earlier real weather runs retrieved seven and then eight successful results.
  They exposed a missing completion signal and reconnect delay; those runs
  preceded the weather settlement safeguard and are not final latency evidence.
- The broad legacy `check_simple_fast.cjs` run was stopped after failures and
  a hang. Its old expectations include no notice for quick window actions,
  generated-only acknowledgments, and paused microphone forwarding. Those
  expectations conflict with later per-call speech and interruption requirements.
  It is not reported as passing. The active, focused suites are reported separately.

No physical microphone/speaker or packaged-installer acceptance is established.
Full eight-city reports still take seconds; only notice startup is near instant.
Restart Orvix to load the updated production build.
