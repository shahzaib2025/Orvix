# Automatic situational conversation

Orvix chooses occasional conversation openings while the desktop app is running.
There is no manual company-mode switch. This is activity-based timing, not a
claim to detect loneliness or read emotions.

## What the first version notices

- A foreground Chrome/Edge YouTube watch page with a verified title and playback
  report. It matches the active tab to the foreground window title.
- A pause after at least 30 seconds observing the same YouTube video.
- Three or more Explorer windows open at the same verified local folder path.
  Explorer window titles alone are not sufficient evidence. Windows Shell COM
  verifies paths locally; only a basename, count and opaque grouping key cross IPC.
  Only the basename/count are supplied to Gemini. UNC and virtual folders are omitted.

The existing paired PC-monitor extension is required for YouTube observations.
Reload the unpacked extension after this update and refresh existing YouTube tabs.
A lightweight five-second report keeps visible YouTube playback fresh; no frames
are captured. Other apps, Netflix, arbitrary scenes and browser content are not
interpreted by this feature. The eye button continues to control screen sharing.

## How it chooses a moment

The local controller checks metadata every two seconds, waits for a stable
observation (20 seconds for playback, 12 for folders, 4 for a pause), and requires
recent activity reports. A startup warmup lasts 20 seconds. It stays quiet during
typing, user speech detected by an already active microphone, main voice work,
foreground call apps, Windows quiet hours/lock, away periods, unrelated media
playback and presentations. A brief remark during verified foreground YouTube
playback is allowed automatically. It never pauses the user's video.

One attempted remark starts a ten-minute cooldown, including failures or cancelled
requests. The same video-start, video-pause or folder group is not repeated in the
session. When there is no reply/feedback within two minutes, it backs off for a
further 30 minutes. A response or Nice timing lets normal timing resume. Not my
thing suppresses that broad topic for the session. This is a first heuristic
policy; it has not been demonstrated to infer the user's desired timing reliably.

Not now, be quiet, chup thako, ekhon na and their supported Bangla equivalents
pause interruptions for 30 minutes, with automatic resumption. Settings contains
Pause interruptions and an optional early resume. No everyday opt-in panel is
shown. Quiet state, feedback, recently observed topic visits and timing are kept
in memory for the running session, not stored as personal facts. A restart starts
automatic timing again. Existing voice controls govern the microphone; this
feature does not start or record a microphone by itself.

## Voice and memory

Only an eligible event opens a short, separate Fast Gemini Live connection with
no tools, microphone input, screen frames, session resumption or chat restoration.
It receives the selected title/folder count, profile name/language, a temporary
topic-visit count and up to five relevant enabled user-confirmed memories. It is
instructed to make one short Bangla/Banglish remark/question, honour explicit
language preferences and never invent scenes, preferences, feelings or actions.
Model grounding remains fallible; metadata titles are not evidence of video scenes.

The audio is buffered and bounded, then the observation is checked again before
playback. A stale/changed observation or new user activity cancels the remark.
During playback, existing voice PCM forwarding is suppressed, while local user
activity detection remains available to interrupt it. A small bubble shows the
same output transcription with quiet/feedback actions. Spontaneous remarks are
not persisted into chat or personal memory. The actual displayed comment is
passed as assistant context to a connected conversation or the next conversation
within two minutes, labelled as potentially interrupted audio, never human
authorization. Memory edits/disabling recall clear temporary hints and stop any
in-flight comment. Document navigation, app quit, renderer failure and renderer
cleanup stop native queries. Orvix's existing close-to-tray behavior keeps the app
running, so automatic timing can continue while its main window is hidden.

## Resources and current verification

No new local model, embeddings, database or continuous model loop is added.
Folder verification uses a hidden, bounded Windows PowerShell query only while
Explorer is foreground and at least three Explorer windows exist, with an
eight-second cache and six-second timeout. Provider requests have a 25-second
deadline and bounded audio. Calls still consume Gemini quota; this is not offline.

The TypeScript/Vite production build is the compilation gate.

On 8 October 2026, focused tests identified and fixed stale video titles after
tab changes, ambiguous identical window titles, a missing future-folder timestamp
check and invalid activity values. The rebuilt Windows package passed native UI,
IPC and real Explorer COM checks with three controlled folder windows. A component
harness exercised automatic startup, silence backoff, quiet/resume, simulated
typing/voice interruption, busy-state gating, topic rejection, memory invalidation
and unmount cleanup. The harness uses simulated metadata, logical time, provider
responses and playback; it is not physical microphone evidence.

Three real Gemini requests returned short Banglish transcripts and bounded PCM
audio for controlled video-start, video-pause and duplicate-folder metadata. They
did not use a real YouTube page, screen capture or microphone. The existing memory
regression suite also passed. See `scratch/pc-companion-native.report.json` for
observed outputs and exact scope. Reproduce with `npm run check:pc-companion`,
`npm run check:companion-memory` and `npm run check:pc-companion:live`.

Real YouTube extension/foreground playback integration, physical microphone and
speaker interruption, human timing quality and steady-state resource measurements
remain unvalidated. No emotional inference accuracy or success percentage is
claimed.
