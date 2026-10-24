# Three.js scene and asset engineering

Use this guide for a human-requested 3D/WebGL scene, model, asset, animation, repair, or technical review. Select it when the task clearly requires Three.js, including when the website design profile is **None**. A design profile governs creative workflow; it does not prevent relevant engineering guidance from loading. MAX alone is not permission to add 3D.

This is an engineering reference, not a visual template. It supplies no default scene, object, palette, camera, composition, animation, asset pack, page structure, or starter design. Derive those choices from the user's brief and available references. If the purpose is better served with CSS, SVG, or ordinary imagery, explain that fit and do not add WebGL without a concrete reason.

## 1. Establish fidelity before modeling

Translate the request into a compact asset and behavior specification before substantial implementation. Record only what the task supports:

- The primary subject and distinct assets that must exist, plus which details are essential versus optional.
- Relative proportions and a stable scale anchor when dimensions or a reference provide one. State the chosen unit convention and the model's origin, forward direction, and pivot.
- Silhouette, major forms, placement, attachment points, orientation, visible surface qualities, and required state changes.
- The requested rendering context, likely viewing distances, target viewport sizes, and interaction expectations.
- Source references and which visible properties each reference establishes.

Inspect supplied images, models, screenshots, or URLs with the available tools before approximating their details. Compare landmarks and relative measurements instead of relying on memory. Distinguish visible facts from inference. Do not claim exact reconstruction when the reference lacks dimensions, hidden surfaces, or adequate resolution; make the uncertainty explicit and preserve the known features accurately. Ask a focused question only when an unresolved measurement or interpretation materially changes the requested result.

For an open creative brief without references, exercise judgment for that subject. Do not invent business facts or claim reference accuracy. “Premium” means deliberate form, careful proportions, clean surfaces, coherent material response, thoughtful detail, and reliable presentation; it does not mean adding arbitrary complexity or a familiar showcase scene.

## 2. Choose the representation that fits the asset

Inspect the project's framework, package manager, lockfile, installed Three.js version, and existing scene architecture first. Use the project's current conventions. Avoid installing another renderer or replacing existing code just to follow this guide.

Choose among primitives, `Shape`/extrusion, custom `BufferGeometry`, curve/tube geometry, or an imported model according to the actual shape and needed fidelity. Prefer supplied or authorized source models when they are materially more accurate than a rushed procedural approximation. Do not silently substitute a generic model, invent a Spline URL, or present a placeholder as finished work. Keep source provenance and any necessary attribution.

For procedural assets, build recognizable large forms first, then add only details supported by the brief or reference. Use named functions and semantic groups for meaningful parts. Keep transforms understandable: consistent units, stable pivots, intentional local origins, and predictable parent-child relationships. Avoid arbitrary geometry scattered through one giant initializer.

For characters, establish a coherent silhouette, relative head/body/limb proportions, joint connections, facial expression, clothing construction, and a pose that suits the brief. Primitive geometry is a construction method, not evidence of finished visual quality. Inspect how adjoining forms meet: unintended gaps, balloon-like overlaps, abrupt sleeve/cuff transitions, disconnected hands, and blocky feet can undermine the intended character. Refine the visible forms rather than hiding them with decoration. Simplified hands, hair, or anatomy can be deliberate stylistic choices, but their execution must fit the chosen character. Verify ground contact and shadows from actual geometry; do not assume a nominal height or hardcoded hip position places the feet on the floor. Report measured dimensions or clearly identify estimates.

For custom geometry, validate vertex positions, indices, winding, normals, UVs, and bounding volumes. Use enough segments for the actual viewing distance, not an unbounded tessellation. Avoid coplanar overlaps, visible seams, paper-thin edges where thickness matters, accidental holes, and shading artifacts. Check silhouette and proportions from the delivered camera before adding microdetail.

For imported models, use the format and loader supported by the project's installed version. Preserve hierarchy and materials when useful; normalize scale, orientation, and pivot deliberately. Handle loading, progress, failure, and cleanup. Do not assume an asset's license or attribution from its filename.

When the task involves finding, evaluating, licensing, validating, converting, importing, or optimizing an external model or texture, also read the registered `gltf_assets` skill. Skip that guide for a wholly procedural scene with no external asset work.

## 3. Materials, surface detail, and lighting

Use material properties to explain what surfaces are made of. Tune `MeshStandardMaterial` or `MeshPhysicalMaterial` values in context; metallic, roughness, transmission, clearcoat, and normal detail should support the intended material, not act as generic gloss. Avoid excessive reflectivity, uniformly rough plastic, noisy procedural texture, and many barely visible details that compete with the main form.

Use texture color spaces and maps correctly for the installed Three.js version. Keep color maps in the appropriate color space and data maps such as normals, roughness, and metalness in linear space. Check UV orientation, stretching, seams, and texel density at the final camera distance. Prefer a small number of purposeful, correctly sized textures; do not upscale tiny source images or create unsupported texture detail.

Choose lighting and tone mapping for the intended subject and reference. Check that key forms remain readable, shadows do not obscure essential geometry, highlights retain detail, and colors survive the renderer's output settings. Avoid adding lights or postprocessing without a visible purpose. Preserve a consistent visual scale between objects, lighting, and environment.

## 4. Integrate the scene without hiding the product

Keep essential text, navigation, instructions, labels, and controls in semantic HTML or accessible SVG. The canvas must not be the only way to understand or operate the experience. Give the canvas an appropriate accessible name or hide it from assistive technology when it is purely decorative. Provide keyboard operation, visible focus, and touch-sized controls for actual scene actions.

When the user requests a premium presentation, design the surrounding experience as part of the result. Give the requested subject visual prominence through composition, scale, typography, material contrast, lighting, and useful controls chosen for this brief. Do not default to a boxed diagnostic viewer beside construction notes. Put internal geometry names, renderer settings, dependency versions, measurements, and implementation explanations in the delivery report or developer documentation unless the user specifically requests an educational or engineering interface. Keep essential operating instructions, attribution, and truthful failure feedback accessible. No fixed layout, color scheme, camera angle, stage, pedestal, animation, or character style is required by this guide.

Set camera placement, projection, clipping planes, and framing from the requested subject and evidence. Verify the full required object remains in frame at desktop and mobile sizes, with no accidental clipping, extreme empty space, or controls covering the focal geometry. Do not inherit a camera path or framing recipe from another project.

If GSAP, ScrollTrigger, Lenis, or another animation system is also used, assign each animated property one owner. Keep a single coordinated render-loop/ticker relationship, avoid duplicate frame loops, and explicitly synchronize scroll-driven state with the scene. Read the matching library skill when the requested implementation actually uses it; never add a dependency just to demonstrate it.

## 5. Rendering performance and lifecycle

Size the renderer from its actual container. Update camera projection after container changes, use a bounded pixel ratio appropriate to the device, and avoid unnecessary full-window rendering for a contained canvas. Use `ResizeObserver` where appropriate and disconnect it during teardown.

Check the real canvas and container bounds after resizing. An aspect ratio combined with a minimum height can force a viewer wider than a narrow screen; canvas intrinsic dimensions can also influence sizing. Constrain the scene to its layout, update framing where necessary, and inspect for horizontal document overflow and clipped controls. Do not use page-level overflow hiding as a substitute for fixing oversized content. Keep reset behavior consistent with the current viewport and ensure it restores an intentional view without moving or repeatedly rescaling the asset.

Use a demand render for static scenes. For active animation, keep one frame-loop owner and stop or reduce work when the canvas is off-screen or the document is hidden. Keep geometry, texture dimensions, shader work, postprocessing, shadows, and draw calls within the target-device budget. Reuse shared materials and geometry where appropriate; use instancing or merged geometry only when repeated objects and interaction needs justify them. Avoid premature optimization that makes ownership or cleanup unclear.

Dispose of resources owned by the scene when it is removed: geometries, materials, textures, render targets, renderer resources, observers, event listeners, controls, and scheduled frames. Do not dispose shared assets owned elsewhere. Handle WebGL context loss/restoration if the scene's expected lifetime makes it relevant. Keep failures diagnosable; do not label every setup exception as WebGL unavailability.

## 6. Motion, reduced motion, and fallback

Make movement communicate a real state, relationship, or interaction. Do not add idle motion merely to make a scene appear active. Respect `prefers-reduced-motion` on first load and when it changes during the session. The reduced-motion version must retain the complete subject, information, and controls in a stable useful state; it must not leave scrubbed content hidden or depend on camera travel.

If WebGL, a model, a texture, a CDN import, or scene initialization fails, preserve the page's useful content and controls, show a relevant non-WebGL fallback when needed, and report the actual failure. Do not replace unavailable imagery with an unrelated object or claim the live scene was reviewed when only fallback content rendered.

Make loading, ready, and failure states agree with what is actually visible. Verify that a fallback marked `hidden` is truly absent: an author rule such as `display: grid` can override the browser's default hidden styling. Explicitly preserve hidden behavior for these overlays and check their computed visibility. A successful canvas render must not remain covered by an unavailable/loading overlay. Initialization failures must not leave a false ready status, and module-loading failures that occur before application initialization must not remain indistinguishable from endless loading.

Confirm the requested launch method before delivery. Local ES modules, import maps, loaders, and fetched assets may require an HTTP origin and fail under `file://`. An HTTP preview does not prove double-click compatibility. If the user expects to open the HTML directly, verify that exact route and choose a compatible delivery approach. Otherwise provide a working lightweight local preview entrypoint and its URL, clearly explaining the required launch method. Do not claim a file is self-contained or double-click ready merely because dependencies were copied locally. Do not disable browser security to make the delivery appear functional.

For a newly delivered Three.js scene/model project on Windows, default to HTTP and include **Start-Preview.bat** plus concise launch instructions, regardless of design profile, including None. Apply the shared web project launch guidance: the launcher must use the actual package scripts or a project-owned lightweight static-server helper, quote paths relative to its own location, bind to localhost, and print/open the actual URL only after readiness. It must work independently of Orvix's temporary preview server. Reuse an existing suitable launcher; keep prerequisite/startup failures visible and do not silently install global runtimes. Respect an explicitly different launch contract when feasible. Report missing prerequisites and unobserved launch behavior honestly. This delivery support supplies no scene, geometry or visual template.

## 7. Verify the rendered result

For a requested visual composition, premium presentation, refinement, or critique of the 3D subject, also read visual_composition. It guides subject prominence and observed craft without imposing a scene or activating a creative profile.

Read browser_verification for the actual launch route, responsive container sizing, loading/failure overlays, and browser interactions. Apply it within the existing preview allowance; use bug_repair when diagnosing a reported defect.

Use the existing preview and verification workflow. Inspect the actual Three.js canvas at the requested desktop and mobile sizes; distinguish it from a static fallback or screenshot. Check the principal asset's silhouette, proportions, orientation, placement, material response, camera framing, clipping, and requested interactions against the task specification and supplied references. For a scroll- or interaction-driven scene, inspect the real subject before, during, and after the state change, including reverse/re-entry when applicable. Check reduced motion and relevant console/loading errors within the existing preview allowance.

Fix visible defects supported by observation. After a source change, use fresh evidence for the changed state. Report which references and viewports were actually inspected, whether the full WebGL scene rendered, and any remaining approximation or measurement uncertainty. A build, successful import, or screenshot alone does not prove asset accuracy, responsive behavior, or performance. Report frame-rate or device claims only when measured.

Before reporting completion, check the following within the existing bounded preview workflow; reuse current evidence rather than adding a separate critic or repeated polishing loop:

- The delivered launch route loads the actual scene and its dependencies. Check relevant browser errors and distinguish local-file failures from WebGL or asset failures.
- Ready/loading/failure text and overlays match the rendered state; the actual model is visible and accessible controls remain reachable.
- Desktop and narrow mobile views fit their containers without horizontal overflow, unintended crop, or controls obscuring important forms. Check the geometry after resize and reset, not only the initial view.
- The principal asset remains coherent from the front, side, and back where those views are relevant. Inspect proportions, connections, surface transitions, contact/shadows, expression, and the requested movement.
- The composition and subject meet the user's intended visual quality. A running renderer, PBR material, auto-rotation, or a control checklist does not establish a premium result. Identify and address observed visual weaknesses before claiming quality.

When the user reports a specific failed artifact, inspect its actual files and rendered state before diagnosing it. Preserve their intended subject and scope while addressing the observed cause. Keep checks and claimed fixes tied to evidence; if a required observation is unavailable, report that limit instead of claiming the mistake cannot recur.

Consult the current [Three.js manual](https://threejs.org/manual/) and [API documentation](https://threejs.org/docs/) for version-specific loaders, color management, renderer sizing, geometry, animation, and disposal details. Match examples to the version actually installed; do not rely on stale snippets by habit.
