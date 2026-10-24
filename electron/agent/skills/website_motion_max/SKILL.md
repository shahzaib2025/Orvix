# Design MAX motion implementation router

Use after choosing the MAX visual direction, and only when implementing motion. This is shared engineering guidance and a router to focused library skills. It does not prescribe a visual motif, composition, page structure, effect sequence, or reusable design.

## Choose the technical guidance that applies

- For a qualifying new full MAX website, the existing MAX contract uses **GSAP, ScrollTrigger, and Lenis together**, unless the human requests static treatment, another stack, reference fidelity, or a concrete scope/technical constraint prevents it. Read `gsap`, `scrolltrigger`, and `lenis` before substantial implementation of that stack.
- Read `gsap_svg` when implementing Flip-based layout transitions, SVG drawing, or SVG morphing. Read `gsap_text` when implementing SplitText, ScrambleText, or TextPlugin effects. Read both only when both technique families are actually chosen.
- Read `threejs` only when the human requests 3D or selects Orvix's existing 3D website option. Do not add Three.js because MAX is selected.
- Read `gltf_assets` in addition to `threejs` only when a requested 3D task needs external model or texture sourcing, licensing, validation, conversion, import, or optimization. Skip it for a wholly procedural scene. It is an asset-pipeline reference, not a scene template.
- For a short study, repair, static site, or existing page, read only the relevant technical skill(s). Explicit human constraints and the actual project stack take precedence. Do not load unused plugin guidance just to increase motion.

Use registered skill IDs with `read_agent_skill` in direct execution. In native OpenCode, read the exact registered files using its native read tool, without indexing or registering the managed skill directory as a project. Read complete files. Reuse successful reads in this task unless their content changed.

## Shared implementation rules

Install or import libraries in the generated website project, using its existing package manager and lockfile. A dependency in Orvix's Electron app does not animate a generated site. Preserve the site's framework. For buildless delivery, use explicitly versioned, compatible CDN imports and serve ES modules over HTTP; do not tell the human to open a module-based `index.html` through `file://` when browser security blocks it. Consult the official API for the exact installed version when details may have changed. Do not copy a demo page, library starter, visual scaffold, or preset composition.

The libraries must cause the intended behavior to appear in the actual site. An import, dependency declaration, code comment, or decorative-only motion is not evidence of successful integration. Keep ordinary content present and readable before initialization; if a script or asset fails, the useful page and controls must remain. Classify actual failures from their diagnostics instead of guessing that every exception means WebGL is unavailable.

Give the required MAX stack distinct, subject-led responsibilities: GSAP coordinates related animation states, ScrollTrigger connects chosen states to real scroll positions and pins only a fitting scene, and Lenis smooths the page's actual scroll through the same clock as ScrollTrigger. This is a tool-role guide, not a visual recipe; never add generic motion just to demonstrate a library. Before claiming integration, confirm the generated page loaded the intended version, registered the required plugin, created the intended instance, and visibly changed the actual scene elements. If one library or remote import is unavailable, keep a complete non-motion page and report the limitation truthfully.

Give each animated property one coordinated owner. A single timeline or explicit sequence should own related states; avoid unrelated timers or competing triggers that animate the same property. Use explicit end states where an earlier animation's captured state could make a later animation finish hidden. Keep reading content visible on forward scroll, reverse scroll, re-entry, and refresh. Stop unnecessary ambient work when its scene is off-screen or the document is hidden, and clean up only resources this page owns; never stop a shared global ticker to pause one scene.

Respect reduced motion on initial load and when the preference changes at runtime. A reduced-motion state still contains the full subject, text, story stages and controls in a stable, reachable composition. Disable or simplify JavaScript motion and CSS transitions without leaving scrubbed content hidden or pinned to one inaccessible stage. Keep keyboard access, visible focus, legible contrast throughout intermediate states, and usable mobile behavior. Supply a meaningful fallback when optional libraries, network imports, or WebGL fail.

## Use existing evidence efficiently

Use the existing bounded preview workflow; do not add another review stage, background server, automatic polishing loop, or repeated inspection pass. Preview captures support only observed states. For motion, use actual selectors from the changed source, sample meaningful forward and reverse states, inspect after entrances settle, and check mobile and reduced motion within the existing allowance. Current motion checkpoints allow at most six frames, two viewports, and `settle_ms` up to 500. Preserve time-separated samples when checking sustained movement. After the final source edit, reserve a fresh capture and the primary-action assertion when relevant. Report what was observed and what was not verified; syntax or build success alone does not establish motion quality.

For a major animated scene, the existing storyboard must connect its input (time, scroll or interaction), the real subject element, and the understandable visual change. During the existing review, inspect that element before, during and after the intended state change, including reverse/re-entry when the scene supports it. A one-shot entrance on a decorative object does not prove that a section has meaningful motion. If the visual barely changes, the motion hides information, or the scene's purpose is unclear, fix the implementation or simplify the scene and describe the remaining limitation.

Useful primary references: [GSAP docs](https://gsap.com/docs/), [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/), [Lenis documentation](https://github.com/darkroomengineering/lenis), [Three.js manual](https://threejs.org/manual/), and the official GSAP API pages for the selected plugins. Check the actual version and API before relying on older snippets.
