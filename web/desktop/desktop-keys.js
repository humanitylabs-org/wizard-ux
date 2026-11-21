/* Wizard UX desktop shell › Back, Esc, moving between windows and the keys guide. Moved out of desktop.js
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
window.WizCore.desktopParts.keys = function ({ $, $$, C, CHATS, closedWins, closeWin, closeWorkflow, cogLate, desktopVars, dictate, esc, escapeBack, focused, focusWin, hudBack, IS_MAC, listWin, mainChats, MOD, nativeDesktop, nextStop, panelEsc, panelWin, readyRows, replayTour, resizable, spotLive, syncChatsPane, talk, toggleMono, VOICE, winEl, wsOf }) {
  function dirFocus(dx, dy) {
    const d = desktopVars.ws[desktopVars.cur]; if (d.wins.length < 2) return;
    const me = winEl(d.focus)?.getBoundingClientRect(); if (!me) return;
    const cx = me.left + me.width / 2, cy = me.top + me.height / 2;
    let best = null, bs = Infinity;
    for (const id of d.wins) {
      if (id === d.focus) continue; const r = winEl(id)?.getBoundingClientRect(); if (!r || winEl(id).classList.contains('gone')) continue;
      const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      if ((dx && Math.sign(x) !== dx) || (dy && Math.sign(y) !== dy)) continue;
      const s = Math.abs(dx ? x : y) + Math.abs(dx ? y : x) * 2; if (s < bs) { bs = s; best = id; }
    }
    if (!best && d.mono) { const i = d.wins.indexOf(d.focus); best = d.wins[(i + (dx || dy) + d.wins.length) % d.wins.length]; }
    if (best) focusWin(best);
  }
  function desktopBack(event) {
    window.WosSettings?.cancelWait?.();
    return escapeBack.run({ event,
      recording: () => { if (VOICE.state === 'idle') return false; desktopVars.vMode === 'dictate' ? dictate('cancel') : talk('cancel'); return true; },
      surface: () => window.WosSkinHost?.escapeSurface?.(), fallback: () => escStep(),
    });
  }
  // Navigation only. ALL transient owners live in the shared phone Back registry.
  function escStep() {
    // The floating chat, when the keyboard is in it, walks back from its open thread before anything behind it.
    { const hb = hudBack(); if (hb) return hb; }
    // No desks: Esc (and Back) slides the panel away, back to Home.
    if (globalThis.WosSkinHost?.panelMode && panelWin()) return panelEsc();
    // Leave fullscreen before navigating the app underneath; preserve its thread and draft.
    if (desktopVars.homeOpen) return '';
    // The split list owns its own search state (id::list). Back there peels search/chips
    // without navigating the selected thread; overlays above it have already had first refusal.
    { const f = focused(), inList = f && winEl(f.id)?.querySelector('.pane-list')?.contains(document.activeElement);
      if (f?.app === 'chats' && (inList || !f.thread)) {
        const did = CHATS.clearFilter(listWin(f.id));
        if (did) { syncChatsPane(f.id); if (inList) winEl(f.id)?.querySelector('[data-chsearch]')?.focus({ preventScroll: true }); return did === 'search' ? 'search' : 'filter'; }
      }
    }
    if (focused() && CHATS.isHosted(focused().id)) return CHATS.threadBack(focused());
    if (focused()?.app === 'pages') { const w = focused(); if (window.WosPages.back(winEl(w.id)?.querySelector('.pg-host'))) return 'pages'; closeWin(w.id); return 'pages-close'; }

    // Back navigates while recording; only the explicit Cancel control may discard audio.
    const f = focused();
    if (f?.app === 'feature') { closeWin(f.id);return 'view'; }
    if (f?.app === 'chats' && f.thread) { const r = CHATS.threadBack(f); syncChatsPane(f.id); winEl(f.id)?.focus({ preventScroll: true }); return r; }
    if (f && f.app !== 'chats') { if (desktopVars.ws[desktopVars.cur].mono) { toggleMono(); return 'mono'; } }
    if (f?.app === 'frame') {
      // A sandboxed app (browser boundary) answers later; at its root its workflow/preview closes then.
      const result = window.WizAppServices?.back(winEl(f.id)?.querySelector('iframe'), () => { if (!(f.workflow && closeWorkflow(f)) && f.preview) closeWin(f.id); });
      if (['handled', 'pending', 'stay'].includes(result)) return 'hosted';
      // Shell-owned previews and sign-in workflows return to their opener;
      // ordinary installed apps at root stay mounted.
      if (f.workflow && closeWorkflow(f)) return 'workflow';
      if (f.preview) { closeWin(f.id); return 'preview'; }
      return '';
    }

    if (f && window.WizCompanionPane?.back(f.id)) return 'companion-back';
    if (f?.appId === 'app-store') {
      if (!desktopVars.ws[desktopVars.cur].mono) { closeWin(f.id); return 'store-parent'; }
    }
    return '';
  }
  /* ---------------- hold left ⌥ / Alt: the keys guide ----------------
   * The one keys guide. Holding left ⌥ alone for a moment labels every bar control with its key and lays the
   * keys out where they act: speaking under the speak buttons, switching under the desktops, window keys on the
   * focused window. Each key has a name and a one-line meaning. Letting go hides it; ⌥/ or the bar's ⌥/ button
   * pins it open until Esc or a click. */
  const keyHints = (() => {
    const el = document.createElement('div'); el.id = 'keyHints'; el.className = 'key-hints'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Keys guide');
    document.body.appendChild(el);
    let timer = 0, armed = false, pinned = false;
    const ALT = IS_MAC ? '⌥' : 'Alt';
    const SPEAK = [
      ['S', 'Talk about this', 'Ask about this window, or reply to the open chat'],
      ['V', 'New voice chat', 'A fresh start; nothing on screen is shared'],
      ['C', 'Tell the computer', 'Say “calendar”, “next desk”, “full screen”, “go home”. Stays on this box'],
      ['D', 'Type with your voice', 'Your words go into the box you’re typing in'],
    ];
    const TYPE = [['N', 'New chat', 'Type a new message'], ['␣', 'Search', 'Apps, chats and commands'], ['I', 'Inbox', 'All your chats']];
    const READY = [['↓', 'Next ready chat', 'From anywhere. Opens it ready to reply'], ['X', 'Resolve this', 'An open notification: stop these or fix the cause']];
    const GO = [['G', 'Pick anything', 'Letters appear on every button, app and chat; type them to click'], ['`', 'Home', 'Again to go back'], ['1–9', 'Desktop 1 to 9', 'Jump straight to it'], ['T', 'New desktop', ''], ['⇧ [ ]', 'Move desktop left / right', ''], ['O', 'Open an app', '']];
    const WIN = [['P', 'Float chat', 'Over every desk; again puts it back on desktop 1'], ['F', 'Full screen', ''], ['W', 'Close', ''], ['⇧W', 'Reopen closed window', 'The last window you closed, where it was'], ['−', 'Narrower', 'The window in front'], ['=', 'Wider', 'The window in front'], ['Z', 'Back to where you were', 'Again flips back'], ['L', 'Dark / Light', 'Same skin, light or dark'], ['R', 'Refresh window', ''], [']', 'Next window', 'Past the last one: the next desktop'], ['[', 'Previous window', 'Past the first one: the previous desktop'], ['⇧ ← →', 'Swap places', ''], ['⇧ 1–9', 'Send to a desktop', '']];
    // (a node inside an app frame reads its own window's styles)
    const vis = n => n && !n.hidden && n.getClientRects().length && (n.ownerDocument?.defaultView || window).getComputedStyle(n).visibility !== 'hidden';
    // Every key is a small chip on the thing it acts on (Miguel, 27 Oct 2026: no boxes to read). Only the four
    // Speak keys carry a word, since their buttons don't say what they do. The lists above name each chip for
    // screen readers.
    const NAMES = Object.fromEntries([...SPEAK, ...TYPE, ...READY, ...GO, ...WIN].map(([k, n]) => [k, n]));
    // opt.frame: n sits inside that same-origin app frame (its box is moved by the frame's offset and hit-tested in the
    // frame's own page); opt.app: an app's own ⌥ key (data-wz-key, named by the app); opt.free: a spot the layout knows is
    // empty (no hit test).
    function chip(n, label, at = 'below', word = '', opt = null) {
      const f = opt?.frame || null, fr = f ? f.getBoundingClientRect() : null, r0 = n.getBoundingClientRect();
      const ox = fr ? fr.left + (f.clientLeft || 0) : 0, oy = fr ? fr.top + (f.clientTop || 0) : 0;
      const r = fr ? { left: r0.left + ox, right: r0.right + ox, top: r0.top + oy, bottom: r0.bottom + oy, width: r0.width, height: r0.height } : r0;
      // Only on things you can see right now: not scrolled away, not under another window.
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return null;
      if (fr && (r.bottom <= fr.top || r.top >= fr.bottom || r.right <= fr.left || r.left >= fr.right)) return null; // scrolled out of its app
      const hx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), hy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      if (!opt?.free) {
        const top = f || n, hitEl = document.elementFromPoint(hx, hy);
        if (!hitEl || (hitEl !== top && !top.contains(hitEl) && !hitEl.contains(top) && !el.contains(hitEl))) return null;
        if (f) { const inner = n.ownerDocument.elementFromPoint(hx - ox, hy - oy); if (!inner || (inner !== n && !n.contains(inner) && !inner.contains(n))) return null; }
      }
      const c = document.createElement('b');
      c.className = 'kh-chip' + (word ? ' kh-lab' : '') + (opt?.app ? ' kh-app' : ''); c.innerHTML = word ? `<kbd>${esc(label)}</kbd>${esc(word)}` : esc(label);
      c.setAttribute('aria-label', opt?.app ? `${ALT} ${label}: ${opt.name || label}` : `${ALT} ${label}: ${NAMES[label] || word || label}`); el.appendChild(c);
      const w = c.offsetWidth, h = c.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.bottom + 24 > innerHeight ? r.top - h - 3 : r.bottom + 3; // near the bottom: above it
      if (at === 'inside') { x = r.right - w - 8; y = r.top + r.height / 2 - h / 2; }
      if (at === 'start') { x = r.left - w - 4; y = r.top + r.height / 2 - h / 2; if (x < 4) x = r.left + 4; }
      if (at === 'inside-l') { x = r.left + 8; y = r.top + r.height / 2 - h / 2; }
      if (at === 'inside-2') { x = r.right - w - 8 - 76; y = r.top + r.height / 2 - h / 2; }
      if (at === 'above') y = r.top - h - 3 < 4 ? r.bottom + 3 : r.top - h - 3;
      if (at === 'corner') { x = r.left - 4; y = r.top - 4; }
      if (at === 'tl') { x = r.left - Math.round(w * .45); y = r.top - Math.round(h * .45); } // a keycap on the target's top-left corner
      if (at === 'tr') { x = r.right - Math.round(w * .55); y = r.top - Math.round(h * .45); }   // … its top-right corner
      if (at === 'bl') { x = r.left - Math.round(w * .45); y = r.bottom - Math.round(h * .55); } // … its bottom-left corner
      if (at === 'right') { x = r.right + 3; y = r.top + r.height / 2 - h / 2; }                // just right of it (a small chevron)
      if (at === 'right-up') { x = r.right + 3; y = r.top + r.height / 2 - h - 3; }            // … two keys on it: the upper one
      if (at === 'right-dn') { x = r.right + 3; y = r.top + r.height / 2 + 3; }                // … and the lower one (clear of the stepping margin)
      if (at === 'mid') { x = r.left + r.width / 2 - w / 2; y = r.top + r.height / 2 - h / 2; }  // on its middle (a thin grip)
      if (at === 'bottom-in') { x = r.left + r.width / 2 - w / 2; y = r.bottom - h - 6; }
      if (at && typeof at === 'object') { x = at.x - w; y = at.y; at.x = x - 6; } // Speak words: one row, right to left, ending under the last speak button
      x = Math.round(Math.max(4, Math.min(innerWidth - w - 4, x))); y = Math.round(Math.max(4, y));
      // Never on top of another chip: step down until clear.
      const taken = [...el.querySelectorAll('.kh-chip')].filter(o => o !== c).map(o => o.getBoundingClientRect());
      for (let k = 0; k < 8 && taken.some(o => x < o.right + 2 && x + w > o.left - 2 && y < o.bottom + 2 && y + h > o.top - 2); k++) y += h + 3;
      c.style.left = x + 'px'; c.style.top = y + 'px';
      return c;
    }
    function show(pin = pinned) {
      pinned = !!pin;
      el.innerHTML = ''; el.hidden = false; el.classList.toggle('pinned', pinned); // visible first, so chips can be measured
      // A layout that marks its own keys (the AI apps view): only its chips, each on the thing it acts on; nothing else.
      if (window.WosSkinHost?.keysOnly) {
        for (const h of window.WosSkinHost.keyChips()) if (vis(h.el)) chip(h.el, h.key, h.at || 'tl', h.word || '', h);
        document.documentElement.classList.add('key-hints-on'); return;
      }
      // Top bar: Home, desktops, new desktop, and the Speak buttons with their one-word meaning.
      // [ ] sit on where they go: the next window or Chats side on this desk (left to right), else the desk one
      // step left / right (Home left of desktop 1; nothing past either end).
      const winL = nextStop(-1), winR = nextStop(1);
      const stepL = winL ? null : desktopVars.homeOpen ? null : desktopVars.cur === 0 ? $('#logo') : $(`#wsList .ws[data-ws="${desktopVars.cur - 1}"]`);
      const stepR = winR ? null : desktopVars.homeOpen ? $('#wsList .ws[data-ws="0"]') : $(`#wsList .ws[data-ws="${desktopVars.cur + 1}"]`);
      const marks = [['#searchBtn', '␣'], ['#status', 'I'], ['#settingsBtn', ','], ['#keysBtn', '/'], ['#logo', '`']];
      for (const [q, l] of marks) { const n = $(q); if (vis(n)) chip(n, l); }
      $$('#wsList .ws[data-ws]').forEach(n => { const slot = C.workspaceNav.slot(+n.dataset.ws); if (slot <= 9 && vis(n)) chip(n, String(slot)); });
      const add = $('#wsList [data-newdesk]'); if (vis(add)) chip(add, 'T');
      // Their own chip on a second row under the neighbour's key, so it reads as "either 2 or ]", not one combo.
      if (vis(stepL)) chip(stepL, '['); if (vis(stepR)) chip(stepR, ']');
      // Home: ↓ on the Ready count (Miguel's skins) or the first unread row (stock Home): ⌥↓ opens it from here.
      if (desktopVars.homeOpen) { const r = $('#desktopHome [data-home-act="ready"]') || $('#desktopHome .home-card .home-row'); if (vis(r)) chip(r, '↓', 'inside'); }
      // [ ] on the desktops either side of this one (they wrap), under their numbers.
      // While recording: the same key again sends, Esc cancels, right on the pill.
      if (VOICE.state !== 'idle') { const send = $('#voiceSend'), cancel = $('#voiceCancel'); if (vis(send)) chip(send, ($('#voiceKey')?.textContent || '').replace(MOD, '') || 'S'); if (vis(cancel)) chip(cancel, 'Esc'); }
      const f = !desktopVars.homeOpen && focused(), d = desktopVars.ws[desktopVars.cur];
      // Chats: ↓ sits on the Ready chat it opens next; X on Resolve; ↵ on Send; / on search; N on New chat.
      const cw = !desktopVars.homeOpen && (f?.app === 'chats' ? f : d.wins.map(x => desktopVars.W[x]).find(mainChats));
      if (cw) {
        const wel = winEl(cw.id), rows = readyRows(cw.id), i = cw === f ? rows.findIndex(r => (r.dataset.chopen || 'n:' + r.dataset.chnotif) === (cw.thread === '__new__' && CHATS.notifOpen?.(cw.id) ? 'n:' + CHATS.notifOpen(cw.id) : cw.thread)) : -1;
        const next = rows.length && (i < 0 ? rows[0] : rows[(i + 1) % rows.length]);
        const prev = i > 0 && rows.length > 2 ? rows[i - 1] : null; // ⌥↑ goes back one Ready chat
        if (prev && vis(prev)) { const lr = wel.querySelector('.pane-list')?.getBoundingClientRect(), pr = prev.getBoundingClientRect(); if (!lr || (pr.top >= lr.top && pr.bottom <= lr.bottom - 4)) chip(prev, '↑', 'inside'); }
        if (next && (i < 0 || next !== rows[i]) && vis(next)) {
          // Scrolled out of the list: the chip goes on the Ready heading instead, so it never hangs off the edge.
          const lr = wel.querySelector('.pane-list')?.getBoundingClientRect(), nr = next.getBoundingClientRect();
          const head = wel.querySelector('.pane-list [data-sectoggle="ready"]');
          const pl = wel.querySelector('.pane-list');
          if (!lr || (nr.top >= lr.top && nr.bottom <= lr.bottom - 4)) chip(next, '↓', 'inside'); else if (!(vis(head) && chip(head, '↓', 'inside')) && pl) chip(pl, '↓', 'bottom-in');
        }
        if (cw === f) {
          // Resolve's key follows its button; Archive and Snooze have no standard-desktop key.
          if (f.thread && (f.thread !== '__new__' || CHATS.notifOpen?.(f.id))) for (const [q, l, word] of [['[data-chact="resolve"]', 'X', 'Resolve']]) {
            const on = [...wel.querySelectorAll(q)].filter(vis).map(n => chip(n, l, 'above')).some(Boolean);
            const head = wel.querySelector('.pane-main .ch-head');
            if (!on && wel.querySelector(q) && vis(head)) chip(head, l, l === '→' ? 'inside' : 'inside-2', word);
          }
          const send = wel.querySelector('.pane-main .ch-send'); if (f.thread && vis(send)) chip(send, '↵', 'start');
          // ⌥I opens the chat list; pressed again it searches chats and messages.
          const srch = wel.querySelector('[data-chsearch]'); if (vis(srch) && document.activeElement !== srch) chip(srch, 'I', 'inside');
        }
        // N on this desk's New chat button: ⌥N starts the new chat there, even from the app beside it.
        const fab = wel.querySelector('.pane-list [data-chfab]'); if (vis(fab)) chip(fab, 'N', 'corner');
      }
      // No Chats on this desk: N with its word on the right edge of the window in front, where the chat opens.
      // (not when the view puts N on its own New chat button: the AI apps view's sidebar)
      else if (f && f.app !== 'chats' && !(window.WosSkinHost?.keyChips?.() || []).some(c => c.key === 'N')) { const b = winEl(f.id)?.querySelector('.wbody'); if (vis(b)) chip(b, 'N', 'inside', 'New chat'); }
      // Heads-up chat: P on the float button, or (floating) on Back to desktop 1.
      if (desktopVars.hud && desktopVars.W[desktopVars.hud.id]) { const n = winEl(desktopVars.hud.id)?.querySelector('.wbar [data-wact="hud-home"]'); if (vis(n)) chip(n, 'P'); }
      else {
        const fw = f?.app === 'chats' ? f : !desktopVars.homeOpen && d.wins.map(x => desktopVars.W[x]).find(mainChats);
        const n = fw && winEl(fw.id)?.querySelector('.wbar [data-wact="hud"]'); if (vis(n)) chip(n, 'P');
      }
      // The window in front: F W R on its own buttons ([ ] mark the windows they step to).
      if (f) {
        const wel = winEl(f.id);
        for (const [q, l] of [['[data-wact="mono"]', 'F'], ['[data-wact="close"]', 'W'], ['[data-wact="reload"]', 'R']]) { const n = wel?.querySelector(`.wbar ${q}`); if (vis(n)) chip(n, l); }
        // ⇧W under W once something was closed; = − on the edge the window shares with its neighbour.
        if (closedWins.some(c => !desktopVars.W[c.w.id])) { const n = wel?.querySelector('.wbar [data-wact="close"]'); if (vis(n)) chip(n, '⇧W', 'below', 'Reopen'); }
        if (desktopVars.hud?.id !== f.id && resizable(d)) { const b = wel?.querySelector('.wbody'), side = d.wins[0] === f.id ? 'inside' : 'inside-l'; if (vis(b)) { chip(b, '=', side, 'Wider'); chip(b, '−', side, 'Narrower'); } }
      }
      // No window in front (Home, empty desk): ⇧W Reopen sits on the new-desktop +.
      if (!f && closedWins.some(c => !desktopVars.W[c.w.id])) { const n = $('#wsList [data-newdesk]'); if (vis(n)) chip(n, '⇧W', 'below', 'Reopen'); }
      // L flips Dark / Light (lights on / off): on the Settings gear, saying where it goes.
      { const tw = window.WosSkin?.twin?.(), n = $('#settingsBtn'); if (tw && vis(n)) chip(n, 'L', 'below', tw.light ? 'Light' : 'Dark'); }
      // Z on where it goes back to: that window's title, that desk's number, or Home.
      if (spotLive(desktopVars.spotPrev) && desktopVars.spotPrev !== (desktopVars.homeOpen ? 'home' : f?.id)) {
        const s = desktopVars.spotPrev, i = s === 'home' ? -1 : s.startsWith('d:') ? desktopVars.ws.findIndex(x => x.id === s.slice(2)) : wsOf(s);
        const n = s === 'home' ? $('#logo') : i === desktopVars.cur && !desktopVars.homeOpen && !s.startsWith('d:') ? winEl(s)?.querySelector('.wbar .t') : $(`#wsList .ws[data-ws="${i}"]`);
        if (vis(n)) chip(n, 'Z', 'below', 'Back');
      }
      // ] and [ inside this desk: on the title of the window they go to, or on the Chats side (list / message box).
      for (const [st, l] of [[winR, ']'], [winL, '[']]) {
        if (!st) continue; const o = winEl(st[0]);
        const t = st[1] === 'thread' ? o?.querySelector('.pane-main textarea') : st[1] === 'list' ? o?.querySelector('.pane-list') : (o?.querySelector('.wbar .t') || o?.querySelector('.wbar'));
        if (vis(t)) chip(t, l, st[1] ? 'corner' : 'start');
      }
      // A layout's own keys, on the things they act on (the Orbs view: its list fold, chat and app panels).
      for (const h of window.WosSkinHost?.keyChips?.() || []) if (vis(h.el)) chip(h.el, h.key, h.at || 'below', h.word || '');
      // Speak keys last: their words step around anything already placed.
      const speak = [['#micBtn', 'S', 'Talk about this'], ['#generalVoice', 'V', 'New voice chat'], ['#commandBtn', 'C', 'Tell the computer'], ['#dictateBtn', 'D', 'Dictate']]
        .map(([q, l, w]) => [$(q), l, w]).filter(([n]) => vis(n)).sort((x, y) => x[0].getBoundingClientRect().left - y[0].getBoundingClientRect().left);
      // Speak keys: the letter under each button like every bar key, and their meaning as one line inside the bar,
      // just left of them, so nothing covers a window. Too narrow for that: the words drop under the buttons.
      if (speak.length) {
        speak.forEach(([n, l]) => chip(n, l));
        const sb = $('#searchBtn'), bar = $('#bar')?.getBoundingClientRect(), wl = $('#wsList')?.getBoundingClientRect();
        const end = (vis(sb) ? sb : speak[0][0]).getBoundingClientRect().left - 10, min = (wl?.right || 0) + 12;
        const leg = document.createElement('div'); leg.className = 'kh-legend';
        leg.innerHTML = [['G', 'Pick anything'], ...speak.map(([, l, w]) => [l, w])].map(([l, w]) => `<span><kbd>${esc(l)}</kbd>${esc(w)}</span>`).join(''); el.appendChild(leg);
        const lw = leg.offsetWidth, lh = leg.offsetHeight;
        if (bar && end - lw >= min) { leg.style.left = Math.round(end - lw) + 'px'; leg.style.top = Math.round(bar.top + (bar.height - lh) / 2) + 'px'; leg.classList.add('in-bar'); }
        else { const last = speak[speak.length - 1][0].getBoundingClientRect(); leg.style.left = Math.round(Math.max(4, last.right - lw)) + 'px'; leg.style.top = Math.round(last.bottom + 24) + 'px'; }
      }
      // One quiet line for the keys that have no single place: pick anything, keep this open.
      if (!pinned && el.querySelector('.kh-legend.in-bar')) { document.documentElement.classList.add('key-hints-on'); return; } // the bar line already says G
      const foot = document.createElement('div'); foot.className = 'kh-foot' + (pinned ? ' pinned' : '');
      foot.innerHTML = (pinned ? `<span><kbd>Esc</kbd> close</span>` : `<span><kbd>G</kbd> letters on everything</span><span><kbd>/</kbd> keep open</span>`)
        + (pinned && nativeDesktop ? `<span>Any Mac app: <kbd>Caps Lock</kbd> search · <kbd>Right ⌘</kbd> talk · <kbd>Right ⌥</kbd> dictate</span>` : '')
        + (pinned && window.WosTour?.desk ? `<button type="button" data-keystour>Show me the tour again</button>` : '');
      el.appendChild(foot);
      document.documentElement.classList.add('key-hints-on');
    }
    function hide() { clearTimeout(timer); armed = false; pinned = false; if (el.hidden) return; el.hidden = true; el.innerHTML = ''; el.classList.remove('pinned'); document.documentElement.classList.remove('key-hints-on'); }
    el.addEventListener('click', e => { if (e.target.closest('[data-keystour]')) replayTour(); else if (pinned) hide(); });
    return {
      hide, show, pinned: () => pinned, mine: t => !!t?.closest?.('#keyHints, #keysBtn'),
      down(e) {
        if (e.code === 'AltLeft' || e.code === 'AltRight' || e.key === 'Alt') {
          if (pinned || e.repeat || e.code !== 'AltLeft' || e.metaKey || e.ctrlKey || e.shiftKey || window.WosSkinHost?.holdKeys) return;
          hide(); armed = true; timer = setTimeout(() => { if (armed) show(false); }, 300); return;
        }
        if (pinned && e.altKey && e.code === 'Slash') return; // ⌥/ closes it via toggleKeys
        hide();
      },
      up(e) { if (pinned) return; if (e.code === 'AltLeft' || e.key === 'Alt') { const was = !el.hidden; hide(); if (was) e.preventDefault(); } },
    };
  })();
  cogLate({ keyHints });

  return { desktopBack, dirFocus, keyHints };
};
