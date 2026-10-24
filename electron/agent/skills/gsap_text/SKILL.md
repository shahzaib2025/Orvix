# GSAP text-animation plugins

Use when the selected motion uses SplitText, ScrambleText, or TextPlugin. This skill covers text mechanics and accessible behavior only. It supplies no copy, type pairing, visual style, page layout, or effect sequence. Read `gsap`; read `scrolltrigger` when scroll controls the text progression.

## Split only the text that benefits

Inspect the installed plugin/version and current official documentation. SplitText can expose line, word, or character targets for choreography; use the smallest level that supports the meaning. Wait for fonts before measuring or splitting. If the installed version supports responsive re-splitting, use its documented auto-splitting/lifecycle API and return the owned animation from its split callback as required. Revert owned splits and animations when fonts, viewport, component lifetime, or reduced-motion conditions change; do not accumulate detached targets.

Keep a stable, meaningful text reading for assistive technology. Inspect the resulting DOM and accessibility tree for the actual element role: avoid duplicate announcements, broken link semantics, invalid ARIA attributes, and characters that disrupt whole-word wrapping or keyboard interaction. Preserve spaces and natural wrapping across viewport sizes. Keep interactive semantics inside linked text intact. Text animation must resolve to the original meaningful words; it must not leave essential copy scrambled, clipped by masks, faint, or outside the viewport.

## Use ScrambleText and TextPlugin selectively

Use ScrambleText or TextPlugin for a short nonessential accent that settles into intended, understandable text. Do not scramble body content, instructions, prices, labels, navigation, or other information a visitor must read. Avoid applying one identical effect to every heading. Give meaningful passages distinct behavior only when their content benefits from it, with enough stillness to read. Reserve space for changing text so it does not cause avoidable layout shifts.

Respect reduced motion at startup and runtime: show the complete final message and restore stable unsplit or otherwise accessible text. Check contrast during intermediate states, not just at the final color. Inspect the actual animated characters/words, including forward, reverse, re-entry, font load, resize, and mobile wrapping where relevant. A moving parent container does not prove its text treatment works. Consult the official GSAP docs for [SplitText](https://gsap.com/docs/v3/Plugins/SplitText/), [ScrambleText](https://gsap.com/docs/v3/Plugins/ScrambleTextPlugin/), and [TextPlugin](https://gsap.com/docs/v3/Plugins/TextPlugin/).
