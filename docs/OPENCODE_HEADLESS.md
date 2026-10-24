# OpenCode Zen Free in Orvix

Implemented on 2026-10-09 with `opencode-ai` pinned to `1.18.35`.

## Use

Restart Orvix to load the updated Electron backend. In Agent, open **OpenCode → Refresh**, select a **Zen Free** model and send a task. A Zen API key is unnecessary for this route. Go and Kilo still use their existing credentials and provider clients.

Refresh compares the public Zen model list with the installed runtime's model metadata. Only models advertising zero input/output/cache cost, text responses and tool calling enter the free agent list. Thinking levels and image support come from that metadata. Advertised models without compatible runtime metadata appear under “models unavailable for this agent.” Provider access, quotas and free availability can change; catalog membership is not proof that every model currently accepts a request.

The last successful list is cached for six hours. Opening Agent reads the cache without starting OpenCode. Refresh or a free-model request starts the runtime if needed. An unavailable saved selection is shown explicitly; Orvix does not silently switch models. Catalog failures retain the previous list and show the failure. Requests require a verified current catalog.

## Execution and PC resources

Orvix runs the official `opencode serve` binary with its built-in `build` agent and real file, shell and web tools. This is a native OpenCode session, not a direct free-tier API request using Orvix's separate tool loop. The native route has OpenCode's tool set and a task-scoped local bridge for visual assets and website previews in execution modes. It does not use Orvix's full independent acceptance-planning loop. Visual-tool behavior requires its own validation beyond the file/approval checks described here.

One owned server serves one native turn at a time. It listens on a random `127.0.0.1` port protected by a randomly generated password. Queued turns support cancellation. The server runs with a hidden window, starts only on demand, shuts down after **two idle minutes**, and is terminated when Orvix quits. It does not launch the OpenCode desktop app. Runtime config, data, cache and state are separate from the user's OpenCode installation; provider key environment variables are removed.

LSP, formatters, file watchers, snapshots, sharing, automatic updates, plugins, auxiliary title/summary calls and subagents are disabled. No external MCP servers are configured. Execution modes connect an authenticated, task-scoped visual bridge in Orvix's existing process; a browser starts only if a preview tool is actually used. The native agent has a 24-step limit. Models run in the cloud; the local server still consumes memory and can spawn commands that the task needs. Actual checkpoints on this PC used approximately **408–608 MB working memory** and **756–951 MB private memory**. Those are observations, not a maximum or a guarantee that the PC will never lag. Complex shell tasks or browser previews can use substantially more resources.

## Orvix controls and records

- **Plan:** native file reads/research allowed; file edits and shell execution blocked.
- **Controlled:** edits and shell actions request one-time approval through Orvix. Newly opened project folders require approval. A declined action can stop OpenCode without a final model reply; Orvix reports that explicitly.
- **Full access:** ordinary edits and shell commands can proceed; detected deletion commands still request approval.
- Sensitive explicit file paths and credential-probing commands are rejected using Orvix's existing guards. These are guards, not a filesystem sandbox. Host commands can access the host according to their permissions.
- Native tool outcomes are saved in Orvix's evidence store and shown in activity. Changes in open workspaces are captured before permission is granted, scanned after writes and on completion, and can be restored using the existing change controls.
- Reported token usage sums observed assistant message usage within the turn, replacing repeated updates for the same message to avoid double counting. Context displays the latest model-reported input separately from that turn total.
- Conversation history retains Orvix's approximate 200K compaction threshold; the original conversation is archived before compaction. Native context within a turn is bounded by the model and runtime. Provider context limits and the 24-step limit can stop long tasks.
- Cancellation aborts the native session and removes transient session data. Completed actions remain visible. Interrupted native tasks are not automatically replayed; review their changes before submitting a new request. Steering is sent to the active native session after connection.
- Native verification is labeled **not run** when Orvix has no independent checks for the turn. Preview tools may add their own scoped layout/accessibility/performance or supplied browser assertions. Recorded reads, commands and edits are evidence of their own actions; they do not imply that all requested behavior was independently verified.

## Validation

`npm run check:opencode-headless` checks lazy startup, serialization, idle termination, startup recovery, queued cancellation, shutdown during startup, environment isolation, catalog filtering, streamed event parsing, approval timeout cleanup, access modes, approval decline/acceptance, restore, credential guards, steering and cancellation using fixtures.

`npm run check:opencode-headless:live` starts the actual bundled binary, fetches the live catalog, sends genuine MiMo requests, reads/edits/restores a disposable project, exercises Controlled approval and decline, cancels a waiting approval, tries Space Bunny Free with an advertised thinking level, checks session deletion and observes actual process exit. It stores results under `scratch/opencode-headless-live/result.json`. This consumes free-provider quota. Every run has its own fixture project and Orvix data folder. A separate Ling Free live request timed out after 60 seconds; it was not counted as a passing model check.

`node scripts/check_agent_navigation.cjs` exercises the real React UI with a fixture IPC bridge, including refreshed models, supported thinking levels, unavailable-model explanations, free usage without a Zen key and the existing navigation/approval flows. It does not prove packaged Electron IPC behavior.

`npm run build` checks TypeScript and produces the application bundle. The Windows packaging config explicitly unpacks the bundled native executable. A fresh installer/package smoke test is separate from a successful web build.

### Observed results on 2026-10-09

| Check | Result |
| --- | --- |
| Headless fixture suite | 18 passed |
| Existing agent regression suite | 96 passed |
| Real React navigation/model menu with fixture IPC | Passed |
| TypeScript and Vite build | Passed; existing large-chunk warnings retained |
| Live catalog | 11 compatible free agent models; 2 advertised IDs lacked compatible runtime metadata |
| MiMo Free native greeting, Plan read, Full-access edit/read-back/restore | Passed |
| MiMo Free Controlled approval, decline and cancellation during approval | Passed; only the approved fixture file changed |
| Space Bunny Free with Low thinking | Passed |
| Temporary sessions and actual owned process exit | Passed |
| Unauthenticated local session API | HTTP 401 |
| Active request versus idle shutdown | Actual process stayed alive during an active lease and exited after idle; lifecycle probe used a one-second test timeout, production uses two minutes |
| Ling Free with Low thinking | Timed out after 60 seconds; not a passing provider check |
| Fresh Windows installer / packaged Electron IPC | Not checked by these runs |

Latest main live checkpoint: 465.7 MB working memory and 817 MB private memory. Additional results are saved in `scratch/opencode-headless-live/lifecycle-result.json` and `thinking-result.json`. Live model availability and latency remain provider dependent; other catalog models were not individually validated.

Official references: [OpenCode server](https://opencode.ai/docs/server/), [CLI](https://opencode.ai/docs/cli/), [Zen](https://opencode.ai/docs/zen/). The public catalog may contain models unavailable in this pinned runtime; updating the runtime is an explicit dependency change rather than an automatic background download.
