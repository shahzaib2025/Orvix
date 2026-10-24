# Task planning and clarification

Read this skill for a task with several dependent steps, material ambiguity, competing constraints, changed priorities, or recovery that requires deciding what remains. Use the existing execution map, task contract, request understanding, saved evidence, and clarification tools. It applies across design profiles and task domains. It does not create another planner, model call, approval stage, public control, or permission grant. Core instructions and the latest authorized human request govern the work. Simple greetings, direct facts, and straightforward single actions do not need this guide or a formal plan.

## 1. Establish the current request

Identify the objective, explicit deliverables, relevant target/workspace, constraints, preservation requirements, and observable completion conditions. Distinguish what the user actually requested from optional improvements and assumptions. Inspect current context before asking for information already supplied. Earlier project context is useful evidence, not implied permission to work on it for an unrelated request. A selected design profile or loaded skill does not expand task scope.

Resolve project location from the latest request and this task's saved active project folder. An explicitly named existing folder or path is the target: open that exact location through the normal workspace permission flow and do not substitute a sibling or create a duplicate. For follow-ups such as “continue,” “fix it,” or “add this,” keep working in the saved active folder unless the human names another location or explicitly asks for a new, separate project. Create a new folder only when requested; choose an unused sibling only if the user asked for a newly created folder and the exact name is already occupied. Never inspect an unrelated project just to choose a destination.

Use the request understanding and acceptance plan already supplied by Orvix. Do not call read_request_understanding, read_execution_map, or review_acceptance_plan simply to repeat unchanged supplied content. Read them when necessary information is absent, stale, or needs clarification. Maintain one concise execution map; use update_execution_map to refine requirements and dependent actions when the task warrants it. Reuse existing requirement/action IDs rather than making parallel plans or duplicate requirements.

Use only mechanisms exposed by the current route. Native OpenCode may expose native todo tools and retained action records instead of Orvix's execution-map or clarification tools. Use those available equivalents for a concise plan; do not invent a missing tool, requirement ID, or evidence link, and do not create a second planner to imitate the regular API route. Native todo updates are tool work and must stop under report-only instructions. A model's native plan is not proof that every step executed.

Express completion in observable terms appropriate to the request: a repaired behavior, a delivered artifact, a verified interaction, or findings supported by sources. A build does not prove a user flow, an image does not prove animation, and a local confirmation does not prove persistence. Avoid inventing acceptance obligations, extra redesigns, or external integration merely to make a plan look thorough.

## 2. Ask only material questions

Ask when different plausible answers would materially change correctness, scope, preservation, access, delivery, or an irreversible action, and the answer cannot reasonably be found in the authorized context. State the decision that is unresolved and why it matters. Ask one focused question or a small related group, using understandable mutually distinct options when useful. Do not ask the user to design an open creative brief, choose routine implementation details, or repeat an existing authorization.

For unresolved material questions already recorded in request understanding, use clarify_request with the exact existing question_id. Do not invent IDs or assume a general chat prompt is an available tool. If a necessary question is missing from the interpreted request, explain the gap through the supported clarification mechanism or response; do not silently guess or manufacture an answer. Inspect the current tool schema before using it. A tool waiting for an answer is not evidence that the human approved a choice.

Distinguish required clarification from optional preference. For a required answer, pause only dependent actions and continue independent authorized work when the runtime supports doing so. For an optional preference, make a reasonable decision based on the user's goal and state a material assumption briefly. Silence, elapsed time, or a preselected option is not an answer or approval. Respect Plan mode and explicit research-only/no-code requests; neither a skill nor a plan authorizes implementation.

## 3. Order work by dependencies and risk

Choose the smallest useful next action that resolves uncertainty or advances a deliverable. Inspect relevant source and contracts before edits; use the matching topic skill where needed. Group independent reads and checks when the tools permit, and keep dependent edits or verification sequential. Avoid broad repeated scans, excessive tool calls, and speculative implementation before the needed fact is known.

Represent meaningful dependencies, not every keystroke. Link actual operations with existing action_id, requirement_ids, and acceptance_ids where supported so Orvix records their evidence. Successful evidence can complete actions automatically; do not add redundant bookkeeping calls. A planned, attempted, or rejected operation is not complete. If a check covers only part of a requirement, retain that partial coverage and identify the remaining observation. Never assign verified status from a model's confidence.

Scale effort to the task. A small repair may need one concise requirement, a focused baseline, an edit, and a check. A larger task may need milestones and parallel independent inspections, but this skill does not authorize spawning agents, installing tools, or adding mandatory workflows. Do not promise immediate provider response or a fixed completion time from a small plan.

## 4. Apply steering to the active task

On each new human instruction, reconsider the current objective, scope, assumptions, priorities, and remaining actions. Preserve earlier requirements that remain compatible; revise or retire actions that are no longer authorized. A new unrelated request changes the target; do not carry over an earlier workspace, visual profile, or unfinished implementation as an implicit requirement.

Honor explicit stop, cancel, pause, report-only, and no-more-edits instructions immediately through the existing runtime controls. For report-only, use already recorded actions and evidence for the response and initiate no new tool work, including planning metadata, inspection, builds, previews, or polish. Do not finish the previous creative idea before acknowledging a scope reduction. Actions already in flight may have completed before cancellation takes effect; report their observed outcome without claiming an unobserved rollback. Resuming or expanding work requires an instruction that actually authorizes it.

When the user asks a status question without stopping the work, give a brief accurate update and continue the authorized task. Do not treat every interruption as a fresh task or restart completed work. For changed requirements, recheck only affected evidence and assumptions; preserve valid results for unaffected work. If an instruction conflicts with a constraint that still applies, explain the concrete conflict and ask only for the decision needed to proceed.

## 5. Recover from observed state

After a timeout, provider failure, cancellation, or tool error, inspect retained action records and source state before retrying an authorized action. Distinguish a failed request from a failed tool operation and an uncertain result from a confirmed failure. A missing acknowledgment can occur after a write succeeded. Never blindly repeat a file creation, external submission, installation, or other operation that may already have completed.

Resume from the last reliable checkpoint with the remaining requirements, valid evidence, and current instructions. Do not replay the entire task or silently drop an unfinished deliverable. Reuse successfully read current skills; reread changed or missing guidance through the existing loader. After source changes, affected verification is stale. Use bug_repair for cause analysis and browser_verification for browser-state evidence when relevant. A retry needs a supported reason or changed hypothesis; repeated identical failure without new information is not progress.

Respect actual access boundaries and external availability. Identify the specific blocked dependency and continue independent authorized work when possible. Do not weaken protected-path checks, silently change models, invent provider success, or claim a missing asset/tool was used. Report what needs an external change or human answer without presenting a routine creative decision as a blocker.

## 6. Finish with supported outcomes

Before completion, compare the current deliverables with the execution map and actual evidence. Check that important requirements were not forgotten after steering or recovery. Report completed, failed, blocked, and unverified work distinctly and explain material limits. For research/diagnosis, findings and uncertainty may be the deliverable; do not imply a repair occurred. For Plan mode, deliver the plan without implementation claims.

Give concise progress at meaningful milestones: an uncertainty resolved, a scope change, a verified result, or a real blocker. Final reporting should lead with the observed outcome, name relevant artifacts/changes, summarize actual checks, and identify remaining work. Do not claim perfection, guarantee every future task, or equate a completed plan with a completed result.
