/* WizardOS · text selection menu (James, 12 Oct 2026)
 *
 * Long-press words in a chat and WizardOS shows its own small menu above them instead of Android's
 * Copy / Share / Select all toolbar. The items are chosen in Settings → Text selection menu:
 *   Copy · Share (Android's share sheet, "From the configured wizard:" over the words when they are his) · Quote (into this
 *   thread's reply box) · Look up (core/lookup-pop.js: a fast AI explains the words in their message) · Search (Wizard Search) · Select all (the whole message).
 *
 * Shared in-page browser selection actions; native Android suppression is an optional adapter.
 * The browser may still provide its own system selection toolbar. Editable fields and hosted apps
 * keep their own Paste/selection behavior. External-app text requires native accessibility.
 *
 *   WosSelMenu.back()      → 'selection' when Back closed the menu (and cleared the selection), else ''
 *   WosSelMenu.html()      → the Settings group;  WosSelMenu.act(el) → handles a tap inside it
 *   WosSelMenu.state       → QA probe { open, items, text, moved }
 *
 * Drag to move (James, 12 Oct): press anywhere on the menu (the ⋮⋮ grip shows it) and slide it off the words you
 * want to read. It stays where it was dropped, clamped on screen, through scrolls and handle drags, until that
 * selection ends; the next selection places it above the words again. A press that moves under 6 px is still a tap.
 *
 * Any word starts a selection (issue 1708): Chrome only selects on a long-press that lands on a glyph, so a short word
 * ("a", "it") or the space beside it selected nothing. A still touch hold on readable text that Chrome left alone
 * selects the word under the finger (or the nearest word on that line) here, and dragging before lifting extends it
 * word by word. Chrome's own selection always wins.
 */
(() => {
  'use strict';
  const KEY = 'wos.selmenu';
  const ITEMS = [
    { id: 'copy', label: 'Copy', icon: '<path d="M9 9h10v11H9zM5 15V4h10"/>', note: 'Puts the words on the clipboard' },
    { id: 'share', label: 'Share', icon: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>', note: 'Device share sheet when supported; otherwise Copy' },
    { id: 'quote', label: 'Quote', icon: '<path d="M5 18h14M5 6h4M5 12h8M15 6l4 6-4 6"/>', note: 'Into this thread’s reply box, as a quote' },
    { id: 'lookup', label: 'Look up', icon: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>', note: 'A fast AI explains the words in their message' },
    { id: 'search', label: 'Search', icon: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>', note: 'Wizard Search, with an AI overview' },
    { id: 'all', label: 'Select all', icon: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 9h8M8 12h8M8 15h5"/>', note: 'The whole message' },
  ];
  const DEFAULT = ['copy', 'share', 'quote', 'lookup', 'search', 'all'];
  const KNOWN0 = ['copy', 'share', 'quote', 'search', 'all']; // the items a list saved before Look up existed was choosing from
  const N = () => window.WizardOSNative || null;
  const own = () => { const n = N(); return typeof window.getSelection === 'function'; };
  const tell = s => { try { const n = N(); if (n && typeof n.selection === 'function') n.selection(s); } catch (e) {} };
  const host = () => window.__wos || window.__wux;
  const toast = (i, t, ms) => host()?.toast?.(i, t, ms);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Product name: WizardOS, always one word (James, 8 Nov 2026; wizard-os#436).
  const OS = () => 'WizardOS';
  const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const EDIT = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  // A saved choice only decides the items it was choosing from: an item added later (Look up) starts on.
  function enabled() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (Array.isArray(v)) { let known = KNOWN0; try { const k = JSON.parse(localStorage.getItem(KEY + '.known') || 'null'); if (Array.isArray(k)) known = k; } catch (e) {} return ITEMS.map(i => i.id).filter(id => v.includes(id) || !known.includes(id)); }
    } catch (e) {}
    return DEFAULT.slice();
  }
  function setEnabled(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); localStorage.setItem(KEY + '.known', JSON.stringify(ITEMS.map(i => i.id))); } catch (e) {} }

  let el = null, cur = null, settleT = 0, down = false, scrolling = 0, selectionPress = null;
  let pos = null, drag = null, dragged = false; // pos: where the user dropped the menu for this selection
  const DRAG_PX = 6;
  function mount() {
    if (el) return el;
    el = document.createElement('div'); el.className = 'selmenu'; el.setAttribute('role', 'menu'); el.hidden = true;
    // Keep the selection: a press on the menu must never move focus or collapse it.
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) el.addEventListener(t, e => { e.stopPropagation(); if (e.cancelable && t !== 'touchstart') e.preventDefault(); }, { passive: t === 'touchstart' });
    // Drag to move: press anywhere on the menu and slide.
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      dragged = false; // a fresh press: its click is a real tap unless it turns into a drag
      const r = el.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, l: r.left, t: r.top, on: false };
    });
    el.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.on && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!drag.on) { drag.on = true; el.classList.add('drag'); clearTimeout(settleT); try { el.setPointerCapture(e.pointerId); } catch (err) {} } // capture only once it is a drag: a tap keeps its button
      e.preventDefault();
      pos = clampPos(drag.l + dx, drag.t + dy); paint(pos);
    });
    // A press that never became a drag is a tap: run its button on release (the click that may follow is swallowed),
    // so taps work the same whether or not the WebView turns this press into a click.
    const end = (e, up) => {
      if (!drag || e.pointerId !== drag.id) return;
      const was = drag; drag = null;
      if (e.wosShareHeld) return; // the shared Share gesture already ran this action
      if (was.on) { dragged = true; el.classList.remove('drag'); return; } // the drop is not a tap
      const b = up && document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.selmenu [data-sm]');
      if (b) { swallowClick(); run(b.dataset.sm); }
    };
    // The tap already ran on release, and the menu hides at once. The click that follows the same touch would land on
    // whatever the action just opened (Search's sheet scrim closed it at once: "it just refreshes"), so eat it anywhere.
    function swallowClick() {
      const eat = e => { off(); e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const off = () => { clearTimeout(t); document.removeEventListener('click', eat, true); };
      document.addEventListener('click', eat, true);
      const t = setTimeout(off, 700);
    }
    el.addEventListener('pointerup', e => end(e, true)); el.addEventListener('pointercancel', e => end(e, false));
    el.addEventListener('click', e => {
      if (dragged) { dragged = false; e.preventDefault(); e.stopPropagation(); return; } // already handled on release
      const b = e.target.closest('[data-sm]'); if (b) { e.preventDefault(); e.stopPropagation(); run(b.dataset.sm); } // keyboard / a11y
    });
    document.body.appendChild(el);
    return el;
  }
  const safeTop = () => 8 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0);
  function clampPos(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight, mw = el.offsetWidth, mh = el.offsetHeight;
    return { x: Math.round(Math.max(8, Math.min(vw - mw - 8, x))), y: Math.round(Math.max(safeTop(), Math.min(vh - mh - 8, y))) };
  }
  const paint = p => { el.style.transform = `translate(${p.x}px, ${p.y}px)`; };

  const elOfNode = n => n && (n.nodeType === 1 ? n : n.parentElement);
  function current() {
    const s = window.getSelection?.(); if (!s || s.isCollapsed || !s.rangeCount) return null;
    const text = String(s).replace(/\u00a0/g, ' ').trim(); if (!text) return null;
    const a = elOfNode(s.anchorNode), f = elOfNode(s.focusNode);
    if (!a || !f || a.closest(EDIT) || f.closest(EDIT) || a.closest('.selmenu')) return null;
    const range = s.getRangeAt(0);
    const thread = a.closest('.ch-thread') && a.closest('[data-chats]');
    const mine = !!a.closest('.msg.u') && !!f.closest('.msg.u'); // James's own words carry no "From Archimedes"
    const block = a.closest('.msg .bub, .note-line, .appr pre, .cx-text, .wk-steps li, .wk-plan li, p, li') || a;
    return { text, range, wid: thread ? thread.dataset.chats : '', mine, block, lk: !!window.WosLookup?.holds?.(range.commonAncestorContainer) };
  }

  function show() {
    if (!own()) return hide();
    const c = current(); if (!c) return hide(true);
    tell(3); cur = c;
    if (window.WosLookup?.isOpen && !c.lk) return hide(); // the Look up popover owns the words; its Back brings this menu back
    const ids = enabled().filter(id => id !== 'quote' || c.wid).filter(id => id !== 'search' || (host()?.openSearch && host()?.canSearch?.())).filter(id => id !== 'lookup' || lookupOk(c));
    if (!ids.length) return hide();
    const m = mount();
    m.innerHTML = `<span class="sm-grip" data-smgrip aria-label="Drag to move" title="Drag to move">${svg('<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>')}</span>`
      + ids.map(id => { const it = ITEMS.find(i => i.id === id); return `<button type="button" role="menuitem" data-sm="${id}">${svg(it.icon)}<span>${esc(it.label)}</span></button>`; }).join('');
    m.hidden = false; m.classList.remove('on'); m.classList.toggle('tight', ids.length > 5); // six or seven items need the narrower buttons on a phone
    place(); requestAnimationFrame(() => m.classList.add('on'));
  }
  // Look up: words in a chat message (not in the popover itself), never in a private or Incognito thread.
  function lookupOk(c) {
    if (c.lk || !window.WosLookup?.open) return false;
    if (!c.wid && !c.block?.closest?.('.msg')) return false;
    // Fail closed: a chat selection whose thread scope cannot be resolved (or is private) never offers Look up.
    try { if (c.wid) { const s = host()?.chats?.lookupScope?.(c.wid); if (!s || s.private) return false; } } catch (e) { return false; }
    return true;
  }
  function place() {
    if (!el || el.hidden || !cur) return;
    if (pos) { el.classList.remove('off'); pos = clampPos(pos.x, pos.y); paint(pos); return; } // where the user put it
    const rects = [...cur.range.getClientRects()].filter(r => r.width || r.height);
    const r = rects.length ? rects.reduce((a, b) => ({ top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) })) : cur.range.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, mw = el.offsetWidth, mh = el.offsetHeight, gap = 12;
    if (r.bottom < 0 || r.top > vh) { el.classList.add('off'); return; }
    el.classList.remove('off');
    let top = r.top - mh - gap;
    const st = safeTop();
    if (top < st) top = Math.min(vh - mh - 8, r.bottom + 34); // below the selection, clear of the handles
    const left = Math.max(8, Math.min(vw - mw - 8, (r.left + r.right) / 2 - mw / 2));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(st, top))}px)`;
  }
  function hide(selectionGone) {
    if (selectionGone) tell(0);
    if (el && !el.hidden) { el.hidden = true; el.classList.remove('on'); }
    if (selectionGone) { cur = null; pos = null; drag = null; if (el) el.classList.remove('drag'); }
  }
  const clear = () => { try { window.getSelection().removeAllRanges(); } catch (e) {} hide(true); };

  async function run(id) {
    const c = cur || current(); if (!c) return hide(true);
    const KIT = window.WosChat || host()?.chat;
    if (id === 'copy') { const ok = await KIT.copyText(c.text); clear(); toast(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy', 1400); return; }
    if (id === 'share') {
      const r = await (c.mine ? KIT.shareText(c.text) : KIT.shareAssistantText(c.text)); clear();
      if (r === 'copied') toast('⧉', 'Copied · sharing isn’t available here', 1800); else if (r === 'failed') toast('!', 'Couldn’t share', 1800);
      return;
    }
    if (id === 'quote') {
      const q = c.text.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      clear(); if (!host()?.chats?.insertText(c.wid, q)) toast('!', 'Open the thread to quote', 1600);
      return;
    }
    if (id === 'lookup') {
      // Paint first: the popover opens on this tap's frame; the words stay selected under it, only the menu steps aside.
      const L = window.WosLookup, cx = L.contextOf(c.range); let sc = {};
      if (c.wid) { try { sc = host()?.chats?.lookupScope?.(c.wid); } catch (e) { sc = null; } if (!sc || sc.private) return hide(); } // re-checked at the tap, never sent unscoped
      hide(); L.open({ text: c.text, before: cx.before, after: cx.after, frame: sc.frame || '', agent: sc.agent || '', session: sc.session || '', range: c.range });
      return;
    }
    if (id === 'search') { const q = c.text.replace(/\s+/g, ' ').slice(0, 200); clear(); host().openSearch(q, 'all'); return; }
    if (id === 'all') {
      const b = c.block.closest('.bub') || c.block; const r = document.createRange(); r.selectNodeContents(b);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); settle(0); return;
    }
  }

  function settle(ms) { clearTimeout(settleT); settleT = setTimeout(() => { if (!down && !scrolling && !lp?.on) show(); }, ms); }

  /* ---- Long-press on any word (issue 1708) ---- */
  const LP_MS = 600, LP_SLOP = 8, LP_NEAR = 28;
  const NOT_TEXT = EDIT + ', a[href], button, img, video, svg, canvas, [role="button"], .selmenu';
  const BLOCK = 'p, li, pre, td, th, h1, h2, h3, h4, h5, h6, blockquote, .bub, .an-body, .rc-body, .note-line, .lk-body, .lk-term, .mv-doc';
  let lp = null; // the touch hold being watched: { id, x, y, t, snap, on, a: anchor word, set: what we selected }
  function readable(e) {
    if (!e || e.closest(NOT_TEXT)) return false;
    const cs = getComputedStyle(e), us = cs.userSelect || cs.webkitUserSelect;
    return us === 'text' || us === 'all';
  }
  function caretAt(x, y) {
    const r = document.caretRangeFromPoint?.(x, y);
    if (r) return { node: r.startContainer, off: r.startOffset };
    const p = document.caretPositionFromPoint?.(x, y);
    return p ? { node: p.offsetNode, off: p.offset } : null;
  }
  let SEG = null;
  function words(t) {
    if (SEG === null) { try { SEG = new Intl.Segmenter(undefined, { granularity: 'word' }); } catch (e) { SEG = false; } }
    if (SEG) return [...SEG.segment(t)].filter(g => g.isWordLike).map(g => ({ i: g.index, j: g.index + g.segment.length }));
    return [...t.matchAll(/[\p{L}\p{N}\p{M}_'’]+/gu)].map(m => ({ i: m.index, j: m.index + m[0].length }));
  }
  // The word under (x, y), or the nearest word on that line within LP_NEAR px, in the readable block under the point.
  function wordAt(x, y) {
    const c = caretAt(x, y); if (!c) return null;
    const host = elOfNode(c.node); if (!readable(host)) return null;
    const block = host.closest(BLOCK) || host;
    const r = document.createRange(), onLine = q => y >= q.top - 2 && y <= q.bottom + 2;
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let best = null;
    for (let n; (n = walk.nextNode());) {
      if (!n.data.trim() || !readable(n.parentElement)) continue;
      r.selectNodeContents(n); if (![...r.getClientRects()].some(onLine)) continue;
      for (const w of words(n.data)) {
        r.setStart(n, w.i); r.setEnd(n, w.j);
        for (const q of r.getClientRects()) {
          if (!onLine(q)) continue;
          const d = x < q.left ? q.left - x : x > q.right ? x - q.right : 0;
          if (!best || d < best.d) best = { d, node: n, i: w.i, j: w.j };
        }
      }
    }
    return best && best.d <= LP_NEAR ? best : null;
  }
  const selSnap = () => { const s = window.getSelection?.(); return s && !s.isCollapsed ? [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset].join('\u0000') + String(s) : ''; };
  const sameSel = set => { const s = window.getSelection?.(); return !!s && s.anchorNode === set[0] && s.anchorOffset === set[1] && s.focusNode === set[2] && s.focusOffset === set[3]; };
  function lpSelect(set) {
    lp.set = set;
    try { window.getSelection().setBaseAndExtent(set[0], set[1], set[2], set[3]); } catch (e) {}
  }
  function lpFire() {
    const g = lp; if (!g || g.on) return;
    const now = selSnap(); if (now && now !== g.snap) { lp = null; return; } // Chrome started its own selection: leave it
    const w = wordAt(g.x, g.y); if (!w) { lp = null; return; }
    g.on = true; g.a = w; selectionPress = null; // our selection must survive the lift
    window.addEventListener('touchmove', lpDrag, { capture: true, passive: false });
    lpSelect([w.node, w.i, w.node, w.j]); tell(3);
  }
  function lpDrag(e) {
    const g = lp; if (!g?.on) return;
    const t = [...e.touches].find(t => t.identifier === g.id); if (!t) return;
    // The finger is selecting: no scroll, and no page gesture below (thread swipe-back would slide the thread away
    // on a drag right along the line and close it on lift).
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    const w = wordAt(t.clientX, t.clientY); if (!w) return;
    const a = g.a, before = w.node === a.node ? w.i < a.i : !!(a.node.compareDocumentPosition(w.node) & Node.DOCUMENT_POSITION_PRECEDING);
    const set = before ? [a.node, a.j, w.node, w.i] : [a.node, a.i, w.node, w.j];
    if (!sameSel(set)) lpSelect(set);
  }
  function lpEnd(show) {
    const g = lp; lp = null; if (!g) return;
    clearTimeout(g.t); window.removeEventListener('touchmove', lpDrag, true);
    if (g.on && show) settle(120);
  }
  function bindHold() {
    document.addEventListener('touchstart', e => {
      lpEnd(false);
      if (e.touches.length !== 1 || !own()) return;
      const t = e.touches[0], tg = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
      if (!tg || tg.closest(NOT_TEXT)) return;
      lp = { id: t.identifier, x: t.clientX, y: t.clientY, snap: selSnap(), on: false, a: null, set: null };
      lp.t = setTimeout(lpFire, LP_MS);
    }, { capture: true, passive: true });
    document.addEventListener('touchmove', e => {
      const g = lp; if (!g || g.on) return;
      const t = [...e.touches].find(t => t.identifier === g.id);
      if (!t || e.touches.length > 1 || Math.hypot(t.clientX - g.x, t.clientY - g.y) > LP_SLOP) lpEnd(false);
    }, { capture: true, passive: true });
    document.addEventListener('touchend', () => lpEnd(true), true);
    document.addEventListener('touchcancel', () => lpEnd(true), true);
    document.addEventListener('scroll', () => { if (lp && !lp.on) lpEnd(false); }, true);
    // Chrome took the selection over (its own long-press arrived late): stop steering it.
    document.addEventListener('selectionchange', () => { if (lp?.on && lp.set && !sameSel(lp.set)) { window.removeEventListener('touchmove', lpDrag, true); lp.on = false; } });
  }

  function bind() {
    if (bind.done) return; bind.done = true;
    bindHold();
    document.addEventListener('pointerdown', e => {
      if (e.target.closest?.('.selmenu, .wos-lookup')) return; // the Look up popover keeps the words selected under it
      down = true;
      if (!own()) return;
      tell(e.target.closest?.(EDIT) ? 2 : 1);
      // Include the temporary hidden state while selectionchange settles. Otherwise
      // the menu can return after an outside tap. Keep handle drags on the block.
      selectionPress = cur ? { x: e.clientX, y: e.clientY } : null;
      if (cur) {
        if (!cur.block?.contains(e.target)) { clear(); selectionPress = null; }
        else hide();
      }
    }, true);
    const up = e => {
      if (!down) return;
      down = false;
      // A tap on the selected block is outside the menu too; an actual handle
      // drag keeps the selection and brings its menu back once it settles.
      if (selectionPress && e.type === 'pointerup' && Math.hypot(e.clientX - selectionPress.x, e.clientY - selectionPress.y) < DRAG_PX) clear();
      selectionPress = null; settle(180);
    };
    document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    // Android's long-press ends in pointercancel only; touchend still arrives.
    document.addEventListener('touchend', up, true);
    document.addEventListener('selectionchange', () => {
      if (!own()) return;
      const s = window.getSelection?.();
      if (!s || s.isCollapsed) { hide(true); return; }
      if (el && !el.hidden && !down) hide();
      settle(down ? 400 : 160);
    });
    document.addEventListener('scroll', () => { if (!el || el.hidden && !cur) return; if (pos && !el.hidden) return; /* moved by hand: it stays put */ hide(); clearTimeout(scrolling); scrolling = setTimeout(() => { scrolling = 0; if (cur) show(); }, 220); }, true);
    window.addEventListener('resize', () => place());
    window.addEventListener('blur', () => { if (cur) tell(0); }); // focus went into a hosted app: its own menu applies
  }

  /* ---- Settings ---- */
  function html() {
    const on = enabled(), n = N();
    const sub = own() ? 'Select words in a chat · choose what the menu offers' : n ? `Update the ${OS()} app (0.9.7) to use it` : `Works in the ${OS()} Android app`;
    return `<div class="st-group" data-selmenu><h4>Text selection menu</h4><p class="st-note">${esc(sub)}</p>
      ${ITEMS.map(it => `<button class="st-row" data-smset="${it.id}"><span class="st-tx"><b>${esc(it.label)}</b><small>${esc(it.note)}</small></span><span class="sw ${on.includes(it.id) ? 'on' : ''}"><i></i></span></button>`).join('')}</div>`;
  }
  function act(target) {
    const b = target.closest?.('[data-smset]'); if (!b) return false;
    const id = b.dataset.smset, on = enabled();
    const next = on.includes(id) ? on.filter(x => x !== id) : on.concat(id);
    if (!next.length) { toast('!', 'Keep at least one item', 1400); return true; }
    setEnabled(next);
    const g = b.closest('[data-selmenu]'); if (g) g.outerHTML = html();
    return true;
  }

  function back() { if (cur && el && !el.hidden || cur && !window.getSelection().isCollapsed) { clear(); return 'selection'; } return ''; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
  window.WosSelMenu = { back, html, act, ITEMS, enabled, setEnabled, show, hide, get state() { return { open: !!el && !el.hidden, items: el && !el.hidden ? [...el.querySelectorAll('[data-sm]')].map(b => b.dataset.sm) : [], text: cur?.text || '', own: own(), moved: pos ? { ...pos } : null }; } };
})();
