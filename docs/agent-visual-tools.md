# Orvix website visual tools

The direct Orvix API route and native OpenCode route now share local website inspection and workspace image inspection. The native route uses a task-scoped authenticated loopback MCP bridge rather than project plugins or a separate browser agent. It is connected inside the runtime's exclusive session and disconnected at completion, failure or cancellation. The bridge credentials stay out of prompts and project files.

## Available tools

- `preview_website`: existing default desktop 1440×900 and mobile 390×844 captures, plus one to four custom viewport sizes (240–2560 pixels per dimension). `full_page` captures section rhythm; `selector` captures exactly one matching section. Full-page and section captures cannot be combined and are bounded to 24 megapixels. Screenshots are JPEG copies bounded to 1 MB. A too-large capture fails with a clear error rather than silently returning no image.
- `preview_website` also reports headings, bounded element geometry/computed typography and colours, overflow, image loading, browser errors, automated axe accessibility findings and lab load metrics. These are observations, not an aesthetic score or proof of complete accessibility.
- Browser `workflow` actions include click, fill, check, select, press, hover, scroll, reload, navigate and explicit state assertions. Hover and scroll accept a unique selector. Ambiguous interactions stop. A workflow without assertions cannot pass verification. The workflow maintains one browser context within each viewport, including reload/persistence checks; viewport contexts and separate preview calls are isolated.
- `reduced_motion` emulates the user preference, with the actual media-query result reported. Static screenshots disable animations for stable captures; they do not verify motion timing or animation playback.
- `read_visual_asset`: inspect an existing PNG, JPEG or WebP in an approved workspace, including supplied reference screenshots. Canonical paths and sensitive-file checks are enforced. Original files stay unchanged; inspection copies are at most 1600 pixels on the longest side and show transparency on white. Input files are limited to 10 MB and decoded images to 40 megapixels.
- `start_preview_server`: launches a manifest-defined development command in an approved workspace. The process tree stops when the native or direct agent turn ends or is cancelled. Existing access-mode approval behavior applies.

Models advertising image input receive actual screenshot/image content, in addition to text observations. A text-only model receives measurements and an explicit visual limitation. Native browser checks are archived as evidence and distinguish captured layout, automated accessibility and supplied flow assertions. Subsequent native edits or shell commands invalidate earlier captures as current proof.

Plan mode does not expose these browser/process tools. Controlled mode can decline browser inspection or server launch before execution. The local browser accepts localhost HTTP(S) navigation without embedded credentials. External assets may load, as in the existing preview tool. This is host browser execution, not a security sandbox. No user browser profile or signed-in session is imported.

## Research and verification

Playwright's [screenshot documentation](https://playwright.dev/docs/screenshots) documents full-page and element captures; its [page API](https://playwright.dev/docs/api/class-page) documents browser inspection and interaction primitives. OpenCode's [MCP documentation](https://opencode.ai/docs/mcp-servers/) documents exposing MCP tools to the agent. The bridge follows the [MCP tools protocol](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) with Streamable HTTP JSON responses.

The installed OpenCode runtime API was inspected directly before implementation: dynamic `/mcp` registration and disconnect are supported by this installed version. A live isolated runtime connected and disconnected the bridge. A currently verified free vision model called the image tool and described the returned image as a yellow circle on a blue background, without those facts being provided in text. Results and actual token usage are stored in `scratch/visual-mcp-live/result.json`.

Run `npm run check:visual-tools` for browser, asset, MCP, native permission and lifecycle tests; `npm run check:preview` retains the existing preview/persistence regression checks. `npm run check:visual-tools:live` checks the installed runtime and an available free vision model; provider availability can change.

## Remaining capabilities

This change equips the agents to observe their website and inspect existing assets. It does not guarantee premium aesthetics. The earlier shared design instructions guide composition; further revision-loop and latency work remain separate phases. No image-generation provider, image-search service, Figma connector, public reference-site screenshot tool, persistent interactive browser session or browser trace export has been added. Existing web-search and webpage-text tools remain available for research. Generating custom artwork requires an actual supported provider or supplied assets, not a prompt claiming a nonexistent tool.

Restart Orvix to load the Electron main-process changes. A production build validates compilation, not packaged-app or end-user website acceptance.
