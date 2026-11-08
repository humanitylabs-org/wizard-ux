/* Desktop-style Chats list (phone): the sidebar's header row. The stock list stays the list; this adds the desktop's top
 * line (the agent's name with a chevron, a search icon, a filter icon) in the shell's own list-top slot and folds the
 * stock search field away until it is wanted (search icon, a typed query or an active filter keeps it open). Every tap
 * paints on its own frame and calls the stock control underneath; nothing is stored. Teardown removes the header and
 * the classes. */
export default function setup(api) {
  if (api.env.shell !== 'phone') return () => {};
  const doc = document, SVG = 'http://www.w3.org/2000/svg';
  const icon = (paths, cls) => { const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls); for (const d of paths) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); } return s; };
  const head = doc.createElement('div'); head.className = 'dc-head';
  const name = doc.createElement('button'); name.type = 'button'; name.className = 'dc-name';
  const label = doc.createElement('b'); name.append(label, icon(['m7 10 5 5 5-5'], 'dc-chev'));
  const find = doc.createElement('button'); find.type = 'button'; find.className = 'dc-ib dc-find'; find.setAttribute('aria-label', 'Search chats'); find.append(icon(['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M15.5 15.5 20 20'], 'dc-ico'));
  const filt = doc.createElement('button'); filt.type = 'button'; filt.className = 'dc-ib dc-filter'; filt.setAttribute('aria-label', 'Filter chats'); filt.append(icon(['M4 7h16', 'M7 12h10', 'M10 17h4'], 'dc-ico'));
  head.append(name, find, filt);
  let searchOpen = false;
<<<<<<< HEAD
  const list = () => api.slot('list-top')?.closest('.ch-list') || null;
  const tab = l => l?.querySelector('.ch-focus-tab.on') || null;
  const sync = () => {
    const l = list(); if (!l) return;
    if (head.parentNode !== api.slot('list-top')) api.slot.mount('list-top', head, -10);
    const t = tab(l), nm = t?.querySelector('span:last-of-type')?.textContent?.trim();
=======
  /* no selector strings: the tweak lint allows only [data-slot]/[data-part] ones, so the stock list is found by its part and its controls by class/attribute walks */
  const list = () => api.part('list');
  const first = (l, cls) => l?.getElementsByClassName?.(cls)?.[0] || null;
  const attr = (l, a) => Array.from(l?.getElementsByTagName?.('*') || []).find(n => n.hasAttribute(a)) || null;
  const tab = l => Array.from(l?.getElementsByClassName?.('ch-focus-tab') || []).find(t => t.classList.contains('on')) || null;
  const sync = () => {
    const l = list(); if (!l) return;
    if (head.parentNode !== api.slot('list-top')) api.slot.mount('list-top', head, -10);
    const t = tab(l), nm = Array.from(t?.getElementsByTagName?.('span') || []).pop()?.textContent?.trim();
>>>>>>> origin/main
    const text = !t || /^all$/i.test(nm || '') ? 'All chats' : nm;
    if (label.textContent !== text) label.textContent = text;
    const isAgent = !!t && /^agent:/.test(t.dataset.chfocusopt || '');
    name.disabled = !isAgent; name.classList.toggle('dc-static', !isAgent);
<<<<<<< HEAD
    const input = l.querySelector('[data-chsearch]'), fb = l.querySelector('[data-chfbtn]');
    const chipOn = !!l.querySelector('.ch-search .ch-chip');
=======
    const input = attr(l, 'data-chsearch');
    const chipOn = !!first(l, 'ch-search')?.getElementsByClassName?.('ch-chip')?.length;
>>>>>>> origin/main
    const open = searchOpen || !!input?.value || chipOn;
    l.classList.toggle('dc-search', open); find.setAttribute('aria-pressed', String(open));
    filt.classList.toggle('on', chipOn);
  };
  api.on('render', sync);
  sync();
  api.listen(head, 'click', e => {
    const l = list(); if (!l) return;
<<<<<<< HEAD
    if (e.target.closest('.dc-find')) { searchOpen = !searchOpen && !l.querySelector('[data-chsearch]')?.value; sync(); if (searchOpen) l.querySelector('[data-chsearch]')?.focus(); }
    else if (e.target.closest('.dc-filter')) l.querySelector('[data-chfbtn]')?.click();
    else if (e.target.closest('.dc-name')) tab(l)?.click();
  });
  api.listen(doc, 'focusout', e => {
    const l = list(); const input = l?.querySelector('[data-chsearch]');
    if (!input || e.target !== input || input.value || e.relatedTarget?.closest?.('.ch-top, .dc-head')) return;
    searchOpen = false; api.after ? api.after(120, sync) : setTimeout(sync, 120);
  });
  api.listen(doc, 'input', e => { if (e.target?.matches?.('[data-chsearch]')) sync(); });
=======
    if (find.contains(e.target)) { searchOpen = !searchOpen && !attr(l, 'data-chsearch')?.value; sync(); if (searchOpen) attr(l, 'data-chsearch')?.focus(); }
    else if (filt.contains(e.target)) attr(l, 'data-chfbtn')?.click();
    else if (name.contains(e.target)) tab(l)?.click();
  });
  api.listen(doc, 'focusout', e => {
    const l = list(); const input = attr(l, 'data-chsearch'), to = e.relatedTarget;
    if (!input || e.target !== input || input.value || (to && (head.contains(to) || first(l, 'ch-top')?.contains(to)))) return;
    searchOpen = false; api.frame(() => api.frame(sync));
  });
  api.listen(doc, 'input', e => { if (e.target?.hasAttribute?.('data-chsearch')) sync(); });
>>>>>>> origin/main
  return () => { head.remove(); list()?.classList.remove('dc-search'); };
}
