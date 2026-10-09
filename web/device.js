/* Wizard OS · device features (feature/native-parity)
 *
 * The web half of the Android-native features. Everything here is a no-op in a browser/PWA or an older shell
 * (no window.WizardOSDevice), except the web hot-reload, which works everywhere.
 *
 *  #14 Background recording: the orb records in Android's foreground-service recorder (app.js asks
 *      WizardOSDevice.recStart). Here: pick a still-running take back up after a reload, act on the
 *      notification's Stop/Send, and offer takes cut short by an app kill (Send → durable outbox / Delete).
 *  #20 Share to Wizard: other apps' share sheet → native copy → this sheet → upload to Wizard Files → send
 *      to a new chat or an existing thread (through the outbox like every send).
 *  #21 Reply notifications: every send the outbox delivers is handed to the native reply watcher, which posts
 *      "Archimedes replied" while Wizard OS is in the background; a tap opens that thread.
 *  #22 Updates: banner when a newer signed APK is published (native download → verify → installer), and a
 *      web hot-reload that keeps chat drafts.
 */
(() => {
  'use strict';
  const W$ = () => window.__wos;
  const DEV = () => { const d = window.WizardOSDevice; return d && typeof d.version === 'function' ? d : null; };
  const OUTBOX = window.WosOutbox || null;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (i, t, ms) => W$()?.toast?.(i, t, ms);
  const J = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  const log = (...a) => { window.__devLog = (window.__devLog || []).concat(a.join(' ')).slice(-60); };
  const fmtMs = ms => { const s = Math.round((Number(ms) || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fsize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';

  /* ---------------- overlay sheet (registered with Back via app.js backStep → WosDevice.back) ---------------- */
  let sheet = null; // { kind, el, onBack }
  function openSheet(kind, html, onBack) {
    closeSheet();
    const el = document.createElement('div');
    el.className = 'dv-wrap'; el.dataset.dv = kind;
    el.innerHTML = `<div class="dv-scrim" data-dvclose></div><section class="dv-sheet" role="dialog" aria-label="${esc(kind)}">${html}</section>`;
    ($('#device') || document.body).appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    sheet = { kind, el, onBack };
    return el;
  }
  function closeSheet() {
    if (!sheet) return false;
    const el = sheet.el; sheet = null;
    el.classList.remove('open'); setTimeout(() => el.remove(), 220);
    return true;
  }
  function back() {
    if (!sheet) return null;
    const k = sheet.kind, fn = sheet.onBack;
    closeSheet(); try { fn && fn(); } catch (e) {}
    return 'device-' + k;
  }

  /* ---------------- chunked native reads → Blob ---------------- */
  function readBlob(read, type) {
    const parts = []; let off = 0;
    for (let k = 0; k < 4000 && off >= 0; k++) {
      const c = J(read(off)); if (!c) break;
      const bin = atob(c.b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      parts.push(u); off = c.next;
    }
    return new Blob(parts, { type: type || 'application/octet-stream' });
  }

  /* ================= #14 background recording: resume, notification Stop/Send, recovery ================= */
  const handledTakes = new Set();
  function syncRecorder(why) {
    const d = DEV(), w = W$(); if (!d || !w || typeof d.recActive !== 'function') return;
    const a = J(d.recActive());
    if (a && a.id && w.voice === 'idle') { if (w.nativeResume(a)) log('rec:resume', a.id, why); }
    if (w.V.native && (!a || a.id !== w.V.native)) {
      // The take ended outside the page (notification Stop/Send, or the recorder failed) while we were away.
      const id = w.V.native; w.V.native = null; w.setVoice('idle'); w.txHide();
      const p = J(d.recPending()) || []; const t = p.find(x => x.id === id);
      if (t && t.send) return sendTake(t, 'notification');
    }
    offerPending(why);
  }
  function offerPending(why) {
    const d = DEV(); if (!d || sheet) return;
    const list = (J(d.recPending()) || []).filter(t => !handledTakes.has(t.id));
    if (!list.length) return;
    // Send was already pressed in the notification: the owner said send, so send.
    const go = list.filter(t => t.send);
    for (const t of go) sendTake(t, 'notification');
    const ask = list.filter(t => !t.send);
    if (!ask.length) return;
    log('rec:offer', ask.map(t => t.id + ':' + t.state).join(','), why);
    const el = openSheet('recording', `
      <div class="dv-head"><span class="dv-ic">◉</span><div><b>${ask.length > 1 ? `${ask.length} recordings saved` : 'Recording saved'}</b><small>${ask[0].state === 'interrupted' ? 'Wizard OS closed while you were recording. Nothing was lost.' : 'You stopped it from the notification.'}</small></div></div>
      ${ask.map(t => `<div class="dv-take" data-take="${esc(t.id)}"><span class="dv-tk">${fmtMs(t.ms)} · ${esc(fsize(t.bytes || 0))}</span>
        <button class="dv-btn" data-takeact="delete">Delete</button><button class="dv-btn primary" data-takeact="send">Send</button></div>`).join('')}
      <p class="dv-note">Send transcribes it and sends it to ${window.WizConfig.agent()} as a new chat, with the recording attached.</p>`);
    el.addEventListener('click', e => {
      if (e.target.closest('[data-dvclose]')) return back();
      const b = e.target.closest('[data-takeact]'); if (!b) return;
      const row = b.closest('[data-take]'), t = ask.find(x => x.id === row.dataset.take); if (!t) return;
      row.remove();
      if (b.dataset.takeact === 'send') sendTake(t, 'recovered'); else { handledTakes.add(t.id); try { d.recClaim(t.id); d.recDone(t.id); } catch (x) {} toast('✕', 'Recording deleted', 1400); }
      if (!el.querySelector('[data-take]')) closeSheet();
    });
  }
  /* A take that ended outside the page goes straight to the durable outbox (which transcribes and sends it),
   * then the native copy is deleted. Saved before anything goes over the network, so it can't be lost. */
  async function sendTake(t, how) {
    const d = DEV(), w = W$(); if (!d || !w || handledTakes.has(t.id)) return;
    handledTakes.add(t.id);
    if (!J(d.recClaim(t.id))) return;
    const blob = readBlob(off => d.recRead(t.id, off), 'audio/aac');
    if (blob.size < 600) { d.recDone(t.id); return; }
    const it = await OUTBOX.enqueue({ kind: 'new', text: '', audio: blob, source: 'orb', how,
      instructions: (window.WizConfig.owner() ? window.WizConfig.owner() + ' recorded' : 'The owner recorded') + ' this with the Wizard OS orb on their Android phone' + (how === 'recovered' ? '; the recording was interrupted and recovered' : '') + '. The original recording is attached as a voice note.' });
    d.recDone(t.id);
    log('rec:sent', t.id, it.id, how);
    toast('✦', how === 'recovered' ? `Recording sent to ${window.WizConfig.agent()}` : 'Sending your recording', 2000);
    try { w.openWizardThread(it.sessionId); } catch (e) {}
  }
  function onRec(ev) {
    const w = W$(); if (!w) return;
    log('rec:' + ev.type, ev.id);
    if (ev.type === 'send' && w.V.native === ev.id) { w.setVoice('think'); return w.nativeFinish(ev.id, true); }
    if (ev.type === 'send') return syncRecorder('send-event');
    if ((ev.type === 'stopped' || ev.type === 'error') && w.V.native === ev.id) {
      w.V.native = null; w.setVoice('idle'); w.txHide();
      if (ev.type === 'error') toast('!', 'The microphone stopped · recording saved if anything was captured', 2600);
      return offerPending('stopped');
    }
  }

  /* ================= #20 share to Wizard ================= */
  async function onShare(id) {
    const d = DEV(), w = W$(); const m = J(d.shareMeta(id));
    if (!m) { toast('!', 'That share expired · share it again', 2400); return; }
    const items = m.items || [], text = [m.subject, m.text].filter(Boolean).join('\n').trim();
    const threads = (w.live?.sessions || []).filter(s => !s.archived && !s.hidden).slice(0, 6);
    log('share:open', id, items.length, text.length);
    const el = openSheet('share', `
      <div class="dv-head"><span class="dv-ic">↗</span><div><b>Share to Wizard</b><small>${items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Text'}${m.skipped ? ` · ${m.skipped} skipped (too large or unreadable)` : ''}</small></div></div>
      <div class="dv-items">${items.map(f => `<span class="dv-item" data-n="${f.n}">${/^image\//.test(f.mime) ? '<img alt="">' : '<span class="dv-fi">▤</span>'}<span class="dv-nm">${esc(f.name)}<small>${esc(fsize(f.bytes))}</small></span></span>`).join('')}</div>
      <textarea class="dv-text" rows="3" placeholder="Add a message (optional)">${esc(text)}</textarea>
      <button class="dv-btn primary wide" data-shareto="__new__">Send to a new chat</button>
      ${threads.length ? `<div class="dv-sub">Or add to a chat</div>${threads.map(s => `<button class="dv-thread" data-shareto="${esc(s.id)}">${esc(s.title || 'Untitled chat')}</button>`).join('')}` : ''}
      <div class="dv-status" aria-live="polite"></div>`, () => { try { d.shareDone(id); } catch (e) {} toast('✕', 'Share cancelled', 1400); });
    // Image previews from the native copy (small ones only; the upload reads the bytes again).
    items.forEach(f => { if (/^image\//.test(f.mime) && f.bytes < 6e6) { const img = el.querySelector(`[data-n="${f.n}"] img`); if (img) img.src = URL.createObjectURL(readBlob(off => d.shareRead(id, f.n, off), f.mime)); } });
    let busy = false;
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-dvclose]')) return back();
      const b = e.target.closest('[data-shareto]'); if (!b || busy) return;
      busy = true; el.querySelectorAll('button').forEach(x => x.disabled = true);
      const status = el.querySelector('.dv-status');
      const note = el.querySelector('.dv-text').value.trim();
      try {
        const files = [];
        for (const f of items) {
          status.textContent = `Uploading ${files.length + 1} of ${items.length}…`;
          const blob = readBlob(off => d.shareRead(id, f.n, off), f.mime);
          files.push(await w.uploadFile(new File([blob], f.name, { type: f.mime })));
        }
        status.textContent = 'Sending…';
        const target = b.dataset.shareto;
        w.openWizardThread(target);
        const wid = Object.keys(w.wins).find(k => w.wins[k].app === 'chats' && w.wins[k].thread === target);
        if (!wid) throw new Error('no chat window');
        const c = w.chatState(wid); c.files = files.map(f => ({ ...f, key: Math.random().toString(36).slice(2) }));
        await w.sendChat(wid, note, 'shared from another Android app');
        try { d.shareDone(id); } catch (x) {}
        log('share:sent', id, target, files.map(f => f.id).join(','));
        closeSheet(); toast('✦', 'Shared to Wizard', 1800);
      } catch (err) {
        busy = false; el.querySelectorAll('button').forEach(x => x.disabled = false);
        status.textContent = err?.user ? err.message : 'Couldn’t upload · check the connection and try again';
        log('share:error', String(err?.message || err));
      }
    });
  }

  /* ================= #21 reply notifications for chats sent from Wizard OS ================= */
  OUTBOX?.onSent((it, res) => {
    const d = DEV(); if (!d || typeof d.watchRun !== 'function' || !res?.runId) return;
    const s = W$()?.live?.session?.(it.sessionId);
    const title = (s?.title && s.title !== 'Untitled chat' ? s.title : (it.text || 'Voice note')).slice(0, 60);
    try { d.watchRun(it.sessionId, res.runId, title); log('watch', it.sessionId, res.runId); } catch (e) {}
  });

  /* ================= #22 updates: native APK banner ================= */
  let upd = null, updHidden = 0;
  const UPD_TEXT = {
    available: u => [`Wizard OS ${u.version} is available`, 'Update'],
    ready: u => [`Wizard OS ${u.version} is downloaded`, 'Install'],
    downloading: u => [`Downloading ${u.version}… ${u.progress || 0}%`, ''],
    verifying: u => [`Checking ${u.version}…`, ''],
    installing: () => ['Opening Android’s installer…', ''],
    installer: u => [`Finish installing ${u.version} in Android’s installer`, 'Again'],
    permission: () => ['Allow Wizard OS to install updates, then come back', 'Allow'],
    error: u => [u.message || 'Update failed', 'Retry'],
  };
  function renderUpdate() {
    let el = $('#dvUpdate');
    const u = upd, t = u && UPD_TEXT[u.state];
    if (!t || (updHidden && updHidden === u.versionCode && (u.state === 'available' || u.state === 'ready'))) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'dvUpdate'; el.className = 'dv-update'; el.setAttribute('role', 'status');
      ($('#device') || document.body).appendChild(el);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-upd="go"]')) { DEV()?.updateInstall(); log('update:install'); }
        if (e.target.closest('[data-upd="later"]')) { updHidden = upd?.versionCode || 1; renderUpdate(); }
      });
    }
    const [msg, btn] = t(u);
    el.hidden = false; el.dataset.state = u.state;
    el.innerHTML = `<span class="dv-ui">↻</span><span class="dv-um">${esc(msg)}</span>${btn ? `<button data-upd="go">${esc(btn)}</button>` : ''}${u.state === 'available' || u.state === 'ready' ? '<button class="later" data-upd="later" aria-label="Later">×</button>' : ''}`;
  }
  function onUpdate(u) { upd = u; log('update:' + u.state, u.version || '', u.message || ''); renderUpdate(); if (W$()?.sheet === 'settings') W$().renderSettings(); }

  /* ================= #22 web hot-reload that keeps drafts ================= */
  const ASSETS = ['index.html', 'app.js', 'live.js', 'outbox.js', 'device.js', 'orb.js', 'live-mode.js', 'styles.css',
    'core/core.js', 'core/apps.js', 'core/chats.js', 'core/bridge.js', 'core/shell.js', 'core/base.css', 'core/chats.css'];
  const DRAFTS = 'wos.drafts.v1';
  let print0 = '', webPending = false, lastCheck = 0;
  async function fingerprint() {
    const parts = await Promise.all(ASSETS.map(async a => {
      try {
        // GET (some proxies mishandle HEAD); only the headers are read, the body is dropped unread.
        const r = await fetch(a, { cache: 'no-store', credentials: 'same-origin' });
        try { r.body?.cancel(); } catch (e) {}
        if (!r.ok) return a + ':' + r.status;
        const lm = r.headers.get('last-modified') || '', et = r.headers.get('etag') || '', len = r.headers.get('content-length') || '';
        return a + ':' + (et || lm + '/' + len);
      } catch (e) { return null; }
    }));
    return parts.includes(null) ? '' : parts.join('|');
  }
  async function checkWeb(force) {
    if (webPending || (!force && Date.now() - lastCheck < 60e3) || !navigator.onLine) return;
    lastCheck = Date.now();
    const p = await fingerprint(); if (!p) return;
    if (!print0) { print0 = p; return; }
    if (p !== print0) { webPending = true; log('web:changed'); applyWeb(); }
  }
  // Safe to reload: not recording, nothing uploading, no sheet or share in progress.
  function webBusy() {
    const w = W$(); if (!w) return true;
    if (w.voice !== 'idle' || sheet) return true;
    return Object.keys(w.wins).some(k => (w.chatState(k).files || []).some(f => f.uploading));
  }
  function saveDrafts() {
    const w = W$(); if (!w) return;
    const out = {};
    for (const k of Object.keys(w.wins)) {
      if (w.wins[k].app !== 'chats') continue;
      const c = w.chatState(k);
      const ta = document.querySelector(`[data-win="${k}"] .ch-compose textarea`);
      const draft = ta ? ta.value : c.draft || '';
      const files = (c.files || []).filter(f => f.id && !f.uploading).map(({ id, name, mime, bytes }) => ({ id, name, mime, bytes }));
      if (draft || files.length) out[k] = { thread: w.wins[k].thread || null, draft, files };
    }
    try { Object.keys(out).length ? localStorage.setItem(DRAFTS, JSON.stringify({ at: Date.now(), out })) : localStorage.removeItem(DRAFTS); } catch (e) {}
  }
  function restoreDrafts() {
    const w = W$(); if (!w) return;
    const s = J(localStorage.getItem(DRAFTS)); if (!s?.out || Date.now() - s.at > 864e5) return;
    let n = 0;
    for (const [k, v] of Object.entries(s.out)) {
      const win = w.wins[k]; if (!win || win.app !== 'chats' || (win.thread || null) !== v.thread) continue;
      const c = w.chatState(k);
      if (!c.draft && v.draft) { c.draft = v.draft; n++; }
      if (!(c.files || []).length && v.files?.length) { c.files = v.files.map(f => ({ ...f, key: Math.random().toString(36).slice(2) })); n++; }
      w.renderChats(win);
    }
    if (n) log('drafts:restored', n);
  }
  function applyWeb() {
    if (!webPending) return;
    if (document.hidden && !webBusy()) { reloadNow('hidden'); return; } // the owner is away: swap it in quietly
    let el = $('#dvWeb');
    if (!el) {
      el = document.createElement('div'); el.id = 'dvWeb'; el.className = 'dv-update web'; el.setAttribute('role', 'status');
      el.innerHTML = '<span class="dv-ui">✦</span><span class="dv-um">Wizard OS was updated</span><button data-web="go">Reload</button>';
      ($('#device') || document.body).appendChild(el);
      el.addEventListener('click', e => { if (e.target.closest('[data-web="go"]')) { if (webBusy()) toast('◌', 'Finish recording first', 1600); else reloadNow('tap'); } });
    }
  }
  function reloadNow(why) { saveDrafts(); log('web:reload', why); window.__wosReloading = why; location.reload(); }

  /* ================= wiring ================= */
  const api = window.WosDevice = {
    ready: false, back,
    get sheet() { return sheet ? sheet.kind : null; },
    /* Native → page: queued intents (share, recovery notification). Returns true when taken. */
    handle(h) {
      if (!h || !W$()) return false;
      if (h.action === 'share' && h.id) { onShare(String(h.id)); return true; }
      if (h.action === 'recover') { W$().closeSheets?.(); syncRecorder('notification'); return true; }
      return false;
    },
    /* Native → page events: rec (recorder), update (APK updater). */
    event(type, ev) {
      if (type === 'rec' && ev) onRec(ev);
      if (type === 'update' && ev) onUpdate(ev);
      return true;
    },
    settingsHtml() {
      const d = DEV(); if (!d) return '';
      const n = J(d.notifications()) || {};
      const u = upd || J(d.updateState()) || {};
      const ver = u.installed || (J(d.updateState()) || {}).installed || '';
      const sub = u.state === 'available' || u.state === 'ready' ? `${u.version} is available · tap to update` : u.state === 'current' ? 'Up to date' : u.state === 'offline' ? 'Couldn’t check · tap to try again' : 'Tap to check for updates';
      return `<div class="st-row static"><span class="st-ic">◉</span><span class="st-tx"><b>Recording</b><small>Keeps going with the screen off or in another app · Stop and Send in the notification</small></span></div>
        <div class="st-row static"><span class="st-ic">✉</span><span class="st-tx"><b>Reply notifications</b><small>${n.allowed ? `On · when ${window.WizConfig.agent()} answers a chat you sent from here` : 'Off · allow notifications for Wizard OS in Android settings'}</small></span></div>
        <button class="st-row" data-dvupd><span class="st-ic">↻</span><span class="st-tx"><b>Wizard OS ${esc(ver)}</b><small>${esc(sub)}</small></span><span class="st-go">›</span></button>`;
    },
    saveDrafts, checkWeb, _state: () => ({ sheet: sheet?.kind || null, upd, webPending, print0: !!print0 }),
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-dvupd]')) return;
    const d = DEV(); if (!d) return;
    if (upd && (upd.state === 'available' || upd.state === 'ready' || upd.state === 'error' || upd.state === 'installer' || upd.state === 'permission')) d.updateInstall(); else { d.updateCheck(); toast('↻', 'Checking for updates', 1400); }
  });

  function boot() {
    if (!W$()) return setTimeout(boot, 200);
    restoreDrafts();
    api.ready = true;
    const d = DEV();
    if (d) {
      syncRecorder('boot');
      upd = J(d.updateState()); renderUpdate();
      setTimeout(() => { try { d.updateCheck(); } catch (e) {} }, 2500);
    }
    setTimeout(() => checkWeb(true), 1500);
    setInterval(() => { if (!document.hidden) checkWeb(false); }, 5 * 60e3);
  }
  addEventListener('wos-native-resume', () => { if (api.ready) { syncRecorder('resume'); checkWeb(false); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveDrafts(); if (webPending) applyWeb(); }
    else if (api.ready) { checkWeb(false); syncRecorder('visible'); }
  });
  addEventListener('pagehide', saveDrafts);
  boot();
})();
