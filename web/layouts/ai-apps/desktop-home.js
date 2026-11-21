/* Wizard UX AI apps view (desktop) › Home, + and the cog's count. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { colourOf, glyphOf } from '../orb/shared.js';
import { CHATS } from '../apps/chrome.js';
export function homePart({ aadVars, api, appName, cancelBtn, closeMenu, closeWs, desks, el, FEED, feedOn, field, findBtn, loading, newBtn, panes, rFind, rNew, rSet, scroll, setBtn, setSearch, unpeek }) {
  let closeAll, hidePanel, mainChats, NOTE, paintList, wantAppFocus; // late-bound: desktop.js declares these after the call, see bindLate
  api.listen(findBtn, 'click', () => setSearch(true)); api.listen(rFind, 'click', () => setSearch(true));
  api.listen(cancelBtn, 'click', () => setSearch(false));
  api.listen(field, 'input', () => { aadVars.q = field.value; paintList(); });
  api.listen(field, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scroll.querySelector('button')?.click(); } });
  // Home (Miguel, 2 Nov 2026) = the empty new chat: the skin's background, the composer and the orb, no greeting. + goes
  // there from anywhere (and ⌥`, the desktop's own Home key).
  const newChat = () => { aadVars.draftWant = false; if (aadVars.chatThread === NOTE) aadVars.chatThread = null; if (aadVars.chatThread === FEED || feedOn()) { aadVars.chatThread = null; api.sessions.channelBack?.(); } unpeek(); if (aadVars.q) setSearch(false); closeMenu(); closeWs(); closeAll(); aadVars.noteWant = false; aadVars.oneList = false; api.sessions.newChat(); };
  /* round 15 (Miguel): Home = nothing open in front: the app panel hides (its app keeps running), a docked chat goes, the
   * new chat's composer at the bottom centre (the sidebar's ⌂, ⌥`) */
  const goHome = () => { if (aadVars.pane) hidePanel({ home: false }); aadVars.chatThread = null; newChat(); };
  const settings = () => { unpeek(); api.desk.settings(); };
  // + with a channel's feed in front posts in that channel: its own box (wizard-ux issue 1291). ⌂ still goes Home.
  // The sidebar's tab decides (wizard-ux issues 1308, 1310): Activity, a blank new chat (a feed left in the column closes);
  // Channels with a channel open, its box; the Channels list with none open, a blank new chat as on Activity (only the
  // list's + New channel row makes a channel, wizard-ux issue 1489).
  const plus = () => { if (aadVars.chatThread === FEED && feedOn() && api.sessions.channelView?.() !== 'activity' && api.sessions.channelPost?.()) { closeMenu(); return; } newChat(); };
  api.listen(newBtn, 'click', plus); api.listen(rNew, 'click', plus);
  api.listen(setBtn, 'click', settings); api.listen(rSet, 'click', settings);
  // the cog's count (System notices set to Badge, …): WosBell.attention, as on the stock desktop's cog and the phone's gear
  const setCounts = [setBtn, rSet].map(b => { const c = el('b', 'aad-count aad-setn', { 'aria-hidden': 'true' }); c.hidden = true; b.append(c); return c; });
  const paintCog = at => {
    const n = at?.n | 0, t = !n ? '' : n > 99 ? '99+' : String(n);
    for (const c of setCounts) { c.textContent = t; c.hidden = !n; }
    for (const b of [setBtn, rSet]) b.setAttribute('aria-label', n ? `Settings, ${n} ${at.label}` : 'Settings');
  };
  paintCog(api.desk.attention?.(paintCog));

  /* ---------- an app's icon: its logo, else its sigil in its colour (the sheet's own tile) ---------- */
  const metaOf = id => api.apps.list().find(a => a.id === id) || { id, name: appName(id) || id };
  function appTile(id, cls = 'aad-tile') {
    const a = metaOf(id), t = el('span', cls, { 'aria-hidden': 'true' });
    t.style.setProperty('--c', colourOf(a));
    t.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    api.apps.logo(id).then(url => {
      if (!url || !t.isConnected) return;
      const im = el('img', 'aad-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { t.replaceChildren(im); t.classList.add('is-logo'); }, () => {});
    });
    return t;
  }
  // round 12: a Home icon is a desk (desk = its number): that desk; round 13: it opens as a tab (the New tab page goes)
  // round 15: an app opens as the panel (its desk, or a new desk for it); the All apps sheet goes
  const goApp = (id, desk = null, then = null, place = null) => {
    unpeek(); closeAll(); wantAppFocus(id === CHATS ? '' : id);
    if (id !== CHATS && panes.get().focus !== 'app') panes.set({ focus: 'app' });
    if (id === CHATS && (desk == null || desk === mainChats()?.desk)) { goHome(); return; }
    const d = (desk != null && desks().find(x => x.desk === desk && x.id === id)) || desks().find(x => x.id === id);
    aadVars.want = id; if (!d) loading(id);
    const go = () => { if (d) api.nav.goDesk(d.desk); else api.apps.openDesk(id, place); then?.(); };
    // the Chats desk stays behind the panel: Home's new chat there first (never its bare list's empty pane beside the app)
    if (!aadVars.chatsFresh && !aadVars.chatThread && mainChats()) { aadVars.chatsFresh = true; api.sessions.newChat(); }
    // Deep links deliver their page to the frame in this same call, not a timer later.
    go();
  };
  return { appTile, goApp, goHome, metaOf, plus, settings, bindLate: v => { if ('closeAll' in v) closeAll = v.closeAll; if ('hidePanel' in v) hidePanel = v.hidePanel; if ('mainChats' in v) mainChats = v.mainChats; if ('NOTE' in v) NOTE = v.NOTE; if ('paintList' in v) paintList = v.paintList; if ('wantAppFocus' in v) wantAppFocus = v.wantAppFocus; } };
}
