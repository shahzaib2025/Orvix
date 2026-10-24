# Orvix Fast profile research

Reviewed September 30, 2026 (Asia/Dhaka). Scope: the project's Fast voice profile, its tools and research flow, and current Google documentation. This is a research assessment; application code was not modified.

## Conclusion

The Fast profile uses an appropriate low-latency voice model and has useful evidence collection and recovery mechanisms. Its main weaknesses are application orchestration: missing conversation restoration, stale desktop context, blocked spoken interruptions, and research completion checks that can accept an empty answer. These should be addressed before assuming a different model will solve responsiveness or answer-quality problems.

## How it works

| Component | Implementation |
| --- | --- |
| Profile routing | `src/liveVoice.ts:35` selects `FastVoiceSession`; Fast and Thinking have separate handlers. |
| Model and authentication | `electron/live-auth.cjs:2` defaults to `gemini-3.8-live`, with an environment override. The main process issues temporary tokens to the renderer. |
| Voice connection | `src/fastVoice.ts:200` requests the Fast token; the connection uses audio output, input/output transcription, session resumption, and sliding-window compression. |
| Audio | `src/audioEngine.ts` captures 16 kHz PCM in 50 ms chunks and queues 24 kHz output. |
| Instructions | `src/fastFlow.ts` asks for prompt acknowledgement, complete execution, source grounding, and Bangla by default. |
| Tools | Weather, web search/page reading, files/content search, windows/clipboard, tiny agents, YouTube, and Class 10 textbooks. |
| Desktop awareness | `src/pcContext.ts` compresses foreground app/document, background windows, media, volume, and presence into startup context. |
| Research | `src/fastResearch.ts` distinguishes directly read pages from excerpts. General research tries up to three queries and seven pages, stopping after two verified hostnames. GPT/Gemini comparisons have six predetermined documentation targets. |

## Compatibility with current Google documentation

Google lists `gemini-3.8-live` as a stable model for low-latency voice interaction. Its model-specific migration guidance says to omit thinking configuration, supports asynchronous function calling, and says a completed client-content turn interrupts active generation. Fast omits thinking configuration and several shared tool declarations explicitly use `NON_BLOCKING`, which is supported. An older comment in `src/thinkingVoice.ts:323` saying Fast must not use that behavior is inconsistent with the current model documentation. [Gemini 3.8 Live documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)

The generic tool guide still includes a support table for older Live models, so use the model-specific guidance when interpreting 3.8 behavior. Live tool execution and responses remain the application's responsibility. [Live tool guide](https://ai.google.dev/gemini-api/docs/live-api/tools)

Compression and session resumption match Google's recommended mechanisms for longer conversations. The API also provides a `GoAway` warning with remaining connection time. [Session management](https://ai.google.dev/gemini-api/docs/live-api/session-management)

## Findings and recommended priorities

### 1. General research can accept an empty answer — high priority

`src/fastResearch.ts:188` checks topic coverage using regular expressions. The four default general-research requirements have no corresponding expressions. Consequently, a task with one verified source and an empty answer returns no missing topics and `fastResearchNeedsMore` returns false.

Confirmed through an in-memory execution of the actual module. This shows the guard fails to reject an empty answer; it does not establish how often the live model produces one.

Recommendation: require a nonempty substantive answer and explicit coverage of requested questions. Validate evidence attribution separately from keyword presence. The two-continuation ceiling should end with a clear statement of unresolved work.

### 2. General research receives comparison-specific instructions — high priority

`src/fastVoice.ts:553` starts typed research for both task kinds, but its prompt always asks to compare two providers and discusses coding rankings. A request about an unrelated topic can therefore receive irrelevant instructions.

Recommendation: construct instructions according to `task.kind`; keep provider-comparison guidance within the GPT/Gemini branch.

### 3. Saved history is not restored to a fresh Fast session — high priority

`src/App.tsx:340` supplies saved messages through the session facade. Fast stores and updates this history but does not send earlier turns during connection. A resumed server session can retain its own context, but reopening a saved conversation in a fresh session has no equivalent restoration.

Recommendation: send a bounded history or summary when establishing a fresh session. Avoid duplicating context on successful resumption.

### 4. Spoken interruption is blocked — high priority for voice UX

`src/fastVoice.ts:162` drops captured microphone chunks unless the state is listening and no answer or tool response is pending. Audio received during assistant speech or tool work therefore cannot reach the model to interrupt it. Handling a server interruption message does not overcome this input gate.

Recommendation: support microphone input during speech with appropriate echo handling and explicit turn cancellation. Test interruption during playback and tool execution independently.

### 5. Desktop context can become stale — medium priority

`src/fastVoice.ts:314` sends only an app-name update when the foreground app changes, while listening. It does not refresh the document, media, dwell time, or presence context. Changes within the same app produce no update. Meanwhile, the system instruction asks for instant desktop answers without tools.

Recommendation: refresh compact context before relevant turns, or publish throttled changes to the meaningful snapshot fields. Include freshness information and distinguish unavailable state from confirmed absence.

### 6. Tool handling reduces the benefits of asynchronous calls — medium priority

`src/fastVoice.ts:707` executes calls within a received batch sequentially and sends their responses together. Independent slow calls can delay all results. Research tool waits allow 210 seconds; textbook tools allow 12 minutes. These are completion limits, not evidence of quick responses. The outer timeout wrapper rejects without cancelling its underlying operation, although web requests have their own abort timeouts in `electron/search.cjs`.

Recommendation: return independent results promptly, preserve ordering for dependent actions, and connect cancellation to the underlying operation where supported. Measure time to acknowledgement, first audio, first useful result, and final completion separately.

### 7. Connection warning handling is reactive — medium priority

`src/fastVoice.ts:395` changes the status on `GoAway`, but does not use its remaining time to plan a connection handover. Reconnection happens after close, with up to four retries.

Recommendation: use the warning to schedule resumption at a suitable turn boundary and test connection loss while tools are pending.

## Validation and limits

- Ran `node scripts/check_fast_research_recovery.cjs`: passed. It verifies simulated source failure recovery and keyword coverage for comparison requests.
- Executed an in-memory general-research probe: one verified source plus an empty answer produced `missingTopics: []` and `emptyAnswerNeedsMore: false`.
- Reviewed the existing `scripts/check_fast_research_conversation.report.json`, recorded September 30, 2026 at 01:01 Bangladesh time. Its three complete turns lasted approximately 10.2, 106.0, and 10.9 seconds; the research turn recorded 26 tool events and no diagnostics. This is a historical report, not a fresh live run or a distribution of latency measurements.
- No fresh microphone, live API, or desktop-action benchmark was run. Those remain necessary to measure audio interruption, answer quality, first-response latency, and reconnect continuity.

The strongest next step is to correct the research guard and prompt branching, then restore history and fresh desktop context. Afterward, measure real conversational latency and interruption behavior before changing models.
