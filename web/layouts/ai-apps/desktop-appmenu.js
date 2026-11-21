/* Wizard UX AI apps view (desktop) › an app's quick actions, the apps grid and a chat row. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { ACTS, pinsFrom, shortTime, titleInProject, togglePin } from './parts.js';
import { CHATS } from '../apps/chrome.js';
export function appmenuPart({ aadVars, api, canPin, chanTitle, closeAll, closeMenu, closeWs, desks, el, goApp, home, homeComposer, icon, installedIds, khMarks, openMenu, root, scene, setSearch, ttAgent, ttDots, unpeek }) {
  let dropTo, paintVt; // late-bound: desktop.js declares these after the call, see bindLate
  const refreshPins = () => { aadVars.pins = pinsFrom(Array.isArray(aadVars.pinsStored) ? aadVars.pinsStored : null, installedIds()); return aadVars.pins; };
  const setPins = list => { aadVars.pinsStored = list; aadVars.pins = list; api.storage.set('pins', list); paintVt(true); };
  const pinApp = id => setPins(togglePin(refreshPins(), id));

  /* the quick actions (round 10): Open; Add to Home Screen (the Desks' own sheet, apps it would offer); the App Store
   * page (its own Update / Remove, behind the Store's own confirmations); Close for an open app (it stays installed) */
  function openAppMenu(a, at) {
    closeMenu(); closeWs();
    let isOpen = desks().some(d => d.id === a.id);
    const acts = [];
    // round 15: Pin / Unpin first (round 16: the right column's top), then Open
    if (a.id !== CHATS) acts.push(aadVars.pins.includes(a.id) ? ['unpin', 'Unpin', 'unpin', () => pinApp(a.id)] : ['pin', 'Pin', 'pin', () => pinApp(a.id)]);
    // round 16 item 6: from the right column, Move up / Move down within its group
    const col = a.col, item = { id: a.id, desk: a.desk ?? null };
    if (col && col.index > 0) acts.push(['up', 'Move up', 'up', () => dropTo(item, { group: col.group, index: col.index - 1 })]);
    if (col && col.index >= 0 && col.index < col.n - 1) acts.push(['down', 'Move down', 'dn', () => dropTo(item, { group: col.group, index: col.index + 1 })]);
    acts.push(['open', 'Open', 'expand', () => goApp(a.id, a.desk)]);
    if (a.id === CHATS) isOpen = false;   // round 12: a Chats desk offers Open only
    else if (canPin(a.id)) acts.push(['home', 'Add to Home Screen', 'plus', () => api.apps.homeScreen.offer(a.id)]);
    if (api.apps.get && a.id !== CHATS && !a.system) acts.push(['store', 'App Store page', 'apps', () => { closeAll(); api.apps.get(a.id); }]);
    if (isOpen && api.apps.close) acts.push(['close', 'Close', 'x', () => { api.apps.close(a.id); api.after(120, () => { home.paint(true); paintVt(true); }); }]);
    const card = el('div', 'aad-pop aad-appmenu', { role: 'menu', 'aria-label': a.name });
    card.append(el('h3', 'aad-pop-h', { text: a.name }));
    for (const [k, word0, ico, run] of acts) {
      const it = el('button', 'aad-pop-i', { type: 'button', role: 'menuitem', 'data-act': k });
      it.append(icon(ico), el('span', '', { text: word0 }));
      api.listen(it, 'click', () => { closeMenu(); run(); });
      card.append(it);
    }
    scene.append(card);
    const h = acts.length * 40 + 44, H = globalThis.innerHeight || 900, W = globalThis.innerWidth || 1440;
    card.style.left = Math.round(Math.max(8, Math.min(at.x, W - 236))) + 'px';
    card.style.top = Math.round(at.y + h > H - 8 ? Math.max(8, at.y - h) : at.y) + 'px';
    const cellEl = at.el || null; cellEl?.classList.add('is-held');
    aadVars.menu = { card, wrap: cellEl || card }; aadVars.offMenuBack = api.back.push(closeMenu);
    api.after(0, () => card.querySelector('button')?.focus?.({ preventScroll: true }));
  }
  // round 15: the grid shows in the All apps sheet only (Home is the clean background and the composer)
  function paintHome() {
    if (root.dataset.aiFront !== 'list') root.dataset.aadHome = ''; else delete root.dataset.aadHome;
  }
  // the grid's box is fixed (desktop.css); a composer grown tall with words clips its lowest row instead of moving it
  let clipShown = '';
  function placeHome() {
    if (home.el.hidden) return;
    const c = homeComposer(), r = c?.getBoundingClientRect(), g = home.el.getBoundingClientRect();
    const px = r && r.top > 0 && r.top - 12 < g.bottom ? Math.max(0, Math.round(g.bottom - (r.top - 12))) + 'px' : '0px';
    if (px !== clipShown) { clipShown = px; home.el.style.setProperty('--aad-hg-clip', px); }
  }

  /* ---------- a chat row: click opens it; ⋯ (on hover) or a right click opens its menu ---------- */
  function chatRow(s, cur, inProject = false) {
    const wrap = el('div', 'aad-rw' + (s.id === cur ? ' is-cur' : ''), { 'data-sid': s.id, 'data-kind': s.kind });
    if (khMarks.has(s.id)) wrap.dataset.aadKh = khMarks.get(s.id);   // (round 21: a repaint while ⌥ is held keeps the room for its keycap)
    const b = el('button', 'aad-row aad-chat', { type: 'button', ...(s.id === cur ? { 'aria-current': 'page' } : {}) });
    // a notification (round 5; round 20 item 6, Miguel: it stands out, subtly, in amber): a small amber bell before its
    // title in normal text; its unread dot amber too (a chat's stays the accent)
    if (s.note) { wrap.dataset.note = ''; b.append(icon('bell', 'aad-ico aad-bell')); }
    // (round 26: under a By project header the row drops the project, the header says it once; the full title stays its tip)
    const t0 = inProject ? titleInProject(s) : s.title;
    const title = el('span', 'aad-row-t', { text: t0, ...(t0 !== s.title ? { title: s.title } : {}) });
    // A Working chat's ask line goes when the thread tracker is on (its dots carry it); no background
    // helper pill either way: the spinner already shows it (James, 7 Nov 2026).
    const ask = s.workingAsk && !globalThis.WosThreadTracker?.onFor?.(ttAgent(s.id)) ? s.workingAsk : null; // main agent only
    if (ask) title.append(el('span', 'aad-working-ask', { text: `${ask.state === 'needs_you' ? 'Needs you' : 'Your call'}: ${ask.ask}` }));
    // Channels on (issue 1256): the chat's channel, muted on a second line, as in Chats' Activity
    if (s.channel) title.append(el('span', 'aad-chan-line', { text: `# ${s.channel}` }));
    if (s.channel && typeof chanTitle === 'function') title.lastChild.textContent = chanTitle({ name: s.channel, general: s.channel === 'General' }); // (issue 1506: its emoji, not #)
    // (issue 1336: another agent's thread names it after the channel, "# WizardOS Chats · Philosopher")
    if (s.channel && s.agentName) title.lastChild?.append?.(` · ${s.agentName}`);
    // A saved, unsent draft (wizard-ux issue 1445, on for everyone since 1604): "✎ Draft" leads the second line (core/chats.css)
    if (s.draft) { wrap.dataset.draft = ''; if (!s.channel) title.append(el('span', 'aad-chan-line aad-draft-line')); }
    b.append(title);
    const dots = ttDots(s.id) ? globalThis.WosThreadTracker.dotsNode(s.id, ttAgent(s.id)) : null;
    if (dots) b.append(dots);
    // round 22 (Miguel, 4 Nov 2026: the time says more than a status tag, and makes Newest / Oldest readable): how long
    // ago its last message came in, muted at the row's end (a working chat has its spinner instead)
    if (s.kind !== 'working' && s.at) { const t = shortTime(s.at, Date.now()); if (t) b.append(el('span', 'aad-time', { 'data-at': String(s.at), text: t })); }
    if (s.pinned) b.append(icon('pin', 'aad-ico aad-pin'));
    // (Activity with Channels on, issue 1336: the row's one marker, amber over green; no purple unread dot)
    const mk = typeof s.mark === 'string' ? s.mark : null;
    if (mk !== null ? s.kind === 'working' || mk === 'needs' || mk === 'new' : s.kind === 'working' || (s.kind === 'ready' && s.unread)) b.append(el('i', 'aad-st' + (s.kind === 'working' ? '' : mk === 'needs' ? ' is-needs' : ' is-new'), { 'aria-hidden': 'true' }));
    b.setAttribute('aria-label', `${s.note ? 'Notification: ' : ''}${s.title}${s.kind === 'working' ? ', working' : s.kind === 'snoozed' ? ', snoozed' : s.unread ? ', ready, new' : s.snoozed && s.note ? ', snoozed' : s.kind === 'ready' ? ', ready' : ''}${s.pinned ? ', pinned' : ''}`);
    if (ask) b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, ${ask.state === 'needs_you' ? 'Needs you' : 'Your call'}: ${ask.ask}`);
    if (mk === 'needs') b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, needs you`);
    if (s.channel) b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, in # ${s.channel}${s.agentName ? `, ${s.agentName}` : ''}`);
    if (s.draft) b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, unsent draft`);
    api.listen(b, 'click', () => { if (aadVars.q) setSearch(false); unpeek(); aadVars.noteWant = !!s.note; aadVars.feedFocus = null; aadVars.stepAt = s.id; aadVars.fromFeed = null; api.sessions.open(s.id); });
    api.listen(b, 'contextmenu', e => { e.preventDefault(); openMenu(wrap, s, { x: e.clientX, y: e.clientY }); });
    wrap.append(b);
    if ((s.actions || []).some(k => ACTS.some(([a]) => a === k))) {
      const m = el('button', 'aad-more', { type: 'button', 'aria-label': `More for ${s.title}`, title: 'More', 'aria-haspopup': 'menu' }); m.append(icon('more'));
      api.listen(m, 'click', e => { e.stopPropagation?.(); openMenu(wrap, s); });
      wrap.append(m);
    }
    return wrap;
  }
  return { chatRow, openAppMenu, paintHome, placeHome, refreshPins, setPins, bindLate: v => { if ('dropTo' in v) dropTo = v.dropTo; if ('paintVt' in v) paintVt = v.paintVt; } };
}
