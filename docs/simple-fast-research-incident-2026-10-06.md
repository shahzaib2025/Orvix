# Fast research incident fix — 2026-10-06

The progress-speech implementation described below was subsequently replaced by [generated streaming acknowledgments](fast-generated-acknowledgments-2026-10-06.md). This document records the earlier research incident and its original validation.

The supplied conversation performed eight differently worded searches, read no source pages, and later supplied a model comparison on an unclear follow-up despite the earlier retrieval failure. The active runtime is `src/simpleFastVoice.ts`.

## Changed behavior

- A natural request for current Google/OpenAI models reads each required vendor's known API catalog through the existing sequential speech/tool queue. There is an explanation before each actual read. Search proposals receive the actual retrieved pages instead of triggering another catalog search.
- General research still uses search and page reads. Query paraphrases share a two-search budget per subject; publisher restrictions follow the query subject during model research. Ordinary Google company research remains unrestricted.
- Catalog reads have a bounded retry allowance, successful reads are reused within that request, and independent sources are attempted before retrying a failed source. Model tool proposals also count toward the existing cumulative limit, including rejected proposals.
- Follow-ups retain original source excerpts and whether the required original pages were read. That status establishes source coverage, not that every comparison claim has been proven. New requests for current information and explicit rereads require fresh reads.
- Unclear references ask a focused clarification. An earlier failed comparison cannot become a confirmed comparison on the next message. Invented numeric GPT/Gemini versions absent from retrieved bodies are rejected. Conversational Hindi uncertainty gets no generic promise to perform work.
- The model is instructed to describe each model separately, distinguish API catalogs from app availability and release chronology, and report missing information. This is a source guard and prompting improvement, not exhaustive semantic verification of every generated claim.
- Speech remains buffered and checked before playback. A missing transcript is logged separately from an altered transcript or missing audio. Neither transcript problem disables the next explanation's voice attempt. Installed speech remains the fallback; if no suitable voice works, the complete written explanation is shown with a visible notice. Completed work is not rerun to repair audio.

## Validation

`npm run check:fast-reliability`: **296 tests passed**, plus browser integration, AudioWorklet and Web Audio checks. The active Simple Fast suite contains **54 tests**, including natural catalog comparisons, premature ungrounded drafts, failed catalog recovery, paraphrased search limits, independent sources, evidence continuity, ambiguous follow-ups, invented versions, and missing speech transcription.

`npm run build`: TypeScript and Vite build passed. Vite retains its existing large-chunk warning.

Two separate six-turn conversations used the real configured Live provider and real public page retrieval, with the original natural request and ambiguous follow-ups. No URL hints were inserted into the comparison request. Both used **two sequential original-page reads and zero actual searches**. All six final reports in each run completed with counted PCM. The clear follow-up reused the retrieved sources; the ambiguous follow-up asked what the user meant. Source checks confirmed the named model versions appeared in the actual retrieved catalog bodies. These runs are a focused incident replay, not the earlier proposed 50-request production benchmark.

The second run's machine audit passed:

| Check | Result |
| --- | --- |
| All six final reports finished | Pass |
| Actual operations had prior explanations and maximum concurrency one | Pass |
| Natural comparison read both catalogs | Pass |
| Unclear follow-up asked for clarification, with no execution | Pass |
| Conversational Hindi had no work promise | Pass |
| Final reports included PCM audio | Pass |
| Explanations requiring written fallback | One |

The first replay also had one written-only explanation. A separate renderer probe obtained PCM without any transcription for two sentences and an altered spelling for another; those buffers were rejected. Provider transcription/speech availability is therefore still a material limitation. The initial replay also grouped two Google models under broad wording; the final prompt now requires each model's purpose separately, and the second replay separated those descriptions. This does not establish that all future generated claims will be exact.

Google's [LiveServerContent reference](https://googleapis.github.io/js-genai/release_docs/interfaces/types.LiveServerContent.html) describes transcription as independent of the model turn. Missing or mismatching text cannot establish that rendered audio says the intended explanation, so the app continues to reject it rather than treat audio presence as proof.

## Evidence and scope

- `scratch/simple-fast-incident-live.first-report.json`: first six-turn replay.
- `scratch/simple-fast-incident-live.report.json`: second six-turn replay and audit.
- `scratch/catalog-speech-check.json`: separate speech/transcription probe.
- `scratch/fast-incident-reliability.log`: complete reliability run.
- `scratch/fast-incident-build.log`: build output.

Live conversations used typed input and counted PCM, not physical microphone capture or speakers. Browser checks used synthetic PCM and microphone input. The packaged Windows application was not tested in this incident pass. Full audible reliability and production readiness are not established by these checks. Restart Orvix and start a new Fast voice session to load the updated runtime.
