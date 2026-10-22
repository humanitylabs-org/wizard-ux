/* Settings › Photos backup, drawn by the web shell (Android app only).
 * Native keeps the device work: photo access, the backup worker, the photo server client and Wizard Sign-in.
 * This page talks to it over window.wizardPhotosPort, protocol v1:
 *   page → {v:1, id, method, params}; native → {v:1, id, ok, result|error}; native push → {v:1, type:'status', status}.
 * Keys and sign-in state never reach this page; status is a fixed set of fields (PhotosBridgePolicy.status).
 * An older app answers nothing (it only knows the word 'open'): the row then opens its native screen, as before. */
(() => {
  'use strict';
  const VERSION = 1, DETECT_MS = 1500, CALL_MS = 15000;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Request/answer over an AndroidX web-message port. Pure: tests drive it with a fake port. */
  function client(port, { timeout = CALL_MS, onStatus = () => {}, set = setTimeout, clear = clearTimeout } = {}) {
    const waiting = new Map(); let seq = 0;
    const onMessage = ev => {
      let m; try { m = JSON.parse(typeof ev === 'string' ? ev : ev?.data); } catch (_) { return; }
      if (!m || m.v !== VERSION) return;
      if (m.type === 'status' && m.status) { onStatus(m.status); return; }
      const w = waiting.get(m.id); if (!w) return;
      waiting.delete(m.id); clear(w.timer);
      if (m.ok) { if (m.result && typeof m.result === 'object' && m.result.v === VERSION) onStatus(m.result); w.resolve(m.result); }
      else w.reject(new Error(String(m.error || 'Something went wrong')));
    };
    if (typeof port.addEventListener === 'function') port.addEventListener('message', onMessage); else port.onmessage = onMessage;
    function call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = 'ph' + (++seq);
        const timer = set(() => { waiting.delete(id); reject(Object.assign(new Error('No answer from the Wizard OS app'), { timeout: true })); }, timeout);
        waiting.set(id, { resolve, reject, timer });
        try { port.postMessage(JSON.stringify({ v: VERSION, id, method, params })); }
        catch (e) { waiting.delete(id); clear(timer); reject(e); }
      });
    }
    return {
      call, onMessage,
      status: () => call('status'),
      setEnabled: (on, server) => call('setEnabled', server ? { on: !!on, server } : { on: !!on }),
      setOption: (key, on) => call('setOption', { key, on: !!on }),
      connect: server => call('connect', server ? { server } : {}),
      runNow: () => call('runNow'),
      permissions: () => call('permissions'),
      albums: () => call('albums'),
      setAlbums: ids => call('setAlbums', { ids: [...ids] }),
      disconnect: () => call('disconnect'),
    };
  }

  function ago(ms, now = Date.now()) {
    if (!ms) return 'not backed up yet';
    const min = Math.max(0, Math.floor((now - ms) / 60000));
    if (min < 1) return 'last backup just now';
    if (min < 60) return `last backup ${min} min ago`;
    const h = Math.floor(min / 60); if (h < 24) return `last backup ${h} h ago`;
    const d = Math.floor(h / 24); return `last backup ${d} ${d === 1 ? 'day' : 'days'} ago`;
  }
  /** One line for the Settings row and the page: what is true right now. */
  function summary(s, now = Date.now()) {
    if (!s) return 'Checking…';
    if (s.signingIn) return 'Confirm with your fingerprint in Wizard Sign-in';
    if (!s.enabled) return s.connected ? 'Off' : 'Off · turning it on signs you in with your fingerprint';
    if (s.needsAccess) return 'On · waiting for photo access';
    if (!s.total && !s.lastSync) return 'On · first backup waiting';
    return `On · ${s.total ? `${s.done} of ${s.total} backed up` : 'nothing backed up yet'} · ${ago(s.lastSync, now)}`;
  }
  /** The server field shows only when nothing is known: no build-time server and not signed in. */
  const needsServer = s => !!s && !s.connected && !s.server;

  const sw = (attr, on, title, sub, disabled) => `<button type="button" class="ph-row" ${attr} role="switch" aria-checked="${!!on}"${disabled ? ' disabled' : ''}><span class="ph-tx"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="sw ${on ? 'on' : ''}"><i></i></span></button>`;

  /** The whole page body for one state. Pure: tests render it directly. */
  function html(st, now = Date.now()) {
    if (st.mode === 'legacy') return `<div class="ph"><button type="button" class="ph-row" data-ph="native"><span class="ph-tx"><b>Photos backup</b><small>Originals backed up to your photo server</small></span><span class="st-go">›</span></button></div>`;
    const s = st.status;
    if (!s) return `<div class="ph"><p class="ph-status" data-ph-status>${esc(st.error || 'Checking…')}</p></div>`;
    const busy = !!st.busy || !!s.signingIn;
    const parts = [`<div class="ph" aria-busy="${busy}">`,
      `<p class="ph-intro">Original photos and videos go straight to your photo server. Nothing is deleted from this phone.</p>`,
      sw('data-ph="enabled"', s.enabled, 'Back up photos', null, busy)];
    if (needsServer(s)) parts.push(`<label class="ph-field"><span>Photo server</span><input type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://photos.example.com" data-ph-server value="${esc(st.server || '')}"></label>`);
    parts.push(`<p class="ph-status" data-ph-status role="status">${esc(st.error || summary(s, now))}</p>`);
    if (s.enabled && s.message && !st.error) parts.push(`<p class="ph-note">${esc(s.message)}</p>`);
    if (s.needsAccess) parts.push(`<button type="button" class="ph-btn primary" data-ph="permissions">Allow photo access</button>`);
    if (s.limited) parts.push(`<p class="ph-note">Only the photos you picked in Android are visible. <button type="button" class="ph-link" data-ph="permissions">Allow all photos</button></p>`);
    parts.push(sw('data-ph="wifi"', s.wifi, 'Wi-Fi only', 'Mobile data is never used', busy));
    parts.push(sw('data-ph="charge"', s.charge, 'First backup only while charging', null, busy));
    parts.push(`<button type="button" class="ph-row" data-ph="albums" aria-expanded="${!!st.albumsOpen}"><span class="ph-tx"><b>Albums</b><small>${esc(albumSub(st))}</small></span><span class="st-go">${st.albumsOpen ? '⌄' : '›'}</span></button>`);
    if (st.albumsOpen) parts.push(albumsHtml(st));
    const acts = [];
    if (s.enabled) acts.push(`<button type="button" class="ph-btn" data-ph="run"${busy ? ' disabled' : ''}>Back up now</button>`);
    if (s.connected) acts.push(`<button type="button" class="ph-btn" data-ph="signin"${busy ? ' disabled' : ''}>Sign in again</button>`);
    if (s.connected) acts.push(st.confirmDisconnect
      ? `<button type="button" class="ph-btn danger" data-ph="disconnect-yes">Disconnect this phone</button><button type="button" class="ph-btn" data-ph="disconnect-no">Keep</button>`
      : `<button type="button" class="ph-btn ghost" data-ph="disconnect">Disconnect</button>`);
    if (acts.length) parts.push(`<div class="ph-acts">${acts.join('')}</div>`);
    if (st.confirmDisconnect) parts.push(`<p class="ph-note">Backup stops and this phone forgets its key. Photos already on the server stay.</p>`);
    if (s.server) parts.push(`<p class="ph-server">${esc(s.server)}</p>`);
    parts.push('</div>');
    return parts.join('');
  }
  function albumSub(st) {
    const list = st.albums?.albums;
    if (!list) return 'Camera and Screenshots unless you choose';
    const n = list.filter(a => a.selected).length;
    return n ? `${n} of ${list.length} chosen` : 'None chosen · nothing is backed up';
  }
  function albumsHtml(st) {
    if (st.albumsError) return `<p class="ph-note">${esc(st.albumsError)}</p>`;
    const list = st.albums?.albums; if (!list) return '<p class="ph-note">Loading albums…</p>';
    if (!list.length) return '<p class="ph-note">No albums visible yet.</p>';
    return `<div class="ph-albums" role="group" aria-label="Albums to back up">${list.map(a => `<button type="button" class="ph-album" role="checkbox" aria-checked="${!!a.selected}" data-ph-album="${esc(a.id)}"><span class="ph-check" aria-hidden="true"></span>${esc(a.name)}</button>`).join('')}</div>`;
  }

  /** Taps → bridge calls. Returns the promise of the call it made (or null). Pure over (state, client). */
  function act(st, api, what, extra = {}) {
    const s = st.status; if (!s) return null;
    const server = needsServer(s) ? String(extra.server ?? st.server ?? '').trim() : '';
    switch (what) {
      case 'enabled':
        if (!s.enabled && needsServer(s) && !server) { st.error = 'Enter your photo server address first'; return null; }
        return api.setEnabled(!s.enabled, server);
      case 'wifi': return api.setOption('wifi', !s.wifi);
      case 'charge': return api.setOption('charge', !s.charge);
      case 'permissions': return api.permissions();
      case 'run': return api.runNow();
      case 'signin': return api.connect(server);
      case 'disconnect': st.confirmDisconnect = true; return null;
      case 'disconnect-no': st.confirmDisconnect = false; return null;
      case 'disconnect-yes': st.confirmDisconnect = false; st.albums = null; st.albumsOpen = false; return api.disconnect();
      case 'albums':
        st.albumsOpen = !st.albumsOpen; st.albumsError = '';
        if (!st.albumsOpen) return null;
        return api.albums().then(r => { st.albums = r; return r; }, e => { st.albumsError = e.message; throw e; });
      case 'album': {
        const list = st.albums?.albums; if (!list) return null;
        const a = list.find(x => x.id === extra.id); if (!a) return null;
        a.selected = !a.selected;
        return api.setAlbums(list.filter(x => x.selected).map(x => x.id));
      }
    }
    return null;
  }

  /* ---------- Live wiring (the shell) ---------- */
  const port = () => typeof window.wizardPhotosPort?.postMessage === 'function' ? window.wizardPhotosPort : null;
  const state = { mode: '', status: null, error: '', busy: false, server: '', albumsOpen: false, albums: null, albumsError: '', confirmDisconnect: false };
  let api = null, detecting = null;
  const refresh = () => {
    // Typing the server address: only the status line changes, so the field keeps its caret.
    const field = typeof document !== 'undefined' && document.activeElement?.matches?.('[data-ph-server]');
    if (field) { document.querySelectorAll('[data-ph-status]').forEach(el => { el.textContent = state.error || summary(state.status); }); return; }
    window.WosSettings?.refresh();
  };
  function detect() {
    const p = port(); if (!p) return null;
    if (!api) api = client(p, { onStatus: s => { state.status = s; state.mode = 'v1'; refresh(); } });
    if (state.mode === 'v1' || state.mode === 'legacy') return Promise.resolve(state.mode);
    if (detecting) return detecting;
    // An app that answers nothing within DETECT_MS predates v1: show its native screen instead.
    return (detecting = Promise.race([api.status(), new Promise((_, no) => setTimeout(() => no(new Error('legacy')), DETECT_MS))])
      .then(() => { state.mode = 'v1'; return 'v1'; }, () => { if (state.mode !== 'v1') state.mode = 'legacy'; return state.mode; })
      .finally(() => { detecting = null; refresh(); }));
  }
  function tap(what, extra) {
    if (state.mode === 'legacy') { if (what === 'native') port()?.postMessage('open'); return; }
    state.error = '';
    const pending = act(state, api, what, extra);
    if (!pending) { refresh(); return; }
    if (what !== 'albums' && what !== 'album') state.busy = true;
    refresh();
    pending.catch(e => { state.error = e.timeout ? 'The Wizard OS app did not answer · try again' : e.message; })
      .finally(() => { state.busy = false; refresh(); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('input', e => { if (e.target?.matches?.('[data-ph-server]')) state.server = e.target.value; });
    addEventListener?.('wos-native-resume', () => { if (state.mode === 'v1') api?.status().catch(() => {}); });
  }
  const register = () => window.WosSettings?.register({ id: 'photos-backup', aliases: ['photos'], available: () => !!port(), html() {
    if (!state.mode) detect();
    return `<div class="st-group"><h4 class="ph-h">Photos backup</h4>${html(state)}</div>`;
  }, act(ctx, el) {
    const b = el.closest('[data-ph], [data-ph-album]'); if (!b || b.disabled) return false;
    if (b.dataset.phAlbum != null) { tap('album', { id: b.dataset.phAlbum }); return true; }
    const field = ctx.root?.querySelector?.('[data-ph-server]');
    tap(b.dataset.ph, field ? { server: field.value } : {}); ctx.haptic?.(8); return true;
  } });

  window.WosPhotos = { VERSION, client, summary, html, act, ago, needsServer, state, detect };
  register();
})();
