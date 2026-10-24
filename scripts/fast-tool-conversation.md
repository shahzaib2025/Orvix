# Fast profile: real tool conversation

Result: all four messages triggered real model tool calls and completed.

Scope: Real Gemini Live, production Fast handler and work executor, disposable Chromium with controlled Google/YouTube pages, real public web search/page reads. Text input; audio chunks counted, not audibly played.

The search acknowledgement was corrected during this test: a pending action used a different status key from its verified result. The final run checks that the acknowledgement contains only the verified result.

## Message 1

**Sent:** Reply in English. Use browser_observe to inspect the current Google tab and tell me its URL and the visible search input label. Do not answer from memory.

**Fast answered:** The current URL of the Google tab is https://www.google.com/, and the visible search input label is "Search".

**Model tool calls:** browser_observe

**Tool results:** browser_observe: ok

Audio chunks admitted by Fast: 30.


## Message 2

**Sent:** Reply in English. Search Google for Africanized honey bee facts using work_browser. Verify the requested query in the resulting URL, then tell me what finished.

**Fast answered:** The requested search page opened.

**Model tool calls:** work_browser

**Tool results:** work_browser: ok

Audio chunks admitted by Fast: 11.


## Message 3

**Sent:** Reply in Bangla. Use web_search to find three facts about Africanized honey bees, then read one relevant source with read_web_page and give me the three facts with that source URL. Do not just say that you will search.

**Fast answered:** অবশ্যই, আফ্রিকানাইজড হানি বি বা মৌমাছি সম্পর্কে তিনটি গুরুত্বপূর্ণ তথ্য নিচে দেওয়া হলো: প্রথমত, এরা খুবই প্রতিরক্ষামূলক এবং কলোনিতে কোনো ব্যাঘাত ঘটলে তারা অনেক বেশি সংখ্যায় আক্রমণ করে। দ্বিতীয়ত, এরা আক্রমণকারীকে দূর পর্যন্ত ধাওয়া করতে পারে, প্রায় এক মাইল বা তারও বেশি। তৃতীয়ত, এরা বিভিন্ন জায়গায় বাসা বাঁধে, এমনকি মাটির নিচেও। এই তথ্যগুলো আপনি এই সোর্সে পাবেন: https://ag.utah.gov/plant-industry/apiary-inspection-and-beekeeping/africanized-honey-bees/

**Model tool calls:** web_search, read_web_page

**Tool results:** web_search: ok; read_web_page: ok

Audio chunks admitted by Fast: 102.

- Page read: https://ag.utah.gov/plant-industry/apiary-inspection-and-beekeeping/africanized-honey-bees/ — ok (direct_page).
- Page read: https://ucanr.edu/node/136533 — partial (search_provider_text).
- Page read: https://ag.utah.gov/plant-industry/apiary-inspection-and-beekeeping/africanized-honey-bees/ — ok (direct_page).

## Message 4

**Sent:** Reply in Bangla. Use browser_observe again to inspect the Google tab and confirm which search query is currently open.

**Fast answered:** ব্রাউজারটি পরীক্ষা করে নিশ্চিত হওয়া গেল যে, বর্তমানে গুগল ট্যাবে "Africanized honey bee facts" সার্চ কুয়েরিটি ওপেন রয়েছে।

**Model tool calls:** browser_observe

**Tool results:** browser_observe: ok

Audio chunks admitted by Fast: 27.


Validation: 81 regression checks passed; browser integration and real AudioWorklet/audio-drain checks passed; production build passed. Physical microphone input and audible speaker delivery were not tested.
