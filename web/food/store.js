/* Food's saved orders, on this phone's Wizard OS page (localStorage). Was android/.../usuals/UsualsStore.java.
 * Recipes are this phone's Grab taps, so they stay on the device. migrate() copies what the pre-v1 native Food kept
 * (read-only device.automation.legacyRecipes) once; the native copy is left untouched so an older web still works. */
(function (root) {
  'use strict';
  const KEY = 'wos.food.v1';
  function create(storage, rules, { now = () => Date.now(), rand = () => Math.random() } = {}) {
    const empty = () => ({ v: 1, recipes: [], pending: {}, migrated: '' });
    function load() {
      try {
        const o = JSON.parse(storage.getItem(KEY) || 'null');
        if (o && o.v === 1 && Array.isArray(o.recipes)) { o.pending = o.pending || {}; return o; }
      } catch (e) { /* fall through */ }
      return empty();
    }
    const save = o => storage.setItem(KEY, JSON.stringify(o));
    const view = r => Object.assign({}, r, { script: rules.write(r.steps || []) });
    const newId = p => p + '-' + Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0');
    return {
      all: () => load().recipes.map(view),
      get(id) { const r = load().recipes.find(x => x.id === id); return r ? view(r) : null; },
      put(r) {
        const o = load(), x = Object.assign({}, r);
        delete x.script;
        if (!x.id) { x.id = newId('u'); x.createdAt = now(); }
        const i = o.recipes.findIndex(y => y.id === x.id);
        if (i >= 0) o.recipes[i] = x; else o.recipes.push(x);
        save(o);
        return view(x);
      },
      remove(id) { const o = load(); o.recipes = o.recipes.filter(x => x.id !== id); save(o); },
      uniqueName(base) {
        const taken = load().recipes.map(r => r.name);
        if (!taken.includes(base)) return base;
        for (let i = 2; i < 50; i++) if (!taken.includes(base + ' ' + i)) return base + ' ' + i;
        return base;
      },
      /** A recording in flight (survives the page being killed while the owner is in Grab). */
      pend(info) { const o = load(), id = newId('t'); o.pending[id] = Object.assign({ at: now() }, info); save(o); return id; },
      pending: id => load().pending[id] || null,
      unpend(id) { const o = load(); delete o.pending[id]; save(o); },
      migrated: () => load().migrated || '',
      migrate(legacy) {
        const o = load();
        if (o.migrated) return 0;
        let n = 0;
        for (const u of Array.isArray(legacy) ? legacy : []) {
          if (!u || !u.id || o.recipes.some(r => r.id === String(u.id))) continue;
          o.recipes.push(fromLegacy(u)); n++;
        }
        o.migrated = 'native-usuals'; o.migratedCount = n; o.migratedAt = now();
        save(o);
        return n;
      },
    };
  }
  function fromLegacy(u) {
    return {
      id: String(u.id), name: String(u.name || ''), pkg: String(u.pkg || 'com.grabtaxi.passenger'),
      steps: (Array.isArray(u.steps) ? u.steps : []).map(s => ({ type: s.type || 'tap', label: s.label || '', id: s.id || '', near: s.near || '' })),
      basket: String(u.basket || ''), place: String(u.place || ''), lastTotal: String(u.lastTotal || ''),
      lastRunAt: +u.lastRunAt || 0, lastResult: String(u.lastResult || ''), needsName: !!u.needsName, createdAt: +u.createdAt || 0,
    };
  }
  root.WosFoodStore = { create, KEY, fromLegacy };
})(typeof window !== 'undefined' ? window : globalThis);
