# Fast search acknowledgment recovery and measured latency

## Failure and fix

The supplied 9:08 log showed acknowledgment generation timing out, followed by a failure-report voice timeout. Search correctly remained undispatched, but voice recovery did not resume its pending operation.

Search/read acknowledgment generation now retries once through a fresh voice connection before pausing. Only speech preparation repeats; the pending retrieval executes once, after successful playback drains. Stop invalidates late recovery output. Failure-report rendering also gets one bounded voice retry, including during the previous voice cooldown.

The initial generation deadline previously expired while useful audio was arriving. Mandatory buffered search acknowledgments now retain the initial speech-start deadline and allow up to eight seconds for generation completion after the first audio arrives. Complete safe sentences can exceed the requested word count without an extra word-count rewrite. Unsafe success claims remain rejected.

## Ten real-provider acknowledgment requests

Test scope: actual SimpleFast acknowledgment controller and real Live generation, warm connection, typed research requests. Tool proposals were supplied by the harness; retrieval and playback were fixtures. These are playback scheduling measurements, not physical audible latency or an end-to-end research conversation. The current default Bangla voice was retained, including for English query text.

| Request | Generated acknowledgment | First provider audio | Playback scheduling |
|---|---|---:|---:|
| accha gemini er letest model ki? | আমি জেমিনির লেটেস্ট মডেলটি খুঁজে দেখছি। | 1602 ms | 5056 ms |
| GPT er latest model gula khoj neo | আমি জিপিটির নতুন মডেলগুলো দেখছি। | 765 ms | 3680 ms |
| Google আর OpenAI এর নতুন মডেল তুলনা করো | আমি নতুন মডেলগুলোর তুলনা খুঁজে দেখছি। | 1688 ms | 4699 ms |
| Florian BD সম্পর্কে অনলাইনে খুঁজে দেখো | আমি ফ্লোরিয়ান বিডি সম্পর্কে খুঁজে দেখছি। | 969 ms | 4194 ms |
| Florian BD আর তার প্রতিযোগীদের তুলনা করো | আমি ফ্লোরিয়ান বিডির তুলনা খুঁজে দেখছি। | 1117 ms | 4060 ms |
| বাংলায় সৌরশক্তির সুবিধা খুঁজে বলো | আমি সৌরশক্তির সুবিধাগুলো খুঁজে দেখছি। | 1003 ms | 4069 ms |
| Find the latest Google flagship model | আমি গুগলের লেটেস্ট ফ্ল্যাগশিপ মডেল খুঁজে দেখছি। | 1163 ms | 4775 ms |
| Research how ocean tides work | আমি জোয়ার-ভাটার প্রক্রিয়া খুঁজে দেখছি। | 1383 ms | 3177 ms |
| Search for the history of Dhaka | আমি ঢাকার ইতিহাস খুঁজে দেখছি। | 1230 ms | 3874 ms |
| Find reliable sources about electric cars | আমি বৈদ্যুতিক গাড়ির তথ্য খুঁজে দেখছি। | 1633 ms | 3990 ms |

All ten generated speech successfully with one generation attempt and one mocked search each. Zero met the one-second playback target. Median playback start: 4060 ms; nearest-rank p95: 5056 ms (only ten samples). Median provider first audio: 1163 ms; p95: 1688 ms. Median wait between first audio and generation completion: 2939 ms; p95: 3607 ms.

The largest observed delay is whole-sentence buffering: `acknowledge` awaits the complete `generate` result before sending its PCM to the audio engine. Provider startup also exceeded one second on eight of ten requests. Removing buffering alone therefore would not reliably meet one second. A future streaming change needs to preserve complete playback before dispatch and define how to handle invalid or incomplete generated speech after it has begun playing. No additional streaming behavior was introduced for this benchmark.

The benchmark manually selected `web_search` for every request and used empty mocked search results. It cannot establish action-selection accuracy, research answer quality, conversational continuity, microphone endpoint latency, or speaker output. Those remain separate checks.

## Validation

- 23 focused controller/voice tests passed, including startup versus completion deadlines, cancellation, false-success rejection, recovery ordering and persistent failure limits.
- Real Chromium Web Audio fixture passed: retrieval waited 1718.6 ms, with no dispatch during playback. Retrieval and speech PCM were fixtures.
- Injected first generation failure followed by actual Live recovery passed: two generation attempts, nine returned PCM chunks, and one mocked retrieval. Earlier live recovery attempts exposed the six-second completion timeout; separating the deadlines resolved the observed retry failure. This is not proof of recovery from every natural provider outage.
- TypeScript/Vite production build passed after the runtime changes. Packaged Windows app, physical microphone and audible speaker behavior were not validated.

Raw requests: `scratch/fast-search-ack-latency-live.report.json`. Recovery evidence: `scratch/search-ack-recovery-live.report.json`. Repeat latency sampling with `node scripts/benchmark_fast_search_ack_live.cjs`; repeat ordering checks with `npm run check:fast-search-ack`.
