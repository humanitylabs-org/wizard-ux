/* Wizard UX AI apps view (desktop) › now playing marks, the keycaps while left Option is held and the app keys. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { railActive, readyStep } from './parts.js';
import { CHATS } from '../apps/chrome.js';
export function keysPart({ aadVars, allOpenNow, anim, api, appKeyOf, applySizes, appName, behindThread, chanTitle, chatAction, chatParts, chatWindows, closeAll, closeChat, closeDesk, closeTidy, closeWs, cTop, curChat, cX, deskOfNode, desks, doc, DRAFT, el, FEED, feedBack, feedGone, feedOn, feedTitle, findBtn, focusIn, focusLeave, focusOut, FRAME_KEYS, goApp, grip, hBack, hidePanel, hMid, homeComposer, host, isAppKey, KEY_LIKE, khMarks, listBack, macHoles, mainChats, MODE_KEYS, MODE_LABELS, modeBars, narrow, newBtn, NOTE, noteOn, noteTitle, one, oneBack, oneSplit, openAll, openTidy, openWs, orbBtn, paintAgents, paintBack, paintHome, paintList, paintOneChats, paintOrbIdentity, paintRail, paintSplit, paintVt, paintWs, paneFrame, panes, pIcon, plus, pW, pX, railMode, readSessions, readyIds, readyOrder, retileSoon, rFind, rList, rNew, root, rSet, rTog, setBtn, setSearch, setSize, settings, setWide, side, sizes, stepReady, swapOn, swapped, swapSides, syncOrb, syncSide, talkFromOrb, tidyBtn, titleOf, togBtn, toggleSide, toggleTabs, top, tt, typing, unpeek, vtAll, vtList, vtTog, windowMode, wsBtn, wsName }) {
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
    if (sh && code === 'KeyL' && swapOn() && !one()) return once(swapSides);   // swap sides (wizard-ux issue 1526)
    // voice: the shell's own keys (⌥D into the open chat's box, ⌥V a new voice chat, ⌥C a command); ⌥Space = the orb
    if (code === 'KeyV' || code === 'KeyC' || code === 'KeyD') return false;
    // a word with an accent while typing (⌥E é, ⌥U ü, ⌥I î on a Mac) and ⌥← / ⌥→ word jumps stay the field's
    if (typing() && /^(KeyE|KeyU|KeyI|ArrowLeft|ArrowRight)$/.test(code)) return false;
    // the app in front: ⌥ + a key it marks (data-wz-key) presses that control, also from inside its frame and while
    // typing there; a letter it claims beats the view's own meaning for it while it is in front (⌥K = its key, not
    // search); Wizard's keys (RESERVED_KEYS) never reach it; nothing marked: the view's meaning below
    if (!sh && appFront()) { const t = appTarget(appKeyOf(code)); if (t) { if (!e.repeat) pressApp(t); return true; } }
    if (code === 'Space' && !sh) return once(talkFromOrb);
    if ((code === 'ArrowDown' || code === 'ArrowUp') && !sh) { if (!e.repeat || here().thread) stepReady(code === 'ArrowDown' ? 1 : -1); return true; }
    // ⌥H Home: everything away (both sides, the chat, the app); ⌥H again: back exactly as it was (⌥` the same, quietly)
    if ((code === 'KeyH' || code === 'Backquote') && !sh) return once(() => (focusOn() && aadVars.focusStash ? focusOut : focusIn)());
    if (code === 'KeyS' && !sh) return once(settings);
    if (code === 'KeyN' && !sh) return once(plus);
    if (code === 'KeyK' && !sh) return once(() => setSearch(true));
    // ⌥L / ⌥R fold the left / right side: with the sides swapped (wizard-ux issue 1526) the apps are left, the chats right
    if (code === 'KeyL' && !sh) return once(swapped() ? toggleTabs : toggleSide);
    if (code === 'KeyR' && !sh) return once(swapped() ? toggleSide : toggleTabs);
    // ⌥O opens what the header name opens: the shared switcher with two or more Wizards (saved ones too), else this list
    if (code === 'KeyO' && !sh) return once(() => { if (aadVars.wsPop) { closeWs(); return; } if (root.dataset.aadSide === 'rail' && !narrow()) toggleSide(); const W = globalThis.WizWorkspaces; if (W?.visible && W.openMenu) { W.openMenu(wsBtn); return; } openWs(); });
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
    if ((code === 'Minus' || code === 'Equal') && !sh) { if (aadVars.pane && !aadVars.wide) setSize('app', sizes().app[0] + (code === 'Equal' ? 64 : -64), true); return true; }
    if (code === 'KeyW' && !sh && aadVars.pane) { if (!e.repeat) { const d = desks().find(x => x.desk === aadVars.pane.desk); if (d && !aadVars.pins.includes(d.id)) closeDesk(d); else hidePanel(); } return true; }
    if (code === 'KeyW' && !sh && aadVars.docked) { if (!e.repeat) closeChat(); return true; }
    if (code === 'KeyF' && !sh && aadVars.pane) { if (!e.repeat) { aadVars.wideAuto = false; setWide(!aadVars.wide); } return true; }
    // The open item's own buttons change its state, never the selected thread.
    // Keep the existing letters: ⌥E Archive, ⌥Z Snooze. A and S already open All apps and Settings.
    const act = !sh && aadVars.docked && !typing() && { KeyZ: 'snooze', KeyE: 'done', KeyX: 'resolve' }[code];
    if (act) { if (!e.repeat) chatBtn(act)?.click?.(); return true; }
    if (code === 'KeyB' && !sh) { if (!e.repeat && aadVars.docked && frontNote()) routeBtn()?.click?.(); return true; }
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
  const frontNote = () => aadVars.chatThread === NOTE || here().note;
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
    const midH = () => { if (!aadVars.pane && !aadVars.docked && !aadVars.fly && !aadVars.q && !aadVars.wsPop && !aadVars.menu && !aadVars.tidyPop && midFree()) out.push({ el: hMid, key: 'H', at: 'mid', free: true }); };
    if (focusOn()) { put(hBack, 'H'); midH(); return out; }
    const open = root.dataset.aadSide === 'open';
    if (open) { put(wsName, 'H', 'below'); put(wsBtn.querySelector('.aad-wsc'), 'O', 'right'); }
    put(open ? togBtn : rTog, swapped() ? 'R' : 'L'); put(open ? findBtn : rFind, 'K'); put(open ? newBtn : rNew, 'N'); put(open ? setBtn : rSet, 'S');
    const ids = readyIds(), cur = curChat(), nx = ids.length ? readyStep(ids, ids.includes(cur) ? cur : null, 1) : null, pv = ids.length > 2 && ids.includes(cur) ? readyStep(ids, cur, -1) : null;
    if (open) {
      // ↓ / ↑ on the very rows ⌥↓ / ⌥↑ open (the drawn Ready, in its order)
      // (the row makes room at its start while ⌥ is held, data-aad-kh, so the keycap never touches its title)
      const row = (id, k) => { const w = id && [...side.querySelectorAll('.aad-rw[data-kind="ready"]')].find(r => r.dataset.sid === id); const b = w?.querySelector('.aad-row'); if (shown(b)) { w.dataset.aadKh = k; khMarks.set(id, k); put(b, k, 'inside-l'); } };
      if (nx && nx.id !== cur) row(nx.id, '↓'); if (pv && pv.id !== cur) row(pv.id, '↑');
    } else {
      // folded: on the rail word whose group holds it (its status, else Ready)
      const s = aadVars.sessions || readSessions(), rk = id => { const a = id && railActive(s, id, null, readyOrder(), railMode()); return a && [...rList.querySelectorAll('.aad-rk')].find(n => n.dataset.k === a.key); };   // (a project key may hold any character)
      const n1 = nx && nx.id !== cur ? rk(nx.id) : null, p1 = pv && pv.id !== cur ? rk(pv.id) : null;
      // (beside the rail word, never over its count; both on one word: ↑ over ↓)
      if (n1) put(n1, '↓', p1 === n1 ? 'right-dn' : 'right'); if (p1) put(p1, '↑', p1 === n1 ? 'right-up' : 'right');
    }
    put(vtTog, swapped() ? 'L' : 'R');
    const rows = vtRows(), i = rows.findIndex(b => b.classList.contains('is-on')), tile = b => b.querySelector('.aad-tile') || b;
    rows.forEach((b, k) => { if (k < 10) put(tile(b), String((k + 1) % 10)); });
    if (rows.length > 1) {
      const nb = rows[i < 0 ? 0 : (i + 1) % rows.length], pb = rows[i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length];
      const at = aadVars.vtFolded ? 'bl' : 'tr';   // (folded: under the icon, clear of its count badge)
      put(tile(nb), ']', at); if (pb !== nb) put(tile(pb), '[', at);
    }
    put(vtAll.querySelector('.aad-vti') || vtAll, 'A'); put(tidyBtn.querySelector('.aad-tidy-i') || tidyBtn, 'T');
    // ⌥P on the icon of what played last: on its bars while they play, else on the icon itself
    const np = api.media?.list?.()[0], npRow = np && rows.find(b => b.dataset.app === np.appId);
    if (npRow) { const bars = npRow.querySelector('.aad-np'); put(np.playing && bars ? bars : tile(npRow), 'P', np.playing && bars ? 'mid' : 'bl'); }
    if (aadVars.pane) { put(pX, 'W'); put(pW, 'F'); if (!aadVars.wide) put(grip.app, '− =', 'mid'); put(pIcon, 'H'); } else if (aadVars.docked) put(cX, 'W');
    for (const { bar } of modeBars) for (const [code, mode] of Object.entries(MODE_KEYS)) {
      const n = bar.querySelector('[data-mode="' + mode + '"]');
      if (shown(n)) out.push({ el: n, key: '⇧' + code.slice(3), at: 'below', word: MODE_LABELS[mode] });
    }
    midH();
    if (aadVars.docked) {
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
  const appFront = () => !!aadVars.pane && !focusOn();
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
    const note = !app && !r.home && r.view === 'thread' && r.thread === '__new__' && (aadVars.noteWant || noteOn());
    // round 21: an app's Reply (a new chat holding its item) is a chat in the column, never Home's composer
    const draft = !app && !note && !r.home && r.view === 'thread' && r.thread === '__new__' && aadVars.draftWant && onMainChats(r);
    return { app, thread: r.thread && r.thread !== '__new__' ? r.thread : null, note, draft, r };
  }
  let pending = false;
  const soon = fn => { if (pending) return; pending = true; api.after(0, () => { pending = false; fn(); }); };
  const onMainChats = r => { const m = mainChats(); return !m || r.desk === m.desk; };
  function onRoute(r) {
    if (r.desk === mainChats()?.desk || r.home) aadVars.chatsFresh = !!r.home || (r.view === 'thread' && r.thread === '__new__');
    if (r.home) soon(() => { if (api.route().home) api.sessions.newChat(); });
    else if (r.view === 'list' && onMainChats(r)) soon(() => { const n = api.route(); if (n.view === 'list' && onMainChats(n)) api.sessions.newChat(); });
    paintTop(r);
  }
  let lastThread, frontApp = '';
  function paintTop(r = api.route()) {
    if (noteOn() || r.view !== 'thread' || (r.thread && r.thread !== '__new__')) aadVars.noteWant = false;
    if (r.home || r.view !== 'thread' || r.thread !== '__new__' || !onMainChats(r)) aadVars.draftWant = false;
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
    if (!h.app && aadVars.pane && aadVars.chatThread === NOTE && !h.thread && !h.note && !h.draft && !r.home && r.view === 'thread' && r.thread === '__new__' && onMainChats(r)) { aadVars.draftWant = true; h.draft = true; }
    if (!h.app) aadVars.chatThread = h.thread || (h.note ? NOTE : h.draft ? DRAFT : feedOn() ? FEED : null);
    // an app in front and no chat known yet (the page (re)loaded on that app, an update's reload): the channel feed or
    // the thread the Chats desk still holds docks beside it as before, never laid out as Home under the panel (cut off,
    // at its top). A feed left open is what the column showed (wizard-ux issue 1339).
    else if (aadVars.chatThread === FEED ? !feedOn() : !aadVars.chatThread) { if (aadVars.chatThread === FEED) feedGone(); aadVars.chatThread = !aadVars.chatThread && feedOn() ? FEED : behindThread(); }
    const wasDocked = aadVars.docked;
    paintSplit(!!aadVars.chatThread);
    if (h.thread !== lastThread) { if (h.thread && lastThread !== undefined && wasDocked) anim('thread'); lastThread = h.thread; }
    root.dataset.aiFront = r.home ? 'chat' : h.app ? 'app' : r.view === 'list' ? 'list' : 'chat';
    const fresh = aadVars.chatThread !== FEED && !h.app && !h.note && !h.draft && (r.home || (r.view === 'thread' && r.thread === '__new__'));
    root.dataset.aadNew = String(fresh && !r.home);
    const t = aadVars.chatThread === NOTE ? noteTitle() : aadVars.chatThread === DRAFT ? 'New chat' : aadVars.chatThread === FEED ? (typeof chanTitle === 'function' ? chanTitle(feedOn()) : `# ${feedOn()?.name || ''}`) : aadVars.chatThread ? feedTitle(aadVars.chatThread) || titleOf(aadVars.chatThread) : '';
    tt.textContent = aadVars.docked ? t : ''; tt.title = t; paintBack();
    cX.setAttribute('aria-label', aadVars.chatThread === NOTE ? 'Close the notification (Esc)' : aadVars.chatThread === FEED ? 'Close the channel (Esc)' : 'Close the chat (Esc)');
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
    if (on !== aadVars.oneWas) { aadVars.oneWas = on; aadVars.oneList = true; aadVars.oneSeen = aadVars.chatThread; if (on) closeTidy(); paintVt(true); applySizes(); retileSoon(); }
    oneSig = oneNow();
    // a chat opened (from the list, a notification, a key) shows that chat
    if (on && !h.app && aadVars.chatThread !== aadVars.oneSeen) { if (aadVars.chatThread) aadVars.oneList = false; aadVars.oneSeen = aadVars.chatThread; }
    const v = on ? (aadVars.pane ? 'app' : 'chats') : '';
    if ((root.dataset.aadOne || '') !== v) { if (v) root.dataset.aadOne = v; else delete root.dataset.aadOne; }
    syncSide();
    // (a post opened from a channel's feed has its own "‹ # channel" Back there, cBack: one Back at a time)
    const back = on && !aadVars.pane && !oneSplit() && !aadVars.oneList && !feedBack() && !listBack();
    if (oneBack.hidden === back) oneBack.hidden = !back;
    if (back) { // named for the list it goes to (a channel's feed: Channels; else the list it was opened from)
      const v = aadVars.chatThread === FEED ? 'channels' : api.sessions.channelView?.() || '', name = v === 'channels' ? 'Channels' : v === 'activity' ? 'Activity' : 'Chats';
      if (oneBack.textContent !== `‹ ${name}`) { oneBack.textContent = `‹ ${name}`; oneBack.title = 'Back (Esc)'; oneBack.setAttribute('aria-label', `Back to ${name} (Esc)`); }
    }
    const bh = aadVars.docked ? cTop : top; if (back && oneBack.parentNode !== bh) bh.insertBefore(oneBack, bh.firstChild || null);
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
        unpeek(); closeAll(); if (aadVars.q) setSearch(false);
        let ok = false; try { ok = !!go(); } catch (_) { ok = false; }
        if (ok && kind === 'draft') { aadVars.draftWant = true; paintTop(); }
        return true;
      }
      return false;
    },
    // the app panel's desk, and the Chats desk while its chat is docked beside an app: both on screen
    shows: desk => (!!aadVars.secondEl && deskOfNode(aadVars.secondEl) === desk) || (panes.get().slots.includes('app') && !!aadVars.pane && Number(aadVars.pane.desk) === desk) || (aadVars.docked && !!aadVars.pane && !!aadVars.dockEl && deskOfNode(aadVars.dockEl) === desk),
  });
  api.on('route', r => { onRoute(r); api.after(260, syncOrb); });
  api.on('render', () => { readSessions(); paintTop(); });
  api.on('home', () => soon(() => { if (api.route().home) api.sessions.newChat(); }));
  // Settings opens as the centred panel over the page (Claude's settings modal), never as a window beside the chat
  const releaseSettings = host?.settings.overlay();
  { const r = api.route(); aadVars.chatsFresh = !!r.home || (r.desk === mainChats()?.desk && r.view === 'thread' && r.thread === '__new__'); }
  return { focusOn, here, markMedia, offAppKeys, offFrameKeys, onMainChats, onScreen, paintTop, releaseSettings, soon };
}
