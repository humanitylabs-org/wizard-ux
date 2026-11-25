/* Wizard UX AI apps view (desktop) › the sort and group menu, the order in Settings and painting the sidebar. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { archiveTop, EMPTY, GROUP_MODES, GROUP_ORDERS, KINDS, projectGroups, RAIL_WORDS, railActive, railNext, railRows, readyFlat, readyGroups, sectionsFor, stateGroups } from './parts.js';
import { CHATS, matches } from '../apps/chrome.js';
export function sidepaintPart({ aadVars, ACT_SECTIONS, actOn, actOrder, api, badgeText, chatRow, closeFly, closeMenu, el, flyLeave, flyWant, groupBy, icon, LKINDS, paintChan, paintFly, paintView, panes, readSessions, readyOrder, rList, root, scene, scroll, secOpen, setActOrder, setGroup, setOrder, setSearch, setWorkingOrder, workingOrder }) {
  let here, NOTE; // late-bound: desktop.js declares these after the call, see bindLate
  /** round 19 item 2 / round 22 / round 25 (Miguel, 4 Nov 2026: sort and group right in the sidebar, as two separate
   * drop-downs, since they are two different choices): kind 'sort' lists Newest / Oldest first, kind 'group' lists
   * By status / By project / One list, the current one checked */
  function openSortMenu(btn, kind = 'sort') {
    if (aadVars.menu?.wrap === btn) { closeMenu(); return; }
    closeMenu();
    const isWorking = kind === 'working-sort', isAct = kind === 'act-sort', isSort = kind === 'sort' || isWorking || isAct;
    const card = el('div', 'aad-pop aad-sortmenu', { role: 'menu', 'aria-label': isAct ? 'Sort' : isWorking ? 'Sort Working' : isSort ? 'Sort Ready' : 'Group Ready', 'data-menu': kind });
    const item = (on, w0, attrs, fn) => {
      const it = el('button', 'aad-pop-i' + (on ? ' is-on' : ''), { type: 'button', role: 'menuitemradio', 'aria-checked': String(on), ...attrs });
      it.append(on ? icon('check') : el('span', 'aad-ico', { 'aria-hidden': 'true' }), el('span', '', { text: w0 }));
      api.listen(it, 'click', () => { closeMenu(); fn(); });
      return it;
    };
    card.append(el('h3', 'aad-pop-h', { text: isSort ? 'Sort' : 'Group' }));
    if (isAct) for (const [v, w0] of globalThis.WizChatsListModel.ACTIVITY_SORTS) card.append(item(v === actOrder(), w0, { 'data-act-order': v }, () => setActOrder(v)));
    else if (isWorking) for (const [v, w0] of globalThis.WizChatsListModel.WORKING_SORTS) card.append(item(v === workingOrder(), w0, { 'data-working-order': v }, () => setWorkingOrder(v)));
    else if (isSort) for (const [v, w0] of GROUP_ORDERS) card.append(item(v === readyOrder(), w0, { 'data-order': v }, () => setOrder(v)));
    else for (const [v, w0] of GROUP_MODES) card.append(item(v === groupBy(), w0, { 'data-group': v }, () => setGroup(v)));
    scene.append(card);
    const r = btn.getBoundingClientRect();
    card.style.left = Math.round(Math.max(8, Math.min(r.right - 200, (globalThis.innerWidth || 1440) - 216))) + 'px';
    card.style.top = Math.round(r.bottom + 4) + 'px';
    aadVars.menu = { card, wrap: btn }; btn.classList.add('is-held'); btn.setAttribute('aria-expanded', 'true');
    aadVars.offMenuBack = api.back.push(closeMenu);
    api.after(0, () => card.querySelector('.is-on')?.focus?.({ preventScroll: true }));
  }

  /* ---------- round 19 item 2: the order in Settings › Chats & app screens (this view's own group there) ---------- */
  const setNode = el('div', 'st-group aad-stg', { 'data-aad-setting': '' });
  function paintSetting() {
    if ((typeof actOn === 'function' && actOn())) {
      // Activity with Channels on (issue 1336): the one sort, no grouping (Channels does the grouping now).
      const ao = actOrder(), ar = el('div', 'st-chats-options', { role: 'radiogroup', 'aria-label': 'Sort Activity' });
      for (const [v, w0] of globalThis.WizChatsListModel.ACTIVITY_SORTS) {
        const b = el('button', 'st-row wz-row', { type: 'button', role: 'radio', 'aria-checked': String(v === ao), 'data-aad-act-order': v });
        const tx = el('span', 'st-tx'); tx.append(el('b', '', { text: w0 }));
        b.append(el('span', '', { 'aria-hidden': 'true', text: v === ao ? '◉' : '○' }), tx);
        api.listen(b, 'click', () => setActOrder(v));
        ar.append(b);
      }
      setNode.replaceChildren(el('h4', '', { text: 'AI apps view' }), el('p', 'aad-stg-l', { text: 'Sort Activity' }), ar,
        el('p', 'aad-stg-n', { text: 'Working and Ready follow this order; Recent is always newest first. The same choice as Chats\' own order.' }));
      return;
    }
    const o = readyOrder();
    const radios = el('div', 'st-chats-options', { role: 'radiogroup', 'aria-label': 'Order chats within each group' });
    for (const [v, w0] of GROUP_ORDERS) {
      const b = el('button', 'st-row wz-row', { type: 'button', role: 'radio', 'aria-checked': String(v === o), 'data-aad-order': v });
      const tx = el('span', 'st-tx'); tx.append(el('b', '', { text: w0 }));
      b.append(el('span', '', { 'aria-hidden': 'true', text: v === o ? '◉' : '○' }), tx);
      api.listen(b, 'click', () => setOrder(v));
      radios.append(b);
    }
    const gm = groupBy(), gw = el('div', 'st-chats-options', { role: 'radiogroup', 'aria-label': 'Group Ready', 'data-aad-groupready': '' });
    for (const [v, w0] of GROUP_MODES) {
      const b = el('button', 'st-row wz-row', { type: 'button', role: 'radio', 'aria-checked': String(v === gm), 'data-aad-group': v });
      const tx = el('span', 'st-tx'); tx.append(el('b', '', { text: w0 }));
      b.append(el('span', '', { 'aria-hidden': 'true', text: v === gm ? '◉' : '○' }), tx);
      api.listen(b, 'click', () => setGroup(v));
      gw.append(b);
    }
    setNode.replaceChildren(el('h4', '', { text: 'AI apps view' }), el('p', 'aad-stg-l', { text: 'Group Ready' }), gw,
      el('p', 'aad-stg-l', { text: 'Order Ready chats' }), radios,
      el('p', 'aad-stg-n', { text: 'One list follows this order across chats. By status or project keeps the group order, with this order inside each group. The same choice as Chats\' own order; Priority or By subject there reads as Newest first here.' }));
  }
  paintSetting();
  api.desk.setting?.('ai-apps-order', setNode);

  /* ---------- paint the sidebar (only when what it lists changed: renders come often while a chat works) ---------- */
  const label = text => el('h3', 'aad-lab', { text });
  // Sends a graceful restart holds (wizard-ux issue 1362, wizard/graceful-restart): their own Saved heading under
  // Working, only while there are any (the list model's `saved`), so a held send never counts as Working.
  function savedSec(rows, cur) {
    if (!rows?.length) return [];
    const on = secOpen.saved !== false;
    const hd = el('button', 'aad-lab aad-sec', { type: 'button', 'data-sec': 'saved', 'aria-expanded': String(on), 'aria-controls': 'aad-sec-saved', 'aria-label': `Saved, ${rows.length}${on ? '' : ', folded'}` });
    hd.append(el('span', 'aad-sec-w', { text: 'Saved' }), el('span', 'aad-sec-m', { 'aria-hidden': 'true', text: String(rows.length) }), icon('down', 'aad-ico aad-sec-c'));
    api.listen(hd, 'click', () => { secOpen.saved = !on; api.storage.set('sections', { ...secOpen }); paintList(true); });
    const body = el('div', 'aad-sec-b', { id: 'aad-sec-saved', role: 'group', 'aria-label': 'Saved' }); body.hidden = !on;
    if (on) body.append(...rows.map(r => chatRow(r, cur)));
    return [hd, body];
  }
  let drawn = '', railDrawn = '';
  function paintList(force = false) {
    if (root.dataset.aadSide === 'rail') return;
    if (typeof paintChan === 'function') paintChan();
    if (typeof paintView === 'function' && paintView(false)) return;
    const s = aadVars.sessions || readSessions(), h = here();
    // A tab switch or picked chat moves the current mark in place, never rebuilding the list.
    const sig = JSON.stringify([aadVars.q, archiveTop(root),
      secOpen, workingOrder(), readyOrder(), groupBy(), badgeText(CHATS), !!globalThis.WosThreadTracker?.on?.(), KINDS.map(k => (s[k] || []).map(r => [r.id, r.title, r.unread, r.pinned, r.state || '', r.at || '', r.workingAsk?.state || '', r.workingAsk?.ask || '', r.background || '', r.channel || '', (r.actions || []).join(), globalThis.WosThreadTracker?.on?.() ? globalThis.WosThreadTracker.dots(r.id, globalThis.WizLive?.agentOf?.(r.id) || '') : '']))]
      .concat([(s.saved || []).map(r => [r.id, r.title, r.mark || ''])], (typeof actOn === 'function' && actOn()) ? [actOrder(), s.older || 0, (typeof LKINDS !== 'undefined' ? LKINDS : KINDS).map(k => (s[k] || []).map(r => [r.id, r.title, r.mark, r.agentName || '', r.channel || '', r.at || '', r.pinned, (r.actions || []).join(), !!r.draft]))] : []));
    if (!force && sig === drawn && scroll.childElementCount) { markCurrent(h.thread); return; }
    drawn = sig;
    const out = [];
    if (aadVars.q) {
      const seen = new Set(), hitsC = (typeof LKINDS !== 'undefined' ? LKINDS : KINDS).flatMap(k => s[k] || []).filter(r => !seen.has(r.id) && seen.add(r.id) && matches({ name: r.title }, aadVars.q));
      if (hitsC.length) out.push(label('Chats'), ...hitsC.map(r => chatRow(r, h.thread)));
      if (!hitsC.length) out.push(el('p', 'aad-empty', { text: 'No chats by that name.' }));
    } else if ((typeof actOn === 'function' && actOn())) {
      // Activity with Channels on (issue 1336): Working, Ready (its one sort on the header), Recent with Show older,
      // then Snoozed and Archived folded at the very bottom, each with its count. A section shows only while it holds
      // something; nothing at all is one empty state with a way to start a chat (wizard-ux issue 1731).
      const has = k => (s[k] || []).length > 0 || (k === 'recent' && !!s.older);
      if (!aadVars.sessions) out.push(el('p', 'aad-empty', { text: 'Loading your chats…' }));
      else if (!ACT_SECTIONS.some(([k]) => has(k)) && !(s.saved || []).length) {
        const box = el('div', 'aad-act-empty', { role: 'status' }), go = el('button', 'aad-act-new', { type: 'button', text: 'New chat' });
        api.listen(go, 'click', () => api.sessions.newChat());
        box.append(el('b', '', { text: 'No chats yet' }), el('span', '', { text: 'Type a message to Wizard, or tap the orb and talk.' }), go);
        out.push(box);
      }
      // Miguel's "Archive on top" (miguel/archive-top) puts Archived first here too, as on the phone drawer (issue 1741)
      const actSections = archiveTop(root) ? [...ACT_SECTIONS.filter(([k]) => k === 'archive'), ...ACT_SECTIONS.filter(([k]) => k !== 'archive')] : ACT_SECTIONS;
      const inboxKeep = !!globalThis.WizCore?.inboxKeep?.(); // Inbox until archived (wizard-ux issue 1810): Ready reads Inbox
      for (const [k, word1] of actSections) {
        const word0 = k === 'ready' && inboxKeep ? 'Inbox' : word1;
        if (aadVars.sessions && has(k)) {
          const rows = s[k] || [], on = k === 'recent' ? secOpen.recent !== false : !!secOpen[k];
          const hd = el('button', 'aad-lab aad-sec', { type: 'button', 'data-sec': k, 'aria-expanded': String(on), 'aria-controls': 'aad-sec-' + k });
          hd.append(el('span', 'aad-sec-w', { text: word0 }));
          // (Ready's count is what waits on the owner: the pill; the others a muted number)
          if (rows.length && k !== 'recent') hd.append(el(k === 'ready' ? 'b' : 'span', k === 'ready' ? 'aad-sec-n' : 'aad-sec-m', { 'aria-hidden': 'true', text: rows.length > 99 ? '99+' : String(rows.length) }));
          hd.append(icon('down', 'aad-ico aad-sec-c'));
          hd.setAttribute('aria-label', `${word0}${rows.length && k !== 'recent' ? `, ${rows.length}` : ''}${on ? '' : ', folded'}`);
          api.listen(hd, 'click', () => { secOpen[k] = !on; api.storage.set('sections', { ...secOpen }); paintList(true); });
          const body = el('div', 'aad-sec-b', { id: 'aad-sec-' + k, role: 'group', 'aria-label': word0 }); body.hidden = !on;
          if (on) {
            body.append(...rows.map(r => chatRow(r, h.thread)));
            if (k === 'recent' && s.older) {
              const more = el('button', 'aad-more-older', { type: 'button', text: `Show older · ${s.older}` });
              api.listen(more, 'click', () => { aadVars.actOlder = true; readSessions(); paintList(true); });
              body.append(more);
            }
          }
          if (k === 'ready') {
            const row = el('div', 'aad-sech'), word = (globalThis.WizChatsListModel.ACTIVITY_SORTS.find(([v]) => v === actOrder()) || globalThis.WizChatsListModel.ACTIVITY_SORTS[0])[1];
            const sort = el('button', 'aad-sortb aad-act-orderb', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Sort: ${word}. Change`, title: 'Sort' });
            sort.append(el('span', 'aad-sortb-w', { text: word.replace(' first', '') }), icon('down', 'aad-ico aad-sortb-c'));
            api.listen(sort, 'click', e => { e.stopPropagation?.(); openSortMenu(sort, 'act-sort'); });
            row.append(hd, sort); out.push(row, body);
          } else out.push(hd, body);
        }
        if (k === 'working' && typeof savedSec === 'function') out.push(...savedSec(s.saved, h.thread));
      }
    } else {
      // The sidebar and its search are Chats only; app search belongs to the global launcher.
      // Wizard's own sections in place of Recents (round 5): Working, Ready, Archive last (archive-top: first), each folding under its header
      for (const [k, word0] of sectionsFor(root)) {
        const rows = k === 'working' ? globalThis.WizChatsListModel.workingSort(s[k], workingOrder()) : s[k] || [], on = !!secOpen[k];
        // round 18 item 4 (Miguel: the open sidebar built on the folded rail): Snoozed only when it holds chats, as on the rail
        if (k === 'snoozed' && !rows.length) continue;
        const hd = el('button', 'aad-lab aad-sec', { type: 'button', 'data-sec': k, 'aria-expanded': String(on), 'aria-controls': 'aad-sec-' + k });
        hd.append(el('span', 'aad-sec-w', { text: word0 }));
        // Ready keeps every row; its pill uses the same canonical unread feed as the phone menu.
        const unread = k === 'ready' ? badgeText(CHATS) : '';
        if (unread) hd.append(el('b', 'aad-sec-n', { 'aria-hidden': 'true', text: unread }));
        hd.append(icon('down', 'aad-ico aad-sec-c'));
        // folded (round 7): a minimal tally after the chevron: Working its count with a tiny spinner, Ready its count
        if (!on && k !== 'archive' && k !== 'ready' && rows.length) hd.append(el('span', 'aad-tally', { 'data-n': String(rows.length), 'aria-hidden': 'true' }));
        if (k === 'ready') hd.setAttribute('aria-label', `${word0}${unread ? `, ${unread} unread` : ''}${on ? '' : ', folded'}`);
        else if (!on && rows.length) hd.setAttribute('aria-label', `${word0}, ${rows.length}, folded`);
        api.listen(hd, 'click', () => { secOpen[k] = !secOpen[k]; api.storage.set('sections', { ...secOpen }); paintList(true); });
        const body = el('div', 'aad-sec-b', { id: 'aad-sec-' + k, role: 'group', 'aria-label': word0 }); body.hidden = !on;
        if (on && k === 'ready' && rows.length && groupBy() === 'none') {
          // round 20 item 9 (Miguel, 3 Nov 2026): one flat Ready (the order ⌥↓ walks), a tiny muted tag on Needs you /
          // Your call rows; 'Group Ready by status' in Settings brings the sub-headers back. In the chosen Sort (James,
          // 4 Nov 2026: Newest means newest first here, not Needs you on top)
          body.append(...readyFlat(rows, readyOrder()).map(r => chatRow(r, h.thread)));
        } else if (on && k === 'ready' && rows.length) {
          // round 18 item 4b: a sub-header per status with its count (the rail's words and order), its chats under it in
          // the chosen order (item 3: group first, then the order inside each)
          // (round 24c: or one per project, WizardOS, Messenger, … under their own headers)
          const groups = groupBy() === 'project' ? projectGroups(rows, readyOrder()) : readyGroups(rows, readyOrder());
          for (const g of groups) {
            // (only plain chats: no sub-header, as the rail shows Ready alone)
            if (groups.length === 1 && g.state === 'none') { body.append(...g.rows.map(r => chatRow(r, h.thread))); break; }
            const gh = el('div', 'aad-grp', { 'data-state': g.state.startsWith('proj:') ? 'project' : g.state, role: 'heading', 'aria-level': '4' });
            gh.append(el('span', 'aad-grp-w', { text: g.word }));
            const n = globalThis.WizChatsListModel.unreadCount(g.rows);
            if (n) gh.append(el('span', 'aad-grp-n', { text: n > 99 ? '99+' : String(n) }));
            body.append(gh, ...g.rows.map(r => chatRow(r, h.thread, g.state.startsWith('proj:'))));
          }
        } else if (on) {
          if (rows.length) body.append(...rows.map(r => chatRow(r, h.thread)));
          else body.append(el('p', 'aad-empty', { text: !aadVars.sessions ? 'Loading your chats…' : EMPTY[k] }));
        }
        if (k === 'ready') {
          // round 22 / round 25 (Miguel, 4 Nov 2026): always on Ready's header, two quiet drop-downs: the grouping
          // (By status / By project / One list) and the order (Newest / Oldest); never a native select
          const row = el('div', 'aad-sech');
          const word0 = (GROUP_ORDERS.find(([v]) => v === readyOrder()) || GROUP_ORDERS[0])[1];
          const gw0 = (GROUP_MODES.find(([v]) => v === groupBy()) || GROUP_MODES[2])[1];
          const dd = (cls, kind, text, aria, title) => {
            const b = el('button', 'aad-sortb ' + cls, { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': aria, title });
            b.append(el('span', 'aad-sortb-w', { text }), icon('down', 'aad-ico aad-sortb-c'));
            api.listen(b, 'click', e => { e.stopPropagation?.(); openSortMenu(b, kind); });
            return b;
          };
          const group = dd('aad-groupb', 'group', gw0, `Group: ${gw0}. Change`, 'Group Ready');
          const sort = dd('aad-orderb', 'sort', word0.replace(' first', ''), `Sort: ${word0}. Change`, 'Sort Ready');
          row.append(hd, group, sort);
          out.push(row, body);
        } else if (k === 'working') {
          const row = el('div', 'aad-sech');
          const word = globalThis.WizChatsListModel.WORKING_SORTS.find(([v]) => v === workingOrder())[1];
          const sort = el('button', 'aad-sortb aad-working-orderb', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Sort Working: ${word}. Change`, title: 'Sort Working' });
          sort.append(el('span', 'aad-sortb-w', { text: word.replace(' first', '') }), icon('down', 'aad-ico aad-sortb-c'));
          api.listen(sort, 'click', e => { e.stopPropagation?.(); openSortMenu(sort, 'working-sort'); });
          row.append(hd, sort); out.push(row, body);
          if (typeof savedSec === 'function') out.push(...savedSec(s.saved, h.thread));
        } else out.push(hd, body);
      }
    }
    closeMenu();
    scroll.replaceChildren(...out);
  }
  /** the chat in front, marked in the list where it already is (round 14: no rebuild for it) */
  function markCurrent(id) {
    for (const w of scroll.querySelectorAll('.aad-rw')) {
      const on = !!id && w.dataset.sid === id;
      if (w.classList.contains('is-cur') === on) continue;
      w.classList.toggle('is-cur', on);
      const b = w.querySelector('.aad-row'); if (on) b?.setAttribute('aria-current', 'page'); else b?.removeAttribute('aria-current');
    }
  }
  /* The rail (round 12, Miguel: the icon tiles were unreadable: words, no status icons; round 16: 52 px). Snoozed, then
   * Ready and under it each stock Chats status with chats in it (STATES: core/chats.js stiKind's order; plain Ready
   * chats count in Ready only), each a count with a short word under it (RAIL_WORDS; the full words in its label).
   * Archive and Working stay in the open sidebar.
   * Round 19 item 1 (Miguel, 3 Nov 2026: fully usable while folded, nothing expands but ◫): a click opens that group's
   * FIRST chat in the docked chat column, the rail staying folded; the same item again opens the next one (wrapping).
   * The current group is marked and shows where the chat in front sits in it ('1/3' under its word). Hovering an item
   * (300 ms) shows a small flyout listing its chats (title, time); a click opens one; Esc closes it. ⌥↓ / ⌥↑ still walk
   * the whole Ready. Nothing advances on send (stock has no such setting). */
  let railLast = '';
  // (an app in front with a chat docked beside it: that chat is the current one, so ⌥↓ / ⌥↑ step from it)
  const curChat = () => { const h = here(); return h.thread || (h.note && aadVars.stepAt) || (h.app && aadVars.chatThread ? (aadVars.chatThread === NOTE ? aadVars.stepAt : aadVars.chatThread) : null) || null; };
  const railMode = () => ({ status: 'groups', project: 'projects' })[groupBy()] || 'list';   // (round 24b: By project folds to its projects)
  const railNow = () => railActive(aadVars.sessions || readSessions(), curChat(), railLast, readyOrder(), railMode());
  function railGo(key) {
    closeFly();
    const s = readSessions(), ids = railRows(s, key, readyOrder(), groupBy()).map(r => r.id); if (!ids.length) return;
    // The current chat stays marked across a grouping switch; the first click on a different rail row still starts it.
    const a = railNow(), same = a && a.key === key && (!railLast || railLast === key);
    const nx = railNext(ids, same ? curChat() : null); if (!nx) return;
    openChat(nx.id, key);
  }
  function openChat(id, key) {
    if (panes.get().focus !== 'chats') panes.set({ focus: 'chats' });
    if (aadVars.q) setSearch(false);
    aadVars.feedFocus = null; railLast = key; aadVars.stepAt = id; aadVars.noteWant = id.startsWith('notif:'); aadVars.fromFeed = null; api.sessions.open(id);
    paintRail(true);
  }
  function railRow(k, n, word0, state = '', act = null, text = n > 99 ? '99+' : String(n)) {
    const key = state || k, sub = !!state, on = !!act && act.key === key;
    const label = `${word0}${n ? `, ${text}${k === 'ready' ? ' unread' : ''}` : ''}${on ? `, chat ${act.i + 1} of ${act.n} open` : ''}. Click opens ${on ? 'the next' : 'the first'}; hover lists them`;
    const b = el('button', 'aad-rk' + (sub ? ' is-sub' : '') + (n ? '' : ' is-zero') + (on ? ' is-on' : ''), { type: 'button', role: 'listitem', 'data-k': key, 'aria-label': label, ...(on ? { 'aria-current': 'true' } : {}) });
    // round 23c (Miguel, 4 Nov 2026: a tally of dots looked weird past four): every row is Working's pattern, ONE mark
    // and its number: a spinner while chats work, a solid dot once ready (amber in Ready, the ink in a status), a ring
    // when snoozed; nothing waiting = the faint empty ring alone
    const kind = key === 'working' ? 'spin' : key === 'snoozed' ? 'ring' : 'dot';
    const wk = el('span', 'aad-rk-n aad-rk-wk', { 'data-n': String(n), 'aria-hidden': 'true' });
    if (n) wk.append(el('i', 'aad-d is-' + kind), el('span', 'aad-rk-wn', { text }));
    else wk.append(el('i', 'aad-d is-none'));
    b.append(wk, el('span', 'aad-rk-w', { text: RAIL_WORDS[key] || word0 }));
    if (on && act.n > 1) b.append(el('span', 'aad-rk-p', { 'aria-hidden': 'true', text: `${act.i + 1}/${act.n}` }));
    api.listen(b, 'click', () => railGo(key));
    api.listen(b, 'pointerenter', () => flyWant(b, key, word0));
    api.listen(b, 'pointerleave', flyLeave);
    api.listen(b, 'focus', () => { if (aadVars.fly) flyWant(b, key, word0); });
    return b;
  }

  function paintRail(force = false) {
    if (root.dataset.aadSide !== 'rail') return;
    if (typeof paintView === 'function' && paintView(true)) return;
    // round 22 (Miguel, 4 Nov 2026: never both, it reads as double counting): One list = Ready alone; By status = each
    // status alone (plain chats as 'Other'), no Ready total over them
    const s = aadVars.sessions || readSessions(), ready = s.ready || [], gm = groupBy(), grouped = gm !== 'none', groups = gm === 'project' ? projectGroups(ready, readyOrder()) : grouped ? stateGroups(ready) : [], act = railNow();
    const working = (s.working || []).length;
    const unread = aadVars.badgeMap[CHATS] || 0, text = badgeText(CHATS);
    const sig = JSON.stringify([working, (s.snoozed || []).length, ready.length, unread, text, gm, groups.map(g => [g.state, g.rows.length, globalThis.WizChatsListModel.unreadCount(g.rows)]), act]);
    if (!force && sig === railDrawn && rList.childElementCount) return;
    railDrawn = sig;
    // Snoozed (when there are any), Ready (only when something is ready), then Ready's statuses
    // round 22 (Miguel, 4 Nov 2026): Working comes back on the rail (only while chats work), its count beside the
    // expanded list's tiny spinner, in the expanded list's order (Working, Snoozed, Ready)
    const out = working ? [railRow('working', working, 'Working', '', act)] : [];
    if ((s.snoozed || []).length) out.push(railRow('snoozed', s.snoozed.length, 'Snoozed', '', act));
    if (grouped && groups.length) out.push(...groups.map(g => railRow('ready', globalThis.WizChatsListModel.unreadCount(g.rows), g.state === 'none' ? 'Other' : g.word, g.state, act)));   // (round 24b: or each project)
    // nothing ready (Miguel, 4 Nov 2026): no Ready mark at all, so the rail reads just "9 Working"
    // (wizard-os issue 510: an unread count with no Ready chat behind it pointed at nothing, so it needs a Ready row)
    else if (ready.length) out.push(railRow('ready', unread, globalThis.WizCore?.inboxKeep?.() ? 'Inbox' : 'Ready', '', act, text));
    rList.replaceChildren(...out);
    if (aadVars.fly) paintFly();
  }
  /* the hover flyout (round 19 item 1c): a small card beside the rail listing one item's chats */
  const FLY_MS = 300, FLY_OUT_MS = 220;
  return { curChat, FLY_MS, FLY_OUT_MS, openChat, paintList, paintRail, paintSetting, railMode, railNow, bindLate: v => { if ('here' in v) here = v.here; if ('NOTE' in v) NOTE = v.NOTE; } };
}
