/* Wizard UX desktop shell › window titles, private agent names and opening a new window. Moved out of desktop.js
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
window.WizCore.desktopParts.windows = function ({ agentApp, agentWin, appOf, C, CHATS, desktopVars, freshDesk, LIVE, OUTBOX, panelDeskApp, panelHas, render, save, store, threadShown, toast, uid, wsOf }) {
  let closePalette, closeSettings, closeUsage, focusWin, goHome, goWs, hudClose, leaveHome, log, panelClose, panelDeskClose, panelOpen, removeDesktop, toggleKeys, winEl; // late-bound: desktop.js declares these after the call, see bindLate
  function winTitle(w) {
    if (!w) return '';
    if (w.app === 'chats' && !w.thread) { const title = CHATS.listTitle?.(w); if (title) return title; }
    if (w.app === 'chats') {
      if (w.thread === '__new__') return 'New chat';
      if (w.thread) return LIVE?.session(w.thread)?.title || OUTBOX?.forThread(w.thread)[0]?.title || 'Thread';
      return agentWin(w) ? `${agentApp(w).name} · Chats` : 'Chats';
    }
    return appOf(w).name;
  }
  function viewContext(id, how = 'typing') {
    // A private agent's window is named, never read: its thread titles stay with that agent.
    // Unified Chats: a private agent's thread open in the main Chats is named like its own Chats, never by title.
    const privThread = x => !!(x && x.app === 'chats' && x.thread && LIVE?.isPrivate?.(x.thread));
    const priv = x => (agentWin(x) && agentApp(x).private) || privThread(x);
    const privName = x => privThread(x) && !agentWin(x) ? 'A private agent’s thread' : `${agentApp(x).name} chats (private agent)`;
    const w = desktopVars.homeOpen && !id ? null : desktopVars.W[id || desktopVars.ws[desktopVars.cur].focus], others = desktopVars.homeOpen ? [] : desktopVars.ws[desktopVars.cur].wins.filter(x => x !== w?.id).map(x => priv(desktopVars.W[x]) ? privName(desktopVars.W[x]) : winTitle(desktopVars.W[x]));
    const a = appOf(w);
    return [
      `[WizardOS context] ${window.WizConfig.owner() || 'The user'} sent this by ${how} from Wizard UX on their desktop (${desktopVars.homeOpen ? 'Home' : 'workspace ' + C.workspaceNav.slot(desktopVars.cur)}).`,
      w ? `Window in front: ${priv(w) ? privName(w) : winTitle(w)}${a?.url ? ` (${a.url})` : ''}.` : desktopVars.homeOpen ? 'Home screen in front.' : 'No window was open.',
      (s => s ? `Visible on screen: ${s}` : '')(w && w.app !== 'chats' ? (window.WizScreen?.read(winEl(w.id)) || '') : ''),
      others.length ? `Also open on this workspace: ${others.join(', ')}.` : '',
      'When they say "this", "here", or "it", they likely mean that window. Use this as background only.',
    ].filter(Boolean).join(' ');
  }

  function newWin(obj, opts = {}) {
    if (obj.app === 'chats' && !obj.agent && !obj.chatsProvider) obj = { ...obj, chatsProvider: CHATS.views.defaultId() };
    if (globalThis.WosSkinHost?.panelMode) return panelOpen(obj);
    leaveHome();
    const t = Number.isInteger(opts.ws) && desktopVars.ws[opts.ws] ? opts.ws : desktopVars.cur;
    const id = uid(); desktopVars.W[id] = { id, ...obj };
    const d = desktopVars.ws[t];
    // New windows go next to the focused one, like a tiling WM.
    const at = d.focus ? d.wins.indexOf(d.focus) + 1 : d.wins.length;
    d.wins.splice(at, 0, id); d.focus = id; d.mono = false;
    save();
    if (t !== desktopVars.cur) goWs(t); else render();
    return desktopVars.W[id];
  }
  // A window may refuse to close (an in-progress recording or temporary chat asks first).
  function canLeave(id, checkOnly = false) {
    if (desktopVars.W[id]?.app === 'pages' && !window.WosPages.canClose(winEl(id)?.querySelector('.pg-host'))) return false;
    return CHATS.beforeLeave ? CHATS.beforeLeave(id, checkOnly) : true;
  }
  // One cleanup path for a window close and a whole-desktop close. The caller owns
  // leave checks, pruning and the final render (which detaches closed app frames).
  function removeWin(id, internal = false) {
    if (!desktopVars.W[id]) return;
    if (!internal) {
      desktopVars.boundManager?.dismiss(desktopVars.W[id]);
      window.WizBackgroundAudio?.closeApp(desktopVars.W[id]?.appId)?.catch(() => toast('♫','Audio could not stop. Pause it from the media controls.'));
    }
    const t = wsOf(id); if (t < 0) return;
    if (desktopVars.W[id]?.app === 'chats') threadShown(id,null);
    const d = desktopVars.ws[t], i = d.wins.indexOf(id);
    CHATS.saveDraft(id);
    d.wins.splice(i, 1); delete desktopVars.W[id]; CHATS.forget(id);
    if (d.focus === id) d.focus = d.wins[Math.min(i, d.wins.length - 1)] || null;
    if (d.wins.length < 2) d.mono = false;
  }
  function closeWin(id, internal = false) {
    if (!internal && !canLeave(id)) return;
    if (desktopVars.hud?.id === id) { hudClose(); return; }
    if (globalThis.WosSkinHost?.panelMode && panelHas(id)) { panelClose({ id }); return; }
    if (globalThis.WosSkinHost?.panelMode && panelDeskApp(desktopVars.W[id])) { panelDeskClose(id); save(); render(); return; } // an app's desk out of sight
    const t = wsOf(id); if (t < 0) return;
    const d = desktopVars.ws[t];
    if (!internal) rememberClosed(id, t);
    removeWin(id, internal);
    if (!internal && !d.wins.length && desktopVars.ws.length > 1) { removeDesktop(d); if (window.WosSkinHost?.emptyHome) goHome(); } // a layout without desk numbers: back to Home
    else { save(); render(); }
  }
  /* ⌥⇧W reopens the last closed window (Omarchy-style safety net for ⌥W): same desk, same spot, same chat or screen. */
  const closedWins = (() => { const v = store.get('closed', []); return Array.isArray(v) ? v.filter(c => c && c.w && typeof c.w.id === 'string').slice(-12) : []; })(); // kept across reloads
  function rememberClosed(id, t) {
    const d = desktopVars.ws[t]; let w; try { w = JSON.parse(JSON.stringify(desktopVars.W[id])); } catch (_) { return; }
    closedWins.push({ w, desk: d.id, deskAt: t, at: d.wins.indexOf(id), split: d.split }); if (closedWins.length > 12) closedWins.shift(); store.set('closed', closedWins);
  }
  function reopenClosed() {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    let c; do c = closedWins.pop(); while (c && desktopVars.W[c.w.id]); store.set('closed', closedWins);
    if (!c) return toast('↺', 'Nothing closed to reopen', 1500);
    closePalette({ restore: false }); toggleKeys(false); closeSettings(); closeUsage();
    let t = desktopVars.ws.findIndex(d => d.id === c.desk);
    if (t < 0) { // its desk closed with it: put the desk back where it was
      t = Math.max(0, Math.min(c.deskAt, desktopVars.ws.length)); desktopVars.ws.splice(t, 0, { ...freshDesk(), id: c.desk, ...(c.split ? { split: c.split } : {}) });
      if (desktopVars.cur >= t) desktopVars.cur += 1; if (desktopVars.lastWs >= t) desktopVars.lastWs += 1;
    }
    const d = desktopVars.ws[t]; desktopVars.W[c.w.id] = c.w;
    d.wins.splice(Math.max(0, Math.min(c.at, d.wins.length)), 0, c.w.id); d.focus = c.w.id; d.mono = false;
    save(); leaveHome(); if (t !== desktopVars.cur) { desktopVars.lastWs = desktopVars.cur; goWs(t); } else render();
    focusWin(c.w.id); log('reopen:' + (c.w.appId || c.w.app));
  }
  return { canLeave, closedWins, closeWin, newWin, rememberClosed, removeWin, reopenClosed, viewContext, winTitle, bindLate: v => { if ('closePalette' in v) closePalette = v.closePalette; if ('closeSettings' in v) closeSettings = v.closeSettings; if ('closeUsage' in v) closeUsage = v.closeUsage; if ('focusWin' in v) focusWin = v.focusWin; if ('goHome' in v) goHome = v.goHome; if ('goWs' in v) goWs = v.goWs; if ('hudClose' in v) hudClose = v.hudClose; if ('leaveHome' in v) leaveHome = v.leaveHome; if ('log' in v) log = v.log; if ('panelClose' in v) panelClose = v.panelClose; if ('panelDeskClose' in v) panelDeskClose = v.panelDeskClose; if ('panelOpen' in v) panelOpen = v.panelOpen; if ('removeDesktop' in v) removeDesktop = v.removeDesktop; if ('toggleKeys' in v) toggleKeys = v.toggleKeys; if ('winEl' in v) winEl = v.winEl; } };
};
