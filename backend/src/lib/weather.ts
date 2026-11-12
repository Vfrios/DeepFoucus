export type Weather = { temperatureC: number; description: string; location: string };

export async function getWeather(lat?: string, lon?: string): Promise<Weather | null> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return null;
  const latitude = lat && Number.isFinite(Number(lat)) ? lat : '-19.9';
  const longitude = lon && Number.isFinite(Number(lon)) ? lon : '-43.9';
  try {
    const params = new URLSearchParams({ lat: latitude, lon: longitude, appid: key, units: 'metric', lang: 'pt_br' });
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`);
    if (!response.ok) return null;
    const data = await response.json() as { main?: { temp?: number }; weather?: Array<{ description?: string }>; name?: string };
    if (typeof data.main?.temp !== 'number') return null;
    return { temperatureC: Math.round(data.main.temp), description: data.weather?.[0]?.description || 'condição não informada', location: data.name || 'localização atual' };
  } catch { return null; }
}
