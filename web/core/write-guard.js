/* WizardOS — one guard for the shell's own writes (wizard-ux issue 1439; switch wizard/write-guard, off by default).
 * On 13 Nov a phone re-sent its 117 KB read state up to ~8 times a second for hours (issue 1428) and the Agent Service
 * froze four times. Each feature decides on its own when to resend, so this sits in the one layer every shell write
 * already goes through: window.fetch of this page. It acts only on same-origin POST/PUT/PATCH/DELETE while the switch
 * is on; with it off the call goes straight through, unchanged.
 *   1. The same write again (method, URL, body and Idempotency-Key) within 10 s gets the earlier answer; nothing goes
 *      on the wire. One resend after that is let through, then the same body is held for 10 minutes, unless a
 *      different body goes to that URL or the earlier send failed.
 *   2. More than 20 writes in a minute to one endpoint (method + path) trips a breaker: the endpoint pauses for 30 s,
 *      doubling up to 15 min. Paused writes get a local 429 with Retry-After, so each caller's own error path runs.
 *      Once per endpoint per day the shell files a bug through the Feedback app (endpoint, rate, build); without
 *      Feedback the report stays on this device (WosWriteGuard.reports()).
 *   3. A 429 with Retry-After (the Agent Service's per-device limit, wizard-agent-service issue 513) pauses that
 *      endpoint for as long as it says.
 * Uploads (XHR) and app frames (their own window) never pass through here. */
(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || window.fetch.wosWriteGuard) return;
  const ID = 'wizard/write-guard';
  const SAME_MS = 10000, HOLD_MS = 10 * 60000, WINDOW_MS = 60000, PER_MINUTE = 20;
  const PAUSE_MS = 30000, PAUSE_MAX = 15 * 60000, CALM_MS = 15 * 60000, RETRY_MAX = 60 * 60000, LANES_MAX = 500;
  const KEY = 'wos.write-guard.v1', KEPT_MAX = 20;
  const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const base = window.fetch;
  const now = () => Date.now();
  const on = () => { try { return String(document.documentElement.dataset.tweaks || '').split(/\s+/).includes(ID); } catch (_) { return false; } };
  const ends = new Map();    // 'METHOD /path' -> { sent: [times], until, level, trippedAt, why, counts }
  const targets = new Map(); // 'METHOD url'   -> { sig, at, resent, ok, kept, pending }
  const cap = (m, key, make) => {
    let v = m.get(key);
    if (!v) { v = make(); m.set(key, v); if (m.size > LANES_MAX) m.delete(m.keys().next().value); }
    return v;
  };
  const end = key => cap(ends, key, () => ({ sent: [], until: 0, level: 0, trippedAt: 0, why: '', counts: { sent: 0, dropped: 0, paused: 0, trips: 0 } }));

  function store() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }

  function headerOf(init, input, name) {
    try {
      const h = init && init.headers;
      if (h) return (typeof h.get === 'function' ? h.get(name) : Array.isArray(h) ? (h.find(([k]) => String(k).toLowerCase() === name) || [])[1] : Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1]) || '';
      return input && typeof input.headers?.get === 'function' ? input.headers.get(name) || '' : '';
    } catch (_) { return ''; }
  }
  // What this call is, or null when the guard has nothing to say about it (reads, other origins, unreadable input).
  function describe(input, init) {
    try {
      const isRequest = typeof Request === 'function' && input instanceof Request;
      const method = String((init && init.method) || (isRequest ? input.method : 'GET')).toUpperCase();
      if (!WRITES.has(method)) return null;
      const u = new URL(isRequest ? input.url : String(input), location.href);
      if (u.origin !== location.origin) return null;
      const body = init && 'body' in init ? init.body : undefined;
      // Only bodies we can compare without reading a stream take part in (1); every write counts for (2) and (3).
      const text = isRequest && body === undefined ? null : body == null ? '' : typeof body === 'string' ? body
        : typeof URLSearchParams === 'function' && body instanceof URLSearchParams ? body.toString() : null;
      const sig = text == null ? null : text + '\u0000' + headerOf(init, input, 'idempotency-key');
      return { method, endpoint: method + ' ' + u.pathname, target: method + ' ' + u.pathname + u.search, sig };
    } catch (_) { return null; }
  }

  function paused(e, ms) {
    const secs = Math.max(1, Math.ceil(ms / 1000));
    e.counts.paused++;
    return Promise.resolve(new Response(JSON.stringify({ error: { code: 'write_paused', message: `Wizard paused this write for ${secs} s: it was sent too often (${e.why}).` } }), {
      status: 429, statusText: 'Too Many Requests', headers: { 'Content-Type': 'application/json', 'Retry-After': String(secs), 'X-Wizard-Write-Guard': 'paused' },
    }));
  }
  function retryAfter(r) {
    const v = r.headers?.get?.('Retry-After'); if (!v) return 0;
    const n = Number(v); if (Number.isFinite(n)) return Math.min(RETRY_MAX, Math.max(0, n * 1000));
    const at = Date.parse(v); return Number.isFinite(at) ? Math.min(RETRY_MAX, Math.max(0, at - now())) : 0;
  }

  // Ids in a path (session ids, run ids) never leave the device in a report.
  const redact = p => p.split('/').map(s => s.length > 24 || /\d/.test(s) && s.length > 6 ? ':id' : s).join('/');
  const shell = () => { try { return String(document.documentElement.dataset.shell || ''); } catch (_) { return ''; } };
  function feedbackUrl() {
    try {
      const apps = JSON.parse(localStorage.getItem('wux.apps.v1') || '[]') || [];
      const a = apps.find(x => x && x.url && (x.id === 'feedback' || (Array.isArray(x.provides) && x.provides.includes('feedback'))));
      if (!a) return '';
      const u = new URL('api/feedback', new URL(String(a.url).replace(/\/?$/, '/'), location.href));
      return u.origin === location.origin ? u.href : '';
    } catch (_) { return ''; }
  }
  function report(e, endpoint, rate, pauseMs) {
    const day = new Date(now()).toISOString().slice(0, 10), s = store();
    s.reported = s.reported || {};
    if (s.reported[endpoint] === day) return null;
    s.reported[endpoint] = day;
    const [method, path] = endpoint.split(' '), where = method + ' ' + redact(path), build = String(window.WizWebUpdate?.version || 'unknown');
    const text = `Wizard paused a write loop: ${where} went out ${rate} times in one minute on this ${shell() || 'device'}.\n\n`
      + `Endpoint: ${where}\nRate: ${rate} writes in 60 s (the limit is ${PER_MINUTE})\nPaused for: ${Math.round(pauseMs / 1000)} s\nBuild: ${build}\nShell: ${shell()}\n\n`
      + 'Filed by the shell\'s write guard (wizard-ux issue 1439), at most once a day per endpoint.';
    const item = { at: now(), endpoint: where, rate, build, shell: shell(), text, filed: '' };
    s.kept = [item, ...(s.kept || [])].slice(0, KEPT_MAX); save(s);
    const url = feedbackUrl();
    const done = filed => { const t = store(); const k = (t.kept || []).find(x => x.at === item.at && x.endpoint === item.endpoint); if (k) { k.filed = filed; save(t); } item.filed = filed; return item; };
    if (!url) return Promise.resolve(done('no-feedback-app'));
    return base.call(window, url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'bug', text, wizard_version: build, device: 'WizardOS ' + (shell() || 'shell'), operation_id: `write-guard:${day}:${where}` }) })
      .then(r => done(r.ok ? 'sent' : 'refused ' + r.status), () => done('unreachable'));
  }

  function trip(e, endpoint, rate) {
    const t = now();
    if (t - e.trippedAt > CALM_MS) e.level = 0;
    const ms = Math.min(PAUSE_MAX, PAUSE_MS * 2 ** e.level);
    e.level++; e.trippedAt = t; e.until = t + ms; e.why = `${rate} writes in a minute`; e.counts.trips++;
    try { window.dispatchEvent(new CustomEvent('wos:write-guard', { detail: { endpoint, rate, pauseMs: ms } })); } catch (_) {}
    report(e, endpoint, rate, ms);
    return ms;
  }

  function guarded(self, input, init, d) {
    const t = now(), e = end(d.endpoint);
    if (e.until > t) return paused(e, e.until - t);
    const last = d.sig == null ? null : targets.get(d.target);
    let resend = false;
    if (last && last.sig === d.sig && last.ok !== false) {
      const age = t - last.at;
      if (last.pending || age < SAME_MS || (last.resent && age < HOLD_MS)) {
        e.counts.dropped++;
        return (last.pending || Promise.resolve(last.kept)).then(k => k ? k.clone() : base.call(self, input, init));
      }
      resend = !last.resent;
    }
    e.sent = e.sent.filter(x => t - x < WINDOW_MS);
    if (e.sent.length >= PER_MINUTE) return paused(e, trip(e, d.endpoint, e.sent.length + 1));
    e.sent.push(t); e.counts.sent++;
    const entry = d.sig == null ? null : { sig: d.sig, at: t, resent: resend, ok: null, kept: null, pending: null };
    if (entry) { targets.delete(d.target); cap(targets, d.target, () => entry); }
    const p = base.call(self, input, init).then(r => {
      if (r.status === 429) { const ms = retryAfter(r); if (ms > 0) { e.until = Math.max(e.until, now() + ms); e.why = 'the box asked to wait'; } }
      if (entry) { entry.ok = r.ok; entry.kept = r.ok ? r.clone() : null; entry.pending = null; }
      return r;
    }, err => { if (entry) { entry.ok = false; entry.pending = null; } throw err; });
    if (entry) entry.pending = p.then(() => entry.kept, () => null);
    return p;
  }

  const wrapped = function fetch(input, init) {
    if (!on()) return base.call(this, input, init);
    const d = describe(input, init);
    return d ? guarded(this, input, init, d) : base.call(this, input, init);
  };
  wrapped.wosWriteGuard = true;
  window.fetch = wrapped;

  window.WosWriteGuard = Object.freeze({
    id: ID,
    get on() { return on(); },
    limits: Object.freeze({ sameMs: SAME_MS, holdMs: HOLD_MS, perMinute: PER_MINUTE, pauseMs: PAUSE_MS, pauseMax: PAUSE_MAX }),
    // Per endpoint: writes sent, answered from the earlier write, refused while paused, and breaker trips.
    stats: () => Object.fromEntries([...ends].map(([k, e]) => [k, { ...e.counts, pausedFor: Math.max(0, e.until - now()) }])),
    reports: () => store().kept || [],
  });
})();
