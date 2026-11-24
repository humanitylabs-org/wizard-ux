/* Wizard UX desktop shell › Pick anything (⌥G), live data and the orb dump. Moved out of desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names desktop.js declares only further down are late-bound: desktop.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the window list W and the workspaces) stay in desktop.js;
 * this code reads and writes them as desktopVars.<name>, desktop.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before desktop.js. The body below keeps desktop.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.pickany = function ({ $, C, chanPost, CHATS, chatsUpDown, closeCurrent, closePalette, closeSettings, closeUsage, closeVoiceMenu, commandVoice, desktopBack, desktopHost, desktopVars, dictate, dirFocus, escapeBack, fields, flipLight, focused, focusInside, focusWin, freshDesk, goHome, goWs, homeHtml, hudKey, hudPaint, IS_MAC, jumpBack, keyField, keyHints, leaveHome, listRows, listWin, LIVE, mainChats, MOD, moveDesk, moveWin, newChat, newDesktop, openChatsList, OUTBOX, paintBar, paintHome, pal, palToggle, panelHas, panelWins, reloadCurrent, reopenClosed, resizeFocused, restFocus, returnToSettings, settingsFocused, settingsView, speakScreen, stage, stepThread, stepWin, swapWin, syncChatsPane, talkNew, tapkeysLate, textField, toast, toggleKeys, toggleMono, toggleSettings, typing, usageEl, VOICE, voiceMenu, winEl, wsEl }) {
  let LINKS; // late-bound: desktop.js declares these after the call, see bindLate
  /* ⌥G Pick anything (Miguel, 27 Oct 2026: "never touch the trackpad"): every visible button, link, field, app tile
   * and chat row on screen, the bar and same-origin app windows included, gets a letter chip. Type the letters
   * (with or without ⌥ still held) to click or focus it; Backspace undoes a letter; Esc, a click or a scroll cancels. */
  const pick = (() => {
    const layer = document.createElement('div'); layer.id = 'pickHints'; layer.className = 'pick-hints'; layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer);
    const SEL = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="option"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[data-chopen],[data-chdraft],[tabindex]:not([tabindex="-1"])';
    const KEYS = 'asdfjklghqwertyuiopzxcvbnm';
    let items = [], typed = '', on = false;
    function shown(n, view) {
      if (n.disabled || n.closest('[hidden],[inert],#pickHints,#keyHints')) return null;
      const r = n.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
      const cs = n.ownerDocument.defaultView.getComputedStyle(n); if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.pointerEvents === 'none') return null;
      const x = r.left + view.x, y = r.top + view.y;
      if (x + r.width < view.l || y + r.height < view.t || x > view.r || y > view.b) return null;
      // Something else painted over its centre (a covered window or a closed sheet) is not pickable.
      const cx = Math.min(r.right - 1, Math.max(r.left + 1, r.left + r.width / 2)), cy = Math.min(r.bottom - 1, Math.max(r.top + 1, r.top + r.height / 2));
      const top = n.ownerDocument.elementFromPoint(cx, cy); if (top && top !== n && !n.contains(top) && !top.contains(n)) return null;
      return { x: Math.max(view.l, x), y: Math.max(view.t, y) };
    }
    function collect() {
      const out = [], seen = new Set();
      const scan = (doc, view) => {
        for (const n of doc.querySelectorAll(SEL)) {
          if (seen.has(n) || (n.parentElement?.closest(SEL) && !n.matches('[data-chopen],[data-chdraft]') && n.parentElement.closest(SEL).matches('a[href],button'))) continue;
          const at = shown(n, view); if (!at) continue; seen.add(n); out.push({ n, ...at });
        }
        for (const f of doc.querySelectorAll('iframe')) {
          let d = null; try { d = f.contentDocument; } catch (_) {} if (!d || !d.body) continue;
          const fr = f.getBoundingClientRect(); if (!fr.width || !fr.height || !shown(f, view)) continue;
          scan(d, { x: view.x + fr.left + f.clientLeft, y: view.y + fr.top + f.clientTop, l: Math.max(view.l, view.x + fr.left), t: Math.max(view.t, view.y + fr.top), r: Math.min(view.r, view.x + fr.right), b: Math.min(view.b, view.y + fr.bottom) });
        }
      };
      scan(document, { x: 0, y: 0, l: 0, t: 0, r: innerWidth, b: innerHeight });
      return out.sort((a, b) => (a.y - b.y) || (a.x - b.x)).slice(0, KEYS.length * KEYS.length);
    }
    function labels(n) {
      if (n <= KEYS.length) return [...KEYS].slice(0, n);
      const out = []; for (const a of KEYS) for (const b of KEYS) out.push(a + b); return out.slice(0, n);
    }
    function paint() {
      for (const it of items) {
        const hit = it.label.startsWith(typed); it.chip.hidden = !hit;
        if (hit) it.chip.innerHTML = `<u>${typed}</u>${it.label.slice(typed.length)}`.toUpperCase();
      }
    }
    function stop() { if (!on) return; on = false; typed = ''; items = []; layer.hidden = true; layer.innerHTML = ''; document.documentElement.classList.remove('pick-on'); }
    function start() {
      closePalette(); toggleKeys(false);
      const found = collect(); if (!found.length) { toast('◌', 'Nothing to pick here', 1200); return false; }
      const names = labels(found.length); layer.innerHTML = ''; layer.hidden = false; on = true; typed = '';
      items = found.map((it, i) => { const c = document.createElement('b'); c.className = 'pick-chip'; layer.appendChild(c);
        c.style.left = Math.min(innerWidth - 30, it.x) + 'px'; c.style.top = Math.min(innerHeight - 18, it.y) + 'px'; return { ...it, label: names[i], chip: c }; });
      paint(); document.documentElement.classList.add('pick-on'); log('pick:' + items.length); return true;
    }
    function act(n) {
      const doc = n.ownerDocument, win = (doc === document ? n : doc.defaultView.frameElement)?.closest?.('[data-win]');
      if (win && desktopVars.W[win.dataset.win]) focusWin(win.dataset.win, { scroll: false });
      const field = n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) && !/^(button|submit|checkbox|radio|reset|file)$/.test(n.type);
      try { n.focus({ preventScroll: true }); } catch (_) {}
      if (!field) n.click();
      log('pick:act:' + (n.getAttribute('aria-label') || n.textContent || n.tagName).trim().slice(0, 40));
    }
    function key(e) {
      e.preventDefault(); e.stopPropagation();
      if (/^(Alt|Shift|Meta|Control)/.test(e.code)) return;
      if (e.key === 'Escape') return stop();
      if (e.key === 'Backspace') { typed = typed.slice(0, -1); return paint(); }
      const m = /^Key([A-Z])$/.exec(e.code); if (!m) return stop();
      const next = typed + m[1].toLowerCase(), left = items.filter(it => it.label.startsWith(next));
      if (!left.length) return; typed = next;
      const exact = left.length === 1 && left[0].label === typed ? left[0] : null;
      if (exact) { stop(); act(exact.n); } else paint();
    }
    addEventListener('pointerdown', stop, true); addEventListener('resize', stop); addEventListener('wheel', stop, { capture: true, passive: true });
    return { start, stop, key, active: () => on };
  })();
  const NATIVE_MENU = !!window.webkit?.messageHandlers?.wizardNative;
  const vis0 = n => !!n && !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  // Legacy owners join the SAME recency stack as layout back.push overlays.
  // Observe opening, not keyboard priority, so a newer menu beats an older sheet.
  const watchEscape = (name, active, back) => escapeBack.watch(active, back, name);
  window.WizEscapeBack.installOwners(escapeBack, { chats: () => CHATS, links: () => LINKS, afterChat: () => { if (desktopVars.settingsReturn === 'files') returnToSettings(); } });
  watchEscape('pick', () => pick.active(), () => pick.key({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
  watchEscape('keys', () => keyHints.pinned(), () => { toggleKeys(false); returnToSettings(); });

  watchEscape('palette', () => !pal.hidden, () => closePalette());


  watchEscape('voice-menu', () => !voiceMenu.hidden, () => closeVoiceMenu());
  watchEscape('usage', () => !usageEl.hidden, () => closeUsage());
  watchEscape('settings', () => settingsFocused(), () => { if (settingsView.back()) return 'settings-page'; closeSettings(); return 'settings'; });
  window.WosBack = Object.freeze({ escape: e => onKey(e, true), names: escapeBack.names });
  function onKey(e, fromFrame = false) {
    // macOS word jumps belong to the field/app, even with an empty composer or a sheet open.
    // Yield before layout, picker and window-manager dispatch; shifted arrows keep their distinct controls.
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
    // ⌥⇧← / → select by word in a text field, an app's included: the field keeps them before any layout key.
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && textField(keyField(e))) return;
    // On a Mac ⌥- / ⌥⇧- type – and — (⌥= / ⌥⇧= type ≠ and ±): in an editable text field they are characters, not ⌥− / ⌥= resizes (issue 1278).
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'Minus' || e.code === 'Equal') && IS_MAC && (f => textField(f) && !f.readOnly)(keyField(e))) return;
    if (e.key === 'Escape') {
      if (e.isComposing || e.keyCode === 229) return;
      // Run BEFORE layout keys and before the app's own capture listeners. The
      // focused iframe is a surface, not permission to hide its window.
      e.preventDefault?.(); e.stopPropagation?.(); e.stopImmediatePropagation?.();
      if (e.repeat) return;
      const did = desktopBack(e);
      log('esc:' + (did || 'root')); return;
    }

    if (pick.active()) return pick.key(e);
    if (window.WosWelcome?.active) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); window.WosWelcome.back(); } return; } // first run: no shell shortcuts behind it
    if (e.key === 'Escape' && keyHints.pinned()) { e.preventDefault(); e.stopPropagation(); toggleKeys(false); returnToSettings(); return; }
    keyHints.down(e);
    // A layout's own keys (the Orbs view: hold-left-⌥ app letters, its panels) see every key first, app frames included.
    if (globalThis.WosSkinHost?.key?.(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const k = e.key, code = e.code, alt = e.altKey && !e.metaKey && !e.ctrlKey, shift = e.shiftKey;
    const digit = /^Digit([1-9])$/.exec(code);
    const hit = fn => { e.preventDefault(); e.stopPropagation(); fn(); };
    // One base key for everything: ⌥ (Option / Alt). macOS and browsers own ⌘ and Ctrl, Omarchy owns Super.
    // Inside the Wizard Mac app only, its own menu items (⌘N, ⌘T, ⌘W, ⌘,) forward here with their usual Mac meaning.
    const menu = NATIVE_MENU && e.metaKey && !e.ctrlKey && !e.altKey && !shift;
    if (code === 'Comma' && !shift && (alt || menu)) return hit(toggleSettings);
    // Home is ⌥` (the key left of 1, like the Home icon left of the desks); desktops are ⌥1…9 left to right.
    // ⌥` again from Home goes back to the desktop you were on.
    if (alt && !shift && code === 'KeyG') return hit(() => { if (!e.repeat) pick.start(); });
    if (alt && !shift && code === 'Backquote') return hit(() => { if (e.repeat) return; if (desktopVars.homeOpen) { leaveHome(); log('home:back'); } else { goHome(); log('home'); } });
    if ((menu || alt) && !shift && code === 'KeyW') return hit(() => { if (!e.repeat) closeCurrent(); });
    // ⌥⇧W reopen the last closed window · ⌥Z back to where you were · ⌥− / ⌥= window narrower / wider (on a Mac, not in a text field: there they type – — ≠ ±).
    if (alt && shift && code === 'KeyW') return hit(() => { if (!e.repeat) reopenClosed(); });
    if (alt && !shift && code === 'KeyZ') return hit(() => { if (!e.repeat) jumpBack(); });
    // ⌥L Dark ⇄ Light (Miguel: L for light; ⌥H J K L window moves retired, ⌥[ ] step windows): the same skin's light or dark twin (Dark ⇄ Light, Landscapes Dark ⇄ Landscapes Light).
    if (alt && !shift && code === 'KeyL') return hit(() => { if (!e.repeat) flipLight(); });
    if (alt && (code === 'Minus' || code === 'Equal')) return hit(() => resizeFocused(code === 'Equal' ? 1 : -1));
    if ((menu || alt) && !shift && code === 'KeyT') return hit(() => { if (!e.repeat) { closePalette(); toggleKeys(false); closeSettings(); closeUsage(); newDesktop(); } });
    if (alt && !shift && (code === 'ArrowUp' || code === 'ArrowDown')) return hit(() => { if (!e.repeat || focused()?.app === 'chats') { closePalette(); toggleKeys(false); chatsUpDown(code === 'ArrowDown' ? 1 : -1); } });
    // ⌥N new chat; ⌥V new voice chat (⌥V again sends).
    // ⌥N: a New chat on this desk. Reuses this desk's Chats window, else opens one beside the window in front (like Reply).
    if ((menu || alt) && !shift && code === 'KeyN') return hit(() => { if (e.repeat) return; closePalette(); toggleKeys(false); closeSettings(); closeUsage(); chanPost() || newChat(); });
    if (alt && !shift && code === 'Enter') return hit(() => { if (!e.repeat) chanPost() || newChat(); });
    if (alt && code === 'KeyV') return hit(() => { if (e.repeat) return; closePalette(); toggleKeys(false); closeSettings(); closeUsage(); talkNew(`${MOD}V`); });

    // ⌥X Resolve this: an open notification goes to the agent to stop these or fix the cause.
    if (alt && !shift && code === 'KeyX') return hit(() => { if (!e.repeat) chatAct('resolve', 'X'); });
    function chatAct(act, keyName) {
      const f0 = focused(), f = f0?.app === 'chats' ? f0 : (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(mainChats);
      const name = act === 'done' ? 'Archive' : act === 'resolve' ? 'Resolve this' : 'Snooze';
      if ((desktopVars.homeOpen && !(globalThis.WosSkinHost?.panelMode && panelHas(f?.id))) || !f?.thread || (f.thread === '__new__' && !CHATS.notifOpen?.(f.id))) return toast('✓', `Open a chat first, then ${MOD}${keyName} = ${name}`, 1800);
      if (!winEl(f.id)?.querySelector(`[data-chact="${act}"]`)) return toast('◷', act === 'resolve' ? 'Resolve this is for an open notification' : `${name} appears once the reply is in`, 1800);
      CHATS.threadAct(f.id, f.thread, act);
    }
    // ⌥S speak about this screen (replies to the open chat), ⌥C speak a local command, ⌥D dictate into the text box.
    // Same key again sends. Like ⌥V these work from anywhere, even while typing.
    if (alt && !shift && (code === 'KeyS' || code === 'KeyC' || code === 'KeyD')) return hit(() => {
      if (e.repeat) return;
      if (code === 'KeyD') { // in Chats, dictation always lands in the open chat's message box, even from the list
        const f = focused(), ta = !desktopVars.homeOpen && mainChats(f) && f.thread && winEl(f.id)?.querySelector('.pane-main textarea');
        if (ta && VOICE.state === 'idle' && document.activeElement !== ta) { ta.focus({ preventScroll: true }); fields().refresh?.(); }
        return dictate();
      }
      closePalette(); toggleKeys(false); closeSettings(); closeUsage();
      code === 'KeyS' ? speakScreen() : commandVoice();
    });
    // ⌥Space search everything, ⌥O open an app: from anywhere, even while typing.
    if (alt && !shift && code === 'Space') return hit(() => palToggle('all'));
    if (alt && !shift && code === 'KeyO') return hit(() => { if (!e.repeat) palToggle('apps'); });
    // ⌥P float the chat over every desk; again, put it back on desktop 1. Even while typing.
    if (alt && !shift && code === 'KeyP') return hit(() => { if (!e.repeat) { closePalette({ restore: false }); hudKey(); } });
    // Link pane: ⌘Enter keeps it as a window, ⌘⇧Enter opens it in the browser.
    if (LINKS && LINKS.isOpen() && (e.metaKey || e.ctrlKey) && k === 'Enter') return hit(() => LINKS.el.querySelector(shift ? '[data-ls="out"]' : '[data-ls="keep"]')?.click());

    if (!pal.hidden) {
      // ⌘K's palette owns the keyboard while open. The app selector lets the window manager's ⌥ chords
      // through (⌥Enter, ⌥1…9, ⌥[ ], ⌥W…), stepping aside first, so a fresh desktop never traps them.
      if (desktopVars.palMode !== 'apps' || !alt || !/^(Digit[1-9]|Key[GIWFLNTVPZ]|Slash|Comma|Minus|Equal|Bracket(Left|Right))$/.test(code)) return;
      closePalette({ restore: false });
      queueMicrotask(() => { const a = document.activeElement; if (!a || a === document.body || !a.getClientRects().length) restFocus(); });
    }
    if (settingsFocused() && !e.altKey) return; // the Settings window keeps its plain keys; ⌥ window keys work as in any window
    // Chats: ↑/↓ or j/k walk the thread list (from the list, the search box or an empty thread pane), / focuses search.
    {
      const f = focused(), plain = !e.altKey && !e.metaKey && !e.ctrlKey;
      const inList = !!e.target.closest?.('.pane-list'), inSearch = e.target.matches?.('[data-chsearch]');
      if (f?.app === 'chats' && !keyHints.pinned() && plain && !fromFrame) {
        const free = !typing(e.target) || inSearch;
        if (free && (inList || inSearch || !f.thread || e.target === winEl(f.id)) && (k === 'ArrowDown' || k === 'ArrowUp' || (!inSearch && (k === 'j' || k === 'k')))) { if (stepThread(f.id, k === 'ArrowDown' || k === 'j' ? 1 : -1)) return hit(() => {}); }
        if (k === '/' && !typing(e.target)) return hit(() => { const s = winEl(f.id)?.querySelector('[data-chsearch]'); if (s) { s.focus(); s.select(); } });
        if (k === 'Enter' && inSearch) { const r = listRows(f.id)[0]; if (r) return hit(() => { stepThread(f.id, 1); focusInside(f.id); }); }
      }
    }
    if (!e.altKey || e.metaKey || e.ctrlKey) {
      return;
    }
    // ⌥ (Option/Alt) keys. Use e.code: on a Mac, ⌥ turns e.key into symbols (⌥V = √).
    // The next visible slot adds a desktop; shifted slots move a window.
    // Home is never a window target and digits beyond the + slot stay inert.
    if (digit) return hit(() => {
      const target = C.workspaceNav.digitTarget(+digit[1], desktopVars.ws.length);
      if (!target || target.kind === 'home' || e.repeat) return;
      if (shift) { const f = focused(); if (!f || desktopVars.homeOpen) return; if (target.kind === 'new') desktopVars.ws.push(freshDesk()); moveWin(f.id, target.index); }
      else if (target.kind === 'new') newDesktop();
      else { desktopVars.lastWs = desktopVars.cur; goWs(target.index); }
    });
    // ⌥I: the chat list; again (list already in front): search chats and messages.
    if (code === 'KeyI') return hit(() => {
      const f = focused(), s = !desktopVars.homeOpen && f?.app === 'chats' && !f.thread && winEl(f.id)?.querySelector('[data-chsearch]');
      if (s && vis0(s) && document.activeElement !== s && !e.repeat) { s.focus(); s.select(); log('key:search-chats'); return; }
      openChatsList();
    });
    if (code === 'KeyW') return hit(() => { if (!e.repeat) closeCurrent(); });
    if (code === 'KeyF') return hit(() => { if (!e.repeat) toggleMono(); });
    if (code === 'KeyR' && !shift) return hit(() => { if (!e.repeat) reloadCurrent(); });
    if (code === 'Slash') return hit(() => toggleKeys());
    if (code === 'Comma') return hit(toggleSettings);
    // ⌥] / ⌥[ next / previous window on this desk (Chats: list, then message box), then on to the next / previous desk.
    if (code === 'BracketLeft') return hit(() => { if (shift) return moveDesk(desktopVars.cur, desktopVars.cur - 1); stepWin(-1); });
    if (code === 'BracketRight') return hit(() => { if (shift) return moveDesk(desktopVars.cur, desktopVars.cur + 1); stepWin(1); });
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[code];
    // ⌥ arrows are word/paragraph jumps while typing on a Mac: leave them to the text field (⌥[ ] still step windows).
    if (dir && /^Arrow/.test(code) && typing(e.target)) return;
    if (dir) return hit(() => { if (shift && dir[0]) swapWin(dir[0]); else dirFocus(dir[0], dir[1]); });
  }
  /* Window keys and the keys a sandboxed app passes on: moved verbatim to desktop/desktop-boundarykeys.js (issue 1665). */
  const { log } = window.WizCore.desktopParts.boundarykeys({ desktopBack, desktopHost, keyHints, onKey, toast });
  tapkeysLate({ log });

  /* ---------------- live data ---------------- */
  if (LIVE) LIVE.onChange(() => {
    paintBar(); CHATS.markVisibleThreadsSeen();
    for (const id of Object.keys(desktopVars.W)) {
      const w = desktopVars.W[id]; if (w.app !== 'chats' && !CHATS.isHosted(id)) continue;
      const el = winEl(id); if (!el) continue;
      const lp = el.querySelector(`[data-chats="${id}::list"]`);
      if (lp && !lp.contains(document.activeElement) && !CHATS.holdList(id + '::list')) CHATS.renderChatList(listWin(id), lp);
      const sp = typeof desktopVars.sideHost !== 'undefined' && desktopVars.sideHost?.isConnected && desktopVars.sideHost.dataset.chats === id + '::side' ? desktopVars.sideHost : null;
      if (sp && !sp.contains(document.activeElement) && !CHATS.holdList(id + '::side')) CHATS.renderChatList(listWin(id, 'side'), sp);
      if (w.thread) CHATS.loadThread(w);
      syncChatsPane(id);
    }
    // the sidebar's Channels pane on its stand-in (no main Chats window yet): repainted like the one on a real window
    const sb = typeof desktopVars.sideBase !== 'undefined' && desktopVars.sideBase && typeof desktopVars.sideHost !== 'undefined' && desktopVars.sideHost?.isConnected && desktopVars.sideHost.dataset.chats === desktopVars.sideBase.id + '::side' ? desktopVars.sideHost : null;
    if (sb && !sb.contains(document.activeElement) && !CHATS.holdList(desktopVars.sideBase.id + '::side')) CHATS.renderChatList(listWin(desktopVars.sideBase.id, 'side'), sb);
    // the channel feed in the main column (its own stand-in window): the same
    const fb = typeof desktopVars.feedBase !== 'undefined' && desktopVars.feedBase && typeof desktopVars.feedHost !== 'undefined' && desktopVars.feedHost?.isConnected && desktopVars.feedHost.dataset.chats === desktopVars.feedBase.id + '::side' ? desktopVars.feedHost : null;
    if (fb && !fb.contains(document.activeElement) && !CHATS.holdList(desktopVars.feedBase.id + '::side')) CHATS.renderChatList(listWin(desktopVars.feedBase.id, 'side'), fb);
    const d = desktopVars.ws[desktopVars.cur]; if (!d.wins.length) { const h = wsEl(desktopVars.cur).querySelector('.home'); if (h) paintHome(h, homeHtml(desktopVars.cur)); }
    if (desktopVars.homeOpen) paintHome($('#desktopHome'), homeHtml(null));
    hudPaint();
  });
  OUTBOX?.onChange(() => { if (desktopVars.homeOpen) paintHome($('#desktopHome'), homeHtml(null)); else if (!desktopVars.ws[desktopVars.cur].wins.length) { const h = wsEl(desktopVars.cur).querySelector('.home'); if (h) paintHome(h, homeHtml(desktopVars.cur)); } for (const id of [...desktopVars.ws[desktopVars.cur].wins, ...(desktopVars.hud?.open ? [desktopVars.hud.id] : [])]) { const w = desktopVars.W[id]; if ((w?.app === 'chats' || CHATS.isHosted(id)) && w.thread) { const el = stage.querySelector(`[data-chats="${id}"]`); if (el) CHATS.renderThread(w, el); } } });
  /* Orb dump (switch wizard/agent-inbox, off by default; wizard-ux issue 1588): an orb take to the main agent with no
   * thread, window or reply in front is offered to the router as a possible background task (the outbox asks with
   * accept_dump); on this shell that is the orb's idle take (talkNew, a new voice chat). If the box takes it: "Got it"
   * with its title, nothing opens, nothing new in Chats. */
  function dumpTake(aimSid, rp) {
    try { if (!(document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/agent-inbox')) return false; } catch (_) { return false; }
    return !aimSid && !rp && !desktopVars.vFeedback && !desktopVars.strictReply && !desktopVars.commandTake && !(desktopVars.vRoute?.agent && window.WosAgents?.isOther?.(desktopVars.vRoute.agent));
  }
  OUTBOX?.onDump?.(it => {
    const title = it.dumped?.title || '';
    toast('✦', 'Got it' + (title ? ' · ' + title : ''), 2600);
    $('#toast').classList.add('got-it');
  });
  OUTBOX?.onSent((it, res) => {
    if (it.kind === 'new' && LIVE && !LIVE.session(it.sessionId)) {
      LIVE.sessions.unshift({ id: it.sessionId, runtime: 'direct', title: (it.text || 'Voice note').slice(0, 60), status: 'running', runId: res.runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: it.text, source: 'wizard-mobile' });
      LIVE.markSeen(it.sessionId);
    } else if (LIVE?.session(it.sessionId)?.synthetic) LIVE.markSeen(it.sessionId);
    // A reply's thread is already held in Working with its live status by live.js (PEND), until Wizard lists the run.
    if (res.steered) toast('✦', 'Sent · steering the live run', 1600);
    LIVE?.emit(); setTimeout(() => LIVE?.refresh(), 3000);
    for (const id of Object.keys(desktopVars.W)) if ((desktopVars.W[id].app === 'chats' || CHATS.isHosted(id)) && desktopVars.W[id].thread === it.sessionId) setTimeout(() => desktopVars.W[id] && CHATS.loadThread(desktopVars.W[id], true), 1500);
  });
  // Open threads poll a little faster while Archimedes works.
  setInterval(() => { if (document.hidden) return; for (const id of [...desktopVars.ws[desktopVars.cur].wins, ...(desktopVars.hud?.open ? [desktopVars.hud.id] : [])]) { const w = desktopVars.W[id]; if ((w?.app === 'chats' || CHATS.isHosted(id)) && w.thread && w.thread !== '__new__') CHATS.loadThread(w); } }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LIVE?.refresh(); CHATS.markVisibleThreadsSeen(); } });
  return { dumpTake, log, onKey, bindLate: v => { if ('LINKS' in v) LINKS = v.LINKS; } };
};
