/* Wizard OS · text selection menu (James, 12 Oct 2026)
 *
 * Long-press words in a chat and Wizard OS shows its own small menu above them instead of Android's
 * Copy / Share / Select all toolbar. The items are chosen in Settings → Text selection menu:
 *   Copy · Share (Android's share sheet, "From Archimedes:" over the words when they are his) · Quote (into this
 *   thread's reply box) · Search (Wizard Search) · Select all (the whole message).
 *
 * Android app 0.9.7+ only (WizardOSNative.selection): the page tells the native view when a selection is its own and
 * the stock toolbar stays quiet for it (SelectionWebView). Text fields and hosted apps keep Android's menu (Paste).
 * Browsers and older apps keep their own toolbar and never see this menu.
 *
 *   WosSelMenu.back()      → 'selection' when Back closed the menu (and cleared the selection), else ''
 *   WosSelMenu.html()      → the Settings group;  WosSelMenu.act(el) → handles a tap inside it
 *   WosSelMenu.state       → QA probe { open, items, text }
 */
(() => {
  'use strict';
  const KEY = 'wos.selmenu';
  const ITEMS = [
    { id: 'copy', label: 'Copy', icon: '<path d="M9 9h10v11H9zM5 15V4h10"/>', note: 'Puts the words on the clipboard' },
    { id: 'share', label: 'Share', icon: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>', note: 'Android share sheet · Telegram, Messages…' },
    { id: 'quote', label: 'Quote', icon: '<path d="M5 18h14M5 6h4M5 12h8M15 6l4 6-4 6"/>', note: 'Into this thread’s reply box, as a quote' },
    { id: 'search', label: 'Search', icon: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>', note: 'Wizard Search, with an AI overview' },
    { id: 'all', label: 'Select all', icon: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 9h8M8 12h8M8 15h5"/>', note: 'The whole message' },
  ];
  const DEFAULT = ['copy', 'share', 'quote', 'search', 'all'];
  const N = () => window.WizardOSNative || null;
  const own = () => { const n = N(); return !!n && typeof n.selection === 'function' || !!window.__wosSelMenuForce; };
  const tell = s => { try { const n = N(); if (n && typeof n.selection === 'function') n.selection(s); } catch (e) {} };
  const toast = (i, t, ms) => window.__wos?.toast?.(i, t, ms);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const EDIT = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  function enabled() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(v)) return ITEMS.map(i => i.id).filter(id => v.includes(id)); } catch (e) {}
    return DEFAULT.slice();
  }
  function setEnabled(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

  let el = null, cur = null, settleT = 0, down = false, scrolling = 0;
  function mount() {
    if (el) return el;
    el = document.createElement('div'); el.className = 'selmenu'; el.setAttribute('role', 'menu'); el.hidden = true;
    // Keep the selection: a press on the menu must never move focus or collapse it.
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) el.addEventListener(t, e => { e.stopPropagation(); if (e.cancelable && t !== 'touchstart') e.preventDefault(); }, { passive: t === 'touchstart' });
    el.addEventListener('click', e => { const b = e.target.closest('[data-sm]'); if (b) { e.preventDefault(); e.stopPropagation(); run(b.dataset.sm); } });
    document.body.appendChild(el);
    return el;
  }

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
    return { text, range, wid: thread ? thread.dataset.chats : '', mine, block };
  }

  function show() {
    if (!own()) return hide();
    const c = current(); if (!c) return hide(true);
    tell(3); cur = c;
    const ids = enabled().filter(id => id !== 'quote' || c.wid).filter(id => id !== 'search' || window.__wos?.openSearch);
    if (!ids.length) return hide();
    const m = mount();
    m.innerHTML = ids.map(id => { const it = ITEMS.find(i => i.id === id); return `<button type="button" role="menuitem" data-sm="${id}">${svg(it.icon)}<span>${esc(it.label)}</span></button>`; }).join('');
    m.hidden = false; m.classList.remove('on');
    place(); requestAnimationFrame(() => m.classList.add('on'));
  }
  function place() {
    if (!el || el.hidden || !cur) return;
    const rects = [...cur.range.getClientRects()].filter(r => r.width || r.height);
    const r = rects.length ? rects.reduce((a, b) => ({ top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) })) : cur.range.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, mw = el.offsetWidth, mh = el.offsetHeight, gap = 12;
    if (r.bottom < 0 || r.top > vh) { el.classList.add('off'); return; }
    el.classList.remove('off');
    let top = r.top - mh - gap;
    const safeTop = 8 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0);
    if (top < safeTop) top = Math.min(vh - mh - 8, r.bottom + 34); // below the selection, clear of the handles
    const left = Math.max(8, Math.min(vw - mw - 8, (r.left + r.right) / 2 - mw / 2));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(safeTop, top))}px)`;
  }
  function hide(selectionGone) {
    if (selectionGone) tell(0);
    if (el && !el.hidden) { el.hidden = true; el.classList.remove('on'); }
    if (selectionGone) cur = null;
  }
  const clear = () => { try { window.getSelection().removeAllRanges(); } catch (e) {} hide(true); };

  async function run(id) {
    const c = cur || current(); if (!c) return hide(true);
    const KIT = window.WosChat || window.__wos?.chat;
    const agent = window.WizConfig?.agent?.() || 'Archimedes';
    if (id === 'copy') { const ok = await KIT.copyText(c.text); clear(); toast(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy', 1400); return; }
    if (id === 'share') {
      const r = await KIT.shareText(c.mine ? c.text : `From ${agent}:\n\n${c.text}`); clear();
      if (r === 'copied') toast('⧉', 'Copied · sharing isn’t available here', 1800); else if (r === 'failed') toast('!', 'Couldn’t share', 1800);
      return;
    }
    if (id === 'quote') {
      const q = c.text.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      clear(); if (!window.__wos?.chats?.insertText(c.wid, q)) toast('!', 'Open the thread to quote', 1600);
      return;
    }
    if (id === 'search') { const q = c.text.replace(/\s+/g, ' ').slice(0, 200); clear(); window.__wos.openSearch(q, 'all'); return; }
    if (id === 'all') {
      const b = c.block.closest('.bub') || c.block; const r = document.createRange(); r.selectNodeContents(b);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); settle(0); return;
    }
  }

  function settle(ms) { clearTimeout(settleT); settleT = setTimeout(() => { if (!down && !scrolling) show(); }, ms); }

  function bind() {
    if (bind.done) return; bind.done = true;
    document.addEventListener('pointerdown', e => {
      if (e.target.closest?.('.selmenu')) return;
      down = true;
      if (!own()) return;
      tell(e.target.closest?.(EDIT) ? 2 : 1);
      if (el && !el.hidden) hide(); // dragging a handle or pressing elsewhere: back once it settles
    }, true);
    const up = () => { if (!down) return; down = false; settle(180); };
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
    document.addEventListener('scroll', () => { if (!el || el.hidden && !cur) return; hide(); clearTimeout(scrolling); scrolling = setTimeout(() => { scrolling = 0; if (cur) show(); }, 220); }, true);
    window.addEventListener('resize', () => place());
    window.addEventListener('blur', () => { if (cur) tell(0); }); // focus went into a hosted app: its own menu applies
  }

  /* ---- Settings ---- */
  function html() {
    const on = enabled(), n = N();
    const sub = own() ? 'Long-press words in a chat · choose what the menu offers' : n ? 'Update the Wizard OS app (0.9.7) to use it' : 'Works in the Wizard OS Android app';
    return `<div class="st-group" data-selmenu><h4>Text selection menu</h4><p class="st-note">${esc(sub)}</p>
      ${ITEMS.map(it => `<button class="st-row" data-smset="${it.id}"><span class="st-ic">${svg(it.icon)}</span><span class="st-tx"><b>${esc(it.label)}</b><small>${esc(it.note)}</small></span><span class="sw ${on.includes(it.id) ? 'on' : ''}"><i></i></span></button>`).join('')}</div>`;
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
  window.WosSelMenu = { back, html, act, ITEMS, enabled, setEnabled, show, hide, get state() { return { open: !!el && !el.hidden, items: el && !el.hidden ? [...el.querySelectorAll('[data-sm]')].map(b => b.dataset.sm) : [], text: cur?.text || '', own: own() }; } };
})();
