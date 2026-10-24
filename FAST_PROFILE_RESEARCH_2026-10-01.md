# Fast profile investigation — October 1, 2026

Scope: current source, the user's pasted desktop session, existing local checks, and current Google documentation. Application code was not changed. The earlier FAST_PROFILE_RESEARCH.md is historical; several details have changed since that review.

## Assessment

Fast uses a suitable voice model. The strongest explanations for the reported problems are browser observation freshness, invalid action targets, weak enforcement of action outcomes, and conversation orchestration. A model replacement alone would not repair those paths.

## Model and session configuration

- `electron/live-auth.cjs:2` defaults Fast to `gemini-3.8-live`; GEMINI_FAST_MODEL can override it. The pasted log does not prove which override, if any, was active.
- `src/fastVoice.ts:200` requests a Fast token. The LOW argument is not a configured thinking level for Fast. Its connection config correctly omits thinkingConfig, enables audio and both transcriptions, and uses session resumption plus sliding-window compression.
- Google's model-specific guide describes 3.8 Live as the default for low-latency voice, supports asynchronous function calling, and says to omit thinking configuration. Async function calling defaults to NON_BLOCKING. Browser declarations do not specify behavior, so they inherit that default; this does not itself establish the cause of duplicate speech.
- Native audio chooses languages automatically; an explicit language code is unsupported. Restrict spoken language through system instructions. Orvix already requests Bangla, but that request does not guarantee accurate input transcription.

Sources: [3.8 Live model and migration](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live), [Live capabilities and languages](https://ai.google.dev/gemini-api/docs/live-api/capabilities).

## Findings tied to the pasted session

### 1. Page actions use the wrong kind of reference — confirmed

At 2:02:46, 2:02:51, and 2:03:58, typing or Enter uses a tab reference. `PC-Monitor-Test/extension/browser-background.js:341` requires an element reference for those actions and rejects its absence as stale_target. Here the error means an invalid target kind, not necessarily an expired element.

The schema separates target from args.ref but leaves args and ref optional across all actions. The system prompt explains element references, yet the model repeatedly violates the contract. Improve action-specific validation and error recovery. A Google search already has a dedicated browser_act(action=search,args={query:...}) path at browser-background.js:587, avoiding the type/click/Enter sequence for ordinary searches. For explicit typing, use the observed input reference and verify both its value and submission outcome.

### 2. Spoken completion is not enforced against action results — confirmed in log

At 2:03:58 Enter fails. After a successful observation, Orvix says at 2:04:05 that Enter was pressed and results are showing. There is no successful Enter retry recorded. Typing at 2:03:45 succeeds, but does not prove search submission.

`src/fastFlow.ts:45` already instructs truthful reporting. `src/fastVoice.ts:840` forwards results to the model; it does not independently validate the generated spoken completion claim. UI progress distinguishes dispatched and partial, but the model's audio can still contradict it. Track requested outcomes explicitly and derive completion reporting from verification. Consider explicit BLOCKING behavior for dependent browser mutations, while retaining async execution where useful; evaluate latency and acknowledgments before choosing a scheduling policy.

### 3. YouTube can accept old results after a new URL — confirmed code gap, likely log cause

`PC-Monitor-Test/extension/youtube-background.js:90` waits for the requested URL and accepts the first nonempty youtube-results response. `youtube.js:20` extracts whatever video rows currently exist and returns no query or navigation-generation identity. A YouTube SPA can update its URL before replacing old rows.

The Bangla Lofi search returns rankings in 151 ms, and the user reports different visible results. This supports the race explanation, but a fresh browser reproduction is still needed to establish the exact timing. Tie result extraction to the completed search generation and test a transition where the URL changes before rows update.

Results are also sorted by title-match score and numbered afterward. Therefore option 1 can differ from the first item on screen even with fresh data. Clarify whether numbered choices refer to screen order or ranked options. The collector only includes video renderers, excluding playlist renderers; this helps explain why a visible playlist was absent from its choices.

### 4. Spoken interruptions are prevented by the microphone gate — confirmed

`src/fastVoice.ts:162` drops microphone chunks unless listening, with no active tools, pending answer, or pending tool response. Echo cancellation, noise suppression, and automatic gain control already exist in audioEngine.ts. Handling a server interruption and cancelling browser jobs does not allow interruptions if speech never reaches the server.

Test real microphone interruption during speech and slow tools. Keep input available where appropriate, clear playback, and cancel affected work deliberately.

### 5. Intent drift and language instability — observed, exact cause unresolved

The user repeatedly asks for a browser search for open code; Orvix switches to desktop Code, Command Prompt, Windows search, and editor updates. This occurs within one connected conversation, so missing saved-history restoration alone cannot explain it.

Unexpected multilingual input transcripts may reflect recognition mistakes; the audio is unavailable. Replies also mix Bengali and Hindi despite the Bangla instruction. `languageForText` can classify any ASCII utterance of four or more words as English, even without an explicit switch, conflicting with the prompt's explicit-switch rule. That heuristic governs local language state; it is not a direct input-recognition setting.

### 6. Initial companion mismatch and later service failure are separate

`electron/youtube-control.cjs:146` reports update_required when the connected companion lacks the new browser protocol handshake. Authentication alone does not establish browser-tool compatibility. Subsequent browser actions succeed after reconnect, so this initial failure did not persist throughout the session.

The final 1011 service-unavailable close is recorded, but its underlying cause is unknown. Fast attempts reconnection with backoff; the pasted log ends before showing the result. GoAway currently only changes status and ignores timeLeft; use it to prepare session handover. Google's session guide documents resumption and advance GoAway notice: [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

## Additional current-source findings

- Fresh Fast connections never send saved history, although the constructor receives it. Server resumption is a separate mechanism.
- Desktop updates now send the full compact context when foreground app or browser state changes. The previous report's claim that only an app name is sent is outdated. Same-app document changes and other fields still do not independently trigger updates.
- `beginTextResearch` supplies comparison-specific instructions to general research too.
- `missingFastResearchTopics` has no checks for general research's default required topics. An in-memory probe with objective “Research desktop assistants,” one verified source, and an empty answer returned missingTopics=[] and needsMore=false. Requests containing recognized topic keywords may still trigger checks.
- Tool calls inside one received batch execute sequentially and responses are sent together. Separate incoming batches can overlap. Independent slow tools can delay results; preserve ordering for dependent browser actions.

## Validation and next priorities

Passed existing checks: check_fast_browser.cjs, check_fast_research_recovery.cjs, and check_youtube_control.cjs. These use mocks and do not establish live microphone quality, generated answer honesty, or YouTube SPA freshness. The browser check tests cancellation machinery, not successful spoken barge-in.

Priority: (1) reliable action outcomes and element-target recovery; (2) fresh YouTube results and consistent choice ordering; (3) microphone interruption and explicit language-switch handling; (4) research guard/prompt branching, history restoration, and reconnection continuity.

No fresh paid API session, microphone recording, or live desktop mutation was run. No application fixes were made during this research request.
