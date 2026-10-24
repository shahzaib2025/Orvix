# Fast research and browser follow-up fixes

Implemented against the reported GPT leak / Terra / “open the second one” conversation. No model names or release facts were hardcoded into answers.

## Changes

- Current and rumor lookups bypass the five-minute local cache and send a recent-date filter to Serper and its DuckDuckGo fallback. Explicit historical questions retain their range. Results retain retrieval time and provider publication metadata; undated sources remain undated. A filter is not proof that a result is current.
- Short model follow-ups retain publisher and subject references. The reported Terra → “Terra model er” → “GPT er” sequence scopes retrieval to the active model topic. Explicit new subjects, crypto requests, negation and unfinished input do not receive that shortcut. The inferred scope is a search hint, not evidence of product identity.
- Upcoming model requests include the current official catalog. Rumors also require an original-source read, within the existing bounded sequential tool loop. Old articles, social posts and videos must remain attributed and distinct from confirmed releases.
- Official-silence and “no recent updates” claims cannot be inferred from an incomplete lookup. Model-version matching also checks named variants. Access-challenge HTML is blocked evidence. Community forum posts on vendor domains do not count as official publisher confirmation.
- Named variants missing from the highlighted catalog can use its full documentation index, then published model links, within two additional reads. The OpenAI landing page's “View all” is a JavaScript button without a discoverable href; the official full-model index was separately fetched and checked. The Terra index entry and its specific documentation page were successfully retrieved.
- “Open the second one” uses the actual displayed source order and selects `browser_act` navigation with an expected URL. A background page read cannot substitute. Missing or ambiguous selections ask for the source. A blank tab or generic action acknowledgment cannot establish navigation success. Existing approvals, cancellation, tab reuse and action serialization remain in place.

Main code: `src/fastResearchContext.ts`, `src/simpleFastVoice.ts`, `src/simpleFastResearch.ts`, `src/fastResearch.ts`, `src/fastLatency.ts`, `src/fastResearchClaims.ts`, `src/fastBrowserRouting.ts`, `electron/search.cjs`.

## Validation

- `npm run check:fast-research-context`: 81 passed, zero failed. Includes both new regressions and existing research claims, reply content/language, tab routing and search-key tests.
- Real primary-source retrieval: highlighted catalog → full-model index → exact Terra model page succeeded. Publication and retrieval timestamps remain distinct.
- Captured-provider replay: all three unsafe Terra answers were withheld from original PCM and corrected by the current local guards. The current controller retrieved the full primary catalog for each replay. This uses captured model text, actual additional page reads and simulated speech; it is not another live-model conversation.
- Earlier broad `check_simple_fast.cjs` / `check_fast_latency.cjs` fixtures: 47 identical failing assertions were observed against both saved baseline and candidate during bounded 20-second comparisons. Both runs timed out; the broad suite is not passing. No additional failure names were observed in that comparison. Several assertions still describe previous acknowledgment/interruption behavior.
- Production build and TypeScript validation are recorded in `scratch/research-context-fix-20261022/build-final.log`.

## Live conversation limits

A five-turn typed conversation used the real Gemini Live connection and real public retrieval. This Node harness has no access to Electron's encrypted Serper store, so it used DuckDuckGo; it does not establish the installed app's Serper-key behavior. Audio was counted/scheduled in a fixture rather than played through physical speakers.

Four replies were produced: one completed through the simulated live-audio renderer and three fell back to visible-only delivery after voice-rendering timeouts. The fifth turn hit a Gemini Live 1011 quota rejection and the harness deadline. The first pass exposed an additional “no recent updates” claim; that defect was then fixed and replay-tested. The final changes have not completed a new live-provider conversation because of that quota failure.

Live browser focus, microphone input, audible playback and a packaged Windows build have not been accepted in this change. Do not call this a fully passing live release or promise fault-free research.

Evidence: `scratch/research-context-fix-20261022/targeted-final.log`, `baseline-comparison.json`, `primary-sources.json`, `live-answer-replay.json`; original typed run: `scratch/simple-fast-live.research-context-20261022.report.json`.
