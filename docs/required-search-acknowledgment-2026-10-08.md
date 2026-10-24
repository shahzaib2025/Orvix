# Search acknowledgment before retrieval

The pasted 8:56:53 PM log showed `web_search` starting before acknowledgment handling, followed by `Acknowledgment generation bypassed`, `cacheReady: false`, and `delivery: visible_only`. Thus retrieval ran without an audible explanation.

## Changed behavior

- Search and page-read tools use fresh generated acknowledgment speech instead of the cached generic lookup clip.
- Retrieval starts only after acknowledgment generation and actual playback finish. It no longer executes alongside acknowledgment preparation, and results are not submitted during that speech.
- If generation fails or neither generated audio nor installed speech can deliver the generated text, retrieval remains undispatched. The controller reports that the spoken explanation failed and pauses the task.
- An installed voice may speak the fresh generated text when generated PCM is unavailable. This is not a canned acknowledgment.
- The unused lookup-clip startup preparation was removed. The existing generated acknowledgment connection remains warm.
- Existing quick focus/minimize/maximize behavior and the earlier latency/browser changes remain.

## Evidence

- Six dedicated tests passed: generation/playback ordering, fresh explanation for subsequent reads, generation failure, missing audio, generated-text installed-voice fallback, and Stop during generation.
- Combined targeted regression run: 15 passed.
- Real Chromium Web Audio check passed: two synthetic PCM buffers drained before retrieval; tool dispatch waited 1523.3 ms and occurred with no audio playing. Retrieval was mocked; this does not establish physical speaker or microphone behavior.
- Real Live provider generated six distinct progress phrases with PCM; all six succeeded. Median startup to first generated audio was 1062 ms; median full generation was 3763 ms. The controller awaits complete generated speech and playback, so those first-audio figures are not measured first audible acknowledgment latency in the desktop app.
- Production TypeScript/Vite build passed; the existing large-bundle warning remains.

Evidence files: `scratch/required-search-ack.log`, `scratch/required-search-ack-regression.log`, `scratch/required-search-ack-browser.log`, `scratch/required-search-ack-provider.log`, `scratch/fast-generated-progress-live.report.json`, and `scratch/required-search-ack-build.log`.

Run `npm run check:fast-search-ack` to repeat the ordering checks. Restart Orvix to load the renderer changes. The normal packaged app, physical microphone, and audible speaker output have not been validated here; earlier broader reliability failures remain outside this change.
