// Generic, private weather reader for Home. Coordinates and labels come only from deployment configuration.
const PROVIDER = 'https://api.open-meteo.com/v1/forecast';
const CODES = new Map([
  [0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Cloudy'],
  [45, 'Fog'], [48, 'Fog'], [51, 'Light drizzle'], [53, 'Drizzle'], [55, 'Heavy drizzle'],
  [56, 'Freezing drizzle'], [57, 'Freezing drizzle'], [61, 'Light rain'], [63, 'Rain'], [65, 'Heavy rain'],
  [66, 'Freezing rain'], [67, 'Freezing rain'], [71, 'Light snow'], [73, 'Snow'], [75, 'Heavy snow'],
  [77, 'Snow grains'], [80, 'Rain showers'], [81, 'Rain showers'], [82, 'Heavy showers'],
  [85, 'Snow showers'], [86, 'Heavy snow showers'], [95, 'Thunderstorm'], [96, 'Thunderstorm'], [99, 'Thunderstorm'],
]);
const finite = value => value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const coarse = value => Math.round(value * 10) / 10;

export function readWeatherConfig(env = process.env) {
  const rawLat = String(env.WIZARD_WEATHER_LATITUDE || '').trim();
  const rawLon = String(env.WIZARD_WEATHER_LONGITUDE || '').trim();
  if (!rawLat && !rawLon) return null;
  if (!rawLat || !rawLon) throw new Error('WIZARD_WEATHER_LATITUDE and WIZARD_WEATHER_LONGITUDE must both be set');
  const latitude = finite(rawLat), longitude = finite(rawLon);
  if (latitude == null || latitude < -90 || latitude > 90) throw new Error('WIZARD_WEATHER_LATITUDE must be between -90 and 90');
  if (longitude == null || longitude < -180 || longitude > 180) throw new Error('WIZARD_WEATHER_LONGITUDE must be between -180 and 180');
  const label = String(env.WIZARD_WEATHER_LABEL || 'Local').trim();
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('WIZARD_WEATHER_LABEL must be 1-80 printable characters');
  return { latitude: coarse(latitude), longitude: coarse(longitude), label };
}

export function createWeatherReader({
  config = readWeatherConfig(), fetchImpl = fetch, now = Date.now,
  ttlMs = 10 * 60_000, staleMs = 6 * 60 * 60_000,
} = {}) {
  let cached = null, cachedAt = 0, failedAt = null, refreshPromise = null;
  const staleReading = at => cached && at - cachedAt <= staleMs ? { ...cached, stale: true } : null;
  const refresh = async at => {
    try {
      const url = new URL(PROVIDER);
      url.searchParams.set('latitude', String(config.latitude));
      url.searchParams.set('longitude', String(config.longitude));
      url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m');
      url.searchParams.set('temperature_unit', 'celsius');
      url.searchParams.set('wind_speed_unit', 'kmh');
      url.searchParams.set('timezone', 'auto');
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Weather provider unavailable');
      const raw = await response.text();
      if (raw.length > 65_536) throw new Error('Invalid weather response');
      const current = JSON.parse(raw)?.current;
      const temperatureC = finite(current?.temperature_2m), windKph = finite(current?.wind_speed_10m), code = finite(current?.weather_code);
      if (temperatureC == null || temperatureC < -100 || temperatureC > 70 || code == null) throw new Error('Invalid weather response');
      cachedAt = at;
      failedAt = null;
      cached = {
        configured: true,
        label: config.label,
        condition: CODES.get(code) || 'Current conditions',
        temperatureC: Math.round(temperatureC),
        windKph: windKph == null || windKph < 0 || windKph > 500 ? null : Math.round(windKph),
        observedAt: typeof current.time === 'string' ? current.time.slice(0, 32) : '',
        fetchedAt: new Date(at).toISOString(),
        stale: false,
      };
      return { ...cached };
    } catch {
      failedAt = at;
      const stale = staleReading(at);
      if (stale) return stale;
      throw new Error('Weather unavailable');
    }
  };
  return async () => {
    if (!config) return { configured: false };
    const at = now();
    if (cached && at - cachedAt <= ttlMs) return { ...cached, stale: false };
    if (failedAt != null && at - failedAt <= ttlMs) {
      const stale = staleReading(at);
      if (stale) return stale;
      throw new Error('Weather unavailable');
    }
    if (!refreshPromise) refreshPromise = refresh(at).finally(() => { refreshPromise = null; });
    return refreshPromise;
  };
}
