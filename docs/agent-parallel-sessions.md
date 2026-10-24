# Parallel agent sessions

Independent sessions can run simultaneously without an application-wide concurrency cap. Start a task, open another session, and send its request. Switching sessions or pages does not cancel background work.

Each session retains its draft, attachments, model, thinking level, access mode, notices, streamed response, and approval/question IDs. The sidebar shows activity and unread results. Follow-ups in a running session retain the existing queue/steering behavior. Stop affects only the selected session.

OpenCode starts a separate authenticated worker lazily for each task. Catalog discovery has its own worker. Workers reuse the existing idle cleanup policy; shutdown terminates owned worker process trees and previews. Kilo uses concurrent requests directly, without OpenCode workers. Diagnostics are available through `window.orvixDesktop.getAgentWorkers()`.

Writing sessions reserve canonical project roots, including overlapping parent/child paths. A conflicting writer waits with a visible explanation while unrelated work continues. Read-only research can run concurrently. Cancelled waiters never execute. Use different project folders for independent website jobs. This feature does not create worktrees or merge files automatically.

Reload restores all active runs. Restarted, interrupted work uses the existing safe resume path; uncertain file changes are not replayed automatically. Existing conversations inherit missing preferences once. Each session preserves the existing 200K compaction policy and permission modes. Provider throttling and machine resource limits still apply; failures are scoped to the originating request.

## Validation

- `npm run check:agent`: 98 regression checks passed.
- Focused worker, preview, visual-tool, and reservation tests: 47 checks passed.
- `npm run check:agent:ui`: browser fixtures passed simultaneous mixed-provider runs, navigation, separate drafts/attachments, interleaved streams, independent approvals, unread results, reload, and a completion-during-hydration race.
- `npm run build`: TypeScript and production build passed.
- `npm run check:agent:parallel:live`: two actual MiMo Free sessions used distinct workers. Website creation took 42.424 seconds; MDN research took 34.829 seconds. They overlapped for 34.829 seconds. Three website files and source-backed research were verified. Evidence: `scratch/parallel-agent-live-1791604178717/result.json`.
- `npm run check:agent:parallel:preview`: two actual worker MCP connections and owned preview servers passed isolation and cleanup. Closing the first connection and preview left the second connection and preview working. Evidence: `scratch/parallel-preview-live-1791604736051/result.json`.

Mixed-provider concurrency, cancellation, crash recovery, and approval ownership have fixture coverage. The live model run used OpenCode MiMo Free; live Kilo concurrency, deliberate provider throttling, and a full desktop restart recovery exercise were not performed. Timings describe this run, not a latency guarantee. Restart Orvix to load main-process changes.
