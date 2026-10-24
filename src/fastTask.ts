// Small, observable task state for Fast requests that have a known checklist.
// A division is represented by its main city; one city is not the weather of
// every district in that division.
export const BANGLADESH_DIVISION_CITIES = [
  "Dhaka", "Chattogram", "Rajshahi", "Khulna", "Barishal", "Sylhet", "Rangpur", "Mymensingh",
] as const;

export type FastWeatherResult = {
  city: string;
  status: "ok" | "unavailable";
  location?: string;
  temperature?: string;
  conditions?: string;
  feelsLike?: string;
  humidity?: string;
  windSpeed?: string;
  todayHigh?: string;
  todayLow?: string;
  observedAt?: string;
  timezone?: string;
  detail?: string;
};

export type FastWeatherTask = {
  kind: "bangladesh-division-weather";
  requestedAt: number;
  results: Map<string, FastWeatherResult>;
  attempts: Map<string, number>;
  fillingGaps: boolean;
  cities?: string[];
};

function cityFor(value: string): string | null {
  const names = ["ঢাকা", "চট্টগ্রাম", "রাজশাহী", "খুলনা", "বরিশাল", "সিলেট", "রংপুর", "ময়মনসিংহ"];
  const translated=names.findIndex(name=>value.normalize("NFC").includes(name));
  if (translated>=0) return BANGLADESH_DIVISION_CITIES[translated];
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.includes("chittagong")) return "Chattogram";
  if (normalized.includes("barisal")) return "Barishal";
  return BANGLADESH_DIVISION_CITIES.find(city => normalized.includes(city.toLowerCase())) ?? null;
}

export function fastWeatherTaskFor(prompt: string): FastWeatherTask | null {
  const text = prompt.toLowerCase();
  const weather = /\bweather\b|\bforecast\b|\bget_weather\b|আবহাওয়া|আবহাওয়া|ওয়েদার|ওয়েদার|ওয়েথার/i.test(text);
  const divisions = /\bdivisions?\b|বিভাগ/i.test(text);
  const all = /\ball\b|\bevery\b|\beight\b|\b8\b|সব|সকল|আট/i.test(text);
  const national = /bangladesh|বাংলাদেশ/i.test(text) && !/\bdhaka\b|ঢাকা|\bsylhet\b|সিলেট|\brajshahi\b|রাজশাহী|\bchattogram\b|চট্টগ্রাম|\bkhulna\b|খুলনা|\bbarishal\b|বরিশাল|\brangpur\b|রংপুর|\bmymensingh\b|ময়মনসিংহ|ময়মনসিংহ/i.test(text);
  if (!weather) return null;
  const cities=[...new Set((prompt.match(/[\p{L}\p{M}\p{N}]+/gu) || []).map(cityFor).filter((city): city is string=>!!city))];
  if (!(divisions && all || national) && !cities.length) return null;
  return { kind: "bangladesh-division-weather", cities: divisions && all || national ? [...BANGLADESH_DIVISION_CITIES] : cities, requestedAt: Date.now(), results: new Map(), attempts: new Map(), fillingGaps: false };
}

export function pendingWeatherCities(task: FastWeatherTask): string[] {
  return (task.cities || BANGLADESH_DIVISION_CITIES).filter(city => {
    const item = task.results.get(city);
    return !item || (item.status === "unavailable" && (task.attempts.get(city) ?? 0) < 2);
  });
}

export function weatherAnswerCoversCities(text: string, cities: readonly string[] = BANGLADESH_DIVISION_CITIES): boolean {
  const aliases = [/\bdhaka\b|ঢাকা/i, /\b(?:chattogram|chittagong)\b|চট্টগ্রাম/i,
    /\brajshahi\b|রাজশাহী/i, /\bkhulna\b|খুলনা/i, /\b(?:barishal|barisal)\b|বরিশাল/i,
    /\bsylhet\b|সিলেট/i, /\brangpur\b|রংপুর/i, /\bmymensingh\b|ময়মনসিংহ|ময়মনসিংহ/i];
  const mentions = aliases.flatMap((alias, city) => [...text.matchAll(new RegExp(alias.source, "gi"))]
    .map(match => ({ city, start: match.index!, end: match.index! + match[0].length }))).sort((a, b) => a.start - b.start);
  const covered = new Set<number>();
  let sharedCities: number[] = [];
  const temperatureHeader = /celsius|°|temperature|degrees|ডিগ্রি|তাপমাত্রা/i.test(text);
  for (let index = 0; index < mentions.length; index++) {
    const section = text.slice(mentions[index].start, mentions[index + 1]?.start ?? text.length);
    if (/celsius|°|degrees|ডিগ্রি|তাপমাত্রা|unavailable|not available|পাওয়া যায়নি/i.test(section) ||
        temperatureHeader && /[\d০-৯]/.test(section)) {
      covered.add(mentions[index].city);
      for (const city of sharedCities) covered.add(city);
      sharedCities = [];
    } else {
      const connector = text.slice(mentions[index].end, mentions[index + 1]?.start ?? text.length).trim();
      if (/^(?:(?:and|আর|ও|এবং|,|&)\s*)+$/i.test(connector)) sharedCities.push(mentions[index].city);
      else sharedCities = [];
    }
  }
  return cities.every(city=>covered.has(BANGLADESH_DIVISION_CITIES.indexOf(city as typeof BANGLADESH_DIVISION_CITIES[number])));
}

export function cachedWeatherResultFor(task: FastWeatherTask, requestedCity: string): FastWeatherResult | null {
  const city = cityFor(requestedCity);
  if (!city) return null;
  const result = task.results.get(city);
  if (!result) return null;
  return result.status === "ok" || (task.attempts.get(city) ?? 0) >= 2 ? result : null;
}

export function recordWeatherResult(task: FastWeatherTask, requestedCity: string, raw: unknown): FastWeatherResult | null {
  const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (!["ok", "unavailable", "failed", "error"].includes(String(result.status ?? ""))) return null;
  const city = cityFor(requestedCity) ?? cityFor(String(result.location ?? ""));
  if (!city) return null;
  task.attempts.set(city, (task.attempts.get(city) ?? 0) + 1);
  const resolvedLocation = String(result.location ?? "");
  const ok = result.status === "ok" && typeof result.temperature === "string"
    && resolvedLocation.includes("Bangladesh") && cityFor(resolvedLocation) === city;
  const entry: FastWeatherResult = {
    city,
    status: ok ? "ok" : "unavailable",
    location: typeof result.location === "string" ? result.location : undefined,
    temperature: ok ? String(result.temperature) : undefined,
    conditions: ok && typeof result.conditions === "string" ? result.conditions : undefined,
    feelsLike: ok && typeof result.feelsLike === "string" ? result.feelsLike : undefined,
    humidity: ok && typeof result.humidity === "string" ? result.humidity : undefined,
    windSpeed: ok && typeof result.windSpeed === "string" ? result.windSpeed : undefined,
    todayHigh: ok && typeof result.todayHigh === "string" ? result.todayHigh : undefined,
    todayLow: ok && typeof result.todayLow === "string" ? result.todayLow : undefined,
    observedAt: ok && typeof result.observedAt === "string" ? result.observedAt : undefined,
    timezone: ok && typeof result.timezone === "string" ? result.timezone : undefined,
    detail: !ok ? String(result.message ?? result.error ?? (resolvedLocation ? `Resolved outside the requested Bangladesh city: ${resolvedLocation}` : "Weather unavailable")) : undefined,
  };
  task.results.set(city, entry);
  return entry;
}

export function weatherTaskContext(task: FastWeatherTask): string {
  const rows = (task.cities || BANGLADESH_DIVISION_CITIES).map(city => {
    const item = task.results.get(city);
    if (!item) return `${city}: not checked`;
    return item.status === "ok"
      ? `${city} (${item.location ?? city}): ${item.temperature ?? "unknown"}, ${item.conditions ?? "unknown"}; feels like ${item.feelsLike ?? "unknown"}; humidity ${item.humidity ?? "unknown"}; wind ${item.windSpeed ?? "unknown"}; high ${item.todayHigh ?? "unknown"}; low ${item.todayLow ?? "unknown"}; observation ${item.observedAt ?? "time unavailable"} ${item.timezone ?? ""}`
      : `${city}: unavailable (${item.detail ?? "lookup failed"})`;
  });
  return `Observed Open-Meteo weather for representative cities, requested ${new Date(task.requestedAt).toISOString()}:\n${rows.join("\n")}`;
}
