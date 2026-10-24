# Bundled topic skills

Implemented 2026-10-10.

## Execution flow

Initial Chat, Responses, Messages and native OpenCode execution prompts receive the four entries from `electron/agent/skills/registry.json`, plus compact design-profile and specialty settings. They do not receive the topic instruction bodies. The agent chooses relevant skills before substantial work, can combine them, and reconsiders relevance on steering or a follow-up. There is no prerequisite gate, classifier call, additional server or new UI control.

Direct routes use the existing `list_agent_skills` and `read_agent_skill` tools. Native OpenCode uses its existing `read` tool with the registered absolute path. Greetings and independent reviewers receive neither this catalog nor execution skills.

## Authoritative files

- `electron/agent/skills/website_design/SKILL.md`: existing frontend guidance, Normal/Medium/Max sections and optional 3D guidance.
- `electron/agent/skills/bug_repair/SKILL.md`: reproduction, focused repair and regression guidance.
- `electron/agent/skills/refactor/SKILL.md`: interface preservation, semantic navigation and verification.
- `electron/agent/skills/research/SKILL.md`: source gathering and evidence-based reporting.

Edit these Markdown files to update topic guidance. The old website/profile exports are compatibility readers of the same Markdown source. General permissions, evidence, verification and truthful reporting remain in core instructions.

## Loading and evidence

The lazy loader validates the registered ID and regular file, caches by filesystem metadata and computes a SHA-256 content hash. Changed files are refreshed; missing, empty or unreadable files produce explicit errors. Catalog generation does not read skill bodies or open/index a project.

Successful reads record ID, content hash and evidence ID in task memory. Full selected content is retained in regular task checkpoints and compaction summaries. Duplicate reads reuse the selection; actual tool outcomes remain independently archived. Native reads count only when the completed output contains the full registered content. Failed or partial reads never mark a skill loaded.

Recovery checks compare previously observed hashes with current registered content. Changed or missing skills are marked stale with a reread instruction, preserving the earlier evidence record without presenting old content as current guidance. Native sessions retain selected instructions across internal revisions/retries. Native automatic replay remains prohibited when action outcomes are unknown.

## Native permissions and packaging

Only exact registered Markdown reads and their necessary external-directory access bypass project registration. The managed folder grants no project-write access. Native edit/write/apply_patch, glob/grep and unregistered reads in the managed directory are rejected. Shell commands directly targeting managed paths are rejected; existing host command and workspace policies still apply elsewhere.

OpenCode skill-tool access is denied and external skill discovery is disabled through runtime flags. Automatic native context pruning/compaction remains disabled. `electron-builder.yml` unpacks `electron/agent/skills/**`; the presence configuration inherits it. Native paths under `app.asar` resolve to `app.asar.unpacked`.

## Validation

Focused checks cover all provider prompt shapes, selected instructions, four task topics, combined/unrelated tasks, greetings/review exclusions, settings, cache reuse/change/missing cases, tool evidence, duplicate reads, compaction/recovery, native permission modes and an actual ASAR unpack fixture.

Results: 69/69 focused checks and 109/109 broader agent checks passed. These include fixtures and bounded browser checks; they are not live provider acceptance.

Commands:

```text
node --test scripts/check_agent_skills.cjs scripts/check_opencode_headless.cjs scripts/check_agent_foundation.cjs scripts/check_design_profiles.cjs scripts/check_agent_speed.cjs
npm run check:agent
```

Measured locally: execution catalog 1,346 bytes; native catalog 1,843 bytes; full website skill 22,050 bytes; complete initial execution instructions 12,696 bytes. One fixture run measured roughly 1.2 ms for a cold skill read and 0.95 ms per cached read. These are local loader measurements, not provider latency or guaranteed first-word timings. Skill selection can require a tool round trip.

No live provider run or full packaged Orvix application launch was performed for this change. The packaging check creates an ASAR fixture and reads the real unpacked Markdown files. Restart Electron to load the changed main-process code.

