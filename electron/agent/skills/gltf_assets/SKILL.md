# 3D asset sourcing and glTF pipeline

Read this guide when a task needs an external 3D model or texture to be found, evaluated, imported, validated, attributed, exported, or optimized. It complements `threejs`: use Three.js for the scene and runtime; use this guide for the asset's source, integrity, rights, and delivery. Skip it for a self-contained procedural scene that uses no external 3D asset. A design profile does not determine whether this technical guide applies.

This guide contains no asset pack, object list, visual style, scene layout, or modeling recipe. Follow the user's subject, references, tools, and asset constraints. Do not source or download a model merely to avoid making a required custom asset, and do not create a generic substitute for a distinctive reference.

## 1. Choose a truthful asset path

Before searching, inspect supplied files and the project's existing asset folders. Clarify the required subject, important visible features, scale anchor, target view distance, interaction needs, and any exact source or licensing constraints. Treat photographs, screenshots, sketches, and model previews as different kinds of evidence: a preview may establish silhouette and visible colors, but not hidden geometry or real-world dimensions.

Choose among a supplied model, a sourced model, a new procedural Three.js model, or a permitted 3D content-creation workflow based on the requested fidelity, geometry, viewing distance, editability, rights, delivery size, and available tools. A distinctive shape or reference may require custom modeling even if a superficially similar download exists. A simple or repeated form may be more accurate and lighter when built in code. Do not assume Blender, an exporter, a converter, or a decoder is installed. Do not claim an asset was authored, converted, compressed, or checked unless the corresponding operation actually happened.

If the requirement is reference accuracy, compare real landmarks and relative proportions from the supplied reference. Record the measurements or ratios that are visible, the unknown dimensions, the required silhouette, the orientation and attachment points, and which details are inference. Do not convert image pixel dimensions into physical scale without a known anchor and camera context. If crucial geometry is hidden or the image is too ambiguous to distinguish plausible forms, ask one focused question or label the result an approximation.

## 2. Search and verify the original source

Search for the exact subject, not just a broad category. Prefer the creator's original asset page or an established repository that exposes the actual model files, license, creator, and revision. Inspect that original page; a search snippet, thumbnail, mirror, or filename does not establish source, rights, file format, or asset contents.

Use the existing `find_visual_assets` tool only for image candidates: it returns image URLs and source pages, not 3D model files. For models, use the available web research tools or user-provided sources, then inspect the canonical model page and file documentation. If search is unavailable, report that limitation and continue with supplied files or a clearly stated procedural alternative when it fits. Never describe an image-search result as a found GLB.

Before including an external asset, record its creator, canonical page, exact license or permission, required attribution, and any restrictions on commercial use, modification, redistribution, or bundling. “Free download,” public access, or a search result does not establish permission. If rights are unclear or incompatible with the user's stated use, do not bundle the file; report the uncertainty and use a permitted alternative. Preserve attribution in the project where the license requires it.

Compare candidate assets against the task's known features before choosing: silhouette and proportion, visible parts, scale and orientation, material appearance, animation or rig requirements, texture resolution, geometry density, expected file size, and the final camera distance. Reject a candidate that only matches its thumbnail or subject label but fails the visual or technical requirements. Do not represent a sourced generic object as the user's product or a real business's own item.

## 3. Inspect the complete asset before integration

Inspect the actual `.gltf` or `.glb`, not only its preview. For JSON glTF, check that every referenced buffer and image exists at the expected relative path and remains deliverable with the project. GLB can package content into one binary file, but still inspect its internal scenes, nodes, meshes, materials, textures, animations, and extensions. Keep required companion files together when they are not embedded.

Read the asset version and `extensionsUsed`/`extensionsRequired`. Confirm the installed Three.js version and loader support each required extension. A compressed asset may require a matching decoder or texture loader and a correct decoder path at runtime; do not assume `GLTFLoader` can decode every extension without configuration. Add only the loaders the selected asset actually needs. Check network origin, path casing, MIME and CORS behavior through the real preview route; avoid proxying third-party files to hide a broken source.

Use glTF's documented coordinate system as the baseline—right-handed, meters, +Y up, with +Z forward—and verify the model in the actual scene. Preserve its transform hierarchy where meaningful. Check world bounds, scale, pivot, facing, ground/contact position, parent transforms, and animation roots; correct a mismatch deliberately and document the conversion rather than stacking unexplained rotations or scale multipliers onto the scene.

Review mesh and material integrity: expected mesh count, missing parts, transparent surfaces, double-sided or inverted faces, normals, UV sets, tangents when needed, texture references, PBR properties, alpha modes, emissive areas, and animation clips. Check texture color-space handling against the installed renderer. Never silently replace missing maps with a misleading color or remove a needed material feature to make the model appear to load.

## 4. Optimize only for a measured constraint

Record the asset's actual transfer size, texture dimensions, mesh or primitive count, and relevant geometry statistics when available. Distinguish download size from decoded CPU/GPU memory and render cost. Set a target based on the requested device and scene, not an invented universal budget.

Prefer the least destructive fix that addresses the observed bottleneck: remove unused scenes or maps, reduce oversized textures to their displayed detail, simplify hidden geometry, reuse repeated resources, or use a supported mesh/texture compression path. Preserve important silhouette, thin details, normal quality, material response, animation, and required metadata. Compare before and after visually in the target scene; the smallest file is not automatically the best asset.

Use Draco or Meshopt geometry compression, or KTX2/Basis texture delivery, only when the actual asset and target justify it. Check the current Three.js loader documentation and the asset's declared extensions, configure the matching decoder/transcoder, ensure decoder assets are packaged and reachable, and test the same production URL/path the site uses. Compression may reduce transfer size while leaving substantial decoded memory use; report those measures separately when measured. Do not add conversion packages, workers, or CDN dependencies just to claim optimization.

## 5. Validate structure, rights, and rendered fidelity separately

When available in the project or environment, validate glTF/GLB structure with the Khronos glTF Validator and resolve errors relevant to the target runtime. If the validator is unavailable, say it was not run; do not add a large toolchain solely to produce a green validator result. A validator report checks conformance, not visual accuracy, source rights, mobile performance, or whether Three.js can load every optional extension.

Load the chosen asset through the actual application loader. Confirm the model and all required companion files load without errors, its expected parts and animations exist, and no browser requests fail. Inspect the rendered model in context at the intended camera and viewport sizes. Compare against the original source or user reference at the same view, and check scale, silhouette, orientation, crop, material response, shadows, and seams. A model viewer thumbnail or a valid GLB is not proof that the website renders it correctly.

If an asset changes, use fresh preview evidence for that asset. Report the canonical source and license, what files were included, any conversion or optimization actually performed, which validation and viewport checks actually ran, and remaining approximations. Do not claim exactness, license clearance, or performance from a successful load alone.

## Primary references

- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) for format, coordinate conventions, scene hierarchy, transforms, materials, and extensions.
- [Three.js GLTFLoader documentation](https://threejs.org/docs/pages/GLTFLoader.html) for the installed runtime's loader and extension-decoder requirements.
- [Khronos glTF-Validator](https://github.com/KhronosGroup/glTF-Validator) for structural conformance checks.

Always check the documentation for the versions actually installed. Supported formats and optional decoders can change; do not infer runtime support from a model page or an outdated code sample.
