# Orvix conversational personality

Implemented scope: item 1 of the companion research plan, conversational personality.

The active Fast and Thinking voice paths share `src/conversationPersonality.ts`.
Their system instructions ask Orvix to:

- Be warm, curious and straightforward, with short natural turns.
- Occasionally ask one relevant follow-up rather than a question every turn.
- Ground unfinished-topic follow-ups in supplied conversation history; avoid
  repeated prompts and stop bringing up a topic after a refusal or subject change.
- Use dates such as “yesterday” only when the supplied history establishes them.
- Disagree politely with evidence, accept corrections and acknowledge uncertainty.
- Respect silence and “not now”, without filling idle time or pressuring a reply.
- Distinguish user statements, fresh authorized screen observations, tool results
  and uncertain inferences. Never claim unavailable audio or unreadable content.
- Avoid invented experiences, emotional needs, claims of missing the user,
  exclusivity, or pressure to continue talking.
- Default to Bangla and honour explicit English/Banglish preferences. Banglish
  text means natural Bengali phrasing in Latin script, not English translation.

The existing action approvals, screen permission controls and research grounding
remain in force. The personality change adds no background requests, sensors,
timers or automatic check-ins. A separate, subsequently implemented
[controlled companion memory](companion-memory.md) supplies explicitly saved
notes across conversations; ordinary conversation refinement stays local.

These are provider instructions, not a guarantee of every generated response.
No live microphone, listening/speaking trial or provider personality evaluation
has been performed for this change. The application must start a new voice
session to load updated system instructions; a running packaged executable also
needs a rebuilt package before it contains the change.
