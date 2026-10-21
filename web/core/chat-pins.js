/* Device-local pinned Chats threads. Shared by phone and desktop shells. */
(() => {
  'use strict';
  const KEY = 'wos.chats.pinned.v1';
  const MAX = 500;
  const clean = value => Array.isArray(value)
    ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 256))].slice(0, MAX)
    : [];
  const read = () => {
    try { return clean(JSON.parse(localStorage.getItem(KEY) || '[]')); }
    catch (_) { return []; }
  };
  const write = ids => {
    const next = clean(ids);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('wos:chat-pins'));
    return next;
  };
  const api = Object.freeze({
    scope: 'device',
    ids: read,
    has(id) { return read().includes(String(id || '')); },
    toggle(id) {
      id = String(id || ''); if (!id || id.length > 256) return false;
      const ids = read(), at = ids.indexOf(id);
      if (at >= 0) { ids.splice(at, 1); write(ids); return false; }
      ids.push(id); write(ids); return true;
    },
    partition(rows, eligible = () => true) {
      const list = Array.isArray(rows) ? rows : [], byId = new Map(list.map(row => [String(row?.id || ''), row]));
      const pinned = read().map(id => byId.get(id)).filter(row => row && eligible(row));
      const selected = new Set(pinned);
      return { pinned, rest: list.filter(row => !selected.has(row)) };
    },
  });
  window.WosChatPins = api;
  window.addEventListener('storage', event => {
    if (event?.key === KEY) window.dispatchEvent(new Event('wos:chat-pins'));
  });
})();
