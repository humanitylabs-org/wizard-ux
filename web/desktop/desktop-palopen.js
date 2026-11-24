/* Wizard UX desktop shell › opening, toggling and closing the palette, and where focus rests. Moved out of desktop.js
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
window.WizCore.desktopParts.palopen = function ({ $, CHATS, desktopVars, findWin, focused, focusInside, focusWin, homeHtml, mainChats, newWin, OUTBOX, paintHome, pal, palIn, palList, palMark, palPaint, palRender, panelWins, pickMove, toast, viewContext, wsEl }) {
  // mode 'all' is ⌘K; 'apps' is the app selector. o.desk ties a selector to the empty desktop it opened on.
  function openPalette(q = '', mode = 'all', o = {}) {
    window.WosResources?.back(); // after Resources hands focus back to its opener, so that is what Esc restores
    const a = document.activeElement;
    if (pal.hidden) desktopVars.palPrev = a && a !== document.body && !pal.contains(a) ? a : null;
    desktopVars.palDesk = o.desk || null; desktopVars.palMode = mode; palPaint();
    pal.hidden = false; palIn.value = q; desktopVars.palSel = 0; palRender(); palIn.focus(); palIn.select();
    window.WizCore.refreshApps?.({afterPending:true}); // also refresh after a pending pre-opening snapshot
  }
  const openPicker = (o = {}) => openPalette('', 'apps', o);
  // ⌘K and ⌘O switch an open box between its modes, keeping the query; the same key again closes it.
  function palToggle(mode) {
    if (pal.hidden) return openPalette('', mode);
    if (desktopVars.palMode === mode) return closePalette();
    desktopVars.palMode = mode; palPaint(); desktopVars.palSel = 0; palRender(); palIn.focus();
    window.WizCore.refreshApps?.({afterPending:true});
  }
  function closePalette({ restore = true } = {}) {
    if (pal.hidden) return;
    pal.hidden = true; desktopVars.palDesk = null;
    const prev = desktopVars.palPrev; desktopVars.palPrev = null;
    if (!restore) return;
    if (prev?.isConnected && prev.getClientRects().length) prev.focus({ preventScroll: true }); else restFocus();
  }
  // Where focus rests with no layer open: the focused app, else Home, else this empty desktop's surface.
  function restFocus() {
    const f = focused(); if (f) return focusInside(f.id);
    (desktopVars.homeOpen ? $('#desktopHome') : wsEl(desktopVars.cur)?.querySelector(':scope > .home'))?.focus({ preventScroll: true });
  }
  function palRun(i, o = {}) {
    const it = desktopVars.palItems[i]; if (!it) return;
    if (it.kind === 'fold') return it.run();
    // An app takes focus where it opens; anything else returns focus first, then runs (it may open its own layer).
    if (it.kind === 'app') { closePalette({ restore: false }); it.run(o); restFocus(); return; }
    closePalette(); it.run(o);
  }
  window.addEventListener('wizard:apps', () => {
    if (!pal.hidden) palRender();
    if (desktopVars.homeOpen) paintHome($('#desktopHome'), homeHtml(null));
    const h = wsEl(desktopVars.cur)?.querySelector('.home'); if (h) paintHome(h, homeHtml(desktopVars.cur));
  });
  palIn.addEventListener('input', () => { desktopVars.palSel = 0; palRender(); });
  palIn.addEventListener('keydown', e => {
    const n = Math.max(1, desktopVars.palItems.length);
    if (desktopVars.palMode === 'apps') {
      if (e.altKey) return; // window-manager chords belong to the shell
      if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return pickMove(e.key); }
      if (e.ctrlKey && (e.key === 'n' || e.key === 'p')) { e.preventDefault(); return palMark((desktopVars.palSel + (e.key === 'n' ? 1 : -1) + n) % n); }
      if (e.key === 'Enter') {
        e.preventDefault();
        // No app by that name: widen to ⌘K with the same words (threads, commands, Search, Ask).
        if (!desktopVars.palItems.length) { if (palIn.value.trim()) palToggle('all'); return; }
        return palRun(desktopVars.palSel, { fresh: e.shiftKey });
      }
      return;
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); palMark((desktopVars.palSel + 1) % n); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); palMark((desktopVars.palSel - 1 + n) % n); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && palIn.value.trim()) { const q = palIn.value; closePalette(); return ask(q); }
      palRun(desktopVars.palSel, { fresh: e.shiftKey });
    }
  });
  palList.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) palRun(+b.dataset.i, { fresh: e.shiftKey }); });
  /* Keyboard containment (the card is aria-modal). The search box is the box's one tab stop: options are
   * tabindex=-1 and followed by aria-activedescendant, so Tab and ⇧Tab keep focus on the search box and never
   * reach the page behind. An option focused by a click or script stays a native button (↵/Space activate it),
   * takes the selection, and hands arrows and Tab back to the search box. ⌘K, ⌘O, ⌥ chords and Esc are handled
   * before this, on the shell's capture listener (onKey). */
  pal.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); palIn.focus({ preventScroll: true });
  });
  palList.addEventListener('focusin', e => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== desktopVars.palSel) palMark(+b.dataset.i); });
  palList.addEventListener('keydown', e => {
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !e.target.closest('[data-i]')) return;
    e.preventDefault(); palIn.focus({ preventScroll: true });
    if (desktopVars.palMode === 'apps') pickMove(e.key);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') palMark((desktopVars.palSel + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, desktopVars.palItems.length)) % Math.max(1, desktopVars.palItems.length));
  });
  palList.addEventListener('pointermove', e => { const b = desktopVars.palMode === 'apps' && e.target.closest('[data-i]'); if (b && +b.dataset.i !== desktopVars.palSel) palMark(+b.dataset.i); });
  pal.addEventListener('pointerdown', e => { if (e.target === pal) closePalette(); });

  /* Ask Archimedes from anywhere: a new thread, through the durable outbox, delegated in the background.
   * Nothing opens or takes focus; the thread shows up in Chats when James wants it. */
  async function ask(text, how = 'typing in the desktop launcher', audio = null, route = null, quiet = false) {
    text = String(text || '').trim(); if (!text && !audio) return;
    const ctx = viewContext(null, how);
    await OUTBOX.enqueue({ ...(route || {}), kind: 'new', text, audio, instructions: ctx, source: 'orb', how });
    if (!audio && !quiet) toast('✦', `New thread started · ${window.WizConfig.agent()} is on it`, 1600);
  }

  /* Wizard Files (#23): the shared Files sheet, in a Chats window (attaches to its open thread, else starts a new chat). */
  function openFiles() {
    let w = (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(mainChats) || findWin(mainChats);
    if (!w) w = newWin({ app: 'chats', thread: null });
    focusWin(w.id);
    setTimeout(() => CHATS.PW?.openFiles(w.thread ? w.id : w.id + '::list'), 30);
  }
  /* AI usage (#24): the same panel as the phone's Settings, in a card. */
  const usageEl = document.createElement('div');
  usageEl.className = 'keys usage-ov'; usageEl.hidden = true;
  usageEl.innerHTML = '<div class="keys-card" role="dialog" aria-label="AI usage"><div class="keys-head"><b>AI usage</b><small>Quota left on each subscription, and when it resets.</small><button class="x" data-close="usage" aria-label="Close">✕</button></div><div class="usage-body" data-usage-host></div></div>';
  document.body.appendChild(usageEl);
  const paintUsage = () => { if (!usageEl.hidden) usageEl.querySelector('[data-usage-host]').innerHTML = window.WosUsage.html(); };
  function openUsage() { window.WosResources?.back(); usageEl.hidden = false; paintUsage(); window.WosUsage.load(Date.now() - (window.WosUsage.at || 0) > 60e3).then(paintUsage); }
  function closeUsage() { if (usageEl.hidden) return false; usageEl.hidden = true; return true; }
  usageEl.addEventListener('click', e => {
    if (e.target === usageEl || e.target.closest('[data-close]')) return closeUsage();
    if (e.target.closest('[data-usage-refresh]')) { window.WosUsage.load(true).then(paintUsage); paintUsage(); }
  });

  /* Shared responsive feature surface; this adapter owns only desktop navigation and focus. */
  const setEl = document.createElement('section');
  setEl.id = 'dsettings'; setEl.className = 'dsettings'; setEl.hidden = true;
  setEl.setAttribute('role', 'region'); setEl.setAttribute('aria-label', 'Settings');
  setEl.innerHTML = '<button class="st-close" data-close aria-label="Close settings">✕</button><div id="settingsBody"></div>';
  document.body.appendChild(setEl);
  return { ask, closePalette, closeUsage, openFiles, openPalette, openPicker, openUsage, paintUsage, palToggle, restFocus, setEl, usageEl };
};
