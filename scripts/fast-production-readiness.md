# Fast profile reliability and acceptance

The latest pasted log exposed a search-routing gap: ordinary searches read the first two results without the research pipeline's relevance checks. The implementation now sends every model-selected web search through the same guarded pipeline, regardless of the user's wording.

## Changes

- Match query words rather than partial spellings, reject irrelevant indexed results before reading them, and enforce domain scope after redirects.
- Read a supplied domain directly even if it is absent from search results. This matters here: `florianbd.com` is readable and identifies itself as a Bangladesh plant nursery. The search index returned unrelated pages and missed the site. Retrieval of the site's statements does not independently prove all its business claims.
- Distinguish `no_relevant_sources` from provider `unavailable`, and preserve actual search failures in the evidence record. A failed lookup does not establish nonexistence or absence of a public footprint.
- Show when sources have returned and the reply is still being prepared. Log assistant-reply completion separately from whole-task success and record unresolved research criteria without logging the prompt.
- After 45 seconds without response activity, request a conclusion once using retained results. If another wait expires, show explicit incomplete status. Recovery blocks new tools and effects, respects active work/playback/user speech, and cannot affect a newer task.
- Deliver an already complete eight-city weather answer without asking the model to regenerate it. Each city must have weather data or an unavailable indication; merely listing names does not pass coverage.
- If Live returns reply text without audio, request the existing reply aloud once. Tools cannot run during that retry. A second missing-audio result remains interrupted delivery and shows an error instead of claiming complete delivery.

The 45-second threshold and one-retry limit are application choices. Google documents that generation completion, turn completion, interruptions, and playback have distinct meanings, and that applications must handle tool responses explicitly: [Live API reference](https://ai.google.dev/api/live), [tool handling](https://ai.google.dev/gemini-api/docs/live-api/tools), [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

## Verification

- `npm run check:fast-reliability`: 94 passed, 0 failed, followed by browser integration, synthetic Chromium AudioWorklet cutoff, and real Web Audio drain checks.
- `npm run build`: passed. Vite still reports existing large bundle chunks.
- `npm run check:fast-services`: real public search/page/weather services passed. The supplied Florian BD domain was directly read, unrelated Hurricane/NASA results were rejected, official Daraz Bangladesh pages were read, and eight weather-city lookups succeeded.
- A real six-turn Gemini Live conversation completed every turn with model tool calls. It exposed the supplied-domain miss and unnecessary weather regeneration, which were then fixed. The run is diagnostic evidence, not a clean final acceptance result: [six-turn transcript](fast-long-conversation.production-retry.md).
- A first targeted retest confirmed the domain fix and Bangla country-scope check but detected a text-only weather reply incorrectly counted as complete delivery. That finding drove the missing-audio fix: [diagnostic retest](fast-long-conversation.production-final.md).
- Final domain and Bangla checks passed with response audio. A final weather retest passed after fixing coverage of grouped readings such as "Rajshahi and Khulna ... 26.7 and 27.3 degrees, respectively." It executed eight lookups, delivered audio, and avoided an unnecessary summary repeat. This turn took 60.3 seconds; the earlier diagnostic weather turn took 166.7 seconds. These are individual runs, not a controlled performance benchmark.
- The final targeted acceptance combines those successful checks from their original reports and validates the weather text with the latest coverage guard: [acceptance summary](check_fast_production_acceptance.report.json), [domain/Bangla transcript](fast-long-conversation.production-delivery.md), [final weather transcript](fast-long-conversation.production-weather.md). The domain/Bangla transcript also preserves an intermediate weather failure that prompted the grouped-reading correction; it is not a clean whole-run acceptance result.

The first Live startup attempt hit a provider quota limit; a later attempt connected. No quota or billing settings were changed.

## Test scope

The conversation tests use real Gemini Live, production FastVoiceSession, real web/weather services, typed prompts, and counted response audio chunks. They do not test a physical microphone, audible speaker output, Bangla pronunciation, or a rebuilt installer. The bounded silence-recovery and repeated missing-audio failure paths are covered by regression tests, not deliberate live outage injection. The earlier controlled reconnect failure still lacks a successful live retest.

Business answers remain model-generated research; successful delivery and readable source pages do not establish factual accuracy of every comparison claim. These tests support the identified reliability changes, not a guarantee of zero bugs or a full release certification.

Restart the desktop app to load the rebuilt frontend. Repeat the public-service check with `npm run check:fast-services`; repeat the six-turn Live acceptance with `npm run check:fast-live-conversation`. Acceptance failures exit with a nonzero status.
