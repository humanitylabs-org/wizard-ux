/* Wizard UX phone shell › which view a voice take is for. Moved out of app.js
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
window.WizCore.appParts.viewvoice = function ({ agentApp, agentWin, appVars, CHATS, frameHref, LIVE, mainChats, winApp, winTitle }) {
  /* ---------------- view-aware voice ----------------
   * The orb always knows which window is in front. A view can
   *  - capture: everything said with a tap goes to that view (hold still forces a command);
   *  - auto: a tap goes to the open thread or to Archimedes, never through command routing;
   *  - say nothing: the utterance goes to Archimedes, who is told what was on screen.
   * Chats threads are auto. Framed apps require the installed receives_voice_input capability
   * and the shared WizardApp.voiceInput receiver; app-authored meta tags grant nothing. */
  function viewOf(id) {
    const w = appVars.W[id]; if (!w) return null;
    // A channel's feed in front (wizard-ux issue 1258): a tap take starts a new chat in that
    // channel, exactly like its message box (whose words and pictures ride with it), pinned to that channel's Space,
    // and the window stays on the feed. A routed agent's channel keeps that agent's own voice path (below).
    const chan = w.app === 'chats' && !w.thread ? CHATS.chanOpen?.(w) : null, pin = chan ? { kind: 'chat thread', thread: '__new__', channel: chan.name, space: chan.general ? '' : chan.id, box: CHATS.chanBox?.(id) || '', chanAgent: CHATS.winAgent(w) || '' } : {};
    if (agentWin(w) || (w.app === 'chats' && (!w.thread || w.thread === '__new__') && CHATS.winAgent(w))) {
      // A Focus list/draft has the same destination as the former per-agent window. Existing threads keep theirs.
      const a = agentApp({ ...w, agent: CHATS.winAgent(w) || w.agent });
      return { id, mode: 'auto', kind: w.thread ? 'chat thread' : w.agent ? 'agent chats' : 'thread list', thread: w.thread || '', agent: a.agent, agentLabel: a.name, private: a.private,
        name: a.private ? `${a.name} chats (private agent)` : w.thread ? `${a.name} thread “${winTitle(w)}”` : `${a.name} chats`, ...pin };
    }
    // Issue 1523: the channel by its emoji and words ("🚀 Launch channel"), as the Chats list shows it.
    if (chan) return { id, mode: 'auto', ...pin, name: `${window.WizCore?.channelFace?.(chan.name, !!chan.general)?.title || '# ' + chan.name} channel` };
    // Unified Chats: a private agent's thread open in the main Chats is named like its own Chats, never by title.
    if (w.app === 'chats' && w.thread && LIVE?.isPrivate?.(w.thread)) { const ag = window.WosAgents?.get(LIVE.agentOf(w.thread) || window.WosAgents.defaultId?.()) || { id: LIVE.agentOf(w.thread), label: 'Private' };
      return { id, mode: 'auto', kind: 'chat thread', thread: w.thread, agent: ag.id, agentLabel: ag.label, private: true, name: `${ag.label} thread (private agent)` }; }
    // A new chat on a Private model in the main Chats: what is said here goes to that agent (never the router).
    if (mainChats(w) && w.thread === '__new__') { const nm = CHATS.ch?.(id)?.newModel, AGx = window.WosAgents, ag = nm?.agent && AGx?.isOther(nm.agent) ? AGx.get(nm.agent) : null;
      if (ag && AGx.isPrivate(ag)) return { id, mode: 'auto', kind: 'chat thread', thread: '__new__', agent: ag.id, agentLabel: ag.label, private: true, name: `New ${ag.label} chat (private agent)` }; }
    if ((w.app === 'chats' || CHATS.isHosted(id)) && w.thread) return { id, mode: 'auto', kind: 'chat thread', thread: w.thread, name: w.thread === '__new__' ? 'New chat' : `Chats thread “${winTitle(w)}”` };
    if (w.app === 'frame' && w.from && w.from.sid) return { id, mode: '', kind: 'review', review: true, thread: w.from.sid, threadTitle: w.from.title || '', name: `Review of ${winTitle(w)}`, url: frameHref(id) || w.url };
    if (w.app === 'frame') return { id, mode: '', kind: 'app', name: winApp(w).name, url: frameHref(id) || winApp(w).url };
    if (w.app === 'chats') return { id, mode: '', kind: 'thread list', name: 'Chats' };
    return { id, mode: '', kind: 'app', name: winTitle(w) };
  }
  return { viewOf };
};
