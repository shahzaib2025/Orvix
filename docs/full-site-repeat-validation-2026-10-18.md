# Two fresh Default websites: repetition test

Result: the live test did not meet acceptance. The two rendered heroes remain substantially similar, and neither native builder completed its final handoff within the 25-minute experiment limit. Both sites were saved and inspected independently without repairing their source.

## Conditions

Both tasks used Orvix's real native OpenCode route, `opencode/mimo-v2.6-flash-free`, default reasoning, requested temperature 0.7, the same full-website brief and Default profile, with visual review off. Each had a fresh task, worker, native session and Desktop folder. They shared one isolated engine memory directory so task two could receive task one's sanitized design history. No prior experiment source, screenshots or private application chats were supplied. The first catalog request timed out; one retry succeeded, and the provider returned the requested preflight marker.

Both builder prompt audits show the same system hash and 68,631 total characters, with the same six full skill instructions. Request traces establish requested temperature, not the provider's actual sampling internals. The comparison lane uses provider-default sampling rather than the build-temperature override.

## What actually happened

- Site 01 reached the experiment cutoff at 1,500.295 seconds (25m 0.295s). It saved six content sections and performed browser previews and corrections, but delivered no final handoff. Two preview requests failed because of an excessive settling delay and a non-unique motion selector. Provider connections dropped twice and were retried. Its final fresh desktop observation remained eligible after the stopped run; earlier mobile geometry became stale after edits.
- Site 02 reached the cutoff at 1,500.187 seconds (25m 0.187s). It saved HTML, CSS and JavaScript and passed JavaScript syntax checking just before stopping. It did not reach its own managed browser preview or final handoff.
- Site 02's real read-only comparator prompt contained Site 01's sanitized observed composition. Comparison was attempted with one prior design even though visual review was off. The comparison timed out at its existing 120-second bound. Its recorded result was `unavailable`, not `distinct`, with no confirmed rejection.
- Current policy allows construction after an unavailable comparison if no repeat was previously confirmed. Site 02 therefore continued with a similar proposed hero. This demonstrates a concrete failure path: history reaches the comparator, but timeout plus the permissive fallback does not reliably prevent repetition. It does not establish that a successful comparison would have accepted this candidate.
- Both tasks recorded zero visual critic reviews. The originality comparison is separate from those reviews.

## Visual comparison

Both heroes have large Fraunces serif copy on the left, a dark pill CTA below, angled paper/card media on the right, small coral accents, a white field and Inter supporting text. Site 01 uses drawn floral card artwork; Site 02 uses actual direct-URL photography and adds a central fold rule. The image treatment and words changed, but the expressive hero structure and typography remain close.

Supporting content does vary: Site 01 uses a three-card collection and centered writing process; Site 02 uses an occasion ledger, staggered process and large message examples. These are not byte-identical pages. That partial variation does not resolve the repeated-hero concern. Both are restrained editorial designs; neither is evidence of a distinctive MAX-style showcase, and MAX was not selected or tested.

## Independent browser results

Each finished set of saved files was served over HTTP and inspected at 1440x900 desktop, 390x844 mobile and desktop reduced motion. Both sites passed the primary dialog flow on desktop and mobile: open, Escape dismissal, reopen and close-button dismissal. All six views had no horizontal overflow, observed page JavaScript errors or broken images.

Site 01 had zero detected automated accessibility violations, with color-contrast results incomplete; this is not full accessibility approval. Site 02 had `color-contrast` violations on 17 nodes and a `link-in-text-block` violation on one node in each view, with some contrast checks also incomplete. Site 02 was not corrected after independent inspection.

The bounded readability probe found no initial-viewport failures on either site. During sampled scrolling, Site 02 produced occlusion findings against its fixed header (`#top`). Ordinary content passing behind a fixed header can trigger this check; these findings need contextual review and should not be presented as proof of permanently hidden content. Reduced-motion content was inspected. Scroll samples included forward/reverse positions; they do not establish every state or measured smoothness. Neither Default site implemented a pinned storytelling scene, so pinned progression/release is not a passing result from this test.

The inspector first jumped between coarse positions, which left some ordinary entrance-reveal elements unactivated in full-page screenshots. It was corrected to traverse intermediate viewports before capturing the final screenshots. Generated site files were not edited by the inspector.

## Limits and source caveat

No Google/Serper keys were supplied to this isolated test environment; this says nothing about the running application's configured keys. The second builder used available native web search/fetch and checked direct image URLs. Asset research and tool retries added substantial delay.

On-disk `electron/agent/opencode-agent.cjs` changed during the test (mtime 2026-10-18T16:07:04.545Z), so the overall `sourceUnchanged` audit is false. This test work did not edit that production file. Both tasks ran in the same Node process, whose engine requires that module at initial load, and their delivered builder system hashes/full skill bundles matched. The caveat remains recorded; no claim of a frozen workspace is made.

Conclusion: instruction/history delivery works in this sample, but end-to-end repetition prevention is not reliable when comparison times out. Before expanding tests to Medium/MAX, address comparison availability and fallback behavior, plus excessive asset-search and preview-retry overhead. This was testing only: no production fix or manual redesign was applied during the experiment. Two samples from one model and subject cannot prove universal uniqueness.

Open `comparison.html` for the screenshots and site links. `generation-report.json`, `inspection-report.json` and `summary.json` contain the recorded details. The 25-minute bounds are experiment watchdogs, not evidence of Orvix's production task timeout.
