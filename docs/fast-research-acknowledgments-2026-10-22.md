# Subject-specific Fast research acknowledgments

The first search can retain its immediate short acknowledgment, such as “তথ্যটা খুঁজে দেখি।” Later web searches and page reads in the same task use fresh generated speech naming the actual next subject/source and action. They cannot use the generic bundled clip or repeat the preceding acknowledgment verbatim.

The existing sanitized operation context supplies the subject; page content and URL query parameters are not used as speech instructions. Known source labels include GPT/OpenAI and Gemini/Google. Reading and searching remain distinct. Missing subjects or repeated wording get one subject-specific repair before playback. The installed-voice failure path also names the subject. Existing tool dispatch, cancellation, approvals, and audio-onset ordering remain in place. A new user task resets this policy's per-task history. Thinking was not modified.

Implementation: `src/fastResearchAcknowledgment.ts`, `src/fastProgressVoice.ts`, `src/fastPreparedAcknowledgment.ts`, and `src/simpleFastVoice.ts`.

## Validation

- 120 targeted tests passed, including subject/action matching, repeated/generic wording rejection before audio, bounded repair, cancellation, first-search clip retention, existing speech/tool ordering, Explorer, and research regressions.
- Production build passed, with the existing large-chunk warning.
- A real Fast acknowledgment-provider run passed four cases: GPT page in Bangla, Gemini page in Bangla, and two GPT-pricing searches in English with distinct wording.
- Actual generated examples: “আচ্ছা, জিপিটি-র পেজটা পড়ে দেখছি।” and “আচ্ছা, জেমিনাই-এর পেজটা পড়ে দেখছি।”
- Earlier four-case attempts timed out, followed by a single-case pass and a four-case pass. The cause of the earlier connection silence was not established. Provider availability is not guaranteed.
- In the successful four-case run, generation completion took 3.19–6.83 seconds; first generated audio arrived at 0.99–4.47 seconds. These are generation measurements, not audible playback latency. Subject-specific speech is validated before release, so this change does not establish sub-second follow-up acknowledgments.

The live check captured PCM without physical playback and did not execute web/PC actions. Physical microphone/speaker and packaged-app acceptance remain unverified. Restart Orvix to load the renderer changes.

Evidence: `scratch/fast-research-ack-subject-tests.log`, `scratch/fast-research-ack-subject-build.log`, and `scratch/fast-research-ack-subject-live.json`. Repeat the provider wording check with `node scripts/check_fast_research_ack_subject_live.cjs`.
