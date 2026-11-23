/* Wizard UX core: app services › an app window's media viewer, Back and thread links (WizardApp.media.view,
 * WizardApp.nav.*), and the reload plan for the "Update ready" banner (kept recordings, drafts, per-app update
 * check). Moved verbatim out of core/app-services.js (wizard-ux issue 1665: split the giant front-end files, no
 * behaviour change). app-services.js calls this once, where the code used to be, with the closure names it reads,
 * and keeps the functions it returns under their old names. Loaded before app-services.js everywhere that loads it.
 * The body below keeps app-services.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.servicesParts = window.WizCore.servicesParts || {};
window.WizCore.servicesParts.windows = function ({ apps, changed, fault, frames, from, ORIGIN, reconcile, uid, valid, VERSION, within }) {
  /* WizardApp.media.view and WizardApp.nav.*, for a same-origin window (services above) and a sandboxed one (the
   * boundary server below) alike; each caller has verified the window first.
   * Photos and videos an app shows open in Wizard's one media viewer (pinch/double-tap zoom, pan, swipe between items,
   * Save/Share, Back/Esc closes) above the app, exactly as in Chats (James, 26 Oct 2026). `url(item)` gives an item's
   * safe address or null; the tapped item keeps its place after unsafe entries are dropped. */
  function mediaView(st, items, index, url) {
    if (st.isVisible?.() !== true || !window.WosChat?.viewer || !Array.isArray(items)) return false;
    const clean = [], list = items.slice(0, 500), want = Math.floor(+index) || 0;
    let i = want >= list.length ? Infinity : 0; // past the end (stale index, intake cap) still clamps to the last item
    for (const [n, it] of list.entries()) {
      if (n === want) i = clean.length;
      const href = url(it); if (!href) continue;
      const kind = it?.kind === 'video' ? 'video' : 'image';
      // A picture's quick stand-in (the copy the app already shows) passes the same address check as the picture,
      // so the viewer can show it at once while the original loads (ux#1509).
      const ph = kind === 'image' && (it?.placeholderBlob != null || (typeof it?.placeholder === 'string' && it.placeholder)) ? url(it.placeholderBlob != null ? { blob: it.placeholderBlob } : { url: it.placeholder }, true) : null;
      // A sharper copy the app already holds (`preview`, wizard-messenger issue 348) passes the same check and shows
      // after the stand-in, before the original; it only rides with a stand-in.
      const pv = ph && (it?.previewBlob != null || (typeof it?.preview === 'string' && it.preview)) ? url(it.previewBlob != null ? { blob: it.previewBlob } : { url: it.preview }, true) : null;
      clean.push({ url: href, kind, name: String(it?.name || '').slice(0, 200), mime: String(it?.mime || (kind === 'video' ? 'video/mp4' : 'image/jpeg')).slice(0, 100), ...(ph && ph !== href ? { placeholder: ph } : {}), ...(pv && pv !== href && pv !== ph ? { preview: pv } : {}) });
    }
    return clean.length ? window.WosChat.viewer.open(clean, Math.max(0, Math.min(clean.length - 1, i))) === true : false;
  }
  // The app finished what the owner came for (dismissed, archived, saved, deleted): take one Back past the app's own
  // views, landing on the previous screen exactly as the shell's Back would (James, 25 Oct 2026).
  function navBack(st) { if (st.isVisible?.() !== true || typeof st.back !== 'function') return false; return st.back() === true; }
  function contextDraft(st, data) {
    // Installed Wizard apps may attach bounded reference data to a fresh MAIN Chats draft, never send or run.
    // Identity and namespace come from the attached live frame, never from the caller's payload. The id grammar
    // matches WosChat.reply.clean's key namespace, so every admitted app can produce a valid reply key.
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(st.appId) || !apps().some(a => a.id === st.appId && a.kind === 'wizard') || st.isVisible?.() !== true || typeof st.openContextDraft !== 'function') throw fault('Context draft unavailable');
    if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id) || typeof data.title !== 'string' || data.title.length > 1000 || typeof data.message !== 'string' || data.message.length > 32000) throw fault('Invalid app context');
    // A Reply: the composer stays empty; the item rides beside the draft and is framed as quoted, untrusted
    // reference DATA only in the message that is sent (WosChat.reply).
    return st.openContextDraft(st.appId + ':' + data.id, { title: data.title, message: data.message });
  }
  function threadOpen(st, id, opts, authorized) {
    // This bounded workflow is admitted only for an admitted installed app's current document (Manager, Wisdom).
    if (!authorized || st.isVisible?.() !== true || typeof id !== 'string' || !id || id.length > 512 || /[\s\x00-\x1f]/.test(id) || id === '__new__') throw fault('Thread navigation unavailable');
    // Optional app item that rides beside the thread's draft: keyed to this app, quoted as data when sent.
    let reply = null;
    if (opts?.reply != null) {
      const r = opts.reply, key = String(r?.key || '');
      if (!key.startsWith(st.appId + ':')) throw fault('Reply context must be keyed to this app');
      reply = window.WosChat?.reply?.clean({ key, title: r?.title, message: r?.message });
      if (!reply) throw fault('Invalid reply context');
    }
    const agent = opts?.agent;
    if (agent != null) {
      const a = typeof agent === 'string' ? window.WosAgents?.get(agent) : null;
      if (!a || a.status !== 'running' || !window.WosAgents.isOther(agent)) throw fault('Thread agent unavailable');
    }
    // Optional trusted owner text stays a draft, separate from the untrusted
    // reply item. No send/run authority is added by this admission.
    let draft;
    if (opts?.draft != null) {
      if (typeof opts.draft !== 'object' || typeof opts.draft.text !== 'string' || opts.draft.text.length > 8000) throw fault('Invalid thread draft');
      draft = {text:opts.draft.text};
    }
    return st.openThread?.(id, { ...(reply ? { reply } : {}), ...(agent ? { agent } : {}), ...(draft ? {draft} : {}) }) === true;
  }
  /* The same for a sandboxed window (media.view): its own blob: URLs belong to its opaque origin and the shell can't
   * read them, so app-client.js sends such an item's bytes (`blob`) and the shell shows them under a blob: URL of its
   * own (the window's last set is revoked on its next view, a new document and when the window goes). Other items must be this host's
   * own http(s) addresses outside the owner routes; a relative one resolves against the page's address in the app. */
  const MEDIA_BLOBS = 50;
  function boundaryMedia(st, args) {
    if (st.isVisible?.() !== true || !window.WosChat?.viewer || !Array.isArray(args?.items)) return false;
    let base = st.url; try { if (typeof args.base === 'string' && args.base.length <= 2048) { const u = new URL(args.base); if (within(u, st.url)) base = u; } } catch (_) {}
    const made = [], count = [0, 0]; // pictures, stand-ins: each has its own quota, so stand-ins never crowd out a picture
    const shown = mediaView(st, args.items, args.index, (it, stand) => {
      if (it?.blob != null) {
        if (!['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(it.blob)) || count[stand ? 1 : 0] >= MEDIA_BLOBS) return null;
        const href = URL.createObjectURL(it.blob); made.push(href); count[stand ? 1 : 0]++; return href;
      }
      if (typeof it?.url !== 'string' || !it.url || it.url.length > 8192) return null;
      let u; try { u = new URL(it.url, base); } catch (_) { return null; }
      return u.origin === location.origin && /^https?:$/.test(u.protocol) && !u.username && !u.password && !window.WizBrowserBoundary.ownerRoute(u.href) ? u.href : null;
    });
    if (!shown) { for (const h of made) URL.revokeObjectURL(h); return false; }
    mediaRevoke(st); st.mediaUrls = made;
    return true;
  }
  function mediaRevoke(st) { for (const h of st.mediaUrls || []) URL.revokeObjectURL(h); st.mediaUrls = null; }
  function managerAuthorized(st) {
    if (!st || st.appId !== 'wizard-manager' || !valid(st, st.doc) || typeof st.openThread !== 'function') return false;
    const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.url);
    try { return !!app && new URL(app.url, location.href).href === st.url.href; } catch (_) { return false; }
  }
  function ownsThreadLink(source, anchor) {
    const st = from(source);
    if (!managerAuthorized(st)) return false;
    try {
      const u = new URL(anchor.href);
      return u.origin === ORIGIN && u.pathname === '/wizard-os-home/' &&
        !!anchor.dataset.wizardNativeThread && u.searchParams.get('session') === anchor.dataset.wizardNativeThread;
    } catch (_) { return false; }
  }
  /* Reload plan for the "Update ready" banner. A native meeting keeps recording through a shell reload (see
   * WizAppCapture.reloadCheck); its app's capture holds ("… recording", "… capture …") are then not a reason
   * to wait, because the app reattaches to the same meeting after load. Every other hold still blocks:
   * kind 'capture' (a recording that would stop or a save after Stop) or 'work' (unsaved app state). */
  const CAPTURE_HOLD = /record|captur/i;
  function reloadPlan() {
    reconcile();
    let cap;
    try { cap = window.WizAppCapture?.reloadCheck?.(); } catch (_) { cap = { safe: false, reason: 'capture' }; }
    if (!cap) { const s = window.WizAppCapture?.getState?.(); cap = s && (s.hold || s.active || s.recording) ? { safe: false, reason: 'capture' } : { safe: true, keeps: null }; }
    let keeps = cap.safe ? cap.keeps || null : null; const blocking = [];
    // A live Android meeting with no stored row (phone storage broken): keep only the meeting app's own frame,
    // and only while it holds a recording. Every other app's capture holds keep blocking.
    if (cap.safe && !keeps && cap.meetingApp) {
      const st = [...frames.values()].find(f => f.appId === cap.meetingApp && [...f.holds.values()].some(r => CAPTURE_HOLD.test(r)));
      if (st) keeps = { appId: st.appId };
    }
    if (!cap.safe) blocking.push({ source: 'capture', appId: cap.appId || null, kind: 'capture', reason: cap.reason || 'capture', startedAt: cap.startedAt || null });
    for (const st of frames.values()) for (const [id, reason] of st.holds) {
      if (st.drafts?.get(id)?.kept) continue;
      const capture = CAPTURE_HOLD.test(reason);
      // App-owned holds are released only by their owner. Durable shared storage cannot prove an
      // app has no private in-memory work. Only the existing native-survival contract passes here.
      if (capture && keeps && st.appId === keeps.appId) continue;
      blocking.push({ source: 'frame', appId: st.appId, kind: capture ? 'capture' : 'work', reason, keepable: !!st.drafts?.has(id) });
    }
    // A blocker says reload is unsafe, not that a known recording will eventually end.
    return { ok: !blocking.length, keeps, capture: cap, blocking, recording: cap.waitForEnd === true };
  }
  // Preparation is non-destructive: an async flush may reveal new work and abort the reload.
  // All frames share one 1.5s budget. Late callbacks, edits and document changes cannot admit reload.
  async function keepDrafts(frame = null) {
    reconcile();
    const now = typeof performance === 'undefined' ? () => Date.now() : () => performance.now();
    const deadline = now() + 1500;
    await Promise.all([...frames.values()].filter(st => !frame || st.frame === frame).flatMap(st => [...(st.drafts || [])].map(async ([id, draft]) => {
      if (draft.kept || !valid(st, draft.doc)) return;
      const generation = draft.generation;
      let timer;
      try {
        // Timers cannot run during synchronous persistence; check the clock at both boundaries.
        const result = await Promise.race([Promise.resolve().then(() => now() < deadline ? draft.keep() : false), new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - now())); })]);
        if (result === 'kept' && now() < deadline && valid(st, draft.doc) && st.drafts?.get(id) === draft && generation === draft.generation) draft.kept = true;
      } catch (_) { /* No confirmation means the original hold stays. */ }
      finally { clearTimeout(timer); }
    })));
    changed();
    return reloadPlan();
  }
  function keepMessage(st, keepId) {
    return new Promise(resolve => {
      const id = uid(), doc = st.doc;
      const done = e => {
        if (e.source !== st.frame.contentWindow || e.origin !== ORIGIN || !valid(st, doc) || e.data?.type !== 'wizard:app:kept' || e.data.version !== VERSION || e.data.id !== id) return;
        finish(e.data.result === 'kept' ? 'kept' : false);
      };
      const finish = result => { clearTimeout(timer); removeEventListener('message', done); resolve(result); };
      const timer = setTimeout(() => finish(false), 1500);
      addEventListener('message', done);
      try { st.frame.contentWindow.postMessage({type: 'wizard:app:keep', version: VERSION, id, keepId}, ORIGIN); } catch (_) { finish(false); }
    });
  }
  async function prepareReload(plan) {
    if (plan?.keeps) await window.WizAppCapture?.prepareReload?.();
  }
  // Commit only after the caller's final safety check, synchronously adjacent to location.reload().
  // Removing the kept frame avoids its standalone beforeunload prompt; its recorder lives in the shell.
  function commitReload(plan) {
    if (!plan?.keeps) return;
    for (const st of [...frames.values()]) if (st.appId === plan.keeps.appId) {
      // Come back to the same place in the app (the meeting being recorded): frames keep only path + query.
      try { const l = st.frame.contentWindow.location; if (valid(st) && l.hash && l.hash !== '#' && l.hash !== '#/') sessionStorage.setItem(RETURN_KEY, JSON.stringify({ appId: st.appId, path: l.pathname + l.search, hash: l.hash.slice(0, 512), at: Date.now() })); } catch (_) {}
      try { st.detach(); st.frame.remove(); } catch (_) {}
    }
  }
  // Per-app update check (core/app-versions.js): attached same-origin app frames, whether each is on screen, and
  // what would be lost by reloading it. A frame with no isVisible host (single-app session) is the whole page.
  function updateFrames() {
    reconcile();
    return [...frames.values()].filter(st => valid(st)).map(st => {
      let visible = true; try { if (st.isVisible) visible = st.isVisible() === true; } catch (_) { visible = false; }
      return Object.freeze({ frame: st.frame, appId: st.appId, visible, holds: [...st.holds].filter(([id]) => !st.drafts?.get(id)?.kept).map(([,reason]) => reason), keepable: [...(st.drafts?.values() || [])].some(d => !d.kept), suspect: !!st.suspect });
    });
  }
  // One-shot, after a reload that kept a recording: put the kept app's frame back on the route it showed.
  const RETURN_KEY = 'wos.reload-return.v1';
  function restoreReturn(st) {
    let r; try { r = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null'); } catch (_) { r = null; }
    if (!r || r.appId !== st.appId) return;
    try {
      const w = st.frame.contentWindow, here = w.location;
      if (Date.now() - r.at > 10 * 60e3) { sessionStorage.removeItem(RETURN_KEY); return; }
      if (!valid(st) || here.href === 'about:blank' || here.pathname + here.search !== r.path) return; // not loaded yet
      sessionStorage.removeItem(RETURN_KEY);
      if (!here.hash || here.hash === '#' || here.hash === '#/') here.hash = r.hash;
    } catch (_) {}
  }
  return { boundaryMedia, commitReload, contextDraft, keepDrafts, keepMessage, mediaRevoke, mediaView, navBack, ownsThreadLink, prepareReload, reloadPlan, restoreReturn, threadOpen, updateFrames };
};
