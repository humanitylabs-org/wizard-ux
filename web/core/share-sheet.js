/* Wizard share sheet v1 (docs/SHARE-SHEET.md). Share opens Wizard's own sheet first: people → Apps →
 * Other apps… (the Android tray / browser share). Entered only from WosChat.sharePayload. Apps receive through
 * WizardApp.share.receive (app-client.js → app-services.js → here). The sheet never sends for an app: it opens the
 * app with the item pending, and the app places it in its own composer for the owner's final tap. */
(() => {
  'use strict';
  if (window.WosShareSheet) return;
  const RECV = 'wos.share.receivers.v1', RECENT = 'wos.share.recent.v1';
  const KINDS = new Set(['text', 'url', 'image', 'file']), TTL = 30 * 60 * 1000, MAX_PEOPLE = 8;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (store, key, dflt) => { try { const v = JSON.parse(store.getItem(key) || 'null'); return v ?? dflt; } catch (_) { return dflt; } };
  const write = (store, key, v) => { try { store.setItem(key, JSON.stringify(v)); } catch (_) {} };
  const clean = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n);
  const okId = v => typeof v === 'string' && v.length > 0 && v.length <= 160 && !/[\x00-\x1f\x7f]/.test(v);
  let receivers = read(localStorage, RECV, {}); if (!receivers || typeof receivers !== 'object') receivers = {};
  let recent = read(localStorage, RECENT, []); if (!Array.isArray(recent)) recent = [];
  // Pending items live in this closure only (never storage, never a global): app-services reads them per verified app id.
  let pendingItems = [];
  let open = null; // { el, resolve, native }

  function appMeta(appId) {
    for (const k of ['mobile', 'desktop']) { try { const a = window.WizCore?.apps?.(k)?.APP?.[appId]; if (a) return a; } catch (_) {} }
    return null;
  }
  const installed = appId => { const a = appMeta(appId); return !!a && a.kind === 'wizard'; };
  function cleanTargets(list) {
    if (!Array.isArray(list)) return [];
    const out = [], seen = new Set();
    for (const t of list) {
      if (out.length >= 24) break;
      if (!t || !okId(t.id) || seen.has(t.id)) continue;
      const name = clean(t.name, 80); if (!name) continue;
      seen.add(t.id); out.push({ id: t.id, name, detail: clean(t.detail, 60) });
    }
    return out;
  }
  // Called by app-services for a verified same-origin app frame only.
  function register(appId, { accepts, targets } = {}) {
    if (!okId(appId)) return false;
    const kinds = (Array.isArray(accepts) ? accepts : []).filter(k => KINDS.has(k));
    if (!kinds.length) { delete receivers[appId]; write(localStorage, RECV, receivers); return false; }
    const prev = receivers[appId];
    receivers[appId] = { accepts: [...new Set(kinds)], targets: targets === undefined ? (prev?.targets || []) : cleanTargets(targets), at: Date.now() };
    write(localStorage, RECV, receivers); return true;
  }
  function setTargets(appId, targets) {
    if (!receivers[appId]) return false;
    receivers[appId].targets = cleanTargets(targets); receivers[appId].at = Date.now();
    write(localStorage, RECV, receivers); return true;
  }
  const isBlob = f => f && ['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(f));
  const kindOf = p => isBlob(p.file) ? (p.file.type.startsWith('image/') ? 'image' : 'file') : (p.text ? 'text' : 'url');
  function itemPayload(p) {
    if (!p || typeof p !== 'object') return null;
    if (p.file != null && (!isBlob(p.file) || p.file.size > 32 * 1024 * 1024)) return null;
    const kind = kindOf(p);
    return { ...p, kind, ...(isBlob(p.file) ? { name: clean(p.file.name || 'wizard-file', 255), mime: p.file.type || 'application/octet-stream', size: p.file.size } : {}) };
  }
  // Reviewed receivers offered before the app has ever been opened on this device (fresh install, new phone,
  // cleared storage). Until the catalog carries a manifest share declaration, this list is the only default; the
  // app's own WizardApp.share.receive registration replaces it (and adds its people) the first time it runs.
  // Images stay out of the default until a Messenger that stages images (wizard-messenger#8) registers them itself:
  // an older, never-opened Messenger offered an image would leave it pending until expiry.
  const DEFAULTS = Object.freeze({ messenger: Object.freeze({ accepts: Object.freeze(['text', 'url']), targets: Object.freeze([]) }) });
  const live = kind => Object.entries({ ...DEFAULTS, ...receivers }).filter(([id, r]) => r?.accepts?.includes(kind) && installed(id));
  const rank = key => { const i = recent.indexOf(key); return i < 0 ? 1e6 : i; };
  function people(kind) {
    const rows = [];
    for (const [appId, r] of live(kind)) (r.targets || []).forEach((t, i) => rows.push({ appId, ...t, order: i }));
    return rows.sort((a, b) => (rank(a.appId + '|' + a.id) - rank(b.appId + '|' + b.id)) || (a.order - b.order)).slice(0, MAX_PEOPLE);
  }
  const apps = kind => live(kind).map(([appId]) => appId).sort((a, b) => rank(a) - rank(b));
  const wants = kind => live(kind).length > 0;
  function remember(...keys) { recent = [...keys, ...recent.filter(k => !keys.includes(k))].slice(0, 40); write(localStorage, RECENT, recent); }

  function prune() { const now = Date.now(); pendingItems = pendingItems.filter(x => now - x.at < TTL); }
  // One frame per item: the first live frame of that app to pull claims it, and only a closed claimant releases it,
  // so two open windows of one app never both place the same share.
  function pending(appId, claimant) {
    prune();
    const mine = x => x.appId === appId && (!x.claim || x.claim.owner === claimant?.owner || !x.claim.alive());
    return pendingItems.filter(mine).map(x => { if (claimant) x.claim = claimant; return { id: x.id, ...x.payload, target: x.target }; });
  }
  function ack(appId, id) { const n = pendingItems.length; pendingItems = pendingItems.filter(x => !(x.appId === appId && x.id === id)); return pendingItems.length < n; }
  function deliver(appId, payload, target) {
    payload = itemPayload(payload);
    if (!payload || !window.WizOpenApp) return false;
    prune();
    const id = 'sh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    pendingItems.push({ id, appId, payload, target: target || null, at: Date.now() });

    if (window.WizOpenApp(appId) === false) { ack(appId, id); return false; }
    // An app already open pulls now; a fresh frame pulls when it registers.
    window.dispatchEvent(new CustomEvent('wizard:share-pending', { detail: { appId } }));
    return true;
  }

  const initials = n => (String(n).trim().split(/\s+/).slice(0, 2).map(w => [...w][0] || '').join('') || '?').toUpperCase();
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % 360; };
  function appTile(appId) {
    const a = appMeta(appId) || { id: appId, name: appId };
    const icon = window.WizSigil ? window.WizSigil.box('span', 'shs-ic', a) : `<span class="shs-ic">${esc(initials(a.name))}</span>`;
    return { name: a.name || appId, icon };
  }
  function dismiss(o) { if (o.thumbnail) { URL.revokeObjectURL(o.thumbnail); o.el.querySelector('.shs-thumb')?.removeAttribute('src'); } o.el.classList.remove('on'); o.el.style.pointerEvents = 'none'; setTimeout(() => o.el.remove(), 160); }
  function close(outcome) {
    if (!open) return false;
    const o = open; open = null; dismiss(o);
    o.resolve(outcome); return true;
  }
  function render(payload, kind, thumbnail) {
    const ppl = people(kind), list = apps(kind);
    const preview = clean([payload.name, payload.title, payload.text, payload.url].filter(Boolean).join(' · '), 160);
    const el = document.createElement('div');
    el.className = 'wos-share'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Share');
    el.innerHTML = `<div class="shs-b">
      <div class="shs-t">Share</div>
      ${preview ? `<div class="shs-preview">${thumbnail ? `<img class="shs-thumb" src="${esc(thumbnail)}" alt="Image to share">` : ''}<div class="shs-prev">${esc(preview)}</div></div>` : ''}
      ${ppl.length ? `<div class="shs-sub">People</div><div class="shs-row" data-shs-people>${ppl.map(p => { const t = appTile(p.appId); return `<button type="button" class="shs-person" data-shs-app="${esc(p.appId)}" data-shs-target="${esc(p.id)}" aria-label="${esc(p.name)} in ${esc(t.name)}"><span class="shs-av" style="--h:${hue(p.name)}">${esc(initials(p.name))}<span class="shs-badge">${t.icon}</span></span><span class="shs-nm">${esc(p.name)}</span></button>`; }).join('')}</div>` : ''}
      <div class="shs-sub">Apps</div><div class="shs-row" data-shs-apps>${list.map(id => { const t = appTile(id); return `<button type="button" class="shs-app" data-shs-app="${esc(id)}">${t.icon}<span class="shs-nm">${esc(t.name)}</span></button>`; }).join('')}</div>
      <button type="button" class="shs-other" data-shs-other><span class="shs-oi" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></span>Other apps…</button>
    </div>`;
    return el;
  }
  // Resolves with the receipt contract: shared | copied | cancelled | unsupported.
  function show(payload, native) {
    payload = itemPayload(payload);
    if (!payload) return Promise.resolve('unsupported');
    const kind = payload.kind;
    if (!wants(kind)) return native();
    if (open) close('cancelled');
    return new Promise(resolve => {
      const thumbnail = kind === 'image' ? URL.createObjectURL(payload.file) : null;
      const el = render(payload, kind, thumbnail);
      const me = open = { el, resolve, native, thumbnail };
      // Only a fresh gesture may act on a just-opened sheet. A timeout both let
      // slow long-press releases through and discarded quick intentional taps.
      let armed = false;
      el.addEventListener('pointerdown', () => { armed = true; });
      el.addEventListener('pointercancel', () => { armed = false; });
      el.addEventListener('click', e => {
        if (open !== me || (!armed && e.detail !== 0)) return; // a fading sheet never acts on a newer one
        armed = false;
        if (!e.target.closest('.shs-b')) return close('cancelled');
        if (e.target.closest('[data-shs-other]')) { open = null; dismiss(me); Promise.resolve().then(() => me.native()).then(me.resolve, () => me.resolve('unsupported')); return; }
        const b = e.target.closest('[data-shs-app]'); if (!b) return;
        const appId = b.dataset.shsApp, target = b.dataset.shsTarget || null;
        remember(...(target ? [appId + '|' + target] : []), appId);
        close(deliver(appId, payload, target) ? 'shared' : 'unsupported');
      });
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));
      el.querySelector('button')?.focus({ preventScroll: true });
    });
  }
  // Back / Escape: the sheet sits above everything it was opened from.
  const back = () => (close('cancelled') ? 'share-sheet' : null);
  const claimed = !!window.WizAppServices?.claimShare?.(Object.freeze({ register, setTargets, pending, ack, deliver }));
  if (!claimed) console.warn('WosShareSheet: app services already claimed; apps cannot receive shares');
  window.WosShareSheet = Object.freeze({ show, wants: kind => wants(kind), back, isOpen: () => !!open,
    _state: () => ({ receivers, recent, pending: pendingItems.map(x => ({ id: x.id, appId: x.appId, target: x.target })) }) });
})();
