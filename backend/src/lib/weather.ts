export type Weather = { temperatureC: number; description: string; location: string };

export interface PeriodRainChance {
  manha: number | null;
  tarde: number | null;
  noite: number | null;
}

export interface DetailedWeather {
  location: string;
  temperatureC: number;
  minC: number;
  maxC: number;
  description: string;
  rainChance: PeriodRainChance;
  maxRainChance: number;
  windKmh: number | null;
  windRelevant: boolean;
  needsUmbrella: boolean;
  needsJacket: boolean;
  provider: 'openweather' | 'open-meteo';
}

const DEFAULT_LAT = '-19.9167';
const DEFAULT_LON = '-43.9345';
const TIME_ZONE = 'America/Sao_Paulo';

function parseCoord(raw: string | undefined, fallback: string, min: number, max: number): string {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return String(n);
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'céu limpo',
  1: 'predominantemente limpo',
  2: 'parcialmente nublado',
  3: 'nublado',
  45: 'neblina',
  48: 'neblina com geada',
  51: 'garoa leve',
  53: 'garoa moderada',
  55: 'garoa forte',
  61: 'chuva leve',
  63: 'chuva moderada',
  65: 'chuva forte',
  71: 'neve leve',
  80: 'pancadas leves de chuva',
  81: 'pancadas moderadas de chuva',
  82: 'pancadas fortes de chuva',
  95: 'trovoadas',
  96: 'trovoadas com granizo',
  99: 'trovoadas fortes com granizo',
};

function wmoToDescription(code: number | undefined): string {
  if (typeof code !== 'number') return 'tempo estável';
  return WMO_DESCRIPTIONS[code] || 'tempo variável';
}

function saoPauloDateKey(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(date);
}

function maxOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(Math.max(...values));
}

function buildFlags(params: {
  temperatureC: number;
  minC: number;
  rainChance: PeriodRainChance;
  windKmh: number | null;
}) {
  const rainVals = [params.rainChance.manha, params.rainChance.tarde, params.rainChance.noite].filter(
    (v): v is number => typeof v === 'number'
  );
  const maxRainChance = rainVals.length ? Math.max(...rainVals) : 0;
  const windRelevant = typeof params.windKmh === 'number' && params.windKmh >= 30;
  const needsUmbrella = maxRainChance >= 50;
  const needsJacket = params.minC <= 16 || params.temperatureC <= 16;
  return { maxRainChance, windRelevant, needsUmbrella, needsJacket };
}

async function fetchOpenMeteo(
  latitude: string,
  longitude: string,
  signal?: AbortSignal,
  now = new Date()
): Promise<DetailedWeather | null> {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,weather_code,wind_speed_10m',
    hourly: 'precipitation_probability,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: TIME_ZONE,
    forecast_days: '1',
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    hourly?: { time?: string[]; precipitation_probability?: number[]; wind_speed_10m?: number[] };
  };

  if (typeof data.current?.temperature_2m !== 'number') return null;

  const temperatureC = Math.round(data.current.temperature_2m);
  const minC =
    typeof data.daily?.temperature_2m_min?.[0] === 'number'
      ? Math.round(data.daily.temperature_2m_min[0])
      : temperatureC;
  const maxC =
    typeof data.daily?.temperature_2m_max?.[0] === 'number'
      ? Math.round(data.daily.temperature_2m_max[0])
      : temperatureC;

  const todayStr = saoPauloDateKey(now);
  const times = Array.isArray(data.hourly?.time) ? data.hourly!.time! : [];
  const probs = Array.isArray(data.hourly?.precipitation_probability)
    ? data.hourly!.precipitation_probability!
    : [];
  const winds = Array.isArray(data.hourly?.wind_speed_10m) ? data.hourly!.wind_speed_10m! : [];

  const manha: number[] = [];
  const tarde: number[] = [];
  const noite: number[] = [];
  const dayWinds: number[] = [];
  if (typeof data.current.wind_speed_10m === 'number') {
    dayWinds.push(data.current.wind_speed_10m);
  }

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t || !t.startsWith(todayStr)) continue;
    const hour = Number(t.slice(11, 13));
    const prob = probs[i];
    const wind = winds[i];
    if (typeof wind === 'number') dayWinds.push(wind);
    if (typeof prob === 'number') {
      if (hour >= 6 && hour < 12) manha.push(prob);
      else if (hour >= 12 && hour < 18) tarde.push(prob);
      else if (hour >= 18 && hour <= 23) noite.push(prob);
    }
  }

  const rainChance: PeriodRainChance = {
    manha: maxOrNull(manha),
    tarde: maxOrNull(tarde),
    noite: maxOrNull(noite),
  };
  const windKmh = dayWinds.length ? Math.round(Math.max(...dayWinds)) : null;
  const flags = buildFlags({ temperatureC, minC, rainChance, windKmh });

  return {
    location: 'sua região',
    temperatureC,
    minC,
    maxC,
    description: wmoToDescription(data.current.weather_code),
    rainChance,
    windKmh,
    ...flags,
    provider: 'open-meteo',
  };
}

async function fetchOpenWeather(
  latitude: string,
  longitude: string,
  key: string,
  signal?: AbortSignal,
  now = new Date()
): Promise<DetailedWeather | null> {
  const baseParams = new URLSearchParams({
    lat: latitude,
    lon: longitude,
    appid: key,
    units: 'metric',
    lang: 'pt_br',
  });

  const [curRes, fcRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?${baseParams}`, { signal }),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?${baseParams}&cnt=8`, { signal }).catch(() => null),
  ]);

  if (!curRes.ok) return null;
  const cur = (await curRes.json()) as {
    main?: { temp?: number; temp_min?: number; temp_max?: number };
    weather?: Array<{ description?: string }>;
    wind?: { speed?: number };
    name?: string;
  };
  if (typeof cur.main?.temp !== 'number') return null;

  const temperatureC = Math.round(cur.main.temp);
  const temps: number[] = [temperatureC];
  if (typeof cur.main.temp_min === 'number') temps.push(Math.round(cur.main.temp_min));
  if (typeof cur.main.temp_max === 'number') temps.push(Math.round(cur.main.temp_max));

  const winds: number[] = [];
  if (typeof cur.wind?.speed === 'number') winds.push(cur.wind.speed * 3.6);

  const manha: number[] = [];
  const tarde: number[] = [];
  const noite: number[] = [];
  const todayStr = saoPauloDateKey(now);

  if (fcRes && fcRes.ok) {
    try {
      const fc = (await fcRes.json()) as {
        list?: Array<{
          dt?: number;
          main?: { temp_min?: number; temp_max?: number };
          pop?: number;
          wind?: { speed?: number };
        }>;
      };
      for (const item of fc.list || []) {
        if (typeof item.dt !== 'number') continue;
        const d = new Date(item.dt * 1000);
        if (saoPauloDateKey(d) !== todayStr) continue;
        if (typeof item.main?.temp_min === 'number') temps.push(Math.round(item.main.temp_min));
        if (typeof item.main?.temp_max === 'number') temps.push(Math.round(item.main.temp_max));
        if (typeof item.wind?.speed === 'number') winds.push(item.wind.speed * 3.6);
        if (typeof item.pop === 'number') {
          const hour = Number(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: TIME_ZONE,
              hour: '2-digit',
              hourCycle: 'h23',
            }).format(d)
          );
          const pct = Math.round(item.pop * 100);
          if (hour >= 6 && hour < 12) manha.push(pct);
          else if (hour >= 12 && hour < 18) tarde.push(pct);
          else if (hour >= 18 && hour <= 23) noite.push(pct);
        }
      }
    } catch {
      /* forecast parse optional */
    }
  }

  const minC = Math.min(...temps);
  const maxC = Math.max(...temps);
  const rainChance: PeriodRainChance = {
    manha: maxOrNull(manha),
    tarde: maxOrNull(tarde),
    noite: maxOrNull(noite),
  };
  const windKmh = winds.length ? Math.round(Math.max(...winds)) : null;
  const flags = buildFlags({ temperatureC, minC, rainChance, windKmh });

  return {
    location: cur.name || 'sua região',
    temperatureC,
    minC,
    maxC,
    description: cur.weather?.[0]?.description || 'tempo estável',
    rainChance,
    windKmh,
    ...flags,
    provider: 'openweather',
  };
}

/**
 * Busca clima detalhado para o briefing da manhã.
 * Usa OpenWeather se `OPENWEATHER_API_KEY` estiver configurada; caso contrário (ou se falhar), usa Open-Meteo (sem chave).
 */
export async function getDetailedWeather(
  lat?: string,
  lon?: string,
  opts: { signal?: AbortSignal; now?: Date } = {}
): Promise<DetailedWeather | null> {
  const latitude = parseCoord(lat, DEFAULT_LAT, -90, 90);
  const longitude = parseCoord(lon, DEFAULT_LON, -180, 180);
  const key = (process.env.OPENWEATHER_API_KEY || '').trim();

  if (key) {
    try {
      const ow = await fetchOpenWeather(latitude, longitude, key, opts.signal, opts.now);
      if (ow) return ow;
    } catch {
      /* fallback para Open-Meteo */
    }
  }

  try {
    return await fetchOpenMeteo(latitude, longitude, opts.signal, opts.now);
  } catch {
    return null;
  }
}

/** Compatibilidade legada. */
export async function getWeather(lat?: string, lon?: string): Promise<Weather | null> {
  const detailed = await getDetailedWeather(lat, lon);
  if (!detailed) return null;
  return {
    temperatureC: detailed.temperatureC,
    description: detailed.description,
    location: detailed.location,
  };
}
