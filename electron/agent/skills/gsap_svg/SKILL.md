# GSAP SVG and layout-transition plugins

Use for Flip-based layout transitions or GSAP-driven SVG drawing and morphing. This is a plugin engineering reference, not a visual recipe. Read `gsap` and, for scroll-controlled progress, `scrolltrigger` as well. Choose a technique from the subject's needs; this skill does not require any particular motif or animation.

## Confirm the plugin and geometry

Inspect the project's installed GSAP version, exports, license/access requirements, and official documentation before registering a plugin. Add only plugins the selected design actually uses, and keep versions compatible with GSAP core. Do not invent package names, claim a plugin loaded when its import failed, or leave a decorative imitation in place of a requested path/shape change. If the required plugin cannot be used, preserve the page with an honest static or technically available fallback and report the limitation.

**Flip** animates between measured layout states. Capture a valid initial state before applying the final layout, then animate the transition from those real states. Avoid measuring every frame or repeatedly reparenting nodes. If temporary absolute positioning is used, preserve the original layout space and restore stable geometry on resize, reverse, reduced motion, and teardown. When scroll progress controls Flip, one ScrollTrigger should own the paused transition's progress; do not create competing triggers for the same element.

**DrawSVG** develops an SVG stroke, not a filled silhouette. Confirm the target has a visible stroke and appropriate stroke width; choose meaningful draw ranges and retain the completed diagram. **MorphSVG** interpolates compatible path geometry (and supported polygon/polyline inputs). Keep paths in compatible coordinate spaces and viewBoxes; convert shapes only when the resulting geometry remains accurate and maintainable. Inspect intermediate silhouettes, simplify overly complex paths when needed, and verify the visible artwork rather than a hidden target or stationary parent.

## Preserve semantics and performance

Give each path or shape one timeline owner. Confirm every selector and expected group member exists; missing-target warnings matter even if the browser has no uncaught exception. Avoid animating hundreds of unrelated paths or continuously applying expensive SVG filters. Preserve legible labels and diagrams at small sizes. If artwork persists across sections, coordinate its ownership and handoffs so leaving one section does not hide the shared parent or strand the story.

Reduced motion retains a useful finished diagram or labelled static states. Content, labels, links, and controls remain semantic and reachable outside the animated path. Do not hide the active target along with unused morph artwork. For scroll-linked work, inspect actual intermediate and reverse geometry, section handoffs, mobile scale, and a final static/reduced-motion state. Read the current official GSAP plugin documentation for [Flip](https://gsap.com/docs/v3/Plugins/Flip/), [DrawSVG](https://gsap.com/docs/v3/Plugins/DrawSVGPlugin/), and [MorphSVG](https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/).
