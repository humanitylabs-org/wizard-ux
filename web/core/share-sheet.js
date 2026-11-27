/* Wizard share sheet v3 (docs/SHARE-SHEET.md). Share opens Wizard's own sheet first: People → Agents → Apps →
 * Other apps… (the Android tray / browser share). Entered only from WosChat.sharePayload. Apps receive through
 * WizardApp.share.receive (app-client.js → app-services.js → here). The sheet never sends: an agent opens a new chat
 * with the item staged in its composer (WizOpenAgentChats + the Chats composer's own insertText/addFiles), an app
 * opens with the item pending and places it in its own composer; the owner makes the final tap either way.
 * James's latest correction, 31 Oct 2026: People first, recent shares/chats first, without loading the receiving app. */
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
      seen.add(t.id); out.push({ id: t.id, name, detail: clean(t.detail, 60), ...(Number.isFinite(t.lastActivity) && t.lastActivity > 0 ? { lastActivity: t.lastActivity } : {}) });
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
    write(localStorage, RECV, receivers); if (targets !== undefined) keepOnBox(appId); return true;
  }
  function setTargets(appId, targets) {
    if (!receivers[appId]) return false;
    receivers[appId].targets = cleanTargets(targets); receivers[appId].at = Date.now();
    write(localStorage, RECV, receivers); keepOnBox(appId); return true;
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
  // `switched`: a kind the app takes only while one of its own feature switches is on (wizard.app-switches/1). The
  // App Manager's one catalog says so without loading the app, so a file is offered to Messenger in a window that has
  // never opened it (wizard-ux issue 1625); a known switch state wins over the cached registration for that kind.
  const DEFAULTS = Object.freeze({ messenger: Object.freeze({ accepts: Object.freeze(['text', 'url']), targets: Object.freeze([]), switched: Object.freeze({ file: 'messenger:share-files' }) }) });
  // App switch states from store-install/_feature-switches: id -> true/false; a switch the catalog doesn't list is unknown.
  const sw = { on: null, at: 0, read: null };
  const homeUrl = p => { try { return new URL(p, document.baseURI || location.href).pathname; } catch (_) { return '/wizard-os-home/' + p; } };
  function readSwitches() {
    if (sw.read) return sw.read;
    if (Date.now() - sw.at < 60000 || typeof window.fetch !== 'function') return Promise.resolve();
    const ac = typeof AbortController === 'function' ? new AbortController() : null, timer = setTimeout(() => ac?.abort(), 8000);
    sw.read = window.fetch(homeUrl('store-install/_feature-switches'), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, ...(ac ? { signal: ac.signal } : {}) })
      .then(r => (r.ok ? r.json() : null)).then(d => {
        if (!d || !Array.isArray(d.switches)) return;
        const on = new Map(); for (const x of d.switches) if (x && x.kind === 'app' && typeof x.id === 'string') on.set(x.id, x.on === true);
        sw.on = on;
      }, () => {}).finally(() => { clearTimeout(timer); sw.read = null; sw.at = Date.now(); });
    return sw.read;
  }
  // Read ahead (never waited on: a Share tap opens the sheet, or goes out, in the same gesture): when a file is about to
  // be shareable (the media viewer opened one) and on every share, for the next one.
  function prime(kind) {
    if (Object.entries(DEFAULTS).some(([id, d]) => d.switched?.[kind] && installed(id))) void readSwitches();
    void readBox();
  }
  function takes(id, r, kind) {
    const key = DEFAULTS[id]?.switched?.[kind];
    if (key && sw.on?.has(key)) return sw.on.get(key);
    return !!r?.accepts?.includes(kind);
  }
  /* People on the box (wizard-ux issue 1627, on for everyone). The targets an app publishes
   * (id, name, detail only, in the app's own order: no activity times, never shared content) are also kept in one small
   * file in the owner's Files, Pages/wizard-share/people.json, through the Agent Service Pages file API that Look sync
   * uses (owner only, versioned, a stale save is a 409 carrying the newer text; no page.json, so it is never listed as a
   * page). A window that has never run Messenger then still shows Messenger's people: this browser's own copy wins when
   * it has one, else the box's. Read ahead (load, a file opened in the viewer, every share; cached 60 s, never waited on,
   * so Share stays inside its tap); written a moment after a changed list, at most every 30 s.
   *   { version: 1, apps: { '<app id>': { targets: [{ id, name, detail? }] } }, updated } */
  const BOX = '/wizard/v1/pages/wizard-share/people.json';
  const bx = { apps: {}, version: null, known: false, gone: false, at: 0, read: null, mine: {}, timer: null, put: 0, busy: false };
  const slim = list => cleanTargets(list).map(({ id, name, detail }) => ({ id, name, ...(detail ? { detail } : {}) }));
  function parseBox(text) {
    const out = {};
    try { const d = JSON.parse(text); if (d && typeof d.apps === 'object' && !Array.isArray(d.apps)) for (const [id, a] of Object.entries(d.apps)) if (okId(id) && a && typeof a === 'object') out[id] = slim(a.targets); } catch (_) {}
    return out;
  }
  function readBox(force = false) {
    if (bx.gone || typeof window.fetch !== 'function') return Promise.resolve();
    if (bx.read) return bx.read;
    if (!force && Date.now() - bx.at < 60000) return Promise.resolve();
    const ac = typeof AbortController === 'function' ? new AbortController() : null, timer = setTimeout(() => ac?.abort(), 8000);
    bx.read = window.fetch(BOX, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, ...(ac ? { signal: ac.signal } : {}) })
      .then(async r => {
        const j = await r.json().catch(() => null);
        if (r.status === 200 && typeof j?.text === 'string') { bx.apps = parseBox(j.text); bx.version = typeof j.version === 'string' ? j.version : null; bx.known = true; }
        else if (r.status === 404 && j?.error === 'file_not_found') { bx.apps = {}; bx.version = null; bx.known = true; }
        else if (r.status === 404 || r.status === 403) bx.gone = true; // no Pages on this box, or not the owner: this browser only
      }, () => {}).finally(() => { clearTimeout(timer); bx.read = null; bx.at = Date.now(); });
    return bx.read;
  }
  function keepOnBox(appId) {
    if (bx.gone || !receivers[appId]) return;
    bx.mine = { ...bx.mine, [appId]: slim(receivers[appId].targets) }; // replaced, never edited: a write in flight keeps its own
    clearTimeout(bx.timer); bx.timer = setTimeout(writeBox, Math.max(2000, bx.put + 30000 - Date.now()));
  }
  async function writeBox() {
    if (bx.busy) { bx.timer = setTimeout(writeBox, 2000); return; }
    bx.busy = true;
    try {
      // A fresh read first; a 409 hands back the newer file, which is merged per app and saved again.
      for (let i = 0; i < 4 && Object.keys(bx.mine).length; i++) {
        if (bx.gone) { bx.mine = {}; return; }
        if (i === 0 || !bx.known) await readBox(true);
        if (!bx.known) return; // offline or failing: kept, sent with the next change
        const mine = bx.mine, next = { ...bx.apps, ...mine };
        if (JSON.stringify(next) === JSON.stringify(bx.apps)) { if (bx.mine === mine) bx.mine = {}; return; }
        const apps = Object.fromEntries(Object.entries(next).map(([id, targets]) => [id, { targets }]));
        const text = JSON.stringify({ version: 1, apps, updated: new Date().toISOString() }, null, 1) + '\n';
        bx.put = Date.now();
        const r = await window.fetch(BOX, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, version: bx.version }) });
        const j = await r.json().catch(() => null);
        if (r.ok && typeof j?.version === 'string') { bx.apps = next; bx.version = j.version; bx.at = Date.now(); if (bx.mine === mine) bx.mine = {}; return; }
        if (r.status === 409 && j?.current && typeof j.current === 'object') { bx.apps = j.current.exists ? parseBox(j.current.text) : {}; bx.version = typeof j.current.version === 'string' ? j.current.version : null; continue; }
        if (r.status === 404 || r.status === 403) bx.gone = true;
        return;
      }
    } catch (_) { /* offline: kept, sent with the next change */ } finally { bx.busy = false; }
  }
  // This browser's own copy when the app has published one here, else the box's.
  function targetsOf(appId, r) {
    const own = cleanTargets(r?.targets);
    return own.length ? own : cleanTargets(bx.apps[appId]);
  }
  // Load: read the box, and offer it the people this browser already has (an app publishes only when its list
  // changes, so a list cached earlier would otherwise wait for the next change).
  function boxStart() {
    void readBox();
    for (const [id, r] of Object.entries(receivers)) if (r?.targets?.length) keepOnBox(id);
  }
  if (typeof setTimeout === 'function') setTimeout(boxStart, 0);
  const live = kind => Object.entries({ ...DEFAULTS, ...receivers }).filter(([id, r]) => takes(id, r, kind) && installed(id));
  const rank = key => { const i = recent.indexOf(key); return i < 0 ? 1e6 : i; };
  function people(kind) {
    // Cached metadata from every registered receiver; never open/unlock an app to choose a person.
    const rows = [];
    for (const [appId, r] of live(kind)) targetsOf(appId, r).forEach((t, order) => rows.push({ appId, ...t, order }));
    return rows.sort((a, b) => (rank(a.appId + '|' + a.id) - rank(b.appId + '|' + b.id)) ||
      ((b.lastActivity || 0) - (a.lastActivity || 0)) || (a.order - b.order)).slice(0, MAX_PEOPLE);
  }
  const apps = kind => live(kind).map(([appId]) => appId).sort((a, b) => rank(a) - rank(b));
  const wants = kind => live(kind).length > 0;

  /* ---- Agents row ---- */
  const host = () => window.__wos || window.__wux || null;
  // Where the share started: the tapped control, else the live selection, else the window in front. A Share pressed
  // inside a Chats window carries that window's agent; anything else (an app frame, Home) is not agent content.
  let lastPress = null;
  if (document.addEventListener) document.addEventListener('pointerdown', e => { if (!e.target?.closest?.('.wos-share')) lastPress = { el: e.target, at: Date.now() }; }, true);
  function frontWin(h) {
    try {
      if (Array.isArray(h?.desks)) return h.wins?.[h.desks[h.idx]?.focus] || null; // phone
      if (Array.isArray(h?.ws)) return h.wins?.[h.ws[h.cur]?.focus] || null; // desktop
    } catch (_) {}
    return null;
  }
  function chatOrigin(h, wid, box) {
    const AG = window.WosAgents, C = h?.chats, w = h?.wins?.[wid] || h?.wins?.[String(wid).replace(/::list$/, '')] || null;
    const thread = w?.thread && w.thread !== '__new__' ? w.thread : '';
    const agent = (thread && h?.live?.agentOf?.(thread)) || (w && C?.winAgent?.(w)) || '';
    const incognito = !!(box?.querySelector?.('[data-incog-thread]') || C?.incognitoActive?.(wid));
    const priv = incognito || !!(agent && AG?.isPrivate?.(AG.get(agent)));
    return { chat: true, agent: agent || AG?.defaultId?.() || '', private: priv, incognito };
  }
  function origin() {
    const h = host(), nodes = [];
    if (lastPress && Date.now() - lastPress.at < 8000) nodes.push(lastPress.el);
    try { const a = getSelection?.()?.anchorNode; if (a) nodes.push(a.nodeType === 1 ? a : a.parentElement); } catch (_) {}
    nodes.push(document.activeElement);
    for (const n of nodes) { const box = n?.closest?.('[data-chats]'); if (box) return chatOrigin(h, box.dataset.chats, box); }
    const w = frontWin(h); // the media viewer and other overlays sit over the window they came from
    if (w?.app === 'chats') { const box = document.querySelector(`[data-chats="${CSS.escape(String(w.id))}"]`); return chatOrigin(h, w.id, box); }
    return { chat: false, agent: '', private: false, incognito: false };
  }
  // Agents James can chat with (WosAgents, hidden ones excluded), most recently shared-to first, the main agent first
  // by default. Privacy (docs/SHARE-SHEET.md): content from a private agent's chat is offered only to that same agent,
  // and Incognito content never leaves its RAM-only chat, so the row is hidden there.
  function agentsFor(kind, from) {
    const AG = window.WosAgents; if (!AG || !window.WizOpenAgentChats) return [];
    if (from.incognito) return [];
    // Only the registry may declare a recipient. An empty/unavailable registry is not an agent.
    let list = (AG.visible?.() || []).filter(a => a.status !== 'stopped');
    if (from.private) list = list.filter(a => a.id === from.agent);
    if (kind === 'image' || kind === 'file') list = list.filter(a => a.permissions?.files !== 'none');
    const order = new Map(list.map((a, i) => [a.id, i]));
    return [...list].sort((a, b) => (rank('agent:' + a.id) - rank('agent:' + b.id)) || ((b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)) || (order.get(a.id) - order.get(b.id)));
  }
  // Text and links arrive as a Markdown quote under the unchanged attribution line ("From Archimedes:"), with an
  // empty line after it for his own note; files go through the composer's paperclip path (addFiles).
  function quoteOf(p) {
    let text = String(p.text || '').replace(/\r\n?/g, '\n'), head = '';
    const m = /^(From [^\n]{1,80}:)\n\n/.exec(text); if (m) { head = m[1]; text = text.slice(m[0].length); }
    const link = p.url && !text.includes(p.url) ? (p.title && !text ? `[${String(p.title).replace(/[[\]]/g, '')}](${p.url})` : p.url) : '';
    const body = [text.trim(), link].filter(Boolean).join('\n');
    if (!body) return '';
    return (head ? head + '\n' : '') + body.split('\n').map(l => (l ? '> ' + l : '>')).join('\n') + '\n\n';
  }
  const nextFrame = () => new Promise(r => (window.requestAnimationFrame || setTimeout)(() => r(), 16));
  async function composerOf(h, wid) {
    for (let i = 0; i < 60; i++) {
      const ta = document.querySelector(`[data-chats="${CSS.escape(String(wid))}"] .ch-compose textarea`);
      if (ta && ta.offsetParent !== null) return ta;
      await nextFrame();
    }
    return null;
  }
  async function toAgent(id, payload) {
    const h = host(), C = h?.chats; if (!C?.insertText) return false;
    const V = window.WosChat?.viewer; for (let i = 0; i < 3 && V?.isOpen?.(); i++) V.close(); // a photo shared from the viewer
    const w = await window.WizOpenAgentChats(id, { thread: '__new__', share: true });
    const wid = w && typeof w === 'object' ? w.id : ''; if (!wid) return false;
    const ta = await composerOf(h, wid); if (!ta) return false;
    const quote = quoteOf(payload);
    if (quote) {
      // After any unsent words already in that agent's new-chat draft; never over them.
      const had = ta.value.replace(/\s+$/, '');
      ta.setSelectionRange(ta.value.length, ta.value.length);
      if (!C.insertText(wid, (had ? (ta.value.endsWith('\n\n') ? '' : ta.value.endsWith('\n') ? '\n' : '\n\n') : '') + quote)) return false;
    }
    if (isBlob(payload.file)) { C.addFiles(wid, [payload.file]); ta.focus({ preventScroll: true }); }
    return true;
  }
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
  let handoffs = 0;
  function deliver(appId, payload, target) {
    payload = itemPayload(payload);
    if (!payload || !window.WizOpenApp) return false;
    prune();
    const id = 'sh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    pendingItems.push({ id, appId, payload, target: target || null, at: Date.now() });
    // The app shows its own picker (Messenger's Send to…): an overlay the share came from (the media viewer) steps
    // aside first, so the picker is where the owner is looking, never behind the file (ux#1630).
    if (!window.WizCanOpen || window.WizCanOpen(appId)) { const V = window.WosChat?.viewer; for (let i = 0; i < 3 && V?.isOpen?.(); i++) V.close(); }
    if (window.WizOpenApp(appId) === false) { ack(appId, id); return false; }
    handoffs++; // 'shared' is the receipt, but nothing is placed until the owner picks: callers must not toast Shared
    // An app already open pulls now; a fresh frame pulls when it registers.
    window.dispatchEvent(new CustomEvent('wizard:share-pending', { detail: { appId } }));
    return true;
  }

  // Same 31/code-point hash as Messenger; retain the share sheet's original 360-hue identity.
  const hue = n => { let h = 0; for (const ch of String(n).trim()) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % 360; };
  const initials = n => (String(n).trim().split(/\s+/).slice(0, 2).map(w => [...w][0] || '').join('') || '?').toUpperCase();
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
  function agentTile(a) {
    const AG = window.WosAgents, off = ['stopped', 'error'].includes(a.status);
    const icon = AG?.sigil ? AG.sigil(a, 'shs-ic') : `<span class="shs-ic">${esc(initials(a.label))}</span>`;
    return `<button type="button" class="shs-agent${AG?.isPrivate?.(a) ? ' private' : ''}" data-shs-agent="${esc(a.id)}"${off ? ' disabled' : ''} aria-label="${esc(`New chat with ${a.label}${off ? ' (stopped)' : ''}`)}">${icon}<span class="shs-nm">${esc(a.label)}</span></button>`;
  }
  function render(payload, kind, thumbnail, agents) {
    const list = apps(kind), ppl = people(kind);
    const preview = clean([payload.name, payload.title, payload.text, payload.url].filter(Boolean).join(' · '), 160);
    const el = document.createElement('div');
    el.className = 'wos-share'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Share');
    el.innerHTML = `<div class="shs-b">
      <div class="shs-t">Share</div>
      ${preview ? `<div class="shs-preview">${thumbnail ? `<img class="shs-thumb" src="${esc(thumbnail)}" alt="Image to share">` : ''}<div class="shs-prev">${esc(preview)}</div></div>` : ''}
      ${ppl.length ? `<div class="shs-sub">People</div><div class="shs-row" data-shs-people>${ppl.map(p => { const t = appTile(p.appId); return `<button type="button" class="shs-person" data-shs-app="${esc(p.appId)}" data-shs-target="${esc(p.id)}" aria-label="${esc(p.name)} in ${esc(t.name)}"><span class="shs-av" style="--h:${hue(p.name)}">${esc(initials(p.name))}<span class="shs-badge" aria-hidden="true">${t.icon}</span></span><span class="shs-nm">${esc(p.name)}</span></button>`; }).join('')}</div>` : ''}
      ${agents.length ? `<div class="shs-sub">Agents</div><div class="shs-row" data-shs-agents>${agents.map(agentTile).join('')}</div>` : ''}
      ${list.length ? `<div class="shs-sub">Apps</div><div class="shs-row" data-shs-apps>${list.map(id => { const t = appTile(id); return `<button type="button" class="shs-app" data-shs-app="${esc(id)}">${t.icon}<span class="shs-nm">${esc(t.name)}</span></button>`; }).join('')}</div>` : ''}
      <button type="button" class="shs-other" data-shs-other><span class="shs-oi" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></span>Other apps…</button>
    </div>`;
    return el;
  }
  // Resolves with the receipt contract: shared | copied | cancelled | unsupported.
  function show(payload, native) {
    payload = itemPayload(payload);
    if (!payload) return Promise.resolve('unsupported');
    prime(payload.kind);
    const kind = payload.kind, agents = agentsFor(kind, origin());
    if (!wants(kind) && !agents.length) return native();
    if (open) close('cancelled');
    return new Promise(resolve => {
      const thumbnail = kind === 'image' ? URL.createObjectURL(payload.file) : null;
      const el = render(payload, kind, thumbnail, agents);
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
        const ag = e.target.closest('[data-shs-agent]');
        if (ag) {
          if (ag.disabled) return;
          const id = ag.dataset.shsAgent; remember('agent:' + id);
          open = null; dismiss(me);
          toAgent(id, payload).then(done => me.resolve(done ? 'shared' : 'unsupported'), () => me.resolve('unsupported'));
          return;
        }
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
  window.WosShareSheet = Object.freeze({ show, wants: kind => wants(kind), prime: kind => { prime(kind); }, back, isOpen: () => !!open, handoffs: () => handoffs,
    _state: () => ({ receivers, recent, pending: pendingItems.map(x => ({ id: x.id, appId: x.appId, target: x.target })) }),
    _people: kind => people(kind).map(p => p.id),
    _agents: (kind, from) => agentsFor(kind, { chat: false, agent: '', private: false, incognito: false, ...(from || {}) }).map(a => a.id), _quote: p => quoteOf(p) });
})();
