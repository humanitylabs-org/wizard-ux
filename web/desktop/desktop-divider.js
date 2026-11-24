/* Wizard UX desktop shell › the divider between the Chats list and the thread: drag, arrow keys, double-click to
 * reset, one width for every Chats window. Moved verbatim out of desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.divider = function ({ $$, stage, store, winEl }) {
  /* ---- the list/thread divider: drag, arrow keys, double-click to reset; one width for every Chats window ---- */
  const LIST_W = [220, 640, 340];
  function listW() { const v = +store.get('listW', LIST_W[2]); return v >= LIST_W[0] && v <= LIST_W[1] ? v : LIST_W[2]; }
  function setListW(px) { px = Math.round(Math.max(LIST_W[0], Math.min(LIST_W[1], px))); store.set('listW', px); $$('.dchats', stage).forEach(b => b.style.setProperty('--list-w', px + 'px')); return px; }
  let split = null;
  stage.addEventListener('pointerdown', e => {
    const s = e.target.closest('[data-split]'); if (!s || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const box = s.closest('.dchats'); split = { box, left: box.getBoundingClientRect().left };
    s.setPointerCapture?.(e.pointerId); document.documentElement.classList.add('splitting');
  });
  addEventListener('pointermove', e => { if (split) setListW(e.clientX - split.left); });
  addEventListener('pointerup', () => { if (!split) return; split = null; document.documentElement.classList.remove('splitting'); });
  stage.addEventListener('dblclick', e => { if (e.target.closest('[data-split]')) { e.stopPropagation(); setListW(LIST_W[2]); } }, true);
  stage.addEventListener('keydown', e => {
    if (!e.target.matches?.('[data-split]')) return;
    const d = { ArrowLeft: -24, ArrowRight: 24 }[e.key]; if (!d) return;
    e.preventDefault(); e.stopPropagation(); setListW(listW() + d);
  });
  /* ---- keyboard through the thread list: ↑/↓ (or j/k) open the previous/next chat, / searches ---- */
  function listRows(id) { return $$('.pane-list .ch-row[data-chopen], .pane-list .ch-row[data-chdraft]', winEl(id) || document.createElement('div')).filter(r => r.getClientRects().length).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); }
  // ⌥↓ / ⌥↑: walk the Ready chats only (Working and the rest are skipped), top first, from anywhere.
  // Rows are taken in on-screen order so "top" is what the owner sees at the top of Ready.
  // Notifications shown as rows (inbox tweak, [data-chnotif]) count too, wherever Chats shows them (one list holds
  // them): new ones before the Ready chats, so ⌥↓ from elsewhere lands on the top notification; snoozed ones after.
  const byTop = (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  const readyRows = id => {
    // A Chats window whose list is hidden (narrow and showing a thread, or a chat panel beside a docked list): its rows
    // still count, in list order.
    const folded = !!winEl(id)?.querySelector('.pane-list') && !winEl(id).querySelector('.pane-list').getClientRects().length;
    const threads = $$('.pane-list .ch-sec[data-sec="ready"] .ch-row[data-chopen]', winEl(id) || document.createElement('div')).filter(r => folded || r.getClientRects().length).sort(byTop);
    // Listed among the chats (inbox list mode): the list's own rows, in on-screen order with everything else.
    const own = $$('.pane-list .ch-sec[data-sec="ready"] .ch-notif-row[data-chnotif]', winEl(id) || document.createElement('div')).filter(r => r.getClientRects().length);
    if (own.length) return [...threads, ...own].sort(byTop);
    const notes = $$('.pane-list .ch-sec[data-sec="ready"] [data-chnotif]', document).filter(r => r.getClientRects().length).sort(byTop);
    const end = r => r.closest('[data-slot]')?.dataset.slot === 'ready-end';
    return [...notes.filter(r => !end(r)), ...threads, ...notes.filter(end)];
  };
  return { listRows, listW, readyRows, setListW };
};
