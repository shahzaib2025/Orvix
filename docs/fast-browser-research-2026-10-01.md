# Fast browser reliability research

Reviewed October 1, 2026, Asia/Dhaka. Scope: false completion claims, stale YouTube search results, and invalid browser target types in the supplied desktop log. Application code was not changed. Findings combine current source inspection, official Google/Chrome documentation, existing offline checks, and in-memory probes. No live model, microphone, or browser benchmark was run.

## Conclusion

These problems cross three layers: model-generated tool arguments and speech, application validation and response handling, and extension page readiness. Changing voice models alone would not repair the reproduced validation and readiness gaps.

Fast defaults to `gemini-3.8-live` in `electron/live-auth.cjs:2`, unless overridden by the environment. The log does not establish the effective runtime model. Google's model-specific guide supports asynchronous function calling and requires omitting thinking configuration; the current Fast setup follows that guidance. Tool execution and tool responses are still the application's responsibility.

Sources: [Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live), [Live tool handling](https://ai.google.dev/gemini-api/docs/live-api/tools).

## 1. Success claimed after Enter failed

### Evidence

- At 2:03:45, typing succeeds. This establishes that the input value was entered, not that search was submitted.
- At 2:03:58, `browser_act(action=key)` targets a tab and returns `stale_target`, with `completionUnknown:false` and the message `An observed element ref is required for this page action.`
- At 2:04:00, `browser_observe` succeeds. Observation success does not establish that Enter was dispatched or that search results loaded.
- At 2:04:05, Orvix says it pressed Enter and results are showing. No successful replacement Enter call appears between the failure and that statement.

### Source trace

`src/fastVoice.ts:840–872` preserves and sends the failure result to the model. The browser failure is not converted into success there. `src/fastFlow.ts:45` explicitly prohibits claiming success for failed or unverified actions, and the progress formatter also distinguishes those statuses.

However, `src/fastVoice.ts:442–512` accepts model output transcription and plays audio without reconciling completion claims with browser action evidence. There is no application-owned browser task completion state controlling that speech.

An in-memory probe returned `stale_target` from a mock browser call, then injected a synthetic model message saying “I pressed Enter; results are showing.” The handler accepted that message as a final transcript. This proves the missing application guard; it does not measure how often the live model produces the claim. The supplied log supplies the actual contradiction.

### Recommended fix

Track execution, verification, and observation as separate facts associated with the current browser task. A page observation must never overwrite the recorded failure of an action. Require an observed search outcome before declaring submission complete.

For completion statements that need a hard guarantee, use an application-controlled confirmation path tied to verified results. A stronger prompt is useful but already exists here and did not prevent this incident. Filtering the displayed transcript after audio has played would not repair the spoken claim.

On a rejected action with confirmed no effects, obtain the required element and retry within the same task. For uncertain actions, inspect their effects before considering a retry.

## 2. YouTube accepts old results after the URL changes

### Evidence and reproduction

The log repeatedly shows a new search ranking titles associated with the preceding query, in 151–451 ms. At 1:57:50, the user also reports different items visible on screen.

`PC-Monitor-Test/extension/youtube-background.js:192–199` checks that the tab URL contains the requested query, then collects results. `waitForPage`, at line 89, accepts the first nonempty result list. The content script's `youtube-results` response contains titles and URLs, without a search generation or readiness marker tying that DOM content to the submitted query.

An in-memory probe using the existing YouTube test harness provided old DOM results while the tab URL changed to `search_query=NEW%20lofi%20query`. The controller returned `needs_selection` with the two OLD titles. This reproduces the acceptance gap. The exact timing of the original live DOM transition remains unmeasured.

Chrome documents that history-state updates can occur after the initial document loads, and that navigation commitment does not imply all resources finished downloading. Inferring fresh results from a new URL is therefore insufficient. [Chrome navigation lifecycle](https://developer.chrome.com/docs/extensions/reference/api/webNavigation).

### Two additional sources of screen mismatch

`youtube.js:20` collects only `ytd-video-renderer` rows, excluding playlist renderers. The user's first visible playlist can consequently be absent even with fresh extraction. The controller then sorts videos by match score rather than preserving screen order. “First returned option” and “first visible item” are different concepts in this implementation.

### Recommended fix

Associate searches with a request generation. Wait for evidence that the result container has updated for that generation, then return the matched query, readiness evidence, and a fresh result snapshot together. URL equality, a fixed delay, or disappearance of old IDs alone are inadequate: valid successive queries may overlap in videos.

Support playlist extraction, or clearly describe the result list as video candidates. Preserve visible order when the user asks what is on screen; keep relevance ranking separately labeled. If readiness cannot be established, return an explicit unverified/timeout result rather than old options.

## 3. Typing and Enter use tab references instead of element references

### Evidence and source trace

The requests at 2:02:46, 2:02:51, and 2:03:58 target `...:tab:847184574` for `type` or `key`. The errors explicitly report a missing observed element. This is an invalid target type, not evidence that the target simply expired.

`electron/browser-protocol.cjs:5` checks argument types and allowed actions but does not require an element reference for these actions. An in-memory probe confirmed both requests pass desktop validation.

`browser-background.js:452` normalizes element targets into `args.ref`. `pageAction`, at line 338, resolves that reference; line 355 rejects page actions without it. For Enter, the valid element is focused before the key is dispatched. The extension correctly refuses the invalid requests.

The shared tool schema has one broad action enum and one target description covering tabs, windows, groups, and elements. It describes the element requirement in prose, but the schema cannot enforce the action-dependent relationship. The current system prompt also lists many browser capabilities together. This is a plausible contributor to argument mistakes, not a measured causal attribution to prompt length.

### Recommended fix

Add action-specific validation: `type` and `key` require an observed element reference; tab management accepts tab references. Distinguish `invalid_target_type`/`missing_element_ref` from genuinely stale references so recovery follows the actual cause. Do not silently guess a page control.

Clarify the tool contract with compact valid examples or separate page-input declarations. After a valid typing result, reuse its fresh search-input reference for Enter and verify the resulting search page. For a general “Google search for X” request, the existing `browser_act(action=search,args={query:X})` implementation avoids typing and key dispatch altogether. An explicit request to press Enter should still use the appropriate element.

## Validation and implementation order

Existing checks passed: `check_fast_browser.cjs`, `check_youtube_control.cjs`, and `check_fast_research_recovery.cjs`. These do not test the three failure scenarios above. The browser check's interruption test invokes cancellation directly; it is not a live speech test.

Implement result-backed completion handling and target validation first, then YouTube readiness and visible-order handling. Add focused regression coverage for:

1. Failed Enter followed by successful observation cannot establish submission.
2. A new query URL with old DOM results does not return those results as fresh candidates.
3. Tab-targeted type/key calls are rejected before extension dispatch with an actionable target-type error.
4. Valid element-targeted Enter completes only after its expected search outcome is observed.

Finally, repeat the original Bangla/romanized-Bangla voice sequence against the running app and measure successful actions and truthful spoken confirmations separately. Offline probes establish the code gaps, not post-fix live reliability.

## Follow-up: researched implementation design

The following is a proposed design, not implemented or live-validated behavior. Reviewed October 1, 2026 following the request to research the fixes.

### Target validation and recovery

Keep the current two-tool interface initially. Add action-dependent validation in `electron/browser-protocol.cjs`, with the extension retaining final authority over whether a reference still exists. Validate the reference category before dispatch, not merely whether the target is a string. Accept either an element in `target` or `args.ref`; reject conflicting references. If a tab target is supplied alongside `args.ref`, retain the extension's check that the element belongs to that tab.

Do not require an element for every page-related action: the existing viewport-scroll branch intentionally permits scrolling a tab without a control reference. Define a per-action contract. At minimum, type requires an element and text; key requires an element and an allowed key. Use separate errors for missing reference, wrong category, malformed reference, and an observed reference whose document or element is no longer available.

Recovery should preserve the user's pending objective. For a rejected type/key request with no effects, inspect the intended page, obtain the matching editable element, and retry that operation once. Do not convert a tab into an arbitrary first input. For unknown completion, inspect the current outcome before replaying input.

Google recommends explicit tool invocation conditions and concise prompts. Add a short valid type/key sequence to the tool instructions, but rely on runtime validation for enforcement. [Live API best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices).

### YouTube: use a reliable new-document path first

A request ID correlates messages; it does not establish that the page content belongs to that request. Similarly, a MutationObserver firing once can reflect an unrelated animation or advertisement. Require evidence from the relevant results container, not any DOM mutation or a generic quiet period.

The most practical initial fallback for this implementation is deliberate full navigation to the requested results URL:

1. Register navigation tracking before dispatch and record the existing main-frame document identity.
2. Navigate to the requested query; reload deliberately when a fresh same-query lookup would otherwise keep the same document.
3. Wait for a new main-frame document with the expected query. Reject or restart observation if the user navigates away.
4. Send result-reading messages specifically to that document, rather than whichever document now happens to occupy the tab.
5. Wait for visible readable result rows or a recognized completed empty-results state. An empty list during loading is not a completed empty search.
6. Return query, request generation, document identity, URL, and collection time with the snapshot. Invalidate candidate choices after intervening searches/navigation.

Chrome supplies a document identity that changes across new documents, and `tabs.sendMessage` supports selecting that identity. The project already uses document IDs for generic page operations; its minimum Chrome version is 125, above the documented Chrome 106 introduction of document-targeted messaging. [Document lifecycle](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [Document-targeted messaging](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage).

This addresses the demonstrated old-document/old-DOM acceptance race, but does not prove relevance or completeness of every YouTube result. It may take longer than soft navigation. Measure the latency difference before introducing an optimized SPA path. Such a path needs a tested results-generation signal; undocumented YouTube navigation events should not be its only evidence. Chrome demonstrates observing relevant content changes for SPA navigation, without claiming that every mutation proves readiness. [Chrome SPA content-script example](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab).

### Speech: separate practical improvement from a hard guarantee

Set `behavior: BLOCKING` on the Fast browser action declaration if the desired behavior is to wait for action results before continuing model output. Apply this deliberately in Fast's connection setup; do not change shared declarations across other profiles without checking their intended behavior. Current Gemini 3.8 Live defaults to asynchronous tool calling and explicitly supports blocking declarations. This reduces premature narration but cannot guarantee that the model correctly interprets a failure afterward. [Model-specific function behavior](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live).

Maintain an application-owned ledger per browser task and action. Observation success means a page was read. Input verification means the requested value was entered. Workflow verification means submission or another requested outcome was observed. Keep those facts separate. For Google search, establish the expected query URL and a result-page condition; suggestions in an input are not search results. The existing generic URL expectation uses exact equality, so any richer query/DOM condition requires an explicit verifier change.

Change the `browser_observe` progress wording from “Browser result verified” to “Page inspected.” A new in-memory probe confirmed the current formatter reports the former even for an observation with no action verification.

For a practical improvement, include the ledger's allowed completion facts in the returned tool result, suppress model audio while actions are unresolved, and keep correction prompts concise. Treat this as a reduction in false confirmations, not elimination.

For a hard guarantee in browser task confirmations, the application must own the words and audio emitted for those confirmations, selected from verified ledger states. During that controlled task phase, unrestricted model-generated completion audio cannot also be allowed through. A deterministic spoken-status path would need implementation: the current code has PCM playback, but no dedicated template-to-speech path.

A new synthetic-message probe sent audio before output transcription. Fast scheduled the audio immediately, then accepted “I pressed Enter” as the final transcript. Therefore, transcript filtering at the end of a turn cannot reliably prevent the spoken false claim. Buffering or controlling the relevant audio before playback is necessary. Gemini 3.8 Live does not support structured outputs, so a schema-enforced spoken completion response is not an available replacement for this application logic. [Model capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live).

### Acceptance criteria

Validate delayed result-container updates, overlapping video IDs between successive queries, identical repeated queries, explicit empty results, manual navigation mid-search, playlist-first pages, and cancellation. Measure browser execution and spoken truthfulness separately. Preserve immediate neutral progress while waiting; do not buy perceived speed by accepting unverifiable results.

The follow-up added two offline probes (audio-before-transcript handling and observation progress wording). No live API calls, browsing actions in the user's Chrome, application changes, or fresh end-to-end benchmark were performed.

## Implementation update — October 1, 2026

The requested fixes are now implemented in the workspace:

- Desktop validation distinguishes invalid page target types and preserves confirmed no-effect failures. Viewport scrolling remains permitted with a tab target.
- Fast can recover a uniquely observed Google search control for typing, and targets the last successfully typed control for a following key request on the same tab. Unrelated or ambiguous controls are not guessed.
- YouTube searches load a fresh document, read through document-targeted messaging, wait for result rows, retain video candidates in page order, and reject choices after page changes. Playlists remain explicitly excluded. Companion version is now 0.3.1.
- Browser actions use blocking model calls. Completion text comes from the action results, independently of later observation success. Model confirmation audio is buffered until its transcript matches that text. Contradictory audio is withheld and replaced by the verified status using a local language voice if available, otherwise a visible status. Ordinary conversation still streams. This introduces a bounded delay for browser confirmations and is not an independent audio/transcript fidelity guarantee.
- Cancellation and stop clear buffered confirmations; late cancelled results cannot establish completion in a new turn.

Regression coverage includes wrong tab targets, Google control recovery, audio arriving before a false success transcript, valid confirmation playback after turn completion, delayed document commits/results, repeated searches, and invalidated candidate IDs. The browser suite, research recovery checks, and voice navigation checks passed. Build validation is recorded in the final task response.

Restart the workspace desktop app and reload its unpacked Chrome companion to activate both halves of the change. No packaged Windows installer was rebuilt, and no live microphone/API benchmark was performed.

## Testing update — October 1, 2026

The later testing request extended verification beyond the offline checks above:

- `npm run check:browser`, `node scripts/check_voice_navigation.cjs`, `node scripts/check_browser_live.cjs`, and `npm run build` passed. The live browser suite uses an isolated Chromium profile and the actual companion extension.
- `node scripts/check_fast_browser_acceptance.cjs --model` passed with the production Fast handler, actual Gemini Live API, and Chromium fixture pages. Gemini typed into an observed Google input, pressed Enter, and received verified results for both actions. Its confirmation transcript matched the deterministic completion text; all 16 confirmation audio chunks were admitted. This used text input and muted audio interception, not a microphone or listening evaluation. The report is `scripts/check_fast_browser_acceptance.report.json`.
- Testing exposed an additional verification gap: explicit keyboard requests could be replaced by a search shortcut, and an Enter without an expected outcome was merely dispatched. The Fast prompt now preserves explicit keyboard workflows. A `search_query` expectation verifies the decoded Google query, including equivalent space encodings, and Fast adds it after typing into a known Google search control.
- Public YouTube testing exposed a URL canonicalization race: the site rewrites `%20` to `+` while loading. The companion now reads again when the same document retains the same decoded query, while rejecting changed documents or different queries. A focused regression covers this race.

Public-site results are recorded separately in `scripts/check_fast_browser_acceptance.youtube.report.json`. These checks do not cover microphone recognition, Bangla spoken confirmation quality, or a packaged installer.

The final public-site run passed both consecutive queries, with different document IDs and correctly decoded query values. `Bangla Gaan` completed verified playback in about 24 seconds; `Bangla Lofi Song` returned choices in about 6 seconds. Search readiness now allows up to 20 seconds within the desktop's existing overall deadline, because the public-site run exceeded the earlier 12-second readiness limit. The current companion also supports playlist candidates; the Fast instruction now follows each returned option's kind instead of assuming playlists are always excluded.
