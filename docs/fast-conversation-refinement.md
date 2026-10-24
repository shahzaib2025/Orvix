# Fast conversation refinement

Implemented behind **Settings → Fast working capabilities → Conversation refinement**. It defaults off; enabling or disabling applies to the next voice session. The current voice, PCM buffering, 600 ms silence allowance, local interruption detector, exact verified-speech gate, and Windows fallback remain in place.

The refined prompt uses professional everyday Bangla (আপনি), adaptive explanations, direct answers, useful clarifications, and meaningful progress updates. It retains authorization, task verification, research and textbook requirements. The low-level browser route remains available for explicit typing and keys; familiar operations prefer the shared executor.

Reconnects restore up to 24 messages (3,000 characters each), reply language, pending clarification, and the existing executor task. History accepts optional `delivery: complete | interrupted`; old entries remain compatible. An interrupted reply is reference context, not a completed answer or an instruction to resume. Metadata travels through persisted conversation messages. This adds no summarizer, classifier, personal-memory store, or additional model generation.

PC updates include receipt timestamps and silently refresh while listening. A received snapshot is observational context, not proof that every native field was sampled at that instant. Missing or stale state must be reobserved with available tools or reported as uncertain. It must not authorize actions.

## Automated checks

Run `npm run check:fast-conversation`, `npm run check:voice-interruptions`, `npm run check:voice-interruptions:browser`, `npm run check:fast-work`, `npm run check:voice-navigation`, `npm run check:browser`, and `npm run build`.

These check context handling, metadata, language switches, settings persistence, confirmation evidence, exact audio gating, interruption regression, and evaluation rejection paths. They do not establish real microphone accuracy or human conversational quality.

## Live baseline and release gate

`shared/fast-conversation-evaluation.json` contains 30 scenarios, each requiring five trials, for **150 baseline and 150 refined trials**. Start each independent trial with its documented setup; follow-up scenarios need their preceding topic, ambiguous references need two real candidates, and reconnect cases require a forced connection reset. Use the same machine, microphone, audio output, network conditions, and model for baseline and refined trials. Run baseline with refinement off; refined trials use it on. Alternate run order to reduce network and warm-up bias.

With the user's microphone and participation, record observed results and human ratings in local JSONL files. Do not generate acceptance data from fixtures. Raw audio and transcript capture are opt-in and unnecessary for the evaluator; reviewers can listen live and record only outcomes, timings, and ratings.

Each row has `caseId`, `trial` (1–5), `evidenceKind: real_microphone`, `reviewer`, `firstAudibleMs`, and booleans `success`, `questionsCovered`, `languageCorrect`, `reportedComplete`, `verified`, `unauthorizedAction`, `staleAudioResumed`. Current rows also require 1–5 ratings `professionalTone`, `clarity`, `coherence`, and `additionalModelRequests` (zero for ordinary conversation). Action cases with an expected completed effect require independently measured `verifiedCompletionMs` (the deliberately unavailable website is exempt); interruption cases require `interruptionClearMs`.

`success` means the scenario's oracle was met, including truthful reporting for intentionally unavailable websites. `verified` means independently observed support for the reported result; unresolved actions must have `reportedComplete: false`. First audible timing starts at the user's actual speech end, not the detector's delayed end event. Completion timing ends when the independent outcome oracle observes the effect. Interruption timing starts at detection and ends when queued speech stops. Rate professional tone (polite, restrained), clarity (understandable and appropriately detailed), and coherence (topic/correction continuity) separately.

Run `npm run evaluate:fast-conversation -- baseline.jsonl current.jsonl`. The evaluator requires full real-microphone evidence, ≥95% correct handling, complete coverage and language compliance, zero false completion/unauthorized effects/stale audio restarts, averages ≥4/5, interruption clearance ≤500 ms, and per-scenario median/p95 timing regression ≤10%.

Logs record response audio **queue** delay, Windows fallback start delay, existing tool execution timings, statuses, and interruption-clear delay, without entered text or audio in the added events. Queue delay is not audible latency: output scheduling, silence detection, and device latency still apply. Measure first audible response separately for release acceptance.

**Release status: live acceptance pending.** Keep the setting off by default until the measured evaluation passes. No live baseline, microphone trials, or human ratings are supplied by the implementation or automated checks. Rollback is switching refinement off and starting a new voice session.
