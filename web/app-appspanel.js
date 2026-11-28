/* Wizard UX phone shell › the Apps tile's Favorites panel and hold-for-nine quick switcher (wizard-ux#1955, on for
 * everyone since the switch wizard/apps-panel went; the phone's four-section bar, app-sections.js).
 *
 * Tap Apps: a slim panel above the tile instead of the full-screen Apps sheet. Top to bottom: \"Search apps\" with All
 * apps and Get apps, Favorites (the owner's pinned apps, in order, with Edit), Recent (the last four apps used that are
 * not Favorites, each with an × that takes it off Recent). Search shows matching installed apps, best first; Enter opens
 * the best. All apps is the A–Z list. Edit: drag to reorder, minus to remove, Add favorites (All apps with stars), Done.
 * Long-press a row: Add to / Remove from Favorites, and Add to Home Screen when the app can be pinned (ux#2001). Tap outside, swipe the panel right or down, or Back closes it.
 * Hold Apps (350 ms): nine round bubbles above the tile, recent first then favorites, the newest bottom-right; slide onto
 * one and let go to open it, let go elsewhere to cancel.
 * While Apps is the section in front, a sideways swipe anywhere on the bar steps one app through Recent (left = older,
 * right = newer), stopping at the ends; app-sections.js (the Apps tile) and app-scrub.js (the rest of the bar, the orb's
 * sideways drag) hand those swipes here.
 * Favorites and the apps taken off Recent are box preferences (ui-preferences appFavorites, appRecentHidden), so they
 * are the same on every device of the owner; opening an app again puts it back on Recent. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.appspanel = function ({ $, APP, APPS, appVars, CHATS_APP, device, esc, ico, LIVE, norm, openApp, openStoreKind, phoneBack, store, tapOpen, toast, vib }) {
  const AP_FAV = 'wos.apps.favorites.v1', AP_HID = 'wos.apps.recentHidden.v1', AP_ID = /^[A-Za-z0-9._-]{1,80}$/;
  // var, not let: the shell's tests put this body back into app.js (tests/fixtures/app-parts.mjs), where its hoisted
  // functions may run before this body has; apReady is true only once all of it has.
  var apReady = false;
  // Up wherever the phone's four-section bar is (never on the desktop shell).
  function apOn() {
    try { return !!window.WizCore.phoneSections?.on?.(); } catch (_) { return false; }
  }
  /* ---- the lists ---- */
  // An agent's chats are the tile `agent:<id>` (core/apps.js); the box's ui-preferences take app ids without a colon,
  // so the lists store it as `agent.<id>` and read it back (ux#1989: a starred agent never stuck).
  const apKey = id => String(id).replace(/^agent:/, 'agent.'), apUnkey = k => String(k).replace(/^agent\./, 'agent:');
  const apRead = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && AP_ID.test(x)).map(apUnkey) : []; } catch (_) { return []; } };
  // This device at once, then the box for every device (live-work.js prefsFields keeps the copy in step).
  // The box gets one item operation per edit (WizLive.prefOps add / remove / move one app id, wizard-ux#2047), never
  // this phone's whole cached list: a phone that had not pulled used to erase another phone's edit.
  const apWrite = (k, field, list, op) => {
    list = [...new Set(list.filter(x => typeof x === 'string').map(apKey).filter(x => AP_ID.test(x)))].slice(0, 100); try { localStorage.setItem(k, JSON.stringify(list)); } catch (_) {}
    op = { ...op, key: field, item: apKey(op.item) }; if (op.items) op.items = [...new Set(op.items.map(apKey))].filter(x => AP_ID.test(x)).slice(0, 100);
    if (AP_ID.test(op.item)) LIVE?.prefOps?.([op]);
  };
  // What the panel lists: things you open and use, sorted the launcher's way (WosAppKinds): Apps, In development and
  // each agent's chats; never Connectors or screenless agent apps (they stay in Get apps and Settings).
  function apOk() {
    const K = window.WosAppKinds?.kinds(APPS, APP); if (!K) return new Set();
    return new Set([...K.apps, ...K.dev, ...K.agents].filter(a => a && APP[a.id] === a && a.id !== 'agents' && a.kind !== 'native').map(a => a.id));
  }
  const apUsable = (a, ok = apOk()) => !!a && ok.has(a.id);
  const apAll = () => { const ok = apOk(); return APPS.filter(a => apUsable(a, ok)).sort((x, y) => (x.name || '').localeCompare(y.name || '', undefined, { sensitivity: 'base' })); };
  const apFavs = () => { const ok = apOk(); return [...new Set(apRead(AP_FAV).map(id => APP[id]?.id))].filter(id => id && apUsable(APP[id], ok)); };
  const apHidden = () => new Set(apRead(AP_HID));
  function apRecentAll() {
    const hid = apHidden(), ok = apOk();
    return [...new Set(store.get('recent', window.WizLauncher?.get('recents') || []).map(id => APP[id]?.id))].filter(id => id && id !== 'app-store' && !hid.has(id) && apUsable(APP[id], ok));
  }
  const apRecent = () => { const f = new Set(apFavs()); return apRecentAll().filter(id => !f.has(id)).slice(0, 4); };
  const apIsFav = id => apFavs().includes(id);
  function apSetFav(id, on) {
    const raw = apRead(AP_FAV).filter(x => x !== id);
    apWrite(AP_FAV, 'appFavorites', on ? [...raw, id] : raw, { op: on ? 'add' : 'remove', item: id }); apPaint();
  }
  function apDropRecent(id) {
    apWrite(AP_HID, 'appRecentHidden', [...apRead(AP_HID), id], { op: 'add', item: id });
    store.set('recent', store.get('recent', []).filter(x => x !== id)); // this device's own list too
    vib(6); apPaint();
  }
  // Opened again (from here or any other tile): it is a recent app again on every device.
  function apOpened(id) {
    if (!apReady || !apOn()) return;
    const raw = apRead(AP_HID); if (raw.includes(id)) apWrite(AP_HID, 'appRecentHidden', raw.filter(x => x !== id), { op: 'remove', item: id });
  }
  window.WizCore.appsPanelOpened = apOpened;

  /* ---- the panel ---- */
  const apSvg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const AP_I = {
    search: apSvg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    grid: apSvg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
    plus: apSvg('<path d="M12 5v14M5 12h14"/>'),
    pencil: apSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    x: apSvg('<path d="M7 7l10 10M17 7 7 17"/>'),
    minus: apSvg('<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>'),
    back: apSvg('<path d="M15 5l-7 7 7 7"/>'),
    drag: apSvg('<path d="M5 9h14M5 15h14"/>'),
    star: apSvg('<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z"/>'),
  };
  const apEl = document.createElement('section'), apScrim = document.createElement('div'), apGrid = document.createElement('div');
  apScrim.className = 'ap-scrim'; apScrim.id = 'apScrim';
  apEl.className = 'ap-panel'; apEl.id = 'appsPanel'; apEl.setAttribute('role', 'dialog'); apEl.setAttribute('aria-label', 'Apps'); apEl.hidden = true;
  apEl.innerHTML = `<form class="ap-top" data-apform role="search">
      <label class="ap-q">${AP_I.search}<input type="search" data-apq placeholder="Search apps" aria-label="Search apps" autocomplete="off" spellcheck="false" enterkeyhint="go"></label>
      <button class="ap-ib" type="button" data-apall aria-label="All apps" title="All apps">${AP_I.grid}</button>
      <button class="ap-ib" type="button" data-apget aria-label="Get apps" title="Get apps">${AP_I.plus}</button>
    </form><div class="ap-body" data-apbody></div>`;
  apGrid.className = 'ap-grid'; apGrid.id = 'appsGrid'; apGrid.hidden = true; apGrid.setAttribute('role', 'menu'); apGrid.setAttribute('aria-label', 'Recent apps');
  apScrim.hidden = true;
  device.append(apScrim, apEl, apGrid);
  const apQ = apEl.querySelector('[data-apq]'), apBody = apEl.querySelector('[data-apbody]');
  // view: 'home' (Favorites + Recent) or 'all'; edit: Favorites edit mode; add: All apps with stars (Add favorites).
  var apState = { open: false, view: 'home', edit: false, add: false, closedAt: 0 };
  const apRow = (a, tail = '', cls = '') => `<div class="ap-row${cls}" data-aprow="${esc(a.id)}"><button class="ap-open" type="button" data-apopen="${esc(a.id)}">${ico('span', 'ap-ic', a)}<span class="ap-nm">${esc(a.name)}</span></button>${tail}</div>`;
  const apHead = (text, btn = '') => `<div class="ap-h"><span class="ap-ht">${text}</span>${btn}</div>`;
  const apStar = a => { const on = apIsFav(a.id); return `<button class="ap-star${on ? ' on' : ''}" type="button" data-apstar="${esc(a.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(a.name)} ${on ? 'from' : 'to'} Favorites">${AP_I.star}</button>`; };
  function apMatches(q) {
    const n = norm(q); if (!n) return [];
    return apAll().map(a => { const nm = norm(a.name || ''), ds = norm(a.desc || ''); return [nm.startsWith(n) ? 3 : nm.split(/\s+/).some(w => w.startsWith(n)) ? 2.5 : nm.includes(n) ? 2 : ds.includes(n) ? 1 : 0, a]; })
      .filter(x => x[0]).sort((x, y) => y[0] - x[0]).map(x => x[1]);
  }
  function apHtml() {
    const q = apQ.value.trim();
    if (q) {
      const hits = apMatches(q);
      return hits.length ? `<div class="ap-list" role="list">${hits.map((a, i) => apRow(a, apState.add ? apStar(a) : '', i ? '' : ' ap-best')).join('')}</div>` : '<p class="ap-none">No app matches</p>';
    }
    if (apState.view === 'all') {
      return `${apHead(`<button class="ap-ib ap-back" type="button" data-apback aria-label="Back">${AP_I.back}</button>${apState.add ? 'Add favorites' : 'All apps'}`, apState.add ? '<button class="ap-tb" type="button" data-apdone>Done</button>' : '')}
        <div class="ap-list" role="list">${apAll().map(a => apRow(a, apState.add ? apStar(a) : '')).join('')}</div>`;
    }
    const favs = apFavs().map(id => APP[id]), rec = apRecent().map(id => APP[id]);
    const editBtn = apState.edit ? '<button class="ap-tb" type="button" data-apdone>Done</button>'
      : `<button class="ap-tb" type="button" data-apedit aria-label="Edit favorites">${AP_I.pencil}<span>Edit</span></button>`;
    const favRows = favs.map(a => apState.edit
      ? `<div class="ap-row ap-editing" data-aprow="${esc(a.id)}"><button class="ap-ib ap-minus" type="button" data-apminus="${esc(a.id)}" aria-label="Remove ${esc(a.name)} from Favorites">${AP_I.minus}</button><span class="ap-open ap-still">${ico('span', 'ap-ic', a)}<span class="ap-nm">${esc(a.name)}</span></span><span class="ap-ib ap-drag" data-apdrag="${esc(a.id)}" role="button" aria-label="Drag ${esc(a.name)} to reorder">${AP_I.drag}</span></div>`
      : apRow(a)).join('');
    const add = `<button class="ap-add" type="button" data-apadd>${AP_I.star}<span>Add favorites</span></button>`;
    const favBody = favs.length ? `<div class="ap-list" role="list" data-apfavs>${favRows}</div>${apState.edit ? add : ''}`
      : `<p class="ap-empty">Star apps to keep them here</p>${add}`;
    const recBody = rec.length ? apHead('Recent') + `<div class="ap-list" role="list">${rec.map(a => apRow(a, `<button class="ap-ib ap-x" type="button" data-apx="${esc(a.id)}" aria-label="Remove ${esc(a.name)} from Recent">${AP_I.x}</button>`)).join('')}</div>` : '';
    return apHead('Favorites', favs.length || apState.edit ? editBtn : '') + favBody + recBody;
  }
  function apPaint() {
    if (!apState.open) return;
    apBody.innerHTML = apHtml();
    apEl.classList.toggle('ap-tall', apState.view === 'all' && !apQ.value.trim());
    apEl.dataset.view = apState.view; apEl.classList.toggle('ap-editmode', apState.edit);
  }
  // Both sit just above the bar's tiles, wherever the skin and the phone put them; the panel (wide enough to reach over
  // the orb) also clears the orb's top.
  function apPlace(clearOrb) {
    const bar = $('#secR') || $('#dock'), dv = device.getBoundingClientRect(), r = bar?.getBoundingClientRect(); if (!r || !r.height) return;
    const o = clearOrb ? $('#orbWrap')?.getBoundingClientRect() : null, top = o && o.height ? Math.min(r.top, o.top) : r.top;
    device.style.setProperty('--ap-above', Math.round(dv.bottom - top + 4) + 'px');
  }
  function apOpen() {
    if (!apReady || !apOn()) return false;
    apGridClose(); apPlace(true);
    apState = { ...apState, open: true, view: 'home', edit: false, add: false };
    apQ.value = ''; apEl.hidden = false; apScrim.hidden = false; apPaint(); apBody.scrollTop = 0;
    device.classList.add('ap-panel-up');
    requestAnimationFrame(() => { apEl.classList.add('open'); apScrim.classList.add('open'); });
    vib(6); return true;
  }
  function apClose() {
    if (!apState.open) return false;
    apState.open = false; apState.closedAt = Date.now(); apEl.classList.remove('open'); apScrim.classList.remove('open'); device.classList.remove('ap-panel-up');
    apQ.blur(); window.WosContextMenu?.isOpen && window.WosContextMenu.back?.();
    apEl.style.transform = ''; apEl.hidden = true; apScrim.hidden = !apGridState; return true;
  }
  function apPick(id) {
    const a = APP[id]; if (!a) return;
    apClose(); apOpened(a.id); tapOpen(a, null, false);
  }
  phoneBack?.watch?.(() => apState.open, () => { apClose(); return 'apps-panel'; }, 'apps-panel');
  apScrim.addEventListener('click', () => { apClose(); apGridClose(); });
  // A tap on the bar while the panel is up closes it (the Apps tile itself toggles it, see appsPanelOpen).
  $('#dock').addEventListener('pointerdown', e => { if (apState.open && !e.target.closest?.('.sec-tile[data-sec="apps"]')) apClose(); }, true);
  apEl.querySelector('[data-apform]').addEventListener('submit', e => {
    e.preventDefault(); const a = apMatches(apQ.value.trim())[0]; if (a) apPick(a.id);
  });
  apQ.addEventListener('input', () => { apPaint(); apBody.scrollTop = 0; });
  var apLong = null, apLongAt = 0;
  apEl.addEventListener('click', e => {
    const t = e.target.closest?.('button,[data-apdrag]'); if (!t) return;
    if (Date.now() - apLongAt < 600) return; // the long-press menu just opened from this finger
    const d = t.dataset;
    if ('apall' in d) { apState.view = 'all'; apState.add = false; apState.edit = false; apPaint(); apBody.scrollTop = 0; return; }
    if ('apget' in d) { apClose(); openStoreKind('apps'); return; }
    if ('apback' in d) { apState.view = 'home'; apState.add = false; apPaint(); return; }
    if ('apedit' in d) { apState.edit = true; apPaint(); return; }
    if ('apdone' in d) { if (apState.add) { apState.add = false; apState.view = 'home'; apState.edit = true; } else apState.edit = false; apQ.value = ''; apPaint(); return; }
    if ('apadd' in d) { apState.view = 'all'; apState.add = true; apQ.value = ''; apPaint(); apBody.scrollTop = 0; return; }
    if (d.apstar) { apSetFav(d.apstar, !apIsFav(d.apstar)); vib(6); return; }
    if (d.apminus) { apSetFav(d.apminus, false); vib(6); return; }
    if (d.apx) { apDropRecent(d.apx); return; }
    if (d.apopen) { if (apState.add) { apSetFav(d.apopen, !apIsFav(d.apopen)); vib(6); return; } apPick(d.apopen); }
  });
  // Long-press a row: Add to / Remove from Favorites, and Add to Home Screen for every app the home-screen sheet can pin
  // (WizHomeScreenApps, as a hold on the Apps sheet or New desk grid; ux#2001). WosContextMenu, so Back and a tap
  // outside close it too.
  function apMenu(btn) {
    const id = btn.dataset.apopen, a = APP[id], M = window.WosContextMenu; if (!a || !M) return;
    apLongAt = Date.now(); vib(12);
    const r = btn.getBoundingClientRect(), fav = apIsFav(id), H = window.WizHomeScreenApps;
    const items = [{ label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: () => apSetFav(id, !fav) }];
    if (H?.canOffer?.(a)) items.push({ label: 'Add to Home Screen', action: () => H.offer(a) });
    M.open({ anchor: btn, x: Math.max(8, r.left + 12), y: r.bottom - 4, label: a.name, items });
  }
  apEl.addEventListener('contextmenu', e => { const b = e.target.closest?.('[data-apopen]'); if (!b) return; e.preventDefault(); if (Date.now() - apLongAt > 600) apMenu(b); });
  apEl.addEventListener('pointerdown', e => {
    const b = e.target.closest?.('button[data-apopen]'); clearTimeout(apLong?.t); apLong = null;
    if (b && !apState.add) apLong = { x: e.clientX, y: e.clientY, t: setTimeout(() => { apLong = null; apMenu(b); }, 500) };
  });
  apEl.addEventListener('pointermove', e => { if (apLong && Math.hypot(e.clientX - apLong.x, e.clientY - apLong.y) > 10) { clearTimeout(apLong.t); apLong = null; } });
  const apLongEnd = () => { if (apLong) { clearTimeout(apLong.t); apLong = null; } };
  apEl.addEventListener('pointerup', apLongEnd); apEl.addEventListener('pointercancel', apLongEnd);
  // Edit: drag a Favorite by its handle; the order is saved when the finger lifts.
  var apDrag = null;
  apEl.addEventListener('pointerdown', e => {
    const h = e.target.closest?.('[data-apdrag]'); if (!h) return;
    const row = h.closest('.ap-row'); e.preventDefault();
    apDrag = { id: e.pointerId, row, y: e.clientY }; row.classList.add('ap-dragging');
    try { h.setPointerCapture(e.pointerId); } catch (_) {}
  });
  apEl.addEventListener('pointermove', e => {
    if (!apDrag || e.pointerId !== apDrag.id) return;
    const list = apDrag.row.parentElement, rows = [...list.children].filter(r => r !== apDrag.row);
    const after = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    if (after) { if (apDrag.row.nextElementSibling !== after) list.insertBefore(apDrag.row, after); } else if (list.lastElementChild !== apDrag.row) list.append(apDrag.row);
  });
  const apDragEnd = e => {
    if (!apDrag || e.pointerId !== apDrag.id) return;
    const list = apDrag.row.parentElement, order = [...list.children].map(r => r.dataset.aprow), id = apDrag.row.dataset.aprow; apDrag.row.classList.remove('ap-dragging'); apDrag = null;
    apMoveFav(id, order[order.indexOf(id) + 1] || '', order); vib(6); apPaint();
  };
  // Favorites: `id` now sits before `before` ('' = after the last one shown here). Favorites of apps not installed
  // here keep their place at the end. The box is told which apps follow it, so a gap left by another phone's edit
  // (one it removed meanwhile) still puts it in the right place.
  function apMoveFav(id, before, order = apFavs().filter(x => x !== id)) {
    const raw = apRead(AP_FAV); if (!raw.includes(id)) return;
    const shown = order.filter(x => x !== id), at = before ? shown.indexOf(before) : -1;
    shown.splice(at < 0 ? shown.length : at, 0, id);
    const mine = new Set(shown), rest = raw.filter(x => !mine.has(x)), all = [...shown, ...rest];
    apWrite(AP_FAV, 'appFavorites', all, { op: 'move', item: id, items: all.slice(all.indexOf(id) + 1) });
  }
  apEl.addEventListener('pointerup', apDragEnd); apEl.addEventListener('pointercancel', apDragEnd);
  // Swipe the panel right or down (from the top of its list) to close it.
  var apSw = null;
  apEl.addEventListener('touchstart', e => { const t = e.touches[0]; apSw = e.touches.length === 1 && !apDrag ? { x: t.clientX, y: t.clientY, top: apBody.scrollTop <= 0 } : null; }, { passive: true });
  apEl.addEventListener('touchmove', e => {
    if (!apSw || apDrag) return; const t = e.touches[0], dx = t.clientX - apSw.x, dy = t.clientY - apSw.y;
    const right = dx > 0 && dx > Math.abs(dy), down = apSw.top && dy > 0 && dy > Math.abs(dx) * 1.2;
    if (right || down) apEl.style.transform = right ? `translateX(${dx}px)` : `translateY(${dy}px)`; else apEl.style.transform = '';
    if (down && e.cancelable) e.preventDefault();
  }, { passive: false });
  const apSwEnd = e => {
    if (!apSw) return; const t = e.changedTouches?.[0], s = apSw; apSw = null; if (!t) { apEl.style.transform = ''; return; }
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if ((dx > 70 && dx > Math.abs(dy)) || (s.top && dy > 70 && dy > Math.abs(dx))) { vib(6); apClose(); } else apEl.style.transform = '';
  };
  apEl.addEventListener('touchend', apSwEnd); apEl.addEventListener('touchcancel', apSwEnd);

  /* ---- hold the Apps tile: nine bubbles ---- */
  var apGridState = null, apHoldT = 0;
  function apNine() {
    const seen = new Set(), out = [], ok = apOk(), add = id => { if (out.length < 9 && id && !seen.has(id) && apUsable(APP[id], ok)) { seen.add(id); out.push(id); } };
    apRecentAll().forEach(add); apFavs().forEach(add); apAll().forEach(a => add(a.id)); // a new owner still gets nine to pick from
    return out;
  }
  function apGridOpen(tile) {
    const ids = apNine(); if (!ids.length) return false;
    apClose();
    // Cell k (0 = the most recent) fills from the bottom-right corner, nearest the thumb, leftwards then up.
    apGrid.innerHTML = ids.map((id, k) => { const a = APP[id]; return `<button class="ap-bub" type="button" role="menuitem" data-apbub="${esc(id)}" style="grid-row:${3 - Math.floor(k / 3)};grid-column:${3 - (k % 3)}" aria-label="${esc(a.name)}">${ico('span', 'ap-bi', a)}<span class="ap-bn">${esc(a.name)}</span></button>`; }).join('');
    const r = tile.getBoundingClientRect(), dv = device.getBoundingClientRect(); apPlace(false);
    apGrid.style.setProperty('--ap-right', Math.max(4, dv.right - r.right - 2) + 'px');
    apGrid.hidden = false; apScrim.hidden = false; device.classList.add('ap-grid-up');
    requestAnimationFrame(() => { apGrid.classList.add('open'); apScrim.classList.add('open', 'ap-deep'); });
    apGridState = { hot: '' }; vib(14); return true;
  }
  function apGridClose() {
    clearTimeout(apHoldT); apHoldT = 0;
    if (!apGridState) return false;
    apGridState = null; apGrid.classList.remove('open'); apGrid.hidden = true; device.classList.remove('ap-grid-up');
    apScrim.classList.remove('ap-deep'); if (!apState.open) { apScrim.classList.remove('open'); apScrim.hidden = true; }
    return true;
  }
  const apBubAt = (x, y) => { const el = document.elementFromPoint(x, y); return el?.closest?.('.ap-bub') || null; };
  // From app-sections.js: the finger went down on the Apps tile.
  function apHold(e) {
    clearTimeout(apHoldT); apHoldT = 0;
    if (!apReady || !apOn()) return;
    const tile = e.target.closest?.('.sec-tile'), x = e.clientX, y = e.clientY;
    apHoldT = setTimeout(() => { apHoldT = 0; if (tile && apGridOpen(tile)) apGridState.from = { x, y }; }, 350);
    apHoldFrom = { x, y };
  }
  var apHoldFrom = null;
  // Returns true while the bubbles own this finger.
  function apHoldMove(e) {
    if (apHoldT && apHoldFrom && Math.hypot(e.clientX - apHoldFrom.x, e.clientY - apHoldFrom.y) > 10) { clearTimeout(apHoldT); apHoldT = 0; }
    if (!apGridState) return false;
    const b = apBubAt(e.clientX, e.clientY), id = b ? b.dataset.apbub : '';
    if (id !== apGridState.hot) { apGridState.hot = id; apGrid.querySelectorAll('.ap-bub').forEach(x => x.classList.toggle('hot', x === b)); if (id) vib(5); }
    return true;
  }
  // The finger lifted: a bubble under it opens; anywhere else cancels. True when the bubbles had it.
  function apHoldEnd(e) {
    clearTimeout(apHoldT); apHoldT = 0; apHoldFrom = null;
    if (!apGridState) return false;
    const b = e.type === 'pointerup' ? apBubAt(e.clientX, e.clientY) : null, id = b?.dataset.apbub;
    apGridClose();
    if (id && APP[id]) { apOpened(id); tapOpen(APP[id], null, false); }
    return true;
  }
  // A tap on a bubble (keyboard, a screen reader) opens it too.
  apGrid.addEventListener('click', e => { const b = e.target.closest?.('.ap-bub'); if (!b) return; const id = b.dataset.apbub; apGridClose(); if (APP[id]) { apOpened(id); tapOpen(APP[id], null, false); } });
  phoneBack?.watch?.(() => !!apGridState, () => { apGridClose(); return 'apps-grid'; }, 'apps-grid');

  /* ---- Apps in front: a bar swipe steps one app through Recent ---- */
  function apStepping() { return apReady && apOn() && !apState.open && !apGridState && !appVars.sheet && window.WizCore.phoneSections?.current?.() === 'apps'; }
  function apFront() {
    const P = window.WizCore.phoneSections, did = P?.sections?.().apps, d = did ? appVars.desks.find(x => x.id === did) : null;
    const w = d ? appVars.W[d.focus] || appVars.W[d.wins[0]] : null; return w?.app === 'chats' && w.agent ? 'agent:' + w.agent : w?.appId || '';
  }
  function apStepList() {
    const P = window.WizCore.phoneSections, skip = new Set([P?.slotId?.() || '', CHATS_APP.id]);
    // An agent's chats step like any app: they open as their own window in the Apps section (ux#2007).
    return apRecentAll().filter(id => !skip.has(id) && ((APP[id]?.kind === 'wizard' && APP[id].url) || (APP[id]?.kind === 'chats' && APP[id].agent)));
  }
  // step +1: the next older recent app (a swipe to the left); -1: back toward the newest (a swipe to the right).
  function apStep(step) {
    const list = apStepList(), cur = apFront(), at = list.indexOf(cur);
    const to = at < 0 ? (step > 0 ? list.findIndex(id => id !== cur) : -1) : at + step;
    if (to < 0 || to >= list.length || list[to] === cur) { vib(4); return false; } // the ends: it stays (no wrap)
    const a = APP[list[to]]; openApp(a); vib(8);
    toast('⇄', `${esc(a.name)} · ${to + 1} of ${list.length}`, 1200);
    return true;
  }

  /* ---- staying in step ---- */
  addEventListener('wizard:apps', () => apPaint());
  addEventListener('wos:prefs', () => apPaint());
  new MutationObserver(() => { if (!apOn()) { apClose(); apGridClose(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-shell'] });
  apReady = true;
  // Read-only view for tests and QA.
  window.WizCore.appsPanel = Object.freeze({ on: apOn, isOpen: () => apState.open, view: () => ({ ...apState }), favorites: apFavs, moveFav: (id, before) => { apMoveFav(id, before); apPaint(); }, recent: apRecent, nine: apNine, stepList: apStepList, front: apFront, open: apOpen, close: apClose, step: apStep, stepping: apStepping });
  // appsPanelOpen: the Apps tile's selector; false only before this part is ready (the Apps sheet opens then).
  const appsPanelOpen = () => apOpen();
  // The Apps tile tapped while the panel is up (or closed by this same finger): it goes away, nothing else happens.
  const appsPanelToggled = () => { if (apClose()) return true; return Date.now() - apState.closedAt < 500; };
  return { appsPanelHold: apHold, appsPanelHoldEnd: apHoldEnd, appsPanelHoldMove: apHoldMove, appsPanelOn: apOn, appsPanelOpen, appsPanelToggled, appsStep: apStep, appsStepping: apStepping };
};
