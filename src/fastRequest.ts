import { windowCorrection } from "./fastTaskContinuity";
export type FastRequestIntent = "conversation" | "continue" | "correct" | "refine" | "add" | "clarify" | "cancel" | "replace";

// Interpret the completed utterance, never microphone energy, as task intent.
export function fastRequestIntent(text: string): FastRequestIntent {
  const value = text.trim().replace(/^(?:(?:reply|respond|answer) in (?:english|bangla|bengali)|বাংলায় উত্তর দাও|বাংলায় উত্তর দাও)[.!।:]\s*/i, "").replace(/[.!?।]+$/g, "");
  if (windowCorrection(value)) return "correct";
  if (/^(?:(?:please\s+)?(?:stop|cancel|abort)(?:\s+(?:it|that|this|the task|the job|working|everything))?|(?:থামো|থামুন|বন্ধ করো|বন্ধ করুন|বাতিল করো|বাতিল করুন)(?:\s+(?:এটা|কাজটি|কাজটা|সব))?)$/i.test(value)) return "cancel";
  if (/^(?:hello|hi|hey|hlw|yo|হ্যালো|হাই|হেই|সালাম|আসসালামু আলাইকুম|কেমন আছ(?:ো|েন)?|কেমন আসো|kemon as[oa]|how are (?:you|u)|what[’']?s up|who are (?:you|u)|thanks|thank you|ভালো আছি|ভাল আছি)$/i.test(value)) return "conversation";
  // Continuation preserves the reviewed task, but never grants an approval.
  if (/^(?:then|and then|finish(?: it| the answer)?|finish speaking|tell me the rest|confirm|permission (?:given|granted)|হুম|হুঁ|হ্যাঁ(?: করো| করুন)?(?: বন্ধু)?|হ্যা(?: করো| করুন)?(?: বন্ধু)?|অনুমতি (?:দেওয়া|দেওয়া) হলো|বলো শেষ করো|শেষ করো|তারপর|তার পরে|এরপর|और|हैं)$/i.test(value)) return "continue";
  if (/^(?:বলো শেষ করো|শেষ করো|তারপর|এরপর)[।.!]?\s+(?:আগের|বাকি|একই|চালিয়ে|চালিয়ে)/i.test(value)) return "continue";
  if (/^(?:(?:achha|accha|okay|ok|আচ্ছা)[,\s]+)?(?:details (?:do|dao)|(?:give|tell) me (?:more|the details)|আরও বলো|বিস্তারিত (?:দাও|বলো)|এদের .*(?:প্রোডাক্ট|পণ্য|দাম)|সবগুলা প্রোডাক্ট|এই দুইটা (?:কম্পেয়ার|কম্পেয়ার|তুলনা))/i.test(value)) return "add";
  if (/^.{1,60}(?:এর|দের|টির|র)\s+সব(?:গুলো|গুলা)?\s+(?:প্রোডাক্ট|পণ্য)/i.test(value)) return "add";
  // Status/report requests refer to existing work. Match the whole utterance so
  // a new request such as "give me a report about solar panels" still replaces it.
  if (/^(?:please\s+)?(?:(?:give|show|send) me (?:the|its|your|that|this) (?:report|results?|findings|update)|(?:where is|where's) (?:the|my|your) (?:report|answer|results?)|(?:why|how come) (?:did you|have you|you) (?:stop(?:ped)?|pause(?:d)?)(?: (?:working|the work|the research|the task))?|(?:have you|did you) (?:finish(?:ed)?|complete(?:d)?)(?: (?:it|the task|the work|the research))?)(?: yet)?$/i.test(value) || /^(?:রিপোর্ট(?:টা|টি)? (?:দাও|দিন|দেখাও|দেখান)|(?:কাজ(?:টা|টি)?|গবেষণা(?:টা|টি)?) (?:শেষ|সম্পূর্ণ) (?:করলে|করলেন|করেছ|করেছেন) (?:না কেন|কি)|(?:কেন|কী কারণে) (?:থেমে গেলে|থেমে গেছ|কাজ বন্ধ করলে)|(?:রিপোর্ট|ফলাফল|উত্তর)(?:টা|টি)? কোথায়)$/i.test(value)) return "continue";
  if (/^(?:yes|yeah|yep|ok|okay|thanks|thank you|go on|keep going|continue|resume|next|are you done|is it done|what(?:'s| is) (?:the status|happening)|how(?:'s| is) it going|are you (?:still )?(?:working|there)|হ্যাঁ|হ্যা|ঠিক আছে|আচ্ছা|ধন্যবাদ|চালিয়ে যাও|চালিয়ে যাও|চালিয়ে যান|চালিয়ে যান|চালু রাখো|হয়েছে|হয়েছে|শেষ হয়েছে|শেষ হয়েছে|কাজ কি শেষ|কাজ হচ্ছে|কতদূর|কি হলো|কী হলো)$/i.test(value)) return "continue";
  if (/^(?:also\b|and also\b|add\b|include\b|what about\b|আরও|এছাড়াও|এছাড়াও|যোগ করো|যোগ করুন)/i.test(value)) return "add";
  // A substantive follow-up adds a new outcome; it is not a status-only
  // continuation and must not discard the existing evidence or replay its reply.
  if (/^(?:simple follow-up\b|using .{0,120}(?:already verified|previous|earlier)|audit .{0,100}(?:our|previous|earlier)|finish in (?:bangla|bengali|english)\b)/i.test(value) ||
      /^(?:আগের|পূর্বের).{0,100}(?:গবেষণা|তথ্য|সূত্র|ফলাফল)/i.test(value) && !/শেষ করো|শেষ করুন|বাকি উত্তর|সংশোধন|বদল/i.test(value)) return "add";
  if (/^i may have misstated\b|^make this (?:a )?multi.step\b/i.test(value)) return "refine";
  if (/^(?:use the other(?: one)?|do that(?: one)?|change it|change that|অন্যটা|ওটা করো|ওইটা করো)$/i.test(value)) return "clarify";
  if (/^(?:refine\b|update (?:the|that|this)\b|focus on\b|make (?:it|that)\b|আগের.*(?:বদল|সংশোধন)|সংশোধন করো)/i.test(value)) return "refine";
  if (/^(?:আগের|পূর্বের).{0,300}(?:যোগ করো|যোগ করুন|যোগ করে)/i.test(value)) return "add";
  if (/^(?:আগের|আগেকার|পূর্বের).{0,180}(?:শেষ করো|শেষ করুন|চালিয়ে যাও|চালিয়ে যাও|বাকি উত্তর)/i.test(value)) return "continue";
  if (/^(?:please\s+)?(?:continue|resume|finish)\s+(?:(?:that|this|the|our|earlier|previous)\s+.{0,60}?)?(?:task|check|answer|work|research|explanation|audit|comparison)\b/i.test(value)) {
    return /\b(?:also|add|include|read again|page again|reread|re-read|new|additional)\b|[.!]\s*(?:use|read|check|find|explain|compare)\b/i.test(value) ? "add" : "continue";
  }
  if (/^(?:no\b|actually\b|instead\b|i meant\b|enter\b|press enter\b|continue\b|next\b|না|আমি বল|বলছিলাম|বলতেছিলাম|এন্টার|পরের)|search bar|সার্চ বার/i.test(value)) return "correct";
  if (/^(?:[0-9০-৯]+|first|second|third|one|two|three|প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|এক|দুই|তিন)$|^(?:choose|select|play|বেছে|নম্বর)\s/i.test(value)) return "correct";
  return "replace";
}
