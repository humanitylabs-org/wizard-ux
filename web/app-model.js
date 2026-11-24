/* Wizard UX phone shell › saving the window model, live Wizard state, thread emojis and the reload buttons. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.model = function ({ $, appVars, finishVoice, HOME, LIVE, store, vib }) {
  let applyLayout, armBack, closeMenu, deskOf, editUnsent, FIELDS, fromOf, hostedOpenable, openApp, openLinkDesk, openSettings, openWizardThread, recordReply, sealTarget, threadShown, toast, V, viewContext, winTitle; // late-bound: app.js declares these after the call, see bindLate
  if (!(appVars.idx >= 0 && appVars.idx < appVars.desks.length)) appVars.idx = HOME;
  const save = () => { store.set('wins4', appVars.W); store.set('strip', appVars.desks); store.set('idx4', appVars.idx); store.set('idxDesk', appVars.desks[appVars.idx]?.id || ''); window.WosWorkspaceSync?.current?.changed(); };

  /* Live Wizard state: inbox, unread, working come from the real Wizard backend. */
  // Thread emojis are Wizard's own (same-origin storage), read fresh each render.
  let EMO = {}, emoAt = 0;
  const emoOf = id => { if (Date.now() - emoAt > 2000) { try { EMO = JSON.parse(localStorage.getItem('wizard.thread-emojis.v1') || '{}'); } catch (e) {} emoAt = Date.now(); } return EMO[`direct:${id}`] || window.WizBrand.html; };
  const live = () => (LIVE && LIVE.ok ? LIVE.groups() : { needs: [], ready: [], working: [] });
  const ago = window.WizCore.ago;

  /* ---------------- window model ---------------- */
  const track = $('#track');
  /* ---------------- Chats ----------------
   * The Chats client (list, thread, composer, attachments, voice notes, unsent bubbles) is shared with
   * the desktop shell: web/core/chats.js. The phone hands it windows on desks. */
  /* Generic window-refresh adapter: a layout+navigation package may ask for ↻ beside ✕ in every window bar (same
   * in-place refresh as desktop ⌥R) and opt Chats out of pull-to-refresh. Nothing changes while no package holds it. */
  const refreshModes = [];
  const RELOAD_BTN = '<button class="wb" data-wact="reload" aria-label="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg></button>';
  function syncReloadButtons() {
    const on = refreshModes.length > 0;
    for (const bar of track.querySelectorAll('.win > .wbar')) {
      const b = bar.querySelector(':scope > [data-wact="reload"]');
      if (on && !b) bar.querySelector(':scope > [data-wact="full"]')?.insertAdjacentHTML('beforebegin', RELOAD_BTN); else if (!on && b) b.remove();
    }
  }
  const windowRefreshAdapter = { use(options) {
    const mode = Object.freeze({ ...options }); refreshModes.push(mode); syncReloadButtons();
    let released = false;
    return () => { if (released) return; released = true; const at = refreshModes.indexOf(mode); if (at >= 0) refreshModes.splice(at, 1); syncReloadButtons(); };
  } };
  const CHATS = window.WizChatsHost.create({
    win: id => appVars.W[id],
    pullRefresh: () => !refreshModes.some(m => m.pull === false),
    root: () => track,
    save: () => save(),
    layout: id => applyLayout(deskOf(id)),
    toast: (...a) => toast(...a),
    title: w => winTitle(w),
    viewContext: (id, how) => viewContext(id, how),
    visible: () => appVars.desks[appVars.idx].wins,
    front: () => appVars.desks[appVars.idx].focus,
    editUnsent: it => editUnsent(it),
    recoverUnsent: id => { openSettings('unsent'); window.WosSettings.focusUnsent(id); },
    openUnsent: () => openSettings(true),
    newChatHint: 'Type below, or tap the orb and talk.',
    // The composer's mic (#13): the orb's own recorder, pinned to this thread.
    recordReply: (wid, sid) => recordReply(wid, sid),
    dictationField: () => FIELDS && V.kind === 'dictation' && V.state !== 'idle' ? V.field?.el : null,
    captureBusy: () => V.state !== 'idle' || !!V.admitting || !!window.WizAppCapture?.getState?.()?.active,
    recordingFor: () => (V.replyTo && (V.state === 'listen' || V.state === 'paused') ? V.replyTo.sid : ''),
    // The thread a recording take will go into (its composer rides along); Send in that composer finishes the take.
    voiceInto: () => (V.state === 'listen' || V.state === 'paused' ? sealTarget()?.sid || '' : ''),
    finishVoice: () => finishVoice(),
    // A private-origin link in a message opens in a window on this desk: the shell never navigates away.
    openLink: (url, title) => openLinkDesk(url, null),
    // An installed app opened from a Chats row/card remembers this window, so Back (or the app's own done/dismiss) lands here.
    openApp: (id, srcEl) => { const a = hostedOpenable(id); if (!a) return false; const srcId = srcEl?.closest?.('.win')?.dataset.win; const go = () => openApp(a, {}, srcId && appVars.W[srcId] ? { from: fromOf(srcId) } : {}); return window.WosSkinHost?.routeOpen?.('app', { id, path: '' }, go) ? true : go(); },
    overlay: open => { if (open) { closeMenu(); armBack(); } },
    vib: ms => vib(ms),
    threadShown: (wid, el) => threadShown(wid, el),
    openThread: (sid, options) => openWizardThread(sid, options),
  });
  const { CH, ch, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, sendChat, refreshCompose, toggleVoice, markVisibleThreadsSeen, MIC_SVG } = CHATS;
  return { ago, ch, CH, CHATS, chatsBack, emoOf, live, loadThread, markVisibleThreadsSeen, openChat, refreshCompose, refreshModes, RELOAD_BTN, renderChatList, renderChats, renderThread, save, sendChat, track, windowRefreshAdapter, bindLate: v => { if ('applyLayout' in v) applyLayout = v.applyLayout; if ('armBack' in v) armBack = v.armBack; if ('closeMenu' in v) closeMenu = v.closeMenu; if ('deskOf' in v) deskOf = v.deskOf; if ('editUnsent' in v) editUnsent = v.editUnsent; if ('FIELDS' in v) FIELDS = v.FIELDS; if ('fromOf' in v) fromOf = v.fromOf; if ('hostedOpenable' in v) hostedOpenable = v.hostedOpenable; if ('openApp' in v) openApp = v.openApp; if ('openLinkDesk' in v) openLinkDesk = v.openLinkDesk; if ('openSettings' in v) openSettings = v.openSettings; if ('openWizardThread' in v) openWizardThread = v.openWizardThread; if ('recordReply' in v) recordReply = v.recordReply; if ('sealTarget' in v) sealTarget = v.sealTarget; if ('threadShown' in v) threadShown = v.threadShown; if ('toast' in v) toast = v.toast; if ('V' in v) V = v.V; if ('viewContext' in v) viewContext = v.viewContext; if ('winTitle' in v) winTitle = v.winTitle; } };
};
