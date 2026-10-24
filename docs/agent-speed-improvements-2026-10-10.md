# Agent speed improvements

Date: 10 October 2026, Asia/Dhaka.

## Implemented scope

- The direct engine marks shared website guidance as already supplied. Reading the website skill returns its compact workflow addition instead of repeating the full guidance. Standalone skill reads retain the full instructions; other skills are unchanged.
- Grouped file ranges are read with at most four concurrent workers. Results keep the requested order, per-file hashes and errors, workspace restrictions and credential-file exclusions. Mutating tool calls remain sequential.
- Native and direct tasks lazily reuse a browser for the turn. Each viewport/capture uses a fresh context, keeping cookies and storage isolated. Completion and cancellation close the owned browser; failed launches can be retried, and a disconnected browser can be replaced. Standalone preview calls still close their own browser.
- Direct previews already refresh project context inside their capture callback. The duplicate refresh after the tool returns is removed; the callback refresh remains before recording the design fingerprint.
- Long successful `run_command` results supply their first and last 3,000 characters to the model. Full output remains in saved evidence. Source reads, check results and failures retain their existing context behavior. This reduces repeated prompt input without changing the 200K compaction threshold.
- New users with no saved review preference default to Fast builder inspection. Explicit saved Balanced/Thorough/Off choices are retained, as are historical turn display and resumed review policies. Runtime defaults match the new first-use preference. Fast still receives the same fresh-design instructions and browser inspection guidance.
- Shared design instructions encourage coherent edit batches, current evidence reuse, focused revisions, existing dependencies and concise reporting. Unstyled setup and technical helpers are reusable; page layouts, section recipes and visual identities remain fresh decisions.

## Boundaries

No model, provider, reasoning preference, access permission or 200K compaction rule is silently changed. This update does not implement the separate Design MAX/Medium profile plan. It adds no third-party dependency or mandatory page template.

Provider/model comparison remains necessary before naming a fastest model. The existing benchmark script can run matched briefs with explicit model and variant selections. A model name or faster inspection fixture does not prove faster full website generation.

Manual provider caching is not added indiscriminately: current routes use OpenCode and Kilo gateways, and native requests delegate to OpenCode. Cache support and hit rates should be established for the actual provider path before adding provider-specific request fields. Cache usage reported by native requests remains accounted for. No generated website response cache is introduced.

## Validation

Focused checks cover concurrent launch sharing, disconnection, cancellation during launch, launch failure recovery, guidance deduplication, prompt output preservation, and actual desktop/mobile preview reuse with isolated storage and closed contexts. Existing design-review tests explicitly select Balanced to retain coverage of the optional builder/reviewer/revision flow.

- 30/30 focused speed, design review, visual tooling and context checks passed. The final browser cleanup adjustment was then checked with 6/6 speed checks, including the actual browser fixture.
- 98/98 broader agent regression checks passed.
- Application typecheck/build passed. Vite still reports existing large-chunk warnings.
- A repeated website skill read avoids 14,959 characters of duplicate guidance (full skill 15,402 characters; workflow addition 443 characters). This is a prompt-size measurement, not a latency percentage.
- A live OpenCode inspection fixture passed in 52,674 ms, with observed click/state assertions at desktop and mobile sizes, a final provider reply, and managed preview cleanup. Evidence: `scratch/website-native-smoke-jjgVjJ/result.json`. This is inspection of a supplied page, not fresh website generation.
- The preceding live fixture is retained as failed at `scratch/website-native-smoke-weJRGZ/result.json`: the smoke script assumed both viewports in one call, while the recorded passing workflows were in separate desktop/mobile calls. The updated script accepts either form and explicitly requires both viewport widths plus the actual click and resulting text assertion. The earlier failed record was not rewritten; its preview URL was separately confirmed unreachable.

These changes remove concrete repeated work. No percentage or full-site speedup is claimed without a matched live generation comparison.
