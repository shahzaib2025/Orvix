# OpenCode builder temperature: 0.6

**Current setting update:** The builder default was subsequently raised to **0.7** at the user's request. The native verifier now checks 0.7 delivery and unsupported-model omission. The 0.6 website experiment below remains historical evidence; those samples were not regenerated at 0.7. Reviews/catalog retain provider defaults, and direct-provider routes remain unchanged.

Orvix's native OpenCode task workers now configure the built-in `build` agent with temperature **0.6**. The catalog/review worker retains the provider/model defaults. This does not modify direct-provider routes, website skills, selected design profiles, reasoning levels, or seeds.

OpenCode 1.19.0 gates temperature on the model's advertised `capabilities.temperature`. The live catalog advertised **false for Space Bunny Free** and **true for MiMo V2.6 Flash Free**. Orvix preserves that capability in its normalized catalog and records configured/requested settings in native prompt trace metadata. A trace reports configuration, not proof of the provider's internal sampling.

A recovered worker's actual build-agent temperature must match its expected setting before Orvix reuses it. A mismatch requests a restart of that owned worker while preserving saved task records; it does not silently claim the new setting loaded or start a duplicate worker.

## Technical validation

- `node --test scripts/check_opencode_headless.cjs scripts/check_agent_parallel.cjs scripts/check_opencode_recovery.cjs`: **76 passed**. The existing project-writer fixture was corrected to wait at the real mutation-permission boundary rather than treating model-session creation as a write lock; cleanup now waits for outstanding jobs.
- The later trace-specific assertion also passed: configuration and the model's sampling capability are recorded without raw prompt text.
- `node scripts/check_opencode_temperature_native.cjs`: **passed** against the bundled native runtime and a loopback provider fixture. Captured actual provider JSON contained `temperature: 0.6` for a supported model and omitted the field for an unsupported model. No real model inference or provider account was used by this fixture.
- `npm run build`: **passed**, with the existing large-chunk warning.

## Live layout experiment

See `scratch/temperature-design-1792318675227/report.json` and `inspection.json`. Websites and screenshots are in `~/Desktop/Orvix-Temperature-Comparison-1792318675227`.

The experiment uses MiMo V2.6 Flash Free with its default reasoning setting, the Default design profile, an identical standalone FlorianBD hero brief, and fresh independent task state and output folders. Two runs use no sampling override; two request 0.6. Independent design review is off to avoid introducing anti-repeat comparisons as another variable. No prior source, screenshots or design history are supplied. All four proposed storyboards use left-side editorial copy and a right-side layered card composition.

The first completed baseline and 0.6 pages both passed independent desktop/mobile checks for horizontal overflow, broken images, JavaScript errors, and demo-dialog open/Escape/close behavior. The automated accessibility scans found no WCAG violations in those checked states. Reduced-motion captures retained their content. Checks wait for animated dialog dismissal before judging whether it is hidden.

The final inspection covers all four saved pages. All desktop/mobile demo-dialog checks passed; no horizontal overflow, JavaScript page errors or broken image elements were observed in those states. The second baseline retains one text-contrast failure and the second 0.6 page retains two. Both first-pair pages have no detected WCAG violations in the scanned states. This is an automated scan, not a complete accessibility audit.

Both second attempts reached the original experiment's eight-minute watchdog after producing source and preview attempts. The baseline's separate resume completed a preview and style correction but hit its three-minute follow-up watchdog before returning a final handoff. These are test-harness limits, not newly introduced production timeouts. The saved pages were independently inspected after their final source changes; their generation/handoff status remains explicitly incomplete. Future uses of the generation harness have a twelve-minute limit with explicit timeout attribution. The two complete first-pair generations took 4m 23s (no override) and 5m 04s (0.6); this sample does not establish a speed effect.

Open the Desktop comparison folder's `comparison.html` or `README.md` for the side-by-side screenshots, per-sample checks, timings and limitations. `generation-report.json` preserves the original attempt results and sampling traces; `inspection-report.json` records the independent browser checks. The identical initial system-prompt hashes are recorded in the generation report. No generation provider errors were observed in this batch. The observed outcome is that requesting 0.6 works, but it did not remove the repeated broad hero composition.

## Limits

An explicit 0.6 is not necessarily an increase: the previous remote provider default was not observed. Unsupported models ignore the override, and a model advertising support can still have provider-specific restrictions. The fixture verifies OpenCode's request construction; a successful real response does not expose the provider's internal inference settings. This small hero experiment cannot establish overall coding reliability, full-site MAX quality, or unique layouts on every run. Setting a temperature is not a structural originality policy.

Restart the source-launched Orvix app to load the changed main-process modules. Already-running app processes do not hot-reload these files.
