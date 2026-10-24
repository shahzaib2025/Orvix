# Design context cleanup

## Implemented

- Removed the repeated greeting-card scaffold example from Medium, MAX and the native frontend contract. Naming the unwanted design repeatedly was an unnecessary source of anchoring; its causal contribution is a hypothesis, not a proven model defect.
- Replaced forced baseline/three-concept comparisons with a concrete existing design brief: first viewport, media role, page progression and visible interaction. No extra schema, preset or approval stage.
- Shortened the native profile reminder. Selected skill files remain the detailed guidance. Default skill is unchanged; MAX retains its hero, connected layered sections, varied motion, one pinned scene, mobile and reduced-motion requirements.
- Added a metadata-only native request trace in task evidence named `native_prompt_trace`: task/session IDs, model/provider, variant, profile, history count, prompt lengths and SHA-256 fingerprints. Initial builder submissions and steering submissions are traced. No prompt contents, credentials, image payloads or seed/temperature overrides are added.

## Interpretation

Different task IDs and different native session IDs support session separation. Matching system hashes are expected for the same profile. Matching text hashes indicate identical submitted parts; different hashes alone cannot prove that prior context is absent. The trace describes Orvix's outgoing OpenCode API request, not the complete provider-resolved system prompt or hidden sampling settings. It must not be represented as a captured final model request.

Existing memory remains keyed by task ID. A focused check covers fresh-task absence and mismatched stored identity; that does not prove the UI always passes a new task ID. No user history was removed.

## Next live comparison

Use the same verified provider/model ID, thinking level, prompt and workspace conditions in plain OpenCode and Orvix, in fresh sessions. Compare the actual loaded skills, file reads, instructions and provider-resolved settings before attributing differences to memory or sampling. Keep generation duration and visual observations separate from code checks. Two samples cannot guarantee future originality.

## Scope of acceptance

Automated profile/routing, skill isolation, request trace and browser fixtures are run for this change. No new live Muse website was generated in this change; there is no claim of a permanent visual-diversity fix. Restart Orvix to load the changed agent modules and skills before the next user test.

## Validation result

`node --test scripts/check_design_profiles.cjs scripts/check_design_review.cjs scripts/check_agent_skills.cjs scripts/check_opencode_headless.cjs`: 76 passed, zero failed, about 43 seconds. Syntax checks passed for all three changed agent modules. Output: `scratch/design-context-simplification-checks.log`.

A read-only inspection of the local standalone OpenCode `opencode.jsonc` found no explicit model, temperature, top_p, seed, agent, plugin or instruction configuration; a provider configuration is present. Orvix uses its isolated built-in build agent with a 24-step budget and its own skills/tool bridge. This comparison does not establish which model or session-resolved settings the user's earlier standalone runs used. Neither inspected client configuration justifies assuming a fixed seed or temperature zero.
