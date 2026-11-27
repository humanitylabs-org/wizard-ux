/* Wizard UX core: Chats › Mark done and Needs you: the post and row menu's Mark done, the one "waiting on the owner"
 * rule with Channels on, Needs you in the thread and Jump to Needs you. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the functions it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.done = function ({ attOf, ch, CH, CHAN_PREFS_KEY, chanSeenPaint, chanStore, chanStorePrefs, elOf, esc, isWorking, LIVE, owner, paintListsNow, renderThreadNow, rowOf, scrollBox, threadOnScreen, threadViewportTop, toast, vib, W }) {
  let chanUser, PW; // late-bound: chats.js declares these after the call, see bindLate
  /* Mark done (wizard-ux issue 1317, part of the Channels switch since issue 1358): the post and row menu clears a thread's
   * amber Needs you and green New reply in the feed, Activity and the Channels list, through the synced seen record
   * (LIVE.markHandled). It never archives or moves the thread; a later reply brings the markers back. An approval
   * gate is not a marker: it stays until it is answered. */
  const MARK_DONE_SVG = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const handledNow = s => !!s && !!LIVE.handled?.(s);
  // Offered while there is a marker to clear: not handled through its newest reply yet, or marked unread again since.
  const canMarkDone = s => !!s && !!LIVE.markHandled && !isWorking(s) && !s.archived && (!handledNow(s) || !!LIVE.isNew?.(s));
  // inThread: the thread's own Mark done beside its Needs you line, also while the agent works on a plain owner message.
  function markDone(wid, sid, inThread = false) {
    const s = (wid && W[owner(wid)] ? rowOf(owner(wid), sid) : null) || LIVE.session(sid);
    if (!(inThread ? !!needsAsk(s) && !!LIVE.markHandled : canMarkDone(s))) return false;
    vib(8);
    // The row the window shows (a routed post can share its id with a main thread), as openChat's markSeen does.
    void LIVE.markHandled(s);
    paintListsNow(); chanSeenPaint(); needsRepaint(wid, sid, s);
    toast('✓', 'Cleared', 1400);
    return true;
  }
  /* The one "waiting on the owner" rule with Channels on (wizard-ux issue 1360): Ready membership, the Activity row's
   * amber marker, the channel line and the feed post all read it. A status line of needs_you or check ("Your call":
   * the owner's judgment is the missing piece) waits on him until Mark done, Reply to it, or a newer status line;
   * opening the thread never clears it (only green, unread, clears on open). */
  // Smart inbox (wizard-ux issues 1883, 1928): a check waits for catch me up, so it is not Needs you (no amber dot, not
  // Inbox); only a blocker (needs_you, an approval, unknown) is. Switch off: check counts as before.
  const chanNeeds = s => !isWorking(s) && !s.archived && (['waiting_for_approval', 'unknown'].includes(s.status) || attOf(s)?.state === 'needs_you' || (attOf(s)?.state === 'check' && !(() => { try { return !!window.WizChatsListModel?.smartInboxOn?.(document.documentElement.dataset.tweaks); } catch (_) { return false; } })()));
  /* Needs you in the thread (wizard-ux issue 1331, part of the Channels switch since issue 1358). The agent's
   * reply whose status line said needs_you gets the feed's amber Needs you line right above its bubble, with the ask
   * and Mark done beside it. One marker state for every surface: attOf (the row's status line; Mark done's handled
   * mark clears it). It clears on Mark done, on Reply to that message, or when the agent's next status line no longer
   * lists the ask; a plain owner message never clears it. Channels also give Mark done (the menus), Reply on any
   * message in the main agent's threads, and retires the Thread tracker strip and dots (thread-tracker.js on()). */
  const needsAsk = s => { if (!s || s.archived || s.status === 'waiting_for_approval') return null; const a = attOf(s); return ['needs_you', 'check'].includes(a?.state) ? a : null; }; // the one rule above (issue 1360)
  // Reply on any message (the quote above the composer) is standard for the main agent's threads with this switch.
  const replyStd = agent => (!agent || agent === 'hermes');
  function needsLineHtml(s) {
    const a = needsAsk(s); if (!a) return '';
    // A saved-result Needs you with its own reason panel (wizard-agent-service issue 469) is not drawn twice.
    if (s.backgroundResult) return '';
    return `<div class="ch-needs-line" data-needs-line role="status"><span class="ch-post-st needs"><i class="ch-chan-dot" aria-hidden="true"></i>${a.state === 'check' ? 'Your call' : 'Needs you'}</span><span class="ch-needs-ask">${esc(a.ask)}</span>${LIVE.markHandled ? `<button type="button" class="ch-needs-done" data-chmarkdone>${MARK_DONE_SVG}Mark done</button>` : ''}</div>`;
  }
  // Which reply carries the line: the agent's newest reply in the thread (its status line is the row's attention).
  // Remembered per window so Reply on that message (needsReplied) and the opening place (needsLand) find it.
  function needsMark(wid, sid, s, turns) {
    const c = ch(wid), html = sid && sid !== '__new__' ? needsLineHtml(s) : '';
    const k = html ? turns.map(tn => !!tn.a && isFinite(tn.a.at)).lastIndexOf(true) : -1;
    if (k >= 0) { c.needsFor = sid; c.needsAt = turns[k].a.at; } else if (c.needsFor === sid) { c.needsFor = ''; c.needsAt = NaN; }
    return { k, html: k >= 0 ? html : '' };
  }
  // Reply on the needs-you message (3a): handled through the reply it shows, once the owner's message is saved.
  function needsReplied(wid, sid, reply) {
    const c = ch(wid), q = reply?.quote;
    if (!q || q.role !== 'assistant' || !sid || c.needsFor !== sid || !(Math.abs((+q.at || 0) - c.needsAt) < 1500)) return false;
    const s = rowOf(owner(wid), sid) || LIVE.session(sid); if (!needsAsk(s) || !LIVE.markHandled) return false;
    void LIVE.markHandled(s); paintListsNow(); chanSeenPaint(); needsRepaint(wid, sid, s);
    return true;
  }
  // The open thread repaints on the tap's frame too (AI review of 1331: the line and Mark done stayed until a reopen).
  // Only windows showing that same row: a routed thread sharing the id with a main one keeps its own state (Codex P2).
  function needsRepaint(wid, sid, s) {
    for (const id of Object.keys(CH)) { const x = W[id]; if (x && x.thread === sid && (id === wid || rowOf(owner(id), sid) === s)) renderThreadNow(x); }
  }
  // Opening a thread with an open Needs you lands on that message (once per open), its amber line at the top.
  function needsLand(w, nav) {
    const c = ch(w.id); if (c.needsLandNav === nav) return;
    c.needsLandNav = nav;
    const find = () => c.readNav === nav && c.needsFor === w.thread ? elOf(w.id)?.querySelector('.ch-msgs [data-needs-line]') : null;
    // Lands just under the thread's header, not under it (AI review of 1331: on a phone the document scrolls and the
    // fixed header hid the line; on desktop it clipped the ask). A few frames re-check it while the layout settles.
    const place = line => {
      const nb = line.closest('.ch-msgs'), sc = nb ? scrollBox(nb) : null, head = line.closest('.ch-thread')?.querySelector('.ch-head');
      if (!sc || typeof sc.scrollTo !== 'function') { line.scrollIntoView({ block: 'start' }); return 0; }
      const base = Math.max(sc === nb ? nb.getBoundingClientRect().top : 0, head ? head.getBoundingClientRect().bottom : 0);
      const off = line.getBoundingClientRect().top - threadViewportTop(nb, base) - 8;
      if (Math.abs(off) > 1) sc.scrollTo({ top: sc.scrollTop + off, behavior: 'auto' });
      if (typeof PW !== 'undefined') PW?.landAt?.(w.id, line); // the line is now the reading place: the opening restore keeps it (second AI review)
      return off;
    };
    const settle = (line, n) => { if (n > 0 && line.isConnected && find() === line && Math.abs(place(line)) > 1) requestAnimationFrame(() => settle(line, n - 1)); };
    const go = n => { const line = find();
      if (line) { place(line); requestAnimationFrame(() => settle(line, 6)); } else if (n > 0) requestAnimationFrame(() => go(n - 1)); };
    requestAnimationFrame(() => go(4));
  }
  /* Jump to Needs you (wizard-ux issue 1359, part of the Channels switch): the Thread tracker's dropdown is gone, so a
   * thread shows one pill at the top centre while an open Needs you (amber) or a reply that was unread when the thread
   * opened (green) sits above what the owner sees, and a matching pill at the bottom for ones below (unless ↓ Latest
   * already points at it). One tap scrolls to the closest one, amber first. Green counts only until it has been on
   * screen; amber stays until Mark done (which repaints the thread, so the pill follows on the same frame). */
  // Before openChat marks the thread read: replies newer than the read record are this open's green ones.
  function jumpOpened(wid, sid, r) {
    const c = ch(wid); c.jumpFor = sid; c.jumpSeen = new Set(); c.jumpSince = NaN; c.jumpTo = null;
    if (!sid || sid === '__new__') return;
    const s = r && typeof r === 'object' ? r : LIVE.session(sid);
    if (!s || !LIVE.isNew?.(s)) return;
    // No read record yet (a thread made after the synced seen state began): every reply is unread (Codex P2).
    const rec = LIVE.seenRecord?.(s), a = Date.parse(rec?.assistantActivityAt ?? '');
    c.jumpSince = !rec ? -Infinity : isFinite(a) ? a : isFinite(rec.seenAt) ? +rec.seenAt : NaN;
  }
  const jumpPillsHtml = () => '<button type="button" class="ch-jump up" data-chjump="up" hidden></button><button type="button" class="ch-jump down" data-chjump="down" hidden></button>';
  // The thread's visible band: under its header (the phone's document scroll has a fixed header and composer).
  // Issue 1440: a channel's feed (its list scroller, .ch-scroll) uses the same pills; its band is the scroller itself.
  const jumpFeed = nb => !!nb?.classList?.contains('ch-scroll');
  function jumpBand(nb) {
    if (jumpFeed(nb)) { const r = nb.getBoundingClientRect(); return { sc: nb, top: r.top, bottom: r.bottom }; }
    const sc = scrollBox(nb), doc = sc !== nb, th = nb.closest('.ch-thread'), head = th?.querySelector('.ch-head');
    const top = threadViewportTop(nb, Math.max(doc ? 0 : nb.getBoundingClientRect().top, head ? head.getBoundingClientRect().bottom : 0));
    let bottom = doc ? (window.visualViewport?.height || window.innerHeight) : nb.getBoundingClientRect().bottom;
    const comp = doc ? th?.querySelector('.ch-compose') : null, cr = comp?.getBoundingClientRect();
    if (cr && cr.height) bottom = Math.min(bottom, cr.top);
    return { sc, top, bottom };
  }
  // Every marker in the open thread, split into above / below the band. Green replies seen on screen drop out.
  function jumpMarks(wid, nb, band) {
    const c = ch(wid), w = W[wid], out = { up: [], down: [] }, now = Date.now(); c.jumpSeen = c.jumpSeen || new Set();
    const skip = c.jumpTo && now < c.jumpTo.until ? c.jumpTo.n : null, live = !jumpFeed(nb) && threadOnScreen(nb);
    const add = (n, kind, key) => {
      const r = n.getBoundingClientRect(); if (!r.height) return;
      if (n === skip) { if (r.bottom > band.top + 1 && r.top < band.bottom - 1) c.jumpTo = null; else return; } // reached: counts normally again
      if (r.bottom <= band.top + 1) out.up.push({ n, kind, y: r.top });
      else if (r.top >= band.bottom - 1) out.down.push({ n, kind, y: r.top });
      else if (key && live) c.jumpSeen.add(key);
    };
    // A feed counts posts, never messages: each marked post once (amber over green), on screen = not counted.
    if (jumpFeed(nb)) { nb.querySelectorAll('.ch-post[data-chmark]').forEach(n => add(n, n.dataset.chmark === 'needs' ? 'needs' : 'new')); return out; }
    nb.querySelectorAll('[data-needs-line]').forEach(n => add(n, 'needs'));
    if (w && c.jumpFor === w.thread && !Number.isNaN(c.jumpSince ?? NaN)) {
      nb.querySelectorAll('.msg.a[data-morph-key^="a"]').forEach(n => {
        const key = n.dataset.morphKey, at = +key.slice(1);
        // the message under an amber line counts once, as amber
        if (at > c.jumpSince && !c.jumpSeen.has(key) && !n.previousElementSibling?.matches?.('[data-needs-line]')) add(n, 'new', key);
      });
    }
    return out;
  }
  // amber first, then the nearest one in that direction
  function jumpTarget(list, dir) {
    const pick = list.filter(m => m.kind === 'needs').length ? list.filter(m => m.kind === 'needs') : list;
    return pick.reduce((b, m) => !b || (dir === 'up' ? m.y > b.y : m.y < b.y) ? m : b, null);
  }
  function jumpLabel(dir, list) {
    const nn = list.filter(m => m.kind === 'needs').length, ng = list.length - nn;
    return `<span class="ch-jump-arr" aria-hidden="true">${dir === 'up' ? '↑' : '↓'}</span>${nn ? `<span class="ch-jump-k"><i class="ch-chan-dot" aria-hidden="true"></i>${nn} Needs you</span>` : ''}${ng ? `<span class="ch-jump-k"><i class="ch-chan-dot new" aria-hidden="true"></i>${ng} New</span>` : ''}`;
  }
  function paintJump(el, nb) {
    liftLatest(el);
    const wid = el?.dataset.chats, up = el?.querySelector('[data-chjump="up"]'), dn = el?.querySelector('[data-chjump="down"]');
    const feed = jumpFeed(nb);
    if (!wid || !nb || (!up && !dn) || !(feed ? nb.isConnected && nb.clientHeight > 0 : threadOnScreen(nb))) return;
    const band = jumpBand(nb), m = jumpMarks(wid, nb, band);
    // ↓ Latest already covers a marker that its jump to the end would bring on screen.
    const latest = el.querySelector('[data-chlatest]'), sc = band.sc;
    const end = (sc === nb ? nb.getBoundingClientRect().top : 0) - sc.scrollTop + sc.scrollHeight;
    const covered = latest && !latest.hidden && m.down.every(x => end - x.y <= band.bottom - band.top);
    const set = (b, dir, list) => {
      if (!b) return;
      const show = !!list.length && !(dir === 'down' && covered), html = show ? jumpLabel(dir, list) : '';
      if (b.dataset.sig !== html || (html && !b.firstChild)) { b.innerHTML = html; b.dataset.sig = html; }
      if (b.hidden === show) b.hidden = !show; // shown first: a hidden pill has no offsetParent to place it by (issue 1440)
      if (show) {
        const n = list.filter(x => x.kind === 'needs').length, g = list.length - n;
        b.setAttribute('aria-label', `Jump ${dir} to ${[n ? `${n} Needs you` : '', g ? `${g} new ${g === 1 ? 'reply' : 'replies'}` : ''].filter(Boolean).join(' and ')}`);
        // the top pill sits just under the header (fixed on the phone's document scroll, else inside the thread)
        if (dir === 'up') { const p = b.offsetParent; b.style.top = `${Math.round(band.top + 8 - (p ? p.getBoundingClientRect().top : 0))}px`; }
      }
      // a feed's ↓ pill sits just above its message box (the scroller's bottom edge)
      if (dir === 'down' && feed) { const p = b.offsetParent; b.style.bottom = show && p ? `${Math.round(p.getBoundingClientRect().bottom - band.bottom + 12)}px` : ''; }
      else if (dir === 'down') jumpStack(b, show && latest && !latest.hidden ? latest : null);
    };
    set(up, 'up', m.up); set(dn, 'down', m.down);
  }
  // Issue 1380: the thread's own Mark done · Snooze · Archive buttons, on screen (both bottom controls keep off them).
  const actBoxes = el => [...(el?.querySelectorAll('.ch-tacts > button') || [])].map(n => n.getBoundingClientRect()).filter(r => r.width && r.height);
  const meets = (r, o, g) => !(r.left >= o.right + g || r.right <= o.left - g || r.bottom <= o.top - g || r.top >= o.bottom + g);
  // ↓ Latest in the AI apps column sits in the thread's flow just above the composer, over the sticky action row's band:
  // when it would cover one of those buttons it rises above the row (--ch-latest-lift, read by the layout's own rule).
  function liftLatest(el) {
    const l = el?.querySelector('[data-chlatest]'); if (!l) return;
    if (l.style.getPropertyValue('--ch-latest-lift')) l.style.removeProperty('--ch-latest-lift');
    if (l.hidden) return;
    const r = l.getBoundingClientRect(), hit = actBoxes(el).filter(o => meets(r, o, 0));
    if (r.height && hit.length) l.style.setProperty('--ch-latest-lift', `${Math.ceil(r.bottom - Math.min(...actBoxes(el).map(o => o.top)) + 8)}px`);
  }
  // Issue 1380: the ↓ pill never sits on ↓ Latest (a narrow column, or the phone's shared bottom row) or on the thread's
  // action row (Mark done beside a wide column's centre): it goes above whichever it would touch.
  function jumpStack(b, latest) {
    if (b.style.bottom) b.style.bottom = '';
    if (b.hidden) return;
    const keep = [...(latest ? [latest.getBoundingClientRect()] : []), ...actBoxes(b.closest('[data-chats]') || b.parentElement)].filter(o => o.width && o.height);
    for (let i = 0; i < 4; i++) {
      const r = b.getBoundingClientRect(), o = r.height && keep.find(x => meets(r, x, latest && x === keep[0] ? 8 : 4));
      if (!o) return;
      b.style.bottom = `${Math.round((parseFloat(getComputedStyle(b).bottom) || 0) + r.bottom - o.top + 8)}px`;
    }
  }
  // Issue 1380: with markers left above, the ↑ pill comes back at the top: land the target just under it, not behind it.
  function jumpLandGap(nb, m, t) {
    const above = [...m.up, ...m.down].some(x => x.n !== t.n && x.y < t.y) || [...nb.querySelectorAll('[data-needs-line], .ch-post[data-chmark="needs"]')].some(n => n !== t.n && n.getBoundingClientRect().top < t.y);
    if (!above) return 8;
    const up = nb.parentElement?.querySelector('[data-chjump="up"]'), h = up && !up.hidden ? up.getBoundingClientRect().height : 0;
    return 8 + (h || 32) + 8;
  }
  function jumpGo(wid, dir) {
    const el = elOf(wid), sc = !W[wid]?.thread ? el?.querySelector('.ch-list > .ch-scroll') : null, feed = !!sc?.querySelector(':scope > .ch-chan-feed');
    const nb = feed ? sc : el?.querySelector('.ch-msgs'); if (!nb) return false;
    const band = jumpBand(nb), m = jumpMarks(wid, nb, band), t = jumpTarget(m[dir === 'down' ? 'down' : 'up'], dir);
    if (!t) { paintJump(el, nb); return false; }
    vib(6);
    const c = ch(wid), gap = jumpLandGap(nb, m, t), off = t.n.getBoundingClientRect().top - band.top - gap;
    if (t.kind === 'new' && !feed) c.jumpSeen?.add(t.n.dataset.morphKey);
    // A feed holds its place (chanHold): the post landed on becomes it, and the scroll counts as the owner's own.
    if (feed) { const o = (W[owner(wid)] || W[wid])?.chan; if (o) o.at = { key: t.n.dataset.morphKey, y: gap, ...(t.n.dataset.chrow ? { row: t.n.dataset.chrow } : {}) }; chanUser(wid); }
    c.jumpTo = { n: t.n, until: Date.now() + 1500 }; // the pill counts it as reached on the tap's frame
    paintJump(el, nb);
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof band.sc.scrollTo === 'function') band.sc.scrollTo({ top: band.sc.scrollTop + off, behavior: smooth ? 'smooth' : 'auto' });
    else t.n.scrollIntoView({ block: 'start' });
    return true;
  }
  // The open channel feed's pills follow every paint, place hold and scroll of the feed (issue 1440).
  function paintFeedJump(wid, sc) { if (sc?.querySelector?.(':scope > .ch-chan-feed')) paintJump(elOf(wid), sc); }
  function chanPrefs() {
    const st = typeof chanStore === 'function' ? chanStore() : null;
    if (st) return chanStorePrefs(st);
    let v = null; try { v = JSON.parse(localStorage.getItem(CHAN_PREFS_KEY) || 'null'); } catch (_) {}
    v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const arch = v.archived && typeof v.archived === 'object' && !Array.isArray(v.archived) ? v.archived : {};
    return { sort: v.sort === 'za' ? 'za' : 'az', pins: Array.isArray(v.pins) ? [...new Set(v.pins.filter(x => typeof x === 'string'))] : [], archived: Object.fromEntries(Object.entries(arch).filter(([, t]) => typeof t === 'string')) };
  }
  const chanArchived = id => !!chanPrefs().archived[id];
  function setChanPrefs(p) { try { localStorage.setItem(CHAN_PREFS_KEY, JSON.stringify(p)); } catch (_) {} }
  return { canMarkDone, chanArchived, chanNeeds, chanPrefs, handledNow, jumpGo, jumpOpened, jumpPillsHtml, MARK_DONE_SVG, markDone, needsAsk, needsLand, needsMark, needsReplied, paintFeedJump, paintJump, replyStd, setChanPrefs, bindLate: v => { if ('chanUser' in v) chanUser = v.chanUser; if ('PW' in v) PW = v.PW; } };
};
