# Orvix website design benchmark and reliability fixes

Status: six comparison attempts finished, final screenshots inspected, supplemental interactions checked, and the updated native route passed a separate live smoke test. Five agents completed. Luxury Fast timed out before delivering its final response; its saved page passed later browser checks.

## Results

| Brief | Fast agent time | Balanced agent time | Balanced critic | Outcome |
| --- | --- | --- | --- | --- |
| Luxury fragrance | 12m 56s, failed | 13m 22s | 91s | Both saved pages pass the specified desktop/mobile checks; Fast did not complete its final response. |
| Developer SaaS | 10m 12s | 11m 50s | 67s | Both completed and pass the specified checks; actual Monthly/Annual/Monthly price changes also pass. |
| Art-director portfolio | 6m 20s | 12m 33s | 43s | Both completed and pass the specified checks; All restores both project categories. |

All six saved sites pass the specified interaction assertions at both viewports, with no detected horizontal overflow, broken images, browser errors or automated accessibility violations in those captures. This does not upgrade luxury Fast's failed agent completion. All three Balanced critics approved with minor comments; **none triggered a revision**. Consequently this batch does not measure revision speed or establish a causal quality improvement from independent review.

The completed runs took about 6–13 minutes, with first previews at about 5–9 minutes. SaaS Fast was 98 seconds faster than Balanced; critic time accounts for 67 seconds of that difference. Portfolio Fast was 373 seconds faster, but only 43 seconds were critic time: differences in builder work, output and provider conditions dominate the rest. The Balanced portfolio generated four project studies, versus Fast's two. These stochastic output differences prevent treating mode alone as the cause.

Fast is not a guarantee of lower reported token usage: SaaS Fast reported 437,676 tokens versus Balanced's 323,727. Portfolio Fast reported 231,575 versus Balanced's 569,631. Luxury Balanced reported 400,612; luxury Fast usage was unavailable. Full stage figures and tool interval measurements are in the generated report.

## Recommendation from the evidence

Keep the existing model choices and review defaults. Use Fast for small iterations where current screenshots and a focused interaction check are sufficient; use a bounded Balanced critique when independent feedback is valuable for a substantial new design. This is a practical policy, not a statistically proven quality winner. Do not add unlimited automatic polishing passes or promise "premium every time" from critic approval.

The next highest-value addition is a **project-specific reference and asset workflow**, followed by an explicit model comparison using the same briefs:

1. Capture a short design brief with audience, main action, composition, type roles, imagery and mobile ordering. Select references for those qualities rather than copying a whole page.
2. Inspect supplied logos, photography, product material and visual references before building. Identify which visual needs an original asset. Keep factual claims grounded in supplied content; avoid unsupported popularity badges.
3. Build one coherent candidate. Inspect a readable hero and the complete desktop/mobile page, including states hidden by filtering. Check small-screen insets, wrapping, image quality and action visibility as well as overflow.
4. Use one independent critique where appropriate, prioritizing concrete material issues. Revise once in a coherent batch and inspect fresh evidence. Keep optional minor preferences separate from delivery blockers.
5. Benchmark available image-capable models explicitly for page quality, malformed tool calls, first preview, completed latency and aggregate usage. Prefer evidence over a model name or the assumption that a "Fast" mode is instant. Preserve user-selected routing.

The visual evidence supports this priority: fragrance illustrations are flat and repetitive; luxury Balanced's mobile content touches the screen edge despite approval; both SaaS pages invent popularity badges; the portfolios have coherent graphic art but reuse warm paper/ink/italic-serif decisions and elementary geometry. The sites are useful demonstrations with different compositions, but do not prove consistent premium finish or global originality.

## Validation of the fixes

- **43/43** targeted transport, preview lifecycle, browser, native handoff and design-review tests passed.
- **98/98** broader agent regression checks passed.
- Real managed-server lifecycle: **872ms** observed startup, **0ms** same-process reuse, cleanup passed.
- Updated native API + managed preview + actual desktop/mobile interaction smoke: **passed in 39.1s**, including final reply retrieval and preview cleanup. [Live result](<~/Desktop/Orvix-Project-v2/scratch/website-native-smoke-KT1K11/result.json>)
- Final cleanup audit: all **14 recorded preview URLs were unreachable**, and no OpenCode process remained. [Audit](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/cleanup-validation.json>)

The 39.1-second smoke is an inspection-only fixture, not a new website build. It validates the updated native path, not a before/after reduction of full-site generation time. Large-generation latency after the final fixes still needs a matched repeat to quantify any speed change.

## What this experiment measures

Three fictional briefs—AUREL fragrance, Signaldesk incident diagnosis, and Mira Sen art direction—each start from the same empty HTML page, package manifest and local server. Each brief is run once in Fast and once in Balanced with identical prompt hashes within its pair. Order is counterbalanced: luxury Fast first, SaaS Balanced first, portfolio Fast first.

The explicitly selected test model is `opencode/longcat-2.5-preview-free`, with its advertised `low` thinking variant. The catalog was refreshed before the batch. User model selections and defaults were not changed. A page is a small plain HTML/CSS/JavaScript demonstration, targeting about 200–350 lines and 20KB of text source, without framework installation or supplied reference assets.

Each run has a 15-minute watchdog. Agent time ends when the native engine returns or fails; supervising browser captures occur afterward and are excluded from agent time. First preview is the first recorded completed preview call, not a guarantee that every requested interaction already passed. Token figures are provider-reported aggregate usage across calls, including repeated input context; they are neither a single prompt's size nor account billing totals. Missing usage remains unavailable.

OpenCode's [v1.18.35 usage normalization](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/session/session.ts#L321-L357) separates visible output and reasoning and splits cached input from uncached input. Orvix reconstructs inclusive input and prefers a supplied total, summing normalized categories only when the total is absent; it retains one latest usage value per message.

The independent host serves each final source separately, captures desktop at 1440px and mobile at 390px, checks the exact requested interaction assertions, overflow, broken images and browser errors, and records automated accessibility findings separately. The supervising assistant inspects actual hero and full-page screenshots. A mobile viewport is a browser simulation; visual judgment is not a blinded human-panel result.

## Evidence

- [Complete run data](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/results.json>)
- [Generated report with desktop/mobile screenshots](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/report.md>)
- [Qualitative screenshot assessment](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/visual-assessment.json>)
- [Saved-source checks after failed agent completion](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/artifact-validation.json>)
- [Supplemental actual pricing assertions](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/pricing-validation.json>)
- [All-filter restoration and complete portfolio captures](<~/Desktop/Orvix-Project-v2/scratch/website-design-benchmark/2026-10-09T20-02-50-518Z/portfolio-validation.json>)

Passing checks establish the supplied assertions only. They do not establish cross-project originality, complete accessibility, working production backends, or a premium aesthetic. Failed agent completion remains failed even when saved source passes later browser checks. Balanced's independent critic can approve with minor issues; its approval is not a guarantee. After a revision, `reinspected` means fresh builder evidence, not a second independent approval.

## Fixes prompted by observed failures

### Long native submissions

A diagnostic synchronous native call failed after roughly five minutes before delivering a page. This is consistent with the HTTP client's default response-header timeout, but the diagnostic did not preserve an exact timeout cause code. Native submissions now use the official asynchronous endpoint, wait for session-scoped completion events, and retrieve the authoritative response. Cancellation still aborts and deletes the native session; work is not replayed.

The comparison batch used asynchronous submission but still loaded the older whole-session message retrieval with a 15-second limit. Its luxury Fast attempt later timed out after source and browser work. The improved implementation retrieves the observed final assistant message by ID with a 30-second request limit, avoiding a full history transfer. This targets a plausible retrieval bottleneck; the generic failure alone does not prove its precise endpoint cause.

The API behavior is documented by the [official OpenCode server reference](https://opencode.ai/docs/server/). The response-header default appears in [Undici's client implementation](https://github.com/nodejs/undici/blob/main/lib/dispatcher/client.js).

### Preview startup

The comparison's older preview helper returned after a fixed 3.5 seconds without an observed URL. One agent guessed a port, got a refused connection and recovered by inspecting the server process. The updated helper waits for an observed loopback URL, reports `ready`, `starting` or `stopped`, returns the URL explicitly, and reuses an identical managed command/directory. It rejects remote/lookalike/credential URLs and stops only its owned process on cancellation or turn cleanup. Instructions explain the actual native tool names, readiness states and URL reuse.

Inspection guidance also asks for the complete initial or restored page when an interaction hides content. A screenshot of a filtered project list does not approve the projects that it hides. This is instruction guidance, not a claim that all future agents will follow it.

An isolated real server started in **872ms**, reused the same process in **0ms**, and became unreachable after cleanup. This proves that fixture's lifecycle, not that every framework will start in 872ms. The current six-way comparison was already running when this fix was made and retains the old preview implementation; it is not a before/after performance study.

### Design scope

An exploratory run exposed a scope-filter regression: a full build containing a discover button and the phrase "Report only observed results" incorrectly skipped design review. The filter now recognizes adjacent narrow-edit requests rather than unrelated words anywhere in the prompt. The corrected six-way batch includes that fix. Earlier affected runs are excluded from valid mode comparisons.

## Diagnostic attempts retained

- `2026-10-09T19-34-15-338Z`: LongCat default; synchronous request failed, next attempt interrupted for transport repair.
- `2026-10-09T19-44-02-780Z`: MiMo Flash; first attempt reached the seven-minute diagnostic watchdog without a delivered page, next interrupted to test a focused configuration.
- `2026-10-09T19-52-38-537Z`: LongCat low; one functional luxury page returned in 417 seconds, but review scope was invalid for a Fast/Balanced comparison. Next attempt interrupted to fix scope and preview instructions.

These are diagnostic attempts, not omitted successes or valid model rankings. Their projects and records remain under `scratch/website-design-benchmark`.

## Reproduction

```powershell
npm run benchmark:website-design -- --model=opencode/longcat-2.5-preview-free --variant=low
npm run report:website-design
npm run check:preview-server
npm run check:preview-server:live
npm run check:website-design:native:live
```

The live model must still be present in the verified image-capable free catalog. There is no silent fallback. Optional `--case=luxury|saas|portfolio` and `--mode=fast|balanced` filters create a new isolated batch. Provider calls can be slow; the six-way run is intentionally sequential.

## Limits on interpretation

One attempt per brief/mode cannot establish a statistical quality, speed or token winner. Free-provider queuing, model processing, communication, cold startup and local load are not independently isolated. One machine snapshot recorded 73% CPU load with about 3.3GB free RAM; it is not sustained-load telemetry. Time outside observed execution tools includes those factors and critic time, not just model generation.

This experiment uses one small stack and no supplied photography or visual references. The generated fragrance bottle illustrations expose an asset-quality ceiling. More instructions, more effects or more review passes do not by themselves solve that ceiling.
