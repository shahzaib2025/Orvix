# Bug repair

Use this skill for a reported defect, regression, crash, incorrect result, or broken interaction. Diagnose and repair within the user's authorized scope. A diagnosis-only request does not authorize implementation. Preserve working behavior, public contracts, user data, and unrelated changes. This guide supplies a reasoning workflow, not a mandatory model call, review gate, or permission grant.

## 1. Define and reproduce the actual failure

For several dependent repairs, material ambiguity, scope changes, or recovery that needs a revised plan, also read task_planning. Reuse the existing execution map and supplied acceptance plan; do not create another planner or delay a simple repair with formal planning.

Record the user-visible failure and expected behavior in the task contract. Identify the exact artifact, task/request, entrypoint, launch method, triggering input, and relevant environment from available evidence. Separate facts from hypotheses. A pasted log or screenshot is evidence of a symptom, not proof of its cause. Reuse existing current evidence before issuing redundant commands. Ask a focused question only when a missing fact materially prevents diagnosis.

Use verify_work with phase reproduce and a specific expected output when feasible. A safe reproducer should exercise the reported behavior, not just import a module or compile the project. A failing command establishes reproduction only when its output matches the intended failure; an unrelated installation or environment error does not. Avoid destructive reproduction, real purchases, outgoing messages, or production writes without applicable authorization. If reproduction is unavailable, state that limit and investigate the observable code path without claiming confirmation.

For browser or Electron renderer behavior, also read browser_verification. For a WebGL defect, read threejs; for external model/texture failures, combine it with gltf_assets when relevant. Use available tools and their actual schemas; do not invent tool names, parameters, or unavailable capabilities.

## 2. Trace the cause and test the hypothesis

Locate the smallest relevant code path and inspect callers before editing. Trace the trigger through input/state, event handling, IPC/API or tool execution, external dependencies, and returned UI state as relevant. Identify the first observed divergence from expected behavior. Inspect both sides of a boundary when a value, error, cancellation, or permission decision crosses it. Check versions, configuration, paths, process ownership, and runtime state only where they could explain the symptom.

Form a concrete hypothesis with a predicted observation, then use the smallest read, inspection, or safe experiment that can confirm or reject it. Update the hypothesis when evidence disagrees. Do not perform repeated speculative edits or gather an entire repository when a focused trace will answer the question. Treat timing correlations as clues, not proof. If a log records empty tool input, distinguish streaming placeholders from completed arguments before diagnosing an empty request.

Distinguish application defects from provider outages, unsupported endpoints, authentication/rate-limit failures, protected-path controls, and deliberate cancellation. Preserve the underlying error and its source. A provider failure is not fixed by changing unrelated UI; a permission denial is not evidence that the human declined the action. Never weaken security, protected-path checks, or evidence requirements to suppress a symptom. Recover through an authorized route when one exists, and report external limits honestly. After a timeout, inspect completed actions and current files before retrying so successful writes or external actions are not duplicated.

## 3. Repair the cause while preserving contracts

Make the smallest repair that explains the failure. Inspect inputs, outputs, surrounding callers, and lifecycle before changing a shared helper. Preserve IDs, event handlers, API/IPC shapes, persistence formats, access modes, cancellation semantics, and existing user work unless the authorized fix requires changing them. Avoid broad refactoring or redesign during a narrow repair.

Handle errors at the boundary that owns them with truthful, actionable state. Do not catch and discard errors, hardcode a passing result, leave endless loading, label every exception with one generic cause, or present a fallback as successful execution. Remove temporary diagnostic changes or explicitly document any retained instrumentation. Prefer updating existing dependencies only when evidence shows a version issue; do not add a large toolchain for a small defect.

If the cause is shared by several operations, repair the common mechanism and check the affected operations rather than adding isolated exceptions. Explain the causal relationship between the defect and the change. If evidence supports only a partial repair, identify the unresolved part instead of claiming the entire problem is fixed.

## 4. Verify the original behavior and nearby risks

Run the focused reproducer again, then relevant regression checks. Use the same trigger and launch route that failed. Choose adjacent checks from the changed contract: callers of a shared helper, success/failure paths of state handling, cancellation during asynchronous work, or reload/persistence when storage changed. Avoid broad or repeated test runs after the relevant checks pass unless new evidence justifies them.

A useful regression check distinguishes the old failure from the corrected behavior; it must not merely repeat the implementation. Keep command exit status, observed output, screenshot inspection, user-flow result, provider behavior, and packaged-app validation separate. A build does not establish browser interaction, backend persistence, provider availability, or visual quality. If reproduction or a check is unavailable, record why and do not claim it passed. After edits, prior evidence for the affected state is stale until checked again.

## 5. Deliver an evidence-based explanation

Report the observed failure, confirmed cause or remaining hypothesis, changed files/behavior, focused checks and outcomes, and material limits. Describe user impact plainly. Attribute each failure to the evidence actually recorded. Never promise that an error cannot recur or claim a live end-to-end repair from static checks alone. When a check fails, investigate the new evidence before marking the task complete; when an external dependency remains unavailable, preserve completed work and clearly identify what cannot be verified.
