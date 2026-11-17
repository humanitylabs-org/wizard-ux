/* Thread swipe-back (Miguel's gesture, every skin since James, 23 Oct 2026): inside an open chat thread, swipe right
 * from anywhere (not the OS edge strip) to go back one step. The thread follows the finger a little and fades;
 * an intentional swipe (swipe-intent.js: long drag or deliberate level flick) runs the shell's own Back step (linked thread -> parent, thread -> list).
 * It never leaves or exits the app. Code blocks, tables, the composer, sliders, inputs and selected text keep their
 * own horizontal gestures. Runs as a WosSkinHost built-in, so it gets the skin hook API's guards and cleanup.
 * Channels pages (wizard-ux issue 1467, switch wizard/chat-channels; James, 15 Nov 2026: "channels on the left,
 * activity on the right ... swipe anywhere on the screen to swipe back and forth"): the same gesture and threshold on
 * the Chats list, read from the list's own markup, so with the switch off the list has no swipe. On the Chats home the
 * list body follows the finger between the Channels page (left) and the Activity page (right), the header tabs follow
 * it, and a release past the threshold taps the other tab (one path with the tap). Nothing lies left of Channels or
 * right of Activity: that swipe never engages, and Back is never run from the home. A channel's or agent's feed goes
 * back to the Channels list with a swipe right (the shell's Back step, so sheets and filters close first).
 * Rows with their own swipe: a leftward swipe that starts on an Activity row, or any swipe while a row's tray is open,
 * stays the row's; a channel row leaves its sideways swipe to the page (chats.js `lp.page`; long-press still opens its
 * menu); with a row sheet open nothing moves. A sideways scroller (a wide table, a code block, chips) scrolls first; the page takes over only at its edge.
 * API: none (registers itself). */
import { engages, commits, COMMIT_PX } from './swipe-intent.js';
{
  function setup(api) {
    let sw = null;
    const thread = () => { const r = api.part('thread'); return r && r.querySelector('[data-part="thread"]'); };
    const skip = t => !t || !t.closest || t.closest('pre, table, [data-part="composer"], .ms-track, input, textarea, [contenteditable="true"]');
    const reset = th => { if (!th) return; th.style.transition = 'transform .18s ease-out, opacity .18s ease-out'; th.style.transform = ''; th.style.opacity = ''; };
    // The nearest sideways scroller under the finger inside the Chats root, or null.
    const scroller = (t, root) => {
      for (let n = t; n && n !== root && n.nodeType === 1; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 1) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return n; }
      }
      return null;
    };
    // Can it still scroll the way the finger pulls? (raw < 0: the content moves left, so it needs room on its right.)
    const scrolls = (n, raw) => !!n && (raw < 0 ? n.scrollLeft + n.clientWidth < n.scrollWidth - 1 : n.scrollLeft > 0);
    // The Chats list's state: a feed is open (its Back button), or the home shows the Channels | Activity tabs.
    // Always the list the finger is on: a shell can hold several Chats windows (main and routed agents, other desks).
    const listState = t => {
      const list = t && t.closest ? t.closest('.ch-list') : null; if (!list) return null;
      if (list.querySelector('.ch-chan-h [data-chchanback]')) return { mode: 'feed', list, th: list, dir: 1 };
      const tabs = list.querySelector('.ch-chan-tabs .ch-rdy-bar'), on = tabs && tabs.querySelector('[data-chview][aria-pressed="true"]');
      if (!on) return null;
      const page = on.dataset.chview, left = page === 'channels';
      // Channels is page 1 (left), Activity page 2 (right): the only way to go is toward the other one.
      return { mode: 'page', list, tabs, page, to: left ? 'activity' : 'channels', dir: left ? -1 : 1, th: list.querySelector(':scope > .ch-scroll') };
    };
    // The header tabs follow the finger: past the commit distance they show where a release lands.
    const preview = (s, want) => {
      if (!s.tabs || !!s.shown === want) return; s.shown = want;
      for (const b of s.tabs.querySelectorAll('[data-chview]')) b.classList.toggle('on', b.dataset.chview === (want ? s.to : s.page));
    };
    const bind = root => {
      api.listen(root, 'touchstart', e => {
        sw = null;
        const view = api.route().view;
        if ((view !== 'thread' && view !== 'list') || e.touches.length !== 1) return;
        const t0 = e.touches[0];
        if (t0.clientX < api.env.edgeInset || skip(e.target) || String(window.getSelection ? window.getSelection() : '')) return;
        if (view === 'thread') {
          const th = thread(); if (!th) return;
          sw = { mode: 'thread', dir: 1, x: t0.clientX, y: t0.clientY, t: performance.now(), th, on: false, dx: 0 };
          return;
        }
        const st = listState(e.target); if (!st || !st.th) return;
        st.win = e.target.closest('[data-chats]') || root;
        if (st.list.querySelector('.ch-row-wrap.swiped') || e.target.closest('.ch-swipe-acts')) return; // an open row tray is the row's
        if (root.ownerDocument?.querySelector('.ch-sheet')) return; // a row or channel sheet is open: it closes first
        sw = { ...st, x: t0.clientX, y: t0.clientY, t: performance.now(), on: false, dx: 0, target: e.target, sc: scroller(e.target, root) };
      }, { passive: true });
      api.listen(root, 'touchmove', e => {
        if (!sw) return;
        // d: travel the way this swipe may go (right for Back; toward the other page on the home).
        const t = e.touches[0], raw = t.clientX - sw.x, d = raw * sw.dir, dy = Math.abs(t.clientY - sw.y);
        if (!sw.on) {
          if (dy > 36 && dy > Math.abs(raw)) { sw = null; return; }
          if (!engages(d, dy)) return;
          if (sw.mode !== 'thread') {
            if (sw.mode === 'page' && raw < 0 && sw.target.closest('[data-chopen], [data-chnotif]')) { sw = null; return; } // the row's own leftward swipe
            if (scrolls(sw.sc, raw)) { sw = null; return; }
          }
          sw.on = true; sw.th.style.transition = 'none';
        }
        sw.dx = d;
        const s = sw;
        api.frame(() => {
          if (!s.on || s.done) return;
          s.th.style.transform = `translateX(${s.dir * Math.max(0, Math.min(s.dx, s.mode === 'page' ? 160 : 140)) * .5}px)`; s.th.style.opacity = String(1 - Math.max(0, Math.min(s.dx, 160)) / 500);
          if (s.mode === 'page') preview(s, s.dx > COMMIT_PX);
        });
      }, { passive: true });
      const end = e => {
        if (!sw) return; const s = sw; sw = null; s.done = true;
        const t1 = e.changedTouches && e.changedTouches[0];
        const go = s.on && e.type !== 'touchcancel' && !!t1 && commits((t1.clientX - s.x) * s.dir, Math.abs(t1.clientY - s.y), performance.now() - s.t);
        if (s.mode === 'page' && go) {
          // Settle: the tab's own tap path switches the page, then the new page slides in from the side it lies on.
          s.th.style.transition = 'none'; s.th.style.transform = ''; s.th.style.opacity = '';
          s.tabs.querySelector(`[data-chview="${s.to}"]`)?.click();
          const body = s.list.isConnected !== false ? s.list.querySelector(':scope > .ch-scroll') : s.win.querySelector('.ch-list > .ch-scroll'); if (!body) return;
          body.style.transition = 'none'; body.style.transform = `translateX(${-s.dir * 48}px)`; body.style.opacity = '.4';
          api.frame(() => api.frame(() => reset(body)));
          return;
        }
        if (s.mode === 'page') preview(s, false);
        // Snap back on every release: a drag frame queued by the last move must not re-indent the thread after it.
        if (s.on) { reset(s.th); api.frame(() => reset(s.th)); }
        if (go) api.nav.back();
      };
      api.listen(root, 'touchend', end, { passive: true });
      api.listen(root, 'touchcancel', end, { passive: true });
    };
    // The chats container is stable across repaints; bind once per container (desks can hold several chats windows).
    const bound = new WeakSet();
    const ensure = () => { const r = api.part('thread') || api.part('list'); if (r && !bound.has(r)) { bound.add(r); bind(r); } };
    ensure();
    api.on('render', ensure);
    api.on('route', ensure);
    return () => { if (sw) { reset(sw.th); if (sw.mode === 'page') preview(sw, false); } sw = null; };
  }
  window.WosSkinHost?.builtin('thread-swipe-back', setup, { when: 'touch', label: 'Swipe back' });
}
