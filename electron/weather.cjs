const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const WEATHER_CODES = Object.freeze({
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
});

async function readJson(url, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`[Orvix Live Tool: get_weather] HTTP ${response.status} from ${url}: ${text.slice(0, 120)}`);
        if (response.status === 429) throw new Error("The free weather service is busy. Try again in a moment.");
        throw new Error(`Weather service returned HTTP ${response.status}.`);
      }
      return await response.json();
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      throw err;
    }
  }
}

const STOP_WORDS = new Set([
  "and", "or", "also", "about", "from", "with", "the", "yhr", "thr", "teh", "a", "an",
  "in", "at", "for", "of", "to", "weather", "forecast", "current", "city", "chk",
  "check", "please", "me", "tell", "what", "whats", "how", "is", "like"
]);
const GENERIC_WORDS = new Set([
  "there", "here", "now", "today", "tomorrow", "somewhere", "anywhere", "my place",
  "current location", "that", "this", "it", "sure", "double check", "check again", "again"
]);

let lastResolvedPlace = null;

const PRE_SEEDED_CITIES = {
  tokyo: { name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan', admin1: 'Tokyo' },
  london: { name: 'London', latitude: 51.50853, longitude: -0.12574, country: 'United Kingdom', admin1: 'England' },
  paris: { name: 'Paris', latitude: 48.85341, longitude: 2.3488, country: 'France', admin1: 'Île-de-France' },
  newyork: { name: 'New York', latitude: 40.71427, longitude: -74.00597, country: 'United States', admin1: 'New York' },
  dhaka: { name: 'Dhaka', latitude: 23.7104, longitude: 90.4074, country: 'Bangladesh', admin1: 'Dhaka Division' },
  rangpur: { name: 'Rangpur', latitude: 25.7439, longitude: 89.2752, country: 'Bangladesh', admin1: 'Rangpur Division' },
  kurigram: { name: 'Kurigram', latitude: 25.8054, longitude: 89.6361, country: 'Bangladesh', admin1: 'Rangpur Division' },
  chattogram: { name: 'Chattogram', latitude: 22.3569, longitude: 91.7832, country: 'Bangladesh', admin1: 'Chattogram Division' },
  chittagong: { name: 'Chattogram', latitude: 22.3569, longitude: 91.7832, country: 'Bangladesh', admin1: 'Chattogram Division' },
  rajshahi: { name: 'Rajshahi', latitude: 24.3745, longitude: 88.6042, country: 'Bangladesh', admin1: 'Rajshahi Division' },
  khulna: { name: 'Khulna', latitude: 22.8456, longitude: 89.5403, country: 'Bangladesh', admin1: 'Khulna Division' },
  barishal: { name: 'Barishal', latitude: 22.701, longitude: 90.3535, country: 'Bangladesh', admin1: 'Barishal Division' },
  barisal: { name: 'Barishal', latitude: 22.701, longitude: 90.3535, country: 'Bangladesh', admin1: 'Barishal Division' },
  sylhet: { name: 'Sylhet', latitude: 24.8949, longitude: 91.8692, country: 'Bangladesh', admin1: 'Sylhet Division' },
  mymensingh: { name: 'Mymensingh', latitude: 24.7471, longitude: 90.4203, country: 'Bangladesh', admin1: 'Mymensingh Division' },
  mymensing: { name: 'Mymensingh', latitude: 24.7471, longitude: 90.4203, country: 'Bangladesh', admin1: 'Mymensingh Division' },
  sydney: { name: 'Sydney', latitude: -33.86785, longitude: 151.20732, country: 'Australia', admin1: 'New South Wales' },
  berlin: { name: 'Berlin', latitude: 52.52437, longitude: 13.41053, country: 'Germany', admin1: 'Land Berlin' },
  toronto: { name: 'Toronto', latitude: 43.70011, longitude: -79.4163, country: 'Canada', admin1: 'Ontario' },
  singapore: { name: 'Singapore', latitude: 1.28967, longitude: 103.85007, country: 'Singapore' },
  dubai: { name: 'Dubai', latitude: 25.07725, longitude: 55.30927, country: 'United Arab Emirates', admin1: 'Dubai' },
};
const GEOCODE_CACHE = new Map(Object.entries(PRE_SEEDED_CITIES));

function cleanLocation(input) {
  let value = typeof input === "string" ? input : input?.location || input?.city || input?.place || input?.query;
  if (Array.isArray(value)) {
    value = value.filter(v => typeof v === "string").join(" ");
  }
  if (typeof value === "object" && value !== null) {
    value = value.name || value.city || Object.values(value).join(" ");
  }
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
}

async function resolveLocation(rawQuery) {
  if (!rawQuery) return lastResolvedPlace;
  // Strip punctuation like '?', '!', commas, periods, quotes
  const sanitized = rawQuery.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const trimmed = sanitized.toLowerCase();
  if (!trimmed || GENERIC_WORDS.has(trimmed)) return lastResolvedPlace;

  const words = sanitized.split(/\s+/).filter(Boolean);
  const meaningful = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  const targetQuery = meaningful.length ? meaningful.join(" ") : sanitized;

  const normalizedKey = targetQuery.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (GEOCODE_CACHE.has(normalizedKey)) {
    const cached = GEOCODE_CACHE.get(normalizedKey);
    lastResolvedPlace = cached;
    return cached;
  }

  // 1. Try target query directly
  const geocode = new URL(GEOCODING_URL);
  geocode.search = new URLSearchParams({ name: targetQuery, count: "5", language: "en", format: "json" }).toString();
  let res = await readJson(geocode).catch(() => ({}));
  if (res.results?.length) {
    const match = res.results[0];
    GEOCODE_CACHE.set(normalizedKey, match);
    lastResolvedPlace = match;
    return match;
  }

  // 2. Try raw query directly
  if (targetQuery !== rawQuery.trim()) {
    geocode.search = new URLSearchParams({ name: rawQuery.trim(), count: "5", language: "en", format: "json" }).toString();
    res = await readJson(geocode).catch(() => ({}));
    if (res.results?.length) return res.results[0];
  }

  // 3. Try each word in meaningful words as city name, and match qualifiers
  const candidateWords = meaningful.length ? meaningful : words;
  for (let i = 0; i < candidateWords.length; i++) {
    const candidateCity = candidateWords[i];
    const otherWords = candidateWords.filter((_, idx) => idx !== i).map(w => w.toLowerCase());

    geocode.search = new URLSearchParams({ name: candidateCity, count: "10", language: "en", format: "json" }).toString();
    res = await readJson(geocode).catch(() => ({}));
    if (res.results?.length) {
      if (otherWords.length) {
        const matched = res.results.find(place => {
          const text = [place.name, place.country, place.admin1, place.admin2, place.admin3].filter(Boolean).join(" ").toLowerCase();
          return otherWords.some(w => text.includes(w));
        });
        if (matched) return matched;
      }
      return res.results[0];
    }
  }

  return null;
}

async function getWeather(input = {}) {
  try {
    const locationQuery = cleanLocation(input);
    console.log(`[Orvix Live Tool: get_weather] Called with:`, input, `-> Cleaned location: "${locationQuery}"`);
    if ((!locationQuery || GENERIC_WORDS.has(locationQuery.toLowerCase())) && !lastResolvedPlace) {
      console.warn(`[Orvix Live Tool: get_weather] Location needed, no location specified.`);
      return {
        status: "location_needed",
        message: "Please tell the user: which city or place would you like the weather for?",
      };
    }

    const rawDays = input.forecastDays;
    const forecastDays = (rawDays !== undefined && Number.isInteger(Number(rawDays)) && Number(rawDays) >= 1 && Number(rawDays) <= 7)
      ? Number(rawDays)
      : 1;
    const unit = input.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius";
    const includeHourly = input.includeHourly === true;

    const place = await resolveLocation(locationQuery);
    if (!place) {
      console.error(`[Orvix Live Tool: get_weather] Geocoding failed for: "${locationQuery}"`);
      return {
        status: "location_not_found",
        searchedQuery: locationQuery,
        message: `Could not find a place named '${locationQuery}'. Please ask the user to clarify or name the city.`,
      };
    }

    console.log(`[Orvix Live Tool: get_weather] Resolved place: ${place.name}, ${place.country} (${place.latitude}, ${place.longitude})`);
    lastResolvedPlace = place;

    const forecast = new URL(FORECAST_URL);
    const params = {
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
      forecast_days: String(forecastDays),
      temperature_unit: unit,
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
      timezone: "auto",
    };
    if (includeHourly) params.hourly = "temperature_2m,precipitation_probability,precipitation,weather_code";
    forecast.search = new URLSearchParams(params).toString();
    const data = await readJson(forecast);
    if (!data.current || !data.daily) {
      return {
        status: "unavailable",
        message: "The weather service returned incomplete forecast data. Please try again shortly.",
      };
    }

    const describe = code => WEATHER_CODES[code] ?? "unknown conditions";
    const unitSymbol = (unit === "fahrenheit" || data.current_units?.temperature_2m === "°F") ? " degrees F" : " degrees C";
    const windUnit = data.current_units?.wind_speed_10m ?? "km/h";
    const result = {
      status: "ok",
      location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
      conditions: describe(data.current.weather_code),
      temperature: `${data.current.temperature_2m} ${unitSymbol}`,
      feelsLike: `${data.current.apparent_temperature} ${unitSymbol}`,
      humidity: `${data.current.relative_humidity_2m}%`,
      windSpeed: `${data.current.wind_speed_10m} ${windUnit}`,
      todayHigh: data.daily?.temperature_2m_max?.[0] !== undefined ? `${data.daily.temperature_2m_max[0]} ${unitSymbol}` : undefined,
      todayLow: data.daily?.temperature_2m_min?.[0] !== undefined ? `${data.daily.temperature_2m_min[0]} ${unitSymbol}` : undefined,
      observedAt: data.current.time,
      timezone: data.timezone,
      source: 'Open-Meteo',
    };
    if (forecastDays > 1 && Array.isArray(data.daily?.time) && data.daily.time.length > 1) {
      result.forecast = data.daily.time.slice(1, forecastDays).map((date, index) => ({
        date,
        conditions: describe(data.daily.weather_code[index + 1]),
        high: `${data.daily.temperature_2m_max[index + 1]} ${unitSymbol}`,
        low: `${data.daily.temperature_2m_min[index + 1]} ${unitSymbol}`,
      }));
    }
    if (includeHourly && Array.isArray(data.hourly?.time)) {
      result.hourly = data.hourly.time.slice(0, 12).map((time, index) => ({
        time,
        conditions: describe(data.hourly.weather_code[index]),
        temperature: `${data.hourly.temperature_2m[index]} ${unitSymbol}`,
        precipitationProbability: `${data.hourly.precipitation_probability?.[index] ?? 0}%`,
      }));
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Orvix Live Tool: get_weather] ERROR: ${message}`);
    return {
      status: "unavailable",
      message: `Weather data is temporarily unavailable: ${message}`,
    };
  }
}

module.exports = { getWeather };
