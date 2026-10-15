/* Wizard UX core: who and when, from the Wizard Agent Service.
 *
 * Nothing about any particular owner, agent or place is built into the UX. At start it reads
 * GET /wizard/v1/bootstrap (Wizard OS settings.json + what this box can do) and keeps the last
 * answer on the device, so a reload paints instantly and offline still works.
 *
 *   WizConfig.agent()          the agent's display name ("Wizard" until the owner names it)
 *   WizConfig.owner()          the owner's name, or '' (UI then says "you")
 *   WizConfig.timeZone()       settings timezone, else the device's own zone
 *   WizConfig.dayStart(t)      start (ms) of the owner's day containing t (settings day_starts_at)
 *   WizConfig.dayParts(t)      {y, m, d, dow} of t in the owner's zone
 *   WizConfig.endpoint(name)   'transcribe' | 'route' | 'apps' | 'upload' URL, or '' when absent
 *   WizConfig.has(capability)  voice, router, files, approvals, steer, joined_delegation, markdown
 *   WizConfig.ready            promise for the first live answer (resolves even if it fails)
 *   'wizard:config' event      fired on window whenever the answer changes
 *
 * Backwards compatibility: with an Agent Service that has no bootstrap endpoint yet, the UX falls
 * back to the shell's own same-origin api/transcribe and api/route sidecar, as before. */
(() => {
  'use strict';
  const KEY = 'wux.bootstrap.v1';
  const DEFAULTS = {
    bootstrap: 0,
    settings: { owner: { name: '', place: '' }, agent: { name: 'Wizard' }, clock: { timezone: '', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
    capabilities: {},
    endpoints: {},
  };
  let B = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || DEFAULTS; } catch (e) { return DEFAULTS; } })();
  let live = false;

  const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
  const zoneOk = z => { if (!z) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; } };
  const fmtCache = new Map();
  const fmt = z => {
    if (!fmtCache.has(z)) fmtCache.set(z, new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }));
    return fmtCache.get(z);
  };
  const DOWS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  const C = {
    get raw() { return B; },
    get live() { return live; },
    agent() { return (B.settings?.agent?.name || 'Wizard').trim() || 'Wizard'; },
    // Match the configured spoken name literally, with a boundary (never a name prefix).
    stripAddress(text) {
      const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const names = [...new Set([C.agent(), 'Wizard'])].sort((a, b) => b.length - a.length);
      return String(text || '').trim().replace(new RegExp('^(?:(?:hey|ok|okay)\\s+)?(?:' + names.map(escape).join('|') + ')(?:[,.!]?\\s+|[,.!]?$)', 'i'), '');
    },
    owner() { return (B.settings?.owner?.name || '').trim(); },
    place() { return (B.settings?.owner?.place || '').trim(); },
    vocabulary() { return Array.isArray(B.settings?.voice?.vocabulary) ? B.settings.voice.vocabulary : []; },
    timeZone() { const z = B.settings?.clock?.timezone; return zoneOk(z) ? z : deviceZone(); },
    /* Wall-clock parts of instant t in the owner's zone. */
    dayParts(t = Date.now()) {
      const p = {}; for (const x of fmt(C.timeZone()).formatToParts(new Date(t))) p[x.type] = x.value;
      return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second, dow: DOWS[p.weekday] ?? 0 };
    },
    /* Offset (ms) of the owner's zone from UTC at instant t. */
    offset(t = Date.now()) { const p = C.dayParts(t); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000; },
    /* Start of the owner's working day that contains t (day_starts_at, e.g. 06:00), as a UTC ms instant. */
    dayStart(t = Date.now()) {
      const [hh, mm] = String(B.settings?.clock?.day_starts_at || '00:00').split(':').map(Number);
      const shift = ((hh || 0) * 60 + (mm || 0)) * 6e4;
      const off = C.offset(t);
      const DAY = 864e5;
      return Math.floor((t + off - shift) / DAY) * DAY + shift - off;
    },
    endpoint(name) {
      if (B.bootstrap) return B.endpoints?.[name] || '';
      // Pre-bootstrap Agent Service: the shell's own sidecar answers these, same origin as the page.
      return { transcribe: 'api/transcribe', route: 'api/route' }[name] || '';
    },
    has(cap) { return B.bootstrap ? !!B.capabilities?.[cap] : (cap === 'voice' || cap === 'router' || cap === 'files' || cap === 'approvals' || cap === 'steer'); },
    /* One audio take → text, through whichever transcription endpoint this box has. */
    async transcribe(blob, { prompt = '', language = '', signal } = {}) {
      const url = C.endpoint('transcribe');
      if (!url) throw Object.assign(new Error('Voice is not set up on this Wizard'), { code: 'no_voice' });
      const t0 = performance.now();
      let r;
      if (B.bootstrap) {
        const type = (blob.type || 'audio/webm').split(';')[0];
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
        r = await fetch(url, { method: 'POST', signal, credentials: 'same-origin', headers: { 'Content-Type': type, 'X-Wizard-Filename': `voice.${ext}` }, body: blob });
      } else {
        const fd = new FormData();
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        fd.append('file', blob, `voice.${ext}`); fd.append('language', language || 'en');
        if (prompt) fd.append('prompt', prompt);
        r = await fetch(url, { method: 'POST', signal, body: fd });
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { status: r.status });
      return { text: String(j.text || '').trim(), ms: j.ms ?? Math.round(performance.now() - t0), model: j.model || '' };
    },
    /* Spoken names the transcriber should spell right: the agent, the owner, the apps, the owner's words. */
    voicePrompt(extra = []) {
      const names = [C.agent(), C.owner(), ...C.vocabulary(), ...extra].filter(Boolean);
      return names.length ? `Names: ${[...new Set(names)].join(', ')}.` : '';
    },
    ready: null,
  };

  async function load() {
    try {
      const r = await fetch('/wizard/v1/bootstrap', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const next = await r.json();
      if (!next || typeof next.bootstrap !== 'number') throw new Error('bad bootstrap');
      const changed = JSON.stringify(next) !== JSON.stringify(B);
      B = next; live = true;
      try { localStorage.setItem(KEY, JSON.stringify(B)); } catch (e) {}
      if (changed) window.dispatchEvent(new CustomEvent('wizard:config', { detail: B }));
    } catch (e) {
      // 404 = an Agent Service without bootstrap yet: keep sidecar fallbacks, forget any stale cache.
      if (String(e.message).includes('404') && B.bootstrap) {
        B = DEFAULTS; try { localStorage.removeItem(KEY); } catch (e2) {}
        window.dispatchEvent(new CustomEvent('wizard:config', { detail: B }));
      }
    }
    return B;
  }
  C.ready = load();
  // Settings can change while the app is open (the owner renames the agent): refresh on focus.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  // Clock text in the owner's zone (settings timezone, else the device's own).
  C.hm = (t = Date.now()) => { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: C.timeZone() || undefined }).format(t); } catch (e) { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } };
  C.dateLabel = (t = Date.now(), opts = { weekday: 'short', day: 'numeric', month: 'short' }) => { try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: C.timeZone() || undefined }).format(t); } catch (e) { return new Date(t).toLocaleDateString(undefined, opts); } };
  window.WizConfig = C;
})();
