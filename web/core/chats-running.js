/* Wizard UX core: Chats › the agent inbox parts (on for everyone since wizard-ux issue 1778): the Running view, Open / Send to inbox,
 * the Signal sweep card and Alert rules feedback. Moved verbatim out of core/chats.js (wizard-ux issue 1665: split the
 * giant front-end files, no behaviour change). createChats (core/chats.js) calls this once, where the code used to be,
 * with the closure names it reads, and keeps the functions it returns under their old names. Loaded before chats.js
 * by both shells. The body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.running = function ({ ago, ch, CH, chanStore, clip, esc, H, KIT, LIVE, paintListsNow, PIN, renderThreadNow, rerenderList, STI, storeAgent, toast, W, winAgent }) {
  /* Running view (wizard-ux issue 1569). A task the owner hands off (the orb's
   * dump) works in a hidden worker thread that never lists in Chats, Activity or the unread counts; the box's agent inbox
   * (LIVE.agentInbox: GET /wizard/v1/agent-inbox?state=running,stale) says what is still running. The main Chats list
   * shows one row at the top while anything runs (the unsent row's markup); a tap opens the Running view in the same list
   * window: one ordinary chat row per task with its title, last update, how long it has been running, and "No news for
   * 6 h" once it went quiet. A tap opens the thread (openChat, like any link); Back from the thread returns here (the
   * window keeps ch().running) and Back here returns to Chats (channelBack, clearFilter). Opening never unhides it. */
  function runningOn(w) {
    return !!w && !winAgent(w) && !!LIVE.agentInbox;
  }
  /* The AI apps desktop's sidebar (wizard-ux issue 1599, switch wizard/ai-apps-running, off by default): the sweep card's
   * Running link opens the Running view in the sidebar's Chats pane (its id::side window, H.runningPane) instead of the
   * Classic list pane; a task opens in the main column (the pane's thread setter), the view stays in the sidebar, and
   * Esc / ‹ there returns to the sidebar list (channelBack). Off, a side window never shows it. */
  const RUN_SIDE = 'wizard/ai-apps-running';
  function runningSideOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(RUN_SIDE); } catch (_) { return false; } }
  const runningSideWin = w => /::side$/.test(String(w?.id || ''));
  function runningOpen(w) { return !!w && !!ch(w.id).running && runningOn(w) && (!runningSideWin(w) || runningSideOn()); }
  // The sweep card's Running link on the AI apps desktop: true when the sidebar took it.
  function runningSideGo() {
    const sp = runningSideOn() && typeof H.runningPane === 'function' ? H.runningPane() : null;
    if (!sp || !runningOn(sp)) return false;
    ch(sp.id).sent = false; // the view takes the pane's place, Sent included
    return runningGo(sp, true);
  }
  // The main Chats list shows the main agent's tasks only (the orb's dump starts them there): a routed agent's record
  // never opens as the main agent's thread, even when both use the same thread id.
  function runningRecs() { return LIVE.agentInbox?.records?.('hermes') || []; }
  function runningFor(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; }
  function runningRow(w) {
    if (!runningOn(w) || ch(w.id).running) return '';
    const r = runningRecs(), quiet = r.filter(x => x.state === 'stale').length;
    if (!r.length) return '';
    return `<button type="button" class="ch-unsent ch-running${quiet ? ' quiet' : ''}" data-chrunning aria-label="${r.length} running: open the Running view"><span class="pip"></span><span class="tx"><b>${r.length} running${quiet ? ` · ${quiet} quiet` : ''}</b><small>${esc(clip(r[0].title || r[0].update || 'Background task', 60))}</small></span><span class="go">View</span></button>`;
  }
  function runningHead() {
    return '<div class="ch-chan-h ch-run-h" data-morph-key="run-head"><button type="button" class="ch-chan-back" data-chrunback aria-label="Back to chats"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><b>Running</b></div>';
  }
  function runningBody() {
    const st = LIVE.agentInbox?.state(), r = runningRecs(), now = Date.now();
    if (!st?.ok) return '<div class="ch-empty">Checking what is running…</div>';
    if (!r.length) return `<div class="ch-empty">${st.gone ? 'Your Wizard keeps no agent inbox yet.' : 'Nothing is running.'}</div>`;
    return `<section class="ch-sec open ch-run" data-sec="running"><div class="ch-sec-b">${r.map(x => {
      const quiet = x.state === 'stale', lead = quiet ? '<em class="att quiet">No news for 6 h:</em> ' : '';
      return `<div class="ch-row-wrap" data-morph-key="run:${esc(x.id)}"><button type="button" data-part="thread-row" class="ch-row ch-run-row${quiet ? ' quiet' : ''}" data-chrunopen="${esc(x.thread)}" title="Open thread"><span class="emo sti ${quiet ? 'deferred' : 'working'}" aria-label="${quiet ? 'No news for 6 h' : 'Working'}">${quiet ? STI.deferred : STI.working}</span>
      <span class="bd"><span class="tp"><b>${esc(x.title || 'Background task')}</b><time>${esc(x.updatedAt ? ago(x.updatedAt) : '')}</time></span><span class="ch-run-pv">${lead}${esc(clip(x.update || '', 140))}</span><span class="ch-run-age">Running ${esc(runningFor(now - (x.createdAt || now)))}</span></span></button>${typeof inboxListed === 'function' && !inboxListed(x.thread) ? `<button type="button" class="ch-inbox-open" data-chinboxopen="${esc(x.thread)}" data-title="${esc(x.title || '')}" aria-label="Open in Chats: ${esc(x.title || 'Background task')}" title="Move it into the chat list">Open</button>` : ''}</div>`;
    }).join('')}</div></section>`;
  }
  function runningGo(w, on) {
    if (!w) return false;
    ch(w.id).running = !!on;
    if (on) { LIVE.agentInbox?.fresh?.(); LIVE.agentInbox?.read?.(); }
    rerenderList(w); return true;
  }
  function runningBack(w) {
    if (!w || w.thread || !ch(w.id).running) return false;
    const was = runningOpen(w); ch(w.id).running = false;
    if (!was) return false;
    rerenderList(w); return true;
  }
  /* Open / Send to inbox (wizard-ux issue 1570). One tap fixes a wrong routing either way: Open (a Running
   * view row, a hidden thread's header) moves a background thread into the chat list at once; Send to inbox (a visible
   * thread's menu, never a pinned one) hides it and lets it finish in the background, its result in the next sweep.
   * LIVE.inboxMove moves the row on the tap frame and tells the box (POST /wizard/v1/agent-inbox/open|send), which also
   * keeps each tap as an example for the orb's router. Main agent threads only (the box hides only those). */
  const INBOX_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4M5 13l2-8h10l2 8v6H5z"/></svg>';
  function inboxListed(id) { return LIVE.sessions.some(x => x.id === id && !x.hidden && !x.optimistic); }
  // The box keeps an agent inbox: not one that answered 404 (WIZARD_AGENT_INBOX=0 or an older Service), so Open and
  // Send to inbox are never offered there; before the first answer they are (the usual case).
  function inboxBoxOn() { return !!LIVE.agentInbox && LIVE.agentInbox.state?.()?.gone !== true; }
  function inboxHidden(w, s) {
    if (!s || !w || winAgent(w) || !inboxBoxOn() || (LIVE.ownerOf && LIVE.ownerOf(s))) return false;
    if (inboxListed(s.id)) return false;
    return s.hidden === true || runningRecs().some(r => r.thread === s.id);
  }
  function inboxHeadHtml(w, s) {
    return inboxHidden(w, s) ? `<span class="ch-inbox-h"><span class="ch-inbox-note">In the background</span><button type="button" class="ch-inbox-open" data-chinboxopen="${esc(s.id)}" aria-label="Open: move this thread into the chat list" title="Move it into the chat list">Open</button></span>` : '';
  }
  // Daily and Alerts threads always stay in Chats (issue 1569 review: the sweep card lives in today's Daily thread):
  // the box names them (stays), the row's channel says so while Channels are on, and nothing is offered in the Daily view.
  function inboxStays(w, s) {
    if (w.daily || (LIVE.agentInbox.stays && LIVE.agentInbox.stays(s.id))) return true;
    const st = typeof s.channel === 'string' && s.channel ? chanStore() : null, c = st && st.channels.find(x => x.id === s.channel);
    return !!c && (c.kind === 'daily' || c.kind === 'alerts');
  }
  function inboxCanSend(wid, s) {
    const w = W[wid];
    return !!(s && w && !winAgent(w) && inboxBoxOn() && !(LIVE.ownerOf && LIVE.ownerOf(s)) && !s.hidden && !s.archived && !s.optimistic && !s.synthetic && !PIN.has(s.id) && !inboxStays(w, s));
  }
  function inboxRepaint(id) {
    paintListsNow();
    for (const x of Object.keys(CH)) { const ww = H.win(x); if (ww && ww.thread === id) renderThreadNow(ww); }
  }
  async function inboxMove(kind, id, opts = {}) {
    try {
      const moving = LIVE.inboxMove(kind, id, opts);
      inboxRepaint(id); // the row moved on this frame (LIVE.inboxMove's first step)
      await moving;
      toast(kind === 'open' ? '✓' : '↧', kind === 'open' ? 'In Chats now' : 'Sent to the inbox · it finishes in the background', 2200);
    } catch (e) {
      toast('!', e?.status === 409 ? (kind === 'send' ? 'This chat stays in Chats' : 'Couldn’t move it') : 'Couldn’t move it · try again', 3200);
    }
    inboxRepaint(id);
  }
  /* Signal sweep card (wizard-ux issue 1586, box half wizard-agent-service issue 550). The Service adds
   * the card as the last row of today's Daily thread (display_kind agent_sweep); Chats draws it
   * with the run-control buttons instead of its markdown copy: one button per answer token on each Waiting item (a tap
   * posts the answer, the Service sends the full message into that task's thread), Later (snoozed to the next sweep),
   * "Open to confirm" for an item that sends or spends, Open for a hidden main-agent thread, and Yes to all. After a tap
   * the card is read again (GET /wizard/v1/agent-inbox/sweep) and repainted in place. SWEEP keeps per card: the newest
   * view the box sent, the taps on their way, and the items snoozed here. */
  const SWEEP = new Map();
  const sweepOf = id => { let s = SWEEP.get(id); if (!s) { s = { view: null, busy: {}, later: new Set(), all: false }; SWEEP.set(id, s); if (SWEEP.size > 20) SWEEP.delete(SWEEP.keys().next().value); } return s; };
  const sweepMd = v => String(v ?? '').replace(/\s+/g, ' ').replace(/([\\`*_[\]])/g, '\\$1').trim();
  // A ?inbox= list link has no view in the shell yet (only Running has one, drawn as its own button): plain text, not a dead link.
  const sweepLink = (text, link) => link && !/^\/wizard-os-home\/\?inbox=/.test(link) ? KIT.inline(`[${sweepMd(text)}](${link})`) : esc(text);
  const sweepRunning = r => `<button type="button" class="ch-sw-run" data-chsweeprunning aria-label="Running: ${r.count}: open the Running view">Running: ${r.count}</button>`;
  const sweepThread = (i, inner) => i.agent === 'hermes' && i.thread ? `<a href="/wizard-os-home/?session=${encodeURIComponent(i.thread)}" class="wsl" data-session="${esc(i.thread)}">${inner}</a>` : inner;
  const sweepLabel = t => t === 'later' ? 'Later' : KIT.friendlyChoice(t);
  function sweepItemHtml(cardId, s, i) {
    const busy = s.busy[i.id], age = i.seen > 1 ? `<span class="ch-sw-age" title="Shown on ${i.seen} sweeps">Sweep ${i.seen}</span>` : '';
    let act;
    if (i.state === 'answered') act = `<small class="ch-sw-st">Answered: ${esc(sweepLabel(i.answer || ''))}</small>`;
    else if (s.later.has(i.id)) act = '<small class="ch-sw-st">Later · back at the next sweep</small>';
    else if (i.state === 'parked') act = '<small class="ch-sw-st">Parked</small>';
    else if (i.state === 'archived') act = '<small class="ch-sw-st">Archived</small>';
    else if (i.state === 'running') act = '<small class="ch-sw-st">Working on it</small>';
    else if (i.confirm) act = i.agent === 'hermes' && i.thread ? `<div class="appr-b">${sweepThread(i, 'Open to confirm').replace('class="wsl"', 'class="wsl ch-sw-confirm"')}</div>` : '<small class="ch-sw-st">Open its thread to confirm</small>';
    else {
      const tokens = [...i.options, ...(i.options.includes('later') ? [] : ['later'])];
      act = `<div class="appr-b${tokens.length > 2 ? ' many' : ''}">${tokens.map(t => `<button type="button" data-chsweep="${esc(i.id)}" data-card="${esc(cardId)}" data-opt="${esc(t)}" class="${t === 'later' ? 'no' : ''}${t === i.def ? ' def' : ''}"${busy || s.all ? ' disabled' : ''}>${busy === t ? 'Sending…' : esc(sweepLabel(t))}</button>`).join('')}</div>`;
    }
    const open = i.agent === 'hermes' && i.thread && !inboxListed(i.thread) ? `<button type="button" class="ch-inbox-open" data-chinboxopen="${esc(i.thread)}" data-title="${esc(i.title)}" aria-label="Open in Chats: ${esc(i.title || 'Task')}" title="Move it into the chat list">Open</button>` : '';
    return `<li class="ch-sw-i" data-morph-key="sw:${esc(i.id)}"><div class="ch-sw-t"><b>${sweepThread(i, esc(i.title || 'Task'))}</b>${age}${open}</div>`
      + `${i.ask ? `<p class="ch-sw-ask">${esc(i.ask)}</p>` : ''}${i.recommendation ? `<p class="ch-sw-rec">Recommendation: ${esc(i.recommendation)}</p>` : ''}${act}${alertFbHtml(i.id, 'should_alert')}</li>`;
  }
  // The card for one history row (tn.a.sweep), or '' (not a card the shell can read: the markdown shows).
  function sweepHtml(raw) {
    if (!LIVE.agentInbox?.card) return '';
    const base = LIVE.agentInbox.card(raw); if (!base) return '';
    const s = sweepOf(base.id); s.base = base;
    const v = s.view || base, w = v.waiting, d = v.done;
    const yes = v.yes.count > 0 ? `<div class="appr-b ch-sw-all"><button type="button" data-chsweepall="${esc(v.id)}"${s.all || Object.keys(s.busy).length ? ' disabled' : ''}>${s.all ? 'Sending…' : `Yes to all (${v.yes.count})`}</button></div>${v.yes.skipped ? `<small>${v.yes.skipped} to confirm yourself</small>` : ''}` : '';
    const counts = [sweepRunning(v.running) + (v.running.stale ? `, ${v.running.stale} with no news for 6 h` : ''), LIVE.agentInbox.later ? sweepLaterBtn(v, s) : sweepLink(`Later and FYI: ${v.later.count}`, v.later.link)];
    if (v.parked.count) counts.push(sweepLink(`${v.parked.count} parked`, v.parked.link));
    if (v.missing) counts.push(esc(`${v.missing} finished task${v.missing === 1 ? '' : 's'} had no inbox record at the last check`));
    if (v.rules) counts.push(sweepLink(`Alert rules let ${v.rules.alerts} alerts through on ${v.rules.day} (more than ${v.rules.cap}): check the rules`, v.rules.link));
    return `<div class="appr ch-sweep" role="group" aria-label="Signal sweep" data-chsweepcard="${esc(v.id)}"><b>Signal sweep</b>`
      + `<div class="ch-sw-h" role="heading" aria-level="3">Waiting on you (${w.items.length + w.more})</div>${w.items.length ? `<ul class="ch-sw-l">${w.items.map(i => sweepItemHtml(v.id, s, i)).join('')}</ul>` : '<p class="ch-sw-none">Nothing is waiting on you.</p>'}`
      + `${w.more ? `<p class="ch-sw-more">${sweepLink(`and ${w.more} more`, w.link)}</p>` : ''}${yes}`
      + `<div class="ch-sw-h" role="heading" aria-level="3">Done (${d.items.length + d.more})</div>${d.items.length ? `<ul class="ch-sw-d">${d.items.map(i => `<li data-morph-key="sw:${esc(i.id)}"><span class="ch-sw-dt">${sweepLink(i.title || 'Task', i.link)}</span>${alertFbHtml(i.id, 'should_alert')}</li>`).join('')}</ul>` : '<p class="ch-sw-none">Nothing new finished.</p>'}`
      + `${d.more ? `<p class="ch-sw-more">${sweepLink('more', d.link)}</p>` : ''}<p class="ch-sw-n">${counts.join('<br>')}</p>${sweepLaterHtml(s)}</div>`;
  }
  function sweepRepaint() { for (const x of Object.keys(CH)) { const ww = H.win(x); if (ww && ww.thread) renderThreadNow(ww); } }
  // Inline action cards (wizard-ux issue 1463, core/action-cards.js): flipping wizard/action-cards repaints open threads too.
  let actWas = window.WosActionCards?.on?.() === true;
  try { window.addEventListener('wos:experience', () => { const on = window.WosActionCards?.on?.() === true; if (actWas === on) return; actWas = on; sweepRepaint(); }); } catch (_) {}
  // Read the card again; only the same card's view is kept (a newer sweep posts its own row).
  async function sweepReread(id) {
    try { const v = await LIVE.agentInbox.sweep(); if (v && v.id === id) sweepOf(id).view = v; } catch (_) {}
  }
  async function sweepAnswer(cardId, itemId, option) {
    const s = sweepOf(cardId); if (s.busy[itemId] || s.all) return;
    s.busy[itemId] = option; sweepRepaint();
    try {
      await LIVE.agentInbox.answer(itemId, option);
      if (option === 'later') s.later.add(itemId);
      else if (s.view || s.base) { const v = s.view || s.base; s.view = { ...v, waiting: { ...v.waiting, items: v.waiting.items.map(i => i.id === itemId ? { ...i, state: 'answered', answer: option } : i) } }; }
      toast('✓', option === 'later' ? 'Later · back at the next sweep' : 'Answer sent', 1800);
    } catch (e) { toast('!', e?.status === 404 ? 'That item is no longer waiting' : 'Couldn’t send the answer · try again', 3200); }
    delete s.busy[itemId];
    await sweepReread(cardId);
    sweepRepaint();
  }
  async function sweepYesToAll(cardId) {
    const s = sweepOf(cardId); if (s.all || Object.keys(s.busy).length) return;
    s.all = true; sweepRepaint();
    try {
      const r = await LIVE.agentInbox.yesToAll(cardId);
      if (r.card && r.card.id === cardId) s.view = r.card;
      toast('✓', `${r.answered.length} answer${r.answered.length === 1 ? '' : 's'} sent`, 1800);
    } catch (e) { toast('!', 'Couldn’t send the answers · try again', 3200); }
    s.all = false;
    await sweepReread(cardId);
    sweepRepaint();
  }
  /* Alert rules feedback (wizard-ux issue 1589, box half wizard-agent-service issue 552). The box decides
   * what is loud: an alert record (kind alert) reaches Alerts, everything else waits for the sweep. Each answer teaches
   * it one example: Not urgent on an alert in the Alerts channel (the alert moves to the sweep; on the day's collapsed
   * "More alerts today" alert it only clears it) and Should have alerted on a sweep item (the card's Waiting and Done
   * items and its Later list). ALFB keeps the taps on their way and the items marked here. */
  const ALFB = { busy: {}, done: new Set() };
  function alertFbHtml(id, action) {
    if (ALFB.done.has(id)) return `<small class="ch-sw-st ch-al-done">${action === 'not_urgent' ? 'Not urgent · it waits for the sweep' : 'Marked · alerts like this get through next time'}</small>`;
    const busy = ALFB.busy[id];
    return `<div class="appr-b ch-al-fb"><button type="button" class="no" data-chalertfb="${esc(action)}" data-id="${esc(id)}"${busy ? ' disabled' : ''}>${busy ? 'Sending…' : action === 'not_urgent' ? 'Not urgent' : 'Should have alerted'}</button></div>`;
  }
  // The card's "Later and FYI: N" opens the Later list in place (read from the box on each open).
  function sweepLaterBtn(v, s) {
    return `<button type="button" class="ch-sw-lb" data-chsweeplater="${esc(v.id)}" aria-expanded="${s.laterOpen ? 'true' : 'false'}">Later and FYI: ${v.later.count}</button>`;
  }
  function sweepLaterHtml(s) {
    if (!s.laterOpen) return '';
    if (!s.laterList) return '<p class="ch-sw-none">Reading the Later list…</p>';
    if (!s.laterList.length) return '<p class="ch-sw-none">Nothing waits for later.</p>';
    return `<div class="ch-sw-h" role="heading" aria-level="3">Later and FYI</div><ul class="ch-sw-l ch-sw-later">${s.laterList.map(r => `<li class="ch-sw-i" data-morph-key="swl:${esc(r.id)}"><div class="ch-sw-t"><b>${esc(r.title || 'Note')}</b></div>${r.ask ? `<p class="ch-sw-ask">${esc(r.ask)}</p>` : ''}${r.feedback === 'should_alert' && !ALFB.done.has(r.id) ? '<small class="ch-sw-st ch-al-done">Marked · alerts like this get through next time</small>' : alertFbHtml(r.id, 'should_alert')}</li>`).join('')}</ul>`;
  }
  async function sweepLater(cardId) {
    const s = sweepOf(cardId); s.laterOpen = !s.laterOpen;
    if (!s.laterOpen) { sweepRepaint(); return; }
    s.laterList = null; sweepRepaint();
    try { s.laterList = await LIVE.agentInbox.later(); } catch (_) { s.laterOpen = false; toast('!', 'Couldn’t read the Later list · try again', 3200); }
    sweepRepaint();
  }
  // The Alerts channel (kind alerts) shows the alert records still waiting on top of its posts' end, newest first.
  function alertsChan(open) {
    if (!open || open.general || open.agentFeed || !LIVE.agentInbox?.alerts) return false;
    const st = typeof chanStore === 'function' ? chanStore() : null;
    return !!st && st.channels.some(c => c.id === open.id && c.kind === 'alerts');
  }
  function alertsHtml(open) {
    if (!alertsChan(open)) return '';
    const list = LIVE.agentInbox.alerts(typeof storeAgent === 'function' ? storeAgent(open.agent) : (open.agent || 'hermes'));
    if (!list.length) return '';
    return `<section class="appr ch-sweep ch-alerts" role="group" aria-label="Alerts now" data-morph-key="alerts-now"><b>Alerts now</b><ul class="ch-sw-l">${list.map(r => `<li class="ch-sw-i ch-al-i${r.collapsed ? ' collapsed' : ''}" data-morph-key="al:${esc(r.id)}"><div class="ch-sw-t"><b>${r.agent === 'hermes' && r.thread && LIVE.sessions?.some?.(x => x.id === r.thread) ? `<a href="/wizard-os-home/?session=${encodeURIComponent(r.thread)}" class="wsl" data-session="${esc(r.thread)}">${esc(r.title || 'Alert')}</a>` : esc(r.title || 'Alert')}</b>${r.collapsed ? `<span class="ch-sw-age ch-al-n" title="${r.extra} more alerts today">${r.extra}</span>` : ''}</div>${r.ask ? `<p class="ch-sw-ask">${esc(r.ask)}</p>` : ''}${alertFbHtml(r.id, 'not_urgent')}</li>`).join('')}</ul></section>`;
  }
  async function alertFeedback(id, action, collapsed = false) {
    if (ALFB.busy[id] || ALFB.done.has(id)) return;
    ALFB.busy[id] = action; alertRepaint();
    try {
      const r = await LIVE.agentInbox.feedback(id, action), n = r.examples[action];
      if (action === 'should_alert') ALFB.done.add(id);
      toast('✓', collapsed ? 'Cleared' : action === 'not_urgent' ? `Not urgent · it waits for the sweep (${n} example${n === 1 ? '' : 's'})` : `Got it · alerts like this get through next time (${n} example${n === 1 ? '' : 's'})`, 2600);
    } catch (e) { toast('!', e?.status === 404 ? 'That item is gone' : e?.status === 400 ? (action === 'not_urgent' ? 'That is no longer an alert' : 'That is already an alert') : 'Couldn’t send it · try again', 3200); }
    delete ALFB.busy[id];
    alertRepaint();
  }
  function alertRepaint() { sweepRepaint(); if (typeof paintListsNow === 'function') paintListsNow(); }
  return { alertFeedback, alertsHtml, INBOX_SVG, inboxCanSend, inboxHeadHtml, inboxMove, runningBack, runningBody, runningGo, runningHead, runningOn, runningOpen, runningRow, runningSideGo, sweepAnswer, sweepHtml, sweepLater, sweepYesToAll };
};
