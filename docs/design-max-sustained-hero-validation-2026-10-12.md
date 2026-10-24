# Design MAX sustained hero motion — implementation and observed results

Date: 2026-10-12. This is an instruction and bounded inspection update, not a guarantee of perfect designs or unique layouts on every model run.

## Delivered

- `website_design_max/SKILL.md` now requires subject-relevant main media to remain visibly alive after the finite entrance, including a new standalone MAX hero. A button pulse, blinking indicator, marquee or static photograph after a title reveal is insufficient. Imagery, layout and choreography remain the model's creative choices.
- `website_motion_max/SKILL.md` explains separate entrance/ambient/scroll ownership, seamless loops, off-screen/hidden pause and teardown without stopping the shared GSAP ticker. Spline-style movement does not mandate Spline; real Spline scenes require real exports. Existing explicit 3D selection remains necessary for Three.js.
- Observed lessons added: preserve word spacing and whole-word wrapping, expose actual initialization failures, keep check helpers inside the approved project, reserve readable space throughout scene movement, inspect opened mobile dialogs, and avoid empty runways in a standalone hero.
- `design-review.cjs` reinforces the sustained main-visual requirement in the compact MAX reminder and existing reviewer criteria. New standalone MAX heroes can reuse the existing bounded final fresh-capture handoff after source changes. Static, reference-fidelity and repair-only requests do not acquire this construction scope. No new review stage or polishing loop was added.
- Default/Medium routing, managed skill loading, optional 3D policy and explicit scope overrides remain covered by existing checks. No animation libraries were installed in Electron.

## Automated checks

The focused four-file suite initially passed 55/55. After two additional handoff/scope checks, 55 of 57 passed in one run; the two real-browser timing cases timed out/cancelled. Both passed when rerun sequentially (16 seconds combined). All 57 checks therefore have successful results across these runs, not one clean 57-test run.

The final updated skill text also passed 22/22 profile-selection and managed-loader checks. A real-browser fixture distinguishes sustained main-media movement at a stationary viewport from a completed title entrance and a stable reduced-motion composition. A native execution fixture checks fresh final captures for a new standalone MAX hero without adding a second builder or an independent critic.

Logs: `scratch/max-sustained-hero-regressions.log`, `scratch/max-sustained-hero-final-regressions.log`, `scratch/max-sustained-hero-timing-recheck.log`. Passing these checks establishes instruction delivery and bounded inspection behavior; it does not grade a generated website's artistic quality.

## Live Orvix generation

Both examples were generated through Orvix's production engine, retaining `opencode/space-bunny-free` with `medium` reasoning and selecting Design MAX. These were deliberately bounded single-hero briefs, not nine-section website tests. The brief did not repeat the new sustained-loop requirement. OPTIC explicitly enabled the existing 3D selection. Codex changed Orvix guidance and test/report helpers; Orvix generated and corrected the example website source.

Desktop folder: `~/Desktop/Orvix-MAX-Motion-Tests-1791789040578`.

| Example | Recorded generation time | Observed result |
| --- | --- | --- |
| LUCENT photographic film-festival hero | 15m 36s | Three photographic layers, image drift/scale and a moving light treatment remain active after the entrance. Program-preview dialog works on desktop/mobile in the final recorded normal-motion workflow. |
| OPTIC interactive camera-optics hero | Original 8m 30s; completion 4m 26s; targeted correction 8m 09s | Three.js scene now renders and controls/study dialog respond. The final correction reached its eight-minute cap and returned Task cancelled; this is retained work, not a fully accepted generation. |

The original OPTIC run was blocked while trying to place a check helper in protected Temp/opencode. This was not a user refusal and permissions were not weakened. Its stylesheet was also missing; Orvix supplied it during completion. The apparent WebGL failure was subsequently traced to `r` being undefined in a caustic-opacity assignment; Orvix replaced it with `solution.radius`. Silent catch handling had concealed that source defect. The functioning 3D scene was then observed in the in-app browser.

LUCENT's settled title remained stable while main image/frame transforms changed over time at the same scroll position. Its action opened six clearly illustrative program entries and returned on close. This provides direct evidence for sustained hero motion, not measured frame rate.

For OPTIC, manual inspection observed the actual 3D scene, wavelength readout changing from 550 to 551 nm, corrector switching to `aria-pressed="true"` with added optical elements, and the optical-study dialog opening and dismissing. Desktop and 390×844 mobile compositions were inspected; the temporary browser viewport override was reset.

## Weaknesses and acceptance limits

- These runs were slow. This update establishes a stronger hero standard; it does not demonstrate faster model generation.
- LUCENT added an unnecessary scroll runway for a one-hero brief. Its scroll departure was not verified at nonzero scroll progress. The guidance now explicitly excludes empty standalone runways.
- OPTIC's bright rays cross its reading copy, especially on mobile. The opened mobile study dialog also showed horizontal clipping/overflow. It is not visually accepted as finished premium work.
- OPTIC's recorded workflow failed at an attribute assertion because the model supplied boolean `true` while the actual DOM attribute was string `"true"`. Earlier action, diagram and wavelength assertions passed. Manual inspection separately confirmed the toggle; the failed workflow record is not rewritten as a pass.
- Reduced-motion captures exist, but complete final reduced-motion interaction and pause/teardown coverage was not established. No frame-rate, battery, physical-device or field-performance claim is made.
- OPTIC's simplified optical simulation is illustrative and was not scientifically validated; some study readouts report all rays clipped. It must not be presented as an accurate measured instrument.
- Neither sample received independent premium-design approval. One pair of different subjects cannot prove cross-run uniqueness or quality across all models.

## Recorded lab performance

These are individual tool measurements, affected by network/cache state; they are not field metrics or animation smoothness measurements.

| Capture | Load | LCP | CLS |
| --- | --- | --- | --- |
| LUCENT desktop | 3798 ms | 2516 ms | 0 |
| LUCENT mobile | 728 ms | 368 ms | 0 |
| OPTIC desktop during correction | 4346 ms | 532 ms | 0.002 |
| OPTIC mobile during correction | 1908 ms | 560 ms | 0.007 |

Recorded captures reported no page-level horizontal overflow, broken images, console errors or automated accessibility violations. This did not catch OPTIC's inner-dialog clipping or animated visual/readability collision. LUCENT's final aggregate performance check failed; it is not claimed to meet every performance budget.

## Viewing and rollout

Use `OPEN-LUCENT.cmd` or `OPEN-OPTIC.cmd` in the Desktop test folder. The local HTTP launcher preserves ES-module support; do not open OPTIC through file:// or disable browser security. Current URLs are `http://127.0.0.1:7246/01-LUCENT-Photographic-Hero/` and `http://127.0.0.1:7246/02-OPTIC-3D-Hero/` while the server runs. `orvix-evidence` folders retain production screenshots and recorded results.

The live test engines loaded the changed routing/review code. Restart the ordinary Orvix app before fresh chats to load changed CommonJS handoff/review code; managed skill reads already refresh changed file content. No unrelated active user job was forcibly closed.
