/* Shared Home weather. The browser reads one same-origin, sanitized endpoint; coordinates never enter client code. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finite = value => value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const S = { value: null, configured: null, at: 0, error: '', busy: null, timer: null, controller: null };
  const desktopHome = () => !!window.__wux && (window.__wux.homeOpen || !window.__wux.ws?.[window.__wux.cur]?.wins?.length);
  const active = () => !document.hidden && (desktopHome() || (window.__wos?.idx === 0 && !window.__wos?.sheet && !window.__wos?.desks?.[0]?.wins?.length));
  function normalize(json) {
    if (json?.configured === false) return { configured: false, value: null };
    const temperatureC = finite(json?.temperatureC), windKph = finite(json?.windKph);
    if (json?.configured !== true || temperatureC == null || typeof json.condition !== 'string') throw new Error('Unavailable');
    return { configured: true, value: {
      label: String(json.label || 'Local').slice(0, 80), condition: json.condition.slice(0, 80),
      temperatureC: Math.round(temperatureC), windKph: windKph == null ? null : Math.round(windKph),
      fetchedAt: typeof json.fetchedAt === 'string' ? json.fetchedAt : '', stale: !!json.stale,
    } };
  }
  function content() {
    const value = S.value;
    if (!value) return '';
    const wind = value.windKph == null ? '' : `<span class="home-weather-wind">Wind ${esc(value.windKph)} km/h</span>`;
    const stale = value.stale || !!S.error;
    const label = `Weather in ${value.label}: ${value.condition}, ${value.temperatureC} degrees Celsius${value.windKph == null ? '' : `, wind ${value.windKph} kilometres per hour`}${stale ? ', last known reading' : ''}`;
    return `<div class="home-weather${stale ? ' home-weather-stale' : ''}" aria-label="${esc(label)}"><span class="home-weather-place">${esc(value.label)}</span><span class="home-weather-condition">${esc(value.condition)}</span><b>${esc(value.temperatureC)}°</b>${wind}</div>`;
  }
  function paint() {
    const html = content();
    for (const host of document.querySelectorAll('[data-home-weather]')) {
      host.hidden = !html;
      if (host.innerHTML !== html) host.innerHTML = html;
    }
  }
  function home() {
    queueMicrotask(sync);
    const html = content();
    return `<div class="home-weather-host" data-home-weather${html ? '' : ' hidden'}>${html}</div>`;
  }
  async function update(force = false) {
    if (S.busy) return S.busy;
    if (!force && !active()) return;
    if (!force && S.at && Date.now() - S.at < 10 * 60_000) return;
    const controller = S.controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    S.busy = fetch('/api/system/weather', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
      .then(json => {
        const next = normalize(json); S.configured = next.configured; S.value = next.value; S.error = ''; S.at = Date.now(); paint();
      })
      .catch(() => { S.error = 'Unavailable'; if (S.value) S.value = { ...S.value, stale: true }; paint(); })
      .finally(() => { clearTimeout(timeout); S.busy = null; S.controller = null; schedule(); window.dispatchEvent?.(new Event('wos:weather')); });
    return S.busy;
  }
  function schedule() {
    clearTimeout(S.timer); S.timer = null;
    if (active()) S.timer = setTimeout(() => { S.timer = null; update(); }, S.configured === false ? 60 * 60_000 : 10 * 60_000);
  }
  function sync() {
    if (!active()) { clearTimeout(S.timer); S.timer = null; S.controller?.abort(); return; }
    paint(); if (!S.busy) update();
  }
  document.addEventListener?.('visibilitychange', sync);
  window.WosWeather = { home, sync, update, normalize, html: content, get state() { return { value: S.value, configured: S.configured, at: S.at, error: S.error, busy: !!S.busy, timer: !!S.timer }; } };
})();
