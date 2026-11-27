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
import { appmenuPart } from './desktop-appmenu.js';
import { closingPart } from './desktop-closing.js';
import { columnPart } from './desktop-column.js';
import { escPart } from './desktop-esc.js';
import { feedPart } from './desktop-feed.js';
import { focusPart } from './desktop-focus.js';
import { homePart } from './desktop-home.js';
import { keysPart } from './desktop-keys.js';
import { modesPart } from './desktop-modes.js';
import { panesPart } from './desktop-panes.js';
import { readyPart } from './desktop-ready.js';
import { sectionsPart } from './desktop-sections.js';
import { sidebarPart } from './desktop-sidebar.js';
import { sidepaintPart } from './desktop-sidepaint.js';
import { sidetabsPart } from './desktop-sidetabs.js';
import { sizesPart } from './desktop-sizes.js';
import { splitPart } from './desktop-split.js';
import { tabsPart } from './desktop-tabs.js';
import { voicePart } from './desktop-voice.js';

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
  /* Values this view changes over time (wizard-ux issue 1665): the parts in layouts/ai-apps/desktop-*.js read and
   * write them as aadVars.<name>, accessors on these same variables, so every read and write is live. */
  const aadVars = {
    get actOlder() { return actOlder; }, set actOlder(v) { actOlder = v; },
    get badgeMap() { return badgeMap; }, set badgeMap(v) { badgeMap = v; },
    get chatsFresh() { return chatsFresh; }, set chatsFresh(v) { chatsFresh = v; },
    get chatThread() { return chatThread; }, set chatThread(v) { chatThread = v; },
    get closing() { return closing; }, set closing(v) { closing = v; },
    get docked() { return docked; }, set docked(v) { docked = v; },
    get dockEl() { return dockEl; }, set dockEl(v) { dockEl = v; },
    get draftWant() { return draftWant; }, set draftWant(v) { draftWant = v; },
    get dropped() { return dropped; }, set dropped(v) { dropped = v; },
    get exitMotion() { return exitMotion; }, set exitMotion(v) { exitMotion = v; },
    get feedFocus() { return feedFocus; }, set feedFocus(v) { feedFocus = v; },
    get fixingBehind() { return fixingBehind; }, set fixingBehind(v) { fixingBehind = v; },
    get fly() { return fly; }, set fly(v) { fly = v; },
    get focusGeneration() { return focusGeneration; }, set focusGeneration(v) { focusGeneration = v; },
    get focusHosted() { return focusHosted; }, set focusHosted(v) { focusHosted = v; },
    get focusing() { return focusing; }, set focusing(v) { focusing = v; },
    get focusStash() { return focusStash; }, set focusStash(v) { focusStash = v; },
    get focusWant() { return focusWant; }, set focusWant(v) { focusWant = v; },
    get fromFeed() { return fromFeed; }, set fromFeed(v) { fromFeed = v; },
    get fullFrom() { return fullFrom; }, set fullFrom(v) { fullFrom = v; },
    get glideUntil() { return glideUntil; }, set glideUntil(v) { glideUntil = v; },
    get laidOut() { return laidOut; }, set laidOut(v) { laidOut = v; },
    get loadId() { return loadId; }, set loadId(v) { loadId = v; },
    get manual() { return manual; }, set manual(v) { manual = v; },
    get menu() { return menu; }, set menu(v) { menu = v; },
    get noteWant() { return noteWant; }, set noteWant(v) { noteWant = v; },
    get offMenuBack() { return offMenuBack; }, set offMenuBack(v) { offMenuBack = v; },
    get offPeek() { return offPeek; }, set offPeek(v) { offPeek = v; },
    get offTidyBack() { return offTidyBack; }, set offTidyBack(v) { offTidyBack = v; },
    get oneLast() { return oneLast; }, set oneLast(v) { oneLast = v; },
    get oneList() { return oneList; }, set oneList(v) { oneList = v; },
    get oneSeen() { return oneSeen; }, set oneSeen(v) { oneSeen = v; },
    get oneWas() { return oneWas; }, set oneWas(v) { oneWas = v; },
    get oneWide() { return oneWide; }, set oneWide(v) { oneWide = v; },
    get pane() { return pane; }, set pane(v) { pane = v; },
    get paneGeometry() { return paneGeometry; }, set paneGeometry(v) { paneGeometry = v; },
    get peek() { return peek; }, set peek(v) { peek = v; },
    get pins() { return pins; }, set pins(v) { pins = v; },
    get pinsStored() { return pinsStored; }, set pinsStored(v) { pinsStored = v; },
    get q() { return q; }, set q(v) { q = v; },
    get secondEl() { return secondEl; }, set secondEl(v) { secondEl = v; },
    get sessions() { return sessions; }, set sessions(v) { sessions = v; },
    get sized() { return sized; }, set sized(v) { sized = v; },
    get sizing() { return sizing; }, set sizing(v) { sizing = v; },
    get splitTries() { return splitTries; }, set splitTries(v) { splitTries = v; },
    get stepAt() { return stepAt; }, set stepAt(v) { stepAt = v; },
    get tidyPop() { return tidyPop; }, set tidyPop(v) { tidyPop = v; },
    get vtDrawn() { return vtDrawn; }, set vtDrawn(v) { vtDrawn = v; },
    get vtFolded() { return vtFolded; }, set vtFolded(v) { vtFolded = v; },
    get want() { return want; }, set want(v) { want = v; },
    get wide() { return wide; }, set wide(v) { wide = v; },
    get wideAuto() { return wideAuto; }, set wideAuto(v) { wideAuto = v; },
    get wsPop() { return wsPop; }, set wsPop(v) { wsPop = v; },
  };
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
  /* Narrower window, one app at a time (ONE above): from the window's width alone, never stored. Bottom app bar on
   * desktop (wizard-ux issue 1692, switch wizard/desktop-bottom-bar, off by default): while it is on, the same one-app
   * layout at every width (the bar's items keep their 96 px and centre, Chats keeps its list beside the chat). */
  const barOn = () => { try { return String(root.dataset.tweaks || '').split(' ').includes('wizard/desktop-bottom-bar'); } catch (_) { return false; } };
  const one = () => barOn() || (globalThis.innerWidth || 1440) < ONE.from;
  /* Activity as a short what-needs-me list (wizard-ux issue 1336, part of Channels, on for everyone since issue 1258): no agent
   * chips (every agent's chats; agents live in the Channels list), Working, Ready (amber needs you and green unread
   * only), Recent (the rest, newest first, a week back, then Show older), Snoozed and Archived folded at the bottom,
   * one sort on Ready (Newest first, Oldest first, Needs you first), and one marker per row: spinner, amber or green. */
  const actOn = () => true; // tests that slice this file without it get the older list
  const ACT_SECTIONS = [['working', 'Working'], ['ready', 'Ready'], ['recent', 'Recent'], ['snoozed', 'Snoozed'], ['archive', 'Archived']];
  // (+ 'saved': sends a graceful restart holds, wizard-ux issue 1362; listed only while there are any)
  const LKINDS = [...KINDS, 'recent', 'saved'];
  let actOlder = false;
  /* The app panel on the left and placing the panes; layouts/ai-apps/desktop-panes.js. */
  const { desks, el, flipSides, icon, oneSplit, paneModel, placePanes, swapOn, swapped, bindLate: panesLate } = panesPart({ aadVars, api, COLS, doc, flip, one, ONE, panes, paneVars, RAIL, root });
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
  /* A row's tracker dots and the sidebar's header; layouts/ai-apps/desktop-sidebar.js. */
  const { agentName, appName, badgeText, cancelBtn, field, findBtn, foot, fuel, head, khMarks, lit, newBtn, rail, readSessions, scroll, searchBox, setBtn, side, titleOf, togBtn, ttAgent, ttDots, wsBtn, wsName } = sidebarPart({ aadVars, actOn, api, desks, el, icon, LKINDS });
  /* Swap sides (wizard-ux issue 1526, switch wizard/swap-sides): a button in the chats sidebar's header, before ◫, only
   * while the switch is on (paintSwap) */
  const sSwap = el('button', 'aad-ib aad-sswap', { type: 'button', 'aria-keyshortcuts': 'Alt+Shift+L' }); sSwap.append(icon('swap')); sSwap.hidden = true;
  /* The rail's Wizard switcher, the agent choices, the Channels pane and another Chats look; layouts/ai-apps/desktop-sidetabs.js. */
  const { cBack, chanTitle, cTop, cX, FEED, feedBox, feedOn, modeBars, oneBack, paintAgents, paintChan, paintView, pIcon, pName, pTools, pTop, pW, pX, rFind, rList, rNew, rSet, rTog, rWs, shade, sName, sTop, top, tt, windowMode, bindLate: sidetabsLate } = sidetabsPart({ aadVars, actOn, api, el, flip, foot, head, icon, one, oneSplit, panes, rail, readSessions, scroll, side });
  // (in memory only: after a reload in full screen, Esc goes to tiled)
  var fullFrom = 'tiled';
  /* The window arrangement buttons and the Mac title-bar strip; layouts/ai-apps/desktop-modes.js. */
  const { macHoles, paintModes, bindLate: modesLate } = modesPart({ aadVars, api, cTop, cX, doc, el, MODE_LABELS, modeBars, panes, pTop, pW, root, sTop, top, windowMode });
  /* A slow app's placeholder, the apps column on the right and the orb's place; layouts/ai-apps/desktop-column.js. */
  const { chrome, cv, fb, hBack, hMid, near, orbAt, orbBox, orbBtn, paintOrbIdentity, pLoad, pLoadT, scene, tidyBtn, tidyW, toast, toastU, toastW, vChats, vChatsN, vOne, vtAll, vtFoot, vtList, vtTog } = columnPart({ api, desks, doc, el, feedBox, icon, shade, side, top });

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
    // (sides swapped, wizard-ux issue 1526: the rail is at the sidebar's right edge, so the reveal opens leftwards)
    const swappedNow = typeof swapped === 'function' && swapped(), sideKey = swappedNow ? 'R' : 'L';
    if (relayout && was === 'rail' && mode !== 'rail' && !reduced() && typeof side.animate === 'function') side.animate([{ clipPath: swappedNow ? `inset(0 0 0 calc(100% - ${RAIL}px))` : `inset(0 calc(100% - ${RAIL}px) 0 0)` }, { clipPath: 'inset(0 0 0 0)' }], { duration: FLIP_MS, easing: EASE });
    const open = mode !== 'rail';
    if (open) closeFly();
    togBtn.title = `Close sidebar (⌥${sideKey})`;
    togBtn.setAttribute('aria-expanded', String(open)); rTog.setAttribute('aria-expanded', String(open));
    rTog.title = `Open sidebar (⌥${sideKey})`;
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
  /* Which sidebar sections are open, Ready's grouping and the rows' times; layouts/ai-apps/desktop-sections.js. */
  const { actOrder, groupBy, readyOrder, secOpen, setActOrder, setGroup, setOrder, setWorkingOrder, workingOrder, bindLate: sectionsLate } = sectionsPart({ actOn, api, readSessions, root, scroll });
  const unpeek = () => { if (!peek) return; peek = false; offPeek?.(); offPeek = null; paintSide(); };
  api.listen(togBtn, 'click', toggleSide); api.listen(rTog, 'click', toggleSide);
  api.listen(shade, 'click', unpeek);
  api.listen(globalThis, 'wos:thread-tracker', () => paintList());
  // A draft appeared or went (wizard-ux issue 1445): the Activity rows' ✎ Draft follows at once.
  api.listen(globalThis, 'wos:drafts-keys', () => { if (root.dataset.aadSide === 'rail' || !(typeof actOn === 'function' && actOn())) return; readSessions(); paintList(); });
  // a switch turned on or off (Channels, issue 1256): the pane, the "# channel" lines and the Focus a feed held
  api.listen(globalThis, 'wos:experience', () => { if (chatThread === FEED && !feedOn()) paintTop(); paintSetting(); paintAgents(); if (root.dataset.aadSide === 'rail') return; paintChan(); readSessions(); paintList(true); });
  // the Default Chats look changed, failed or the switch flipped (issue 1443): the sidebar (or rail) follows
  const viewRepaint = () => { if (root.dataset.aadSide === 'rail') paintRail(true); else paintList(true); };
  api.listen(globalThis, 'wos:chats-view', viewRepaint);
  api.listen(globalThis, 'wos:experience', () => { if (root.dataset.aadSide === 'rail') paintRail(true); });
  api.listen(globalThis, 'resize', syncSide);
  api.keys.on({ down: e => { if (!isSideKey(e) || e.repeat) return false; toggleSide(); return true; } });
  /* ---------- round 9 (Miguel, 2 Nov 2026): the panels resizable by drag (round 15: the sidebar, the open apps, the app panel) ----------
   * A thin separator on its inner edge (a hairline in the accent on hover); drag it, or ←/→ (⇧ for bigger steps) with it
   * focused; a double click or Enter goes back to the default. Kept per device. */
  let sized = { ...(api.storage.get('widths') || {}) }, sizing = '', laidOut = '';
  /* Each panel's width, dragging a grip and re-tiling; layouts/ai-apps/desktop-sizes.js. */
  const { applySizes, grip, retileSoon, setSize, SIZE_VARS, sizes, vw, bindLate: sizesLate } = sizesPart({ aadVars, api, COLS, el, FLIP_MS, host, paneWins, placePanes, RAIL, root, scene, SIDE, SIZE_LIMITS });
  panesLate({ vw });

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
  /* Home, + and the cog's count; layouts/ai-apps/desktop-home.js. */
  const { appTile, goApp, goHome, metaOf, plus, settings, bindLate: homeLate } = homePart({ aadVars, api, appName, cancelBtn, closeMenu, closeWs, desks, el, FEED, feedOn, field, findBtn, loading, newBtn, panes, rFind, rNew, rSet, scroll, setBtn, setSearch, unpeek });
  let chatsFresh = false;
  /* App keys (Miguel, 4 Nov 2026: drive every app from the keyboard): the app picked by key (⌥1–⌥0, ⌥[ ]) or by click
   * takes the keyboard once it is the panel (its own typing, its own plain keys); its ⌥ keys (data-wz-key) the view
   * presses for it (App keys, at the key handler). */
  let focusWant = '', focusing = false, focusGeneration = 0, focusHosted = null;
  /* Focusing an app, All apps and the pinned apps; layouts/ai-apps/desktop-focus.js. */
  const { allOpenNow, canPin, closeAll, focusFrame, home, installedIds, openAll, paneFrame, pinApps, wantAppFocus, bindLate: focusLate } = focusPart({ aadVars, api, badgeText, chrome, closeMenu, closeWs, desks, doc, frameReady, goApp, host, lit, panelWindow, setSearch, unpeek, vtAll });
  homeLate({ closeAll, wantAppFocus });
  // (until he pins or unpins, the defaults follow the installed list: it can still be empty on the first paint)
  let pinsStored = api.storage.get('pins'), pins = pinsFrom(pinsStored, installedIds());
  /* An app's quick actions, the apps grid and a chat row; layouts/ai-apps/desktop-appmenu.js. */
  const { chatRow, openAppMenu, paintHome, placeHome, refreshPins, setPins, bindLate: appmenuLate } = appmenuPart({ aadVars, api, canPin, chanTitle, closeAll, closeMenu, closeWs, desks, el, goApp, home, homeComposer, icon, installedIds, khMarks, openMenu, root, scene, setSearch, ttAgent, ttDots, unpeek });
  focusLate({ openAppMenu });
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
  /* The sort and group menu, the order in Settings and painting the sidebar; layouts/ai-apps/desktop-sidepaint.js. */
  const { curChat, FLY_MS, FLY_OUT_MS, openChat, paintList, paintRail, paintSetting, railMode, railNow, bindLate: sidepaintLate } = sidepaintPart({ aadVars, ACT_SECTIONS, actOn, actOrder, api, badgeText, chatRow, closeFly, closeMenu, el, flyLeave, flyWant, groupBy, icon, LKINDS, paintChan, paintFly, paintView, panes, readSessions, readyOrder, rList, root, scene, scroll, secOpen, setActOrder, setGroup, setOrder, setSearch, setWorkingOrder, workingOrder });
  sidetabsLate({ paintList, paintRail });
  sectionsLate({ paintList, paintRail, paintSetting });
  homeLate({ paintList });
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
    // (sides swapped, wizard-ux issue 1526: the rail is on the right, so its list opens to its left)
    const rb = rail.getBoundingClientRect?.(), x = typeof swapped === 'function' && swapped() ? (rb?.left ?? (globalThis.innerWidth || 1440) - RAIL) - 6 - (card.offsetWidth || 280) : (rb?.right || RAIL) + 6;
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
  /* The Wizard switcher menus and the orb: click talks, hold commands; layouts/ai-apps/desktop-voice.js. */
  const { behindThread, chatsEl, mainChats, offRws, placeOrb, ro, syncOrb, talkFromOrb, vtTabs, wsps } = voicePart({ aadVars, api, appName, chrome, closeFly, closeMenu, closeWs, cv, desks, doc, fb, homeComposer, host, lit, mainChatWindow, near, one, openWs, orbAt, orbBox, orbBtn, paintFuel, paintWs, pinApps, placeHome, placementOf, placements, plus, rail, refreshPins, root, rWs, scene, wsBtn });
  sizesLate({ syncOrb });
  homeLate({ mainChats });
  let manual = api.storage.get('vtManual') === true;
  let vtFolded = api.storage.get('tabsFolded') === true, vtDrawn = '';
  /* The open-apps column: its rows, moving them and dragging to rearrange; layouts/ai-apps/desktop-tabs.js. */
  const { closeDesk, dropTo, oneApp, paintOneChats, paintTools, paintVt, toggleTabs, bindLate: tabsLate } = tabsPart({ aadVars, api, applySizes, appName, appTile, badgeText, behindThread, closeAll, closeMenu, desks, el, FEED, flip, focusLeave, goApp, goHome, host, icon, metaOf, one, oneBack, oneSplit, openAppMenu, orbBox, paneFrame, panelWindow, pTools, retileSoon, root, setPins, shownDesks, top, vChats, vChatsN, vOne, vtList, vtTabs, vtTog });
  appmenuLate({ dropTo, paintVt });
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
  homeLate({ NOTE });
  sidepaintLate({ NOTE });
  const notificationSurface = () => chatWindows().map(w => host.chats(w.id)).find(s => onScreen(s?.notification));
  const noteOn = () => !!notificationSurface();
  const noteTitle = () => notificationSurface()?.notificationTitle || 'Notification';
  let dropped = null;   // the panel just hidden for Home / Focus while the route still names its app
  /* The app beside a chat after a reload, the split and a channel feed in the chat column; layouts/ai-apps/desktop-split.js. */
  const { paintSplit, bindLate: splitLate } = splitPart({ aadVars, anim, api, applySizes, appName, appTile, chatsEl, cTop, cX, desks, doneLoading, FEED, feedBox, flip, focusFrame, homeComposer, host, markUsed, one, orbBox, paintModes, paintTools, paneModel, paneWins, pIcon, placementOf, pName, pTop, pX, retileSoon, root, sName, sTop, syncSide, top, waitLoaded, watchPaneWins, wsps });
  // The post last opened from the feed (its row or its Reply), and the channel it was opened in.
  let fromFeed = null;
  /* A post opened from a channel feed and the way back to it; layouts/ai-apps/desktop-feed.js. */
  const { feedBack, feedOpened, feedTitle, paintBack, bindLate: feedLate } = feedPart({ aadVars, api, cBack, chanTitle, FEED, feedBox, feedGone, feedOn, mainChats, one, oneSplit, panes, unpeek });
  let feedFocus = null;
  // the feed left the column (Esc, ✕, its own Back to channels): the app it was brought in front of gets the front back
  function feedGone() { if (feedFocus && pane && panes.get().focus === 'chats') panes.set({ focus: feedFocus }); feedFocus = null; }
  api.listen(globalThis, 'wos:channel-feed', e => feedOpened(e?.detail?.open || null));
  // the panel hides (the app keeps running on its desk): back to the chat (docked) or Home
  let closing = null, exitMotion = null;
  /* Hiding the app panel, closing the chat column and Back; layouts/ai-apps/desktop-closing.js. */
  const { chatBack, closeChat, hidePanel, listBack, setWide, bindLate: closingLate } = closingPart({ aadVars, anim, api, cX, doneLoading, DRAFT, FEED, feedBack, feedGone, flip, focusFrame, icon, mainChats, one, oneSplit, paintSide, paintSplit, panes, peekable, pTop, pW, pX, reduced, retileSoon, root, wantAppFocus });
  modesLate({ setSize, setWide });
  homeLate({ hidePanel });
  tabsLate({ closeChat, hidePanel, setWide });
  splitLate({ setWide });
  feedLate({ chatBack, listBack });
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
  /* The tidy sheet and Esc stepping back one layer; layouts/ai-apps/desktop-esc.js. */
  const { openTidy, typing, bindLate: escLate } = escPart({ aadVars, api, chatBack, chatsEl, closeMenu, closeTidy, cTop, doc, el, feedBack, goApp, listBack, one, oneApp, oneSplit, paintList, paintTidy, panes, pTop, side, tidyBtn, tidyKey, vtAll, vtFoot, windowMode });
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
  /* Stepping through Ready; layouts/ai-apps/desktop-ready.js. */
  const { KEY_LIKE, readyIds, stepReady, bindLate: readyLate } = readyPart({ aadVars, actOn, api, curChat, groupBy, railNow, readSessions, readyOrder, root, scroll, showToast });
  /* Now playing marks, the keycaps while left Option is held and the app keys; layouts/ai-apps/desktop-keys.js. */
  const { focusOn, here, markMedia, offAppKeys, offFrameKeys, onMainChats, onScreen, paintTop, releaseSettings, soon } = keysPart({ aadVars, allOpenNow, anim, api, appKeyOf, applySizes, appName, behindThread, chanTitle, chatAction, chatParts, chatWindows, closeAll, closeChat, closeDesk, closeTidy, closeWs, cTop, curChat, cX, deskOfNode, desks, doc, DRAFT, el, FEED, feedBack, feedGone, feedOn, feedTitle, findBtn, focusIn, focusLeave, focusOut, FRAME_KEYS, goApp, grip, hBack, hidePanel, hMid, homeComposer, host, isAppKey, KEY_LIKE, khMarks, listBack, macHoles, mainChats, MODE_KEYS, MODE_LABELS, modeBars, narrow, newBtn, NOTE, noteOn, noteTitle, one, oneBack, oneSplit, openAll, openTidy, openWs, orbBtn, paintAgents, paintBack, paintHome, paintList, paintOneChats, paintOrbIdentity, paintRail, paintSplit, paintVt, paintWs, paneFrame, panes, pIcon, plus, pW, pX, railMode, readSessions, readyIds, readyOrder, retileSoon, rFind, rList, rNew, root, rSet, rTog, setBtn, setSearch, setSize, settings, setWide, side, sizes, stepReady, swapOn, swapped, swapSides, syncOrb, syncSide, talkFromOrb, tidyBtn, titleOf, togBtn, toggleSide, toggleTabs, top, tt, typing, unpeek, vtAll, vtList, vtTog, windowMode, wsBtn, wsName });
  sidetabsLate({ paintTop });
  sidepaintLate({ here });
  tabsLate({ here, markMedia, paintTop });
  splitLate({ here, onMainChats, paintTop });
  feedLate({ here, paintTop });
  closingLate({ here, paintTop });
  escLate({ paintTop });
  readyLate({ here });
  readSessions(); paintSide(false); paintVt(true); paintTop(); paintBadges();
  const offHost = host?.onChange(() => { paintTop(); watchPaneWins(); });
  let swapWas = swapped();
  const offPanes = panes.subscribe(() => { paintTop(); applySizes(); retileSoon(); paintSwap(); });
  /* Swap sides (wizard-ux issue 1526): the button, ⌥⇧L and the switch turned on or off */
  function swapSides() { flipSides([side, vtList.parentNode, top, orbBox, ...shownDesks()]); }
  function paintSwap() {
    const show = swapOn() && !one(), on = swapped(), t = on ? 'Move the chats to the left (⌥⇧L)' : 'Move the chats to the right (⌥⇧L)';
    if (sSwap.hidden !== !show) sSwap.hidden = !show;
    if (show && sSwap.parentNode !== head) head.insertBefore(sSwap, togBtn); else if (!show && sSwap.parentNode) sSwap.remove();
    if (sSwap.title !== t) { sSwap.title = t; sSwap.setAttribute('aria-label', t); }
    sSwap.setAttribute('aria-pressed', String(on));
    if (swapWas !== on) { swapWas = on; paintSide(false); paintVt(true); }
  }
  api.listen(sSwap, 'click', e => { e.stopPropagation(); swapSides(); });
  const swapCheck = () => { const was = swapWas; paintSwap(); if (was !== swapWas) { paintTop(); applySizes(); retileSoon(); } };
  // (the bottom app bar switch flipped: the one-app layout comes or goes at once, no reload; paintOne lays it out)
  let barWas = barOn();
  const barCheck = () => { if (barOn() === barWas) return; barWas = barOn(); paintTop(); paintSwap(); };
  api.listen(globalThis, 'wos:experience', barCheck);
  api.listen(globalThis, 'wos:experience', swapCheck);
  const swapMo = globalThis.MutationObserver ? new MutationObserver(() => { barCheck(); swapCheck(); }) : null; swapMo?.observe(root, { attributes: true, attributeFilter: ['data-tweaks'] });
  api.listen(globalThis, 'resize', () => paintSwap());
  paintSwap();
  globalThis.dispatchEvent?.(new Event('resize'));
  if (api.route().home) soon(() => { if (api.route().home) api.sessions.newChat(); });
  api.listen(css, 'load', () => api.after(260, () => syncOrb()));

  return () => {
    offAppKeys?.();
    offFrameKeys?.();
    offPanes(); for (const v of paneVars) root.style.removeProperty(v);
    for (const k of ['aadPaneSide', 'aadDockEdge', 'aadPaneTiled', 'aadMode', 'aadAppSide']) delete root.dataset[k];
    swapMo?.disconnect(); sSwap.remove();
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
