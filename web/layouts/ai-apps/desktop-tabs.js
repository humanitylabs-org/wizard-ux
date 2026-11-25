/* Wizard UX AI apps view (desktop) › the open-apps column: its rows, moving them and dragging to rearrange. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { CHATS } from '../apps/chrome.js';
import { relMoves, vtMove } from './parts.js';
export function tabsPart({ aadVars, api, applySizes, appName, appTile, badgeText, behindThread, closeAll, closeMenu, desks, el, FEED, flip, focusLeave, goApp, goHome, host, icon, metaOf, one, oneBack, oneSplit, openAppMenu, orbBox, paneFrame, panelWindow, pTools, retileSoon, root, setPins, shownDesks, top, vChats, vChatsN, vOne, vtList, vtTabs, vtTog }) {
  let closeChat, here, hidePanel, markMedia, paintTop, setWide; // late-bound: desktop.js declares these after the call, see bindLate
  // the tab in front: the panel's desk (or the app desk in front before its panel is placed)
  const frontDesk = () => aadVars.pane ? Number(aadVars.pane.desk) : here().app ? api.route().desk : null;
  function vtTab(d, pinned) {
    const open = d.desk != null, on = open && frontDesk() === d.desk;
    const name = d.name || appName(d.id) || d.id, n = d.id === CHATS ? '' : badgeText(d.id);
    const b = el('div', 'aad-vtab' + (on ? ' is-on' : '') + (pinned ? ' is-pinned' : '') + (pinned && open ? ' is-run' : '') + (open ? '' : ' is-closed'), { role: 'tab', tabindex: on ? '0' : '-1', 'aria-selected': String(on), ...(open ? { 'data-desk': String(d.desk) } : {}), 'data-app': d.id, title: name + (n ? ` · ${n} new` : '') + (open ? '' : ' · not open'), 'aria-label': name + (n ? `, ${n} new` : '') + (pinned ? ', pinned' : '') + (open ? '' : ', not open') });
    const ic = el('span', 'aad-vti');
    // (a second Chats desk: the chats glyph on the accent, as on the Desks view)
    let t0; if (d.id === CHATS) { t0 = el('span', 'aad-tile is-vt', { 'aria-hidden': 'true' }); t0.style.setProperty('--c', 'var(--wz-accent)'); t0.append(el('i', 'sgi sg-chats', { 'aria-hidden': 'true' })); } else t0 = appTile(d.id, 'aad-tile is-vt');
    ic.append(t0);
    b.append(ic, el('span', 'aad-vtn', { text: name }));
    if (n) b.append(el('b', 'aad-vtb', { 'aria-hidden': 'true', text: n }));
    if (!pinned) {
      const x = el('button', 'aad-vtx', { type: 'button', tabindex: '-1', 'aria-label': `Close ${name}`, title: 'Close (⌥W)' }); x.append(icon('x', 'aad-ico aad-vtx-i'));
      api.listen(x, 'click', e => { e.stopPropagation?.(); closeDesk(d); });
      b.append(x);
    }
    // a pin not open: a click opens it (as the panel)
    const pick = () => (open ? pickVt(d) : goApp(d.id));
    api.listen(b, 'click', () => { if (Date.now() < dragSwallow) return; pick(); });
    api.listen(b, 'auxclick', e => { if (e.button === 1 && !pinned) { e.preventDefault?.(); closeDesk(d); } });
    api.listen(b, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); pick(); return; }
      if (e.key === 'Delete' && !pinned) { e.preventDefault?.(); closeDesk(d); return; }
      const all = [...vtList.querySelectorAll('.aad-vtab')], i = all.indexOf(b), j = { ArrowDown: i + 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
      if (j != null && all[j]) { e.preventDefault?.(); all[j].focus?.(); }
    });
    api.listen(b, 'contextmenu', e => { e.preventDefault?.(); openAppMenu({ id: d.id, name, ...(open ? { desk: d.desk } : {}), system: !!metaOf(d.id).system, col: colPlace(d, pinned) }, { x: e.clientX, y: e.clientY, el: b }); });
    b.dataset.group = pinned ? 'pin' : 'open';
    // (round 18 item 3c: ⌥1–9, ⌥[ ] and ⌥⇧[ ] reach the rows through these)
    b.__pick = pick; b.__move = dir => { const c = colPlace(d, pinned), i = c.index + dir; if (c.index >= 0 && i >= 0 && i < c.n) dropTo({ id: d.id, desk: open ? d.desk : null }, { group: c.group, index: i }); };
    return b;
  }
  /** a row's place in the column: its group, index and the group's size (the menu's Move up / Move down) */
  function colPlace(d, pinned) {
    const { others } = vtTabs();
    return pinned ? { group: 'pin', index: aadVars.pins.indexOf(d.id), n: aadVars.pins.length } : { group: 'open', index: others.findIndex(x => x.desk === d.desk), n: others.length };
  }
  /** Move one row of the column (a drop, or Move up / down): the pin order, and / or the desks' order (stock moveDesk) */
  function dropTo(item, to) {
    const { others } = vtTabs(), O0 = others.map(d => d.desk);
    if (item.id === CHATS && to.group === 'pin') return false;   // (a Chats desk is never a pin)
    const r = vtMove(aadVars.pins, O0, item, to);
    const pinsChanged = r.pins.join() !== aadVars.pins.join(), openChanged = r.open.join() !== O0.filter(x => x !== item.desk).join();
    if (openChanged) orderDesks(r.open);
    if (pinsChanged) setPins(r.pins); else paintVt(true);
    return pinsChanged || openChanged;
  }
  /** the open apps in this order: the desks themselves move (only those that must), so the column stays 1:1 with Desks */
  function orderDesks(want) {
    aadVars.manual = true; api.storage.set('vtManual', true);
    const all = desks(), max = Math.max(-1, ...all.map(d => d.desk), ...want);
    const plan = relMoves(Array.from({ length: max + 1 }, (_, i) => i), want);
    for (const [from, to] of plan.moves) if (!api.desks.move?.(from, to)) break;
    if (aadVars.pane) { const i = plan.order.indexOf(Number(aadVars.pane.desk)); if (i >= 0) aadVars.pane = { ...aadVars.pane, desk: i }; }
    api.after(0, () => { paintVt(true); paintTop(); });
  }
  /* ---------- round 16 item 6: drag a row (press and hold, or a drag past 5 px) ---------- */
  const DRAG_PX = 5, DRAG_HOLD_MS = 350;
  let drag = null, dragSwallow = 0;
  const dropLine = el('i', 'aad-vtdrop', { 'aria-hidden': 'true' }); dropLine.hidden = true;
  vtList.append?.(dropLine);
  function dragStart() {
    const g = drag; if (!g || g.on) return; g.on = true; g.hold?.(); g.hold = null;
    g.offBack = api.back.push(() => dragEnd(false));
    try { vtList.setPointerCapture?.(g.pid); } catch (_) {}
    const rows = [...vtList.querySelectorAll('.aad-vtab')], i = rows.indexOf(g.b);
    g.rows = rows; g.oi = i; g.rects = rows.map(r => r.getBoundingClientRect());
    g.pinBefore = rows.filter(r => r.dataset.group === 'pin').length;
    g.sep = vtList.querySelector('.aad-vtsep'); g.pitch = (g.rects[i]?.height || 36) + 2;
    const fp = g.rects[g.pinBefore], lp = g.rects[g.pinBefore - 1];
    g.S = fp && lp ? Math.max(0, fp.top - lp.top - g.pitch) : 0;
    g.top0 = g.rects[0]?.top || 0;
    vtList.dataset.drag = ''; g.b.classList.add('is-drag'); dropLine.hidden = false;
  }
  const yOf = (g, k, pinned) => g.top0 + k * g.pitch + (k >= pinned ? g.S : 0);
  /** where the dragged row would land for a pointer at y: { group, index } */
  function dragTarget(g, y) {
    const rest = g.rows.filter(r => r !== g.b), pp = rest.filter(r => r.dataset.group === 'pin').length;
    const mid = r => { const b = g.rects[g.rows.indexOf(r)]; return b.top + b.height / 2; };
    const k = rest.filter(r => mid(r) < y).length;
    let to;
    if (k < pp) to = { group: 'pin', index: k };
    else if (k > pp) to = { group: 'open', index: k - pp };
    else {
      const s = g.sep?.getBoundingClientRect?.(), last = rest[pp - 1], first = rest[pp];
      const edge = s && s.height ? s.top + s.height / 2 : last ? g.rects[g.rows.indexOf(last)].bottom + 6 : first ? g.rects[g.rows.indexOf(first)].top - 6 : y;
      to = y < edge ? { group: 'pin', index: pp } : { group: 'open', index: 0 };
    }
    if (g.b.dataset.app === CHATS && to.group === 'pin') to = { group: 'open', index: 0 };
    return { to, pp };
  }
  function dragMove(y) {
    const g = drag; if (!g?.on) return;
    g.y = y; g.b.style.translate = `0px ${Math.round(y - g.y0)}px`;
    const { to, pp } = dragTarget(g, y); g.to = to;
    const ins = to.group === 'pin' ? to.index : pp + to.index, pinAfter = pp + (to.group === 'pin' ? 1 : 0);
    let j2 = 0;
    g.rows.forEach((r, j) => {
      if (r === g.b) return;
      const k = j2 < ins ? j2 : j2 + 1; j2++;
      const dy = Math.round(yOf(g, k, pinAfter) - yOf(g, j, g.pinBefore));
      r.style.translate = dy ? `0px ${dy}px` : '';
    });
    if (g.sep) { const dy = (pinAfter - g.pinBefore) * g.pitch; g.sep.style.translate = dy ? `0px ${dy}px` : ''; }
    const box = vtList.getBoundingClientRect?.() || { top: 0 };
    dropLine.style.translate = `0px ${Math.round(yOf(g, ins, pinAfter) - box.top + (vtList.scrollTop || 0) - 2)}px`;
  }
  function dragEnd(commit) {
    const g = drag; drag = null; if (!g) return false;
    g.offBack?.();
    g.hold?.();
    if (!g.on) return false;
    for (const r of g.rows) r.style.translate = ''; if (g.sep) g.sep.style.translate = '';
    g.b.classList.remove('is-drag'); delete vtList.dataset.drag; dropLine.hidden = true;
    try { vtList.releasePointerCapture?.(g.pid); } catch (_) {}
    dragSwallow = Date.now() + 400;
    if (!commit || !g.to) return true;
    const d = { desk: g.b.dataset.desk != null ? Number(g.b.dataset.desk) : null, id: g.b.dataset.app };
    dropTo(d, g.to);
    return true;
  }
  api.listen(vtList, 'pointerdown', e => {
    if (e.button || drag || one()) return;   // (the app bar: reordering by its menu's Move left / right; drag is the column's)
    const b = e.target?.closest?.('.aad-vtab'); if (!b || e.target.closest?.('.aad-vtx, .aad-np')) return;
    drag = { b, pid: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, on: false, to: null, hold: null };
    drag.hold = api.after(DRAG_HOLD_MS, () => { if (drag && !drag.on) { dragStart(); dragMove(drag.y); } });
  });
  api.listen(vtList, 'pointermove', e => {
    const g = drag; if (!g) return;
    if (!g.on) { if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_PX) return; dragStart(); }
    dragMove(e.clientY);
  });
  api.listen(vtList, 'pointerup', () => dragEnd(true));
  api.listen(vtList, 'pointercancel', () => dragEnd(false));
  api.listen(vtList, 'lostpointercapture', () => { if (drag?.on) dragEnd(true); });
  function paintVt(force = false) {
    // (the narrower window's app bar, ONE: its own look, never the folded rail's; the fold choice is kept for wide)
    const bar = one(), mode = bar ? 'bar' : aadVars.vtFolded ? 'rail' : 'open';
    if (root.dataset.aadTabs !== mode) { root.dataset.aadTabs = mode; applySizes(); }
    paintOneChats(); if (vtTog.hidden !== bar) vtTog.hidden = bar;
    vtTog.setAttribute('aria-expanded', String(!aadVars.vtFolded));
    // (⌥R folds the right side: with the sides swapped, wizard-ux issue 1526, this column is on the left, so ⌥L)
    const vtKey = root.dataset.aadPaneSide === 'end' ? '⌥L' : '⌥R';
    vtTog.setAttribute('aria-label', aadVars.vtFolded ? 'Show the apps\' names' : 'Fold the apps to icons'); vtTog.title = aadVars.vtFolded ? `Expand (${vtKey})` : `Fold to icons (${vtKey})`;
    const { pinned, others } = vtTabs();
    const inst = bar ? [] : installsShown(pinned, others);
    const sig = JSON.stringify([mode, frontDesk() ?? '', pinned.map(d => d.desk + d.id + d.name + badgeText(d.id)), others.map(d => d.desk + d.id + d.name + badgeText(d.id)), inst.map(r => r.id + r.state + r.name)]);
    if (!force && sig === aadVars.vtDrawn && vtList.childElementCount) return; aadVars.vtDrawn = sig;
    const out = pinned.map(d => vtTab(d, true));
    if (pinned.length && others.length) out.push(el('hr', 'aad-vtsep', { 'aria-hidden': 'true' }));
    out.push(...others.map(d => vtTab(d, false)));
    out.push(...inst.map(vtInstall));
    if (!out.length) out.push(el('p', 'aad-vtnone', { text: 'No apps open.' }));
    if (drag) dragEnd(false);
    // the app bar: Chats and the first half of the apps left of the orb, the rest and All apps right of it (the phone's
    // orb bar: the orb in one spot, the items either side of it)
    // (Chats and All apps count too; an odd count gets an empty spot on the right, so the orb sits at the bar's centre)
    if (bar) {
      const rows = out.filter(n => n.classList?.contains('aad-vtab')), all = rows.length + 2, left = Math.ceil(all / 2) - 1;
      rows.forEach((n, i) => { n.dataset.half = i < left ? 'l' : 'r'; });
      if (all % 2) out.push(el('i', 'aad-vtfill', { 'aria-hidden': 'true', 'data-half': 'r' }));
    }
    vtList.setAttribute('aria-orientation', bar ? 'horizontal' : 'vertical');
    vtList.replaceChildren(...out, dropLine);
    markMedia();
  }
  /* An app being installed (wizard-os#682, switch wizard/install-in-sidebar, off by default): core/apps.js
   * WizCore.installs follows each Store Get on the box, also once the Store is closed; each shows here after the open
   * apps, with a spinner on its icon while it installs. Done, it is the app (not open yet: a click opens it, ✕ forgets
   * it); failed, it says so (a click shows the Store). An app already pinned or open is its own row. These rows are
   * not .aad-vtab, so dragging and ⌥1–9 never see them; the narrower window's app bar leaves them out. */
  const installsOf = () => { try { return globalThis.WizCore?.installs || null; } catch (_) { return null; } };
  function installsShown(pinned, others) {
    const I = installsOf(), list = I?.list?.() || []; if (!list.length) return [];
    const shown = new Set([...pinned, ...others].map(d => d.id));
    for (const r of list) if (shown.has(r.id) && r.state !== 'installing') api.after(0, () => I.dismiss?.(r.id));   // opened: it is its own row now
    return list.filter(r => !shown.has(r.id));
  }
  function vtInstall(r) {
    const busy = r.state === 'installing', failed = r.state === 'failed', word = busy ? 'Installing…' : failed ? 'Couldn’t install' : 'Installed';
    const b = el('div', 'aad-vtinst is-' + (busy ? 'installing' : failed ? 'failed' : 'ready'), { role: 'button', tabindex: '0', 'data-app': r.id, 'aria-busy': String(busy),
      title: busy ? `${r.name} is installing. You can close the App Store.` : failed ? `${r.name}: ${r.error || 'the install did not finish'}` : `Open ${r.name}`,
      'aria-label': `${r.name}, ${word}` });
    const ic = el('span', 'aad-vti'); ic.append(appTile(r.id, 'aad-tile is-vt'));
    if (busy) ic.append(el('i', 'aad-vtspin', { 'aria-hidden': 'true' }));
    const words = el('span', 'aad-vtw'); words.append(el('span', 'aad-vtn', { text: r.name }), el('span', 'aad-vtst', { text: busy ? 'Installing…' : failed ? 'Couldn’t install' : 'Ready to open' }));
    b.append(ic, words);
    if (!busy) {
      const x = el('button', 'aad-vtx', { type: 'button', tabindex: '-1', 'aria-label': `Hide ${r.name}`, title: 'Hide' }); x.append(icon('x', 'aad-ico aad-vtx-i'));
      api.listen(x, 'click', e => { e.stopPropagation?.(); installsOf()?.dismiss?.(r.id); });
      b.append(x);
    }
    const pick = () => { if (busy || failed) { goApp('app-store'); return; } installsOf()?.dismiss?.(r.id); goApp(r.id); };
    api.listen(b, 'click', pick);
    api.listen(b, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); pick(); } });
    return b;
  }
  api.listen(globalThis, 'wizard:installs', () => paintVt());
  /* narrower window (ONE): Chats, the app bar's first item, lit while Chats is in front; its badge: chats waiting */
  function paintOneChats() {
    const on = one(), front = on && !aadVars.pane, n = on ? badgeText(CHATS) : '';
    if (vOne.hidden === on) vOne.hidden = !on;
    vChats.classList.toggle('is-on', front); vChats.setAttribute('aria-pressed', String(front));
    if (front) vChats.setAttribute('aria-current', 'page'); else vChats.removeAttribute('aria-current');
    if (vChatsN.textContent !== n) vChatsN.textContent = n; vChatsN.hidden = !n;
    const label = 'Chats' + (n ? `, ${n} new` : ''); if (vChats.getAttribute('aria-label') !== label) vChats.setAttribute('aria-label', label);
  }
  /** Chats from the column: from an app, Chats as it was (the open chat, else the list); Chats in front again, its first
   * view (the list, and at half width a new chat beside it) */
  function oneChats() {
    if (!one()) return;
    closeAll(); closeMenu();
    if (aadVars.pane) { aadVars.oneList = !behindThread(); hidePanel(); return; }
    if (oneSplit()) { if (aadVars.docked) closeChat(); } else { aadVars.oneList = true; paintTop(); }
  }
  api.listen(vChats, 'click', oneChats);
  api.listen(vChats, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); oneChats(); } });
  /** the app last in front, while its desk is still open (Back from the chats list goes there) */
  const oneApp = () => aadVars.oneLast && desks().some(d => d.desk === aadVars.oneLast.desk && d.id === aadVars.oneLast.id) ? aadVars.oneLast : null;
  api.listen(oneBack, 'click', () => { if (!one()) return; if (aadVars.chatThread === FEED) closeChat(); aadVars.oneList = true; paintTop(); });
  function toggleTabs() { focusLeave(); aadVars.vtFolded = !aadVars.vtFolded; api.storage.set('tabsFolded', aadVars.vtFolded); flip([top, orbBox, ...shownDesks()], () => paintVt(true)); retileSoon(); }
  api.listen(vtTog, 'click', toggleTabs);
  /** a tab: its app as the panel; the one in front again hides the panel (the desk stays open) */
  function pickVt(d) {
    // narrower window (ONE): the app in front stays in front (one app at a time; Chats is the bar's first item) and goes
    // back to its top level, the phone's tap on the tab you are on
    if (one() && aadVars.pane && Number(aadVars.pane.desk) === d.desk) { if (!homeOn() || !appHome()) appTop(); return; }
    // The chat docked beside the panel has the keyboard (a reply was just sent there): the panel's tab brings its app
    // forward, never hides it out from under the pointer (James, 6 Nov 2026: "Messenger became unclickable").
    const chatHasIt = !!aadVars.pane && aadVars.docked && Number(api.route().desk) !== d.desk;
    if (frontDesk() === d.desk && !chatHasIt) { if (aadVars.pane) hidePanel(); else goHome(); return; }
    if (d.id === CHATS) { closeAll(); api.nav.goDesk(d.desk); return; }
    goApp(d.id, d.desk);
  }
  /** the app in front at its top level: its own Back, step by step, until it says it is at its root (never past it:
   * the app stays open); a sandboxed app answers later, so one step there */
  function appTop() {
    const f = paneFrame(), S = globalThis.WizAppServices; if (!f || !S?.back) return;
    for (let i = 0; i < 12; i++) if (S.back(f) !== 'handled') break;
  }
  /* Tapping the app in front takes it to its first view (wizard-ux issue 1332, switch wizard/app-tap-home, off by
   * default): the app's own Home (WizardApp.nav.onHome, else all its Back steps at once, also under the browser
   * boundary), never a reload; false = this app has no Home, so appTop's Back steps run as before. */
  const homeOn = () => { try { return String(globalThis.document?.documentElement?.dataset?.tweaks || '').split(' ').includes('wizard/app-tap-home'); } catch (_) { return false; } };
  function appHome() {
    const f = paneFrame(), S = globalThis.WizAppServices; if (!f || typeof S?.home !== 'function') return false;
    return S.home(f) !== 'unsupported';
  }
  function closeDesk(d) {
    if (aadVars.pane && Number(aadVars.pane.desk) === d.desk) { aadVars.pane = null; setWide(false); }
    if (!(api.desks.close?.(d.desk))) api.apps.close?.(d.id);
    api.after(120, () => { paintVt(true); paintTop(); });
  }

  /* App surfaces are host-owned; late tools and companion windows use its
   * coalesced lifecycle subscription, never Classic markup mutations. */
  function paintTools() {
    pTools.hidden = !host?.renderTools(panelWindow()?.id, pTools);
  }
  return { closeDesk, dropTo, oneApp, paintOneChats, paintTools, paintVt, toggleTabs, bindLate: v => { if ('closeChat' in v) closeChat = v.closeChat; if ('here' in v) here = v.here; if ('hidePanel' in v) hidePanel = v.hidePanel; if ('markMedia' in v) markMedia = v.markMedia; if ('paintTop' in v) paintTop = v.paintTop; if ('setWide' in v) setWide = v.setWide; } };
}
