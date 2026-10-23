/* Pinned Chats threads, the same on every device of the owner. Shared by phone and desktop shells.
 * The list lives in Agent Service's box-wide shell preferences (pinnedChats via /wizard/v1/ui-preferences, the
 * path live.js already syncs); localStorage is only this device's offline cache of it. Pins made on a device
 * before pins synced (Novaire's device-local wos.chats.pinned.v1) are merged into the shared list once.
 * Pin design: Novaire (wizard-ux #250). */
(() => {
  'use strict';
  const KEY = 'wos.chats.pinned.v2', LEGACY = 'wos.chats.pinned.v1', MIGRATED = 'wos.chats.pinned.migrated.v1';
  const MAX = 300, ID = /^[A-Za-z0-9._:-]{1,180}$/;
  const clean = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && ID.test(id)))].slice(0, MAX) : [];
  const parse = raw => { try { return clean(JSON.parse(raw || '[]')); } catch (_) { return []; } };
  let cache = null, cacheRaw = null;
  const read = () => { let raw = null; try { raw = localStorage.getItem(KEY); } catch (_) {} if (raw !== cacheRaw || !cache) { cacheRaw = raw; cache = parse(raw); } return cache; };
  const emit = () => window.dispatchEvent(new Event('wos:chat-pins'));
  const save = ids => {
    const next = clean(ids);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
    emit();
    window.WizLive?.putPrefs?.({ pinnedChats: next });
    return next;
  };
  async function migrate() {
    let legacy = [];
    try { if (localStorage.getItem(MIGRATED)) return; legacy = parse(localStorage.getItem(LEGACY)); } catch (_) { return; }
    if (!legacy.length) { try { localStorage.setItem(MIGRATED, '1'); } catch (_) {} return; }
    try {
      const r = await fetch('/wizard/v1/ui-preferences', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return; // older service or offline: try again next load, keep the local pins meanwhile
      const j = await r.json(), shared = clean(j?.pinnedChats);
      const merged = clean(shared.concat(legacy.filter(id => !shared.includes(id))));
      if (merged.length !== shared.length) {
        const w = await fetch('/wizard/v1/ui-preferences', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinnedChats: merged }) });
        if (!w.ok) return;
      }
      try { localStorage.setItem(KEY, JSON.stringify(merged)); localStorage.setItem(MIGRATED, '1'); localStorage.removeItem(LEGACY); } catch (_) {}
      emit();
    } catch (_) {}
  }
  const api = Object.freeze({
    scope: 'owner',
    ids: () => read().slice(),
    has(id) { return read().includes(String(id || '')); },
    toggle(id) {
      id = String(id || ''); if (!ID.test(id)) return false;
      const ids = read().slice(), at = ids.indexOf(id);
      if (at >= 0) { ids.splice(at, 1); save(ids); return false; }
      ids.push(id); save(ids); return true;
    },
    partition(rows, eligible = () => true) {
      const list = Array.isArray(rows) ? rows : [], byId = new Map(list.map(row => [String(row?.id || ''), row]));
      const pinned = read().map(id => byId.get(id)).filter(row => row && eligible(row));
      const selected = new Set(pinned);
      return { pinned, rest: list.filter(row => !selected.has(row)) };
    },
    _migrate: migrate,
  });
  window.WosChatPins = api;
  // Another tab on this device, or a pull of the shared list (live.js writes the cache, then fires wos:prefs).
  window.addEventListener('storage', e => { if (e?.key === KEY) emit(); });
  let last = JSON.stringify(read());
  window.addEventListener('wos:prefs', () => { const now = JSON.stringify(read()); if (now !== last) { last = now; emit(); } });
  window.addEventListener('wos:chat-pins', () => { last = JSON.stringify(read()); });
  setTimeout(migrate, 1500);
})();
