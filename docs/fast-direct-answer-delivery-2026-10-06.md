# Fast final answers go directly to delivery

Current work execution: [one repeating work loop](fast-single-work-loop-2026-10-06.md). Direct final-answer delivery described here remains in effect.

The active Fast runtime (`SimpleFastVoiceSession`) no longer applies the final
controller answer-verification gate. Gemini's completed answer is delivered in
its own wording, using its existing audio when supplied.

The final stage no longer rejects or rewrites answers based on missing source
pages, model names absent from retrieved excerpts, failed lookups, unverified PC
results or pending approvals. No final speech/text comparison is needed to reuse
Gemini's own completed audio. Read-page URLs are still appended to the written
reply, and read receipts remain available for later requests.

Tool-result handling remains in the execution loop: one actual tool at a time,
fresh target requirements, existing review dialogs, uncertain-effect no-replay
protection, bounded recovery, operation receipts and results returned to Gemini.
Approvals still control execution. Gemini's instructions still require accurate
interpretation of these results and disclosure of missing information. The
controller no longer independently enforces that requirement on its final answer.

Generated acknowledgments and their playback drain stay before tool execution.
Ambiguous-input clarification, unavailable acknowledgment, work-budget exhaustion,
empty replies and connection failures retain their control-flow notices. Those
are operational/input states, not a source/claim verification stage.

Final-answer audio still uses the existing full-turn buffer. This change removes
the final-answer gate; it does not establish a one-to-two-second answer startup
or alter the microphone input path.

Verification: `npm run check:fast-reliability` passed 318 tests plus browser and
Web Audio/AudioWorklet fixtures with synthetic input/PCM. `npm run build` passed
TypeScript and Vite with the existing bundle-size warning. The affected active
Fast tests now exercise direct final delivery instead of the removed gate, while
retaining execution, recovery, approval and speech-ordering assertions. Legacy
Fast tests/helpers remain for compatibility; the active facade uses SimpleFast.

Evidence: `scratch/fast-direct-answer-reliability.log` and
`scratch/fast-direct-answer-build.log`. No new real-provider, physical microphone,
speaker, packaged Windows or latency benchmark was run for this change.

Restart Orvix and start a fresh Fast session to load the updated instruction.
