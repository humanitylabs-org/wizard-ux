/* Wizard UX AI apps view (desktop) › the app panel on the left and placing the panes. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { svgIcon } from './parts.js';
export function panesPart({ aadVars, api, COLS, doc, flip, one, ONE, panes, paneVars, RAIL, root }) {
  let vw; // late-bound: desktop.js declares these after the call, see bindLate
  const oneSplit = () => (globalThis.innerWidth || 1440) >= ONE.split;
  // (one app at a time: no split, no side by side, no second app; the saved arrangement is kept for the wide window)
  const paneModel = () => { const m = panes.get(); return one() ? { ...m, mode: 'tiled', ratio: null, weights: {}, slots: ['chats', 'app'], app2: null } : m; };
  /* The app panel on the left (wizard-os#639, switch wizard/app-panel-left, off by default): one button in the panel's
   * header (and ⌥⇧M) mirrors the main area, the app panel next to the sidebar and a docked chat beside it on the right,
   * kept per device in the pane model (appSide). Off, or in the narrower one-app window, the panel stays on the right. */
  const leftOn = () => { try { return String(root.dataset.tweaks || '').split(' ').includes('wizard/app-panel-left'); } catch (_) { return false; } };
  const appSideOf = m => leftOn() && !one() && m.appSide === 'start' ? 'start' : 'end';
  function flipAppSide() {
    if (!leftOn() || one()) return;
    const to = panes.get().appSide === 'start' ? 'end' : 'start';
    flip([aadVars.dockEl, aadVars.pane?.el, aadVars.secondEl], () => panes.set({ appSide: to }));
  }
  function placePanes(s) {
    const m = paneModel(), focus = root.hasAttribute('data-aad-focus');
    // Horizontal dock interaction is not admitted yet: keep the saved model but render at end. The narrower window's
    // app bar (ONE) is that dock at ONE.bar, ONE.barH thick; the saved wide-window edge is left as it is.
    const bar = one(), edge = bar ? ONE.bar : ['start', 'end'].includes(m.dock.edge) ? m.dock.edge : 'end';
    const sm = root.dataset.aadSide;
    const sideWidth = focus || sm === 'none' ? 0 : sm === 'open' ? s.side[0] : sm === 'full' ? vw() : RAIL;
    const dockWidth = focus ? 0 : bar ? ONE.barH : root.dataset.aadTabs === 'rail' ? COLS.tabsRail : s.tabs[0];
    aadVars.paneGeometry = panes.geometry({ ...m, appSide: appSideOf(m), dock: { ...m.dock, edge } }, { width: vw(), height: globalThis.innerHeight || 900 }, {
      sideWidth, dockWidth, appWidth: s.app[0], chatOn: !!root.dataset.aadChat, appOn: !!root.dataset.aadSplit, wide: root.hasAttribute('data-aad-wide'), app2On: !!aadVars.secondEl,
    });
    root.dataset.aadPaneSide = m.side; root.dataset.aadDockEdge = edge;
    root.dataset.aadAppSide = appSideOf(m);
    root.dataset.aadPaneTiled = String(aadVars.paneGeometry.tiled);
    root.dataset.aadMode = m.mode;
    const put = (k, v) => { const key = '--aad-pane-' + k; paneVars.add(key); if (root.style.getPropertyValue(key) !== v + 'px') root.style.setProperty(key, v + 'px'); };
    for (const [id, b] of Object.entries({ side: aadVars.paneGeometry.sidebar, dock: aadVars.paneGeometry.dock, main: aadVars.paneGeometry.content, chat: aadVars.paneGeometry.panes.chats, app: aadVars.paneGeometry.panes.app, app2: aadVars.paneGeometry.panes.app2 || { x: 0, y: 0, width: 0, height: 0 } })) {
      for (const [k, v] of Object.entries(b)) put(id + '-' + k, v);
      put(id + '-right', vw() - b.x - b.width); put(id + '-bottom', (globalThis.innerHeight || 900) - b.y - b.height);
    }
    /* round 14 (wizard-ux issue 1742): desks out of sight keep the open sidebar's geometry, so a fold re-lays out only
     * what shows. The main area as it is with the sidebar and the tab column open (the same model, the fold left out). */
    const held = panes.geometry({ ...m, appSide: appSideOf(m), dock: { ...m.dock, edge } }, { width: vw(), height: globalThis.innerHeight || 900 }, {
      sideWidth: s.side[0], dockWidth: bar ? ONE.barH : s.tabs[0], appWidth: s.app[0],
    }).content;
    put('held-x', held.x); put('held-right', vw() - held.x - held.width);
    for (const [slot, n] of [['chats', aadVars.dockEl], ['app', aadVars.pane?.el], ['app2', aadVars.secondEl]]) if (n) {
      const b = aadVars.paneGeometry.panes[slot];
      n.toggleAttribute('data-aad-mode-hidden', m.mode !== 'tiled' && (!b?.width || !b?.height));
    }
  }
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = (name, cls = 'aad-ico') => svgIcon(doc, name, cls);
  const desks = () => api.desks.list();
  return { appSideOf, desks, el, flipAppSide, icon, leftOn, oneSplit, paneModel, placePanes, bindLate: v => { if ('vw' in v) vw = v.vw; } };
}
