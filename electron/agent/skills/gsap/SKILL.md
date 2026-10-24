# GSAP animation engineering

Use when a MAX task implements animation with GSAP. This is a technical skill, not a visual direction: it supplies no page, hero, section, or effect template. Select motion from the human's subject and the approved design brief.

## Understand the project's actual GSAP setup

Inspect the website project's existing dependencies, entry points, and package manager before changing them. Add GSAP to the generated site, not Orvix's Electron runtime. Preserve the project's framework and lockfile. Check the installed version and its official API when using version-sensitive behavior or a plugin. In buildless sites, use explicitly versioned compatible imports and an HTTP preview for modules. Do not claim a library is active because it is merely imported or listed in a manifest.

GSAP tweens interpolate properties over time; timelines coordinate related tweens, labels, and sequencing under one owner. Use a timeline when multiple elements express one event or state progression. Keep separate timelines only when their lifetimes or behavior are meaningfully independent. Avoid chains of unrelated timers and per-frame DOM measurements. Prefer transform and opacity when they communicate the intended change without repeated layout or paint work.

## Own targets and lifecycle

Give each target property one clear animation owner. Competing tweens or ScrollTriggers on the same element/property can capture stale start or end values and produce invisible finishes, jumps, or reverse-scroll faults. Use explicit start and destination values (`fromTo`) when another style or animation makes the captured current state ambiguous. Do not assume `overwrite` repairs an already-captured wrong destination. Check selector matches and plugin warnings, not just uncaught exceptions.

Audit selector overlap before adding a special reveal to an existing collection: a global reveal and a gallery/card-specific `from()` can both own opacity, capturing a hidden value as the destination. Exclude those targets from the generic effect or compose them under one owner with explicit readable end values. Verify every affected item and nested word span after the sequence settles and on re-entry; do not fix the symptom by globally forcing all story stages visible.

Pixel translation (`x`, `y`) and percentage translation (`xPercent`, `yPercent`) are independent components. A CSS `translateY(...)` can be captured as a pixel offset; finishing a tween at `yPercent: 0` alone may leave that offset in place and keep text outside its mask. Prefer readable base CSS and initialize the entrance with GSAP. When taking ownership of an existing transform, explicitly normalize the relevant pixel and percentage components without erasing intentional layout positioning. Check each settled text span against its clipping ancestors; opacity 1, DOM text and an existing heading box do not prove its glyphs are on screen. See the [official CSS transform guidance](https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/).

Scope animations to the component or page lifecycle. Use `gsap.context()` where appropriate and revert the owned context during teardown. Use `gsap.matchMedia()` for responsive and reduced-motion conditions when supported by the installed GSAP version; create animations inside the condition so reverting it cleans up its owned animations and ScrollTriggers. Remove event listeners, observers, and ticker callbacks by the exact function reference that was registered. Never pause the global GSAP ticker to stop one component; pause or revert only the work that component owns.

Ambient loops and finite entrances have different jobs. Keep the entrance finite, then run a separate or deliberately composed loop that can continue while visible. Pause unnecessary loops off-screen and while the document is hidden; resume without a visible jump. Do not start a second requestAnimationFrame loop when an owned GSAP ticker or timeline already drives the same scene. Avoid infinite child loops that prevent a parent timeline from completing its cycle. Observe a cycle boundary before claiming a seamless repeat.

## Responsive behavior, accessibility, and verification

Reduced motion must be complete both at startup and when the preference changes: retain all text, meaning, stages, and controls in a settled state; do not leave content hidden at a tween's start or at the first scrub position. Use `matchMedia` conditions to remove motion rather than leave a live animation in a partially progressed state. Keep semantic HTML as the source of truth; animation must not make essential copy unreadable, inaccessible to keyboard users, or dependent on pointer input.

Killing ScrollTriggers alone does not revert inline styles or stop independent repeating tweens. On a preference change, revert the owned animation context, remove its Lenis/ticker callbacks, and compose a complete static state including split-text descendants, drawn paths, counters and scene content. Switching back may rebuild only one owned motion setup; avoid duplicate wrappers, loops or triggers. Keep semantic counter values available independently of whether a motion branch runs.

Inspect the actual finished page after entrances settle, while motion is enabled and reduced, at desktop and mobile sizes. Check forward/reverse/re-entry when relevant, time-separated states for loops, computed visibility when sections look blank, console warnings for missing targets, and primary actions after the final edit. A passing build or a working hero does not prove page-wide behavior. Record only observed evidence.

For version-specific details, use the official [GSAP documentation](https://gsap.com/docs/) for core tweens, timelines, contexts, matchMedia, and ticker ownership. Read `scrolltrigger`, `gsap_svg`, or `gsap_text` for those separate APIs when the selected technique uses them.
