/* Wizard UX AI apps view (desktop) › a row's tracker dots and the sidebar's header. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { KINDS } from './parts.js';
export function sidebarPart({ aadVars, actOn, api, desks, el, icon, LKINDS }) {
  const agentName = () => (api.agents.list().find(a => a.main) || api.agents.here?.() || {}).label || (api.workspaces?.list()[0] || {}).name || 'Wizard';
  const readSessions = () => { aadVars.sessions = api.sessions.list((typeof actOn === 'function' && actOn()) ? { activity: true } : { focused: true }) || { working: [], snoozed: [], ready: [], archive: [] }; return aadVars.sessions; };
  // (a chat opened from elsewhere may belong to an agent the sidebar is not focused on: look in the whole list too)
  const titleOf = id => { for (const s of [aadVars.sessions || readSessions(), api.sessions.list()]) for (const k of (typeof LKINDS !== 'undefined' ? LKINDS : KINDS)) { const r = ((s || {})[k] || []).find(x => x.id === id); if (r) return r.title; } return ''; };
  // Thread tracker (tweak, off by default): the row's ask dots, drawn by the tracker itself so every list agrees.
  const ttAgent = id => globalThis.WizLive?.agentOf?.(id) || '';
  const ttDots = id => { const T = globalThis.WosThreadTracker; return T?.on?.() ? T.dots(id, ttAgent(id)) : ''; };
  const appName = id => (api.apps.list().find(a => a.id === id) || desks().find(d => d.id === id) || {}).name || '';
  const badgeText = id => { const n = aadVars.badgeMap[id] || 0; if (!n) return ''; const t = api.apps.badgeText?.(id); return t || (n > 99 ? '99+' : String(n)); };
  const lit = id => (aadVars.badgeMap[id] || 0) > 0;
  const litFirst = list => [...list.filter(a => lit(a.id)), ...list.filter(a => !lit(a.id))];

  /* ---------- the sidebar ---------- */
  const khMarks = new Map();   // the Ready rows wearing ↓ / ↑ while ⌥ is held (sid → key)
  const side = el('nav', 'aad-side', { 'aria-label': 'Sidebar' });
  const head = el('div', 'aad-sh');
  // round 7 (Miguel): the workspace switcher IS the header (this Wizard's name; a click opens the switcher menu), where
  // the name was; Home = + and ⌥`
  const wsBtn = el('button', 'aad-ws', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  // round 8 (Miguel): text only and a small chevron, no disc before the name
  const wsName = el('span', 'aad-wsn');
  wsBtn.append(wsName, icon('down', 'aad-ico aad-wsc'));
  const findBtn = el('button', 'aad-ib aad-find', { type: 'button', 'aria-label': 'Search chats', title: 'Search chats (⌥K)' }); findBtn.append(icon('search'));
  const togBtn = el('button', 'aad-ib aad-tog', { type: 'button', 'aria-controls': 'aad-side' }); togBtn.append(icon('side'));
  // (round 18 item 4a, Miguel: the Ready count sits on Ready's own header, as on the rail; none on ◫ any more)
  const searchBox = el('label', 'aad-search'); searchBox.hidden = true;
  const field = el('input', 'aad-q', { type: 'search', placeholder: 'Search chats', 'aria-label': 'Search chats', autocomplete: 'off' });
  searchBox.append(icon('search', 'aad-ico aad-search-i'), field);
  const cancelBtn = el('button', 'aad-cancel', { type: 'button', text: 'Cancel' }); cancelBtn.hidden = true;
  // (round 16: no ⌂ here any more; Home = a chat's ✕, Esc, ⌥`)
  head.append(wsBtn, findBtn, searchBox, cancelBtn, togBtn);
  const scroll = el('div', 'aad-scroll');
  const foot = el('div', 'aad-foot');
  const newBtn = el('button', 'aad-new', { type: 'button', 'aria-label': 'New chat', title: 'New chat (⌥N)' }); newBtn.append(icon('plus'));
  const setBtn = el('button', 'aad-set', { type: 'button', 'aria-label': 'Settings', title: 'Settings (⌥S)' }); setBtn.append(icon('cog'));
  // round 7: the cog on the left, the AI fuel gauge between, + on the right
  const fuel = el('div', 'aad-fuel', { 'data-fuel-copy': '' }); fuel.hidden = true;
  foot.append(setBtn, fuel, newBtn);
  // the rail (collapsed, round 16: 52 px): ◫ · + · 🔍, then Snoozed, Ready and Ready's stock statuses, each a count over
  // a short word (round 12's words, not icons) … the cog. (No Ready count on its ◫: Ready is right under it.)
  const rail = el('div', 'aad-rail');
  return { agentName, appName, badgeText, cancelBtn, field, findBtn, foot, fuel, head, khMarks, lit, newBtn, rail, readSessions, scroll, searchBox, setBtn, side, titleOf, togBtn, ttAgent, ttDots, wsBtn, wsName };
}
