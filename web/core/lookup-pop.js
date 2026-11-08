/* WizardOS · AI Look up popover (ported from the reading app's Look up → "AI explanation").
 *
 * Select words in a chat message, tap Look up in the selection menu (core/sel-menu.js): a compact opaque popover opens
 * under the words (above them when there is no room) and a fast model streams a 1-2 sentence plain explanation of the
 * words as used in that message. Only the selected words and ≤800 characters of the same message either side go to
 * POST /wizard/v1/lookup/stream (wizard-agent-service docs/lookup.md); never the thread. Private threads never reach it.
 *
 *   WosLookup.open({ text, before, after, frame, agent, session, range })  → paints "Explaining…" NOW, then streams
 *   WosLookup.close(opts)   → aborts the fetch, hides it            WosLookup.back() → 'lookup' when Back closed it
 *   WosLookup.isOpen        → bool (selection menu stays out of its way)   WosLookup.contextOf(range) → {before, after}
 *   WosLookup.state         → QA probe { open, status, text, term, model }
 *
 * Rules kept from that port: a newer lookup, Back, an outside tap or close aborts the request and a superseded answer can
 * never paint; deltas are provisional ("…" trails them) and only the validated done text with the exact fast model is
 * shown as final; the answer is selectable and copyable; an error shows a compact Retry. No answer is stored.
 */
(() => {
  'use strict';
  const URL_ = '/wizard/v1/lookup/stream';
  const MODEL = 'claude-haiku-4-5';
  const SIDE = 800, MAX_CHARS = 128, MAX_WORDS = 8, DEADLINE = 45000, CACHE_MAX = 60;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = () => window.__wos || window.__wux;
  let el = null, serial = 0, ctl = null, req = null, status = 'closed', term = '', shown = '', model = '', range = null, box = null, raf = 0;
  const cache = new Map();
  const sel = () => { try { return window.getSelection(); } catch (e) { return null; } };
  const inside = n => !!(el && n && el.contains(n.nodeType === 1 ? n : n.parentNode));
  // A native selection inside the popover (the reader is copying) belongs to the reader: nothing may dismiss it.
  const selectionInside = () => { const s = sel(); return !!(s && !s.isCollapsed && s.rangeCount && inside(s.getRangeAt(0).commonAncestorContainer)); };

  /* ---- context: the selected words in their message, nothing wider ---- */
  const ROOT = '.msg .bub, .msg .an-body, .msg .rc-body, .note-line, .appr pre, .cx-text, .wk-steps li, .wk-plan li, .msg, p, li';
  const flat = s => String(s).replace(/\s+/g, ' ');
  function contextOf(r) {
    const a = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const rootEl = a && a.closest(ROOT); if (!rootEl) return { before: '', after: '' };
    const b = document.createRange(), f = document.createRange();
    try {
      b.selectNodeContents(rootEl); b.setEnd(r.startContainer, r.startOffset);
      f.selectNodeContents(rootEl); if (rootEl.contains(r.endContainer)) f.setStart(r.endContainer, r.endOffset); else f.collapse(false);
    } catch (e) { return { before: '', after: '' }; }
    return { before: flat(b.toString()).slice(-SIDE), after: flat(f.toString()).slice(0, SIDE) };
  }
  // The port trims quotes and punctuation round the term; what is trimmed goes back to the context so the passage reads whole.
  function normalise(rawText, before, after) {
    const m = /^([\s"'“‘(\[]*)([\s\S]*?)([\s"'”’)\],.;:!?]*)$/.exec(flat(rawText));
    const text = (m ? m[2] : flat(rawText)).trim();
    return { text, before: (before + (m ? m[1] : '')).slice(-SIDE), after: ((m ? m[3] : '') + after).slice(0, SIDE) };
  }
  const sameRange = r => !range || (r.startContainer === range.startContainer && r.startOffset === range.startOffset && r.endContainer === range.endContainer && r.endOffset === range.endOffset);
  const tooBig = t => t.length > MAX_CHARS || t.split(/\s+/).length > MAX_WORDS;

  /* ---- popover ---- */
  function mount() {
    if (el) return el;
    el = document.createElement('div'); el.className = 'wos-lookup'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'AI explanation'); el.hidden = true;
    // The selection under it must survive a tap on it (a press never moves focus), but its own words stay selectable.
    for (const t of ['pointerdown', 'mousedown']) el.addEventListener(t, e => { e.stopPropagation(); if (e.target.closest('[data-lk-retry]') && e.cancelable) e.preventDefault(); });
    el.addEventListener('click', e => { if (e.target.closest('[data-lk-retry]')) { e.preventDefault(); e.stopPropagation(); retry(); } });
    document.body.appendChild(el);
    return el;
  }
  function paint(body, kind) {
    const p = mount(); status = kind; shown = body;
    p.dataset.state = kind;
    p.innerHTML = `<div class="lk-term" lang="">${esc(term)}</div><p class="lk-body">${esc(body)}${kind === 'error' && req ? ` <button type="button" class="lk-retry" data-lk-retry>Retry</button>` : ''}</p><small>AI explanation${model && model !== MODEL ? ' · ' + esc(model) : ''}</small>`;
    p.hidden = false; place();
  }
  function rectOf() {
    if (range) { try { if (range.commonAncestorContainer.isConnected) { const rs = [...range.getClientRects()].filter(r => r.width || r.height); if (rs.length) { box = rs.reduce((a, b) => ({ top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) })); } } } catch (e) {} }
    return box;
  }
  function place() {
    if (!el || el.hidden) return;
    const q = rectOf() || { top: 80, bottom: 100, left: 12, right: 40 };
    const W = window.innerWidth, H = window.innerHeight, w = Math.min(340, W - 24);
    el.style.width = w + 'px';
    const h = el.offsetHeight, cx = (q.left + q.right) / 2;
    let top = q.bottom + 10; if (top + h > H - 12) top = q.top - 10 - h;
    top = Math.max(12 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0), Math.min(top, H - 12 - h));
    el.style.left = Math.round(Math.min(W - 12 - w, Math.max(12, cx - w / 2))) + 'px'; el.style.top = Math.round(top) + 'px';
  }

  /* ---- request ---- */
  async function stream(payload, onDelta, signal) {
    const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(payload), signal });
    if (!res.ok) { let d = {}; try { d = await res.json(); } catch (e) {} throw Object.assign(new Error(d.detail || d.error || 'Unable to connect'), { status: res.status }); }
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', bytes = 0;
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      bytes += value.length; if (bytes > 65536) throw new Error('Oversized explanation');
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1); if (!ln.trim()) continue;
        const ev = JSON.parse(ln);
        if (ev.type === 'delta' && typeof ev.text === 'string') onDelta(ev.text);
        else if (ev.type === 'done') return ev;
        else if (ev.type === 'error') throw Object.assign(new Error(ev.error || 'Unavailable'), { status: ev.status });
        else throw new Error('Invalid explanation stream');
      }
    }
    throw new Error('Incomplete explanation');
  }
  const valid = r => r && r.model === MODEL && typeof r.text === 'string' && r.text.trim() && r.text.length <= 700 && r.text.trim().split(/\s+/).length <= 70;

  function abort() { serial++; if (ctl) { ctl.abort(); ctl = null; } if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  async function run() {
    const q = req; if (!q) return;
    abort(); const mine = serial;
    const current = () => mine === serial && status !== 'closed';
    const key = JSON.stringify(q), hit = cache.get(key);
    if (hit) { model = hit.model; paint(hit.text, 'done'); return; }
    model = ''; paint('Explaining…', 'loading');
    const c = new AbortController(), timer = setTimeout(() => c.abort(), DEADLINE); ctl = c;
    let partial = '';
    const draw = () => { raf = 0; if (current() && partial.trim()) paint(partial.trim() + ' …', 'streaming'); };
    try {
      const done = await stream(q, piece => { if (!current()) return; partial += piece; if (!raf) raf = requestAnimationFrame(draw); }, c.signal);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!valid(done)) throw new Error('Invalid explanation');
      cache.set(key, { text: done.text.trim(), model: done.model }); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      if (current()) { model = done.model; paint(done.text.trim(), 'done'); }
    } catch (err) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (current()) paint(err.status === 400 ? 'Select a word or short phrase to explain.' : 'AI explanation unavailable.', 'error');
    } finally { clearTimeout(timer); if (ctl === c) ctl = null; }
  }
  function retry() { if (status === 'error' && req) { void run(); } }

  function open(o) {
    const text = String(o?.text || '').trim(); if (!text) return false;
    abort(); // a newer lookup supersedes the last one
    range = o.range || null; box = null; if (range) { try { range = range.cloneRange(); } catch (e) { range = null; } }
    term = text; model = '';
    const n = normalise(text, o.before || '', o.after || '');
    req = { text: n.text, before: n.before, after: n.after, ...(o.frame ? { frame: String(o.frame).slice(0, 80) } : {}), ...(o.agent ? { agent: o.agent } : {}), ...(o.session ? { session: o.session } : {}) };
    if (!n.text || tooBig(n.text)) { req = null; paint('Select a word or short phrase to explain.', 'error'); return true; }
    paint('Explaining…', 'loading'); // same frame as the tap, before any request
    status = 'loading';
    void run();
    return true;
  }
  function close(opts) {
    if (status === 'closed' && (!el || el.hidden)) return false;
    abort(); status = 'closed'; req = null; range = null; box = null;
    if (el) { if (selectionInside()) { try { sel().removeAllRanges(); } catch (e) {} } el.hidden = true; el.innerHTML = ''; }
    // Back leaves the words selected, so their menu comes back (one layer at a time); an outside tap ends the selection itself.
    if (opts?.menu) { const s = sel(); if (s && !s.isCollapsed) window.WosSelMenu?.show?.(); }
    return true;
  }
  const back = () => close({ menu: true }) ? 'lookup' : '';

  function bind() {
    if (bind.done) return; bind.done = true;
    // Tap outside closes it (a press inside, including text selection handles, never does).
    document.addEventListener('pointerdown', e => { if (status === 'closed' || !el || el.hidden) return; if (el.contains(e.target) || selectionInside()) return; close(); }, true);
    // A newer selection (or none) closes it; the words being copied out of the popover itself do not.
    let held = false; // the reader had words of the popover selected (copying): letting go of them is not "outside"
    document.addEventListener('selectionchange', () => {
      if (status === 'closed') { held = false; return; }
      if (selectionInside()) { held = true; return; }
      const s = sel(), t = s && !s.isCollapsed ? String(s).replace(/\s+/g, ' ').trim() : '';
      if (!t && held) { held = false; return; }
      held = false;
      // Still the same words only when it is the very same place in the page (same text elsewhere is a newer selection).
      if (!t || t !== flat(term).trim() || !sameRange(s.getRangeAt(0))) close();
    });
    document.addEventListener('scroll', () => { if (status !== 'closed') place(); }, true);
    window.addEventListener('resize', () => { if (status !== 'closed') place(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();

  window.WosLookup = { open, close, back, retry, contextOf, normalise, MODEL, clearCache: () => cache.clear(), holds: n => inside(n),
    get isOpen() { return status !== 'closed' && !!el && !el.hidden; },
    get state() { return { open: status !== 'closed' && !!el && !el.hidden, status, term, text: shown, model, request: req ? { ...req } : null, selectable: !!el && getComputedStyle(el).userSelect !== 'none' }; } };
})();
