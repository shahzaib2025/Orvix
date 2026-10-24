# MAX hero loops: live test and inspection improvements

## Completed implementation

The selected MAX guidance requires an original layered SVG hero whose artwork keeps changing after entrance, with a restrained looping accent on a meaningful word, a connected scroll handoff and useful mobile/reduced-motion composition. It supplies no hero scaffold, example phrase, preset shape or effect sequence.

Testing exposed a missing observation capability: motion capture recorded transforms/opacity but not SVG stroke drawing, path geometry or text paint. `motion-preview.cjs` now records bounded SVG attributes and stroke/fill/dash states plus text color, clip path, background position, variation settings and letter spacing. The existing review gate consumes those observations. Models are instructed to sample actual animated paths/glyphs rather than their static parents. No preview arguments, mode or extra critic stage was added.

A local server test also received browser-blocked port 5061. Local visual MCP now selects a loopback port in the dynamic range, with bounded collision retries; browser protections and MCP authentication remain intact. Browser fixture servers use the same helper. Reference: [Fetch port blocking](https://fetch.spec.whatwg.org/#port-blocking).

## Verification

**84 passed, 0 failed** in the final integration run, recorded in `scratch/max-hero-loop-final-checks.log`. Coverage includes direct/native profile and skill loading, diversity constraints, visual MCP authentication/cancellation, existing scroll/review checks and a real browser fixture observing SVG stroke, changing path geometry and selected-word color without moving the viewport. Its reduced-motion run keeps these states stable. Fixtures establish inspection capability, not the quality of a generated website.

## Live generation attempts

The open brief requested a bounded three-section white website composition study for TANGENT, a fictional experimental typography studio: a complete hero, two useful connected supporting sections and an accessible type-study interaction. Layout, artwork, word selection and choreography were left to Orvix. This is a focused hero test, not acceptance of the nine-section full-site standard.

- The saved selected Space Bunny Free model, medium reasoning, failed in about 1m 24s with HTTP 401 Invalid credential before generating files. State: `scratch/max-motion-live-1791819040958`.
- The human then selected Muse Spark 1.3 Free, xhigh. Orvix's production engine/native worker pool was used. Provider responses reported internal server errors, a connection reset and output-token rate limits. The run loaded the complete `website_design_max` and `website_motion_max` skills and successfully recorded a chosen brief, but created no project files before the 20-minute benchmark limit cancelled the task. State: `scratch/max-motion-live-1791819307702`; Desktop report: `Orvix-MAX-Motion-Tests-1791819307702/generation-report.json`.

Muse's recorded concept uses a continuous diagonal tangent rule, large experimental letterforms, construction marks, a looping emphasis word and a supporting glyph-anatomy scene. It is only a proposal; no rendered design or working animation exists to approve. There is no website screenshot or visual grade for this run.

The live quality acceptance and targeted website revision remain incomplete pending a successful model generation. The user has been asked which model should continue the test. No silent fallback or change to saved model settings was made.
