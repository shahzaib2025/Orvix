---
name: diagrams
description: Create inline diagrams and interactive visual explanations in Orvix chat. Use for flowcharts, architecture, relationships, and simulations; not general website builds.
---

# Diagrams and interactive visuals

Choose the smallest format that explains the user's question. Orvix renders these formats directly from the assistant reply; no generation tool or project file is required.

For static structures and processes, return a fenced `mermaid` block. Use short, quoted labels and stable node IDs. Flowcharts, sequence diagrams, state diagrams and ER diagrams are useful choices. Split dense graphs into focused diagrams. Do not include Mermaid configuration directives, frontmatter, HTML labels, click actions or external resources. Orvix provides the theme and disables executable links. Keep below 200 edges and 40,000 characters. Close the fence: unfinished streamed blocks wait before rendering.

For visuals that need changing inputs, motion or calculations, return a fenced `orvix-visual` block containing self-contained HTML with optional inline CSS and JavaScript. The user starts it with Run visual. It runs in a sandbox with no network, Electron API, parent document, storage, external scripts, fonts or nested frames. Use inline SVG, canvas and native controls. Use data images only if necessary. Never require imports, fetch, WebSockets, navigation, downloads or host callbacks. Keep under 40,000 characters. Scope selectors to a unique root. Give controls accessible labels, make the first view useful, support 320px width, and keep essential content usable with reduced motion. The preview has a fixed height and can scroll; keep the composition compact.

Ground labels and numbers in the actual available evidence. Explain uncertainty outside the visual. Check source syntax, selected states, arithmetic and control-to-output relationships. Use existing preview tools only when a runtime/browser check is needed and authorized; distinguish those checks from simply generating source. Never claim a rendered or tested outcome without observed evidence. Do not turn a request for a diagram into a website project.

Example static reply:

```mermaid
flowchart LR
  A["User request"] --> B["Agent"]
  B --> C["Tools"]
  C --> D["Verified result"]
```

Prefer a concise explanation alongside the diagram, without repeating every node in prose.
