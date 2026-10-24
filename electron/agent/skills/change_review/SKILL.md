---
name: change-review
description: Review actual source changes against the user's request before handing off meaningful code edits; catch likely regressions without adding a separate reviewer stage.
---

# Change review

Use after meaningful source changes and before the final handoff. Skip unchanged files, research-only work, and trivial edits whose risk is negligible. This is a focused inspection by the working agent, not an extra model call, approval gate, or permission to expand the task.

Inspect the actual changed files using the current route's diff, change records, or before/after evidence. If no reliable diff is available, inspect the current edited sections and state that the review was limited. Do not infer changes from the task description or claim a Git diff in a workspace that is not a Git repository.

Check the changes against the human's requested outcome and existing project contracts. Focus on likely defects introduced by the edits: incorrect state or data flow, missed callers, edge cases, failure handling, cleanup, accidental scope changes, and relevant accessibility or security behavior. Follow a changed value across its boundary when that is where a regression could occur. Avoid broad style opinions and speculative findings.

If review finds a clear issue within the authorized scope, correct it and inspect the affected change again. Run or repeat only the check needed to confirm that correction. If a concern cannot be resolved from available evidence or is outside scope, describe it as an unresolved risk with its basis; do not present a hypothesis as a defect.

In the handoff, briefly say what was reviewed and report actionable unresolved findings. A clean review means no likely issue was found in the inspected changes; it does not prove the whole application is defect-free.
