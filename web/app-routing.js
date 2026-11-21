/* Wizard UX phone shell › where a take goes: review mode, the view in front, commands and new requests. Moved out of app.js
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
window.WizCore.appParts.routing = function ({ $, APP, appAt, appByName, APPS, appVars, CHATS, clearDesk, clip, closeSheets, closeWin, device, esc, findApp, finishVoice, focusWin, goDesk, HOME, hostedOpenable, isPill, LIVE, loadThread, mainChats, moveWin, openApp, openSearch, openSettings, openSheet, OUTBOX, quickSearch, refreshHome, renderDots, renderMoons, searchUrl, sendChat, sendSnap, setFull, setVoice, startVoice, takeFiles, toast, tourEv, tx, txHide, txPill, txShow, V, vib, winEl, withSealFiles }) {
  function viewContext(id, how = 'voice', snap = null) {
    if(snap?.meetingEventId)return ''; // explicit request only: no recording title, notes, transcript or screen
    const S = snap || sendSnap(id), v = S.view, others = S.others;
    const z = v?.z ? ` at ${v.z.level} level${v.z.day ? ` (${v.z.day})` : v.z.week ? ` (week of ${v.z.week})` : ''}` : '';
    return [
      `[WizardOS context] ${window.WizConfig.owner() || 'The user'} sent this by ${how} from Wizard UX on their phone.`,
      v ? `Window in front: ${v.name} (${v.kind}${v.url ? `, ${v.url}` : ''})${z}.` : `They were on desk ${S.desk + 1} with no window open.`,
      S.screen ? `Visible on screen: ${S.screen}` : '',
      others.length ? `Also open on this desk: ${others.join(', ')}.` : '',
      'When they say "this", "here", or "it", they likely mean that window. Use this as background only.',
    ].filter(Boolean).join(' ');
  }
  // Review mode: what James says about the page goes to the thread that linked it, sent through a Chats window.
  function reviewSink(v) {
    const src = appVars.W[appVars.W[v.id]?.from?.win]; if (src && src.app === 'chats') return src.id;
    return Object.keys(appVars.W).find(k => mainChats(appVars.W[k])) || '';
  }
  function reviewContext(v) {
    return [`[WizardOS context] ${window.WizConfig.owner() || 'The user'} sent this by voice from Wizard UX on their phone while reviewing a page this thread linked.`,
      `Page under review: ${v.name.replace(/^Review of /, '')} (${v.url}).`,
      (s => s ? `Visible on screen: ${s}` : '')(window.WizScreen?.read(winEl(v.id)) || ''),
      'Treat the message as feedback on that page; "this", "here" and "it" mean that page.'].filter(Boolean).join(' ');
  }
  async function sendReview(v, text, audio, files = [], route = null, custodyId = null) {
    try { route ||= window.WosModels.snapshot(v.thread); }
    catch (e) {
      const it = custodyId ? OUTBOX.get(custodyId) : await OUTBOX.stage({ kind: 'reply', sessionId: v.thread, text, audio, files });
      if (it) await OUTBOX.transition(it.id, 'held', 'Feedback route unavailable · original kept');
      setVoice('idle'); toast('!', 'Feedback kept for its original thread · model route unavailable', 3200);
      return it || { outcome: 'retained' };
    }
    window.__ovLog = (window.__ovLog || []).concat('review-send:' + v.thread).slice(-30);
    return window.WosBoundView.feedback(OUTBOX, { thread: v.thread, url: v.url, route, custodyId, context: reviewContext(v) }, text, audio, files);
  }
  // A take started in front of a channel is filed into that channel, wherever James is by Send.
  const pinSpace = v => typeof v?.space === 'string' && v.thread === '__new__' ? { space: v.space } : {};
  function deliverToView(v, text, snap) {
    if (v.review) return sendReview(v, text, snap?.audio || null, [], snap?.route, snap?.custodyId);
    const w = appVars.W[v.id]; if (!w) return false;
    // The thread that was open when James sent, even if the window shows another one by now.
    if ((w.app === 'chats' || v.kind === 'chat thread') && (v.thread || w.thread)) { return sendChat(v.id, text, 'voice, aimed at this thread', snap?.audio || null, { custodyId: snap?.custodyId, sid: v.thread || w.thread, route: snap?.route, seal: snap?.seal || false, ...pinSpace(v), instructions: viewContext(v.id, 'voice, aimed at this thread', snap) }); }
    // No unacknowledged postMessage delivery to arbitrary/self-asserted frames.
    return false;
  }

  /* ---------------- routing ---------------- */
  /* On the Chats list, only a held orb can filter and search it:
   *   clear filter | all chats | show everything      → chips off
   *   filter [by] X | only X | show [me] [only] X [only] → chip X (status or subject), else search X
   *   search [for] X | find X                          → search text
   * A held orb with any other words on the list keeps doing what it always did (open apps, etc.). */
  const LOCAL_COMMANDS = window.WosCommands.create({ CHATS, APP, appByName, findApp, quickSearch, sendSnap });
  const localParse = (text, snap, kind, typed = false) => LOCAL_COMMANDS.parse(text, snap, kind, typed);
  async function handleText(text, kind, typed, sttMs, target, snap) {
    const sttNote = sttMs ? ` · heard in ${sttMs} ms` : '';
    snap = snap || sendSnap();
    if (snap.general) return toAgent(text, 'To ' + snapAgentName(snap), { snap, files: typed ? [] : takeFiles() });
    if (snap.conversation && kind !== 'command' && target == null) {
      const it = await OUTBOX.sendConversation({ conversation: snap.conversation, text, audio: snap.audio || null, files: typed ? [] : takeFiles(), source: 'orb' });
      setVoice('idle'); txHide();
      toast(it.state === 'sent' ? '✦' : '!', it.state === 'sent' ? 'Sent to ' + snap.conversation.label : it.error, 5000);
      return it;
    }
    // Quick take (under QUICK_MS): try it as a command first (on-device grammar, then the router off-thread).
    // No match: it continues below as an ordinary tap take, so nothing short is ever lost.
    if (kind === 'quick') {
      const qo = target == null ? { snap } : { desk: target, snap };
      const loc = localParse(text, snap, 'command');
      if (loc) { snap.quickRan = true; showRouted('command', `Quick command · on-device${sttNote}`); return finishCmd(loc, text, qo); }
      if (window.WosTour?.isHelp(text) && snap.view?.kind !== 'chat thread') { snap.quickRan = true; setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
      const routeUrl = snap.view?.kind !== 'chat thread' && window.WizConfig.endpoint('route');
      // A take marked as a possible background task (wizard/agent-inbox, issue 1588) asks for it in this one call.
      const dumpAsk = OUTBOX.get?.(snap.custodyId)?.dump === true;
      if (routeUrl) try {
        setVoice('think'); if (isPill()) tx.dataset.detail = 'Quick command? · routing'; else $('#txRouteText').textContent = 'Quick command? · routing';
        const r = await fetch(routeUrl, { method: 'POST', signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, force: '', view: null, apps: APPS.filter(a => a.kind !== 'view').map(a => a.name), ...(dumpAsk ? { accept_dump: true } : {}) }) });
        const j = await r.json(); const c = r.ok && j.cmd || {};
        if (dumpAsk && r.ok) snap.dumpAsked = true; // answered: the outbox never asks again
        if (dumpAsk && c.route === 'dump' && c.record_id) { setVoice('idle'); txHide(0); gotIt(c.title); return { outcome: 'local' }; }
        if (c.route === 'command' && !c.then_agent) { snap.quickRan = true; showRouted('command', `Quick command · ${j.ms} ms${sttNote}`); return finishCmd(c, text, qo); }
      } catch (_) {}
      kind = 'auto';
    }
    // A bare "help" is not special in a tapped voice message.
    if (!window.WosCommands.isMessageTake(kind, typed) && window.WosTour?.isHelp(text) && (kind === 'command' || snap.view?.kind !== 'chat thread')) { setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
    const opts = target == null ? { snap } : { desk: target, snap };
    $('#txText').textContent = text;
    const v = snap.view;
    /* Agents MVP: in an agent's Chats, a tap utterance goes to that agent (its open thread, else a new chat with
     * it), never to the main agent and never through the cloud router. A held orb is still a phone command, but
     * only on-device commands run; anything else offers the choices and sends nothing. */
    if (v?.agent && target == null) {
      if (kind === 'command' && !typed) { const lc = await LOCAL_COMMANDS.confirm(localParse(text, snap, kind), text, snap, kind); if (lc) { showRouted('command', `Command · on-device${sttNote}`); return finishCmd(lc, text, opts); } return holdNoMatch(text, opts); }
      const files = typed ? [] : takeFiles(), seal = typed ? null : snap.seal || null;
      setVoice('idle'); txPill('✦', `To ${v.agentLabel}${v.thread && v.thread !== '__new__' ? ' · this thread' : ' · new chat'}${sttNote}`, 'agent'); txHide(1400);
      return sendChat(v.id, text, `voice, in ${v.agentLabel}’s chats`, snap.audio || null, { custodyId: snap.custodyId, sid: v.thread || '__new__', route: snap.route, files, seal: seal || false, ...pinSpace(v), instructions: viewContext(v.id, `voice, in ${v.agentLabel}’s chats`, snap) });
    }
    // Attached files mean "look at this": skip command routing and send words + files together. So do words,
    // photos or files waiting in the thread's composer (snap.seal): one message, never a command.
    const files = typed ? [] : takeFiles();
    const seal = typed ? null : snap.seal || null;
    if (files.length || seal) {
      const nf = files.length + (seal ? seal.files.length : 0);
      const with_ = [seal?.text.trim() ? 'your text' : '', nf ? (nf === 1 ? '1 file' : `${nf} files`) : '', seal?.reply ? 'the notification' : ''].filter(Boolean).join(' + ');
      if (target == null && v?.review) { setVoice('idle'); txPill('✦', 'Feedback waiting to send with ' + (files.length === 1 ? '1 file' : `${files.length} files`), 'agent'); txHide(1400); return sendReview(v, text, snap.audio || null, files, snap.route, snap.custodyId); }
      if (target == null && v?.kind === 'chat thread' && appVars.W[v.id]) { setVoice('idle'); txPill('✦', 'Waiting to send with ' + with_, 'agent'); txHide(1400); return sendChat(v.id, text, 'voice, aimed at this thread', snap.audio || null, { custodyId: snap.custodyId, sid: v.thread, route: snap.route, files, seal: seal || false, ...pinSpace(v), instructions: viewContext(v.id, 'voice, aimed at this thread', snap) }); }
      const all = withSealFiles(files, seal);
      return toAgent(CHATS.joinWords(seal?.text, text), `To ${window.WizConfig.agent()} · with ${with_}` + sttNote, { ...opts, files: all, reply: seal?.reply || null }).then(item => { seal?.done(item); return item; });
    }
    // Registered app delivery and composer custody above are not commands. All other tap takes
    // use the normal message destination, without local parsing, cloud routing or no-match cards.
    if (window.WosCommands.isMessageTake(kind, typed)) {
      // A tapped take whose first word is a declared app route ("music") opens that app, outside threads, before
      // anything goes to the agent (James, 7 Nov: a tapped "Music" became a new chat instead of song ID).
      if (target == null && !(v?.kind === 'chat thread' || v?.review || v?.mode === 'capture')) {
        // Paint now; act only once the box's fresh app list confirms the route (else it is a message as usual).
        if (LOCAL_COMMANDS.declaredRoute?.(text)) {
          showRouted('command', `Command · on-device${sttNote}`);
          const dr = await LOCAL_COMMANDS.confirmRoute(text);
          if (dr) return finishCmd(dr, text, opts);
        }
      }
      if (target == null && (v?.kind === 'chat thread' || v?.review || v?.mode === 'capture')) return toView(v, text, `To ${v.name}${sttNote}`, snap);
      return toAgent(text, `To ${window.WizConfig.agent()}${sttNote}`, opts);
    }
    const t0 = performance.now();
    const loc = await LOCAL_COMMANDS.confirm(localParse(text, snap, kind, typed), text, snap, kind, typed);
    if (loc) {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      showRouted('command', `Command · on-device · ${ms} ms${sttNote}`);
      return finishCmd(loc, text, opts);
    }
    // A held take with no on-device match still asks the router (force: 'command'); only a non-command
    // answer falls back to the no-match choice card, so nothing is ever sent without a tap.
    // A capturing view takes a tap utterance as-is.
    if (kind !== 'command' && v?.mode === 'capture' && target == null) return toView(v, text, `To ${v.name}${sttNote}`, snap);
    // An open thread owns what James says: unless it is a phone command (or aimed at another desk), it goes
    // into that thread (steering the live run), never a new thread. New threads start from the list or New chat.
    const intoThread = kind !== 'command' && target == null && (v?.kind === 'chat thread' || v?.review);
    // A held orb is a command for the interface, never a message (James, 10 Oct 2026: "the long press is me
    // saying I want to issue a command that I want the interface to respond to"). When nothing matches, it
    // offers the choices and sends nothing until one is tapped. On a review desk a tap sends feedback to the
    // thread the link came from.
    const toAgentOrThread = label => kind === 'command' && !typed ? holdNoMatch(text, opts)
      : intoThread ? toView(v, text, v.review ? `To “${clip(v.threadTitle || 'the thread', 30)}” · feedback${sttNote}` : `To this thread${sttNote}`, snap) : toAgent(text, label, opts);
    setVoice('think'); if (isPill()) tx.dataset.detail = 'Routing · DeepSeek Flash'; else $('#txRouteText').textContent = 'Routing · DeepSeek Flash';
    try {
      const view = v && v.mode && kind !== 'command' && target == null ? { name: v.name, kind: v.kind } : null;
      const routeUrl = window.WizConfig.endpoint('route');
      if (!routeUrl) return toAgentOrThread(`To ${window.WizConfig.agent()}${sttNote}`);
      const r = await fetch(routeUrl, { method: 'POST', signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, force: kind === 'command' ? 'command' : '', view, apps: APPS.filter(a => a.kind !== 'view').map(a => a.name) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'router');
      const c = j.cmd || {};
      if (c.route === 'view' && view) return toView(v, text, `To ${v.name} · routed in ${j.ms} ms${sttNote}`, snap);
      if (c.route === 'command') {
        showRouted('command', `Command · DeepSeek Flash · ${j.ms} ms${sttNote}`);
        const ran = finishCmd(c, text, opts);
        if (c.then_agent) { await new Promise(resolve => setTimeout(resolve, 1500)); return toAgent(String(c.then_agent), `Opened ${c.app || 'app'} · follow-up to ${window.WizConfig.agent()}`, opts); }
        return ran;
      }
      return toAgentOrThread(`To ${window.WizConfig.agent()} · routed in ${j.ms} ms${sttNote}`);
    } catch (e) {
      return toAgentOrThread(`Router offline · sent to ${window.WizConfig.agent()}`);
    }
  }
  /* Hold-command with no command match: a choice card, nothing is sent until James taps. */
  const NOMATCH_MS = 4000;
  function holdNoMatch(text, opts) {
    tourEv('nomatch', { text });
    setVoice('idle'); vib(12);
    const q = String(text || '').trim().replace(/[.!?,\s]+$/, '');
    // A long held take is a message, not a missed command (James, 18 Oct: a 40 s task vanished with the 4 s card).
    // It keeps the card until he taps Send or ×, with Send first and no search chips.
    const long = q.split(/\s+/).length > 20;
    txShow(text, long ? 'Not a command · tap Send to keep it' : 'No command matched · nothing sent', 'command', '⚡');
    const btn = (k, label) => `<button data-hold="${k}">${esc(label)}</button>`;
    $('#txChips').innerHTML = long ? btn('agent', `Send to ${window.WizConfig.agent()}`)
      : (searchUrl(q) ? btn('search', 'Search the web') + btn('images', 'Image search') : '') + btn('agent', `Send to ${window.WizConfig.agent()}`);
    V.holdText = q; V.holdOpts = opts; V.holdLong = long;
    window.__backLog = (window.__backLog || []).concat('hold:nomatch').slice(-30);
    if (long) clearTimeout(appVars.txHideT); else txHide(NOMATCH_MS); // James (11 Oct): 9 s lingered far too long; × closes it at once
    return long ? { outcome: 'held-message' } : false;
  }
  function showRouted(kind, label) {
    if (isPill()) {
      const short = kind === 'agent' ? 'Waiting to send'
        : kind === 'view' ? 'Sent ' + label.split(' · ')[0].replace(/^To /, 'to ')
        : ($('#txText').textContent || 'Done');
      return txPill(kind === 'command' ? '⚡' : kind === 'view' ? '◧' : '✦', short, kind, label);
    }
    tx.className = 'transcript ' + kind; window.WizBrand.paint($('#txRouteIcon'), kind === 'command' ? '⚡' : kind === 'view' ? '◧' : '✦'); $('#txRouteText').textContent = label;
  }
  function finishCmd(c, text, opts) {
    setVoice('done'); vib([8, 40, 8]);
    // Music only acknowledges acceptance; its done/fail receipt settles the recording later.
    let settle = null;
    const done = /^(music|play_music)$/.test(c?.action || '') ? new Promise(r => { settle = r; }) : null;
    const ok = execute(c, text, settle ? { ...opts, musicDone: settle } : opts);
    tourEv('command', { ok: !!ok, text });
    if (!ok) { $('#txRouteText').textContent += ' · no match'; }
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(ok ? (isPill() ? 1200 : 1300) : 3200);
    return { outcome: ok ? (window.WosCommands.completedLocally(c, ok) ? 'local' : 'local-pending') : 'unhandled', done: ok ? done : null };
  }
  async function toView(v, text, label, snap) {
    showRouted('view', label); setVoice('done'); vib([8, 40, 8]);
    const ok = await deliverToView(v, text, snap);
    if (!ok) return toAgent(text, `${v.name} didn’t take it · sent to ${window.WizConfig.agent()}`, { snap });
    if (!v.thread || appVars.W[v.id]?.thread === v.thread) focusWin(v.id); // never pull James back from where he went since
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(isPill() ? 1200 : 1500);
    return ok === true ? { outcome: 'local-pending' } : ok;
  }
  function execute(c, text, opts = {}) {
    return window.WosCommands.execute(c, text, {
      search: openSearch, settings: openSettings,
      focused: () => appVars.W[opts.snap?.id || appVars.desks[appVars.idx].focus], chats: CHATS, chatList: () => openSheet('inbox'), launcher: q => openSheet('launcher', q),
      findApp, openApp: app => openApp(app, {}, opts), openAppRoute: (id, url) => { const a = hostedOpenable(id); return !!a && appAt(url)?.id === id && openApp(a, { path: url }, opts) !== false; }, musicDone: opts.musicDone, layout: c => {
        const a = c.action, f = opts.snap?.id || appVars.desks[appVars.idx].focus;
    if (a === 'desk') {
      const to = c.to; closeSheets();
      if (to === 'next') goDesk(appVars.idx + 1); else if (to === 'prev') goDesk(appVars.idx - 1); else if (to === 'home') goDesk(HOME); else if (+to >= 1) goDesk(+to - 1);
      return true;
    }
    if (a === 'clear_desk') { clearDesk(appVars.idx); return true; }
    if (a === 'close_window') { if (!f) return false; closeWin(f); return true; }
    if (a === 'fullscreen') { if (!f) return false; setFull(f, c.on !== false); return true; }
    if (a === 'move_window') { if (!f) return false; const to = c.to === 'prev' || c.to === 'left' ? appVars.idx - 1 : c.to === 'next' || c.to === 'right' ? appVars.idx + 1 : +c.to - 1; return moveWin(f, to); }
        return false;
      }
    });
  }
  /* A new request to Archimedes. It is delegated in the background: James stays exactly where he is
   * (no Chats window opens, no desk switch, no thread takes focus). The new thread shows up in Chats,
   * Working and the Inbox like any other, and he opens it when he chooses. */
  async function toAgent(text, label, opts = {}) {
    tourEv('sent', { text });
    showRouted('agent', label); setVoice('agent'); vib(10);
    setTimeout(() => { setVoice('idle'); }, 1200);
    txHide(isPill() ? 1400 : 2600);
    const ctx = viewContext(appVars.desks[appVars.idx].focus, opts.how || 'voice', opts.snap);
    // Chats new-voice uses the shared draft path, including Space membership, but no composer or screen context.
    if (opts.snap?.newChatWid && appVars.W[opts.snap.newChatWid]?.app === 'chats') {
      return sendChat(opts.snap.newChatWid, text, 'new voice chat', opts.audio || opts.snap.audio || null, { custodyId: opts.snap.custodyId, sid: '__new__', route: opts.snap.route, seal: false, files: opts.files || [], instructions: 'Explicit new voice chat. No foreground app or private thread context shared.' });
    }
    // Saved before it is sent: a dropped connection can delay this, never lose it.
    const item = await OUTBOX.enqueue({ sealKey: opts.snap?.seal?.key, custodyId: opts.snap?.custodyId, kind: 'new', text, typed: opts.typed || '', ...(opts.snap?.route || {}), instructions: ctx, audio: opts.audio || opts.snap?.audio || null, source: opts.source || 'orb', files: opts.files || [], ...(opts.reply ? { reply: opts.reply } : {}), ...(opts.snap?.dumpAsked ? { dump: false } : {}) });
    renderMoons(); refreshHome(); renderDots();
    return item;
  }
  /* Orb dump (switch wizard/agent-inbox, off by default; wizard-ux issue 1588): a plain new take to the main agent, said
   * away from any thread (home, an app, the Chats list), is offered to the router as a possible background task (the
   * outbox asks with accept_dump). A take aimed anywhere (a thread, a review, a capture view, an agent's or a channel's
   * chats, a desk, the general button, a meeting) or carrying composer words, files or a reply is never one. */
  function dumpTake(snap, rt, aimAt, kind) {
    try { if (!(document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/agent-inbox')) return false; } catch (_) { return false; }
    const v = snap?.view;
    return !rt && aimAt == null && kind !== 'command' && !snap.general && !snap.conversation && !snap.meetingEventId && !V.meetingLoan
      && !snap.seal && !snap.newChatWid && !(snap.route?.agent && window.WosAgents?.isOther?.(snap.route.agent)) && !V.files?.length
      && !(v && (v.review || v.mode === 'capture' || v.agent || v.channel || v.kind === 'chat thread' || (v.thread && v.thread !== '__new__')));
  }
  // The box took it as a background task: "Got it" with its title, no navigation, nothing new in Chats.
  function gotIt(title) {
    title = String(title || '').slice(0, 80);
    toast('✦', `<b>Got it</b>${title ? ' · ' + esc(title) : ''}`, 2600);
    $('#toast').classList.add('got-it');
  }
  OUTBOX?.onDump?.(it => gotIt(it.dumped?.title));
  OUTBOX?.onSent((it, res) => {
    if (it.kind === 'new' && LIVE && !LIVE.session(it.sessionId)) {
      LIVE.sessions.unshift({ id: it.sessionId, runtime: 'direct', title: (it.text || 'Voice note').slice(0, 60), status: 'running', runId: res.runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: it.text, source: 'wizard-mobile' });
      LIVE.markSeen(it.sessionId);
    } else if (LIVE?.session(it.sessionId)?.synthetic) LIVE.markSeen(it.sessionId);
    // A reply's thread is already held in Working with its live status by live.js (PEND), until Wizard lists the run.
    if (it.attempts) toast('✦', res.steered ? 'Delivered · steering the live run' : `Delivered to ${window.WizConfig.agent()}`, 2000);
    // First-try orb sends were already confirmed by the pill above the orb: no second banner.
    else if (res.steered) toast('✦', 'Sent · steering the live run', 1800);
    LIVE?.emit(); setTimeout(() => LIVE?.refresh(), 3000);
    for (const id of Object.keys(appVars.W)) if ((appVars.W[id].app === 'chats' || CHATS.isHosted(id)) && appVars.W[id].thread === it.sessionId) setTimeout(() => appVars.W[id] && loadThread(appVars.W[id], true), 1500);
  });

  /* ---------------- orb gestures ----------------
   * Tap: talk. Hold: command (it opens on the desk beside this one). Swipe: left/right desks, up apps, down inbox. */
  const orbWrap = $('#orbWrap');
  const voiceDestination = document.createElement('div');
  voiceDestination.id = 'voiceDestination'; voiceDestination.setAttribute('role', 'status');
  const generalTarget = document.createElement('button');
  generalTarget.id = 'generalVoice'; generalTarget.className = 'general-voice';
  generalTarget.textContent = 'Record for ' + window.WizConfig.agent();
  generalTarget.setAttribute('aria-label', generalTarget.textContent);
  /* Labels align with the dock's top edge; keep them outside its stacking
   * context so recording controls cannot obscure the destination text. */
  device.append(voiceDestination, generalTarget);
  generalTarget.addEventListener('click', () => {
    if (V.state === 'idle') startVoice('general');
    else if (V.snap?.general && ['listen', 'paused'].includes(V.state)) finishVoice();
  });
  function snapAgentName(snap) {
    const id = snap?.route?.agent, a = id && window.WosAgents?.get(id);
    return a ? a.label : window.WizConfig.agent();
  }
  return { dumpTake, execute, generalTarget, handleText, localParse, NOMATCH_MS, orbWrap, pinSpace, sendReview, snapAgentName, toAgent, viewContext, voiceDestination };
};
