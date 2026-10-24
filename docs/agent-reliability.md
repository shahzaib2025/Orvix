# Agent reliability and request understanding

Orvix now stores evidence independently of the text currently supplied to its model. Open **Task understanding & evidence** below a turn to review requirements, dependent actions, project structure and saved evidence. The panel and its detail sections start collapsed. Expanded tool results also offer **Read full evidence**.

## Durable evidence

`agent-evidence/<task>/<request>` contains an append-only event index and immutable metadata. Redacted output is stored in content-addressed blobs with SHA-256 validation. Retrieval is scoped to the task and request, and paged without rerunning the original command. Host stdout/stderr is captured before the transcript tail is shortened; completed sandbox output is retained before the sandbox staging directory is removed. File edit snapshots, final turn snapshots, model output, verification, recovery and pre-compaction context are archived separately.

Existing tool scope limits still apply: a bounded search records its actual returned results, not every possible match; binary files and credential paths are excluded. Historic outputs that were already discarded before this upgrade cannot be reconstructed. Redaction protects recognized credential patterns; it is not a general secret-detection guarantee.

Task history now uses an atomic manifest of independent task records, migrating the legacy `agent-tasks.json` on first read. There is no aggregate 30 MB history ceiling. Prompts and final replies are retained while activity previews remain compact. A read failure does not authorize overwriting unreadable history.

## Execution map

The model refines the original request into concrete requirements and actions using `update_execution_map`. Actions have requirement links, dependencies, pending/running/done/blocked states, and evidence IDs. Cycles, nonexistent dependencies and unsupported completion are rejected before saving a revision. Check actions require passing post-change evidence linked to their requirements. Map revisions are archived.

Requirement status is derived from observed evidence. A model cannot set a requirement to verified by declaring it complete. The initial broad goal stays pending until supported; replacing it with detailed requirements preserves the original objective. The quality and completeness of that decomposition still depend on the model.

## Progress-aware recovery

Repeated unchanged results, repeated failures and repeated action cycles produce a recovery instruction. It asks the model to reconsider its hypothesis, select an unverified requirement, reuse saved evidence, narrow the next check or explain a concrete blocker. Recovery observations and state survive safe checkpoints. Recovery never terminates the run because of a step, tool-call or total-time budget.

Existing operation-level command/network timeouts and user cancellation remain. Automatic verification repair has no fixed two-attempt cutoff; a reply explaining inability or a blocker can return a partial result with outstanding requirements.

## Maintained project map

The project map refreshes approved workspaces and fingerprints source/configuration content. It tracks files, declarations, imports, likely test files, entry points and guidance documents. Unchanged declarations are reused; import edges are resolved again so additions and removals update dependents. JavaScript/TypeScript use TypeScript AST and module resolution. Python uses AST declarations with static import candidates. Other formats expose file metadata. Generated, ignored, binary and credential paths are excluded, and large files expose metadata with a diagnostic.

This map is navigation support, not whole-program analysis. Automatic context selection also queries targeted symbol impact for focused JS/TS/Python files; `semantic_code` can retrieve other symbols and omitted details. JS/TS callers are compiler-resolved and Python callers remain static candidates. Source/configuration edits conservatively invalidate prior verification; excluded/generated files and remote source changes are not automatically monitored.

## Verification tied to requirements

`verify_work` accepts requirement IDs and an optional action ID. Check phases must match the requirement's accepted verification types. Linked focused/user-flow checks require an expected output and exit zero. Assertions can match the complete saved command output even if it is absent from the transcript tail. Preview checks attach only to compatible requirements, and browser-flow evidence requires actual assertions.

Verification types determine which phases are compatible. New turns additionally require coverage of every independently planned acceptance criterion with approved, fresh evidence. Separate checks can cover different criteria. Older turns without an acceptance plan keep their original phase-based coverage rules. Build success cannot support a requirement accepting only behavioral checks. Reproduction, skipped checks and failed checks cannot establish successful post-change verification. Changed sources make previous evidence stale; a failed rerun supersedes a prior passing run of the same check.

The final reply includes outstanding requirements or unfinished actions, and task memory records a partial status when coverage is incomplete. Expected text and exit status are observed checks; a separate review now checks the proposed test against acceptance criteria before execution. Reviewer approval alone never establishes a passed check. These changes improve traceability and recovery; they do not guarantee perfect execution or superiority over another coding agent.

## Validation

Run `npm run check:agent` for foundation and reliability checks, and `npm run build` for TypeScript and renderer packaging. Reliability checks include command output beyond transcript limits, scoped paging/checksums, split-chunk credential redaction, dependency cycles, requirement freshness, research support, project dependency changes, storage migration beyond the old aggregate ceiling, checkpoint recovery and a scripted model driving a real edit/check/restart flow. Scripted model tests do not measure live provider quality.


## Request understanding and follow-ups

Before substantial work, a separate model request extracts the goal, affected feature, trigger, expected behavior, assumptions with their basis, exclusions and concrete before/after examples. It distinguishes settled change monitoring from thresholds. Earlier human requests, the saved task goal and contract are supplied for follow-ups such as “finish it”; the user should not need to repeat an already known task.

Material questions pause mutations until the user answers or cancels. Optional preferences do not gate work. The answer form remains visible outside collapsed details; pending questions can be retrieved after navigating back to a task. Clarification invalidates the old acceptance plan and forces the executor to reconsider an already proposed batch. Waiting is reported explicitly before the edit timer starts. Failed or cancelled edits are labelled failed or stopped, never “Edited” merely because their tool name denotes an edit. Successful file-operation timing is separate from the following project-context refresh.

## Automatic relevant context

Every model step refreshes approved project maps, ranks current targets, imports/dependents, symbol references/callers, likely tests, project guidance and manifests, and retrieves focused, hashed source excerpts. Changed files cannot silently reuse old excerpts or caller locations. The context includes saved project constraints and relevant archived evidence from earlier turns in the same task. `read_evidence` and `list_evidence` accept `source_request_id` for those earlier observations. The transcript can stay small without rerunning the original command just to recover its result.

Excerpt sizes and tool-result paging are context-packing limits, not task execution budgets. Retrieval is heuristic and may omit needed sources; ranges, explicit relevant-context queries and semantic navigation remain available. Archived observations are historical evidence, not proof of the current environment.

## Runtime inspection

`runtime_inspect` reports OS/runtime/application versions, approved roots, listening ports and process metadata, managed preview launches, browser-companion observations or fresh PC Monitor sensors. Mentioned ports and sensor/server troubleshooting trigger read-only inspection automatically. Server commands also refresh relevant process/port observations before execution.

A registered preview PID and its descendants have a known launch directory. PID start times prevent treating an old/reused PID as the managed preview. On Windows, arbitrary-process cwd generally remains unavailable: a command-line reference to the project is explicitly only a candidate. A listening port does not prove application readiness. Runtime inspection itself does not terminate processes. Browser targets require the existing browser companion; unavailable versions, targets or sensors remain unavailable.

## Independent acceptance planning and review

A separate model call plans success criteria and negative cases from the original request, its interpretation and observed sources before project mutations. The planner does not receive the executor's conversation or proposed solution. Every declared requirement needs coverage, and missing original-request coverage is reported as a gap. Proposed command, browser, sensor and research checks get a separate review against selected criteria. Plain success-printing commands are rejected without a model call.

All criteria for a requirement must have fresh, passing or supported, approved observations. Evidence binds to the exact acceptance-plan stamp; changing criteria cannot reuse an older proof merely by keeping its ID. Malformed or unavailable reviews cannot award acceptance coverage. Work can continue when the review service is unavailable, but completion remains unverified; the executor can explicitly retry planning. Independent calls use the currently selected provider/model with a dedicated reviewer system prompt and no execution tools. They add model latency and usage; they do not guarantee model correctness or constitute an independently trained judge.

## Real workflow verification

`preview_website.workflow` supports click, fill, checkbox changes, selection, keys, local navigation, reload and assertions against actual text, input values, checked state, visibility, attributes, non-sensitive storage keys and URL. Persistence can be tested by changing a setting, saving, reloading and checking the restored state at desktop and mobile sizes. A failed step stops that workflow; interactions without assertions remain skipped. Arbitrary JavaScript is not accepted as a workflow action, and credential storage keys are excluded.

`verify_native_workflow` supports fresh brightness/volume/battery observations and comparisons, explicit baselines for change assertions, and real test notifications. Sensor snapshots must have consistent timestamps and available numeric readings. A queued notification is unresolved: only the exact notice's visible renderer acknowledgement verifies display. Tests can wait within an individual operation and are cancellable. Observation does not modify device settings; Controlled mode keeps host approval for a real notification test. These checks cover the selected cases, not every possible hardware condition or complete Windows automation scenario.

## Additional validation

`npm run check:agent` includes request/acceptance coverage, stale-plan invalidation, unavailable reviews, follow-up context, live Windows fixture-port ownership, targeted caller retrieval, native freshness, notification acknowledgement rules, cross-turn evidence retrieval, and clarification-before-write behavior. Model behavior in these tests is scripted; live provider interpretation quality still needs task-based evaluation.

`npm run check:preview` exercises actual desktop/mobile browser workflows, reload persistence, deliberately broken persistence and interaction-only checks. `npm run check:agent:ui` mounts the actual React components in a browser and checks collapsed details, live clarification, stale lookups, failed-answer retries, paged evidence, stopped-edit labels and turn changes. `npm run check:agent:native` uses an isolated Electron notification service and existing fresh live PC Monitor readings; missing sensors are reported as unavailable rather than fabricated passes. `npm run build` verifies TypeScript and renderer packaging.


## Responsive history and background indexing

Opening the agent page no longer refreshes every workspace once for each saved turn. Collapsed historic panels request no execution metadata or question state. Pending turns receive lightweight saved metadata and live events; expanding one panel requests a fresh check, with saved coverage labelled separately from current checks.

Project indexing now runs in a worker thread, using the same approved-workspace and sensitive-path checks. Overlapping scans of a root share one operation. Cancellation remains supported, and cancelling one index job does not terminate other queued projects. TypeScript parsing and Python inspection no longer run on Electron's main event loop. The worker stops after inactivity or engine shutdown; this does not impose a task execution budget.

Change fingerprinting reads the full changes manifest once rather than once per changed file. Unchanged fingerprints and change-list metadata reuse a cache tied to the manifest's file identity, size and high-resolution modification timestamps. Edits, restore and external manifest changes invalidate that cache. Current source verification still refreshes project fingerprints; browsing saved metadata does not imply a fresh environment check.

Responsiveness checks exercise 12 overlapping scans of a large source file while a main-thread heartbeat runs, saved metadata for 80 turns without indexing or file-body reads, cache invalidation after edits/restore, cancellation isolation, and an 80-turn browser history that loads only the explicitly opened panel. These are scoped regression checks, not a guarantee of responsiveness under every hardware or application workload.
# Navigation and live task ownership

The Agent workspace mounts on its first visit and stays mounted while other app
pages are open. Its hidden UI is inert and excluded from accessibility navigation.
Page navigation therefore preserves the pending run, event subscriptions, Stop
control, clarification questions, and eventual completion/history save. Reading
history and converting orphaned pending turns into interrupted attempts happens
when the workspace starts, rather than whenever the user returns to its page.

Switching agent sessions keeps the dashboard event subscription intact. Progress
and results use their originating task/request IDs, streamed text remains available
when returning to the running session, and pending activity retains its normal
detail allowance while another session is displayed. History must finish loading
before a new task starts, preventing hydration from replacing that new turn.

`check:agent:ui` exercises real App navigation and AgentDashboard with deferred IPC
responses: progress/clarification while away, session switching, completion and
saving while hidden, genuine provider failures, and explicit cancellation. This
fixture verifies renderer lifecycle behavior; it does not claim a live provider
run or recovery across an application restart.
