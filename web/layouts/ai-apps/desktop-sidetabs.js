/* Wizard UX AI apps view (desktop) › the rail's Wizard switcher, the agent choices, the Channels pane and another Chats look. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { sharedList } from './parts.js';
export function sidetabsPart({ aadVars, actOn, api, el, flip, foot, head, icon, one, oneSplit, panes, rail, readSessions, scroll, side }) {
  let paintList, paintRail, paintTop; // late-bound: desktop.js declares these after the call, see bindLate
  const rTog = el('button', 'aad-ib aad-rtog', { type: 'button', 'aria-label': 'Open sidebar', title: 'Open sidebar' }); rTog.append(icon('side'));
  const rNew = el('button', 'aad-ib aad-rnew', { type: 'button', 'aria-label': 'New chat', title: 'New chat (⌥N)' }); rNew.append(icon('plus'));
  const rFind = el('button', 'aad-ib aad-rfind', { type: 'button', 'aria-label': 'Search chats', title: 'Search chats (⌥K)' }); rFind.append(icon('search'));
  // the shared Wizard switcher (core/workspaces.js), icon only, shown only with two or more Wizards: its stock bar icon would sit
  // over the chat's own title here, so on the rail it is this button and with the sidebar open the header name below is the switcher
  const rWs = el('button', 'aad-ib aad-rws', { type: 'button', 'aria-label': 'Switch Wizard', title: 'Switch Wizard', 'aria-haspopup': 'menu' }); rWs.append(icon('layers')); rWs.hidden = true;
  const rSet = el('button', 'aad-ib aad-rset', { type: 'button', 'aria-label': 'Settings', title: 'Settings (⌥S)' }); rSet.append(icon('cog'));
  const rList = el('div', 'aad-rlist', { role: 'list', 'aria-label': 'Chats' });
  rail.append(rTog, rNew, rFind, rWs, rList, rSet);
  /* Agent choices (only with more than one agent): All, then each agent, as small chips under the header. They are Chats'
   * own Focus (api.agents.setFocus -> setFocus / winAgent): the sidebar lists that agent's chats and + starts one with it. */
  const agentsRow = el('div', 'aad-agents', { role: 'group', 'aria-label': 'Chats from' }); agentsRow.hidden = true;
  let agentsDrawn = '';
  function paintAgents() {
    const f = api.agents.focus ? api.agents.focus() : { id: '', agents: [] }, list = f.agents || [];
    const sig = list.length > 1 && !(typeof actOn === 'function' && actOn()) ? JSON.stringify([f.id, list.map(a => [a.id, a.label, a.colour, a.private])]) : '';
    if (sig === agentsDrawn) return;
    agentsDrawn = sig; agentsRow.hidden = !sig;
    if (!sig) { agentsRow.replaceChildren(); return; }
    const chip = (id, text, colour, priv) => {
      const on = f.id === id, b = el('button', 'aad-ag' + (on ? ' is-on' : ''), { type: 'button', 'data-aad-agent': id, 'aria-pressed': String(on), ...(priv ? { title: text + ' · private agent' } : {}) });
      if (colour) { const d = el('i', 'aad-ag-d', { 'aria-hidden': 'true' }); d.style.setProperty('--aad-ag', colour); b.append(d); }
      b.append(el('span', 'aad-ag-t', { text }));
      // the pick lands on the press itself (a tap registers at once); the list repaints right after
      api.listen(b, 'click', () => pickAgent(id));
      return b;
    };
    agentsRow.replaceChildren(chip('', 'All'), ...list.map(a => chip(a.id, a.label, a.colour, a.private)));
  }
  function pickAgent(id) {
    const f = api.agents.focus(); if (!f.space && (f.id || '') === id) return;   // a Space focus is replaced by the agent-wide one
    api.agents.setFocus(id);
    agentsDrawn = ''; paintAgents(); readSessions(); paintList(true); paintRail(true);
  }
  /* Channels (wizard-ux issue 1256): Chats' own Channels pane for this sidebar, through
   * api.sessions.channels: the Activity / Channels tabs over the rows below, and in Channels the channel list, or a
   * channel's feed and its message box, in place of them (desktop.css). Empty and hidden with the switch off. */
  const chanBox = el('div', 'aad-chan'); chanBox.hidden = true;
  // (true: the pane draws Chats' own list there, the phone's title bar, rows and tabs; wizard-ux issue 1966)
  const paintChan = () => { const on = !aadVars.q && !!api.sessions.channels?.(chanBox); if (chanBox.hidden === on) chanBox.hidden = !on; return on && !!sharedList(chanBox); };
  /* A channel opens in the main chat column, never in this sidebar (James, 11 Nov 2026: "Channels should display in the
   * chat list with the channel list remaining visible on the sidebar"): its feed is one more chat in the column (FEED),
   * drawn by api.sessions.channelFeed into feedBox over the docked Chats window. A post opens its thread there; Back
   * (Esc, ✕) from the thread returns to the feed, and from the feed to nothing open. The sidebar list never changes. */
  /* Another Chats look (wizard-ux issue 1443, on for everyone): with an installed provider picked under
   * Settings › Chats › Default Chats, api.sessions.chatsView mounts it into viewBox in place of this sidebar's own rows
   * (and of the rail's, at the rail's real width: the provider handles a narrow column). Search keeps the stock hits.
   * Built-in Chats or a provider that fails: false, and the rows below come back as they were. */
  const viewBox = el('div', 'aad-cview'); viewBox.hidden = true;
  function paintView(inRail) {
    const at = inRail ? rail : panel;
    if (viewBox.parentNode !== at) { at.insertBefore(viewBox, inRail ? rSet : scroll); rList.hidden = false; scroll.hidden = false; }
    const on = !!api.sessions.chatsView?.(viewBox);
    const show = on && !(aadVars.q && !inRail);
    if (viewBox.hidden === show) viewBox.hidden = !show;
    if (inRail) rList.hidden = show; else { scroll.hidden = show; if (show) chanBox.hidden = true; }
    return show;
  }
  const FEED = '__feed__', feedBox = el('div', 'aad-feed'); feedBox.hidden = true;
  const feedOn = () => api.sessions.channelFeedOpen?.() || null;
  // A channel as its emoji and words (wizard-ux issue 1506): "🚀 Launch", General "#️⃣ General"; an agent's feed keeps its name.
  function chanTitle(c) {
    const n = String(c?.name || ''), f = !c?.agentFeed && globalThis.WizCore?.channelFace?.(n, !!c?.general || c?.id === '__general__');
    return c?.agentFeed ? n : f ? f.title || `${f.emoji} ${f.label}` : `# ${n}`;
  }
  const panel = el('div', 'aad-panel'); panel.append(head, agentsRow, chanBox, scroll, foot);
  side.id = 'aad-side'; side.append(panel, rail);
  // one app at a time, the list alone: its row for the chat already open behind it shows that chat again (another row
  // opens its chat, and paintOne follows the new thread)
  api.listen(side, 'click', e => {
    // (a row of the sidebar's own, or of the pane's shared Chats list: wizard-ux issue 1966)
    const sid = e.target?.closest?.('.aad-row')?.closest?.('.aad-rw')?.dataset.sid || e.target?.closest?.('.aad-chan [data-chopen]')?.dataset.chopen;
    if (sid && one() && !aadVars.pane && aadVars.oneList && !oneSplit() && sid === aadVars.chatThread) { aadVars.oneList = false; aadVars.oneSeen = aadVars.chatThread; paintTop(); }
  }, { capture: true }); // (capture: Chats' own pane handler stops the click once it opens the row)
  const shade = el('div', 'aad-shade', { 'aria-hidden': 'true' });

  /* ---------- round 15 (Miguel, 3 Nov 2026: Arc-style): the top row over the main area ----------
   * Left: a docked chat's title and ✕ (round 7's column); right: the app panel's icon, name, its own title-bar tools,
   * ⤢ wider and — hide (the app keeps running on its desk). Nothing on Home: the skin's background only. */
  const top = el('header', 'aad-top');
  const cTop = el('div', 'aad-ctop'), tt = el('span', 'aad-tt');
  const cX = el('button', 'aad-ib aad-cx', { type: 'button', 'aria-label': 'Close the chat (Esc)', title: 'Close (Esc · ⌥W)' }); cX.append(icon('x')); cX.hidden = true;
  /* Back to the channel (wizard-ux issue 1302; James, 11 Nov 2026: "if I open a channel and then I click through to a
   * thread there's no way for me to go back to the channel"): a thread opened from a channel's feed in this column shows
   * "‹ # name" at the left of its header, and it does what Esc does (closeChat: the feed again, at its place). A thread
   * opened from Activity or the sidebar shows "‹ Activity" / "‹ Chats" (and the feed "‹ Channels") only while the list
   * is not beside it (James, 12 Nov 2026: "Make sure the user always has a back button in chats"; listBack below). */
  const cBack = el('button', 'aad-cback', { type: 'button' }); cBack.hidden = true;
  cTop.append(cBack, tt, cX);
  // narrow desktop (ONE), narrower than ONE.split: the chat (or a new one) alone, Back to the chats list
  const oneBack = el('button', 'aad-cback aad-oneback', { type: 'button', text: '‹ Chats', 'aria-label': 'Back to the chats list', title: 'Back to the chats list' }); oneBack.hidden = true;
  const pTop = el('div', 'aad-ptop'); pTop.hidden = true;
  const pIcon = el('span', 'aad-pti'), pName = el('span', 'aad-ptn');
  const pTools = el('span', 'aad-ptools'); pTools.hidden = true;
  const pX = el('button', 'aad-ib aad-px', { type: 'button', title: 'Hide (Esc) · it keeps running' }); pX.append(icon('hide'));
  pTop.append(pIcon, pName, pTools, pX);
  const sTop = el('div', 'aad-stop'), sName = el('span', 'aad-ptn'); sTop.hidden = true;
  sTop.append(sName);
  api.listen(sTop, 'mousedown', e => e.preventDefault()); // like the app bar: never takes the keyboard itself
  const modeBars = [];
  function windowMode(mode, slot = panes.get().focus) {
    // narrow desktop (ONE): one app at a time, no arrangements; the saved one stays as it is for the wide window
    if (typeof one === 'function' && one()) return;
    // Full screen remembers the view it came from: Esc there goes back to it, never to tiled (wizard-ux issue 1325)
    const was = panes.get().mode; if (mode === 'full' && was !== 'full') aadVars.fullFrom = was;
    // Only mode/focus change: the tiled ratios, slots and rail sizes stay saved.
    flip([aadVars.dockEl, aadVars.pane?.el, aadVars.secondEl], () => panes.set({ mode, focus: slot }));
  }
  return { cBack, chanTitle, cTop, cX, FEED, feedBox, feedOn, modeBars, oneBack, paintAgents, paintChan, paintView, pIcon, pName, pTools, pTop, pX, rFind, rList, rNew, rSet, rTog, rWs, shade, sName, sTop, top, tt, windowMode, bindLate: v => { if ('paintList' in v) paintList = v.paintList; if ('paintRail' in v) paintRail = v.paintRail; if ('paintTop' in v) paintTop = v.paintTop; } };
}
