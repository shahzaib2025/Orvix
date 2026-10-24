# Agent research accuracy — 2026-10-06

Research now retains original source evidence and requires the final answer to match that evidence before research acceptance criteria become supported. Search excerpts are candidates, not independent rankings. Missing search results cannot establish that a business or its published information does not exist.

## Changes

- Reject unrelated entity/domain search results and label location evidence honestly.
- Detect HTTP errors, access challenges and soft not-found pages. Unavailable retrieval cannot count as successful evidence.
- During a search-provider cooldown, use retained sources or direct page reads instead of repeating blocked searches.
- Preserve source request IDs across follow-ups. Support records retain provenance; they do not independently complete the final-answer requirements.
- Check source excerpts locally before review. Permit whitespace differences while retaining the original source span; reject changed wording or invented numbers.
- Give the independent final reviewer actual fetched text and require criterion-to-source-to-answer mappings. Reviewer failures and missing mappings leave requirements pending.
- Repair malformed review JSON once with its validation error. Keep raw review evidence for diagnosis.
- Request proportionate research plans and concise evidence anchors, avoiding unnecessary audits and repeated per-source behavior reviews.
- Emit an acknowledgement supplied by the model instead of a generic coding-work sentence.

## Live evidence and limits

The read-only live probe used DeepSeek V4.1 Flash and actual Florian BD pages. Its answer identified the website, named published offerings and labeled seller marketing as independently unverified. The original run took about 136 seconds. A later independent review of that saved answer against the fetched sources validated all five acceptance criteria in about 109 seconds; it did not repeat the complete user workflow.

Reports are under `benchmarks/.runs/research-final-VNxOz0/`: `report.json` records the original run and `review-recheck-2.json` records the later review. This verifies a specific answer, not an independent ranking of nurseries or guaranteed accuracy across all future tasks. Search-provider blocking and model latency remain external limitations.

## Regression checks

`npm run check:agent` includes research cases covering unrelated hits, Bangla sources, paginated evidence, fabricated quotes, schema repair, cross-turn provenance, false HTTP success pages, final-answer coverage and provider cooldown. `scripts/check_agent_precision.cjs` also checks that cancellation recovery retains completed work and that the acknowledgement uses the supplied model text.

Final validation: all 74 agent checks passed; `npm run build` passed; all 23 Fast grounding checks passed after the shared search changes. The build retains its existing large-chunk advisory. A concurrent build/test run hit the Windows inspector timeout; that check passed independently and in the final complete suite.

Restart the desktop process to load the changed Electron backend.

## Greeting and latency review — 2026-10-07

The agent recognizes a standalone yo as casual conversation. That path skips workspace discovery, acceptance planning, evidence recording and completion review; it makes one model request with no tools and forwards streamed text deltas to the Agent page. The conversation instruction now asks the model for a short relaxed greeting and prefers “Yo!” over a formal self-introduction. The words remain model-generated.

The saved Florian BD run took 136,267 ms overall. Its five network retrieval tools took 2,816 ms combined, its two execution-map tool calls took 31 ms, and its two source-support writes took 32 ms. Those nine recorded tool operations account for about 2.9 seconds. The remaining time is in unmeasured model turns and application overhead; this report does not contain per-model-call timings, so it cannot assign the full delay to one provider request. The independent review of the saved answer took 108,878 ms by itself. These measurements show the local evidence writes were not the bottleneck in that run.

The latency review follows the general LLM guidance to reduce sequential model requests, generate concise answers, and stream output so users see the first text earlier. The cited OpenAI guide is general engineering guidance; its provider-specific latency numbers do not apply to Orvix's OpenCode/DeepSeek route: https://developers.openai.com/api/docs/guides/latency-optimization.

The next useful performance change is per-request timing for model calls: purpose, model/provider, time to first token, total request time and token counts, correlated with existing tool durations. Then optimize the slowest measured phase while preserving source and completion checks for substantial work. No live provider test of the new Yo wording has been run.
