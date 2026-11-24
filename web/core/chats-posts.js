/* Wizard UX core: Chats › channel posts: a post's first message and its words, reply
 * counts, where a feed opens and stays, and seeing a post without reading it. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls this
 * once, where the code used to be, with the closure names it reads, and keeps the functions it returns under their
 * old names. Loaded before chats.js by both shells. The body below keeps chats.js's indentation so `git log -L` and
 * patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.posts = function ({ ch, CH, CHAN_TEXT_MAX, chanChanged, chanGenAgent, chanOpen, chanReadAt, chanReadFeed, chanReadKey, elOf, holdList, isWorking, LIVE, mediaOfFile, owner, paintFeedJump, rerenderList, rowAgent, toTurns, W }) {
  /* A post is the owner's first message (James, 10 Nov 2026: "the first message that I sent, truncated beyond a
   * certain length", with the pictures it carried as thumbnails). Agent Service list rows will carry it as
   * firstRequest / firstAttachments (wizard-agent-service issue 446); until then the shell reads the first page of
   * the thread's history once, a few threads at a time, and keeps it per thread. Everything is keyed by the row's own
   * agent plus its id, and the read names that agent: a main and a routed thread may share an id. A failed read
   * (offline, timeout) is not kept; the thread is read again on a repaint after CHAN_FIRST_RETRY. Nor is an empty
   * history (a chat just started) or a voice note still being transcribed: read again soon (firstPend, backing off).
   * The post never shows the generated chat title for an owner's message (James, 11 Nov 2026: "We don't want to
   * temporarily display a title. We don't want to oscillate back and forth"): the words once shown stay (SHOWN). */
  const FIRST = new Map(), firstWant = new Map(), firstAsked = new Set(), firstFailed = new Map(), firstPend = new Map(), SHOWN = new Map(), CHAN_FIRST_RETRY = 30e3, CHAN_FIRST_WAIT = 2e3;
  let firstBusy = 0, firstT = 0;
  const firstAgent = s => LIVE.ownerOf ? LIVE.ownerOf(s) || '' : '';
  const firstKey = s => firstAgent(s) + '|' + s.id;
  function chanMedia(files, images = []) {
    const list = (Array.isArray(files) ? files : []).map(f => typeof f === 'string' ? { id: f, name: 'Photo', mime: 'image/*', kind: 'image', url: f } : f && typeof f === 'object' ? mediaOfFile(f) : null);
    return list.concat((Array.isArray(images) ? images : []).map((u, i) => ({ id: 'img' + i, name: 'Photo', mime: 'image/*', kind: 'image', url: u }))).filter(m => m && m.kind === 'image' && (m.url || m.thumb));
  }
  // null: nothing to keep yet (no history, unreadable). none: a thread the agent started, with no owner message.
  // voice: the owner's voice note whose transcript is not there yet.
  function firstOf(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    let turns; try { turns = toTurns(rows); } catch (_) { return null; }
    const ti = turns.findIndex(x => x.u && (x.u.text || x.u.files?.length || x.u.images?.length)), t = turns[ti];
    // The agent started it (wizard-agent-service issue 441: an alert, a reminder, a new chat it opened): the post is the
    // agent's own first message with its pictures, also once the owner has replied under it.
    const ai = turns.findIndex(x => !x.u && ((x.a && x.a.text) || x.media?.length)), a = turns[ai];
    const byAgent = () => {
      const said0 = a?.a ? String(a.a.plainText || a.a.text || '') : '', pics = (a?.media || []).filter(m => m && m.kind === 'image' && (m.url || m.thumb));
      return { text: '', media: [], none: true, ...(a && (said0.trim() || pics.length) ? { agent: { text: said0.slice(0, CHAN_TEXT_MAX), media: pics, at: Number(a.a?.at ?? a.mediaAt ?? a.at) || 0 } } : {}) };
    };
    if (t && a && ai < ti) return byAgent();
    if (!t) {
      // An owner message with nothing to show yet (empty, or a voice note before its words) is not an agent-started
      // thread. Internal user rows (display_kind: notes, steers, run context) that parseRows hides are not his.
      const body = r => r.content ?? r.text ?? '', said = r => { try { return typeof body(r) === 'string' ? body(r) : JSON.stringify(body(r)); } catch (_) { return ''; } };
      const own = rows.find(r => r && r.role === 'user' && !r.display_kind && !r.kind && (!said(r).trim() || /audio\//.test(said(r))));
      return own ? { text: '', media: [], wait: true, ...(/audio\//.test(said(own)) ? { voice: true } : {}) } : byAgent();
    }
    const files = t.u.files || [], typed = String(t.u.text || '').trim() ? String(t.u.text) : '';
    const heard = typed || String(files.find(f => f && typeof f.transcript === 'string' && f.transcript.trim())?.transcript || '');
    const voice = !heard && files.some(f => f && (f.kind === 'audio' || /^audio\//.test(f.mime || '')));
    return { text: heard.slice(0, CHAN_TEXT_MAX), media: chanMedia(files, t.u.images || []), at: t.u.at, ...(voice ? { voice: true } : {}) };
  }
  function firstPost(s) {
    if (typeof s.firstRequest === 'string' && (s.firstRequest.trim() || chanMedia(s.firstAttachments || []).length)) return { text: s.firstRequest, media: chanMedia(s.firstAttachments || []) };
    const k = firstKey(s);
    if (FIRST.has(k)) {
      const f = FIRST.get(k);
      // Read before the agent's first words were there: read again once the thread moves (its list revision changes).
      if (!(f.none && !f.agent && f.rev !== undefined && f.rev !== replyRev(s))) return f;
      FIRST.delete(k); firstAsked.delete(k); firstWant.set(k, { id: s.id, agent: firstAgent(s), rev: replyRev(s) }); return f;
    }
    const pend = firstPend.get(k), now = Date.now();
    if (!firstAsked.has(k) && !(now - (firstFailed.get(k) || 0) < CHAN_FIRST_RETRY) && !(pend && now - pend.at < pend.wait)) firstWant.set(k, { id: s.id, agent: firstAgent(s), rev: replyRev(s) });
    return null;
  }
  // Placeholders the list and outbox put where a message's words will be (live.js pendText, synthetic rows).
  const CHAN_STAND_IN = /^(?:🎙\s*Voice (?:note|reply)|📎\s*Attachment)$/u, CHAN_VOICE_IN = /^🎙/u;
  const chanSaid = v => { v = String(v || '').trim(); return v && !CHAN_STAND_IN.test(v) ? v : ''; };
  /* What a post says: the owner's own words (Agent Service firstRequest, the first-message read, the message sent from
   * the box), else the list's owner text meanwhile; once shown, those words stay through stale list refreshes. A voice
   * note with no words yet says "Voice note". The chat's title only for a thread the agent started itself. */
  function chanPostText(s, p) {
    const k = firstKey(s);
    if (p && p.text) SHOWN.set(k, p.text);
    else if (!SHOWN.has(k)) { const stand = chanSaid(s.request) || (s.previewRole === 'user' ? chanSaid(s.preview) : '') || chanSaid(s.pendText); if (stand) SHOWN.set(k, stand); }
    const text = SHOWN.get(k) || '';
    if (text) return { text };
    const voice = !!p?.voice || !!firstPend.get(k)?.voice || [s.request, s.previewRole === 'user' ? s.preview : '', s.pendText].some(v => CHAN_VOICE_IN.test(String(v || '').trim()));
    if (voice && !p?.media?.length) return { text: '', voice: true };
    return { text: p && !p.media.length && p.none ? String(s.title || '') : '' };
  }
  /* Reply counts (wizard-ux issue 1266): the agent replies James sees when he opens the thread, one per answer bubble
   * (a KIT.parseRows turn with an answer, or the files an agent sent), never Hermes' message_count, which also counts
   * tool calls, tool results, steps and status turns. The first-message read gives them when its page holds the whole
   * thread; a longer thread is read once in full (LIVE.threadRows). Kept per row (agent|id) with the list revision it
   * was read at; a thread that moved is read again once it stops working, showing the last count meanwhile. */
  const REPLIES = new Map(), replyWant = new Map(), replyAsked = new Set(), replyFailed = new Map(), CHAN_FIRST_PAGE = 50;
  const replyRev = s => [s.messageCount ?? '', s.lastAssistantAt || '', s.previewAt || ''].join('|');
  function replyAts(rows) {
    let t; try { t = toTurns(rows); } catch (_) { return null; }
    return t.filter(x => x.a ? !!(x.a.text || x.a.tweaks?.length || x.a.failed) : !!x.media?.length).map(x => Number(x.a?.at ?? x.mediaAt ?? x.at) || 0);
  }
  function chanReplies(s) {
    const k = firstKey(s), r = REPLIES.get(k), rev = replyRev(s);
    if (r && (r.rev === rev || isWorking(s))) return r;
    const known = FIRST.has(k) || typeof s.firstRequest === 'string'; // else the first-message read counts them too
    if (known && LIVE.threadRows && !replyAsked.has(k) && !(Date.now() - (replyFailed.get(k) || 0) < CHAN_FIRST_RETRY)) replyWant.set(k, { id: s.id, agent: firstAgent(s), rev });
    return r || null;
  }
  // The new ones among them: replies after the row's own read record (LIVE.readAt; 0 = never read, all new).
  const chanNewN = (s, r) => { if (!r) return 0; const t = LIVE.readAt ? LIVE.readAt(s) : 0; return r.ats.filter(a => a > t).length; };
  function pullFirst() {
    while (firstBusy < 3 && (firstWant.size || replyWant.size)) {
      const first = firstWant.size > 0, q = first ? firstWant : replyWant, asked = first ? firstAsked : replyAsked, failed = first ? firstFailed : replyFailed;
      const [k, { id, agent, rev }] = q.entries().next().value; q.delete(k);
      if (asked.has(k) || (first ? FIRST.has(k) : REPLIES.get(k)?.rev === rev)) continue;
      asked.add(k); firstBusy++;
      Promise.resolve().then(() => first ? LIVE.firstMessages(id, agent, CHAN_FIRST_PAGE) : LIVE.threadRows(id, agent)).then(rows => {
        const partial = !!rows?.truncated; rows = rows || [];
        if (first) {
          // Kept once it holds the owner's words (or proves the agent started the thread); else read again soon.
          const p = firstOf(rows), was = firstPend.get(k);
          if (p && !p.voice && !p.wait) { FIRST.set(k, p.none && !p.agent ? { ...p, rev } : p); firstPend.delete(k); }
          else { const wait = Math.min(CHAN_FIRST_RETRY, was ? was.wait * 2 : CHAN_FIRST_WAIT); firstPend.set(k, { at: Date.now(), wait, voice: !!p?.voice || !!was?.voice }); setTimeout(() => chanRepaint(), wait + 50); }
        }
        failed.delete(k);
        // A history cut short (LIVE.threadRows' page limit) gives no count rather than a wrong one. The first page is
        // the whole thread only when the service itself returned fewer rows than asked (pagination.returned, issue
        // 1269): its view=wizard page can hold fewer rows than it returned, and counting from it undercounted.
        if (!first || Number(rows.returned ?? rows.length) < CHAN_FIRST_PAGE) { const ats = partial ? null : replyAts(rows); REPLIES.set(k, ats ? { rev, ats } : { rev, ats: [], partial: true }); }
      }, () => failed.set(k, Date.now()))
        .finally(() => { asked.delete(k); firstBusy--; clearTimeout(firstT); firstT = setTimeout(() => chanRepaint(), 60); pullFirst(); });
    }
  }
  // A list held under the finger or pointer repaints once it is let go (tried again shortly, a few times).
  function chanRepaint(n = 0) {
    let held = false;
    for (const id of Object.keys(CH)) { const x = W[id]; if (!x || x.thread || !chanOpen(x)) continue; if (holdList(id)) held = true; else rerenderList(x); }
    if (held && n < 20) { clearTimeout(firstT); firstT = setTimeout(() => chanRepaint(n + 1), 400); }
  }
  /* Where a feed opens and stays (wizard-ux issue 1263; James, 10 Nov 2026: "it shouldn't auto scroll to the top ever").
   * Posts changed since the channel's watermark (issue 1316, chanChanged): it opens at the first of them in posting
   * order, under a "New" line, just below what was read; nothing changed: at the very bottom. A post whose reply was
   * never opened does not count (its "● New reply" words are passive). Chosen once per open
   * (o.chan.newKey/at), so the line never jumps away while James reads; the next open clears it. The place is held,
   * not set once: every paint and every growth of the feed (first messages, thumbnails, "more") puts it back, because
   * posts fill in late. Once James scrolls, the post at the top of his view is the place (the bottom when he is at the
   * end), so a repaint, a refresh or Back from a thread lands where he was. */
  const CHAN_NEW_Y = 8, CHAN_USER_MS = 1200, chanUserAt = {}, chanSetTop = {}, chanRO = {};
  const chanKey = s => rowAgent(s) + '|' + s.id;
  function chanStart(w, shown, open) {
    const c = (W[owner(w.id)] || w)?.chan; if (!c) return null;
    if (c.at === undefined && shown.length) { const mark = chanReadAt(chanReadKey(open, open.general ? chanGenAgent(w) : '')), u = shown.find(s => chanChanged(s, mark)); c.newKey = u ? chanKey(u) : ''; c.at = u ? { key: 'chan-new', y: CHAN_NEW_Y, bar: true } : { end: true }; }
    return c;
  }
  const chanScroller = wid => elOf(wid)?.querySelector?.('.ch-list > .ch-scroll') || null;
  function chanHold(wid) {
    const w = W[wid], at = w && (W[owner(wid)] || w)?.chan?.at, sc = chanScroller(wid), feed = sc?.querySelector('.ch-chan-feed');
    if (!feed) { chanRO[wid]?.ro.disconnect(); delete chanRO[wid]; return; }
    chanWatch(wid, sc, feed);
    if (!at || !sc.clientHeight) { paintFeedJump(wid, sc); return; }
    ch(wid).listPending = null; // the feed's own place outranks the list's return bookmark
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
    // The same key can be drawn twice (a main and a routed thread sharing an id): the place is the copy of its own row
    // (agent|id), wherever a re-sort moved it.
    const same = at.key ? [...feed.querySelectorAll('[data-morph-key]')].filter(n => n.dataset.morphKey === at.key) : [], node = (at.row && same.find(n => n.dataset.chrow === at.row)) || same[0];
    // The opening place (bar: true) sits below a sticky bar at the feed's top, if one is ever drawn (the Open · Needs you
    // · All row went in issue 1440); a place James scrolled to was measured from the scroller's own top, so it keeps that.
    const stuck = at.bar && node ? chanStuck(feed) : 0;
    const to = at.end || !node ? max : Math.max(0, Math.min(max, sc.scrollTop + node.getBoundingClientRect().top - sc.getBoundingClientRect().top - (at.y || 0) - stuck));
    if (Math.abs(sc.scrollTop - to) >= 1) sc.scrollTop = to;
    chanSetTop[wid] = sc.scrollTop; // the scroll event this fires is the hold's own, never James's
    // The whole feed in view at its end (a short channel, or the end is the place): read to its newest post (issue 1316).
    if (sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 4) chanReadFeed(wid, sc, feed);
    paintFeedJump(wid, sc);
  }
  /* Seeing a post is not reading it (wizard-ux issue 1269, which overrides issue 1266; James, 11 Nov 2026: "the green
   * dot gets dismissed when I go into that topic and I see that reply"). The feed, its scrolling and its end never
   * write seen: a post's green dot and its share of the channel's unread clear only when its chat opens, through the
   * per-chat seen record Activity uses (openChat → LIVE.markSeen). Scrolling moves only the channel's watermark
   * (chanReadFeed, issue 1316), never a post's seen record. */
  // The feed grows after a paint (first messages, pictures, "more"); each growth puts the place back.
  function chanWatch(wid, sc, feed) {
    const cur = chanRO[wid]; if (cur && cur.feed === feed && cur.sc === sc) return;
    cur?.ro.disconnect(); delete chanRO[wid];
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => chanHold(wid)); ro.observe(feed); ro.observe(sc);
    chanRO[wid] = { ro, feed, sc };
  }
  const chanStuck = feed => { const bar = feed.firstElementChild; return bar && !bar.dataset?.morphKey && globalThis.getComputedStyle?.(bar).position === 'sticky' ? bar.offsetHeight : 0; };
  // James's own touch, wheel, key or pointer on the feed: his scrolls from now (and a fling after it) move the place.
  const chanUser = wid => { if (wid) chanUserAt[wid] = Date.now(); };
  function chanScrolled(wid, sc) {
    const w = W[wid], c = w && (W[owner(wid)] || w)?.chan; if (!c || !(Date.now() - (chanUserAt[wid] || 0) < CHAN_USER_MS)) return;
    const feed = sc.querySelector('.ch-chan-feed'); if (!feed || !sc.clientHeight || Math.abs(sc.scrollTop - (chanSetTop[wid] ?? -9)) < 1) return;
    chanUserAt[wid] = Date.now();
    chanReadFeed(wid, sc, feed); // his scroll moves the channel's watermark forward (issue 1316)
    if (sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 4) { c.at = { end: true }; return; }
    // The top of his view is below the sticky filter bar.
    const edge = sc.getBoundingClientRect().top + chanStuck(feed), all = [...feed.querySelectorAll('[data-morph-key]')], i = all.findIndex(x => x.getBoundingClientRect().bottom > edge + 1);
    if (i < 0) return;
    const n = all[i], key = n.dataset.morphKey, twin = all.some(x => x !== n && x.dataset.morphKey === key);
    c.at = { key, y: n.getBoundingClientRect().top - sc.getBoundingClientRect().top, ...(twin && n.dataset.chrow ? { row: n.dataset.chrow } : {}) };
  }
  return { chanHold, chanKey, chanNewN, chanPostText, chanRepaint, chanReplies, chanScrolled, chanStart, chanUser, chanUserAt, FIRST, firstAgent, firstPost, firstWant, pullFirst, replyWant };
};
