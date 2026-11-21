/* Wizard UX core: Chats › the Daily view's follow and claim, and agents in the Channels list.
 * Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Values chats.js changes over time (its
 * reassigned lets) stay in chats.js; this code reads and writes them as chatVars.<name>, chats.js's get/set
 * accessors on the same variables, so every read and write is live. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.agentrows = function ({ agentName, AGS, ch, CH, chanElsewhere, chanNeeds, chanOpen, chatVars, clip, DAILY_HIST, DAILY_OPEN, dailyHead, dailyLast, dailyOn, dailyPin, dailyState, draftKey, esc, isWorking, KIT, LIVE, loadDraft, openChat, owner, renderChatList, renderThread, rowAgent, save, saveDraft, toTurns, W }) {
  let deferredOf, elOf, hasContent, holdList; // late-bound: chats.js declares these after the call, see bindLate
  // The days read after a Daily view opened on the kept copy: a newer day there moves every window still showing that
  // view on the thread it opened, words in its box going along.
  function dailyFollow(id, sid) {
    const st = LIVE.chanDaily?.state(id), head = dailyHead(st); if (!st || head === sid || head === '__new__') return;
    if (sid !== '__new__' && !(st.days.findIndex(d => d.sessionId === head) < st.days.findIndex(d => d.sessionId === sid))) return;
    for (const wid of Object.keys(CH)) {
      const w = W[wid]; if (!w || !dailyOn(w) || w.daily.id !== id || w.thread !== sid) continue;
      const ta = elOf(wid)?.querySelector?.('.ch-compose textarea'); if (ta) ch(wid).draft = ta.value;
      saveDraft(wid);
      chatVars.dailyNext = { sid: head, daily: { id, agent: w.daily.agent }, at: Date.now(), from: draftKey(w) };
      openChat(wid, head);
    }
  }
  // openChat's hook: the thread a Daily tap (or a send that moved to a new day) opened takes the Daily view; any other
  // open leaves it. A draft typed on the day before follows the view to the new day's thread.
  function dailyClaim(w, sid) {
    const n = chatVars.dailyNext;
    if (n && n.sid === sid && Date.now() - n.at < 5000) {
      // A Chats list window (the AI apps sidebar's id::side) sets its base window's thread: that window takes the view.
      const lw = /::(list|side)$/.test(String(w.id)) && W[String(w.id).replace(/::(list|side)$/, '')];
      if (lw && lw !== w && lw.thread === sid) w = lw;
      chatVars.dailyNext = null; w.daily = { id: n.daily.id, agent: n.daily.agent, sid };
      const last = dailyLast(n.daily.id), from = n.from || (last && last !== sid ? 'direct:' + last : '');
      const to = sid === '__new__' ? '' : 'direct:' + sid;
      if (from && to && from !== to) {
        const a = KIT.drafts.get(from), b = KIT.drafts.get(to);
        if (hasContent(a.text, a.files) && !hasContent(b.text, b.files)) { KIT.drafts.set(to, a.text, a.files); KIT.drafts.clear(from); loadDraft(w); }
      }
      if (sid !== '__new__') dailyLast(n.daily.id, sid);
      save();
      if (lw === w) { const el = elOf(w.id); if (el) renderThread(w, el); }
      return true;
    }
    if (w.daily) { delete w.daily; save(); }
    return false;
  }
  // sendChat's hook: the thread a send from the Daily view goes to, pinned at the tap: today's, as the box names it.
  // When the day moved on (or this is the day's first post) and the window still shows the view, it opens today's thread
  // first, taking the box with it. Unreachable: the day thread on screen at the tap takes it (the words are never lost).
  async function dailyTarget(w) {
    const d = w?.daily; if (!d || !dailyOn(w)) return '';
    const was = w.thread;
    let r = null; try { r = await LIVE.chanDaily.today(d.id); } catch (_) { return was; }
    if (!r?.sessionId) return was;
    dailyPin(r.sessionId, d.agent);
    if (r.sessionId === was) return was;
    if (W[w.id] === w && w.daily === d && w.thread === was) {
      // The box as it is now: the words being sent already left it (the send clears the field before it asks).
      const ta = elOf(w.id)?.querySelector?.('.ch-compose textarea'); if (ta) ch(w.id).draft = ta.value;
      saveDraft(w.id);
      chatVars.dailyNext = { sid: r.sessionId, daily: d, at: Date.now(), from: draftKey(w) };
      openChat(w.id, r.sessionId);
    }
    LIVE.chanDaily.read(d.id);
    return r.sessionId;
  }
  /* The Daily view, unread and Activity marks; core/chats-daily.js. */
  const { actMark, actNeeds, actRowMark, actUnread, agentLabelOf, chanDraftMark, chanUnread, chanUnreadN, dailyClick, dailyHtml, dailyLinkTo, dailyWatch, draftTag, rowDraft, bindLate: dailyLate } = window.WizCore.chatsParts.daily({ agentName: (...a) => agentName(...a), AGS: (...a) => AGS(...a), CH, chanElsewhere, chanNeeds, chanOpen, clip, DAILY_HIST, DAILY_OPEN, dailyOn, dailyPin, dailyState, deferredOf: (...a) => deferredOf(...a), elOf: (...a) => elOf(...a), esc, holdList: (...a) => holdList(...a), isWorking, KIT, LIVE, renderChatList, renderThread, rowAgent, toTurns, W });
  // Activity always shows every agent (the agent chips left it): a list still focused on one agent or a Space from
  // before goes back to All, unless a channel's or an agent's feed is open in it. A window opened for one agent keeps it.
  function actAllAgents(w, side = false) {
    if (side || chatVars.chanView !== 'activity' || !w || chanOpen(w)) return false;
    const o = W[owner(w.id)] || w; if (!o || !o.focus || o.agent) return false;
    o.focus = null; save(); return true;
  }
  /* Agents in the Channels list (issue 1336; James: "putting them in the channels section … have that collapsed"): a
   * folded Agents row just above Archive, one line per visible agent (the main one first), each with a channel's own
   * aggregate marker. An agent opens like a channel: a feed of every thread with that agent across its channels (its
   * Focus), whose message box starts a new thread with it in General. Hidden while only one agent is installed. */
  const CHAN_AGENT = '@agent:';
  return { actAllAgents, actMark, actNeeds, actRowMark, actUnread, agentLabelOf, CHAN_AGENT, chanDraftMark, chanUnread, chanUnreadN, dailyClaim, dailyClick, dailyFollow, dailyHtml, dailyLate, dailyLinkTo, dailyTarget, dailyWatch, draftTag, rowDraft, bindLate: v => { if ('deferredOf' in v) deferredOf = v.deferredOf; if ('elOf' in v) elOf = v.elOf; if ('hasContent' in v) hasContent = v.hasContent; if ('holdList' in v) holdList = v.holdList; } };
};
