# Tiny Agents workflows

Implemented on 2026-10-02. Existing Tiny Agents watchers and Construction Lock keep their separate validation, approval and recovery behavior.

## Using the Workshop

Open Tiny Agents → Agent Workshop. Pick a starter, or ask Fast or Thinking voice to draft a workflow. Set the goal, exact permitted targets, worker models, steps and observed acceptance checks. Saving creates a draft; review the complete plan before approving its revision.

Work is one-off by default. Explicitly select a trigger/schedule and approve recurrence for repeated work. The default execution policy is Single. Queued defaults to ten runs including the active run; Parallel defaults to two. Restart accepts read-only, restart-safe definitions and waits for cancellation before replacing a run. Browser and desktop actions share one interaction lock with voice; overlapping file/project paths are serialized.

The five job modes are Plan, Monitor, Work, Review and Repair. Structured blocks support PC actions, exact delays, condition/event waits, branches, parallel groups, research, browser/desktop workers, project workers, report creation, verification, notifications and approval checkpoints. Waits default to a visible 600-second timeout. Step outputs can be referenced by later steps; unavailable, cyclic, forward and cross-branch references are rejected.

The synthetic preview displays the saved plan without executing it. Live work shows step states, waiting reasons, questions, report previews and hashes, project changes, execution checks, ordered history and notification display status. The run inspection control shows its exact approved revision, even after a future draft has been edited. Project tasks and island residents link back to the Workshop.

Stopping voice, switching profiles or navigating away detaches the conversation. Approved jobs continue while Orvix runs, including in the tray. Pause and Cancel explicitly control the selected task. Orvix does not execute workflows while the application is closed.

## Authority and recovery

`electron/tiny-workflows.cjs` owns revisioned definitions, approvals, runs, timers and ordered events. State lives under Electron user data in `tiny-workflows/`; checkpoint writes are flushed and atomic, and events are append-only. A changing effect is checkpointed before dispatch and its result afterward. Deduplication receipts retain stable request IDs across restarts.

Both voice profiles use the same four workflow tools and narrow, sender-validated preload/IPC methods. Spoken approval requires inspection of the exact revision followed by a new explicit human approval turn. Model output, website text and workflow announcements cannot supply that approval. Late input or Stop from a previous profile cannot detach or authorize the current session.

Approval preserves exact worker choices and scope. Missing credentials, disabled workers, unavailable browser companions and Construction Lock conflicts produce setup requirements. Project workers use Controlled execution; exact reviewed commands may be granted within the reviewed workspace, while further commands require a checkpoint and outside targets are rejected. No model fallback or Full-access conversion is applied.

Completed steps are reused on continuation. Updating remaining work requires a paused, settled run and review of the new revision; changing a completed step is rejected. Read retries are bounded and reuse request IDs. Worker budgets stay bounded across approval checkpoints, and partial results require an explicit Continue. Interrupted changing effects require independent inspection before replay. Safe waits and checkpoints recover after restart; backup recovery disables future triggers for review.

## Verification results

| Check | Result |
| --- | --- |
| `npm run check:tiny-workflows` | 28 passed, including both-profile client contracts, approvals, reviewed effects, scopes, policies, queue overflow, event waits, branches, parallel groups, notification state, revision continuity and crash recovery |
| `npm run check:tiny-agents` | 71 passed, including Construction Lock fixtures and selected-change monitoring |
| `npm run check:agent` | 43 passed, including actual disposable project edits, evidence, recovery and Windows listener inspection |
| `npm run check:fast-work` | 42 passed |
| `npm run check:voice-interruptions` | 22 passed |
| `npm run check:fast-conversation` | 15 passed |
| `npm run check:browser` | Passed bridge, browser, YouTube and startup regressions |
| `npm run check:agent:ui` | Passed request/evidence UI and App navigation regressions |
| `npm run check:tiny-agents:ui` | Passed real Electron legacy/Workshop UI, approval, synthetic preview, approved-run inspection, navigation continuity, keyboard focus, compact layout and WCAG 2 A/AA checks |
| `npm run check:island:pc` and `npm run check:island` | Passed real IPC worker navigation plus WebGL, scenery controls, responsive layout, reduced motion and renderer disposal |
| `npm run build` | Passed TypeScript and production build; existing large-chunk warning remains |

The workflow arrival scenario uses actual disposable files, report writes and independent hash verification; research/provider responses and desktop notifications are fixtures. The crash scenario writes a real report, fails its result checkpoint, then verifies the existing file after recovery without rewriting it. Native protection tests remain disposable lifecycle fixtures; no permissions on user folders were changed by these tests.

## Real Live-provider acceptance

`npm run check:tiny-workflows:live` is an opt-in provider test using configured credentials. It creates a disposable read-only fixture and asks each configured Live model to draft, inspect and explicitly approve a file-content check. The latest report is `scratch/tiny-workflow-live-acceptance.json`.

Fast (`gemini-3.8-live`) passed drafting, inspection, explicit approval and observed file verification. Thinking (`gemini-3.8-live-extended-thinking`) did not pass: its session reported a system error or timed out before the complete approval sequence. Its scripted shared-tool, approval and continuity checks pass, but real-provider acceptance remains unresolved. No model was substituted.

The Live probe is text-driven. Microphone input, speech quality, Bangla speech, native protection and changing browser/desktop/project provider effects were not validated by that probe. Passing scripted checks does not establish those live outcomes.

Thinking workflow responses include the asynchronous scheduling hint described in [Google's Live tool guidance](https://ai.google.dev/gemini-api/docs/live-api/tools). Durable execution belongs to the Electron coordinator and does not depend on Live session resumption.

Personal-profile expansion, continuous desktop streaming and execution while Orvix is closed remain outside this implementation.
