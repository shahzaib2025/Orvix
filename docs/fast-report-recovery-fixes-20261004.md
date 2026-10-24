# Fast report recovery fixes

Investigation began on October 3, 2026; validation continued on October 4 (Asia/Dhaka).

## Findings and changes

- Local interruption could retain a completed tool result without arming recovery. Interrupted work now keeps a response timer. An absent server interruption boundary triggers one fresh connection with the saved ledger/evidence, invalidating callbacks from the old connection. Old function IDs are restored as context rather than sent to a new socket. Recovery cannot repeat tool effects.
- A discarded server turn boundary could clear the only response timer. Recovery remains active until an accepted reply or an explicit unfinished delivery report. Missing confirmation audio also keeps its timer.
- English and Bangla report/status questions could replace the task. Whole-utterance intent rules now preserve its ID, epoch and retained evidence, while distinct topics and explicit cancellation retain their existing behavior.
- A blocked review could reduce speech to a generic incomplete-task sentence. The spoken report now includes controller-approved findings, explicit unknowns, observed execution summaries, remaining outcomes and verification obstacles. Rejected completion claims and unsupported facts are excluded. If audio recovery ultimately fails, a visible report is emitted with interrupted delivery.
- Terminal reports were being audited again after an explicit review, using coverage quotes from a different draft. An explicit terminal review now controls delivery without an additional audit of its derived status report.
- The old 2,000,000-character confirmation audio buffer could discard reports longer than about 31 seconds. The bounded buffer now allows 180 seconds of 24 kHz, 16-bit mono PCM (11,520,000 base64 characters). Overflow still rejects the audio and records a content-free diagnostic.
- Named BD business searches now reject coincidentally named repository/personal-profile results. Explicit software queries retain matching repository sources. Bangladesh marketplace queries reject explicitly foreign rankings that lack Bangladesh coverage.

## Automated validation

- `npm run check:fast-reliability`: 157/157 Node tests passed, followed by browser integration and real Web Audio/AudioWorklet checks.
- Synthetic AudioWorklet interruption: 1 ms detection-to-clear, 78 ms synthetic onset-to-clear; capture continued. This does not measure physical microphone or speaker echo.
- Web Audio acknowledgement delivery waited for both scheduled buffers to drain.
- `npm run build`: passed. Existing large-bundle warnings remain.
- Regressions cover stuck retained results, absent server boundaries, bounded recovery, old call IDs, preservation of report requests, terminal explanations, rejected success claims, long confirmation audio and source relevance.

## Live validation

The intermediate two-turn real Gemini Live run uncovered missing audio for both reports. Both report texts were retained; one replay's transcript matched the expected text, exposing the too-small audio buffer. The direct domain lookup successfully read `https://florianbd.com/`. The evidence reviewer reported HTTP 429/403 and did not confirm the research as complete.

The final two-turn live run is recorded in `scripts/check_fast_long_conversation.report-recovery-final-20261003.report.json` and its matching Markdown transcript. Both final reports were delivered with PCM audio: turn 1 in 143.306 seconds (5 model tool calls, 6 underlying search queries), turn 2 in 80.785 seconds (3 model tool calls, 1 search query and 1 direct page read). Their research execution remained blocked, as the reports explicitly stated. All recorded production-source hashes matched the final files.

The overall conversation harness still returned `issues_found`: turn 2 could not establish the supplied domain's business identity in its final answer because independent evidence verification remained unavailable (HTTP 429/403). Report delivery succeeded; this is not full research-task acceptance or a production-readiness claim. The live tests use text input and count received/admitted PCM; they do not use a physical microphone or audible speakers.

Models, voice, worker opt-in settings, approval requirements and immediate user barge-in remain unchanged. Packaged Windows and physical speaker/microphone acceptance are not established by these checks.
