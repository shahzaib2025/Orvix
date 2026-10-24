# Controlled companion memory

Orvix now has a separate persistent memory store for Fast and Thinking. It saves
only an explicit user memory command or a manual entry in Settings → Memories.
Conversation refinement remains conversation-local. This feature does not
retrain the model, run an embedding model, watch the screen, or make background
memory requests.

## Controls

- `remember this: I prefer short Banglish replies`
- `mone rakho My project code is MAPLE-7319`
- `মনে রাখো আমি ছোট উত্তর পছন্দ করি`
- `show my memories` / `memories dekhao`
- `forget My project code is MAPLE-7319`

Commands work through typed input and completed voice transcriptions. Partial
voice commands cannot save notes or trigger competing tools. A bare “remember
this” asks for the exact note; it does not guess which earlier sentence to save.
An ambiguous forget request opens Settings without deleting anything. Settings
also supports add, edit, individual deletion, confirmed clear-all, event dates,
expiry dates, and the Use saved memories switch.

Supported persistent kinds are confirmed preferences, facts and events. An
inference is not an accepted persistent kind. Uncertain impressions have no
separate durable store. Every note records its source and creation/update dates;
event dates are separate and optional. Relative dates are not automatically
resolved from prose. Notes have personal or project scope. Choose Memory scope
on Home to authorize recall from that project; personal notes remain eligible.
Disabled memory retains the notes locally and returns no notes to the provider.

## Storage and retrieval

- Built-in `node:sqlite`, verified inside Electron 38.8.6 / Node 22.22.0.
- `app.getPath('userData')/companion-memory.sqlite` stores encrypted note and
  configuration payloads using Electron safeStorage (Windows DPAPI). Note text
  and metadata are not stored in a plaintext FTS index.
- Keyword scoring runs over the small decrypted collection in main-process RAM.
  A limited topic alias dictionary supports common English/Banglish/Bangla
  language, brevity, screen, coding and music queries. Arbitrary paraphrases and
  every Bengali word form are not guaranteed to match.
- Maximum 250 notes, 500 characters per note, five recalled notes, and 3,500
  UTF-8 bytes of recalled records. Expired notes remain visible but are excluded
  from recall. The initial connection includes relevant saved preferences;
  other recall uses a read-only local `recall_companion_memories` tool.
- The provider receives only selected notes. Notes are labeled as user-confirmed
  data, not instructions, observations or permission. An empty result must not
  become an invented memory. The model has no memory write/delete tool.
- The preload allows memory IPC only from the main Orvix window's main frame.
  Encryption failure and unreadable storage fail closed. Writes are atomic,
  duplicates are rejected, and common credential patterns are rejected.

SQLite FTS5 is deliberately not used in this first implementation: a normal
on-disk FTS index would expose searchable note text. At this fixed small limit,
RAM keyword matching avoids another database encryption dependency.

## Removing old context

Every save, edit, delete, clear or enable/disable operation closes the current
voice session and screen share. Restart voice to use the new context. Both
profiles discard resume handles. A persisted context boundary prevents earlier
chat messages (including undated legacy messages) from automatically being
restored into later provider sessions after a memory change. Existing chat
messages remain visible. Explicit memory command text is not added to chat
history. Memory recall responses are redacted from Thinking diagnostics.

This store does not erase separate historical chats/logs or retract information
already sent to a cloud provider. DPAPI protects data at rest for the Windows
account; it is not protection from software running as that same account.

## Validation

Run:

```
npm run check:companion-memory
npm run check:companion-memory:native
npm run build:memory:package
npm run check:companion-memory:live
```

Focused checks cover provenance, actual SQLite transactions with a test
encryptor, multilingual retrieval, scope, dates/expiry, limits, failures,
IPC authorization, commands, privacy history filtering, partial voice commands,
tool/audio suppression, diagnostics redaction and resume-handle cleanup.
The native check uses a fresh isolated Windows app profile, actual DPAPI,
UI controls and restart persistence. Its 250-note benchmark reports database
size and recall latency; memory deltas include allocations/GC and do not measure
steady-state whole-app RAM or idle CPU.

The live check sends typed questions through the packaged Electron app to Fast
and Thinking, then forgets a fact and checks fresh-session replies. These are
provider tests, not physical microphone, speech recognition or speaker tests.
The test passes existing project credentials privately through the process
environment; credentials are not bundled into the executable. For normal use
from this project, `npm run desktop` loads the configured project environment.
Reports live under `scratch/companion-memory-*.report.json`; the package is
`scratch/memory-package/win-unpacked/Orvix.exe`.

Observed so far: 21 focused memory checks, 19 screen-sharing checks and 106
conversation/voice/protocol checks passed. Production build passed. Nine native
Windows checks passed. With 250 long notes, the source-app benchmark observed
286,720 bytes on disk, 14.99 ms median recall and 16.65 ms p95 recall. These are
measurements on this host, not a performance guarantee.

The packaged Windows app also passed ten UI/storage/session checks and six live
typed provider answers: two saved-fact/preference answers per profile and one
post-forgetting UNKNOWN answer per profile. Its 250-note benchmark observed
286,720 bytes on disk, 18.62 ms median recall and 21.42 ms p95 recall. See
`scratch/companion-memory-packaged-live.report.json` for the actual answers.

One intermediate live run produced an unsupported system-error apology from
Thinking after a note was forgotten, instead of the requested UNKNOWN answer.
It did not expose the forgotten code. The memory instruction now explicitly
requires checking the read-only recall tool and distinguishes missing notes
from actual storage failures. The final rebuilt package passed all six live
answers after this change. The failed response is preserved in
`scratch/companion-memory-provider-response-failure.report.json`. Model wording
can vary; a passing run does not guarantee every future answer.

The broader `check_simple_fast.cjs` suite is not green: 82/122 passed, with
40 failures. All 40 failure names also occur against the saved pre-memory source
in `scratch/screen-sharing-baseline-20261007` (80/122 passed there). This is a
comparison against a dated source snapshot, not proof that the rest of Fast has
no issues. Comparison output is in `scratch/companion-memory-fast-current.txt`
and `scratch/companion-memory-fast-baseline.txt`.
