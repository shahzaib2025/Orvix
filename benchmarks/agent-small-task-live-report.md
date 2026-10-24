# Small task: live Agent evaluation

Tested on October 3, 2026, using the production Agent executor and the configured OpenCode Go provider with DeepSeek V4.1 Flash. No model or review responses were mocked. This evaluates the executor and provider, not desktop UI responsiveness.

Task: change `add(a, b)` from subtraction to addition in one small file. Preserve its comment and exported signature, leave the package manifest and tests unchanged, run the project tests, and report the outcome.

## After the workflow fixes

The final repair trial used the same live provider, model, default thinking variant and isolated addition task. It completed normally with every requirement verified and all four execution steps done.

| Measurement | Before fixes | Latest repair trial |
| --- | --- | --- |
| First independently correct fix | 1m 58.55s | 1m 42.64s |
| Final response saved | 6m 41.72s | 3m 25.93s |
| Actual edit duration | 22ms | 17ms |
| Independent input checks | 7/7 | 7/7 |
| Existing project tests | 3/3 | 3/3 |
| Tool calls | 23 | 11 |
| Failed proposals/operations | 14 | 1 |
| Provider requests | 23 | 14 |
| Requirement coverage | 1 verified, 3 pending | 2 verified, none pending |
| Pending execution steps | Present | None |

The one rejected proposal mixed verification phases for incompatible requirements. Local validation rejected it before execution or paid review; the agent recovered with separate checks. The fix preserved the comment, signature, manifest and test file. Finalization now verifies recorded workspace hashes, sources and actual delivery independently, and combines criterion evidence without overwriting it. Overall task, tool-call and time limits were not introduced.

The captured final reply also confused matching source fingerprints with execution identity. A subsequent guard checks distinct command-log IDs, excludes declined automatic checks, and preserves reviewed reporting excerpts through corrections. That guard passed regression checks against the captured live response; it was added after the timed trial. The raw report retains the original response for transparency.

Evidence: [latest repair trial JSON](.runs/small-task-Kr5I29/report.json), [timeline](.runs/small-task-Kr5I29/timeline.json), [fixed file](.runs/small-task-Kr5I29/project/math.js), and [captured reporting regression](../scripts/fixtures/agent-execution-identity.json).

Intermediate probes also found proof-overwrite, compound-action and delivery-retention issues. One probe that started before the execution-review fix was stopped to replace its obsolete executor. Completed intermediate trials took 3m10s, 4m23s and 3m55s and passed the external code checks, but their ledger/reporting gaps prompted the additional fixes; they are not presented as final acceptance.

Validation after implementation: agent regression suite, real React/navigation UI checks and production build. These small trials do not establish general model reliability or a production UI performance rating. Provider interpretation/planning/review latency still accounts for much of this small task's duration.

## Original clean run

| Measurement | Result |
| --- | --- |
| First independently correct fix | 1 minute 58.55 seconds |
| Final response saved | 6 minutes 41.72 seconds |
| Actual edit tool duration | 22 milliseconds |
| Independent input checks | 7 of 7 passed |
| Existing project tests | 3 of 3 passed |
| Protected comment, signature, manifest and tests | Preserved |
| Tool calls | 23 |
| Failed tool operations | 14 |
| Logical provider requests, including reviews | 23 |
| Provider request time, summed | 356.90 seconds |
| Acceptance-planning request | 55.15 seconds |
| Eight check-review requests, summed | 143.34 seconds |
| Executor requirement coverage | 1 verified, 3 pending |

The code fix was correct. The overall workflow was slow and its completion bookkeeping remained partial. Failures included a missing required reproduction output, verification phases that did not match linked requirements, a Git status check in a folder without Git, and attempts to complete actions without accepted evidence.

Independent reviews repeatedly required a test command to also verify the future final report, and required scope checks to prove that nothing was written elsewhere on the filesystem. These distinct outcomes were grouped under single requirements. The agent repeatedly revised check commands instead of resolving the criteria coverage problem.

The final reply also mixed observed behavior with proposals rejected before execution. A rejected check is not an executed check with a successful exit status. This remains an accuracy issue even though the independently tested code is correct.

Evidence: [clean run JSON](.runs/small-task-rR92Ff/report.json), [timeline](.runs/small-task-rR92Ff/timeline.json), and [fixed file](.runs/small-task-rR92Ff/project/math.js).

## Initial trial and limitation

An initial trial reached a correct fix at 3 minutes 55.33 seconds and returned its final response at 6 minutes 48.13 seconds. It passed the same independent checks, but the test harness restricted command shapes and blocked legitimate preservation checks. Its later verification timing is confounded by those restrictions. The clean run used normal Full access for commands in the approved isolated folder; the measurements above come from that clean run.

Evidence: [initial run JSON](.runs/small-task-0taMqq/report.json).

The original evaluation did not change production code. The subsequent implementation and trials above changed the executor and verification/reporting workflow.
