/* The chrome the Orb and Apps views share (Miguel, 1 Nov 2026): the + sheet, the orb swipes and the full-screen app
 * windows both views wear. Used by the Apps view on both shells (layouts/apps) and by the Orb view (layouts/orb: the
 * phone's Home and the desktop scene); one source, so both views offer exactly the same lists and the same gestures,
 * and switching views (Desks | Orb | Apps) never loses anything: they all read the same desks.
 *
 *   - Three levels, in one logical flow (Miguel, 1 Nov 2026):
 *       1. Open      = every app with a desk (one to one with the Apps view's icons and the Orb's satellites);
 *       2. Installed = installed apps that are not open: a tap opens it on a desk of its own, where it then shows as its
 *                      own icon / satellite;
 *       3. Get more  = the App Store's apps this Wizard lacks (the Store app's own listing, api.apps.store()): a tap
 *                      opens that app's page in the App Store window (its own Get, never a second store); once it is
 *                      installed it opens right away in the Store's place.
 *     The + opens the sheet: one search field filters all three; Open tiles carry a ✕ that closes the app (its desk
 *     goes, it moves back to Installed). Backdrop, ✕ or Back / Esc close the sheet.
 *   - No Back button (round 6): Home is a swipe up on the orb, like the iPhone's home swipe (ORB_SWIPES: up = Home;
 *     sideways and down do nothing in these views). The desktop also keeps ⌥`.
 *   - Full screen (Miguel, 1 Nov 2026: "like Chats"): an open app uses the whole screen, the orb floats over it and the
 *     app fades out toward the bottom (chrome.css); hosted apps get room under their last item (api.apps.inset), so
 *     every list still scrolls clear of the orb.
 *
 * Its CSS (chrome.css, loaded from here) is scoped to html[data-view-chrome], set only while a view wears it. No
 * timers, no storage, no innerHTML; everything through the layout API. */
import { glyphOf, colourOf } from '../orb/shared.js';

const SVG = 'http://www.w3.org/2000/svg';
export const CHATS = 'wizard';
/** A microphone (one path): the glyph the orb wears in the AI apps view (round 6: the orb is the microphone). */
export const MIC = 'M12 3.5a2.75 2.75 0 0 0-2.75 2.75v5.5a2.75 2.75 0 0 0 5.5 0v-5.5A2.75 2.75 0 0 0 12 3.5zM6.5 11.25a5.5 5.5 0 0 0 11 0M12 16.75v3.75';

/** Level 2, Installed: the picker's apps minus Chats and every app already open (ids of the open desks). */
export function notOpen(apps, openIds) {
  const open = new Set(openIds || []);
  return (apps || []).filter(a => a && a.id && a.id !== CHATS && !a.agent && !a.connector && !a.dev && !open.has(a.id));
}
/** Level 1, Open: one per open app, in desk order (Chats left out: it is always there), named as the picker names it. */
export function openApps(apps, desks) {
  const meta = new Map((apps || []).map(a => [a.id, a])), seen = new Set();
  return (desks || []).filter(d => d && d.id && d.id !== CHATS && !seen.has(d.id) && seen.add(d.id))
    .map(d => meta.get(d.id) || { id: d.id, name: d.name || d.id, icon: '' });
}
/** Real apps only (Miguel, round 6: the drawer / sidebar grid): the open apps that are Apps in the launcher's grouping
 * (kinds.apps; the shared sheet's Apps), not system / Wizard apps; never agent apps, agents, connectors or apps in
 * development. Without kinds (an older shell): the open apps minus anything flagged agent / connector / dev. */
export function realApps(list, kinds) {
  if (kinds && Array.isArray(kinds.apps)) { const ok = new Set(kinds.apps.filter(a => a && a.id && !a.system).map(a => a.id)); return (list || []).filter(a => ok.has(a.id)); }
  return (list || []).filter(a => a && !a.agent && !a.connector && !a.dev && !a.system);
}
/** The sheet's one search field: a case-insensitive match on the name (and a Store app's summary). */
export const matches = (a, q) => { const n = String(q || '').trim().toLowerCase(); return !n || String(a.name || '').toLowerCase().includes(n) || String(a.summary || '').toLowerCase().includes(n); };
/** Room the floating orb takes at the bottom of an app window (px), per shell: hosted apps scroll their last item
 * clear of it (api.apps.inset). The phone's dock orb sits in its row (dock height + safe area, ~92 px); the desktop
 * Apps orb is 60 px over an 8 px margin. */
export const FLOAT_INSET = Object.freeze({ phone: 96, desktop: 84 });

/** The phone dock orb's swipes in the Orb and Apps views (api.phone.swipes): up = Home; sideways (desk steps) and down
 * (distraction-free) do nothing; no Desks panel / app picker from the orb (the + covers new apps). Tap and hold stay
 * the stock ones. Desks declares nothing, so the dock keeps every stock swipe there. */
export const ORB_SWIPES = Object.freeze({ up: 'home', side: null, down: null });

export function viewChrome(api, { openIds, goOpen = null, inset = null, orb = null, swipes = null, micGlyph = false }) {
  const doc = document, root = doc.documentElement, shell = api.env.shell === 'desktop' ? 'desktop' : 'phone';
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = (d, cls) => {
    if (typeof doc.createElementNS !== 'function') return el('i', cls);
    const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
    const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); return s;
  };
  let href = 'chrome.css';
  try { const u = new URL('chrome.css', import.meta.url); u.search = new URL(import.meta.url).search; href = u.href; } catch (_) {}
  const css = el('link', '', { rel: 'stylesheet', href });
  const unmountCss = api.mount(css);
  root.dataset.viewChrome = shell;

  // the dock orb's swipes (phone; the desktop Apps orb is the layout's own button): up = Home, the rest inert
  // (a view may give its own: AI apps' swipe up is a New chat with the keyboard up, 'new')
  const offSwipes = shell === 'phone' && api.phone?.swipes ? api.phone.swipes(swipes || ORB_SWIPES) : null;

  /* ---------- full screen: hosted apps get room under their last item for the floating orb ---------- */
  // the orb bar (the Wizard standard on the phone): the dock orb's fixed spot, bottom centre; an app's own bottom tabs
  // are laid out either side of it on its row (skin-host), never under it
  const orbSpot = () => {
    const o = api.phone?.orb?.(); if (!o?.getBoundingClientRect) return null;
    const r = o.getBoundingClientRect(), d = o.offsetWidth || r.width;   // untransformed size: a press never reflows the bar
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, d } : null;
  };
  /* Round 6 (Miguel, 2 Nov 2026): the orb has a compact spot of its own wherever there is a row to sit in. The view's
   * composer (orbIn: the slot where the mic was) or the app in front (skin-host: the end of its bottom row of controls)
   * says where; the orb moves there and takes that size (--vc-orb-dx / -dy / -k on <html>, read by chrome.css for the
   * dock orb and by the view's own CSS for its own orb); null = its own fixed spot. home() is the orb's untransformed
   * spot (what the bars are laid out around), whatever move is applied. */
  let moved = { dx: 0, dy: 0, k: 1 }, appSpot = null, ownSpot = null;
  const rawSpot = orb || (shell === 'phone' ? orbSpot : null);
  const home = () => { const o = rawSpot?.(); return o ? { x: o.x - moved.dx, y: o.y - moved.dy, d: o.d } : null; };
  function placeOrb() {
    const want = ownSpot || appSpot, h = want ? home() : null;
    const t = want && h && h.d > 0 ? { dx: Math.round(want.x - h.x), dy: Math.round(want.y - h.y), k: Math.round(Math.min(1, want.d / h.d) * 1000) / 1000 } : { dx: 0, dy: 0, k: 1 };
    const at = want ? (ownSpot ? 'composer' : 'row') : '';
    if (t.dx === moved.dx && t.dy === moved.dy && t.k === moved.k && (root.dataset.vcOrb || '') === at) return;
    moved = t;
    if (at) { root.style.setProperty('--vc-orb-dx', t.dx + 'px'); root.style.setProperty('--vc-orb-dy', t.dy + 'px'); root.style.setProperty('--vc-orb-k', String(t.k)); root.dataset.vcOrb = at; }
    else { for (const k of ['--vc-orb-dx', '--vc-orb-dy', '--vc-orb-k']) root.style.removeProperty(k); delete root.dataset.vcOrb; }
  }
  const sameSpot = (a, b) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.d - b.d) < .5);
  const offInset = api.apps.inset ? api.apps.inset(inset ?? FLOAT_INSET[shell], rawSpot ? home : null, s => { appSpot = s || null; placeOrb(); }) : null;
  // the small microphone in the orb (round 6: the orb IS the microphone, everywhere the view shows it): the dock orb's;
  // a view drawing its own orb draws its own
  let glyph = null;
  if (micGlyph && shell === 'phone') {
    const o = api.phone?.orb?.();
    if (o?.append) { glyph = el('span', 'vc-mic', { 'aria-hidden': 'true' }); glyph.append(icon(MIC, 'vc-mic-i')); o.append(glyph); }
  }

  /* ---------- the + sheet: Open · Installed · Get more ---------- */
  let sheet = null, offBack = null, offMount = null, q = '', store = null, storeErr = false, body = null, closing = false;
  const desks = () => (api.desks?.list || api.phone?.desks)?.() || [];
  // (AI apps round 16, opt-in: the picker of installed apps that are neither open nor pinned; see open(opts))
  let pick = null;
  function list() { const ex = new Set(pick?.exclude?.() || []); return notOpen(api.apps.list(), pick?.includeOpen ? [] : openIds()).filter(a => !ex.has(a.id)); }
  function tile(a, cls = 'vc-tile') {
    const t = el('span', cls, { 'aria-hidden': 'true' }); t.style.setProperty('--c', colourOf(a));
    t.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    api.apps.logo(a.id).then(url => {
      if (!url || !t.isConnected) return;
      const im = el('img', 'vc-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { t.replaceChildren(im); t.classList.add('is-logo'); }, () => {});
    });
    return t;
  }
  // level 1: an open app; tap = go to it, ✕ = close it (its desk goes; it moves back to Installed)
  function openTile(a) {
    const box = el('div', 'vc-open', { role: 'listitem', 'data-open': a.id });
    const go = el('button', 'vc-hit', { type: 'button', 'aria-label': 'Go to ' + a.name });
    go.append(tile(a), el('span', 'vc-name', { text: a.name }));
    const x = el('button', 'vc-close', { type: 'button', 'aria-label': 'Close ' + a.name, title: 'Close ' + a.name }); x.append(icon('M7 7l10 10M17 7 7 17', 'vc-ico'));
    api.listen(go, 'click', () => { close(); (goOpen || (id => api.apps.openDesk ? api.apps.openDesk(id) : api.apps.open(id)))(a.id); });
    api.listen(x, 'click', () => { closing = true; try { api.apps.close?.(a.id); } finally { closing = false; } api.after(60, paint); });   // the sheet stays open (closing a desk briefly leaves Home)
    box.append(go, x);
    return box;
  }
  // level 2: installed, not open; tap = open it on a desk of its own (an agent app with no screen: its settings)
  function row(a) {
    const b = el('button', 'vc-app' + (a.system ? ' vc-sys' : ''), { type: 'button', role: 'listitem', 'data-app': a.id, 'aria-label': 'Open ' + a.name });
    b.append(tile(a), el('span', 'vc-name', { text: a.name }));
    api.listen(b, 'click', () => { const reuse = pick?.includeOpen && desks().some(d => d.id === a.id); close(); if (reuse && goOpen) goOpen(a.id); else if (api.apps.openAny && kindsOf()) api.apps.openAny(a.id); else if (api.apps.openDesk) api.apps.openDesk(a.id); else api.apps.open(a.id); });
    return b;
  }
  /* Installed, by kind (Miguel, 2 Nov 2026: "the different types of apps", as the launcher groups them): Apps, Agent apps,
   * Agents, Connectors, In development; each without what is already open. A shell without kinds: one Installed list. */
  /* Miguel, 2 Nov 2026: Apps open; everything mostly for agents (Agent apps, Agents, Connectors) folded into one
   * "For agents" row, like the launcher; apps made on this Wizard (agent Pages, launcher links, test copies: what the
   * launcher calls In development) are just apps here, with the rest. */
  const KINDS = [['apps', 'Apps'], ['wiz', 'Agent apps'], ['agents', 'Agents'], ['conns', 'Connectors']];
  const AGENT_KINDS = new Set(['wiz', 'agents', 'conns']);
  const kindsOf = () => { const k = api.apps.kinds?.(); return k && typeof k === 'object' ? k : null; };
  function installedGroups(K) {
    const open = new Set([CHATS, ...(pick?.includeOpen ? [] : openIds() || []), ...(pick?.exclude?.() || [])]);
    const of = k => k === 'apps' ? [...(K.apps || []), ...(K.dev || [])].sort((x, y) => (!!y.system - !!x.system) || String(x.name).localeCompare(String(y.name), undefined, { sensitivity: 'base' })) : K[k] || [];
    return KINDS.map(([k, label]) => [k, label, of(k).filter(a => a && a.id && !open.has(a.id) && matches(a, q))]);
  }
  let openFold = false, agentFold = false;   // Already open and For agents start folded to one line; a search shows their matches
  // level 3: in the App Store, not installed; tap = its Store page (Get there; it opens once installed)
  function getRow(a) {
    const b = el('button', 'vc-get', { type: 'button', role: 'listitem', 'data-store': a.id, 'aria-label': `Get ${a.name} from the App Store` });
    const words = el('span', 'vc-get-w'); words.append(el('b', 'vc-get-n', { text: a.name }), el('span', 'vc-get-s', { text: a.summary || 'In the App Store' }));
    b.append(tile(a, 'vc-tile vc-tile-s'), words, el('span', 'vc-get-b', { text: 'Get', 'aria-hidden': 'true' }));
    api.listen(b, 'click', () => { close(); if (!api.apps.get?.(a.id)) api.apps.openDesk('app-store'); });
    return b;
  }
  const section = (title, n) => { const h = el('h3', 'vc-sec-h'); h.append(el('span', '', { text: title }), ...(n != null ? [el('small', 'vc-count', { text: String(n) })] : [])); return h; };
  function paint() {
    if (!sheet || !body) return;
    const apps = api.apps.list(), open = openApps(apps, desks()).filter(a => matches(a, q)), K = kindsOf();
    const out = [];
    if (K) {
      // already open: one quiet folded row first (tap to see them, each with its ✕); while searching, its matches show
      if (open.length && !pick) {
        const shown = openFold || !!String(q).trim();
        const h = el('button', 'vc-fold' + (shown ? ' open' : ''), { type: 'button', 'aria-expanded': String(shown) });
        h.append(el('span', '', { text: 'Already open' }), el('small', 'vc-count', { text: String(open.length) }), icon('m6 9 6 6 6-6', 'vc-ico vc-chev'));
        api.listen(h, 'click', () => { openFold = !openFold; paint(); });
        out.push(h);
        if (shown) { const g = el('div', 'vc-list vc-list-open', { role: 'list', 'aria-label': 'Already open' }); g.append(...open.map(openTile)); out.push(g); }
      }
      const groups = installedGroups(K).filter(([, , l]) => l.length), searching = !!String(q).trim();
      const people = groups.filter(([k]) => !AGENT_KINDS.has(k)), agents = groups.filter(([k]) => AGENT_KINDS.has(k));
      const block = ([k, label, l], head) => { const g = el('div', 'vc-list', { role: 'list', 'aria-label': label, 'data-kind': k }); g.append(...l.map(row)); out.push(head(label, l.length), g); };
      // (the picker: one 'For people' section, open)
      if (pick && people.length) { const l = people.flatMap(([, , x]) => x); block(['apps', pick.people || 'For people', l], section); }
      else for (const gr of people) block(gr, section);
      if (agents.length) {
        const shown = agentFold || searching, n = agents.reduce((s, [, , l]) => s + l.length, 0);
        const h = el('button', 'vc-fold vc-fold-agents' + (shown ? ' open' : ''), { type: 'button', 'aria-expanded': String(shown) });
        h.append(el('span', '', { text: 'For agents' }), el('small', 'vc-count', { text: String(n) }), icon('m6 9 6 6 6-6', 'vc-ico vc-chev'));
        api.listen(h, 'click', () => { agentFold = !agentFold; paint(); });
        out.push(h);
        if (shown) for (const gr of agents) block(gr, (label, c) => { const s = section(label, c); s.classList.add('vc-sub-h'); return s; });
      }
      if (!groups.length) out.push(section(pick ? (pick.people || 'For people') : 'Installed', 0), el('p', 'vc-empty', { text: q ? 'No installed app by that name.' : pick ? 'Every installed app is pinned or open.' : 'Every installed app is open.' }));
      // the App Store: no list of everything you don't have (that is the Store's job); a search also looks there, and
      // one row opens the Store itself
      if (searching && store?.length) {
        // an app you already have under another Store id (a renamed Store listing) is not offered again
        const have = new Set([...api.apps.list(), ...Object.values(K).flat()].map(a => String(a?.name || '').trim().toLowerCase()).filter(Boolean));
        const hits = store.filter(a => matches(a, q) && !have.has(String(a.name || '').trim().toLowerCase()));
        if (hits.length) { const g = el('div', 'vc-rows', { role: 'list', 'aria-label': 'In the App Store' }); g.append(...hits.map(getRow)); out.push(section('In the App Store', hits.length), g); }
      }
      out.push(pick ? moreTile() : storeBtn('Get more apps in the App Store'));
      body.replaceChildren(...out);
      return;
    } else {
      const inst = list().filter(a => matches(a, q));
      if (pick) {
        out.push(section(pick.people || 'For people', inst.length));
        if (inst.length) { const g = el('div', 'vc-list', { role: 'list', 'aria-label': pick.people || 'For people', 'data-kind': 'apps' }); g.append(...inst.map(row)); out.push(g); }
        else out.push(el('p', 'vc-empty', { text: q ? 'No installed app by that name.' : 'Every installed app is pinned or open.' }));
        out.push(moreTile()); body.replaceChildren(...out); return;
      }
      if (open.length) { const g = el('div', 'vc-list', { role: 'list', 'aria-label': 'Open' }); g.append(...open.map(openTile)); out.push(section('Open', open.length), g); }
      out.push(section('Installed', inst.length));
      if (inst.length) { const g = el('div', 'vc-list', { role: 'list', 'aria-label': 'Installed' }); g.append(...inst.map(row)); out.push(g); }
      else out.push(el('p', 'vc-empty', { text: q ? 'No installed app by that name.' : 'Every installed app is open.' }));
    }
    out.push(section('Get more', store ? store.filter(a => matches(a, q)).length : null));
    if (storeErr) out.push(el('p', 'vc-empty', { text: 'The App Store can’t be reached right now.' }));
    else if (!store) out.push(el('p', 'vc-empty', { text: 'Looking in the App Store…' }));
    else {
      const hits = store.filter(a => matches(a, q));
      if (hits.length) { const g = el('div', 'vc-rows', { role: 'list', 'aria-label': 'Get more' }); g.append(...hits.map(getRow)); out.push(g); }
      else out.push(el('p', 'vc-empty', { text: q ? 'Nothing in the App Store by that name.' : 'You have every app in the App Store.' }));
    }
    const all = el('button', 'vc-store', { type: 'button', text: 'Browse the App Store' });
    api.listen(all, 'click', () => { close(); api.apps.openDesk('app-store'); });
    out.push(all);
    body.replaceChildren(...out);
  }
  const storeBtn = text => { const all = el('button', 'vc-store', { type: 'button', text }); api.listen(all, 'click', () => { close(); api.apps.openDesk('app-store'); }); return all; };
  // the picker's last tile: + Get more = the App Store as it is (its own installed / open states)
  function moreTile() {
    const g = el('div', 'vc-list vc-list-more', { role: 'list', 'aria-label': 'Get more' });
    const b = el('button', 'vc-app vc-more', { type: 'button', role: 'listitem', 'aria-label': 'Get more apps in the App Store' });
    const t = el('span', 'vc-tile vc-tile-plus', { 'aria-hidden': 'true' }); t.append(icon('M12 5v14M5 12h14', 'vc-ico'));
    b.append(t, el('span', 'vc-name', { text: 'Get more' }));
    api.listen(b, 'click', () => { close(); api.apps.openDesk('app-store'); });
    g.append(b); return g;
  }
  /** open(): the + sheet (Already open · Installed by kind · the App Store). open({ exclude, people }) (AI apps round 16):
   * the picker: only installed apps neither open nor in exclude() (his pins), 'For people' open, 'For agents' folded,
   * no Already open row, a + Get more tile last; nothing from the App Store listed in it. */
  function open(opts = null) {
    if (sheet) return;
    pick = opts && typeof opts === 'object' && !(typeof Event === 'function' && opts instanceof Event) && !opts.type ? opts : null;
    q = ''; store = null; storeErr = false; openFold = false; agentFold = false;
    sheet = el('div', 'vc-sheet' + (pick ? ' vc-pick' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': pick ? 'Add an app' : 'Apps' });
    const scrim = el('div', 'vc-scrim', { 'aria-hidden': 'true' });
    const card = el('div', 'vc-card');
    const head = el('div', 'vc-head');
    const find = el('label', 'vc-find');
    const field = el('input', 'vc-q', { type: 'search', placeholder: 'Search apps', 'aria-label': 'Search apps', autocomplete: 'off', enterkeyhint: 'search' });
    find.append(icon('M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20', 'vc-ico vc-find-i'), field);
    const shut = el('button', 'vc-x', { type: 'button', 'aria-label': 'Close' }); shut.append(icon('M6 6l12 12M18 6L6 18', 'vc-ico'));
    head.append(find, shut);
    body = el('div', 'vc-body');
    card.append(head, body); sheet.append(scrim, card);
    api.listen(scrim, 'click', close); api.listen(shut, 'click', close);
    api.listen(field, 'input', () => { q = field.value; paint(); });
    api.listen(field, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); body.querySelector('button:is(.vc-app, .vc-hit, .vc-get)')?.click(); } });
    offMount = api.mount(sheet);
    offBack = api.back?.push ? api.back.push(close) : null;
    root.dataset.vcSheet = 'open';
    paint();
    const mine = sheet;
    if (!pick) Promise.resolve(api.apps.store ? api.apps.store() : []).then(l => { if (sheet === mine) { store = l || []; paint(); } }, () => { if (sheet === mine) { storeErr = true; paint(); } });
    // the desktop types at once; the phone waits for a tap (no keyboard over the lists)
    if (shell === 'desktop') field.focus?.({ preventScroll: true }); else shut.focus?.({ preventScroll: true });
  }
  function close() {
    if (!sheet) return;
    const s = sheet; sheet = null; body = null; pick = null;
    offBack?.(); offBack = null; offMount?.(); offMount = null; s.remove();
    delete root.dataset.vcSheet;
  }
  /* ---------- an open app's menu: right-click (desktop) or a long press (phone) on its icon (Miguel, 2 Nov 2026) ----------
   * Open, or Close · stays installed: off the grid and stopped (its desk goes); the + opens it again. Two states only:
   * on the grid = running, otherwise installed. Chats never closes. */
  let menuEl = null, menuOff = null, menuUnmount = null;
  function menuClose() { if (!menuEl) return; const m = menuEl; menuEl = null; menuOff?.(); menuOff = null; menuUnmount?.(); menuUnmount = null; m.remove(); }
  // (extra: [[label, fn]…] first, e.g. Pin / Unpin; running: false = not open, no Close)
  function appMenu(a, x, y, { onOpen, onClosed, extra = null, running = null } = {}) {
    menuClose(); if (!a || !a.id || a.id === CHATS) return;
    const m = el('div', 'vc-menu', { role: 'menu', 'aria-label': a.name });
    const scrim = el('div', 'vc-menu-scrim', { 'aria-hidden': 'true' });
    const card = el('div', 'vc-menu-card');
    const item = (label, fn, cls = '') => { const b = el('button', 'vc-menu-i' + cls, { type: 'button', role: 'menuitem', text: label }); api.listen(b, 'click', () => { menuClose(); fn(); }); return b; };
    card.append(el('div', 'vc-menu-h', { text: a.name }), ...(extra || []).map(([label, fn]) => item(label, fn)), item('Open', () => onOpen?.()), ...(running === false ? [] : [item('Close · stays installed', () => { api.apps.close?.(a.id); onClosed?.(); }, ' is-close')]));
    m.append(scrim, card);
    api.listen(scrim, 'pointerdown', e => { e.preventDefault?.(); menuClose(); });
    api.listen(scrim, 'contextmenu', e => { e.preventDefault?.(); menuClose(); });
    api.listen(card, 'keydown', e => { const k = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (!k) return; e.preventDefault(); const bs = [...card.children].filter(n => n.tagName === 'BUTTON'), i = bs.indexOf(doc.activeElement); bs[(i + k + bs.length) % bs.length]?.focus(); });
    menuUnmount = api.mount(m); menuEl = m;
    menuOff = api.back?.push ? api.back.push(menuClose) : null;
    // at the pointer, kept on screen (the phone: centred under the finger)
    const W = globalThis.innerWidth || 0, H = globalThis.innerHeight || 0, w = card.offsetWidth || 200, h = card.offsetHeight || 120;
    card.style.left = Math.round(Math.max(8, Math.min((+x || 0) - (shell === 'phone' ? w / 2 : 0), W - w - 8))) + 'px';
    card.style.top = Math.round(Math.max(8, Math.min(+y || 0, H - h - 8))) + 'px';
    card.children[1]?.focus?.({ preventScroll: true });
  }
  /* Wire an icon: right-click, or a still press held HOLD ms, opens its menu; the click that ends a long press is eaten. */
  const HOLD = 520;
  function menuOn(b, a, opts) {
    if (!b || !a || a.id === CHATS) return;
    api.listen(b, 'contextmenu', e => { e.preventDefault(); const r = b.getBoundingClientRect(); appMenu(a, e.clientX || r.x + r.width / 2, e.clientY || r.y + r.height, opts); });
    if (shell !== 'phone') return;
    let p = null;
    api.listen(b, 'pointerdown', e => { if (e.button) return; const t = { x: e.clientX, y: e.clientY, fired: false }; p = t;
      t.cancel = api.after(HOLD, () => { if (p !== t) return; t.fired = true; const r = b.getBoundingClientRect(); appMenu(a, r.x + r.width / 2, r.y + r.height + 6, opts); }); });
    api.listen(b, 'pointermove', e => { if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { p.cancel?.(); p = null; } });
    const up = () => { if (p && !p.fired) p.cancel?.(); };
    api.listen(b, 'pointerup', up); api.listen(b, 'pointercancel', () => { p?.cancel?.(); p = null; });
    api.listen(b, 'click', e => { if (p?.fired) { e.preventDefault(); e.stopImmediatePropagation?.(); p = null; } }, true);
  }
  /** A + button (Apps: the grid's last tile; Orb: beside the Chats pill). */
  function plus(cls, label = 'Open an app', build = null) {
    const b = el('button', cls, { type: 'button', 'aria-label': label, title: label }), ico = icon('M12 5v14M5 12h14', 'vc-ico');
    if (build) build(b, ico, el); else b.append(ico);
    api.listen(b, 'click', open);
    return b;
  }

  return {
    plus, open, close, list, menuOn, appMenu, menuClose,
    get isOpen() { return !!sheet; },
    get closing() { return closing; },
    /** The view's own spot for the orb ({ x, y, d } viewport px: its composer's orb slot), or null; it wins over an app's. */
    orbIn(spot) { const s = spot && [spot.x, spot.y, spot.d].every(Number.isFinite) ? { x: +spot.x, y: +spot.y, d: +spot.d } : null; if (sameSpot(s, ownSpot)) return; ownSpot = s; placeOrb(); },
    /** The orb's own fixed spot (untransformed), whatever move is applied. */
    orbHome: home,
    dispose() { close(); menuClose(); offSwipes?.(); offInset?.(); ownSpot = appSpot = null; placeOrb(); glyph?.remove(); unmountCss(); css.remove(); delete root.dataset.viewChrome; },
  };
}
