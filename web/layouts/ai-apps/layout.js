/* AI apps view (Miguel, 2 Nov 2026). Worn by the miguel/ai-apps tweak, off by default; one shell view at a time (Orb,
 * Apps, AI apps; all off = Desks). Phone only for now: on the desktop it does nothing (the stock desktop stays).
 *
 * Copies the layout the ChatGPT, Claude and Perplexity phone apps share (measured references:
 * ~/.hermes/cache/screenshots/ai-apps-ref/REPORT.md, "Recommended spec", Mobile), with Wizard's own pieces in it:
 *   - Top bar, always there (an app open too): ☰ on the left opens the drawer and carries the Ready count (round 5:
 *     the number the orb used to wear, in Chats' amber); a small home button in the middle goes Home from anywhere, an
 *     app included (round 5: it replaced the Wizard's name); on the right, on Home only (round 5; never over a chat or
 *     an app), the workspace switcher, in the slot where they put Temporary / Incognito (this Wizard, then the Wizards
 *     he manages; Manage = Settings › Connections, where Add a Wizard lives).
 *   - Drawer from the left (☰, or a swipe from the left edge; a swipe right in a thread too, which keeps the chat
 *     under it and never also runs the thread swipe-back): the name and 🔍 (searches chats and apps), then where they list Projects / GPTs / Spaces
 *     a compact grid of EVERY open app (a small icon with its name under it, like ChatGPT's GPT grid; desk order, apps
 *     with a badge first as in the Orb view, the badge on the icon), ending in All apps = the three-level sheet (Open ·
 *     Installed · Get more, chrome.js); then the chats in Wizard's own sections (round 5, in place of Recents and View
 *     all: the drawer IS the chat list), in the stock Chats order Archive, Working, Ready, each header like their
 *     Recents label and a tap folds it (Ready open, Working and Archive folded at first; kept on this device). A long
 *     press on a row opens the row menu: Pin, Rename, Mark unread, Snooze, Archive / Restore, through Chats' own
 *     actions. At the foot (round 2): New chat = a big round + where ChatGPT puts its compose button, Settings = a cog.
 *   - Home = a New chat (round 4, Miguel): the empty chat with no greeting, only the skin's background, the composer
 *     and the dock orb under it; typing there starts a new chat, so Home and New chat are one screen. Ways back to it
 *     from anywhere: the home button in the top bar, the drawer's round +. A swipe up on the orb (round 5) opens the same
 *     New chat with the cursor in the composer (the keyboard up): tap the orb to talk, swipe it up to type.
 *   - Main screen = the real Chats window, without its list (the list lives in the drawer): Home (a New chat) or the
 *     thread picked, with the real composer: + (attach) on the left, the model chip, the mic (dictation), and the round
 *     Send only while there are words (like ChatGPT). Talking is the orb's: the dock orb keeps its one spot, bottom
 *     centre, under the composer (tap talks, hold gives a command, exactly as in every view); while the field is being
 *     typed in, the orb steps aside and the composer drops to the bottom. A take shows the stock voice controls.
 *   - An app = its desk, filling the screen under the same top bar, with the orb bar at the bottom: the dock orb in its
 *     one fixed spot, bottom centre, and the app's own tabs (if it has a bottom tab bar) split either side of it
 *     (chrome.js inset → skin-host's orb bar).
 * Shapes (round 2, measured on the native apps): round discs for the top-bar buttons, a 16 px end radius on the drawer,
 * 12 px row pills, 18 px menus, 28 px sheets, full pills for the composer, search and chips; icons as rounded squares.
 * Every list comes from the shell (open apps = desks, the same as the Apps view's icons and the Orb's satellites;
 * chats = Chats' own Working / Ready), so switching views loses nothing. Colours are skin tokens (layout.css). */
import { viewChrome, openApps, realApps, matches, CHATS } from '../apps/chrome.js';
import { glyphOf, colourOf } from '../orb/shared.js';

// one icon set and one row-menu order with the desktop sidebar (parts.js); the desktop has its own screen (desktop.js)
import { ICON, ACTS, SVG, initial, sectionsFor, archiveTop, KINDS, EMPTY, sectionsOpen, gridSlot, gaugeInto, fuelOf,
  pinsFrom, togglePin, appLayers, orderOpen, homeDrop, tidyPlan, seedUsed, tidyWords, TIDY, TIDY_DEFAULT, tidyLine, tidySentence,
  READY_SORTS, sortOf, PRIORITY_TIP, readySort } from './parts.js';
import { homeView } from './home.js';

const LONG_PRESS = 450;     // ms, a still press on a chat row opens its menu
const EDGE = 24;            // px from the left edge where a swipe opens the drawer

export default function setup(api) {
  // the desktop's entry is desktop.js (core/skin-host.js files.desktop): this file is the phone's only
  if (api.env.shell !== 'phone') return () => {};
  const doc = document, root = doc.documentElement;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = (name, cls = 'aa-ico') => {
    const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
    for (const d of ICON[name] || []) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  };
  const desks = () => (api.desks?.list || api.phone.desks)();
  root.dataset.aiApps = 'on';

  // the + sheet in three levels, the dock without its desk switcher, the orb's swipes (up = Home, here the chat) and
  // room under every hosted app for the floating orb: the Orb and Apps views' own chrome, so all three agree
  // (round 5: a swipe up on the orb is a New chat with the keyboard up here, 'new', not Home)
  // (round 6: the orb wears a small microphone, the orb IS the microphone)
  const chrome = viewChrome(api, { openIds: () => desks().map(d => d.id), swipes: { up: 'new', side: null, down: null }, micGlyph: true });

  /* ---------- data ---------- */
  let sessions = null, badgeMap = api.apps.badges(m => { badgeMap = m; paintBadges(); });
  const agentName = () => (api.agents.list().find(a => a.main) || {}).label || (api.workspaces?.list()[0] || {}).name || 'Wizard';
  const readSessions = () => { sessions = api.sessions.list() || { working: [], snoozed: [], ready: [], archive: [] }; return sessions; };

  /* ---------- the top bar ---------- */
  const top = el('header', 'aa-top');
  const menuBtn = el('button', 'aa-tb aa-menu', { type: 'button', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'aa-drawer' });
  // the Ready count on ☰ (round 5, Miguel: a dot with no number said nothing; the orb no longer wears it here)
  const menuCount = el('b', 'aa-count', { 'aria-hidden': 'true' }); menuCount.hidden = true;
  menuBtn.append(icon('menu'), menuCount);
  // Home: a small home button in the middle (round 5, in place of the Wizard's name), from a thread or inside an app
  const mid = el('button', 'aa-tb aa-home', { type: 'button', 'aria-label': 'Home', title: 'Home' });
  mid.append(icon('home'));
  // (round 7: the workspace switcher moved to the drawer's header, in place of the name, as on the desktop)
  top.append(menuBtn, mid);
  api.mount(top);

  /* ---------- the drawer ---------- */
  const layer = el('div', 'aa-layer'); layer.hidden = true;
  const scrim = el('div', 'aa-scrim', { 'aria-hidden': 'true' });
  const drawer = el('nav', 'aa-drawer', { id: 'aa-drawer', 'aria-label': 'Menu' });
  const head = el('div', 'aa-dh');
  // round 7 (Miguel): the workspace switcher IS the drawer's header: this Wizard's name (a small disc, a chevron); a tap
  // opens the switcher sheet
  const wsBtn = el('button', 'aa-dws', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  const wsDisc = el('span', 'aa-ws-i', { 'aria-hidden': 'true' }), wsName = el('span', 'aa-word');
  wsBtn.append(wsDisc, wsName, icon('down', 'aa-ico aa-dws-c'));
  const findBtn = el('button', 'aa-tb aa-find', { type: 'button', 'aria-label': 'Search chats and apps' }); findBtn.append(icon('search'));
  const searchBox = el('label', 'aa-search'); searchBox.hidden = true;
  const field = el('input', 'aa-q', { type: 'search', placeholder: 'Search chats and apps', 'aria-label': 'Search chats and apps', autocomplete: 'off', enterkeyhint: 'search' });
  searchBox.append(icon('search', 'aa-ico aa-search-i'), field);
  const cancelBtn = el('button', 'aa-cancel', { type: 'button', text: 'Cancel' }); cancelBtn.hidden = true;
  head.append(wsBtn, findBtn, searchBox, cancelBtn);
  const scroll = el('div', 'aa-scroll');
  // the foot: New chat = a big round + (ChatGPT's compose spot, bottom left), Settings = a cog (bottom right); icons only
  const foot = el('div', 'aa-foot');
  const newBtn = el('button', 'aa-new', { type: 'button', 'aria-label': 'New chat', title: 'New chat' }); newBtn.append(icon('plus'));
  const setBtn = el('button', 'aa-set', { type: 'button', 'aria-label': 'Settings', title: 'Settings' }); setBtn.append(icon('cog'));
  // round 7: the cog on the left, the AI fuel gauge between, + on the right (as on the desktop)
  const fuel = el('div', 'aa-fuel', { 'data-fuel-copy': '' }); fuel.hidden = true;
  foot.append(setBtn, fuel, newBtn);
  drawer.append(head, scroll, foot);
  layer.append(scrim, drawer);
  api.mount(layer);

  /* ---------- Home: the app grid above the composer (home.js; round 19 item 4: the pins in a dock above the composer,
   * the grid = the open apps not pinned, then +) ----------
   * Round 16 item 7 (Miguel, 3 Nov 2026): the desktop's app model. Pinned (his pin order, open or not; hold and drag to
   * rearrange), then 'Open' (the open apps not pinned, auto-tidy), then + (the picker of installed apps neither pinned
   * nor open, + Get more = the App Store). Pins, his open-apps order flag and tidy are kept per device (api.storage),
   * the same keys the desktop uses. */
  const installedIds = () => api.apps.list().filter(a => a && a.id && a.id !== CHATS).map(a => a.id);
  let pinsStored = api.storage.get('pins');
  const pinsNow = () => pinsFrom(Array.isArray(pinsStored) ? pinsStored : null, installedIds());
  const setPins = list => { pinsStored = list; api.storage.set('pins', list); home.paint(true); };
  const mainDesk = () => desks().find(d => d.id === CHATS)?.desk ?? null;
  // round 19 item 4: the grid's open apps in his own order once he has dragged them there (kept per device)
  const layersNow = () => { const L0 = appLayers(desks(), pinsNow(), { main: mainDesk(), lit: id => lit(id), manual: api.storage.get('vtManual') === true, chats: CHATS }); return { ...L0, open: orderOpen(L0.open, api.storage.get('homeOpen')) }; };
  /** a drop on Home (round 19 item 4): within the dock, within the grid, or across (into the dock pins, out unpins) */
  function homeMove(item, to) {
    const pins = pinsNow(), open = layersNow().open.map(d => d.id), r = homeDrop(pins, open, item, to);
    api.storage.set('homeOpen', r.open);
    if (r.pins.join() !== pins.join()) setPins(r.pins); else home.paint(true);
  }
  function appMenuFor(a, at) {
    const pins = pinsNow(), pinned = pins.includes(a.id), running = desks().some(d => d.id === a.id), i = pins.indexOf(a.id);
    const extra = [[pinned ? 'Unpin' : 'Pin', () => setPins(togglePin(pins, a.id))]];
    if (pinned && i > 0) extra.push(['Move up', () => { const l = pins.filter(x => x !== a.id); l.splice(i - 1, 0, a.id); setPins(l); }]);
    if (pinned && i < pins.length - 1) extra.push(['Move down', () => { const l = pins.filter(x => x !== a.id); l.splice(i + 1, 0, a.id); setPins(l); }]);
    if (api.apps.homeScreen?.can?.(a.id)) extra.push(['Add to Home Screen', () => api.apps.homeScreen.offer(a.id)]);
    chrome.appMenu({ id: a.id, name: a.name }, at.x, at.y, { extra, running, onOpen: () => goApp(a.id, a.desk ?? null), onClosed: () => api.after(120, () => home.paint(true)) });
  }
  /* round 18 (Miguel, 3 Nov 2026): the tidy setting on the phone too, at Home's end under +: a small muted line
   * 'Unused apps close after 24h · Change' opening a small sheet with the desktop's sentence (parts.js tidySentence) */
  const tidyKey = () => { const k = api.storage.get('tidy'); return Object.prototype.hasOwnProperty.call(TIDY, k) ? k : TIDY_DEFAULT; };
  const tidyFoot = el('button', 'ah-tidy', { type: 'button', 'aria-haspopup': 'dialog' });
  const tidyFootW = el('span', 'ah-tidy-w');
  tidyFoot.append(tidyFootW, el('span', 'ah-tidy-c', { text: 'Change' }));
  const paintTidyFoot = () => { const k = tidyKey(); tidyFootW.textContent = tidyLine(k) + ' · '; tidyFoot.setAttribute('aria-label', `${tidyLine(k)}. Change`); };
  paintTidyFoot();
  let tsheet = null, offTsheetBack = null;
  function closeTidySheet() { if (!tsheet) return; tsheet.remove(); tsheet = null; offTsheetBack?.(); offTsheetBack = null; tidyFoot.setAttribute('aria-expanded', 'false'); }
  function openTidySheet() {
    if (tsheet) return;
    tsheet = el('div', 'aa-sheet aa-tsheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tidy up' });
    const sc = el('div', 'aa-sh-scrim', { 'aria-hidden': 'true' }), card = el('div', 'aa-sh-card');
    const hd = el('div', 'aa-sh-head'); const x = el('button', 'aa-tb aa-sh-x', { type: 'button', 'aria-label': 'Close' }); x.append(icon('x'));
    hd.append(el('h3', 'aa-sh-t', { text: 'Tidy up' }), x);
    const body = el('div', 'aa-sh-body');
    body.append(tidySentence(doc, tidyKey(), k => { api.storage.set('tidy', k); paintTidyFoot(); }, 'aa-tidys'));
    card.append(el('i', 'aa-sh-grip', { 'aria-hidden': 'true' }), hd, body);
    tsheet.append(sc, card); api.mount(tsheet);
    api.listen(sc, 'click', closeTidySheet); api.listen(x, 'click', closeTidySheet);
    offTsheetBack = api.back.push(closeTidySheet); tidyFoot.setAttribute('aria-expanded', 'true');
  }
  api.listen(tidyFoot, 'click', openTidySheet);
  const home = homeView(api, { goApp: (id, desk) => goApp(id, desk), getMore: () => api.apps.openDesk('app-store'), lit: id => lit(id), badgeText: id => badgeText(id), desks,
    layers: { model: layersNow, plus: () => chrome.open({ exclude: () => pinsNow(), people: 'For people' }), menu: appMenuFor, foot: tidyFoot,
      drop: homeMove } });
  api.mount(home.el);
  /* auto-tidy on the phone too (the desktop's rule and setting): open apps not pinned and unused longer than the Tidy
   * setting close by themselves (the stock close), with a toast; round 18: with Undo, as on the desktop */
  let used = seedUsed(api.storage.get('used') || {}, desks(), Date.now());
  api.storage.set('used', used);
  let usedAt = 0;
  function markUsed(r) { const d = desks().find(x => x.desk === r?.desk); if (!d || d.id === CHATS || r.home) return; const now = Date.now(); used = { ...used, [d.id]: now }; if (now - usedAt > 60e3) { usedAt = now; api.storage.set('used', used); } }
  const toast = el('div', 'ah-toast', { role: 'status' }); toast.hidden = true;
  const toastW = el('span', 'ah-toast-w'), toastU = el('button', 'ah-toast-u', { type: 'button', text: 'Undo' });
  toast.append(toastW, toastU); api.mount(toast);
  let toastOff = null, undoIds = [];
  function showToast(text, undo) {
    toastW.textContent = text; undoIds = undo || []; toastU.hidden = !undoIds.length; toast.hidden = false;
    toastOff?.(); toastOff = api.after(8000, () => { toast.hidden = true; toastOff = null; });
  }
  api.listen(toastU, 'click', () => {
    toast.hidden = true; toastOff?.(); toastOff = null;
    const ids = undoIds; undoIds = []; const now = Date.now();
    for (const id of ids) { used = { ...used, [id]: now }; api.apps.openDesk(id); }
    api.storage.set('used', used);
    goHome(); api.after(120, () => home.paint(true));
  });
  function tidy() {
    const key = tidyKey(), now = Date.now();
    used = seedUsed(used, desks(), now); api.storage.set('used', used);
    const plan = tidyPlan(desks(), { pins: pinsNow(), used, now, limit: TIDY[key], keep: [api.route().desk].filter(x => x != null) });
    if (!plan.length) return [];
    const ids = [...new Set(plan.map(d => d.id))];
    for (const id of ids) api.apps.close?.(id);
    showToast(tidyWords(ids.length, key), ids);
    api.after(120, () => home.paint(true));
    return plan;
  }
  let tidyOff = null;
  // api.after caps a timer at 10 s: wake on that beat and tidy only once the hour is up
  let tidyAt = Date.now() + 3600e3;
  const tidyLoop = () => { tidyOff = api.after(10e3, () => { if (Date.now() >= tidyAt) { tidyAt = Date.now() + 3600e3; tidy(); } tidyLoop(); }); };
  api.after(6000, tidy); tidyLoop();

  // round 18 item 3: Ready's order = the stock Chats Filter's saved choice (api.sessions.order), so both views agree
  const readyOrder = () => sortOf(api.sessions.order?.() || 'priority');
  api.listen(globalThis, 'wos:prefs', () => { if (open) paintDrawer(); });
  let open = false, offBack = null, q = '';
  // which sections are open (Ready open, Working and Archive folded at first), kept on this device
  const secOpen = sectionsOpen(api.storage.get('sections'));
  // Shell sheets own interaction while Chats prepares behind a Look toggle. A
  // thread → list route is not an owner request to put the drawer over Settings.
  const shellSheetOpen = () => !!doc.querySelector('.sheet-open');
  function openDrawer() {
    if (open || shellSheetOpen()) return; open = true; closeMenu();
    readSessions(); paintDrawer(true);
    layer.hidden = false; layer.classList.remove('is-drag'); drawer.style.removeProperty('transform'); scrim.style.removeProperty('opacity');
    api.frame(() => layer.classList.add('is-open'));
    api.aiUsage?.live?.(foot);  // the fuel gauge's feed: watched only once the foot is on screen
    root.dataset.aaDrawer = 'open'; menuBtn.setAttribute('aria-expanded', 'true');
    offBack = api.back.push(closeDrawer);
  }
  function closeDrawer() {
    if (!open) return; open = false; closeMenu();
    offBack?.(); offBack = null;
    layer.classList.remove('is-open', 'is-drag'); drawer.style.removeProperty('transform'); scrim.style.removeProperty('opacity');
    delete root.dataset.aaDrawer; menuBtn.setAttribute('aria-expanded', 'false');
    if (q) setSearch(false);
    api.after(220, () => { if (!open) layer.hidden = true; });
  }
  function setSearch(on) {
    searchBox.hidden = cancelBtn.hidden = !on; wsBtn.hidden = findBtn.hidden = on;
    if (!on) { q = ''; field.value = ''; }
    paintDrawer();
    if (on) field.focus?.({ preventScroll: true });
  }
  api.listen(menuBtn, 'click', () => (open ? closeDrawer() : openDrawer()));
  api.listen(scrim, 'click', closeDrawer);
  api.listen(findBtn, 'click', () => setSearch(true));
  api.listen(cancelBtn, 'click', () => setSearch(false));
  api.listen(field, 'input', () => { q = field.value; paintDrawer(); });
  // A channel's feed in front: its own box takes the new chat (issue 1291); the drawer closes so the box is in view.
  api.listen(newBtn, 'click', () => { if (api.sessions.channelPost?.()) { closeMenu(); closeSheet(); closeDrawer(); } else goHome(); });
  api.listen(mid, 'click', goHome);
  api.listen(setBtn, 'click', () => { closeDrawer(); api.desk.settings(); });
  // the cog's count (System notices set to Badge, …): the same WosBell.attention the phone's gear and the desktop's cog show
  const setCount = el('b', 'aa-count aa-setn', { 'aria-hidden': 'true' }); setCount.hidden = true; setBtn.append(setCount);
  const paintCog = at => { const n = at?.n | 0; setCount.textContent = !n ? '' : n > 99 ? '99+' : String(n); setCount.hidden = !n; setBtn.setAttribute('aria-label', n ? `Settings, ${n} ${at.label}` : 'Settings'); };
  paintCog(api.desk.attention?.(paintCog));

  /* rows: an app (its logo, else the dock's own mark for it), a chat (Working spinner / Ready dot, title, pin) */
  // round 6: the app's own icon filling its tile like an iPhone icon (its sigil on a tile tinted by its colour, or its
  // picture logo edge to edge), never a small mark on a grey plate
  const metaOf = id => api.apps.list().find(a => a.id === id) || desks().find(d => d.id === id) || { id, name: id };
  function appTile(id) {
    const a = metaOf(id), t = el('span', 'aa-tile', { 'aria-hidden': 'true' });
    t.style.setProperty('--c', colourOf(a));
    t.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    api.apps.logo(id).then(url => {
      if (!url || !t.isConnected) return;
      const im = el('img', 'aa-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { t.replaceChildren(im); t.classList.add('is-logo'); }, () => {});
    });
    return t;
  }
  // the badge as the shell shows it (50+ for an app that lists only its newest items), else the count
  const badgeText = id => { const n = badgeMap[id] || 0; if (!n) return ''; const t = api.apps.badgeText?.(id); return t || (n > 99 ? '99+' : String(n)); };
  const lit = id => (badgeMap[id] || 0) > 0;
  /* the open apps as a grid of small icons with their names under them; badged apps first (the Orb view's rule), then
   * the rest, each in desk order */
  const litFirst = list => [...list.filter(a => lit(a.id)), ...list.filter(a => !lit(a.id))];
  function appCell(a, go) {
    const b = el('button', 'aa-gi aa-app', { type: 'button', role: 'listitem', 'data-app': a.id, title: a.name });
    const ic = el('span', 'aa-gt'), n = el('b', 'aa-badge', { 'data-badge': a.id, 'aria-hidden': 'true', text: badgeText(a.id) }); n.hidden = !n.textContent;
    ic.append(appTile(a.id), n);
    b.append(ic, el('span', 'aa-gn', { text: a.name }));
    b.setAttribute('aria-label', a.name + (n.textContent ? `, ${n.textContent} new` : ''));
    api.listen(b, 'click', () => { closeDrawer(); go(); });
    return b;
  }
  function plainCell(cls, ico, label, go) {
    const b = el('button', 'aa-gi ' + cls, { type: 'button', role: 'listitem', 'aria-label': label });
    const ic = el('span', 'aa-gt'), t = el('span', 'aa-tile is-plain', { 'aria-hidden': 'true' }); t.append(icon(ico)); ic.append(t);
    b.append(ic, el('span', 'aa-gn', { text: label, 'aria-hidden': 'true' }));
    api.listen(b, 'click', () => { closeDrawer(); go(); });
    return b;
  }
  const grid = (label, cells) => { const g = el('div', 'aa-grid', { role: 'list', 'aria-label': label }); g.append(...cells); return g; };
  // round 12: a Home icon is a desk: that desk (a second Chats desk too); a search hit: its app's first desk
  const goApp = (id, desk = null) => { const d = (desk != null && desks().find(x => x.desk === desk && x.id === id)) || desks().find(x => x.id === id); if (d) api.nav.goDesk(d.desk); else api.apps.openDesk(id); };
  /* round 21 (Miguel, 4 Nov 2026): every open the shell starts by itself follows the view. An app (a notification's
   * Open, a chat's app button) or a link an app owns = that app full screen, its one window reused and taken to the page;
   * no view opens beside a thread by itself. A Reply / a chat an app starts opens the chat, and Back returns to the app
   * (while that chat is in front). Links no app owns keep the stock page with its own Back. */
  let backOff = null, backDesk = -1, draftWant = false;   // draftWant: the new chat in front holds an app's Reply (a chat, never Home)
  const dropBack = () => { backOff?.(); backOff = null; backDesk = -1; };
  api.apps.routeOpens?.({
    open(kind, d, go) {
      if (kind === 'beside') return true;
      if (kind === 'app' || (kind === 'link' && d.app)) {
        const id = kind === 'app' ? d.id : d.app, path = kind === 'app' ? d.path : d.url;
        if (!id || id === CHATS) return false;
        closeMenu(); closeSheet(); closeDrawer(); dropBack();
        goApp(id); if (path) api.apps.path(id, path); return true;
      }
      if (kind === 'draft' || kind === 'thread') {
        closeMenu(); closeSheet(); closeDrawer(); dropBack();
        let ok = false; try { ok = !!go(); } catch (_) { ok = false; }
        if (ok && d.from) { const from = d.from; backDesk = api.route().desk; backOff = api.back.push(() => { backOff = null; backDesk = -1; goApp(from); }); }
        if (ok && kind === 'draft') { draftWant = true; paintTop(); }
        return true;
      }
      return false;
    },
  });
  function chatRow(s, here) {
    const b = el('button', 'aa-row aa-chat', { type: 'button', 'data-sid': s.id, 'data-kind': s.kind, ...(s.id === here ? { 'aria-current': 'page' } : {}) });
    // plain titles like theirs; a pin, then the state at the end only when there is one (Working turns, Ready new = a dot);
    // a notification (round 5) is the same row with a small bell before its title, nothing yellow
    if (s.note) { b.dataset.note = ''; b.append(icon('bell', 'aa-ico aa-bell')); }
    b.append(el('span', 'aa-row-t', { text: s.title }));
    if (s.pinned) b.append(icon('pin', 'aa-ico aa-pin'));
    if (s.kind === 'working' || (s.kind === 'ready' && s.unread)) b.append(el('i', 'aa-st' + (s.kind === 'working' ? '' : ' is-new'), { 'aria-hidden': 'true' }));
    b.setAttribute('aria-label', `${s.note ? 'Notification: ' : ''}${s.title}${s.kind === 'working' ? ', working' : s.kind === 'snoozed' ? ', snoozed' : s.unread ? ', ready, new' : s.snoozed && s.note ? ', snoozed' : s.kind === 'ready' ? ', ready' : ''}${s.pinned ? ', pinned' : ''}`);
    pressable(b, s);
    return b;
  }
  const label = (text, cls = '') => el('h3', 'aa-lab' + (cls ? ' ' + cls : ''), { text });
  let drawn = '';
  function paintDrawer(force = false) {
    if (!open) return;
    paintWs(); paintFuel();
    const here = api.route().thread, out = [], s = sessions || readSessions();
    const apps = api.apps.list(), dk = desks();
    // repaint only when what it lists changed (renders come often while a chat is working; a row under a finger stays)
    const sig = JSON.stringify([q, archiveTop(root), here, secOpen, api.sessions.workingOrder?.(), readyOrder(), dk.map(d => d.id + d.desk + (lit(d.id) ? '*' : '')), apps.length, KINDS.map(k => (s[k] || []).map(r => [r.id, r.title, r.unread, r.pinned, r.state || '', r.at || '', r.actions.join()]))]);
    if (!force && sig === drawn && scroll.childElementCount) return;
    drawn = sig;
    if (q) {
      const hitsA = apps.filter(a => a.id !== CHATS && !a.agent && !a.connector && !a.dev && matches(a, q));
      const seen = new Set(), hitsC = KINDS.flatMap(k => s[k] || []).filter(r => !seen.has(r.id) && seen.add(r.id) && matches({ name: r.title }, q));
      if (hitsA.length) out.push(label('Apps'), grid('Apps', hitsA.map(a => appCell(a, () => goApp(a.id)))));
      if (hitsC.length) out.push(label('Chats'), ...hitsC.map(r => chatRow(r, here)));
      if (!hitsA.length && !hitsC.length) out.push(el('p', 'aa-empty', { text: 'No chat or app by that name.' }));
    } else {
      // the drawer is the chat list only (Miguel, 2 Nov 2026: the apps live on Home now; a search still finds them)
      // Wizard's own sections in place of Recents (round 5): Working, Ready, Archive last (archive-top: first), each folding under its header
      for (const [k, word0] of sectionsFor(root)) {
        // round 18 item 3a: Ready in the stock Chats Filter's order (Priority / Newest / Oldest), notifications among it
        const rows = k === 'working' ? globalThis.WizChatsListModel.workingSort(s[k], api.sessions.workingOrder?.()) : k === 'ready' ? readySort(s[k] || [], readyOrder()) : s[k] || [], on = !!secOpen[k];
        const h = el('button', 'aa-lab aa-sec', { type: 'button', 'data-sec': k, 'aria-expanded': String(on), 'aria-controls': 'aa-sec-' + k });
        h.append(el('span', '', { text: word0 }), icon('down', 'aa-ico aa-sec-c'));
        // folded (round 7): a minimal tally: Working its count with a tiny spinner, Ready its count
        // Ready counts unread only (James, 8 Nov 2026); Working and Snoozed keep their place counts.
        const tallyN = k === 'ready' ? globalThis.WizChatsListModel.unreadCount(rows) : rows.length;
        if (!on && k !== 'archive' && tallyN) { h.append(el('span', 'aa-tally', { 'data-n': String(tallyN), 'aria-hidden': 'true' })); h.setAttribute('aria-label', `${word0}, ${tallyN}${k === 'ready' ? ' unread' : ''}, folded`); }
        api.listen(h, 'click', () => { secOpen[k] = !secOpen[k]; api.storage.set('sections', { ...secOpen }); paintDrawer(true); });
        const body = el('div', 'aa-sec-b', { id: 'aa-sec-' + k, role: 'group', 'aria-label': word0 }); body.hidden = !on;
        if (on) {
          if (rows.length) body.append(...rows.map(r => chatRow(r, here)));
          else body.append(el('p', 'aa-empty', { text: !sessions ? 'Loading your chats…' : EMPTY[k] }));
        }
        if (k === 'ready') {
          const row = el('div', 'aa-sech'), sort = el('select', 'aa-sort', { 'aria-label': 'Order Ready', title: `${PRIORITY_TIP}\nThe same choice as Chats' own Filter.` });
          for (const [v, w0] of READY_SORTS) { const o = el('option', '', { value: v, text: w0 }); if (v === readyOrder()) o.setAttribute('selected', ''); sort.append(o); }
          sort.value = readyOrder();
          api.listen(sort, 'change', () => { api.sessions.setOrder?.(sort.value); paintDrawer(true); });
          row.append(h, sort); out.push(row, body);
        } else if (k === 'working') {
          const row = el('div', 'aa-sech'), sort = el('select', 'aa-sort', { 'aria-label': 'Sort Working' });
          for (const [v, word] of globalThis.WizChatsListModel.WORKING_SORTS) sort.append(el('option', '', { value: v, text: word }));
          sort.value = api.sessions.workingOrder?.() || 'alphabetical';
          api.listen(sort, 'change', () => { api.sessions.setWorkingOrder?.(sort.value); paintDrawer(true); });
          row.append(h, sort); out.push(row, body);
        } else out.push(h, body);
      }
    }
    scroll.replaceChildren(...out);
  }
  function paintBadges() {
    home.paint();
    if (open) paintDrawer();   // a badge that comes or goes reorders the grid (badged first); the signature skips the rest
    for (const n of scroll.querySelectorAll('[data-badge]')) {
      n.textContent = badgeText(n.dataset.badge); n.hidden = !n.textContent;
      const b = n.closest('.aa-gi'), nm = b?.querySelector('.aa-gn')?.textContent || '';
      if (b && nm) b.setAttribute('aria-label', nm + (n.textContent ? `, ${n.textContent} new` : ''));
    }
    const unread = badgeMap[CHATS] || 0, rt = unread ? (api.apps.badgeText?.(CHATS) || (unread > 99 ? '99+' : String(unread))) : '';
    menuCount.textContent = rt; menuCount.hidden = !unread;
    menuBtn.setAttribute('aria-label', unread ? `Open menu, ${rt} unread` : 'Open menu');
  }

  /* ---------- a chat row: tap opens it; a long press (or right click) opens its menu ---------- */
  let press = null, swallow = 0;
  function pressable(b, s) {
    api.listen(b, 'pointerdown', e => {
      if (e.button > 0) return;
      const p = { x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
      p.off = api.after(LONG_PRESS, () => { if (press !== p) return; p.done = true; press = null; swallow = Date.now() + 700; openMenu(b, s); });
      press = p;
    });
    api.listen(b, 'pointermove', e => { if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { press.off(); press = null; } });
    const end = () => { if (press) { press.off(); press = null; } };
    api.listen(b, 'pointerup', end); api.listen(b, 'pointercancel', end);
    api.listen(b, 'contextmenu', e => { e.preventDefault(); end(); swallow = Date.now() + 400; openMenu(b, s); });
    api.listen(b, 'click', e => { if (Date.now() < swallow) { e.preventDefault(); return; } closeDrawer(); api.sessions.open(s.id); });
  }
  let menu = null, offMenuBack = null;
  function openMenu(row, s) {
    closeMenu();
    const acts = ACTS.filter(([k]) => (s.actions || []).includes(k));
    if (!acts.length) return;
    const box = el('div', 'aa-menu-layer');
    const shade = el('div', 'aa-menu-scrim', { 'aria-hidden': 'true' });
    const card = el('div', 'aa-pop', { role: 'menu', 'aria-label': s.title });
    for (const [k, word0] of acts) {
      const w = k === 'pin' && s.pinned ? 'Unpin' : word0;
      const it = el('button', 'aa-pop-i' + (k === 'done' ? ' is-file' : ''), { type: 'button', role: 'menuitem', 'data-act': k });
      it.append(icon(k), el('span', '', { text: w }));
      api.listen(it, 'click', () => { if (Date.now() < swallow) return; closeMenu(); if (k === 'rename' || k === 'move') closeDrawer(); api.sessions.act(s.id, k); api.after(120, () => { readSessions(); paintDrawer(); }); });
      card.append(it);
    }
    box.append(shade, card);
    drawer.append(box);
    // under the row, right-aligned in the drawer (above it when the row sits low), like their popovers
    const dr = drawer.getBoundingClientRect(), rr = row.getBoundingClientRect(), h = acts.length * 48 + 12;
    const below = rr.bottom - dr.top + 4, above = rr.top - dr.top - h - 4;
    card.style.top = Math.max(8, below + h > dr.height - 8 ? above : below) + 'px';
    api.listen(shade, 'click', () => { if (Date.now() >= swallow) closeMenu(); });   // not the lift of the press that opened it
    api.listen(shade, 'pointerdown', e => e.preventDefault());
    menu = box; row.classList.add('is-held');
    offMenuBack = api.back.push(closeMenu);
    api.after(0, () => card.querySelector('button')?.focus?.({ preventScroll: true }));
  }
  function closeMenu() {
    if (!menu) return;
    menu.remove(); menu = null; offMenuBack?.(); offMenuBack = null;
    for (const r of scroll.querySelectorAll('.is-held')) r.classList.remove('is-held');
  }

  /* ---------- open the drawer with a swipe: from the left edge anywhere, or rightwards anywhere in a chat ----------
   * Once recognised, the swipe is the drawer's alone (Miguel, 2 Nov 2026: a swipe from the left of a chat also ran the
   * thread swipe-back, which left the chat for a New chat under the drawer): it claims the finger (api.gesture.claim:
   * the dock swipe and the row long-press stand down) and keeps its touches from the chat below, where the thread
   * swipe-back listens, so the chat stays as it was. It is recognised before the swipe-back would follow the finger
   * (16 px sideways vs its 24). Touch events, like the swipe-back, so a list starting to scroll never cancels it; code,
   * tables, the composer and fields keep their own sideways gestures. Back (the button) still steps a thread back. */
  const OWN_SIDEWAYS = 'pre, table, [data-part="composer"], .ch-compose, .ms-track, input, textarea, [contenteditable="true"]';
  let drag = null, touchPid = null;
  const W = () => drawer.getBoundingClientRect().width || 300;
  api.listen(doc, 'pointerdown', e => { if (e.pointerType === 'touch' && e.isPrimary !== false) touchPid = e.pointerId; }, true);
  api.listen(doc, 'touchstart', e => {
    drag = null;
    if (open || menu || sheet || shellSheetOpen() || root.dataset.vcSheet || e.touches.length !== 1) return;
    const t = e.touches[0], tg = e.target;
    // under the top bar only, never from the composer (its + sits at the edge), the dock or a sheet
    if (t.clientY <= top.getBoundingClientRect().bottom || tg?.closest?.('.ch-compose, #dock, .aa-sheet, .vc-sheet')) return;
    const edge = t.clientX <= EDGE;
    const inChat = !edge && root.dataset.aiFront === 'chat' && api.route().view === 'thread' && !tg?.closest?.(OWN_SIDEWAYS)
      && !String(globalThis.getSelection?.() || '');
    if (edge || inChat) drag = { x: t.clientX, y: t.clientY, at: performance.now(), on: false, edge };
  }, { capture: true, passive: true });
  api.listen(doc, 'touchmove', e => {
    if (!drag) return;
    if (shellSheetOpen()) { settle(false); drag = null; return; }
    const t = e.touches[0];
    if (!t || e.touches.length !== 1) { if (drag.on) settle(false); drag = null; return; }
    const dx = t.clientX - drag.x, dy = t.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (drag.edge ? dx < 10 : !(dx > 16 && dx > Math.abs(dy) * 2)) return;
      drag.on = true; if (touchPid != null) api.gesture.claim(touchPid, { backSwipe: true });
      closeMenu(); readSessions(); open = true; paintDrawer(); open = false;
      layer.hidden = false; layer.classList.add('is-drag');
    }
    // the drawer's swipe from here: nothing below (thread swipe-back, desk steps, scrolling) follows it
    e.stopPropagation(); if (e.cancelable) e.preventDefault();
    const w = W(), x = Math.max(0, Math.min(w, dx));
    drawer.style.transform = `translateX(${x - w}px)`; scrim.style.opacity = String(x / w);
  }, { capture: true, passive: false });
  function settle(go) {
    const blocked = shellSheetOpen();
    if (go && !blocked) return openDrawer();
    layer.classList.remove('is-drag'); drawer.style.removeProperty('transform'); scrim.style.removeProperty('opacity');
    // A sheet can open after touchstart: remove the drag scrim on this frame,
    // rather than leave it intercepting the sheet while the close animates.
    if (blocked) { layer.classList.remove('is-open'); layer.hidden = true; }
    else api.after(220, () => { if (!open) layer.hidden = true; });
  }
  const dragEnd = e => {
    if (!drag) return;
    const g = drag; drag = null; if (!g.on) return;
    e.stopPropagation();
    const t = e.changedTouches?.[0], dx = t ? t.clientX - g.x : 0, dy = t ? t.clientY - g.y : 0;
    settle(e.type !== 'touchcancel' && !!t && (dx > W() * .4 || api.gesture.intent(dx, dy, performance.now() - g.at)));
  };
  api.listen(doc, 'touchend', dragEnd, { capture: true, passive: true }); api.listen(doc, 'touchcancel', dragEnd, { capture: true, passive: true });
  // a swipe left on the open drawer closes it
  let shut = null;
  api.listen(drawer, 'pointerdown', e => { if (!menu) shut = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() }; });
  api.listen(drawer, 'pointerup', e => {
    if (!shut || e.pointerId !== shut.id) return; const g = shut; shut = null;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (dx < -40 && Math.abs(dx) > Math.abs(dy) * 1.5) closeDrawer();
  });
  api.listen(drawer, 'pointercancel', () => { shut = null; });

  /* ---------- workspaces (top right) ---------- */
  let sheet = null, offSheetBack = null;
  function paintWs() {
    const list = api.workspaces?.list() || [], own = list[0] || { name: agentName() };
    wsDisc.textContent = initial(own.name); wsName.textContent = own.name;
    wsBtn.setAttribute('aria-label', `Workspace: ${own.name}. Switch workspace`); wsBtn.title = `Workspace: ${own.name}`;
    if (sheet) paintSheet(list);
  }
  function paintSheet(list) {
    const body = sheet.querySelector('.aa-sh-body'), out = [];
    for (const w of list) {
      const r = el('div', 'aa-sh-row' + (w.current ? ' is-on' : ' is-off'), { role: 'listitem' });
      const disc = el('span', 'aa-ws-i is-big', { 'aria-hidden': 'true', text: initial(w.name) });
      const words = el('span', 'aa-sh-w'); words.append(el('b', '', { text: w.name }), el('small', '', { text: w.current ? 'This Wizard · on this screen' : `${w.org ? w.org + ' · ' : ''}${w.url ? 'Another Wizard · tap to switch' : 'Not connected yet'}` }));
      if (!w.current && w.url) {
        const go = () => { closeSheet(); void globalThis.WizWorkspaces?.switch(w.id).catch(() => {}); };
        r.tabIndex = 0; r.setAttribute('tabindex', '0'); r.setAttribute('role', 'menuitemradio' === r.getAttribute('role') ? 'menuitemradio' : 'button');
        api.listen(r, 'click', go);
        api.listen(r, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      r.append(disc, words); if (w.current) r.append(icon('check', 'aa-ico aa-sh-check'));
      out.push(r);
    }
    const list0 = el('div', 'aa-sh-list', { role: 'list', 'aria-label': 'Workspaces' }); list0.append(...out);
    const manage = el('button', 'aa-sh-manage', { type: 'button', text: 'Manage workspaces' });
    // Manage = Settings › Connections, where the saved Wizards are added (wizard-ux#1209: Network & security has none of it)
    api.listen(manage, 'click', () => { closeSheet(); api.desk.settings('connections'); });
    body.replaceChildren(list0, manage);
  }
  function openSheet() {
    if (sheet) return; closeDrawer();
    api.workspaces?.refresh();
    sheet = el('div', 'aa-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Workspaces' });
    const sc = el('div', 'aa-sh-scrim', { 'aria-hidden': 'true' }), card = el('div', 'aa-sh-card');
    const hd = el('div', 'aa-sh-head'); const x = el('button', 'aa-tb aa-sh-x', { type: 'button', 'aria-label': 'Close' }); x.append(icon('x'));
    hd.append(el('h3', 'aa-sh-t', { text: 'Workspaces' }), x);
    card.append(el('i', 'aa-sh-grip', { 'aria-hidden': 'true' }), hd, el('div', 'aa-sh-body'));
    sheet.append(sc, card); api.mount(sheet);
    api.listen(sc, 'click', closeSheet); api.listen(x, 'click', closeSheet);
    offSheetBack = api.back.push(closeSheet);
    wsBtn.setAttribute('aria-expanded', 'true');
    paintSheet(api.workspaces?.list() || []);
    api.after(0, () => x.focus?.({ preventScroll: true }));
  }
  function closeSheet() { if (!sheet) return; sheet.remove(); sheet = null; offSheetBack?.(); offSheetBack = null; wsBtn.setAttribute('aria-expanded', 'false'); }
  // Two or more saved Wizards: the shared switcher menu (core/workspaces.js), which also lists the Wizards saved on this device.
  api.listen(wsBtn, 'click', () => { const W = globalThis.WizWorkspaces; if (W?.visible && W.openMenu) { closeSheet(); W.openMenu(wsBtn); return; } sheet ? closeSheet() : openSheet(); });
  api.listen(globalThis, 'wos:resources', () => { paintWs(); paintFuel(); });
  let fuelSig = '';
  // (4 Nov 2026) the gauge stays without the network Home: read the AI usage feed directly and keep it polling while the foot shows
  const ownFuel = () => fuelOf(api.aiUsage?.state?.(), api.aiUsage?.provider?.());
  api.aiUsage?.live?.(foot);
  const paintFuel = () => { fuelSig = gaugeInto(doc, fuel, fuelSig, pg => { closeDrawer(); api.desk.settings(pg || 'ai'); }, ownFuel); };

  /* ---------- Home: a New chat (the drawer's +, the name in the top bar, the orb's swipe up all land here) ---------- */
  function goHome() { draftWant = false; closeMenu(); closeSheet(); closeDrawer(); api.sessions.newChat(); }

  /* ---------- the orb in the composer (round 6, Miguel: the orb replaces the microphone) ----------
   * The composer keeps an empty slot where the mic was (layout.css: the grid's 'orb' column, right, before Send); the
   * dock orb moves into it at that size (chrome.orbIn), so tap talks / dictates and hold gives a command, as everywhere.
   * Off a chat, during a take (the stock voice controls around the orb's own spot) or with no composer on screen: back
   * to its own spot. */
  // The Chats windows' shared surfaces come from the shell (api.phone.chats: WizChatsHost surfaces), never its markup.
  const chatSurfaces = () => api.phone.chats?.() || [];
  const onScreenComposer = W => chatSurfaces().map(s => s.composer).find(n => { if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.left > -4 && r.right < W + 4; }) || null;
  const shownNote = () => chatSurfaces().map(s => s.notification).find(n => n && (typeof n.getClientRects !== 'function' || n.getClientRects().length)) || null;
  function orbSlot() {
    if (root.dataset.aiFront !== 'chat') return null;
    if ((api.voice?.state?.()?.state || 'idle') !== 'idle') return null;
    const W = globalThis.innerWidth || 0;
    const c = onScreenComposer(W);
    const row = c?.querySelector('.ch-row2'); if (!row) return null;
    return gridSlot(row, 3);
  }
  const syncOrb = () => api.frame(() => { chrome.orbIn(orbSlot()); homeRoom(); });
  // Home's apps end where the composer starts (it grows with words)
  function homeRoom() {
    const W = globalThis.innerWidth || 0, H = globalThis.innerHeight || 0;
    const c = onScreenComposer(W);
    const top = c ? c.getBoundingClientRect().top : 0;
    if (H && top > 0) root.style.setProperty('--ah-bottom', Math.round(H - top) + 'px');
  }
  // only on Home (the empty New chat), never while the drawer is open over it
  const homeShow = on => home.show(!!on);
  api.listen(globalThis, 'resize', syncOrb);
  if (globalThis.visualViewport) { api.listen(globalThis.visualViewport, 'resize', syncOrb); api.listen(globalThis.visualViewport, 'scroll', syncOrb); }
  api.listen(doc, 'input', e => { if (e.target?.closest?.('.ch-compose')) syncOrb(); }, true);
  api.listen(doc, 'focusin', syncOrb, true); api.listen(doc, 'focusout', () => api.after(60, syncOrb), true);

  /* ---------- the main screen: the chat (Home and the bare list become it), or an app ---------- */
  let last = { view: '', thread: null, desk: -1 }, pending = false;
  const soon = fn => { if (pending) return; pending = true; api.after(0, () => { pending = false; fn(); }); };
  function onRoute(r) {
    if (backOff && r.desk !== backDesk) dropBack();   // left the app's chat: Back is the stock one again
    if (r.home) { soon(() => { if (api.route().home) api.sessions.newChat(); }); return paintTop(r); }
    if (r.view === 'list') {
      // the list lives in the drawer here: a thread left for the list (Back) opens the drawer over a new chat
      const fromThread = last.view === 'thread' && last.desk === r.desk;
      soon(() => { if (api.route().view === 'list') { api.sessions.newChat(); if (fromThread) openDrawer(); } });
    }
    last = { view: r.view, thread: r.thread, desk: r.desk };
    paintTop(r);
  }
  function paintTop(r = api.route()) {
    if (r.home || r.view !== 'thread' || r.thread !== '__new__' || (r.app && r.app !== 'chats')) draftWant = false;
    globalThis.WizChatsHost.placeNotificationRoute(shownNote());
    const app = r.app && r.app !== 'chats' ? r.app : '';
    root.dataset.aiFront = r.home ? 'chat' : app ? 'app' : r.view === 'list' ? 'list' : 'chat';
    // Home = a New chat: nothing but the skin's background, the composer and the orb
    // a notification opened from the list is a New chat holding the note: a chat, never Home (round 7)
    const home = !app && r.view !== 'list' && (r.home || !r.thread || r.thread === '__new__') && !shownNote() && !draftWant;
    if (home) root.dataset.aiNew = 'on'; else delete root.dataset.aiNew;
    homeShow(home);
    if (!home && app) closeSheet();
    syncOrb();
    paintWs();
  }
  api.on('route', r => { markUsed(r); onRoute(r); api.after(420, syncOrb); });   // again once the chat's desk has slid in
  api.on('render', () => { if (open) { readSessions(); paintDrawer(); } paintTop(); });
  api.on('home', () => { draftWant = false; soon(() => { if (api.route().home) api.sessions.newChat(); }); });
  api.on('voice', () => paintTop());
  readSessions(); paintTop(); paintBadges();
  if (api.route().home) soon(() => api.sessions.newChat());

  return () => {
    closeMenu(); closeSheet(); closeDrawer();
    top.remove(); layer.remove(); toast.remove(); closeTidySheet(); chrome.dispose(); tidyOff?.(); toastOff?.();
    for (const k of ['aiApps', 'aiFront', 'aaDrawer', 'aiNew']) delete root.dataset[k];
    home.el.remove(); root.style.removeProperty('--ah-bottom');
  };
}
