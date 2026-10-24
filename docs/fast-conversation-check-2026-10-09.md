# Fast live conversation check — 2026-10-09

Verdict: execution and audio generation were stable in this run; research accuracy and instruction following still need improvement. This is not a production-readiness result.

## Measured results

```json
{
  "turns": 20,
  "audioDelivered": 20,
  "tools": 13,
  "noToolFollowups": 10,
  "allOrderingPassed": true,
  "firstAcknowledgmentSchedulingProxy": {
    "samples": 10,
    "medianMs": 820.0,
    "p95Ms": 3494.4,
    "maxMs": 3494.4
  },
  "onsetToDispatch": {
    "samples": 13,
    "medianMs": 2.5,
    "p95Ms": 5.3,
    "maxMs": 5.3
  },
  "toolsCompletedBeforeAcknowledgmentFinished": 13,
  "acknowledgmentsUnderOneSecond": 5,
  "errors": []
}
```

Scope: real Gemini Live, real public retrieval, typed input, counted PCM with mocked playback onset/drain. No microphone, physical speakers, interruption stress test or packaged Windows validation. The onset-to-dispatch timing is a mock-renderer measurement, not acoustic latency. No application source was changed.

## Acknowledgment delay investigation

Five of ten work requests started their acknowledgment scheduling proxy below one second. Median was 820 ms, p95/worst 3,494 ms; the two-second p95 target was not met.

- Turn 1: 18.5 ms before acknowledgment generation, then 3,338.6 ms to first audio. This includes initial voice readiness; it is not a warm-only sample.
- Turn 13 (Florian BD competitors): 2,792.0 ms before acknowledgment generation, then 702.4 ms to audio. The main action-selection stage, rather than tool execution, dominated this delay.
- Known-page reads generally began generation within 4–10 ms and emitted first audio in roughly 0.65–0.82 seconds in this run.
- All 13 tools followed the mock-renderer onset by 2.5 ms median / 5.3 ms p95. The dispatch barrier itself is no longer the large delay.

## Problems found

- Turns 11, 12: Entity identity was not resolved. A search returned several social profiles and a Dhaka restaurant; the answer framed the request as a recognized public figure rather than asking which Florian BD was intended.
- Turns 13, 14: Failed retrieval was presented as absence of public competitor evidence. Generic competitor-finder pages and an unrelated BD company do not support that absence claim.
- Turns 15, 16: The comparison generalized distinct model-page examples into publisher-wide differences. Turn 15 also gave one sentence when two were requested.
- Turns 9, 10, 18: Wording about models executing actions blurs the model proposal/application execution boundary; turn 17 was more precise.
- Turns 5: Acknowledgment said Searching about Google for a read_web_page operation; action wording could be more precise.


## Conversation transcript

### Turn 1

User: Read https://ai.google.dev/gemini-api/docs/models and tell me one listed model and its intended use. Reply in English in one sentence.

Acknowledgment text: Reading about Google.

Final generated response: The Gemini 3.8 Live model is designed as the default Live API model for most low-latency voice agent experiences without reasoning delays.
https://ai.google.dev/gemini-api/docs/models?hl=en

Tools: 1; delivery: complete; ordering passed: True

### Turn 2

User: আগের পড়া তথ্য থেকে সেই মডেলের ব্যবহার বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: Gemini 3.8 Live মডেলটি মূলত রিজনিং-এর বিলম্ব ছাড়া অধিকাংশ লো-লেটেন্সি ভয়েস এজেন্ট অভিজ্ঞতার জন্য ডিফল্ট লাইভ এপিআই মডেল হিসেবে কাজ করার জন্য ডিজাইন করা হয়েছে।

Tools: 0; delivery: complete; ordering passed: True

### Turn 3

User: Read https://developers.openai.com/api/docs/models and tell me one listed model and its intended use. Reply in English in one sentence.

Acknowledgment text: Reading about OpenAI.

Final generated response: The GPT-6 Astra model is OpenAI's flagship model designed for complex reasoning and coding.
https://developers.openai.com/api/docs/models

Tools: 1; delivery: complete; ordering passed: True

### Turn 4

User: আগের পড়া OpenAI তথ্য বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: GPT-6 Astra মডেলটি হলো OpenAI-এর ফ্ল্যাগশিপ মডেল, যা মূলত জটিল রিজনিং এবং কোডিংয়ের জন্য ডিজাইন করা হয়েছে।

Tools: 0; delivery: complete; ordering passed: True

### Turn 5

User: Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one documented intended use from each in two English sentences.

Acknowledgment text: Searching about Google. / Reading about OpenAI.

Final generated response: The Gemini 3.8 Flash model is engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows. In contrast, OpenAI's GPT-6 Astra is a flagship model designed specifically for complex reasoning and coding.
https://ai.google.dev/gemini-api/docs/models?hl=en
https://developers.openai.com/api/docs/models

Tools: 2; delivery: complete; ordering passed: True

### Turn 6

User: আগের দুই সূত্র থেকে তুলনাটি বাংলায় দুই বাক্যে বলো। নতুন খোঁজ নয়।

Acknowledgment text: None; retained-information follow-up.

Final generated response: Gemini 3.8 Flash মডেলটি মূলত লং-হরাইজন সফটওয়্যার ইঞ্জিনিয়ারিং, স্বায়ত্তশাসিত এজেন্ট এবং জটিল এন্টারপ্রাইজ ওয়ার্কফ্লোর জন্য তৈরি। অন্যদিকে, GPT-6 Astra হলো একটি ফ্ল্যাগশিপ মডেল যা বিশেষভাবে জটিল রিজনিং এবং কোডিংয়ের জন্য ডিজাইন করা হয়েছে।

Tools: 0; delivery: complete; ordering passed: True

### Turn 7

User: Read https://ai.google.dev/gemini-api/docs/function-calling and explain function calling in one English sentence.

Acknowledgment text: Searching about Google.

Final generated response: Function calling enables models to interact with external tools and APIs by determining when to call specific functions and providing the necessary parameters to execute real-world actions.
https://ai.google.dev/gemini-api/docs/function-calling?hl=en

Tools: 1; delivery: complete; ordering passed: True

### Turn 8

User: আগের function calling ব্যাখ্যাটি বাংলায় এক বাক্যে বলো। নতুন তথ্য দরকার নেই।

Acknowledgment text: None; retained-information follow-up.

Final generated response: ফাংশন কলিং মডেলগুলোকে নির্দিষ্ট ফাংশন কখন কল করতে হবে তা নির্ধারণ করে এবং বাস্তব জগতের কাজ সম্পাদনের জন্য প্রয়োজনীয় প্যারামিটার প্রদান করে বাহ্যিক টুল এবং এপিআই-এর সাথে ইন্টারঅ্যাক্ট করতে সক্ষম করে।

Tools: 0; delivery: complete; ordering passed: True

### Turn 9

User: Read https://ai.google.dev/gemini-api/docs/live-api/capabilities and tell me one documented Live capability in one English sentence.

Acknowledgment text: Reading about Google.

Final generated response: The Live API supports asynchronous function calling, allowing models to execute actions without blocking the conversation flow.
https://ai.google.dev/gemini-api/docs/live-api/capabilities?hl=en

Tools: 1; delivery: complete; ordering passed: True

### Turn 10

User: আগের Live capability বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: লাইভ এপিআই অ্যাসিঙ্ক্রোনাস ফাংশন কলিং সমর্থন করে, যা মডেলগুলোকে কথোপকথনের প্রবাহে কোনো বাধা না দিয়ে কাজ সম্পাদনের সুযোগ দেয়।

Tools: 0; delivery: complete; ordering passed: True

### Turn 11

User: Search online about Florian BD and report one sourced fact briefly. If evidence is missing, say so. Reply in English.

Acknowledgment text: Searching about Florian BD.

Final generated response: Sufficient public evidence is missing regarding a widely recognized entity or public figure known specifically as "Florian BD."

Tools: 1; delivery: complete; ordering passed: True

### Turn 12

User: আগের Florian BD অনুসন্ধানে কী জানা গেছে বাংলায় বলো। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: "Florian BD" নামে নির্দিষ্ট কোনো সুপরিচিত ব্যক্তিত্ব বা পাবলিক ফিগার সম্পর্কে পর্যাপ্ত তথ্য পাওয়া যায়নি।

Tools: 0; delivery: complete; ordering passed: True

### Turn 13

User: Search for Florian BD competitors and compare one documented aspect. Do not invent competitors or facts; label missing evidence. Reply briefly in English.

Acknowledgment text: Searching Florian competitors.

Final generated response: This is a preliminary description from search results; I have not read the original page.
I cannot provide a comparison because there is no public evidence identifying competitors or their documented aspects for Florian BD.
https://companies.bizvibe.com/similar-companies
https://www.semrush.com/free-tools/competitor-finder/

Tools: 1; delivery: complete; ordering passed: True

### Turn 14

User: আগের প্রতিযোগী তুলনার সীমাবদ্ধতা বাংলায় এক বাক্যে বলো। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: "Florian BD" এর প্রতিযোগী বা তাদের নথিভুক্ত কোনো দিক সম্পর্কে পর্যাপ্ত পাবলিক তথ্য না থাকায় এই তুলনা করা সম্ভব হয়নি।

Tools: 0; delivery: complete; ordering passed: True

### Turn 15

User: Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. Compare one supported model selection consideration in two English sentences.

Acknowledgment text: Reading about Google. / Reading about OpenAI.

Final generated response: When selecting a Gemini model, consideration is given to specific needs like reasoning depth for low-latency voice interactions, unlike OpenAI, which directs users to balance intelligence with cost efficiency for different workloads.
https://ai.google.dev/gemini-api/docs/models?hl=en
https://developers.openai.com/api/docs/models

Tools: 2; delivery: complete; ordering passed: True

### Turn 16

User: আগের তুলনার ভিত্তিতে একটি ব্যবহারিক বিবেচনা বাংলায় বলো। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: Gemini মডেল নির্বাচনের ক্ষেত্রে ভয়েস ইন্টারঅ্যাকশনের মতো নির্দিষ্ট ফিচারের প্রতি গুরুত্ব দেওয়া হয়, যেখানে OpenAI মূল ফোকাস রাখে বুদ্ধিমত্তা ও খরচের সামঞ্জস্যের ওপর।

Tools: 0; delivery: complete; ordering passed: True

### Turn 17

User: Read https://ai.google.dev/gemini-api/docs/function-calling and tell me whether tools require application execution. Reply briefly in English.

Acknowledgment text: Reading about Google.

Final generated response: Based on the documentation, function calling connects models to external tools and APIs, where real-world actions are executed by those external systems.
https://ai.google.dev/gemini-api/docs/function-calling?hl=en

Tools: 1; delivery: complete; ordering passed: True

### Turn 18

User: আগের উত্তরের ভিত্তিতে tool execution বাংলায় এক বাক্যে বোঝাও। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: মডেলগুলো এপিআই বা এক্সটারনাল টুলের মাধ্যমে রিয়েল-ওয়ার্ল্ড অ্যাকশন এক্সিকিউট করে, যা বাহ্যিক সিস্টেম দ্বারা সম্পন্ন হয়।

Tools: 0; delivery: complete; ordering passed: True

### Turn 19

User: Read https://ai.google.dev/gemini-api/docs/models and https://developers.openai.com/api/docs/models one at a time. State one model from each and explain that these pages do not establish which is best. Reply in two English sentences.

Acknowledgment text: Searching about Google. / Reading about OpenAI.

Final generated response: Google lists models like Gemini 3.8 Flash, and OpenAI features models like GPT-6 Astra. However, these pages do not establish which model is best for your specific needs.
https://ai.google.dev/gemini-api/docs/models?hl=en
https://developers.openai.com/api/docs/models

Tools: 2; delivery: complete; ordering passed: True

### Turn 20

User: আগের দুই পৃষ্ঠার তুলনা বাংলায় দুই বাক্যে দাও। নতুন খোঁজ লাগবে না।

Acknowledgment text: None; retained-information follow-up.

Final generated response: গুগল Gemini 3.8 Flash-এর মতো মডেল তালিকাভুক্ত করে, এবং OpenAI GPT-6 Astra-এর মতো মডেল প্রদর্শন করে। তবে, এই পৃষ্ঠাগুলো কোনটি আপনার জন্য সেরা তা নির্ধারণ করে না।

Tools: 0; delivery: complete; ordering passed: True

Evidence: `scratch/simple-fast-live.conversation-check-20261009.report.json`, `scratch/fast-conversation-check-20261009.audit.json`, `scratch/fast-conversation-check-20261009.log`.
