# Fast profile: ten-turn conversation review

Ten substantial research turns completed with real Gemini Live and the production FastVoiceSession. Every turn triggered model function calls and delivered a final reply. Topics included Florian BD identity, electronics returns, groceries, transport, appliances, support, source audits, and a reusable comparison framework.

The completed chat contains 29 model tool calls, 51 public searches, and 121 page reads, including 16 non-ok page responses. Total turn time was about 13.4 minutes. Visible working acknowledgements arrived in 4–14 ms; first response audio chunks arrived in 1.7–23.2 seconds. The latter measures first audio, not guaranteed spoken acknowledgement.

Turns 1–6 completed in one Live session. The runner stopped during a controlled disconnect experiment. Turns 7–10 completed in a fresh session with the six completed user/assistant turns restored. This establishes a ten-turn logical conversation across sessions, not ten uninterrupted turns on one connection.

## Problems found and changes made

- The frontend searched the entire long request before the model could select useful queries. Research now reaches Live immediately, and the model chooses focused queries through real function calls.
- Follow-up queries reused earlier evidence. Query-specific caching now returns the requested query's results while retaining accumulated evidence for the final synthesis.
- Continuations could discard earlier answer sections or finish with a promise to do more research. Final text now retains the collected sections, and bounded continuation checks require findings or a concrete blocker.
- Current Bangladesh policy answers used foreign-market pages or old secondary reports. Country paths, country parameters, redirects, and requested original company sources now receive scope checks. Readable page text alone does not establish current policy.
- Numeric source aliases could link a claim to a different page in a later turn. Source IDs are now stable URLs; automatically appending every candidate page was removed.
- An English turn could override a later explicit Bangla instruction. The language selector now honors that instruction.
- Reconnecting an unfinished server interaction could stall. Recovery now opens a fresh interaction with retained task evidence instead of replaying the unfinished interaction or verified effects.
- A page-only check triggered an unwanted wider search after a rejected page. Explicit search prohibitions now block search execution; a completed scope explanation can finish without a readable source.

## Verification

- `npm run check:fast-reliability`: 87 passed, 0 failed, plus browser integration and synthetic Chromium audio checks.
- `npm run build`: passed. Vite still reports existing large bundle chunks.
- The latest real Live scope probe called `read_web_page` on the specified `/gh/en/` Uber URL, received `out_of_scope`, delivered a final explanation, and executed zero searches. See [scope probe report](check_fast_long_conversation.scope-fixed.report.json).
- A separate transport source retest completed after excluding old secondary reports. The final generic regional-path guard was verified by regression tests and the narrow live scope probe.

## Limits and remaining observations

The controlled fresh-session reconnect retest was blocked by Gemini's quota/billing response. Recovery state transitions passed regression tests; recovery under that live failure condition remains unverified.

These tests used typed prompts and counted response PCM chunks. They did not record a physical microphone or listen to speaker playback. Some responses repeated explanations, and the recorded model wording sometimes overstates what a failed identity search proves. The transcript is execution evidence, not independently verified business advice. Florian BD's identity was not established, so a responsible competitor comparison still requires a specific business link or confirmed name.

The ten-turn transcript predates the final narrow source and search-prohibition fixes; the follow-up reports document their verification. The aggregate topic audit is heuristic and does not prove factual correctness.

[Read the complete ten-turn transcript](fast-long-conversation-completed.md). [Inspect the aggregate report](check_fast_long_conversation.completed.report.json).
