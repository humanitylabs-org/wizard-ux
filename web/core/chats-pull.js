/* Wizard UX core: Chats › typing into a composer, opening media and pull to refresh on a list.
 * Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Values chats.js changes over time (its
 * reassigned lets) stay in chats.js; this code reads and writes them as chatVars.<name>, chats.js's get/set
 * accessors on the same variables, so every read and write is live. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.pull = function ({ ch, chanUser, chatVars, draftKey, H, INC, KIT, LIVE, renderChatList, saveDraft, toast, vib, W, winAgent }) {
  let elOf, holdList, idOf; // late-bound: chats.js declares these after the call, see bindLate
  // Words typed (or dictated) into a box are saved under that box's own key: a channel box under its channel, a thread's
  // box under the thread it was painted for, whatever the window's state says by then.
  function typedInto(id, ta) {
    const c = ch(id), form = ta.form || ta.closest?.('form'), el = elOf(id);
    const mk = form?.dataset?.morphKey || '', own = form?.dataset && 'chchanform' in form.dataset ? (mk.startsWith('chanbox:') ? mk.slice(8) : '') : el?.dataset?.draftFor || '';
    const w = W[id], key = w ? draftKey(w) : '';
    if (own && own !== key) { if (!INC?.active(id)) KIT.drafts.set(own, ta.value, KIT.drafts.get(own).files); return; }
    if (own) c.draftFor = own;
    c.draft = ta.value; saveDraft(id);
  }
  function openMedia(wid, k) {
    const c = ch(wid), list = c.media || [], m = list[k]; if (!m) return;
    // Photos swipe as one gallery (this thread, oldest first); a file or video opens on its own.
    if (m.kind === 'image') { const g = list.filter(x => x.kind === 'image'); return KIT.viewer.open(g, g.indexOf(m)); }
    KIT.viewer.open([m], 0);
  }
  KIT.K.notify = (icon, text) => toast(icon, text, 1800);
  KIT.K.onChange = open => H.overlay?.(open);
  /* Pull to refresh (James, 21 Oct 2026): at the top of a Chats list, drag down and let go to re-read the list now.
   * Listeners stay passive so native scrolling, desk swipes and row swipes keep their ownership; the pull only engages
   * on a clearly downward drag that starts with the list already at the top. The finger on the list holds list
   * re-renders (readGuard), so the indicator can be painted directly while dragging. */
  const PTR_GO = 48, PTR_MAX = 84;
  let ptr = null;
  function paintPull(p, d) {
    const el = p.sc.parentElement?.querySelector(':scope > .ch-ptr'); if (!el) return;
    el.classList.remove('out'); el.style.height = d + 'px';
    const go = d >= PTR_GO; el.classList.toggle('go', go);
    const tx = el.querySelector('span'); if (tx) tx.textContent = go ? 'Release to refresh' : 'Pull to refresh';
  }
  function endPull() {
    const p = ptr; ptr = null; if (!p?.on) return;
    const el = p.sc.parentElement?.querySelector(':scope > .ch-ptr');
    if (el) { el.classList.add('out'); el.style.height = '0px'; el.classList.remove('go'); }
    if (p.d >= PTR_GO) pullRefresh(p.wid);
  }
  function repaintList(wid) { const w = H.win(wid), el = elOf(wid); if (w && !w.thread && el && el.querySelector('.ch-list') && !holdList(wid)) renderChatList(w, el); }
  function pullRefresh(wid) {
    const c = ch(wid); if (!wid || c.ptrState === 'busy') return;
    vib(10); clearTimeout(c.ptrT); c.ptrState = 'busy'; repaintList(wid);
    const agent = winAgent(H.win(wid));
    Promise.resolve(LIVE.refresh()).catch(() => {}).then(() => {
      const st = LIVE.statusFor ? LIVE.statusFor(agent) : { error: LIVE.error };
      c.ptrState = st.error ? '' : 'done'; repaintList(wid);
      if (c.ptrState) c.ptrT = setTimeout(() => { c.ptrState = ''; repaintList(wid); }, 1600);
    });
  }
  function bindPull(root) {
    // James's own touch or wheel on the list owns its scroll from here: drop any return bookmark still being held.
    const own = e => { const sc = e.target.closest?.('.ch-list > .ch-scroll'); const id = sc && idOf(sc); if (id) { ch(id).listPending = null; if (typeof chanUser === 'function') chanUser(id); } };
    root.addEventListener('wheel', own, { capture: true, passive: true });
    for (const t of ['touchmove', 'pointerdown', 'keydown']) root.addEventListener(t, own, { capture: true, passive: true });
    root.addEventListener('touchstart', e => {
      own(e);
      ptr = null;
      if (H.pullRefresh?.() === false) return; // a package moved refresh to the ↻ in the window bar
      if (e.touches.length !== 1) return;
      const sc = e.target.closest?.('.ch-list > .ch-scroll'); if (!sc || sc.scrollTop > 0) return;
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const t = e.touches[0]; ptr = { sc, wid: idOf(sc), x: t.clientX, y: t.clientY, y0: 0, on: false, d: 0 };
    }, { capture: true, passive: true });
    root.addEventListener('touchmove', e => {
      if (!ptr) return; const t = [...e.touches][0]; if (!t || e.touches.length !== 1) { endPull(); return; }
      const dx = t.clientX - ptr.x, dy = t.clientY - ptr.y;
      if (!ptr.on) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { ptr = null; return; } // a desk or row swipe
        if (dy < -6 || ptr.sc.scrollTop > 0) { ptr = null; return; } // scrolling the list
        if (dy < 12 || dy < Math.abs(dx) * 1.5) return;
        ptr.on = true; ptr.y0 = dy; if (chatVars.lp) { clearTimeout(chatVars.lp.t); chatVars.lp.row.style.transform = ''; chatVars.lp = null; }
      }
      ptr.d = Math.max(0, Math.min(PTR_MAX, (dy - ptr.y0) * 0.5));
      paintPull(ptr, ptr.d);
    }, { capture: true, passive: true });
    root.addEventListener('touchend', endPull, { capture: true, passive: true });
    root.addEventListener('touchcancel', () => { if (ptr) ptr.d = 0; endPull(); }, { capture: true, passive: true });
  }
  return { bindPull, openMedia, repaintList, typedInto, bindLate: v => { if ('elOf' in v) elOf = v.elOf; if ('holdList' in v) holdList = v.holdList; if ('idOf' in v) idOf = v.idOf; } };
};
