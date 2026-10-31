/* Wizard OS · the one text selection menu (James, 12 Oct 2026; one menu for every app, 31 Oct 2026)
 *
 * Select words anywhere in Wizard and the shell shows its own small menu above them. This file is the only
 * implementation: Chats, installed apps (Wisdom, Notes…) and any other app document use it. The shell owns the
 * pop-up (placement, drag, Back, tap outside, skins); each surface may add its own items.
 *
 *   Shell items (Settings → Text selection menu chooses which show):
 *     Copy · Share · Reply in chat (a Chats draft beside the app, the words quoted; nothing is sent) · Search
 *   Surface items:
 *     Chats registers Quote (into this thread's reply box) and Select all (the whole message).
 *     An installed app adds its own through WizardApp.selection (core/app-client.js):
 *       WizardApp.selection.items([{ id, label, icon? }], pick)  extra items for ordinary selections in the app
 *       WizardApp.selection.show({ text, rect, items }, pick, dismissed)  an app that draws its own selection
 *         (Wisdom's highlights and handles) hands the shell its words and box; the shell shows the menu
 *       WizardApp.selection.hide()
 *     An app item with a shell item's id replaces it (Wisdom's Copy copies its own exact passage).
 *
 *   WosSelMenu.back()      → 'selection' when Back closed the menu (and let go of the words), else ''
 *   WosSelMenu.html()      → the Settings group;  WosSelMenu.act(el) → handles a tap inside it
 *   WosSelMenu.register(id, { match(node) → ctx|null, items(ctx) → [ids], run(id, ctx) }) → a shell-document surface
 *   WosSelMenu.watch(source) / forget(doc) → app-services.js attaches a verified app document
 *   WosSelMenu.state       → QA probe { open, items, text, moved, app }
 *
 * Idle cost is zero: no polling, intervals or animation loops. Work happens only on selection, pointer, scroll and
 * key events, with one short settle timer after them (PR #751's floating Reply polled; that drained the battery).
 *
 * Drag to move (James, 12 Oct): press anywhere on the menu (the ⋮⋮ grip shows it) and slide it off the words you
 * want to read. It stays where it was dropped, clamped on screen, through scrolls and handle drags, until that
 * selection ends; the next selection places it above the words again. A press that moves under 6 px is still a tap.
 */
(() => {
  'use strict';
  const KEY = 'wos.selmenu';
  const ICON = {
    copy: '<path d="M9 9h10v11H9zM5 15V4h10"/>',
    share: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    reply: '<path d="M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1"/>',
    quote: '<path d="M5 18h14M5 6h4M5 12h8M15 6l4 6-4 6"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    all: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 9h8M8 12h8M8 15h5"/>',
    highlight: '<path d="m9 15 6-10 4 2.5-6 10H9zM5 20h14"/>',
    note: '<path d="M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 16h5"/>',
    ask: '<path d="M4 6h16v10H9l-5 4zM9 10h6"/>',
    lookup: '<circle cx="10" cy="10" r="5"/><path d="m19 19-5.5-5.5M8 10h4"/>',
    remove: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  };
  // Shell items. Quote and Select all belong to Chats (registered below by core/chats.js through register());
  // they stay listed here so Settings keeps one place to choose the menu.
  const ITEMS = [
    { id: 'copy', label: 'Copy', note: 'Puts the words on the clipboard' },
    { id: 'share', label: 'Share', note: 'Device share sheet when supported; otherwise Copy' },
    { id: 'reply', label: 'Reply in chat', note: 'In an app: Chats opens beside it with the words quoted. Nothing is sent' },
    { id: 'quote', label: 'Quote', note: 'Chats: into this thread’s reply box, as a quote' },
    { id: 'search', label: 'Search', note: 'Wizard Search, with an AI overview' },
    { id: 'all', label: 'Select all', note: 'Chats: the whole message' },
  ].map(i => ({ ...i, icon: ICON[i.id] }));
  const DEFAULT = ['copy', 'share', 'reply', 'quote', 'search', 'all'];
  const N = () => window.WizardOSNative || null;
  const own = () => typeof window.getSelection === 'function';
  const tell = s => { try { const n = N(); if (n && typeof n.selection === 'function') n.selection(s); } catch (e) {} };
  const host = () => window.__wos || window.__wux;
  const toast = (i, t, ms) => host()?.toast?.(i, t, ms);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const EDIT = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  function enabled() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      // A list saved before Reply in chat existed keeps working and gains the new item once.
      if (Array.isArray(v)) return ITEMS.map(i => i.id).filter(id => v.includes(id) || (id === 'reply' && !v.includes('v2')));
    } catch (e) {}
    return DEFAULT.slice();
  }
  // 'v2' marks a list saved since Reply in chat existed: an older list gains Reply once, a v2 list is as chosen.
  function setEnabled(list) { try { localStorage.setItem(KEY, JSON.stringify(list.filter(x => x !== 'v2').concat('v2'))); } catch (e) {} }

  /* ---- surfaces ---- */
  const surfaces = new Map();   // shell-document surfaces (Chats)
  const sources = new Map();    // app documents: doc → source (from app-services.js)
  function register(id, spec) { if (spec && typeof spec.match === 'function') surfaces.set(String(id), spec); return () => surfaces.delete(String(id)); }

  // cur: the selection the menu is for. { text, rects(), block?, surface?, ctx?, src?, explicit?, mine }
  let el = null, cur = null, settleT = 0, down = false, scrolling = 0;
  let lastSrc = null; // the document the owner last pressed or selected in (null: the shell's own)
  let pos = null, drag = null, dragged = false; // pos: where the user dropped the menu for this selection
  const DRAG_PX = 6;

  function mount() {
    if (el) return el;
    el = document.createElement('div'); el.className = 'selmenu'; el.setAttribute('role', 'menu'); el.hidden = true;
    // Keep the selection: a press on the menu must never move focus or collapse it.
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) el.addEventListener(t, e => { e.stopPropagation(); if (e.cancelable && t !== 'touchstart') e.preventDefault(); }, { passive: t === 'touchstart' });
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
      if (!drag.on) { drag.on = true; el.classList.add('drag'); clearTimeout(settleT); try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
      pos = clampPos(drag.l + dx, drag.t + dy); paint(pos);
    });
    // A press that never became a drag is a tap: run its button on release (the click that may follow is swallowed).
    const end = (e, up) => {
      if (!drag || e.pointerId !== drag.id) return;
      const was = drag; drag = null;
      if (e.wosShareHeld) return; // the shared Share gesture already ran this action
      if (was.on) { dragged = true; el.classList.remove('drag'); return; } // the drop is not a tap
      const b = up && document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.selmenu [data-sm]');
      if (b) { swallowClick(); run(b.dataset.sm); }
    };
    // The click that follows the same touch would land on whatever the action just opened, so eat it anywhere.
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
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); } });
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
  const clean = s => String(s || '').replace(/\u00a0/g, ' ').trim();

  /* ---- what is selected ---- */
  function currentShell() {
    const s = window.getSelection?.(); if (!s || s.isCollapsed || !s.rangeCount) return null;
    const text = clean(s); if (!text) return null;
    const a = elOfNode(s.anchorNode), f = elOfNode(s.focusNode);
    if (!a || !f || a.closest(EDIT) || f.closest(EDIT) || a.closest('.selmenu')) return null;
    const range = s.getRangeAt(0);
    const c = { text, rects: () => [...range.getClientRects()], block: a.closest('.note-line, .appr pre, .cx-text, .wk-steps li, .wk-plan li, p, li') || a, mine: false };
    for (const [id, sf] of surfaces) {
      let ctx = null; try { ctx = sf.match(a, f, s); } catch (e) {}
      if (ctx) { c.surface = id; c.ctx = ctx; c.mine = !!ctx.mine; if (ctx.block) c.block = ctx.block; break; }
    }
    return c;
  }
  function frameBox(src) { const r = src.frame.getBoundingClientRect(); return { x: r.left + (src.frame.clientLeft || 0), y: r.top + (src.frame.clientTop || 0), w: r.width, h: r.height }; }
  function currentIn(src) {
    if (!src.visible()) return null;
    const off = () => frameBox(src);
    if (src.explicit) {
      const x = src.explicit, text = clean(x.text); if (!text) return null;
      return { text, src, explicit: x, rects: () => { const o = off(); return x.rects.map(r => ({ left: r.left + o.x, right: r.right + o.x, top: r.top + o.y, bottom: r.bottom + o.y, width: r.right - r.left, height: r.bottom - r.top })); } };
    }
    let s; try { s = src.doc.defaultView.getSelection(); } catch (e) { return null; }
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const text = clean(s); if (!text) return null;
    const a = elOfNode(s.anchorNode), f = elOfNode(s.focusNode);
    if (!a || !f || a.closest(EDIT) || f.closest(EDIT)) return null;
    const range = s.getRangeAt(0);
    return { text, src, rects: () => { const o = off(); return [...range.getClientRects()].map(r => ({ left: r.left + o.x, right: r.right + o.x, top: r.top + o.y, bottom: r.bottom + o.y, width: r.width, height: r.height })); } };
  }

  function itemsFor(c) {
    const on = enabled();
    const shell = id => on.includes(id) && ITEMS.find(i => i.id === id);
    const search = !!(host()?.openSearch && host()?.canSearch?.());
    if (c.src) {
      const extra = (c.explicit ? c.explicit.items : c.src.items) || [];
      const ids = new Set(extra.map(x => x.id));
      const base = ['reply', 'copy', 'share'].concat(search ? ['search'] : []).filter(id => !ids.has(id)).map(shell).filter(Boolean);
      return extra.map(x => ({ ...x, app: true })).concat(base.map(i => ({ id: i.id, label: i.label, icon: i.id })));
    }
    const sf = c.surface && surfaces.get(c.surface);
    const own = sf ? (sf.items?.(c.ctx) || []) : [];
    // Reply in chat is for apps; inside Chats the thread's own Quote replies.
    return ['copy', 'share', ...own, 'search', 'all'].filter(id => id !== 'search' || search).map(shell).filter(Boolean).map(i => ({ id: i.id, label: i.label, icon: i.id }));
  }

  function show() {
    if (!own()) return hide();
    // The document the owner last pressed or selected in: a stale selection left in another app never wins.
    const src = lastSrc && sources.get(lastSrc.doc) === lastSrc ? lastSrc : null;
    const c = src ? currentIn(src) : currentShell();
    if (!c) return hide(true);
    const items = itemsFor(c);
    if (!items.length) return hide();
    tell(3); cur = { ...c, items };
    const m = mount();
    m.innerHTML = `<span class="sm-grip" data-smgrip aria-label="Drag to move" title="Drag to move">${svg('<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>')}</span>`
      + items.map(it => `<button type="button" role="menuitem" data-sm="${esc((it.app ? 'app:' : '') + it.id)}">${ICON[it.icon] ? svg(ICON[it.icon]) : ''}<span>${esc(it.label)}</span></button>`).join('');
    m.dataset.app = c.src ? c.src.appId : '';
    m.hidden = false; m.classList.remove('on');
    place(); requestAnimationFrame(() => m.classList.add('on'));
  }
  function place() {
    if (!el || el.hidden || !cur) return;
    if (pos) { el.classList.remove('off'); pos = clampPos(pos.x, pos.y); paint(pos); return; } // where the user put it
    const rects = cur.rects().filter(r => r.width || r.height);
    if (!rects.length) { el.classList.add('off'); return; }
    const r = rects.reduce((a, b) => ({ top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) }));
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
  // Let go of the words and close: Back, Escape, a tap outside, or after an action.
  function dismiss() {
    const c = cur;
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    if (c?.src) {
      if (c.explicit) { const x = c.src.explicit; c.src.explicit = null; try { x?.dismissed?.(); } catch (e) {} }
      else { try { c.src.doc.defaultView.getSelection().removeAllRanges(); } catch (e) {} }
    }
    hide(true);
  }
  const keyOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h.toString(36); };

  // Reply in chat: a fresh MAIN Chats draft beside the app with the words as its quoted reply. Nothing is sent.
  function replyFrom(src, text) {
    const words = clean(text).slice(0, 4000); if (!words || !src) return false;
    try {
      const r = src.reply('sel-' + keyOf(words), { title: `Selected in ${src.name}`, message: words });
      return !!r;
    } catch (e) { toast('!', 'Couldn’t open Chats · nothing sent', 2200); return false; }
  }

  async function run(id) {
    const c = cur || null; if (!c) return hide(true);
    if (id.startsWith('app:')) {
      const it = c.items.find(x => x.app && 'app:' + x.id === id), pick = c.explicit ? c.explicit.pick : c.src?.pick;
      const text = c.text;
      if (c.explicit) hide(true); else dismiss(); // an app that draws its own selection decides what stays selected
      try { pick?.({ id: it?.id || id.slice(4), text }); } catch (e) { console.warn('selection item', e); }
      return;
    }
    const KIT = window.WosChat || host()?.chat;
    if (id === 'copy') { const ok = await KIT.copyText(c.text); dismiss(); toast(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy', 1400); return; }
    if (id === 'share') {
      const r = await (c.mine ? KIT.shareText(c.text) : KIT.shareAssistantText(c.text)); dismiss();
      if (r === 'copied') toast('⧉', 'Copied · sharing isn’t available here', 1800); else if (r === 'failed') toast('!', 'Couldn’t share', 1800);
      return;
    }
    if (id === 'reply') { const src = c.src, t = c.text; dismiss(); replyFrom(src, t); return; }
    if (id === 'search') { const q = c.text.replace(/\s+/g, ' ').slice(0, 200); dismiss(); host().openSearch(q, 'all'); return; }
    if (id === 'all' && c.block) {
      const r = document.createRange(); r.selectNodeContents(c.block);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); settle(0); return;
    }
    const sf = c.surface && surfaces.get(c.surface);
    if (sf?.run) { const keep = sf.run(id, c.ctx, c) === 'keep'; if (keep) settle(0); else dismiss(); }
  }

  function settle(ms) { clearTimeout(settleT); settleT = setTimeout(() => { settleT = 0; if (!down && !scrolling) show(); }, ms); }

  /* ---- events: the shell document and each watched app document ---- */
  function listen(doc, src) {
    const win = doc.defaultView, offs = [];
    const on = (t, fn, opts) => { doc.addEventListener(t, fn, opts); offs.push(() => doc.removeEventListener(t, fn, opts)); };
    let press = null;
    on('pointerdown', e => {
      if (!src && e.target.closest?.('.selmenu')) return;
      down = true; lastSrc = src;
      if (!own()) return;
      if (!src) tell(e.target.closest?.(EDIT) ? 2 : 1);
      press = cur ? { x: e.clientX, y: e.clientY } : null;
      if (!cur) return;
      const mineDoc = src ? cur.src === src : !cur.src;
      // A tap outside the words closes the menu. In an app that draws its own selection the app hears the tap
      // and tells the shell (hide), so its handles keep working.
      if (!mineDoc) { dismiss(); press = null; return; }
      if (cur.explicit) return;
      if (!src && !cur.block?.contains(e.target)) { dismiss(); press = null; } else hide();
    }, true);
    const up = e => {
      if (!down) return;
      down = false;
      // A tap on the selected block is outside the menu too; an actual handle drag keeps the selection.
      if (press && e.type === 'pointerup' && cur && !cur.explicit && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) dismiss();
      press = null; settle(180);
    };
    on('pointerup', up, true); on('pointercancel', up, true);
    on('touchend', up, true); // Android's long-press ends in pointercancel only; touchend still arrives
    on('selectionchange', () => {
      if (!own()) return;
      if (src?.explicit) return;
      const s = win.getSelection?.();
      if (s && !s.isCollapsed) lastSrc = src;
      if (!s || s.isCollapsed) { if (!cur || (src ? cur.src === src : !cur.src)) hide(true); return; }
      if (el && !el.hidden && !down) hide();
      settle(down ? 400 : 160);
    });
    on('scroll', () => { if (!el || el.hidden && !cur) return; if (pos && !el.hidden) return; hide(); clearTimeout(scrolling); scrolling = setTimeout(() => { scrolling = 0; if (cur) show(); }, 220); }, true);
    on('keydown', e => { if (e.key === 'Escape' && cur && el && !el.hidden) { e.preventDefault(); e.stopPropagation(); dismiss(); } }, true);
    return () => offs.forEach(f => f());
  }
  function bind() {
    if (bind.done) return; bind.done = true;
    listen(document, null);
    window.addEventListener('resize', () => place());
    window.addEventListener('blur', () => { if (cur && !cur.src) tell(0); });
  }

  // app-services.js: a verified app document joins the one menu. Called on every WizardApp connect; idempotent.
  function watch(spec) {
    if (!spec?.doc || !spec.frame) return () => {};
    const had = sources.get(spec.doc); if (had) { Object.assign(had, { name: spec.name || had.name }); return had.off; }
    const src = { doc: spec.doc, frame: spec.frame, appId: String(spec.appId || ''), name: String(spec.name || spec.appId || 'this app'), visible: spec.visible || (() => true), reply: spec.reply, items: [], pick: null, explicit: null };
    src.stop = listen(spec.doc, src);
    src.off = () => forget(spec.doc);
    sources.set(spec.doc, src);
    return src.off;
  }
  function forget(doc) {
    const src = sources.get(doc); if (!src) return;
    sources.delete(doc); try { src.stop(); } catch (e) {}
    if (lastSrc === src) lastSrc = null;
    if (cur?.src === src) hide(true);
  }
  const SAFE_ID = /^[a-z][a-z0-9-]{0,31}$/;
  function cleanItems(list) {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 6) throw new Error('Use up to 6 selection items');
    return list.map(x => {
      if (!x || !SAFE_ID.test(x.id || '') || typeof x.label !== 'string' || !x.label.trim()) throw new Error('Invalid selection item');
      return { id: x.id, label: x.label.trim().slice(0, 24), icon: ICON[x.icon] ? x.icon : '' };
    });
  }
  // WizardApp.selection.items(list, pick): extra items for ordinary selections in that app.
  function setItems(doc, list, pick) {
    const src = sources.get(doc); if (!src) return false;
    src.items = cleanItems(list); src.pick = typeof pick === 'function' ? pick : null;
    if (cur?.src === src && !cur.explicit) show();
    return true;
  }
  // WizardApp.selection.show(spec, pick, dismissed): an app that draws its own selection. rect/rects are in the
  // app's viewport. The shell shows the same menu there; Back or a tap outside calls dismissed().
  function present(doc, spec, pick, dismissed) {
    const src = sources.get(doc); if (!src || !spec) return false;
    const box = r => r && ['left', 'top', 'right', 'bottom'].every(k => Number.isFinite(+r[k])) ? { left: +r.left, top: +r.top, right: +r.right, bottom: +r.bottom } : null;
    const rects = (Array.isArray(spec.rects) ? spec.rects : [spec.rect]).slice(0, 200).map(box).filter(Boolean);
    const text = clean(spec.text).slice(0, 32000);
    if (!rects.length || !text) return false;
    if (cur && cur.src !== src) dismiss();
    src.explicit = { text, rects, items: cleanItems(spec.items), pick: typeof pick === 'function' ? pick : null, dismissed: typeof dismissed === 'function' ? dismissed : null };
    lastSrc = src; pos = null; show();
    return !!(el && !el.hidden);
  }
  function withdraw(doc) { const src = sources.get(doc); if (!src?.explicit) return false; src.explicit = null; if (cur?.src === src) hide(true); return true; }

  // ⌥A (desktop): reply about the app in front. Its selected words when there are some, else what is on screen.
  function replyAbout(frame, fallback) {
    const src = [...sources.values()].find(s => s.frame === frame); if (!src) return false;
    const c = currentIn(src);
    const words = c ? c.text : clean(typeof fallback === 'function' ? fallback() : fallback);
    if (!words) return false;
    if (c) dismiss();
    return replyFrom(src, words);
  }

  /* ---- Settings ---- */
  function html() {
    const on = enabled(), n = N();
    const sub = own() ? 'Select words in any app · choose what the menu offers' : n ? 'Update the Wizard OS app (0.9.7) to use it' : 'Works in the Wizard OS Android app';
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

  function back() {
    const open = el && !el.hidden;
    if (cur && (open || cur.explicit || (!cur.src && !window.getSelection().isCollapsed))) { dismiss(); return 'selection'; }
    return '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
  window.WosSelMenu = { back, html, act, ITEMS, enabled, setEnabled, show, hide, dismiss, register, watch, forget, setItems, present, withdraw, replyAbout,
    get state() { return { open: !!el && !el.hidden, items: el && !el.hidden ? [...el.querySelectorAll('[data-sm]')].map(b => b.dataset.sm) : [], text: cur?.text || '', app: cur?.src?.appId || '', own: own(), moved: pos ? { ...pos } : null, idleTimers: !!(settleT || scrolling) }; } };
})();
