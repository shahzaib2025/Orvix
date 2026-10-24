# Connected silence and away protection

Implemented policy, 8 October 2026. This supersedes the earlier connected-session
silence behavior in `pc-companion.md`. It does not establish physical presence or
detect loneliness.

## Conversation timing

The voice facade records a completed assistant turn and waits for the main output
playback to drain before starting its timer. Fast also exposes its speaking flag;
Thinking exposes queued audio playback. Interrupted turns, new user speech/input,
connection loss and reconnection invalidate that completion. Initial connection
alone does not count as a completed conversation turn.

After 45 seconds, while PC input occurred within the last 15 seconds and has
paused for at least three seconds, Orvix can offer one short opening. It receives
the application name and up to 180 characters of the actual preceding user topic,
plus relevant enabled memories. Window titles from arbitrary apps are not needed.
The opening cannot execute the preceding request: its separate voice connection
has no tools. There is one opening per completed turn and a ten-minute global
cooldown; ignoring it also causes a ten-minute backoff. Existing standalone video
and folder observations remain available when no main voice session exists.

## Possible absence

While connected and after at least 30 seconds of conversational silence, the
controller admits at most one check at each PC-idle threshold: 30, 60 and 90
seconds. A late observation skips earlier stages rather than playing a burst.
At 120 seconds it stops proposing more calls. Each admitted attempt consumes its
stage even if generation is unavailable; Gemini outage never creates a retry loop.

Checks are suppressed by fresh detected playback, audible browser tabs, calls,
player apps, fullscreen activity, presentations, Windows quiet hours, unavailable
activity signals and explicit deferral. Inactivity is not proof the user left.
An ignored check does not trigger unrelated conversation. The final check stays
quiet afterwards; it mentions an approaching lock only when native protection
reports eligible inactivity near the configured deadline.

Gemini renders the supplied check-in through a separate short voice connection.
Provider generation and local polling introduce latency: the thresholds admit a
request, they do not guarantee audio begins at the exact second. Main voice work,
typing or speech interrupts playback, and fresh activity is rechecked before any
generated audio is played. The user's own microphone stays governed by the voice
button. Away-check audio never renews user-presence timers.

## Local lock rule

Settings → Automatic conversation contains a one-time “Lock after two minutes of
inactivity” setting, off by default. Its saved rule is independent of conversation
quiet mode and Gemini connectivity. It continues while the app runs in the tray.
The default smart mode defers for detected passive activity, missing browser
reports and calls/presentations. Strict mode includes passive activity. Reading
without input can trigger either mode when no explicit deferral applies; playback
exceptions can leave an unattended computer unlocked.

The Electron main process requires fresh monitor data and agrees it with native
system-idle time. Startup, unlock and resume establish a fresh two-minute arming
period. Recognised user responses reset the presence deadline. New keyboard/mouse
input cancels a pending request. A bounded hidden Windows helper checks native
last-input time again immediately before requesting `LockWorkStation`. No model
argument or renderer command can supply shell code or demand an immediate lock.

The main process reports “locked” only after the Windows lock-screen event. An
initiated request lacking that event is reported as unconfirmed; failures are not
reported as success. Failed/unconfirmed attempts do not continuously retry. Lock
or suspension stops voice and screen sharing. Unlock/resume cancels stale remarks;
it does not automatically restart the microphone or share the screen again.

## Controls

- “Not now” / “chup thako”: pause conversation for 30 minutes; protection remains.
- “I’m reading”, “I’m here”, “ami achi, porchi”: defer away reminders and locking
  for ten minutes.
- “Don’t lock yet” / “lock koro na”: the same ten-minute deferral.
- “I’m going outside” / “ami baire jacchi”: pause conversation; the lock rule remains.
- Settings offers temporary lock deferral and smart/strict policy selection.

Commands must be exact recognised utterances, not titles, quoted instructions or
model output. Confirmations follow the local IPC result. These controls neither
write personal memories nor authorize agent tasks.

## Build and verification scope

`npm run build:presence:package` compiles a separate monitor executable and the
TypeScript/Vite app, then packages Windows Electron under `scratch/presence-package-final`.
The separate monitor output avoids overwriting the monitor binary used by the
current desktop session. A previously running shared monitor may need its normal
restart before the updated unknown-input reporting is active.

The extension resources are copied sequentially with bounded retries and file-hash
checks after packaging, because Electron Builder's concurrent resource copying
encountered Windows file locks on this host.

The production build and JavaScript syntax checks establish compilation only.
The prior companion tests and report do not cover this new policy. Real Windows
lock/unlock, exact connected-turn timing, return-to-PC cancellation, physical
microphone/speaker interruption, passive playback and steady-state resource use
remain acceptance checks before claiming this behavior is validated.
