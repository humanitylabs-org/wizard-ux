/* Wizard UX AI apps view (desktop) › stepping through Ready. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { railRows, readyFlat, readyStep } from './parts.js';
export function readyPart({ aadVars, actOn, api, curChat, groupBy, railNow, readSessions, readyOrder, root, scroll, showToast }) {
  let here; // late-bound: desktop.js declares these after the call, see bindLate
  api.sessions.archiveOrder?.(sid => {
    if (root.dataset.aadSide === 'rail') {
      const key = railNow()?.key;
      return key ? railRows(aadVars.sessions || readSessions(), key, readyOrder(), groupBy()).map(r => r.id) : [];
    }
    const rows = [...scroll.querySelectorAll('.aad-rw[data-sid]')], row = rows.find(r => r.dataset.sid === sid);
    if (!row) return [];
    const group = r => {
      for (let n = r.previousElementSibling; n; n = n.previousElementSibling) if (n.classList.contains('aad-grp')) return n;
      return r.parentElement;
    };
    const section = group(row);
    return rows.filter(r => r.parentElement === row.parentElement && group(r) === section).map(r => r.dataset.sid);
  });
  const readyIds = () => (typeof actOn === 'function' && actOn()) ? ((aadVars.sessions || readSessions()).ready || []).map(r => r.id) : readyFlat((aadVars.sessions || readSessions()).ready || [], readyOrder(), groupBy()).map(r => r.id);
  function stepReady(dir) {
    readSessions();
    const ids = readyIds();
    if (!ids.length) { showToast('Nothing ready right now'); return; }
    const r = api.route(), h = here(r), cc = h.app ? curChat() : null;
    // (round 21: the item in front exactly as the hints read it, so ⌥↓ opens the row wearing ↓; nothing in front: ⌥↓ the
    // first, ⌥↑ the last)
    const cur = h.thread && ids.includes(h.thread) ? h.thread : aadVars.stepAt && ids.includes(aadVars.stepAt) && h.note ? aadVars.stepAt : cc && ids.includes(cc) ? cc : null;
    const nx = cur == null && dir < 0 ? { id: ids[ids.length - 1], wrapped: false } : readyStep(ids, cur, dir); if (!nx) return;
    if (nx.wrapped && dir > 0) showToast('Back to the top of Ready');
    aadVars.feedFocus = null; aadVars.stepAt = nx.id; aadVars.noteWant = nx.id.startsWith('notif:'); aadVars.fromFeed = null; api.sessions.open(nx.id);
  }
  /* Round 21 (Miguel, 4 Nov 2026: the keys as obvious as possible): ⌥ + a mnemonic letter, ⇧ only for the reverse /
   * variant of a plain key, every key reachable from where it acts. Left: ⌥H Home (again = everything back as it was),
   * ⌥O workspaces, ⌥K search, ⌥L fold the sidebar, ⌥N new chat, ⌥S Settings, ⌥↓ / ⌥↑ the next / previous Ready item.
   * Right: ⌥1–⌥9 and ⌥0 the first ten rows, ⌥[ / ⌥] the previous / next app (every row past ten), ⌥⇧[ / ⌥⇧] move it,
   * ⌥A add an app, ⌥T tidy, ⌥R fold the column, ⌥P pause / play what played last (Now playing). In front: ⌥W close, ⌥F wide, ⌥− / ⌥= narrower / wider, ⌥Z snooze,
   * ⌥E archive then the next, ⌥X resolve then the next, ⌥B where this app's notifications go. Voice: ⌥Space talk (the
   * orb), ⌥D dictate, ⌥V new voice chat, ⌥C command (the shell's own). A modal in front (the app picker, Settings):
   * only its own key (⌥A, ⌥S) and Esc. Every other ⌥ key is the view's and does nothing, so nothing acts unseen on a
   * hidden desk (no ⌥G letters, no ⌥/ pinned guide: holding ⌥ is the guide). */
  const KEY_LIKE = /^(Key[A-Z]|Digit\d|Arrow|Bracket|Backslash|Period|Comma|Minus|Equal|Backquote|Space|Slash|Enter|Semicolon|Quote)/;
  return { KEY_LIKE, readyIds, stepReady, bindLate: v => { if ('here' in v) here = v.here; } };
}
