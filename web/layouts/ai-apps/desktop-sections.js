/* Wizard UX AI apps view (desktop) › which sidebar sections are open, Ready's grouping and the rows' times. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { groupMode, groupOrder, sectionsOpen, shortTime } from './parts.js';
export function sectionsPart({ actOn, api, readSessions, root, scroll }) {
  let paintList, paintRail, paintSetting; // late-bound: desktop.js declares these after the call, see bindLate
  // which sections are open (Ready open, Working and Archive folded at first), kept on this device
  const secOpen = sectionsOpen(api.storage.get('sections'));
  /* round 18 item 4: the open Ready is grouped by status like the rail. Round 19 item 2 (Miguel, 3 Nov 2026: the
   * grouping IS the priority): only the order inside each group, Newest first / Oldest first, chosen in Settings ›
   * Chats & app screens and kept where stock Chats keeps its order (api.sessions.order; its Priority or By subject
   * reads as Newest here). The sidebar's own sort control shows only when 'Show sort control in sidebar' is on. */
  const workingOrder = () => globalThis.WizChatsListModel.workingOrderOf(api.sessions.workingOrder?.());
  const setWorkingOrder = o => { api.sessions.setWorkingOrder?.(o); readSessions(); paintList(true); paintRail(true); };
  const readyOrder = () => groupOrder(api.sessions.order?.());
  // (round 20 item 9: off = one flat Ready; round 24c: 'status' / 'project' / 'none', the old on/off switch read as status / none, a saved 'subject' as project)
  const groupBy = () => (typeof actOn === 'function' && actOn()) ? 'none' : api.storage.get('groupReady') === true ? 'status' : ['project', 'subject'].includes(api.storage.get('groupBy')) ? 'project' : 'none';
  const groupReady = () => groupBy() === 'status';
  // round 22: the rows' times stay true ("5m" becomes "6m") without a repaint: one cheap text pass every 10 s
  const tickTimes = () => { const now = Date.now(); for (const t of scroll.querySelectorAll('.aad-time')) { const v = shortTime(t.dataset.at, now); if (v && t.textContent !== v) t.textContent = v; } api.after(10e3, tickTimes); };
  api.after(10e3, tickTimes);
  const setOrder = o => { api.sessions.setOrder?.(groupOrder(o)); paintList(true); paintRail(true); paintSetting(); };
  // Activity's one sort (issue 1336): Chats' own Ready order, where Priority reads as Needs you first.
  const actOrder = () => globalThis.WizChatsListModel.activitySortOf(api.sessions.order?.());
  const setActOrder = o => { api.sessions.setOrder?.(globalThis.WizChatsListModel.activitySortOf(o)); readSessions(); paintList(true); paintRail(true); paintSetting(); };
  const setGroup = m => { m = groupMode(m); api.storage.set('groupBy', m); api.storage.set('groupReady', m === 'status'); paintSetting(); paintList(true); paintRail(true); };
  api.listen(globalThis, 'wos:prefs', () => { if (root.dataset.aadSide !== 'rail') paintList(); else paintRail(); paintSetting(); });
  return { actOrder, groupBy, readyOrder, secOpen, setActOrder, setGroup, setOrder, setWorkingOrder, workingOrder, bindLate: v => { if ('paintList' in v) paintList = v.paintList; if ('paintRail' in v) paintRail = v.paintRail; if ('paintSetting' in v) paintSetting = v.paintSetting; } };
}
