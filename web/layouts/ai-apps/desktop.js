/* AI apps view on the desktop (Miguel, 2 Nov 2026): the layout the ChatGPT, Claude and Perplexity desktop apps share,
 * measured at 1440 × 900 and 1280 × 800 (~/.hermes/cache/screenshots/ai-apps-ref/REPORT.md §6), with Wizard's own
 * pieces in it. Worn by the same miguel/ai-apps tweak as the phone (layout.js hands the desktop shell here).
 *
 *   - Sidebar on the left, 288 px (Claude's width, ChatGPT's panel): the Wizard's name, 🔍 (searches chats only)
 *     and the collapse toggle ◫ in its header; where they list Projects / GPTs / Spaces, the open apps as a grid of
 *     small icons with their names (every open app = desks, badged first then desk order, the badge on the icon; the
 *     same list as the phone drawer, the Apps icons and the Orb satellites), ending in All apps = the three-level
 *     sheet (chrome.js); then the chats in Wizard's own sections (round 5, in place of Recents and View all: the
 *     sidebar IS the chat list), in the stock Chats order Archive, Working, Ready, each header like their Recents label
 *     and a click folds it (Ready open, Working and Archive folded at first; kept on this device; ⋯ on hover or a right
 *     click on a row: Pin, Rename, Mark unread, Snooze, Archive / Restore, through Chats' own actions); at its foot a
 *     round + (New chat) and a cog (Settings), icons only, as on the phone. Its ◫ toggle (and the rail's) carries the
 *     Ready count (round 5, the phone's ☰ count).
 *   - Collapsed, it is a 120 px rail (round 12: words, not icons; was a 52 px icon rail, ChatGPT / Perplexity): ◫, +, 🔍, the open apps' icons, All apps, and the cog
 *     at the bottom. ◫ or Ctrl / ⌘ + Shift + S (ChatGPT's key) toggles it; the choice is kept on this device. It stays
 *     open from 680 px up (none of them fold it there; James, 12 Nov 2026: was 900), or 900 px while a chat is docked
 *     beside an app panel; narrower it rests as the rail and opens over the page.
 *   - The main area beside it: a 52 px top row (what is in front on the left, a thread's title or an app's name; a small
 *     home button in its middle, always there (round 5, as on the phone); on the right, on Home only (round 5), the
 *     workspace switcher, where they put Temporary / Incognito), then the chat or the app.
 *       · The chat = the real Chats window without its list or its header (both live in the sidebar): one column, at
 *         most 768 px, centred (ChatGPT). A new chat shows the greeting with the composer centred under it; in a chat
 *         the composer docks 24 px from the bottom. The real composer: + · field · model chip · mic · one round button
 *         (Send with words, else the voice button: click talks, hold gives a command, as in every view).
 *       · An app = its desk, filling the main area under the same top row, and the orb floating at the bottom centre of
 *         the main area (the phone's standard): click talks, hold commands, a drag up opens a New chat with the cursor
 *         in its composer (round 5, the phone's swipe up: talk or type). An
 *         app's own bottom tab bar is laid out either side of it (the orb bar, skin-host), else lifted clear of it.
 *   - The stock bar keeps only what is not a desk switcher (the AI fuel gauge, warnings, update notices) and moves into
 *     the top row; every desktop key still works (⌥ keys, ⌥1–9 desks, ⌥` = Home = the chat here).
 * Round 8 (Miguel, 2 Nov 2026): the apps move to their own sidebar on the RIGHT, the left one's mirror (an app switcher:
 * open apps first, badged first, then installed, then Get more; folds to a rail with ◫ or ⌥⇧\, kept per device); an app
 * opens as the panel growing out of it toward the middle, the switcher staying in view; Home is clean again (the skin's
 * background and the composer only); one fuel gauge (the sidebar foot's); the header name is text only; the folded rail
 * shows each Ready chat's stock status icon, grouped by status with small counts. The phone keeps its Home grid.
 * Round 10 (Miguel, 2 Nov 2026: umbrelOS's Home with the AI-first composer): the right apps sidebar is gone. Home = the
 * skin's background, the new chat's composer floating in the upper middle and under it the app grid (home.js, paged:
 * big icons with their names, no plate behind them; the phone's order; drag to rearrange; a right click for quick
 * actions: Open, Add to Home Screen, App Store page, Close). An app slides in from the right OVER Home as the panel
 * (resizable, ⤢ wider, ✕ / Esc back to the grid); the grid and the composer stay where they are. ⌥ app letters sit on
 * the grid's icons.
 * Round 11 (Miguel, 2 Nov 2026): the desktop like the phone. The composer sits at the BOTTOM centre under the app grid;
 * the grid is always there on the background (Home, and with a chat column or an app panel open: it stays exactly
 * where it is, the panels slide over it; closing a chat is Home again). Its order is the desks' order (badged first),
 * nothing to drag. Opening or closing anything never touches the wallpaper (core/skins.js no longer re-renders on a
 * same-size resize) and moves things with short transforms only (flip below: no width or left transitions; one
 * re-tile after a change has settled, never one per frame).
 * Round 13 (Miguel, 2 Nov 2026) put the open apps in a tab strip across the top; round 15 (Miguel, 3 Nov 2026: "ok let's
 * try", Arc's layout) replaces it: no tab strip and no New tab page. The sidebar gains a row of PINNED apps under its
 * header (40 px icons, names on hover, the owner's order; Music, Mail, Messenger, Calendar, Money at first when
 * installed; two rows at most, All apps at its end: the full grid as a sheet over the background, a right click on any
 * app: Pin / Unpin, Open, Add to Home Screen); the folded rail shows them too. The OPEN apps are vertical tabs in a
 * column on the right (one per desk, the open pins first without ✕, then badged first, then desk order; folds to 52 px,
 * resizable); a tab shows its app as a panel docked left of the column (resizable, ⤢ wider); the tab again or Esc hides
 * it (the desk stays open); ✕ closes the desk. Auto-tidy (Arc): open apps not pinned and unused for 24 h (Off · 12 h ·
 * 1 week) close by themselves, with a toast and Undo. A chat opens as round 7's column docked beside the sidebar (✕,
 * Esc, ⌥W back Home); Home is the background, the composer and the orb only; ⌂ beside 🔍 goes Home from anywhere.
 * Round 16 (Miguel, 3 Nov 2026: the apps in ONE place, Arc's): the pinned row leaves the sidebar and the rail; the
 * right column lists every pinned app on top (always there, no ✕, open or not: a click on one not open opens it), a
 * hairline, the other open apps (✕, auto-tidy), and All apps as its last row (⌥T); folded, the same icons. The sidebar
 * is the chats only (no ⌂: Home stays ✕ / Esc / ⌥` and the switcher). The folded rail is 52 px (ChatGPT's): ◫, +, 🔍,
 * then Snoozed and Ready with Ready's statuses, each a count with a short word under it (the full words in its tip;
 * Archive and Working are not on it), and the cog. Item 6: drag a row (press and hold, or drag past 5 px) to rearrange:
 * within Pinned (the pin order), within the open apps (the desks themselves move, the stock moveDesk: 1:1 with Desks),
 * or between them (into Pinned pins it there; out of it unpins it); the others slide out of the way, a line shows where
 * it lands, Esc cancels. Its right click has Move up / Move down too. Once he has ordered the open apps by hand, they
 * keep his order (desk order; badged first only until then).
 * Everything through the layout API; no timers of its own beyond api.after, no innerHTML, no storage of its own
 * beyond api.storage. Colours are skin tokens (desktop.css). */
import { viewChrome, openApps, realApps, matches, CHATS, MIC } from '../apps/chrome.js';
import { glyphOf, colourOf } from '../orb/shared.js';
import { HOLD_MS } from '../orb/keys.js';
import { ACTS, svgIcon, initial, sectionsFor, archiveTop, KINDS, EMPTY, sectionsOpen, gridSlot, STATES, stateOf, stateGroups, gaugeInto, fuelOf,
  pinsFrom, togglePin, RAIL_WORDS, vtMove, relMoves, appLayers, shownIds, TIDY, TIDY_WORDS, TIDY_DEFAULT, tidyPlan, seedUsed, tidyWords,
  TIDY_SHORT, tidySentence, readyGroups, projectGroups, GROUP_MODES, groupMode, readyFlat, readyStep, GROUP_ORDERS, groupOrder, railRows, railActive, railNext, shortTime, titleInProject } from './parts.js';
import { homeView } from './home.js';

export const SIDE = 288, RAIL = 52, DOCKED_FROM = 680, CROWDED_FROM = 900;
/** Narrower desktop window, one app at a time (James, 12 Nov 2026, from the approved mockup: Wizard at half or a third of
 * his screen beside Zoom; wizard-ux issue 1314 was the earlier switch): below `from` px wide the main area shows ONE
 * thing, an app or Chats, and the Apps column becomes the app bar at the `bar` edge (`barH` px): Chats first, then the
 * pinned and open apps either side of the orb, All apps last, one click each. Chats keeps its list beside the chat
 * from `split` px (the sidebar's own DOCKED_FROM), narrower the list, then the chat with Back. The bar's edge lives
 * here only: the pane geometry places it (dock edge) and desktop.css reads html[data-aad-dock-edge]. */
export const ONE = Object.freeze({ from: 1100, split: DOCKED_FROM, bar: 'bottom', barH: 64 });
/** Round 9 (Miguel, 2 Nov 2026): the panels resizable by drag, within these limits (px). Round 15: the sidebar, the
 * open-apps column on the right (Arc's vertical tabs; 52 px folded) and the app panel docked left of it. */
export const SIZE_LIMITS = { side: [220, 440], tabs: [160, 320], app: [360, 1400] };
/** Round 15: the open-apps column's default and folded widths, the tidy check's period. */
export const COLS = { tabs: 200, tabsRail: 52 };
export const TIDY_EVERY = 3600e3;
/** Ctrl / ⌘ + Shift + S: ChatGPT's sidebar key (the shell's own keys are all ⌥, so it takes nothing of theirs). */
/** One anchor (Miguel, 4 Nov 2026): every Wizard key is left ⌥ + a key, the keys of the app in front included
 * (docs/ai-apps-view.md › App keys). These ⌥ keys are Wizard's and never go to an app (⇧ variants too): ⌥1–⌥0, ⌥[ ⌥],
 * ⌥↑/↓, ⌥H (and ⌥`), ⌥W, ⌥S, ⌥Space and the voice keys ⌥D ⌥V ⌥C. Horizontal arrows stay reserved
 * from app-declared shortcuts so plain ⌥←/→ remain native word navigation, not a Wizard action. */
export const RESERVED_KEYS = Object.freeze(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'BracketLeft', 'BracketRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyH', 'Backquote', 'KeyW', 'KeyS', 'Space', 'KeyD', 'KeyV', 'KeyC']);
/** Browser boundary (wizard-os#133): the view's own ⌥ keys that also come across from a sandboxed app that has the
 * keyboard, as they do from a same-origin one: ⌥H Home, ⌥K search, ⌥L / ⌥R fold a side, ⌥O workspaces, ⌥A add an app
 * and ⌥0 the tenth row. Like the desktop's list, only keys that move around the owner's own windows or open the view's
 * own panels; ⌥N, ⌥S, ⌥W, ⌥↑/↓, ⌥E/X/Z/B, ⌥P and the voice keys stay the app's while it has the keyboard. */
export const FRAME_KEYS = Object.freeze(['KeyH', 'KeyK', 'KeyL', 'KeyR', 'KeyO', 'KeyA', 'Digit0']);
/** An app key (data-wz-key): one lower-case letter or / , . ; that is not Wizard's. appKeyOf reads it from e.code,
 * never e.key (macOS ⌥ turns letters into symbols): KeyJ → 'j', Slash → '/'; '' for anything else. */
const APP_PUNCT = { Slash: '/', Comma: ',', Period: '.', Semicolon: ';' };
export const appKeyOf = code => { const c = String(code || ''); if (RESERVED_KEYS.includes(c)) return ''; const m = /^Key([A-Z])$/.exec(c); return m ? m[1].toLowerCase() : APP_PUNCT[c] || ''; };
export const isAppKey = k => typeof k === 'string' && /^[a-z/,.;]$/.test(k) && !(/^[a-z]$/.test(k) && RESERVED_KEYS.includes('Key' + k.toUpperCase()));
export const isSideKey = e => !!e && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === 'KeyS' || String(e.key).toLowerCase() === 's');

export default function desktop(api) {
  const doc = document, root = doc.documentElement;
  const host = globalThis.WizDesktop?.host;
  const chatWindows = () => (host?.windows() || []).filter(w => w.kind === 'chats');
  const mainChatWindow = () => chatWindows().find(w => w.desk === mainChats()?.desk) || chatWindows()[0] || null;
  const chatParts = part => chatWindows().map(w => host.chats(w.id)?.[part]).filter(n => n && n.getClientRects().length && n.getBoundingClientRect().width > 0);
  const chatAction = act => chatWindows().map(w => host.chats(w.id)?.action(act)).find(onScreen) || null;
  // the desks' placement containers come from the host (WizDesktop.host.placements), keyed by desk; never Classic markup
  const placements = () => host?.placements?.() || [];
  const placementOf = (desk, not = null) => placements().find(p => p.desk === desk && p.node !== not)?.node || null;
  const deskOfNode = n => placements().find(p => p.node === n)?.desk ?? null;
  const panes = globalThis.WizCore.panes;
  const MODE_KEYS = { KeyU: 'centre', KeyJ: 'pair', KeyF: 'full', KeyT: 'tiled' };
  const MODE_LABELS = { centre: 'Centred', pair: 'Side by side', full: 'Full screen', tiled: 'Back to tiled' };
  const appWindows = desk => (host?.windows() || []).filter(w => w.desk === desk && w.tiled);
  const panelWindow = () => appWindows(pane?.desk).find(w => w.appId === pane?.id) || appWindows(pane?.desk)[0] || null;
  const paneWins = () => appWindows(pane?.desk).length;
  let pane = null, dockEl = null, want = null, docked = false, wide = false, chatThread = null, splitTries = 0, fixingBehind = false;
  let paneGeometry = null, secondEl = null;
  const paneVars = new Set();
  /* Narrower window, one app at a time (ONE above): from the window's width alone, never stored */
  const one = () => (globalThis.innerWidth || 1440) < ONE.from;
  /* Activity as a short what-needs-me list (wizard-ux issue 1336, the Channels switch wizard/chat-channels): no agent
   * chips (every agent's chats; agents live in the Channels list), Working, Ready (amber needs you and green unread
   * only), Recent (the rest, newest first, a week back, then Show older), Snoozed and Archived folded at the bottom,
   * one sort on Ready (Newest first, Oldest first, Needs you first), and one marker per row: spinner, amber or green. */
  const actOn = () => { try { return String(root.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'); } catch (_) { return false; } };
  const ACT_SECTIONS = [['working', 'Working'], ['ready', 'Ready'], ['recent', 'Recent'], ['snoozed', 'Snoozed'], ['archive', 'Archived']];
  const ACT_EMPTY = { working: 'Nothing working.', ready: 'Nothing needs you.', recent: 'Nothing else this week.', snoozed: 'Nothing snoozed.', archive: 'Nothing archived.' };
  // (+ 'saved': sends a graceful restart holds, wizard-ux issue 1362; listed only while there are any)
  const LKINDS = [...KINDS, 'recent', 'saved'];
  let actOlder = false;
  const oneSplit = () => (globalThis.innerWidth || 1440) >= ONE.split;
  // (one app at a time: no split, no side by side, no second app; the saved arrangement is kept for the wide window)
  const paneModel = () => { const m = panes.get(); return one() ? { ...m, mode: 'tiled', ratio: null, weights: {}, slots: ['chats', 'app'], app2: null } : m; };
  function placePanes(s) {
    const m = paneModel(), focus = root.hasAttribute('data-aad-focus');
    // Horizontal dock interaction is not admitted yet: keep the saved model but render at end. The narrower window's
    // app bar (ONE) is that dock at ONE.bar, ONE.barH thick; the saved wide-window edge is left as it is.
    const bar = one(), edge = bar ? ONE.bar : ['start', 'end'].includes(m.dock.edge) ? m.dock.edge : 'end';
    const sm = root.dataset.aadSide;
    const sideWidth = focus || sm === 'none' ? 0 : sm === 'open' ? s.side[0] : sm === 'full' ? vw() : RAIL;
    const dockWidth = focus ? 0 : bar ? ONE.barH : root.dataset.aadTabs === 'rail' ? COLS.tabsRail : s.tabs[0];
    paneGeometry = panes.geometry({ ...m, dock: { ...m.dock, edge } }, { width: vw(), height: globalThis.innerHeight || 900 }, {
      sideWidth, dockWidth, appWidth: s.app[0], chatOn: !!root.dataset.aadChat, appOn: !!root.dataset.aadSplit, wide: root.hasAttribute('data-aad-wide'), app2On: !!secondEl,
    });
    root.dataset.aadPaneSide = m.side; root.dataset.aadDockEdge = edge;
    root.dataset.aadPaneTiled = String(paneGeometry.tiled);
    root.dataset.aadMode = m.mode;
    const put = (k, v) => { const key = '--aad-pane-' + k; paneVars.add(key); if (root.style.getPropertyValue(key) !== v + 'px') root.style.setProperty(key, v + 'px'); };
    for (const [id, b] of Object.entries({ side: paneGeometry.sidebar, dock: paneGeometry.dock, main: paneGeometry.content, chat: paneGeometry.panes.chats, app: paneGeometry.panes.app, app2: paneGeometry.panes.app2 || { x: 0, y: 0, width: 0, height: 0 } })) {
      for (const [k, v] of Object.entries(b)) put(id + '-' + k, v);
      put(id + '-right', vw() - b.x - b.width); put(id + '-bottom', (globalThis.innerHeight || 900) - b.y - b.height);
    }
    for (const [slot, n] of [['chats', dockEl], ['app', pane?.el], ['app2', secondEl]]) if (n) {
      const b = paneGeometry.panes[slot];
      n.toggleAttribute('data-aad-mode-hidden', m.mode !== 'tiled' && (!b?.width || !b?.height));
    }
  }
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = (name, cls = 'aad-ico') => svgIcon(doc, name, cls);
  const desks = () => api.desks.list();
  let draftWant = false;   // round 21: the new chat in front holds an app's Reply: it docks as a chat (left), the app stays right
  /* Round 11 (Miguel: opening and closing panels must be smooth): a change of layout snaps at once and its pieces glide
   * from where they were with a short transform (FLIP: translate only, never width / left), 220 ms. */
  const FLIP_MS = 220, EASE = 'cubic-bezier(.2, .8, .2, 1)';
  const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let flipping = 0, glideUntil = 0;
  function flip(nodes, change) {
    if (flipping) { change(); return; }   // (one flip at a time: a nested change rides the outer one)
    flipping++;
    try { flipNow(nodes, change); } finally { flipping--; }
  }
  function flipNow(nodes, change) {
    const list = nodes.filter(n => n && n.isConnected !== false && typeof n.getBoundingClientRect === 'function');
    const before = list.map(n => n.getBoundingClientRect());
    change();
    // the orb goes to its new spot first (measured on the final layout, before anything glides), then glides with the rest
    if (list.includes(orbBox)) placeOrb(true);
    if (reduced() || typeof list[0]?.animate !== 'function') return;
    list.forEach((n, i) => {
      const a = before[i], b = n.getBoundingClientRect(); if (!a.width || !b.width) return;
      const dx = Math.round(a.left - b.left), dy = Math.round(a.top - b.top); if (!dx && !dy) return;
      // (added to the element's own translate: the orb keeps its --vc-orb move underneath)
      n.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: FLIP_MS, easing: EASE, composite: 'add' });
      glideUntil = Date.now() + FLIP_MS + 10;
    });
  }
  const shownDesks = () => placements().filter(p => p.shown).map(p => p.node);
  const homeComposer = () => chatParts('composer')[0] || null;
  root.dataset.aiApps = 'desktop';
  api.sessions.ownList?.(); // core does not mount/paint the legacy list beneath this sidebar
  const css = el('link', '', { rel: 'stylesheet', href: api.asset('desktop.css') || '' });
  const unmountCss = api.mount(css);
  // the desks' windows are laid out in pixels from the page's sizes: again once this sheet (the sidebar, the widths) applies
  // first paint after a refresh stays clear (html[data-layout-booting], layout.css) until this sheet has applied
  const endBoot = () => doc.documentElement.removeAttribute('data-layout-booting');
  api.listen(css, 'load', () => { endBoot(); globalThis.dispatchEvent?.(new Event('resize')); });
  api.listen(css, 'error', endBoot);


  /* ---------- data ---------- */
  // round 15: the All apps sheet showing
  let noteWant = false;
  let sessions = null, badgeMap = api.apps.badges(m => { badgeMap = m; paintBadges(); });
  const agentName = () => (api.agents.list().find(a => a.main) || api.agents.here?.() || {}).label || (api.workspaces?.list()[0] || {}).name || 'Wizard';
  const readSessions = () => { sessions = api.sessions.list((typeof actOn === 'function' && actOn()) ? { activity: true, older: actOlder } : { focused: true }) || { working: [], snoozed: [], ready: [], archive: [] }; return sessions; };
  // (a chat opened from elsewhere may belong to an agent the sidebar is not focused on: look in the whole list too)
  const titleOf = id => { for (const s of [sessions || readSessions(), api.sessions.list()]) for (const k of (typeof LKINDS !== 'undefined' ? LKINDS : KINDS)) { const r = ((s || {})[k] || []).find(x => x.id === id); if (r) return r.title; } return ''; };
  // Thread tracker (tweak, off by default): the row's ask dots, drawn by the tracker itself so every list agrees.
  const ttAgent = id => globalThis.WizLive?.agentOf?.(id) || '';
  const ttDots = id => { const T = globalThis.WosThreadTracker; return T?.on?.() ? T.dots(id, ttAgent(id)) : ''; };
  const appName = id => (api.apps.list().find(a => a.id === id) || desks().find(d => d.id === id) || {}).name || '';
  const badgeText = id => { const n = badgeMap[id] || 0; if (!n) return ''; const t = api.apps.badgeText?.(id); return t || (n > 99 ? '99+' : String(n)); };
  const lit = id => (badgeMap[id] || 0) > 0;
  const litFirst = list => [...list.filter(a => lit(a.id)), ...list.filter(a => !lit(a.id))];

  /* ---------- the sidebar ---------- */
  const khMarks = new Map();   // the Ready rows wearing ↓ / ↑ while ⌥ is held (sid → key)
  const side = el('nav', 'aad-side', { 'aria-label': 'Sidebar' });
  const head = el('div', 'aad-sh');
  // round 7 (Miguel): the workspace switcher IS the header (this Wizard's name; a click opens the switcher menu), where
  // the name was; Home = + and ⌥`
  const wsBtn = el('button', 'aad-ws', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  // round 8 (Miguel): text only and a small chevron, no disc before the name
  const wsName = el('span', 'aad-wsn');
  wsBtn.append(wsName, icon('down', 'aad-ico aad-wsc'));
  const findBtn = el('button', 'aad-ib aad-find', { type: 'button', 'aria-label': 'Search chats', title: 'Search chats (⌥K)' }); findBtn.append(icon('search'));
  const togBtn = el('button', 'aad-ib aad-tog', { type: 'button', 'aria-controls': 'aad-side' }); togBtn.append(icon('side'));
  // (round 18 item 4a, Miguel: the Ready count sits on Ready's own header, as on the rail; none on ◫ any more)
  const searchBox = el('label', 'aad-search'); searchBox.hidden = true;
  const field = el('input', 'aad-q', { type: 'search', placeholder: 'Search chats', 'aria-label': 'Search chats', autocomplete: 'off' });
  searchBox.append(icon('search', 'aad-ico aad-search-i'), field);
  const cancelBtn = el('button', 'aad-cancel', { type: 'button', text: 'Cancel' }); cancelBtn.hidden = true;
  // (round 16: no ⌂ here any more; Home = a chat's ✕, Esc, ⌥`)
  head.append(wsBtn, findBtn, searchBox, cancelBtn, togBtn);
  const scroll = el('div', 'aad-scroll');
  const foot = el('div', 'aad-foot');
  const newBtn = el('button', 'aad-new', { type: 'button', 'aria-label': 'New chat', title: 'New chat (⌥N)' }); newBtn.append(icon('plus'));
  const setBtn = el('button', 'aad-set', { type: 'button', 'aria-label': 'Settings', title: 'Settings (⌥S)' }); setBtn.append(icon('cog'));
  // round 7: the cog on the left, the AI fuel gauge between, + on the right
  const fuel = el('div', 'aad-fuel', { 'data-fuel-copy': '' }); fuel.hidden = true;
  foot.append(setBtn, fuel, newBtn);
  // the rail (collapsed, round 16: 52 px): ◫ · + · 🔍, then Snoozed, Ready and Ready's stock statuses, each a count over
  // a short word (round 12's words, not icons) … the cog. (No Ready count on its ◫: Ready is right under it.)
  const rail = el('div', 'aad-rail');
  const rTog = el('button', 'aad-ib aad-rtog', { type: 'button', 'aria-label': 'Open sidebar', title: 'Open sidebar' }); rTog.append(icon('side'));
  const rNew = el('button', 'aad-ib aad-rnew', { type: 'button', 'aria-label': 'New chat', title: 'New chat (⌥N)' }); rNew.append(icon('plus'));
  const rFind = el('button', 'aad-ib aad-rfind', { type: 'button', 'aria-label': 'Search chats', title: 'Search chats (⌥K)' }); rFind.append(icon('search'));
  // the shared Wizard switcher (core/workspaces.js), icon only, shown only with two or more Wizards: its stock bar icon would sit
  // over the chat's own title here, so on the rail it is this button and with the sidebar open the header name below is the switcher
  const rWs = el('button', 'aad-ib aad-rws', { type: 'button', 'aria-label': 'Switch Wizard', title: 'Switch Wizard', 'aria-haspopup': 'menu' }); rWs.append(icon('layers')); rWs.hidden = true;
  const rSet = el('button', 'aad-ib aad-rset', { type: 'button', 'aria-label': 'Settings', title: 'Settings (⌥S)' }); rSet.append(icon('cog'));
  const rList = el('div', 'aad-rlist', { role: 'list', 'aria-label': 'Chats' });
  rail.append(rTog, rNew, rFind, rWs, rList, rSet);
  /* Agent choices (only with more than one agent): All, then each agent, as small chips under the header. They are Chats'
   * own Focus (api.agents.setFocus -> setFocus / winAgent): the sidebar lists that agent's chats and + starts one with it. */
  const agentsRow = el('div', 'aad-agents', { role: 'group', 'aria-label': 'Chats from' }); agentsRow.hidden = true;
  let agentsDrawn = '';
  function paintAgents() {
    const f = api.agents.focus ? api.agents.focus() : { id: '', agents: [] }, list = f.agents || [];
    const sig = list.length > 1 && !(typeof actOn === 'function' && actOn()) ? JSON.stringify([f.id, list.map(a => [a.id, a.label, a.colour, a.private])]) : '';
    if (sig === agentsDrawn) return;
    agentsDrawn = sig; agentsRow.hidden = !sig;
    if (!sig) { agentsRow.replaceChildren(); return; }
    const chip = (id, text, colour, priv) => {
      const on = f.id === id, b = el('button', 'aad-ag' + (on ? ' is-on' : ''), { type: 'button', 'data-aad-agent': id, 'aria-pressed': String(on), ...(priv ? { title: text + ' · private agent' } : {}) });
      if (colour) { const d = el('i', 'aad-ag-d', { 'aria-hidden': 'true' }); d.style.setProperty('--aad-ag', colour); b.append(d); }
      b.append(el('span', 'aad-ag-t', { text }));
      // the pick lands on the press itself (a tap registers at once); the list repaints right after
      api.listen(b, 'click', () => pickAgent(id));
      return b;
    };
    agentsRow.replaceChildren(chip('', 'All'), ...list.map(a => chip(a.id, a.label, a.colour, a.private)));
  }
  function pickAgent(id) {
    const f = api.agents.focus(); if (!f.space && (f.id || '') === id) return;   // a Space focus is replaced by the agent-wide one
    api.agents.setFocus(id);
    agentsDrawn = ''; paintAgents(); readSessions(); paintList(true); paintRail(true);
  }
  /* Channels (wizard/chat-channels, wizard-ux issue 1256): Chats' own Channels pane for this sidebar, through
   * api.sessions.channels: the Activity / Channels tabs over the rows below, and in Channels the channel list, or a
   * channel's feed and its message box, in place of them (desktop.css). Empty and hidden with the switch off. */
  const chanBox = el('div', 'aad-chan'); chanBox.hidden = true;
  const paintChan = () => { const on = !q && !!api.sessions.channels?.(chanBox); if (chanBox.hidden === on) chanBox.hidden = !on; };
  /* A channel opens in the main chat column, never in this sidebar (James, 11 Nov 2026: "Channels should display in the
   * chat list with the channel list remaining visible on the sidebar"): its feed is one more chat in the column (FEED),
   * drawn by api.sessions.channelFeed into feedBox over the docked Chats window. A post opens its thread there; Back
   * (Esc, ✕) from the thread returns to the feed, and from the feed to nothing open. The sidebar list never changes. */
  const FEED = '__feed__', feedBox = el('div', 'aad-feed'); feedBox.hidden = true;
  const feedOn = () => api.sessions.channelFeedOpen?.() || null;
  const panel = el('div', 'aad-panel'); panel.append(head, agentsRow, chanBox, scroll, foot);
  side.id = 'aad-side'; side.append(panel, rail);
  // one app at a time, the list alone: its row for the chat already open behind it shows that chat again (another row
  // opens its chat, and paintOne follows the new thread)
  api.listen(side, 'click', e => {
    const w = e.target?.closest?.('.aad-row')?.closest?.('.aad-rw');
    if (w && one() && !pane && oneList && !oneSplit() && w.dataset.sid === chatThread) { oneList = false; oneSeen = chatThread; paintTop(); }
  });
  const shade = el('div', 'aad-shade', { 'aria-hidden': 'true' });

  /* ---------- round 15 (Miguel, 3 Nov 2026: Arc-style): the top row over the main area ----------
   * Left: a docked chat's title and ✕ (round 7's column); right: the app panel's icon, name, its own title-bar tools,
   * ⤢ wider and — hide (the app keeps running on its desk). Nothing on Home: the skin's background only. */
  const top = el('header', 'aad-top');
  const cTop = el('div', 'aad-ctop'), tt = el('span', 'aad-tt');
  const cX = el('button', 'aad-ib aad-cx', { type: 'button', 'aria-label': 'Close the chat (Esc)', title: 'Close (Esc · ⌥W)' }); cX.append(icon('x')); cX.hidden = true;
  /* Back to the channel (wizard-ux issue 1302; James, 11 Nov 2026: "if I open a channel and then I click through to a
   * thread there's no way for me to go back to the channel"): a thread opened from a channel's feed in this column shows
   * "‹ # name" at the left of its header, and it does what Esc does (closeChat: the feed again, at its place). A thread
   * opened from Activity or the sidebar shows "‹ Activity" / "‹ Chats" (and the feed "‹ Channels") only while the list
   * is not beside it (James, 12 Nov 2026: "Make sure the user always has a back button in chats"; listBack below). */
  const cBack = el('button', 'aad-cback', { type: 'button' }); cBack.hidden = true;
  cTop.append(cBack, tt, cX);
  // narrow desktop (ONE), narrower than ONE.split: the chat (or a new one) alone, Back to the chats list
  const oneBack = el('button', 'aad-cback aad-oneback', { type: 'button', text: '‹ Chats', 'aria-label': 'Back to the chats list', title: 'Back to the chats list' }); oneBack.hidden = true;
  const pTop = el('div', 'aad-ptop'); pTop.hidden = true;
  const pIcon = el('span', 'aad-pti'), pName = el('span', 'aad-ptn');
  const pTools = el('span', 'aad-ptools'); pTools.hidden = true;
  const pW = el('button', 'aad-ib aad-pw', { type: 'button' });
  const pX = el('button', 'aad-ib aad-px', { type: 'button', title: 'Hide (Esc) · it keeps running' }); pX.append(icon('hide'));
  pTop.append(pIcon, pName, pTools, pW, pX);
  const sTop = el('div', 'aad-stop'), sName = el('span', 'aad-ptn'); sTop.hidden = true;
  sTop.append(sName);
  api.listen(sTop, 'mousedown', e => e.preventDefault()); // like the app bar: never takes the keyboard itself
  const modeBars = [];
  function windowMode(mode, slot = panes.get().focus) {
    // narrow desktop (ONE): one app at a time, no arrangements; the saved one stays as it is for the wide window
    if (typeof one === 'function' && one()) return;
    // Full screen remembers the view it came from: Esc there goes back to it, never to tiled (wizard-ux issue 1325)
    const was = panes.get().mode; if (mode === 'full' && was !== 'full') fullFrom = was;
    // Only mode/focus change: the tiled ratios, slots and rail sizes stay saved.
    flip([dockEl, pane?.el, secondEl], () => panes.set({ mode, focus: slot }));
  }
  // (in memory only: after a reload in full screen, Esc goes to tiled)
  var fullFrom = 'tiled';
  function modeBar(slot) {
    const bar = el('span', 'aad-modes', { role: 'group', 'aria-label': 'Window arrangement' });
    const nav = el('button', 'aad-ib aad-mode-chats', { type: 'button', 'aria-label': 'Chats list', title: 'Chats list' }); nav.append(icon('side'));
    api.listen(nav, 'click', e => { e.stopPropagation(); windowMode('tiled', 'chats'); if (pane) hidePanel({ home: false }); if (root.dataset.aadSide !== 'open') toggleSide(); });
    bar.append(nav);
    for (const [code, mode] of Object.entries(MODE_KEYS)) {
      const label = MODE_LABELS[mode], key = 'Alt+Shift+' + code.slice(3);
      const b = el('button', 'aad-ib aad-mode', { type: 'button', 'data-mode': mode, 'aria-label': label, 'aria-keyshortcuts': key, title: label + ' (' + key + ')' });
      b.append(el('span', 'aad-mode-glyph is-' + mode, { 'aria-hidden': 'true' }));
      api.listen(b, 'click', e => { e.stopPropagation(); windowMode(mode, slot); }); bar.append(b);
    }
    modeBars.push({ slot, bar }); return bar;
  }
  cTop.insertBefore(modeBar('chats'), cX); pTop.insertBefore(modeBar('app'), pW); sTop.append(modeBar('app2'));
  top.append(cTop, pTop);
  /* Wizard for Mac (wizard-os#548): the Mac app's title-bar drag strip covers #bar and lets a click through only on a
   * control INSIDE #bar (try-wizard WizardDragView reads #bar's box and the buttons in it). The chat's and the app panel's
   * headers sit over that strip but live on their desks, so their buttons were dead in the Mac app (a click moved the
   * window instead). Each of their buttons gets an empty, click-through stand-in in #bar, at its place; the Mac app then
   * leaves those spots to the page and blank header space still drags the window. Plain browsers never get them. */
  const macHoles = (() => {
    if (root.dataset?.nativeChrome !== 'mac') return null;
    const bar = doc.getElementById?.('bar'); if (!bar) return null;
    const box = el('span', 'aad-mac-holes', { 'aria-hidden': 'true' });
    bar.append(box);
    const CONTROLS = 'button, a[href], input, select, textarea, [role="button"]';
    let asked = false, last = '';
    const sync = () => {
      asked = false;
      if (!box.isConnected) bar.append(box);
      const b = bar.getBoundingClientRect(), spots = [];
      for (const head of [cTop, pTop, sTop]) {
        if (!head.isConnected) continue;
        for (const c of head.querySelectorAll(CONTROLS)) {
          if (!c.getClientRects().length) continue;
          const r = c.getBoundingClientRect();
          if (!r.width || !r.height || r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right) continue;
          const x = Math.floor(r.left - b.left - bar.clientLeft), y = Math.floor(r.top - b.top - bar.clientTop);
          spots.push([x, y, Math.ceil(r.right - b.left - bar.clientLeft) - x, Math.ceil(r.bottom - b.top - bar.clientTop) - y]);
        }
      }
      // The Mac app keeps page coordinates and re-reads only on a change inside #bar: when #bar itself moves (the sidebar
      // folds or opens), the spots are rebuilt too, even at the same place inside it.
      const key = [b.left, b.top, b.width, b.height].map(Math.round).join(',') + '|' + spots.join(';'); if (key === last) return; last = key;
      box.replaceChildren(...spots.map(([x, y, w, h]) => {
        const i = el('i', '', { tabindex: '-1' });
        Object.assign(i.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        return i;
      }));
    };
    const soon = () => { if (!asked) { asked = true; api.frame(sync); } };
    // The pointer moves before it clicks: keep the spots current while it is over the top row (motion, resizes, a header
    // that moved without a repaint), and after every repaint, resize and finished slide.
    api.listen(doc, 'pointermove', e => { if (e.clientY < bar.getBoundingClientRect().bottom + 8) soon(); });
    for (const t of ['animationend', 'transitionend']) api.listen(doc, t, soon);
    api.listen(globalThis, 'resize', soon);
    const ro = globalThis.ResizeObserver ? new ResizeObserver(soon) : null;
    for (const head of [cTop, pTop, sTop]) ro?.observe(head);
    ro?.observe(bar);
    const mo = globalThis.MutationObserver ? new MutationObserver(soon) : null;
    mo?.observe(root, { attributes: true, attributeFilter: ['style', 'data-aad-side', 'data-aad-chat', 'data-aad-split', 'data-aad-mode', 'data-aad-focus', 'data-aad-wide'] });
    soon();
    return { soon, dispose() { ro?.disconnect(); mo?.disconnect(); box.remove(); } };
  })();
  // a slow app: its placeholder in the panel's place from the first frame
  const pLoad = el('div', 'aad-pload', { 'aria-live': 'polite' }); pLoad.hidden = true;
  const pLoadT = el('span', 'aad-pload-t'); pLoad.append(el('span', 'aad-pload-i'), el('i', 'aad-pload-s', { 'aria-hidden': 'true' }), pLoadT);

  /* ---------- the apps, all in one place on the right (round 15: Arc / Chrome's vertical tabs; round 16: one place) ----------
   * The pinned apps on top, every one of them, open or not, no ✕ (they never auto-close; a click on one not open
   * opens it), a hairline, then the other open apps (one per desk, Home's own Chats desk aside), badged first, then
   * desk order, each with its ✕; All apps last (⌥T). A click shows the app as the panel docked left of the column; the
   * tab in front again (or Esc) hides it; ✕ closes the desk (the stock close). Folds to a 52 px icon column (kept),
   * resizable. At its foot: Tidy (auto-close apps not used for a while: Off · 12 h · 24 h · 1 week). */
  const vt = el('nav', 'aad-vt', { 'aria-label': 'Apps' });
  const vtHead = el('div', 'aad-vth');
  const vtTog = el('button', 'aad-ib aad-vtog', { type: 'button', 'aria-controls': 'aad-vt' }); vtTog.append(icon('side'));
  const vtTitle = el('span', 'aad-vtt', { text: 'Apps' });
  vtHead.append(vtTitle, vtTog);
  const vtList = el('div', 'aad-vtl', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Apps' });
  const vtFoot = el('div', 'aad-vtf');
  // All apps: the list's last row, kept in view under it (the grid as a sheet, ⌥T)
  // round 16 item 7: + at the column's end (in place of All apps): the picker of installed apps neither pinned nor open
  const vtAll = el('button', 'aad-vall', { type: 'button', 'aria-label': 'Open another app: search all installed apps, including open and pinned apps', title: 'Open another app (Left ⌥Space · ⌥A)' });
  const vtAllI = el('span', 'aad-vti'); vtAllI.append(icon('plus', 'aad-ico aad-vall-i'));
  // (the app bar's own word for it, ONE: "All apps", the phone's)
  vtAll.append(vtAllI, el('span', 'aad-vtn', { text: 'Add an app' }), el('span', 'aad-vtn aad-vtn-bar', { text: 'All apps', 'aria-hidden': 'true' }));
  const tidyBtn = el('button', 'aad-tidy', { type: 'button', 'aria-expanded': 'false' });
  const tidyW = el('span', 'aad-tidy-w');
  tidyBtn.append(icon('snooze', 'aad-ico aad-tidy-i'), tidyW);
  vtFoot.append(vtAll, tidyBtn);
  /* Narrower window (ONE): this column is the app bar (desktop.css, html[data-aad-dock-edge]) and Chats is its first
   * item, the one way back to the chats there (the left sidebar is gone); hidden while the window is wide (outside the
   * list: the rows' drag and their numbering never see it). Its badge: the chats waiting (Ready's count). */
  const vOne = el('div', 'aad-vone'); vOne.hidden = true;
  const vChats = el('div', 'aad-vchats', { role: 'button', tabindex: '0', 'data-app': CHATS, title: 'Chats', 'aria-label': 'Chats' });
  const vChatsN = el('b', 'aad-vtb', { 'aria-hidden': 'true' }); vChatsN.hidden = true;
  { const ic = el('span', 'aad-vti'), t0 = el('span', 'aad-tile is-vt', { 'aria-hidden': 'true' }); t0.style.setProperty('--c', 'var(--wz-accent)'); t0.append(el('i', 'sgi sg-chats', { 'aria-hidden': 'true' })); ic.append(t0); vChats.append(ic, el('span', 'aad-vtn', { text: 'Chats' }), vChatsN); }
  vOne.append(vChats, el('hr', 'aad-vtsep', { 'aria-hidden': 'true' }));
  // the app bar's gap for the orb (between its two halves; the orb moves into it, as into the composer's slot)
  const vtOrb = el('i', 'aad-vtorb', { 'aria-hidden': 'true' });
  vt.id = 'aad-vt'; vt.append(vtHead, vtList, vtFoot, vtOrb);
  vt.insertBefore(vOne, vtList);
  const toast = el('div', 'aad-toast', { role: 'status' }); toast.hidden = true;
  const toastW = el('span', 'aad-toast-w'), toastU = el('button', 'aad-toast-u', { type: 'button', text: 'Undo' });
  toast.append(toastW, toastU);

  /* ---------- the orb: bottom centre of the main area, always (Home, a chat, an app): the one way to talk ---------- */
  const orbBox = el('div', 'aad-orb');
  const cv = el('canvas', 'aad-orbc', { width: '128', height: '128', 'aria-hidden': 'true' });
  const fb = el('img', 'aad-orbfb', { alt: '', src: 'robert-thread-orb.png', draggable: 'false' }); fb.hidden = true;
  const orbBtn = el('button', 'aad-orbbtn', { type: 'button', 'aria-label': 'Wizard orb (the microphone). Click to talk, hold for a command, drag up for a new chat to type in.' });
  // round 6: the orb IS the microphone, so it wears a small one (in the composer, where the mic was, and on its own spot)
  const micG = el('span', 'aad-mic', { 'aria-hidden': 'true' }); micG.append(svgIcon(doc, 'mic', 'aad-mic-i'));
  const micMarkup = micG.innerHTML; let orbIdentityHtml = micMarkup;
  function paintOrbIdentity(appId) {
    const a = appId && api.apps.list().find(a => a.id === appId), S = doc.defaultView?.WizSigil;
    const html = a && S ? (a.sgh || S.html(a.sigil || a)) : micMarkup;
    if (html === orbIdentityHtml) return;
    orbIdentityHtml = html; micG.innerHTML = html;
    if (a && S) { S.orb(micG); for (const glyph of micG.children) { glyph.style.width = '40%'; glyph.style.height = '40%'; } }
  }
  orbBox.append(cv, fb, micG, orbBtn);


  // round 21: ⌥H Home hides both sides; this one quiet ◫ at the top left (where the sidebar was) puts everything back (⌥H)
  const hBack = el('button', 'aad-ib aad-hback', { type: 'button', 'aria-label': 'Everything back as it was (⌥H)', title: 'Back as it was (⌥H)' }); hBack.append(icon('side'));
  // (app keys round: the empty middle of Home, where ⌥H's keycap sits while ⌥ is held; nothing drawn, never clickable)
  const hMid = el('div', 'aad-hmid', { 'aria-hidden': 'true' });
  const scene = el('div', 'aad');
  scene.append(shade, side, top, pLoad, vt, toast, orbBox, hBack, hMid);
  api.mount(scene);
  api.mount(feedBox);   // (moved into the docked chat column while a channel's feed shows there)

  // the + sheet in three levels and room under hosted apps for the floating orb, from the shared view chrome; the orb's
  // spot (its centre, its size) lets an app's own bottom tabs go either side of it
  const orbSpot = () => { const r = orbBox.getBoundingClientRect?.(); return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, d: orbBox.offsetWidth || r.width } : null; };
  const chrome = viewChrome(api, { openIds: () => desks().map(d => d.id), orb: orbSpot });
  const near = (a, b) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.d - b.d) < .5);
  const orbAt = { done: false, slot: null, home: null };   // where placeOrb last put the orb (round 11)

  /* ---------- the sidebar's width: open, the rail, or open over the page (narrow) ---------- */
  let folded = api.storage.get('folded') === true, peek = false;
  // one app at a time (ONE): Chats narrower than ONE.split shows its list (oneList) or the chat; the app last in front
  // (Back from the list returns to it); the chat last seen (a new one shows the chat); the switch's state last painted
  let oneList = true, oneLast = null, oneSeen, oneWas = false, oneWide = false;
  // A chat docked beside an app panel needs that room: there the sidebar keeps the old 900 px breakpoint, so the app
  // is never squeezed to nothing between the docked chat and the open-apps column (Codex review on PR 1313).
  const narrow = () => (globalThis.innerWidth || 1440) < (root.dataset.aadChat && root.dataset.aadSplit ? CROWDED_FROM : DOCKED_FROM);
  // (peek: the list shown over the page, by ◫ on a narrow window or by a chat's Back wherever the list is not beside it:
  // narrow, folded to the rail, or full screen)
  const peekable = () => narrow() || folded || panes.get().mode === 'full';
  const sideWant = () => one() ? (pane ? 'none' : oneSplit() ? 'open' : oneList ? 'full' : 'none') : peek && peekable() ? 'over' : narrow() || folded ? 'rail' : 'open';
  /** the sidebar again after a resize or a chat docking beside an app (or leaving): only when its mode changes */
  function syncSide() {
    if ((one() || !peekable()) && peek) { peek = false; offPeek?.(); offPeek = null; }
    if (sideWant() !== root.dataset.aadSide) paintSide();
  }
  function paintSide(relayout = true) {
    const mode = sideWant();
    const was = root.dataset.aadSide;
    if (relayout && was && was !== mode) flip([top, orbBox, ...shownDesks()], () => { root.dataset.aadSide = mode; });
    else root.dataset.aadSide = mode;
    // the sidebar opens with a short reveal (clip, no width animation); folding snaps to the rail
    if (relayout && was === 'rail' && mode !== 'rail' && !reduced() && typeof side.animate === 'function') side.animate([{ clipPath: `inset(0 calc(100% - ${RAIL}px) 0 0)` }, { clipPath: 'inset(0 0 0 0)' }], { duration: FLIP_MS, easing: EASE });
    const open = mode !== 'rail';
    if (open) closeFly();
    togBtn.title = 'Close sidebar (⌥L)';
    togBtn.setAttribute('aria-expanded', String(open)); rTog.setAttribute('aria-expanded', String(open));
    rTog.title = 'Open sidebar (⌥L)';
    if (open) paintList(); else paintRail();
    applySizes();
    paintBack(); // (the list beside the chat or not: its Back follows)
    // the desks' windows are laid out in pixels: lay them out again for the new width
    if (relayout && was !== mode && (was === 'open') !== (mode === 'open')) retileSoon();
  }
  function toggleSide() {
    focusLeave();
    if (narrow() || peek) { peek = !peek; if (peek) offPeek = api.back.push(() => { peek = false; offPeek = null; paintSide(); }); else { offPeek?.(); offPeek = null; } }
    else { folded = !folded; api.storage.set('folded', folded); }
    if (q) setSearch(false);
    paintSide();
    api.aiUsage?.live?.(foot);  // the sidebar's foot (fuel gauge) may have just come on screen
  }
  let offPeek = null;
  // which sections are open (Ready open, Working and Archive folded at first), kept on this device
  const secOpen = sectionsOpen(api.storage.get('sections'));
  /* round 18 item 4: the open Ready is grouped by status like the rail. Round 19 item 2 (Miguel, 3 Nov 2026: the
   * grouping IS the priority): only the order inside each group, Newest first / Oldest first, chosen in Settings ›
   * Chats & app screens and kept where stock Chats keeps its order (api.sessions.order; its Priority or By subject
   * reads as Newest here). The sidebar's own sort control shows only when 'Show sort control in sidebar' is on. */
  const workingOrder = () => globalThis.WizChatsListModel.workingOrderOf(api.sessions.workingOrder?.());
  const setWorkingOrder = o => { api.sessions.setWorkingOrder?.(o); readSessions(); paintList(true); paintRail(true); };
  const readyOrder = () => groupOrder(api.sessions.order?.());
  // (round 20 item 9: off = one flat Ready; round 24c: 'status' / 'project' / 'none', the old on/off switch read as status / none, a saved 'subject' as project)
  const groupBy = () => (typeof actOn === 'function' && actOn()) ? 'none' : api.storage.get('groupReady') === true ? 'status' : ['project', 'subject'].includes(api.storage.get('groupBy')) ? 'project' : 'none';
  const groupReady = () => groupBy() === 'status';
  // round 22: the rows' times stay true ("5m" becomes "6m") without a repaint: one cheap text pass every 10 s
  const tickTimes = () => { const now = Date.now(); for (const t of scroll.querySelectorAll('.aad-time')) { const v = shortTime(t.dataset.at, now); if (v && t.textContent !== v) t.textContent = v; } api.after(10e3, tickTimes); };
  api.after(10e3, tickTimes);
  const setOrder = o => { api.sessions.setOrder?.(groupOrder(o)); paintList(true); paintRail(true); paintSetting(); };
  // Activity's one sort (issue 1336): Chats' own Ready order, where Priority reads as Needs you first.
  const actOrder = () => globalThis.WizChatsListModel.activitySortOf(api.sessions.order?.());
  const setActOrder = o => { api.sessions.setOrder?.(globalThis.WizChatsListModel.activitySortOf(o)); readSessions(); paintList(true); paintRail(true); paintSetting(); };
  const setGroup = m => { m = groupMode(m); api.storage.set('groupBy', m); api.storage.set('groupReady', m === 'status'); paintSetting(); paintList(true); paintRail(true); };
  api.listen(globalThis, 'wos:prefs', () => { if (root.dataset.aadSide !== 'rail') paintList(); else paintRail(); paintSetting(); });
  const unpeek = () => { if (!peek) return; peek = false; offPeek?.(); offPeek = null; paintSide(); };
  api.listen(togBtn, 'click', toggleSide); api.listen(rTog, 'click', toggleSide);
  api.listen(shade, 'click', unpeek);
  api.listen(globalThis, 'wos:thread-tracker', () => paintList());
  // A draft appeared or went (wizard-ux issue 1445): the Activity rows' ✎ Draft follows at once.
  api.listen(globalThis, 'wos:drafts-keys', () => { if (root.dataset.aadSide === 'rail' || !(typeof actOn === 'function' && actOn())) return; readSessions(); paintList(); });
  // a switch turned on or off (Channels, issue 1256): the pane, the "# channel" lines and the Focus a feed held
  api.listen(globalThis, 'wos:experience', () => { if (chatThread === FEED && !feedOn()) paintTop(); paintSetting(); paintAgents(); if (root.dataset.aadSide === 'rail') return; paintChan(); readSessions(); paintList(true); });
  api.listen(globalThis, 'resize', syncSide);
  api.keys.on({ down: e => { if (!isSideKey(e) || e.repeat) return false; toggleSide(); return true; } });
  /* ---------- round 9 (Miguel, 2 Nov 2026): the panels resizable by drag (round 15: the sidebar, the open apps, the app panel) ----------
   * A thin separator on its inner edge (a hairline in the accent on hover); drag it, or ←/→ (⇧ for bigger steps) with it
   * focused; a double click or Enter goes back to the default. Kept per device. */
  let sized = { ...(api.storage.get('widths') || {}) }, sizing = '', laidOut = '';
  const GRIP_NAMES = { side: 'Resize the chats sidebar', tabs: 'Resize the open apps', app: 'Resize the app panel' };
  const SIZE_VARS = { side: '--aad-side-w', tabs: '--aad-tabs-px', app: '--aad-app-px' };
  const vw = () => globalThis.innerWidth || 1440;
  const clampTo = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
  /** each panel's width now (the owner's, else the default) within its limits: [now, lo, hi]; the app panel always
   * leaves the middle 320 px (the composer and the orb) */
  function sizes() {
    const W = vw(), hi = Math.round(Math.min(SIZE_LIMITS.side[1], W * .32));
    const side = clampTo(sized.side ?? SIDE, SIZE_LIMITS.side[0], hi);
    const tabs = clampTo(sized.tabs ?? COLS.tabs, SIZE_LIMITS.tabs[0], Math.min(SIZE_LIMITS.tabs[1], W * .25));
    const sideNow = root.dataset.aadSide === 'open' ? side : RAIL, tabsNow = root.dataset.aadTabs === 'rail' ? COLS.tabsRail : tabs;
    const appHi = Math.min(SIZE_LIMITS.app[1], W - sideNow - tabsNow - 320);
    // an app shown with its companion pane (Video Editor's video + Feedback) needs room for both columns: wider by
    // default until the owner sizes the panel himself (James, 6 Nov 2026)
    // An app with its companion (Video Editor + Feedback) needs room for two columns: the panel opens at least
    // 900px / 62% wide while the companion shows, even over a narrower width the owner chose for single apps,
    // and returns to that chosen width when the companion closes (James, 6 Nov 2026).
    const app = clampTo(Math.round(paneWins() > 1 ? Math.max(sized.app ?? 0, 900, W * .62) : sized.app ?? Math.min(720, Math.max(420, W * .4))), SIZE_LIMITS.app[0], appHi);
    return { side: [side, SIZE_LIMITS.side[0], hi], tabs: [tabs, SIZE_LIMITS.tabs[0], Math.min(SIZE_LIMITS.tabs[1], W * .25)], app: [app, SIZE_LIMITS.app[0], appHi] };
  }
  /* round 10 (Miguel: dragging felt laggy): a drag writes only what changed, once a frame. While a grip is held
   * (data-aad-resizing) the shown desks' windows follow their desk by CSS (desktop.css), and the page's resize (the
   * desks tiled again, every app frame, the orb, the composer) waits for the release: once, at pointerup. */
  const shownVars = {}, shownAria = {};
  function applySizes() {
    const s = sizes();
    placePanes(s);
    for (const id of Object.keys(SIZE_VARS)) {
      const px = s[id][0] + 'px';
      if (shownVars[id] !== px) { shownVars[id] = px; root.style.setProperty(SIZE_VARS[id], px); }
      const g = grip[id]; if (!g) continue;
      const aria = `${s[id][0]},${s[id][1]},${Math.round(s[id][2])}`; if (shownAria[id] === aria) continue; shownAria[id] = aria;
      g.setAttribute('aria-valuenow', String(s[id][0])); g.setAttribute('aria-valuemin', String(s[id][1])); g.setAttribute('aria-valuemax', String(Math.round(s[id][2])));
    }
    // the desks' windows are laid out in pixels: again when a width changed (after the drag, while one is held)
    const sig = Object.keys(SIZE_VARS).map(id => s[id][0]).join(',');
    if (sig !== laidOut) { laidOut = sig; if (!sizing || !root.dataset.aadResizing) relayoutSoon(); }
  }
  /* One re-tile (the shell's own: a page resize) once a change has settled, coalesced: the windows of the shown panels
   * follow their desks by CSS meanwhile (desktop.css), so nothing re-lays out per frame and the wallpaper is untouched
   * (core/skins.js ignores a resize that leaves the page its size). */
  let retileOff = null;
  /* round 14 (Miguel: the fold must feel instant): a shown desk's lone window follows it by CSS and the desks out of
   * sight keep the open sidebar's geometry (desktop.css), so a fold needs no re-tile; only a desk tiling two or more
   * windows side by side does. The shell's re-tile re-laid out every desk's app (~100 layouts) right after each fold. */
  const needsTile = () => { const groups = new Map(); for (const w of host?.windows() || []) if (w.tiled) { const n = (groups.get(w.deskId) || 0) + 1; if (n > 1) return true; groups.set(w.deskId, n); } return false; };
  function retileSoon(ms = FLIP_MS + 20) { retileOff?.(); retileOff = api.after(ms, () => { retileOff = null; if (needsTile()) globalThis.dispatchEvent?.(new Event('resize')); syncOrb(); }); }
  const relayoutSoon = () => retileSoon();
  function setSize(id, w, keep) {
    sized = { ...sized, [id]: Math.round(w) }; applySizes();
    sized = { ...sized, [id]: sizes()[id][0] };   // what shows is what is kept
    if (keep) api.storage.set('widths', sized);
  }
  function resetSize(id) { const { [id]: _, ...rest } = sized; sized = rest; api.storage.set('widths', sized); applySizes(); }
  /* (round 10) an app's page lays itself out again whenever its frame changes width, and the shown apps run in this
   * page's thread: while a grip is held their frames keep a fixed width (the window clips or shows its own background
   * at the moving edge), refitted a few times a second, and once more on release. */
  const FRAME_FIT_MS = 120;
  const shownFrames = () => (host?.windows() || []).filter(w => w.visible && w.tiled).map(w => host.frame(w.id)).filter(Boolean);
  function fitFrames(list) {
    for (const f of list) f.style.removeProperty('width');
    const ws = list.map(f => f.getBoundingClientRect().width);
    list.forEach((f, i) => { if (ws[i] > 0) f.style.setProperty('width', Math.round(ws[i]) + 'px'); });
  }
  const grips = el('div', 'aad-grips');
  const grip = {};
  for (const id of ['side', 'tabs', 'app']) {
    const g = el('div', 'aad-grip', { role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'aria-label': GRIP_NAMES[id], title: GRIP_NAMES[id] + ' · double-click: back to default', 'data-grip': id });
    grips.append(g); grip[id] = g;
    // the sidebar grows to the right, the open-apps column and the app panel to the left
    const sign = () => id === 'tabs' ? (root.dataset.aadDockEdge === 'start' ? 1 : -1) : (id === 'side' ? 1 : -1) * (root.dataset.aadPaneSide === 'end' ? -1 : 1);
    let drag = null, cancelFrame = null;
    // (the pointer's latest x, applied once a frame: a fast mouse sends several moves a frame)
    const step = t => {
      cancelFrame = null; if (!drag || drag.at === drag.done) return;
      drag.done = drag.at; setSize(id, drag.w + (drag.at - drag.x) * sign(), false);
      if (t && t - drag.fit > FRAME_FIT_MS) { drag.fit = t; fitFrames(drag.frames); }
    };
    api.listen(g, 'pointerdown', e => {
      if (e.button) return; e.preventDefault();
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      drag = { x: e.clientX, at: e.clientX, done: e.clientX, w: sizes()[id][0], fit: 0, frames: shownFrames() }; sizing = id; g.classList.add('is-drag'); root.dataset.aadResizing = id;
      fitFrames(drag.frames);
    });
    api.listen(g, 'pointermove', e => { if (!drag) return; drag.at = e.clientX; if (!cancelFrame) cancelFrame = api.frame(step); });
    const end = () => {
      if (!drag) return;
      cancelFrame?.(); cancelFrame = null; step(); const held = drag.frames; drag = null;
      for (const f of held) f.style.removeProperty('width');
      // the desks tiled for the final widths (and the orb placed) BEFORE the CSS follow is lifted: no jump on release
      sizing = ''; g.classList.remove('is-drag'); globalThis.dispatchEvent?.(new Event('resize')); syncOrb();
      delete root.dataset.aadResizing; api.storage.set('widths', sized);
    };
    api.listen(g, 'pointerup', end); api.listen(g, 'pointercancel', end); api.listen(g, 'lostpointercapture', end);
    api.listen(g, 'dblclick', () => resetSize(id));
    api.listen(g, 'keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); resetSize(id); return; }
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!dir) return;
      e.preventDefault(); sizing = id; setSize(id, sizes()[id][0] + dir * sign() * (e.shiftKey ? 64 : 16), true); sizing = '';
    });
  }
  api.listen(globalThis, 'resize', () => applySizes());
  scene.append(grips);

  /* ---------- contextual Chats search (apps stay in the global launcher) ---------- */
  let q = '';
  function setSearch(on) {
    if (on && root.dataset.aadSide === 'rail') { if (narrow()) { peek = true; offPeek = api.back.push(() => { peek = false; offPeek = null; paintSide(); }); } else { folded = false; api.storage.set('folded', false); } paintSide(); }
    searchBox.hidden = cancelBtn.hidden = !on; wsBtn.hidden = findBtn.hidden = on;
    if (!on) { q = ''; field.value = ''; offSearch?.(); offSearch = null; } else if (!offSearch) offSearch = api.back.push(() => { offSearch = null; setSearch(false); });
    paintList(true);
    if (on) field.focus?.({ preventScroll: true });
  }
  let offSearch = null;
  api.listen(findBtn, 'click', () => setSearch(true)); api.listen(rFind, 'click', () => setSearch(true));
  api.listen(cancelBtn, 'click', () => setSearch(false));
  api.listen(field, 'input', () => { q = field.value; paintList(); });
  api.listen(field, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scroll.querySelector('button')?.click(); } });
  // Home (Miguel, 2 Nov 2026) = the empty new chat: the skin's background, the composer and the orb, no greeting. + goes
  // there from anywhere (and ⌥`, the desktop's own Home key).
  const newChat = () => { draftWant = false; if (chatThread === NOTE) chatThread = null; if (chatThread === FEED || feedOn()) { chatThread = null; api.sessions.channelBack?.(); } unpeek(); if (q) setSearch(false); closeMenu(); closeWs(); closeAll(); noteWant = false; oneList = false; api.sessions.newChat(); };
  /* round 15 (Miguel): Home = nothing open in front: the app panel hides (its app keeps running), a docked chat goes, the
   * new chat's composer at the bottom centre (the sidebar's ⌂, ⌥`) */
  const goHome = () => { if (pane) hidePanel({ home: false }); chatThread = null; newChat(); };
  const settings = () => { unpeek(); api.desk.settings(); };
  // + with a channel's feed in front posts in that channel: its own box (wizard-ux issue 1291). ⌂ still goes Home.
  // The sidebar's tab decides (wizard-ux issues 1308, 1310): Activity, a blank new chat (a feed left in the column closes);
  // Channels with a channel open, its box; the Channels list with none open, + / ⌥N start a new channel.
  const newOrPost = () => { if (chatThread === FEED && feedOn() && api.sessions.channelView?.() !== 'activity' && api.sessions.channelPost?.()) { closeMenu(); return; } newChat(); };
  const plus = () => { if (!feedOn() && api.sessions.channelNew?.()) { closeMenu(); return; } newOrPost(); };
  api.listen(newBtn, 'click', plus); api.listen(rNew, 'click', plus);
  api.listen(setBtn, 'click', settings); api.listen(rSet, 'click', settings);
  // the cog's count (System notices set to Badge, …): WosBell.attention, as on the stock desktop's cog and the phone's gear
  const setCounts = [setBtn, rSet].map(b => { const c = el('b', 'aad-count aad-setn', { 'aria-hidden': 'true' }); c.hidden = true; b.append(c); return c; });
  const paintCog = at => {
    const n = at?.n | 0, t = !n ? '' : n > 99 ? '99+' : String(n);
    for (const c of setCounts) { c.textContent = t; c.hidden = !n; }
    for (const b of [setBtn, rSet]) b.setAttribute('aria-label', n ? `Settings, ${n} ${at.label}` : 'Settings');
  };
  paintCog(api.desk.attention?.(paintCog));

  /* ---------- an app's icon: its logo, else its sigil in its colour (the sheet's own tile) ---------- */
  const metaOf = id => api.apps.list().find(a => a.id === id) || { id, name: appName(id) || id };
  function appTile(id, cls = 'aad-tile') {
    const a = metaOf(id), t = el('span', cls, { 'aria-hidden': 'true' });
    t.style.setProperty('--c', colourOf(a));
    t.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    api.apps.logo(id).then(url => {
      if (!url || !t.isConnected) return;
      const im = el('img', 'aad-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { t.replaceChildren(im); t.classList.add('is-logo'); }, () => {});
    });
    return t;
  }
  // round 12: a Home icon is a desk (desk = its number): that desk; round 13: it opens as a tab (the New tab page goes)
  // round 15: an app opens as the panel (its desk, or a new desk for it); the All apps sheet goes
  const goApp = (id, desk = null, then = null, place = null) => {
    unpeek(); closeAll(); wantAppFocus(id === CHATS ? '' : id);
    if (id !== CHATS && panes.get().focus !== 'app') panes.set({ focus: 'app' });
    if (id === CHATS && (desk == null || desk === mainChats()?.desk)) { goHome(); return; }
    const d = (desk != null && desks().find(x => x.desk === desk && x.id === id)) || desks().find(x => x.id === id);
    want = id; if (!d) loading(id);
    const go = () => { if (d) api.nav.goDesk(d.desk); else api.apps.openDesk(id, place); then?.(); };
    // the Chats desk stays behind the panel: Home's new chat there first (never its bare list's empty pane beside the app)
    if (!chatsFresh && !chatThread && mainChats()) { chatsFresh = true; api.sessions.newChat(); }
    // Deep links deliver their page to the frame in this same call, not a timer later.
    go();
  };
  let chatsFresh = false;
  /* App keys (Miguel, 4 Nov 2026: drive every app from the keyboard): the app picked by key (⌥1–⌥0, ⌥[ ]) or by click
   * takes the keyboard once it is the panel (its own typing, its own plain keys); its ⌥ keys (data-wz-key) the view
   * presses for it (App keys, at the key handler). */
  let focusWant = '', focusing = false, focusGeneration = 0, focusHosted = null;
  function wantAppFocus(id) { focusWant = id; focusing = false; focusHosted = null; focusGeneration++; }
  const paneFrame = () => host?.frame(panelWindow()?.id) || null;
  function focusFrame(tries = 0, generation = focusGeneration) {
    if (generation !== focusGeneration) return; // an old timer cannot consume a newer request
    if (!focusWant) { focusing = false; return; }
    const f = pane && pane.id === focusWant ? paneFrame() : null;
    if (!f || !frameReady()) { if (tries < 60) api.after(150, () => focusFrame(tries + 1, generation)); else { focusWant = ''; focusing = false; } return; }
    // One host lifecycle focus per request, not once per iframe-focus retry.
    // Some documents refuse browser focus; that must never re-enter routing.
    const id = panelWindow()?.id;
    if (id && focusHosted !== id) { focusHosted = id; host?.focus(id, { scroll: false }); }
    if (generation !== focusGeneration) return;
    try { f.focus?.({ preventScroll: true }); f.contentWindow?.focus?.(); } catch (_) {}
    // (the shell can still focus the window itself right after the desk switch: once more, then it is the app's)
    if (tries < 60 && doc.activeElement !== f) { api.after(150, () => focusFrame(tries + 1, generation)); return; }
    focusWant = ''; focusing = false;
  }

  /* ---------- round 15: All apps (round 16: the right column's last row, ⌥T) ----------
   * A sheet over the main area: every app as a big icon with its name (the open ones, then every installed app, then
   * Get more; paged, home.js), on a soft veil over the skin's background; a pick opens it as the panel; a right click
   * gives Pin / Unpin, Open, Add to Home Screen, its App Store page; Esc or a click on the veil closes it. */
  const canPin = id => !!api.apps.homeScreen?.can?.(id);
  const oneEach = () => { const seen = new Set(); return desks().filter(d => d.id !== CHATS && !seen.has(d.id) && seen.add(d.id)); };
  // (round 16 item 7: no All apps grid any more; Home's model still gives the ⌥ letters, never shown)
  const home = homeView(api, { goApp: (id, desk) => goApp(id, desk), getMore: () => api.apps.openDesk('app-store'), lit, badgeText, desks: oneEach, paged: true, menu: (a, at) => openAppMenu(a, at) });
  /* the picker (round 16 item 7; the shared sheet, chrome.js): installed apps neither open nor pinned, For people open,
   * For agents folded, + Get more last (the App Store as it is); ⌥T or the column's + */
  const allOpenNow = () => !!chrome.isOpen;
  function openAll() { if (chrome.isOpen) return; unpeek(); closeMenu(); closeWs(); if (q) setSearch(false); chrome.open({ includeOpen: true, people: 'For people' }); }
  function closeAll() { chrome.close(); }
  api.listen(vtAll, 'click', openAll);

  /* ---------- round 15: the pinned apps (round 16: the right column's top) ---------- */
  // Launcher links (e.g. Video Editor) live in kinds.dev, not the quick-app list.
  // Validate pins against the installed catalog, never just that quick projection.
  const pinApps = () => { const K = api.apps.kinds?.() || {}; return [...api.apps.list(), ...(K.apps || []), ...(K.dev || [])]; };
  const installedIds = () => pinApps().filter(a => a && a.id && a.id !== CHATS).map(a => a.id);
  // (until he pins or unpins, the defaults follow the installed list: it can still be empty on the first paint)
  let pinsStored = api.storage.get('pins'), pins = pinsFrom(pinsStored, installedIds());
  const refreshPins = () => { pins = pinsFrom(Array.isArray(pinsStored) ? pinsStored : null, installedIds()); return pins; };
  const setPins = list => { pinsStored = list; pins = list; api.storage.set('pins', list); paintVt(true); };
  const pinApp = id => setPins(togglePin(refreshPins(), id));

  /* the quick actions (round 10): Open; Add to Home Screen (the Desks' own sheet, apps it would offer); the App Store
   * page (its own Update / Remove, behind the Store's own confirmations); Close for an open app (it stays installed) */
  function openAppMenu(a, at) {
    closeMenu(); closeWs();
    let isOpen = desks().some(d => d.id === a.id);
    const acts = [];
    // round 15: Pin / Unpin first (round 16: the right column's top), then Open
    if (a.id !== CHATS) acts.push(pins.includes(a.id) ? ['unpin', 'Unpin', 'unpin', () => pinApp(a.id)] : ['pin', 'Pin', 'pin', () => pinApp(a.id)]);
    // round 16 item 6: from the right column, Move up / Move down within its group
    const col = a.col, item = { id: a.id, desk: a.desk ?? null };
    if (col && col.index > 0) acts.push(['up', 'Move up', 'up', () => dropTo(item, { group: col.group, index: col.index - 1 })]);
    if (col && col.index >= 0 && col.index < col.n - 1) acts.push(['down', 'Move down', 'dn', () => dropTo(item, { group: col.group, index: col.index + 1 })]);
    acts.push(['open', 'Open', 'expand', () => goApp(a.id, a.desk)]);
    if (a.id === CHATS) isOpen = false;   // round 12: a Chats desk offers Open only
    else if (canPin(a.id)) acts.push(['home', 'Add to Home Screen', 'plus', () => api.apps.homeScreen.offer(a.id)]);
    if (api.apps.get && a.id !== CHATS && !a.system) acts.push(['store', 'App Store page', 'apps', () => { closeAll(); api.apps.get(a.id); }]);
    if (isOpen && api.apps.close) acts.push(['close', 'Close', 'x', () => { api.apps.close(a.id); api.after(120, () => { home.paint(true); paintVt(true); }); }]);
    const card = el('div', 'aad-pop aad-appmenu', { role: 'menu', 'aria-label': a.name });
    card.append(el('h3', 'aad-pop-h', { text: a.name }));
    for (const [k, word0, ico, run] of acts) {
      const it = el('button', 'aad-pop-i', { type: 'button', role: 'menuitem', 'data-act': k });
      it.append(icon(ico), el('span', '', { text: word0 }));
      api.listen(it, 'click', () => { closeMenu(); run(); });
      card.append(it);
    }
    scene.append(card);
    const h = acts.length * 40 + 44, H = globalThis.innerHeight || 900, W = globalThis.innerWidth || 1440;
    card.style.left = Math.round(Math.max(8, Math.min(at.x, W - 236))) + 'px';
    card.style.top = Math.round(at.y + h > H - 8 ? Math.max(8, at.y - h) : at.y) + 'px';
    const cellEl = at.el || null; cellEl?.classList.add('is-held');
    menu = { card, wrap: cellEl || card }; offMenuBack = api.back.push(closeMenu);
    api.after(0, () => card.querySelector('button')?.focus?.({ preventScroll: true }));
  }
  // round 15: the grid shows in the All apps sheet only (Home is the clean background and the composer)
  function paintHome() {
    if (root.dataset.aiFront !== 'list') root.dataset.aadHome = ''; else delete root.dataset.aadHome;
  }
  // the grid's box is fixed (desktop.css); a composer grown tall with words clips its lowest row instead of moving it
  let clipShown = '';
  function placeHome() {
    if (home.el.hidden) return;
    const c = homeComposer(), r = c?.getBoundingClientRect(), g = home.el.getBoundingClientRect();
    const px = r && r.top > 0 && r.top - 12 < g.bottom ? Math.max(0, Math.round(g.bottom - (r.top - 12))) + 'px' : '0px';
    if (px !== clipShown) { clipShown = px; home.el.style.setProperty('--aad-hg-clip', px); }
  }

  /* ---------- a chat row: click opens it; ⋯ (on hover) or a right click opens its menu ---------- */
  function chatRow(s, cur, inProject = false) {
    const wrap = el('div', 'aad-rw' + (s.id === cur ? ' is-cur' : ''), { 'data-sid': s.id, 'data-kind': s.kind });
    if (khMarks.has(s.id)) wrap.dataset.aadKh = khMarks.get(s.id);   // (round 21: a repaint while ⌥ is held keeps the room for its keycap)
    const b = el('button', 'aad-row aad-chat', { type: 'button', ...(s.id === cur ? { 'aria-current': 'page' } : {}) });
    // a notification (round 5; round 20 item 6, Miguel: it stands out, subtly, in amber): a small amber bell before its
    // title in normal text; its unread dot amber too (a chat's stays the accent)
    if (s.note) { wrap.dataset.note = ''; b.append(icon('bell', 'aad-ico aad-bell')); }
    // (round 26: under a By project header the row drops the project, the header says it once; the full title stays its tip)
    const t0 = inProject ? titleInProject(s) : s.title;
    const title = el('span', 'aad-row-t', { text: t0, ...(t0 !== s.title ? { title: s.title } : {}) });
    // A Working chat's ask line goes when the thread tracker is on (its dots carry it); no background
    // helper pill either way: the spinner already shows it (James, 7 Nov 2026).
    const ask = s.workingAsk && !globalThis.WosThreadTracker?.onFor?.(ttAgent(s.id)) ? s.workingAsk : null; // main agent only
    if (ask) title.append(el('span', 'aad-working-ask', { text: `${ask.state === 'needs_you' ? 'Needs you' : 'Your call'}: ${ask.ask}` }));
    // Channels on (issue 1256): the chat's channel, muted on a second line, as in Chats' Activity
    if (s.channel) title.append(el('span', 'aad-chan-line', { text: `# ${s.channel}` }));
    // (issue 1336: another agent's thread names it after the channel, "# WizardOS Chats · Philosopher")
    if (s.channel && s.agentName) title.lastChild?.append?.(` · ${s.agentName}`);
    // A saved, unsent draft (switch wizard/draft-marks, wizard-ux issue 1445): "✎ Draft" leads the second line (its CSS)
    if (s.draft) { wrap.dataset.draft = ''; if (!s.channel) title.append(el('span', 'aad-chan-line aad-draft-line')); }
    b.append(title);
    const dots = ttDots(s.id) ? globalThis.WosThreadTracker.dotsNode(s.id, ttAgent(s.id)) : null;
    if (dots) b.append(dots);
    // round 22 (Miguel, 4 Nov 2026: the time says more than a status tag, and makes Newest / Oldest readable): how long
    // ago its last message came in, muted at the row's end (a working chat has its spinner instead)
    if (s.kind !== 'working' && s.at) { const t = shortTime(s.at, Date.now()); if (t) b.append(el('span', 'aad-time', { 'data-at': String(s.at), text: t })); }
    if (s.pinned) b.append(icon('pin', 'aad-ico aad-pin'));
    // (Activity with Channels on, issue 1336: the row's one marker, amber over green; no purple unread dot)
    const mk = typeof s.mark === 'string' ? s.mark : null;
    if (mk !== null ? s.kind === 'working' || mk === 'needs' || mk === 'new' : s.kind === 'working' || (s.kind === 'ready' && s.unread)) b.append(el('i', 'aad-st' + (s.kind === 'working' ? '' : mk === 'needs' ? ' is-needs' : ' is-new'), { 'aria-hidden': 'true' }));
    b.setAttribute('aria-label', `${s.note ? 'Notification: ' : ''}${s.title}${s.kind === 'working' ? ', working' : s.kind === 'snoozed' ? ', snoozed' : s.unread ? ', ready, new' : s.snoozed && s.note ? ', snoozed' : s.kind === 'ready' ? ', ready' : ''}${s.pinned ? ', pinned' : ''}`);
    if (ask) b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, ${ask.state === 'needs_you' ? 'Needs you' : 'Your call'}: ${ask.ask}`);
    if (mk === 'needs') b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, needs you`);
    if (s.channel) b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, in # ${s.channel}${s.agentName ? `, ${s.agentName}` : ''}`);
    if (s.draft) b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, unsent draft`);
    api.listen(b, 'click', () => { if (q) setSearch(false); unpeek(); noteWant = !!s.note; feedFocus = null; stepAt = s.id; fromFeed = null; api.sessions.open(s.id); });
    api.listen(b, 'contextmenu', e => { e.preventDefault(); openMenu(wrap, s, { x: e.clientX, y: e.clientY }); });
    wrap.append(b);
    if ((s.actions || []).some(k => ACTS.some(([a]) => a === k))) {
      const m = el('button', 'aad-more', { type: 'button', 'aria-label': `More for ${s.title}`, title: 'More', 'aria-haspopup': 'menu' }); m.append(icon('more'));
      api.listen(m, 'click', e => { e.stopPropagation?.(); openMenu(wrap, s); });
      wrap.append(m);
    }
    return wrap;
  }
  let menu = null, offMenuBack = null;
  function openMenu(wrap, s, at = null) {
    closeMenu();
    const acts = ACTS.filter(([k]) => (s.actions || []).includes(k));
    if (!acts.length) return;
    const card = el('div', 'aad-pop aad-rowmenu', { role: 'menu', 'aria-label': s.title });
    for (const [k, w0] of acts) {
      const it = el('button', 'aad-pop-i' + (k === 'done' ? ' is-file' : ''), { type: 'button', role: 'menuitem', 'data-act': k });
      it.append(icon(k), el('span', '', { text: k === 'pin' && s.pinned ? 'Unpin' : w0 }));
      // the row goes on this frame; the later pass reconciles
      api.listen(it, 'click', () => { closeMenu(); api.sessions.act(s.id, k); readSessions(); paintList(true); api.after(120, () => { readSessions(); paintList(true); }); });
      card.append(it);
    }
    scene.append(card);
    const r = wrap.getBoundingClientRect(), h = acts.length * 40 + 12, H = globalThis.innerHeight || 900;
    const x = at ? at.x : r.right - 8, y0 = at ? at.y : r.bottom + 4;
    card.style.left = Math.round(Math.max(8, Math.min(x, (globalThis.innerWidth || 1440) - 228))) + 'px';
    card.style.top = Math.round(y0 + h > H - 8 ? Math.max(8, (at ? at.y : r.top - 4) - h) : y0) + 'px';
    menu = { card, wrap }; wrap.classList.add('is-held');
    offMenuBack = api.back.push(closeMenu);
    api.after(0, () => card.querySelector('button')?.focus?.({ preventScroll: true }));
  }
  function closeMenu() {
    if (!menu) return;
    menu.card.remove(); menu.wrap.classList.remove('is-held'); if (menu.wrap.hasAttribute('aria-expanded')) menu.wrap.setAttribute('aria-expanded', 'false'); menu = null; offMenuBack?.(); offMenuBack = null;
  }
  /** round 19 item 2 / round 22 / round 25 (Miguel, 4 Nov 2026: sort and group right in the sidebar, as two separate
   * drop-downs, since they are two different choices): kind 'sort' lists Newest / Oldest first, kind 'group' lists
   * By status / By project / One list, the current one checked */
  function openSortMenu(btn, kind = 'sort') {
    if (menu?.wrap === btn) { closeMenu(); return; }
    closeMenu();
    const isWorking = kind === 'working-sort', isAct = kind === 'act-sort', isSort = kind === 'sort' || isWorking || isAct;
    const card = el('div', 'aad-pop aad-sortmenu', { role: 'menu', 'aria-label': isAct ? 'Sort' : isWorking ? 'Sort Working' : isSort ? 'Sort Ready' : 'Group Ready', 'data-menu': kind });
    const item = (on, w0, attrs, fn) => {
      const it = el('button', 'aad-pop-i' + (on ? ' is-on' : ''), { type: 'button', role: 'menuitemradio', 'aria-checked': String(on), ...attrs });
      it.append(on ? icon('check') : el('span', 'aad-ico', { 'aria-hidden': 'true' }), el('span', '', { text: w0 }));
      api.listen(it, 'click', () => { closeMenu(); fn(); });
      return it;
    };
    card.append(el('h3', 'aad-pop-h', { text: isSort ? 'Sort' : 'Group' }));
    if (isAct) for (const [v, w0] of globalThis.WizChatsListModel.ACTIVITY_SORTS) card.append(item(v === actOrder(), w0, { 'data-act-order': v }, () => setActOrder(v)));
    else if (isWorking) for (const [v, w0] of globalThis.WizChatsListModel.WORKING_SORTS) card.append(item(v === workingOrder(), w0, { 'data-working-order': v }, () => setWorkingOrder(v)));
    else if (isSort) for (const [v, w0] of GROUP_ORDERS) card.append(item(v === readyOrder(), w0, { 'data-order': v }, () => setOrder(v)));
    else for (const [v, w0] of GROUP_MODES) card.append(item(v === groupBy(), w0, { 'data-group': v }, () => setGroup(v)));
    scene.append(card);
    const r = btn.getBoundingClientRect();
    card.style.left = Math.round(Math.max(8, Math.min(r.right - 200, (globalThis.innerWidth || 1440) - 216))) + 'px';
    card.style.top = Math.round(r.bottom + 4) + 'px';
    menu = { card, wrap: btn }; btn.classList.add('is-held'); btn.setAttribute('aria-expanded', 'true');
    offMenuBack = api.back.push(closeMenu);
    api.after(0, () => card.querySelector('.is-on')?.focus?.({ preventScroll: true }));
  }

  /* ---------- round 19 item 2: the order in Settings › Chats & app screens (this view's own group there) ---------- */
  const setNode = el('div', 'st-group aad-stg', { 'data-aad-setting': '' });
  function paintSetting() {
    if ((typeof actOn === 'function' && actOn())) {
      // Activity with Channels on (issue 1336): the one sort, no grouping (Channels does the grouping now).
      const ao = actOrder(), ar = el('div', 'st-chats-options', { role: 'radiogroup', 'aria-label': 'Sort Activity' });
      for (const [v, w0] of globalThis.WizChatsListModel.ACTIVITY_SORTS) {
        const b = el('button', 'st-row wz-row', { type: 'button', role: 'radio', 'aria-checked': String(v === ao), 'data-aad-act-order': v });
        const tx = el('span', 'st-tx'); tx.append(el('b', '', { text: w0 }));
        b.append(el('span', '', { 'aria-hidden': 'true', text: v === ao ? '◉' : '○' }), tx);
        api.listen(b, 'click', () => setActOrder(v));
        ar.append(b);
      }
      setNode.replaceChildren(el('h4', '', { text: 'AI apps view' }), el('p', 'aad-stg-l', { text: 'Sort Activity' }), ar,
        el('p', 'aad-stg-n', { text: 'Working and Ready follow this order; Recent is always newest first. The same choice as Chats\' own order.' }));
      return;
    }
    const o = readyOrder();
    const radios = el('div', 'st-chats-options', { role: 'radiogroup', 'aria-label': 'Order chats within each group' });
    for (const [v, w0] of GROUP_ORDERS) {
      const b = el('button', 'st-row wz-row', { type: 'button', role: 'radio', 'aria-checked': String(v === o), 'data-aad-order': v });
      const tx = el('span', 'st-tx'); tx.append(el('b', '', { text: w0 }));
      b.append(el('span', '', { 'aria-hidden': 'true', text: v === o ? '◉' : '○' }), tx);
      api.listen(b, 'click', () => setOrder(v));
      radios.append(b);
    }
    const gm = groupBy(), gw = el('div', 'st-chats-options', { role: 'radiogroup', 'aria-label': 'Group Ready', 'data-aad-groupready': '' });
    for (const [v, w0] of GROUP_MODES) {
      const b = el('button', 'st-row wz-row', { type: 'button', role: 'radio', 'aria-checked': String(v === gm), 'data-aad-group': v });
      const tx = el('span', 'st-tx'); tx.append(el('b', '', { text: w0 }));
      b.append(el('span', '', { 'aria-hidden': 'true', text: v === gm ? '◉' : '○' }), tx);
      api.listen(b, 'click', () => setGroup(v));
      gw.append(b);
    }
    setNode.replaceChildren(el('h4', '', { text: 'AI apps view' }), el('p', 'aad-stg-l', { text: 'Group Ready' }), gw,
      el('p', 'aad-stg-l', { text: 'Order Ready chats' }), radios,
      el('p', 'aad-stg-n', { text: 'One list follows this order across chats. By status or project keeps the group order, with this order inside each group. The same choice as Chats\' own order; Priority or By subject there reads as Newest first here.' }));
  }
  paintSetting();
  api.desk.setting?.('ai-apps-order', setNode);

  /* ---------- paint the sidebar (only when what it lists changed: renders come often while a chat works) ---------- */
  const label = text => el('h3', 'aad-lab', { text });
  // Sends a graceful restart holds (wizard-ux issue 1362, wizard/graceful-restart): their own Saved heading under
  // Working, only while there are any (the list model's `saved`), so a held send never counts as Working.
  function savedSec(rows, cur) {
    if (!rows?.length) return [];
    const on = secOpen.saved !== false;
    const hd = el('button', 'aad-lab aad-sec', { type: 'button', 'data-sec': 'saved', 'aria-expanded': String(on), 'aria-controls': 'aad-sec-saved', 'aria-label': `Saved, ${rows.length}${on ? '' : ', folded'}` });
    hd.append(el('span', 'aad-sec-w', { text: 'Saved' }), el('span', 'aad-sec-m', { 'aria-hidden': 'true', text: String(rows.length) }), icon('down', 'aad-ico aad-sec-c'));
    api.listen(hd, 'click', () => { secOpen.saved = !on; api.storage.set('sections', { ...secOpen }); paintList(true); });
    const body = el('div', 'aad-sec-b', { id: 'aad-sec-saved', role: 'group', 'aria-label': 'Saved' }); body.hidden = !on;
    if (on) body.append(...rows.map(r => chatRow(r, cur)));
    return [hd, body];
  }
  let drawn = '', railDrawn = '';
  function paintList(force = false) {
    if (root.dataset.aadSide === 'rail') return;
    if (typeof paintChan === 'function') paintChan();
    const s = sessions || readSessions(), h = here();
    // A tab switch or picked chat moves the current mark in place, never rebuilding the list.
    const sig = JSON.stringify([q, archiveTop(root),
      secOpen, workingOrder(), readyOrder(), groupBy(), badgeText(CHATS), !!globalThis.WosThreadTracker?.on?.(), KINDS.map(k => (s[k] || []).map(r => [r.id, r.title, r.unread, r.pinned, r.state || '', r.at || '', r.workingAsk?.state || '', r.workingAsk?.ask || '', r.background || '', r.channel || '', (r.actions || []).join(), globalThis.WosThreadTracker?.on?.() ? globalThis.WosThreadTracker.dots(r.id, globalThis.WizLive?.agentOf?.(r.id) || '') : '']))]
      .concat([(s.saved || []).map(r => [r.id, r.title, r.mark || ''])], (typeof actOn === 'function' && actOn()) ? [actOrder(), s.older || 0, (typeof LKINDS !== 'undefined' ? LKINDS : KINDS).map(k => (s[k] || []).map(r => [r.id, r.title, r.mark, r.agentName || '', r.channel || '', r.at || '', r.pinned, (r.actions || []).join(), !!r.draft]))] : []));
    if (!force && sig === drawn && scroll.childElementCount) { markCurrent(h.thread); return; }
    drawn = sig;
    const out = [];
    if (q) {
      const seen = new Set(), hitsC = (typeof LKINDS !== 'undefined' ? LKINDS : KINDS).flatMap(k => s[k] || []).filter(r => !seen.has(r.id) && seen.add(r.id) && matches({ name: r.title }, q));
      if (hitsC.length) out.push(label('Chats'), ...hitsC.map(r => chatRow(r, h.thread)));
      if (!hitsC.length) out.push(el('p', 'aad-empty', { text: 'No chats by that name.' }));
    } else if ((typeof actOn === 'function' && actOn())) {
      // Activity with Channels on (issue 1336): Working, Ready (its one sort on the header), Recent with Show older,
      // then Snoozed and Archived folded at the very bottom, each with its count.
      for (const [k, word0] of ACT_SECTIONS) {
        const rows = s[k] || [], on = k === 'recent' ? secOpen.recent !== false : !!secOpen[k];
        const hd = el('button', 'aad-lab aad-sec', { type: 'button', 'data-sec': k, 'aria-expanded': String(on), 'aria-controls': 'aad-sec-' + k });
        hd.append(el('span', 'aad-sec-w', { text: word0 }));
        // (Ready's count is what waits on the owner: the pill; the others a muted number)
        if (rows.length && k !== 'recent') hd.append(el(k === 'ready' ? 'b' : 'span', k === 'ready' ? 'aad-sec-n' : 'aad-sec-m', { 'aria-hidden': 'true', text: rows.length > 99 ? '99+' : String(rows.length) }));
        hd.append(icon('down', 'aad-ico aad-sec-c'));
        hd.setAttribute('aria-label', `${word0}${rows.length && k !== 'recent' ? `, ${rows.length}` : ''}${on ? '' : ', folded'}`);
        api.listen(hd, 'click', () => { secOpen[k] = !on; api.storage.set('sections', { ...secOpen }); paintList(true); });
        const body = el('div', 'aad-sec-b', { id: 'aad-sec-' + k, role: 'group', 'aria-label': word0 }); body.hidden = !on;
        if (on) {
          if (rows.length) body.append(...rows.map(r => chatRow(r, h.thread)));
          else body.append(el('p', 'aad-empty', { text: !sessions ? 'Loading your chats…' : ACT_EMPTY[k] }));
          if (k === 'recent' && s.older) {
            const more = el('button', 'aad-more-older', { type: 'button', text: `Show older · ${s.older}` });
            api.listen(more, 'click', () => { actOlder = true; readSessions(); paintList(true); });
            body.append(more);
          }
        }
        if (k === 'ready') {
          const row = el('div', 'aad-sech'), word = (globalThis.WizChatsListModel.ACTIVITY_SORTS.find(([v]) => v === actOrder()) || globalThis.WizChatsListModel.ACTIVITY_SORTS[0])[1];
          const sort = el('button', 'aad-sortb aad-act-orderb', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Sort: ${word}. Change`, title: 'Sort' });
          sort.append(el('span', 'aad-sortb-w', { text: word.replace(' first', '') }), icon('down', 'aad-ico aad-sortb-c'));
          api.listen(sort, 'click', e => { e.stopPropagation?.(); openSortMenu(sort, 'act-sort'); });
          row.append(hd, sort); out.push(row, body);
        } else out.push(hd, body);
        if (k === 'working' && typeof savedSec === 'function') out.push(...savedSec(s.saved, h.thread));
      }
    } else {
      // The sidebar and its search are Chats only; app search belongs to the global launcher.
      // Wizard's own sections in place of Recents (round 5): Working, Ready, Archive last (archive-top: first), each folding under its header
      for (const [k, word0] of sectionsFor(root)) {
        const rows = k === 'working' ? globalThis.WizChatsListModel.workingSort(s[k], workingOrder()) : s[k] || [], on = !!secOpen[k];
        // round 18 item 4 (Miguel: the open sidebar built on the folded rail): Snoozed only when it holds chats, as on the rail
        if (k === 'snoozed' && !rows.length) continue;
        const hd = el('button', 'aad-lab aad-sec', { type: 'button', 'data-sec': k, 'aria-expanded': String(on), 'aria-controls': 'aad-sec-' + k });
        hd.append(el('span', 'aad-sec-w', { text: word0 }));
        // Ready keeps every row; its pill uses the same canonical unread feed as the phone menu.
        const unread = k === 'ready' ? badgeText(CHATS) : '';
        if (unread) hd.append(el('b', 'aad-sec-n', { 'aria-hidden': 'true', text: unread }));
        hd.append(icon('down', 'aad-ico aad-sec-c'));
        // folded (round 7): a minimal tally after the chevron: Working its count with a tiny spinner, Ready its count
        if (!on && k !== 'archive' && k !== 'ready' && rows.length) hd.append(el('span', 'aad-tally', { 'data-n': String(rows.length), 'aria-hidden': 'true' }));
        if (k === 'ready') hd.setAttribute('aria-label', `${word0}${unread ? `, ${unread} unread` : ''}${on ? '' : ', folded'}`);
        else if (!on && rows.length) hd.setAttribute('aria-label', `${word0}, ${rows.length}, folded`);
        api.listen(hd, 'click', () => { secOpen[k] = !secOpen[k]; api.storage.set('sections', { ...secOpen }); paintList(true); });
        const body = el('div', 'aad-sec-b', { id: 'aad-sec-' + k, role: 'group', 'aria-label': word0 }); body.hidden = !on;
        if (on && k === 'ready' && rows.length && groupBy() === 'none') {
          // round 20 item 9 (Miguel, 3 Nov 2026): one flat Ready (the order ⌥↓ walks), a tiny muted tag on Needs you /
          // Your call rows; 'Group Ready by status' in Settings brings the sub-headers back. In the chosen Sort (James,
          // 4 Nov 2026: Newest means newest first here, not Needs you on top)
          body.append(...readyFlat(rows, readyOrder()).map(r => chatRow(r, h.thread)));
        } else if (on && k === 'ready' && rows.length) {
          // round 18 item 4b: a sub-header per status with its count (the rail's words and order), its chats under it in
          // the chosen order (item 3: group first, then the order inside each)
          // (round 24c: or one per project, WizardOS, Messenger, … under their own headers)
          const groups = groupBy() === 'project' ? projectGroups(rows, readyOrder()) : readyGroups(rows, readyOrder());
          for (const g of groups) {
            // (only plain chats: no sub-header, as the rail shows Ready alone)
            if (groups.length === 1 && g.state === 'none') { body.append(...g.rows.map(r => chatRow(r, h.thread))); break; }
            const gh = el('div', 'aad-grp', { 'data-state': g.state.startsWith('proj:') ? 'project' : g.state, role: 'heading', 'aria-level': '4' });
            gh.append(el('span', 'aad-grp-w', { text: g.word }));
            const n = globalThis.WizChatsListModel.unreadCount(g.rows);
            if (n) gh.append(el('span', 'aad-grp-n', { text: n > 99 ? '99+' : String(n) }));
            body.append(gh, ...g.rows.map(r => chatRow(r, h.thread, g.state.startsWith('proj:'))));
          }
        } else if (on) {
          if (rows.length) body.append(...rows.map(r => chatRow(r, h.thread)));
          else body.append(el('p', 'aad-empty', { text: !sessions ? 'Loading your chats…' : EMPTY[k] }));
        }
        if (k === 'ready') {
          // round 22 / round 25 (Miguel, 4 Nov 2026): always on Ready's header, two quiet drop-downs: the grouping
          // (By status / By project / One list) and the order (Newest / Oldest); never a native select
          const row = el('div', 'aad-sech');
          const word0 = (GROUP_ORDERS.find(([v]) => v === readyOrder()) || GROUP_ORDERS[0])[1];
          const gw0 = (GROUP_MODES.find(([v]) => v === groupBy()) || GROUP_MODES[2])[1];
          const dd = (cls, kind, text, aria, title) => {
            const b = el('button', 'aad-sortb ' + cls, { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': aria, title });
            b.append(el('span', 'aad-sortb-w', { text }), icon('down', 'aad-ico aad-sortb-c'));
            api.listen(b, 'click', e => { e.stopPropagation?.(); openSortMenu(b, kind); });
            return b;
          };
          const group = dd('aad-groupb', 'group', gw0, `Group: ${gw0}. Change`, 'Group Ready');
          const sort = dd('aad-orderb', 'sort', word0.replace(' first', ''), `Sort: ${word0}. Change`, 'Sort Ready');
          row.append(hd, group, sort);
          out.push(row, body);
        } else if (k === 'working') {
          const row = el('div', 'aad-sech');
          const word = globalThis.WizChatsListModel.WORKING_SORTS.find(([v]) => v === workingOrder())[1];
          const sort = el('button', 'aad-sortb aad-working-orderb', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Sort Working: ${word}. Change`, title: 'Sort Working' });
          sort.append(el('span', 'aad-sortb-w', { text: word.replace(' first', '') }), icon('down', 'aad-ico aad-sortb-c'));
          api.listen(sort, 'click', e => { e.stopPropagation?.(); openSortMenu(sort, 'working-sort'); });
          row.append(hd, sort); out.push(row, body);
          if (typeof savedSec === 'function') out.push(...savedSec(s.saved, h.thread));
        } else out.push(hd, body);
      }
    }
    closeMenu();
    scroll.replaceChildren(...out);
  }
  /** the chat in front, marked in the list where it already is (round 14: no rebuild for it) */
  function markCurrent(id) {
    for (const w of scroll.querySelectorAll('.aad-rw')) {
      const on = !!id && w.dataset.sid === id;
      if (w.classList.contains('is-cur') === on) continue;
      w.classList.toggle('is-cur', on);
      const b = w.querySelector('.aad-row'); if (on) b?.setAttribute('aria-current', 'page'); else b?.removeAttribute('aria-current');
    }
  }
  /* The rail (round 12, Miguel: the icon tiles were unreadable: words, no status icons; round 16: 52 px). Snoozed, then
   * Ready and under it each stock Chats status with chats in it (STATES: core/chats.js stiKind's order; plain Ready
   * chats count in Ready only), each a count with a short word under it (RAIL_WORDS; the full words in its label).
   * Archive and Working stay in the open sidebar.
   * Round 19 item 1 (Miguel, 3 Nov 2026: fully usable while folded, nothing expands but ◫): a click opens that group's
   * FIRST chat in the docked chat column, the rail staying folded; the same item again opens the next one (wrapping).
   * The current group is marked and shows where the chat in front sits in it ('1/3' under its word). Hovering an item
   * (300 ms) shows a small flyout listing its chats (title, time); a click opens one; Esc closes it. ⌥↓ / ⌥↑ still walk
   * the whole Ready. Nothing advances on send (stock has no such setting). */
  let railLast = '';
  // (an app in front with a chat docked beside it: that chat is the current one, so ⌥↓ / ⌥↑ step from it)
  const curChat = () => { const h = here(); return h.thread || (h.note && stepAt) || (h.app && chatThread ? (chatThread === NOTE ? stepAt : chatThread) : null) || null; };
  const railMode = () => ({ status: 'groups', project: 'projects' })[groupBy()] || 'list';   // (round 24b: By project folds to its projects)
  const railNow = () => railActive(sessions || readSessions(), curChat(), railLast, readyOrder(), railMode());
  function railGo(key) {
    closeFly();
    const s = readSessions(), ids = railRows(s, key, readyOrder(), groupBy()).map(r => r.id); if (!ids.length) return;
    // The current chat stays marked across a grouping switch; the first click on a different rail row still starts it.
    const a = railNow(), same = a && a.key === key && (!railLast || railLast === key);
    const nx = railNext(ids, same ? curChat() : null); if (!nx) return;
    openChat(nx.id, key);
  }
  function openChat(id, key) {
    if (panes.get().focus !== 'chats') panes.set({ focus: 'chats' });
    if (q) setSearch(false);
    feedFocus = null; railLast = key; stepAt = id; noteWant = id.startsWith('notif:'); fromFeed = null; api.sessions.open(id);
    paintRail(true);
  }
  function railRow(k, n, word0, state = '', act = null, text = n > 99 ? '99+' : String(n)) {
    const key = state || k, sub = !!state, on = !!act && act.key === key;
    const label = `${word0}${n ? `, ${text}${k === 'ready' ? ' unread' : ''}` : ''}${on ? `, chat ${act.i + 1} of ${act.n} open` : ''}. Click opens ${on ? 'the next' : 'the first'}; hover lists them`;
    const b = el('button', 'aad-rk' + (sub ? ' is-sub' : '') + (n ? '' : ' is-zero') + (on ? ' is-on' : ''), { type: 'button', role: 'listitem', 'data-k': key, 'aria-label': label, ...(on ? { 'aria-current': 'true' } : {}) });
    // round 23c (Miguel, 4 Nov 2026: a tally of dots looked weird past four): every row is Working's pattern, ONE mark
    // and its number: a spinner while chats work, a solid dot once ready (amber in Ready, the ink in a status), a ring
    // when snoozed; nothing waiting = the faint empty ring alone
    const kind = key === 'working' ? 'spin' : key === 'snoozed' ? 'ring' : 'dot';
    const wk = el('span', 'aad-rk-n aad-rk-wk', { 'data-n': String(n), 'aria-hidden': 'true' });
    if (n) wk.append(el('i', 'aad-d is-' + kind), el('span', 'aad-rk-wn', { text }));
    else wk.append(el('i', 'aad-d is-none'));
    b.append(wk, el('span', 'aad-rk-w', { text: RAIL_WORDS[key] || word0 }));
    if (on && act.n > 1) b.append(el('span', 'aad-rk-p', { 'aria-hidden': 'true', text: `${act.i + 1}/${act.n}` }));
    api.listen(b, 'click', () => railGo(key));
    api.listen(b, 'pointerenter', () => flyWant(b, key, word0));
    api.listen(b, 'pointerleave', flyLeave);
    api.listen(b, 'focus', () => { if (fly) flyWant(b, key, word0); });
    return b;
  }

  function paintRail(force = false) {
    if (root.dataset.aadSide !== 'rail') return;
    // round 22 (Miguel, 4 Nov 2026: never both, it reads as double counting): One list = Ready alone; By status = each
    // status alone (plain chats as 'Other'), no Ready total over them
    const s = sessions || readSessions(), ready = s.ready || [], gm = groupBy(), grouped = gm !== 'none', groups = gm === 'project' ? projectGroups(ready, readyOrder()) : grouped ? stateGroups(ready) : [], act = railNow();
    const working = (s.working || []).length;
    const unread = badgeMap[CHATS] || 0, text = badgeText(CHATS);
    const sig = JSON.stringify([working, (s.snoozed || []).length, ready.length, unread, text, gm, groups.map(g => [g.state, g.rows.length, globalThis.WizChatsListModel.unreadCount(g.rows)]), act]);
    if (!force && sig === railDrawn && rList.childElementCount) return;
    railDrawn = sig;
    // Snoozed (when there are any), Ready (only when something is ready), then Ready's statuses
    // round 22 (Miguel, 4 Nov 2026): Working comes back on the rail (only while chats work), its count beside the
    // expanded list's tiny spinner, in the expanded list's order (Working, Snoozed, Ready)
    const out = working ? [railRow('working', working, 'Working', '', act)] : [];
    if ((s.snoozed || []).length) out.push(railRow('snoozed', s.snoozed.length, 'Snoozed', '', act));
    if (grouped && groups.length) out.push(...groups.map(g => railRow('ready', globalThis.WizChatsListModel.unreadCount(g.rows), g.state === 'none' ? 'Other' : g.word, g.state, act)));   // (round 24b: or each project)
    // nothing ready (Miguel, 4 Nov 2026): no Ready mark at all, so the rail reads just "9 Working"
    // (wizard-os issue 510: an unread count with no Ready chat behind it pointed at nothing, so it needs a Ready row)
    else if (ready.length) out.push(railRow('ready', unread, 'Ready', '', act, text));
    rList.replaceChildren(...out);
    if (fly) paintFly();
  }
  /* the hover flyout (round 19 item 1c): a small card beside the rail listing one item's chats */
  const FLY_MS = 300, FLY_OUT_MS = 220;
  let fly = null, flyOn = null, flyOff = null, flyBack = null;
  function flyWant(b, key, word0) {
    flyOff?.(); flyOff = null;
    if (fly) { if (fly.key !== key) showFly(b, key, word0); return; }
    flyOn?.(); flyOn = api.after(FLY_MS, () => { flyOn = null; if (root.dataset.aadSide === 'rail' && b.isConnected) showFly(b, key, word0); });
  }
  function flyLeave() { flyOn?.(); flyOn = null; if (!fly) return; flyOff?.(); flyOff = api.after(FLY_OUT_MS, () => { flyOff = null; closeFly(); }); }
  function showFly(b, key, word0) {
    const card = fly?.card || el('div', 'aad-pop aad-fly', { role: 'menu' });
    if (!fly) {
      api.listen(card, 'pointerenter', () => { flyOff?.(); flyOff = null; });
      api.listen(card, 'pointerleave', flyLeave);
      scene.append(card);
      flyBack = api.back.push(closeFly);
    }
    fly = { card, key, word: word0, at: b };
    paintFly();
  }
  function paintFly() {
    if (!fly) return;
    const { card, key, word } = fly, rows = railRows(sessions || readSessions(), key, readyOrder(), groupBy()), cur = curChat(), now = Date.now();
    card.setAttribute('aria-label', `${word}: ${rows.length}`);
    const items = rows.map(r => {
      const it = el('button', 'aad-pop-i aad-fly-i' + (r.id === cur ? ' is-cur' : ''), { type: 'button', role: 'menuitem', 'data-sid': r.id, ...(r.id === cur ? { 'aria-current': 'true' } : {}) });
      if (r.note) { it.dataset.note = ''; it.append(icon('bell', 'aad-ico aad-bell')); }   // (round 20 item 6: the amber bell here too)
      it.append(el('span', 'aad-fly-t', { text: (key.startsWith('proj:') ? titleInProject(r) : r.title) || 'Untitled' }), el('span', 'aad-fly-at', { text: shortTime(r.at, now) }));
      api.listen(it, 'click', () => { const k = fly?.key || key; closeFly(); openChat(r.id, k); });
      return it;
    });
    card.replaceChildren(el('h3', 'aad-pop-h', { text: `${word} · ${rows.length}` }), ...(items.length ? items : [el('p', 'aad-empty', { text: 'Nothing here now.' })]));
    const r = fly.at.getBoundingClientRect?.(), H = globalThis.innerHeight || 900, h = Math.min(420, rows.length * 34 + 44);
    const x = (rail.getBoundingClientRect?.().right || RAIL) + 6;
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(Math.max(8, Math.min((r?.top ?? 60) - 4, H - h - 8))) + 'px';
  }
  function closeFly() { flyBack?.(); flyBack = null; flyOn?.(); flyOn = null; flyOff?.(); flyOff = null; if (!fly) return; fly.card.remove(); fly = null; }
  let fuelSig = '';
  // (4 Nov 2026) the gauge stays without the network Home: read the AI usage feed directly and keep it polling while the foot shows
  const ownFuel = () => fuelOf(api.aiUsage?.state?.(), api.aiUsage?.provider?.());
  api.aiUsage?.live?.(foot);
  const paintFuel = () => { fuelSig = gaugeInto(doc, fuel, fuelSig, pg => { unpeek(); api.desk.settings(pg || 'ai'); }, ownFuel); };
  function paintBadges() {
    paintFuel();
    paintVt();
    if (root.dataset.aadSide === 'rail') paintRail(); else paintList();
    for (const n of scroll.querySelectorAll('[data-badge]')) { n.textContent = badgeText(n.dataset.badge); n.hidden = !n.textContent; }
    togBtn.setAttribute('aria-label', 'Close sidebar');
  }

  /* ---------- workspaces (top right): this Wizard, then the ones he manages ---------- */
  let wsPop = null, offWsBack = null;
  function paintWs() {
    const list = api.workspaces?.list() || [], own = list[0] || { name: agentName() };
    wsName.textContent = own.name;
    wsBtn.setAttribute('aria-label', `Workspace: ${own.name}. Switch workspace`); wsBtn.title = `Workspace: ${own.name}`;
    if (wsPop) paintWsPop(list);
  }
  function paintWsPop(list) {
    const rows = list.map(w => {
      const r = el('div', 'aad-wr' + (w.current ? ' is-on' : ' is-off'), { role: 'menuitemradio', 'aria-checked': String(!!w.current), tabindex: '-1' });
      const words = el('span', 'aad-ww'); words.append(el('b', '', { text: w.name }), el('small', '', { text: w.current ? 'This Wizard · on this screen' : `${w.org ? w.org + ' · ' : ''}${w.url ? 'Another Wizard · tap to switch' : 'Not connected yet'}` }));
      if (!w.current && w.url) {
        const go = () => { closeWs(); void globalThis.WizWorkspaces?.switch(w.id).catch(() => {}); };
        r.tabIndex = 0; r.setAttribute('tabindex', '0'); r.setAttribute('role', 'menuitemradio' === r.getAttribute('role') ? 'menuitemradio' : 'button');
        api.listen(r, 'click', go);
        api.listen(r, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      r.append(el('span', 'aad-wsd is-big', { 'aria-hidden': 'true', text: initial(w.name) }), words);
      if (w.current) r.append(icon('check', 'aad-ico aad-wcheck'));
      return r;
    });
    const manage = el('button', 'aad-wm', { type: 'button', role: 'menuitem', text: 'Manage workspaces' });
    // Manage = Settings › Connections, where the saved Wizards are added (core/workspaces.js 'saved-wizards'); Network & security
    // holds nothing about workspaces (wizard-ux#1209).
    api.listen(manage, 'click', () => { closeWs(); api.desk.settings('connections'); });
    wsPop.replaceChildren(el('h3', 'aad-wh', { text: 'Workspaces' }), ...rows, el('hr', 'aad-pdiv'), manage);
  }
  function openWs() {
    if (wsPop) return; closeMenu();
    api.workspaces?.refresh();
    wsPop = el('div', 'aad-pop aad-wspop', { role: 'menu', 'aria-label': 'Workspaces' });
    scene.append(wsPop); paintWsPop(api.workspaces?.list() || []);
    offWsBack = api.back.push(closeWs); wsBtn.setAttribute('aria-expanded', 'true');
    api.after(0, () => wsPop?.querySelector('button')?.focus?.({ preventScroll: true }));
  }
  function closeWs() { if (!wsPop) return; wsPop.remove(); wsPop = null; offWsBack?.(); offWsBack = null; wsBtn.setAttribute('aria-expanded', 'false'); }
  // With two or more saved Wizards the header name opens the shared switcher menu (core/workspaces.js: this Wizard, the registry and the
  // Wizards saved on this device, so a Wizard on a box without the devices registry still lists its way back); alone it keeps this list.
  api.listen(wsBtn, 'click', () => { const W = globalThis.WizWorkspaces; if (W?.visible && W.openMenu) { closeWs(); W.openMenu(wsBtn); return; } wsPop ? closeWs() : openWs(); });
  // the rail's switcher: the shared menu (opaque, outside tap and Back close it), anchored under the icon
  const paintRws = () => { const W = globalThis.WizWorkspaces; rWs.hidden = !W?.visible; rWs.setAttribute('aria-label', 'Switch Wizard'); };
  api.listen(rWs, 'click', () => { closeWs(); globalThis.WizWorkspaces?.openMenu?.(rWs); });
  const offRws = globalThis.WizWorkspaces?.subscribe?.(paintRws); paintRws();
  api.listen(globalThis, 'wos:resources', () => { paintWs(); paintFuel(); });
  // a click anywhere else closes the menus (their own popovers, like ChatGPT's)
  api.listen(doc, 'pointerdown', e => {
    const t = e.target;
    if (menu && !menu.card.contains(t) && !t?.closest?.('.aad-more, .aad-sortb')) closeMenu();
    if (wsPop && !wsPop.contains(t) && !wsBtn.contains(t)) closeWs();
    if (fly && !fly.card.contains(t) && !rail.contains(t)) closeFly();
  }, true);

  /* ---------- voice: the orb (click talks, hold commands, drag up = Home) ---------- */
  const MODES = ['idle', 'listen', 'command', 'think', 'paused', 'done', 'agent', 'typing'];
  let eng = null;
  api.orb.ready().then(ok => { if (!ok || !scene.isConnected) return; eng = api.orb.create(cv, fb, { R: .64 }); eng?.setRestingMotion?.(false); mode(api.voice.state()); });
  function mode(v) {
    const m = !v || v.state === 'idle' ? (v?.command ? 'command' : 'idle') : v.command ? 'command' : MODES.includes(v.state) ? v.state : 'listen';
    orbBox.dataset.mode = m; eng?.setMode?.(m);
    if (m === 'idle') delete root.dataset.aadVoice; else root.dataset.aadVoice = m;
  }
  api.on('voice', mode);
  api.orb.onLevel(v => eng?.setLevel?.(+v || 0));
  let press = null;
  // a press: click talks (again = send), hold = a local command (release runs it); on the orb a drag up = Home (the chat)
  function down(e, target, { drag }) {
    const p = { held: false, started: null, cancel: null, x: e.clientX, y: e.clientY, moved: false, drag, target }; press = p;
    try { target.setPointerCapture?.(e.pointerId); } catch (_) {}
    target.classList.add('is-pressed'); if (target === orbBtn) eng?.press?.(true);
    p.cancel = api.after(HOLD_MS, () => { if (press !== p || p.moved || (api.voice.state()?.state || 'idle') !== 'idle') return; p.held = true; p.started = Promise.resolve(api.voice.command()); });
  }
  function move(e) {
    const p = press; if (!p || p.held || p.moved) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.hypot(dx, dy) < 48) return;
    p.moved = true; p.cancel?.();
    if (p.drag && dy < 0 && -dy > Math.abs(dx)) newOrPost();
  }
  function up(run) {
    const p = press; press = null; if (!p) return; p.cancel?.(); p.target.classList.remove('is-pressed'); if (p.target === orbBtn) eng?.press?.(false);
    if (!run || p.moved) return;
    if (p.held) p.started.then(r => { if (r === 'voice') api.voice.command(); });
    else talkFromOrb();
  }
  // The orb is visually docked in the Chats composer, but lives outside its window.
  // A companion pane can own keyboard focus: reply to the composer, not that pane.
  function talkFromOrb() {
    if ((api.voice.state()?.state || 'idle') !== 'idle') return api.voice.talk();
    const wid = orbComposer()?.closest('[data-chats]')?.dataset.chats;
    const w = wid && host?.windows().find(w => w.id === wid && w.kind === 'chats');
    if (w?.thread && w.thread !== '__new__') return api.voice.reply(w.id, w.thread);
    return api.voice.talk();
  }
  api.listen(orbBtn, 'pointerdown', e => { if (!e.button) down(e, orbBtn, { drag: true }); });
  api.listen(orbBtn, 'pointermove', move);
  api.listen(orbBtn, 'pointerup', () => up(true)); api.listen(orbBtn, 'pointercancel', () => up(false));
  /* Plain keys belong to the app in front (Miguel, 4 Nov 2026: Space for Music's play/pause started a voice take). A
   * click never parks the keyboard on the orb (the mouse never focuses it, so a later Space can't talk), and a focused
   * orb talks on Enter; on Space only when Tab put it there (:focus-visible). Wizard's voice key stays ⌥Space. */
  api.listen(orbBtn, 'mousedown', e => e.preventDefault());
  const tabbed = n => { try { return n.matches(':focus-visible'); } catch (_) { return false; } };
  api.listen(orbBtn, 'keydown', e => { if (e.key === 'Enter' || (e.key === ' ' && tabbed(orbBtn))) { e.preventDefault(); if (!e.repeat) talkFromOrb(); } });
  api.listen(orbBtn, 'contextmenu', e => e.preventDefault());
  /* the composer (round 6, Miguel: the orb replaces the microphone): the orb sits INSIDE it, in the slot where the mic
   * was (desktop.css: the grid's 'orb' column, right, before the round Send that shows with words); off a chat, back to
   * its own spot at the bottom centre of the main area (or the end of an app's bottom row: skin-host via chrome) */
  function orbComposer() {
    if (root.dataset.aiFront === 'list') return null;   // (round 13: Home, a chat and an app tab all float the composer)
    return homeComposer();
  }
  function orbSlot() {
    if (one()) return null;   // (the narrower window's app bar holds the orb at its centre, for Chats too)
    const c = orbComposer();
    const row = c?.querySelector('.ch-row2');
    return row ? gridSlot(row, 3) : null;
  }
  // (round 8: placed afresh each time: the orb's own spot moves too, sliding when the chat column or a sidebar changes,
  // while the slot can stay put; a same-slot call would keep a move measured mid-slide)
  // (round 11, Miguel: panels must open smoothly): only when the slot or the orb's own spot really moved. Every call
  // used to clear and re-set the orb's variables on <html>, a whole-page style recalc twice a call, ~20 calls an open.
  function placeOrb(force = false) {
    if (!force && Date.now() < glideUntil) return;   // (mid-glide the boxes are moving: the settle places it)
    const s = orbSlot(), h = chrome.orbHome?.() || null;
    if (!force && orbAt.done && near(s, orbAt.slot) && near(h, orbAt.home)) return;
    Object.assign(orbAt, { done: true, slot: s, home: h }); chrome.orbIn(null); chrome.orbIn(s);
  }
  const syncOrb = () => api.frame(() => { placeOrb(); placeHome(); watchComposer(); });
  /* round 8: the composer moves without a resize of the page (the Chats window laid out again after the sidebars settle,
   * the model chip filled in late): follow its box and its window's, so the orb never sits on the chip */
  let roSeen = null, roAsked = false;
  // (once a frame at most; while a grip is held the orb waits for the release, which places it: round 10)
  const ro = globalThis.ResizeObserver ? new ResizeObserver(() => { if (roAsked || root.dataset.aadResizing) return; roAsked = true; api.frame(() => { roAsked = false; placeOrb(); placeHome(); }); }) : null;
  function watchComposer() {
    if (!ro) return;
    const c = homeComposer();
    if (c === roSeen) return;
    ro.disconnect(); roSeen = c;
    if (c) { ro.observe(c); const slot = c.closest('[data-chats]')?.parentElement; if (slot) ro.observe(slot); const ch = c.querySelector('.ch-mlabel'); if (ch) ro.observe(ch); }
  }
  api.listen(globalThis, 'resize', syncOrb);
  api.listen(orbBox, 'transitionend', syncOrb);
  api.listen(doc, 'input', e => { if (e.target?.closest?.('.ch-compose')) syncOrb(); }, true);
  api.listen(doc, 'focusin', syncOrb, true);

  /* ---------- round 15 (Miguel, 3 Nov 2026: Arc-style): the open apps on the right, the app panel, the docked chat ----------
   * Built on the desks as they are (round 7's thirds): the Chats desk and the app's desk are both shown (desktop.css,
   * data-aad-role on their desks), the chat between the sidebar and the panel, the app docked left of the open-apps
   * column; hiding the panel leaves its app running on its desk. */
  const wsps = () => placements().map(p => p.node);
  const mainChats = () => desks().find(d => d.id === CHATS) || null;
  /** The remaining renderer adapter maps the host's Chats desk to its placement container. */
  const chatsEl = () => { const w = mainChatWindow(); return w ? placementOf(w.desk) : null; };
  /** Retained thread identity comes from the host, not mirrored renderer attributes. */
  const behindThread = () => { const t = mainChatWindow()?.thread || ''; return t && t !== '__new__' ? t : null; };
  /** the right column's rows (round 16): every pin, open or not (its desk, else { desk: null }), in pin order; then the
   * other open desks (Home's own Chats desk aside), badged first, then desk order */
  function vtTabs() {
    refreshPins();
    // (round 16 item 7: parts.js appLayers, the phone's Home too; badged first until he orders them by hand: then his
    // order, i.e. the desks' order; the badge stays on the row)
    const L = appLayers(desks(), pins, { main: mainChats()?.desk ?? null, lit, manual, names: Object.fromEntries(pins.map(id => [id, pinApps().find(a => a.id === id)?.name || appName(id) || id])), chats: CHATS });
    return { pinned: L.pinned, others: L.open };
  }
  let manual = api.storage.get('vtManual') === true;
  let vtFolded = api.storage.get('tabsFolded') === true, vtDrawn = '';
  // the tab in front: the panel's desk (or the app desk in front before its panel is placed)
  const frontDesk = () => pane ? Number(pane.desk) : here().app ? api.route().desk : null;
  function vtTab(d, pinned) {
    const open = d.desk != null, on = open && frontDesk() === d.desk;
    const name = d.name || appName(d.id) || d.id, n = d.id === CHATS ? '' : badgeText(d.id);
    const b = el('div', 'aad-vtab' + (on ? ' is-on' : '') + (pinned ? ' is-pinned' : '') + (pinned && open ? ' is-run' : '') + (open ? '' : ' is-closed'), { role: 'tab', tabindex: on ? '0' : '-1', 'aria-selected': String(on), ...(open ? { 'data-desk': String(d.desk) } : {}), 'data-app': d.id, title: name + (n ? ` · ${n} new` : '') + (open ? '' : ' · not open'), 'aria-label': name + (n ? `, ${n} new` : '') + (pinned ? ', pinned' : '') + (open ? '' : ', not open') });
    const ic = el('span', 'aad-vti');
    // (a second Chats desk: the chats glyph on the accent, as on the Desks view)
    let t0; if (d.id === CHATS) { t0 = el('span', 'aad-tile is-vt', { 'aria-hidden': 'true' }); t0.style.setProperty('--c', 'var(--wz-accent)'); t0.append(el('i', 'sgi sg-chats', { 'aria-hidden': 'true' })); } else t0 = appTile(d.id, 'aad-tile is-vt');
    ic.append(t0);
    b.append(ic, el('span', 'aad-vtn', { text: name }));
    if (n) b.append(el('b', 'aad-vtb', { 'aria-hidden': 'true', text: n }));
    if (!pinned) {
      const x = el('button', 'aad-vtx', { type: 'button', tabindex: '-1', 'aria-label': `Close ${name}`, title: 'Close (⌥W)' }); x.append(icon('x', 'aad-ico aad-vtx-i'));
      api.listen(x, 'click', e => { e.stopPropagation?.(); closeDesk(d); });
      b.append(x);
    }
    // a pin not open: a click opens it (as the panel)
    const pick = () => (open ? pickVt(d) : goApp(d.id));
    api.listen(b, 'click', () => { if (Date.now() < dragSwallow) return; pick(); });
    api.listen(b, 'auxclick', e => { if (e.button === 1 && !pinned) { e.preventDefault?.(); closeDesk(d); } });
    api.listen(b, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); pick(); return; }
      if (e.key === 'Delete' && !pinned) { e.preventDefault?.(); closeDesk(d); return; }
      const all = [...vtList.querySelectorAll('.aad-vtab')], i = all.indexOf(b), j = { ArrowDown: i + 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
      if (j != null && all[j]) { e.preventDefault?.(); all[j].focus?.(); }
    });
    api.listen(b, 'contextmenu', e => { e.preventDefault?.(); openAppMenu({ id: d.id, name, ...(open ? { desk: d.desk } : {}), system: !!metaOf(d.id).system, col: colPlace(d, pinned) }, { x: e.clientX, y: e.clientY, el: b }); });
    b.dataset.group = pinned ? 'pin' : 'open';
    // (round 18 item 3c: ⌥1–9, ⌥[ ] and ⌥⇧[ ] reach the rows through these)
    b.__pick = pick; b.__move = dir => { const c = colPlace(d, pinned), i = c.index + dir; if (c.index >= 0 && i >= 0 && i < c.n) dropTo({ id: d.id, desk: open ? d.desk : null }, { group: c.group, index: i }); };
    return b;
  }
  /** a row's place in the column: its group, index and the group's size (the menu's Move up / Move down) */
  function colPlace(d, pinned) {
    const { others } = vtTabs();
    return pinned ? { group: 'pin', index: pins.indexOf(d.id), n: pins.length } : { group: 'open', index: others.findIndex(x => x.desk === d.desk), n: others.length };
  }
  /** Move one row of the column (a drop, or Move up / down): the pin order, and / or the desks' order (stock moveDesk) */
  function dropTo(item, to) {
    const { others } = vtTabs(), O0 = others.map(d => d.desk);
    if (item.id === CHATS && to.group === 'pin') return false;   // (a Chats desk is never a pin)
    const r = vtMove(pins, O0, item, to);
    const pinsChanged = r.pins.join() !== pins.join(), openChanged = r.open.join() !== O0.filter(x => x !== item.desk).join();
    if (openChanged) orderDesks(r.open);
    if (pinsChanged) setPins(r.pins); else paintVt(true);
    return pinsChanged || openChanged;
  }
  /** the open apps in this order: the desks themselves move (only those that must), so the column stays 1:1 with Desks */
  function orderDesks(want) {
    manual = true; api.storage.set('vtManual', true);
    const all = desks(), max = Math.max(-1, ...all.map(d => d.desk), ...want);
    const plan = relMoves(Array.from({ length: max + 1 }, (_, i) => i), want);
    for (const [from, to] of plan.moves) if (!api.desks.move?.(from, to)) break;
    if (pane) { const i = plan.order.indexOf(Number(pane.desk)); if (i >= 0) pane = { ...pane, desk: i }; }
    api.after(0, () => { paintVt(true); paintTop(); });
  }
  /* ---------- round 16 item 6: drag a row (press and hold, or a drag past 5 px) ---------- */
  const DRAG_PX = 5, DRAG_HOLD_MS = 350;
  let drag = null, dragSwallow = 0;
  const dropLine = el('i', 'aad-vtdrop', { 'aria-hidden': 'true' }); dropLine.hidden = true;
  vtList.append?.(dropLine);
  function dragStart() {
    const g = drag; if (!g || g.on) return; g.on = true; g.hold?.(); g.hold = null;
    g.offBack = api.back.push(() => dragEnd(false));
    try { vtList.setPointerCapture?.(g.pid); } catch (_) {}
    const rows = [...vtList.querySelectorAll('.aad-vtab')], i = rows.indexOf(g.b);
    g.rows = rows; g.oi = i; g.rects = rows.map(r => r.getBoundingClientRect());
    g.pinBefore = rows.filter(r => r.dataset.group === 'pin').length;
    g.sep = vtList.querySelector('.aad-vtsep'); g.pitch = (g.rects[i]?.height || 36) + 2;
    const fp = g.rects[g.pinBefore], lp = g.rects[g.pinBefore - 1];
    g.S = fp && lp ? Math.max(0, fp.top - lp.top - g.pitch) : 0;
    g.top0 = g.rects[0]?.top || 0;
    vtList.dataset.drag = ''; g.b.classList.add('is-drag'); dropLine.hidden = false;
  }
  const yOf = (g, k, pinned) => g.top0 + k * g.pitch + (k >= pinned ? g.S : 0);
  /** where the dragged row would land for a pointer at y: { group, index } */
  function dragTarget(g, y) {
    const rest = g.rows.filter(r => r !== g.b), pp = rest.filter(r => r.dataset.group === 'pin').length;
    const mid = r => { const b = g.rects[g.rows.indexOf(r)]; return b.top + b.height / 2; };
    const k = rest.filter(r => mid(r) < y).length;
    let to;
    if (k < pp) to = { group: 'pin', index: k };
    else if (k > pp) to = { group: 'open', index: k - pp };
    else {
      const s = g.sep?.getBoundingClientRect?.(), last = rest[pp - 1], first = rest[pp];
      const edge = s && s.height ? s.top + s.height / 2 : last ? g.rects[g.rows.indexOf(last)].bottom + 6 : first ? g.rects[g.rows.indexOf(first)].top - 6 : y;
      to = y < edge ? { group: 'pin', index: pp } : { group: 'open', index: 0 };
    }
    if (g.b.dataset.app === CHATS && to.group === 'pin') to = { group: 'open', index: 0 };
    return { to, pp };
  }
  function dragMove(y) {
    const g = drag; if (!g?.on) return;
    g.y = y; g.b.style.translate = `0px ${Math.round(y - g.y0)}px`;
    const { to, pp } = dragTarget(g, y); g.to = to;
    const ins = to.group === 'pin' ? to.index : pp + to.index, pinAfter = pp + (to.group === 'pin' ? 1 : 0);
    let j2 = 0;
    g.rows.forEach((r, j) => {
      if (r === g.b) return;
      const k = j2 < ins ? j2 : j2 + 1; j2++;
      const dy = Math.round(yOf(g, k, pinAfter) - yOf(g, j, g.pinBefore));
      r.style.translate = dy ? `0px ${dy}px` : '';
    });
    if (g.sep) { const dy = (pinAfter - g.pinBefore) * g.pitch; g.sep.style.translate = dy ? `0px ${dy}px` : ''; }
    const box = vtList.getBoundingClientRect?.() || { top: 0 };
    dropLine.style.translate = `0px ${Math.round(yOf(g, ins, pinAfter) - box.top + (vtList.scrollTop || 0) - 2)}px`;
  }
  function dragEnd(commit) {
    const g = drag; drag = null; if (!g) return false;
    g.offBack?.();
    g.hold?.();
    if (!g.on) return false;
    for (const r of g.rows) r.style.translate = ''; if (g.sep) g.sep.style.translate = '';
    g.b.classList.remove('is-drag'); delete vtList.dataset.drag; dropLine.hidden = true;
    try { vtList.releasePointerCapture?.(g.pid); } catch (_) {}
    dragSwallow = Date.now() + 400;
    if (!commit || !g.to) return true;
    const d = { desk: g.b.dataset.desk != null ? Number(g.b.dataset.desk) : null, id: g.b.dataset.app };
    dropTo(d, g.to);
    return true;
  }
  api.listen(vtList, 'pointerdown', e => {
    if (e.button || drag || one()) return;   // (the app bar: reordering by its menu's Move left / right; drag is the column's)
    const b = e.target?.closest?.('.aad-vtab'); if (!b || e.target.closest?.('.aad-vtx, .aad-np')) return;
    drag = { b, pid: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, on: false, to: null, hold: null };
    drag.hold = api.after(DRAG_HOLD_MS, () => { if (drag && !drag.on) { dragStart(); dragMove(drag.y); } });
  });
  api.listen(vtList, 'pointermove', e => {
    const g = drag; if (!g) return;
    if (!g.on) { if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_PX) return; dragStart(); }
    dragMove(e.clientY);
  });
  api.listen(vtList, 'pointerup', () => dragEnd(true));
  api.listen(vtList, 'pointercancel', () => dragEnd(false));
  api.listen(vtList, 'lostpointercapture', () => { if (drag?.on) dragEnd(true); });
  function paintVt(force = false) {
    // (the narrower window's app bar, ONE: its own look, never the folded rail's; the fold choice is kept for wide)
    const bar = one(), mode = bar ? 'bar' : vtFolded ? 'rail' : 'open';
    if (root.dataset.aadTabs !== mode) { root.dataset.aadTabs = mode; applySizes(); }
    paintOneChats(); if (vtTog.hidden !== bar) vtTog.hidden = bar;
    vtTog.setAttribute('aria-expanded', String(!vtFolded));
    vtTog.setAttribute('aria-label', vtFolded ? 'Show the apps\' names' : 'Fold the apps to icons'); vtTog.title = vtFolded ? 'Expand (⌥R)' : 'Fold to icons (⌥R)';
    const { pinned, others } = vtTabs();
    const sig = JSON.stringify([mode, frontDesk() ?? '', pinned.map(d => d.desk + d.id + d.name + badgeText(d.id)), others.map(d => d.desk + d.id + d.name + badgeText(d.id))]);
    if (!force && sig === vtDrawn && vtList.childElementCount) return; vtDrawn = sig;
    const out = pinned.map(d => vtTab(d, true));
    if (pinned.length && others.length) out.push(el('hr', 'aad-vtsep', { 'aria-hidden': 'true' }));
    out.push(...others.map(d => vtTab(d, false)));
    if (!out.length) out.push(el('p', 'aad-vtnone', { text: 'No apps open.' }));
    if (drag) dragEnd(false);
    // the app bar: Chats and the first half of the apps left of the orb, the rest and All apps right of it (the phone's
    // orb bar: the orb in one spot, the items either side of it)
    // (Chats and All apps count too; an odd count gets an empty spot on the right, so the orb sits at the bar's centre)
    if (bar) {
      const rows = out.filter(n => n.classList?.contains('aad-vtab')), all = rows.length + 2, left = Math.ceil(all / 2) - 1;
      rows.forEach((n, i) => { n.dataset.half = i < left ? 'l' : 'r'; });
      if (all % 2) out.push(el('i', 'aad-vtfill', { 'aria-hidden': 'true', 'data-half': 'r' }));
    }
    vtList.setAttribute('aria-orientation', bar ? 'horizontal' : 'vertical');
    vtList.replaceChildren(...out, dropLine);
    markMedia();
  }
  /* narrower window (ONE): Chats, the app bar's first item, lit while Chats is in front; its badge: chats waiting */
  function paintOneChats() {
    const on = one(), front = on && !pane, n = on ? badgeText(CHATS) : '';
    if (vOne.hidden === on) vOne.hidden = !on;
    vChats.classList.toggle('is-on', front); vChats.setAttribute('aria-pressed', String(front));
    if (front) vChats.setAttribute('aria-current', 'page'); else vChats.removeAttribute('aria-current');
    if (vChatsN.textContent !== n) vChatsN.textContent = n; vChatsN.hidden = !n;
    const label = 'Chats' + (n ? `, ${n} new` : ''); if (vChats.getAttribute('aria-label') !== label) vChats.setAttribute('aria-label', label);
  }
  /** Chats from the column: from an app, Chats as it was (the open chat, else the list); Chats in front again, its first
   * view (the list, and at half width a new chat beside it) */
  function oneChats() {
    if (!one()) return;
    closeAll(); closeMenu();
    if (pane) { oneList = !behindThread(); hidePanel(); return; }
    if (oneSplit()) { if (docked) closeChat(); } else { oneList = true; paintTop(); }
  }
  api.listen(vChats, 'click', oneChats);
  api.listen(vChats, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); oneChats(); } });
  /** the app last in front, while its desk is still open (Back from the chats list goes there) */
  const oneApp = () => oneLast && desks().some(d => d.desk === oneLast.desk && d.id === oneLast.id) ? oneLast : null;
  api.listen(oneBack, 'click', () => { if (!one()) return; if (chatThread === FEED) closeChat(); oneList = true; paintTop(); });
  function toggleTabs() { focusLeave(); vtFolded = !vtFolded; api.storage.set('tabsFolded', vtFolded); flip([top, orbBox, ...shownDesks()], () => paintVt(true)); retileSoon(); }
  api.listen(vtTog, 'click', toggleTabs);
  /** a tab: its app as the panel; the one in front again hides the panel (the desk stays open) */
  function pickVt(d) {
    // narrower window (ONE): the app in front stays in front (one app at a time; Chats is the bar's first item) and goes
    // back to its top level, the phone's tap on the tab you are on
    if (one() && pane && Number(pane.desk) === d.desk) { appTop(); return; }
    // The chat docked beside the panel has the keyboard (a reply was just sent there): the panel's tab brings its app
    // forward, never hides it out from under the pointer (James, 6 Nov 2026: "Messenger became unclickable").
    const chatHasIt = !!pane && docked && Number(api.route().desk) !== d.desk;
    if (frontDesk() === d.desk && !chatHasIt) { if (pane) hidePanel(); else goHome(); return; }
    if (d.id === CHATS) { closeAll(); api.nav.goDesk(d.desk); return; }
    goApp(d.id, d.desk);
  }
  /** the app in front at its top level: its own Back, step by step, until it says it is at its root (never past it:
   * the app stays open); a sandboxed app answers later, so one step there */
  function appTop() {
    const f = paneFrame(), S = globalThis.WizAppServices; if (!f || !S?.back) return;
    for (let i = 0; i < 12; i++) if (S.back(f) !== 'handled') break;
  }
  function closeDesk(d) {
    if (pane && Number(pane.desk) === d.desk) { pane = null; setWide(false); }
    if (!(api.desks.close?.(d.desk))) api.apps.close?.(d.id);
    api.after(120, () => { paintVt(true); paintTop(); });
  }

  /* App surfaces are host-owned; late tools and companion windows use its
   * coalesced lifecycle subscription, never Classic markup mutations. */
  function paintTools() {
    pTools.hidden = !host?.renderTools(panelWindow()?.id, pTools);
  }
  let winsDesk = null, winsN = 0;
  // An app showing its companion (Video Editor's video + Feedback) takes the full width, as if Wider were
  // pressed, and goes back to the side when the companion closes. Pressing Wider/Back yourself wins (James, 6 Nov 2026).
  let wideAuto = false;
  function autoWide(n) {
    if (n > 1 && !wide) { wideAuto = true; setWide(true); }
    else if (n <= 1 && wideAuto) { wideAuto = false; setWide(false); }
  }
  // Side by side only when the panel really has room for two columns. A narrower panel stacks the app over its
  // companion (video on top, Feedback below), decided by the panel's measured width before paint
  // (James, 7 Nov 2026: never a side-by-side split in a narrow window).
  const STACK_BELOW = 960;
  let stackEl = null;
  const stackRo = globalThis.ResizeObserver ? new ResizeObserver(es => { for (const e of es) e.target.toggleAttribute('data-aad-stack', e.contentRect.width < STACK_BELOW); }) : null;
  function watchStack() {
    const el = pane?.el || null; if (el === stackEl) return;
    if (stackEl) { stackRo?.unobserve(stackEl); stackEl.removeAttribute('data-aad-stack'); }
    stackEl = el; if (el) { if (stackRo) stackRo.observe(el); else el.toggleAttribute('data-aad-stack', el.getBoundingClientRect().width < STACK_BELOW); }
  }
  function watchPaneWins() {
    const desk = pane?.desk ?? null, n = paneWins();
    watchStack();
    if (desk !== winsDesk || n !== winsN) { winsDesk = desk; winsN = n; autoWide(n); applySizes(); retileSoon(); }
  }
  const NOTE = '__note__', DRAFT = '__draft__';
  const notificationSurface = () => chatWindows().map(w => host.chats(w.id)).find(s => onScreen(s?.notification));
  const noteOn = () => !!notificationSurface();
  const noteTitle = () => notificationSurface()?.notificationTitle || 'Notification';
  let dropped = null;   // the panel just hidden for Home / Focus while the route still names its app
  /* The app beside a chat survives a reload (wizard-ux issue 1368): a chat opened from the sidebar puts the Chats desk
   * in front (the route), and the panel was kept only in memory. Saved as { id, desk } whenever it changes; on boot,
   * with the Chats desk in front, the same app's desk becomes the panel again (the shell draws it on a later paint). */
  let besideWant = api.storage.get('beside'), besideSaved = JSON.stringify(besideWant ?? null), besideTries = 0;
  function restoreBeside(h) {
    const b = besideWant, d = b && typeof b.id === 'string' && (desks().find(x => x.id === b.id && x.desk === b.desk) || desks().find(x => x.id === b.id));
    if (!d || d.id === CHATS || h.app || h.r.home || !onMainChats(h.r)) { besideWant = null; return; }
    const el0 = placementOf(d.desk);
    if (el0) { pane = { id: d.id, el: el0, desk: d.desk }; besideWant = null; }
    else if (++besideTries > 20) besideWant = null;
    else api.after(150, () => paintTop());
  }
  function keepBeside() {
    const v = pane ? { id: pane.id, desk: Number(pane.desk) } : null, s = JSON.stringify(v);
    if (s !== besideSaved) { besideSaved = s; api.storage.set('beside', v); }
  }
  function paintSplit(chatOn) {
    const h = here();
    if (dropped && (want === h.app || h.app !== dropped.id || Number(h.r.desk) !== dropped.desk)) dropped = null;
    if (h.app && !dropped && (want === h.app || !pane || pane.id !== h.app || Number(pane.desk) !== h.r.desk)) {
      // the app now in front becomes the panel (its desk is the one not hidden)
      const app = (host?.windows() || []).find(w => w.visible && w.desk === h.r.desk && w.kind !== 'chats');
      const el0 = app && placementOf(app.desk);
      if (el0) { const fresh = pane?.el !== el0; pane = { id: h.app, el: el0, desk: h.r.desk }; if (fresh) anim('app'); markUsed(h.app); }
      want = null;
    }
    if (focusWant && pane?.id === focusWant && !focusing) { focusing = true; const generation = focusGeneration; api.after(60, () => focusFrame(0, generation)); }
    // (another panel already in front wins over a pending restore: Codex review)
    if (besideWant) { if (pane) besideWant = null; else restoreBeside(h); }
    if (pane && (!pane.el.isConnected || !desks().some(d => d.desk === pane.desk && d.id === pane.id))) pane = null;
    if (!besideWant) keepBeside();
    if (!pane && wide) setWide(false);
    // narrow desktop (ONE): the app in front fills the main area (as ⤢ Wider); the chat stays open behind it, not beside
    if (pane) oneLast = { id: pane.id, desk: Number(pane.desk) };
    const oneFront = one() && !!pane;
    if (oneFront && !wide) { oneWide = true; setWide(true); } else if (oneWide && !oneFront) {
      // (an app showing its companion keeps the width it wants wide, as autoWide would have given it: Codex review)
      oneWide = false; if (pane && paneWins() > 1) wideAuto = true; else if (wide && !wideAuto) setWide(false);
    }
    const model = paneModel(), floating = model.mode !== 'tiled';
    const chat = pane || chatOn || floating ? chatsEl() : null; dockEl = chat;
    // (the app's desk or the Chats desk not on the stage yet, the shell draws a desk on its first visit: look again
    // shortly, a few times; no route event follows that drawing)
    if (((h.app && !pane) || ((pane || chatOn) && !chat)) && splitTries < 20) { splitTries++; api.after(150, () => paintTop()); } else splitTries = 0;
    // the Chats desk behind the panel shows Home's new chat, never its bare list (the page opened on an app, or the
    // Chats desk was left on its list): a new chat there, then the app back in front (once; the shell draws it)
    if (pane && !chatOn && chat && !chat.querySelector('.pane-main .ch-compose') && !fixingBehind) {
      fixingBehind = true; const d0 = pane.desk, id0 = pane.id;
      api.sessions.newChat(); api.after(80, () => { want = id0; api.nav.goDesk(d0); api.after(600, () => { fixingBehind = false; }); });
    }
    const second = model.slots.includes('app2') && model.app2 && desks().find(d => d.id === model.app2 && d.id !== pane?.id && d.id !== CHATS);
    secondEl = second ? placementOf(second.desk, chat) : null;
    for (const w of wsps()) {
      const r = w === pane?.el ? 'app' : w === chat ? 'chat' : w === secondEl ? 'app2' : '';
      if ((w.dataset.aadRole || '') !== r) { if (r) w.dataset.aadRole = r; else delete w.dataset.aadRole; }
      if (r && !model.slots.includes(r === 'chat' ? 'chats' : r)) w.dataset.aadOmitted = ''; else delete w.dataset.aadOmitted;
    }
    const was = `${!!root.dataset.aadSplit}${docked}`, wasDocked = docked;
    docked = !!(model.slots.includes('chats') && (chatOn || floating) && chat) && !oneFront;
    const setState = () => {
      if (model.slots.includes('app') && pane && chat) root.dataset.aadSplit = 'on'; else delete root.dataset.aadSplit;
      if (docked) root.dataset.aadChat = 'on'; else delete root.dataset.aadChat;
    };
    if (!docked && !wasDocked && !!(pane && chat) !== !!root.dataset.aadSplit) flip([homeComposer(), orbBox], setState); else setState();
    if (docked && !wasDocked) anim('dock');
    applySizes(); watchPaneWins();
    if (was !== `${!!root.dataset.aadSplit}${docked}`) { syncSide(); retileSoon(); }
    // One physical pane owns both the layout header and the app window. Moving
    // the header (not cloning it) preserves its tools/listeners and iframe state.
    const headerHost = pane?.el || top;
    if (pTop.parentNode !== headerHost) headerHost.append(pTop);
    // Docked windows carry their header and body on ONE animated ancestor,
    // including the trip back to tiled. Home's undocked title stays in its row.
    const chatHeaderHost = docked && chat ? chat : top;
    if (cTop.parentNode !== chatHeaderHost) chatHeaderHost.append(cTop);
    // The second app's header lives only on that window; parked nowhere when none is open.
    if (secondEl) { if (sTop.parentNode !== secondEl) secondEl.append(sTop); } else sTop.remove();
    sTop.hidden = !secondEl; sName.textContent = second ? appName(second.id) : '';
    for (const { bar } of modeBars) for (const b of bar.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === model.mode));
    pTop.hidden = !pane || !model.slots.includes('app'); cX.hidden = !docked;
    paintFeed(chat);
    if (pane) { pName.textContent = appName(pane.id); pIcon.replaceChildren(appTile(pane.id, 'aad-tile is-xs')); pX.setAttribute('aria-label', `Hide ${appName(pane.id)} (Esc), it keeps running`); }
    paintTools();
    if (loadId && pane?.id === loadId) waitLoaded(); else if (loadId && !want) doneLoading();
  }
  // A channel's feed in the docked chat column, over the Chats window there (its own header, posts and message box).
  function paintFeed(chat) {
    const on = chatThread === FEED && docked && !!chat;
    if (on && feedBox.parentNode !== chat) chat.append(feedBox);
    const open = on ? api.sessions.channelFeed?.(feedBox) : null;
    if (feedBox.hidden === !!open) feedBox.hidden = !open;
    if (open) root.dataset.aadFeed = ''; else delete root.dataset.aadFeed;
  }
  // The post last opened from the feed (its row or its Reply), and the channel it was opened in.
  let fromFeed = null;
  function feedPost(e) {
    const t = e?.target, row = t?.closest?.('[data-chopen], [data-chreply]'), open = feedOn();
    if (!row || !open || t.closest('.ch-post-t a[href]') || t.closest('.ch-sheet')) return;
    // (its title too: a post older than the loaded Activity list is in no list titleOf reads, wizard-ux issue 1329)
    const title = row.closest('.ch-post')?.dataset?.chtitle || '';
    fromFeed = { sid: row.dataset.chopen || row.dataset.chreply, id: open.id, name: open.name, title };
  }
  api.listen(feedBox, 'click', feedPost, true);
  // The channel the chat in the column goes back to, or null: only that post, docked, with its channel still open.
  function feedBack() {
    if (!fromFeed || !docked || chatThread !== fromFeed.sid) return null;
    const open = feedOn(); return open && open.id === fromFeed.id ? open : null;
  }
  // the title of the post opened from the feed: an older post is in no list, and the lists match by id alone (a routed
  // agent's post may share its id with a main chat), so the post the owner clicked names it first
  function feedTitle(sid) { return fromFeed && fromFeed.sid === sid ? fromFeed.title || '' : ''; }
  function paintBack() {
    // another chat (or none) in the column: that post's Back is spent; the feed itself keeps it for a reopen
    if (fromFeed && chatThread !== fromFeed.sid && chatThread !== FEED) fromFeed = null;
    const b = feedBack(), up = b ? '' : listBack(); cBack.hidden = !b && !up; if (!b && !up) return;
    const name = b ? `# ${b.name || ''}` : up; cBack.textContent = `‹ ${name}`; cBack.title = 'Back (Esc)'; cBack.setAttribute('aria-label', `Back to ${name} (Esc)`);
  }
  api.listen(cBack, 'click', () => chatBack());
  // A channel opened in the sidebar: its feed comes into the column in place of the chat there (the app panel stays).
  function feedOpened(open) {
    // the feed closed by its own Back to channels: as Esc, the app it was brought in front of gets the front back
    if (!open) { feedGone(); paintTop(); return; }
    unpeek(); // (a channel picked in the list shown over the page: its feed in front)
    const h = here(), r = api.route();
    // (no main Chats window yet, as on a desk holding only an app: the new chat makes the column the feed lies over)
    if (h.thread || h.note || h.draft || !mainChats() || (!h.app && (r.home || r.view !== 'thread'))) { noteWant = false; draftWant = false; chatThread = null; api.sessions.newChat(); }
    else if (h.app) chatThread = FEED;
    // With an app centred (or full) the feed comes to the front, as opening a chat does; closing the feed gives the
    // front back to the app, in the same view (wizard-ux issue 1344)
    const f = panes.get().focus;
    if (f !== 'chats') { feedFocus = f; panes.set({ focus: 'chats' }); }
    paintTop();
  }
  let feedFocus = null;
  // the feed left the column (Esc, ✕, its own Back to channels): the app it was brought in front of gets the front back
  function feedGone() { if (feedFocus && pane && panes.get().focus === 'chats') panes.set({ focus: feedFocus }); feedFocus = null; }
  api.listen(globalThis, 'wos:channel-feed', e => feedOpened(e?.detail?.open || null));
  // the panel hides (the app keeps running on its desk): back to the chat (docked) or Home
  let closing = null, exitMotion = null;
  function hidePanel({ home: goBack = true } = {}) {
    if (!pane || closing) return !!pane;
    const was = pane, el0 = was.el, w0 = el0.getBoundingClientRect?.().width || 480;
    const finish = () => {
      closing = null; if (pane !== was) { out?.cancel?.(); exitMotion = null; return; }
      pane = null; setWide(false); doneLoading(); anim('close');
      // (Home / Focus: the route still names the app until the new chat lands; don't take it back as the panel meanwhile)
      if (!goBack) dropped = { id: was.id, desk: Number(was.desk) };
      const m = mainChats();
      if (goBack && here().app === was.id) { if (m) api.nav.goDesk(m.desk); else api.sessions.newChat(); }
      paintSplit(!!chatThread); paintTop();
      api.frame(() => { out?.cancel?.(); if (exitMotion === out) exitMotion = null; });
    };
    // (one app at a time: Chats replaces the app at once, on the click's own frame; no slide out)
    const out = goBack && !reduced() && !one() && typeof el0.animate === 'function' ? el0.animate([{ translate: '0px 0px', opacity: 1 }, { translate: `${Math.min(w0, 480)}px 0px`, opacity: 0.3 }], { duration: 180, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }) : null;
    exitMotion = out;
    if (out) closing = api.after(180, finish); else finish();
    return true;
  }
  // the chat column goes: Home (a new chat); the app panel (if any) stays
  function closeChat() {
    if (!docked) return false;
    // Closing never changes the owner's view (wizard-ux issues 1330, 1325; James: "going back shouldn't change the
    // user's selected view"): a post's thread back to its feed, the feed closed and a plain chat closed all leave 50/50,
    // centred or full as they were; the new chat takes the chat slot.
    // the channel's feed: closed (nothing open); from a post opened in it, Back lands on the feed again (paintTop)
    if (chatThread === FEED) feedGone(); // (brought in front of a centred app: the app gets the front back, issue 1344)
    if (chatThread === FEED) { chatThread = null; anim('undock'); api.sessions.channelBack?.(); paintTop(); return true; }
    if (!feedBack()) feedFocus = null; // a plain chat closing: no feed to give the front back from
    chatThread = null; noteWant = false; draftWant = false; anim('undock');
    api.sessions.newChat(); return true;
  }
  /* One level up from the column wherever the list is not beside it (James, 12 Nov 2026: "I am missing a back button
   * here at smaller width ... It either takes them back to the channels or the chats list, wherever is one level above
   * where they were last"): a narrow window (the rail), the sidebar folded, or full screen. The name of the list it goes
   * to, or '' (the list beside it, a post's own "‹ # channel" Back, a new chat, or one app at a time's own Back). */
  function listBack() {
    if (!docked || !chatThread || chatThread === DRAFT || feedBack()) return '';
    // one app at a time (ONE): the chat alone, narrower than ONE.split (its list, oneList, is the level above it)
    if (one()) { if (pane || oneSplit() || oneList) return ''; }
    else if (root.dataset.aadSide === 'open' && panes.get().mode !== 'full') return '';
    if (chatThread === FEED) return 'Channels';
    const v = api.sessions.channelView?.() || '';
    return v === 'channels' ? 'Channels' : v === 'activity' ? 'Activity' : 'Chats';
  }
  // Back (the header's ‹ and Esc): the column one level up (closeChat: a post to its feed, the feed or a chat closed);
  // a chat that came from the list shows that list again, over the page, at its place (its own Back / a tap outside
  // closes it). In page only: never a history step, so Back at the root never leaves Wizard.
  function chatBack() {
    const up = listBack();
    // one app at a time: the list fills the window again; the chat stays open behind it (Chats as it was)
    // (a channel's feed closes, as wide: one level up from it is the channel list; a chat stays open behind its list)
    if (one() && up) { if (chatThread === FEED) closeChat(); oneList = true; paintTop(); return true; }
    if (!closeChat()) return false;
    if (up && !peek && peekable()) { peek = true; offPeek = api.back.push(() => { peek = false; offPeek = null; paintSide(); }); paintSide(); }
    return true;
  }
  function setWide(on) {
    const w = !!on && !!pane; if (w === wide) { paintWide(); return; } wide = w;
    flip([pane?.el], () => { if (wide) root.dataset.aadWide = ''; else delete root.dataset.aadWide; });
    paintWide(); retileSoon();
  }
  function paintWide() {
    pW.setAttribute('aria-pressed', String(wide)); pW.replaceChildren(icon(wide ? 'shrink' : 'expand'));
    pW.title = wide ? 'Back to the side (⌥F)' : 'Wider (⌥F)'; pW.setAttribute('aria-label', wide ? 'Make the app panel narrower again' : 'Make the app panel wider');
  }
  paintWide();
  api.listen(pX, 'click', () => hidePanel());
  // a click anywhere on the app panel's bar hands the keyboard back to the app (its buttons never keep it)
  api.listen(pTop, 'mousedown', e => e.preventDefault());
  api.listen(pTop, 'click', e => { if (pane && !e.target?.closest?.('.aad-px') && !focusing) { wantAppFocus(pane.id); focusing = true; focusFrame(); } });
  api.listen(cX, 'click', closeChat);
  api.listen(pW, 'click', () => { wideAuto = false; setWide(!wide); });
  // a slow app: its placeholder in the panel's place at once (faded in after a beat), gone once its frame has loaded
  let loadId = '', loadOff = null, loadWait = null;
  function loading(id) {
    loadId = id; pLoadT.textContent = `Opening ${appName(id) || 'the app'}…`;
    pLoad.querySelector('.aad-pload-i').replaceChildren(appTile(id, 'aad-tile'));
    pLoad.hidden = false; root.dataset.aadLoading = '';
    loadOff?.(); loadOff = api.after(15000, doneLoading);
  }
  function doneLoading() { loadOff?.(); loadOff = null; loadWait?.(); loadWait = null; loadId = ''; pLoad.hidden = true; delete root.dataset.aadLoading; }
  function frameReady() { return !!panelWindow() && host.frameReady(panelWindow().id); }
  function waitLoaded() {
    if (frameReady()) return doneLoading();
    if (loadWait) return;
    const f = paneFrame(); if (f) loadWait = api.listen(f, 'load', () => { if (frameReady()) doneLoading(); });
  }
  let animOff = null, animOn = [];
  function anim(kind) {
    animOff?.(); for (const n of animOn) delete n.dataset.aadAnim;
    const chatDesk = chatsEl();
    animOn = (kind === 'app' ? [pane?.el] : kind === 'dock' ? [chatDesk, cTop] : kind === 'thread' ? [chatDesk] : []).filter(Boolean);
    for (const n of animOn) n.dataset.aadAnim = kind;
    animOff = api.after(320, () => { for (const n of animOn) delete n.dataset.aadAnim; animOn = []; animOff = null; });
  }

  /* ---------- round 15: auto-tidy (Arc) ----------
   * Each app's last use (on screen as the panel) is kept on this device; on load and every hour, open apps that are not
   * pinned, not on screen and unused for longer than the Tidy setting (24 h at first) close; a quiet toast says how many,
   * with Undo (they open again). */
  const tidyKey = () => { const k = api.storage.get('tidy'); return Object.prototype.hasOwnProperty.call(TIDY, k) ? k : TIDY_DEFAULT; };
  let used = seedUsed(api.storage.get('used') || {}, desks(), Date.now()), usedAt = 0;
  api.storage.set('used', used);
  function markUsed(id) {
    if (!id) return; const now = Date.now();
    used = { ...used, [id]: now };
    if (now - usedAt > 60e3) { usedAt = now; api.storage.set('used', used); }
  }
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
    const m = mainChats(); if (m) api.nav.goDesk(m.desk);
  });
  function tidy() {
    const key = tidyKey(), now = Date.now();
    used = seedUsed(used, desks(), now);
    if (pane) used = { ...used, [pane.id]: now };
    const plan = tidyPlan(desks(), { pins, used, now, limit: TIDY[key], keep: [pane?.desk, api.route().desk].filter(x => x != null) });
    api.storage.set('used', used);
    if (!plan.length) return [];
    for (const d of plan) api.desks.close?.(d.desk);
    showToast(tidyWords(plan.length, key), plan.map(d => d.id));
    api.after(120, () => paintVt(true));
    return plan;
  }
  let tidyOff = null;
  // (Codex review on #888: api.after caps every timer at 10 s, so the hourly tidy counts to its deadline)
  let tidyAt = Date.now() + TIDY_EVERY;
  const tidyLoop = () => { tidyOff = api.after(10e3, () => { if (Date.now() >= tidyAt) { tidyAt = Date.now() + TIDY_EVERY; tidy(); } tidyLoop(); }); };
  api.after(6000, tidy); tidyLoop();
  // the setting: the column's foot. Round 18 (Miguel, 3 Nov 2026: the setting reads as a sentence): a small 'Tidy: 24h'
  // line that expands in place into 'Tidy up: close apps you haven't used in [24 hours ▾]. Pinned apps always stay
  // open.' (parts.js tidySentence, the phone's sheet too); folded to the rail it opens beside the column
  let tidyPop = null, offTidyBack = null;
  function paintTidy() { const k = tidyKey(); tidyW.textContent = `Tidy: ${TIDY_SHORT[k]}`; tidyBtn.setAttribute('aria-label', `Tidy up: ${k === 'off' ? 'off' : `close apps you haven't used in ${TIDY_WORDS[k]}`}. Change`); tidyBtn.title = 'Tidy up: close apps you haven\'t used for a while (pinned apps always stay open) · ⌥T'; }
  function closeTidy() { if (!tidyPop) return; tidyPop.remove(); tidyPop = null; offTidyBack?.(); offTidyBack = null; tidyBtn.setAttribute('aria-expanded', 'false'); }
  function openTidy() {
    if (tidyPop) { closeTidy(); return; } closeMenu();
    tidyPop = el('div', 'aad-tidyx', { role: 'group', 'aria-label': 'Tidy up' });
    tidyPop.append(tidySentence(doc, tidyKey(), k => { api.storage.set('tidy', k); paintTidy(); }, 'aad-tidys'));
    vtFoot.replaceChildren(vtAll, tidyPop, tidyBtn); offTidyBack = api.back.push(closeTidy); tidyBtn.setAttribute('aria-expanded', 'true');
    api.after(0, () => tidyPop?.querySelector('select')?.focus?.({ preventScroll: true }));
  }
  api.listen(tidyBtn, 'click', openTidy);
  api.listen(doc, 'pointerdown', e => { if (tidyPop && !tidyPop.contains(e.target) && !tidyBtn.contains(e.target)) closeTidy(); }, true);
  paintTidy();

  /* ---------- keys (round 21 below): Esc steps back one layer: the picker, then the wide panel, then the panel hides,
   * then the chat column ---------- */
  // Escape navigation is a surface callback, not an early layout key. Recording
  // and the shared recency stack must finish first. A root press is consumed
  // without sending the hidden Classic Chats window through threadBack(__new__).
  let lastSurface = 'chat';
  const typing = () => { const a = doc.activeElement; return !!a && /^(TEXTAREA|INPUT)$/.test(a.tagName || '') && !!a.value; };
  const rememberSurface = e => {
    let slot;
    if (secondEl?.contains(e.target)) slot = 'app2';
    else if (pane?.el?.contains(e.target) || pTop.contains(e.target)) slot = 'app';
    else if (chatsEl()?.contains(e.target) || cTop.contains(e.target)) slot = 'chats';
    if (slot) { lastSurface = slot === 'chats' ? 'chat' : 'app'; if (panes.get().focus !== slot) panes.set({ focus: slot }); }
    else if (side.contains(e.target)) lastSurface = 'chat';
  };
  api.listen(doc, 'pointerdown', rememberSurface, true);
  api.listen(doc, 'focusin', rememberSurface, true);
  api.back.surface?.(() => {
    // Shared registry has already offered recording and transient overlays.
    if (panes.get().mode === 'full') {
      // A channel post's thread full screen: Esc is its "‹ # channel" Back, the feed again and still full screen
      // (wizard-ux issue 1325: going back never changes the owner's view). Full screen shows only the focused slot, so
      // the panes' focus decides, never a stale focus left in the hidden app's frame (Codex, PR 1390).
      // The same for a chat from the list, which full screen hides: Back shows the list over it, still full screen.
      if (panes.get().focus === 'chats' && (feedBack() || listBack())) { chatBack(); return true; }
      // Overlay-first: a sheet or nested view inside the focused app closes before Esc leaves full screen.
      const act = doc.activeElement, frame = pane && (pane.el.contains(act) || (lastSurface === 'app' && !chatsEl()?.contains(act))) ? pane.el.querySelector?.('iframe') : null;
      // 'pending': a sandboxed app (browser boundary) answers later; at its root full screen ends then.
      // Leaving full screen goes back to the view it came from (50/50, centred or tiled; wizard-ux issue 1325).
      const r = frame ? globalThis.WizAppServices?.back?.(frame, () => windowMode(fullFrom)) : null;
      if (r === 'handled' || (r === 'pending' && globalThis.WizBrowserBoundary?.owns(frame))) return true;
      windowMode(fullFrom); return true;
    }
    const a = doc.activeElement;
    // A mixed Chats/app desk can have a focused iframe without an AI-apps pane.
    // Do not consume its Back: the shell's focused-window fallback owns that app.
    if (a?.tagName === 'IFRAME' && !pane?.el?.contains(a)) return false;
    const appFocused = !!pane && (pane.el.contains(a) || pTop.contains(a) || (lastSurface === 'app' && !chatsEl()?.contains(a)));
    if (appFocused) api.apps.back?.(pane.id);
    // one app at a time, the chat alone (narrower than ONE.split): one level up is the list it came from (a post from a
    // channel's feed has its own "‹ # channel" first); at the list (the root) Back stays put
    else if (one() && !pane && !oneSplit() && !feedBack()) { if (!chatBack() && !oneList) { oneList = true; paintTop(); } }
    else if (docked) chatBack();
    else if (api.sessions?.channelBack?.()) paintList(); // Channels: thread → channel → list (issue 1256)
    return true; // bare AI apps desktop: no DOM change, no legacy navigation
  });
  /* round 18 item 3b (Miguel): ⌥↓ / ⌥↑ walk EXACTLY Ready as this sidebar draws it (grouped by status, the chosen order
   * inside; notifications in it), top to bottom, opening each one; from elsewhere the top; past the end back to the top
   * (stock stepReady's wrap and toast). Folded or not, it is the same list. */
  /* round 20 item 1 (Miguel, 3 Nov 2026): ⌥. Focus: both sidebars away, the chat column and the app panel closed, only
   * Home's background and the composer; ⌥. again puts back exactly what was there (which sidebars were open, the chat,
   * the app, wide, the widths). Kept in memory only; Esc leaves it alone; folding / opening a side by hand ends it. */
  let focusStash = null;
  function focusIn() {
    readSessions();
    focusStash = { folded, vtFolded, thread: chatThread === NOTE ? (stepAt && stepAt.startsWith('notif:') ? stepAt : null) : chatThread === FEED ? null : chatThread, app: pane ? { id: pane.id, desk: Number(pane.desk) } : null, wide, widths: { ...sized } };
    closeAll(); closeFly(); closeTidy(); closeMenu(); closeWs(); if (q) setSearch(false); unpeek();
    if (pane || docked) goHome();
    folded = true; vtFolded = true;
    flip([top, orbBox, homeComposer(), ...shownDesks()], () => { root.dataset.aadFocus = ''; paintSide(false); paintVt(true); });
    retileSoon();
  }
  function focusOut() {
    const st = focusStash; focusStash = null; if (!st) return;
    folded = st.folded; vtFolded = st.vtFolded; sized = { ...st.widths };
    flip([top, orbBox, homeComposer(), ...shownDesks()], () => { delete root.dataset.aadFocus; paintSide(false); paintVt(true); });
    retileSoon();
    if (st.thread) { noteWant = st.thread.startsWith('notif:'); stepAt = st.thread; api.sessions.open(st.thread); }
    if (st.app) api.after(st.thread ? 400 : 0, () => {
      const d = desks().find(x => x.desk === st.app.desk && x.id === st.app.id); goApp(st.app.id, d ? d.desk : null);
      if (st.wide) api.after(500, () => setWide(true));
    });
  }
  api.listen(hBack, 'click', () => focusOut());
  /** the rails come back as they are now (a side opened by hand, a chat or an app opened): the stash stays for ⌥. */
  function focusLeave() { if (!focusOn()) return; delete root.dataset.aadFocus; }
  let stepAt = null;
  api.sessions.archiveOrder?.(sid => {
    if (root.dataset.aadSide === 'rail') {
      const key = railNow()?.key;
      return key ? railRows(sessions || readSessions(), key, readyOrder(), groupBy()).map(r => r.id) : [];
    }
    const rows = [...scroll.querySelectorAll('.aad-rw[data-sid]')], row = rows.find(r => r.dataset.sid === sid);
    if (!row) return [];
    const group = r => {
      for (let n = r.previousElementSibling; n; n = n.previousElementSibling) if (n.classList.contains('aad-grp')) return n;
      return r.parentElement;
    };
    const section = group(row);
    return rows.filter(r => r.parentElement === row.parentElement && group(r) === section).map(r => r.dataset.sid);
  });
  const readyIds = () => (typeof actOn === 'function' && actOn()) ? ((sessions || readSessions()).ready || []).map(r => r.id) : readyFlat((sessions || readSessions()).ready || [], readyOrder(), groupBy()).map(r => r.id);
  function stepReady(dir) {
    readSessions();
    const ids = readyIds();
    if (!ids.length) { showToast('Nothing ready right now'); return; }
    const r = api.route(), h = here(r), cc = h.app ? curChat() : null;
    // (round 21: the item in front exactly as the hints read it, so ⌥↓ opens the row wearing ↓; nothing in front: ⌥↓ the
    // first, ⌥↑ the last)
    const cur = h.thread && ids.includes(h.thread) ? h.thread : stepAt && ids.includes(stepAt) && h.note ? stepAt : cc && ids.includes(cc) ? cc : null;
    const nx = cur == null && dir < 0 ? { id: ids[ids.length - 1], wrapped: false } : readyStep(ids, cur, dir); if (!nx) return;
    if (nx.wrapped && dir > 0) showToast('Back to the top of Ready');
    feedFocus = null; stepAt = nx.id; noteWant = nx.id.startsWith('notif:'); fromFeed = null; api.sessions.open(nx.id);
  }
  /* Round 21 (Miguel, 4 Nov 2026: the keys as obvious as possible): ⌥ + a mnemonic letter, ⇧ only for the reverse /
   * variant of a plain key, every key reachable from where it acts. Left: ⌥H Home (again = everything back as it was),
   * ⌥O workspaces, ⌥K search, ⌥L fold the sidebar, ⌥N new chat, ⌥S Settings, ⌥↓ / ⌥↑ the next / previous Ready item.
   * Right: ⌥1–⌥9 and ⌥0 the first ten rows, ⌥[ / ⌥] the previous / next app (every row past ten), ⌥⇧[ / ⌥⇧] move it,
   * ⌥A add an app, ⌥T tidy, ⌥R fold the column, ⌥P pause / play what played last (Now playing). In front: ⌥W close, ⌥F wide, ⌥− / ⌥= narrower / wider, ⌥Z snooze,
   * ⌥E archive then the next, ⌥X resolve then the next, ⌥B where this app's notifications go. Voice: ⌥Space talk (the
   * orb), ⌥D dictate, ⌥V new voice chat, ⌥C command (the shell's own). A modal in front (the app picker, Settings):
   * only its own key (⌥A, ⌥S) and Esc. Every other ⌥ key is the view's and does nothing, so nothing acts unseen on a
   * hidden desk (no ⌥G letters, no ⌥/ pinned guide: holding ⌥ is the guide). */
  const KEY_LIKE = /^(Key[A-Z]|Digit\d|Arrow|Bracket|Backslash|Period|Comma|Minus|Equal|Backquote|Space|Slash|Enter|Semicolon|Quote)/;
  const closeSettings = () => host?.settings.close();
  // (inside the Chats desk, which can carry [hidden] while the view shows it: on screen = it has a box)
  const onScreen = n => !!n && typeof n.getClientRects === 'function' && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0;
  const snoozeOpen = () => !!doc.querySelector?.('.boom-sheet');
  // (the one on screen: a second Chats window, e.g. the chat ⌥X starts, can hold another hidden one)
  const routeBtn = () => chatParts('routeButton')[0] || null;
  const chatBtn = act => chatAction(act);
  let leftOption = false;
  api.listen(globalThis, 'blur', () => { leftOption = false; });
  api.keys.on({ down: e => {
    if (e.code === 'AltLeft') leftOption = true;
    else if (!e.altKey) leftOption = false;
    if (!e.altKey || e.ctrlKey || e.metaKey) return false;
    const code = e.code || '', sh = !!e.shiftKey, once = fn => { if (!e.repeat) fn(); return true; };
    // Physical LEFT Option + Space is the existing app picker, never voice.
    // Before modal/app key dispatch: repeats are consumed without reopening it.
    if (code === 'Space' && !sh && leftOption) return once(openAll);
    // Native word jumps are never a view action, including with a modal or snooze sheet in front.
    if (!sh && (code === 'ArrowLeft' || code === 'ArrowRight')) return false;
    if (allOpenNow()) return code === 'KeyA' && !sh ? once(closeAll) : KEY_LIKE.test(code);
    if (settingsOpen()) return code === 'KeyS' && !sh ? once(closeSettings) : KEY_LIKE.test(code);
    // The snooze sheet keeps ⌥Z to close; Someday is an explicit button, never an arrow shortcut.
    if (snoozeOpen()) return code === 'KeyZ' && !sh ? once(() => doc.querySelector('.boom-sheet [data-boom-close]')?.click?.()) : KEY_LIKE.test(code);
    if (sh && MODE_KEYS[code]) return once(() => windowMode(MODE_KEYS[code]));
    // voice: the shell's own keys (⌥D into the open chat's box, ⌥V a new voice chat, ⌥C a command); ⌥Space = the orb
    if (code === 'KeyV' || code === 'KeyC' || code === 'KeyD') return false;
    // a word with an accent while typing (⌥E é, ⌥U ü, ⌥I î on a Mac) and ⌥← / ⌥→ word jumps stay the field's
    if (typing() && /^(KeyE|KeyU|KeyI|ArrowLeft|ArrowRight)$/.test(code)) return false;
    // the app in front: ⌥ + a key it marks (data-wz-key) presses that control, also from inside its frame and while
    // typing there; a letter it claims beats the view's own meaning for it while it is in front (⌥K = its key, not
    // search); Wizard's keys (RESERVED_KEYS) never reach it; nothing marked: the view's meaning below
    if (!sh && appFront()) { const t = appTarget(appKeyOf(code)); if (t) { if (!e.repeat) pressApp(t); return true; } }
    if (code === 'Space' && !sh) return once(() => api.voice.talk());
    if ((code === 'ArrowDown' || code === 'ArrowUp') && !sh) { if (!e.repeat || here().thread) stepReady(code === 'ArrowDown' ? 1 : -1); return true; }
    // ⌥H Home: everything away (both sides, the chat, the app); ⌥H again: back exactly as it was (⌥` the same, quietly)
    if ((code === 'KeyH' || code === 'Backquote') && !sh) return once(() => (focusOn() && focusStash ? focusOut : focusIn)());
    if (code === 'KeyS' && !sh) return once(settings);
    if (code === 'KeyN' && !sh) return once(plus);
    if (code === 'KeyK' && !sh) return once(() => setSearch(true));
    if (code === 'KeyL' && !sh) return once(toggleSide);
    if (code === 'KeyR' && !sh) return once(toggleTabs);
    // ⌥O opens what the header name opens: the shared switcher with two or more Wizards (saved ones too), else this list
    if (code === 'KeyO' && !sh) return once(() => { if (wsPop) { closeWs(); return; } if (root.dataset.aadSide === 'rail' && !narrow()) toggleSide(); const W = globalThis.WizWorkspaces; if (W?.visible && W.openMenu) { W.openMenu(wsBtn); return; } openWs(); });
    if (code === 'KeyT' && !sh) return once(openTidy);
    if (code === 'KeyA' && !sh) return once(openAll);
    // ⌥P: pause (again: play) what played last, in any app (Now playing: the bars on its icon; nothing playing: nothing)
    if (code === 'KeyP' && !sh) return once(() => api.media?.toggle?.());
    const dg = /^Digit(\d)$/.exec(code);
    if (dg) { if (!e.repeat && !sh) vtRows()[(+dg[1] + 9) % 10]?.__pick?.(); return true; }
    if (code === 'BracketLeft' || code === 'BracketRight') {
      const rows = vtRows(), i = rows.findIndex(b => b.classList.contains('is-on')), dir = code === 'BracketRight' ? 1 : -1;
      if (sh) { if (!e.repeat && i >= 0) rows[i].__move?.(dir); return true; }
      if (rows.length) rows[i < 0 ? (dir > 0 ? 0 : rows.length - 1) : (i + dir + rows.length) % rows.length].__pick?.();
      return true;
    }
    if ((code === 'Minus' || code === 'Equal') && !sh) { if (pane && !wide) setSize('app', sizes().app[0] + (code === 'Equal' ? 64 : -64), true); return true; }
    if (code === 'KeyW' && !sh && pane) { if (!e.repeat) { const d = desks().find(x => x.desk === pane.desk); if (d && !pins.includes(d.id)) closeDesk(d); else hidePanel(); } return true; }
    if (code === 'KeyW' && !sh && docked) { if (!e.repeat) closeChat(); return true; }
    if (code === 'KeyF' && !sh && pane) { if (!e.repeat) { wideAuto = false; setWide(!wide); } return true; }
    // The open item's own buttons change its state, never the selected thread.
    // Keep the existing letters: ⌥E Archive, ⌥Z Snooze. A and S already open All apps and Settings.
    const act = !sh && docked && !typing() && { KeyZ: 'snooze', KeyE: 'done', KeyX: 'resolve' }[code];
    if (act) { if (!e.repeat) chatBtn(act)?.click?.(); return true; }
    if (code === 'KeyB' && !sh) { if (!e.repeat && docked && frontNote()) routeBtn()?.click?.(); return true; }
    if (typing() && sh && /^Arrow/.test(code)) return false;   // ⌥⇧← / → select words
    return KEY_LIKE.test(code);
  }, up: e => { if (e.code === 'AltLeft' || !e.altKey) leftOption = false; } });
  const vtRows = () => [...vtList.querySelectorAll('.aad-vtab')];
  /* Now playing (4 Nov 2026, minimal): a playing app's row wears data-media="playing" | "paused" and its icon small
   * bars (.aad-np, drawn by the miguel/now-playing tweak's css). Hovering the bars turns them into pause; a click
   * pauses that app (paused: play again) without opening it. Paused bars stop and fade out (the tweak's css); a fresh
   * row never draws bars for something already paused. Passive: it hears the shell's media watcher only while that
   * tweak watches, so nothing is drawn without it, or on a shell without api.media. */
  function markMedia() {
    const of = markMedia.of; if (!of) return;
    for (const b of vtList.querySelectorAll('.aad-vtab')) {
      const m = of.get(b.dataset.app), ic = b.querySelector('.aad-vti'); let np = ic?.querySelector('.aad-np');
      if (!m || !ic) { if (b.dataset.media) delete b.dataset.media; np?.remove(); continue; }
      if (!np && !m.playing) { if (b.dataset.media) delete b.dataset.media; continue; }
      if (b.dataset.media !== (m.playing ? 'playing' : 'paused')) b.dataset.media = m.playing ? 'playing' : 'paused';
      if (!np) {
        np = el('button', 'aad-np', { type: 'button', tabindex: '-1' });
        const bars = el('span', 'aad-np-b', { 'aria-hidden': 'true' }); bars.append(el('i'), el('i'), el('i'));
        np.append(bars, el('span', 'aad-np-g', { 'aria-hidden': 'true' }));
        api.listen(np, 'click', e => { e.stopPropagation?.(); e.preventDefault?.(); const x = markMedia.of?.get(b.dataset.app); if (x) (x.playing ? api.media.pause(x.key) : api.media.play(x.key)); });
        api.listen(np, 'auxclick', e => e.stopPropagation?.());
        ic.append(np);
      }
      const what = (m.playing ? 'Pause ' : 'Play ') + (appName(b.dataset.app) || b.dataset.app);
      if (np.getAttribute('aria-label') !== what) { np.setAttribute('aria-label', what); np.title = m.playing ? 'Pause' : 'Play'; }
    }
  }
  api.media?.watch?.(list => {
    const of = new Map(); for (const x of list) if (x.playing ? !of.get(x.appId)?.playing : !of.has(x.appId)) of.set(x.appId, { playing: x.playing, key: x.key });
    markMedia.of = of; markMedia();
  }, { passive: true });
  const shown = n => !!n && n.isConnected !== false && !n.closest?.('[hidden]') && (typeof n.getClientRects !== 'function' || n.getClientRects().length > 0);
  /* Round 21: while left ⌥ is held, a small keycap ON each thing a key acts on, where it is (no legend card, nothing in
   * the middle): icons and buttons at their top-left corner, the next / previous Ready rows at their start (the row
   * makes room; folded: beside the rail word), app rows 1–9 / 0 on the icon's top-left, [ ] on the icon's top-right of
   * the row they go to (folded: bottom-left, clear of the count badge). No keycap
   * for a key with nothing to point at (⌥V, ⌥C); count badges step back while ⌥ is held. */
  const focusOn = () => root.dataset.aadFocus != null;
  const frontNote = () => chatThread === NOTE || here().note;
  const settingsOpen = () => host?.settings.isOpen() || false;   // the centred shared Settings panel
  api.keys.guide(() => {
    const out = [], put = (n, key, at = 'tl') => { if (shown(n)) out.push({ el: n, key, at }); }, putIn = (n, key, at = 'tl') => { if (onScreen(n)) out.push({ el: n, key, at }); };
    for (const r of side.querySelectorAll('.aad-rw[data-aad-kh]')) delete r.dataset.aadKh; khMarks.clear();
    // a modal in front: its own key on its ✕ (what is behind sits under its scrim)
    if (allOpenNow()) { put(doc.querySelector('.vc-sheet .vc-x'), 'A'); return out; }
    if (settingsOpen()) { put(host?.settings.closePart(), 'S'); return out; }
    if (snoozeOpen()) { putIn(doc.querySelector('.boom-sheet [data-boom-close]'), 'Z'); return out; }
    put(orbBtn, 'Space'); putIn(homeComposer(), 'D');
    // ⌥H in the empty middle of Home too (focus or not), only while nothing covers it
    const midH = () => { if (!pane && !docked && !fly && !q && !wsPop && !menu && !tidyPop && midFree()) out.push({ el: hMid, key: 'H', at: 'mid', free: true }); };
    if (focusOn()) { put(hBack, 'H'); midH(); return out; }
    const open = root.dataset.aadSide === 'open';
    if (open) { put(wsName, 'H', 'below'); put(wsBtn.querySelector('.aad-wsc'), 'O', 'right'); }
    put(open ? togBtn : rTog, 'L'); put(open ? findBtn : rFind, 'K'); put(open ? newBtn : rNew, 'N'); put(open ? setBtn : rSet, 'S');
    const ids = readyIds(), cur = curChat(), nx = ids.length ? readyStep(ids, ids.includes(cur) ? cur : null, 1) : null, pv = ids.length > 2 && ids.includes(cur) ? readyStep(ids, cur, -1) : null;
    if (open) {
      // ↓ / ↑ on the very rows ⌥↓ / ⌥↑ open (the drawn Ready, in its order)
      // (the row makes room at its start while ⌥ is held, data-aad-kh, so the keycap never touches its title)
      const row = (id, k) => { const w = id && [...side.querySelectorAll('.aad-rw[data-kind="ready"]')].find(r => r.dataset.sid === id); const b = w?.querySelector('.aad-row'); if (shown(b)) { w.dataset.aadKh = k; khMarks.set(id, k); put(b, k, 'inside-l'); } };
      if (nx && nx.id !== cur) row(nx.id, '↓'); if (pv && pv.id !== cur) row(pv.id, '↑');
    } else {
      // folded: on the rail word whose group holds it (its status, else Ready)
      const s = sessions || readSessions(), rk = id => { const a = id && railActive(s, id, null, readyOrder(), railMode()); return a && [...rList.querySelectorAll('.aad-rk')].find(n => n.dataset.k === a.key); };   // (a project key may hold any character)
      const n1 = nx && nx.id !== cur ? rk(nx.id) : null, p1 = pv && pv.id !== cur ? rk(pv.id) : null;
      // (beside the rail word, never over its count; both on one word: ↑ over ↓)
      if (n1) put(n1, '↓', p1 === n1 ? 'right-dn' : 'right'); if (p1) put(p1, '↑', p1 === n1 ? 'right-up' : 'right');
    }
    put(vtTog, 'R');
    const rows = vtRows(), i = rows.findIndex(b => b.classList.contains('is-on')), tile = b => b.querySelector('.aad-tile') || b;
    rows.forEach((b, k) => { if (k < 10) put(tile(b), String((k + 1) % 10)); });
    if (rows.length > 1) {
      const nb = rows[i < 0 ? 0 : (i + 1) % rows.length], pb = rows[i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length];
      const at = vtFolded ? 'bl' : 'tr';   // (folded: under the icon, clear of its count badge)
      put(tile(nb), ']', at); if (pb !== nb) put(tile(pb), '[', at);
    }
    put(vtAll.querySelector('.aad-vti') || vtAll, 'A'); put(tidyBtn.querySelector('.aad-tidy-i') || tidyBtn, 'T');
    // ⌥P on the icon of what played last: on its bars while they play, else on the icon itself
    const np = api.media?.list?.()[0], npRow = np && rows.find(b => b.dataset.app === np.appId);
    if (npRow) { const bars = npRow.querySelector('.aad-np'); put(np.playing && bars ? bars : tile(npRow), 'P', np.playing && bars ? 'mid' : 'bl'); }
    if (pane) { put(pX, 'W'); put(pW, 'F'); if (!wide) put(grip.app, '− =', 'mid'); put(pIcon, 'H'); } else if (docked) put(cX, 'W');
    for (const { bar } of modeBars) for (const [code, mode] of Object.entries(MODE_KEYS)) {
      const n = bar.querySelector('[data-mode="' + mode + '"]');
      if (shown(n)) out.push({ el: n, key: '⇧' + code.slice(3), at: 'below', word: MODE_LABELS[mode] });
    }
    midH();
    if (docked) {
      for (const [a, k] of [['snooze', 'Z'], ['done', 'E'], ['resolve', 'X']]) putIn(chatBtn(a), k);
      if (frontNote()) putIn(routeBtn(), 'B', 'start');
    }
    // the app in front: its own ⌥ keys (data-wz-key) on its own controls, the same keycaps as Wizard's (one anchor); a
    // letter it claims takes the view's keycap for that letter away (the app wins it while in front)
    if (appFront()) {
      const f = paneFrame(), ks = f ? frameKeys(f).slice(0, 24) : [], caps = new Set(ks.map(t => keyCap(t.key)));
      if (ks.length) { for (let i = out.length - 1; i >= 0; i--) if (caps.has(out[i].key)) out.splice(i, 1); for (const t of ks) out.push({ el: t.el, key: keyCap(t.key), at: 'tl', frame: f, app: true, name: t.label || '' }); }
    }
    return out;
  }, { only: true });
  /* App keys: what the app in front marks with data-wz-key (core/app-client.js WizardApp.keys.list(); an app on an older
   * SDK copy: the same rules read here), only the keys an app may have (isAppKey: a letter or / , . ; not Wizard's);
   * its keycap reads the letter in capitals. */
  const appFront = () => !!pane && !focusOn();
  // under the browser boundary only the sandboxed app in front reports and holds back its ⌥ keys, while this view runs
  // (a var: paintTop can run before this line, during setup)
  var offAppKeys = globalThis.WizBrowserBoundary?.pressAppKeys?.(() => (appFront() ? paneFrame() : null)) || null;
  const offFrameKeys = globalThis.WizBrowserBoundary?.layoutKeys?.(FRAME_KEYS) || null;
  const appTarget = k => { const f = k ? paneFrame() : null; return f ? frameKeys(f).find(t => t.key === k) || null : null; };
  function pressApp(t) {
    const n = t.el;
    // a field as the target ('/' to search) takes the typing too (a click alone never focuses a field)
    try { if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName || '') || n.isContentEditable) n.focus?.({ preventScroll: true }); n.click?.(); } catch (_) {}
  }
  function frameKeys(f) {
    // a sandboxed app (browser boundary, wizard-os#133): the keys it reported, as stand-ins that press over the channel
    const B = globalThis.WizBrowserBoundary;
    if (B?.owns?.(f)) { try { return B.appKeys(f).filter(t => t && t.el && isAppKey(t.key)); } catch (_) { return []; } }
    let w = null, d = null; try { w = f.contentWindow; d = f.contentDocument; } catch (_) { return []; }
    if (!d || !w) return [];
    try { const l = w.WizardApp?.keys?.list?.(); if (Array.isArray(l)) return [...l].filter(t => t && t.el && isAppKey(t.key)); } catch (_) {}
    const box = n => n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0;
    const modal = [...d.querySelectorAll('[aria-modal="true"], [role="dialog"]:not([hidden]), dialog[open]')].filter(box).pop() || d;
    return [...modal.querySelectorAll('[data-wz-key]')].filter(n => box(n) && !n.closest('[hidden], [inert], [aria-hidden="true"]') && !n.disabled && n.getAttribute('aria-disabled') !== 'true')
      .map(n => ({ el: n, key: n.getAttribute('data-wz-key') || '', label: n.getAttribute('data-wz-key-label') || n.getAttribute('aria-label') || '' }))
      .filter(t => isAppKey(t.key));
  }
  const keyCap = k => String(k).toUpperCase();
  function midFree() {
    const r = hMid.getBoundingClientRect?.(); if (!r || typeof doc.elementFromPoint !== 'function') return true;
    const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !hit?.closest?.('button, a[href], input, textarea, select, iframe, [role="dialog"], .msg, .aad-side, .aad-vt, .aad-toast, .vc-sheet, h1, h2, h3, p, li');
  }

  /* ---------- the main area: Home (the new chat), a chat docked beside the sidebar, an app as the panel ---------- */
  function here(r = api.route()) {
    const d = desks().find(x => x.desk === r.desk), id = r.home ? '' : d?.id || '';
    const app = id && id !== CHATS && !(r.view === 'thread' || r.view === 'list') ? id : '';
    const note = !app && !r.home && r.view === 'thread' && r.thread === '__new__' && (noteWant || noteOn());
    // round 21: an app's Reply (a new chat holding its item) is a chat in the column, never Home's composer
    const draft = !app && !note && !r.home && r.view === 'thread' && r.thread === '__new__' && draftWant && onMainChats(r);
    return { app, thread: r.thread && r.thread !== '__new__' ? r.thread : null, note, draft, r };
  }
  let pending = false;
  const soon = fn => { if (pending) return; pending = true; api.after(0, () => { pending = false; fn(); }); };
  const onMainChats = r => { const m = mainChats(); return !m || r.desk === m.desk; };
  function onRoute(r) {
    if (r.desk === mainChats()?.desk || r.home) chatsFresh = !!r.home || (r.view === 'thread' && r.thread === '__new__');
    if (r.home) soon(() => { if (api.route().home) api.sessions.newChat(); });
    else if (r.view === 'list' && onMainChats(r)) soon(() => { const n = api.route(); if (n.view === 'list' && onMainChats(n)) api.sessions.newChat(); });
    paintTop(r);
  }
  let lastThread, frontApp = '';
  function paintTop(r = api.route()) {
    if (noteOn() || r.view !== 'thread' || (r.thread && r.thread !== '__new__')) noteWant = false;
    if (r.home || r.view !== 'thread' || r.thread !== '__new__' || !onMainChats(r)) draftWant = false;
    for (const w of chatWindows()) { const s = host.chats(w.id); if (onScreen(s?.notification)) s.placeNotificationRoute(); }
    const h = here(r);
    paintAgents();
    paintOrbIdentity(h.app);
    // an app coming to the front closes the picker; a repaint with the same app in front does not (round 21: ⌥A / + with
    // an app open flashed shut on the next render)
    if (h.app && h.app !== frontApp) closeAll();
    frontApp = h.app;
    if (focusOn() && (h.app || h.thread || h.note)) focusLeave();
    // the chat on screen: a thread, or a notification shown as one; with an app in front, the chat beside it stays
    // A notification in the chat column that becomes a chat (Resolve this / Have Wizard handle it, or a reply sent from
    // it) stays a chat in that column at its geometry, never Home laid out full width under the app panel (James, 6 Nov 2026).
    if (!h.app && pane && chatThread === NOTE && !h.thread && !h.note && !h.draft && !r.home && r.view === 'thread' && r.thread === '__new__' && onMainChats(r)) { draftWant = true; h.draft = true; }
    if (!h.app) chatThread = h.thread || (h.note ? NOTE : h.draft ? DRAFT : feedOn() ? FEED : null);
    // an app in front and no chat known yet (the page (re)loaded on that app, an update's reload): the channel feed or
    // the thread the Chats desk still holds docks beside it as before, never laid out as Home under the panel (cut off,
    // at its top). A feed left open is what the column showed (wizard-ux issue 1339).
    else if (chatThread === FEED ? !feedOn() : !chatThread) { if (chatThread === FEED) feedGone(); chatThread = !chatThread && feedOn() ? FEED : behindThread(); }
    const wasDocked = docked;
    paintSplit(!!chatThread);
    if (h.thread !== lastThread) { if (h.thread && lastThread !== undefined && wasDocked) anim('thread'); lastThread = h.thread; }
    root.dataset.aiFront = r.home ? 'chat' : h.app ? 'app' : r.view === 'list' ? 'list' : 'chat';
    const fresh = chatThread !== FEED && !h.app && !h.note && !h.draft && (r.home || (r.view === 'thread' && r.thread === '__new__'));
    root.dataset.aadNew = String(fresh && !r.home);
    const t = chatThread === NOTE ? noteTitle() : chatThread === DRAFT ? 'New chat' : chatThread === FEED ? `# ${feedOn()?.name || ''}` : chatThread ? feedTitle(chatThread) || titleOf(chatThread) : '';
    tt.textContent = docked ? t : ''; tt.title = t; paintBack();
    cX.setAttribute('aria-label', chatThread === NOTE ? 'Close the notification (Esc)' : chatThread === FEED ? 'Close the channel (Esc)' : 'Close the chat (Esc)');
    paintWs(); paintVt();
    if (root.dataset.aadSide === 'rail') paintRail(); else paintList();
    paintHome(); paintOne(h);
    syncOrb(); macHoles?.soon(); offAppKeys?.sync?.();
  }
  /* narrow desktop (ONE): which one thing shows (data-aad-one = app | chats), the sidebar for it (none beside an app;
   * at half width the list beside the chat; narrower the list or the chat), and the two Backs */
  function paintOne(h) {
    const on = one();
    // (crossing ONE.from: the column becomes the app bar or the column again, laid out for it at once)
    if (on !== oneWas) { oneWas = on; oneList = true; oneSeen = chatThread; if (on) closeTidy(); paintVt(true); applySizes(); retileSoon(); }
    oneSig = oneNow();
    // a chat opened (from the list, a notification, a key) shows that chat
    if (on && !h.app && chatThread !== oneSeen) { if (chatThread) oneList = false; oneSeen = chatThread; }
    const v = on ? (pane ? 'app' : 'chats') : '';
    if ((root.dataset.aadOne || '') !== v) { if (v) root.dataset.aadOne = v; else delete root.dataset.aadOne; }
    syncSide();
    // (a post opened from a channel's feed has its own "‹ # channel" Back there, cBack: one Back at a time)
    const back = on && !pane && !oneSplit() && !oneList && !feedBack() && !listBack();
    if (oneBack.hidden === back) oneBack.hidden = !back;
    if (back) { // named for the list it goes to (a channel's feed: Channels; else the list it was opened from)
      const v = chatThread === FEED ? 'channels' : api.sessions.channelView?.() || '', name = v === 'channels' ? 'Channels' : v === 'activity' ? 'Activity' : 'Chats';
      if (oneBack.textContent !== `‹ ${name}`) { oneBack.textContent = `‹ ${name}`; oneBack.title = 'Back (Esc)'; oneBack.setAttribute('aria-label', `Back to ${name} (Esc)`); }
    }
    const bh = docked ? cTop : top; if (back && oneBack.parentNode !== bh) bh.insertBefore(oneBack, bh.firstChild || null);
    paintBack(); // (the chat alone or its list: the column's Back follows)
    paintOneChats();
  }
  // the window crossing either of ONE's widths (one app with the app bar, the list beside the chat): all of it again
  // (Codex review: not only ONE.from)
  const oneNow = () => `${one()}|${oneSplit()}`;
  let oneSig = '';
  const oneCheck = () => { if (oneNow() !== oneSig) paintTop(); };
  api.listen(globalThis, 'resize', oneCheck);
  /* round 21 (Miguel, 4 Nov 2026): one left/right model for every open the shell starts by itself. An app (a
   * notification's Open, the launcher, a command) or a link an app owns = that app in the right panel, its one window
   * reused and taken to the page; a link no app owns = one link page in the same panel; no view opens beside a thread
   * by itself (links open when tapped). A Reply / a chat an app starts = a chat in the left column, the app stays. */
  api.apps.routeOpens?.({
    open(kind, d, go) {
      if (kind === 'beside') return true;
      if (kind === 'app' || (kind === 'link' && d.app)) {
        const id = kind === 'app' ? d.id : d.app, path = kind === 'app' ? d.path : d.url;
        if (!id || id === CHATS) return false;
        // A new app must use the original URL-bearing opener. A generic launcher open
        // may await setup, so applying path immediately afterwards loses the destination.
        goApp(id, null, path ? () => api.apps.path(id, path) : null, go); return true;
      }
      if (kind === 'link') { unpeek(); closeAll(); return api.apps.openLink(d.url, d.title); }
      if (kind === 'draft' || kind === 'thread') {
        unpeek(); closeAll(); if (q) setSearch(false);
        let ok = false; try { ok = !!go(); } catch (_) { ok = false; }
        if (ok && kind === 'draft') { draftWant = true; paintTop(); }
        return true;
      }
      return false;
    },
    // the app panel's desk, and the Chats desk while its chat is docked beside an app: both on screen
    shows: desk => (!!secondEl && deskOfNode(secondEl) === desk) || (panes.get().slots.includes('app') && !!pane && Number(pane.desk) === desk) || (docked && !!pane && !!dockEl && deskOfNode(dockEl) === desk),
  });
  api.on('route', r => { onRoute(r); api.after(260, syncOrb); });
  api.on('render', () => { readSessions(); paintTop(); });
  api.on('home', () => soon(() => { if (api.route().home) api.sessions.newChat(); }));
  // Settings opens as the centred panel over the page (Claude's settings modal), never as a window beside the chat
  const releaseSettings = host?.settings.overlay();
  { const r = api.route(); chatsFresh = !!r.home || (r.desk === mainChats()?.desk && r.view === 'thread' && r.thread === '__new__'); }
  readSessions(); paintSide(false); paintVt(true); paintTop(); paintBadges();
  const offHost = host?.onChange(() => { paintTop(); watchPaneWins(); });
  const offPanes = panes.subscribe(() => { paintTop(); applySizes(); retileSoon(); });
  globalThis.dispatchEvent?.(new Event('resize'));
  if (api.route().home) soon(() => { if (api.route().home) api.sessions.newChat(); });
  api.listen(css, 'load', () => api.after(260, () => syncOrb()));

  return () => {
    offAppKeys?.();
    offFrameKeys?.();
    offPanes(); for (const v of paneVars) root.style.removeProperty(v);
    for (const k of ['aadPaneSide', 'aadDockEdge', 'aadPaneTiled', 'aadMode']) delete root.dataset[k];
    closing?.(); closing = null; exitMotion?.cancel?.(); exitMotion = null;
    top.append(pTop); // release layout-owned chrome before restoring Classic Desks
    top.append(cTop); sTop.remove(); macHoles?.dispose();
    oneBack.remove();
    closeMenu(); closeWs(); offRws?.(); globalThis.WizWorkspaces?.close?.(); closeTidy(); closeAll(); closeFly(); offSearch?.(); offPeek?.(); ro?.disconnect(); stackRo?.disconnect(); animOff?.(); doneLoading(); toastOff?.(); tidyOff?.();
    scene.remove(); chrome.dispose(); unmountCss(); css.remove(); releaseSettings?.();
    offHost?.();
    for (const k of ['aiApps', 'aiFront', 'aadSide', 'aadTabs', 'aadHome', 'aadNew', 'aadAll', 'aadVoice', 'aadSplit', 'aadChat', 'aadWide', 'aadLoading', 'aadFocus', 'aadOne']) delete root.dataset[k];
    for (const w of wsps()) { delete w.dataset.aadRole; delete w.dataset.aadAnim; delete w.dataset.aadOmitted; delete w.dataset.aadModeHidden; delete w.dataset.aadStack; }
    delete root.dataset.aadResizing; for (const v of Object.values(SIZE_VARS)) root.style.removeProperty(v);
    globalThis.dispatchEvent?.(new Event('resize'));
  };
}
