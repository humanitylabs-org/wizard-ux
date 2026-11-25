/* Wizard UX AI apps view (desktop) › the app beside a chat after a reload, the split and a channel feed in the chat column. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { CHATS } from '../apps/chrome.js';
export function splitPart({ aadVars, anim, api, applySizes, appName, appTile, chatsEl, cTop, cX, desks, doneLoading, FEED, feedBox, flip, focusFrame, homeComposer, host, markUsed, modeBars, one, orbBox, paintTools, paneModel, paneWins, pIcon, placementOf, pName, pTop, pX, retileSoon, root, sName, sTop, syncSide, top, waitLoaded, watchPaneWins, wsps }) {
  let here, onMainChats, paintTop, setWide; // late-bound: desktop.js declares these after the call, see bindLate
  /* The app beside a chat survives a reload (wizard-ux issue 1368): a chat opened from the sidebar puts the Chats desk
   * in front (the route), and the panel was kept only in memory. Saved as { id, desk } whenever it changes; on boot,
   * with the Chats desk in front, the same app's desk becomes the panel again (the shell draws it on a later paint). */
  let besideWant = api.storage.get('beside'), besideSaved = JSON.stringify(besideWant ?? null), besideTries = 0;
  function restoreBeside(h) {
    const b = besideWant, d = b && typeof b.id === 'string' && (desks().find(x => x.id === b.id && x.desk === b.desk) || desks().find(x => x.id === b.id));
    if (!d || d.id === CHATS || h.app || h.r.home || !onMainChats(h.r)) { besideWant = null; return; }
    const el0 = placementOf(d.desk);
    if (el0) { aadVars.pane = { id: d.id, el: el0, desk: d.desk }; besideWant = null; }
    else if (++besideTries > 20) besideWant = null;
    else api.after(150, () => paintTop());
  }
  function keepBeside() {
    const v = aadVars.pane ? { id: aadVars.pane.id, desk: Number(aadVars.pane.desk) } : null, s = JSON.stringify(v);
    if (s !== besideSaved) { besideSaved = s; api.storage.set('beside', v); }
  }
  function paintSplit(chatOn) {
    const h = here();
    if (aadVars.dropped && (aadVars.want === h.app || h.app !== aadVars.dropped.id || Number(h.r.desk) !== aadVars.dropped.desk)) aadVars.dropped = null;
    if (h.app && !aadVars.dropped && (aadVars.want === h.app || !aadVars.pane || aadVars.pane.id !== h.app || Number(aadVars.pane.desk) !== h.r.desk)) {
      // the app now in front becomes the panel (its desk is the one not hidden)
      const app = (host?.windows() || []).find(w => w.visible && w.desk === h.r.desk && w.kind !== 'chats');
      const el0 = app && placementOf(app.desk);
      if (el0) { const fresh = aadVars.pane?.el !== el0; aadVars.pane = { id: h.app, el: el0, desk: h.r.desk }; if (fresh) anim('app'); markUsed(h.app); }
      aadVars.want = null;
    }
    if (aadVars.focusWant && aadVars.pane?.id === aadVars.focusWant && !aadVars.focusing) { aadVars.focusing = true; const generation = aadVars.focusGeneration; api.after(60, () => focusFrame(0, generation)); }
    // (another panel already in front wins over a pending restore: Codex review)
    if (besideWant) { if (aadVars.pane) besideWant = null; else restoreBeside(h); }
    if (aadVars.pane && (!aadVars.pane.el.isConnected || !desks().some(d => d.desk === aadVars.pane.desk && d.id === aadVars.pane.id))) aadVars.pane = null;
    if (!besideWant) keepBeside();
    if (!aadVars.pane && aadVars.wide) setWide(false);
    // narrow desktop (ONE): the app in front fills the main area (as ⤢ Wider); the chat stays open behind it, not beside
    if (aadVars.pane) aadVars.oneLast = { id: aadVars.pane.id, desk: Number(aadVars.pane.desk) };
    const oneFront = one() && !!aadVars.pane;
    if (oneFront && !aadVars.wide) { aadVars.oneWide = true; setWide(true); } else if (aadVars.oneWide && !oneFront) {
      // (an app showing its companion keeps the width it wants wide, as autoWide would have given it: Codex review)
      aadVars.oneWide = false; if (aadVars.pane && paneWins() > 1) aadVars.wideAuto = true; else if (aadVars.wide && !aadVars.wideAuto) setWide(false);
    }
    const model = paneModel(), floating = model.mode !== 'tiled';
    const chat = aadVars.pane || chatOn || floating ? chatsEl() : null; aadVars.dockEl = chat;
    // (the app's desk or the Chats desk not on the stage yet, the shell draws a desk on its first visit: look again
    // shortly, a few times; no route event follows that drawing)
    if (((h.app && !aadVars.pane) || ((aadVars.pane || chatOn) && !chat)) && aadVars.splitTries < 20) { aadVars.splitTries++; api.after(150, () => paintTop()); } else aadVars.splitTries = 0;
    // the Chats desk behind the panel shows Home's new chat, never its bare list (the page opened on an app, or the
    // Chats desk was left on its list): a new chat there, then the app back in front (once; the shell draws it)
    if (aadVars.pane && !chatOn && chat && !chat.querySelector('.pane-main .ch-compose') && !aadVars.fixingBehind) {
      aadVars.fixingBehind = true; const d0 = aadVars.pane.desk, id0 = aadVars.pane.id;
      api.sessions.newChat(); api.after(80, () => { aadVars.want = id0; api.nav.goDesk(d0); api.after(600, () => { aadVars.fixingBehind = false; }); });
    }
    const second = model.slots.includes('app2') && model.app2 && desks().find(d => d.id === model.app2 && d.id !== aadVars.pane?.id && d.id !== CHATS);
    aadVars.secondEl = second ? placementOf(second.desk, chat) : null;
    for (const w of wsps()) {
      const r = w === aadVars.pane?.el ? 'app' : w === chat ? 'chat' : w === aadVars.secondEl ? 'app2' : '';
      if ((w.dataset.aadRole || '') !== r) { if (r) w.dataset.aadRole = r; else delete w.dataset.aadRole; }
      if (r && !model.slots.includes(r === 'chat' ? 'chats' : r)) w.dataset.aadOmitted = ''; else delete w.dataset.aadOmitted;
    }
    const was = `${!!root.dataset.aadSplit}${aadVars.docked}`, wasDocked = aadVars.docked;
    aadVars.docked = !!(model.slots.includes('chats') && (chatOn || floating) && chat) && !oneFront;
    const setState = () => {
      if (model.slots.includes('app') && aadVars.pane && chat) root.dataset.aadSplit = 'on'; else delete root.dataset.aadSplit;
      if (aadVars.docked) root.dataset.aadChat = 'on'; else delete root.dataset.aadChat;
    };
    if (!aadVars.docked && !wasDocked && !!(aadVars.pane && chat) !== !!root.dataset.aadSplit) flip([homeComposer(), orbBox], setState); else setState();
    if (aadVars.docked && !wasDocked) anim('dock');
    applySizes(); watchPaneWins();
    if (was !== `${!!root.dataset.aadSplit}${aadVars.docked}`) { syncSide(); retileSoon(); }
    // One physical pane owns both the layout header and the app window. Moving
    // the header (not cloning it) preserves its tools/listeners and iframe state.
    const headerHost = aadVars.pane?.el || top;
    if (pTop.parentNode !== headerHost) headerHost.append(pTop);
    // Docked windows carry their header and body on ONE animated ancestor,
    // including the trip back to tiled. Home's undocked title stays in its row.
    const chatHeaderHost = aadVars.docked && chat ? chat : top;
    if (cTop.parentNode !== chatHeaderHost) chatHeaderHost.append(cTop);
    // The second app's header lives only on that window; parked nowhere when none is open.
    if (aadVars.secondEl) { if (sTop.parentNode !== aadVars.secondEl) aadVars.secondEl.append(sTop); } else sTop.remove();
    sTop.hidden = !aadVars.secondEl; sName.textContent = second ? appName(second.id) : '';
    for (const { bar } of modeBars) for (const b of bar.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === model.mode));
    pTop.hidden = !aadVars.pane || !model.slots.includes('app'); cX.hidden = !aadVars.docked;
    paintFeed(chat);
    if (aadVars.pane) { pName.textContent = appName(aadVars.pane.id); pIcon.replaceChildren(appTile(aadVars.pane.id, 'aad-tile is-xs')); pX.setAttribute('aria-label', `Hide ${appName(aadVars.pane.id)} (Esc), it keeps running`); }
    paintTools();
    if (aadVars.loadId && aadVars.pane?.id === aadVars.loadId) waitLoaded(); else if (aadVars.loadId && !aadVars.want) doneLoading();
  }
  // A channel's feed in the docked chat column, over the Chats window there (its own header, posts and message box).
  function paintFeed(chat) {
    const on = aadVars.chatThread === FEED && aadVars.docked && !!chat;
    if (on && feedBox.parentNode !== chat) chat.append(feedBox);
    const open = on ? api.sessions.channelFeed?.(feedBox) : null;
    if (feedBox.hidden === !!open) feedBox.hidden = !open;
    if (open) root.dataset.aadFeed = ''; else delete root.dataset.aadFeed;
  }
  return { paintSplit, bindLate: v => { if ('here' in v) here = v.here; if ('onMainChats' in v) onMainChats = v.onMainChats; if ('paintTop' in v) paintTop = v.paintTop; if ('setWide' in v) setWide = v.setWide; } };
}
