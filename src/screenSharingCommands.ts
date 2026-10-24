export type ScreenSharingCommand = 'start' | 'stop';

function screenRequestText(input: string): string {
  return String(input || '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[’']/g, "'").replace(/[.!?।,]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:hey )?orvix |bhai |ভাই |भाई |accha |achha |acha |okay |ok |আচ্ছা |अच्छा |please |দ[য়য়]া করে )+/, '')
    .replace(/ (?:hello|hi|হ্যালো|হাই)$/, '')
    .replace(/ (?:please|to|তো)$/, '').trim();
}

/** Match only direct, short screen-sharing controls, not ordinary screen questions. */
export function screenSharingCommand(input: string): ScreenSharingCommand | null {
  const text = screenRequestText(input).replace(/\bkaro\b/g, 'koro');

  // Microphone transcription can mix English with Hindi/Banglish control words.
  // Keep the full utterance anchored so quoted or compound requests cannot toggle capture.
  const spokenControl = /^(?:screen share|screen sharing|screen view|screen) (?:turn )?(on|off|start|stop|open|close|enable|disable|chalu|shuru|band|bandh|bondho)(?: (?:kar do|koro|korun|kore dao))?$/;
  const spokenMatch = text.match(spokenControl);
  if (spokenMatch) return /^(?:off|stop|close|disable|band|bandh|bondho)$/.test(spokenMatch[1]) ? 'stop' : 'start';
  // Observed speech transcript: "Screen sharing turn kar do."
  if (/^(?:screen share|screen sharing|screen view) turn (?:kar do|koro)$/.test(text)) return 'start';
  if (/^(?:स्क्रीन|स्क्रिन)(?: शेयर| शेयरिंग| शेयरिन्ग)? (?:ऑफ|बंद|बन्द)(?: कर दो| करो| करें)?$/.test(text)) return 'stop';
  if (/^(?:स्क्रीन|स्क्रिन)(?: शेयर| शेयरिंग| शेयरिन्ग)? (?:ऑन|चालू|शुरू)(?: कर दो| करो| करें)?$/.test(text)) return 'start';

  if (/^(?:stop|turn off|close|disable) (?:the )?(?:screen share|screen sharing|screen view)(?: please)?$/.test(text) ||
      /^(?:screen share|screen sharing|screen) (?:off|বন্ধ)(?: koro| korun| kore dao| করো| করুন| করে দাও| করে দিন)?$/.test(text) ||
      /^(?:screen share|screen sharing|screen) (?:bondho|বন্ধ) (?:koro|korun|kore dao|কোরো|করো|করুন)$/.test(text) ||
      /^(?:স্ক্রিন(?: শেয়ার| শেয়ার)? (?:বন্ধ করো|বন্ধ করুন|অফ করো|অফ করুন)|স্ক্রিন শেয়ার বন্ধ|স্ক্রিন শেয়ার বন্ধ)$/.test(text)) return 'stop';

  if (/^(?:start|turn on|open|enable) (?:the )?(?:screen share|screen sharing|screen view)(?: please)?$/.test(text) ||
      /^(?:share|show|view) (?:my |the )?screen$/.test(text) ||
      /^(?:look at|see) (?:my |the )?screen$/.test(text) ||
      /^screen(?: share| sharing)? (?:on|start|open)(?: koro| korun| kore dao| please)?$/.test(text) ||
      /^screen (?:e|এ|a|আ|ta|টা|eta|এটা) (?:dekho|দেখো|দেখুন)$/.test(text) ||
      /^screen share (?:chalu|shuru|on) koro$/.test(text) ||
      /^screen sharing (?:chalu|shuru) koro$/.test(text) ||
      /^(?:স্ক্রিন(?:ে|টা)? দেখো|স্ক্রিন(?:ে|টা)? দেখুন|স্ক্রিন শেয়ার চালু করো|স্ক্রিন শেয়ার চালু করো|স্ক্রিন শেয়ার অন করো|স্ক্রিন শেয়ার অন করো|স্ক্রিন শেয়ার শুরু করো|স্ক্রিন শেয়ার শুরু করুন)$/.test(text)) return 'start';

  return null;
}

/** Short status questions only; screen contents and compound actions stay with the model. */
export function screenStatusQuestion(input: string): boolean {
  const text = screenRequestText(input);
  return /^(?:can|do|are) you (?:see|seeing) (?:my |the )?screen(?: (?:now|right now))?$/.test(text) ||
    /^(?:can you not|can't you|cannot you|don't you) see (?:my |the )?screen(?: now)?$/.test(text) ||
    /^(?:is|am i) (?:my )?(?:screen sharing|sharing (?:my )?screen)(?: (?:on|off|active|now))?$/.test(text) ||
    /^(?:আমার )?স্ক্রিন (?:দেখতে পাচ্ছ|দেখতে পাচ্ছো|দেখতে পাচ্ছেন)(?: না)?(?: এখন)?$/.test(text) ||
    /^(?:তুমি |আপনি )?(?:এখন )?(?:আমার )?স্ক্রিন (?:দেখতে পাচ্ছ|দেখতে পাচ্ছো|দেখতে পাচ্ছেন)(?: না)?$/.test(text) ||
    /^(?:amar |amaar )?screen (?:dekhte paccho|dekhte pachcho|dekhte pachho|dekhte parcho|dekhte paro)(?: na)?(?: (?:ekhon|akhon))?$/.test(text) ||
    /^(?:kya )?(?:tum |aap )?(?:mera |meri )?screen (?:dekh sakte ho|dekh pa rahe ho|dikh raha hai)(?: abhi)?$/.test(text);
}

/** A direct question about pixels can stream when the session has a fresh shared frame. */
export function screenContentQuestion(input: string): boolean {
  const text = screenRequestText(input);
  return /^(?:what is|what's) (?:on|visible on) (?:my |the )?screen(?: now)?$/.test(text) ||
    /^(?:what (?:can|do) you see|describe what you see)(?: on (?:my |the )?screen)?$/.test(text) ||
    /^(?:আমার )?স্ক্রিনে (?:কি|কী) (?:আছে|দেখছ|দেখতে পাচ্ছ)(?: এখন)?$/.test(text) ||
    /^(?:amar )?screen (?:e|এ) (?:ki|ki ki) (?:ache|dekcho|dekhte paccho)$/.test(text);
}
