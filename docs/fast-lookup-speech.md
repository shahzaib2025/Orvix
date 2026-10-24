# Lookup acknowledgment and answer playback

The Fast session prepares one short, transcript-validated generic lookup clip
during connection. The clip is cached in memory by language, shared across voice
sessions, and contains no user data. Warmup is bounded at 4.5 seconds and can
increase initial connection time; it does not run again on each lookup.

Search and page-read acknowledgments bypass the generated wording connection.
An available installed speech voice speaks the selected tool's subject. Otherwise
the prepared clip says “আচ্ছা, তথ্যটা খুঁজে যাচাই করে দেখছি।” (or its English
equivalent); the contextual subject also appears in the local progress notice.
If neither speech path is available, the notice remains visible and the read
continues. Native speech startup has a 1.2-second deadline, and stalled speech is
bounded. These limits are fallback bounds, not guaranteed audible latency.

Read-only searches and page reads continue in parallel with acknowledgment
playback. Other actions retain their existing ordering and approval controls.
Natural Banglish/Hindi lookup wording is classified as lookup. Screen sharing
accepts the polite prefix “bhai”, the particle “ta”, and a trailing standalone
greeting, while retaining whole-command matching and negation protection.

Search results are explicitly marked as snippets with unconfirmed facts. The
provider is instructed to read an original page before claiming confirmation.
Snippet-only final replies always carry a local preliminary-description notice;
unqualified provider audio is discarded and the reviewed text is narrated instead.

Early answer speech accepts literal supporting page text, or a short exact quote
with the matching source label. Snippet quotes must say “Search results say:” or
“সার্চের ফলাফলে লেখা আছে:”. Translated or unsupported claims remain buffered.
The next reviewed sentence and final narration can render while the preceding
sentence plays; scheduling still waits for playback to drain. Ignoring the quote
format does not bypass the evidence check or guarantee early speech.

Logs now include speech-end-to-acknowledgment and acknowledgment-end-to-answer
playback intervals. Those use local VAD estimates and scheduled audio time, not
physical microphone/speaker measurements. Build success does not establish live
latency, provider adherence, or audible output quality.
