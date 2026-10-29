import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createWeatherReader, readWeatherConfig } from '../tools/system-weather.mjs';
import { createResourceHandler } from '../tools/system-resources.mjs';

const source = readFileSync(new URL('../web/core/weather.js', import.meta.url), 'utf8');
const configured = { latitude: 50.2, longitude: -119.3, label: 'North & <Lake>' };
const payload = { current: { temperature_2m: 12.4, weather_code: 2, wind_speed_10m: 8.2, time: '2026-10-29T11:00' } };

test('weather config is generic, coarse and optional', () => {
  assert.equal(readWeatherConfig({}), null);
  assert.deepEqual(readWeatherConfig({ WIZARD_WEATHER_LATITUDE: '50.2', WIZARD_WEATHER_LONGITUDE: '-119.3', WIZARD_WEATHER_LABEL: 'North Lake' }),
    { latitude: 50.2, longitude: -119.3, label: 'North Lake' });
  assert.deepEqual(readWeatherConfig({ WIZARD_WEATHER_LATITUDE: '50.123456', WIZARD_WEATHER_LONGITUDE: '-119.987654' }),
    { latitude: 50.1, longitude: -120, label: 'Local' }, 'provider coordinates are rounded to a coarse 0.1-degree grid');
  assert.throws(() => readWeatherConfig({ WIZARD_WEATHER_LATITUDE: '50.2' }), /both/i);
  assert.throws(() => readWeatherConfig({ WIZARD_WEATHER_LATITUDE: '91', WIZARD_WEATHER_LONGITUDE: '1' }), /latitude/i);
});

test('weather reader bounds its provider read, caches success and returns stale data on failure', async () => {
  let calls = 0, fail = false, now = Date.parse('2026-10-29T18:00:00Z');
  const read = createWeatherReader({ config: configured, now: () => now, ttlMs: 600_000, staleMs: 21_600_000,
    fetchImpl: async url => {
      calls++; assert.equal(url.origin, 'https://api.open-meteo.com');
      assert.equal(url.searchParams.get('latitude'), '50.2'); assert.equal(url.searchParams.get('longitude'), '-119.3');
      if (fail) throw new Error('offline');
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const fresh = await read();
  assert.deepEqual(fresh, { configured: true, label: configured.label, condition: 'Partly cloudy', temperatureC: 12, windKph: 8, observedAt: payload.current.time, fetchedAt: '2026-10-29T18:00:00.000Z', stale: false });
  assert.equal((await read()).stale, false); assert.equal(calls, 1, 'fresh cache avoids provider work');
  now += 600_001; fail = true; assert.equal((await read()).stale, true, 'bounded failure preserves a recent last reading');
  now += 21_600_001; await assert.rejects(read(), /unavailable/i, 'expired data is not presented indefinitely');
});

test('weather reader coalesces refreshes and throttles outage retries to one provider call per interval', async () => {
  const ttlMs = 600_000;
  let calls = 0, fail = false, releaseFailure, now = Date.parse('2026-10-29T18:00:00Z');
  const read = createWeatherReader({ config: configured, now: () => now, ttlMs, staleMs: 21_600_000,
    fetchImpl: async () => {
      calls++;
      if (fail) {
        await new Promise(resolve => { releaseFailure = resolve; });
        throw new Error('offline');
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await read();
  now += ttlMs + 1;
  fail = true;
  const concurrent = [read(), read(), read(), read()];
  assert.equal(calls, 2, 'concurrent stale reads share one provider refresh');
  releaseFailure();
  const stale = await Promise.all(concurrent);
  assert.ok(stale.every(value => value.stale), 'a failed refresh serves the recent cached reading');

  const repeated = await Promise.all([read(), read(), read()]);
  assert.ok(repeated.every(value => value.stale));
  assert.equal(calls, 2, 'repeated reads do not retry during the failed refresh interval');

  now += ttlMs + 1;
  const nextInterval = read();
  assert.equal(calls, 3, 'the provider is retried once after the failed refresh interval');
  releaseFailure();
  assert.equal((await nextInterval).stale, true);
});

test('same-origin weather route is owner-only, read-only and reports unconfigured quietly', async () => {
  const server = http.createServer(createResourceHandler(async () => ({}), null, null, async () => ({ configured: false }), 'qa-owner'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/system/weather`;
  try {
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await fetch(base, { headers: { 'tailscale-user-login': 'qa-other' } })).status, 403, 'another Tailnet user is not the owner');
    assert.equal((await fetch(base, { method: 'POST', headers: { 'tailscale-user-login': 'qa-owner' } })).status, 405);
    const result = await fetch(base, { headers: { 'tailscale-user-login': 'qa-owner' } });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { configured: false });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('private gateway admits the exact weather route through the existing authenticated adapter', () => {
  const caddy = readFileSync(new URL('../tools/system-resources.Caddyfile', import.meta.url), 'utf8');
  assert.match(caddy, /@system_reads path[^\n]*\/api\/system\/weather/);
  assert.match(caddy, /request_header -Tailscale-User-Login/);
  assert.match(caddy, /forward_auth 127\.0\.0\.1:19447/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:9582/);
});

function weatherFixture(responses, DateImpl = Date) {
  const hosts = [], events = [];
  const document = { hidden: false, querySelectorAll: q => q === '[data-home-weather]' ? hosts : [] };
  const window = { __wos: { idx: 0, desks: [{ wins: [] }] }, dispatchEvent: e => events.push(e.type) };
  let i = 0;
  const timeout = (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; };
  const context = { window, document, Event, AbortController, setTimeout: timeout, clearTimeout, queueMicrotask, Date: DateImpl,
    fetch: async () => responses[Math.min(i++, responses.length - 1)], console };
  vm.runInNewContext(source, context);
  return { weather: window.WosWeather, hosts, events };
}

test('shared weather UI is absent when unconfigured and escapes configured labels', async () => {
  const f = weatherFixture([new Response(JSON.stringify({ configured: false })), new Response(JSON.stringify({ configured: true, label: configured.label, condition: 'Partly cloudy', temperatureC: 12, windKph: 8, fetchedAt: new Date().toISOString(), stale: false }))]);
  await f.weather.update(true); assert.match(f.weather.home(), /data-home-weather hidden/);
  await f.weather.update(true); const html = f.weather.home();
  assert.match(html, /North &amp; &lt;Lake&gt;/); assert.doesNotMatch(html, /North & <Lake>/);
  assert.match(html, /Partly cloudy/); assert.match(html, /12°/); assert.match(html, /8 km\/h/);
});

test('client keeps the last weather quietly stale when a refresh fails', async () => {
  const ok = new Response(JSON.stringify({ configured: true, label: 'Coast', condition: 'Clear', temperatureC: 18, windKph: 4, fetchedAt: new Date().toISOString(), stale: false }));
  const bad = new Response('{}', { status: 503 });
  const f = weatherFixture([ok, bad]);
  await f.weather.update(true); assert.match(f.weather.home(), /Clear/);
  await f.weather.update(true); assert.match(f.weather.home(), /home-weather-stale/);
  assert.equal(f.weather.state.error, 'Unavailable');
});

test('client hides a last-known reading after the six-hour stale window', async () => {
  let now = Date.parse('2026-10-29T18:00:00Z');
  class FakeDate extends Date { static now() { return now; } }
  const ok = new Response(JSON.stringify({ configured: true, label: 'Coast', condition: 'Clear', temperatureC: 18, windKph: 4, fetchedAt: new Date(now).toISOString(), stale: false }));
  const bad = new Response('{}', { status: 503 });
  const f = weatherFixture([ok, bad], FakeDate);
  await f.weather.update(true); assert.match(f.weather.home(), /Clear/);
  now += 6 * 60 * 60_000 + 1;
  await f.weather.update(true);
  assert.match(f.weather.home(), /data-home-weather hidden/);
  assert.equal(f.weather.state.value, null);
});