/* Wizard UX AI apps view (desktop) › the Wizard switcher menus and the orb: click talks, hold commands. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { HOLD_MS } from '../orb/keys.js';
import { appLayers, gridSlot } from './parts.js';
import { CHATS } from '../apps/chrome.js';
export function voicePart({ aadVars, api, appName, chrome, closeFly, closeMenu, closeWs, cv, desks, doc, fb, homeComposer, host, lit, mainChatWindow, near, one, openWs, orbAt, orbBox, orbBtn, paintFuel, paintWs, pinApps, placeHome, placementOf, placements, plus, rail, refreshPins, root, rWs, scene, wsBtn }) {
  // With two or more saved Wizards the header name opens the shared switcher menu (core/workspaces.js: this Wizard, the registry and the
  // Wizards saved on this device, so a Wizard on a box without the devices registry still lists its way back); alone it keeps this list.
  api.listen(wsBtn, 'click', () => { const W = globalThis.WizWorkspaces; if (W?.visible && W.openMenu) { closeWs(); W.openMenu(wsBtn); return; } aadVars.wsPop ? closeWs() : openWs(); });
  // the rail's switcher: the shared menu (opaque, outside tap and Back close it), anchored under the icon
  const paintRws = () => { const W = globalThis.WizWorkspaces; rWs.hidden = !W?.visible; rWs.setAttribute('aria-label', 'Switch Wizard'); };
  api.listen(rWs, 'click', () => { closeWs(); globalThis.WizWorkspaces?.openMenu?.(rWs); });
  const offRws = globalThis.WizWorkspaces?.subscribe?.(paintRws); paintRws();
  api.listen(globalThis, 'wos:resources', () => { paintWs(); paintFuel(); });
  // a click anywhere else closes the menus (their own popovers, like ChatGPT's)
  api.listen(doc, 'pointerdown', e => {
    const t = e.target;
    if (aadVars.menu && !aadVars.menu.card.contains(t) && !t?.closest?.('.aad-more, .aad-sortb')) closeMenu();
    if (aadVars.wsPop && !aadVars.wsPop.contains(t) && !wsBtn.contains(t)) closeWs();
    if (aadVars.fly && !aadVars.fly.card.contains(t) && !rail.contains(t)) closeFly();
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
    if (p.drag && dy < 0 && -dy > Math.abs(dx)) plus();
  }
  function up(run) {
    const p = press; press = null; if (!p) return; p.cancel?.(); p.target.classList.remove('is-pressed'); if (p.target === orbBtn) eng?.press?.(false);
    if (!run || p.moved) return;
    if (p.held) p.started.then(r => { if (r === 'voice') api.voice.command(); });
    else talkFromOrb();
  }
  // The orb is visually docked in the Chats composer, but lives outside its window.
  // A companion pane can own keyboard focus: reply to the composer, not that pane.
  const idle = () => (api.voice.state()?.state || 'idle') === 'idle';
  // The Chats window whose thread's message box holds the orb, or null (New chat, Home, an app alone, the list).
  function orbThread() {
    const wid = orbComposer()?.closest('[data-chats]')?.dataset.chats;
    const w = wid && host?.windows().find(w => w.id === wid && w.kind === 'chats');
    return w?.thread && w.thread !== '__new__' ? w : null;
  }
  function talkFromOrb() {
    if (!idle()) return api.voice.talk();
    const w = orbThread();
    return w ? api.voice.reply(w.id, w.thread) : api.voice.talk();
  }
  // Wizard for Mac's orb and Right ⌘ (wizard:orb) start the same reply while an app beside the thread has keyboard focus
  // (wizard-ux issue 1547); with no thread holding the orb they keep the shell's own action (undefined).
  api.voice.onTap?.(() => { const w = idle() ? orbThread() : null; return w ? api.voice.reply(w.id, w.thread) : undefined; });
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
    if (!force && Date.now() < aadVars.glideUntil) return;   // (mid-glide the boxes are moving: the settle places it)
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
    const L = appLayers(desks(), aadVars.pins, { main: mainChats()?.desk ?? null, lit, manual: aadVars.manual, names: Object.fromEntries(aadVars.pins.map(id => [id, pinApps().find(a => a.id === id)?.name || appName(id) || id])), chats: CHATS });
    return { pinned: L.pinned, others: L.open };
  }
  return { behindThread, chatsEl, mainChats, offRws, placeOrb, ro, syncOrb, talkFromOrb, vtTabs, wsps };
}
