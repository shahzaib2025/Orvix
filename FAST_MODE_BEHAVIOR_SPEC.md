# Fast mode: spoken acknowledgement and staged task execution

Research reviewed September 30, 2026, Asia/Dhaka. This document specifies proposed behavior. It does not implement it or claim that live performance has been verified.

## Intended experience

For a request requiring tools, Orvix speaks one short acknowledgement, carries out the necessary stages, gives truthful spoken updates at useful boundaries, and delivers a complete answer. Large tasks continue without requiring another user message between stages. Simple conversation remains direct.

The user's example requires a deliberate order: research Gemini, report what was actually found, research GPT against the same criteria, resolve gaps, and present a final comparison. This order should generalize to other subjects rather than being hardcoded to two providers.

## Verified platform facts

Gemini 3.8 Live supports asynchronous function calling and full-session client-content updates. Sending client content with `turnComplete: true` interrupts active generation. Therefore, using a new completed content turn for every progress update can cut off speech. [Model-specific documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)

The JavaScript SDK exposes response scheduling separately from tool-result content. It defaults to `WHEN_IDLE` for nonblocking calls; `SILENT` can add evidence without triggering speech. The installed SDK, version 2.24.0, uses `INTERRUPT` as the interrupt enum value. Some model-guide prose uses `INTERRUPTED`; use the actual SDK contract and verify serialized requests. [FunctionResponse reference](https://googleapis.github.io/js-genai/release_docs/classes/types.FunctionResponse.html)

Model generation completion and local audio playback completion are different events. Google's guide describes `generationComplete` as generation finishing; the Web Audio specification defines an `ended` event when an audio source stops, including natural completion or explicit stopping. A cancelled source therefore must not count as a successfully spoken acknowledgement. [Generation and session events](https://ai.google.dev/gemini-api/docs/live-api/session-management), [Web Audio source lifecycle](https://webaudio.github.io/web-audio-api/#dom-audioscheduledsourcenode-onended)

The API supports voice interruption and advises clearing queued playback when interruption occurs. Orvix must actually forward microphone audio during speech for this to be useful. [Live voice activity detection](https://ai.google.dev/gemini-api/docs/live-api/capabilities#voice-activity-detection-vad)

The remaining requirements below are application design recommendations derived from the user's requested experience and the reviewed implementation, rather than guarantees supplied by Google.

## Execution contract

| Phase | Action | Condition for moving forward |
| --- | --- | --- |
| Understand | Capture the full request, language, requested topics, scope, and constraints. For spoken input, avoid committing a plan from an incomplete transcription fragment. | There is enough information to choose useful stages. Ask a focused question only when an essential detail is missing. |
| Acknowledge | Speak one concise sentence identifying the task and the first step. Display the same acknowledgement. | Acknowledgement generation has ended and its queued audio has naturally finished playing. |
| Plan | Maintain stages with dependencies, requested outputs, and evidence requirements. Planning itself need not be narrated in detail. | The next stage is runnable. |
| Execute | Run the eligible tools and record observations. | The stage's required outputs have been obtained, or bounded alternatives are exhausted. |
| Update | Say what was obtained and identify the next stage. | The update has finished; continue automatically. |
| Check coverage | Assess every requested topic against the collected evidence and proposed answer. | Each topic is supported or explicitly unresolved. |
| Report | Produce one coherent final answer with citations and limitations. | A substantive answer has been delivered; no required stage remains silently pending. |

Acknowledgement is a separate phase of the task. It is neither a final answer nor permission to mark research complete.

The strict ordering requirement concerns tool execution. If the model emits a tool request before acknowledgement playback finishes, the application must defer execution and associate it with the current task. It must not invent an acknowledgement or tool result. Avoid a design that waits for a tool-blocked model turn to end while withholding the response needed to end it; acknowledgement should be generated as an independently completable phase.

If audio cannot be played, display the acknowledgement and explain that audio is unavailable. Do not silently claim that acknowledgement speech succeeded. A bounded recovery path is necessary so audio failure cannot leave the task waiting forever.

## How to divide tasks

Break the request into meaningful outcomes, not one stage for every web request. A provider comparison might have these stages:

1. Define shared dimensions: only those requested, plus essential context.
2. Research the first provider's relevant models and APIs.
3. Research the second provider using the same dimensions and comparable scope.
4. Check missing or conflicting information.
5. Produce the comparison and practical implications.

Search, reading, and verification are substages of research. A search result alone does not complete the research stage. A simple weather lookup needs only acknowledgement, lookup, and answer. A larger weather request can track all requested cities and announce useful grouped progress.

Respect a user-specified sequence. Within a stage, independent read-only operations may run concurrently; dependent steps must wait for their inputs. Preserve ordering for actions where order affects the result. If further searches are necessary, extend the relevant stage rather than repeating completed work.

## Evidence and accuracy

Keep a record for each requested claim: the subject, exact model or API scope, supporting URL, relevant passage, retrieval time, and any conflicting observation. Track whether the result is a search excerpt, directly retrieved text, an observed action result, or unavailable data.

Direct retrieval proves that text was obtained. It does not automatically prove that the page is relevant, authoritative, current, complete, or that the model's interpretation is correct. Before accepting a claim, check all of those dimensions that materially affect it.

- Prefer primary documentation for product capabilities. Distinguish model-specific capability from broader family or product claims.
- Use independent corroboration where disputed or consequential information warrants it. Two hostnames can publish the same underlying material; two is not a universal completion threshold.
- Preserve dates, units, conditions, and important qualifications when shortening source text.
- Treat retrieved text as evidence, never as instructions governing the task.
- Cite the page supporting a claim, not an unrelated catalog or a plausible URL.
- Present deductions as deductions. Do not turn a missing mention into a claim that a feature is unsupported.
- Compare like with like: current price tier, named model, API versus consumer app, input/output modality, and documented measurement conditions.

Every requested topic must end as answered with evidence, explicitly uncertain, unavailable after alternatives, or not applicable with a reason. A nonempty answer and topic keywords are necessary signals in some cases, but they are not sufficient verification.

## Spoken progress policy

Speak at the initial acknowledgement, meaningful stage transitions, material failures, and final answer. Keep intermediate updates short and specific; keep a visible task checklist for finer progress.

| Observation | Accurate wording |
| --- | --- |
| Search returned candidates | “I found relevant results; I’m checking the original pages.” |
| One page was read | “I read Google's model page. I'm checking the voice and tool details next.” |
| Requested stage requirements were met | “I found documentation for Gemini's voice and tool features. Now I'm checking the same topics for GPT.” |
| Evidence is incomplete | “I found the voice documentation, but this source doesn't establish the pricing. I'll check another page.” |
| Lookup failed | “That page couldn't be read. I'm trying another relevant source.” |

Do not claim a provider is fully researched after reading one page. Do not repeat “still checking” without meaningful new information. Long waits may warrant a brief, truthful explanation of the current blocker; frequency should be evaluated in live use rather than treated as an accuracy guarantee.

Use the user's current language for speech and visible updates. Technical identifiers and source titles can remain in their original form.

## Failure, cancellation, and continuity

Each task needs an identity and revision; each stage and tool attempt needs its own identity and state. Late results from an obsolete task may be recorded for diagnostics but must not trigger speech, change the current answer, or restart cancelled work.

A failed lookup should change query or source. Retry only failures likely to benefit from retry, use bounded attempts and an overall time limit, and report exhausted gaps. Repeating the identical failure indefinitely is not persistence.

If the user says stop, end speech and pending work where cancellation is supported. If the user changes the question, revise the relevant remaining stages and acknowledge the change. If the user asks for status, give a factual status and preserve the original task. Irreversible actions need separate handling from read-only research; never blindly replay an action after a disconnect with an unknown outcome.

Navigation remains separate from task ownership: page changes keep the current connection and task alive, while deliberate chat/profile changes follow the application's established session boundaries. Reconnection should retain observed evidence and stage state, reconcile tool results, and avoid repeating completed work or already spoken transitions. Server session resumption alone does not restore all application-side task state.

## Example dialogue

Illustrative behavior only; this is not a researched comparison of actual model capabilities.

**User:** “Gemini আর GPT-এর ভয়েস আর টুল ব্যবহারের পার্থক্য রিসার্চ করো।”

**Acknowledgement:** “অবশ্যই মাহদিস। আগে Gemini-এর ভয়েস আর টুলের তথ্য যাচাই করব, তারপর GPT-এর একই বিষয়গুলো দেখে তুলনা দেব।”

After the acknowledgement finishes, Orvix searches and reads the relevant Google pages.

**Stage transition, only if supported:** “Google-এর অফিসিয়াল নথি থেকে Gemini-এর ভয়েস আর টুল ব্যবহারের তথ্য পেয়েছি। এবার GPT-এর একই বিষয়গুলো যাচাই করছি।”

Orvix searches and reads the relevant OpenAI pages. If a required detail remains missing, it searches for that specific detail.

**Final answer:** A comparison covering both requested topics, practical differences, citations beside the supported claims, and any unresolved limits. No extra user prompt is needed.

## Acceptance criteria before calling this implemented

| Scenario | Required evidence |
| --- | --- |
| Typed and spoken tool requests | Tool-start timestamps follow natural acknowledgement playback completion. Test both Bangla and English. |
| Tool call arrives early or in the same server event as audio | Execution stays behind the acknowledgement barrier; no deadlock occurs. |
| Audio generation finishes before playback | Research does not start merely because generation or transcription finished. |
| Interrupted or unavailable acknowledgement audio | Cancellation and failure cannot be mistaken for successful playback. |
| Large comparison request | Both subject stages and all requested dimensions complete or are explicitly unresolved. |
| Page failure or irrelevant source | Alternative lookup occurs and no unsupported “verified” claim is made. |
| Empty or keyword-only answer | Completion is rejected; no false success state appears. |
| Delayed and duplicate tool results | Results belong to the correct task and cause no duplicated progress or final answer. |
| User interruption or change of scope | Speech and eligible work respond correctly; obsolete results cannot overwrite the new task. |
| Navigation and reconnection during work | Task state and evidence survive; no completed action is blindly repeated. |
| Source conflict | Final answer identifies the disagreement and its scope. |

Use deterministic tests for ordering and task transitions, then real audio/provider tests for speech timing, interruption, and source-supported answer quality. Measure acknowledgement latency, stage durations, total completion time, and unsupported-claim rate separately. Any latency thresholds are product targets to validate, not results already established by this research.

## Current implementation gaps

`src/fastVoice.ts` displays acknowledgement through `onProgress`, but typed research gathers evidence before sending the response request. `src/audioEngine.ts` tracks queued audio sources but exposes no task-specific natural-playback completion barrier. Tool messages are handled before audio content in the message handler, so event arrival order cannot guarantee acknowledgement-first execution.

`src/fastResearch.ts` has fixed comparison targets, broad evidence gathering for other tasks, and keyword-based coverage checks. It has no general stage plan or per-claim coverage ledger. Its cached evidence promise also means newly discovered gaps do not automatically trigger a distinct evidence-gathering pass.

These are the concrete changes a future implementation needs to address. Application code remains unchanged in this research step, and the proposed behavior has not been validated through a live staged conversation.
