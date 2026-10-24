# Fast research wording and acknowledgment fixes — 2026-10-09

Three confirmed problems were addressed with targeted instructions and local delivery safeguards. There is no additional AI review call.

## Changes

- Retrieval failures or irrelevant search hits cannot establish public absence. Known absolute absence wording is withheld and replaced with a statement limited to the retrieved sources. A missing competitor comparison remains unknown.
- Comparisons must attach capabilities to exact model versions and the same documented dimension. Local checks withhold known publisher-wide priority/superiority wording, unscoped model capability sentences, and common capability terms that are absent from that exact model's excerpt. Reasoning evidence for GPT cannot support a Gemini workflow description. These checks are conservative and are not an exhaustive semantic fact verifier.
- Comparison/competitor/best-model responses remain buffered for the local wording check. If wording changes, original uncorrected PCM is discarded; the corrected text is spoken. Ordinary conversation streaming and the single-tool result loop remain intact.
- Page-read and web-search acknowledgment contexts specify their actual action. Research PCM waits for compatible transcript wording; an incomplete “I’m” prefix cannot release audio. An action mismatch gets one fresh repair before playback. A repeated mismatch fails rather than playing the wrong speech. Neutral brief acceptance remains allowed; acknowledgments are generated, not preset.

Modified production files: `src/fastResearchClaims.ts`, `src/simpleFastVoice.ts`, `src/simpleFastFlow.ts`, `src/fastProgressVoice.ts`. Added focused tests in `scripts/check_fast_research_claims.cjs`, included through `package.json`; live harness adds repeatable research prompts and captures generated versus delivered wording.

## Live findings and refinements

Initial live retest corrected the absence claim to: “I could not identify documented competitors for Florian BD from the retrieved sources, so the comparison remains unknown.” Unrelated competitor-directory and medical-company hits did not support a Florian BD comparison. The Bangla follow-up also scoped its statement to the sources.

The first comparison retest still generalized catalog descriptions to provider-wide selection criteria. Requiring exact named models corrected that. Another retest produced “enterprise reasoning” for Gemini from an excerpt documenting enterprise workflows, so an entity-specific capability check was added and tested against that counterexample.

The latest model retest delivered:

> Gemini 3.8 Flash is engineered for long-horizon software engineering and complex enterprise workflows. GPT-6 Astra is chosen for demanding tasks that require complex reasoning and coding capabilities.

Those descriptions match the retrieved Google and OpenAI excerpts. Its Bangla retained-information follow-up kept the same model-specific capabilities. The best-model answer declined to establish an overall winner from those pages. All four page reads in this three-turn retest received reading acknowledgments; its retained-information turn performed no new retrieval.

Evidence sources: https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models. The quoted model descriptions are the retrieved test evidence; this report is not an independent latest-model survey.

## Validation

- 65 focused tests passed, including English/Bangla action mismatch, audio-before-transcript, one bounded repair, unchanged source-supported facts, discarded unsafe PCM, exact model scope and cross-model capability contamination.
- Actual Chromium Web Audio fixture passed; dispatch followed synthetic audio onset by 0.7 ms while playback remained active.
- Production build passed with existing chunk-size warnings.
- Four iterative live-provider conversations completed 16 turns total. The earlier retests exposed issues and informed subsequent fixes; they are not all successful accuracy results. The latest three-turn model retest completed without tool ordering or delivery failures.
- The final best-model buffering expansion was fixture-tested after that live run. Live tests used typed prompts, real Gemini and online retrieval, with mocked playback callbacks. Physical microphone/speaker and packaged Windows app behavior were not verified.
- Corrected speech can take longer because an invalid acknowledgment requires repair or an invalid final answer requires rendering corrected text. No sub-second guarantee or general production-readiness claim is made.

Audit: `scratch/fast-research-fixes-audit-20261009.json`. Full live records: `scratch/simple-fast-live.research-fixes-final-20261009.report.json` and `scratch/simple-fast-live.research-capability-guard-20261009.report.json`. Tests/build logs: `scratch/fast-research-fixes-final-tests.log` and `scratch/fast-research-fixes-final-build.log`.
