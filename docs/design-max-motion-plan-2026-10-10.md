# Design MAX, Design Medium and Default: research and implementation plan

Date: 10 October 2026, Asia/Dhaka. Status: the original profile/motion plan remains pending. A later user-authorized instruction-only update is implemented in the shared website guidance and website skill; no profile, tooling, dependency or generated-site changes are included.

## Latest instruction-only scope

The user subsequently requested autonomous fresh concepts with fewer verification demands. This supersedes the proposed design-fingerprint/history mechanism and separate originality acceptance workflow below: do not implement those mechanisms. Use available prior examples as lightweight context only. The shared instructions now explicitly require the agent to invent a subject-specific concept and implementation approach for an open brief, with no fixed section recipe, mandatory visual style, or recurring animation pattern. No additional review pass, motion-verification tooling, or exhaustive checklist is added by this update. Existing runtime checks remain separate. The remaining profile/motion architecture below is a historical proposal, not authorization to implement it in this instruction-only change.

## Intended result

Design MAX should produce an original scrolling experience with intentional visual storytelling, attractive section compositions, purposeful animation and strong mobile behavior. The requested example is a pinned viewport scene: the section stays in view while continued page scrolling changes central text, imagery or graphic elements, then releases into the following content. This uses normal page scrolling; it does not require the browser Fullscreen API.

The user-facing choices will be **Default**, **Design Medium**, and **Design MAX**. Default runs the existing normal website-design skill. Medium replaces the current Fast design option. MAX replaces the advanced design option. These names apply to website design and must not rename Orvix's separate Fast voice profile.

## What the current structure is missing

Repository inspection confirms:

- The existing selector offers Balanced, Fast, Thorough and Off. It stores `designReviewMode`, not a distinct creative profile.
- Direct and native builders receive the same `websiteDesignGuidance`. The options mainly change review behavior; renaming them alone would not create richer sections or motion.
- The current guidance encourages signature moments but treats substantial motion as optional. It has no explicit storyboard or pinned-scene acceptance requirement.
- Browser workflow `scroll` calls `scrollIntoViewIfNeeded`. It does not sample the progress of a pinned scene or its entry, middle and exit.
- Static preview screenshots use `animations: 'disabled'`. They are useful layout evidence but cannot establish the intended animation sequence or its smoothness.
- The previous exploratory benchmark approved all three Balanced candidates without triggering revision. The supervising assessment still found visual weaknesses. A generic visual approval therefore cannot be the only MAX acceptance check.

## Research and technique selection

**Recommended starting point: GSAP + ScrollTrigger for complex scenes.** The official API supports pinning elements over a scroll range, linking timelines to scroll progress, sequencing transitions and recalculating positions on resize. This directly matches the requested pinned text/image sequence. It is a recommendation based on capability, not a benchmark proving it is always the fastest implementation. [ScrollTrigger documentation](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)

Use `gsap.matchMedia()` to configure desktop, mobile and reduced-motion variants and revert animation setup when conditions change. React sites also need cleanup on unmount/navigation. [Responsive setup and cleanup](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/)

**Use CSS sticky and simple CSS/WAAPI transitions when enough.** Sticky layout can hold a scene while its enclosing narrative scrolls. Choose this for a simple comparison or short chapter sequence when a full timeline is unnecessary. Inspect ancestor overflow and available container height when diagnosing sticky behavior. [CSS positioning reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position)

**Use native CSS scroll timelines as progressive enhancement.** They connect animation progress to scrolling, but MDN currently marks `animation-timeline` as limited availability. Feature detection and a readable fallback are necessary; do not make it the sole mandatory engine across unspecified browser targets. [Compatibility and behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation-timeline)

Prefer transform and opacity where practical; investigate layout/paint-heavy effects and avoid applying `will-change` indiscriminately. Motion smoothness must be observed in the rendering environment. [Animation performance guidance](https://web.dev/articles/animations-guide)

Provide a reduced-motion presentation with every chapter and action accessible. W3C's Animation from Interactions guidance addresses disabling nonessential interaction-triggered motion; this is not a claim that a single preference check establishes complete accessibility. [W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

GSAP also publishes official agent guidance. Evaluate it as an optional focused reference for generated projects that actually use GSAP; do not install it or inject its complete content into every Orvix task during this planning phase. [Official GSAP skills](https://github.com/greensock/gsap-skills)

## Profile behavior

| Choice | Creative behavior | Motion expectation | Initial review policy |
| --- | --- | --- | --- |
| Default | Existing normal website skill and requested project conventions | Ordinary interaction feedback; add explicit user-requested motion | Existing technical/browser checks, no extra automatic critic |
| Design Medium | More deliberate section rhythm, tailored transitions and one memorable interaction | A lightweight sequence or interactive section on a substantial marketing site; pinning when useful | Builder checks actual motion states; no automatic independent critic |
| Design MAX | Strong subject-specific concept, a section storyboard, expressive composition and coordinated visual storytelling | At least one substantial signature scene for a substantial showcase/marketing build, with supporting transitions; pinning is the default candidate when it fits the story | One bundled independent review; at most one targeted revision, followed by fresh evidence |

These are proposed policies. Explicit user requests override general profile preferences. A small edit, dashboard or faithful recreation should preserve its scope rather than automatically acquire a cinematic landing page. When the user explicitly asks for a pinned sequence, its working entry, progression and release become acceptance requirements.

Default remains the normal skill; it is not a low-quality mode. Medium and MAX must change builder instructions and acceptance requirements, not merely the number of reviews. MAX does not mean maximum dependencies, maximum animation count or unlimited polishing.

## The MAX instruction contract

### Fresh design requirement for every new website

User clarification: every new website must receive a fresh design rather than a repeated template. This applies to Default, Design Medium and Design MAX; the profiles change creative depth and motion complexity, not permission to recycle a page design.

- Develop a subject-specific visual concept before building. Decide the hero composition, typography hierarchy, section geometry/order, imagery treatment and interaction language from the actual brief.
- Do not reuse a fixed hero/features/cards/testimonials/footer composition, or treat a color/font/copy swap as a new design. Choose each section because the content and user journey need it.
- For substantial builds, consider a few concise concept directions and select one with a concrete reason. Keep this lightweight in Medium and Default; do not generate multiple full websites merely to choose a direction.
- Keep a compact design fingerprint for completed new-site builds: concept, hero silhouette, section sequence/compositions, typography roles, asset treatment and signature interaction. Compare with a bounded set of available recent fingerprints before committing to the next design. If the overall composition repeats without a brief-driven reason, change the concept and affected sections before delivery. This requires a future local history mechanism; none is implemented in this planning update.
- References guide quality and individual techniques; do not reproduce their complete page composition. Reusable accessible controls, layout primitives and animation utilities are allowed, while the overall art direction and page composition must be designed for the brief.
- For revisions to an existing site, retain its approved identity unless redesign is requested. Honor explicit requests for a template, faithful recreation or an established brand system.

Add originality to the acceptance review: identify the site's specific concept, inspect repeated section patterns within the page, and compare available recent designs. A repeated template composition is a design failure even if its code and animations work. When history is unavailable, report that limitation; do not claim comparison occurred or promise worldwide uniqueness. The requirement is fresh design decisions on each new build, supported by review and revision.

Before a substantial build, record a compact storyboard alongside the existing design brief:

1. Audience, main action, content, references and available assets.
2. The page's section sequence, with the purpose and composition of each section.
3. The signature scene: what stays in view, what changes, and why that change explains the subject.
4. Entry, intermediate and exit states, reverse-scroll behavior, and the expected visible content in each.
5. Mobile composition, reduced-motion presentation and a way to reach subsequent content normally.
6. The selected implementation technique and the browser evidence needed to verify it.

Proposed core instruction:

> For a substantial Design MAX showcase website, design an original scrolling narrative with at least one meaningful signature scene. Storyboard the section before implementing it. Where appropriate, keep a viewport-sized composition in view while scroll progress changes central copy, media or graphic layers, then release naturally into the following content. Tailor the scene to the actual subject and assets. Compose supporting sections with varied rhythm and purposeful transitions. Verify the scene at multiple real scroll positions, in reverse, on mobile and with reduced motion. Preserve working actions and the requested scope.

Do not require the same pinned section on every site. Vary the story, media, silhouette, content order and transition language. Reusable technical animation helpers are acceptable; repeatedly reproducing the same page composition with different colors is not the goal. Logos must come from supplied/verified assets or clearly identified fictional demonstration content.

## Example scenes for the three previous briefs

| Brief | Proposed signature scene | Supporting section ideas |
| --- | --- | --- |
| AUREL fragrance | Bottle held centrally; scroll moves through raw ingredient, composition and finished scent, changing copy and material imagery | Layered ingredient composition, collection image reveal, tactile detail sequence |
| Signaldesk SaaS | Product interface stays in view; an incident progresses through signal, diagnosis and resolution with synchronized explanation | Interactive before/after comparison, expanding workflow details, responsive product demonstrations |
| Mira Sen portfolio | Project artwork or typographic composition holds while project chapters reveal concept, system and application | Art-led project transitions, editorial collage, interactive case-study reveals |

These are illustrative storyboards, not fixed templates. Each new brief should receive fresh decisions. Medium can use a short, lightweight version; MAX can use a richer sequence where content and assets support it.

## The requested pinned-section behavior

| Scene progress | Visible result | Required observation |
| --- | --- | --- |
| Entry | Scene settles into the viewport; first chapter is readable | Correct positioning and usable navigation |
| Early progression | First media/copy state transitions to the next | Actual visible content changes |
| Middle | Second chapter and corresponding media become dominant | Text and media stay synchronized |
| Late progression | Final chapter completes the story | No overlapping unreadable text or intercepted controls |
| Exit | Scene releases into the next section | Scrolling continues and subsequent content is reachable |
| Reverse | States progress back coherently | No stale images, duplicated listeners or stranded pin |

Use a finite scroll distance chosen for the content, with a shorter mobile version or a vertically stacked chapter presentation. Keep semantic content available without requiring decorative motion. Design around mobile browser viewport changes and check anchors, keyboard focus and image/font loading before declaring the sequence complete.

## Architecture changes to implement later

1. **Add a creative profile registry.** Introduce a validated `designProfile` with `normal`, `medium`, `max`. Keep review policy separate so creative behavior is not accidentally determined by review count.
2. **Route the selected profile consistently.** The direct model client, native initial builder, native revision and acknowledgment retry must use the same resolved profile. Resolve normal skill plus the selected additions once, avoiding duplicate long instruction blocks.
3. **Update the selector and persistence.** Show Default, Design Medium and Design MAX. Use a versioned preference key. In accordance with this request, first use of the new preference defaults to Normal; preserve old records and the policies of already-running/resumed tasks. For historical display, old Fast corresponds to Medium and old Balanced/Thorough to MAX. Old Off corresponds to Normal. Do not rewrite historical evidence or silently change access permissions/model routing.
4. **Persist per-turn profile and storyboard.** Store them with task context, checkpoints and verification. Unknown values must fail validation or resolve through an explicit documented compatibility rule.
5. **Give the critic profile-specific criteria.** For MAX, inspect storyboard fit, section variety, observed motion-state sequence, assets, mobile composition and primary actions. Flag a static ordinary layout as a mismatch when the task requires the signature scene. Judge only visible evidence; request missing frames rather than inventing motion behavior.

Expected touchpoints: `src/components/AgentDashboard.tsx`, `src/components/AgentVerificationResult.tsx`, `src/desktop.d.ts`, `electron/main.cjs`, `electron/agent/model-client.cjs`, `opencode-agent.cjs`, `engine.cjs`, `website-design-guidance.cjs`, `skill-library.cjs`, and `design-review.cjs`.

## Motion verification capability

Extend the existing browser tooling with bounded motion inspection rather than giving the model arbitrary evaluation code:

- Scroll to measured offsets or normalized positions in a named section; retain actual scroll coordinates.
- Capture labelled checkpoints with animations enabled, using bounded settling waits.
- Record the scene's bounding box, visible copy, relevant image sources, computed visibility/transforms and observed active chapter.
- Assert entry/progression/release and reverse progression. Test native wheel/keyboard interactions as well as programmatic positioning.
- Recheck after viewport changes and with reduced motion. Include the full initial/restored page when a state hides content.
- Limit viewports, frames, duration, output size and cancellation latency. Keep workspace, loopback and permission restrictions intact.

An `active-scene` attribute alone is not proof that the image or text visibly changed. Several screenshots prove sampled states, not continuous smoothness. Add an optional short bounded recording and performance trace for the signature scene; describe frame observations and long tasks honestly rather than claiming 60 FPS from page-load metrics. Recording itself can affect measurements.

Likely tooling touchpoints: `browser-workflow.cjs`, `preview-website.cjs`, `tools.cjs`, `visual-mcp.cjs`, browser evidence handling in `engine.cjs`/`opencode-agent.cjs`, and their existing check scripts. A dedicated motion capture mode can keep static layout capture stable.

## Dependency and speed policy

Use the generated project's current stack and available animation system first. For a complex pinned sequence, permit a justified GSAP dependency in that project when its constraints allow installation. Do not add it globally to Orvix merely to make the agent capable of generating GSAP code. Keep the generated project runnable from declared dependencies; avoid undeclared CDN dependencies.

Do not make smooth-scroll replacements, WebGL, 3D, video scrub or heavyweight text splitting mandatory. Start with one motion engine, one signature sequence and a few supporting effects. Reuse the managed preview through revisions, inspect locally, and send one bounded evidence bundle to the critic. MAX has more work than Medium; no instant-generation promise follows from changing the name.

## Implementation order and acceptance

**Phase 1 — profiles and instruction contract.** Add the three names, state migration, direct/native routing and storyboard guidance. Verify Normal does not receive MAX-only demands; Medium/MAX differ in actual builder instructions; resume and retry retain the chosen profile.

**Phase 2 — motion evidence.** Add scroll-position checkpoints, visible-state observations and cancellation bounds. Use a disposable pinned-section fixture to prove entry, three distinct stages, release, reverse scrolling, mobile reconfiguration and reduced-motion content access. A renamed selector is not completion of this phase.

**Phase 3 — reviewer and delivery gates.** Require the requested signature scene and primary actions to be observed. Keep one independent review and at most one targeted revision initially. Report unavailable motion evidence as unavailable. Preserve readable layout checks and fresh post-edit captures.

**Phase 4 — live design comparison.** Reuse luxury/SaaS/portfolio briefs with explicit motion requirements and supplied assets where needed. Compare Medium and MAX using the same model/brief within each pair. Retain source, storyboard, motion checkpoints, failures, usage and elapsed time. Inspect section originality and transitions in addition to screenshots. A small exploratory sample is not a guarantee of consistent premium results.

Completion requires meaningful motion and section composition in actual generated pages, verified scroll progression and exit, usable mobile/reduced-motion behavior, preserved application flows, and transparent performance/latency evidence. No implementation is included in this plan.
