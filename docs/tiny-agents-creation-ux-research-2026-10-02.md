# Tiny Agents creation: research and redesign specification

Date: 2026-10-02. Status: research and proposed design; application code unchanged.

## Recommendation

Make creation an **Agent Workshop**: choose a useful job, edit a readable rule, preview its behavior, and review before enabling. Use the existing island characters and districts for personality. Keep a clearly visible Full editor for every supported setting. Treat the workshop and full editor as two views of the same draft.

The recommendations below are design proposals, not measured improvements. “Perfect” cannot be established from a design review: usability testing, capability coverage, accessibility checks and live acceptance must establish whether the implementation meets its targets.

## What was inspected

- `src/components/TinyAgentsWorkbench.tsx`: creation, editing, condition preview, review, notification activity and runtime controls.
- `src/components/TinyChangeControls.tsx` and `src/tinyAgentCatalog.ts`: selected changes, defaults, supported signals, six action types and twelve current templates.
- `src/components/IslandVillageDemo.tsx` and `src/components/islandWorld.ts`: existing island districts and agent roster.
- `electron/tiny-agent-options.cjs` and `electron/tiny-agent-changes.cjs`: schedule, policy, action and change-trigger validation.
- `docs/TINY_AGENTS.md`, `docs/CONSTRUCTION_LOCK.md`, the previous next-improvements research, and the existing builder screenshot `scratch/tiny-agent-change-builder.png`.

The screenshot and source support a design diagnosis; they are not a new live usability test. No application tests were rerun for this research-only work.

## Why the current creation flow feels tedious

1. A long modal presents trigger, watch configuration, district, name, schedule, conditions, timing, actions and delivery policy in one sequence. The screenshot has substantial scrolling before the user reaches completion.
2. Users must translate their goal into implementation concepts. The blank rule begins with battery at or below 80%, even when the intended job is unrelated to battery.
3. Repeated dark fieldsets and paragraphs give essential and occasional settings similar visual weight. The island personality is mostly outside the creation experience.
4. Raw seconds and broad dropdowns add interpretation work. “Hold,” “repeat,” “settle” and “cooldown” describe different behavior but need clearer contextual explanations.
5. Save-for-review is a useful safeguard, but the builder should explain what happens next and distinguish a saved draft from an active agent.

These are inspection findings and hypotheses about the user's frustration. Baseline task observation must confirm which changes help most.

## Research basis

| Source | Finding used | Application to Orvix |
| --- | --- | --- |
| [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Present frequent choices first, make secondary controls discoverable, and avoid excessive disclosure depth. Mandatory staged flows can impede interconnected work. | A compact workshop with named control groups and direct Full editor access; no mandatory long wizard. |
| [GOV.UK: Structuring forms](https://www.gov.uk/service-manual/design/form-structure) | Ask relevant questions, branch by need and use research to decide when decisions belong together, especially for repeat tasks. | Ask for a folder only for a file job; combine simple trigger/action choices on one editable canvas. |
| [Home Assistant: Automation editors](https://www.home-assistant.io/docs/automation/editor/) | Triggers, conditions and actions remain separately editable; naming and duplication aid maintenance. | Friendly language retains the existing trigger/condition/action distinction and ordered actions. Do not copy unsupported Home Assistant features into Orvix. |
| [Microsoft Fluent 2: Motion](https://fluent2.microsoft.design/motion) | Motion can explain transitions and acknowledge accomplishment. | A short, optional response after a confirmed save; agent movement communicates state rather than creating constant distraction. |
| [W3C: Target Size, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | The AA minimum is 24 by 24 CSS pixels, with defined exceptions including spacing. | Prefer comfortable 44-pixel primary targets; audit actual size/spacing rather than declaring every 44-pixel control a standard requirement. |
| [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | Nonessential interaction animation can be disabled; this criterion is AAA. | Respect reduced motion and provide a calm presentation. Do not imply motion is necessary for successful creation. |

The specific layout, names, grouping and time targets below are Orvix proposals inferred from this research and the inspected implementation.

## Proposed experience

### 1. Choose a job

Replace the empty technical form with useful mission cards: **Notice a change**, **Protect my focus**, **Keep my PC healthy**, **Watch files**, and **Protect work files**. Group the twelve existing templates under these jobs, showing their actual behavior underneath friendly names. Keep **Start from scratch** and **Full editor** visible.

Offer **Describe your agent** through the existing assistant-to-reviewed-draft workflow. Ask for missing details instead of inventing targets or unsupported capabilities. Creation must also work without an AI service. Construction Lock is a separate protection setup reached from its job card, not an ordinary rule action.

### 2. Edit a readable rule

Use a sentence with real controls: “When [brightness] changes by [1 percentage point], [notify me] after [1 second without another change].” Show a concise behavior summary beside or beneath it. Controls change according to the selected job.

For a threshold: “When [CPU] stays [above 90%] for [2 minutes], [notify me].” For a folder arrival, show the selected local folder and filename matching rule. For a schedule, show date/time, timezone and actual selected days.

Keep three named settings groups close to the rule: **Timing**, **Extra conditions**, and **Delivery**. Each collapsed group shows a summary of configured non-default values. Required targets and settings that change immediate behavior stay visible. Custom names and island districts belong in optional **Appearance**, with a suggested name and automatic district assignment.

Selecting a template starts a new draft. Editing an existing agent must never apply template defaults silently. Switching jobs or replacing a configured draft needs a clear local undo or explicit replacement choice.

### 3. Preview, then review

Provide **Preview behavior** without executing actions, and distinguish two things:

- **Example preview**: labeled synthetic input illustrating the message and trigger. It is not evidence that a monitor works.
- **Check current readings**: existing preview results, including unavailable/stale readings and next eligible schedule time. It is not a guarantee of future execution.

Keep the review summary in the same creation surface. Preserve separate save and approval operations, but bring the review into the flow instead of requiring the user to discover it elsewhere. Use **Save draft**, then **Enable agent** after review. A saved draft is labeled Draft; an enabled agent is labeled according to actual runtime state.

Shutdown review must show the ordered actions and existing 30-second cancellation countdown. Construction Lock keeps its own Windows approval, activation verification, unlock and recovery flow.

### 4. Give the agent personality

Use a small island resident illustration, a useful suggested name and warm, brief copy. Show the assigned island district after creation and allow optional customization. A “Brightness Scout” must still display “Brightness change monitor” and its rule underneath.

Use a restrained accent palette, stronger typography, more whitespace, clear selected states, readable labels and larger primary controls. A short completion gesture follows a confirmed draft save or enable result. Do not show success while activation is pending or failed. Respect reduced motion; keep mascot chatter and sound off by default. The full 3D island remains optional so creating a rule does not depend on it loading.

## Capability preservation map

| Current capability | Workshop location | Full access requirement |
| --- | --- | --- |
| Every current condition signal, comparison, target, field and window scope | Job-specific controls and Extra conditions | Retain every supported predicate; show unsupported/unavailable readings explicitly. |
| Selected changes | Notice a change | Up to twelve unique signal/target watches; numeric direction/minimum delta; 0–60-second settling. |
| AND/OR conditions, including saved nested groups | Extra conditions / Full editor | Preserve the original tree. Do not flatten mixed groups into one AND or OR. Existing nested groups can be preserved today; richer group authoring is a separate proposed UI improvement. |
| Always, once, daily and time-window schedules | Timing | Timezone, weekdays, overnight windows and skip/catch-up policy remain editable. |
| Hold, repeat and fire-on-approval behavior | Timing | Preserve exact seconds and explain what each setting controls. |
| Six current action types and ordered sequences | Then do / Full editor | Notify, shutdown, open URL, open local path, focus app and minimize app; up to six actions; preserve shutdown restrictions. |
| Quiet hours, fullscreen deferral, cooldown and daily limits | Delivery | Preserve exact current policies; explain zero/unlimited semantics in plain language. |
| Draft, edit, duplicate, pause, enable, delete and snooze | Agent card and detail actions | Preserve review and runtime controls; deletion and replacement must be clear. |
| Preview, notification test, inbox/retry and activity | Preview and agent details | Preserve current visibility and retry controls; never report queued as delivered. |
| Island district | Appearance | Optional and independent of monitor configuration. |
| Construction Lock | Protect work files → dedicated setup | Preserve modes, path constraints, timed unlock, Windows approval, verified activation, attempts, health and saved-permission recovery. |

Do not add speculative features from the earlier next-improvements research to the supported capability list. Also distinguish condition signals from change-watch signals: their supported sets differ.

## Accuracy rules and wording corrections

1. Both views operate on one canonical draft. Validate against the existing backend schemas. Round-trip comparisons should use normalized supported configuration, allowing established normalization without losing behavior.
2. Threshold holding, event settling, repeat interval and delivery cooldown must remain distinct. A duration selector may show minutes, but must preserve exact seconds and fractional settling values without rounding.
3. Brightness 50% → 51% is a one-percentage-point change. Preserve initial-baseline suppression and the selected one-second settling behavior. Repeated movement must reset settling according to the engine.
4. Preserve quiet-hours/deferred delivery and existing combined summaries. Explain that Orvix must remain running; sensor capture varies, and polling may miss short changes.
5. “Take a break” currently triggers after 45 active minutes accumulated today, not every 45 minutes. Do not relabel it as a recurring break timer.
6. “New PDF” currently uses a filename `contains '.pdf'` predicate. Either describe this precisely or separately implement/test a strict extension predicate; do not imply strict PDF identification.
7. “Disk space low” currently uses `lte` with 10. Describe this as “10% free or less,” not “less than 10%.” Reconcile template-count documentation with the twelve catalog entries.
8. Explain fire-on-approval when a condition is already true. Show the effect in review for any action that could run immediately.
9. Native Construction Lock is not an ordinary watcher: account/path limitations and Windows approval matter. “Protecting” appears only after verified activation. A recovery-required state remains visible and actionable across the redesign.
10. Success words must match evidence: draft saved, agent enabled, notice queued, display confirmed, action launched, or permissions restored. Display confirmation does not prove the user read a message; launching an app does not prove its work finished.

## Implementation sequence after design agreement

1. Establish baseline creation tasks and compare the workshop with a short guided alternative. Finalize hierarchy and copy from observed difficulties.
2. Extract one draft model/adapter from the current workbench; retain backend validators and the current full editor while adding the job chooser and compact rule controls.
3. Add review-in-flow, contextual previews, duration controls and configured-setting summaries. Cover every row in the capability map before replacing the old entry point.
4. Integrate lightweight island identity, optional appearance and reduced-motion behavior. Keep the runtime, native enforcement and notification delivery semantics intact.
5. Run configuration parity, targeted engine/UI regressions, accessibility, failure-state and representative live acceptance checks. Release only after the gates below pass.

## Acceptance gates

| Gate | Evidence required |
| --- | --- |
| Full capability access | Every capability-map row is reachable and editable or explicitly preserved; no silent resets when changing views. |
| Exact rule behavior | Normalized round-trip fixtures cover all action types, schedules, grouped conditions, multiple watches and non-default policies. Include timezone/DST, overnight schedules, fractional settling and unusual valid durations. |
| Understandable preview | Users can explain the trigger, action, timing and activation state. Synthetic preview cannot execute actions or alter monitor state. |
| Error handling | Field-level errors retain entered values; backend rejection, stale readings, unavailable hardware, failed delivery and cancelled Windows approval give a useful next step. |
| Accessibility | Keyboard-only creation/review, visible focus, announced errors/results, readable contrast, reduced motion, target size/spacing and layout at 200% zoom. Check 320px concept width plus supported desktop window sizes. |
| Safe verification | Existing Tiny Agents/UI/island checks and build pass for the changed scope. Test locks only on disposable files; report live Windows approval/audit coverage separately. |
| Ease and enjoyment | Formative sessions with 5–8 participants spanning new and experienced use. Record completion time, mistakes, comprehension and perceived ease. Proposed targets: common notification draft under 60 seconds and ease at least 4/5; these are targets, not measured results or statistical proof. |

Representative tasks: brightness change notification; CPU threshold with hold; weekday reminder with timezone; selected folder arrival; multi-action rule; preserved mixed AND/OR edit; quiet-hours defer/retry; cancelled Construction Lock approval and recovery. Include both first-time creation and editing an existing complex agent.

## Deliverable limits

The accompanying interactive design concept uses sample values and demonstrates two creation layouts. It does not connect to Orvix, save agents, read sensors, modify files or activate protection. It demonstrates the proposed interaction, not full implementation or a usability result.

Concept verification: browser checks passed for sample-job selection, numeric/fractional values in review, optional controls, back/edit value preservation, light/dark themes and 320/360/780-pixel workshop layouts. Desktop dark and narrow light screenshots were inspected. These checks do not establish full application parity, accessibility conformance or user satisfaction.
