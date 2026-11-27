/* Wizard UX core: Chats › sending: Stop on a thread, Send and go, and one send carrying the whole composer (typed
 * words, voice, pictures and files; sealed while a voice send is on its way). Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.send = function ({ AGS, applyLayout, ch, chanDraftKey, chanOwnPost, closeHosted, dailyTarget, deskOf, elOf, focusOf, growTa, H, hosted, INC, isWorking, keepThreadOpen, KIT, LIVE, needsReplied, openChat, openHosted, OUTBOX, PEND, pendRef, refreshCompose, refreshReply, renderChats, renderThreadNow, save, setDraft, spaceMember, syncSend, threadBack, toast, viewContext, W, winAgent }) {
  let PW; // late-bound: chats.js declares these after the call, see bindLate
  /* Opt-in Send and go steps back one level on the phone: linked parent, otherwise the list. Desktop keeps its thread
   * pane. The pinned send target is independent of this navigation; later callbacks cannot pop the parent.
   * Return an owned recovery receipt so a failed local save can restore the composer without stealing a
   * newer navigation (including an A → B → A round trip). */
  const PHONE = () => (document.documentElement.dataset.shell || 'phone') !== 'desktop';
  /* Stop on a thread (Miguel, 28 Oct 2026: Stop must work the moment he sends). The live run stops through LIVE.stop
   * as before; sends not yet admitted are withdrawn so nothing more reaches the agent. Their typed words and files go
   * back into the composer they came from; a recording stays kept under Unsent. */
  // The Stop button answers on the tap itself (issue 1576): greyed, labelled Stopping…, until the row repaints as Stopping….
  function stopTapped(b) { b.disabled = true; b.classList.add('is-stopping'); b.setAttribute('aria-label', 'Stopping…'); b.title = 'Stopping…'; }
  function stopPendingSend(w, sid, runId) {
    toast('■', 'Stopping…', 1400);
    LIVE.cancelSend(sid, runId).then(async r => {
      if (r.outcome === 'busy') return;
      let words = false, kept = false;
      for (const it of r.items || []) {
        if (it.audio || it.audioFile) { kept = true; continue; } // the recording stays kept (Unsent); never deleted here
        const files = (it.files || []).map(fileRef);
        if (String(it.text || '').trim() || files.length || it.reply) { restoreInto(W[w.id] ? w.id : '', it.kind === 'new' ? '__new__' : it.sessionId, it.text || '', files, it.reply || null); words = true; }
        await OUTBOX.remove(it.id).catch(() => {});
      }
      // A new chat that never started has no thread to stay in: back to the New chat draft with the words.
      if (r.outcome === 'cancelled' && W[w.id] && w.thread === sid && r.items.some(it => it.kind === 'new')) openChat(w.id, '__new__');
      if (r.outcome === 'none') { toast('!', 'Nothing to stop', 2000); return; }
      const what = kept ? ' · recording kept in Unsent' : words ? ' · your words are back' : '';
      if (r.outcome === 'cancelled') toast('■', 'Stopped before sending' + what, 2800);
      else if (what) toast('■', 'Stopped · unsent message withdrawn' + what, 2800);
    }).catch(() => toast('!', 'Couldn’t stop · try again', 2600)).finally(() => { if (W[w.id]) renderThreadNow(w); });
  }
  // Issue 669: the Smart inbox switch is on and the box says typed tasks may run in the background.
  const TYPED_QUIET_SWITCH = 'wizard/smart-inbox';
  function typedQuietOn() {
    try { if (!(document.documentElement.dataset.tweaks || '').split(/\s+/).includes(TYPED_QUIET_SWITCH)) return false; } catch (_) { return false; }
    return LIVE.sentLog?.state?.()?.typed?.on === true;
  }
  // Would this send leave its thread by itself (Send and go, a new chat on the desktop)? No navigation happens here.
  function leaveAfterSendWould(wid, sid, isNew) {
    if (keepThreadOpen() && (!isNew || PHONE() || H.keepNewOpen?.(wid))) return false;
    const w = W[wid];
    return !!w && !!sid && w.thread === sid && (isNew || PHONE() || !!H.leaveOnSend?.(wid));
  }
  // `force` (issue 669): a typed task the box may run in the background leaves its thread like Send and go.
  function leaveAfterSend(wid, sid, isNew, how = '', force = false) {
    // A new chat docked beside an app (AI apps: Resolve this / a reply from a notification) stays in its column.
    if (!force && keepThreadOpen() && (!isNew || PHONE() || H.keepNewOpen?.(wid))) return false;
    const w = W[wid];
    if (w && sid && w.thread === sid && hosted.has(wid)) {
      const entry = hosted.get(wid); closeHosted(wid);
      const nav = ch(wid).readNav;
      return { restore() { if (W[wid] === w && ch(wid).readNav === nav && !hosted.has(wid) && entry.frame.isConnected) openHosted(wid, entry.frame, sid); } };
    }
    if (!w || !sid || w.thread !== sid || !(isNew || PHONE() || H.leaveOnSend?.(wid))) return false; // a host's docked list (desktop Orb) leaves like the phone
    const c = ch(wid), trail = [...(c.trail || [])];
    if (!isNew && trail.length) threadBack(w);
    else { c.readNav = (c.readNav || 0) + 1; c.trail = []; w.thread = null; save(); c.loadedFor = ''; c.draftFor = ''; }
    const destination = w.thread, nav = c.readNav;
    // No toast: the sending thread's existing Working/send indicator owns progress.
    return { restore() {
      if (W[wid] !== w || w.thread !== destination || c.readNav !== nav) return;
      c.trail = trail; openChat(wid, sid, { keepTrail: true });
    } };
  }
  /* One send carries the whole composer (legacy Wizard H4, `composeVoiceTurnText`; James, 10 Oct 2026: "when I
   * paste a link in the text box and I send you a voice note … they should both be sent together. The images and
   * the text and the voice note should all be sent together"). At the voice send tap, the composer of the thread
   * the take goes into is TAKEN: its typed or pasted words and its photos and files leave the composer and ride
   * with the recording as one message (words first, then the transcript). Until the outbox has the message, the
   * taken words wait under a hidden 'sealed:<thread>' draft key, so a reload or crash puts them back in the composer
   * (restoreSealed, at start). done(): the outbox has it. putBack(): the take was dropped or could not be saved. */
  const composerKey = sid => sid === '__new__' ? 'new' : 'direct:' + sid;
  // A new chat started from a channel's feed (its mic, the orb in front of it) takes that channel's box.
  const chanBoxOf = (wid, sid) => sid === '__new__' && W[wid] && !W[wid].thread && typeof chanDraftKey === 'function' ? chanDraftKey(W[wid]) : '';
  // box: the channel box a voice take was pinned to when it started ('' = none; undefined = whatever is in front now).
  // A take started in channel A takes A's box even if the window shows channel B by Send.
  const boxKey = (wid, sid, box) => (typeof box === 'string' ? box : chanBoxOf(wid, sid)) || composerKey(sid);
  const SEALED = 'sealed:';
  const fileRef = f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes });
  // What a thread's composer holds right now (the window's textarea while it shows that thread, else the draft).
  function peekComposer(wid, sid, box) {
    if (INC?.active(wid)) return { text: '', files: [] };
    const cur = chanBoxOf(wid, sid), pinned = typeof box === 'string';
    const w = W[wid], here = !!w && !!sid && (pinned ? (box ? box === cur : !cur && w.thread === sid) : (w.thread === sid || !!cur)), c = w ? ch(wid) : null;
    const ta = here ? elOf(wid)?.querySelector('.ch-compose textarea') : null;
    const saved = sid ? KIT.drafts.get(boxKey(wid, sid, box)) : { text: '', files: [] };
    return { here, ta, c, text: String(here ? (ta ? ta.value : c.draft || '') : saved.text), all: here ? (c.files || []) : saved.files, reply: saved.reply };
  }
  // A photo or file in that composer is still uploading: the voice send waits for it, like a typed send.
  const composerBusy = (wid, sid) => peekComposer(wid, sid).all.some(f => f && f.uploading);
  function restoreInto(wid, sid, text, files, reply, box) {
    // A placeholder for a file that was still uploading goes back as its receipt once that upload settles
    // (dropped if it failed or this page no longer holds it).
    const waits = (files || []).filter(f => PEND?.isPending(f?.id));
    if (waits.length) {
      Promise.all(waits.map(f => PEND.rowOf(f.id)?.upDone?.then(r => r, () => null) || null)).then(got => {
        const done = files.map(f => { const i = waits.indexOf(f); return i < 0 ? f : got[i]?.id ? fileRef(got[i]) : null; }).filter(Boolean);
        restoreInto(wid, sid, text, done, reply, box);
      });
      return;
    }
    const now = peekComposer(wid, sid, box);
    const back = { text: [String(text || '').trim(), now.text.trim()].filter(Boolean).join('\n'), files: [...files, ...now.all.filter(f => !files.some(x => x.id === f.id))] };
    if (reply && !now.reply) KIT.drafts.setReply(boxKey(wid, sid, box), reply);
    if (now.here) { setDraft(wid, back.text, back.files); if (now.ta && chanBoxOf(wid, sid)) now.ta.value = back.text; renderChats(W[wid]); } else KIT.drafts.set(boxKey(wid, sid, box), back.text, back.files);
  }
  const NO_SEAL = { text: '', files: [], done() {}, putBack() {} };
  function takeComposer(wid, sid, box) {
    if (INC?.active(wid)) return NO_SEAL;
    if (!sid) return NO_SEAL;
    const P = peekComposer(wid, sid, box), dkey = boxKey(wid, sid, box);
    // A file still uploading is taken too (a pending placeholder): the message never waits for it.
    const taken = P.all.map(f => [f, pendRef(f)]).filter(([, r]) => r && r.id);
    const text = P.text.trim(), files = taken.map(([, r]) => r), reply = P.reply || null;
    if (!text && !files.length && !reply) return NO_SEAL;
    const rest = P.all.filter(f => f && !taken.some(([x]) => x === f)); // only a row with nothing to send stays
    if (P.here) {
      P.c.draft = ''; P.c.files = rest;
      if (P.ta) { P.ta.value = ''; growTa(P.ta); syncSend(P.ta.form, P.c); }
      refreshCompose(wid);
    }
    KIT.drafts.set(dkey, '', rest);
    if (reply) { KIT.drafts.setReply(dkey, null); if (P.here) refreshReply(wid); }
    // A channel box's seal names the box itself ('sealed:chan:<agent>:<id>:…'), so a reload puts the words back there.
    const skey = SEALED + (dkey.startsWith('chan:') ? dkey : sid) + ':' + crypto.randomUUID().replaceAll('-', '');
    KIT.drafts.set(skey, text, files);
    if (reply) KIT.drafts.setReply(skey, reply);
    let open = true;
    return { text, files, reply, key: skey,
      done(it) { if (it && !it.durable) return; if (open) { open = false; KIT.drafts.clear(skey); } },
      putBack() { if (!open) return; open = false; KIT.drafts.clear(skey); restoreInto(wid, sid, text, files, reply, dkey.startsWith('chan:') ? dkey : box); } };
  }
  // At start: words taken by a voice send that never reached the outbox (the page died mid-send) go back.
  const startupSeals = new Set(Object.keys(KIT.drafts.all()).filter(k => k.startsWith(SEALED)));
  function restoreSealed() {
    if (!OUTBOX?.recoveryComplete) return;
    for (const k of Object.keys(KIT.drafts.all())) {
      if (!startupSeals.has(k)) continue;
      startupSeals.delete(k);
      const d = KIT.drafts.get(k), sid = k.slice(SEALED.length).replace(/:[a-z0-9]+$/, '');
      KIT.drafts.clear(k); if (sid && !OUTBOX.ownsSeal(k)) { if (sid.startsWith('chan:')) restoreInto('', '__new__', d.text, d.files, d.reply, sid); else restoreInto('', sid, d.text, d.files, d.reply); }
    }
  }
  // Typed words first, then what was said (legacy order: the pasted link is the context the voice talks about).
  const joinWords = (typed, said) => [String(typed || '').trim(), String(said || '').trim()].filter(Boolean).join('\n\n');
  /* opts.sid pins the destination ('__new__' = a new thread) to where James was when he sent. Voice sends
   * reach here seconds after the tap (transcription, routing); by then the window may show another thread,
   * and a new-chat message must never land in it as a reply. opts.files: files riding with a voice send.
   * opts.seal (voice sends): the thread's composer taken at the send tap (takeComposer), sent with it; true
   * takes it now; false sends nothing from the composer (the later parts of an interrupted take). */
  async function sendChat(wid, text, how = 'typing in the Chats window', audio = null, opts = {}) {
    if (INC?.active(wid)) { if (audio || opts.files?.length || opts.seal) { toast('!', 'Incognito is text only', 2200); return null; } return INC.send(wid, text); }
    const w = W[wid]; text = String(text || '').trim();
    if (!w) { if (opts.seal && opts.seal !== true) opts.seal.putBack(); return; }
    const c = ch(wid);
    // The Daily view sends to today's thread (issue 1469): the box names it, and the view moves there first.
    const daySid = w.daily && !opts.sid && !opts.away && typeof dailyTarget === 'function' ? await dailyTarget(w) : '';
    const sid = opts.sid || daySid || w.thread; if (!sid) { if (opts.seal && opts.seal !== true) opts.seal.putBack(); return; }
    const here = !opts.away && w.thread === sid; // the window still shows the thread this was sent from (opts.away: sent from elsewhere, e.g. a review desk)
    const voice = 'seal' in opts; // a voice send: the composer goes only as taken at the tap, never the live tray
    const sealed = opts.seal === true ? takeComposer(wid, sid) : opts.seal || null;
    const tray = here && !voice ? (c.files || []) : [];
    // Files still uploading go too, as placeholders the outbox fills in before delivery (never a "wait" gate).
    const files = [...(opts.files || []), ...(sealed ? sealed.files : []), ...tray.map(pendRef)].filter(f => f && f.id && !f.uploading).filter((f, i, a) => a.findIndex(x => x.id === f.id) === i);
    // A recording not yet transcribed carries the typed words beside it (the outbox puts them before the
    // transcript); anything already in words is joined now.
    let typed = sealed ? sealed.text : '';
    const later = !!audio && !text;
    text = later ? '' : joinWords(typed, text);
    // Unified Chats: a private chat continuing a standard thread carries that thread's recent turns, quoted and
    // labelled, after the first message (once). Only this window's own new chat takes it.
    const carryText = sid === '__new__' && here && c.carry?.text ? c.carry.text : '';
    if (carryText) { if (later) typed = joinWords(typed, carryText); else if (text || files.length) text = `${text}\n\n${carryText}`.trim(); }
    if (!text && !files.length && !audio) { sealed?.putBack(); return; }
    const isNew = sid === '__new__';
    // opts.space: the Space a send from elsewhere files into (a channel's box, wizard-ux issue 1258).
    const spaceKey = isNew && typeof opts.space === 'string' ? opts.space : isNew && !opts.away && focusOf(w)?.kind === 'space' ? focusOf(w).key : '';
    // A Notifications Reply: the item rides with the message (framed at delivery), never in his words.
    const rdkey = isNew ? (winAgent(w) ? 'agentnew:' + winAgent(w) : 'new') : 'direct:' + sid;
    const reply = voice ? (sealed?.reply || null) : here ? KIT.drafts.get(rdkey).reply : null;
    const s = isNew || Object.hasOwn(opts, 'agent') ? null : LIVE.session(sid);
    const steerRunId = isWorking(s) && s.runId ? s.runId : '';
    const nm = opts.route || (isNew && !opts.away && PW ? PW.newModel(c) : null); // a model picked for this new chat (#11)
    // A new chat goes to the agent its model belongs to: the window's agent, or a Private pick in the main Chats.
    // A take pinned to a channel (opts.space) brings the route it was sent on: its agent is that route's own ('' = the
    // main agent), never the agent this window shows by the time it is saved (wizard-ux issue 1312).
    const chanPinned = isNew && typeof opts.space === 'string' && !!opts.route;
    const AGID = Object.hasOwn(opts, 'agent') ? opts.agent : chanPinned ? (opts.route.agent || '') : isNew ? (opts.route?.agent || winAgent(w) || (nm?.agent && AGS()?.isOther(nm.agent) ? nm.agent : '')) : '';
    const winAG = isNew ? winAgent(w) : '';
    const dkey = isNew ? (winAG ? 'agentnew:' + winAG : 'new') : 'direct:' + sid;
    if (here && !voice) { KIT.drafts.clear(dkey); c.draft = ''; c.files = []; }
    if (here) PW?.follow(wid, true, sid);
    const chanPost = isNew && typeof opts.space === 'string'; // a channel's post: its box keeps its own pick (issue 1309)
    if (nm && !chanPost) c.newModel = null;
    const carried = carryText ? c.carry : null;
    if (carried) c.carry = null;
    // Send and go: on the phone a reply steps back one level; a new thread
    // returns to the list, without waiting on delivery. Keyed on the pinned thread: a thread
    // James opened since stays open.
    // It happens on the tap itself, BEFORE the outbox save is awaited (James, 10 Oct 2026: "it should immediately
    // send me back to the message list… there's a second or two delay"). Leaving after `await OUTBOX.enqueue`
    // tied the screen to the phone's IndexedDB commit plus every outbox listener's re-render: ~80 ms on a desktop
    // Chrome, 1-2 s in the phone's WebView. The reply's thread is held under Working from the same frame
    // (live.js holdSend, the orb's path) until its outbox item takes over. qa-send-leave-timing.cjs guards this.
    const instructions = opts.instructions || (opts.away ? '' : viewContext(wid, how));
    // Hold before navigation can paint a list (also covers desktop / hosted replies).
    const hold = !isNew ? LIVE.holdSend?.(sid) || null : null;
    const trackerSeen = !isNew && here && !opts.away ? globalThis.WosThreadTracker?.beforeSend?.(sid, Object.hasOwn(opts, 'agent') ? opts.agent : LIVE.agentOf?.(sid) || '', Date.now(), { defer: true }) : null;
    const navAtSend = c.readNav;
    // Typed messages can go quiet too (wizard-agent-service issue 669, switch wizard/smart-inbox, off by default): a typed
    // new chat to the main agent asks the box first, and only while the box says its typed guess has proved right (sent
    // log typed_routing.on). It leaves the thread at once like Send and go; the box runs a plain task in the background
    // like an orb dump ("Got it", Sent › Working). A reply phrase, a question or anything unclear is today's visible
    // thread, opened again once it exists when he would have stayed on it. Files, a picked model, another agent, a
    // channel post, a send from elsewhere or a Reply never ask.
    const typedDump = isNew && here && !opts.away && !voice && !audio && !files.length && !reply && !carryText && !spaceKey && !chanPost
      && (!nm || nm.isDefault === true) && (!AGID || AGID === 'hermes') && typedQuietOn();
    const stayAfter = typedDump && !leaveAfterSendWould(wid, sid, isNew, how);
    const left = opts.away ? false : leaveAfterSend(wid, sid, isNew, how, typedDump);
    if (left) { renderChats(W[wid]); applyLayout(deskOf(wid)); }
    // Saved on the phone; the outbox delivers it (and retries) from here.
    let it;
    try {
      it = await OUTBOX.enqueue({ captureId: opts.captureId, custodyId: opts.custodyId, sealKey: sealed?.key, kind: isNew ? 'new' : 'reply', sessionId: isNew ? '' : sid, steerRunId, text, audio, typed: later ? typed : '',
        instructions, files: files.map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes })), ...(reply ? { reply } : {}), wid: here ? wid : '', how, source: 'chat', space: false, ...(nm ? { model: nm.model, provider: nm.provider } : {}), ...(AGID ? { agent: AGID } : {}),
        ...(typedDump ? { dump: true, typedDump: true } : {}) });
      trackerSeen?.commit(); // synchronize Seen only once the message/steer has durable custody
      if (!isNew && reply && typeof needsReplied === 'function') needsReplied(wid, sid, reply); // Reply on the Needs you message clears it (issue 1331)
    } catch (e) {
      trackerSeen?.cancel(); // a failed save must put the green rows back with the draft
      // Not saved anywhere: the words (and files) go back into that thread's composer, and James back into the
      // thread if the window is still on the list he was sent to.
      if (hold) LIVE.releaseSend?.(hold);
      if (nm && !chanPost) c.newModel = nm;
      if (carried) c.carry = carried;
      if (sealed) sealed.putBack(); else if (here && !voice) { KIT.drafts.set(dkey, text, tray); if (reply) KIT.drafts.setReply(dkey, reply); }
      if (left) left.restore();
      // Stayed on the thread (phone "Stay on the chat", desktop): the cleared composer shows the words again now,
      // unless the window has moved on since the tap.
      else if (here && !voice && !sealed && W[wid] === w && c.readNav === navAtSend && w.thread === sid) { setDraft(wid, text, tray); renderChats(w); }
      if (audio) throw e; // a recording: its caller keeps its own copy and reports it, as before
      toast('!', 'Couldn’t save that message · your words are back in the thread', 3200);
      return null;
    }
    // The durable outbox allocates the final thread id before dispatch; retain that
    // membership even if delivery retries or this window navigates away.
    if (spaceKey && it?.sessionId) spaceMember(spaceKey, it.sessionId, true, it.agent ?? AGID ?? '');
    // A post into a channel from elsewhere (a voice key, the orb): that channel's feed brings it into view.
    if (isNew && typeof opts.space === 'string' && it?.sessionId && typeof chanOwnPost === 'function') chanOwnPost(opts.space, it.agent ?? AGID ?? '');
    // Issue 669: he would have stayed on this chat. If the box keeps it visible, open it once it is a thread (the list
    // is where he is now, unless he moved on); a background answer leaves him on the list with "Got it".
    if (stayAfter && left && it?.sessionId) {
      const nav = c.readNav, mine = x => x?.id === it.id;
      let offNew = null, offDump = null;
      const done = () => { offNew?.(); offDump?.(); };
      offNew = OUTBOX.onNew?.(x => { if (!mine(x)) return; done(); if (W[wid] === w && !w.thread && c.readNav === nav) openChat(wid, it.sessionId); }) || null;
      offDump = OUTBOX.onDump?.(x => { if (mine(x)) done(); }) || null;
    }
    // Follow only this New chat's allocated id, never a different chat opened during the disk save.
    if (isNew && !left && !opts.away && it?.sessionId && W[wid] === w && w.thread === sid && c.readNav === navAtSend) openChat(wid, it.sessionId);
    sealed?.done(it);
    if (!left) { renderChats(W[wid]); applyLayout(deskOf(wid)); }
    window.WosSkinHost?.emit?.('sent', { thread: sid, wid, isNew, reply: reply?.key || '' });
    return it;
  }
  const picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
  picker.setAttribute('data-chfile', '');
  document.body.appendChild(picker);
  return { composerBusy, fileRef, joinWords, leaveAfterSend, PHONE, picker, restoreSealed, sendChat, stopPendingSend, stopTapped, takeComposer, bindLate: v => { if ('PW' in v) PW = v.PW; } };
};
