# Fast result delivery

Read-only searches and page reads return their checked result to the active Live
session while acknowledgment audio is playing. The normal pump still serializes
actions and approval handling. Multiple calls in one batch use the ordered path.
Call IDs submitted early are settled once; new calls after that result belong to
the next step, not the original batch. Interruptions retain outcomes without replay.

Full receipts remain in memory. Provider copies select up to 5,000 characters of
page passages and eight search results with up to 1,000 characters per snippet.
Every cut is marked. URLs, status, source metadata, uncertainty, and approval data
are retained. Repeated successful identical reads/searches reuse current-turn
evidence; different offsets, queries, and subsequent turns remain fresh.

Early speech accepts a complete prefix of sentences literally supported by
retrieved excerpts. It uses a separate reusable voice renderer, validates its
speech transcript, and queues playback after any acknowledgment. Translations,
interpretation, actions, uncertain outcomes, missing requested pages, and pending
plan parts remain buffered. This is deliberately conservative, not a general
semantic fact checker. It does not guarantee every Bangla search answer streams.
Delivered prefixes share one transcript entry and are not replayed by the final
report. The unused full-answer provider audio is discarded when a prefix played.

Terminal timing records distinguish local checking, result submission, first
provider audio after a result, sentence rendering, usable-audio buffering, answer
preparation, and playback. Submission means the local SDK call, not a provider
receipt. The waiting label becomes "উত্তর তৈরি হচ্ছে…" after the local check.

Under-one-second total startup remains a measurement target, not a guarantee.
Sentence speech can require a separate rendering request; its duration is logged.
Actual provider and physical microphone/speaker latency must be measured apart
from compilation success.
