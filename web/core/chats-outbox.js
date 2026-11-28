/* Wizard UX core: Chats › the durable outbox and reading a thread: every message is saved on the device before it is
 * sent, the transcript is matched against what is still waiting, and a thread's history is read, cached and retried.
 * Moved verbatim out of core/chats.js (wizard-ux issue 1665: split the giant front-end files, no behaviour change).
 * createChats (core/chats.js) calls this once, where the code used to be, with the closure names it reads, and keeps
 * the functions it returns under their old names. Loaded before chats.js by both shells. The body below keeps
 * chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.outbox = function ({ ch, CH, CHECK_SVG, elOf, esc, H, INC, isWorking, KIT, LIVE, loadApproval, md, MIC_SVG, needsLand, OUTBOX, PEND, reach, reachLabel, renderChatList, renderLive, renderThread, renderThreadLive, replyCard, rowOf, syncListTitle, toTurns, track, troubleshoot, userMedia, W }) {
  /* ---- durable outbox: every message is saved on the phone before it is sent ---- */
  /* New chat always opens blank (James, 20 Oct 2026: "New chat should always go to a brand new chat. It should
   * never go to some existing thread that's trying to get sent"). A new chat shows only the sends made from THIS
   * open of it: each fresh open stamps c.newAt, and an older unsent new-chat message stays in the Chats list's
   * send pill (with its Retry/Edit) instead of reappearing here. qa-new-chat-blank.cjs guards this. */
  function pendingFor(w) {
    if (!OUTBOX || !w.thread) return [];
    if (w.thread !== '__new__') return OUTBOX.forThread(w.thread, '');
    const c = ch(w.id); if (!c.newAt) c.newAt = Date.now(); // a restored window: everything older is not this chat's
    return OUTBOX.forThread('', w.id).filter(it => (it.createdAt || 0) >= c.newAt);
  }
  /* Has the transcript already got this outbox message? A sent one matches a recent user turn (or steer) by file or
   * by its opening words. One whose send was attempted but whose receipt was lost (attempts > 0) matches
   * the same file IDs, or the exact same words in a user turn made after it was written. A queued one that never left
   * the phone never matches: sending the same words twice on purpose keeps both (Codex P2 on #418). */
  function echoed(turns, p) {
    const us = turns.filter(t => t.u && !t.u.localId).map(t => t.u).concat(turns.flatMap(t => t.steers || []).filter(u => !u.localId));
    const files = (p.files || []).filter(f => f && f.id);
    const sameFiles = u => files.length && files.every(f => (u.files || []).some(x => x.id === f.id));
    // A steer the agent took in mid-run is not always a user row in the transcript: a context compaction during the
    // run folds it into its summary (James, 1 Nov 2026: the voice note sat below the reply that answered it). Once a
    // final answer newer than the send is on screen, an accepted steer has been read; queued steers still wait for
    // their own run and keep matching by words.
    if (p.state === 'sent' && p.steered && !p.steerQueued && isFinite(p.sentAt)
        && turns.some(t => t.a && t.a.final && !t.a.failed && isFinite(t.a.at) && t.a.at > p.sentAt + 10e3)) return true;
    if (p.state === 'sent') return us.some(u => sentMatch(u, p));
    if (!['queued', 'sending', 'waiting', 'unconfirmed'].includes(p.state) || !(p.attempts > 0) || p.steerRunId) return false;
    const t = String(typeof KIT !== 'undefined' && KIT.tapsOf ? KIT.tapsOf(p.text).text : p.text || '').trim(), after = u => isFinite(u.at) && u.at >= (p.createdAt || 0) - 10e3; // made after this message was written (10 s for clock skew)
    return us.some(u => after(u) && (files.length ? sameFiles(u) && (!t || String(u.text || '').trim().includes(t)) : !!t && String(u.text || '').trim() === t));
  }
  // A sent Retry of a saved request is that request again: Wizard's copy of it (Not sent, then Sending, then
  // Hermes' own row) is already on screen, so this device's copy never draws twice. Drawing only: a retry is retired
  // from the outbox (retireLanded) only once a transcript row really carries it (echoed), never on a guess.
  function retryShown(turns, p) {
    return p.state === 'sent' && !!p.retryRunId && turns.some(t => t.u?.queue && [p.retryRunId, p.runId].includes(t.u.queue.runId));
  }
  // Match stable receipt identity first; legacy history gets bounded, exact content
  // matching. A shared attachment or forty-character prefix is not message identity.
  function sentMatch(u, p) {
    if ((p.userMessageId && String(u.id || '') === String(p.userMessageId)) || (p.id && u.clientMessageId === p.id)) return true;
    if (p.runId && String(u.id || '') === `queue-${p.runId}`) return true; // Wizard's own copy of this run (not yet in Hermes)
    const at = p.sentAt || p.createdAt, began = p.createdAt || at;
    if (!isFinite(u.at) || !isFinite(at) || u.at < began - 10e3 || u.at > at + 120e3) return false;
    const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const text = norm(typeof KIT !== 'undefined' && KIT.tapsOf ? KIT.tapsOf(p.text).text : p.text), files = (p.files || []).filter(f => f?.id); // a tap message's history copy has no marker (issue 1889)
    const sameFiles = files.length && files.every(f => (u.files || []).some(x => x.id === f.id));
    return files.length ? !!sameFiles && (!text || norm(u.text) === text) : !!text && norm(u.text) === text;
  }
  // sent-message-reconcile: accepted local words belong on the timeline, never
  // beneath the answer as a permanent Sent/Dismiss row. Keep original outbox custody
  // until canonical history arrives; this display copy is never a delivery receipt.
  function localSent(turns, p) { return turns.some(t => t.u?.localId === p.id || t.steers?.some(u => u.localId === p.id)); }
  function reconcileSent(turns, pending, session) {
    const out = turns.slice(), start = t => t.at ?? t.later?.at ?? t.work?.[0]?.at ?? t.a?.at;
    for (const p of pending) {
      if (p.state !== 'sent' || p.steerQueued || (p.runId && (session?.reconnect?.runId === p.runId || session?.lastRunKey === `wizard-saved-retry-${p.runId}`)) || echoed(turns, { ...p, steered: false }) || retryShown(turns, p)) continue;
      const at = p.sentAt || p.createdAt;
      if (!isFinite(at) || (!p.text && !p.files?.length)) continue;
      // A Thread tracker quote rides with the local copy so its header shows at once (canonical history carries it as the marker).
      const quote = p.reply?.quote ? KIT.reply.clean(p.reply) : null;
      const u = { text: p.text || '', files: p.files || [], images: [], at, localId: p.id, ...(quote ? { reply: quote } : {}) };
      if (p.steered) {
        const target = out.findLastIndex(t => start(t) <= at + 10e3 && (!t.a || t.a.at >= at - 10e3));
        if (target >= 0) { out[target] = { ...out[target], steers: [...(out[target].steers || []), u] }; continue; }
      }
      const i = out.findIndex(t => !t.u && !t.note && !t.later?.context && isFinite(start(t))
        && ((start(t) >= (p.createdAt || at) - 10e3 && start(t) <= at + 120e3)
          || (isFinite(t.later?.after) && t.later.after < (p.createdAt || at) && start(t) >= at - 10e3)));
      if (i >= 0) { const { later, ...turn } = out[i]; out[i] = { ...turn, u, at }; }
      else {
        const index = out.findIndex(t => isFinite(start(t)) && start(t) > at);
        const turn = { u, a: null, notes: [], steps: 0, media: [], work: [], steers: [], at };
        out.splice(index < 0 ? out.length : index, 0, turn);
      }
    }
    return out;
  }
  function retireLanded(sid, turns) {
    let gone = false;
    if (OUTBOX && turns.length) for (const p of OUTBOX.forThread(sid)) if (p.state === 'sent' && echoed(turns, { ...p, steered: false })) { OUTBOX.landed(p.id); gone = true; }
    return gone;
  }
  function pendingState(p, s) {
    if (OUTBOX?.quarantined(p.id)) return '<span class="pst wait">Waiting for device storage verification · not sending</span>';
    const recover = H.recoverUnsent ? `<button type="button" class="pbtn" data-obrecover="${esc(p.id)}">Recover</button>` : '';
    if (p.state === 'unconfirmed') return `<span class="pst fail">${esc(p.error)}</span>${recover}`;
    if (p.state === 'empty') return `<span class="pst fail">No speech detected · recording kept</span><button type="button" class="pbtn" data-obretry="${esc(p.id)}">Retry transcription</button><button type="button" class="pbtn ghost" data-obdismiss="${esc(p.id)}">Dismiss</button>`;
    if (p.state === 'held' && p.lateHeld) return `<span class="pst">${esc(OUTBOX.lateLabel(p))}</span>${OUTBOX.canRetry(p) ? `<button type="button" class="pbtn" data-obretry="${esc(p.id)}">Send</button>` : recover}<button type="button" class="pbtn ghost" data-obdiscard="${esc(p.id)}">Discard</button>`;
    if (p.state === 'held') return `<span class="pst">Kept on this device · not queued</span>${recover}<button type="button" class="pbtn ghost" data-obdismiss="${esc(p.id)}">Dismiss</button>`;
    if (p.state === 'failed') return `<span class="pst fail">Not sent · ${esc(p.error || 'Wizard didn’t take it')}</span>${OUTBOX.canRetry(p) && !window.WosModels?.foreignApp?.(s) ? `<button type="button" class="pbtn" data-obretry="${esc(p.id)}">Retry</button>` : ''}${p.audio || p.audioFile || p.body ? recover : `<button type="button" class="pbtn ghost" data-obedit="${esc(p.id)}">Edit</button>`}<button type="button" class="pbtn ghost" data-obdismissfailed="${esc(p.id)}">Dismiss</button>`;
    if (p.state === 'waiting') return `<span class="pst wait">${esc(p.steerWaitSince ? (/^(Queued|Waiting) · /.test(p.error || '') ? p.error : 'Queued · sends when the current reply can take it') : reachLabel('send'))}</span><button type="button" class="pbtn" data-obretry="${esc(p.id)}">Retry now</button>${troubleshoot}`;
    const agent = esc(window.WizConfig.agent());
    if (p.state === 'sent') {
      // Admission is not delivery: keep the saved request held through its automatic resend.
      const held = p.runId && (s?.reconnect?.runId === p.runId
        || (s?.lastRunKey === `wizard-saved-retry-${p.runId}` && s.lastRunStatus !== 'completed'));
      if (held) {
        // Issue 1799: signed back in, the saved send waits for Retry (or its automatic resend), not for a sign-in.
        const live = s?.reconnect && (window.WosModels?.reconnect ? window.WosModels.reconnect(s) : s.reconnect);
        if (!live && ['failed', 'interrupted', 'cancelled'].includes(s?.lastRunStatus)) return '<span class="pst fail">Not sent · message saved</span>';
        return '<span class="pst wait">Waiting for sign-in</span>';
      }
      const label = p.steered ? `${CHECK_SVG}${p.steerQueued ? 'Added to the queued request' : `Delivered · ${agent} sees it next step`}` : 'Sent';
      return `<span class="pst ok">${label}</span><button type="button" class="pbtn ghost" data-obdismiss="${esc(p.id)}">Dismiss</button>`;
    }
    const upl = (p.files || []).filter(f => PEND?.isPending(f.id)).length;
    if (upl) return `<span class="pst">${upl === 1 ? 'Uploading attachment…' : `Uploading ${upl} attachments…`}</span>`;
    return `<span class="pst">${p.steerRunId && !p.attempts ? 'Steering…' : 'Sending…'}</span>`;
  }
  function pendingHtml(p, c, s) {
    const files = (p.files || []).filter(f => f !== p.audioFile);
    const voice = p.audio || p.audioFile ? `<div class="fchips"><span class="fchip">${MIC_SVG} Voice note${p.text || ['empty', 'held'].includes(p.state) ? '' : ' · words come when it sends'}</span></div>` : '';
    const words = p.text || p.typed || ''; // a voice note not yet transcribed shows the typed words riding with it
    // Reply-button taps on their way (wizard-ux issue 1889): the same quiet machine line as once they land.
    const RB = globalThis.WosActionCards?.tapLinesHtml ? globalThis.WosActionCards : null, taps = RB && p.text ? KIT.tapsOf?.(p.text)?.taps || [] : [];
    if (taps.length) return `<div class="msg u pending ${p.state} ch-taps-pending" data-ob="${esc(p.id)}"><div class="ch-renamed ch-taps" data-rb-taps>${RB.tapLinesHtml(taps)}</div><div class="pmeta">${pendingState(p, s)}</div></div>`;
    return `<div class="msg u pending ${p.state}${p.steered ? ' steer' : ''}${p.reply ? ' has-rq' : ''}" data-ob="${esc(p.id)}"><div class="bub">${replyCard(KIT.reply.clean(p.reply))}${voice}${userMedia(c || { media: [] }, files, [])}${words ? md(words) : ''}</div><div class="pmeta">${pendingState(p, s)}</div></div>`;
  }
  // A thread that is still on its way: this device has an unsent/unconfirmed message for it, or the list shows its
  // run queued, launching or running. Hermes answers 404 for its history until the first message is admitted.
  function threadAlive(w, sid) {
    if (pendingFor(w).length) return true;
    const s = rowOf(w.id, sid); // the routed window's own row, not a same-id main-agent row
    return !!s && (isWorking(s) || ['queued', 'launching', 'running'].includes(s.status));
  }
  // Failed thread reads retry by themselves: 1 s, 2 s, 4 s, 8 s, then every 15 s while the thread stays open.
  function retryRead(w, sid, nav, n) {
    const c = ch(w.id); clearTimeout(c.retryT);
    c.retryT = setTimeout(() => { if (CH[w.id] === c && W[w.id] === w && w.thread === sid && c.readNav === nav && c.loadedFor !== sid && !c.loading) loadThread(w, true); }, Math.min(15000, 1000 * 2 ** (n - 1)));
  }
  function threadErrHtml(c) {
    if (c.err !== 'Couldn’t load this thread') return `<div class="ch-empty">${esc(c.err)}</div>`;
    const r = c.errStatus ? null : reach();
    const why = c.errStatus ? `Wizard answered with an error (HTTP ${c.errStatus}).` : !r || ['checking', 'send'].includes(r.layer) ? 'The connection to Wizard dropped while reading it.' : r.message;
    return `<div class="ch-empty ch-readerr" role="status"><b>Couldn’t load this thread</b><br>${esc(why)} Retrying automatically.<br><button type="button" class="pbtn" data-chretry>Retry now</button>${r && !['checking', 'send'].includes(r.layer) ? ' ' + troubleshoot : ''}</div>`;
  }
  function renderChats(w) {
    if (INC?.render(w.id, elOf(w.id))) return;
    syncListTitle(w);
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (!el) return;

    if (w.thread) { renderThread(w, el); loadThread(w); } else renderChatList(w, el);
  }
  // Turns kept from an earlier open may only paint a new open when the live list says the thread still holds the
  // same messages; otherwise the previous reply showed until the read landed (James, 24 Oct 2026). Within one open
  // (this open's own read or cached paint) the turns on screen stay put while the next read runs, so polls never blank it.
  function turnsCurrent(c, s) {
    if (c.loadedNav === c.readNav || c.cachedNav === c.readNav || !s || !LIVE.contentKey) return true;
    return !!LIVE.listTrusted?.() && c.readCk === LIVE.contentKey(s);
  }
  async function loadThread(w, force) {
    if (INC?.active(w.id)) return;
    const c = ch(w.id), sid = w.thread, nav = c.readNav;
    if (!sid || sid === '__new__' || (c.loading && c.loading.sid === sid && c.loading.nav === nav)) return;
    if (c.goneFor === sid && c.goneNav === nav) { if (!threadAlive(w, sid)) return; c.goneFor = ''; } // answered 404 in this open: gone, not worth polling, unless a send for it has since appeared
    const s = LIVE.session(sid);
    // Cache finished history while its session revision is unchanged. Its existing session poll remains live;
    // any new message/activity/status immediately invalidates this cache, with a 60 s safety re-read.
    // Working, approvals, failed reads and pending send/steer receipts keep their existing cadence.
    const revision = s ? JSON.stringify([s.id, s.messageCount, s.status, s.runId, s.updatedAt, s.activityAt,
      s.lastUserAt, s.lastAssistantAt, s.previewAt, s.preview]) : '';
    // The Agent Service omits status for settled historical sessions. A local in-flight override is live.
    const quiet = s && (!s.status || ['completed', 'cancelled', 'failed', 'interrupted'].includes(s.status))
      && Number.isSafeInteger(s.messageCount) && !LIVE.busy(w.thread) && !c.err && !pendingFor(w).length;
    const age = isWorking(s) ? 3500 : quiet ? 60000 : 15000;
    const fresh = c.loadedFor === w.thread && Date.now() - c.at < age && c.readRevision === revision && turnsCurrent(c, s);
    // Status changes (Stopping…, Deferred, Archived) re-render the header even between message reads.
    const hk = s ? [s.status, !!s.archived, !!s.deferred, s.runId, s.backgroundResult?.id || '', s.backgroundResult?.reason || ''].join('|') : '';
    // Speed: a thread not yet read this page paints its last on-device copy at once (no skeleton);
    // the read below still runs and replaces it.
    // A stored copy also replaces turns from an earlier open that the list says are out of date (preload often has the newer one).
    if (!((c.loadedFor === sid || c.cachedFor === sid) && turnsCurrent(c, s)) && LIVE.cachedMessages) {
      const cached = LIVE.cachedMessages(sid);
      if (cached && cached.length) {
        try {
          // These turns now belong to sid alone. loadedFor named the previous thread's read; keeping it let Back to
          // that thread treat sid's cached body as its own fresh copy (James, 23 Oct 2026: Morning projects → linked
          // thread → Back showed the linked thread under the Morning header until the 60 s re-read). The server read
          // below still runs and sets loadedFor.
          Object.assign(c, { turns: toTurns(cached), cachedFor: sid, cachedNav: nav, loadedFor: '', err: '' });
          const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderLive(w, el);
        } catch (e) {}
      }
    }
    if (fresh && !force) {
      c.loadedNav = nav; // still current for this open: the reading place can trust it
      if (typeof needsLand === 'function') needsLand(w, nav); // issue 1331: a cached reopen lands on the Needs you message too
      // Reopening inside the cache window skips the read, so retire sends this transcript already shows here too.
      if (c.loadedFor === sid && retireLanded(sid, c.turns || [])) { const el = elOf(w.id); if (el) renderLive(w, el); }
      // Reopening a cached quiet transcript still refreshes rename/retry metadata,
      // once per navigation, without throwing away its 60-second history cache.
      if (s?.listVersion === 1 && c.detailNav !== nav && c.detailLoadingNav !== nav) {
        c.detailLoadingNav=nav;
        try {
          await LIVE.sessionInfo(sid);
          if (W[w.id] === w && w.thread === sid && c.readNav === nav) { c.detailNav=nav; const el=elOf(w.id); if(el) renderLive(w,el); }
        } catch (_) { /* retry itself fails closed until full detail can be fetched */ }
        finally { if(c.detailLoadingNav===nav) c.detailLoadingNav=null; }
      }
      if (c.loadedFor === w.thread && hk !== c.hk) { c.hk = hk; const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderLive(w, el); }
      return;
    }
    // Every read owns a captured thread AND navigation generation. A -> B -> A is a new read;
    // an old completion must neither publish into it nor release its loading lock.
    const read = { sid, nav }, readCk = LIVE.contentKey ? LIVE.contentKey(s) : ''; c.loading = read;
    // A host can dispose Chats before dropping its window record. A pending
    // transcript read must not paint (or retry) after forget(), even in that gap.
    const current = () => CH[w.id] === c && W[w.id] === w && w.thread === sid && c.readNav === nav && c.loading === read;
    try {
      const rows = await LIVE.messages(sid);
      if (!current()) return;
      const turns = toTurns(rows);
      const sig = JSON.stringify(turns.slice(-3));
      // A new open may be showing a skeleton because its old list revision was stale. Even identical
      // history must repaint that open so the one position restore can run on real rows.
      let changed = c.loadedFor !== w.thread || c.loadedNav !== nav || sig !== c.sig;
      if (globalThis.WosThreadTracker?.on()) { globalThis.WosThreadTracker.shown?.(sid, LIVE.agentOf ? LIVE.agentOf(sid) : '', turns); globalThis.WosThreadTracker.load(sid, LIVE.agentOf ? LIVE.agentOf(sid) : ''); } // the asks of this thread (read right after the history that carries them; its owner bubbles answer older asks)
      Object.assign(c, { turns, cachedFor: '', savedFor: '', loadedFor: w.thread, loadedNav: nav, readCk, at: Date.now(), err: '', sig, readRevision: revision, failN: 0, errStatus: 0 }); clearTimeout(c.retryT);
      // A sent message has landed once a recent user turn in the thread matches it.
      // Transcript absence is not a rejection receipt. Never replay accepted steering.
      if (retireLanded(w.thread, turns)) changed = true;
      // Current answers paint before optional detail and approval metadata.
      if (changed) { const el = elOf(w.id); if (el && current()) renderLive(w, el); }
      if (typeof needsLand === 'function' && current()) needsLand(w, nav); // issue 1331: land on the Needs you message
      changed = false;
      const detail = LIVE.session(sid)?.detailNeeded ? LIVE.sessionInfo(sid).then(() => {
        if (current()) { c.detailNav = nav; changed = true; }
      }).catch(() => {}) : Promise.resolve();
      if (await loadApproval(w, LIVE.session(sid))) changed = true;
      await detail;
      if (!current()) return;
      const s2 = LIVE.session(w.thread), hk2 = s2 ? [s2.status, !!s2.archived, !!s2.deferred, s2.runId, s2.backgroundResult?.id || '', s2.backgroundResult?.reason || ''].join('|') : '';
      if (hk2 !== c.hk) { c.hk = hk2; changed = true; }
      if (changed) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && current()) renderLive(w, el); }
    } catch (e) {
      if (current()) {
        // A failed read is a moment, not a verdict (James, 21 Oct 2026: a 130-message thread showed a bare
        // "Couldn’t load this thread" after one dropped read). Retry on our own with a short backoff, name the
        // broken link in plain words, and give a Retry now tap. Sign-in (403) still needs the owner.
        c.failN = (c.failFor === sid ? c.failN || 0 : 0) + 1; c.failFor = sid; c.errStatus = e.status || 0;
        // A 404 is a verdict, not a blip: the thread is gone (deleted, or a window restored from an earlier install
        // on the same address). Say so once and stop; retrying a missing thread forever reads as a broken Wizard.
        // ...unless the thread is brand new: Hermes has no history for it until its first message is admitted, so a
        // 404 while a send is pending (or the list already shows it queued/running) is "not yet", not "gone" (James, 7 Nov 2026).
        const early = e.status === 404 && threadAlive(w, sid), gone = e.status === 404 && !early;
        // A gone thread drops any cached or earlier-loaded transcript, so the "no longer here" message renders
        // instead of a stale, still-editable copy of a deleted thread.
        if (gone) { Object.assign(c, { goneFor: sid, goneNav: nav, turns: null, loadedFor: '', cachedFor: '' }); LIVE.forgetMessages?.(sid); }
        // No answer at all (offline): paint this device's saved copy, labelled, instead of an empty error. Turns already
        // on screen from an earlier read stay, but now carry the same label, so they never pass for a fresh copy.
        else if (!e.status && (c.loadedFor === sid || c.cachedFor === sid) && c.turns) { if (c.savedFor !== sid || c.savedNav !== nav) Object.assign(c, { savedFor: sid, savedNav: nav, savedAt: c.at || 0 }); }
        else if (!e.status) {
          const saved = LIVE.savedMessages?.(sid);
          if (saved?.rows?.length) try { Object.assign(c, { turns: toTurns(saved.rows), cachedFor: sid, cachedNav: nav, loadedFor: '', savedFor: sid, savedNav: nav, savedAt: saved.at }); } catch (_) {}
        }
        c.err = early ? '' : e.status === 403 ? 'Wizard sign-in needed' : gone ? 'This thread is no longer here. It may have been deleted, or it came from an earlier install. Go back to Chats to start a new one.' : 'Couldn’t load this thread'; c.at = Date.now();
        if (e.status !== 403 && !gone) { if (!e.status) window.WizReach?.failure(); retryRead(w, sid, nav, early ? Math.min(c.failN, 3) : c.failN); }
        renderThreadLive(w);
      }
    }
    finally { if (c.loading === read) c.loading = false; }
  }
  return { echoed, loadThread, localSent, pendingFor, pendingHtml, reconcileSent, renderChats, retryShown, threadAlive, threadErrHtml, turnsCurrent };
};
