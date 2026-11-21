/* Wizard UX desktop shell › watching an app frame for refusal and its services. Moved out of desktop.js
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
window.WizCore.desktopParts.frames = function ({ APP, CHATS, closePreview, closeWorkflow, desktopHost, desktopVars, fields, findWin, focusInside, focusWin, mainChats, newWin, panelHas, panelWins, syncChatsPane, threadFromApp, wsOf }) {
  let keyHints, LINKS, onKey, pal; // late-bound: desktop.js declares these after the call, see bindLate
  function watchFrame(f, el) {
    if (!f) return;
    // servicesAs: a companion view gets its owning installed app's Back/services.
    const w = desktopVars.W[el.dataset.win], a = w && APP[w.servicesAs || w.appId];
    if (a?.url) f._appDetach = window.WizAppServices?.attach(f, { appId: a.id, path: a.url, isFront: () => (globalThis.WosSkinHost?.panelMode && panelHas(w.id) && pal.hidden && !CHATS.isHosted(w.id)) || !desktopVars.homeOpen && desktopVars.ws[desktopVars.cur].focus === w.id && desktopVars.ws[desktopVars.cur].wins.includes(w.id) && pal.hidden && !CHATS.isHosted(w.id), back: () => closeWorkflow(w) || closePreview(w), openThread: (sid, opts) => { const r = window.WosSkinHost?.routeOpen?.('thread', { sid, from: a.id }, () => threadFromApp(sid, opts)); return r ? r.value === true : CHATS.openHosted(w.id, f, sid, opts); }, openContextDraft: (key, text) => { const go = main => { let cw = main ? findWin(mainChats) : (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(mainChats); if (!cw) cw = newWin({ app: 'chats', thread: null }); focusWin(cw.id); const receipt = CHATS.openContextDraft(cw.id, key, text); CHATS.renderChats(cw); syncChatsPane(cw.id); setTimeout(() => focusInside(cw.id), 30); return receipt; }; const r = window.WosSkinHost?.routeOpen?.('draft', { from: a.id }, () => go(true)); if (r) { if (!r.value) throw new Error('Main Chats unavailable'); return r.value; } return go(false); }, isVisible: () => (globalThis.WosSkinHost?.panelMode && panelHas(w.id)) || !desktopVars.homeOpen && desktopVars.ws[desktopVars.cur].wins.includes(w.id) && (!desktopVars.ws[desktopVars.cur].mono || desktopVars.ws[desktopVars.cur].focus === w.id) && pal.hidden && !CHATS.isHosted(w.id) || (pal.hidden && !CHATS.isHosted(w.id) && !!window.WosSkinHost?.routeShows?.(wsOf(w.id))) });
    f.addEventListener('load', () => {
      // A refused frame (CSP frame-ancestors / X-Frame-Options) lands on an unreadable error document.
      let bad = false;
      try { const d = f.contentDocument; bad = !d || /^chrome-error:|^about:blank/.test(d.URL || '') && f.getAttribute('src') !== 'about:blank'; } catch (e) { bad = true; }
      // Browser boundary: a sandboxed app is never readable, so unreadable is not refused. It talks by postMessage.
      if (window.WizBrowserBoundary?.enabled && f.hasAttribute('sandbox')) bad = false;
      el.querySelector('.frame-fallback')?.classList.toggle('on', bad);
      // Clicking inside a same-origin app focuses its window; Esc inside it still reaches the shell.
      try {
        const doc = f.contentDocument; if (!doc || doc.__wuxHooked) return; doc.__wuxHooked = true;
        fields().bind(doc);
        doc.addEventListener('pointerdown', () => desktopHost.focus(el.dataset.win, { scroll: false }), true);
        // Keyboard events never bubble out of an iframe. Use its window's capture phase,
        // just like the shell: an app's window-level stopPropagation (e.g. an editor/modal)
        // otherwise prevents the document hook from ever seeing desktop chords. Forward
        // the original event, once; onKey still decides which keys belong to the app.
        const frameWindow = doc.defaultView;
        frameWindow.addEventListener('keydown', e => onKey(e, true), true);
        frameWindow.addEventListener('keyup', e => { keyHints.up(e); window.WosSkinHost?.keyUp?.(e); }, true);
        frameWindow.addEventListener('blur', () => keyHints.hide());
        try { const w0 = desktopVars.W[el.dataset.win]; if (LINKS && window.WizLinks?.guardFrame) window.WizLinks.guardFrame(f.contentWindow, (w0 && ((APP[w0.appId] || {}).url || w0.url)) || f.contentWindow.location.pathname, LINKS); } catch (e) {}
      } catch (e) {}
    });
  }
  return { watchFrame, bindLate: v => { if ('keyHints' in v) keyHints = v.keyHints; if ('LINKS' in v) LINKS = v.LINKS; if ('onKey' in v) onKey = v.onKey; if ('pal' in v) pal = v.pal; } };
};
