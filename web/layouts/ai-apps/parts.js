// The shells already ran these as classic scripts; import them only where they have not (node tests), so the
// browser never fetches them a second time as modules.
if (!globalThis.WizChatsListModel) await import('../../core/chats-list-model.js');
if (!globalThis.WizCore?.ago) await import('../../core/core.js');
const { STATES, stateOf, stateGroups, READY_SORTS, sortOf, PRIORITY_TIP, rankOf, readySort, readyGroups, NOTES_PROJECT, NO_PROJECT, projectOf, titleInProject, projectGroups, GROUP_MODES, groupMode, readyFlat, readyStep } = globalThis.WizChatsListModel;
export { STATES, stateOf, stateGroups, READY_SORTS, sortOf, PRIORITY_TIP, rankOf, readySort, readyGroups, NOTES_PROJECT, NO_PROJECT, projectOf, titleInProject, projectGroups, GROUP_MODES, groupMode, readyFlat, readyStep };
/* The AI apps view's shared marks and words (phone layout.js and desktop.js): one icon set, one row-menu order, so the
 * drawer on the phone and the sidebar on the desktop draw and say the same things. 24-unit outline paths, drawn with
 * currentColor by the caller's CSS. No DOM at import time. */
export const SVG = 'http://www.w3.org/2000/svg';
export const ICON = {
  menu: ['M4 8.5h16', 'M4 15.5h10'],
  // a bell: a notification among the chats (round 5)
  bell: ['M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  // a house: Home (round 5, the top bar's middle)
  home: ['M4.5 10.5 12 4.5l7.5 6', 'M6.5 9v10h11V9', 'M10 19v-5h4v5'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M15.5 15.5 20 20'],
  apps: ['M5 5h5v5H5z', 'M14 5h5v5h-5z', 'M5 14h5v5H5z', 'M14 14h5v5h-5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  chev: ['m10 7 5 5-5 5'],
  down: ['m7 10 5 5 5-5'],
  // stacked layers: the Wizard switcher's icon (core/workspaces.js draws the same one)
  layers: ['M12 3 3 7.5l9 4.5 9-4.5L12 3Z', 'm3 12 9 4.5 9-4.5', 'm3 16.5 9 4.5 9-4.5'],
  more: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'],
  // the sidebar toggle (ChatGPT's ◫): a panel with its left column
  side: ['M4.5 5.5h15v13h-15z', 'M9.5 5.5v13'],
  pin: ['M9 4h6l-1 6 3 3H7l3-3-1-6z', 'M12 13v7'],
  rename: ['M4 20h4L19 9l-4-4L4 16z', 'm13.5 6.5 4 4'],
  unread: ['M3.5 6.5h17v11h-17z', 'm4.5 7.5 7.5 5.5 7.5-5.5'],
  snooze: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 8v4.5l3 2'],
  done: ['M3.5 5h17v4h-17z', 'M5.5 9v9.5h13V9', 'M10 13h4'],
  restore: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4.5v4h4'],
  // a # (Move to channel…, Channels on)
  move: ['M9.5 4 7.5 20', 'M16.5 4l-2 16', 'M4.5 9h15', 'M4 15h15'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  // Move up / Move down (round 16: the right column's menu)
  up: ['M12 19V5', 'm6 11 6-6 6 6'],
  dn: ['M12 5v14', 'm6 13 6 6 6-6'],
  unpin: ['M9 4h6l-1 6 3 3H7l3-3-1-6z', 'M12 13v7', 'M4 4l16 16'],
  hide: ['M6 12h12'],
  // Mark done (wizard-ux issue 1317): a plain tick
  markdone: ['M5 12.5l4.5 4.5L19 7.5'],
  // the app panel wider / back to a third (round 7, the Orb desktop's panel)
  expand: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
  shrink: ['M4 14h6v6', 'M10 14l-6 6', 'M20 10h-6V4', 'M14 10l6-6'],
  // a microphone: the orb wears it (round 6: the orb IS the microphone)
  mic: ['M12 3.5a2.75 2.75 0 0 0-2.75 2.75v5.5a2.75 2.75 0 0 0 5.5 0v-5.5A2.75 2.75 0 0 0 12 3.5z', 'M6.5 11.25a5.5 5.5 0 0 0 11 0', 'M12 16.75v3.75'],
  newchat: ['M12 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V12', 'M17.5 4.5l2 2L13 13l-3 1 1-3z'],
  // a cogwheel (the Lucide settings outline, ISC licence)
  cog: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
};
/* The row menu (long press on the phone, ⋯ or right click on the desktop), in the order they use (Pin, Rename, …, the
 * filing action last), Wizard's words. */
export const ACTS = [['pin', 'Pin'], ['rename', 'Rename'], ['markdone', 'Mark done'], ['unread', 'Mark unread'], ['move', 'Move to channel…'], ['snooze', 'Snooze'], ['restore', 'Restore'], ['done', 'Archive']];
/** An outline icon from ICON as an <svg> of the given class. */
export function svgIcon(doc, name, cls) {
  const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
  for (const d of ICON[name] || []) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
/** The first letter of a name, for a workspace disc. */
export const initial = n => (String(n || '').trim()[0] || 'W').toUpperCase();
/* The chats in Wizard's own sections (round 5, Miguel: in place of Recents and View all), in the stock Chats order
 * (Working, then Ready, Archive last: James, 6 Nov 2026), each header like their Recents label. Round 13
 * (Miguel): Snoozed between Working and Ready (the stock snooze state, whether or not a tweak files it under Ready).
 * Miguel's "Archive on top" tweak (miguel/archive-top) is the only way to put Archive first: sectionsFor(root). */
export const SECTIONS = [['working', 'Working'], ['snoozed', 'Snoozed'], ['ready', 'Ready'], ['archive', 'Archive']];
const ARCHIVE_TOP = [SECTIONS[3], ...SECTIONS.slice(0, 3)];
/** True when the owner wears Miguel's "Archive on top" tweak (the host lists worn tweaks in <html data-tweaks>). */
export const archiveTop = root => String(root?.dataset?.tweaks || root?.getAttribute?.('data-tweaks') || '').split(/\s+/).includes('miguel/archive-top');
/** The section order to draw: stock (Archive last), or Archive first under the archive-top tweak. */
export const sectionsFor = root => archiveTop(root) ? ARCHIVE_TOP : SECTIONS;
/** Every list the sidebar / drawer shows, for searches and signatures. */
export const KINDS = ['working', 'snoozed', 'ready', 'archive'];
/** What an open section with no rows says. */
export const EMPTY = { ready: 'Nothing ready.', working: 'Nothing working.', snoozed: 'Nothing snoozed.', archive: 'Nothing archived.' };
/** Which sections are open: Ready open, Working, Snoozed and Archive folded at first; a stored choice (this device) wins. */
export function sectionsOpen(stored) {
  const o = { archive: false, working: false, snoozed: false, ready: true };
  if (stored && typeof stored === 'object') for (const k of Object.keys(o)) if (typeof stored[k] === 'boolean') o[k] = stored[k];
  return o;
}
/* Round 7 (Miguel, 2 Nov 2026): the stock Chats statuses (core/chats.js stiKind: what a thread wants from him), in Chats'
 * own order of urgency, with Chats' own words. The rail groups Ready by them and marks each chat with its colour; a
 * notification row is FYI unless it is urgent. */
/** Round 16 (Miguel, 3 Nov 2026): the folded 52 px rail's short words, one under each count (the full STATES words in
 * its tip): Snoozed, Ready, then Ready's statuses. */
export const RAIL_WORDS = Object.freeze({ working: 'Working', snoozed: 'Snoozed', ready: 'Ready', needs: 'Needs you', approval: 'Needs approval', failed: 'Error', check: 'Your call', fyi: 'FYI', done: 'Done', deferred: 'Snoozed', none: 'Other' });   // round 23b: whole words (Miguel), wrapping to two lines when needed
/* Round 8 (Miguel, 2 Nov 2026: the rail's coloured first letters were confusing): each Ready chat on the folded rail is
 * its stock Chats status icon (core/chats.js STI, the Orb desktop's thin column of status icons), the same drawings:
 * [tag, attrs] parts; class f = filled in the status colour, k / kd = the cut-out mark in the panel's colour. */
export const STATE_ICON = {
  needs: [['path', { d: 'M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8' }], ['path', { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15' }]],
  check: [['path', { d: 'M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.6a1 1 0 0 0 .9 1.4h12.8a1 1 0 0 0 .9-1.4l-5.1-10.2a2 2 0 0 1-.2-.9V2M8.5 2h7M7 16h10' }]],
  done: [['circle', { class: 'f', cx: '12', cy: '12', r: '10' }], ['path', { class: 'k', d: 'm7.5 12.3 3 3 6-6.3' }]],
  fyi: [['circle', { class: 'f', cx: '12', cy: '12', r: '10' }], ['path', { class: 'k', d: 'M12 11v5.5' }], ['circle', { class: 'kd', cx: '12', cy: '7.6', r: '1.35' }]],
  deferred: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 7.5V12l3 2' }]],
  approval: [['path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
  failed: [['path', { d: 'm21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3M12 9v4M12 17h.01' }]],
  none: [['circle', { class: 'f', cx: '12', cy: '12', r: '3' }]],
};
/** A Ready chat's status icon (STATE_ICON) as an <svg> of the given class. */
export function stateIcon(doc, state, cls) {
  const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
  for (const [tag, attrs] of STATE_ICON[state] || STATE_ICON.none) { const p = doc.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v); s.append(p); }
  return s;
}
/** The AI fuel gauge (the network Home's E ▮▮▮ F, miguel/machines-home) copied into a box of the view (the sidebar's or
 * the drawer's foot, round 7): the live one stays where it is painted; this copy follows it (call again on renders)
 * and opens Settings › AI. Returns the copy's signature so callers repaint only on change. */
export function gaugeInto(doc, box, last, open, own) {
  const src = [...doc.querySelectorAll('.mh-gauge')].find(n => !n.classList.contains('is-still') && !n.closest('[data-fuel-copy]'));
  // (4 Nov 2026: with the network Home off there is no live gauge to copy, so the view draws its own from the AI usage feed)
  const g = !src && typeof own === 'function' ? own() : null;
  const sig = src && typeof src.cloneNode === 'function' ? `${src.getAttribute('data-s')}|${src.getAttribute('aria-label')}|${src.querySelectorAll('.on').length}`
    : g ? `own|${g.left}|${g.names.join(',')}|${g.old ? 1 : 0}` : '';
  if (sig === last) return last;
  if (!sig) { box.replaceChildren(); box.hidden = true; return sig; }
  const c = src ? src.cloneNode(true) : fuelEl(doc, g);
  for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
  c.removeAttribute('data-go'); c.classList.add('vw-gauge');
  box.replaceChildren(c); box.hidden = false;
  // (the own gauge opens Settings › Resources, the AI usage page; Settings › AI exists only with the network Home)
  c.addEventListener('click', () => src ? open() : open('usage'));
  return sig;
}
/** The AI fuel left, read straight from the AI usage feed (resources state) when the network Home is off: the default
 * model's own accounts (plan limits over credit), else every plan account, else every credit balance; each account
 * counts its tightest weekly limit left. null while nothing is readable. Pure. */
export function fuelOf(state, provider) {
  const subs = [];
  for (const p of state?.ai?.providers || []) {
    const kind = String(p.provider || p.id || '').split(':')[0], ls = Array.isArray(p.limits) ? p.limits : [], wk = ls.filter(l => /week/i.test(l.label));
    const pick = (wk.length ? wk : ls).reduce((a, l) => l && Number.isFinite(l.remainingPercent) && (!a || l.remainingPercent < a.remainingPercent) ? l : a, null);
    let left = pick ? pick.remainingPercent : null, unit = 'plan';
    const paid = p.paid;
    if (left == null && paid?.type === 'credits' && paid.limitMinor > 0 && paid.balanceMinor != null) { left = 100 * paid.balanceMinor / paid.limitMinor; unit = 'credit'; }
    const out = p.signedOut === true || p.status === 'signed_out' || p.status === 'auth' || p.status === 'unavailable';
    if (left == null || out) continue;
    const at = Date.parse(p.fetchedAt || state?.ai?.fetchedAt || '');
    subs.push({ kind, unit, group: p.providerName || kind, left: Math.max(0, Math.min(100, left)), old: p.status === 'stale' || !at || Date.now() - at > 300000 });
  }
  if (!subs.length) return null;
  const pv = String(provider || '').toLowerCase();
  const want = pv ? (subs.find(s => s.kind === pv || s.group.toLowerCase() === pv || pv.startsWith(s.kind + ':'))?.kind
    || (/^(claude|claude-code|anthropic)$/.test(pv) ? 'claude' : /^(openai|openai-codex|codex|chatgpt)$/.test(pv) ? 'chatgpt' : /^tinfoil$/.test(pv) ? 'tinfoil' : '')) : '';
  const mine = want ? subs.filter(s => s.kind === want) : [], unit = mine.some(s => s.unit === 'plan') ? 'plan' : 'credit';
  const pool = mine.filter(s => s.unit === unit), plans = subs.filter(s => s.unit === 'plan');
  const use = pool.length ? pool : plans.length ? plans : subs;
  const left = Math.round(use.reduce((n, s) => n + s.left, 0) / use.length);
  return { left, names: [...new Set(use.map(s => s.group))], old: !!state?.aiError || use.some(s => s.old) };
}
/** The fuel tag drawn by the view itself: E, ten cells, F (the network Home's look, classes and words). */
export function fuelEl(doc, g) {
  const s = g.left <= 10 ? 'no' : g.left <= 25 ? 'tight' : 'ok', on = Math.round(g.left / 10), old = g.old ? ' (last reading)' : '';
  const b = doc.createElement('button'); b.type = 'button'; b.className = 'mh-gauge'; b.setAttribute('data-s', s);
  b.setAttribute('aria-label', `AI fuel: ${g.left}% left${old}, ${g.names.join(' and ')}. Open AI in Settings`);
  b.setAttribute('title', `AI fuel · ${g.names.join(' + ')} · ${g.left}% left${old}`);
  const ef = t => { const x = doc.createElement('span'); x.className = 'mh-g-ef'; x.textContent = t; return x; };
  const cells = doc.createElement('span'); cells.className = 'mh-g-cells'; cells.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 10; i++) { const c = doc.createElement('i'); if (i < on) c.className = 'on'; cells.append(c); }
  b.append(ef('E'), cells, ef('F'));
  return b;
}
/** The box of one column of a grid row (the composer's orb slot, round 6): its middle in viewport px and its size
 * ({ x, y, d }), on the grid's last row. Read from the resolved tracks, so it is right whether the composer is one line
 * or two (words on top, the controls under them). null when the row is not a grid or the column is empty. */
export function gridSlot(row, col) {
  const cs = row?.ownerDocument?.defaultView?.getComputedStyle(row); if (!cs) return null;
  const cols = String(cs.gridTemplateColumns).split(' ').map(parseFloat), rows = String(cs.gridTemplateRows).split(' ').map(parseFloat);
  if (cols.length <= col || cols.some(Number.isNaN) || !rows.length || rows.some(Number.isNaN)) return null;
  const r = row.getBoundingClientRect(), px = k => parseFloat(cs[k]) || 0, cg = px('columnGap'), rg = px('rowGap');
  let x = r.left + px('borderLeftWidth') + px('paddingLeft'), y = r.top + px('borderTopWidth') + px('paddingTop');
  for (let i = 0; i < col; i++) x += cols[i] + cg;
  for (let i = 0; i < rows.length - 1; i++) y += rows[i] + rg;
  const w = cols[col], h = rows[rows.length - 1];
  return w > 0 && h > 0 ? { x: x + w / 2, y: y + h / 2, d: Math.min(w, h) } : null;
}

/* ---------- round 15 (Miguel, 3 Nov 2026: Arc-style desktop): pinned apps and auto-tidy ---------- */
/** The pinned row's first pins (only the ones installed), in this order; afterwards the owner's own order. */
export const DEFAULT_PINS = Object.freeze(['music', 'mail', 'messenger', 'calendar', 'money']);
/** The pins to show: the owner's stored list (kept order, unknown or uninstalled ids dropped, no repeats), else the
 * defaults that are installed. */
export function pinsFrom(stored, installed) {
  const have = new Set(installed || []), seen = new Set();
  // (a default names the app; its installed id may carry the stock "wizard-" prefix)
  const list = Array.isArray(stored) ? stored : DEFAULT_PINS.map(n => have.has(n) ? n : 'wizard-' + n);
  return list.filter(id => typeof id === 'string' && have.has(id) && !seen.has(id) && seen.add(id));
}
/** Pin or unpin one app (pinning appends: pin order = the owner's order). */
export const togglePin = (pins, id) => pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id];
/** Auto-tidy (Arc): how long an open, unpinned app may sit unused before its desk closes. */
export const TIDY = Object.freeze({ off: 0, '12h': 12 * 3600e3, '24h': 24 * 3600e3, week: 7 * 24 * 3600e3 });
export const TIDY_WORDS = Object.freeze({ off: 'Off', '12h': '12 hours', '24h': '24 hours', week: '1 week' });
export const TIDY_DEFAULT = '24h';
/** The desks auto-tidy closes now: open, not pinned, not a Chats desk, not on screen, last used longer ago than the
 * limit (an app never seen yet counts from now: seed `used` first). Highest desk first, so closing one never shifts
 * the next one's number. Pure: the clock and the usage are passed in. */
export function tidyPlan(desks, { pins = [], used = {}, now = 0, limit = 0, keep = [] } = {}) {
  if (!(limit > 0)) return [];
  const pinned = new Set(pins), kept = new Set(keep);
  return (desks || []).filter(d => d && d.id && d.id !== 'wizard' && !pinned.has(d.id) && !kept.has(d.desk) && typeof used[d.id] === 'number' && now - used[d.id] > limit)
    .sort((a, b) => b.desk - a.desk);
}
/** Usage seeded for apps never seen (they count from now), and forgotten for apps no longer open. */
export function seedUsed(used, desks, now) {
  const out = {}, open = new Set((desks || []).map(d => d.id));
  for (const id of open) out[id] = typeof used?.[id] === 'number' ? used[id] : now;
  return out;
}
/** The toast's words for a tidy (round 18, Miguel: the setting's own words): "Closed 3 apps you hadn't used in 24 hours". */
export function tidyWords(n, key) {
  return `Closed ${n} app${n === 1 ? '' : 's'} you hadn't used in ${TIDY_WORDS[key] || TIDY_WORDS[TIDY_DEFAULT]}`;
}
/** Round 18: the short forms (the desktop column's foot 'Tidy: 24h', the phone Home's line). */
export const TIDY_SHORT = Object.freeze({ off: 'Off', '12h': '12h', '24h': '24h', week: '1 week' });
/** The phone Home's quiet line under +: "Unused apps close after 24h" (Off: they stay open). */
export const tidyLine = key => key === 'off' ? 'Unused apps stay open' : `Unused apps close after ${TIDY_SHORT[key] || TIDY_SHORT[TIDY_DEFAULT]}`;
/** Round 18 (Miguel, 3 Nov 2026: the setting reads as a sentence, desktop and phone alike): "Tidy up: close apps you
 * haven't used in [24 hours ▾]. Pinned apps always stay open." as a <p> of the given class, its [..] a <select> of
 * Off / 12 hours / 24 hours / 1 week; onPick(key) on a change. */
export function tidySentence(doc, key, onPick, cls) {
  const p = doc.createElement('p'); p.className = cls;
  const sel = doc.createElement('select'); sel.className = cls + '-sel'; sel.setAttribute('aria-label', 'Close apps you haven\'t used in');
  for (const k of Object.keys(TIDY)) { const o = doc.createElement('option'); o.value = k; o.textContent = TIDY_WORDS[k]; if (k === key) o.setAttribute('selected', ''); sel.append(o); }
  sel.value = key;
  sel.addEventListener('change', () => onPick(Object.prototype.hasOwnProperty.call(TIDY, sel.value) ? sel.value : TIDY_DEFAULT));
  const b = doc.createElement('b'); b.textContent = 'Tidy up:';
  const w = t => { const n = doc.createElement('span'); n.textContent = t; return n; };
  p.append(b, w(' close apps you haven\'t used in '), sel, w('. Pinned apps always stay open.'));
  return p;
}

/* ---------- round 18 item 3 (Miguel, 3 Nov 2026): Ready's order, the stock Chats Filter choice ----------
 * The same three orders and the same saved choice as stock Chats (api.sessions.order / setOrder: its
 * wos.chats.readyOrder.v1, shared across devices through the box preferences), so both views always agree. A stored
 * 'subject' (stock's By subject) reads as Priority here (the view has no subject groups). Notifications sort in the
 * same list by the same rule (never appended separately); read ones (snoozed) stay at the end, by time. */
/* ---------- round 19 (Miguel, 3 Nov 2026): the order inside each group, and the folded rail used as it is ----------
 * Grouping by status already IS the priority, so the desktop sidebar offers only the order inside each group: Newest
 * first / Oldest first (Settings › Chats & app screens). Saved where stock Chats keeps its order (the same key); a
 * stock Priority or By subject reads as Newest here. */
export const GROUP_ORDERS = Object.freeze([['newest', 'Newest first'], ['oldest', 'Oldest first']]);
export const groupOrder = o => o === 'oldest' ? 'oldest' : 'newest';
/** The chats behind one rail item, in the order the open sidebar draws them: 'snoozed' (as listed), 'ready' (all of
 * Ready in the chosen Group/Sort: what ⌥↓ walks), or one of Ready's statuses (that group only). */
export function railRows(s, key, order, mode) {
  if (key === 'working') return (s?.working || []).slice();
  if (key === 'snoozed') return (s?.snoozed || []).slice();
  if (key === 'ready') return readyFlat(s?.ready || [], order, mode);
  // (round 24b: a project on the folded rail, 'proj:<name>')
  if (String(key).startsWith('proj:')) return (projectGroups(s?.ready || [], order).find(g => g.state === key) || { rows: [] }).rows;
  return (readyGroups(s?.ready || [], order).find(g => g.state === key) || { rows: [] }).rows;
}
/** Which rail item is current for the chat in front (cur): the one last clicked while that chat is in it, else the
 * status group holding it, else Ready / Snoozed. { key, i, n } (i zero-based) or null. Pure. */
export function railActive(s, cur, last, order, mode) {
  if (!cur) return null;
  const at = key => { const ids = railRows(s, key, order, mode === 'projects' ? 'project' : undefined).map(r => r.id), i = ids.indexOf(cur); return i < 0 ? null : { key, i, n: ids.length }; };
  // A remembered Ready/status/project key must not win after its row disappears on a grouping switch.
  const common = last === 'working' || last === 'snoozed';
  const visible = mode === 'projects' ? common || String(last).startsWith('proj:')
    : mode === 'groups' ? last !== 'ready' && !String(last).startsWith('proj:')
    : mode === 'list' ? common || last === 'ready' : true;
  if (last && visible) { const a = at(last); if (a) return a; }
  // round 24b (Miguel, 4 Nov 2026: By project on the folded rail too): each project alone, as 'groups' does statuses
  if (mode === 'projects') { const sg = projectGroups(s?.ready || [], order).find(x => x.rows.some(r => r.id === cur)); return (sg && at(sg.state)) || at('snoozed') || at('working'); }
  // round 22: the rail shows Ready alone ('list') or its statuses alone ('groups', plain chats as 'none'); no mode = both
  const g = mode === 'list' ? null : stateGroups(s?.ready || []).find(x => (mode === 'groups' || x.state !== 'none') && x.rows.some(r => r.id === cur));
  return (g && at(g.state)) || (mode === 'groups' ? null : at('ready')) || at('snoozed') || at('working');
}
/** A rail item clicked: its first chat, or (when the chat in front is already in it) the next one, wrapping. */
export const railNext = (ids, cur) => readyStep(ids, cur, 1);
/** Sidebar and flyout use the phone/core labels, including elapsed hours across midnight. */
export const shortTime = (typeof window === 'object' ? window : globalThis).WizCore.ago;

/* ---------- round 19 item 4 (Miguel, 3 Nov 2026): the phone Home's dock ----------
 * The pinned apps live in a dock just above the composer (up to 2 rows × 4 = 8 a page; more pins page sideways with
 * dots); the grid above shows only the open apps not pinned, then +. Hold and drag: within the dock, within the grid
 * and between them (into the dock pins it there; out of it unpins it), the desktop column's own move (vtMove). */
export const DOCK_PER = 8;
/** The open apps (not pinned) in his own order once he has dragged them (ids; new ones after, as they come). Pure. */
export function orderOpen(open, ids) {
  if (!Array.isArray(ids) || !ids.length) return (open || []).slice();
  const at = id => { const i = ids.indexOf(id); return i < 0 ? Infinity : i; };
  return (open || []).map((d, k) => [d, k]).sort((a, b) => (at(a[0].id) - at(b[0].id)) || (a[1] - b[1])).map(x => x[0]);
}
/** A drop on Home: pins (ids), open (the grid's ids), item = { id, open }, to = { group: 'pin' | 'open', index } →
 * { pins, open } (vtMove keyed by app id: a pin not open dragged out simply unpins). Pure. */
export const homeDrop = (pins, open, item, to) => vtMove(pins, open, { id: item.id, desk: item.open ? item.id : null }, to);
/** The dock's pages: the pins in pages of DOCK_PER. */
export const dockPages = (list, per = DOCK_PER) => { const out = []; for (let i = 0; i < (list || []).length; i += per) out.push(list.slice(i, i + per)); return out; };

/* ---------- round 16 item 6 (Miguel, 3 Nov 2026): drag to rearrange the right column ---------- */
const clampI = (i, n) => Math.max(0, Math.min(n, i | 0));
/** Where a moved row lands. pins = the pin order (app ids); open = the open list below them (desk numbers, as shown);
 * item = { id, desk } (desk null for a pin not open); to = { group: 'pin' | 'open', index }. Into Pinned pins it there
 * (out of the open list); out of Pinned unpins it (an open one joins the open list there). Pure. */
export function vtMove(pins, open, item, to) {
  const P = (pins || []).filter(id => id !== item.id), O = (open || []).filter(d => d !== item.desk);
  if (to.group === 'pin') P.splice(clampI(to.index, P.length), 0, item.id);
  else if (item.desk != null) O.splice(clampI(to.index, O.length), 0, item.desk);
  return { pins: P, open: O };
}
/** The fewest desk moves (the stock moveDesk(from, to): take out, put in) that put `want` (desk numbers) in that order
 * among the desks, leaving the others where they are as far as it can: each one that sits before the previous wanted
 * desk moves to just after it (only ever later, so a desk never jumps ahead of Home's Chats desk). order = every desk
 * number in desk order. Returns { moves: [[from, to]…], order } (order = the old numbers in their new places). Pure. */
export function relMoves(order, want) {
  const a = [...order], moves = []; let prev = -1;
  for (const k of want || []) {
    let p = a.indexOf(k); if (p < 0) continue;
    if (p < prev) { a.splice(prev, 0, a.splice(p, 1)[0]); moves.push([p, prev]); p = prev; }
    prev = p;
  }
  return { moves, order: a };
}

/* ---------- round 16 item 7 (Miguel, 3 Nov 2026): one app model on the phone and the desktop ---------- */
/** The three layers. Pinned: every pin once, in his pin order, open or not ({ id, desk, name }; desk null = not open;
 * its first desk when open). Open: the other desks (never Home's own Chats desk, never a pinned app), badged first
 * until he has ordered them by hand (manual: the desks' order). The picker (layer 3) lists what is in neither. Pure. */
export function appLayers(desks, pins, { main = null, lit = () => false, manual = false, names = {}, chats = 'wizard' } = {}) {
  const rest = (desks || []).filter(d => d && d.id && d.desk !== main);
  const pinned = (pins || []).map(id => rest.find(d => d.id === id) || { desk: null, id, name: names[id] || '' });
  const pinIds = new Set(pins || []), others = rest.filter(d => !pinIds.has(d.id));
  const on = d => d.id !== chats && lit(d.id);
  return { pinned, open: manual ? others : [...others.filter(on), ...others.filter(d => !on(d))] };
}
/** Layer 3's exclusions: what the picker never repeats (pinned or open). */
export const shownIds = (layers, chats = 'wizard') => new Set([chats, ...layers.pinned.map(p => p.id), ...layers.open.map(d => d.id)]);

/** Round 20 item 9: the flat Ready's tiny muted tag, only on the rows that wait on him (FYI, Done, plain: none). */
export const STATE_TAG = Object.freeze({ approval: 'Approve', needs: 'Needs you', check: 'Your call', failed: 'Error' });
