/* Apps view (Miguel, 1 Nov 2026). Worn by the miguel/apps-home tweak, off by default, picked with the
 * Desks | Orb | Apps switch (phone: top of Home; desktop: the middle of the bar).
 *
 *   Phone: Home looks like a standard iPhone / Android home screen: a grid of app icons, ONE per desk (each desk is one
 *   app), in desk order, each with its real logo (else the dock's own mark for it), its name and its live count. A tap
 *   opens that desk. Chats is always the first icon, with the Ready count, and opens the stock Chats list. The grid
 *   ends with a + tile: the sheet of every app not open yet (chrome.js); a pick opens it on a desk of its own. Home's
 *   own top stays (which Wizard, the AI fuel gauge, the gear). The stock desk switcher is gone on EVERY screen
 *   (chrome.css): only the dock orb is left at the bottom centre, exactly where it sits: tap talks, hold commands, a
 *   swipe up goes Home (this grid), like the iPhone's home swipe; sideways and down do nothing (chrome.js ORB_SWIPES).
 *   No Back button.
 *
 *   Desktop: the same idea as a launchpad (desktop.js).
 *
 * No timers, no motion of its own: it repaints when the route, the desks or a count change. Colours are the wearing
 * tweak's tokens (--ap-*: miguel/apps-home tweak.css). Everything through the layout API. */
import { viewChrome } from './chrome.js';
import desktop from './desktop.js';

const CHATS = 'wizard';

export default function setup(api) {
  if (api.env.shell === 'desktop') return desktop(api);
  if (api.env.shell !== 'phone') return () => {};
  const doc = document, root = doc.documentElement;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };

  const grid = el('nav', 'ap-grid', { 'aria-label': 'Apps' });
  root.dataset.appsHome = 'on';
  const desks = () => (api.desks?.list || api.phone.desks)();
  // the + sheet (every app not open yet) and the orb swipes (up = Home)
  const chrome = viewChrome(api, { openIds: () => desks().map(d => d.id) });
  // the grid's last tile: a + in a plain tile, labelled like the others
  const plus = chrome.plus('ap-icon ap-plus', 'Add an app', (b, ico) => { b.setAttribute('data-app', '+add'); const t = el('span', 'ap-tile', { 'aria-hidden': 'true' }); t.append(ico); b.append(t, el('span', 'ap-label', { text: 'Add' })); });

  // Chats first, then every app with a badge, then the rest, each in desk order (Miguel, 2 Nov 2026: the same order as
  // the Orb's ring). A newly opened app grows into its place (chrome.css .vc-born) instead of just appearing.
  const litFirst = out => [out[0], ...out.slice(1).filter(i => (badgeMap[i.id] || 0) > 0), ...out.slice(1).filter(i => !((badgeMap[i.id] || 0) > 0))];
  const bornIf = (on, x) => { if (on && x?.b) { x.b.classList.add('vc-born'); api.after(800, () => x.b.classList.remove('vc-born')); } return x; };
  let badgeMap = api.apps.badges(m => { badgeMap = m; paint(); });   // a badge can reorder the grid (badged apps first)
  let names = new Map(), sig = '', icons = [];
  const nameOf = (id, fallback) => names.get(id) || fallback || id;

  // one icon: a tile with the app's logo (or the dock's mark for it), a count badge and its name under it
  function icon(item) {
    const b = el('button', 'ap-icon', { type: 'button', 'data-app': item.id, ...(item.desk != null ? { 'data-desk': String(item.desk) } : {}) });
    const tile = el('span', 'ap-tile', { 'aria-hidden': 'true' });
    const mark = api.phone.mark(item.id);
    if (mark) { mark.querySelector?.('.dbg')?.remove(); mark.classList?.add('ap-mark'); tile.append(mark); }
    const c = mark?.style?.getPropertyValue?.('--c'); if (c) b.style.setProperty('--c', c);
    const count = el('b', 'ap-badge', { 'aria-hidden': 'true' }); count.hidden = true;
    b.append(tile, count, el('span', 'ap-label', { text: item.name }));
    const go = () => {
      if (item.id === CHATS) api.sessions.openList('ready');
      else if (item.desk != null) api.nav.goDesk(item.desk);
    };
    api.listen(b, 'click', go);
    chrome.menuOn(b, item, { onOpen: go, onClosed: () => api.after(60, paint) });   // long press: Open · Close (stays installed)
    if (item.id !== CHATS) api.apps.logo(item.id).then(url => {
      if (!url || !b.isConnected) return;
      const im = el('img', 'ap-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { tile.replaceChildren(im); b.classList.add('is-logo'); }, () => {});
    });
    return { b, count, item };
  }

  function items() {
    names = new Map(api.apps.list().map(a => [a.id, a.name]));
    const out = [{ id: CHATS, name: 'Chats', desk: null }];
    for (const d of desks()) if (d.id && d.id !== CHATS) out.push({ id: d.id, name: nameOf(d.id, d.name), desk: d.desk });
    return litFirst(out);
  }
  function paintCounts() {
    for (const { b, count, item } of icons) {
      const n = badgeMap[item.id] || 0;
      count.textContent = n ? (api.apps.badgeText?.(item.id) || (n > 99 ? '99+' : n ? String(n) : '')) : ''; count.hidden = !n;
      b.setAttribute('aria-label', item.id === CHATS ? (n ? `Chats, ${n} ready` : 'Chats') : `${item.name}${n ? `, ${n} new` : ''}`);
    }
  }
  function paint() {
    const sec = api.phone.home(); if (sec && grid.parentNode !== sec) sec.append(grid);   // a rebuilt desk strip: back in
    const list = items(), next = list.map(i => `${i.id}@${i.desk}:${i.name}`).join('|');
    if (next !== sig) {
      sig = next;
      const was = new Map(icons.map(x => [`${x.item.id}@${x.item.desk}:${x.item.name}`, x]));
      const first = !icons.length;
      icons = list.map(i => was.get(`${i.id}@${i.desk}:${i.name}`) || bornIf(!first, icon(i)));
      grid.replaceChildren(...icons.map(x => x.b), plus);
    }
    paintCounts();
  }
  api.on('route', paint);
  api.on('render', paint);
  api.on('home', paint);
  paint();

  return () => { grid.remove(); chrome.dispose(); delete root.dataset.appsHome; };
}
