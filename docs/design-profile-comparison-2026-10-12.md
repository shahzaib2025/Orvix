# Default / Medium / MAX — controlled Orvix comparison

## Result

The selected skills reached the correct sessions. MAX produced the most content and motion; Medium produced the cleaner restrained presentation; Default retained a conspicuous desktop heading collision. The three outputs are different implementations, but all independently chose a monochrome photographic notebook/contact-sheet identity and a broad left-text/right-image desktop opening. The profiles changed ambition more reliably than they changed the underlying creative idea.

This is evidence from one subject and one model, not proof that every model or future task repeats layouts. No instruction change can honestly guarantee universal uniqueness.

## Controlled setup

- Production Orvix engine and native OpenCode execution, not a Codex-written replacement site.
- Same selected model: `opencode/space-bunny-free`; same reasoning: `medium`; same fast review policy.
- Identical FIELDNOTE photography/print-studio brief, white theme, direct Google-sourced image URLs, responsive/reduced-motion requirements and local-only inquiry action. Brief SHA-256: `8a6298346046227a4363eaa9c508a65b78b7cc4a809659cf2597725fce09432e`.
- Only selected profile and destination folder differed. Each case had a fresh engine/runtime root and session; the controlled cases did not share previous case chats or recent-design notes. Consequently this tests profile behavior with isolated context, not the ordinary app's full historical diversity policy.
- Source inspection and recorded read tools confirm Default loaded `website_design`, Medium loaded `website_design_medium`, and MAX loaded `website_design_max` plus its motion implementation reference. No cross-profile skill read was observed.

Desktop folder: `~/Desktop/Orvix-Three-Design-Comparison-1791804176120`. The three launchers serve the sites over HTTP, preserving module/security compatibility.

## Original three-run comparison

| Profile | Time | Developed section groups | Actual treatment | Main weaknesses |
| --- | --- | --- | --- | --- |
| Default | 9m 00s | 5: opening, commission log, gallery, print detail, inquiry | Narrow identity rail, large photograph, ruled notebook structure, light CSS/vanilla-JS effects | Brand heading spills beyond its rail and is covered by the photograph. Mobile return-to-top anchor partly obscures the heading under the header. Repetitive rail/content pattern and large image-driven length. |
| Medium | 11m 16s | 6: opening/contact sheet, work, prints, process, site explanation, inquiry | Cleaner type hierarchy, framed photograph, selectable plate index, gallery viewer, developed print/form content | Similar broad creative idea to Default. Excessive concept/demo explanation. Repeated invalid preview requests, early form crash and image/alt problems; some repaired. Final checks stale after later edits. |
| MAX | 8m 15s | 10: opening, position, commissions, work, process, prints, selected-frame scene, sizing, questions, inquiry | GSAP/ScrollTrigger/Lenis, SplitText/DrawSVG, ambient hero treatment, two distinct pinned scenes and more detail | Similar broad opening/art direction. Supporting text motion less expressive than requested. SVG treatments concentrated in limited areas. Lenis cleanup error; nested endless hero child prevents practical parent cycling. Ran out of agent steps during verification. |

Navigation/footer do not count as sections. Counts describe developed content groups, not quality scores. Medium's "About this site" is less useful studio content than its gallery/process sections. A long document or more effects does not itself establish premium quality.

## Concrete AI and workflow problems

1. **Recurring art-direction choice despite correct routing.** All three chose black-and-white imagery, monospaced metadata and photographic record-keeping. The brief required a white theme, not monochrome media. Images and details differ, but changing effort or animation does not automatically change spatial identity. This comparison shows a recurring model choice; it does not establish memory leakage.
2. **Visible collisions can survive clean metrics.** Default's final page-level layout/accessibility checks passed while the heading was visibly covered at a normal 1280px desktop viewport. Its 15rem rail and a title that scales to 4.4rem do not ensure the complete word fits. A logical element box and absence of document overflow do not prove all painted text is readable.
3. **Preview argument mistakes waste model turns.** Medium recorded six invalid preview requests, including unsupported `workflow[].kind` and missing exact selectors. MAX recorded invalid preview requests too. Fixing source is different from fixing an assertion's selector, casing or expected attribute type.
4. **Incomplete repairs and stale evidence.** Medium initially crashed while validating absent error spans, used an empty image source and mismatched one image's alt. It repaired several problems, but edited after its last captures; the final host verdict remained `not_run` with visual review unavailable. "Verified and delivered" overstated that final evidence. Default said it was fixing its heading collision but left it visible.
5. **Animation can harm readability.** MAX initially dimmed the hero exit and a story lead; the recorded run reported numerous contrast failures. It subsequently removed the dimming and corrected a process paragraph's grid-column placement. Early mobile pin/scroll-region and contrast problems also required changes. Those are actual construction mistakes, not desirable premium effects.
6. **Lenis lifecycle defect reproduced from generated code.** MAX added an anonymous GSAP ticker callback, destroyed Lenis in `stopLenis()` and set it to null without removing that callback. An isolated execution of the actual generated start/stop block reproduces `Cannot read properties of null (reading 'raf')` on the next tick. This verifies the function-level defect; an actual browser preference switch was not performed in that test. A runtime preference change or motion reinitialization can therefore break/accumulate its animation owner.
7. **Hero loop composition defect.** An endlessly repeating scan child sits inside an endlessly repeating parent that also owns finite image/tilt tweens. The parent cycle cannot finish in practical time, so those finite layers finish once rather than keep cycling. Pointer movement also targets the same image offsets as ambient movement. A repeating timeline declaration alone does not prove sustained coordinated main-media motion.
8. **Misleading visitor copy.** MAX said there were no third-party requests beyond fonts and images despite external CDN animation scripts. Several sections discuss the demonstration/layout itself instead of the visitor's photography/print decision. Labels should be honest without turning the site into implementation documentation.

## What was observed

- Default: actual desktop/mobile views inspected. Its local form displayed the entered synthetic request in a visible confirmation panel with truthful local-only wording. The heading collision and mobile anchor obstruction remain.
- Medium: actual desktop/mobile openings inspected. No duplicate IDs were present in the delivered DOM. A stable keyboard submission displayed the synthetic name, purpose, subject and wall measurement with "Nothing was transmitted" wording. Initial rapid mouse automation did not establish a failure of the product; that observation was inconclusive and the keyboard path was checked separately.
- Original MAX: actual desktop hero inspected; source demonstrates the required libraries and two desktop-only pins. Its recorded six-frame process sequence observes changing stages, diagram drawing, release and reverse. The recorded inquiry status assertion passed, but the overall workflow failed at another result-text assertion; it is not reported as a wholly passed workflow. The second pin and complete final mobile/reduced-motion interaction were not accepted from this run.

The raw aggregate verdicts were Default `failed`, Medium `not_run`, MAX `failed`. Earlier failed captures and repaired errors remain historical evidence; they are not all current defects. Zero reported accessibility violations in a particular capture is not an aesthetic grade or proof of every interactive state.

## Performance and limits

These are single sequential generations, not repeated speed trials. Default made 4 native preview calls; Medium made 13 (including invalid requests); MAX made 8, with additional host capture evidence possible. Model thinking, network/image/font latency and retries affected time. MAX being quickest here does not establish that MAX is generally fastest.

Latest recorded representative lab captures: Default desktop load 3994ms/LCP 4180ms/CLS .001; Medium reduced-motion work capture load 4586ms/LCP 4256ms/CLS 0; MAX inquiry capture load 1469ms/LCP 984ms/CLS .032. These are different capture conditions, so they are not a fair performance ranking, field Web Vitals or FPS measurements.

## Requested text/SVG refinement

After the baseline finished, the human requested more attractive text and SVG motion in MAX. The baseline source is frozen in `MAX-COMPARISON-BASELINE.zip`, with source hashes and baseline captures retained. The live `03-MAX` folder can receive that separate refinement without rewriting the original comparison's timing or claims.

Updated MAX guidance asks for hero plus three supporting text moments, including scroll-progressive text, and two meaningful SVG treatments including shape/structure change. It preserves quiet reading, subject imagery, explicit scope overrides and creative ownership. The implementation reference adds observable SVG states, responsive text targets, finite ambient cycles and concrete ticker ownership. The existing MAX review criteria/reminder were updated; Default and Medium were not changed.

Official technical references: [SplitText](https://gsap.com/docs/v3/Plugins/SplitText/), [MorphSVG](https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/), [DrawSVG](https://gsap.com/docs/v3/Plugins/DrawSVGPlugin/) and [GSAP ticker ownership](https://gsap.com/docs/v3/GSAP/gsap.ticker/). The current API guidance was checked against these sources.

Focused routing/review checks passed. The additional Orvix refinement is recorded separately in `MAX-text-svg-refinement-report.json`. No ordinary app job was forcibly closed. Restart Orvix to load the changed CommonJS review reminder before future fresh chats.

### Refinement result

The single Orvix refinement reached its ten-minute cap (recorded 10m 08s including cancellation/cleanup), after retaining source edits. It is not reported as a normally completed generation. It added a richer character entrance and supporting text sequences, MorphSVG-based process framing and a sizing/framing SVG sequence. The same model/reasoning and existing identity were retained; its source was not hand-replaced by Codex.

The original anonymous Lenis ticker error is corrected. Isolated execution of the revised actual start/stop functions confirms the callback is removed, the instance is destroyed and no null.raf call remains. This check does not substitute for a live browser preference-switch test. The hero's ambient timeline now has finite children and no nested infinite scan child.

After the final source edit, Codex ran the existing Orvix preview API directly, without another model/critic/revision. The initial full-page capture exceeded the 24-megapixel limit, so bounded hero/process captures were used. All four desktop/mobile normal/reduced-motion inquiry workflows passed: visible local result panel and the entered synthetic name. No horizontal document overflow, broken images or console errors were recorded. Normal desktop and both reduced-motion captures had no accessibility violations. Normal mobile still reported a color-contrast violation affecting seven section-kicker labels. These are capture results, not whole-site or frame-rate certification.

Manual browser inspection observed reverse story progression and an actual change in the process SVG path's `d` geometry. Console warnings remain: GSAP reports missing targets. Source inspection finds five stage pairs indexing a collection of only nine diagram paths, which also mixes the morph target with the stage drawing paths. The preview API's error collection does not include warning-level messages, so a clean `errors` list missed this defect. The technical guidance now calls for explicit target groups/cardinality and investigation of missing-target warnings.

The refined MAX is more animated, but is not fully accepted as defect-free. Complete second-pin, continuous frame-rate, off-screen pause and runtime preference-switch coverage remain unestablished. Original comparison timing/source observations are preserved separately from this refinement. Final images and raw check results are in `03-MAX/final-inspection`; `MAX-refinement-lenis-cleanup-check.json` contains the isolated lifecycle result.
