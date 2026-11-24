/* Wizard UX core: app services › a sandboxed window's services under the browser boundary: the fingerprint vault,
 * Wizard ID, recording (capture), the app's own backend calls (net.fetch), streamed answers and WebSockets
 * (docs/browser-boundary.md). Moved verbatim out of core/app-services.js (wizard-ux issue 1665: split the giant
 * front-end files, no behaviour change). app-services.js calls this once, where the code used to be, with the
 * closure names it reads, and keeps the functions it returns under their old names. Loaded before app-services.js
 * everywhere that loads it. The body below keeps app-services.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.servicesParts = window.WizCore.servicesParts || {};
window.WizCore.servicesParts.boundary = function ({ apps, boundaryLive, changed, fault, frames, identityParams, inFront, ORIGIN, uid, vaultCall, whenInFront, within }) {
  // Under the boundary a sandboxed app sets its own badge and title bar, shares out (also to Wizard), receives shares,
  // transcribes, holds shell updates, ducks Wizard Music, uses its fingerprint vault and asks for Wizard ID over the
  // boundary channel (browser-boundary.js).
  function holdFor(st, reason) {
    if (st.holds.size >= 64) throw fault('Too many update holds');
    const id = uid(); st.holds.set(id, String(reason || 'Unsaved work').slice(0, 160)); changed();
    return id;
  }
  // The fingerprint vault (Android) for a sandboxed app: the same per-app secret, always under the window's installed
  // app id (vaultCall adds it; the page never names one). The prompt shows only while that window is steadily in front,
  // and a secret goes back only to the same document that asked (gen), so a reload or another page in the window never
  // gets it. Errors cross as `vault:<code>` (app-client turns them back into error.code).
  async function boundaryVault(st, frame, method, args) {
    const B = window.WizBrowserBoundary, gen = B.gen(frame), alive = () => boundaryLive(st) && B.gen(frame) === gen;
    const fail = code => fault('vault:' + (/^[a-z_]{1,32}$/.test(String(code)) ? code : 'failed'));
    const text = (v, n) => (typeof v === 'string' && v.length <= n ? v : undefined);
    const extra = {};
    if (method === 'seal') { extra.secret = text(args?.secret, 4096); if (!extra.secret) throw fail('invalid'); }
    if (method === 'seal' || method === 'open') {
      const title = text(args?.title, 200); if (title !== undefined) extra.title = title;
      try { await whenInFront(st, alive); } catch (e) { throw fail(e.code || 'failed'); }
      if (!alive()) throw fail('cancelled');
      if (!inFront(st)) throw fail('not_in_front');
    }
    let result;
    try { result = await vaultCall(st.appId, method, extra); } catch (e) { throw fail(e.code || 'failed'); }
    if (!alive()) throw fail('cancelled'); // no secret to a reloaded, navigated or closed document
    return result;
  }
  // Wizard ID (Android) for a sandboxed app: the same rule as identity() above, checked by what the shell controls.
  // Only an installed `kind:wizard` apps.json app; the phone's own approval sheet (biometric/PIN) names the app from
  // the catalog, never from the page. A sheet opens only while that window is steadily in front, and an answer goes
  // back only to the same document that asked (gen), so a reload or another page in the window never gets it.
  async function boundaryIdentity(st, frame, method, args) {
    const B = window.WizBrowserBoundary, gen = B.gen(frame), alive = () => boundaryLive(st) && B.gen(frame) === gen;
    const authorize = () => {
      const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.source === 'apps.json');
      if (!app || !alive() || st.url.origin !== ORIGIN) throw fault('Wizard ID needs an installed app');
      return app;
    };
    const app = authorize(), bridge = window.WizCore?.bridge;
    if (!window.wizardDevicePort || !bridge?.call) return { unavailable: true }; // Desktop-to-phone routing is not v1.
    const params = identityParams(app, method, args);
    const payload = JSON.stringify(params); // a copy: the request can't change after the sheet opens
    if (payload.length > 140000) throw fault('Wizard ID request too large');
    if (method !== 'info') {
      try { await whenInFront(st, alive); } catch (e) { throw fault('Wizard ID: ' + (e.code === 'not_in_front' ? 'not_in_front' : 'cancelled')); }
      authorize();
    }
    const result = await bridge.call('identity.' + method, JSON.parse(payload));
    authorize(); // no signature or plaintext to a reloaded, navigated, closed or uninstalled window
    return result;
  }
  // Recording (capture) for a sandboxed app: the shell's one recorder (core/app-capture.js) records for the window's
  // installed app id, exactly as for a same-origin app; the page gets its sessions over the boundary channel.
  //  - A NEW recording needs a real tap in that window: browser-boundary.js hands `tapped` (a tap or key in this
  //    focused, visible frame just now), or the start names a recording this document prepared on such a tap in the
  //    last minute (the app may ask its own backend in between). Reattaching or resuming this app's own take does not
  //    (a reload must not stop or lose a meeting).
  //  - Events (level, PCM, chunks, state, warnings) go only to the document that started or attached the session; a
  //    new document gets none until it attaches. A reload never stops the recorder (as same-origin).
  //  - The recorder is held for a shell update from before the microphone prompt until it stops, also across a reload.
  //  - Hold to record on a touch screen: the browser counts a touch as a tap only when the finger lifts, so a start on
  //    touch-down has no tap yet. The client marks such a start `press` (a finger is down in it now). The recorder
  //    starts at once, in front only and without computer audio, but the take is HELD: nothing of it (no level, audio,
  //    chunks) reaches the page until a real tap in this visible window confirms it (`lifted` from browser-boundary.js:
  //    a finger lifting after a long press activates the frame without focusing it). The client then asks
  //    `capture.confirm`, or the app's own Stop comes right then. Unconfirmed within PRESS_MS, stopped without a tap, or
  //    its document gone: the take is discarded, so a page alone never gets audio.
  const CAPTURE_OPTS = ['kind', 'mime', 'audio', 'pcm', 'chunkMs', 'maxMs', 'maxBytes', 'systemAudio', 'meta', 'seqBase', 'offsetMs', 'preparedId', 'resumeId'];
  const CAPTURE_CALLS = ['stop', 'cancel', 'pause', 'resume', 'setSystemAudio', 'chunks', 'info'];
  const PREPARED_MS = 60000, PRESS_MS = 120000, PRESS_QUEUE = 4000;
  function captureOpts(opts) {
    const o = {};
    if (opts && typeof opts === 'object') for (const k of CAPTURE_OPTS) if (opts[k] !== undefined && typeof opts[k] !== 'function') o[k] = opts[k];
    const safe = JSON.parse(JSON.stringify(o)); // data only: no callbacks or objects from the page reach the recorder
    if (['auto', 'command', 'dictation'].includes(safe.kind)) throw fault('Capture kind is reserved for Wizard voice; use audio/meeting and task metadata');
    return safe;
  }
  const captureInfo = session => { try { return session.getInfo(); } catch (_) { return null; } };
  const captureCaps = () => {
    const R = window.WizAppCapture, caps = {};
    for (const meeting of [false, true]) for (const pcm of [false, true]) {
      try { caps[(meeting ? 'meeting' : 'audio') + (pcm ? '-pcm' : '')] = R?.capabilities?.({ kind: meeting ? 'meeting' : 'audio', pcm }) || {}; } catch (_) { caps[(meeting ? 'meeting' : 'audio') + (pcm ? '-pcm' : '')] = {}; }
    }
    return caps;
  };
  function captureCurrent(st) { try { return window.WizAppCapture?.current?.(st.appId) || null; } catch (_) { return null; } }
  // What this app's recorder holds now, to every ready sandboxed window of the app when it changes.
  function captureAnnounce() {
    const B = window.WizBrowserBoundary; if (!B?.notice) return;
    for (const st of frames.values()) {
      if (!st.bcap || !boundaryLive(st)) continue;
      const now = captureCurrent(st), key = JSON.stringify(now);
      if (key === st.bcap.said) continue;
      st.bcap.said = key; B.notice(st.frame, 'capture', { event: 'current', value: now });
    }
  }
  addEventListener('wizard-app-capture-state', captureAnnounce);
  const shellVoiceBusy = () => { const shell = window.__wos || window.__wux; return !!(shell?.voice && shell.voice !== 'idle'); };
  // Forget this window's sessions and preparations of documents other than `gen` (all of them for null). The recorder
  // itself keeps going.
  function captureForget(st, gen) {
    const c = st.bcap; if (!c) return;
    for (const [id, e] of c.sessions) if (e.gen !== gen) { if (e.held) captureDrop(st, e); for (const off of e.offs) { try { off(); } catch (_) {} } c.sessions.delete(id); }
    for (const [id, p] of c.prepared) if (p.gen !== gen) { c.prepared.delete(id); try { p.release(); } catch (_) {} }
    c.said = undefined;
  }
  // Held takes not yet confirmed, kept in the shell's own storage (a page can't reach it): a take still held when the
  // shell itself reloads is never handed to the app afterwards (pending, attach, resume); it is discarded instead.
  const HELD_KEY = 'wos.capture.held.v1';
  const heldIds = () => { try { const v = JSON.parse(window.localStorage.getItem(HELD_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch (_) { return []; } };
  const heldMark = (id, on) => {
    try {
      const ids = heldIds().filter(x => x !== id); if (on) ids.push(id);
      if (ids.length) window.localStorage.setItem(HELD_KEY, JSON.stringify(ids.slice(-20))); else window.localStorage.removeItem(HELD_KEY);
    } catch (_) {}
  };
  // A held take (see the header) that was never confirmed: discard it; none of it ever reached the page.
  function captureDrop(st, e, frame) {
    const h = e.held; if (!h) return; e.held = null; clearTimeout(h.timer);
    const id = e.session.id; st.bcap?.unconfirmed.add(id);
    for (const off of e.offs) { try { off(); } catch (_) {} }
    if (st.bcap?.sessions.get(id) === e) st.bcap.sessions.delete(id);
    Promise.resolve().then(() => e.session.cancel()).catch(() => {}).finally(() => { e.release(); heldMark(id, false); st.bcap?.unconfirmed.delete(id); });
    if (frame) { try { window.WizBrowserBoundary.notice(frame, 'capture', { id, event: 'warn', value: 'Recording needs a tap in the app. It was discarded.' }); } catch (_) {} }
  }
  function captureConfirm(e) {
    const h = e.held; if (!h) return; e.held = null; clearTimeout(h.timer); heldMark(e.session.id, false);
    for (const [event, value] of h.queue) e.deliver(event, value);
  }
  // Takes held when the shell reloaded: discarded, never listed.
  async function heldStale(R, appId, takes) {
    const stale = new Set(heldIds()); if (!stale.size) return takes;
    const keep = [];
    for (const t of takes) {
      if (!stale.has(t?.id)) { keep.push(t); continue; }
      try { await R.ack(appId, t.id); } catch (_) {}
      heldMark(t.id, false);
    }
    return keep;
  }
  async function boundaryCapture(st, frame, method, args, ctx) {
    const B = window.WizBrowserBoundary, R = window.WizAppCapture, gen = B.gen(frame), alive = () => boundaryLive(st) && B.gen(frame) === gen;
    if (!R) throw fault('Shared capture unavailable');
    if (!st.bcap) { st.bcap = { sessions: new Map(), prepared: new Map(), said: undefined, unconfirmed: new Set() }; (st.captureOffs ||= new Set()).add(() => captureForget(st, null)); }
    const c = st.bcap, out = value => ({ capture: value === undefined ? null : value });
    if (method === 'capture.sync') { const current = captureCurrent(st); c.said = JSON.stringify(current); return out({ current, caps: captureCaps() }); }
    if (method === 'capture.pending') { const takes = await R.pending(st.appId); return out(Array.isArray(takes) ? await heldStale(R, st.appId, takes) : takes); }
    if (method === 'capture.ack') { if (typeof args?.id !== 'string') throw fault('Invalid capture id'); await R.ack(st.appId, args.id); return out(true); }
    if (method === 'capture.settle') { const keep = typeof args?.keepId === 'string' ? args.keepId : null; return out(await R.settle(st.appId, keep)); }
    if (method === 'capture.release') { const p = c.prepared.get(args?.id); if (p && p.gen === gen) { c.prepared.delete(args.id); p.release(); } return out(true); }
    if (method === 'capture.prepare') {
      if (!ctx?.tapped) throw fault('Recording needs a tap in the app');
      if (shellVoiceBusy()) throw Object.assign(fault('Microphone held by Wizard voice'), { code: 'busy' });
      if (!R.prepare) throw fault('Capture preparation unavailable');
      if (c.prepared.size >= 8) throw fault('Too many prepared recordings');
      const p = R.prepare(st.appId, captureOpts(args?.opts));
      c.prepared.set(p.id, { gen, at: Date.now(), release: p.release });
      return out({ id: p.id });
    }
    if (method === 'capture.confirm') {
      // A lift while this document's press start is still on its way (a slow microphone prompt outlives the tap): the
      // start confirms itself when it lands (Codex P2).
      if (ctx?.lifted) c.lift = { gen, at: Date.now() };
      const e = c.sessions.get(args?.id);
      if (!e || e.gen !== gen || !e.held || !ctx?.lifted) return out(!!(e && e.gen === gen && !e.held));
      captureConfirm(e); return out(true);
    }
    if (method === 'capture.call') {
      const e = c.sessions.get(args?.id), what = args?.method;
      if (!e || e.gen !== gen) throw fault('This recording is not this page\'s');
      if (!CAPTURE_CALLS.includes(what)) throw fault('Capture method unavailable');
      if (e.held) {
        // The finger lifting is the tap that confirms a held take (the app's Stop usually comes right then).
        if (ctx?.lifted) captureConfirm(e);
        else if (what === 'stop') { captureDrop(st, e, frame); throw fault('Recording needs a tap in the app'); }
        else if (what === 'chunks' || what === 'setSystemAudio') throw fault('Recording needs a tap in the app');
        else if (what === 'cancel') { captureDrop(st, e); return out(null); }
      }
      if (what === 'info') return out(captureInfo(e.session));
      if (what === 'stop' || what === 'cancel') {
        // Stop and Discard are distinct intents; the recorder arbitrates their race (as same-origin).
        if (!e.finished[what]) e.finished[what] = Promise.resolve().then(() => e.session[what]()).then(r => { e.release(); return r; }, err => { delete e.finished[what]; throw err; });
        return out(await e.finished[what]);
      }
      if (what === 'setSystemAudio') return out(await e.session.setSystemAudio(args?.args?.on === true));
      if (!e.session[what]) throw fault('Capture method unavailable');
      return out(await e.session[what]());
    }
    if (method !== 'capture.start') throw fault('Not available');
    const attaching = args?.attach === true, opts = attaching ? {} : captureOpts(args?.opts);
    // This document's own preparation, taken out of the list now. Until the recorder uses it, every way out of this
    // start releases it (an unused preparation keeps an AudioContext and the recorder's hold; Codex P1). The recorder
    // ignores a release of one it already used.
    let prep = null;
    if (opts.preparedId !== undefined) {
      const p = c.prepared.get(opts.preparedId);
      if (p && p.gen === gen) { c.prepared.delete(opts.preparedId); prep = p; } else delete opts.preparedId;
      if (prep && Date.now() - prep.at > PREPARED_MS) { prep.release(); prep = null; delete opts.preparedId; }
    }
    const unprepare = () => { if (prep) { try { prep.release(); } catch (_) {} prep = null; } };
    const fresh = !attaching && !opts.resumeId;
    // A start on touch-down (see the header): only while this window is in front, one at a time, no computer audio.
    const press = fresh && !ctx?.tapped && !prep && args?.press === true && !opts.systemAudio && inFront(st) && ![...c.sessions.values()].some(x => x.held);
    if (fresh && !ctx?.tapped && !prep && !press) { unprepare(); throw fault('Recording needs a tap in the app'); }
    if (shellVoiceBusy()) { unprepare(); throw Object.assign(fault('Microphone held by Wizard voice'), { code: 'busy', appId: 'wizard-voice' }); }
    // The hold is the recorder's, not the document's: it stays across a reload until the recording stops (onReset keeps
    // sheetHolds).
    const hold = holdFor(st, 'Recording'); (st.sheetHolds ||= new Set()).add(hold);
    let released = false;
    const release = () => { if (released) return; released = true; removeEventListener('wizard-app-capture-state', onState); st.sheetHolds.delete(hold); if (st.holds.delete(hold)) changed(); };
    const onState = () => { if (R.getState?.().active === false) release(); };
    addEventListener('wizard-app-capture-state', onState);
    let session; const t0 = Date.now();
    try {
      session = await (attaching ? R.attach(st.appId) : opts.resumeId && R.resume ? R.resume(st.appId, opts.resumeId, opts) : R.start(st.appId, opts));
      if (!session) { release(); unprepare(); return out(null); }
      if (!alive()) throw fault('App frame is no longer authorized');
    } catch (err) {
      unprepare();
      // The microphone prompt can outlive this document: stop and keep the take (a document that attached meanwhile owns it).
      if (session && !session.reattached?.()) { try { await session.stop(); } catch (_) {} }
      release();
      if (err.code === 'busy' && err.appId) {
        const owner = apps().find(a => a.id === err.appId);
        err.message = 'The microphone is recording in ' + (owner?.name || String(err.appId).replace(/[-_]/g, ' ')) + '. Stop that recording first.';
      }
      throw err;
    }
    const old = c.sessions.get(session.id);
    // A held take is never handed to anyone but the document that pressed it, and stays held for it. One held when the
    // shell reloaded has nobody to confirm it: it is discarded.
    if (c.unconfirmed.has(session.id) || (old?.held && old.gen !== gen)) { release(); return out(null); }
    if (!press && !old?.held && heldIds().includes(session.id)) {
      try { await session.cancel(); } catch (_) {}
      heldMark(session.id, false); release(); return out(null);
    }
    if (old) for (const off of old.offs) { try { off(); } catch (_) {} }
    const e = { session, gen, offs: [], finished: {}, release, infoAt: 0, held: null };
    const holdUntil = until => { e.held = { queue: old?.held?.queue || [], until, timer: setTimeout(() => captureDrop(st, e, frame), Math.max(0, until - Date.now())) }; };
    if (old?.held) { clearTimeout(old.held.timer); holdUntil(old.held.until); old.held = null; }
    else if (press) { heldMark(session.id, true); holdUntil(Date.now() + PRESS_MS); }
    c.sessions.set(session.id, e);
    if (e.held && c.lift?.gen === gen && c.lift.at >= t0) captureConfirm(e);
    // Events go to this document only. Levels come many times a second; the session info rides along at most once a second.
    e.deliver = (event, value) => {
      if (c.sessions.get(session.id) !== e || !alive()) return;
      const now = Date.now(), withInfo = event !== 'level' && event !== 'pcm' || now - e.infoAt >= 1000;
      if (withInfo) e.infoAt = now;
      B.notice(frame, 'capture', { id: session.id, event, value, ...(withInfo ? { info: captureInfo(session) } : {}) });
    };
    // A held take keeps its events (not the levels, which are only live) until it is confirmed.
    const send = (event, value) => {
      if (!e.held) return e.deliver(event, value);
      if (event === 'level' || c.sessions.get(session.id) !== e) return;
      if (e.held.queue.length >= PRESS_QUEUE) return captureDrop(st, e, frame);
      e.held.queue.push([event, value]);
    };
    for (const [event, on] of [['level', 'onLevel'], ['pcm', 'onPcm'], ['chunk', 'onChunk'], ['state', 'onState'], ['warn', 'onWarn']]) {
      if (typeof session[on] !== 'function') continue;
      try { e.offs.push(session[on](v => send(event, event === 'warn' && v && typeof v === 'object' ? String(v.message || '') : v))); } catch (_) {}
    }
    return out({ id: session.id, info: captureInfo(session), ...(e.held ? { held: true } : {}) });
  }
  /* An app's own backend call under the boundary (net.fetch, docs/browser-boundary.md): the page's fetch to this host
   * is made here, with the shell's credentials for this host, but only inside the window's own app path (within(), the
   * same rule as its links) and never to an owner route, so the shell token is never added. The browser hides where a
   * redirect goes until it has followed it, so only GET and HEAD follow one (and an answer from outside the path is
   * refused); a POST or any other method is never sent on to a redirect's address, which may be another app. An address outside the path answers `outside`: the page's own fetch then goes out
   * unchanged (Origin: null), as before. */
  const NET_METHOD = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/, NET_CACHE = ['default', 'no-store', 'reload', 'no-cache', 'force-cache'];
  const NET_DROP = /^(?:x-wizard-shell-token|cookie|cookie2|host|origin|referer)$/i;
  const outside = () => Object.assign(fault('Outside this app'), { code: 'outside' });
  /* An own screen (core/own-views.js: the owner's version of an app, served by the Agent Service at
   * /wizard/views/<id>/) calls its app through relative `api/…`. The Service answers that with a 307 to the original
   * app's API folder, which a sandboxed window can't follow (it leaves the window's path), so the shell sends such a
   * call straight to that folder (the Service's view.api), and only when the folder lies inside the original app's own
   * path and off every owner route: the same calls the original app's window may make. */
  const ownApi = st => {
    if (st.url.origin !== ORIGIN || st.url.pathname !== `/wizard/views/${st.appId}/`) return null;
    const a = apps().find(a => a.id === st.appId && a.source === 'apps.json' && a.view?.mode === 'own' && a.url === st.url.pathname);
    const api = a?.view?.api;
    if (typeof api !== 'string' || !/^\/[A-Za-z0-9_\/-]+\/$/.test(api) || api.includes('//') || !a.originalUrl) return null;
    try {
      const u = new URL(api, ORIGIN), home = new URL(a.originalUrl, ORIGIN);
      return u.pathname === api && within(u, home) && !window.WizBrowserBoundary.ownerRoute(u.href) ? u : null;
    } catch (_) { return null; }
  };
  // Whether a URL is one this window's page may reach through the shell: inside its app path, or an own screen's API
  // folder; never an owner route.
  const netOk = (st, u) => {
    if (window.WizBrowserBoundary.ownerRoute(u.href)) return false;
    if (within(u, st.url)) return true;
    const api = ownApi(st); return !!api && within(u, api);
  };
  const netTarget = (st, href) => {
    let u; try { u = new URL(String(href)); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    const api = ownApi(st), from = st.url.pathname + 'api/';
    if (api && u.origin === ORIGIN && u.pathname.startsWith(from) && !/%(?:2f|5c|2e|25)/i.test(u.pathname)) {
      let m; try { m = new URL(api.pathname + u.pathname.slice(from.length) + u.search, ORIGIN); } catch (_) { return null; }
      return within(m, api) && netOk(st, m) ? m : null;
    }
    return netOk(st, u) ? u : null;
  };
  async function boundaryNet(st, args) {
    const B = window.WizBrowserBoundary, MAX = B.netMax;
    if (!args || typeof args !== 'object' || typeof args.url !== 'string' || args.url.length > 8192) throw fault('Bad request');
    const u = netTarget(st, args.url); if (!u) throw outside();
    const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
    if (!NET_METHOD.test(method)) throw fault('Method not allowed');
    const headers = new Headers();
    if (Array.isArray(args.headers)) for (const h of args.headers.slice(0, 100)) {
      if (!Array.isArray(h) || typeof h[0] !== 'string' || typeof h[1] !== 'string' || h[0].length > 256 || h[1].length > 16384 || NET_DROP.test(h[0])) continue;
      try { headers.append(h[0], h[1]); } catch (_) {}
    }
    let body;
    if (args.body != null) {
      if (Object.prototype.toString.call(args.body) !== '[object ArrayBuffer]' || args.body.byteLength > MAX) throw fault('Request too large');
      if (method !== 'GET' && method !== 'HEAD') body = args.body;
    }
    const gen = B.gen(st.frame), safe = method === 'GET' || method === 'HEAD';
    // The page can stop its own call (net.abort with this call's key): one key per open call, this window's only.
    const key = typeof args.key === 'string' && args.key.length <= 64 ? args.key : '';
    // A streamed answer (stream: true, with a key) comes back as its status and headers first, then its body in pieces.
    const stream = args.stream === true && !!key;
    const stop = new AbortController(); st.netCalls ||= new Map();
    if (key) {
      if (st.netCalls.has(key)) throw fault('Bad request');
      if (st.netCalls.size >= NET_OPEN) throw fault('Too many open app calls');
      st.netCalls.set(key, stop);
    }
    let pumping = false;
    try {
      const res = await window.fetch(u.href, { method, headers, body, credentials: args.credentials === 'omit' ? 'omit' : 'same-origin', redirect: safe ? 'follow' : 'manual',
        cache: NET_CACHE.includes(args.cache) ? args.cache : 'default', referrerPolicy: 'no-referrer', signal: stop.signal });
      if (res.type === 'opaqueredirect') throw fault('Redirect not followed for ' + method);
      // A redirect may not leave the app's path (another app, an owner route): its answer stays with the shell.
      let landed = null; try { landed = new URL(res.url || u.href); } catch (_) {}
      if (!landed || !netOk(st, landed)) { try { res.body?.cancel(); } catch (_) {} throw fault('Redirected outside this app'); }
      if (!stream || !res.body || method === 'HEAD') return await netAnswer(st, res, u, method, gen, MAX);
      if (!boundaryLive(st) || B.gen(st.frame) !== gen) { try { res.body.cancel(); } catch (_) {} throw fault('App document changed'); }
      // The head goes back first (this answer); the pieces follow as `net` notices once it has been sent.
      pumping = true;
      setTimeout(() => netPump(st, key, res.body.getReader(), gen, stop), 0);
      return { net: { status: res.status, statusText: res.statusText, headers: [...res.headers], body: null, stream: true, url: res.url || u.href, redirected: res.redirected === true } };
    } finally { if (!pumping && key && st.netCalls.get(key) === stop) st.netCalls.delete(key); }
  }
  /* A streamed answer's body (server-sent events, a reply that arrives as it is written): pieces of at most NET_PIECE
   * bytes go to the window's current document as `net` notices (chunk, then end or error). The page says how much it
   * has taken (net.ack); the shell reads on only while less than NET_WINDOW bytes wait in between, so a page that stops
   * reading stops the stream (as a browser does). It ends with the call (net.abort), the document (a load) or the
   * window. */
  const NET_OPEN = 16, NET_PIECE = 256 * 1024, NET_WINDOW = 1024 * 1024;
  async function netPump(st, key, reader, gen, stop) {
    const B = window.WizBrowserBoundary, flow = { sent: 0, acked: 0, wake: null };
    const live = () => !stop.signal.aborted && boundaryLive(st) && B.gen(st.frame) === gen && st.netCalls?.get(key) === stop;
    const wake = () => { const w = flow.wake; flow.wake = null; w?.(); };
    stop.signal.addEventListener('abort', wake, { once: true });
    (st.netFlows ||= new Map()).set(key, { ack: n => { if (Number.isFinite(n) && n > flow.acked) { flow.acked = Math.min(n, flow.sent); wake(); } } });
    let ended = false;
    try {
      // Waits while the page has NET_WINDOW bytes or more not yet taken (between reads and between the pieces of one
      // large read alike); false once the call is over.
      const room = async () => { while (live() && flow.sent - flow.acked >= NET_WINDOW) await new Promise(r => { flow.wake = r; }); return live(); };
      read: for (;;) {
        if (!await room()) break;
        const { done, value } = await reader.read();
        if (!live()) break;
        if (done) { ended = true; B.notice(st.frame, 'net', { key, event: 'end' }); break; }
        for (let at = 0; at < value.byteLength; at += NET_PIECE) {
          if (!await room()) break read;
          const piece = value.slice(at, at + NET_PIECE);
          if (!B.notice(st.frame, 'net', { key, event: 'chunk', chunk: piece.buffer })) throw fault('App document changed');
          flow.sent += piece.byteLength;
        }
      }
    } catch (err) {
      ended = true;
      if (live()) B.notice(st.frame, 'net', { key, event: 'error', message: String(err?.message || 'Connection lost').slice(0, 200) });
    } finally {
      stop.signal.removeEventListener('abort', wake);
      if (!ended) { try { reader.cancel(); } catch (_) {} }
      st.netFlows?.delete(key);
      if (st.netCalls?.get(key) === stop) st.netCalls.delete(key);
    }
  }
  async function netAnswer(st, res, u, method, gen, MAX) {
    const B = window.WizBrowserBoundary;
    let out = null;
    if (res.body && method !== 'HEAD') {
      const reader = res.body.getReader(), parts = []; let n = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        n += value.byteLength; if (n > MAX) { try { reader.cancel(); } catch (_) {} throw fault('Answer too large'); }
        parts.push(value);
      }
      const all = new Uint8Array(n); let at = 0; for (const p of parts) { all.set(p, at); at += p.byteLength; }
      out = all.buffer;
    }
    // The window loaded another page meanwhile: that page never gets this answer.
    if (!boundaryLive(st) || B.gen(st.frame) !== gen) throw fault('App document changed');
    return { net: { status: res.status, statusText: res.statusText, headers: [...res.headers], body: out, url: res.url || u.href, redirected: res.redirected === true } };
  }
  /* An app's own WebSocket under the boundary (ws.open, ws.send, ws.close; docs/browser-boundary.md). An opaque page's
   * socket goes out with `Origin: null` and no cookies, and an app server that checks Origin (the Recorder's live
   * transcript) refuses it. So the shell opens it, with this host's origin and cookies, only inside the window's own
   * app path (the same rule as net.fetch) and never to an owner route. Messages from the server go to the window's
   * current document as `ws` notices; the page's own messages come back as ws.send. A socket ends with the page's close,
   * the server, the document (a load) or the window, and at most WS_OPEN are open per window. An address outside the
   * path answers `outside`: the page's own WebSocket then goes out unchanged, as before. */
  const WS_OPEN = 8, WS_MSG = 4 * 1024 * 1024, WS_BUFFER = 16 * 1024 * 1024, WS_WAIT = 45000;
  const WS_PROTOCOL = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
  const wsTarget = (st, href) => {
    let u; try { u = new URL(String(href)); } catch (_) { return null; }
    if (!/^wss?:$/.test(u.protocol) || u.username || u.password || u.hash) return null;
    const h = new URL(u.href); h.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    // The address the shell opens (an own screen's api/… goes to its app's API folder, as for net.fetch).
    const m = netTarget(st, h.href); if (!m) return null;
    const w = new URL(m.href); w.protocol = u.protocol; return w;
  };
  // A text message's size as sent: its UTF-8 bytes (a lone surrogate goes as U+FFFD, 3 bytes).
  const utf8 = t => {
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c < 0x80) n++; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length && (t.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; } else n += 3;
    }
    return n;
  };
  const wsBytes = d => (typeof d === 'string' ? utf8(d) : d.byteLength);
  // Every socket of this window closes; no page gets their messages.
  function wsCloseAll(st) { for (const c of [...(st.wsConns?.values() || [])]) c.end(); st.wsConns?.clear(); }
  // A window that went away without a detach (its frame left the page) still closes its sockets (checked every 5 s
  // while any is open).
  const wsOwners = new Set();
  let wsSweep = 0;
  const wsWatch = () => {
    if (wsSweep) return;
    wsSweep = setInterval(() => {
      for (const st of [...wsOwners]) {
        for (const c of [...(st.wsConns?.values() || [])]) if (!c.live()) c.end();
        if (!st.wsConns?.size) wsOwners.delete(st);
      }
      if (!wsOwners.size) { clearInterval(wsSweep); wsSweep = 0; }
    }, 5000);
  };
  function boundaryWsOpen(st, args) {
    const B = window.WizBrowserBoundary;
    if (!args || typeof args !== 'object' || typeof args.url !== 'string' || args.url.length > 8192) throw fault('Bad request');
    const key = typeof args.key === 'string' && args.key && args.key.length <= 64 ? args.key : '';
    if (!key) throw fault('Bad request');
    const u = wsTarget(st, args.url); if (!u) throw outside();
    const protocols = Array.isArray(args.protocols) ? args.protocols : [];
    if (protocols.length > 16 || protocols.some(p => typeof p !== 'string' || !WS_PROTOCOL.test(p)) || new Set(protocols).size !== protocols.length) throw fault('Bad request');
    st.wsConns ||= new Map();
    if (st.wsConns.has(key)) throw fault('Bad request');
    if (st.wsConns.size >= WS_OPEN) throw fault('Too many open app sockets');
    const gen = B.gen(st.frame);
    let ws;
    try { ws = new window.WebSocket(u.href, protocols); } catch (_) { throw fault('Bad request'); }
    ws.binaryType = 'arraybuffer';
    let opened = false, ended = false, settle = null, timer = 0;
    const live = () => !ended && boundaryLive(st) && B.gen(st.frame) === gen && st.wsConns?.get(key) === c;
    const c = {
      ws, live,
      // Ends the socket in the shell; the page hears nothing more of it (its document or channel is gone, or it asked).
      end() {
        if (ended) return; ended = true; clearTimeout(timer);
        if (st.wsConns?.get(key) === c) st.wsConns.delete(key);
        try { ws.close(); } catch (_) {}
        settle?.(false);
      },
      // The shell gives up on it (a message too large, a server not reading): the page hears an abnormal close.
      fail() { tellGone(1006, '', false); c.end(); },
    };
    st.wsConns.set(key, c); wsOwners.add(st); wsWatch();
    timer = setTimeout(() => { if (!opened) c.end(); }, WS_WAIT);
    const tell = data => { if (!live() || !B.notice(st.frame, 'ws', { key, ...data })) { c.end(); return false; } return true; };
    ws.addEventListener('message', e => {
      if (!opened || ended) return;
      const d = e.data;
      if (typeof d !== 'string' && Object.prototype.toString.call(d) !== '[object ArrayBuffer]') return;
      // Larger than the shell passes on: the page's socket fails (1009, as a browser's own does) and this one closes.
      if (wsBytes(d) > B.netMax) { tellGone(1009, 'Message too large', false); c.end(); return; }
      tell({ event: 'message', data: d });
    });
    const tellGone = (code, reason, wasClean) => { if (live()) B.notice(st.frame, 'ws', { key, event: 'close', code, reason, wasClean }); };
    ws.addEventListener('close', e => {
      clearTimeout(timer);
      if (ended) return;
      if (opened) tellGone(e.code, e.reason, e.wasClean);
      ended = true; if (st.wsConns?.get(key) === c) st.wsConns.delete(key);
      settle?.(false);
    });
    return new Promise((resolve, reject) => {
      settle = ok => { settle = null; if (!ok) reject(fault('Connection failed')); };
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        if (ended) return;
        if (!live()) { c.end(); return; }
        opened = true; settle = null;
        resolve({ ws: { protocol: ws.protocol, extensions: ws.extensions } });
      });
    });
  }
  function boundaryWsSend(st, args) {
    const c = typeof args?.key === 'string' ? st.wsConns?.get(args.key) : null;
    if (!c || !c.live() || c.ws.readyState !== 1) return false;
    const d = args.data;
    if (typeof d !== 'string' && Object.prototype.toString.call(d) !== '[object ArrayBuffer]') return false;
    // Too large a message, or the server is not reading: the socket fails, as a browser's own does.
    const n = wsBytes(d);
    if (n > WS_MSG || c.ws.bufferedAmount + n > WS_BUFFER) { c.fail(); return false; }
    try { c.ws.send(d); } catch (_) { c.fail(); return false; }
    return true;
  }
  function boundaryWsClose(st, args) {
    const c = typeof args?.key === 'string' ? st.wsConns?.get(args.key) : null;
    if (!c) return false;
    const code = Number.isInteger(args.code) && (args.code === 1000 || (args.code >= 3000 && args.code <= 4999)) ? args.code : undefined;
    const reason = typeof args.reason === 'string' && utf8(args.reason) <= 123 ? args.reason : '';
    // Not open yet: it never opens. Open: the closing handshake runs and its close comes to the page as a notice.
    if (c.ws.readyState !== 1) { c.end(); return true; }
    try { code ? c.ws.close(code, reason) : c.ws.close(); } catch (_) { c.end(); }
    return true;
  }
  return { boundaryCapture, boundaryIdentity, boundaryNet, boundaryVault, boundaryWsClose, boundaryWsOpen, boundaryWsSend, captureForget, holdFor, wsCloseAll };
};
