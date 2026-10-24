// Weather scope and reports come from the user's request and actual receipts.
// This module never fetches data or guesses a missing measurement.
export type WeatherLocation = { key: string; query: string; bn: string; aliases: string[]; acknowledgment: [string, string] };
export type WeatherReceipt = { name: string; args: Record<string, unknown>; result: Record<string, unknown> };
export const divisionWeatherLocations: WeatherLocation[] = [
  { key: 'dhaka', query: 'Dhaka, Bangladesh', bn: 'ঢাকা', aliases: ['dhaka', 'ঢাকা'], acknowledgment: ['আচ্ছা, ঢাকার আবহাওয়া দেখি।', 'Let me check Dhaka.'] },
  { key: 'chattogram', query: 'Chattogram, Bangladesh', bn: 'চট্টগ্রাম', aliases: ['chattogram', 'chittagong', 'চট্টগ্রাম', 'চিটাগং'], acknowledgment: ['এবার চট্টগ্রামেরটা দেখি।', 'Next, checking Chattogram.'] },
  { key: 'rajshahi', query: 'Rajshahi, Bangladesh', bn: 'রাজশাহী', aliases: ['rajshahi', 'রাজশাহী'], acknowledgment: ['রাজশাহীর আবহাওয়া দেখে নিই।', 'Let me check Rajshahi.'] },
  { key: 'khulna', query: 'Khulna, Bangladesh', bn: 'খুলনা', aliases: ['khulna', 'খুলনা'], acknowledgment: ['এবার খুলনার খবর নিই।', 'Next, checking Khulna.'] },
  { key: 'barishal', query: 'Barishal, Bangladesh', bn: 'বরিশাল', aliases: ['barishal', 'barisal', 'বরিশাল'], acknowledgment: ['বরিশালের আবহাওয়াটা দেখি।', 'Let me check Barishal.'] },
  { key: 'sylhet', query: 'Sylhet, Bangladesh', bn: 'সিলেট', aliases: ['sylhet', 'সিলেট'], acknowledgment: ['এবার সিলেটেরটা দেখে নিই।', 'Next, checking Sylhet.'] },
  { key: 'rangpur', query: 'Rangpur, Bangladesh', bn: 'রংপুর', aliases: ['rangpur', 'রংপুর'], acknowledgment: ['রংপুরের খবরটাও নিই।', 'Let me check Rangpur.'] },
  { key: 'mymensingh', query: 'Mymensingh, Bangladesh', bn: 'ময়মনসিংহ', aliases: ['mymensingh', 'ময়মনসিংহ', 'ময়মনসিংহ'], acknowledgment: ['এবার ময়মনসিংহেরটা দেখি।', 'Next, checking Mymensingh.'] },
];
const normalized = (value: string) => value.normalize('NFKC').toLowerCase();
export function isWeatherRequest(text: string): boolean {
  return /\b(?:weather|forecast|abohawa|abohowa)\b|ও[য়য়]েদার|ওয়েদার|আবহাও|বৃষ্টি|তাপমাত্রা/iu.test(text);
}
export function weatherLocation(text: string): WeatherLocation | undefined {
  const value = normalized(text);
  return divisionWeatherLocations.find(place => place.aliases.some(alias => {
    const name = normalized(alias);
    return /[a-z]/.test(name) ? new RegExp(`\\b${name}\\b`, 'i').test(value) : value.includes(name);
  }));
}
function namedLocations(text: string): WeatherLocation[] {
  return divisionWeatherLocations.filter(place => place.aliases.some(alias => {
    const name = normalized(alias), value = normalized(text);
    return /[a-z]/.test(name) ? new RegExp(`\\b${name}\\b`, 'i').test(value) : value.includes(name);
  }));
}
export function weatherScope(text: string, history: { role: string; text: string }[]): WeatherLocation[] {
  if (!isWeatherRequest(text)) return [];
  const explicit = namedLocations(text);
  // Leave unfamiliar cities/countries to the model's ordinary tool flow;
  // a known city must not silently consume a request for another city too.
  if (/\b(?:India|Pakistan|Nepal|United States|USA|UK|Japan|Australia)\b|ভারত|পাকিস্তান|নেপাল|জাপান/i.test(text)) return [];
  const listed = text.split(/\s+(?:and|ও|এবং|আর)\s+|,/i);
  if (explicit.length && listed.length > 1 && listed.slice(1).some(part => !weatherLocation(part) && /[\p{L}]{2,}/u.test(part) && !/^\s*(?:Bangladesh|বাংলাদেশ)[।?!.\s]*$/i.test(part))) return [];
  const allDivisions = /(?:all|every|eight|8|সব|সকল|আট|৮).{0,35}(?:divisions?|বিভাগ)|(?:divisions?|বিভাগ).{0,25}(?:সব|সবগুলো|all|eight|8|আট|৮)|\bdivisions?\s*(?:gula(?:r)?|gulo(?:r)?)\b|বিভাগ(?:গুলো|গুলা|গুলোর|গুলার)/i.test(text);
  if (allDivisions) {
    const qualifier=text.match(/\b(?:in|of|for)\s+([\p{L}\p{M}][\p{L}\p{M}\s]*)/iu)?.[1]?.replace(/\b(?:all|every|the|eight|divisions?|weather|forecast|report|today|current|please|give|me)\b/gi,'').trim();
    if(qualifier&&!/Bangladesh|বাংলাদেশ/i.test(qualifier)&&!weatherLocation(qualifier))return [];
    const context=history.slice(-6).reverse().find(turn=>/divisions?|বিভাগ|Bangladesh|বাংলাদেশ/i.test(turn.text));
    const countryKnown=/Bangladesh|বাংলাদেশ/i.test(text)||explicit.length>0||!!context&&(/Bangladesh|বাংলাদেশ/i.test(context.text)||namedLocations(context.text).length>=2);
    return countryKnown?[...divisionWeatherLocations]:[];
  }
  if (explicit.length) return explicit;
  if (!/\b(?:those|these|their|them|ogula|oigula|egula|oder|tader)\b|ওগুলো|ওগুলোর|এগুলো|এগুলোর|ওদের|সবগুলো|সবগুলোর/i.test(text)) return [];
  // A pronoun resolves only to the nearest supplied turn containing cities.
  for (const turn of history.slice(-6).reverse()) {
    const places = namedLocations(turn.text);
    if (places.length) return places;
  }
  return [];
}
export function weatherOnlyRequest(text: string): boolean {
  return isWeatherRequest(text) && !/\b(?:open|close|play|pause|write|delete|send|install|minimize|maximize|restore|desktop|files?|folders?|research|models?|news|price|browser|clipboard|pc|computer|laptop|screen|clock|time|gpt|gemini|openai)\b|খুলে দাও|বন্ধ কর|গান|ফাইল|ফোল্ডার|পিসি|কম্পিউটার|ডেস্কটপ|সার্চ|গবেষণা|মডেল|উইন্ডো|কটা\s*বাজে|কত\s*বাজে|ক[য়য়]টা\s*বাজে/i.test(text);
}
export function weatherOptions(text: string): Record<string, unknown> {
  const days = text.match(/(?:next|আগামী)\s*([1-7১-৭])\s*(?:days?|দিন)/i)?.[1];
  const digits = (value: string) => value.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  return {
    ...(/tomorrow|আগামীকাল|কালকের/i.test(text) ? { forecastDays: 2 } : days ? { forecastDays: Number(digits(days)) } : {}),
    ...(/fahrenheit|ফারেনহাইট/i.test(text) ? { temperatureUnit: 'fahrenheit' } : {}),
  };
}
export function weatherCoverage(locations: WeatherLocation[], receipts: WeatherReceipt[]) {
  const items = locations.map(place => {
    const matches = receipts.filter(receipt => receipt.name === 'get_weather' && weatherLocation(String(receipt.args.location || receipt.result.location || ''))?.key === place.key);
    const receipt = matches.find(item => item.result.status === 'ok' && typeof item.result.conditions === 'string' && /[\d০-৯]/.test(String(item.result.temperature || ''))) || matches.at(-1);
    const complete = !!receipt && receipt.result.status === 'ok' && typeof receipt.result.conditions === 'string' && /[\d০-৯]/.test(String(receipt.result.temperature || ''));
    return { place, receipt, state: complete ? 'complete' as const : receipt ? 'blocked' as const : 'pending' as const };
  });
  return { items, pending: items.filter(item => item.state === 'pending').map(item => item.place), complete: items.every(item => item.state !== 'pending') };
}
export function weatherEvidence(locations: WeatherLocation[], receipts: WeatherReceipt[]) {
  return weatherCoverage(locations, receipts).items.map(({ place, receipt, state }) => ({
    city: place.query, cityBangla: place.bn, state,
    ...(receipt ? { status: receipt.result.status, conditions: receipt.result.conditions, temperature: receipt.result.temperature,
      humidity: receipt.result.humidity, windSpeed: receipt.result.windSpeed, feelsLike: receipt.result.feelsLike,
      observedAt: receipt.result.observedAt, timezone: receipt.result.timezone, source: receipt.result.source,
      forecast: receipt.result.forecast, message: receipt.result.message } : {}),
  }));
}
export function weatherAnswerCovers(text: string, locations: WeatherLocation[], receipts: WeatherReceipt[], request = ''): boolean {
  const value = normalized(text).replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  const items = weatherCoverage(locations, receipts).items;
  if (!text.trim() || !items.every(({ place }) => place.aliases.some(alias => value.includes(normalized(alias))))) return false;
  if (!items.some(item => item.state === 'complete')) return true;
  if (!/ডিগ্রি|degrees|temperature|তাপমাত্রা|celsius|fahrenheit|°[cf]/i.test(value)) return false;
  return items.every(({place, receipt, state}) => {
    if(state!=='complete')return /পাওয়া যায়নি|পাওয়া যাচ্ছে না|পাওয়া যাচ্ছে না|unavailable|missing|could not/i.test(value);
    const start=Math.min(...place.aliases.map(alias=>value.indexOf(normalized(alias))).filter(index=>index>=0));
    const next=locations.filter(other=>other.key!==place.key).flatMap(other=>other.aliases.map(alias=>value.indexOf(normalized(alias),start+1))).filter(index=>index>start);
    const section=value.slice(start,next.length?Math.min(...next):value.length);
    if(Number(weatherOptions(request).forecastDays||1)>1) {
      return Array.isArray(receipt!.result.forecast)&&receipt!.result.forecast.length>0&&receipt!.result.forecast.every(day=>{
        const item=day as Record<string,unknown>;
        return [item.high,item.low].every(temperature=>section.match(/-?\d+(?:\.\d+)?/g)?.map(Number).includes(Number.parseFloat(String(temperature))));
      });
    }
    const temperature=Number.parseFloat(String(receipt!.result.temperature));
    if(!section.match(/-?\d+(?:\.\d+)?/g)?.map(Number).includes(temperature))return false;
    const condition=String(receipt!.result.conditions).toLowerCase();
    if(/clear/.test(condition))return /clear|পরিষ্কার|রোদ/i.test(section);
    if(/cloud|overcast/.test(condition))return /cloud|overcast|মেঘ/i.test(section);
    if(/rain|drizzle|thunder/.test(condition))return /rain|drizzle|thunder|বৃষ্টি|বজ্র|গুঁড়ি|গুঁড়ি/i.test(section)&&!/(?:no|without)\s+(?:rain|drizzle)|বৃষ্টি\s*(?:নেই|হচ্ছে না)/i.test(section);
    if(/fog/.test(condition))return /fog|কুয়াশা|কুয়াশা/i.test(section);
    if(/snow/.test(condition))return /snow|তুষার/i.test(section);
    return section.includes(normalized(condition));
  });
}
const conditionsBangla: Record<string, string> = {
  'clear sky': 'আকাশ পরিষ্কার', 'mainly clear': 'মূলত পরিষ্কার', 'partly cloudy': 'আংশিক মেঘলা', overcast: 'মেঘাচ্ছন্ন',
  fog: 'কুয়াশা', 'depositing rime fog': 'ঘন কুয়াশা', 'light drizzle': 'হালকা গুঁড়িগুঁড়ি বৃষ্টি', 'moderate drizzle': 'গুঁড়িগুঁড়ি বৃষ্টি',
  'dense drizzle': 'ঘন গুঁড়িগুঁড়ি বৃষ্টি', 'slight rain': 'হালকা বৃষ্টি', 'light rain': 'হালকা বৃষ্টি', 'moderate rain': 'মাঝারি বৃষ্টি',
  'heavy rain': 'ভারী বৃষ্টি', 'slight rain showers': 'হালকা বৃষ্টির ঝাপটা', 'moderate rain showers': 'বৃষ্টির ঝাপটা',
  'violent rain showers': 'প্রবল বৃষ্টির ঝাপটা', thunderstorm: 'বজ্রসহ বৃষ্টি',
};
export function groundedWeatherReport(locations: WeatherLocation[], receipts: WeatherReceipt[], language: 'bn' | 'en', request = ''): string {
  const items = weatherCoverage(locations, receipts).items;
  const current=Number(weatherOptions(request).forecastDays||1)===1;
  const units=items.filter(item=>item.state==='complete').map(item=>/degrees\s*F|°F/i.test(String(item.receipt!.result.temperature))?'F':'C');
  const compact=current&&items.length>1&&units.length>0&&new Set(units).size===1;
  const number = (value: unknown) => String(value).replace(/degrees\s*C|°C/gi, language === 'bn' ? 'ডিগ্রি সেলসিয়াস' : '°C')
    .replace(/degrees\s*F|°F/gi, language === 'bn' ? 'ডিগ্রি ফারেনহাইট' : '°F').replace(/km\/?h/gi, language === 'bn' ? 'কিমি/ঘণ্টা' : 'km/h');
  const lines = items.map(({ place, receipt, state }) => {
    const city = language === 'bn' ? place.bn : place.query.replace(', Bangladesh', '');
    if (state !== 'complete') return language === 'bn' ? `${city}: আবহাওয়ার নির্ভরযোগ্য তথ্য পাওয়া যায়নি।` : `${city}: reliable weather data is unavailable.`;
    const result = receipt!.result, condition = String(result.conditions);
    if (Number(weatherOptions(request).forecastDays || 1) > 1) {
      const forecast = Array.isArray(result.forecast) ? result.forecast : [];
      const future = forecast.map(value => value as Record<string, unknown>).filter(value => value.high !== undefined && value.low !== undefined);
      if (!future.length) return language === 'bn' ? `${city}: চাওয়া পূর্বাভাস পাওয়া যায়নি।` : `${city}: the requested forecast is unavailable.`;
      return future.map(day => language === 'bn' ? `${city}, ${day.date}: সর্বোচ্চ ${number(day.high)}, সর্বনিম্ন ${number(day.low)}, ${conditionsBangla[String(day.conditions).toLowerCase()] || day.conditions}।` : `${city}, ${day.date}: high ${number(day.high)}, low ${number(day.low)}, ${day.conditions}.`).join('\n');
    }
    const temperature=compact?String(result.temperature).match(/-?\d+(?:\.\d+)?/)![0]:number(result.temperature);
    let line = language === 'bn' ? `${city}: ${temperature}, ${conditionsBangla[condition.toLowerCase()] || condition}।` : `${city}: ${temperature}, ${condition}.`;
    if (items.length === 1) {
      const details = [result.humidity ? (language === 'bn' ? `আর্দ্রতা ${result.humidity}` : `Humidity ${result.humidity}`) : '',
        result.windSpeed ? (language === 'bn' ? `বাতাস ${number(result.windSpeed)}` : `wind ${number(result.windSpeed)}`) : ''].filter(Boolean);
      if (details.length) line += ' ' + details.join(', ') + (language === 'bn' ? '।' : '.');
    }
    return line;
  });
  const heading=compact?(language==='bn'?`তাপমাত্রা ডিগ্রি ${units[0]==='F'?'ফারেনহাইটে':'সেলসিয়াসে'}।\n`:`Temperatures in degrees ${units[0]==='F'?'Fahrenheit':'Celsius'}.\n`):'';
  return heading+lines.join('\n');
}
